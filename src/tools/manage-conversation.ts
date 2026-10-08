import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdQuote, mdSection } from '../lib/format.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type ManageConversationInput = {
  action: 'send' | 'sync';
  conversation_id?: string;
  content?: string;
  account_id?: number;
  sync_type?: 'all' | 'dm' | 'comments';
  workspace_id?: string;
  confirm?: boolean;
  preview_id?: string;
};

export const manageConversationTool = {
  name: 'manage_conversation',
  description:
    'Act on the social inbox (Pro plan or higher plus posts:write). action=send (conversation_id, content): send a DM reply in an Instagram or Facebook Page conversation, honoring the 24-hour messaging window (Threads has no DMs); preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id. action=sync (account_id): pull the latest Instagram, Facebook Page, Threads, or LinkedIn inbox data for one account; 30-second cooldown (60 seconds for LinkedIn); Threads and LinkedIn sync comments only.',
  inputSchema: z.object({
    action: z.enum(['send', 'sync']).describe('send or sync.'),
    conversation_id: z.string().min(1).optional().describe('send: conversation ID from list_conversations.'),
    content: z.string().min(1).optional().describe('send: message text to send.'),
    account_id: z.number().int().positive().optional().describe('sync: social account ID from list_accounts.'),
    sync_type: z.enum(['all', 'dm', 'comments']).optional().describe('sync: what to sync. Defaults to all. Threads and LinkedIn are comments-only.'),
    workspace_id: z.string().optional().describe('Optional. Omit to search every workspace you belong to; pass a workspace ID from whoami to limit to one.'),
    confirm: z.boolean().optional().describe('send: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('send: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    send_message: z.object({
      conversation_id: z.string().min(1),
      content: z.string().min(1),
      workspace_id: z.string().optional(),
      confirm: z.literal(true),
    }),
    sync_inbox: z.object({
      account_id: z.number().int().positive(),
      sync_type: z.enum(['all', 'dm', 'comments']).optional(),
      workspace_id: z.string().optional(),
    }),
  },

  async execute(client: PosterlyClient, input: ManageConversationInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_conversation', input);
    if (mode === 'sync') return syncInbox(client, args as ManageConversationInput & { account_id: number });
    return previewThenConfirm({
      tool: 'manage_conversation',
      action: 'send',
      args,
      nonce: true,
      legacyRefusal: 'Refusing to send an inbox message without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => {
        const read = await readForPreview(() => client.getConversation({ conversation_id: args.conversation_id, workspace_id: args.workspace_id, limit: 3 }));
        const header = read.ok
          ? mdSection('Conversation', mdKeyValue([
              ['Conversation ID', code(String(read.data.conversation.id))],
              ['Platform', typeof read.data.conversation.platform === 'string' ? read.data.conversation.platform : 'unknown'],
              ['Participant', typeof read.data.conversation.participant_username === 'string' ? `@${read.data.conversation.participant_username}` : 'unknown'],
            ]))
          : [readFailedNote(read.error), mdKeyValue([['Conversation ID', code(args.conversation_id)]])].join('\n\n');
        return [
          header,
          mdSection('Message to send', mdQuote(String(args.content ?? ''))),
          'This sends a DM as your account. Instagram and Facebook only allow replies within 24 hours of the person\'s last message.',
        ].join('\n\n');
      },
      run: async () => {
        const result = await client.sendMessage({
          conversation_id: args.conversation_id,
          content: args.content,
          workspace_id: args.workspace_id,
        });
        return `Message sent (message_id ${result.message_id}).`;
      },
    });
  },
};

async function syncInbox(client: PosterlyClient, input: ManageConversationInput & { account_id: number }): Promise<string> {
  const result = await client.syncInbox(omitKeys(input, ['action', 'confirm', 'preview_id']) as { account_id: number; sync_type?: 'all' | 'dm' | 'comments'; workspace_id?: string });
  const parts = ['Inbox sync completed.'];
  const keys = Object.keys(result.results || {});
  if (keys.length > 0) parts.push(`Synced: ${keys.join(', ')}.`);
  return parts.join(' ');
}
