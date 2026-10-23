import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatIsoTimestamp, mdError, mdKeyValue, mdSection, mdSuccess } from '../lib/format.js';
import { previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type UploadMediaInput = {
  file_path?: string;
  base64_data?: string;
  url?: string;
  filename?: string;
  content_type?: string;
  workspace_id?: string;
  asset_id?: string;
  confirm?: boolean;
  preview_id?: string;
};

export const uploadMediaTool = {
  name: 'upload_media',
  description:
    'Upload an image or video to posterly storage and get a URL for create_post. Supports JPEG, PNG, GIF, WebP, MP4, MOV, WebM (PDFs are not accepted here: use create_signed_upload or create_media_drop). Images up to 10MB, videos up to 50MB. Three ways in: file_path (an explicit local path the user gave you), base64_data with filename (PREFERRED for images shared in chat, which are not on the local filesystem), or url (a public HTTPS image or video; local/private network URLs are blocked).\n\n' +
    'This writes to the user\'s media storage (counts against quota) but does NOT publish the file anywhere. Uploading is safe - it\'s the subsequent `create_post` call that publishes content, and that tool has its own confirmation requirements. Never guess file paths. You can also pass public HTTP(S) media URLs directly to create_post/update_post; use url here when you want to upload once and reuse the returned posterly URL. Pass asset_id (from list_media) to delete that library file: the first request previews it and deletes nothing; send it again with confirm true and that preview_id only after the user agrees. A file a post still uses is kept.',
  inputSchema: z.object({
    file_path: z
      .string()
      .optional()
      .describe('Absolute local filesystem path (e.g. /Users/name/photo.jpg). Only use when the user gives you an explicit path. Do NOT guess paths for images uploaded in chat.'),
    base64_data: z
      .string()
      .optional()
      .describe('Base64-encoded file data. PREFERRED for images shared directly in chat - extract the image data as base64 and pass it here.'),
    url: z
      .string()
      .url()
      .optional()
      .describe('Public HTTPS URL for the image or video to copy into posterly storage. Local/private network URLs are blocked.'),
    filename: z
      .string()
      .optional()
      .describe('Filename with extension (e.g. photo.jpg, video.mp4). Required with file_path or base64_data; optional override with url.'),
    content_type: z
      .string()
      .optional()
      .describe('MIME type (auto-detected from filename if omitted)'),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
    asset_id: z.string().optional().describe('Library file id from list_media. Deletes that file after a preview. Do not combine with url, file_path, or base64_data.'),
    confirm: z.boolean().optional().describe('Delete only. True only after the user explicitly approves the preview, together with preview_id.'),
    preview_id: z.string().optional().describe('The preview_id from the delete preview. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    upload_media_from_url: z.object({
      url: z.string().url(),
      filename: z.string().optional(),
      content_type: z.string().optional(),
    }),
  },

  async execute(client: PosterlyClient, input: UploadMediaInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'upload_media', input);
    if (mode === 'delete') return deleteLibraryFile(client, args as UploadMediaInput & { asset_id: string }, ctx);
    if (mode === 'url') return uploadFromUrl(client, args as { url: string; filename?: string; content_type?: string; workspace_id?: string });
    return uploadFile(client, args as UploadMediaInput & { filename: string });
  },
};

async function deleteLibraryFile(client: PosterlyClient, input: UploadMediaInput & { asset_id: string }, ctx: ToolContext): Promise<string> {
  return previewThenConfirm({
    tool: 'upload_media',
    action: 'delete',
    args: input,
    nonce: false,
    legacyRefusal: 'Refusing to delete a library file without confirm=true after explicit user confirmation.',
    ctx,
    describe: async () => {
      const read = await readForPreview(() => client.getMediaAsset(input.asset_id));
      const media = read.ok ? read.data.media : null;
      const details = media
        ? mdSection('File', mdKeyValue([
            ['File', media.filename || 'file'],
            ['Type', media.mime || 'unknown'],
            ['Created', formatIsoTimestamp(media.created_at)],
          ]))
        : [
            read.ok ? '_This file was not found, so the preview shows the request as given._' : readFailedNote(read.error),
            mdKeyValue([['File ID', input.asset_id]]),
          ].join('\n\n');
      return [details, 'This permanently deletes the file from the library. A file a post still uses is kept.'].join('\n\n');
    },
    run: async () => {
      const result = await client.deleteMediaAsset(input.asset_id);
      return result.filename
        ? `Deleted ${result.filename} from the library.`
        : 'Deleted the file from the library.';
    },
  });
}

async function uploadFile(
  client: PosterlyClient,
  input: {
    file_path?: string;
    base64_data?: string;
    filename: string;
    content_type?: string;
    workspace_id?: string;
  },
): Promise<string> {
  if (!input.file_path && !input.base64_data) {
    return mdError('Provide either `file_path` or `base64_data`.');
  }

  const result = await client.uploadMedia({
    filePath: input.file_path,
    base64Data: input.base64_data,
    filename: input.filename,
    contentType: input.content_type,
    workspaceId: input.workspace_id,
  });

  return mdSuccess('Media uploaded', [
    ['URL', result.url],
    ['Storage path', result.path],
  ], 'Use this URL as `media_url` when creating a post.');
}

async function uploadFromUrl(
  client: PosterlyClient,
  input: { url: string; filename?: string; content_type?: string; workspace_id?: string },
): Promise<string> {
  const result = await client.uploadMediaFromUrl({
    url: input.url,
    filename: input.filename,
    contentType: input.content_type,
    workspaceId: input.workspace_id,
  });
  return [
    'Remote media uploaded successfully.',
    `• URL: ${result.url}`,
    `• Source URL: ${result.source_url}`,
    `• Content type: ${result.content_type}`,
    `• Size: ${result.size} bytes`,
    '',
    'Use this URL as media_url when creating a post.',
  ].join('\n');
}
