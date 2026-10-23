import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatPagingNote, mdTitle, mdSection, mdKeyValue, mdEmpty } from '../lib/format.js';

export const listPostSuggestionsTool = {
  name: 'list_post_suggestions',
  description:
    "List proactive post suggestions: evidence-based weekly drafts posterly writes in each account's learned voice, each with a rationale tying it back to what has performed well for that account. The caption, rationale, and account id are returned in full. Filter by account_id and status (pending, scheduled, dismissed; default pending). The output says whether every matching suggestion is shown; page with offset until it does. Read-only; requires a Pro plan or higher. Use dismiss_suggestion to hide one, or pass save_as_draft true on that tool to keep it as an unpublished draft.",
  inputSchema: z.object({
    account_id: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Filter to one social account ID (from list_accounts).'),
    status: z
      .enum(['pending', 'scheduled', 'dismissed'])
      .optional()
      .describe('Suggestion status to list (default pending).'),
    limit: z.number().int().min(1).max(100).optional().describe('Max suggestions to return (default 20).'),
    offset: z.number().int().min(0).optional().describe('How many suggestions to skip. Use the offset the previous page gives to get the next page.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      account_id?: string | number;
      status?: 'pending' | 'scheduled' | 'dismissed';
      limit?: number;
      offset?: number;
    },
  ) {
    const page = await client.listPostSuggestions(input);
    const { suggestions } = page;

    if (!suggestions.length) {
      return mdEmpty(
        'post suggestions',
        'No proactive post suggestions match these filters. posterly generates fresh drafts weekly for accounts with a learned voice.',
      );
    }

    const blocks = suggestions.map((suggestion) => {
      const label = suggestion.account?.username
        ? `@${suggestion.account.username} (${suggestion.platform || suggestion.account?.platform})`
        : `account ${suggestion.social_account_id}`;
      return mdSection(
        label,
        mdKeyValue([
          ['Suggestion ID', suggestion.id],
          ['Account ID', String(suggestion.social_account_id)],
          ['Status', suggestion.status],
          ['Period', suggestion.period_key || undefined],
          ['Caption', suggestion.caption.replace(/\s+/g, ' ').trim()],
          ['Rationale', suggestion.rationale ? suggestion.rationale.replace(/\s+/g, ' ').trim() : undefined],
        ]),
      );
    });

    const note = formatPagingNote({
      noun: 'suggestions',
      tool: 'list_post_suggestions',
      offset: page.offset ?? input.offset ?? 0,
      count: suggestions.length,
      total: page.total,
      // An API older than has_more: a full page may mean more exist.
      hasMore: page.has_more ?? suggestions.length >= (input.limit || 20),
      nextOffset: page.next_offset,
    });
    return [mdTitle(`Post suggestions (${suggestions.length})`), ...blocks, note].join('\n\n');
  },
};
