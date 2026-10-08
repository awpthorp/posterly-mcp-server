import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatPagingNote } from '../lib/format.js';

export const listActivityTool = {
  name: 'list_activity',
  description:
    'List recent activity and publish events for posts, including status changes, publish attempts, failures, and retries, newest first. Use this as the agent notifications feed. The output says whether more events exist; page with offset (offset + limit up to 1000) or narrow with since or post_id before concluding nothing else happened.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    post_id: z.number().int().positive().optional().describe('Filter to one post ID.'),
    since: z.string().optional().describe('ISO datetime. Return events created at or after this time.'),
    type: z.enum(['all', 'activity', 'publish']).optional().describe('Event source filter. Defaults to all.'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of items to return. Default 50, max 100.'),
    offset: z.number().int().min(0).optional().describe('How many events to skip. Use the offset the previous page gives to get the next page.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      workspace_id?: string;
      post_id?: number;
      since?: string;
      type?: 'all' | 'activity' | 'publish';
      limit?: number;
      offset?: number;
    },
  ) {
    const result = await client.listActivity(input);
    if (result.items.length === 0) {
      return (input.offset ?? 0) > 0
        ? `No activity on this page: offset ${input.offset} is past the last matching event.`
        : 'No activity found matching your filters.';
    }

    const lines = [
      `Activity (${result.items.length} on this page):`,
    ];

    for (const item of result.items) {
      const when = item.created_at ? new Date(item.created_at).toLocaleString() : 'unknown time';
      if (item.type === 'publish') {
        const outcome = item.outcome || 'publish';
        const platform = item.platform ? ` on ${item.platform}` : '';
        const detail = item.error_message ? ` - ${item.error_message}` : '';
        lines.push(`- [${when}] post #${item.post_id || '?'} ${outcome}${platform}${detail}`);
      } else {
        const label = item.description || item.action || 'activity';
        lines.push(`- [${when}] post #${item.post_id || '?'} ${label}`);
      }
    }

    lines.push('', formatPagingNote({
      noun: 'events',
      tool: 'list_activity',
      offset: result.offset ?? input.offset ?? 0,
      count: result.items.length,
      // An API older than has_more: a full page may mean more exist.
      hasMore: result.has_more ?? result.items.length >= (result.limit || 50),
      nextOffset: result.next_offset,
    }));

    return lines.join('\n');
  },
};
