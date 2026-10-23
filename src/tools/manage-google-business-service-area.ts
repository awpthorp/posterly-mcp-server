import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection } from '../lib/format.js';
import { formatGoogleBusinessServiceArea } from '../lib/service-area-text.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';

const placeSchema = z.object({
  place_id: z.string(),
  place_name: z.string(),
});

type Place = { place_id: string; place_name: string };

type UpdateInput = {
  action: 'update';
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
  business_type?: 'CUSTOMER_LOCATION_ONLY' | 'CUSTOMER_AND_BUSINESS_LOCATION';
  region_code?: string;
  places?: Place[];
  clear_storefront_address?: boolean;
  confirm?: boolean;
  preview_id?: string;
};

export const manageGoogleBusinessServiceAreaTool = {
  name: 'manage_google_business_service_area',
  description:
    'Replace the service areas on a Google Business location. action=update sends the full list (1 to 20 places, each with place_id and place_name from list_google_business_service_areas view=places or a known region Place ID). business_type is CUSTOMER_AND_BUSINESS_LOCATION (customers can visit, and you also travel) or CUSTOMER_LOCATION_ONLY (you only travel to customers). CUSTOMER_LOCATION_ONLY needs region_code when Google has not set one, and clear_storefront_address=true when a street address is still on the listing. The country cannot be changed once set. Preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id. Saving the same list again is safe.',
  inputSchema: z.object({
    action: z.enum(['update']).describe('update: replace the service area list.'),
    workspace_id: z.string().optional(),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
    business_type: z.enum(['CUSTOMER_LOCATION_ONLY', 'CUSTOMER_AND_BUSINESS_LOCATION']).optional().describe('CUSTOMER_LOCATION_ONLY travels to customers. CUSTOMER_AND_BUSINESS_LOCATION also has a storefront.'),
    region_code: z.string().optional().describe('Two-letter country code. Required for customer-only listings that do not already have one. Immutable once set.'),
    places: z.array(placeSchema).max(20).optional().describe('The full replacement list, 1 to 20 areas. Each item needs place_id and place_name.'),
    clear_storefront_address: z.boolean().optional().describe('Set true only when switching to customer-only. Google requires the street address to be removed from the listing in the same update; it is not kept, so adding it back means entering it again.'),
    confirm: z.boolean().optional().describe('Leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('The preview_id from the preview call. Required with confirm: true.'),
  }),

  async execute(client: PosterlyClient, input: UpdateInput, ctx: ToolContext) {
    const { args } = validateArgs(ctx, 'manage_google_business_service_area', input);
    const call = args as UpdateInput;
    return previewThenConfirm({
      tool: 'manage_google_business_service_area',
      action: 'update',
      args,
      nonce: false,
      legacyRefusal: 'Refusing to update Google Business service areas without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => {
        const placeLines = (list: unknown, empty: string): string => {
          const rows = Array.isArray(list) ? list as Place[] : [];
          return rows.length
            ? rows.map((place) => `- ${place.place_name} :: ${place.place_id}`).join('\n')
            : empty;
        };
        // The update replaces the whole list, so show what it replaces.
        const read = await readForPreview(() => client.getGoogleBusinessServiceArea({
          workspace_id: call.workspace_id,
          account_id: call.account_id,
          location_id: call.location_id,
        }));
        const current = read.ok ? read.data?.service_area : null;
        return [
          current
            ? mdSection('Current service areas', [
              mdKeyValue([
                ['Business type', current.business_type || 'not set'],
                ['Country', current.region_code || 'not set'],
              ]),
              placeLines(current.places, 'No areas are set.'),
            ].join('\n\n'))
            : readFailedNote(read.ok ? 'no service area returned' : read.error),
          mdSection('Service areas to save', [
            mdKeyValue([
              ['Business type', call.business_type],
              ['Country', call.region_code || 'unchanged'],
              ['Remove street address', call.clear_storefront_address === true ? 'yes, it is deleted from the listing' : 'no'],
              ['Account ID', call.account_id !== undefined ? code(call.account_id) : undefined],
              ['Location ID', call.location_id ? code(call.location_id) : undefined],
              ['Workspace', call.workspace_id ? code(call.workspace_id) : undefined],
            ]),
            placeLines(call.places, 'No areas in this request.'),
          ].join('\n\n')),
          'This replaces the public service areas on Google. Google allows up to 20 towns or postcodes. Edits can take up to 48 hours to show.',
        ].join('\n\n');
      },
      run: async () => {
        const result = await client.updateGoogleBusinessServiceArea(omitKeys(call, ['action', 'confirm', 'preview_id']) as {
          business_type: string;
          places: Place[];
        });
        return formatGoogleBusinessServiceArea(result);
      },
    });
  },
};
