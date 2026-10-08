import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const generateVideoTool = {
  name: 'generate_video',
  description:
    'Queue an AI video generation job with Google Veo 3.1 or xAI Grok Imagine Video 1.5. COSTS CREDITS: confirm provider, prompt, duration, resolution, aspect ratio, audio choice, and credit cost with the user before calling. Grok supports 1 to 15 seconds and 480p to 1080p; reference-to-video is capped at 720p. Poll list_jobs with type=video for status and final video_url.',
  inputSchema: z.object({
    provider: z.enum(['google', 'xai']).default('google').optional(),
    prompt: z.string().min(5).max(4000),
    negative_prompt: z.string().max(500).optional(),
    aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']).default('16:9').optional(),
    duration_seconds: z.number().int().min(1).max(15).default(8).optional(),
    resolution: z.enum(['480p', '720p', '1080p']).default('720p').optional(),
    model: z.enum(['lite', 'fast', 'standard']).default('fast').optional(),
    image_url: z.string().url().optional(),
    end_image_url: z.string().url().optional(),
    reference_images: z.array(z.object({
      url: z.string().url(),
      type: z.enum(['character', 'object', 'scene']),
    })).max(3).optional(),
    generate_audio: z.boolean().default(true).optional().describe('Google can disable generated audio. xAI Grok includes audio and requires this to remain true.'),
    source_video_url: z.string().url().optional(),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
    confirm: z.literal(true).describe('Must be true after explicit user confirmation of prompt, model, duration, resolution, and credit cost.'),
  }),

  async execute(client: PosterlyClient, input: any) {
    if (input.confirm !== true) {
      throw new Error('Refusing to generate video without confirm=true after explicit user confirmation.');
    }
    const { confirm: _confirm, ...payload } = input;
    const result = await client.generateVideo(payload);
    return [
      'Video generation job queued',
      `Job ID: ${result.job_id}`,
      `Status: ${result.status}`,
      `Credit cost: ${result.credit_cost} (${result.included_credit_cost || 0} included, ${result.purchased_credit_cost || 0} purchased)`,
      result.message,
      '',
      'Raw response:',
      JSON.stringify(result, null, 2),
    ].filter(Boolean).join('\n');
  },
};
