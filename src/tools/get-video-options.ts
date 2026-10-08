import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const getVideoOptionsTool = {
  name: 'get_video_options',
  description:
    'List read-only Veo video generation options, input modes, durations, resolutions, aspect ratios, and credit-cost estimates. This does not generate video or spend credits.',
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const options = await client.getVideoOptions();
    const models = Array.isArray(options.models) ? options.models : [];
    const inputModes = Array.isArray(options.input_modes) ? options.input_modes : [];
    const lines = [
      'Video generation options',
      `Provider: ${options.provider || 'unknown'}`,
      `Public generation status: ${options.public_generation_status || 'unknown'}`,
      '',
      `Models: ${models.map((model: any) => model.id).filter(Boolean).join(', ') || 'none'}`,
      `Durations: ${(options.durations_seconds || []).join(', ')} seconds`,
      `Resolutions: ${(options.resolutions || []).join(', ')}`,
      `Aspect ratios: ${(options.aspect_ratios || []).join(', ')}`,
      `Input modes: ${inputModes.map((mode: any) => mode.id).filter(Boolean).join(', ') || 'none'}`,
      '',
      'Raw options:',
      JSON.stringify(options, null, 2),
    ];
    return lines.join('\n');
  },
};
