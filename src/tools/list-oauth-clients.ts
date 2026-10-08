import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const listOAuthClientsTool = {
  name: 'list_oauth_clients',
  description:
    'List self-serve OAuth developer clients owned by the user. These are public PKCE clients for third-party app integrations.',
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const result = await client.listOAuthClients();
    if (result.clients.length === 0) return 'No OAuth developer clients found.';
    return [
      `OAuth developer clients (${result.clients.length}):`,
      ...result.clients.map((item) => `- ${item.client_name} (${item.client_id}) scopes=${item.default_scopes.join(', ')} active=${item.is_active}`),
    ].join('\n');
  },
};
