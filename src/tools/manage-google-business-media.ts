import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection } from '../lib/format.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const CATEGORIES = [
  'COVER',
  'PROFILE',
  'LOGO',
  'EXTERIOR',
  'INTERIOR',
  'PRODUCT',
  'AT_WORK',
  'FOOD_AND_DRINK',
  'MENU',
  'COMMON_AREA',
  'ROOMS',
  'TEAMS',
  'ADDITIONAL',
] as const;

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';
const LEGACY_LOCATION = {
  workspace_id: z.string().optional(),
  account_id: z.number().int().positive().optional(),
  location_id: z.string().optional(),
};

type ManageMediaInput = {
  action: 'add' | 'delete';
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
  source_url?: string;
  category?: (typeof CATEGORIES)[number];
  media_format?: 'PHOTO' | 'VIDEO';
  media_name?: string;
  confirm?: boolean;
  preview_id?: string;
};

function payloadOf(input: ManageMediaInput): Record<string, any> {
  return omitKeys(input, ['action', 'confirm', 'preview_id']);
}

function locationRows(input: ManageMediaInput): Array<[string, string | undefined]> {
  return [
    ['Account ID', input.account_id !== undefined ? code(input.account_id) : undefined],
    ['Location ID', input.location_id ? code(input.location_id) : undefined],
    ['Workspace', input.workspace_id ? code(input.workspace_id) : undefined],
  ];
}

export const manageGoogleBusinessMediaTool = {
  name: 'manage_google_business_media',
  description:
    'Change a Google Business Profile gallery (the photos and videos shown on Maps and Search). action=add (source_url, category): add a photo or video from a public https URL (upload it with upload_media first); COVER and PROFILE are single-slot and replace the existing one. action=delete (media_name from list_google_business_media): permanently remove an item from the public profile. Both use preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id.',
  inputSchema: z.object({
    action: z.enum(['add', 'delete']).describe('add or delete.'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
    source_url: z.string().url().optional().describe('add: public https URL of the photo or video (from upload_media). Photos must be JPG or PNG, 10 KB to 5 MB.'),
    category: z.enum(CATEGORIES).optional().describe('add: which gallery category to add the media to.'),
    media_format: z.enum(['PHOTO', 'VIDEO']).optional().describe('add: defaults to PHOTO. Use VIDEO for videos (Google caps profile videos at 30s / 75MB).'),
    media_name: z.string().min(1).optional().describe('delete: full media resource name from list_google_business_media (accounts/.../locations/.../media/...).'),
    confirm: z.boolean().optional().describe('Leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('The preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    add_google_business_media: z.object({
      ...LEGACY_LOCATION,
      source_url: z.string().url(),
      category: z.enum(CATEGORIES),
      media_format: z.enum(['PHOTO', 'VIDEO']).optional(),
      confirm: z.literal(true),
    }),
    delete_google_business_media: z.object({
      ...LEGACY_LOCATION,
      media_name: z.string().min(1),
      confirm: z.literal(true),
    }),
  },

  async execute(client: PosterlyClient, input: ManageMediaInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_google_business_media', input);
    const call = args as ManageMediaInput;
    if (mode === 'delete') {
      return previewThenConfirm({
        tool: 'manage_google_business_media',
        action: 'delete',
        args,
        nonce: false,
        legacyRefusal: 'Refusing to delete Google Business media without confirm=true after explicit user confirmation.',
        ctx,
        describe: async () => {
          const read = await readForPreview(() => client.listGoogleBusinessMedia({
            workspace_id: call.workspace_id,
            account_id: call.account_id,
            location_id: call.location_id,
          }));
          const item = read.ok ? (read.data.media || []).find((media) => media?.name === call.media_name) : null;
          const details = item
            ? mdSection('Media', mdKeyValue([
                ['Resource name', code(String(item.name))],
                ['Type', item.mediaFormat === 'VIDEO' ? 'video' : 'photo'],
                ['Category', item.category || 'uncategorised'],
                ['Image', item.googleUrl || item.thumbnailUrl || undefined],
                ['Added', item.createTime || undefined],
                ...locationRows(call),
              ]))
            : [
                read.ok ? '_This item was not found in the current gallery listing, so the preview shows the request as given._' : readFailedNote(read.error),
                mdKeyValue([['Resource name', code(String(call.media_name))], ...locationRows(call)]),
              ].join('\n\n');
          return [details, 'This permanently removes the item from the public Google Business profile.'].join('\n\n');
        },
        run: async () => {
          const result = await client.deleteGoogleBusinessMedia(payloadOf(call) as { media_name: string });
          return result.message || 'Media removed from the Google Business profile.';
        },
      });
    }
    return previewThenConfirm({
      tool: 'manage_google_business_media',
      action: 'add',
      args,
      nonce: true,
      legacyRefusal: 'Refusing to add Google Business media without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => [
        mdSection('Media to add', mdKeyValue([
          ['Source URL', call.source_url],
          ['Category', call.category],
          ['Format', call.media_format || 'PHOTO'],
          ...locationRows(call),
        ])),
        call.category === 'COVER' || call.category === 'PROFILE'
          ? `This adds the item publicly to the Google Business profile and replaces the current ${String(call.category).toLowerCase()} image.`
          : 'This adds the item publicly to the Google Business profile gallery on Maps and Search.',
      ].join('\n\n'),
      run: async () => {
        const result = await client.addGoogleBusinessMedia(payloadOf(call) as { source_url: string; category: string });
        return result.message || 'Media added to the Google Business profile.';
      },
    });
  },
};
