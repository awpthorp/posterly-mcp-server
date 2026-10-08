import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface ToolCallContext {
  toolName: string;
  toolCallId: string;
}

/**
 * Scopes the current tool name/call id to the async execution of a single
 * tool call, so request() can tag its headers without a mutable "current
 * tool" field on the shared PosterlyClient singleton (index.ts registers one
 * client instance for every tool). AsyncLocalStorage keeps overlapping calls
 * from clobbering each other's context if the stdio transport ever
 * dispatches tool calls concurrently.
 */
const toolCallStorage = new AsyncLocalStorage<ToolCallContext>();

/**
 * Resolves the connected MCP client's name (e.g. "claude-ai", "chatgpt"), set
 * once by index.ts after the server is constructed. A resolver function
 * rather than a static value because the SDK only learns the client's
 * identity once the initialize handshake completes, which happens after this
 * module is first loaded; reading through the resolver on every request
 * always gets the current value instead of whatever was available at import
 * time (undefined).
 */
let clientNameResolver: (() => string | undefined) | null = null;

export function setMcpClientNameResolver(resolver: () => string | undefined): void {
  clientNameResolver = resolver;
}

/**
 * HTTP header values must be printable Latin-1 with no control characters;
 * Node's fetch throws (not returns an error, THROWS) on a header value
 * containing anything else, so an MCP client reporting a non-ASCII name
 * (e.g. "通义灵码") or one with an en/em dash would otherwise break every
 * single tool call. Strips anything outside printable ASCII rather than
 * encoding it, since this is just a display label, not data that needs to
 * round-trip losslessly.
 */
export function sanitizeClientHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 200);
}

export interface Account {
  id: string;
  platform: string;
  username: string;
  account_type?: string;
  profile_picture_url?: string;
  workspace_id?: string | null;
  connection_mode?: 'meta' | 'instagram_direct' | null;
  instagram_tagging?: {
    media_user_tags?: { supported?: boolean };
    collaborators?: { supported?: boolean };
  };
}

export interface Brand {
  id: string;
  name: string;
  workspace_id?: string | null;
  workspace_client_id?: string | null;
  legacy_brand_group_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source: 'canonical' | 'legacy';
  account_count: number;
}

export interface BrandProfile {
  id: string | null;
  brand_group_id: string | null;
  workspace_client_id: string | null;
  brand_name: string;
  tone_of_voice?: string | null;
  audience?: string | null;
  brand_values?: string | null;
  do_donts?: unknown;
  keywords?: unknown;
  competitors?: unknown;
  custom_instructions?: string | null;
  visual_guidelines?: unknown;
  logo_url?: string | null;
  brand_story?: string | null;
  example_posts?: unknown;
  topics_to_cover?: unknown;
  topics_to_avoid?: unknown;
  voice_examples?: unknown;
  last_context_refresh_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source: 'canonical' | 'legacy';
  learned_voice?: LearnedVoice[];
}

export interface LearnedVoice {
  social_account_id: number;
  platform: string;
  username: string | null;
  narrative_summary: string | null;
  summary: string | null;
  traits: string[];
  style_guidelines: string[];
  observations: Record<string, unknown>;
  sample_post_ids: number[];
  post_count: number;
  derived_at: string | null;
}

export interface PerformanceProfile {
  social_account_id: number;
  platform: string;
  username: string | null;
  sample_size: number;
  window_days: number;
  engagement_rate_avg: number | null;
  engagement_rate_trend: 'up' | 'down' | 'flat' | 'unknown';
  bullets: string[];
  narrative_summary: string | null;
  stats: Record<string, unknown>;
  derived_at: string | null;
}

export type PerformanceProfileNullReason =
  | 'insufficient_data'
  | 'feature_not_available'
  | 'platform_not_measurable';

export interface PerformanceProfileResponse {
  performance_profile: PerformanceProfile | null;
  reason: PerformanceProfileNullReason | null;
}

export interface FeedbackInsight {
  id: string;
  post_id: number;
  social_account_id: number;
  username: string | null;
  platform: string;
  checkpoint: '1h' | '6h' | '24h' | '72h' | '7d';
  performance_tier: string;
  action_type: string;
  title: string;
  diagnosis: string;
  next_action: string;
  impact_score: number;
  confidence: number;
  metrics: Record<string, unknown>;
  baseline: Record<string, unknown>;
  caption: string | null;
  permalink: string | null;
  published_at: string | null;
  created_at: string;
}

export interface FeedbackInsightsResponse {
  insights: FeedbackInsight[];
}

export interface PostSuggestion {
  id: string;
  social_account_id: number;
  platform: string;
  account: { id: number; username: string | null; platform: string };
  caption: string;
  rationale: string | null;
  period_key: string | null;
  status: string;
  created_at: string;
}

export interface PostSuggestionsResponse {
  suggestions: PostSuggestion[];
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
}

export interface DismissSuggestionResponse {
  ok: boolean;
  status: string;
}

export type ApiPostApprovalStatus = 'none' | 'pending_client' | 'approved' | 'changes_requested' | 'rejected';

export interface ApiPostApproval {
  status: ApiPostApprovalStatus;
  asset_status: ApiPostApprovalStatus;
  caption_status: ApiPostApprovalStatus;
  waiting_on: 'client' | 'team' | null;
  pending_client_approval: boolean;
  requested_at: string | null;
  completed_at: string | null;
}

export interface Post {
  id: number;
  content: string;
  scheduled_at: string;
  social_account_id: string;
  media_url?: string;
  media_urls?: string[];
  status: string;
  post_type?: string;
  platform_post_url?: string;
  published_at?: string;
  workspace_id?: string | null;
  metadata?: Record<string, unknown> | null;
  reel_cover_url?: string | null;
  reel_cover_method?: string | null;
  reel_thumb_offset?: number | null;
  brand_id?: string | null;
  content_plan_id?: string | null;
  approval?: ApiPostApproval;
}

/** Filters shared by GET /posts and GET /posts/counts. */
export interface ListPostsParams {
  status?: string;
  platform?: string;
  account_id?: string;
  workspace_id?: string;
  approval_status?: string;
  approval_waiting_on?: string;
  brand_id?: string;
  scheduled_from?: string;
  scheduled_to?: string;
  timezone?: string;
}

export interface PostsRangeEcho {
  from: string | null;
  to: string | null;
  timezone: string;
}

export interface ListPostsResponse {
  posts: Post[];
  total: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
  order?: 'asc' | 'desc';
  range?: PostsRangeEcho | null;
}

export interface PostCountsResponse {
  total: number;
  counted: number;
  truncated: boolean;
  range: PostsRangeEcho | null;
  by_day: Array<{ date: string; count: number }>;
  by_status: Array<{ status: string; count: number }>;
  by_account: Array<{ account_id: string | null; platform: string | null; username: string | null; count: number }>;
  by_brand: Array<{ brand_id: string | null; name: string | null; count: number }>;
}

function postFilterParams(params?: ListPostsParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.platform) searchParams.set('platform', params.platform);
  if (params?.account_id) searchParams.set('account_id', params.account_id);
  if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
  if (params?.approval_status) searchParams.set('approval_status', params.approval_status);
  if (params?.approval_waiting_on) searchParams.set('approval_waiting_on', params.approval_waiting_on);
  if (params?.brand_id) searchParams.set('brand_id', params.brand_id);
  if (params?.scheduled_from) searchParams.set('scheduled_from', params.scheduled_from);
  if (params?.scheduled_to) searchParams.set('scheduled_to', params.scheduled_to);
  if (params?.timezone) searchParams.set('timezone', params.timezone);
  return searchParams;
}

export interface InstagramPostSettings {
  __type?: 'instagram' | 'instagram-standalone';
  post_type?: 'post' | 'feed' | 'story' | 'reel' | 'carousel';
  is_trial_reel?: boolean;
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';
  collaborators?: Array<string | { label?: string; username?: string; handle?: string }>;
  user_tags?: Array<string | { username?: string; label?: string; handle?: string }>;
  first_comment?: string;
  media_alt_texts?: Record<string, string>;
  media_accessibility?: Array<{ index: number; asset_id?: string; source_url?: string; alt_text: string }>;
  reel_cover_url?: string;
  reel_thumb_offset?: number;
  is_ai_generated?: boolean;
  audio_id?: string;
  caption_addon?: {
    type?: 'none' | 'poll' | 'comment_prompt';
    kind?: 'none' | 'poll' | 'comment_prompt';
    options?: string[];
    extended_duration?: boolean;
  } | null;
  poll_attachment?: {
    option_a?: string;
    option_b?: string;
    option_c?: string;
    option_d?: string;
    options?: string[];
  };
  is_comment_prompt_used?: boolean;
  is_poll_duration_extended?: boolean;
}

export type PlatformPostSettings = Record<string, unknown>;

