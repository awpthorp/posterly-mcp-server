import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { code, dashboardUrlForPost, formatDateTime, groupReleaseIds, mdKeyValue, mdQuote, mdSection, mdTitle, platformPostIdText, platformText, postFailureText, statusLabel } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const mediaAccessibilitySchema = z.array(z.object({
  index: z.number().int().nonnegative(),
  asset_id: z.string().optional(),
  source_url: z.string().url().optional(),
  alt_text: z.string(),
})).describe('Preferred ordered media alt text. Identity follows index/asset_id through platform media preparation; media_alt_texts remains the legacy URL-map form.');

const instagramSettingsSchema = z.object({
  __type: z.enum(['instagram', 'instagram-standalone']).optional(),
  post_type: z.enum(['post', 'feed', 'story', 'reel', 'carousel']).optional(),
  is_trial_reel: z.boolean().optional(),
  graduation_strategy: z.enum(['MANUAL', 'SS_PERFORMANCE']).optional(),
  collaborators: z
    .array(z.union([z.string(), z.object({ label: z.string().optional(), username: z.string().optional(), handle: z.string().optional() })]))
    .max(3)
    .optional()
    .describe('Native Instagram co-author invitations. Meta-linked accounts only; feed images, Reels, and carousels; not Stories.'),
  user_tags: z
    .array(z.union([z.string(), z.object({ username: z.string().optional(), label: z.string().optional(), handle: z.string().optional() })]))
    .optional()
    .describe('Native clickable media tags, not caption @mentions. Supported by eligible direct Instagram and Meta-linked connections; feed images, Reels/video, and Stories. Tags apply to each carousel item and the first Story in a Story Series.'),
  first_comment: z.string().optional(),
  media_alt_texts: z.record(z.string(), z.string()).optional(),
  media_accessibility: mediaAccessibilitySchema.optional(),
  reel_cover_url: z.string().optional(),
  reel_cover_method: z.string().optional(),
  reel_thumb_offset: z.number().nonnegative().optional(),
  is_ai_generated: z.boolean().optional().describe('Label the parent Instagram media container as AI-generated. For carousels, set on the parent only.'),
  audio_id: z.string().optional().describe('Licensed Instagram audio ID for Reels. Meta-linked Facebook Login accounts only.'),
  caption_addon: z.union([
    z.object({
      type: z.enum(['none', 'poll', 'comment_prompt']).optional(),
      kind: z.enum(['none', 'poll', 'comment_prompt']).optional(),
      options: z.array(z.string()).max(4).optional(),
      extended_duration: z.boolean().optional(),
      poll_attachment: z.object({
        option_a: z.string().optional(),
        option_b: z.string().optional(),
        option_c: z.string().optional(),
        option_d: z.string().optional(),
        options: z.array(z.string()).max(4).optional(),
      }).optional(),
    }),
    z.null(),
  ]).optional().describe('Optional Instagram caption add-on. type is none, poll, or comment_prompt. A poll needs 2 to 4 options of 1 to 25 characters (an emoji counts as one) and the caption is the question. A comment prompt uses the caption as the prompt. Facebook Login only. Not available on Stories. At most one add-on per post. Pass null or type none to clear it.'),
  poll_attachment: z.object({
    option_a: z.string().optional(),
    option_b: z.string().optional(),
    option_c: z.string().optional(),
    option_d: z.string().optional(),
    options: z.array(z.string()).max(4).optional(),
  }).optional().describe('Instagram poll choices. option_a and option_b are required, option_c and option_d are optional, and option_d requires option_c. Mutually exclusive with a comment prompt. The caption is the question. Serialised JSON must be 200 characters or fewer.'),
  is_comment_prompt_used: z.boolean().optional().describe('Set true to attach an Instagram comment prompt. The caption is the prompt. Mutually exclusive with a poll. Facebook Login only. Not available on Stories.'),
  is_poll_duration_extended: z.boolean().optional().describe('Set true only together with a poll, to request the longer Instagram poll duration.'),
});

