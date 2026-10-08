import { z } from 'zod';
import type { LearnedVoice, PosterlyClient } from '../lib/api-client.js';
import { code, compactText, formatDateTime, mdEmpty, mdKeyValue, mdLearnedVoice, mdSection, mdTable, mdTitle } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type ListBrandsInput = {
  view?: 'brands' | 'brand' | 'accounts' | 'profile';
  brand_id?: string;
  workspace_id?: string;
};

export const listBrandsTool = {
  name: 'list_brands',
  description:
    'Brands (clients) and their saved context. view=brands (default): brands the caller can access with brand ID, name, workspace ID, source, and how many social accounts are assigned (optional workspace_id). view=brand (brand_id): one brand with its workspace, source, and linked legacy brand group. view=accounts (brand_id): the connected social accounts assigned to the brand; use it when a user refers to a brand name rather than an account handle. view=profile (brand_id): voice and tone, audience, keywords, dos and don’ts, visual notes, and other saved brand context.',
  inputSchema: z.object({
    view: z
      .enum(['brands', 'brand', 'accounts', 'profile'])
      .optional()
      .describe('brands (default), brand, accounts, or profile.'),
    brand_id: z.string().optional().describe('The brand ID (from view=brands). Required for brand, accounts, and profile.'),
    workspace_id: z
      .string()
      .optional()
      .describe('view=brands: filter to brands in a specific workspace (get IDs via whoami).'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_brand: z.object({ brand_id: z.string() }),
    list_brand_accounts: z.object({ brand_id: z.string() }),
    get_brand_profile: z.object({ brand_id: z.string() }),
  },

  async execute(client: PosterlyClient, input: ListBrandsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_brands', input);
    if (mode === 'brand') return brand(client, args as { brand_id: string });
    if (mode === 'accounts') return brandAccounts(client, args as { brand_id: string });
    if (mode === 'profile') return brandProfile(client, args as { brand_id: string });
    return brands(client, args as ListBrandsInput);
  },
};

async function brands(client: PosterlyClient, input: ListBrandsInput): Promise<string> {
  const brands = await client.listBrands({ workspace_id: input.workspace_id });

  if (brands.length === 0) {
    return input.workspace_id
      ? mdEmpty('brands', 'This workspace does not have any brands or clients yet.')
      : mdEmpty('brands', 'No brands or clients were found for this API key.', 'Create a brand in the posterly dashboard, then run this again.');
  }

  return [
    mdTitle(`Brands (${brands.length})`),
    mdTable(
      ['Brand', 'Brand ID', 'Accounts', 'Source', 'Workspace'],
      brands.map((brand) => [
        brand.name,
        code(brand.id),
        brand.account_count,
        brand.source,
        brand.workspace_id ? code(brand.workspace_id) : 'default',
      ]),
    ),
  ].join('\n\n');
}

async function brand(client: PosterlyClient, input: { brand_id: string }): Promise<string> {
  const result = await client.getBrand(input.brand_id);
  const brand = result.brand as Record<string, any>;

  return [
    mdTitle(`Brand: ${brand.name}`),
    mdKeyValue([
      ['Brand ID', code(brand.id)],
      ['Source', brand.source],
      ['Workspace', brand.workspace_id ? code(brand.workspace_id) : 'n/a'],
      ['Accounts assigned', brand.account_count ?? 0],
      ['Workspace client ID', brand.workspace_client_id ? code(brand.workspace_client_id) : undefined],
      ['Legacy brand group ID', brand.legacy_brand_group_id ? code(brand.legacy_brand_group_id) : undefined],
      ['Created', formatDateTime(brand.created_at)],
      ['Updated', formatDateTime(brand.updated_at)],
    ]),
  ].join('\n\n');
}

async function brandAccounts(client: PosterlyClient, input: { brand_id: string }): Promise<string> {
  const accounts = await client.listBrandAccounts(input.brand_id);

  if (accounts.length === 0) {
    return mdEmpty('brand accounts', 'No social accounts are currently assigned to this brand.');
  }

  return [
    mdTitle(`Brand accounts (${accounts.length})`),
    mdTable(
      ['Platform', 'Account', 'Account ID', 'Workspace'],
      accounts.map((account) => [
        account.platform,
        `@${account.username}`,
        code(account.id),
        account.workspace_id ? code(account.workspace_id) : 'default',
      ]),
    ),
  ].join('\n\n');
}

async function brandProfile(client: PosterlyClient, input: { brand_id: string }): Promise<string> {
  const result = await client.getBrandProfile(input.brand_id);
  const profile = result.brand_profile as Record<string, any>;

  const profileBody = [
    mdKeyValue([
      ['Source', profile.source],
      ['Profile ID', profile.id ? code(profile.id) : undefined],
      ['Workspace client ID', profile.workspace_client_id ? code(profile.workspace_client_id) : undefined],
      ['Legacy brand group ID', profile.brand_group_id ? code(profile.brand_group_id) : undefined],
      ['Logo', profile.logo_url],
      ['Last refreshed', profile.last_context_refresh_at ? formatDateTime(profile.last_context_refresh_at) : undefined],
    ]),
    mdSection('Voice and audience', mdKeyValue([
      ['Tone of voice', compactText(profile.tone_of_voice, 180)],
      ['Audience', compactText(profile.audience, 180)],
      ['Brand values', compactText(profile.brand_values, 180)],
      ['Brand story', compactText(formatStructuredValue(profile.brand_story), 240)],
    ])),
    mdSection('Guidance', mdKeyValue([
      ['Custom instructions', compactText(profile.custom_instructions, 240)],
      ['Keywords', formatStructuredValue(profile.keywords)],
      ['Competitors', formatStructuredValue(profile.competitors)],
      ['Do / Don’ts', formatStructuredValue(profile.do_donts)],
      ['Topics to cover', formatStructuredValue(profile.topics_to_cover)],
      ['Topics to avoid', formatStructuredValue(profile.topics_to_avoid)],
    ])),
    mdSection('Creative references', mdKeyValue([
      ['Visual guidelines', formatStructuredValue(profile.visual_guidelines)],
      ['Example posts', formatStructuredValue(profile.example_posts)],
      ['Voice examples', formatStructuredValue(profile.voice_examples)],
    ])),
  ].filter(Boolean).join('\n\n');

  const learnedVoices = (Array.isArray(profile.learned_voice) ? profile.learned_voice : []) as LearnedVoice[];
  const learnedBody = learnedVoices.length
    ? mdSection(
        'Learned voice (from published captions)',
        learnedVoices.map((voice) => mdLearnedVoice(voice)).filter(Boolean).join('\n\n'),
      )
    : '';

  return [
    mdTitle(`Brand profile: ${profile.brand_name}`),
    profileBody || 'No extended brand profile fields have been saved yet.',
    learnedBody ||
      '_No learned voice yet. posterly learns each account’s voice automatically once it has enough published posts._',
  ].filter(Boolean).join('\n\n');
}

function formatStructuredValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value
      .map((item) => formatStructuredValue(item) || JSON.stringify(item))
      .filter(Boolean)
      .join(' | ');
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json === '{}' ? null : json;
  }
  return String(value);
}
