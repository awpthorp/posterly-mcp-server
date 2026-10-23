import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatLocalDateTime, truncateText } from '../lib/format.js';
import { replyWindowPhrase } from '../lib/reply-window.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const INBOX_PLATFORMS = ['instagram', 'facebook'] as const;

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

type ConversationsInput = {
  conversation_id?: string;
  workspace_id?: string;
  account_id?: number;
  platform?: 'instagram' | 'facebook';
  filter?: 'all' | 'unread' | 'starred' | 'archived';
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

/**
 * One list line for a DM conversation: when, account, participant ("(no
 * handle)" when missing), and a preview that starts with "you: " when the
 * business sent the last message and falls back to [media] / [unsupported]
 * when there is no text.
 */
export function formatConversationListLine(conversation: Record<string, unknown>): string {
  const username = typeof conversation.participant_username === 'string' && conversation.participant_username
    ? `@${conversation.participant_username}`
    : '(no handle)';
  const platform = typeof conversation.platform === 'string' ? conversation.platform : 'unknown';
  const unread = conversation.is_read === false ? 'unread' : 'read';
  const last = (conversation.last_message ?? null) as Record<string, unknown> | null;
  const rawPreview = typeof conversation.last_message_preview === 'string' ? conversation.last_message_preview.trim() : '';
  let preview = rawPreview
    ? truncateText(rawPreview, 80)
    : last?.is_unsupported
      ? '[unsupported]'
      : last?.has_media
        ? '[media]'
        : truncateText('', 80);
  if (last?.sender_is_business && preview !== '(empty)') preview = `you: ${preview}`;
  const when = typeof conversation.last_message_at === 'string' && conversation.last_message_at ? `[${formatLocalDateTime(conversation.last_message_at)}]` : null;
  const owner = ownerLabel(conversation);
  const window = replyWindowPhrase(conversation.window_expires_at);
  const line = `- ${[String(conversation.id), when].filter(Boolean).join(' ')} (${[platform, owner, username, unread].filter(Boolean).join(', ')}): ${preview}`;
  return window ? `${line} (${window})` : line;
}

export const listConversationsTool = {
  name: 'list_conversations',
  description:
    'Social inbox DM conversations for Instagram and Facebook Page inboxes (Threads has no DMs; Pro plan or higher plus posts:read). Without conversation_id: list conversations filtered by account, platform, unread/starred/archived, search, or since/until dates, with limit/offset paging. With conversation_id: one conversation and its messages; there limit is the number of messages (default 50, max 100) and only workspace_id may be added. When a sync has stored it, each conversation includes the Meta reply window (open until a UTC time, or closed). A reply does not extend that window, and it is not guessed from the messages loaded in the thread.',
  inputSchema: z.object({
    conversation_id: z.string().min(1).optional().describe('One conversation and its messages.'),
    workspace_id: z.string().optional().describe('Omit to search all your workspaces, or pass an ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('From list_accounts.'),
    platform: z.enum(INBOX_PLATFORMS).optional().describe('Instagram or Facebook. Threads has comments, not DMs.'),
    filter: z.enum(['all', 'unread', 'starred', 'archived']).optional().describe('Default all (excludes archived).'),
    search: z.string().optional().describe('Search participant username or last message preview.'),
    limit: z.number().int().min(1).max(100).optional().describe('Rows (messages with conversation_id). Default 50.'),
    offset: z.number().int().min(0).optional().describe('Rows to skip.'),
    since: z.string().optional().describe('ISO date/time, inclusive.'),
    until: z.string().optional().describe('ISO date/time, inclusive.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_conversation: z.object({
      conversation_id: z.string().min(1),
      workspace_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  },

  async execute(client: PosterlyClient, input: ConversationsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_conversations', input);
    if (mode === 'conversation') return oneConversation(client, args as { conversation_id: string; workspace_id?: string; limit?: number });
    return conversationList(client, args as ConversationsInput);
  },
};

async function conversationList(client: PosterlyClient, input: ConversationsInput): Promise<string> {
  const result = await client.listConversations(input);
  const skippedNote = describeSkippedWorkspaces(result);
  if (result.conversations.length === 0) {
    return [
      'No inbox conversations found matching your filters.',
      skippedNote,
    ].filter(Boolean).join('\n\n');
  }

  const lines = [`Inbox conversations (showing ${result.conversations.length} of ${result.total}):`];
  for (const conversation of result.conversations) {
    lines.push(formatConversationListLine(conversation));
  }

  if (result.hasMore) {
    const nextOffset = (input.offset ?? 0) + result.conversations.length;
    lines.push('', `More conversations available. Call again with offset: ${nextOffset}.`);
  }

  if (skippedNote) lines.push('', skippedNote);

  return lines.join('\n');
}

async function oneConversation(
  client: PosterlyClient,
  input: { conversation_id: string; workspace_id?: string; limit?: number },
): Promise<string> {
  const result = await client.getConversation(input);
  const conversation = result.conversation;
  const username = typeof conversation.participant_username === 'string' ? `@${conversation.participant_username}` : 'unknown';
  const window = replyWindowPhrase((conversation as { window_expires_at?: unknown }).window_expires_at);
  const lines = [
    `Conversation ${String(conversation.id)}`,
    `• Platform: ${typeof conversation.platform === 'string' ? conversation.platform : 'unknown'}`,
    `• Participant: ${username}`,
    `• Read: ${conversation.is_read === false ? 'no' : 'yes'}`,
    window ? `• Reply window: ${window}` : null,
    `• Messages: ${result.messages.length}`,
    '',
  ].filter((line): line is string => line !== null);

  for (const message of result.messages) {
    const who = message.sender_is_business ? 'you' : (typeof message.sender_username === 'string' ? message.sender_username : 'them');
    const when = formatLocalDateTime(typeof message.sent_at === 'string' ? message.sent_at : null);
    const text = truncateText(typeof message.content === 'string' ? message.content : '', 240);
    lines.push(`- [${when}] ${who}: ${text}`);
  }

  return lines.join('\n');
}
