import { z } from 'zod';
import type { ListPostsParams, PosterlyClient } from '../lib/api-client.js';
import { dashboardUrlForPostList, formatPostCounts, formatPostListPage } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';
import { SUPPORTED_PLATFORM_INPUTS, SUPPORTED_PLATFORM_IDS } from '../generated/platform-manifest.js';

type ListPostsInput = ListPostsParams & {
  view?: 'list' | 'counts';
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
};

export const LIST_POSTS_DESCRIPTION =
  'Posts in your workspaces, teammates\' too, per your role there (brand-locked seats only see their assigned brands). If workspace_id is omitted, this searches every workspace you belong to. ' +
  'view=list (default): posts filtered by status (draft, scheduled, publishing, processing, awaiting_tiktok_publish, awaiting_manual, published, failed, paused, paused_due_to_token, paused_due_to_billing, or missed), platform, account_id, workspace_id, brand_id, group_id, release_id, approval_status, approval_waiting_on, and a scheduled date range: scheduled_from (inclusive) and scheduled_to (a plain date includes that whole day), read in timezone (IANA, default UTC; also the zone times are shown in). status=missed is posts that failed, scheduled posts whose scheduled time is already past, and posts a publishing pause held past their time. group_id matches the caller group (including post_group_id). release_id matches that release only. Returns limit posts (default 20, max 200) starting at offset; with a date range the order defaults to oldest first (order=asc|desc). ' +
  'The output always says whether every matching post was shown. If it says more are available, call again with the offset it gives and keep paging until all are shown before drawing any conclusion about totals, gaps, or how busy a client is. ' +
  'view=counts (scheduled_from and scheduled_to required, up to 366 days): exact totals per day, status, account, and brand for the same filters (limit, offset, and order are ignored); use it for "how many" or "is this month full" questions. ' +
  'Each post includes approval.pending_client_approval.';

export const listPostsTool = {
  name: 'list_posts',
  description: LIST_POSTS_DESCRIPTION,
  inputSchema: z.object({
    view: z
      .enum(['list', 'counts'])
      .optional()
      .describe('list (default): the posts. counts: totals (needs scheduled_from and scheduled_to).'),
    status: z
      .string()
      .optional()
      .describe('Stored post status (draft, scheduled, publishing, processing, awaiting_tiktok_publish, awaiting_manual, published, failed, paused, paused_due_to_token, paused_due_to_billing, or missed). paused_due_to_token is a reconnect pause and paused_due_to_billing is a billing pause. missed: failed, still scheduled after the scheduled time, or held by a publishing pause past it.'),
    group_id: z
      .string()
      .optional()
      .describe('Caller group id. Matches api_group_id, group_id, and post_group_id.'),
    release_id: z
      .string()
      .optional()
      .describe('Caller release id. Matches release_id only.'),
    platform: z
      .enum(SUPPORTED_PLATFORM_INPUTS)
      .optional()
      .describe(`Filter by platform: ${SUPPORTED_PLATFORM_IDS.join(', ')}.`),
    account_id: z
      .string()
      .optional()
      .describe('Filter to a specific social account ID (from list_accounts).'),
    scheduled_from: z
      .string()
      .optional()
      .describe('Start of the scheduled range, inclusive: a date (2026-10-01) or an ISO date-time. Plain dates and times without an offset are read in timezone.'),
    scheduled_to: z
      .string()
      .optional()
      .describe('End of the scheduled range: a plain date (2026-10-31) includes that whole day; an ISO date-time is exclusive.'),
    timezone: z
      .string()
      .optional()
      .describe('IANA time zone such as Europe/London for reading plain dates and showing times. Default UTC.'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('asc (oldest first) or desc (newest first). Default asc with a date range, otherwise desc. Ignored by view=counts.'),
    limit: z
      .number()
      .min(1)
      .max(200)
      .optional()
      .describe('Posts per page (default 20, max 200). Ignored by view=counts.'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Matching posts to skip; use the offset the previous page gives. Ignored by view=counts.'),
    workspace_id: z
      .string()
      .optional()
      .describe('Filter to posts in a specific workspace (get IDs via whoami).'),
    approval_status: z
      .enum(['none', 'pending_client', 'approved', 'changes_requested', 'rejected'])
      .optional()
      .describe('Filter by client review approval status. pending_client means the post is waiting on the client.'),
    approval_waiting_on: z
      .enum(['client', 'team'])
      .optional()
      .describe('client: approval_status pending_client. team: changes_requested or rejected. Conflicts with a non-overlapping approval_status.'),
    brand_id: z
      .string()
      .optional()
      .describe('Filter to posts assigned to a specific brand/client (the id from list_brands).'),
  }),

  async execute(client: PosterlyClient, input: ListPostsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_posts', input);
    const filters = postFilters(args as ListPostsInput);
    const timeZone = filters.timezone || 'UTC';

    if (mode === 'counts') {
      return formatPostCounts(await client.countPosts(filters));
    }

    const hasRange = Boolean(filters.scheduled_from || filters.scheduled_to);
    const page = await client.listPosts({
      ...filters,
      limit: (args as ListPostsInput).limit || 20,
      offset: (args as ListPostsInput).offset,
      order: (args as ListPostsInput).order ?? (hasRange ? 'asc' : undefined),
    });
    return formatPostListPage(page, { timeZone, dashboardUrl: dashboardUrlForPostList(page.posts || []) });
  },
};

function postFilters(input: ListPostsInput): ListPostsParams {
  return {
    status: input.status,
    group_id: input.group_id,
    release_id: input.release_id,
    platform: input.platform,
    account_id: input.account_id,
    workspace_id: input.workspace_id,
    approval_status: input.approval_status,
    approval_waiting_on: input.approval_waiting_on,
    brand_id: input.brand_id,
    scheduled_from: input.scheduled_from,
    scheduled_to: input.scheduled_to,
    timezone: input.timezone,
  };
}
