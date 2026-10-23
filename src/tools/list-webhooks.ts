import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

export const listWebhooksTool = {
  name: 'list_webhooks',
  description:
    'List API webhook subscriptions, their event filters, active state, and most recent delivery status. view=deliveries (webhook_id) reads recent delivery attempts for one webhook. That history stays off until it is switched on, and it does not include the signing secret or the request body.',
  inputSchema: z.object({
    view: z.enum(['webhooks', 'deliveries']).optional().describe('webhooks (default) or deliveries.'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    webhook_id: z.string().optional().describe('deliveries: webhook ID from view=webhooks.'),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  }),

  async execute(client: PosterlyClient, input: { view?: 'webhooks' | 'deliveries'; workspace_id?: string; webhook_id?: string; limit?: number; offset?: number }, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_webhooks', input);
    if (mode === 'deliveries') {
      const result = await client.listWebhookDeliveries(String(args.webhook_id), { limit: args.limit, offset: args.offset });
      if (result.enabled !== true) return 'Webhook delivery history is switched off. Nothing was read.';
      const deliveries = Array.isArray(result.deliveries) ? result.deliveries : [];
      if (deliveries.length === 0) return 'No deliveries found for this webhook.';
      const lines = [`Deliveries (${deliveries.length}):`];
      for (const delivery of deliveries) {
        lines.push(`- ${delivery.id} ${delivery.event_type || ''} ${delivery.status || ''} HTTP ${delivery.http_status ?? 'n/a'} at ${delivery.delivered_at || delivery.created_at || 'n/a'}`);
      }
      return lines.join('\n');
    }
    const { webhooks } = await client.listWebhooks({ workspace_id: args.workspace_id });
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
