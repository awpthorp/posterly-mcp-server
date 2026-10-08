import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const getXPostingQuotaTool = {
  name: 'get_x_posting_quota',
  description:
    'Get managed X posting quota for a workspace, including total monthly allowance, used posts, remaining posts, and URL-blocking status.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Workspace ID from whoami. Defaults to the caller personal workspace context.'),
  }),

  async execute(client: PosterlyClient, input: { workspace_id?: string }) {
    const quota = await client.getXPostingQuota(input);
    return [
      'X posting quota',
      `• Workspace: ${quota.workspace_id || 'default'}`,
      `• Tier: ${quota.tier || 'unknown'}`,
      `• Total posts: ${quota.total_posts}`,
      `• Used posts: ${quota.used_posts}`,
      `• Remaining posts: ${quota.remaining_posts}`,
      `• URL posting blocked: ${quota.urls_blocked ? 'yes' : 'no'}`,
      `• Period: ${quota.current_period_start} -> ${quota.current_period_end}`,
    ].join('\n');
  },
};
