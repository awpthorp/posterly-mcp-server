import { z } from 'zod';
import type { CancelSubscriptionResponse, PosterlyClient } from '../lib/api-client.js';
import { mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

// Mirrors CANCELLATION_REASONS in the main app (lib/subscription-reasons.ts).
// Kept in sync manually because the npm package cannot import from the app.
const CANCELLATION_REASONS = [
  'too_expensive',
  'not_using',
  'missing_features',
  'technical_issues',
  'switching_service',
  'temporary_break',
  'other',
] as const;

function formatCanceled(result: CancelSubscriptionResponse): string {
  return [
    mdTitle(result.immediate ? 'Subscription cancelled immediately' : 'Subscription set to cancel at period end'),
    mdSection('Details', mdKeyValue([
      ['Immediate', result.immediate ? 'yes' : 'no'],
      ['Cancel at period end', result.cancel_at_period_end ? 'yes' : 'no'],
      ['Canceled at', result.canceled_at || 'at end of current period'],
    ])),
  ].join('\n\n');
}

export const cancelSubscriptionTool = {
  name: 'cancel_subscription',
  description:
    "Cancel the authenticated user's posterly subscription. DESTRUCTIVE; requires billing:write. ALWAYS ask the user why they are cancelling FIRST and pass their answer as `reason` (one of the allowed values). By default an active or trialing plan is set to cancel at the end of the current period. A past_due or unpaid plan always ends now, even when immediate is false: the unpaid renewal is dropped and payment retries stop. Pass immediate=true only when the user explicitly wants an active plan cancelled right now. Only call after the user explicitly confirms.",
  inputSchema: z.object({
    reason: z.enum(CANCELLATION_REASONS).describe('Why the user is cancelling. Ask the user before calling; do not guess.'),
    feedback: z.string().max(2000).optional().describe('Optional free-text detail the user gave about why they are cancelling.'),
    immediate: z.boolean().optional().describe('Cancel immediately instead of at period end. Defaults to false. Ignored for past_due and unpaid plans, which always end now.'),
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms the cancellation.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { reason: (typeof CANCELLATION_REASONS)[number]; feedback?: string; immediate?: boolean; confirm: true },
  ) {
    const result = await client.cancelSubscription({
      reason: input.reason,
      feedback: input.feedback,
      immediate: input.immediate === true,
    });
    return formatCanceled(result);
  },
};
