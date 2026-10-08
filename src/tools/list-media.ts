import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatPagingNote } from '../lib/format.js';

export const listMediaTool = {
  name: 'list_media',
  description:
    'List the newest media assets for the authenticated user. After create_media_drop, pass drop_session_id to see files the human uploaded on /drop/<token>. Use public_url with validate_post / create_post. The output says whether every matching file is shown; page with offset (offset + limit up to 1000) when it is not.',
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Number of assets to return (default 10, max 50)'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('How many assets to skip. Use the offset the previous page gives to get the next page.'),
    drop_session_id: z
      .string()
      .optional()
      .describe('Filter to files uploaded through one create_media_drop session'),
  }),

  async execute(
    client: PosterlyClient,
    input: { limit?: number; offset?: number; drop_session_id?: string },
  ) {
    const result = await client.listMedia({
      limit: input.limit,
      offset: input.offset,
      dropSessionId: input.drop_session_id,
    });

    if (result.media.length === 0) {
      if ((input.offset ?? 0) > 0 && result.total > 0) {
        return `No media on this page: offset ${input.offset} is past the last of the ${result.total} matching files.`;
      }
      return 'No media found. If you just sent a drop URL, wait for the user to finish uploading, then call list_media again.';
    }

    const lines = result.media.map((item) => {
      const size = typeof item.bytes === 'number' ? `${item.bytes} bytes` : 'unknown size';
      const drop = item.drop_session_id ? ` drop=${item.drop_session_id}` : '';
      return `• ${item.filename} (${item.mime || 'unknown'}, ${size})${drop}\n  public_url: ${item.public_url}`;
    });

    const offset = result.offset ?? input.offset ?? 0;
    return [
      `Media (${result.media.length} of ${result.total}):`,
      ...lines,
      '',
      formatPagingNote({
        noun: 'files',
        tool: 'list_media',
        offset,
        count: result.media.length,
        total: result.total,
        hasMore: result.has_more ?? offset + result.media.length < result.total,
        nextOffset: result.next_offset,
      }),
      'Pass public_url to validate_post / create_post. Do not invent URLs.',
    ].join('\n');
  },
};
