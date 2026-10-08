import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { PLATFORM_HELPER_NAMES, SUPPORTED_PLATFORM_INPUTS, SUPPORTED_PLATFORM_IDS } from '../generated/platform-manifest.js';

export const triggerPlatformHelperTool = {
  name: 'trigger_platform_helper',
  description:
    `Run account-specific platform helper discovery. Available helpers: ${PLATFORM_HELPER_NAMES.join(', ')}.`,
  inputSchema: z.object({
    helper: z.enum(PLATFORM_HELPER_NAMES),
    account_id: z
      .string()
      .optional()
      .describe('Connected social account ID when the helper needs account context.'),
    platform: z
      .enum(SUPPORTED_PLATFORM_INPUTS)
      .optional()
      .describe(`Platform hint when no account_id is supplied. Supported: ${SUPPORTED_PLATFORM_IDS.join(', ')}.`),
    params: z.record(z.string(), z.unknown()).optional(),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      helper: string;
      account_id?: string;
      platform?: string;
      params?: Record<string, unknown>;
    },
  ) {
    const result = await client.triggerPlatformHelper(input);
    return JSON.stringify(result, null, 2);
  },
};
