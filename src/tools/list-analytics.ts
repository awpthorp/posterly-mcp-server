import { z } from 'zod';
import type {
  AccountAnalyticsResponse,
  AccountAnalyticsSummary,
  PostAnalyticsResponse,
  PostAnalyticsRow,
  PosterlyClient,
} from '../lib/api-client.js';
import { formatDateTime, formatIsoTimestamp, mdEmpty, mdKeyValue, mdSection, mdTitle, truncateText } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const presentationSchema = z.enum(['compact', 'table', 'json']).optional();
type AnalyticsPresentation = z.infer<typeof presentationSchema>;
type MetricRow = [string, string];
type Checkpoint = '1h' | '6h' | '24h' | '72h' | '7d';

type ListAnalyticsInput = {
  view: 'accounts' | 'posts' | 'insights';
  account_id?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  post_id?: number;
  checkpoint?: Checkpoint;
  presentation?: AnalyticsPresentation;
  include_extras?: boolean;
};

export const listAnalyticsTool = {
  name: 'list_analytics',
  description:
    'Analytics for connected social accounts (Instagram, X, Facebook, LinkedIn, Google Business Profile, Pinterest, YouTube, and Threads). view=accounts (account_id): daily snapshots and a period summary with platform-native display_metrics labels. Google Business Profile account analytics includes Calls, Website clicks, and Directions along with Profile Views, Search Views, Maps Views, Customer Actions, and Posts. view=posts (account_id): per-post likes, comments/replies, reach, impressions/views, saves, shares, reposts, quotes, plays, clicks, and watch time, most recent first, with limit/offset. Google Business has no per-post rows; its totals are on view=accounts. view=insights: per-post feedback insights with a performance tier (great/good/mixed/poor), diagnosis, next action, and baseline, filtered by account_id, post_id, or checkpoint (1h, 6h, 24h, 72h, 7d); read-only, Pro plan or higher. presentation (accounts and posts): compact for Telegram/mobile, table for Markdown clients, json for custom chart/card renderers. include_extras on accounts asks for saved audience breakdowns, the last analytics sync, and entity snapshots. Those stay off until snapshot extras are switched on, and this does not start a new sync.',
  inputSchema: z.object({
    view: z.enum(['accounts', 'posts', 'insights']).describe('accounts, posts, or insights.'),
    account_id: z
      .union([z.number(), z.string()])
      .optional()
      .describe('The social account ID (from list_accounts). Required for accounts and posts; optional filter for insights.'),
    from: z
      .string()
      .optional()
      .describe('accounts and posts: start date (ISO date, e.g. 2026-03-19). Defaults to 30 days ago.'),
    to: z
      .string()
      .optional()
      .describe('accounts and posts: end date (ISO date). Defaults to today.'),
    limit: z
      .number()
      .min(1)
      .max(200)
      .optional()
      .describe('posts: number of posts (default 50, max 200). insights: max insights (default 20, max 100).'),
    offset: z.number().min(0).optional().describe('posts: pagination offset'),
    post_id: z.number().int().positive().optional().describe('insights: filter to one post ID.'),
    checkpoint: z
      .enum(['1h', '6h', '24h', '72h', '7d'])
      .optional()
      .describe('insights: filter to one checkpoint after publish.'),
    presentation: presentationSchema.describe('accounts and posts: compact, table, or json.'),
    include_extras: z.boolean().optional().describe('accounts: also return saved audience breakdowns, sync status, and entity snapshots when that read is switched on.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_account_analytics: z.object({
      account_id: z.number(),
      from: z.string().optional(),
      to: z.string().optional(),
      presentation: presentationSchema,
    }),
    get_post_analytics: z.object({
      account_id: z.number(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
      presentation: presentationSchema,
    }),
    get_post_insights: z.object({
      account_id: z.union([z.string(), z.number()]).optional(),
      post_id: z.number().int().positive().optional(),
      checkpoint: z.enum(['1h', '6h', '24h', '72h', '7d']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  },

  async execute(client: PosterlyClient, input: ListAnalyticsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_analytics', input);
    if (mode === 'accounts') {
      const result = await client.getAccountAnalytics(args as { account_id: number; from?: string; to?: string; include_extras?: boolean });
      return formatAccountAnalytics(result, args.presentation || 'compact');
    }
    if (mode === 'posts') {
      const result = await client.getPostAnalytics(args as { account_id: number; from?: string; to?: string; limit?: number; offset?: number });
      return formatPostAnalytics(result, args.presentation || 'compact');
    }
    return postInsights(client, args as { account_id?: number; post_id?: number; checkpoint?: Checkpoint; limit?: number });
  },
};

async function postInsights(
  client: PosterlyClient,
  input: { account_id?: number; post_id?: number; checkpoint?: Checkpoint; limit?: number },
): Promise<string> {
  const { insights } = await client.getPostInsights(input);

  if (!insights.length) {
    return mdEmpty(
      'feedback insights',
      'No per-post feedback insights are available for these filters yet. Insights appear as posts hit their 1h, 6h, 24h, 72h, and 7d checkpoints.',
    );
  }

  const blocks = insights.map((insight) => {
    const heading = `${insight.title || 'Insight'} (${insight.performance_tier}, ${insight.checkpoint})`;
    return mdSection(
      heading,
      mdKeyValue([
        ['Post ID', insight.post_id != null ? String(insight.post_id) : undefined],
        ['Platform', insight.platform],
        ['Account', insight.username ? `@${insight.username}` : String(insight.social_account_id)],
        ['Diagnosis', truncateText(insight.diagnosis, 220)],
        ['Next action', truncateText(insight.next_action, 220)],
        ['Impact score', insight.impact_score],
        ['Confidence', insight.confidence],
        ['Published', formatDateTime(insight.published_at)],
        ['Permalink', insight.permalink || undefined],
      ]),
    );
  });

  return [mdTitle(`Post feedback insights (${insights.length})`), ...blocks].join('\n\n');
}

function formatAccountAnalytics(result: AccountAnalyticsResponse, presentation: Exclude<AnalyticsPresentation, undefined>): string {
  const { account, range, summary, snapshots, extras } = result;
  const rows = accountMetricRows(summary, account.platform);
  const insights = analyticsInsights(summary, account.platform);
  const saved = formatAccountExtras(extras);

  if (presentation === 'json') {
    return JSON.stringify({
      type: 'account_analytics',
      account,
      range,
      snapshot_count: snapshots.length,
      metrics: rows.map(([label, value]) => ({ label, value })),
      insights,
      summary,
      snapshots,
      ...(extras ? { extras } : {}),
    }, null, 2);
  }

  if (presentation === 'table') {
    return [
      `**📊 Analytics for ${accountLabel(account.username)} (${account.id})**`,
      `_${account.platform} · ${range.from} → ${range.to}_`,
      '',
      '**Account**',
      markdownTable(['Field', 'Value'], [
        ['Account ID', String(account.id)],
        ['Daily snapshots', formatNumber(snapshots.length)],
      ]),
      '',
      '**Metrics**',
      markdownTable(['Metric', 'Value'], rows),
      '',
      '**Quick read**',
      insights.map((insight) => `- ${insight}`).join('\n'),
      ...(saved ? [saved] : []),
    ].join('\n');
  }

  return [
    `**📊 Analytics for ${accountLabel(account.username)} (${account.id})**`,
    `_${account.platform} · ${range.from} → ${range.to}_`,
    '',
    '**Account**',
    `- **Account ID:** ${account.id}`,
    `- **Daily snapshots:** ${formatNumber(snapshots.length)}`,
    '',
    '**Key metrics**',
    rows.map(([label, value]) => `- **${label}:** ${value}`).join('\n'),
    '',
    '**Quick read**',
    insights.map((insight) => `- ${insight}`).join('\n'),
    ...(saved ? [saved] : []),
  ].join('\n');
}

function formatAccountExtras(extras: AccountAnalyticsResponse['extras']): string {
  if (!extras) return '';
  if (extras.enabled !== true) return '\n**Saved detail**\nSaved audience breakdowns are switched off.';
  const days = Array.isArray(extras.demographics) ? extras.demographics.length : 0;
  const entities = Array.isArray(extras.entity_snapshots) ? extras.entity_snapshots.length : 0;
  const sync = extras.sync_status;
  const syncLine = sync
    ? `Last sync ${sync.last_synced_at || 'unknown'} (${sync.status || 'unknown'}), ${sync.posts_synced ?? 'n/a'} posts.`
    : 'No sync status saved.';
  return `\n**Saved detail**\n- Audience days: ${days}\n- ${syncLine}\n- Entity snapshots: ${entities}`;
}

function accountMetricRows(summary: AccountAnalyticsSummary, platform: string): MetricRow[] {
  const nativeRows = nativeMetricRows(summary);
  if (nativeRows.length > 0) return nativeRows;

  if (platform === 'google_business') {
    const metrics = summary.platform_metrics || {};
    return [
      ['Profile Views', formatNumber(metrics.profile_views ?? summary.total_views)],
      ['Search Views', formatNumber(metrics.search_views ?? summary.total_reach)],
      ['Maps Views', formatNumber(metrics.maps_views ?? summary.total_profile_views)],
      ['Customer Actions', formatNumber(metrics.customer_actions ?? summary.total_accounts_engaged)],
      ['Calls', formatNumber(metrics.call_clicks ?? summary.total_call_clicks)],
      ['Directions', formatNumber(metrics.direction_requests ?? summary.total_direction_requests)],
      ['Website clicks', formatNumber(metrics.website_clicks ?? summary.total_website_clicks)],
      ['Posts', formatNumber(metrics.posts ?? summary.current_media_count)],
    ];
  }

  const rows = genericMetricRows(summary);
  if (platform === 'pinterest') rows.push(['Outbound clicks', formatNumber(summary.total_website_clicks)]);
  if (platform === 'youtube') {
    rows.push(['Watch minutes', formatNumber(summary.total_watch_minutes)]);
    rows.push(['Likes', formatNumber(summary.total_likes)]);
  }
  return rows;
}

function nativeMetricRows(summary: AccountAnalyticsSummary): MetricRow[] {
  return (summary.display_metrics || [])
    .filter((metric) => metric?.label)
    .map((metric) => [metric.label, formatNumber(metric.value)]);
}

function genericMetricRows(summary: AccountAnalyticsSummary): MetricRow[] {
  return [
    ['Followers', `${formatNumber(summary.current_followers)} (${formatDelta(summary.followers_change)} in range)`],
    ['Follows gained / lost', `+${formatNumber(summary.total_follows_gained)} / -${formatNumber(summary.total_follows_lost)}`],
    ['Total reach', formatNumber(summary.total_reach)],
    ['Total views', formatNumber(summary.total_views)],
    ['Profile views', formatNumber(summary.total_profile_views)],
    ['Accounts engaged', formatNumber(summary.total_accounts_engaged)],
    ['Engagement rate by reach', formatPercent(summary.engagement_rate)],
    ['Engagement rate by followers', formatPercent(summary.engagement_rate_by_followers)],
  ];
}

function analyticsInsights(summary: AccountAnalyticsSummary, platform: string): string[] {
  const insights: string[] = [];
  if (platform === 'google_business' && (summary.display_metrics?.length || 0) > 0) {
    insights.push('Google Business metrics are shown with dashboard-native labels.');
  }
  if ((summary.followers_change || 0) > 0) insights.push(`Audience grew by ${formatDelta(summary.followers_change)} followers in this range.`);
  if ((summary.followers_change || 0) < 0) insights.push(`Audience dipped by ${formatDelta(summary.followers_change)} followers in this range.`);
  if (summary.engagement_rate != null && platform !== 'google_business') insights.push(`Engagement by reach is ${formatPercent(summary.engagement_rate)}.`);
  if (platform === 'youtube' && summary.total_watch_minutes != null) insights.push(`${formatNumber(summary.total_watch_minutes)} total watch minutes were recorded.`);
  return insights.length ? insights : ['No standout movement detected in the returned period.'];
}

function formatDelta(n: number): string {
  return n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? 'n/a' : value.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${formatNumber(value)}%`;
}

function accountLabel(username: string): string {
  if (!username) return 'account';
  return username.startsWith('@') || /\s/.test(username) ? username : `@${username}`;
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function escapeCell(value: string): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function formatPostAnalytics(result: PostAnalyticsResponse, presentation: Exclude<AnalyticsPresentation, undefined>): string {
  const { account, range, posts, total } = result;

  if (posts.length === 0) {
    const who = `${accountLabel(account.username)} (${account.platform})`;
    const window = `between ${range.from} and ${range.to}`;
    if (account.platform === 'google_business') {
      return `Google Business analytics cover the location (profile views, searches, and customer actions), not each post. No per-post rows were found for ${who} ${window}. Ask for the account view to see those totals.`;
    }
    return `No analytics found for ${who} ${window}.`;
  }

  const totals = posts.reduce((acc, post) => {
    acc.likes += post.likes || 0;
    acc.comments += post.comments || 0;
    acc.reach += post.reach || 0;
    acc.impressions += post.impressions || 0;
    acc.shares += post.shares || 0;
    acc.reposts += post.reposts || 0;
    acc.quotes += post.quotes || 0;
    acc.saves += post.saved || 0;
    return acc;
  }, { likes: 0, comments: 0, reach: 0, impressions: 0, shares: 0, reposts: 0, quotes: 0, saves: 0 });
  const isThreads = account.platform === 'threads';

  if (presentation === 'json') {
    return JSON.stringify({
      type: 'post_analytics',
      account,
      range,
      returned: {
        count: posts.length,
        total,
      },
      totals,
      posts,
    }, null, 2);
  }

  if (presentation === 'table') {
    if (isThreads) {
      return [
        `**📈 Post analytics for ${accountLabel(account.username)} (${account.id})**`,
        `_Threads · ${range.from} → ${range.to} · showing ${posts.length} of ${total}_`,
        '',
        '**Returned totals**',
        markdownTable(['Views', 'Likes', 'Replies', 'Reposts', 'Quotes', 'Shares'], [[
          formatNumber(totals.impressions),
          formatNumber(totals.likes),
          formatNumber(totals.comments),
          formatNumber(totals.reposts),
          formatNumber(totals.quotes),
          formatNumber(totals.shares),
        ]]),
        '',
        '**Posts**',
        markdownTable(['Posted', 'Post', 'Caption', 'Views', 'Likes', 'Replies', 'Reposts', 'Quotes', 'Shares'], posts.map((post) => [
          dateTime(post.posted_at),
          post.id ? String(post.id) : post.platform_media_id,
          compact(post.caption_snippet, 70) || '(no caption)',
          formatNumber(post.impressions),
          formatNumber(post.likes),
          formatNumber(post.comments),
          formatNumber(post.reposts),
          formatNumber(post.quotes),
          formatNumber(post.shares),
        ])),
      ].join('\n');
    }

    return [
      `**📈 Post analytics for ${accountLabel(account.username)} (${account.id})**`,
      `_${account.platform} · ${range.from} → ${range.to} · showing ${posts.length} of ${total}_`,
      '',
      '**Returned totals**',
      markdownTable(['Likes', 'Comments', 'Reach', 'Impressions', 'Shares', 'Saves'], [[
        formatNumber(totals.likes),
        formatNumber(totals.comments),
        formatNumber(totals.reach),
        formatNumber(totals.impressions),
        formatNumber(totals.shares),
        formatNumber(totals.saves),
      ]]),
      '',
      '**Posts**',
      markdownTable(['Posted', 'Post', 'Caption', 'Reach', 'Likes', 'Comments', 'Extras'], posts.map((post) => [
        dateTime(post.posted_at),
        post.id ? String(post.id) : post.platform_media_id,
        compact(post.caption_snippet, 70) || '(no caption)',
        formatNumber(post.reach),
        formatNumber(post.likes),
        formatNumber(post.comments),
        postExtras(account.platform, post),
      ])),
    ].join('\n');
  }

  const lines: string[] = [
    `**📈 Post analytics for ${accountLabel(account.username)} (${account.id})**`,
    `_${account.platform} · ${range.from} → ${range.to} · showing ${posts.length} of ${total}_`,
    '',
    '**Returned totals**',
    `- **Likes:** ${formatNumber(totals.likes)}`,
    `- **Comments:** ${formatNumber(totals.comments)}`,
    `- **Reach:** ${formatNumber(totals.reach)}`,
    `- **Impressions:** ${formatNumber(totals.impressions)}`,
    `- **Shares:** ${formatNumber(totals.shares)}`,
    `- **Saves:** ${formatNumber(totals.saves)}`,
    '',
    '**Posts**',
  ];

  if (isThreads) {
    const threadLines: string[] = [
      `**📈 Post analytics for ${accountLabel(account.username)} (${account.id})**`,
      `_Threads · ${range.from} → ${range.to} · showing ${posts.length} of ${total}_`,
      '',
      '**Returned totals**',
      `- **Views:** ${formatNumber(totals.impressions)}`,
      `- **Likes:** ${formatNumber(totals.likes)}`,
      `- **Replies:** ${formatNumber(totals.comments)}`,
      `- **Reposts:** ${formatNumber(totals.reposts)}`,
      `- **Quotes:** ${formatNumber(totals.quotes)}`,
      `- **Shares:** ${formatNumber(totals.shares)}`,
      '',
      '**Posts**',
    ];
    posts.forEach((post, index) => {
      threadLines.push(`${index + 1}. **${compact(post.caption_snippet, 70) || '(no caption)'}**`);
      threadLines.push(`   Posted: ${dateTime(post.posted_at)}`);
      threadLines.push(`   Post ID: ${post.id ? String(post.id) : post.platform_media_id}`);
      threadLines.push(`   Views: ${formatNumber(post.impressions)}`);
      threadLines.push(`   Likes: ${formatNumber(post.likes)}`);
      threadLines.push(`   Replies: ${formatNumber(post.comments)}`);
      threadLines.push(`   Reposts: ${formatNumber(post.reposts)}`);
      threadLines.push(`   Quotes: ${formatNumber(post.quotes)}`);
      threadLines.push(`   Shares: ${formatNumber(post.shares)}`);
      if (post.permalink) threadLines.push(`   Permalink: ${post.permalink}`);
    });
    return threadLines.join('\n');
  }

  posts.forEach((post, index) => {
    lines.push(`${index + 1}. **${compact(post.caption_snippet, 70) || '(no caption)'}**`);
    lines.push(`   Posted: ${dateTime(post.posted_at)}`);
    lines.push(`   Post ID: ${post.id ? String(post.id) : post.platform_media_id}`);
    lines.push(`   Reach: ${formatNumber(post.reach)}`);
    lines.push(`   Likes: ${formatNumber(post.likes)}`);
    lines.push(`   Comments: ${formatNumber(post.comments)}`);
    lines.push(`   Extras: ${postExtras(account.platform, post)}`);
  });

  return lines.join('\n');
}

function postExtras(platform: string, post: PostAnalyticsRow): string {
  const metrics: string[] = [];
  if (post.impressions) metrics.push(`${formatNumber(post.impressions)} impressions`);
  if (post.saved) metrics.push(`${formatNumber(post.saved)} saved`);
  if (platform !== 'threads' && post.shares) metrics.push(`${formatNumber(post.shares)} shares`);
  if (post.plays) metrics.push(`${formatNumber(post.plays)} plays`);
  if (platform === 'youtube' && post.total_watch_time_ms) metrics.push(`${formatNumber(Math.round(post.total_watch_time_ms / 60000))} watch minutes`);
  if (platform === 'youtube' && post.avg_watch_time_ms) metrics.push(`${formatNumber(Math.round(post.avg_watch_time_ms / 1000))}s avg view`);
  if (post.url_link_clicks) metrics.push(platform === 'pinterest' ? `${formatNumber(post.url_link_clicks)} outbound clicks` : `${formatNumber(post.url_link_clicks)} link clicks`);
  if (post.user_profile_clicks) metrics.push(platform === 'pinterest' ? `${formatNumber(post.user_profile_clicks)} pin clicks` : `${formatNumber(post.user_profile_clicks)} profile clicks`);
  if (post.permalink) metrics.push(post.permalink);
  return metrics.join(' · ') || 'n/a';
}


function dateTime(value: string | null): string {
  if (!value) return 'n/a';
  return formatIsoTimestamp(value);
}

function compact(value: string | null, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}
