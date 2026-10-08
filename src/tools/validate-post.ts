import type { PosterlyClient } from '../lib/api-client.js';
import {
  buildCreatePostPayload,
  createAccountPlatformResolver,
  createPostPayloadInputSchema,
} from './create-post.js';

export const validatePostInputSchema = createPostPayloadInputSchema;

export type ValidatePostInput = Parameters<typeof buildCreatePostPayload>[0];

export const validatePostTool = {
  name: 'validate_post',
  description:
    'Validate and normalize one post without creating it. This does not create records, copy remote media, consume post-item/storage quota, reserve X quota, emit webhooks, or enqueue publication. Third-party media may return remote_media_not_materialized because live create performs storage copy and final byte validation. Use this before showing the final preview and asking for confirmation to call create_post.',
  inputSchema: validatePostInputSchema,

  async execute(client: PosterlyClient, input: ValidatePostInput) {
    const payload = await buildCreatePostPayload(input, createAccountPlatformResolver(client));
    const result = await client.validatePost(payload);

    const lines = [
      'Post validation passed.',
      `• Platform: ${result.normalized.platform}`,
      `• Account ID: ${result.normalized.account_id}`,
      `• Type: ${result.normalized.post_type}`,
      `• Scheduled: ${result.normalized.scheduled_at}`,
      `• Workspace: ${result.normalized.workspace_id || 'personal/default'}`,
      `• Would create: ${result.would_create.status}`,
    ];

    if (result.warnings.length > 0) {
      lines.push('• Warnings:');
      for (const warning of result.warnings) {
        lines.push(`  - ${warning.code}: ${warning.message}`);
      }
    }

    lines.push('Show the final preview and obtain explicit confirmation before calling create_post.');
    return lines.join('\n');
  },
};
