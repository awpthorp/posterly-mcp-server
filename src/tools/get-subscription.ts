import { z } from 'zod';
import type { PosterlyClient, SubscriptionSummaryResponse } from '../lib/api-client.js';
import { formatDateTime, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

function formatSubscription(result: SubscriptionSummaryResponse): string {
  const sub = result.subscription;
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
    ])),
  ].join('\n\n');
}

export const getSubscriptionTool = {
  name: 'get_subscription',
  description:
    "Get the authenticated user's posterly subscription: status, tier, cancel-at-period-end, current period end, trial end, and pause state. Read-only. Requires the billing:read scope.",
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const result = await client.getSubscription();
    return formatSubscription(result);
  },
};
