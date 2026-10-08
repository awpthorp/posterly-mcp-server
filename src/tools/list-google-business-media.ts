import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const listGoogleBusinessMediaTool = {
  name: 'list_google_business_media',
  description:
    'List the photos and videos on a Google Business Profile gallery (the media shown on Maps and Search) for one location/account or every accessible GBP location. This is separate from media attached to a post. Returns each item\'s resource name, category, format, and URLs.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe('Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { workspace_id?: string; account_id?: number; location_id?: string },
  ) {
    const result = await client.listGoogleBusinessMedia(input);
    if (result.media.length === 0) {
      return 'No photos or videos found on the Google Business profile for your filters.';
    }

    const lines = [`Google Business profile media (${result.media.length}):`];
    for (const item of result.media.slice(0, 50)) {
      const kind = item.mediaFormat === 'VIDEO' ? 'video' : 'photo';
      const category = item.category || 'uncategorised';
      const attribution = item.attribution?.profileName ? ` by ${item.attribution.profileName}` : '';
      lines.push(`- [${kind}] ${category}${attribution} :: ${item.name}`);
    }
    lines.push('', 'Use the resource name (after ::) as media_name to delete an item.');
    return lines.join('\n');
  },
};
