import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, mdKeyValue, mdQuote, mdSection } from '../lib/format.js';
import { reviewNameFromListItem, reviewReplyComment } from '../lib/google-business-review-name.js';
import { omitKeys, previewThenConfirm, readForPreview, validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const LOCATION_ID_DESCRIPTION = 'Google Business numeric location id (the location_id/platform_user_id from list_accounts, e.g. "197940849675145390"). NOT the ChIJ... Place ID from list_google_business_reviews view=review_link. Prefer account_id.';
const LEGACY_LOCATION = {
  workspace_id: z.string().optional(),
  account_id: z.number().int().positive().optional(),
  location_id: z.string().optional(),
};

type ManageReviewInput = {
  action: 'suggest_reply' | 'reply' | 'delete_reply';
  workspace_id?: string;
  account_id?: number;
  location_id?: string;
  review_name?: string;
  comment?: string;
  review_text?: string;
  star_rating?: number;
  reviewer_name?: string;
  business_name?: string;
  tone?: 'professional' | 'friendly' | 'apologetic';
  count?: number;
  confirm?: boolean;
  preview_id?: string;
};

/** Everything the review endpoints accept, without the selector and confirm fields. */
function payloadOf(input: ManageReviewInput): Record<string, any> {
  return omitKeys(input, ['action', 'confirm', 'preview_id']);
}

async function lookupReview(client: PosterlyClient, call: ManageReviewInput): Promise<any | null> {
  const read = await readForPreview(() => client.listGoogleBusinessReviews({
    workspace_id: call.workspace_id,
    account_id: call.account_id,
    location_id: call.location_id,
    limit: 200,
  }));
  if (!read.ok || !Array.isArray(read.data?.reviews)) return null;
  const wanted = String(call.review_name || '');
  return read.data.reviews.find((review: any) => reviewNameFromListItem(review) === wanted || review?.name === wanted) || null;
}

function reviewPreviewRows(call: ManageReviewInput, review: any | null): Array<[string, string | undefined]> {
  if (!review) return [['Review', code(String(call.review_name))], ...locationRows(call)];
  const existing = reviewReplyComment(review);
  return [
    ['Reviewer', review.reviewer?.displayName || 'Anonymous'],
    ['Rating', review.starRating ? `${review.starRating} stars` : 'unrated'],
    ['Review', review.comment ? String(review.comment).replace(/\s+/g, ' ').trim() : '(rating only)'],
    ['Existing reply', existing || (review.reviewReply ? 'replied' : 'none')],
    ['Review', code(String(call.review_name))],
    ...locationRows(call),
  ];
}

function locationRows(input: ManageReviewInput): Array<[string, string | undefined]> {
  return [
    ['Account ID', input.account_id !== undefined ? code(input.account_id) : undefined],
    ['Location ID', input.location_id ? code(input.location_id) : undefined],
    ['Workspace', input.workspace_id ? code(input.workspace_id) : undefined],
  ];
}

export const manageGoogleBusinessReviewTool = {
  name: 'manage_google_business_review',
  description:
    'Act on Google Business Profile reviews. action=suggest_reply (star_rating, optional review_text): short, brand-aware AI reply suggestions; uses the AI Caption Assist allowance and never posts. action=reply (review_name, comment): post or update the owner reply. action=delete_reply (review_name): delete the owner reply. reply and delete_reply use preview then confirm: call without confirm to get a preview and preview_id (it repeats the review name, location, and exact reply text; show the reviewer, rating, and review text alongside it), then call again with confirm=true and that preview_id.',
  inputSchema: z.object({
    action: z.enum(['suggest_reply', 'reply', 'delete_reply']).describe('suggest_reply, reply, or delete_reply.'),
    workspace_id: z.string().optional().describe('Filter to a workspace ID from whoami.'),
    account_id: z.number().int().positive().optional().describe('Google Business account ID from list_accounts (optional brand voice context for suggest_reply).'),
    location_id: z.string().optional().describe(LOCATION_ID_DESCRIPTION),
    review_name: z.string().min(1).optional().describe('reply and delete_reply: review_name from list_google_business_reviews.'),
    comment: z.string().min(1).max(4096).optional().describe('reply: exact owner reply text to post.'),
    review_text: z.string().optional().describe('suggest_reply: review text. Leave empty for rating-only reviews.'),
    star_rating: z.number().min(1).max(5).optional().describe('suggest_reply: review rating from 1 to 5.'),
    reviewer_name: z.string().optional(),
    business_name: z.string().optional(),
    tone: z.enum(['professional', 'friendly', 'apologetic']).optional(),
    count: z.number().int().min(1).max(5).optional(),
    confirm: z.boolean().optional().describe('reply and delete_reply: leave out to get a preview; true only with the preview_id after the user approved it.'),
    preview_id: z.string().optional().describe('reply and delete_reply: the preview_id from the preview call. Required with confirm: true.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    suggest_google_business_review_reply: z.object({
      ...LEGACY_LOCATION,
      review_text: z.string().optional(),
      star_rating: z.number().min(1).max(5),
      reviewer_name: z.string().optional(),
      business_name: z.string().optional(),
      tone: z.enum(['professional', 'friendly', 'apologetic']).optional(),
      count: z.number().int().min(1).max(5).optional(),
    }),
    reply_google_business_review: z.object({
      ...LEGACY_LOCATION,
      review_name: z.string().min(1),
      comment: z.string().min(1).max(4096),
      confirm: z.literal(true),
    }),
    delete_google_business_review_reply: z.object({
      ...LEGACY_LOCATION,
      review_name: z.string().min(1),
      confirm: z.literal(true),
    }),
  },

  async execute(client: PosterlyClient, input: ManageReviewInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'manage_google_business_review', input);
    const call = args as ManageReviewInput;
    if (mode === 'suggest_reply') return suggestReply(client, call as ManageReviewInput & { star_rating: number });
    if (mode === 'delete_reply') {
      return previewThenConfirm({
        tool: 'manage_google_business_review',
        action: 'delete_reply',
        args,
        nonce: false,
        legacyRefusal: 'Refusing to delete a Google review reply without confirm=true after explicit user confirmation.',
        ctx,
        describe: async () => [
          mdSection('Review', mdKeyValue(reviewPreviewRows(call, await lookupReview(client, call)))),
          'This deletes the owner reply from this review on Google. The review itself stays.',
        ].join('\n\n'),
        run: async () => {
          const result = await client.deleteGoogleBusinessReviewReply(payloadOf(call) as { review_name: string });
          return result.message || 'Google Business review reply deleted successfully.';
        },
      });
    }
    return previewThenConfirm({
      tool: 'manage_google_business_review',
      action: 'reply',
      args,
      nonce: true,
      legacyRefusal: 'Refusing to post a Google review reply without confirm=true after explicit user confirmation.',
      ctx,
      describe: async () => [
        mdSection('Review', mdKeyValue(reviewPreviewRows(call, await lookupReview(client, call)))),
        mdSection('Owner reply to post', mdQuote(String(call.comment ?? ''))),
        'This posts publicly on Google as the business owner and replaces any existing owner reply on this review.',
      ].join('\n\n'),
      run: async () => {
        const result = await client.replyGoogleBusinessReview(payloadOf(call) as { review_name: string; comment: string });
        return result.message || 'Google Business review reply posted successfully.';
      },
    });
  },
};

async function suggestReply(client: PosterlyClient, input: ManageReviewInput & { star_rating: number }): Promise<string> {
  const result = await client.suggestGoogleBusinessReviewReply(payloadOf(input) as { star_rating: number });
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
  if (suggestions.length === 0) {
    return 'No reply suggestions were generated.';
  }
  return [
    `Suggested replies (${result.tone || 'professional'}, ${result.rating || input.star_rating} stars):`,
    ...suggestions.map((text: string, index: number) => `${index + 1}. ${text}`),
  ].join('\n');
}
