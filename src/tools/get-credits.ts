import { z } from 'zod';
import type { CreditsSummaryResponse, PosterlyClient } from '../lib/api-client.js';
import { formatDateTime, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

function formatCredits(result: CreditsSummaryResponse): string {
  const c = result.credits;
  const inc = c.included;
  return [
    mdTitle('posterly AI credits'),
    mdSection('Balance', mdKeyValue([
      ['Available now', String(c.available)],
      ['Included this period', `${inc.remaining} of ${inc.monthly} left (${inc.used} used)`],
      ['Purchased packs', String(c.purchased_balance)],
    ])),
    mdSection('Plan', mdKeyValue([
      ['Tier', c.plan_tier || 'unknown'],
      ['Trial', c.is_trial ? 'yes' : 'no'],
      [
        'Included pool resets',
        c.resets_at ? formatDateTime(c.resets_at) : 'no monthly reset (trial or no included pool)',
      ],
      ['Your workspace role', c.workspace?.role || 'unknown'],
    ])),
    "Credits are a shared workspace wallet: every active member draws the same pool, and packs are added to the billing owner's balance.",
  ].join('\n\n');
}

export const getCreditsTool = {
  name: 'get_credits',
  description:
    "Get the authenticated user's posterly AI credit balance: what is available to spend now, how much of the monthly included allowance is left, purchased pack balance, plan tier, and when the included pool next resets. Credits are a shared WORKSPACE wallet, so this reports the balance the caller can actually spend, not a personal figure. Read-only, spends nothing. Requires the billing:read scope.",
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const result = await client.getCredits();
    return formatCredits(result);
  },
};
