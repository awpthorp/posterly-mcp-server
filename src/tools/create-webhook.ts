import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { webhookEventSchema } from './webhook-events.js';

export const createWebhookTool = {
  name: 'create_webhook',
  description:
    'Create a webhook subscription for post/account/analytics events. WRITE WITH OUTBOUND SIDE EFFECTS: show the user the target URL, workspace, events, and active state, then get explicit confirmation before calling. The response includes the signing secret once.',
  inputSchema: z.object({
    url: z.string().url().describe('HTTPS webhook endpoint URL. Localhost HTTP is allowed by the API for development.'),
    events: z.array(webhookEventSchema).optional().describe('Events to deliver. Defaults to core post lifecycle events.'),
    workspace_id: z.string().optional().describe('Optional workspace filter. Omit for all workspaces owned by the API key user.'),
    description: z.string().max(240).optional(),
    is_active: z.boolean().optional().describe('Defaults to true.'),
    confirm: z.literal(true).describe('Must be true after the user explicitly confirms webhook creation.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      url: string;
      events?: string[];
      workspace_id?: string;
      description?: string;
      is_active?: boolean;
      confirm: true;
    },
  ) {
    const { confirm: _confirm, ...payload } = input;
    const result = await client.createWebhook(payload);
    const secret = result.secret ? `\nSigning secret: ${result.secret}` : '';
    return `Webhook created: ${result.webhook.id}\nURL: ${result.webhook.url}\nEvents: ${result.webhook.events.join(', ')}${secret}`;
  },
};
