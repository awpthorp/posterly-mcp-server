import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { mdTitle } from '../lib/format.js';

export const resumeSubscriptionTool = {
  name: 'resume_subscription',
  description:
    "Resume the authenticated user's paused posterly subscription, restoring active billing. Requires the billing:write scope.",
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    await client.resumeSubscription();
    return mdTitle('Subscription resumed', 'Billing has been restored to active.');
  },
};