export type CreatePostPayload = {
  account_id?: string;
  username?: string;
  platform?: string;
  caption: string;
  scheduled_at?: string;
  post_type?: string;
  media_url?: string;
  media_urls?: string[];
  metadata?: Record<string, unknown>;
  settings?: PlatformPostSettings;
  reel_cover_url?: string;
  reel_cover_method?: string;
  reel_thumb_offset?: number;
  workspace_id?: string;
};

export type CreatePostResponse = {
  post: Post;
  workspace: { id: string; name: string; is_personal: boolean; resolved_from: 'explicit' | 'account' | 'personal' };
  warnings?: Array<{ code: string; message: string }>;
};

export type ValidatePostResponse = {
  dry_run: true;
  valid: true;
  normalized: {
    account_id: number;
    platform: string;
    post_type: string;
    scheduled_at: string;
    workspace_id: string | null;
  };
  warnings: Array<{ code: string; message: string }>;
  would_create: { status: string };
};

export type AgentFeedbackPayload = {
  source: 'mcp' | 'cli' | 'rest' | 'skill';
  tool: string;
  outcome: 'success' | 'error' | 'abandoned';
  error_code?: string;
  client?: string;
  comment?: string;
  context?: {
    request_id?: string;
    http_status?: number;
    latency_ms?: number;
    attempt?: number;
  };
};

export type AgentFeedbackResponse = {
  accepted: true;
  feedback_id: string;
  request_id: string;
};

export type ProductFeedbackPayload = {
  category: 'bug' | 'idea' | 'feedback';
  title: string;
  description?: string;
  client?: string;
  confirm: true;
  source?: 'mcp' | 'cli' | 'rest' | 'skill';
  context?: {
    request_id?: string;
    related_tool?: string;
  };
};

export type ProductFeedbackResponse = {
  accepted: true;
  feedback_id: number;
  board_url: string;
  request_id: string;
};

export type BatchCreatePostsResponse = {
  posts: Array<CreatePostResponse & { index: number; replayed: boolean }>;
  errors: Array<{ index: number; status: number; error: string; validation_errors?: unknown }>;
  total: number;
  created: number;
  replayed: number;
  failed: number;
};

export type CaptionPlatform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'twitter'
  | 'threads'
  | 'linkedin'
  | 'youtube'
  | 'pinterest'
  | 'google_business';

export type GenerateCaptionsPayload = {
  platforms: CaptionPlatform[];
  brief?: string;
  tone?: string;
  allow_emojis?: boolean;
  hashtag_strategy?: 'none' | 'smart' | 'minimal' | 'aggressive';
  count?: number;
  mode?: 'generate' | 'adapt';
  source_caption?: string;
  source_platform?: CaptionPlatform;
  preserve_links?: boolean;
  preserve_mentions?: boolean;
  preserve_call_to_action?: boolean;
  social_account_id?: string;
  workspace_id?: string;
  manual_brand_voice?: {
    summary: string;
    traits?: string[];
    style_guidelines?: string[];
  };
};

export type GenerateCaptionsResponse = {
  success: boolean;
  suggestions: Record<string, string[]>;
  workspace_id?: string | null;
  social_account_id?: number | null;
  usage?: Record<string, unknown>;
};

export type AskSupportPayload = {
  question: string;
  workspace_id?: string;
  conversation_id?: string;
  page_url?: string;
  post_id?: number;
  referenced_post_ids?: number[];
  request_human?: boolean;
  confirm_escalation?: boolean;
};

export type ApiKeyScope =
  | 'accounts:read'
  | 'accounts:write'
  | 'posts:read'
  | 'posts:write'
  | 'media:write'
  | 'analytics:read'
  | 'billing:read'
  | 'billing:write';

export type WorkspaceMemberRole = 'publisher' | 'editor' | 'viewer';

export type WorkspaceMemberSummary = {
  id: string;
  user_id: string | null;
  email: string | null;
  name: string | null;
  role: string | null;
  status: string | null;
  /** [] = every brand; missing = not visible to a brand-limited caller. */
  brand_ids?: string[];
  /** Can this teammate use the workspace's API and AI app access. Always true for the owner. */
  api_access?: boolean;
  /** Owners and admins only: live keys and AI app connections for this workspace. */
  api_usage?: { key_count: number; last_used_at: string | null; connected_apps: string[] };
  joined_at: string | null;
  created_at: string | null;
};

export type WorkspaceInviteSummary = {
  id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  brand_ids?: string[];
  expires_at: string | null;
  created_at: string | null;
};

export type WorkspaceMembersResponse = {
  workspace_id: string;
  members: WorkspaceMemberSummary[];
  invites: WorkspaceInviteSummary[];
  usage: { active_members: number; pending_invites: number; seats_used: number };
};

export type WorkspaceMemberPreview = {
  action: string;
  summary: string;
  email: string | null;
  role: string | null;
  previous_role: string | null;
  brand_ids: string[] | null;
  previous_brand_ids: string[] | null;
  sends_email: boolean;
  counts_toward_seats: boolean;
  seats_used: number | null;
  seat_limit: number | null;
  /** action=set_api_access only. */
  api_access?: boolean;
  previous_api_access?: boolean | null;
};

export type WorkspaceMemberChangeResponse = {
  requires_confirmation?: boolean;
  preview?: WorkspaceMemberPreview;
  preview_id?: string;
  preview_expires_at?: string;
  status?: string;
  message?: string;
  invite?: WorkspaceInviteSummary;
  member?: WorkspaceMemberSummary;
  email_sent?: boolean;
  owner_notified?: boolean;
};

export type WorkspaceMemberConfirmFields = {
  confirm?: boolean;
  preview_id?: string;
};

export type PublishingPauseState = {
  workspace: { id: string; name: string | null; paused: boolean; paused_at: string | null };
  brands: Array<{ id: string; name: string | null; paused: boolean; paused_at: string }>;
  viewer: {
    role: string;
    can_pause_workspace: boolean;
    can_pause_brand: boolean;
    can_resume: boolean;
    can_publish_missed: boolean;
  };
};

/**
 * POST /publishing-pause. A pause without confirm: true changes nothing and
 * answers 400 confirmation_required with a preview; the client returns that
 * body (requires_confirmation: true) instead of throwing, so the tool can show
 * it.
 */
export type PublishingPauseChangeResponse = {
  ok?: boolean;
  requires_confirmation?: boolean;
  code?: string;
  error?: string;
  action?: 'pause' | 'resume';
  scope?: 'workspace' | 'brand';
  workspace_id?: string;
  workspace_name?: string | null;
  brand_id?: string | null;
  brand_name?: string | null;
  already_paused?: boolean;
  scheduled_posts_to_hold?: number | null;
  held_count?: number;
  resumed_count?: number;
  missed_count?: number;
  missed_post_ids?: number[];
  still_held_count?: number;
  disconnected_count?: number;
  failed_post_ids?: number[];
  message?: string;
};

export type PublishMissedResponse = {
  ok: boolean;
  started: number;
  skipped: number;
  message?: string;
};

export type CreateApiKeyPayload = {
  name?: string;
  scopes?: ApiKeyScope[];
  workspace_id?: string;
  expires_in_days?: number;
  confirm: true;
};

export type CreateApiKeyResponse = {
  key: string;
  api_key: {
    id: string;
    name: string;
    key_prefix: string;
    scopes: ApiKeyScope[];
    workspace_id?: string | null;
    expires_at?: string | null;
    created_at: string;
  };
  warning?: string;
  limits?: {
    tier?: string;
    max_user_keys?: number;
    active_user_keys?: number;
    remaining_user_keys?: number;
    uses_grandfathered_keys?: boolean;
  };
};

export type DeleteApiKeyResponse = {
  revoked: true;
  already_revoked: boolean;
  api_key: {
    id: string;
    name: string;
    key_prefix: string;
    scopes: ApiKeyScope[];
    workspace_id?: string | null;
    expires_at?: string | null;
    created_at: string;
    is_revoked?: boolean;
  };
};

export type SubscriptionTierName = 'starter' | 'pro' | 'power_user' | 'agency';

export type SubscriptionSummary = {
  id: string | null;
  status: string | null;
  tier: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  paused_at: string | null;
  pause_resumes_at: string | null;
  stripe_subscription_id: string | null;
};

export type SubscriptionSummaryResponse = {
  subscription: SubscriptionSummary;
};

export type CreditsSummaryResponse = {
  credits: {
    available: number;
    included: { monthly: number; used: number; remaining: number };
    purchased_balance: number;
    plan_tier: string;
    is_trial: boolean;
    period_start: string;
    /** Null while trialing or on a plan with no included pool. */
    resets_at: string | null;
    workspace: { role: string; shared_wallet: boolean };
  };
};

export type CancelSubscriptionPayload = {
  reason: string;
  feedback?: string;
  immediate?: boolean;
};

