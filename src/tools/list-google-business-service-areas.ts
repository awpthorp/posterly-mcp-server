import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatGoogleBusinessServiceArea, formatGoogleBusinessServiceAreaPlaces } from '../lib/service-area-text.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';

export const listGoogleBusinessServiceAreasTool = {
  name: 'list_google_business_service_areas',
  description:
    'Read Google Business service areas (the towns and postcodes a location covers, up to 20). view=areas (default): the current business type, country, and place list for one location. view=places (q required): search for a town or postcode to add. Place IDs from view=places are regions, not the review-link Place ID. Town search needs a maps key on the server; if it is missing, add a place with its Place ID and name on the update instead.',
  inputSchema: z.object({
    view: z.enum(['areas', 'places']).optional().describe('areas (default) or places (search).'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts. Required for view=areas.'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
    q: z.string().min(2).optional().describe('places: town or postcode to search for.'),
    region_code: z.string().optional().describe('places: optional two-letter country code, for example GB.'),
  }),

  async execute(client: PosterlyClient, input: {
    view?: 'areas' | 'places';
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    q?: string;
    region_code?: string;
  }, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_google_business_service_areas', input);
    if (mode === 'places') {
      const result = await client.searchGoogleBusinessServiceAreaPlaces({
        workspace_id: args.workspace_id,
        q: args.q,
        region_code: args.region_code,
      });
      return formatGoogleBusinessServiceAreaPlaces(result);
    }
    const result = await client.getGoogleBusinessServiceArea({
      workspace_id: args.workspace_id,
      account_id: args.account_id,
      location_id: args.location_id,
    });
    return formatGoogleBusinessServiceArea(result);
  },
};