const platformSettingsSchema = z.object({
  __type: z.string().optional(),
  post_type: z.string().optional(),
  content_type: z.string().optional(),
  media_alt_texts: z.record(z.string(), z.string()).optional(),
  media_accessibility: mediaAccessibilitySchema.optional(),
  reel_cover_url: z.string().optional(),
  reel_cover_method: z.string().optional(),
  reel_thumb_offset: z.number().nonnegative().optional(),
  reply_settings: z.enum(['everyone', 'following', 'mentionedUsers', 'subscribers', 'verified']).optional(),
  poll: z.object({ options: z.array(z.string()), duration_minutes: z.number().positive().optional(), question: z.string().optional(), duration: z.enum(['ONE_DAY', 'THREE_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS']).optional(), allows_multiple_answers: z.boolean().optional() }).optional(),
  article: z.object({ title: z.string(), cover: z.enum(['first_image', 'none']).optional() }).nullable().optional(),
  reply_control: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only', 'followers_only', 'parent_post_author_only']).optional(),
  topic_tag: z.string().optional(),
  share_to_instagram: z.boolean().optional(), // Threads: also share the published post to the linked Instagram account as a Story
  text_attachment: z.record(z.string(), z.unknown()).optional(),
  is_ghost_post: z.boolean().optional(),
  is_spoiler: z.boolean().optional(),
  is_spoiler_media: z.boolean().optional(),
  enable_reply_approvals: z.boolean().optional(),
  text_entities: z.array(z.record(z.string(), z.unknown())).optional(),
  gif_attachment: z.object({
    gif_id: z.string(),
    provider: z.enum(['GIPHY']).optional(),
  }).optional(),
  text_format_preset_id: z.string().optional(),
  document_title: z.string().optional(),
  document_filename: z.string().optional(),
  mentions: z.array(z.record(z.string(), z.unknown())).optional(),
  thumbnail_url: z.string().optional(),
  thumbnail_method: z.string().optional(),
  content_call_to_action_label: z.enum(['APPLY', 'DOWNLOAD', 'VIEW_QUOTE', 'LEARN_MORE', 'SIGN_UP', 'SUBSCRIBE', 'REGISTER', 'JOIN', 'ATTEND', 'REQUEST_DEMO', 'SEE_MORE', 'BUY_NOW', 'SHOP_NOW']).optional(),
  content_landing_page: z.string().optional(),
  privacy_level: z.string().optional(),
  allow_comment: z.boolean().optional(),
  allow_duet: z.boolean().optional(),
  allow_stitch: z.boolean().optional(),
  title: z.string().optional(),
  video_cover_timestamp_ms: z.number().nonnegative().optional(), // TikTok: millisecond timestamp of the video frame to use as the cover (direct post only)
  is_commercial_content: z.boolean().optional(),
  is_your_brand: z.boolean().optional(),
  is_branded_content: z.boolean().optional(),
  privacy_status: z.enum(['public', 'unlisted', 'private']).optional(),
  made_for_kids: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  category_id: z.string().optional(),
  playlist_id: z.string().optional(),
  board_id: z.string().optional(),
  link: z.string().optional(),
  cover_image_url: z.string().optional(),
  video_cover_url: z.string().optional(),
  cover_image_method: z.enum(['upload', 'frame', 'api']).optional(),
  product_tags: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  event: z.record(z.string(), z.unknown()).optional(),
  offer: z.record(z.string(), z.unknown()).optional(),
  cta: z.record(z.string(), z.unknown()).optional(),
  recurrence: z.record(z.string(), z.unknown()).optional(),
  notify_subscribers: z.boolean().optional(),
  add_shorts_hashtag: z.boolean().optional(),
  brand_partner: z.string().optional(),
  buttons: z.array(z.object({ text: z.string(), url: z.string() })).optional(),
  start_timestamp: z.number().nonnegative().optional(),
  is_live_photo: z.boolean().optional(),
  langs: z.array(z.string()).optional(),
  content_label: z.enum(['sexual', 'nudity', 'porn', 'graphic-media']).optional(),
  quote_url: z.string().optional(),
  disable_quotes: z.boolean().optional(),
  quoted_status_id: z.string().optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  spoiler_text: z.string().optional(),
  markdown: z.boolean().optional(),
  blocks: z.array(z.record(z.string(), z.unknown())).optional(),
  paid_partnership: z.boolean().optional(),
  is_ai_generated: z.boolean().optional(),
  audio_id: z.string().optional(),
  caption_addon: z.union([
    z.object({
      type: z.enum(['none', 'poll', 'comment_prompt']).optional(),
      options: z.array(z.string()).max(4).optional(),
      extended_duration: z.boolean().optional(),
    }),
    z.null(),
  ]).optional(),
  poll_attachment: z.record(z.string(), z.unknown()).optional(),
  is_comment_prompt_used: z.boolean().optional(),
  is_poll_duration_extended: z.boolean().optional(),
  ai_generated: z.boolean().optional(),
}).passthrough();

