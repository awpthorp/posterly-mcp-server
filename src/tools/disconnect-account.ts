import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const disconnectAccountTool = {
  name: 'disconnect_account',
  description:
    'Disconnect a connected social account from posterly. DESTRUCTIVE and IRREVERSIBLE: removes the account connection, emits account.disconnected webhooks, and may transfer Instagram scheduled posts to a replacement account.\n\n' +
    'REQUIRED BEFORE CALLING: Call `list_accounts` first, show the user the exact platform, username, account ID, and workspace that will be disconnected, then get explicit confirmation. Pass confirm=true only after that confirmation.',
  inputSchema: z.object({
    account_id: z.string().describe('Connected social account ID from list_accounts.'),
    confirm: z.boolean().describe('Must be true after explicit user confirmation.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { account_id: string; confirm: boolean },
  ) {
    if (input.confirm !== true) {
      throw new Error('Refusing to disconnect account without confirm=true after explicit user confirmation.');
    }

    const result = await client.disconnectAccount(input.account_id);
    const account = result.account || {};
    return [
      `Disconnected ${account.platform || 'account'}${account.username ? ` @${account.username}` : ''} (ID: ${account.id || input.account_id}).`,
      `Transferred posts: ${result.transferred_post_count ?? 0}.`,
      `Stamped posts: ${result.stamped_post_count ?? 0}.`,
    ].join('\n');
  },
};