export type CancelSubscriptionResponse = {
  success: true;
  immediate: boolean;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
};

export type PauseSubscriptionResponse = {
  success: true;
  pause_resumes_at: string;
};

export type ResumeSubscriptionResponse = {
  success: true;
};

export type DowngradeSubscriptionResponse = {
  success: true;
  tier: SubscriptionTierName;
};

export type AskSupportResponse = {
  success: boolean;
  workspace_id: string;
  conversation: {
    id: string;
    status: string;
    title: string | null;
  };
  message: {
    id: string;
    role: string;
    content: string;
    citations?: unknown[];
    created_at: string;
  };
  ticket?: {
    id: string;
    status: string;
    priority: string;
    created: boolean;
  } | null;
  support_access?: Record<string, unknown>;
  confidence?: number;
  docs_confidence?: string;
  needs_human?: boolean;
  escalation_reason?: string | null;
  model?: Record<string, unknown>;
};

export interface Slot {
  time: string;
  local_time: string;
}

export type SuggestedSlotBasis = 'yours' | 'platform' | 'default';

export interface SuggestedSlot extends Slot {
  basis: SuggestedSlotBasis;
  reason: string;
  /** 1-5; confidence-capped by basis (yours up to 5, platform up to 4, default up to 3). */
  stars: number;
  /** Tooltip text for `stars`, distinct from `reason`. */
  star_reason: string;
}

export interface SuggestedTimesWeeklyRating {
  stars: number;
  basis: SuggestedSlotBasis;
  reason: string;
  estimated: boolean;
}

export interface SuggestedSlotsResponse {
  timezone: string;
  basis: SuggestedSlotBasis;
  basis_label: string;
  slots: SuggestedSlot[];
  /** Only present when include=weekly_ratings was passed. */
  weekly_ratings?: SuggestedTimesWeeklyRating[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  timezone?: string | null;
  role?: string;
}

export interface WhoamiOnboarding {
  completed: boolean;
  next_step: string;
  next_step_label: string;
  instruction: string;
}

export interface Whoami {
  user: { id: string; email: string | null };
  api_key: { id: string; scopes: string[] };
  default_workspace: Workspace;
  workspaces: Workspace[];
  onboarding?: WhoamiOnboarding;
}

export interface AccountAnalyticsSummary {
  current_followers: number;
  followers_change: number;
  current_media_count?: number;
  total_reach: number | null;
  total_views: number | null;
  total_profile_views?: number | null;
  total_accounts_engaged: number | null;
  total_follows_gained: number;
  total_follows_lost: number;
  engagement_rate: number;
  engagement_rate_by_followers: number;
  total_website_clicks: number | null;
  total_call_clicks: number | null;
  total_direction_requests: number | null;
  total_conversations: number | null;
  total_bookings: number | null;
  total_watch_minutes?: number | null;
  total_likes?: number | null;
  platform_metrics?: Record<string, number | null | undefined>;
  display_metrics?: Array<{ key?: string; label: string; value: number | null | undefined; unit?: string }>;
}

export interface AccountAnalyticsSnapshot {
  date: string;
  followers: number | null;
  following: number | null;
  media_count: number | null;
  reach: number | null;
  views: number | null;
  profile_views: number | null;
  accounts_engaged: number | null;
  follows_gained: number | null;
  follows_lost: number | null;
  website_clicks: number | null;
  call_clicks: number | null;
  direction_requests: number | null;
  conversations: number | null;
  bookings: number | null;
}

export interface AccountAnalyticsResponse {
  account: { id: number; platform: string; username: string };
  range: { from: string; to: string };
  summary: AccountAnalyticsSummary;
  snapshots: AccountAnalyticsSnapshot[];
}

export interface PostAnalyticsRow {
  id: number | null;
  platform_media_id: string;
  platform: string;
  posted_at: string | null;
  likes: number;
  comments: number;
  impressions: number;
  reach: number;
  saved: number;
  shares: number;
  reposts: number;
  quotes: number;
  plays: number;
  total_interactions: number;
  avg_watch_time_ms?: number | null;
  total_watch_time_ms?: number | null;
  url_link_clicks?: number;
  user_profile_clicks?: number;
  engagements?: number;
  media_type: string | null;
  media_url: string | null;
  permalink: string | null;
  caption_snippet: string | null;
  synced_at: string;
}

export interface PostAnalyticsResponse {
  account: { id: number; platform: string; username: string };
  range: { from: string; to: string };
  posts: PostAnalyticsRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface GoogleBusinessReview {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating: number;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: Record<string, unknown>;
  locationId?: string | null;
  locationName?: string | null;
  businessName?: string | null;
  socialAccountId?: number;
  account_id?: number;
}

export interface GoogleBusinessLocationReviewSummary {
  id: number;
  location_id: string | null;
  name: string | null;
  business_name: string | null;
  workspace_id: string | null;
  /** Google's own review count for this location, or null when Google didn't report one. */
  total_review_count: number | null;
  average_rating: number | null;
  fetched_review_count: number;
  /** Why this location's reviews are missing or incomplete, else null. */
  error: string | null;
}

export interface GoogleBusinessReviewsResponse {
  reviews: GoogleBusinessReview[];
  /** Reviews matching the filters across every page, not just the ones returned. */
  total: number;
  returned?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  /** Reviews fetched from Google before rating/unanswered filters. */
  fetched?: number;
  /** Google's reported review count summed across the selected locations. */
  total_review_count?: number | null;
  locations: Array<GoogleBusinessLocationReviewSummary | Record<string, unknown>>;
}

export interface GoogleBusinessMediaItem {
  name: string;
  mediaFormat: 'PHOTO' | 'VIDEO' | 'MEDIA_FORMAT_UNSPECIFIED';
  category: string | null;
  googleUrl: string | null;
  thumbnailUrl: string | null;
  createTime: string | null;
  widthPixels: number | null;
  heightPixels: number | null;
  attribution: { profileName?: string; profilePhotoUrl?: string; profileUrl?: string } | null;
  account_id?: number;
  location_id?: string | null;
}

export interface GoogleBusinessMediaResponse {
  media: GoogleBusinessMediaItem[];
  total: number;
  locations: Array<Record<string, unknown>>;
}

export interface GoogleBusinessReviewLinkResponse {
  reviewLink: string;
  placeId: string;
  businessName: string;
  locationId: string | null;
  account_id: number;
}

export interface InboxListParams {
  workspace_id?: string;
  account_id?: number | number[];
  platform?: string | string[];
  filter?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface InboxConversationsResponse {
  conversations: Array<Record<string, unknown>>;
  total: number;
  hasMore: boolean;
}

export interface InboxConversationResponse {
  conversation: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
}

export interface InboxCommentsResponse {
  comments: Array<Record<string, unknown>>;
  total: number;
  hasMore: boolean;
}

export interface InboxCommentResponse {
  comment: Record<string, unknown>;
}

export interface InboxSendMessageResponse {
  success: true;
  message_id: string;
}

export interface InboxCommentReplyResponse {
  success: true;
  reply_type: string;
  reply_id: string;
}

export interface InboxSyncResponse {
  success: true;
  results: Record<string, unknown>;
}

export interface ActivityItem {
  id: string;
  type: 'activity' | 'publish';
  post_id: number | null;
  action?: string | null;
  description?: string | null;
  platform?: string | null;
  outcome?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  http_status?: number | null;
  retry_number?: number | null;
  duration_ms?: number | null;
  pipeline_step?: string | null;
  metadata?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  created_at: string;
}

export interface ActivityResponse {
  items: ActivityItem[];
  /** Items on this page (kept for older clients); use has_more to tell whether more exist. */
  total: number;
  limit: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
}

export interface UpdateEntry {
  slug: string;
  title: string;
  date: string;
  version: string;
  summary: string;
  type: string | null;
  areas: string[];
  url: string;
  image?: string;
  video?: string;
  content?: string;
}

export interface UpdatesResponse {
  updates: UpdateEntry[];
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number | null;
}

export interface ApiWebhook {
  id: string;
  workspace_id: string | null;
  url: string;
  description: string | null;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  last_delivery_at: string | null;
  last_delivery_status: number | null;
  last_error: string | null;
}

export interface WebhookResponse {
  webhook: ApiWebhook;
  secret?: string;
}

export interface PlatformSchema {
  id: string;
  aliases: string[];
  label: string;
  status: 'supported' | 'planned';
  summary: string;
  content_limit: number | null;
  media: Record<string, unknown>;
  post_types: string[];
  analytics_supported: boolean;
  settings_schema: {
    fields: Array<Record<string, unknown>>;
    example: Record<string, unknown>;
  };
  helper_tools: Array<Record<string, unknown>>;
  native_features: string[];
}

export interface ConnectOption {
  platform: string;
  aliases: string[];
  label: string;
  status: 'supported' | 'planned';
  method: 'dashboard_oauth' | 'manual_credentials' | 'planned';
  provider_platforms: string[];
  dashboard_url: string;
  connection_url: string | null;
  oauth_url: string | null;
  supports_direct_oauth_url: boolean;
  requires_browser_session: boolean;
  configured: boolean | null;
  env_requirements: Array<Record<string, unknown>>;
  missing_env: string[][];
  scopes: string[];
  credential_fields: Array<Record<string, unknown>>;
  notes: string[];
  connected_count?: number;
  connected_accounts?: Account[];
}

export interface ConnectSession {
  id: string;
  platform: string;
  method: 'dashboard_oauth' | 'manual_credentials';
  status:
    | 'created'
    | 'opened'
    | 'awaiting_provider'
    | 'awaiting_credentials'
    | 'connected'
    | 'failed'
    | 'cancelled'
    | 'expired';
  status_message: string;
  connect_url: string;
  poll_url: string;
  workspace_id?: string | null;
  connected_account_ids: string[];
  connected_accounts: Account[];
  connected_count: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  opened_at?: string | null;
  provider_redirected_at?: string | null;
  completed_at?: string | null;
  expires_at: string;
}

export interface ConnectAccountCredentialsResponse {
  connected: boolean;
  account: {
    id: number;
    platform: string;
    username: string;
    [extra: string]: unknown;
  };
  workspace_id: string;
}

export interface OAuthDeveloperClient {
  id: string;
  client_id: string;
  client_name: string;
  description?: string | null;
  homepage?: string | null;
  allowed_redirect_uris: string[];
  default_scopes: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type PublicSignupTier = 'starter' | 'pro' | 'power_user' | 'agency';

export interface PublicSignupPayload {
  email: string;
  name?: string;
  tier?: PublicSignupTier;
  interval?: 'month';
  api_addon?: boolean;
  return_path?: string;
  source?: string;
  // Set true only after the user has explicitly confirmed, in this
  // conversation, that they accept the posterly terms. Sending it on this
  // first call avoids a separate terms-confirmation round trip.
  tos_accepted?: boolean;
}

export interface PublicSignupAgentPay {
  enabled?: boolean;
  method?: string;
  credential_type?: string;
  amount?: number;
  currency?: string;
  amount_display?: string;
  payment_intent_id?: string;
  client_secret?: string | null;
  publishable_key?: string | null;
  confirm_url?: string;
  poll_url?: string;
  checkout_redirect_url?: string;
  pay_instructions?: string;
  status?: string;
  period?: Record<string, unknown>;
  // True until the user has explicitly accepted the posterly terms. While
  // true, client_secret and publishable_key are withheld.
  requires_tos_acceptance?: boolean;
  [key: string]: unknown;
}

export interface PublicSignupPaymentAgentWalletSpendRequest {
  merchant_name?: string;
  merchant_url?: string;
  amount?: number | null;
  currency?: string;
  context?: string;
}

export interface PublicSignupPaymentAgentWallet {
  supported?: boolean;
  how?: string;
  spend_request?: PublicSignupPaymentAgentWalletSpendRequest;
}

// Always present while checkout is open, regardless of agent_pay/ENABLE_AGENT_CARD_PAY.
// Describes the Stripe-hosted Checkout session itself so an agent with its own
// approved payment credential (for example a Link agent wallet) can pay it
// directly. null once payment is confirmed or checkout has expired.
export interface PublicSignupPayment {
  amount?: number | null;
  currency?: string;
  amount_display?: string | null;
  billing?: string;
  description?: string;
  merchant_name?: string;
  merchant_url?: string;
  checkout_redirect_url?: string;
  pay_with?: string;
  agent_wallet?: PublicSignupPaymentAgentWallet;
  [key: string]: unknown;
}

export interface PublicSignupSession {
  id: string;
  status: string;
  status_message?: string;
  next_action?: {
    actor?: string;
    type?: string;
    label?: string;
    description?: string;
  };
  agent_next_steps?: string[];
  checkout_redirect_url?: string | null;
  checkout?: Record<string, unknown>;
  account?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  agent_pay?: PublicSignupAgentPay | null;
  payment?: PublicSignupPayment | null;
  links?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  expires_at?: string;
  [key: string]: unknown;
}

export interface PublicSignupResponse {
  signup_session?: PublicSignupSession;
  checkout_session_id?: string;
  checkout_url?: string | null;
  checkout_redirect_url?: string | null;
  poll_url?: string | null;
  complete_url?: string | null;
  dashboard_url?: string | null;
  status?: string;
  status_message?: string;
  links?: Record<string, unknown>;
  account?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  agent_pay?: PublicSignupAgentPay | null;
  payment?: PublicSignupPayment | null;
  [key: string]: unknown;
}

export interface PublicSignupSessionResponse {
  signup_session: PublicSignupSession;
}

export interface ImageJob {
  id: string;
  status: string;
  provider: 'google' | 'xai';
  prompt: string;
  model: string;
  resolution: string;
  quality?: string | null;
  thinking_level?: string | null;
  variations: number;
  urls: string[];
  images: Array<{ url: string; filename?: string; path?: string }>;
  error_message?: string | null;
  credit_cost: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface VideoJob {
  id: string;
  status: string;
  provider: 'google' | 'xai';
  prompt: string;
  model: string;
  duration_seconds: number;
  aspect_ratio?: string;
  resolution?: string;
  generation_mode?: string | null;
  credit_cost: number;
  included_credit_cost?: number;
  purchased_credit_cost?: number;
  source_image_url?: string | null;
  end_image_url?: string | null;
  source_video_url?: string | null;
  reference_images?: unknown;
  generate_audio?: boolean | null;
  video_url?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface XPostingQuotaResponse {
  workspace_id: string | null;
  tier: string | null;
  base_posts: number;
  addon_posts: number;
  total_posts: number;
  used_posts: number;
  remaining_posts: number;
  current_period_start: string;
  current_period_end: string;
  urls_blocked: boolean;
  addon?: Record<string, unknown>;
  plans?: Array<Record<string, unknown>>;
}

export class PosterlyClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.POSTERLY_API_KEY || '';
    this.baseUrl = resolvePosterlyBaseUrl(baseUrl);
    if (this.apiKey) {
      validatePosterlyBaseUrlForKeyUse(this.baseUrl);
    }
  }

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Runs `fn` with a fresh per-call tool name/id scoped via AsyncLocalStorage,
   * so any request() calls made inside it (directly or nested) are tagged
   * with X-Posterly-Tool / X-Posterly-Tool-Call. Called once per tool
   * invocation from index.ts's server.tool() handlers.
   */
  async runToolCall<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    return toolCallStorage.run({ toolName, toolCallId: randomUUID() }, fn);
  }

