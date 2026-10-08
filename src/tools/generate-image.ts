import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { mdKeyValue, mdTitle } from '../lib/format.js';

export const generateImageTool = {
  name: 'generate_image',
  description:
    'Queue an AI image job via posterly using Nano Banana (Gemini) or Grok Imagine Image 2.0 (xAI). Returns job_id. Poll list_jobs with type=image until status is completed, then pass urls to create_post as media_url / media_urls. Gemini thinking high does not change the credit price.\n\n' +
    'COSTS CREDITS. Every call consumes part of the user\'s monthly AI image quota (or purchased credits once the quota is exhausted). Do NOT call speculatively - always describe the image you\'re about to generate (subject, style, aspect ratio, quality/thinking, resolution) to the user and get confirmation before calling.\n\n' +
    'If the user is over their plan limit and has no credits, this tool returns a 402 with upgrade info. Surface that message verbatim - do not retry.\n\n' +
    'Common aspect ratios by platform:\n' +
    '  • Instagram feed / LinkedIn: 1:1 (square) or 4:5 (portrait)\n' +
    '  • Instagram Story/Reel, TikTok, YouTube Shorts: 9:16\n' +
    '  • YouTube thumbnail, Twitter cards, landscape feed: 16:9\n' +
    '  • Pinterest: 2:3',
  inputSchema: z.object({
    prompt: z
      .string()
      .min(5)
      .max(4000)
      .describe('Detailed image description. 5-4000 characters. Describe subject, scene, lighting, mood, and style.'),
    aspect_ratio: z
      .enum([
        '1:1', '9:16', '4:5', '3:4', '2:3', '1:4', '1:8',
        '21:9', '16:9', '4:3', '3:2', '4:1', '8:1', '5:4',
      ])
      .optional()
      .describe('Aspect ratio. Default 1:1. Pick based on target platform (see tool description).'),
    style: z
      .enum([
        'photographic', 'illustration', 'minimal', 'vibrant', 'professional',
        'youtube_thumbnail', 'reel_cover', 'review_background',
      ])
      .optional()
      .describe('Preset style. Default photographic. Use youtube_thumbnail / reel_cover for platform-optimized covers; review_background for testimonial backgrounds.'),
    variations: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('How many variations to generate. Default 1. Each variation costs credits separately - prefer 1 unless the user explicitly wants options.'),
    provider: z
      .enum(['google', 'xai'])
      .optional()
      .describe('Image provider. Default google. Use xai for Grok Imagine Image 2.0.'),
    model: z
      .enum(['lite', 'flash', 'pro'])
      .optional()
      .describe('Google-only. lite (8 credits, 1K only) suits drafts; flash (default, Nano Banana 2.1, 15 at 1K) balances quality and cost; pro (30 at 1K) is highest quality. Ignored for xAI.'),
    resolution: z
      .enum(['1K', '2K', '4K'])
      .optional()
      .describe('Output resolution. Default 1K. xAI supports 1K/2K only. Google flash (Nano Banana 2.1): 15/23/35 credits at 1K/2K/4K. 512 is no longer available. Pro: 30 at 1K-2K, 55 at 4K.'),
    quality: z
      .enum(['low', 'medium', 'high'])
      .optional()
      .describe('Google: high turns on Gemini thinking (dashboard thinkingLevel=high). low/medium leave thinking minimal unless thinking_level is set. xAI: low or medium credit tiers; high is invalid.'),
    thinking_level: z
      .enum(['minimal', 'high'])
      .optional()
      .describe('Google flash/lite only. Gemini image quality control. minimal is fastest; high is for infographics, grounded scenes, and harder layouts. Pro reasons automatically. Overrides quality when both are set.'),
    reference_image_urls: z
      .array(z.string().url())
      .max(14)
      .optional()
      .describe('Google only. Up to 14 HTTPS image URLs used as references (logo, product, style lock). Same as dashboard reference images.'),
    workspace_id: z.string().optional().describe('Optional. The workspace this acts in and whose plan pays (from whoami). Needed only when your connection can act in several workspaces.'),
    confirm: z.literal(true).describe('Must be true after explicit user confirmation of subject, style, aspect ratio, quality, and credit use.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      prompt: string;
      aspect_ratio?: string;
      style?: string;
      variations?: number;
      provider?: 'google' | 'xai';
      model?: 'lite' | 'flash' | 'pro';
      resolution?: '1K' | '2K' | '4K';
      quality?: 'low' | 'medium' | 'high';
      thinking_level?: 'minimal' | 'high';
      reference_image_urls?: string[];
      workspace_id?: string;
      confirm: true;
    }
  ) {
    if (input.confirm !== true) {
      throw new Error('Refusing to generate image without confirm=true after explicit user confirmation.');
    }
    const { confirm: _confirm, ...payload } = input;
    const result = await client.generateImage(payload);

    return [
      mdTitle('Image job queued', `Job: ${result.job_id}`),
      mdKeyValue([
        ['Status', result.status],
        ['Model', result.model],
        ['Resolution', result.resolution],
        ['Thinking', result.thinking_level || undefined],
        ['Credits used', result.credits_used],
        ['Billed from', result.usage?.billed_from],
      ]),
      result.message || 'Poll list_jobs with type=image and this job_id until status is completed, then pass urls to create_post.',
    ].filter(Boolean).join('\n\n');
  },
};
