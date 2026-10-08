import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatLocalDateTime, truncateText } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const INBOX_PLATFORMS = ['instagram', 'facebook', 'threads', 'linkedin'] as const;

/**
 * The shared `InboxConversationsResponse`/`InboxCommentsResponse` types
 * don't declare `workspaces_skipped` (a plain pass-through field from the
 * API), so it's read here through a loose cast rather than widening those
 * shared types for one caller.
 */
function describeSkippedWorkspaces(result: unknown): string | null {
  const skipped = (result as { workspaces_skipped?: Array<{ workspace_id?: string; name?: string; reason?: string }> })?.workspaces_skipped;
  if (!Array.isArray(skipped) || skipped.length === 0) return null;
  const lines = skipped.map((skip) => {
    const name = skip?.name || skip?.workspace_id || 'a workspace';
    const reason = skip?.reason === 'plan' ? "owner's plan does not include inbox" : 'your role there is too low';
    return `- ${name}: ${reason}`;
  });
  return [`Skipped ${skipped.length} workspace${skipped.length === 1 ? '' : 's'} you belong to:`, ...lines].join('\n');
}

type CommentsInput = {
  comment_id?: string;
  workspace_id?: string;
  account_id?: number;
  platform?: 'instagram' | 'facebook' | 'threads' | 'linkedin';
  filter?: 'all' | 'unread' | 'flagged';
  search?: string;
  limit?: number;
  offset?: number;
};

export const listCommentsTool = {
  name: 'list_comments',
  description:
    'Social inbox comments and replies for Instagram, Facebook Pages, Threads, and LinkedIn Pages (Pro plan or higher plus posts:read). Without comment_id: list comments filtered by account, platform, unread/flagged, or search, with limit/offset paging. With comment_id: one comment and its replies; only workspace_id may be added.',
  inputSchema: z.object({
    comment_id: z.string().min(1).optional().describe('One comment (from a list call) with its replies.'),
    workspace_id: z.string().optional().describe('Optional. Omit to search every workspace you belong to; pass a workspace ID from whoami to limit to one.'),
    account_id: z.number().int().positive().optional().describe('Social account ID from list_accounts.'),
    platform: z.enum(INBOX_PLATFORMS).optional().describe('instagram, facebook, threads, or linkedin.'),
    filter: z.enum(['all', 'unread', 'flagged']).optional().describe('Comment filter. Defaults to all.'),
    search: z.string().optional().describe('Search comment content or author username.'),
    limit: z.number().int().min(1).max(100).optional().describe('Number of comments to return. Default 50, max 100.'),
    offset: z.number().int().min(0).optional().describe('Skip this many comments before returning results.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_comment: z.object({
      comment_id: z.string().min(1),
      workspace_id: z.string().optional(),
    }),
  },

  async execute(client: PosterlyClient, input: CommentsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_comments', input);
    if (mode === 'comment') return oneComment(client, args as { comment_id: string; workspace_id?: string });
    return commentList(client, args as CommentsInput);
  },
};

async function commentList(client: PosterlyClient, input: CommentsInput): Promise<string> {
  const result = await client.listComments(input);
  const skippedNote = describeSkippedWorkspaces(result);
  if (result.comments.length === 0) {
    return [
      'No inbox comments found matching your filters.',
      skippedNote,
    ].filter(Boolean).join('\n\n');
  }

  const lines = [`Inbox comments (showing ${result.comments.length} of ${result.total}):`];
  for (const comment of result.comments) {
    const author = typeof comment.author_username === 'string' ? `@${comment.author_username}` : 'unknown';
    const platform = typeof comment.platform === 'string' ? comment.platform : 'unknown';
    const flags: string[] = [];
    if (comment.is_read === false) flags.push('unread');
    if (comment.is_hidden) flags.push('hidden');
    if (comment.is_flagged) flags.push('flagged');
    const flagLabel = flags.length > 0 ? `, ${flags.join(', ')}` : '';
    const text = truncateText(typeof comment.content === 'string' ? comment.content : '', 80);
    const replies = Array.isArray(comment.replies) ? comment.replies.length : 0;
    lines.push(`- ${String(comment.id)} (${platform}, ${author}${flagLabel}${replies ? `, ${replies} replies` : ''}): ${text}`);
  }

  if (result.hasMore) {
    const nextOffset = (input.offset ?? 0) + result.comments.length;
    lines.push('', `More comments available. Call again with offset: ${nextOffset}.`);
  }

  if (skippedNote) lines.push('', skippedNote);

  return lines.join('\n');
}

async function oneComment(client: PosterlyClient, input: { comment_id: string; workspace_id?: string }): Promise<string> {
  const result = await client.getComment(input);
  const comment = result.comment;
  const author = typeof comment.author_username === 'string' ? `@${comment.author_username}` : 'unknown';
  const lines = [
    `Comment ${String(comment.id)}`,
    `• Platform: ${typeof comment.platform === 'string' ? comment.platform : 'unknown'}`,
    `• Author: ${author}`,
    `• Hidden: ${comment.is_hidden ? 'yes' : 'no'}`,
    `• Read: ${comment.is_read === false ? 'no' : 'yes'}`,
    `• Posted: ${formatLocalDateTime(typeof comment.posted_at === 'string' ? comment.posted_at : null)}`,
    `• Content: ${typeof comment.content === 'string' ? comment.content : '(empty)'}`,
  ];
  if (typeof comment.media_permalink === 'string') lines.push(`• Media: ${comment.media_permalink}`);

  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  if (replies.length > 0) {
    lines.push('', `Replies (${replies.length}):`);
    for (const reply of replies) {
      const row = reply as Record<string, unknown>;
      const replyAuthor = typeof row.author_username === 'string' ? `@${row.author_username}` : 'unknown';
      lines.push(`- ${String(row.id)} ${replyAuthor}: ${typeof row.content === 'string' ? row.content : '(empty)'}`);
    }
  }

  return lines.join('\n');
}