type EditInput = {
  post_id: number;
  caption?: string;
  scheduled_at?: string;
  media_url?: string;
  media_urls?: string[];
  post_type?: string;
  account_id?: string;
  thread_posts?: string[];
  instagram_settings?: z.infer<typeof instagramSettingsSchema>;
  platform_settings?: z.infer<typeof platformSettingsSchema>;
  confirm: true;
};

type UpdatePostInput = EditInput & {
  status?: 'scheduled' | 'paused' | 'draft';
  release_id?: string;
  group_id?: string;
  approval_action?: 'request' | 'approve' | 'request_changes' | 'reject';
  approval_axis?: 'asset' | 'caption';
  approval_note?: string;
};

export const updatePostTool = {
  name: 'update_post',
  description:
    'Change a scheduled or draft post. DESTRUCTIVE WRITE. Edit (default): caption, media, schedule, post_type, settings, account_id, or thread_posts; overwrites the existing post; cannot edit published or currently publishing posts. account_id moves the post to another account you can use in the same workspace and on the same brand, and the platform follows that account. thread_posts replaces an X or Threads reply chain with at least two non-empty parts, and the first part becomes the caption. If a client has already approved the post, a caption edit reopens caption approval, a media or thumbnail edit reopens asset approval, and a reschedule, account change, thread edit, or settings change reopens both. status (scheduled, paused, or draft, with scheduled_at when scheduling a draft): pause, resume, or move back to draft; send it on its own. release_id (with optional group_id): set or repair external release/group IDs; send it on its own. approval_action (request, approve, request_changes, or reject): change client approval. Only a workspace owner or admin may do this. The actor is the API key user, never a brand guest. request emails the brand reviewers. approve, request_changes, and reject are team-side decisions. request_changes needs approval_note. Optional approval_axis is asset or caption; omit it for both. Send approval_action on its own.\n\n' +
    'REQUIRED BEFORE CALLING: Show the user a side-by-side of the CURRENT post (caption, scheduled time, media, status) and the PROPOSED change, and get explicit confirmation ("yes update it", "apply those changes") before calling. Do not auto-edit posts based on a general instruction - each change needs its own confirmation.',
  inputSchema: z.object({
    post_id: z.number().describe('The post ID to update'),
    caption: z.string().optional().describe('New caption/text content'),
    scheduled_at: z
      .string()
      .optional()
      .describe('New scheduled time (ISO 8601, e.g. 2026-03-10T09:00:00Z)'),
    media_url: z.string().optional().describe('New media URL. Posterly storage URLs are used as-is; third-party URLs are copied into posterly storage first. Short-lived signed URLs must still be live when this tool runs.'),
    media_urls: z.array(z.string()).optional().describe('New media URLs for carousel, handled like media_url.'),
    post_type: z
      .string()
      .optional()
      .describe('New post type: text, image, video, carousel, reel, story, story_series, document, photo, or cover_photo'),
    account_id: z
      .string()
      .optional()
      .describe('Move this unpublished post to another account you can use in the same workspace. The account must belong to the post brand. The platform follows the new account.'),
    thread_posts: z
      .array(z.string())
      .min(2)
      .optional()
      .describe('Replace an X or Threads reply chain. At least 2 non-empty parts. The first part becomes the caption.'),
    // Reel cover controls are also accepted top-level, matching the hosted
    // endpoint. An agent reading the hosted schema will reach for these names,
    // and scripts/check-mcp-schema-parity.ts enforces that both surfaces agree.
    reel_cover_url: z.string().optional().describe('Cover image URL for a reel.'),
    reel_cover_method: z.string().optional().describe('How the reel cover is chosen, e.g. an uploaded image or a frame offset.'),
    reel_thumb_offset: z.number().nonnegative().optional().describe('Frame offset in milliseconds to use as the reel cover.'),
    instagram_settings: instagramSettingsSchema
      .optional()
      .describe('Instagram-specific updates. Distinguish caption @mentions, native media user_tags, and collaborators. Native media tags work with eligible direct or Meta-linked accounts; collaborators require an eligible Meta-linked account. Call list_platforms with view=schema and account_id first.'),
    platform_settings: platformSettingsSchema
      .optional()
      .describe('Platform-specific settings to merge into the post. Prefer this over raw metadata.'),
    status: z
      .enum(['scheduled', 'paused', 'draft'])
      .optional()
      .describe('Change the post status instead of editing it. Send with post_id (and scheduled_at when scheduling a draft) only.'),
    release_id: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Set an external release ID instead of editing the post. Send with post_id and optional group_id only.'),
    group_id: z.string().min(1).max(160).optional().describe('With release_id only: an external group/campaign ID.'),
    approval_action: z
      .enum(['request', 'approve', 'request_changes', 'reject'])
      .optional()
      .describe('Change client approval instead of editing the post. Send on its own.'),
    approval_axis: z
      .enum(['asset', 'caption'])
      .optional()
      .describe('With approval_action approve, request_changes, or reject: which axis to decide. Omit for both. Not allowed with request.'),
    approval_note: z
      .string()
      .optional()
      .describe('Note stored with the approval change. Required for request_changes.'),
    confirm: z.literal(true).describe('Must be true after explicit user confirmation of the proposed change.'),
  }),

  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    update_post_status: z.object({
      post_id: z.number(),
      status: z.enum(['scheduled', 'paused', 'draft']),
      scheduled_at: z.string().optional(),
      confirm: z.boolean(),
    }),
    update_post_release_id: z.object({
      post_id: z.number().int().positive(),
      release_id: z.string().min(1).max(160),
      group_id: z.string().min(1).max(160).optional(),
      confirm: z.literal(true),
    }),
  },

  async execute(client: PosterlyClient, input: UpdatePostInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'update_post', input);
    if (mode === 'status') return updateStatus(client, args as { post_id: number; status: 'scheduled' | 'paused' | 'draft'; scheduled_at?: string; confirm: boolean });
    if (mode === 'release_id') return updateReleaseId(client, args as { post_id: number; release_id: string; group_id?: string; confirm: true });
    if (mode === 'approval') {
      return updateApproval(client, args as {
        post_id: number;
        approval_action: 'request' | 'approve' | 'request_changes' | 'reject';
        approval_axis?: 'asset' | 'caption';
        approval_note?: string;
        confirm: true;
      });
    }
    return editPost(client, args as EditInput);
  },
};

