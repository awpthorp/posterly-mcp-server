import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { formatDate, mdEmpty, mdTable, mdTitle, starGlyphs } from '../lib/format.js';

const SUGGESTED_BASIS_LABELS: Record<string, string> = {
  yours: 'Based on your posts',
  platform: 'Popular on this platform',
  default: 'Good default',
};

export const findSlotTool = {
  name: 'find_available_slot',
  description:
    'Find available time slots for posting. Respects a 1-hour gap between posts and preferred hours (8am-10pm in the given timezone). Returns up to 10 slots. IMPORTANT: pass a timezone explicitly - default is America/New_York and slots will be off if the user is elsewhere. Pass workspace_id to only avoid collisions with posts in that workspace. strategy "best_engagement" (needs account_ids) ranks the next 7 days by when these accounts get the most engagement, with a 1-5 star rating and a reason per slot.',
  inputSchema: z.object({
    account_ids: z
      .array(z.string())
      .optional()
      .describe('Filter slots for specific account IDs'),
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone (e.g. Asia/Dubai, Europe/London). Defaults to America/New_York - pass the user\'s actual timezone or slots will be wrong.'),
    count: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .describe('Number of slots to return (max 10). Default 5 for next_free, 3 for best_engagement.'),
    workspace_id: z
      .string()
      .optional()
      .describe('Scope slot-finding to a single workspace (get IDs via whoami).'),
    strategy: z
      .enum(['next_free', 'best_engagement'])
      .optional()
      .describe('next_free (default): earliest free slots. best_engagement: best times by engagement (requires account_ids).'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      account_ids?: string[];
      timezone?: string;
      count?: number;
      workspace_id?: string;
      strategy?: 'next_free' | 'best_engagement';
    }
  ) {
    if (input.strategy === 'best_engagement') {
      const accountIds = (input.account_ids || []).filter(Boolean);
      if (accountIds.length === 0) {
        throw new Error('strategy "best_engagement" needs account_ids (get them from list_accounts).');
      }
      const result = await client.findSuggestedSlots({
        account_ids: accountIds,
        timezone: input.timezone,
        count: input.count,
        workspace_id: input.workspace_id,
      });
      const slots = Array.isArray(result.slots) ? result.slots : [];
      if (slots.length === 0) {
        return mdEmpty('suggested slots', 'No suggested slots are free in the next 7 days.');
      }
      const basis = result.basis_label || SUGGESTED_BASIS_LABELS[result.basis] || 'Good default';
      return [
        mdTitle(`Best times to post (${slots.length})`),
        `Basis: ${basis}${result.timezone ? ` (${result.timezone})` : ''}`,
        // local_time already carries the date in the requested timezone, so
        // no separate Date column (a machine-local date could disagree).
        mdTable(
          ['Option', 'Local time', 'Rating', 'Why'],
          slots.map((slot, index) => [
            index + 1,
            slot.local_time,
            starGlyphs(slot.stars, slot.basis === 'default'),
            slot.reason || 'n/a',
          ]),
        ),
      ].join('\n\n');
    }

    const slots = await client.findAvailableSlots(input);

    if (slots.length === 0) {
      return mdEmpty('available slots', 'No available posting slots were found in the next 14 days.');
    }

    return [
      mdTitle(`Available posting slots (${slots.length})`),
      mdTable(
        ['Option', 'Local time', 'Date'],
        slots.map((slot, index) => [
          index + 1,
          slot.local_time,
          formatDate(slot.time),
        ]),
      ),
    ].join('\n\n');
  },
};
