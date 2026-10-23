import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { previewThenConfirm, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const BRAND_WRITE_DESCRIPTION = 'Create, update, or archive a brand. action=create (admin only): name, and the workspace_id from whoami when the key is not already scoped to one workspace. Optional timezone and website_url. Pass confirm=true only after the user agrees. action=update (admin only): brand_id plus name, timezone, or website_url. Pass confirm=true only after the user agrees. action=archive (admin only): preview then confirm. Call without confirm to see the brand and what archiving does, show that to the user, then call again with confirm=true and the preview_id. Archiving removes the brand from the active list. Connected accounts stay connected, and its scheduled posts are not cancelled: they still publish. The preview counts both.';

type ManageBrandsInput = {
  action: 'create' | 'update' | 'archive';
  brand_id?: string;
  workspace_id?: string;
  name?: string;
  timezone?: string;
  website_url?: string | null;
  confirm?: boolean;
  preview_id?: string;
};

function formatBrand(result: Record<string, any>): string {
  if (result.requires_confirmation && result.preview) {
    const preview = result.preview;
    return [
      mdTitle('Preview only: the brand is not archived yet'),
      preview.effect || '',
      mdSection('Brand', mdKeyValue([
        ['Name', preview.name],
        ['Brand ID', preview.brand_id ? code(preview.brand_id) : ''],
        ['Accounts still connected', preview.account_count ?? 'could not be counted'],
        ['Scheduled posts that still publish', preview.scheduled_post_count ?? 'could not be counted'],
        ['Status', preview.status],
      ])),
    ].filter(Boolean).join('\n\n');
  }
  const brand = result.brand || {};
  return [
    mdTitle(result.already_archived ? `Brand already archived: ${brand.name || 'brand'}` : `Brand: ${brand.name || 'updated'}`),
    mdKeyValue([
      ['Brand ID', brand.id ? code(brand.id) : ''],
      ['Status', brand.status],
      ['Timezone', brand.timezone],
      ['Website', brand.website_url],
      ['Workspace', brand.workspace_id ? code(brand.workspace_id) : ''],
    ]),
  ].join('\n\n');
}

export const manageBrandsTool = {
  name: 'manage_brand',
  description: BRAND_WRITE_DESCRIPTION,
  inputSchema: z.object({
    action: z.enum(['create', 'update', 'archive']).describe('create, update, or archive.'),
    brand_id: z.string().optional().describe('update and archive: the brand ID from list_brands.'),
    workspace_id: z.string().optional().describe('create: workspace ID from whoami, when the key is not already scoped.'),
    name: z.string().optional().describe('create: required. update: the new name.'),
    timezone: z.string().optional().describe('create or update: an IANA timezone such as Europe/London.'),
    website_url: z.string().optional().describe('create or update: an http or https website. Pass an empty string on update to clear it.'),
    confirm: z.boolean().optional().describe('create and update: true only after the user agrees. archive: true only with the preview_id from a preview call.'),
    preview_id: z.string().optional().describe('archive: the preview_id from the preview call.'),
  }),

  async execute(client: PosterlyClient, input: ManageBrandsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_brand', input);
    const parsed = args as ManageBrandsInput;
    if (mode === 'update') {
      if (parsed.confirm !== true) throw new Error('Refusing to update a brand without confirm=true after the user agrees.');
      if (!parsed.brand_id) throw new Error('brand_id is required.');
      const result = await client.updateBrand(parsed.brand_id, {
        confirm: true,
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
        ...(parsed.website_url !== undefined ? { website_url: parsed.website_url } : {}),
      });
      return formatBrand(result);
    }
    if (mode === 'archive') {
      if (!parsed.brand_id) throw new Error('brand_id is required.');
      const brandId = parsed.brand_id;
      return previewThenConfirm({
        tool: 'manage_brand',
        action: 'archive',
        args: parsed,
        nonce: false,
        legacyRefusal: 'Refusing to archive a brand without confirm=true after the user agrees.',
        ctx,
        describe: async () => formatBrand(await client.archiveBrand(brandId, { confirm: false })),
        run: async () => formatBrand(await client.archiveBrand(brandId, { confirm: true })),
      });
    }
    if (parsed.confirm !== true) throw new Error('Refusing to create a brand without confirm=true after the user agrees.');
    if (!parsed.name?.trim()) throw new Error('name is required.');
    const result = await client.createBrand({
      name: parsed.name.trim(),
      confirm: true,
      ...(parsed.workspace_id ? { workspace_id: parsed.workspace_id } : {}),
      ...(parsed.timezone ? { timezone: parsed.timezone } : {}),
      ...(parsed.website_url ? { website_url: parsed.website_url } : {}),
    });
    return formatBrand(result);
  },
};
