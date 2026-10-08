import { z } from 'zod';
import type { ConnectOption, PosterlyClient } from '../lib/api-client.js';
import { ALL_PLATFORM_INPUTS, CONNECT_INPUTS, PLANNED_PLATFORM_IDS, SUPPORTED_PLATFORM_IDS } from '../generated/platform-manifest.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type ListPlatformsInput = {
  view?: 'platforms' | 'schema' | 'connect_link';
  include_planned?: boolean;
  account_id?: string;
  platform?: string;
  target?: string;
  workspace_id?: string;
  debug?: boolean;
};

export const listPlatformsTool = {
  name: 'list_platforms',
  description:
    'Platforms, settings schemas, and connection links. view=platforms (default): posterly platform integrations, posting capabilities, content/media limits, settings schemas, helper tools, and analytics support (include_planned shows future integration possibilities). view=schema: the settings schema for one connected account_id (preferred: returns connection-specific capabilities, needed before Instagram native tags/collaborators) or one platform; account_id wins if both are given. view=connect_link: dashboard handoff links and readiness for every target, or one target (instagram, meta, linkedin_page, twitter, telegram, reddit, wordpress, ...); use connection_url in a logged-in browser (direct OAuth URLs are intentionally not exposed); credential platforms show the credential_fields that connect_account needs.',
  inputSchema: z.object({
    view: z
      .enum(['platforms', 'schema', 'connect_link'])
      .optional()
      .describe('platforms (default), schema, or connect_link.'),
    account_id: z
      .string()
      .optional()
      .describe('view=schema: connected account ID from list_accounts. Preferred because it returns account context.'),
    platform: z
      .enum(ALL_PLATFORM_INPUTS)
      .optional()
      .describe(`view=schema: platform ID such as ${SUPPORTED_PLATFORM_IDS.join(', ')}. Set include_planned to inspect planned providers.`),
    target: z
      .enum(CONNECT_INPUTS)
      .optional()
      .describe('view=connect_link: connection target such as instagram, meta, linkedin_page, twitter, x, google_business, telegram, reddit, or wordpress. Omit to list live connection targets.'),
    workspace_id: z
      .string()
      .optional()
      .describe('view=connect_link: filter connected account counts to a workspace.'),
    include_planned: z
      .boolean()
      .optional()
      .describe(`Include planned integrations such as ${PLANNED_PLATFORM_IDS.join(', ')}.`),
    debug: z
      .boolean()
      .optional()
      .describe('view=connect_link: when true, include the raw connect option JSON for debugging. Keep false for normal user-facing agent flows.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_platform_schema: z.object({
      account_id: z.string().optional(),
      platform: z.enum(ALL_PLATFORM_INPUTS).optional(),
      include_planned: z.boolean().optional(),
    }),
    get_connect_link: z.object({
      platform: z.enum(CONNECT_INPUTS).optional(),
      workspace_id: z.string().optional(),
      include_planned: z.boolean().optional(),
      debug: z.boolean().optional(),
    }),
  },

  async execute(client: PosterlyClient, input: ListPlatformsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_platforms', input);
    if (mode === 'schema') return platformSchema(client, args as ListPlatformsInput);
    if (mode === 'connect_link') return connectLink(client, args as ListPlatformsInput);
    return platforms(client, args as ListPlatformsInput);
  },
};

async function platforms(client: PosterlyClient, input: ListPlatformsInput): Promise<string> {
  const result = await client.listPlatforms({ include_planned: input.include_planned });
  const lines = result.platforms.map((platform) => {
    const helperCount = platform.helper_tools?.length || 0;
    return `• ${platform.label} (${platform.id}): ${platform.status}; post types: ${platform.post_types.join(', ') || 'n/a'}; helpers: ${helperCount}; analytics: ${platform.analytics_supported ? 'yes' : 'no'}`;
  });

  return `posterly platforms (${result.platforms.length}):\n${lines.join('\n')}`;
}

async function platformSchema(client: PosterlyClient, input: ListPlatformsInput): Promise<string> {
  const result = await client.getPlatformSchema({ account_id: input.account_id, platform: input.platform, include_planned: input.include_planned });
  const schema = result.schema || result.platform || result.platforms?.[0];
  if (!schema) return JSON.stringify(result, null, 2);

  const fields = schema.settings_schema?.fields || [];
  const helpers = schema.helper_tools || [];
  const accountLine = result.account
    ? `Account: ${(result.account.username as string) || result.account.id} (${result.account.platform})\n`
    : '';
  const instagramTaggingLine = result.account?.instagram_tagging
    ? `Instagram tagging capabilities: ${JSON.stringify(result.account.instagram_tagging)}`
    : '';

  return [
    `${schema.label} (${schema.id}) schema`,
    accountLine.trim(),
    instagramTaggingLine,
    `Status: ${schema.status}`,
    `Post types: ${schema.post_types.join(', ') || 'n/a'}`,
    `Content limit: ${schema.content_limit ?? 'n/a'}`,
    `Media: ${JSON.stringify(schema.media)}`,
    `Analytics: ${schema.analytics_supported ? 'yes' : 'no'}`,
    fields.length
      ? `Settings:\n${fields.map((field: any) => `• ${field.key}${field.required ? ' (required)' : ''}: ${field.description}`).join('\n')}`
      : 'Settings: none',
    helpers.length
      ? `Helpers:\n${helpers.map((helper: any) => `• ${helper.name}: ${helper.description}`).join('\n')}`
      : 'Helpers: none',
    `Example settings: ${JSON.stringify(schema.settings_schema?.example || {})}`,
  ].filter(Boolean).join('\n');
}

async function connectLink(client: PosterlyClient, input: ListPlatformsInput): Promise<string> {
  const { debug } = input;
  const result = await client.getConnectLink({
    platform: input.target,
    workspace_id: input.workspace_id,
    include_planned: input.include_planned,
  });
  if (result.connect) {
    return formatConnectOption(result.connect, Boolean(debug));
  }

  const options = result.connect_options || [];
  const lines = options.map((option) => formatConnectOption(option, false));
  return `posterly connection options (${options.length}):\n${lines.join('\n\n')}`;
}

function formatConnectOption(option: ConnectOption, includeRaw: boolean): string {
  const missing = option.missing_env?.length
    ? `missing env: ${option.missing_env.map((group) => group.join(' or ')).join(', ')}`
    : 'configured';
  const accounts = option.connected_count ?? option.connected_accounts?.length ?? 0;
  const fields = option.credential_fields?.length
    ? `; credential fields: ${option.credential_fields.map((field: any) => field.key).join(', ')}`
    : '';
  const scopes = option.scopes?.length ? `; scopes: ${option.scopes.join(', ')}` : '';
  const raw = includeRaw ? `\n\nRaw connect option:\n${JSON.stringify(option, null, 2)}` : '';

  return [
    `${option.label} (${option.platform})`,
    `Status: ${option.status}; method: ${option.method}; ${missing}; connected accounts: ${accounts}`,
    `Connection URL: ${option.connection_url || 'not available'}${fields}${scopes}`,
    raw,
  ].join('\n');
}
