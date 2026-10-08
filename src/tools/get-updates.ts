import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatPagingNote } from '../lib/format.js';

export const getUpdatesTool = {
  name: 'get_updates',
  description:
    'Get the latest posterly product updates and news from the updates feed: new features, improvements, and fixes, newest first. The output says whether more updates exist; page with offset or narrow with since. Requires an active posterly subscription.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe('Number of updates to return. Default 10, max 50.'),
    offset: z.number().int().min(0).optional().describe('How many updates to skip. Use the offset the previous page gives to get the next page.'),
    since: z.string().optional().describe('ISO date. Return updates published on or after this date.'),
    include_content: z.boolean().optional().describe('Include the full markdown body of each update. Defaults to false.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      limit?: number;
      offset?: number;
      since?: string;
      include_content?: boolean;
    },
  ) {
    const result = await client.getUpdates(input);
    if (result.updates.length === 0) {
      return 'No posterly updates found.';
    }

    const lines = [`Latest posterly updates (${result.updates.length}):`];
    for (const update of result.updates) {
      const meta = [update.date, update.version ? `v${update.version}` : null, update.type]
        .filter(Boolean)
        .join(', ');
      lines.push(`- ${update.title} [${meta}]${update.summary ? `: ${update.summary}` : ''}`);
      if (update.url) lines.push(`  ${update.url}`);
      if (update.content) {
        lines.push('', update.content.trim(), '');
      }
    }

    lines.push('', formatPagingNote({
      noun: 'updates',
      tool: 'get_updates',
      offset: result.offset ?? input.offset ?? 0,
      count: result.updates.length,
      total: result.total,
      // An API older than has_more: a full page may mean more exist.
      hasMore: result.has_more ?? result.updates.length >= (input.limit || 10),
      nextOffset: result.next_offset,
    }));

    return lines.join('\n');
  },
};