  async probeWhoami(timeoutMs = 2500): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
    durationMs: number;
    whoami?: Whoami;
  }> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      return {
        ok: false,
        error: 'POSTERLY_API_KEY is not configured',
        durationMs: 0,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/whoami`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      const data = parseJson(text);
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: formatProbeError(data, text, res.statusText),
          durationMs: Date.now() - startedAt,
        };
      }
      return {
        ok: true,
        status: res.status,
        durationMs: Date.now() - startedAt,
        whoami: data as Whoami,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.name === 'AbortError'
          ? `timed out after ${timeoutMs}ms`
          : err?.message || String(err),
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireApiKey(): void {
    if (!this.apiKey) {
      throw new Error(
        'posterly access is not installed yet. Use start_signup to begin paid setup, or set POSTERLY_API_KEY after signup.'
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { acceptConfirmationPreview?: boolean },
  ): Promise<T> {
    this.requireApiKey();

    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'X-Posterly-Source': 'mcp_stdio',
    };
    const toolCall = toolCallStorage.getStore();
    if (toolCall) {
      headers['X-Posterly-Tool'] = toolCall.toolName;
      headers['X-Posterly-Tool-Call'] = toolCall.toolCallId;
    }
    const clientName = clientNameResolver?.();
    const clientLabel = clientName ? sanitizeClientHeaderValue(clientName) : '';
    if (clientLabel) {
      headers['X-Posterly-Client'] = clientLabel;
    }

    const init: RequestInit = { method, headers };

    if (body instanceof FormData) {
      init.body = body;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      // A write that needs confirm: true answers 400 with a preview; callers
      // that show previews get the body back instead of an error.
      if (options?.acceptConfirmationPreview && res.status === 400 && err?.requires_confirmation === true) {
        return err as T;
      }
      throw new Error(formatApiError(res, err));
    }

    return res.json() as Promise<T>;
  }

  private async publicRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(formatApiError(res, err));
    }

    return res.json() as Promise<T>;
  }

  async startSignup(data: PublicSignupPayload): Promise<PublicSignupResponse> {
    return this.publicRequest('POST', '/api/v1/signup', data);
  }

  async getSignupSession(sessionId: string): Promise<PublicSignupSessionResponse> {
    return this.publicRequest('GET', `/api/v1/signup/sessions/${encodeURIComponent(sessionId)}`);
  }

  async whoami(): Promise<Whoami> {
    return this.request<Whoami>('GET', '/whoami');
  }

  async createApiKey(data: CreateApiKeyPayload): Promise<CreateApiKeyResponse> {
    return this.request('POST', '/api-keys', data);
  }

  async deleteApiKey(keyId: string, data: { confirm: true }): Promise<DeleteApiKeyResponse> {
    return this.request('DELETE', `/api-keys/${encodeURIComponent(keyId)}`, data);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMembersResponse> {
    return this.request('GET', `/workspaces/${encodeURIComponent(workspaceId)}/members`);
  }

  async inviteWorkspaceMember(
    workspaceId: string,
    data: { email: string; role: WorkspaceMemberRole; brand_ids?: string[]; resend?: boolean } & WorkspaceMemberConfirmFields,
  ): Promise<WorkspaceMemberChangeResponse> {
    return this.request('POST', `/workspaces/${encodeURIComponent(workspaceId)}/members`, data);
  }

  async updateWorkspaceMember(
    workspaceId: string,
    target: { member_id?: string; invite_id?: string },
    data: { role?: WorkspaceMemberRole; brand_ids?: string[]; api_access?: boolean } & WorkspaceMemberConfirmFields,
  ): Promise<WorkspaceMemberChangeResponse> {
    const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
    const path = target.member_id
      ? `${base}/members/${encodeURIComponent(target.member_id)}`
      : `${base}/invites/${encodeURIComponent(target.invite_id || '')}`;
    return this.request('PATCH', path, data);
  }

  async removeWorkspaceMember(
    workspaceId: string,
    target: { member_id?: string; invite_id?: string },
    data: WorkspaceMemberConfirmFields,
  ): Promise<WorkspaceMemberChangeResponse> {
    const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
    const path = target.member_id
      ? `${base}/members/${encodeURIComponent(target.member_id)}`
      : `${base}/invites/${encodeURIComponent(target.invite_id || '')}`;
    const params = new URLSearchParams();
    if (data.confirm === true) params.set('confirm', 'true');
    if (data.preview_id) params.set('preview_id', data.preview_id);
    const qs = params.toString();
    return this.request('DELETE', `${path}${qs ? `?${qs}` : ''}`);
  }

  async getPublishingPause(params?: { workspace_id?: string }): Promise<PublishingPauseState> {
    const query = new URLSearchParams();
    if (params?.workspace_id) query.set('workspace_id', params.workspace_id);
    const qs = query.toString();
    return this.request('GET', `/publishing-pause${qs ? `?${qs}` : ''}`);
  }

  async changePublishingPause(data: {
    action: 'pause' | 'resume';
    brand_id?: string;
    workspace_id?: string;
    confirm?: boolean;
  }): Promise<PublishingPauseChangeResponse> {
    return this.request('POST', '/publishing-pause', data, { acceptConfirmationPreview: true });
  }

  async publishMissedPausedPosts(data: {
    post_ids: number[];
    workspace_id?: string;
    confirm: true;
  }): Promise<PublishMissedResponse> {
    return this.request('POST', '/publishing-pause/publish-missed', data);
  }

  async getSubscription(): Promise<SubscriptionSummaryResponse> {
    return this.request('GET', '/subscription');
  }

  async getCredits(): Promise<CreditsSummaryResponse> {
    return this.request('GET', '/credits');
  }

  async cancelSubscription(data: CancelSubscriptionPayload): Promise<CancelSubscriptionResponse> {
    return this.request('POST', '/subscription/cancel', data);
  }

  async pauseSubscription(): Promise<PauseSubscriptionResponse> {
    return this.request('POST', '/subscription/pause', {});
  }

  async resumeSubscription(): Promise<ResumeSubscriptionResponse> {
    return this.request('POST', '/subscription/resume', {});
  }

  async downgradeSubscription(data: { tier?: SubscriptionTierName }): Promise<DowngradeSubscriptionResponse> {
    return this.request('POST', '/subscription/downgrade', data);
  }

  async listAccounts(params?: { workspace_id?: string }): Promise<Account[]> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const qs = searchParams.toString();
    const data = await this.request<{ accounts: Account[] }>('GET', `/accounts${qs ? `?${qs}` : ''}`);
    return data.accounts;
  }

  async disconnectAccount(accountId: string): Promise<Record<string, any>> {
    return this.request('DELETE', `/accounts/${encodeURIComponent(accountId)}`);
  }

  async getConnectLink(params?: {
    platform?: string;
    workspace_id?: string;
    include_planned?: boolean;
  }): Promise<{ connect?: ConnectOption; connect_options?: ConnectOption[] }> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params?.include_planned) searchParams.set('include_planned', 'true');
    const qs = searchParams.toString();
    const path = params?.platform
      ? `/connect/${encodeURIComponent(params.platform)}`
      : '/connect';
    return this.request('GET', `${path}${qs ? `?${qs}` : ''}`);
  }

  async createConnectSession(data: {
    platform: string;
    workspace_id?: string;
    auto_start?: boolean;
  }): Promise<{ connect_session: ConnectSession; connect?: ConnectOption }> {
    const { platform, ...body } = data;
    return this.request('POST', `/connect/${encodeURIComponent(platform)}/sessions`, body);
  }

  async getConnectSession(sessionId: string): Promise<{ connect_session: ConnectSession }> {
    return this.request('GET', `/connect/sessions/${encodeURIComponent(sessionId)}`);
  }

  async connectAccountCredentials(data: {
    platform: string;
    credentials: Record<string, string>;
    workspace_id?: string;
    connect_session_id?: string;
  }): Promise<ConnectAccountCredentialsResponse> {
    const { platform, credentials, workspace_id, connect_session_id } = data;
    const body: Record<string, unknown> = { credentials };
    if (workspace_id) body.workspace_id = workspace_id;
    if (connect_session_id) body.connect_session_id = connect_session_id;
    return this.request('POST', `/connect/${encodeURIComponent(platform)}/credentials`, body);
  }

  async listOAuthClients(): Promise<{ clients: OAuthDeveloperClient[] }> {
    return this.request('GET', '/oauth/clients');
  }

  async createOAuthClient(data: {
    client_name: string;
    description?: string;
    homepage?: string;
    allowed_redirect_uris: string[];
    default_scopes: string[];
    is_active?: boolean;
  }): Promise<{ client: OAuthDeveloperClient }> {
    return this.request('POST', '/oauth/clients', data);
  }

  async updateOAuthClient(
    clientId: string,
    data: {
      client_name?: string;
      description?: string;
      homepage?: string | null;
      allowed_redirect_uris?: string[];
      default_scopes?: string[];
      is_active?: boolean;
    },
  ): Promise<{ client: OAuthDeveloperClient }> {
    return this.request('PATCH', `/oauth/clients/${encodeURIComponent(clientId)}`, data);
  }

  async deleteOAuthClient(clientId: string): Promise<{ deleted: boolean; client_id: string }> {
    return this.request('DELETE', `/oauth/clients/${encodeURIComponent(clientId)}`);
  }

  async listBrands(params?: { workspace_id?: string }): Promise<Brand[]> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const qs = searchParams.toString();
    const data = await this.request<{ brands: Brand[] }>('GET', `/brands${qs ? `?${qs}` : ''}`);
    return data.brands;
  }

  async getBrand(id: string): Promise<{ brand: Brand }> {
    return this.request('GET', `/brands/${encodeURIComponent(id)}`);
  }

  async listBrandAccounts(id: string): Promise<Account[]> {
    const data = await this.request<{ accounts: Account[] }>('GET', `/brands/${encodeURIComponent(id)}/accounts`);
    return data.accounts;
  }

  async getBrandProfile(id: string): Promise<{ brand_profile: BrandProfile }> {
    return this.request('GET', `/brands/${encodeURIComponent(id)}/profile`);
  }

  async getAccountLearnedVoice(id: string | number): Promise<{ learned_voice: LearnedVoice | null }> {
    return this.request('GET', `/accounts/${encodeURIComponent(String(id))}/learned-voice`);
  }

  async getAccountPerformanceProfile(id: string | number): Promise<PerformanceProfileResponse> {
    return this.request('GET', `/accounts/${encodeURIComponent(String(id))}/performance-profile`);
  }

  async getPostInsights(params?: {
    account_id?: string | number;
    post_id?: number;
    checkpoint?: '1h' | '6h' | '24h' | '72h' | '7d';
    limit?: number;
  }): Promise<FeedbackInsightsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.account_id) searchParams.set('account_id', String(params.account_id));
    if (params?.post_id) searchParams.set('post_id', String(params.post_id));
    if (params?.checkpoint) searchParams.set('checkpoint', params.checkpoint);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request('GET', `/analytics/insights${qs ? `?${qs}` : ''}`);
  }

  async listPostSuggestions(params?: {
    account_id?: string | number;
    status?: 'pending' | 'scheduled' | 'dismissed';
    limit?: number;
    offset?: number;
  }): Promise<PostSuggestionsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.account_id) searchParams.set('account_id', String(params.account_id));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return this.request('GET', `/suggestions${qs ? `?${qs}` : ''}`);
  }

  async dismissSuggestion(id: string): Promise<DismissSuggestionResponse> {
    return this.request('POST', `/suggestions/${encodeURIComponent(id)}/dismiss`, {});
  }

  async listPosts(params?: ListPostsParams & {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  }): Promise<ListPostsResponse> {
    const searchParams = postFilterParams(params);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.order) searchParams.set('order', params.order);

    const qs = searchParams.toString();
    return this.request('GET', `/posts${qs ? `?${qs}` : ''}`);
  }

  /** GET /posts/counts: exact totals per day, status, account, and brand for a scheduled range. */
  async countPosts(params: ListPostsParams): Promise<PostCountsResponse> {
    const qs = postFilterParams(params).toString();
    return this.request('GET', `/posts/counts${qs ? `?${qs}` : ''}`);
  }

  async createPost(data: CreatePostPayload): Promise<CreatePostResponse> {
    return this.request('POST', '/posts', data);
  }

  async validatePost(data: CreatePostPayload): Promise<ValidatePostResponse> {
    return this.request('POST', '/posts', { ...data, dry_run: true });
  }

  async submitAgentFeedback(data: AgentFeedbackPayload): Promise<AgentFeedbackResponse> {
    return this.request('POST', '/agent-feedback', data);
  }

  async submitProductFeedback(data: ProductFeedbackPayload): Promise<ProductFeedbackResponse> {
    return this.request('POST', '/feedback', data);
  }

  async createPostsBatch(data: { posts: CreatePostPayload[] }): Promise<BatchCreatePostsResponse> {
    return this.request('POST', '/posts/batch', data);
  }

  async generateCaptions(data: GenerateCaptionsPayload): Promise<GenerateCaptionsResponse> {
    return this.request('POST', '/ai/generate-captions', data);
  }

  async askSupport(data: AskSupportPayload): Promise<AskSupportResponse> {
    return this.request('POST', '/support/chat', data);
  }

  async getPost(id: number): Promise<{ post: Post }> {
    return this.request('GET', `/posts/${id}`);
  }

  async getPostMissing(id: number): Promise<Record<string, any>> {
    return this.request('GET', `/posts/${id}/missing`);
  }

  async updatePost(
    id: number,
    data: {
      caption?: string;
      scheduled_at?: string;
      media_url?: string;
      media_urls?: string[];
      post_type?: string;
      metadata?: Record<string, unknown>;
      settings?: PlatformPostSettings;
      reel_cover_url?: string | null;
      reel_cover_method?: string | null;
      reel_thumb_offset?: number | null;
    },
  ): Promise<{ post: Post }> {
    return this.request('PATCH', `/posts/${id}`, data);
  }

  async deletePost(
    id: number,
    options?: { confirmPublished?: boolean; deleteMode?: 'posterly' | 'platform' },
  ): Promise<{ deleted: boolean; id: number; platform_delete?: string }> {
    const params = new URLSearchParams();
    if (options?.confirmPublished) params.set('confirm_published', 'true');
    if (options?.deleteMode) params.set('delete_mode', options.deleteMode);
    const qs = params.size ? `?${params}` : '';
    return this.request('DELETE', `/posts/${id}${qs}`);
  }

  async setPostApproval(
    id: number,
    data: {
      action: 'request' | 'approve' | 'request_changes' | 'reject';
      axis?: 'asset' | 'caption';
      note?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.request('POST', `/posts/${id}/approval`, {
      action: data.action,
      ...(data.axis ? { axis: data.axis } : {}),
      ...(data.note ? { note: data.note } : {}),
    });
  }

  async updatePostStatus(
    id: number,
    data: { status: 'scheduled' | 'paused' | 'draft'; scheduled_at?: string },
  ): Promise<Record<string, any>> {
    return this.request('PUT', `/posts/${id}/status`, data);
  }

  async updatePostReleaseId(
    id: number,
    data: { release_id: string; group_id?: string },
  ): Promise<Record<string, any>> {
    return this.request('PUT', `/posts/${id}/release-id`, data);
  }

  async deletePostGroup(groupId: string): Promise<Record<string, any>> {
    return this.request('DELETE', `/posts/group/${encodeURIComponent(groupId)}?confirm=true`);
  }

  async generateImage(data: {
    prompt: string;
    aspect_ratio?: string;
    style?: string;
    variations?: number;
    provider?: 'google' | 'xai';
    model?: 'lite' | 'flash' | 'pro';
    resolution?: '1K' | '2K' | '4K';
    quality?: 'low' | 'medium' | 'high';
    thinking_level?: 'minimal' | 'high';
    reference_image_urls?: string[];
    workspace_id?: string;
  }): Promise<{
    job_id: string;
    status: string;
    message?: string;
    model: string;
    provider: 'google' | 'xai';
    resolution?: string;
    thinking_level?: 'minimal' | 'high' | null;
    credits_used: number;
    usage?: {
      used: number | null;
      limit: number | null;
      period: string | null;
      tier: string | null;
      billed_from: string;
    };
  }> {
    return this.request('POST', '/ai/generate-image', data);
  }

  async getVideoOptions(): Promise<Record<string, any>> {
    return this.request('GET', '/ai/video-options');
  }

  async runVideoFunction(data: {
    identifier: string;
    functionName: string;
    params?: Record<string, unknown>;
  }): Promise<Record<string, any>> {
    return this.request('POST', '/ai/video-function', data);
  }

  async generateVideo(data: {
    provider?: 'google' | 'xai';
    prompt: string;
    negative_prompt?: string;
    aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
    duration_seconds?: number;
    resolution?: '480p' | '720p' | '1080p';
    model?: 'lite' | 'fast' | 'standard';
    image_url?: string;
    end_image_url?: string;
    reference_images?: Array<{ url: string; type: 'character' | 'object' | 'scene' }>;
    generate_audio?: boolean;
    source_video_url?: string;
    workspace_id?: string;
  }): Promise<Record<string, any>> {
    return this.request('POST', '/ai/generate-video', data);
  }

  async getVideoJob(params?: {
    job_id?: string;
    status?: string;
    limit?: number;
  }): Promise<{ job?: VideoJob; jobs?: VideoJob[] }> {
    if (params?.job_id) {
      return this.request('GET', `/ai/video-jobs/${encodeURIComponent(params.job_id)}`);
    }
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request('GET', `/ai/video-jobs${qs ? `?${qs}` : ''}`);
  }

  async getImageJob(params?: {
    job_id?: string;
    status?: string;
    limit?: number;
  }): Promise<{ job?: ImageJob; jobs?: ImageJob[] }> {
    if (params?.job_id) {
      return this.request('GET', `/ai/image-jobs/${encodeURIComponent(params.job_id)}`);
    }
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request('GET', `/ai/image-jobs${qs ? `?${qs}` : ''}`);
  }

  async findAvailableSlots(params?: {
    account_ids?: string[];
    timezone?: string;
    count?: number;
    workspace_id?: string;
  }): Promise<Slot[]> {
    const searchParams = new URLSearchParams();
    if (params?.account_ids?.length) searchParams.set('account_ids', params.account_ids.join(','));
    if (params?.timezone) searchParams.set('timezone', params.timezone);
    if (params?.count) searchParams.set('count', String(params.count));
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);

    const qs = searchParams.toString();
    const data = await this.request<{ slots: Slot[] }>('GET', `/slots/next${qs ? `?${qs}` : ''}`);
    return data.slots;
  }

  /** Best times by engagement for the given accounts (GET /slots/suggested). */
  async findSuggestedSlots(params: {
    account_ids: string[];
    timezone?: string;
    count?: number;
    workspace_id?: string;
  }): Promise<SuggestedSlotsResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('account_ids', params.account_ids.join(','));
    if (params.timezone) searchParams.set('timezone', params.timezone);
    if (params.count) searchParams.set('count', String(params.count));
    if (params.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    return this.request<SuggestedSlotsResponse>('GET', `/slots/suggested?${searchParams.toString()}`);
  }

  async getAccountAnalytics(params: {
    account_id: number;
    from?: string;
    to?: string;
  }): Promise<AccountAnalyticsResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('account_id', String(params.account_id));
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    return this.request('GET', `/analytics/accounts?${searchParams.toString()}`);
  }

  async getPostAnalytics(params: {
    account_id: number;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<PostAnalyticsResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('account_id', String(params.account_id));
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));
    return this.request('GET', `/analytics/posts?${searchParams.toString()}`);
  }

  async listGoogleBusinessReviews(params?: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    rating?: number;
    unanswered?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<GoogleBusinessReviewsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params?.account_id) searchParams.set('account_id', String(params.account_id));
    if (params?.location_id) searchParams.set('location_id', params.location_id);
    if (params?.rating) searchParams.set('rating', String(params.rating));
    if (params?.unanswered) searchParams.set('unanswered', 'true');
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return this.request('GET', `/google-business/reviews${qs ? `?${qs}` : ''}`);
  }

  async getGoogleBusinessReviewLink(params: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
  }): Promise<GoogleBusinessReviewLinkResponse> {
    const searchParams = new URLSearchParams();
    if (params.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params.account_id) searchParams.set('account_id', String(params.account_id));
    if (params.location_id) searchParams.set('location_id', params.location_id);
    return this.request('GET', `/google-business/review-link?${searchParams.toString()}`);
  }

  async auditGoogleBusinessProfile(params: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
  }): Promise<Record<string, any>> {
    const searchParams = new URLSearchParams();
    if (params.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params.account_id) searchParams.set('account_id', String(params.account_id));
    if (params.location_id) searchParams.set('location_id', params.location_id);
    return this.request('GET', `/google-business/audit?${searchParams.toString()}`);
  }

  async suggestGoogleBusinessReviewReply(data: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    review_text?: string;
    star_rating: number;
    reviewer_name?: string;
    business_name?: string;
    tone?: 'professional' | 'friendly' | 'apologetic';
    count?: number;
  }): Promise<Record<string, any>> {
    return this.request('POST', '/google-business/reviews/suggest-reply', data);
  }

  async replyGoogleBusinessReview(data: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    review_name: string;
    comment: string;
  }): Promise<Record<string, any>> {
    return this.request('POST', '/google-business/reviews/reply', data);
  }

  async deleteGoogleBusinessReviewReply(data: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    review_name: string;
  }): Promise<Record<string, any>> {
    return this.request('DELETE', '/google-business/reviews/reply', data);
  }

  async listGoogleBusinessMedia(params?: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
  }): Promise<GoogleBusinessMediaResponse> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params?.account_id) searchParams.set('account_id', String(params.account_id));
    if (params?.location_id) searchParams.set('location_id', params.location_id);
    const qs = searchParams.toString();
    return this.request('GET', `/google-business/media${qs ? `?${qs}` : ''}`);
  }

  async addGoogleBusinessMedia(data: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    source_url: string;
    category: string;
    media_format?: 'PHOTO' | 'VIDEO';
  }): Promise<Record<string, any>> {
    return this.request('POST', '/google-business/media', data);
  }

  async deleteGoogleBusinessMedia(data: {
    workspace_id?: string;
    account_id?: number;
    location_id?: string;
    media_name: string;
  }): Promise<Record<string, any>> {
    return this.request('DELETE', '/google-business/media', data);
  }

  async listActivity(params?: {
    workspace_id?: string;
    post_id?: number;
    since?: string;
    type?: 'all' | 'activity' | 'publish';
    limit?: number;
    offset?: number;
  }): Promise<ActivityResponse> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params?.post_id) searchParams.set('post_id', String(params.post_id));
    if (params?.since) searchParams.set('since', params.since);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return this.request('GET', `/activity${qs ? `?${qs}` : ''}`);
  }

  async getUpdates(params?: {
    limit?: number;
    offset?: number;
    since?: string;
    include_content?: boolean;
  }): Promise<UpdatesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.since) searchParams.set('since', params.since);
    if (params?.include_content) searchParams.set('include_content', 'true');
    const qs = searchParams.toString();
    return this.request('GET', `/updates${qs ? `?${qs}` : ''}`);
  }

  async listWebhooks(params?: { workspace_id?: string }): Promise<{ webhooks: ApiWebhook[] }> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const qs = searchParams.toString();
    return this.request('GET', `/webhooks${qs ? `?${qs}` : ''}`);
  }

  async createWebhook(data: {
    url: string;
    events?: string[];
    workspace_id?: string;
    description?: string;
    is_active?: boolean;
  }): Promise<WebhookResponse> {
    return this.request('POST', '/webhooks', data);
  }

  async updateWebhook(
    id: string,
    data: {
      url?: string;
      events?: string[];
      workspace_id?: string | null;
      description?: string | null;
      is_active?: boolean;
    },
  ): Promise<WebhookResponse> {
    return this.request('PATCH', `/webhooks/${encodeURIComponent(id)}`, data);
  }

  async deleteWebhook(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.request('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }

  async testWebhook(id: string): Promise<{ delivery: Record<string, unknown> }> {
    return this.request('POST', `/webhooks/${encodeURIComponent(id)}/test`, {});
  }

  async listPlatforms(params?: { include_planned?: boolean }): Promise<{ platforms: PlatformSchema[] }> {
    const searchParams = new URLSearchParams();
    if (params?.include_planned) searchParams.set('include_planned', 'true');
    const qs = searchParams.toString();
    return this.request('GET', `/platforms${qs ? `?${qs}` : ''}`);
  }

  async getPlatformSchema(params: {
    account_id?: string;
    platform?: string;
    include_planned?: boolean;
  }): Promise<{ account?: Record<string, unknown>; schema?: PlatformSchema; platform?: PlatformSchema; platforms?: PlatformSchema[] }> {
    if (params.account_id) {
      return this.request('GET', `/accounts/${encodeURIComponent(params.account_id)}/schema`);
    }
    const searchParams = new URLSearchParams();
    if (params.platform) searchParams.set('platform', params.platform);
    if (params.include_planned) searchParams.set('include_planned', 'true');
    return this.request('GET', `/platforms?${searchParams.toString()}`);
  }

  async triggerPlatformHelper(data: {
    helper: string;
    account_id?: string;
    platform?: string;
    params?: Record<string, unknown>;
  }): Promise<{ helper: string; account: Record<string, unknown> | null; result: unknown }> {
    return this.request('POST', '/platforms/trigger', data);
  }

  async getXPostingQuota(params?: { workspace_id?: string }): Promise<XPostingQuotaResponse> {
    const searchParams = new URLSearchParams();
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const qs = searchParams.toString();
    return this.request('GET', `/x-posting/quota${qs ? `?${qs}` : ''}`);
  }

  async getSignedUploadUrl(
    filename: string,
    contentType: string,
    size: number,
    workspaceId?: string,
  ): Promise<{
    upload_url: string;
    token: string;
    path: string;
    public_url: string;
    headers?: Record<string, string>;
  }> {
    return this.request('POST', '/media/signed-upload', {
      filename,
      content_type: contentType,
      size,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    });
  }

  async createMediaDrop(input?: {
    filename?: string;
    maxFiles?: number;
    workspaceId?: string;
  }): Promise<{
    session_id: string;
    drop_url: string;
    expires_at: string;
    max_bytes: number;
    max_files: number;
    instructions: string;
  }> {
    return this.request('POST', '/media/drop-sessions', {
      filename: input?.filename,
      max_files: input?.maxFiles,
      ...(input?.workspaceId ? { workspace_id: input.workspaceId } : {}),
    });
  }

  async listMedia(params?: {
    limit?: number;
    offset?: number;
    dropSessionId?: string;
  }): Promise<{
    media: Array<{
      id: string;
      public_url: string;
      filename: string;
      path: string;
      mime: string | null;
      bytes: number | null;
      created_at: string;
      drop_session_id: string | null;
    }>;
    total: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
    next_offset?: number | null;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.dropSessionId) searchParams.set('drop_session_id', params.dropSessionId);
    const qs = searchParams.toString();
    return this.request('GET', `/media${qs ? `?${qs}` : ''}`);
  }

  async uploadMedia(input: {
    filePath?: string;
    base64Data?: string;
    filename: string;
    contentType?: string;
    workspaceId?: string;
  }): Promise<{ url: string; path: string }> {
    this.requireApiKey();

    let fileBuffer: Buffer;

    if (input.filePath) {
      fileBuffer = await readFile(resolve(input.filePath));
    } else if (input.base64Data) {
      fileBuffer = Buffer.from(input.base64Data, 'base64');
    } else {
      throw new Error('Provide filePath or base64Data');
    }

    const contentType =
      input.contentType ||
      guessContentType(input.filename);

    const SIZE_THRESHOLD = 3 * 1024 * 1024; // 3MB

    if (fileBuffer.length > SIZE_THRESHOLD) {
      // Large file: PUT to the object-storage signed URL (not a Vercel relay).
      const signed = await this.getSignedUploadUrl(
        input.filename,
        contentType,
        fileBuffer.length,
        input.workspaceId,
      );

      const uploadRes = await fetch(signed.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          ...(signed.headers || {}),
        },
        body: new Uint8Array(fileBuffer),
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => uploadRes.statusText);
        throw new Error(`Direct upload failed: ${errText}`);
      }

      return { url: signed.public_url, path: signed.path };
    }

    // Small file: use existing base64 flow through Vercel
    const data = fileBuffer.toString('base64');

    return this.request('POST', '/media/upload', {
      filename: input.filename,
      data,
      content_type: contentType,
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    });
  }

  async uploadMediaFromUrl(input: {
    url: string;
    filename?: string;
    contentType?: string;
    workspaceId?: string;
  }): Promise<{ url: string; path: string; source_url: string; content_type: string; size: number }> {
    return this.request('POST', '/media/upload-from-url', {
      url: input.url,
      filename: input.filename,
      content_type: input.contentType,
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
    });
  }

  private appendInboxListParams(searchParams: URLSearchParams, params?: InboxListParams) {
    if (params?.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const accountIds = params?.account_id == null ? [] : Array.isArray(params.account_id) ? params.account_id : [params.account_id];
    for (const accountId of accountIds) searchParams.append('account_id', String(accountId));
    const platforms = params?.platform == null ? [] : Array.isArray(params.platform) ? params.platform : [params.platform];
    for (const platform of platforms) searchParams.append('platform', platform);
    if (params?.filter) searchParams.set('filter', params.filter);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset != null) searchParams.set('offset', String(params.offset));
  }

  async listConversations(params?: InboxListParams): Promise<InboxConversationsResponse> {
    const searchParams = new URLSearchParams();
    this.appendInboxListParams(searchParams, params);
    const qs = searchParams.toString();
    return this.request('GET', `/inbox/conversations${qs ? `?${qs}` : ''}`);
  }

  async getConversation(params: {
    conversation_id: string;
    workspace_id?: string;
    limit?: number;
  }): Promise<InboxConversationResponse> {
    const searchParams = new URLSearchParams();
    if (params.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    if (params.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request(
      'GET',
      `/inbox/conversations/${encodeURIComponent(params.conversation_id)}${qs ? `?${qs}` : ''}`,
    );
  }

  async sendMessage(data: {
    conversation_id: string;
    content: string;
    workspace_id?: string;
  }): Promise<InboxSendMessageResponse> {
    const body: Record<string, unknown> = { content: data.content };
    if (data.workspace_id) body.workspace_id = data.workspace_id;
    return this.request('POST', `/inbox/conversations/${encodeURIComponent(data.conversation_id)}/reply`, body);
  }

  async listComments(params?: InboxListParams): Promise<InboxCommentsResponse> {
    const searchParams = new URLSearchParams();
    this.appendInboxListParams(searchParams, params);
    const qs = searchParams.toString();
    return this.request('GET', `/inbox/comments${qs ? `?${qs}` : ''}`);
  }

  async getComment(params: {
    comment_id: string;
    workspace_id?: string;
  }): Promise<InboxCommentResponse> {
    const searchParams = new URLSearchParams();
    if (params.workspace_id) searchParams.set('workspace_id', params.workspace_id);
    const qs = searchParams.toString();
    return this.request(
      'GET',
      `/inbox/comments/${encodeURIComponent(params.comment_id)}${qs ? `?${qs}` : ''}`,
    );
  }

  async replyToComment(data: {
    comment_id: string;
    content: string;
    type?: 'public' | 'private';
    workspace_id?: string;
  }): Promise<InboxCommentReplyResponse> {
    const body: Record<string, unknown> = { content: data.content };
    if (data.type) body.type = data.type;
    if (data.workspace_id) body.workspace_id = data.workspace_id;
    return this.request('POST', `/inbox/comments/${encodeURIComponent(data.comment_id)}/reply`, body);
  }

  async updateComment(data: {
    comment_id: string;
    is_hidden?: boolean;
    is_read?: boolean;
    workspace_id?: string;
  }): Promise<InboxCommentResponse> {
    const body: Record<string, unknown> = {};
    if (typeof data.is_hidden === 'boolean') body.is_hidden = data.is_hidden;
    if (typeof data.is_read === 'boolean') body.is_read = data.is_read;
    if (data.workspace_id) body.workspace_id = data.workspace_id;
    return this.request('PATCH', `/inbox/comments/${encodeURIComponent(data.comment_id)}`, body);
  }

  async deleteComment(id: string, workspaceId?: string): Promise<{ success: true }> {
    const searchParams = new URLSearchParams();
    if (workspaceId) searchParams.set('workspace_id', workspaceId);
    const qs = searchParams.toString();
    return this.request('DELETE', `/inbox/comments/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
  }

