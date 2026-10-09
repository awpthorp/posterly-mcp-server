import { z } from 'zod';
import type { PosterlyClient, Account } from '../lib/api-client.js';
import { dashboardUrlForPost, formatLocalDateTime } from '../lib/format.js';
import { SUPPORTED_PLATFORM_INPUTS, SUPPORTED_PLATFORM_IDS } from '../generated/platform-manifest.js';

const mediaAccessibilitySchema = z.array(z.object({
  index: z.number().int().nonnegative(),
  asset_id: z.string().optional(),
  source_url: z.string().url().optional(),
  alt_text: z.string(),
})).describe('Preferred ordered media alt text. Identity follows index/asset_id through platform media preparation; media_alt_texts remains the legacy URL-map form.');

export const instagramSettingsSchema = z.object({
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

export const platformSettingsSchema = z.object({
  __type: z.string().optional(),
  post_type: z.string().optional(),
  content_type: z.string().optional(),
  media_alt_texts: z.record(z.string(), z.string()).optional(),
  media_accessibility: mediaAccessibilitySchema.optional(),
  reel_cover_url: z.string().optional(),
  reel_thumb_offset: z.number().nonnegative().optional(),
  // X
  reply_settings: z.enum(['everyone', 'following', 'mentionedUsers', 'subscribers', 'verified']).optional(),
  poll: z.object({
    options: z.array(z.string()),
    duration_minutes: z.number().positive().optional(), // X poll length in minutes
    question: z.string().optional(), // LinkedIn/Telegram poll question (required for those)
    duration: z.enum(['ONE_DAY', 'THREE_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS']).optional(), // LinkedIn poll length
    allows_multiple_answers: z.boolean().optional(), // Telegram poll: allow multiple selections
  }).optional(),
  article: z.object({
    title: z.string(), // X Article title (required)
    cover: z.enum(['first_image', 'none']).optional(), // Use the first attached image as the cover (default) or none
  }).nullable().optional(), // X Article (needs X Premium): the caption is the Markdown body. null turns Article mode off
  // Threads
  reply_control: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only', 'followers_only', 'parent_post_author_only']).optional(),
  topic_tag: z.string().optional(), // Threads single discovery topic tag
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
  // Facebook
  text_format_preset_id: z.string().optional(),
  // LinkedIn
  document_title: z.string().optional(),
  document_filename: z.string().optional(),
  mentions: z.array(z.record(z.string(), z.unknown())).optional(),
  thumbnail_url: z.string().optional(),
  thumbnail_method: z.string().optional(),
  content_call_to_action_label: z.enum(['APPLY', 'DOWNLOAD', 'VIEW_QUOTE', 'LEARN_MORE', 'SIGN_UP', 'SUBSCRIBE', 'REGISTER', 'JOIN', 'ATTEND', 'REQUEST_DEMO', 'SEE_MORE', 'BUY_NOW', 'SHOP_NOW']).optional(),
  content_landing_page: z.string().optional(),
  // TikTok
  privacy_level: z.string().optional(),
  allow_comment: z.boolean().optional(),
  allow_duet: z.boolean().optional(),
  allow_stitch: z.boolean().optional(),
  title: z.string().optional(),
  media_type: z.string().optional(), // TikTok: 'PHOTO' forces a photo slideshow; image media is auto-detected when omitted
  video_cover_timestamp_ms: z.number().nonnegative().optional(), // TikTok: millisecond timestamp of the video frame to use as the cover (direct post only)
  is_commercial_content: z.boolean().optional(),
  is_your_brand: z.boolean().optional(),
  is_branded_content: z.boolean().optional(),
  // YouTube
  privacy_status: z.enum(['public', 'unlisted', 'private']).optional(),
  made_for_kids: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  category_id: z.string().optional(),
  playlist_id: z.string().optional(),
  // Pinterest
  board_id: z.string().optional(),
  link: z.string().optional(),
  cover_image_url: z.string().optional(),
  video_cover_url: z.string().optional(),
  cover_image_method: z.enum(['upload', 'frame', 'api']).optional(),
  product_tags: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
  // Google Business
  event: z.record(z.string(), z.unknown()).optional(),
  offer: z.record(z.string(), z.unknown()).optional(),
  cta: z.record(z.string(), z.unknown()).optional(),
  recurrence: z.record(z.string(), z.unknown()).optional(),
  // YouTube
  notify_subscribers: z.boolean().optional(),
  add_shorts_hashtag: z.boolean().optional(),
  brand_partner: z.string().optional(),
  // Telegram
  buttons: z.array(z.object({ text: z.string(), url: z.string() })).optional(),
  start_timestamp: z.number().nonnegative().optional(),
  is_live_photo: z.boolean().optional(),
  // Bluesky
  langs: z.array(z.string()).optional(),
  content_label: z.enum(['sexual', 'nudity', 'porn', 'graphic-media']).optional(), // Bluesky content warning
  quote_url: z.string().optional(), // Bluesky post URL/AT-URI to quote
  disable_quotes: z.boolean().optional(), // Bluesky: prevent quote-posts of this post
  quoted_status_id: z.string().optional(), // Mastodon quote
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  spoiler_text: z.string().optional(),
  markdown: z.boolean().optional(), // Slack Block Kit markdown
  blocks: z.array(z.record(z.string(), z.unknown())).optional(), // Slack Block Kit
  paid_partnership: z.boolean().optional(), // X paid partnership
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
  // tags (z.array of strings) also serve as Bluesky hidden discovery tags
  // AI-content disclosure (TikTok is_aigc, X made_with_ai, YouTube containsSyntheticMedia, Pinterest ai_disclosures)
  ai_generated: z.boolean().optional(),
}).passthrough();

export const createPostPayloadInputSchema = z.object({
  account_id: z.string().optional().describe('Social account ID (from list_accounts)'),
  username: z.string().optional().describe('Account username (alternative to account_id)'),
  platform: z
    .enum(SUPPORTED_PLATFORM_INPUTS)
    .optional()
    .describe(`Platform name (required with username). Supported: ${SUPPORTED_PLATFORM_IDS.join(', ')}. Aliases such as x, gmb, and instagram-standalone are accepted.`),
  caption: z.string().optional().describe('The post caption/text content. On Instagram, @username creates a caption mention only; it is not a native media tag or collaborator invitation. Ignored when `thread_posts` is provided.'),
  scheduled_at: z
    .string()
    .optional()
    .describe('ISO 8601 datetime for scheduling (e.g. 2026-03-05T09:00:00Z). Omit for immediate publish.'),
  media_url: z.string().optional().describe('Media URL to attach. Posterly storage URLs are used as-is; third-party HTTP(S) URLs are copied into posterly storage before the post is saved. Short-lived signed URLs must still be live when this tool runs. For threads, attaches to the lead post only.'),
  media_urls: z
    .array(z.string())
    .optional()
    .describe('Multiple media URLs for carousel or multi-image posts. Posterly storage URLs are used as-is; third-party HTTP(S) URLs are copied into posterly storage before the post is saved. For TikTok, 2 or more images auto-create a photo slideshow (up to 35 images) and every image is posted.'),
  post_type: z
    .string()
    .optional()
    .describe('Optional post type: text, image, video, carousel, reel, story, story_series, document, photo, cover_photo, x_thread, or threads_thread. Omit it for auto-detection from media. For TikTok photo posts, use photo/image/carousel or omit it; for Facebook cover photos, use cover_photo or platform_settings.post_type.'),
  thread_posts: z
    .array(z.string())
    .optional()
    .describe('For X or Threads only: array of 2+ strings, one per post in the thread. The first entry leads, the rest reply in order. When set, the platform must be twitter or threads.'),
  instagram_settings: instagramSettingsSchema
    .optional()
      .describe('Instagram-specific settings. If “tag” is ambiguous, distinguish caption @mentions (put @username in caption), native media tags (user_tags), and co-author invitations (collaborators). Native media tags work with eligible direct or Meta-linked accounts; collaborators require an eligible Meta-linked account. Call list_platforms with view=schema and account_id first.'),
  platform_settings: platformSettingsSchema
    .optional()
    .describe('Platform-specific settings for the selected account. Use this for non-Instagram settings and prefer it over raw metadata.'),
  workspace_id: z
    .string()
    .optional()
    .describe('Workspace ID to assign the post to (from whoami). If omitted, uses the account\'s workspace or the caller\'s default workspace.'),
});

export const createPostInputSchema = createPostPayloadInputSchema.extend({
  confirm: z.literal(true).describe('Must be true after explicit user confirmation of the post/account/workspace/schedule.'),
});

export type CreatePostInput = z.infer<typeof createPostInputSchema>;
export type CreatePostPayloadInput = z.infer<typeof createPostPayloadInputSchema>;

export type AccountPlatformLookup =
  | { found: true; platform: string | null }
  | { found: false; detail: string };

export type AccountPlatformResolver = (accountId: string, workspaceId?: string) => Promise<AccountPlatformLookup>;

/**
 * Builds a resolver that answers "what platform is this account_id on?" via
 * client.listAccounts() (there is no GET /accounts/:id), for thread_posts
 * calls that gave account_id without platform. Caches one in-flight lookup
 * per workspace_id (including the unscoped list, keyed ''), so
 * create_posts_batch never issues more than one accounts request per
 * distinct workspace_id even though every item in the batch calls this
 * independently: the cache is populated synchronously (before the first
 * await) on the first call for a given workspace_id, so concurrent
 * Promise.all callers for the same workspace_id share the one in-flight
 * request. A failed lookup (non-2xx, missing accounts:read, network error)
 * is cached too, so it is reported once per workspace_id rather than
 * surfacing a fresh error per item.
 */
export function createAccountPlatformResolver(client: PosterlyClient): AccountPlatformResolver {
  const cache = new Map<string, Promise<{ ok: true; platforms: Map<string, string> } | { ok: false; detail: string }>>();
  const lookupForWorkspace = (workspaceKey: string) => {
    let pending = cache.get(workspaceKey);
    if (!pending) {
      pending = (async () => {
        try {
          const accounts: Account[] = await client.listAccounts(workspaceKey ? { workspace_id: workspaceKey } : undefined);
          const platforms = new Map<string, string>();
          for (const account of accounts) {
            if (account && typeof account.platform === 'string' && account.id !== undefined && account.id !== null) {
              platforms.set(String(account.id), account.platform);
            }
          }
          return { ok: true as const, platforms };
        } catch (error: any) {
          return { ok: false as const, detail: error?.message || 'accounts lookup failed' };
        }
      })();
      cache.set(workspaceKey, pending);
    }
    return pending;
  };
  return async (accountId, workspaceId) => {
    const workspaceKey = workspaceId || '';
    const lookup = await lookupForWorkspace(workspaceKey);
    if (!lookup.ok) return { found: false, detail: lookup.detail };
    return { found: true, platform: lookup.platforms.get(String(accountId)) ?? null };
  };
}

export async function buildCreatePostPayload(
  input: CreatePostPayloadInput | CreatePostInput,
  resolvePlatform: AccountPlatformResolver,
): Promise<Parameters<PosterlyClient['createPost']>[0]> {
  const { confirm: _confirm, thread_posts, caption, post_type, instagram_settings, platform_settings, ...rest } = input as CreatePostInput & CreatePostPayloadInput;

  if (thread_posts && thread_posts.length > 0) {
    if (thread_posts.length < 2) {
      throw new Error('thread_posts must contain at least 2 entries');
    }
    const platformHint = (input.platform || '').toLowerCase();
    let isTwitter = platformHint === 'twitter' || platformHint === 'x';
    let isThreads = platformHint === 'threads';
    if (!isTwitter && !isThreads) {
      if (!input.account_id) {
        throw new Error(
          'thread_posts requires `platform` to be "twitter" or "threads", or pass `account_id` for an X/Threads account.',
        );
      }
      // No platform hint: never guess X. Resolve the account's real platform
      // first, so a Threads account_id builds a threads_thread, not an
      // x_thread that the server then rejects.
      const lookup = await resolvePlatform(input.account_id, input.workspace_id);
      if (!lookup.found) {
        throw new Error(
          `thread_posts could not resolve account_id's platform (${lookup.detail}). Pass \`platform\` explicitly.`,
        );
      } else if (lookup.platform === 'threads') {
        isThreads = true;
      } else if (lookup.platform === 'twitter') {
        isTwitter = true;
      } else {
        throw new Error(
          lookup.platform
            ? `thread_posts requires an X/Twitter or Threads account; account_id resolved to platform "${lookup.platform}".`
            : 'thread_posts requires `platform` to be "twitter" or "threads", or an `account_id` that exists in list_accounts. Pass `platform` explicitly.',
        );
      }
    }
    const arrayKey = isThreads ? 'threads_thread_posts' : 'x_thread_tweets';
    const totalKey = isThreads ? 'threads_thread_total' : 'x_thread_total';
    return {
      ...rest,
      platform: isTwitter ? 'twitter' : isThreads ? 'threads' : input.platform,
      caption: thread_posts[0],
      post_type: isThreads ? 'threads_thread' : 'x_thread',
      metadata: {
        [arrayKey]: thread_posts,
        [totalKey]: thread_posts.length,
      },
    };
  }

  // Mirror the server rule (lib/api-v1-post-create.ts): a post needs a caption
  // OR media, not a caption unconditionally. Requiring one here made every
  // media-only post impossible from the npm client, most visibly Instagram and
  // Facebook Stories, which carry no caption at all. The dashboard composer and
  // the hosted MCP have always allowed it; only this package disagreed.
  const hasMedia = Boolean(input.media_url) || (input.media_urls?.length ?? 0) > 0;
  if (!caption && !hasMedia) {
    throw new Error(
      'Provide caption or media (or pass `thread_posts` for an X/Threads thread). Media-only posts are valid, for example an Instagram or Facebook Story.',
    );
  }

  return {
    ...rest,
    // The server treats a missing caption as empty content when media carries
    // the post, so send '' rather than dropping the key.
    caption: caption ?? '',
    post_type,
    ...(platform_settings || instagram_settings
      ? { settings: { ...(instagram_settings ? { __type: 'instagram', ...instagram_settings } : {}), ...(platform_settings || {}) } }
      : {}),
  };
}

export const createPostTool = {
  name: 'create_post',
  description:
    'Schedule or immediately publish a social media post. This is a DESTRUCTIVE WRITE that creates content on the user\'s real social accounts - once scheduled_at passes, it will be posted publicly and cannot be un-posted.\n\n' +
    'REQUIRED BEFORE CALLING:\n' +
    '1. Call `whoami` at the start of any new session to confirm which workspace and user you are acting for.\n' +
    '2. Show the user a preview containing ALL of: account(s) and platform(s), final caption text, scheduled time (in the user\'s timezone), media attached (if any), and workspace name.\n' +
    '3. Get explicit confirmation from the user (e.g. "post it", "yes schedule that", "looks good") BEFORE calling this tool. Do NOT infer consent from earlier instructions like "post about X every Monday" - confirm each individual post or the entire batch.\n' +
    '4. If scheduling multiple posts in one turn, list every post first and confirm the batch as a whole, then prefer `create_posts_batch` so they are created in one API request.\n\n' +
    'AFTER CALLING: Tell the user the post was created, include the posterly dashboard link returned by the tool, and offer the next natural action. Do not narrate raw HTTP, curl, or API plumbing.\n\n' +
    'Provide either account_id OR username+platform to identify the account. If scheduled_at is omitted, the post publishes immediately. If workspace_id is omitted, the server resolves one from the social account, falling back to the caller\'s default (personal) workspace - pass workspace_id explicitly if the user has more than one workspace.\n\n' +
    'MEDIA URLS: Posterly storage URLs are used as-is. Third-party HTTP(S) media URLs are copied into posterly storage before the post is saved, so API-created posts do not later fail on expired signed URLs. Short-lived signed URLs must still be live when this tool runs. You can also call `upload_media` with `url` first if you want to upload once and reuse the returned posterly URL across posts.\n\n' +
    'THREADS: Pass `thread_posts` (an array of 2+ strings) to schedule a multi-post thread on X (Twitter) or Threads (Meta). The first entry is the lead post; the rest are published as replies in the same chain. X entries are capped at 280 characters each (4000 for verified, 25000 for organization accounts); Threads entries are capped at 500 characters each. When `thread_posts` is set, `caption` is ignored.\n\n' +
    'X ARTICLES: To publish on X as a long-form Article, pass `platform_settings.article` ({ title, cover?: "first_image" | "none" }) for an X account. The caption becomes the Article body and is written as Markdown (headings, bold, italic, lists, quotes, code blocks, tables, dividers). Reference attached images with `![caption](media:1)`. Needs an X Premium account; polls, threads, paid partnership, video, and GIFs are not allowed with an Article.\n\n' +
    'PLATFORM SETTINGS: Pass `platform_settings` for composer-equivalent controls: Facebook story/reel/backgrounds, YouTube title/privacy/thumbnail/brandPartner, LinkedIn document titles/mentions/polls/content_call_to_action_label (including BUY_NOW and SHOP_NOW), TikTok direct-post privacy/toggles/commercial disclosure, Pinterest board/title/link/product_tags, GBP event/offer/CTA/recurrence, X reply settings/polls/paid_partnership, Threads reply controls/text attachments/ghost posts/spoilers/reply approvals/GIPHY, Telegram polls/buttons/video cover/live photo, Slack markdown/blocks, Mastodon visibility/quote/poll (media+poll allowed), and Instagram feed/story/reel/carousel/native media tags/collaborators/first comments/trial Reels/is_ai_generated/audio_id/caption add-ons. Instagram caption add-ons (`caption_addon`, or `poll_attachment` / `is_comment_prompt_used`) need a Facebook Login account, a non-empty caption, and a feed photo, Reel, or carousel parent. Stories are rejected. A poll and a comment prompt cannot be combined. For Instagram, @username in caption is only a caption mention; `user_tags` creates native media tags and `collaborators` sends co-author invitations only when the selected Meta-linked account reports those capabilities. Call `list_platforms` with `view: "schema"` and the account ID first. `instagram_settings` remains as a backwards-compatible alias.\n\n' +
    'TIKTOK MEDIA: TikTok supports a single video or a photo slideshow of 1 to 35 images, never multiple videos. Image media auto-detects as a slideshow, so you usually do not set post_type or media_type for photos and every image is posted. Pass `platform_settings.media_type: "PHOTO"` to force a slideshow explicitly.',
  inputSchema: createPostInputSchema,

  async execute(
    client: PosterlyClient,
    input: CreatePostInput,
  ) {
    if (input.confirm !== true) {
      throw new Error('Refusing to create post without confirm=true after explicit user confirmation.');
    }
    const payload = await buildCreatePostPayload(input, createAccountPlatformResolver(client));
    const { thread_posts, instagram_settings, platform_settings } = input;

    const result = await client.createPost(payload);
    const p = result.post as Record<string, any>;
    const ws = result.workspace;

    const when = p.scheduled_at ? formatLocalDateTime(p.scheduled_at) : 'now';
    const dashboardUrl = dashboardUrlForPost({ id: p.id, scheduled_at: p.scheduled_at });
    const createdLine = p.scheduled_at ? 'Post scheduled successfully.' : 'Post created successfully.';

    const lines = [
      createdLine,
      `• ID: ${p.id}`,
      `• Platform: ${p.platform || input.platform || 'unknown'}`,
      `• Type: ${p.post_type}`,
      `• Status: ${p.status}`,
      `• Scheduled: ${when}`,
      `• View in posterly: ${dashboardUrl}`,
    ];
    if (p.reel_cover_url) {
      lines.push(`• Reel cover: ${p.reel_cover_url}`);
    }
    if (p.thumbnail_url) {
      lines.push(`• Thumbnail: ${p.thumbnail_url}`);
    }
    if (p.youtube_thumbnail_url) {
      lines.push(`• YouTube thumbnail: ${p.youtube_thumbnail_url}`);
    }
    if (thread_posts) {
      lines.push(`• Thread: ${thread_posts.length} posts`);
    }
    if (instagram_settings?.collaborators?.length) {
      lines.push(`• Instagram collaborators: ${instagram_settings.collaborators.length}`);
    }
    if (instagram_settings?.first_comment) {
      lines.push('• Instagram first comment: yes');
    }
    const captionAddonType = instagram_settings?.caption_addon && typeof instagram_settings.caption_addon === 'object'
      ? instagram_settings.caption_addon.type || instagram_settings.caption_addon.kind
      : null;
    if (captionAddonType && captionAddonType !== 'none') {
      lines.push(`• Instagram caption add-on: ${captionAddonType}`);
    } else if (instagram_settings?.is_comment_prompt_used) {
      lines.push('• Instagram caption add-on: comment_prompt');
    } else if (instagram_settings?.poll_attachment) {
      lines.push('• Instagram caption add-on: poll');
    }
    if (platform_settings) {
      lines.push('• Platform settings: yes');
    }
    if (ws) {
      lines.push(`• Workspace: ${ws.name} (${ws.id}) - resolved from ${ws.resolved_from}`);
    }
    if (result.warnings && result.warnings.length > 0) {
      lines.push('• Warnings:');
      for (const warning of result.warnings) {
        lines.push(`  - ${warning.message || warning.code}`);
      }
    }
    lines.push(
      '',
      'Next step for the AI agent: tell the user the post is in posterly, share the dashboard link above, then ask whether they want to create another post, adjust this one, or connect another account.',
    );
    return lines.join('\n');
  },
};
