/**
 * The Google review resource name that reply and delete-reply accept:
 * accounts/{account}/locations/{location}/reviews/{review}.
 *
 * List responses from Google put this on `name`. The public API also copies it
 * to `review_name` so a list row can be passed straight to a reply. Both MCP
 * formatters read it from here so the hosted endpoint and the npm package
 * agree.
 */

/**
 * A path segment is rejected when it is empty, a dot segment, or carries a
 * character that could change what URL the name resolves to (?, #, %).
 */
function isSafePathSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false;
  return !/[?#%]/.test(segment);
}

export function isGoogleBusinessReviewResourceName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('/');
  if (parts.length !== 6) return false;
  if (parts[0] !== 'accounts' || parts[2] !== 'locations' || parts[4] !== 'reviews') return false;
  return isSafePathSegment(parts[1]) && isSafePathSegment(parts[3]) && isSafePathSegment(parts[5]);
}

/**
 * locations/{id} from a location_name that may be "locations/{id}",
 * "accounts/{a}/locations/{id}", or either with trailing slashes.
 */
export function googleBusinessLocationResourceName(locationName: string): string | null {
  const trimmed = locationName.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const id = trimmed.split('/').filter(Boolean).pop();
  if (!id || !isSafePathSegment(id)) return null;
  return `locations/${id}`;
}

/**
 * Canonical review_name for one Google review.
 * Prefers a resource name already on the review. Otherwise builds one from
 * the location's account/location metadata and the review id.
 */
export function googleBusinessReviewResourceName(params: {
  name?: unknown;
  review_name?: unknown;
  reviewId?: unknown;
  accountName?: string | null;
  locationName?: string | null;
}): string | null {
  for (const candidate of [params.review_name, params.name]) {
    if (isGoogleBusinessReviewResourceName(candidate)) return candidate.trim();
  }

  const reviewId = typeof params.reviewId === 'string' ? params.reviewId.trim() : '';
  if (!reviewId || reviewId.includes('/')) return null;

  const accountName = (params.accountName || '').trim().replace(/\/+$/, '');
  if (!/^accounts\/[^/]+$/.test(accountName)) return null;

  const locationName = googleBusinessLocationResourceName(params.locationName || '');
  if (!locationName) return null;

  const built = `${accountName}/${locationName}/reviews/${reviewId}`;
  return isGoogleBusinessReviewResourceName(built) ? built : null;
}

/** Owner reply text, when Google sent one. Whitespace is collapsed for a single cell. */
export function reviewReplyComment(review: { reviewReply?: unknown } | null | undefined): string | null {
  const reply = review?.reviewReply;
  const raw = typeof reply === 'string'
    ? reply
    : reply && typeof reply === 'object'
      ? (reply as { comment?: unknown; text?: unknown }).comment || (reply as { text?: unknown }).text
      : '';
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** review_name a formatted list row can show, from the fields a list response carries. */
export function reviewNameFromListItem(
  review: { review_name?: unknown; name?: unknown } | null | undefined,
): string | null {
  if (!review || typeof review !== 'object') return null;
  return googleBusinessReviewResourceName({
    review_name: review.review_name,
    name: review.name,
  });
}
