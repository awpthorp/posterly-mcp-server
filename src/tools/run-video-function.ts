import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const runVideoFunctionTool = {
  name: 'run_video_function',
  description:
    'Run a read-only Google Veo or xAI Grok video helper function before generation: list_input_modes, estimate_cost, or validate_request. This does not generate video or spend credits.',
  inputSchema: z.object({
    identifier: z
      .enum(['google_veo', 'veo3', 'xai_grok', 'grok_imagine'])
      .describe('Video generator identifier from get_video_options.'),
    functionName: z
      .enum(['list_input_modes', 'estimate_cost', 'validate_request'])
      .describe('Helper function name from get_video_options.tools.'),
    params: z
      .record(z.unknown())
      .optional()
      .describe('Function parameters. estimate_cost accepts model, duration_seconds, resolution, output, and xAI input_image_count. validate_request accepts a generate_video-style payload.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { identifier: string; functionName: string; params?: Record<string, unknown> },
  ) {
    const result = await client.runVideoFunction(input);
    return [
      `Video function ${input.functionName} completed`,
      '',
      JSON.stringify(result, null, 2),
    ].join('\n');
  },
};
