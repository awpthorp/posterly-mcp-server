import { z } from 'zod';
import type { PosterlyClient, GoogleBusinessLocationReviewSummary } from '../lib/api-client.js';
import { formatDate } from '../lib/format.js';
import { reviewNameFromListItem, reviewReplyComment } from '../lib/google-business-review-name.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

/** Matches GOOGLE_BUSINESS_REVIEWS_MAX_LIMIT in lib/api-v1-google-business.ts. */
const MAX_LIMIT = 1000;

type ReviewsInput = {
  view?: 'reviews' | 'review_link';
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
  rating?: number;
  unanswered?: boolean;
  limit?: number;
  offset?: number;
};

export const listGoogleBusinessReviewsTool = {
  name: 'list_google_business_reviews',
  description:
    'Google Business Profile reviews. view=reviews (default): reviews for one location/account or every accessible GBP location, paging through all reviews Google has (not just the first 50) with the full untruncated review text, its date, and each location\'s total review count; filter by rating or unanswered, page with limit/offset. Each review has review_name for manage_google_business_review reply/delete_reply. view=review_link (account_id or location_id): the direct public Google review link plus the Google Place ID (ChIJ...); that Place ID is output only and must NOT be passed back as location_id.',
  inputSchema: z.object({
    view: z.enum(['reviews', 'review_link']).optional().describe('reviews (default) or review_link.'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts.'),
    location_id: z.string().optional().describe('Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from view=review_link. Prefer account_id.'),
    rating: z.number().int().min(1).max(5).optional().describe('reviews: filter to a 1-5 star rating.'),
    unanswered: z.boolean().optional().describe('reviews: only return reviews without owner replies.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(`reviews: maximum reviews to return in this call (default 200, max ${MAX_LIMIT}). Every returned review is listed in full.`),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('reviews: skip this many reviews before returning results. Use with limit to page through a location with more reviews than one call returns.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_google_business_review_link: z.object({
      workspace_id: z.string().optional(),
      account_id: z.number().int().positive().optional(),
      location_id: z.string().optional(),
    }),
  },

  async execute(client: PosterlyClient, input: ReviewsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_google_business_reviews', input);
    if (mode === 'review_link') return reviewLink(client, args as { workspace_id?: string; account_id?: number; location_id?: string });
    return reviews(client, args as ReviewsInput);
  },
};

async function reviews(client: PosterlyClient, input: ReviewsInput): Promise<string> {
  const result = await client.listGoogleBusinessReviews(input);
  const locations = (result.locations || []) as GoogleBusinessLocationReviewSummary[];
  const offset = result.offset ?? 0;

  if (result.reviews.length === 0) {
    // Distinguish "no reviews exist" from "we couldn't read them": a silent
    // zero used to be indistinguishable from a broken connection.
    const lines = ['No Google Business reviews found matching your filters.'];
    const locationLines = locations.map((location) => formatLocationLine(location));
    if (locationLines.length > 0) {
      lines.push('', 'Locations checked:', ...locationLines);
    }
    return lines.join('\n');
  }

  const header = [`Google Business reviews (showing ${result.reviews.length} of ${result.total} matching`];
  if (offset > 0) header.push(`, from offset ${offset}`);
  if (typeof result.total_review_count === 'number') {
    header.push(`; ${result.total_review_count} total on Google`);
  }
  header.push('):');

  const lines = [header.join('')];

  for (const location of locations) {
    if (location.error) {
      lines.push(`! ${location.business_name || location.name || location.location_id || 'location'}: ${location.error}`);
    }
  }

  lines.push('');

  for (const review of result.reviews) {
    const name = review.reviewer?.displayName || 'Anonymous';
    const rating = review.starRating ? `${review.starRating} stars` : 'unrated';
    const location = review.businessName || review.locationName || review.locationId || 'location';
    const date = formatReviewDate(review);
    const replyComment = reviewReplyComment(review);
    const replied = replyComment ? `reply: ${replyComment}` : (review.reviewReply ? 'replied' : 'unanswered');
    lines.push(`- ${name} (${rating}, ${date}, ${location}, ${replied})`);
    const reviewName = reviewNameFromListItem(review);
    if (reviewName) lines.push(`  review_name: ${reviewName}`);
    if (review.account_id != null && String(review.account_id) !== '') {
      lines.push(`  account_id: ${String(review.account_id)}`);
    }
    if (review.locationId) lines.push(`  location_id: ${review.locationId}`);
    // Full review text, no truncation; collapse whitespace only so the
    // bullet list stays readable for multi-paragraph reviews.
    if (review.comment) {
      lines.push(`  ${review.comment.replace(/\s+/g, ' ').trim()}`);
    }
  }

  if (result.has_more) {
    const nextOffset = offset + result.reviews.length;
    lines.push('', `More reviews available. Call again with offset: ${nextOffset} to continue.`);
  }

  lines.push('', 'Locations:', ...locations.map((location) => formatLocationLine(location)));

  return lines.join('\n');
}

async function reviewLink(
  client: PosterlyClient,
  input: { workspace_id?: string; account_id?: number; location_id?: string },
): Promise<string> {
  const result = await client.getGoogleBusinessReviewLink(input);
  return [
    `Review link for ${result.businessName}:`,
    result.reviewLink,
    `Place ID: ${result.placeId}`,
    `Account ID: ${result.account_id}`,
  ].join('\n');
}

/**
 * When a review was written, plus when it was last edited if that differs.
 * The list is ordered by last activity (updateTime), so showing only the
 * original date would make an edited review look out of order.
 */
function formatReviewDate(review: { createTime?: string; updateTime?: string }): string {
  const created = review.createTime || review.updateTime;
  const createdLabel = formatDate(created);
  if (!review.updateTime || !review.createTime) return createdLabel;

  const updatedLabel = formatDate(review.updateTime);
  if (updatedLabel === createdLabel) return createdLabel;
  return `${createdLabel}, edited ${updatedLabel}`;
}

function formatLocationLine(location: GoogleBusinessLocationReviewSummary): string {
  const label = location.business_name || location.name || location.location_id || `account ${location.id}`;
  const parts: string[] = [];

  if (typeof location.total_review_count === 'number') {
    parts.push(`${location.total_review_count} reviews on Google`);
  } else if (!location.error) {
    parts.push('review count not reported by Google');
  }

  if (typeof location.average_rating === 'number') {
    parts.push(`${location.average_rating.toFixed(1)} avg`);
  }

  parts.push(`${location.fetched_review_count} fetched`);

  if (location.error) parts.push(`ERROR: ${location.error}`);

  return `- ${label} (account_id ${location.id}): ${parts.join(', ')}`;
}
