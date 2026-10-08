import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { dashboardUrlForPostList, formatLocalDateTime } from '../lib/format.js';
import { buildCreatePostPayload, createAccountPlatformResolver, createPostPayloadInputSchema, type CreatePostPayloadInput } from './create-post.js';

export const createPostsBatchTool = {
  name: 'create_posts_batch',
  description:
    'Create 1-25 scheduled or immediate social posts in one API request. This is a DESTRUCTIVE WRITE that creates content on the user\'s real social accounts - once scheduled_at passes, posts may go public and cannot be un-posted.\n\n' +
    'REQUIRED BEFORE CALLING:\n' +
    '1. Call `whoami` at the start of any new session to confirm which workspace and user you are acting for.\n' +
    '2. Show the user a preview of EVERY post: account/platform, final caption or thread text, scheduled time in their timezone, media, platform settings, and workspace.\n' +
    '3. Get explicit confirmation for the whole batch before calling. Do not infer consent from an earlier content plan.\n\n' +
    'AFTER CALLING: Summarize the batch result in natural language, include the posterly dashboard link returned by the tool, and avoid narrating raw HTTP, curl, or API plumbing.\n\n' +
    'Each item accepts the same fields as `create_post`, including `thread_posts`, `platform_settings`, `instagram_settings`, media URLs, and workspace_id. The endpoint may partially succeed; failed items are returned with their index.',
  inputSchema: z.object({
    posts: z
      .array(createPostPayloadInputSchema)
      .min(1)
      .max(25)
      .describe('Posts to create. Each item uses the same schema as create_post.'),
    confirm: z.literal(true).describe('Must be true after explicit user confirmation of every post in the batch.'),
  }),

  async execute(client: PosterlyClient, input: { posts: CreatePostPayloadInput[]; confirm: true }) {
    if (input.confirm !== true) {
      throw new Error('Refusing to create batch posts without confirm=true after explicit user confirmation.');
    }
    // One resolver shared across the whole batch: createAccountPlatformResolver
    // caches its accounts lookup per workspace_id, so N items that all need
    // thread_posts platform resolution for the same workspace still cost one
    // listAccounts() call, not N.
    const resolvePlatform = createAccountPlatformResolver(client);
    const payloads = await Promise.all(input.posts.map(async (post, index) => {
      try {
        return await buildCreatePostPayload(post, resolvePlatform);
      } catch (error: any) {
        throw new Error(`Item ${index}: ${error?.message || 'invalid post input'}`);
      }
    }));
    const result = await client.createPostsBatch({ posts: payloads });

    const createdPosts = result.posts.map((item) => item.post);
    const dashboardUrl = dashboardUrlForPostList(createdPosts);
    const lines = [
      'Batch create completed.',
      `• Total: ${result.total}`,
      `• Created: ${result.created}`,
      `• Replayed: ${result.replayed}`,
      `• Failed: ${result.failed}`,
      `• View in posterly: ${dashboardUrl}`,
    ];

    for (const item of result.posts.slice(0, 25)) {
      const post = item.post as Record<string, any>;
      const when = post.scheduled_at ? formatLocalDateTime(post.scheduled_at) : 'now';
      lines.push(
        `• [${item.index}] ID ${post.id} ${post.platform || 'unknown'} ${post.post_type || 'post'} ${post.status || 'created'} at ${when}${item.replayed ? ' (replayed)' : ''}`,
      );
    }

    for (const error of result.errors.slice(0, 25)) {
      lines.push(`• [${error.index}] ERROR ${error.status}: ${error.error}`);
    }

    for (const item of result.posts.slice(0, 25)) {
      const warnings = item.warnings || [];
      for (const warning of warnings) {
        lines.push(`• [${item.index}] WARNING ${warning.message || warning.code}`);
      }
    }

    lines.push(
      '',
      'Next step for the AI agent: tell the user which posts were created, share the dashboard link above, and ask whether they want to review the queue, adjust anything, or create the next post.',
    );

    return lines.join('\n');
  },
};
