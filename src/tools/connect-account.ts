import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

const CREDENTIAL_PLATFORMS = [
  'telegram',
  'bluesky',
  'discord',
  'wordpress',
  'devto',
  'hashnode',
  'lemmy',
] as const;

/**
 * Per-platform credential field whitelist. Duplicated in the hosted tool
 * (lib/mcp/http-tools.ts) on purpose: the platform manifest does not carry
 * credential fields, and the v1 endpoint rejects unknown keys, so each tool
 * must whitelist before building the credentials object. The MCP parity and
 * payload checks guard the duplication.
 */
const PLATFORM_CREDENTIAL_FIELDS: Record<string, string[]> = {
  telegram: ['bot_token', 'chat_id'],
  bluesky: ['handle', 'app_password'],
  discord: ['webhook_url'],
  wordpress: ['site_url', 'username', 'app_password'],
  devto: ['api_key'],
  hashnode: ['pat'],
  lemmy: ['instance', 'username', 'password'],
};

export const connectAccountTool = {
  name: 'connect_account',
  description:
    'Connect a credential-based social account (telegram, bluesky, discord, wordpress, devto, hashnode, lemmy) directly, without a browser session. Call list_platforms with view=connect_link first to discover the exact credential fields the platform needs. Prefer scoped secrets: app passwords (Bluesky, WordPress), bot tokens (Telegram), webhook URLs (Discord), and API tokens (Dev.to, Hashnode) over primary passwords. Warn the user that any credential they share passes through this conversation. For OAuth platforms (Instagram, X, LinkedIn, ...) use create_connect_session instead.',
  inputSchema: z.object({
    platform: z
      .enum(CREDENTIAL_PLATFORMS)
      .describe('Credential-based connection target: telegram, bluesky, discord, wordpress, devto, hashnode, or lemmy.'),
    bot_token: z.string().optional().describe('Telegram: bot token from BotFather.'),
    chat_id: z.string().optional().describe('Telegram: target channel or group chat ID.'),
    handle: z.string().optional().describe('Bluesky: handle, for example posterly.bsky.social.'),
    app_password: z.string().optional().describe('Bluesky: app password from account settings. WordPress: application password from wp-admin Users, Profile, Application Passwords.'),
    webhook_url: z.string().optional().describe('Discord: channel webhook URL from channel settings, Integrations, Webhooks.'),
    site_url: z.string().optional().describe('WordPress: site URL, e.g. https://blog.example.com.'),
    username: z.string().optional().describe('WordPress: username the application password belongs to. Lemmy: username or email.'),
    password: z.string().optional().describe('Lemmy: account password (TOTP-enabled accounts are not supported).'),
    api_key: z.string().optional().describe('Dev.to: API key from Settings, Extensions, DEV Community API Keys.'),
    pat: z.string().optional().describe('Hashnode: personal access token from Account Settings, Developer.'),
    instance: z.string().optional().describe('Lemmy: instance domain, for example lemmy.world.'),
    workspace_id: z.string().optional().describe('Workspace to connect the account into. Workspace-scoped API keys ignore this.'),
    connect_session_id: z.string().optional().describe('Optional connect session ID to mark connected or failed based on the outcome.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      platform: (typeof CREDENTIAL_PLATFORMS)[number];
      workspace_id?: string;
      connect_session_id?: string;
    } & Record<string, string | undefined>,
  ) {
    const allowedFields = PLATFORM_CREDENTIAL_FIELDS[input.platform] || [];
    const credentials: Record<string, string> = {};
    for (const field of allowedFields) {
      const value = input[field];
      if (typeof value === 'string' && value.trim()) {
        credentials[field] = value;
      }
    }

    const missing = allowedFields.filter((field) => !(field in credentials));
    if (missing.length > 0) {
      return `Missing credential field(s) for ${input.platform}: ${missing.join(', ')}. Call list_platforms with view=connect_link and target=${input.platform} to see field descriptions.`;
    }

    const result = await client.connectAccountCredentials({
      platform: input.platform,
      credentials,
      workspace_id: input.workspace_id,
      connect_session_id: input.connect_session_id,
    });

    const account = result.account || {};
    const lines = [
      `Connected ${input.platform} account: ${account.username || 'unknown'} (id ${account.id})`,
      `Workspace: ${result.workspace_id}`,
      'Reconnecting the same account updates it in place.',
    ];
    return lines.join('\n');
  },
};
