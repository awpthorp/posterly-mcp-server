import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { previewThenConfirm, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const X_ADDON_DESCRIPTION = 'Buy an X posting add-on. action=buy: plan_code is x_posts_100 ($8/month, 100 extra posts), x_posts_250 ($18/month, 250), or x_posts_500 ($35/month, 500). Call without confirm to see the price. Show that price to the user. Nothing is charged on the preview. Then call again with confirm=true, the preview_id, and expected_addon_status, expected_plan_code, and expected_price_usd from the preview. Confirming returns a Stripe Checkout link. The card is charged only after the user pays on that page. If an add-on is already active, confirming opens the billing page for the workspace owner and does not buy a second plan. Read the allowance with get_x_posting_quota. Owner or admin. billing:write.';

type XAddonQuote = {
  mode?: string;
  plan_code?: string | null;
  plan_name?: string | null;
  monthly_posts?: number | null;
  price_usd?: number | null;
  current_addon_status?: string;
  current_plan_code?: string | null;
  effect?: string;
};

type BuyInput = {
  action: 'buy';
  plan_code?: 'x_posts_100' | 'x_posts_250' | 'x_posts_500';
  workspace_id?: string;
  expected_addon_status?: string;
  expected_plan_code?: string | null;
  expected_price_usd?: number | null;
  confirm?: boolean;
  preview_id?: string;
};

function formatQuote(quote: XAddonQuote): string {
  const price = quote.price_usd == null ? 'n/a' : `$${quote.price_usd} per month`;
  return [
    mdTitle(quote.mode === 'portal' ? 'X posting add-on: billing page' : 'X posting add-on quote'),
    quote.effect || '',
    mdSection('Quote', mdKeyValue([
      ['Plan', quote.plan_name || quote.plan_code || 'none yet'],
      ['Price', price],
      ['Extra posts', quote.monthly_posts ?? 'n/a'],
      ['Charged now', 'no'],
      ['Current add-on status', quote.current_addon_status],
    ])),
    'Nothing is charged until the Stripe page is paid.',
    mdSection('Fields to repeat on confirm', [
      `expected_addon_status: ${quote.current_addon_status}`,
      `expected_plan_code: ${quote.current_plan_code == null ? 'null' : quote.current_plan_code}`,
      `expected_price_usd: ${quote.price_usd == null ? 'null' : quote.price_usd}`,
    ].join('\n')),
  ].filter(Boolean).join('\n\n');
}

export const manageXPostingAddonTool = {
  name: 'manage_x_posting_addon',
  description: X_ADDON_DESCRIPTION,
  inputSchema: z.object({
    action: z.enum(['buy']).describe('buy: quote an X posting add-on, then open Checkout after the user agrees.'),
    plan_code: z.enum(['x_posts_100', 'x_posts_250', 'x_posts_500']).optional().describe('Which add-on to buy. Not used when one is already active.'),
    workspace_id: z.string().optional().describe('Workspace ID from whoami, when the key is not already scoped.'),
    expected_addon_status: z.string().optional().describe('From the preview. The add-on status the quote was based on.'),
    expected_plan_code: z.string().nullable().optional().describe('From the preview. The current plan code, or null when there is none.'),
    expected_price_usd: z.number().nullable().optional().describe('From the preview. The monthly price in dollars, or null.'),
    confirm: z.boolean().optional().describe('True only after the user agrees, with the preview_id.'),
    preview_id: z.string().optional().describe('The preview_id from the preview call.'),
  }),

  async execute(client: PosterlyClient, input: BuyInput, ctx: ToolContext) {
    const { args } = validateArgs(ctx, 'manage_x_posting_addon', input);
    const call = args as BuyInput;
    let quote: XAddonQuote | null = null;
    let previewArgs: Record<string, unknown> = args;
    if (call.confirm !== true) {
      const read = await readForPreview(() => client.quoteXPostingAddon({
        ...(call.plan_code ? { plan_code: call.plan_code } : {}),
        ...(call.workspace_id ? { workspace_id: call.workspace_id } : {}),
      }));
      if (!read.ok) {
        throw new Error([
          'No preview: this add-on cannot be started right now.',
          read.error,
          'Nothing was charged and no preview_id was issued.',
        ].join('\n\n'));
      }
      quote = read.data.quote;
      previewArgs = {
        ...args,
        expected_addon_status: quote.current_addon_status,
        expected_plan_code: quote.current_plan_code,
        expected_price_usd: quote.price_usd,
      };
    }
    return previewThenConfirm({
      tool: 'manage_x_posting_addon',
      action: 'buy',
      args: previewArgs,
      nonce: true,
      legacyRefusal: 'Refusing to start an X posting add-on without confirm=true after the user agrees.',
      ctx,
      describe: async () => formatQuote(quote || {}),
      run: async () => {
        if (call.expected_addon_status === undefined || call.expected_plan_code === undefined || call.expected_price_usd === undefined) {
          throw new Error('Confirm needs expected_addon_status, expected_plan_code, and expected_price_usd from the preview. Get a new preview.');
        }
        const result = await client.buyXPostingAddon({
          confirm: true,
          expected_addon_status: call.expected_addon_status,
          expected_plan_code: call.expected_plan_code,
          expected_price_usd: call.expected_price_usd,
          ...(call.plan_code ? { plan_code: call.plan_code } : {}),
          ...(call.workspace_id ? { workspace_id: call.workspace_id } : {}),
        });
        const url = typeof result.url === 'string' ? result.url : '';
        return [
          mdTitle(result.mode === 'portal' ? 'Billing page, nothing charged' : 'Checkout page, nothing charged yet'),
          result.effect || 'Nothing was charged.',
          url ? `Open this page to finish: ${url}` : 'No page was returned. Nothing was charged.',
        ].join('\n\n');
      },
    });
  },
};
