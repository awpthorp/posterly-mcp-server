import { z } from 'zod';
import type { CreateApiKeyPayload, CreateApiKeyResponse, PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

const scopeSchema = z.enum(['accounts:read', 'accounts:write', 'posts:read', 'posts:write', 'media:write', 'analytics:read', 'billing:read', 'billing:write']);

function formatCreatedApiKey(result: CreateApiKeyResponse): string {
  const key = result.api_key;
  return [
    mdTitle('API key created'),
    `Full key (shown once): ${code(result.key)}`,
    mdSection('Details', mdKeyValue([
      ['Name', key.name],
      ['Key ID', code(key.id)],
      ['Prefix', code(key.key_prefix)],
      ['Scopes', key.scopes.join(', ')],
      ['Workspace', key.workspace_id ? code(key.workspace_id) : 'all accessible workspaces'],
      ['Expires', key.expires_at || 'no expiry'],
      ['Remaining key slots', result.limits?.remaining_user_keys ?? 'unknown'],
    ])),
    mdSection('Warning', result.warning || 'Store this securely. It will not be shown again.'),
  ].filter(Boolean).join('\n\n');
}

export const createApiKeyTool = {
  name: 'create_api_key',
  description:
    'Create a new posterly API key for the authenticated user. SECRET-CREATING WRITE: only use after explicit user confirmation. The new key can only request scopes already present on the calling dashboard-created API key; OAuth and managed assistant tokens cannot mint keys. Team management (members:read, members:write) and client portal sign-in link permissions are never copied or granted here: a person turns them on in /dashboard/api.',
  inputSchema: z.object({
    name: z.string().trim().min(1).max(120).optional().describe('Human-readable key name.'),
    scopes: z.array(scopeSchema).min(1).max(8).optional().describe('Scopes for the new key. Omit to copy the calling key scopes. Cannot exceed the calling key scopes. billing:read and billing:write allow managing the posterly subscription (cancel/pause/resume/downgrade).'),
    workspace_id: z.string().trim().min(1).optional().describe('Optional workspace restriction. Workspace-scoped calling keys cannot create keys outside their workspace.'),
    expires_in_days: z.number().int().min(1).max(365).optional().describe('Optional expiry from now, up to 365 days. Omit for no expiry.'),
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms that a new secret API key should be created.'),
  }),

  async execute(client: PosterlyClient, input: CreateApiKeyPayload) {
    const result = await client.createApiKey(input);
    return formatCreatedApiKey(result);
  },
};
