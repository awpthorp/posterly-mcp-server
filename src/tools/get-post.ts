import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { dashboardUrlForPost, formatIsoTimestamp, formatLocalDateTime, formatPostCreator, groupReleaseIds, isStructuredMissingReport, platformPostIdText, platformText, postFailureText } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

export const getPostTool = {
  name: 'get_post',
  description:
    'One post by ID. view=post (default): caption, status, platform, account, scheduled time, when it was created and by whom (account and channel, such as dashboard, API, or MCP), media, a link back to the post in posterly, and the failure reason when a publish failed. view=missing: each missing field (content, media, account, platform settings, or metadata) and how to fix it before the post can publish.',
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

  const accountId = p.social_account_id ?? p.account_id;
  const failure = postFailureText(p);
  const platformPostId = platformPostIdText(p);
  const groups = groupReleaseIds(p);
  const lines = [
    `Post #${p.id}`,
    `• Status: ${p.status}`,
  ];
  const platform = platformText(p.platform);
  if (platform) lines.push(`• Platform: ${platform}`);
  if (accountId != null && accountId !== '') lines.push(`• Account ID: ${accountId}`);
  if (p.workspace_id) lines.push(`• Workspace: ${p.workspace_id}`);
  lines.push(`• Caption: ${p.content || '(empty)'}`);
  lines.push(`• Type: ${p.post_type || 'unknown'}`);
  lines.push(`• Scheduled: ${formatLocalDateTime(p.scheduled_at)}`);
  if (failure) lines.push(`• Failure: ${failure}`);
  if (platformPostId) lines.push(`• Platform post ID: ${platformPostId}`);
  if (groups.length) lines.push(`• Group: ${groups.join(', ')}`);
  if ('created_at' in p) lines.push(`• Created: ${formatIsoTimestamp(p.created_at)}`);
  if ('created_by' in p) lines.push(`• Created by: ${formatPostCreator(p.created_by)}`);
  if ('updated_at' in p) lines.push(`• Last updated: ${formatIsoTimestamp(p.updated_at)}`);
  lines.push(`• View in posterly: ${dashboardUrlForPost({ id: p.id, scheduled_at: p.scheduled_at })}`);

  if (p.platform_post_url) lines.push(`• Published URL: ${p.platform_post_url}`);
  if (p.media_url) lines.push(`• Media: ${p.media_url}`);
  if (p.media_urls?.length) lines.push(`• Media (${p.media_urls.length}): ${p.media_urls.join(', ')}`);

  return lines.join('\n');
}

async function postMissing(client: PosterlyClient, input: { post_id: number }): Promise<string> {
  const result = await client.getPostMissing(input.post_id);
  if (isStructuredMissingReport(result)) return formatMissingReport(result);
  return JSON.stringify(result, null, 2);
}

function formatMissingReport(data: any): string {
  const post = data.post && typeof data.post === 'object' ? data.post : null;
  const missing = Array.isArray(data.missing) ? data.missing : [];
  const items = missing.map((item: any) => {
    if (item && typeof item === 'object') {
      const field = item.field ? String(item.field) : 'item';
      const message = item.message ? String(item.message) : (item.code ? String(item.code) : 'Missing');
      return `${field}: ${message}`;
    }
    return String(item);
  });
  const lines = [
    data.ready ? 'Post is ready to publish' : 'Post is not ready to publish',
  ];
  if (post?.id != null) lines.push(`Post #${post.id}`);
  const platform = post ? platformText(post.platform) : undefined;
  if (platform) lines.push(`• Platform: ${platform}`);
  const accountId = post ? (post.account_id ?? post.social_account_id) : undefined;
  if (accountId != null && accountId !== '') lines.push(`• Account ID: ${accountId}`);
  if (post?.status) lines.push(`• Status: ${post.status}`);
  if (post?.post_type) lines.push(`• Type: ${post.post_type}`);
  lines.push(items.length ? `Missing:\n${items.map((item: string) => `• ${item}`).join('\n')}` : 'Nothing required is missing.');
  if (Array.isArray(data.next_actions) && data.next_actions.length) {
    lines.push(`How to fix:\n${data.next_actions.map((action: unknown) => `• ${String(action)}`).join('\n')}`);
  }
  return lines.join('\n');
}