async function editPost(client: PosterlyClient, input: EditInput): Promise<string> {
  if (input.confirm !== true) {
    throw new Error('Refusing to update post without confirm=true after explicit user confirmation.');
  }
  const { post_id, confirm: _confirm, preview_id: _previewId, instagram_settings, platform_settings, ...updates } = input as EditInput & { preview_id?: string };
  const payload = {
    ...updates,
    ...(platform_settings || instagram_settings
      ? { settings: { ...(instagram_settings ? { __type: 'instagram', ...instagram_settings } : {}), ...(platform_settings || {}) } }
      : {}),
  };
  const result = await client.updatePost(post_id, payload);
  const p = result.post as Record<string, any>;
  const platform = platformText(p.platform);
  const accountId = p.social_account_id ?? p.account_id;
  const failure = postFailureText(p);
  const platformPostId = platformPostIdText(p);
  const groups = groupReleaseIds(p);

  return [
    mdTitle(`✅ Post ${code(p.id)} updated`),
    mdKeyValue([
      ['Status', statusLabel(p.status)],
      ...(platform ? [['Platform', platform] as [string, string]] : []),
      ...(accountId != null && accountId !== '' ? [['Account ID', String(accountId)] as [string, string]] : []),
      ...(p.workspace_id ? [['Workspace', String(p.workspace_id)] as [string, string]] : []),
      ['Scheduled', formatDateTime(p.scheduled_at)],
      ['Type', p.post_type || 'unknown'],
      ...(failure ? [['Failure', failure] as [string, string]] : []),
      ...(platformPostId ? [['Platform post ID', platformPostId] as [string, string]] : []),
      ...(groups.length ? [['Group', groups.join(', ')] as [string, string]] : []),
      ['View in posterly', dashboardUrlForPost({ id: p.id, scheduled_at: p.scheduled_at })],
      ...(p.reel_cover_url ? [['Reel cover', p.reel_cover_url] as [string, string]] : []),
      ...(p.thumbnail_url ? [['Thumbnail', p.thumbnail_url] as [string, string]] : []),
      ...(p.youtube_thumbnail_url ? [['YouTube thumbnail', p.youtube_thumbnail_url] as [string, string]] : []),
    ]),
    mdSection('Caption', p.content ? mdQuote(p.content) : '_(empty)_'),
  ].join('\n\n');
}

