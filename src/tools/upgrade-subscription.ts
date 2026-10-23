import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  PosterlyClient,
  SubscriptionTierName,
  UpgradePaymentPending,
  UpgradeQuote,
  UpgradeSubscriptionResponse,
} from '../lib/api-client.js';
import { formatDateTime, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { previewThenConfirm, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';
import { usdFromCents } from './manage-extra-account.js';

const TIER_VALUES = ['starter', 'pro', 'power_user', 'agency'] as const;

function upgradeNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : String(value);
}

function intervalNoun(interval: string): string {
  return interval === 'year' ? 'year' : interval === 'week' ? 'week' : 'month';
}

function intervalAdverb(interval: string): string {
  return interval === 'year' ? 'yearly' : interval === 'week' ? 'weekly' : 'monthly';
}

/** Same wording as the hosted endpoint (lib/mcp/http-tools.ts). */
export function formatUpgradePaymentPending(pending: UpgradePaymentPending | null | undefined): string {
  if (!pending) return '';
  return mdSection('Payment waiting', [
    mdKeyValue([
      ['Requested plan', pending.requested_tier || 'a plan change'],
      ['Amount due', pending.amount_due_cents === null || pending.amount_due_cents === undefined ? 'n/a' : usdFromCents(pending.amount_due_cents)],
      ['Expires', pending.expires_at ? formatDateTime(pending.expires_at) : 'n/a'],
      ['Payment link', pending.hosted_invoice_url || 'not available, finish it on the billing page'],
    ]),
    'The plan has not changed yet. It changes automatically once this invoice is paid. Until then posterly will not accept another plan change.',
  ].join('\n\n'));
}

export function formatUpgradeQuote(q: UpgradeQuote): string {
  const word = intervalNoun(q.interval);
  const rows: Array<[string, string | number]> = [
    ['Plan now', `${q.current_tier_name} (${intervalAdverb(q.current_interval)})`],
    ['Plan after', `${q.new_tier_name} (${intervalAdverb(q.interval)})`],
    ['Connected accounts', `${upgradeNumber(q.account_limit_before)} to ${upgradeNumber(q.account_limit_after)}`],
    ['AI credits a month', `${upgradeNumber(q.included_credits_before)} to ${upgradeNumber(q.included_credits_after)}`],
    ['Charge today', q.trialing ? '$0.00 (trial)' : q.charge_today || usdFromCents(q.charge_today_cents)],
    [
      'New recurring cost',
      `${q.new_recurring || usdFromCents(q.new_recurring_cents)} per ${word}${q.current_recurring_cents === null || q.current_recurring_cents === undefined ? '' : ` (now ${usdFromCents(q.current_recurring_cents)} per ${intervalNoun(q.current_interval)})`}`,
    ],
  ];
  if (q.interval_changes) rows.push(['Billing interval', `${intervalAdverb(q.current_interval)} to ${intervalAdverb(q.interval)}`]);
  const chargeLine = q.trialing
    ? 'Nothing is charged today because the subscription is on a trial. The trial continues and the new price starts when it ends.'
    : `The saved card on file is charged ${q.charge_today || usdFromCents(q.charge_today_cents)} today (${q.interval_changes ? 'the unused time on the current plan is credited, and the new billing period starts today' : 'prorated for the rest of this billing period'}) when this is confirmed. Prices are before any discount on the subscription, and discounts carry over. If the card needs confirmation or declines, nothing changes and a payment link is returned instead.`;
  return [mdSection(`Upgrade to ${q.new_tier_name}`, mdKeyValue(rows)), chargeLine].join('\n\n');
}

export function formatUpgradeResult(d: UpgradeSubscriptionResponse): string {
  if (d.status === 'payment_required') {
    return [
      mdTitle('Payment needed: the plan was not changed yet'),
      'The saved card needs confirmation (3D Secure) or was declined, so posterly did not change the plan. Send the user to the payment link. The plan changes automatically once it is paid.',
      mdKeyValue([
        ['Requested plan', d.requested_tier_name],
        ['Connected accounts once paid', d.account_limit_after_payment],
        ['AI credits a month once paid', d.included_credits_after_payment],
        ['Amount due', d.payment_pending?.amount_due_cents === null || d.payment_pending?.amount_due_cents === undefined ? 'n/a' : usdFromCents(d.payment_pending.amount_due_cents)],
        ['Link expires', d.payment_pending?.expires_at ? formatDateTime(d.payment_pending.expires_at) : 'n/a'],
        ['Payment link', d.hosted_invoice_url || 'not available, ask the user to finish it on the billing page'],
      ]),
      'Call get_subscription afterwards to confirm the new plan.',
    ].join('\n\n');
  }
  return [
    mdTitle(`Upgraded to ${d.tier_name}`),
    `The plan is now ${d.tier_name}. New limits show in get_subscription as soon as Stripe confirms the change, usually within seconds.`,
    mdKeyValue([
      ['Plan', `${d.previous_tier_name} to ${d.tier_name}`],
      ['Connected accounts', d.account_limit],
      ['AI credits a month', d.included_credits],
      ['Billing interval', intervalAdverb(d.interval)],
      ['Charged today', d.trialing ? '$0.00 (trial)' : d.charged_cents === null || d.charged_cents === undefined ? 'the prorated amount' : usdFromCents(d.charged_cents)],
    ]),
    d.trialing ? 'The trial continues. The new price starts when it ends.' : 'The prorated amount was charged to the saved card.',
  ].join('\n\n');
}

type UpgradeSubscriptionInput = {
  tier: SubscriptionTierName;
  interval?: 'month' | 'year';
  workspace_id?: string;
  expected_current_tier?: SubscriptionTierName;
  expected_interval?: 'week' | 'month' | 'year';
  confirm?: boolean;
  preview_id?: string;
};

export const upgradeSubscriptionTool = {
  name: 'upgrade_subscription',
  description:
    'Upgrade to a strictly higher plan. MONEY: charges the saved card (prorated). Owner only. Call without confirm for the quote and preview_id; after the user agrees, call with confirm=true, that preview_id and the expected_ fields. 3D Secure or a decline returns a payment link; nothing changes.',
  inputSchema: z.object({
    tier: z.enum(TIER_VALUES),
    interval: z.enum(['month', 'year']).optional(),
    workspace_id: z.string().optional(),
    expected_current_tier: z.enum(TIER_VALUES).optional(),
    expected_interval: z.enum(['week', 'month', 'year']).optional(),
    confirm: z.boolean().optional(),
    preview_id: z.string().optional(),
  }),

  async execute(client: PosterlyClient, input: UpgradeSubscriptionInput, ctx: ToolContext) {
    const { args } = validateArgs(ctx, 'upgrade_subscription', input);
    const call = args as UpgradeSubscriptionInput;
    // Read at use time: a repeated, equal interval is dropped below.
    const makeBase = () => ({
      tier: call.tier,
      ...(call.interval ? { interval: call.interval } : {}),
      ...(call.workspace_id ? { workspace_id: call.workspace_id } : {}),
    });
    // A preview is only issued for a change posterly can actually make: price
    // it first, and answer a failed quote with an error and NO preview_id. The
    // quote's current plan and interval are pinned into the previewed args, so
    // the confirm must repeat them and the API refuses a stale quote.
    let quote: UpgradeQuote | null = null;
    let previewArgs: Record<string, any> = args;
    if (call.confirm !== true) {
      const read = await readForPreview(() => client.quoteUpgrade(makeBase()));
      if (!read.ok) {
        throw new Error([
          'No preview: this plan change cannot be made right now.',
          read.error,
          'Nothing was changed and no preview_id was issued. Tell the user why. If the reason points to the billing page, send them there.',
        ].join('\n\n'));
      }
      quote = read.data.quote;
      // An interval equal to the current one is a no-op the preview does not
      // ask to repeat, so it is dropped from the previewed args: the confirm
      // then binds to exactly the fields listed under "Fields to repeat on
      // confirm".
      const { interval: _noopInterval, ...rest } = args as Record<string, any>;
      previewArgs = {
        ...(quote.interval_changes ? args : rest),
        expected_current_tier: quote.current_tier,
        expected_interval: quote.current_interval,
      };
    } else if (call.interval && call.interval === call.expected_interval) {
      // Confirm side of the same rule: a repeated, equal interval is a no-op.
      const { interval: _noopInterval, ...rest } = args as Record<string, any>;
      previewArgs = rest;
      call.interval = undefined;
    }
    return previewThenConfirm({
      tool: 'upgrade_subscription',
      action: 'upgrade',
      args: previewArgs,
      nonce: true,
      legacyRefusal: 'Refusing to upgrade the plan without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => [
        formatUpgradeQuote(quote as UpgradeQuote),
        'Only confirm after the user has seen the price and agreed. The change is billed to the saved card, not to anything the user types here.',
        mdSection('Fields to repeat on confirm', mdKeyValue([
          ['tier', (quote as UpgradeQuote).new_tier],
          ...((quote as UpgradeQuote).interval_changes ? [['interval', (quote as UpgradeQuote).interval] as [string, string]] : []),
          ['expected_current_tier', (quote as UpgradeQuote).current_tier],
          ['expected_interval', (quote as UpgradeQuote).current_interval],
        ])),
      ].join('\n\n'),
      run: async () => {
        if (!call.expected_current_tier || !call.expected_interval) {
          throw new Error('Confirm needs expected_current_tier and expected_interval from the preview. Get a new preview.');
        }
        // The same preview_id always maps to the same request_id, so a replayed
        // confirm can never upgrade twice.
        const requestId = typeof call.preview_id === 'string' && call.preview_id
          ? `mcp-${createHash('sha256').update(call.preview_id).digest('hex').slice(0, 40)}`
          : undefined;
        const result = await client.upgradeSubscription({
          ...makeBase(),
          expected_current_tier: call.expected_current_tier,
          expected_interval: call.expected_interval,
          ...(requestId ? { request_id: requestId } : {}),
        });
        return formatUpgradeResult(result);
      },
    });
  },
};
