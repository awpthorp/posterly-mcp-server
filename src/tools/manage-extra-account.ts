import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ExtraAccountsChangeResponse, ExtraAccountsPaymentPending, ExtraAccountsQuote, PosterlyClient } from '../lib/api-client.js';
import { formatDateTime, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { previewThenConfirm, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

export function usdFromCents(cents: number | null | undefined): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0;
  return `$${(n / 100).toFixed(2)}`;
}

export function intervalWord(interval: unknown): string {
  return interval === 'year' ? 'year' : 'month';
}

/** Same wording as the hosted endpoint (lib/mcp/http-tools.ts). */
export function formatExtraAccountsPaymentPending(pending: ExtraAccountsPaymentPending | null | undefined): string {
  if (!pending) return '';
  return mdSection('Payment waiting', [
    mdKeyValue([
      ['Requested extra accounts', pending.requested_extra_accounts],
      ['Amount due', pending.amount_due_cents === null || pending.amount_due_cents === undefined ? 'n/a' : usdFromCents(pending.amount_due_cents)],
      ['Expires', pending.expires_at ? formatDateTime(pending.expires_at) : 'n/a'],
      ['Payment link', pending.hosted_invoice_url || 'not available, finish it in Billing'],
    ]),
    'Nothing has been added yet. The accounts apply automatically once this invoice is paid. Until then posterly will not accept another change.',
  ].join('\n\n'));
}

export function formatExtraAccountsQuote(q: ExtraAccountsQuote): string {
  const word = intervalWord(q.interval);
  const verb = q.kind === 'none' ? 'No change' : q.kind === 'increase' ? 'Add accounts' : q.kind === 'remove' ? 'Remove all extra accounts' : 'Lower extra accounts';
  const chargeLine = q.kind === 'increase'
    ? (q.trialing
      ? 'Nothing is charged today because the subscription is on a trial. Billing starts when the trial ends.'
      : `The saved card on file is charged ${q.charge_today || usdFromCents(q.charge_today_cents)} today (prorated for the rest of this billing period) when this is confirmed. If the card needs confirmation or declines, nothing is added and a payment link is returned instead.`)
    : q.kind === 'none'
      ? 'Nothing changes and nothing is charged.'
      : 'Nothing is charged and nothing is refunded for the rest of this billing period. The lower limit applies right away.';
  return [
    mdSection(verb, mdKeyValue([
      ['Extra accounts now', q.current_extra_accounts],
      ['Extra accounts after', q.new_extra_accounts],
      ['Account limit after', q.account_limit_after],
      ['Connected accounts in use', q.accounts_in_use],
      ['Charge today', q.kind === 'increase' ? (q.trialing ? '$0.00 (trial)' : q.charge_today || usdFromCents(q.charge_today_cents)) : '$0.00'],
      ['New recurring cost', `${q.new_recurring || usdFromCents(q.new_recurring_cents)} per ${word} for ${q.new_extra_accounts} extra accounts (${usdFromCents(q.price_per_account_cents)} each)`],
    ])),
    chargeLine,
  ].join('\n\n');
}


type ManageExtraAccountInput = {
  action: 'set';
  extra_accounts: number;
  workspace_id?: string;
  expected_current_extra_accounts?: number;
  expected_interval?: 'month' | 'year';
  confirm?: boolean;
  preview_id?: string;
};

export const manageExtraAccountTool = {
  name: 'manage_extra_account',
  description:
    'Buy, raise, lower, or remove Agency extra-account slots. MONEY: raising charges the saved card. Owner only; billing:write. action=set (extra_accounts = desired TOTAL, 0 removes all; add 20+ at a time). Call without confirm for the quote and preview_id; after the user agrees, call with confirm=true, that preview_id and the expected_ fields from the quote. 3D Secure or a decline returns a payment link; nothing is added.',
  inputSchema: z.object({
    action: z.enum(['set']),
    extra_accounts: z.number().int().min(0),
    workspace_id: z.string().optional(),
    expected_current_extra_accounts: z.number().int().min(0).optional(),
    expected_interval: z.enum(['month', 'year']).optional(),
    confirm: z.boolean().optional(),
    preview_id: z.string().optional(),
  }),

  async execute(client: PosterlyClient, input: ManageExtraAccountInput, ctx: ToolContext) {
    const { args } = validateArgs(ctx, 'manage_extra_account', input);
    const call = args as ManageExtraAccountInput;
    const workspace = call.workspace_id ? { workspace_id: call.workspace_id } : {};
    // A preview is only issued for a change posterly can actually make: price
    // it first, and answer a failed quote with an error and NO preview_id. The
    // quote's current total and interval are pinned into the previewed args,
    // so the confirm must repeat them and the API refuses a stale quote.
    let quote: ExtraAccountsQuote | null = null;
    let previewArgs: Record<string, any> = args;
    if (call.confirm !== true) {
      const read = await readForPreview(() => client.quoteExtraAccounts({ extra_accounts: call.extra_accounts, ...workspace }));
      if (!read.ok) {
        throw new Error([
          'No preview: this change cannot be made right now.',
          read.error,
          'Nothing was changed and no preview_id was issued. Tell the user why, and fix the cause first (for example disconnect accounts, finish the pending payment, or pick at least 20 more than the current total).',
        ].join('\n\n'));
      }
      quote = read.data.quote;
      previewArgs = {
        ...args,
        expected_current_extra_accounts: quote.current_extra_accounts,
        expected_interval: quote.interval,
      };
    }
    return previewThenConfirm({
      tool: 'manage_extra_account',
      action: 'set',
      args: previewArgs,
      nonce: true,
      legacyRefusal: 'Refusing to change extra accounts without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => [
        formatExtraAccountsQuote(quote as ExtraAccountsQuote),
        (quote as ExtraAccountsQuote).kind === 'none' ? '' : 'Only confirm after the user has seen the price and agreed. The change is billed to the saved card, not to anything the user types here.',
        mdSection('Fields to repeat on confirm', mdKeyValue([
          ['extra_accounts', (quote as ExtraAccountsQuote).new_extra_accounts],
          ['expected_current_extra_accounts', (quote as ExtraAccountsQuote).current_extra_accounts],
          ['expected_interval', (quote as ExtraAccountsQuote).interval],
        ])),
      ].filter(Boolean).join('\n\n'),
      run: async () => {
        if (typeof call.expected_current_extra_accounts !== 'number' || !call.expected_interval) {
          throw new Error('Confirm needs expected_current_extra_accounts and expected_interval from the preview. Get a new preview.');
        }
        // The same preview_id always maps to the same request_id, so a replayed
        // confirm can never buy twice.
        const requestId = typeof call.preview_id === 'string' && call.preview_id
          ? `mcp-${createHash('sha256').update(call.preview_id).digest('hex').slice(0, 40)}`
          : undefined;
        const result = await client.setExtraAccounts({
          extra_accounts: call.extra_accounts,
          expected_current_extra_accounts: call.expected_current_extra_accounts,
          expected_interval: call.expected_interval,
          ...(requestId ? { request_id: requestId } : {}),
          ...workspace,
        });
        return formatExtraAccountsResult(result);
      },
    });
  },
};

