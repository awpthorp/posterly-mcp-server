import { z } from 'zod';
import type { PauseSubscriptionResponse, PosterlyClient } from '../lib/api-client.js';
import { formatDateTime, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

function formatPaused(result: PauseSubscriptionResponse): string {
  return [
    mdTitle('Subscription paused'),
    mdSection('Details', mdKeyValue([
      ['Resumes at', result.pause_resumes_at ? formatDateTime(result.pause_resumes_at) : 'n/a'],
    ])),
  ].join('\n\n');
}

export const pauseSubscriptionTool = {
  name: 'pause_subscription',
  description:
    "Pause the authenticated user's posterly subscription for 30 days (one pause allowed per 90-day cooldown). Billing action; requires the billing:write scope. Only call after the user explicitly confirms.",
  inputSchema: z.object({
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms pausing the subscription.'),
  }),

  async execute(client: PosterlyClient, _input: { confirm: true }) {
    const result = await client.pauseSubscription();
    return formatPaused(result);
  },
};
