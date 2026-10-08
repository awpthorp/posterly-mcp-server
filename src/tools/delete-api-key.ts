import { z } from 'zod';
import type { DeleteApiKeyResponse, PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

function formatDeletedApiKey(result: DeleteApiKeyResponse): string {
  const key = result.api_key;
  return [
    mdTitle(result.already_revoked ? 'API key was already revoked' : 'API key revoked'),
    mdSection('Details', mdKeyValue([
      ['Key ID', code(key.id)],
      ['Name', key.name],
      ['Prefix', code(key.key_prefix)],
      ['Workspace', key.workspace_id ? code(key.workspace_id) : 'all accessible workspaces'],
    ])),
  ].join('\n\n');
}

export const deleteApiKeyTool = {
  name: 'delete_api_key',
  description:
    'Revoke a posterly API key owned by the authenticated user. DESTRUCTIVE: call whoami or use a known key ID, show the user the exact key ID/prefix/name if available, and get explicit confirmation before calling. Cannot revoke the key currently authenticating this request, OAuth-issued keys, or managed assistant keys.',
  inputSchema: z.object({
    key_id: z.string().uuid().describe('API key ID to revoke. This is the API key resource ID, not the secret pst_live_ value.'),
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms API key revocation.'),
  }),

  async execute(client: PosterlyClient, input: { key_id: string; confirm: true }) {
    const result = await client.deleteApiKey(input.key_id, { confirm: input.confirm });
    return formatDeletedApiKey(result);
  },
};