function formatExtraAccountsResult(d: ExtraAccountsChangeResponse): string {
  if (d.status === 'payment_required') {
    return [
      mdTitle('Payment needed: nothing was added yet'),
      'The saved card needs confirmation (3D Secure) or was declined, so posterly did not add the accounts. Send the user to the payment link. The accounts apply automatically once it is paid.',
      mdKeyValue([
        ['Requested extra accounts', d.requested_extra_accounts],
        ['Account limit once paid', d.account_limit_after_payment],
        ['Amount due', d.payment_pending?.amount_due_cents === null || d.payment_pending?.amount_due_cents === undefined ? 'n/a' : usdFromCents(d.payment_pending.amount_due_cents)],
        ['Link expires', d.payment_pending?.expires_at ? formatDateTime(d.payment_pending.expires_at) : 'n/a'],
        ['Payment link', d.hosted_invoice_url || 'not available, ask the user to finish it in Billing'],
      ]),
      'Call get_subscription afterwards to confirm the new limit.',
    ].join('\n\n');
  }
  if (d.status === 'unchanged') {
    return [
      mdTitle('No change needed'),
      `The workspace already has ${d.extra_accounts} extra accounts. The account limit is ${d.account_limit}.`,
    ].join('\n\n');
  }
  const word = intervalWord(d.interval);
  const headline = d.extra_accounts === 0
    ? 'Removed all extra accounts'
    : d.kind === 'increase'
      ? `Added ${d.extra_accounts - d.previous_extra_accounts} extra accounts`
      : `Lowered extra accounts to ${d.extra_accounts}`;
  return [
    mdTitle(headline),
    `The account limit is now ${d.account_limit}.`,
    mdKeyValue([
      ['Extra accounts', `${d.previous_extra_accounts} to ${d.extra_accounts}`],
      ['Included with Agency', d.included_accounts],
      ['Connected accounts in use', d.accounts_in_use],
      ['Recurring cost', `${usdFromCents(d.recurring_cents)} per ${word} (${usdFromCents(d.price_per_account_cents)} per extra account)`],
    ]),
    d.kind === 'increase' ? 'The prorated amount was charged to the saved card.' : '',
  ].filter(Boolean).join('\n\n');
}
