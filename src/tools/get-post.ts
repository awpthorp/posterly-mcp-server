import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { dashboardUrlForPost, formatLocalDateTime } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

export const getPostTool = {
  name: 'get_post',
  description:
    'One post by ID. view=post (default): caption, status, scheduled time, media, and platform info. view=missing: whether the post is missing required content, media, account, platform settings, or metadata before it can publish; use it to repair failed or imported posts.',
  inputSchema: z.object({
    post_id: z.number().describe('The post ID to look up'),
    view: z.enum(['post', 'missing']).optional().describe('post (default) or missing.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_post_missing: z.object({ post_id: z.number().int().positive() }),
  },

  async execute(client: PosterlyClient, input: { post_id: number; view?: 'post' | 'missing' }, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'get_post', input);
    if (mode === 'missing') return postMissing(client, args as { post_id: number });
    return post(client, args as { post_id: number });
  },
};

async function post(client: PosterlyClient, input: { post_id: number }): Promise<string> {
  const result = await client.getPost(input.post_id);
  const p = result.post as Record<string, any>;

  const lines = [
    `Post #${p.id}`,
    `• Status: ${p.status}`,
    `• Caption: ${p.content || '(empty)'}`,
    `• Type: ${p.post_type || 'unknown'}`,
    `• Scheduled: ${formatLocalDateTime(p.scheduled_at)}`,
    `• View in posterly: ${dashboardUrlForPost({ id: p.id, scheduled_at: p.scheduled_at })}`,
  ];

  if (p.platform_post_url) lines.push(`• Published URL: ${p.platform_post_url}`);
  if (p.media_url) lines.push(`• Media: ${p.media_url}`);
  if (p.media_urls?.length) lines.push(`• Media (${p.media_urls.length}): ${p.media_urls.join(', ')}`);

  return lines.join('\n');
}

async function postMissing(client: PosterlyClient, input: { post_id: number }): Promise<string> {
  const result = await client.getPostMissing(input.post_id);
  return JSON.stringify(result, null, 2);
}