async function updateStatus(
  client: PosterlyClient,
  input: { post_id: number; status: 'scheduled' | 'paused' | 'draft'; scheduled_at?: string; confirm: boolean },
): Promise<string> {
  if (input.confirm !== true) {
    throw new Error('Refusing to update post status without confirm=true after explicit user confirmation.');
  }

  const result = await client.updatePostStatus(input.post_id, {
    status: input.status,
    scheduled_at: input.scheduled_at,
  });
  const transition = result.transition || {};
  return `Post #${input.post_id} status changed from ${transition.old_status || 'unknown'} to ${transition.new_status || input.status}.`;
}

async function updateApproval(
  client: PosterlyClient,
  input: {
    post_id: number;
    approval_action: 'request' | 'approve' | 'request_changes' | 'reject';
    approval_axis?: 'asset' | 'caption';
    approval_note?: string;
    confirm: true;
  },
): Promise<string> {
  if (input.confirm !== true) {
    throw new Error('Refusing to change client approval without confirm=true after explicit user confirmation. Only a workspace owner or admin can do this, and the actor is the API key user, never a brand guest.');
  }
  const result = await client.setPostApproval(input.post_id, {
    action: input.approval_action,
    axis: input.approval_axis,
    note: input.approval_note,
  });
  return JSON.stringify(result, null, 2);
}

async function updateReleaseId(
  client: PosterlyClient,
  input: { post_id: number; release_id: string; group_id?: string; confirm: true },
): Promise<string> {
  const result = await client.updatePostReleaseId(input.post_id, {
    release_id: input.release_id,
    group_id: input.group_id,
  });
  return JSON.stringify(result, null, 2);
}
