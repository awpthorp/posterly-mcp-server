import { z } from 'zod';
import type { PosterlyClient, SignedUploadBatchResponse } from '../lib/api-client.js';

const fileSchema = z.object({
  filename: z.string().describe('Filename with extension, e.g. launch-video.mp4'),
  content_type: z.string().describe('MIME type, e.g. video/mp4'),
  size: z.number().int().positive().describe('File size in bytes'),
});

type SignedUploadInput = {
  filename?: string;
  content_type?: string;
  size?: number;
  files?: Array<{ filename: string; content_type: string; size: number }>;
  workspace_id?: string;
  pin_content_type?: boolean;
};

export function formatSignedUploadBatch(
  batch: SignedUploadBatchResponse,
  requested: Array<{ content_type: string }>,
): string {
  const lines: string[] = [
    `Signed upload slots: ${batch.summary.requested} requested, ${batch.summary.ok} ready, ${batch.summary.failed} failed.`,
    '',
  ];
  let earliestExpiry: string | null = null;

  batch.slots.forEach((slot, position) => {
    const number = position + 1;
    if (slot.ok) {
      const headers = slot.headers || {};
      const headerKeys = Object.keys(headers);
      const contentTypeKey = headerKeys.find((key) => key.toLowerCase() === 'content-type');
      const contentType = contentTypeKey ? headers[contentTypeKey] : requested[slot.index]?.content_type;
      lines.push(`${number}. ${slot.filename}`);
      lines.push(`   PUT ${slot.upload_url}`);
      if (contentType) lines.push(`   Content-Type: ${contentType}`);
      for (const key of headerKeys) {
        if (key === contentTypeKey) continue;
        lines.push(`   ${key}: ${headers[key]}`);
      }
      if (slot.content_type_pinned === true) {
        lines.push('   Content-Type is locked: send exactly the Content-Type above or storage rejects the PUT with 403.');
      }
      lines.push(`   Public URL after upload: ${slot.public_url}`);
      if (slot.expires_at && (!earliestExpiry || slot.expires_at < earliestExpiry)) {
        earliestExpiry = slot.expires_at;
      }
    } else {
      lines.push(`${number}. ${slot.filename || '(no filename)'}`);
      lines.push(`   Failed (${slot.code}): ${slot.error}`);
    }
    lines.push('');
  });

  if (batch.slots.some((slot) => slot.ok && slot.content_type_pinned === true)) {
    lines.push('Slots marked "Content-Type is locked" accept only a PUT whose Content-Type header is exactly the one shown (curl --data-binary needs -H "Content-Type: ...").');
  }
  lines.push(
    `PUT each file, then pass public_url to create_post / create_posts_batch. Slots expire at ${earliestExpiry ?? 'the expires_at time returned (15 minutes)'}, call again for fresh slots.`,
  );
  return lines.join('\n');
}

export const createSignedUploadTool = {
  name: 'create_signed_upload',
  description:
    'Create signed upload URLs for larger images, videos or PDFs, 1 to 20 files per call. Accepts JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF up to 50MB (a PDF is for LinkedIn document posts); HEIC is not accepted. For one file pass filename, content_type and size. For several pass files: [{filename, content_type, size}] and get one slot per file, with any file that fails reported in place. PUT the raw bytes of each file to its upload_url (object storage) with the returned headers, then pass public_url to create_post / create_posts_batch. For a PDF, create the post with post_type document, media_url set to that public_url and a document_title in settings (LinkedIn only). Pinning is available per request with pin_content_type: true, which locks each slot to the content_type you declare (a PUT with any other Content-Type then fails with 403). posterly may turn it on by default in the future, so always send the Content-Type header returned with the slot. Slots expire in 15 minutes.',
  inputSchema: z.object({
    filename: z.string().optional().describe('Single file: filename with extension, e.g. launch-video.mp4. Omit when using files.'),
    content_type: z.string().optional().describe('Single file: MIME type, e.g. video/mp4. Omit when using files.'),
    size: z.number().int().positive().optional().describe('Single file: size in bytes. Omit when using files.'),
    files: z
      .array(fileSchema)
      .min(1)
      .max(20)
      .optional()
      .describe('Batch: 1 to 20 {filename, content_type, size}. Use instead of the single-file fields.'),
    pin_content_type: z
      .boolean()
      .optional()
      .describe('Optional. true locks each slot to the declared content_type; a PUT with any other Content-Type fails with 403.'),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
  }),

  async execute(client: PosterlyClient, input: SignedUploadInput) {
    if (input.files !== undefined) {
      if (input.filename !== undefined || input.content_type !== undefined || input.size !== undefined) {
        throw new Error('Pass either files or the single-file fields (filename, content_type, size), not both.');
      }
      const batch = await client.getSignedUploadUrls(input.files, input.workspace_id, input.pin_content_type === true);
      return formatSignedUploadBatch(batch, input.files);
    }

    if (!input.filename || !input.content_type || !input.size) {
      throw new Error('Provide filename, content_type and size for one file, or files for a batch of up to 20.');
    }

    const signed = await client.getSignedUploadUrl(
      input.filename,
      input.content_type,
      input.size,
      input.workspace_id,
      input.pin_content_type === true,
    );
    if (signed.content_type_pinned === true) {
      const headers = signed.headers || {};
      const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type');
      const sendType = contentTypeKey ? headers[contentTypeKey] : input.content_type;
      return [
        'Signed upload created.',
        `• Upload URL: ${signed.upload_url}`,
        `• Token: ${signed.token}`,
        `• Storage path: ${signed.path}`,
        `• Content-Type to send: ${sendType}`,
        `• Public URL after upload: ${signed.public_url}`,
        'Content-Type is locked: PUT the raw file bytes to the upload URL with exactly the Content-Type above (curl --data-binary needs -H "Content-Type: ..."), or storage rejects it with 403. Then pass public_url to create_post.',
      ].join('\n');
    }
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
