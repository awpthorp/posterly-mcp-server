import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, inboxCommentContext, mdKeyValue, mdQuote, mdSection } from '../lib/format.js';
import { previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type ManageCommentInput = {
  action: 'reply' | 'update' | 'delete';
  comment_id: string;
  content?: string;
  type?: 'public' | 'private';
  is_hidden?: boolean;
  is_read?: boolean;
  workspace_id?: string;
  confirm?: boolean;
  preview_id?: string;
};

export const manageCommentTool = {
  name: 'manage_comment',
  description:
    'Act on an inbox comment (Pro plan or higher plus posts:write). action=reply (comment_id, content): reply to an Instagram, Facebook Page, Threads, or LinkedIn Page comment; type private is Instagram only, the others take public replies only. action=update (comment_id, is_hidden and/or is_read): hide or unhide it on the platform, or mark it read or unread; reversible, no confirm needed. action=delete (comment_id): delete an Instagram or Facebook Page comment, irreversible and admin only; Threads replies cannot be deleted, hide them instead. reply and delete use preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id.',
  inputSchema: z.object({
    action: z.enum(['reply', 'update', 'delete']).describe('reply, update, or delete.'),
    comment_id: z.string().min(1).describe('Comment ID from list_comments.'),
    content: z.string().min(1).optional().describe('reply: reply text to post.'),
    type: z.enum(['public', 'private']).optional().describe('reply: public (default) or private. Private is Instagram only.'),
    is_hidden: z.boolean().optional().describe('update: hide or unhide the comment on Instagram, Facebook, or Threads.'),
    is_read: z.boolean().optional().describe('update: mark the comment read or unread in posterly.'),
    workspace_id: z.string().optional().describe('Optional. Omit to search every workspace you belong to; pass a workspace ID from whoami to limit to one.'),
    confirm: z.boolean().optional().describe('reply and delete: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('reply and delete: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    reply_to_comment: z.object({
      comment_id: z.string().min(1),
      content: z.string().min(1),
      type: z.enum(['public', 'private']).optional(),
      workspace_id: z.string().optional(),
      confirm: z.literal(true),
    }),
    update_comment: z.object({
      comment_id: z.string().min(1),
      is_hidden: z.boolean().optional(),
      is_read: z.boolean().optional(),
      workspace_id: z.string().optional(),
    }),
    delete_comment: z.object({
      comment_id: z.string().min(1),
      workspace_id: z.string().optional(),
      confirm: z.literal(true),
    }),
  },

  async execute(client: PosterlyClient, input: ManageCommentInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_comment', input);
    if (mode === 'update') return updateComment(client, args as ManageCommentInput);
    if (mode === 'delete') {
      return previewThenConfirm({
        tool: 'manage_comment',
        action: 'delete',
        args,
        nonce: false,
        legacyRefusal: 'Refusing to delete comment without confirm=true after explicit user confirmation.',
        ctx,
        describe: async () => [
          await describeComment(client, args as ManageCommentInput),
          'Deletes this comment from the posterly inbox and, on Instagram or Facebook, from the network. This cannot be undone. Threads replies cannot be deleted; hide them with action=update instead.',
        ].join('\n\n'),
        run: () => deleteComment(client, args as ManageCommentInput & { confirm: true }),
      });
    }
    return previewThenConfirm({
      tool: 'manage_comment',
      action: 'reply',
      args,
      nonce: true,
      legacyRefusal: 'Refusing to reply to a comment without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => [
        await describeComment(client, args as ManageCommentInput),
        mdSection(`Reply to post (${args.type === 'private' ? 'private' : 'public'})`, mdQuote(String(args.content ?? ''))),
        'This posts on the social network as your account.',
      ].join('\n\n'),
      run: () => replyToComment(client, args as ManageCommentInput & { content: string }),
    });
  },
};

async function describeComment(client: PosterlyClient, input: ManageCommentInput): Promise<string> {
  const read = await readForPreview(() => client.getComment({ comment_id: input.comment_id, workspace_id: input.workspace_id }));
  if (!read.ok) {
    return [readFailedNote(read.error), mdKeyValue([['Comment ID', code(input.comment_id)], ['Workspace', input.workspace_id ? code(input.workspace_id) : undefined]])].join('\n\n');
  }
  const comment = read.data.comment;
  const context = inboxCommentContext(comment);
  return mdSection('Comment', mdKeyValue([
    ['Comment ID', code(String(comment.id))],
    ['Platform', typeof comment.platform === 'string' ? comment.platform : 'unknown'],
    ...(context.accountId ? [['Account ID', context.accountId] as [string, string]] : []),
    ['Author', typeof comment.author_username === 'string' ? `@${comment.author_username}` : 'unknown'],
    ...(context.caption ? [['Post', context.caption] as [string, string]] : []),
    ...(context.link ? [['Post link', context.link] as [string, string]] : []),
    ['Content', typeof comment.content === 'string' ? comment.content : '(empty)'],
  ]));
}

async function replyToComment(client: PosterlyClient, input: ManageCommentInput & { content: string }): Promise<string> {
  const result = await client.replyToComment({
    comment_id: input.comment_id,
    content: input.content,
    type: input.type,
    workspace_id: input.workspace_id,
  });
  return `Comment reply sent (${result.reply_type}, reply_id ${result.reply_id}).`;
}

async function updateComment(client: PosterlyClient, input: ManageCommentInput): Promise<string> {
  const result = await client.updateComment({
    comment_id: input.comment_id,
    is_hidden: input.is_hidden,
    is_read: input.is_read,
    workspace_id: input.workspace_id,
  });
  const comment = result.comment;
  const parts = [`Comment ${String(comment.id)} updated.`];
  if (typeof comment.is_hidden === 'boolean') parts.push(`Hidden: ${comment.is_hidden ? 'yes' : 'no'}.`);
  if (typeof comment.is_read === 'boolean') parts.push(`Read: ${comment.is_read ? 'yes' : 'no'}.`);
  return parts.join(' ');
}

async function deleteComment(client: PosterlyClient, input: ManageCommentInput & { confirm: true }): Promise<string> {
  if (input.confirm !== true) {
    throw new Error('Refusing to delete comment without confirm=true after explicit user confirmation.');
  }
  await client.deleteComment(input.comment_id, input.workspace_id);
  // Output kept byte-identical to the old delete_comment tool (its alias
  // must match); the old name in the next-step line still works until the
  // alias sunset.
  return [
    `Comment ${input.comment_id} deleted successfully.`,
    'It has been deleted from the posterly inbox. On Instagram or Facebook it is also removed on the network when the platform call succeeds.',
    '',
    'Next step for the AI agent: tell the user the comment is gone. Threads replies cannot be deleted; hide them with update_comment instead.',
  ].join('\n');
}
