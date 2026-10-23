import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdSuccess } from '../lib/format.js';
import { suggestionAcceptNote } from '../lib/suggestion-accept-note.js';

export const dismissSuggestionTool = {
  name: 'dismiss_suggestion',
  description:
    'Dismiss a proactive post suggestion so it stops appearing, or pass save_as_draft true to turn it into an unpublished draft instead. A draft is not scheduled and nothing is published. WRITE: confirm the exact suggestion with the user first. Never dismisses, and does not overwrite, a suggestion that was already turned into a post.',
  inputSchema: z.object({
    suggestion_id: z
      .string()
      .describe('Suggestion ID from list_post_suggestions.'),
    save_as_draft: z
      .boolean()
      .optional()
      .describe('True saves the suggestion as an unpublished draft and does not dismiss it. Omit to dismiss.'),
  }),

  async execute(client: PosterlyClient, input: { suggestion_id: string; save_as_draft?: boolean; scheduled_at?: string; publish_at?: string; publish?: boolean }) {
    if (input.scheduled_at || input.publish_at || input.publish) {
      throw new Error('Saving a suggestion creates an unpublished draft. It does not schedule or publish.');
    }
    if (input.save_as_draft === true) {
      const result = await client.acceptSuggestion(input.suggestion_id);
      const postId = result.post_id != null ? code(String(result.post_id)) : 'unknown';
      return [
        mdSuccess(result.already_saved ? 'Suggestion already saved' : 'Suggestion saved as a draft', [
          ['Post ID', postId],
          ['Status', result.status || 'unknown'],
        ]),
        suggestionAcceptNote(Boolean(result.already_saved), result.status ?? null),
      ].join('\n\n');
    }
    const result = await client.dismissSuggestion(input.suggestion_id);
    return mdSuccess('Suggestion dismissed', [
      ['Suggestion ID', input.suggestion_id],
      ['Status', result.status || 'dismissed'],
    ]);
  },
};
