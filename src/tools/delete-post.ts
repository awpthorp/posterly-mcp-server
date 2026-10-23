import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, dashboardUrlForPosts } from '../lib/format.js';
import { previewThenConfirm, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type DeletePostInput = {
  post_id?: number;
  group_id?: string;
  delete_mode?: 'posterly' | 'platform';
  confirm_published?: boolean;
  confirm?: boolean;
  preview_id?: string;
};

export const deletePostTool = {
  name: 'delete_post',
  description:
    'Delete posts. DESTRUCTIVE and IRREVERSIBLE: deleted posts and captions cannot be recovered. post_id: delete one post; fetch it with `get_post` first, show the user what will be deleted (caption, account, scheduled time), and pass confirm=true only after explicit confirmation ("yes delete it", "remove it"). A post that is currently publishing is never deleted. A published post is taken down only when the user also explicitly confirms the live removal: delete_mode=platform with confirm_published=true takes the live post down too; delete_mode=posterly removes only the posterly record and leaves it up. Live deletion supports eligible connected platforms with saved post IDs and deletion permissions; refusals keep the record. Threads requires threads_delete. YouTube requires youtube.force-ssl or equivalent, upload alone is insufficient. A published post with no live URL and no platform id is removed from posterly only. group_id: delete every draft, scheduled, failed, or paused post matching a caller-defined group_id, post_group_id, api_group_id, or release_id. A group delete never removes published posts. Preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id. Never delete several posts one by one without listing each and confirming the full list.',
  inputSchema: z.object({
    post_id: z.number().optional().describe('Delete this one post.'),
    group_id: z.string().min(1).max(160).optional().describe('Delete every unpublished post in this group or release instead. Never deletes published posts.'),
    delete_mode: z.enum(['posterly', 'platform']).optional().describe('posterly removes only the record; platform also takes down live content and requires confirm_published=true.'),
    confirm_published: z
      .boolean()
      .optional()
      .describe('With post_id only. True only after the user explicitly confirms taking a live post down. Required with delete_mode=platform.'),
    confirm: z
      .boolean()
      .optional()
      .describe('post_id: true after explicit user confirmation of the deletion. group_id: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('group_id: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    delete_post_group: z.object({
      group_id: z.string().min(1).max(160),
      confirm: z.literal(true),
    }),
  },

  async execute(client: PosterlyClient, input: DeletePostInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'delete_post', input);
    if (mode === 'group') {
      return previewThenConfirm({
        tool: 'delete_post',
        action: 'group',
        args,
        nonce: false,
        legacyRefusal: 'Refusing to delete post group without confirm=true after explicit user confirmation.',
        ctx,
        // GET /api/v1/posts has no group filter, so the preview says in plain
        // words which posts match instead of listing them.
        describe: async () => [
          `Deletes every draft, scheduled, failed, or paused post whose group_id, post_group_id, api_group_id, or release_id is ${code(args.group_id)}. A group delete never removes published posts. This cannot be undone.`,
          'To see the posts first, call list_posts and check each post\'s group or release ID.',
        ].join('\n\n'),
        run: async () => {
          const result = await client.deletePostGroup(args.group_id);
          return JSON.stringify(result, null, 2);
        },
      });
    }
    return deleteOne(client, args as { post_id: number; confirm?: boolean; confirm_published?: boolean; delete_mode?: 'posterly' | 'platform' });
  },
};

async function deleteOne(
  client: PosterlyClient,
  input: { post_id: number; confirm?: boolean; confirm_published?: boolean; delete_mode?: 'posterly' | 'platform' },
): Promise<string> {
  if (input.confirm !== true) {
    throw new Error('Refusing to delete post without confirm=true after explicit user confirmation.');
  }
  const result = await client.deletePost(input.post_id, { confirmPublished: input.confirm_published === true, deleteMode: input.delete_mode });
  const platformDelete = result.platform_delete === 'deleted' ? ' The platform confirmed removal of the live content.'
    : result.platform_delete === 'not_requested' ? ' Only the posterly record was removed; no platform deletion was requested.'
    : result.platform_delete === 'no_live_target' ? ' Only the posterly record was removed because no live target was saved.'
    : '';
  return [
    `Post #${result.id} deleted successfully.${platformDelete}`,
    'It has been removed from the posterly queue.',
    `View queue in posterly: ${dashboardUrlForPosts()}`,
    '',
    'Tell the user whether the live post was deleted or kept on the platform.',
  ].join('\n');
}
