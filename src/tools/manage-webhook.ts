import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection } from '../lib/format.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';
import { webhookEventSchema } from './webhook-events.js';

type ManageWebhookInput = {
  action: 'update' | 'delete' | 'test';
  webhook_id: string;
  url?: string;
  events?: string[];
  workspace_id?: string | null;
  description?: string | null;
  is_active?: boolean;
  confirm?: boolean;
  preview_id?: string;
};

export const manageWebhookTool = {
  name: 'manage_webhook',
  description:
    'Change a webhook subscription (list them first with list_webhooks). action=update (webhook_id): change URL, events, workspace, description, or active state; outbound side effects, so pass confirm=true only after explicit confirmation. action=delete (webhook_id): remove the subscription; preview then confirm: call without confirm to get a preview and preview_id, show the URL, events, and workspace, then call again with confirm=true and that preview_id. action=test (webhook_id): send a signed webhook.test delivery; confirm=true after explicit confirmation.',
  inputSchema: z.object({
    action: z.enum(['update', 'delete', 'test']).describe('update, delete, or test.'),
    webhook_id: z.string().describe('Webhook ID from list_webhooks.'),
    url: z.string().url().optional().describe('update only.'),
    events: z.array(webhookEventSchema).optional().describe('update only.'),
    workspace_id: z.union([z.string(), z.null()]).optional().describe('update only. null clears the workspace.'),
    description: z.union([z.string().max(240), z.null()]).optional().describe('update only.'),
    is_active: z.boolean().optional().describe('update only.'),
    confirm: z
      .boolean()
      .optional()
      .describe('update and test: true after the user explicitly confirms. delete: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('delete: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    update_webhook: z.object({
      webhook_id: z.string(),
      url: z.string().url().optional(),
      events: z.array(webhookEventSchema).optional(),
      workspace_id: z.union([z.string(), z.null()]).optional(),
      description: z.union([z.string().max(240), z.null()]).optional(),
      is_active: z.boolean().optional(),
      confirm: z.literal(true),
    }),
    delete_webhook: z.object({ webhook_id: z.string(), confirm: z.literal(true) }),
    test_webhook: z.object({ webhook_id: z.string(), confirm: z.literal(true) }),
  },

  async execute(client: PosterlyClient, input: ManageWebhookInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_webhook', input);
    const call = args as ManageWebhookInput;
    if (mode === 'update') {
      if (call.confirm !== true) {
        throw new Error('Refusing to update webhook without confirm=true after explicit user confirmation.');
      }
      const payload = omitKeys(call, ['action', 'confirm', 'preview_id', 'webhook_id']);
      const result = await client.updateWebhook(call.webhook_id, payload);
      const active = result.webhook.is_active ? 'active' : 'inactive';
      return `Webhook updated: ${result.webhook.id}\nURL: ${result.webhook.url}\nState: ${active}\nEvents: ${result.webhook.events.join(', ')}`;
    }
    if (mode === 'test') {
      if (call.confirm !== true) {
        throw new Error('Refusing to test webhook without confirm=true after explicit user confirmation.');
      }
      const result = await client.testWebhook(call.webhook_id);
      const delivery = result.delivery || {};
      return `Webhook test sent.\nDelivery: ${JSON.stringify(delivery, null, 2)}`;
    }
    return previewThenConfirm({
      tool: 'manage_webhook',
      action: 'delete',
      args,
      nonce: false,
      legacyRefusal: 'Refusing to delete webhook without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => {
        // There is no GET /webhooks/:id, so the preview finds it in the list.
        const read = await readForPreview(() => client.listWebhooks({}));
        const webhook = read.ok ? read.data.webhooks.find((item) => String(item.id) === String(call.webhook_id)) : null;
        const details = webhook
          ? mdSection('Webhook', mdKeyValue([
              ['Webhook ID', code(webhook.id)],
              ['URL', webhook.url],
              ['Events', webhook.events?.length ? webhook.events.join(', ') : 'default events'],
              ['State', webhook.is_active ? 'active' : 'inactive'],
              ['Workspace', webhook.workspace_id ? code(webhook.workspace_id) : 'all workspaces'],
            ]))
          : [
              read.ok ? '_This webhook was not found in your webhook list, so the preview shows the request as given._' : readFailedNote(read.error),
              mdKeyValue([['Webhook ID', code(call.webhook_id)]]),
            ].join('\n\n');
        return [details, 'This deletes the webhook subscription. posterly stops sending events to its URL.'].join('\n\n');
      },
      run: async () => {
        const result = await client.deleteWebhook(call.webhook_id);
        return `Webhook deleted: ${result.id}`;
      },
    });
  },
};
