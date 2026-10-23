import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';

type ListLocationInput = {
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
};

export const listGoogleBusinessLocationsTool = {
  name: 'list_google_business_locations',
  description:
    'Read regular opening hours and attributes for one Google Business location. Stays off until location edits are switched on, and does not call Google while it is off. Pass account_id or location_id. Does not return the business name, address, phone, or website.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
  }),

  async execute(client: PosterlyClient, input: ListLocationInput, ctx: ToolContext) {
    const { args } = validateArgs(ctx, 'list_google_business_locations', input);
    const result = await client.listGoogleBusinessLocation(args);
    if (result.enabled !== true) {
      return 'Google Business location edits are switched off. Nothing was read from Google.';
    }
    const periods = Array.isArray(result.regular_hours?.periods) ? result.regular_hours.periods : [];
    const attributes = Array.isArray(result.attributes) ? result.attributes : [];
    return [
      mdTitle('Google Business location'),
      mdSection('Location', mdKeyValue([
        ['Account ID', result.account_id != null ? code(result.account_id) : undefined],
        ['Location', result.location ? code(String(result.location)) : undefined],
      ])),
      mdSection('Regular hours', periods.length
        ? periods.map((period: { open_day?: string; open_time?: string; close_day?: string; close_time?: string }) =>
            `- ${period.open_day} ${period.open_time} to ${period.close_day} ${period.close_time}`).join('\n')
        : 'No regular hours saved.'),
      mdSection('Attributes', attributes.length
        ? attributes.map((attribute: { name?: string; value_type?: string; values?: unknown[] }) =>
            `- ${attribute.name} (${attribute.value_type}): ${(attribute.values || []).join(', ')}`).join('\n')
        : 'No attributes saved.'),
    ].join('\n\n');
  },
};
