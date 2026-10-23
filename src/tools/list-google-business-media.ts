import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const listGoogleBusinessMediaTool = {
  name: 'list_google_business_media',
  description:
    'List the photos and videos on a Google Business Profile gallery (the media shown on Maps and Search) for one location/account or every accessible GBP location. This is separate from media attached to a post. Returns each item\'s resource name, category, format, image URL, and date. Pages the gallery already fetched from Google: limit defaults to 50 (max 200) and offset skips that many items.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe('Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.'),
    limit: z.number().int().min(1).max(200).optional().describe('Items per page. Default 50, max 200. This pages the gallery already fetched; it does not ask Google for a smaller page.'),
    offset: z.number().int().min(0).optional().describe('Items to skip. Use the offset the previous page gives.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { workspace_id?: string; account_id?: number; location_id?: string; limit?: number; offset?: number },
  ) {
    const result = await client.listGoogleBusinessMedia(input);
    const media = result.media || [];
    if (media.length === 0) {
      return 'No photos or videos found on the Google Business profile for your filters.';
    }
    const offset = Math.max(0, Math.trunc(input.offset ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 50) || 50));
    const slice = media.slice(offset, offset + limit);
    if (slice.length === 0) {
      return `No Google Business media on this page: offset ${offset} is past the last of the ${media.length} items.`;
    }

    const lines = [`Google Business profile media (showing ${slice.length} of ${media.length}):`];
    for (const item of slice) {
      const kind = item.mediaFormat === 'VIDEO' ? 'video' : 'photo';
      const category = item.category || 'uncategorised';
      const attribution = item.attribution?.profileName ? ` by ${item.attribution.profileName}` : '';
      const image = item.googleUrl || item.thumbnailUrl;
      const when = item.createTime ? ` added ${item.createTime}` : '';
      lines.push(`- [${kind}] ${category}${attribution}${when}${image ? ` ${image}` : ''} :: ${item.name}`);
    }
    if (offset + slice.length < media.length) {
      lines.push('', `More items available. Call again with offset: ${offset + slice.length} to continue.`);
    }
    lines.push('', 'Use the resource name (after ::) as media_name to delete an item.');
    return lines.join('\n');
  },
};
