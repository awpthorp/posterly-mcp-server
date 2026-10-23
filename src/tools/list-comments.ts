import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatLocalDateTime, inboxCommentContext, truncateText } from '../lib/format.js';
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
  since?: string;
  until?: string;
};

/** "on @account (Workspace)" for a list row, or null when the API sent neither. */
function ownerLabel(row: Record<string, unknown>): string | null {
  const account = typeof row.account_username === 'string' && row.account_username ? `@${row.account_username}` : '';
  const workspace = typeof row.workspace_name === 'string' && row.workspace_name ? row.workspace_name : '';
  if (account && workspace) return `on ${account} (${workspace})`;
  if (account || workspace) return `on ${account || workspace}`;
  return null;
}

/** One list line for a comment: when, account, author ("you" or "(no handle)" when needed), flags, text. */
export function formatCommentListLine(comment: Record<string, unknown>): string {
  const author = comment.author_is_business
    ? 'you'
    : typeof comment.author_username === 'string' && comment.author_username
      ? `@${comment.author_username}`
      : '(no handle)';
  const platform = typeof comment.platform === 'string' ? comment.platform : 'unknown';
  const flags: string[] = [];
  if (comment.is_read === false) flags.push('unread');
  if (comment.is_hidden) flags.push('hidden');
  if (comment.is_flagged) flags.push('flagged');
  const flagLabel = flags.length > 0 ? `, ${flags.join(', ')}` : '';
  const text = truncateText(typeof comment.content === 'string' ? comment.content : '', 80);
  const replies = Array.isArray(comment.replies) ? comment.replies.length : 0;
  const when = typeof comment.posted_at === 'string' && comment.posted_at ? `[${formatLocalDateTime(comment.posted_at)}]` : null;
  const owner = ownerLabel(comment);
  const context = inboxCommentContext(comment);
  const account = context.accountId ? `account ${context.accountId}` : null;
  const post = context.caption ? `post: ${truncateText(context.caption, 80)}` : context.link ? `post: ${context.link}` : null;
  return `- ${[String(comment.id), when].filter(Boolean).join(' ')} (${[platform, owner, account, author].filter(Boolean).join(', ')}${flagLabel}${replies ? `, ${replies} replies` : ''}): ${text}${post ? ` (${post})` : ''}`;
}

export const listCommentsTool = {
  name: 'list_comments',
  description:
    'Social inbox comments and replies for Instagram, Facebook Pages, Threads, and LinkedIn Pages (Pro plan or higher plus posts:read). Without comment_id: list comments filtered by account, platform, unread/flagged, search, or since/until dates, with limit/offset paging. With comment_id: one comment and its replies; only workspace_id may be added. YouTube and TikTok are refused rather than returned as an empty list. They stay off until each platform is reviewed and an inbox provider exists.',
  inputSchema: z.object({
    comment_id: z.string().min(1).optional().describe('One comment and its replies.'),
    workspace_id: z.string().optional().describe('Omit to search all your workspaces, or pass an ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('From list_accounts.'),
    platform: z.enum(INBOX_PLATFORMS).optional(),
    filter: z.enum(['all', 'unread', 'flagged']).optional().describe('Default all.'),
    search: z.string().optional().describe('Search comment content or author username.'),
    limit: z.number().int().min(1).max(100).optional().describe('Rows to return. Default 50.'),
    offset: z.number().int().min(0).optional().describe('Rows to skip.'),
    since: z.string().optional().describe('ISO date/time, inclusive.'),
    until: z.string().optional().describe('ISO date/time, inclusive.'),
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
    lines.push(formatCommentListLine(comment));
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
  const context = inboxCommentContext(comment);
  if (context.accountId) lines.push(`• Account ID: ${context.accountId}`);
  if (context.caption) lines.push(`• Post: ${context.caption}`);
  if (context.link) lines.push(`• Post link: ${context.link}`);
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
