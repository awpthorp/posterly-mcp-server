import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection } from '../lib/format.js';
import { omitKeys, previewThenConfirm, readFailedNote, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';
import { GBP_CLOSED_DAYS_NOTE, gbpAttributeLines, gbpCurrentAttributesFor, gbpPeriodLines } from '../lib/gbp-location-preview.js';

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';

const periodSchema = z.object({
  open_day: z.string(),
  open_time: z.string(),
  close_day: z.string(),
  close_time: z.string(),
});

const attributeSchema = z.object({
  name: z.string(),
  value_type: z.enum(['BOOL', 'URL', 'ENUM']),
  values: z.array(z.union([z.boolean(), z.string()])).min(1).max(5),
});

type ManageLocationInput = {
  action: 'update_hours' | 'update_attributes';
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
  regular_hours?: { periods: Array<{ open_day: string; open_time: string; close_day: string; close_time: string }> };
  attributes?: Array<{ name: string; value_type: 'BOOL' | 'URL' | 'ENUM'; values: Array<boolean | string> }>;
  confirm?: boolean;
  preview_id?: string;
};

function locationRows(input: ManageLocationInput): Array<[string, string | undefined]> {
  return [
    ['Account ID', input.account_id !== undefined ? code(input.account_id) : undefined],
    ['Location ID', input.location_id ? code(input.location_id) : undefined],
    ['Workspace', input.workspace_id ? code(input.workspace_id) : undefined],
  ];
}

async function readCurrentLocation(client: PosterlyClient, input: ManageLocationInput) {
  return readForPreview(() => client.listGoogleBusinessLocation({
    workspace_id: input.workspace_id,
    account_id: input.account_id,
    location_id: input.location_id,
  }));
}

function locationReadNote(error: string): string {
  return /switched off/i.test(error)
    ? '_Location edits are switched off, so the current values were not read and a confirm changes nothing._'
    : readFailedNote(error);
}

export const manageGoogleBusinessLocationTool = {
  name: 'manage_google_business_location',
  description:
    'Change regular opening hours or attributes on a Google Business location. action=update_hours sends regular_hours.periods with open_day, close_day, open_time, and close_time as HH:MM. action=update_attributes sends attributes with a name like attributes/has_wifi and value_type BOOL, URL, or ENUM. Both use preview then confirm: call without confirm to get a preview and preview_id, show it, then call again with confirm=true and that preview_id. Stays off until location edits are switched on. A confirm while it is off changes nothing and does not call Google. This uses the same business management connection as posting. It does not change the business name, address, phone, or website.',
  inputSchema: z.object({
    action: z.enum(['update_hours', 'update_attributes']).describe('update_hours or update_attributes.'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
    regular_hours: z.object({ periods: z.array(periodSchema).min(1).max(14) }).optional().describe('update_hours: opening periods. Days are MONDAY-SUNDAY. Times are HH:MM.'),
    attributes: z.array(attributeSchema).min(1).max(20).optional().describe('update_attributes: attributes to set. URL values must be https. Names look like attributes/has_wifi.'),
    confirm: z.boolean().optional().describe('Leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('The preview_id from the preview call. Required with confirm: true.'),
  }),

  async execute(client: PosterlyClient, input: ManageLocationInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_google_business_location', input);
    const call = args as ManageLocationInput;
    if (mode === 'update_attributes') {
      return previewThenConfirm({
        tool: 'manage_google_business_location',
        action: 'update_attributes',
        args,
        nonce: true,
        legacyRefusal: 'Refusing to change Google Business attributes without confirm=true after explicit user confirmation.',
        ctx,
        describe: async () => {
          const read = await readCurrentLocation(client, call);
          const current = read.ok && Array.isArray(read.data?.attributes) ? gbpCurrentAttributesFor(read.data.attributes, call.attributes) : null;
          return [
            mdSection('Current values', current ? gbpAttributeLines(current, 'None of these attributes is set now.') : locationReadNote(read.ok ? 'no attributes returned' : read.error)),
            mdSection('Attributes to set', [gbpAttributeLines(call.attributes, 'No attributes were sent.'), '', mdKeyValue(locationRows(call))].join('\n')),
            'This replaces those attributes on the public Google Business profile. Other attributes are left as they are. Nothing is sent until you confirm, and the edit stays off until location edits are switched on.',
          ].join('\n\n');
        },
        run: async () => {
          const result = await client.updateGoogleBusinessAttributes(omitKeys(call, ['action', 'confirm', 'preview_id']));
          return result.success ? 'Google Business attributes updated.' : (result.error || 'Google Business attributes were not updated.');
        },
      });
    }
    return previewThenConfirm({
      tool: 'manage_google_business_location',
      action: 'update_hours',
      args,
      nonce: true,
      legacyRefusal: 'Refusing to change Google Business hours without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => {
        const read = await readCurrentLocation(client, call);
        const current = read.ok && Array.isArray(read.data?.regular_hours?.periods) ? read.data.regular_hours.periods : null;
        return [
          mdSection('Current regular hours', current ? gbpPeriodLines(current, 'No regular hours are saved now.') : locationReadNote(read.ok ? 'no hours returned' : read.error)),
          mdSection('Regular hours to set', [gbpPeriodLines(call.regular_hours?.periods, 'No opening periods were sent.'), '', GBP_CLOSED_DAYS_NOTE, '', mdKeyValue(locationRows(call))].join('\n')),
          'This replaces the regular opening hours on the public Google Business profile. Nothing is sent until you confirm, and the edit stays off until location edits are switched on.',
        ].join('\n\n');
      },
      run: async () => {
        const result = await client.updateGoogleBusinessHours(omitKeys(call, ['action', 'confirm', 'preview_id']));
        return result.success ? 'Google Business hours updated.' : (result.error || 'Google Business hours were not updated.');
      },
    });
  },
};
