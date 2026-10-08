import { z } from 'zod';
import type { DowngradeSubscriptionResponse, PosterlyClient, SubscriptionTierName } from '../lib/api-client.js';
import { mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

const TIER_VALUES = ['starter', 'pro', 'power_user', 'agency'] as const;

function formatDowngraded(result: DowngradeSubscriptionResponse): string {
  return [
    mdTitle('Subscription downgrade scheduled'),
    mdSection('Details', mdKeyValue([
      ['New tier at next renewal', result.tier],
    ])),
  ].join('\n\n');
}

export const downgradeSubscriptionTool = {
  name: 'downgrade_subscription',
  description:
    "Downgrade the authenticated user's posterly subscription one tier (or to an explicit lower `tier`) at the next renewal with no proration. Billing action; requires the billing:write scope. Only call after the user explicitly confirms.",
  inputSchema: z.object({
    tier: z.enum(TIER_VALUES).optional().describe('Optional explicit target tier. Omit to drop one tier automatically.'),
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms the downgrade.'),
  }),

  async execute(client: PosterlyClient, input: { tier?: SubscriptionTierName; confirm: true }) {
    const result = await client.downgradeSubscription({ tier: input.tier });
    return formatDowngraded(result);
  },
};