  async syncInbox(data: {
    account_id: number;
    sync_type?: 'all' | 'dm' | 'comments';
    workspace_id?: string;
  }): Promise<InboxSyncResponse> {
    return this.request('POST', '/inbox/sync', data);
  }
}

export function resolvePosterlyBaseUrl(baseUrl?: string): string {
  const configured = (
    baseUrl ||
    process.env.POSTERLY_URL ||
    process.env.POSTERLY_API_BASE_URL ||
    'https://www.poster.ly'
  ).trim();

  try {
    const url = new URL(configured);
    url.pathname = url.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return configured.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  }
}

const TRUSTED_POSTERLY_HOSTS = new Set(['poster.ly', 'www.poster.ly']);

type PosterlyBaseUrlInspection = {
  valid: boolean;
  secure: boolean;
  protocol?: string;
  host?: string;
  trustedPosterlyHost: boolean;
  localDevelopmentHost: boolean;
  warnings: string[];
  message: string;
};

function flagEnabled(name: string): boolean {
  const value = (process.env[name] || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLocalHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  );
}

export function inspectPosterlyBaseUrl(baseUrl: string): PosterlyBaseUrlInspection {
  try {
    const url = new URL(baseUrl);
    const hostname = normalizeHostname(url.hostname);
    const local = isLocalHost(hostname);
    const trustedPosterlyHost = TRUSTED_POSTERLY_HOSTS.has(hostname);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && local);
    const warnings: string[] = [];

    if (!trustedPosterlyHost) {
      warnings.push(local ? 'local_development_host' : 'custom_host');
    }
    if (!secure) {
      warnings.push('insecure_non_local_url');
    }

    return {
      valid: true,
      secure,
      protocol: url.protocol.replace(/:$/, ''),
      host: url.host,
      trustedPosterlyHost,
      localDevelopmentHost: local,
      warnings,
      message: secure
        ? 'Base URL is secure for API-key requests.'
        : 'Non-local HTTP URLs are blocked for API-key requests.',
    };
  } catch {
    return {
      valid: false,
      secure: false,
      trustedPosterlyHost: false,
      localDevelopmentHost: false,
      warnings: ['invalid_url'],
      message: 'Base URL must include a scheme and host, for example https://www.poster.ly.',
    };
  }
}

export function validatePosterlyBaseUrlForKeyUse(baseUrl: string): void {
  const check = inspectPosterlyBaseUrl(baseUrl);
  if (!check.valid) {
    throw new Error(`${check.message} Received: ${baseUrl}`);
  }

  if (!check.secure && !flagEnabled('POSTERLY_ALLOW_INSECURE_URL')) {
    throw new Error(
      `Refusing to send an API key to ${baseUrl}. Use https, http://localhost for local development, or set POSTERLY_ALLOW_INSECURE_URL=true only for a trusted private development endpoint.`
    );
  }

  if (
    !check.trustedPosterlyHost &&
    !check.localDevelopmentHost &&
    !flagEnabled('POSTERLY_ALLOW_CUSTOM_BASE_URL')
  ) {
    throw new Error(
      `Refusing to send an API key to custom host ${baseUrl}. Set POSTERLY_ALLOW_CUSTOM_BASE_URL=true only for a trusted posterly deployment.`
    );
  }
}

function parseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function formatProbeError(data: any, fallback: string, statusText: string): string {
  if (data && typeof data === 'object') {
    return data.error || data.message || data.code || statusText || 'API request failed';
  }
  return fallback || statusText || 'API request failed';
}

function formatApiError(res: Response, data: any): string {
  const message = data?.error || data?.message || `API error: ${res.status}`;
  if (res.status !== 429) {
    return message;
  }

  const retryAfter = data?.retry_after || res.headers.get('retry-after');
  const requestId = data?.request_id || res.headers.get('x-request-id');
  const limit = data?.limit || res.headers.get('x-ratelimit-limit');
  const reset = data?.reset || res.headers.get('x-ratelimit-reset');

  return [
    'Rate limit reached.',
    retryAfter ? `Try again in ${retryAfter} seconds.` : '',
    limit ? `Limit: ${limit}.` : '',
    reset ? `Reset: ${reset}.` : '',
    requestId ? `Request ID: ${requestId}.` : '',
    message && message !== 'Rate limit exceeded' ? `Details: ${message}` : '',
  ].filter(Boolean).join(' ');
}

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
  };
  return map[ext || ''] || 'application/octet-stream';
}
