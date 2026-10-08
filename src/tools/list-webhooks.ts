import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const listWebhooksTool = {
  name: 'list_webhooks',
  description:
    'List API webhook subscriptions, their event filters, active state, and most recent delivery status.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
  }),

  async execute(client: PosterlyClient, input: { workspace_id?: string }) {
    const { webhooks } = await client.listWebhooks(input);
    if (webhooks.length === 0) {
      return 'No webhooks found.';
    }

    const lines = [`Webhooks (${webhooks.length}):`];
    for (const webhook of webhooks) {
      const active = webhook.is_active ? 'active' : 'inactive';
      const events = webhook.events?.length ? webhook.events.join(', ') : 'default events';
      const last = webhook.last_delivery_at
        ? ` last ${webhook.last_delivery_status || 'n/a'} at ${new Date(webhook.last_delivery_at).toLocaleString()}`
        : '';
      lines.push(`- ${webhook.id} [${active}] ${webhook.url} (${events})${last}`);
    }
    return lines.join('\n');
  },
};
