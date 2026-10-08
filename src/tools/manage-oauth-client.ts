import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection } from '../lib/format.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const scopeSchema = z.enum(['accounts:read', 'accounts:write', 'posts:read', 'posts:write', 'media:write', 'analytics:read']);

type ManageOAuthClientInput = {
  action: 'create' | 'update' | 'delete';
  client_id?: string;
  client_name?: string;
  description?: string;
  homepage?: string;
  allowed_redirect_uris?: string[];
  default_scopes?: string[];
  is_active?: boolean;
  confirm?: boolean;
  preview_id?: string;
};

export const manageOAuthClientTool = {
  name: 'manage_oauth_client',
  description:
    'Manage self-serve OAuth 2.1 + PKCE developer clients (public clients with no client secret; list them with list_oauth_clients). action=create: client_name, allowed_redirect_uris, and default_scopes; confirm=true only after the user confirms the name, redirect URIs, and scopes. action=update: client_id plus the changed fields; confirm=true after the user confirms the changes. action=delete: client_id; prevents new authorizations (existing access tokens stay revocable as API keys); preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id.',
  inputSchema: z.object({
    action: z.enum(['create', 'update', 'delete']).describe('create, update, or delete.'),
    client_id: z.string().min(1).optional().describe('update and delete: the client_id from list_oauth_clients.'),
    client_name: z.string().min(1).max(120).optional().describe('create (required) or update.'),
    description: z.string().max(500).optional(),
    homepage: z.string().url().optional(),
    allowed_redirect_uris: z.array(z.string().url()).min(1).max(10).optional().describe('create (required) or update.'),
    default_scopes: z.array(scopeSchema).min(1).optional().describe('create (required) or update.'),
    is_active: z.boolean().optional(),
    confirm: z
      .boolean()
      .optional()
      .describe('create and update: true after explicit user confirmation. delete: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('delete: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    create_oauth_client: z.object({
      client_name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      homepage: z.string().url().optional(),
      allowed_redirect_uris: z.array(z.string().url()).min(1).max(10),
      default_scopes: z.array(scopeSchema).min(1),
      is_active: z.boolean().optional(),
      confirm: z.literal(true),
    }),
    update_oauth_client: z.object({
      client_id: z.string().min(1),
      client_name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).optional(),
      homepage: z.string().url().optional(),
      allowed_redirect_uris: z.array(z.string().url()).min(1).max(10).optional(),
      default_scopes: z.array(scopeSchema).min(1).optional(),
      is_active: z.boolean().optional(),
      confirm: z.literal(true),
    }),
    delete_oauth_client: z.object({ client_id: z.string().min(1), confirm: z.literal(true) }),
  },

  async execute(client: PosterlyClient, input: ManageOAuthClientInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_oauth_client', input);
    const call = args as ManageOAuthClientInput;
    if (mode === 'create') {
      if (call.confirm !== true) {
        throw new Error('Refusing to create OAuth client without confirm=true after explicit user confirmation.');
      }
      const payload = omitKeys(call, ['action', 'confirm', 'preview_id']) as {
        client_name: string;
        allowed_redirect_uris: string[];
        default_scopes: string[];
      };
      const result = await client.createOAuthClient(payload);
      return `OAuth client created: ${result.client.client_name}\nclient_id: ${result.client.client_id}\nRedirect URIs: ${result.client.allowed_redirect_uris.join(', ')}`;
    }
    if (mode === 'update') {
      if (call.confirm !== true) {
        throw new Error('Refusing to update OAuth client without confirm=true after explicit user confirmation.');
      }
      const payload = omitKeys(call, ['action', 'confirm', 'preview_id', 'client_id']);
      const result = await client.updateOAuthClient(String(call.client_id), payload);
      return `OAuth client updated: ${result.client.client_name} (${result.client.client_id}) active=${result.client.is_active}`;
    }
    return previewThenConfirm({
      tool: 'manage_oauth_client',
      action: 'delete',
      args,
      nonce: false,
      legacyRefusal: 'Refusing to delete OAuth client without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => {
        const read = await readForPreview(() => client.listOAuthClients());
        const found = read.ok ? read.data.clients.find((item) => String(item.client_id) === String(call.client_id)) : null;
        const details = found
          ? mdSection('OAuth client', mdKeyValue([
              ['Name', found.client_name],
              ['Client ID', code(found.client_id)],
              ['Redirect URIs', found.allowed_redirect_uris.join(', ')],
              ['Active', found.is_active],
            ]))
          : [
              read.ok ? '_This client was not found in your OAuth client list, so the preview shows the request as given._' : readFailedNote(read.error),
              mdKeyValue([['Client ID', code(String(call.client_id))]]),
            ].join('\n\n');
        return [details, 'This deletes the OAuth client: nobody can authorize it again. Existing access tokens stay revocable as API keys.'].join('\n\n');
      },
      run: async () => {
        const result = await client.deleteOAuthClient(String(call.client_id));
        return `OAuth client deleted: ${result.client_id}`;
      },
    });
  },
};
