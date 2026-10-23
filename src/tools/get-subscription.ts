import { z } from 'zod';
import type { ExtraAccountsStateResponse, PosterlyClient, SubscriptionSummaryResponse } from '../lib/api-client.js';
import { formatDateTime, mdBullets, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { formatExtraAccountsPaymentPending, intervalWord, usdFromCents } from './manage-extra-account.js';

function formatConnectedAccounts(accounts: { used?: number; limit?: number } | null | undefined): string | null {
  if (!accounts || typeof accounts.limit !== 'number' || !Number.isFinite(accounts.limit)) return null;
  const used = typeof accounts.used === 'number' && Number.isFinite(accounts.used)
    ? Math.max(0, Math.floor(accounts.used))
    : 0;
  if (accounts.limit < 0) return `${used} of unlimited`;
  return `${used} of ${accounts.limit}`;
}

/** The Agency extra-accounts block (owner only). Same wording as the hosted endpoint. */
function formatExtraAccountsSection(state: ExtraAccountsStateResponse, directoryProfile = false): string {
  const word = intervalWord(state.interval);
  const price = state.price_per_account_cents === null || state.price_per_account_cents === undefined
    ? 'n/a'
    : `${usdFromCents(state.price_per_account_cents)} per extra account per ${word}`;
  const rows: Array<[string, string | number]> = [
    ['Included with Agency', state.included_accounts],
    ['Granted by posterly', state.admin_granted_accounts],
    ['Paid extra accounts', state.paid_extra_accounts],
    ['Account limit', state.account_limit],
    ['Connected accounts in use', state.accounts_in_use],
  ];
  if (!directoryProfile) rows.push(['Price', price]);
  rows.push(['Current extra accounts cost', state.recurring_cents === null || state.recurring_cents === undefined ? 'n/a' : `${usdFromCents(state.recurring_cents)} per ${word}`]);
  if (!directoryProfile) {
    rows.push(['Minimum purchase', `${state.min_purchase} accounts at a time, no maximum`]);
    rows.push(['Lowest total you can set now', state.min_paid_extra_accounts]);
  }
  rows.push(['On a trial', state.trialing ? 'yes, no charge until the trial ends' : 'no']);
  if (!directoryProfile) {
    rows.push(['Can change now', state.eligible
      ? 'yes, with manage_extra_account'
      : `no (${state.code || 'not eligible'}). ${state.reason || 'Extra accounts are not available for this subscription right now.'}`]);
  }
  return mdSection('Extra accounts', mdKeyValue(rows));
}

/**
 * `directoryProfile` is the Claude directory profile: its catalog has no
 * billing mutations, so the output is facts only (no tool names, no offers,
 * no money steps) plus one line pointing at the billing page.
 */
function formatSubscription(result: SubscriptionSummaryResponse, options_?: { directoryProfile?: boolean }): string {
  const sub = result.subscription;
  const connectedAccounts = formatConnectedAccounts(sub.accounts);
  const directoryProfile = options_?.directoryProfile === true;
  const options = directoryProfile ? [] : Array.isArray(sub.upgrade_options) ? sub.upgrade_options : [];
  const steps = directoryProfile ? [] : Array.isArray(sub.next_steps) ? sub.next_steps : [];
  return [
    mdTitle('posterly subscription'),
    mdSection('Details', mdKeyValue([
      ['Status', sub.status || 'unknown'],
      ['Tier', sub.tier || 'unknown'],
      ['Cancel at period end', sub.cancel_at_period_end ? 'yes' : 'no'],
      ['Current period end', sub.current_period_end ? formatDateTime(sub.current_period_end) : 'n/a'],
      ['Trial ends', sub.trial_ends_at ? formatDateTime(sub.trial_ends_at) : 'n/a'],
      ['Paused at', sub.paused_at ? formatDateTime(sub.paused_at) : 'n/a'],
      ['Pause resumes at', sub.pause_resumes_at ? formatDateTime(sub.pause_resumes_at) : 'n/a'],
      ...(connectedAccounts ? [['Connected accounts', connectedAccounts] as [string, string]] : []),
    ])),
    sub.extra_accounts ? formatExtraAccountsSection(sub.extra_accounts, directoryProfile) : '',
    sub.extra_accounts?.payment_pending ? formatExtraAccountsPaymentPending(sub.extra_accounts.payment_pending) : '',
    directoryProfile
      ? `Plan and billing changes are made on the billing page: ${typeof sub.billing_url === 'string' && sub.billing_url ? sub.billing_url : 'https://www.poster.ly/dashboard/account/billing'}`
      : '',
    options.length
      ? mdSection('Plans you can move to', mdBullets(options.map((o) => `${o.name}: $${o.monthly_price}/month or $${o.yearly_price}/year, ${o.max_accounts} connected accounts, ${o.included_credits} AI credits a month`)))
      : '',
    steps.length
      ? mdSection('Next steps', steps.map((step, index) => [
        `${index + 1}. ${step.text}`,
        step.tool ? `   Tool: ${step.tool}${step.params ? ` ${JSON.stringify(step.params)}` : ''}` : '',
      ].filter(Boolean).join('\n')).join('\n'))
      : '',
  ].filter(Boolean).join('\n\n');
}

export const getSubscriptionTool = {
  name: 'get_subscription',
  description:
    "Get the authenticated user's posterly subscription: status, tier, cancel-at-period-end, period end, trial end and pause state. Also reports connected accounts in use and the account limit for the workspace this caller is acting in (plan tier plus any extra slots). Call this FIRST for \"upgrade\", \"change plan\", \"add accounts\" or \"how many accounts\": it returns the plans above this user's with prices, limits and credits, the Agency extra-accounts state (owners), and the exact next steps. Read-only. Requires the billing:read scope.",
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const result = await client.getSubscription();
    // Same switch index.ts uses to drop the billing mutations from the catalog.
    return formatSubscription(result, { directoryProfile: process.env.POSTERLY_DIRECTORY_PROFILE === 'claude' });
  },
};
