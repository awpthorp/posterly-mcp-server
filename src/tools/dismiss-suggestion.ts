import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { mdSuccess } from '../lib/format.js';

export const dismissSuggestionTool = {
  name: 'dismiss_suggestion',
  description:
    'Dismiss a proactive post suggestion so it stops appearing. WRITE: confirm the exact suggestion with the user first. Never dismisses a suggestion that was already turned into a scheduled post (that would break adoption tracking).',
  inputSchema: z.object({
    suggestion_id: z
      .string()
      .describe('Suggestion ID from list_post_suggestions.'),
  }),

  async execute(client: PosterlyClient, input: { suggestion_id: string }) {
    const result = await client.dismissSuggestion(input.suggestion_id);
    return mdSuccess('Suggestion dismissed', [
      ['Suggestion ID', input.suggestion_id],
      ['Status', result.status || 'dismissed'],
    ]);
  },
};
