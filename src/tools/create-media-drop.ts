import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const createMediaDropTool = {
  name: 'create_media_drop',
  description:
    'Create a human drop page so ChatGPT or Claude users can upload laptop files (up to 20 per link) without dashboard login. Returns drop_url (https://www.poster.ly/drop/<token>). Send that URL to the user, wait, then call list_media. Accepts JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF up to 50MB (a PDF is for LinkedIn document posts); HEIC is not accepted. This is not the chat paperclip and not create_signed_upload.',
  inputSchema: z.object({
    filename: z.string().optional().describe('Optional filename hint for the user, e.g. launch-video.mp4'),
    max_files: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('How many files the drop can accept. Default 10, max 20.'),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { filename?: string; max_files?: number; workspace_id?: string },
  ) {
    const drop = await client.createMediaDrop({
      filename: input.filename,
      maxFiles: input.max_files,
      workspaceId: input.workspace_id,
    });
    return [
      'Media drop created. Send this URL to the user. They open it with no posterly login and drop the file.',
      `• Drop URL: ${drop.drop_url}`,
      `• Session ID: ${drop.session_id}`,
      `• Expires: ${drop.expires_at}`,
      `• Max bytes: ${drop.max_bytes}`,
      `• Max files: ${drop.max_files}`,
      drop.instructions,
      'After they finish, call list_media with this drop_session_id, then validate_post / create_post using public_url.',
      'Chat attachments never reach MCP. Accepted: JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF up to 50MB (a PDF is for LinkedIn document posts). HEIC is not accepted.',
    ].join('\n');
  },
};
