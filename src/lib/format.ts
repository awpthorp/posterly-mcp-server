import type { Account, LearnedVoice, ListPostsResponse, Post, PostCountsResponse, PostsRangeEcho } from './api-client.js';

type CellValue = string | number | boolean | null | undefined;

const POSTERLY_APP_URL = (process.env.POSTERLY_URL || 'https://www.poster.ly').replace(/\/$/, '');

export const DASHBOARD_CALENDAR_URL = `${POSTERLY_APP_URL}/dashboard/calendar`;
export const DASHBOARD_TABLE_URL = `${POSTERLY_APP_URL}/dashboard/table`;
export const DASHBOARD_CONNECT_URL = `${POSTERLY_APP_URL}/dashboard/connect`;

export function formatLocalDateTime(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function dashboardUrlForPost(post: Pick<Post, 'id' | 'scheduled_at'>): string {
  const baseUrl = isInCurrentMonth(post.scheduled_at) ? DASHBOARD_CALENDAR_URL : DASHBOARD_TABLE_URL;
  const url = new URL(baseUrl);
  url.searchParams.set('post_id', String(post.id));
  return url.toString();
}

export function dashboardUrlForPosts(): string {
  return DASHBOARD_TABLE_URL;
}

export function dashboardUrlForPostList(posts: Array<Pick<Post, 'scheduled_at'>>): string {
  if (posts.length > 0 && posts.every((post) => isInCurrentMonth(post.scheduled_at))) {
    return DASHBOARD_CALENDAR_URL;
  }
  return DASHBOARD_TABLE_URL;
}

/**
 * Renders a 1-5 star rating as filled/empty glyphs, e.g. 4 -> "★★★★☆".
 * Appends " (est.)" for a default-basis rating, matching the dashboard's
 * "Estimated" badge, so a thin or absent data signal reads the same way on
 * both surfaces.
 */
export function starGlyphs(stars: unknown, estimated = false): string {
  const n = Math.max(0, Math.min(5, Math.round(Number(stars)) || 0));
  const glyphs = '★'.repeat(n) + '☆'.repeat(5 - n);
  return estimated ? `${glyphs} (est.)` : glyphs;
}

export function truncateText(value: string | null | undefined, max = 80): string {
  const text = value?.trim() || '';
  if (!text) return '(empty)';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function formatAccountLabel(account: Account): string {
  const username = account.username ? `@${account.username}` : `account ${account.id}`;
  return `${account.platform} ${username}`;
}

export function formatConnectedAccounts(accounts?: Account[]): string {
  if (!accounts?.length) return 'none yet';
  return accounts.map(formatAccountLabel).join(', ');
}

export function mdTitle(title: string, subtitle?: string): string {
  return [`## ${title}`, subtitle ? `_${subtitle}_` : ''].filter(Boolean).join('\n');
}

export function mdTable(headers: string[], rows: CellValue[][]): string {
  const visibleRows = rows.filter((row) => row.some((cell) => cell !== undefined && cell !== null && cell !== ''));
  if (visibleRows.length === 0) return '';

  const header = `| ${headers.map(escapeCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = visibleRows.map((row) => `| ${row.map((cell) => escapeCell(formatCell(cell))).join(' | ')} |`);

  return [header, divider, ...body].join('\n');
}

export function mdKeyValue(rows: Array<[string, CellValue]>): string {
  return mdTable(['Field', 'Value'], rows);
}

export function mdSection(title: string, body?: string): string {
  if (!body) return '';
  return [`### ${title}`, body].join('\n');
}

export function mdBullets(items: Array<string | null | undefined>): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join('\n');
}

export function mdJson(title: string, value: unknown): string {
  return [`### ${title}`, '```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

export function mdQuote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

export function mdEmpty(title: string, detail: string, nextStep?: string): string {
  return [
    mdTitle(`No ${title}`),
    detail,
    nextStep ? `\n**Next step:** ${nextStep}` : '',
  ].filter(Boolean).join('\n');
}

export function mdSuccess(title: string, rows: Array<[string, CellValue]>, nextStep?: string): string {
  return [
    mdTitle(`✅ ${title}`),
    mdKeyValue(rows),
    nextStep ? `\n**Next step:** ${nextStep}` : '',
  ].filter(Boolean).join('\n');
}

export function mdError(message: string): string {
  return [
    mdTitle('⚠️ posterly tool error'),
    `**Message:** ${message}`,
  ].join('\n');
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? 'n/a' : value.toLocaleString();
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${value.toLocaleString()}%`;
}

export function formatDelta(value: number | null | undefined): string {
  if (value == null) return 'n/a';
  return value >= 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null) return 'n/a';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function compactText(value: string | null | undefined, maxLength = 90): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

/**
 * Render one account's learned voice (derived from its real published captions)
 * as a Markdown block. Returns null when there is no learned voice to show.
 */
export function mdLearnedVoice(learned: LearnedVoice | null | undefined): string | null {
  if (!learned) return null;

  const obs = (learned.observations || {}) as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    const value = obs[key];
    return typeof value === 'number' ? value : undefined;
  };
  const topEmojis = Array.isArray(obs.top_emojis) ? (obs.top_emojis as string[]) : [];

  const accountLabel = learned.username
    ? `@${learned.username}${learned.platform ? ` (${learned.platform})` : ''}`
    : `account ${learned.social_account_id}`;

  const habits: string[] = [];
  const avgLen = num('avg_caption_length');
  if (avgLen != null) habits.push(`~${avgLen} chars/post`);
  const emojiRate = num('emoji_rate');
  if (emojiRate != null) {
    habits.push(emojiRate >= 0.5 ? `~${emojiRate} emoji/post${topEmojis.length ? ` (${topEmojis.slice(0, 3).join(' ')})` : ''}` : 'rarely uses emoji');
  }
  const hashtagAvg = num('hashtag_avg');
  if (hashtagAvg != null && hashtagAvg >= 0.5) habits.push(`~${Math.round(hashtagAvg)} hashtags/post`);
  const questionRate = num('question_rate');
  if (questionRate != null && questionRate >= 0.3) habits.push('often opens with a question');
  const lineBreakRate = num('line_break_rate');
  if (lineBreakRate != null && lineBreakRate >= 0.5) habits.push('uses line breaks');

  const body = mdKeyValue([
    ['Account', accountLabel],
    ['Summary', compactText(learned.narrative_summary || learned.summary, 240)],
    ['Traits', learned.traits?.length ? learned.traits.join(', ') : undefined],
    ['Style guidelines', learned.style_guidelines?.length ? learned.style_guidelines.join(' • ') : undefined],
    ['Observed habits', habits.length ? habits.join(', ') : undefined],
    ['Learned from', `${learned.post_count} posts`],
    ['Last updated', learned.derived_at ? formatDateTime(learned.derived_at) : undefined],
  ]);

  return body || null;
}

export function statusLabel(status: string | null | undefined): string {
  const value = String(status || 'unknown').toLowerCase();
  if (['created', 'success', 'succeeded', 'completed', 'published', 'active'].includes(value)) return `✅ ${status}`;
  if (['scheduled', 'queued', 'pending', 'processing', 'opened', 'awaiting_provider', 'awaiting_credentials'].includes(value)) return `🕒 ${status}`;
  if (['failed', 'error', 'inactive', 'deleted', 'cancelled', 'expired'].includes(value)) return `⚠️ ${status}`;
  if (['draft', 'paused'].includes(value)) return `⏸️ ${status}`;
  return status || 'unknown';
}

export function code(value: CellValue): string {
  return `\`${formatCell(value).replace(/`/g, '\\`')}\``;
}

function formatCell(value: CellValue): string {
  if (value === null || value === undefined || value === '') return 'n/a';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function escapeCell(value: CellValue): string {
  return formatCell(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function isInCurrentMonth(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

/**
 * The completeness line every paged list prints, so an agent always knows
 * whether it has seen everything. Shared by the npm package and the hosted
 * endpoint.
 */
export function formatPagingNote(input: {
  noun: string;
  tool: string;
  offset?: number | null;
  count: number;
  total?: number | null;
  hasMore: boolean;
  nextOffset?: number | null;
}): string {
  const offset = input.offset ?? 0;
  const first = offset + 1;
  const last = offset + input.count;
  const ofTotal = typeof input.total === 'number' ? ` of ${input.total}` : '';
  if (input.hasMore) {
    const next = typeof input.nextOffset === 'number' ? input.nextOffset : last;
    return `**Not complete: showing ${first}-${last}${ofTotal} ${input.noun}.** More available: call ${input.tool} again with the same filters and offset=${next}. Keep paging until this says complete before drawing any conclusion about totals.`;
  }
  if (offset === 0) {
    return `**Complete: all ${typeof input.total === 'number' ? input.total : input.count} ${input.noun} are shown.**`;
  }
  return `**Complete: this is the last page (${input.noun} ${first}-${last}${ofTotal}).**`;
}

// ---------------------------------------------------------------------------
// list_posts: shared by the npm package and the hosted endpoint
// (lib/mcp/http-tools.ts imports these), so both surfaces print the same
// completeness line and the same times for the same response.
// ---------------------------------------------------------------------------

export type PostListRange = PostsRangeEcho;
export type PostListPage = ListPostsResponse;
export type { PostCountsResponse };

function zonedParts(value: string | Date, timeZone: string): Record<string, string> {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** "Wed, Oct 1, 2026, 09:00" in `timeZone`; the raw value when it is not a date. */
export function formatDateTimeInZone(value: string | null | undefined, timeZone: string): string {
  if (!value) return 'not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const p = zonedParts(date, timeZone);
  return `${p.weekday}, ${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute}`;
}

/** "Wed, Oct 1, 2026" for a YYYY-MM-DD calendar day. */
export function formatCalendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const p = zonedParts(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)), 'UTC');
  return `${p.weekday}, ${p.month} ${p.day}, ${p.year}`;
}

function isZonedMidnight(value: string, timeZone: string): boolean {
  const p = zonedParts(value, timeZone);
  return p.hour === '00' && p.minute === '00' && p.second === '00';
}

function zonedDay(value: string | Date, timeZone: string): string {
  const p = zonedParts(value, timeZone);
  return `${p.month} ${p.day}, ${p.year}`;
}

/**
 * The scheduled range in plain words. Whole days read as "Oct 1, 2026 to
 * Oct 31, 2026" (the API's `to` is exclusive, so a midnight `to` ends the
 * day before); anything else reads as "from X up to Y".
 */
export function formatPostRange(range: PostListRange): string {
  const tz = range.timezone;
  if (range.from && range.to && isZonedMidnight(range.from, tz) && isZonedMidnight(range.to, tz)) {
    const lastDay = new Date(Date.parse(range.to) - 1);
    return `${zonedDay(range.from, tz)} to ${zonedDay(lastDay, tz)} (${tz})`;
  }
  const from = range.from ? `from ${formatDateTimeInZone(range.from, tz)}` : '';
  const to = range.to ? `up to ${formatDateTimeInZone(range.to, tz)}` : '';
  return `${[from, to].filter(Boolean).join(' ')} (${tz})`;
}

function approvalCell(post: Post): string {
  if (!post.approval || post.approval.status === 'none') return 'none';
  return post.approval.waiting_on ? `${post.approval.status} (waiting on ${post.approval.waiting_on})` : post.approval.status;
}

/**
 * One page of list_posts. Always says whether every matching post is shown,
 * and when it is not, exactly which offset to call next, so an agent never
 * mistakes the first page for the whole schedule.
 */
export function formatPostListPage(
  data: PostListPage,
  options: { timeZone: string; dashboardUrl?: string },
): string {
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const total = typeof data.total === 'number' ? data.total : posts.length;
  const offset = typeof data.offset === 'number' ? data.offset : 0;
  const tz = options.timeZone;
  const rangeLine = data.range ? `Scheduled ${formatPostRange(data.range)}` : '';
  const orderLine = data.order === 'asc' ? 'oldest first' : 'newest first';

  if (posts.length === 0) {
    const detail = total > 0
      ? `No posts on this page: offset ${offset} is past the last of the ${total} matching posts. Call again with a lower offset.`
      : `No posts match these filters${data.range ? ` (${formatPostRange(data.range)})` : ''}. This is complete: there is nothing more to page through.`;
    return [
      mdTitle('No posts'),
      detail,
      '\n**Next step for the AI agent:** tell the user nothing matches that filter, then ask what they want to schedule next.',
    ].join('\n');
  }

  const first = offset + 1;
  const last = offset + posts.length;
  const hasMore = typeof data.has_more === 'boolean' ? data.has_more : last < total;
  const nextOffset = typeof data.next_offset === 'number' ? data.next_offset : last;
  const completeness = hasMore
    ? `**Not complete: showing ${first}-${last} of ${total} matching posts.** More available: call list_posts again with the same filters and offset=${nextOffset}. Keep paging until every post is shown before drawing any conclusion about totals, gaps, or how busy a day or client is. For "how many" questions, use view=counts.`
    : first === 1
      ? `**Complete: all ${total} matching posts are shown.**`
      : `**Complete: this is the last page (posts ${first}-${last} of ${total}).**`;

  const table = mdTable(
    ['Status', 'Post ID', `Scheduled (${tz})`, 'Type', 'Account ID', 'Brand ID', 'Approval', 'Caption'],
    // The API post row carries account and brand IDs only (no joined names);
    // list_accounts and list_brands, or view=counts, resolve them.
    posts.map((post) => [
      statusLabel(post.status),
      code(String(post.id)),
      formatDateTimeInZone(post.scheduled_at, tz),
      post.post_type || 'post',
      post.social_account_id != null ? String(post.social_account_id) : 'n/a',
      post.brand_id || 'none',
      approvalCell(post),
      compactText(post.content, 80) || '(empty)',
    ]),
  );

  return [
    mdTitle(
      hasMore || first > 1 ? `Posts ${first}-${last} of ${total}` : `Posts (${total})`,
      [rangeLine, orderLine, `times in ${tz}`].filter(Boolean).join(' · '),
    ),
    table,
    completeness,
    options.dashboardUrl ? `View in posterly: ${options.dashboardUrl}` : '',
  ].filter(Boolean).join('\n\n');
}

/** The counts view of list_posts: exact totals per day, status, account, and brand. */
export function formatPostCounts(data: PostCountsResponse): string {
  const range = data.range;
  const days = Array.isArray(data.by_day) ? data.by_day : [];
  const emptyDays = days.filter((day) => day.count === 0).map((day) => formatCalendarDay(day.date));
  const sections = [
    mdTitle(`Post counts: ${data.total} ${data.total === 1 ? 'post' : 'posts'}`, range ? formatPostRange(range) : undefined),
    data.truncated
      ? `**Partial grouping:** ${data.total} posts match, but only the first ${data.counted} were grouped below. The total is exact; narrow the range or filters for exact per-day numbers.`
      : `**Complete:** every one of the ${data.total} matching posts is counted below.`,
    mdSection('By day', mdTable(['Day', 'Posts'], days.map((day) => [formatCalendarDay(day.date), day.count]))),
    // A truncated grouping only covers the earliest posts, so a day with a
    // zero here may still have posts: never list "empty" days then.
    days.length > 0 && !data.truncated ? `Days with no posts: ${emptyDays.length > 0 ? emptyDays.join('; ') : 'none'}.` : '',
    data.truncated ? '_Per-day numbers above cover only the grouped posts, so a day showing 0 may still have posts. Narrow the range to check for empty days._' : '',
    mdSection('By status', mdTable(['Status', 'Posts'], (data.by_status || []).map((row) => [statusLabel(row.status), row.count]))),
    mdSection('By account', mdTable(
      ['Account', 'Platform', 'Account ID', 'Posts'],
      (data.by_account || []).map((row) => [
        row.username ? `@${row.username}` : row.account_id ? 'unknown account' : 'no account',
        row.platform || 'n/a',
        row.account_id ?? 'none',
        row.count,
      ]),
    )),
    mdSection('By brand', mdTable(
      ['Brand', 'Brand ID', 'Posts'],
      (data.by_brand || []).map((row) => [row.name || (row.brand_id ? 'unknown brand' : 'no brand'), row.brand_id ?? 'none', row.count]),
    )),
    '**Next step for the AI agent:** these totals are exact for the filters above. To read the posts themselves, call list_posts with view=list and the same filters, paging with offset until every post is shown.',
  ];
  return sections.filter(Boolean).join('\n\n');
}
