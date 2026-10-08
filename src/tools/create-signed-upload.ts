import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const createSignedUploadTool = {
  name: 'create_signed_upload',
  description:
    'Create a signed upload URL for a larger image or video. PUT the raw bytes to the returned upload_url (object storage) with the returned headers, then public_url can be used with create_post.',
  inputSchema: z.object({
    filename: z.string().describe('Filename with extension, e.g. launch-video.mp4'),
    content_type: z.string().describe('MIME type, e.g. video/mp4'),
    size: z.number().int().positive().describe('File size in bytes'),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { filename: string; content_type: string; size: number; workspace_id?: string },
  ) {
    const signed = await client.getSignedUploadUrl(input.filename, input.content_type, input.size, input.workspace_id);
    return [
      'Signed upload created.',
      `• Upload URL: ${signed.upload_url}`,
      `• Token: ${signed.token}`,
      `• Storage path: ${signed.path}`,
      `• Public URL after upload: ${signed.public_url}`,
      'PUT the raw file bytes to the upload URL with the same Content-Type. Then pass public_url to create_post.',
    ].join('\n');
  },
};
