import { z } from 'zod';
import type { PosterlyClient, PosterlyStatusResponse } from '../lib/api-client.js';
import { formatDateTime, mdBullets, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';

const STATE_LABELS: Record<string, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Not enough recent activity to measure',
};

const PLATFORM_STATE_LABELS: Record<string, string> = {
  operational: 'operational',
  degraded: 'degraded',
  outage: 'outage',
  low_volume: 'low volume',
  no_data: 'no data',
};

function formatPosterlyStatus(result: PosterlyStatusResponse): string {
  const incidents = Array.isArray(result.incidents) ? result.incidents : [];
  const platforms = Array.isArray(result.platforms) ? result.platforms : [];
  const platformRows: Array<[string, string]> = platforms.map((p) => {
    const label = PLATFORM_STATE_LABELS[p.state] || p.state;
    return [
      p.platform,
      p.success_rate_7d === null || p.success_rate_7d === undefined
        ? `${label} (${p.publishes_7d ?? 0} publishes in 7 days)`
        : `${label} (${p.success_rate_7d}% of ${p.publishes_7d ?? 0} publishes in 7 days)`,
    ];
  });
  const excluded = platforms.reduce((sum, p) => sum + (Number(p.customer_side_failures_7d) || 0), 0);
  return [
    mdTitle('posterly publishing status', result.as_of ? `Computed ${formatDateTime(result.as_of)}` : undefined),
    mdSection('Overall', mdKeyValue([
      ['State', STATE_LABELS[result.state] || result.state],
      ['Basis', result.state_basis || 'publishing success, last 4 hours'],
      ['Posts counted in the success rate (last 4 hours)', String(result.counted_4h ?? 0)],
      ['Enough recent activity to judge', result.insufficient_data ? 'no' : 'yes'],
      ['Upcoming scheduled posts', String(result.upcoming_scheduled_posts ?? 0)],
    ])),
    incidents.length > 0
      ? mdSection('Active incidents', mdBullets(incidents.map((i) => `${i.platform || 'unknown'}: ${i.message || i.state || 'incident'}`)))
      : '',
    platforms.length > 0 ? mdSection('Platforms (last 7 days)', mdKeyValue(platformRows)) : '',
    result.insufficient_data && incidents.length === 0
      ? 'Too few publishes in the last 4 hours to judge health. That is not an outage, and not a green light either.'
      : '',
    `Excluded from the rates: ${excluded} failures in the last 7 days caused by content or account problems (for example an expired connection or a content limit). They are not posterly's fault.`,
  ].filter(Boolean).join('\n\n');
}

export const posterlyStatusTool = {
  name: 'posterly_status',
  description:
    "Check posterly's own publishing health: overall state from the last 4 hours of publishing success, any active incident (for example X being unavailable), and per-platform state with 7-day success rate and publish counts. Call it before scheduling a time-critical post, or when a user asks whether posterly or a platform is down or why posts are failing. Says so plainly when there is not enough recent activity to judge. Failures caused by content or account problems (expired connections, content limits) are excluded from the rates and reported separately as customer_side. Not the same as whoami view \"status\", which only reports the MCP server and npm package version. Read-only; aggregates only, no post or user data.",
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const result = await client.getStatus();
    return formatPosterlyStatus(result);
  },
};
