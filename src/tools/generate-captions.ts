import { z } from 'zod';
import type { GenerateCaptionsPayload, PosterlyClient } from '../lib/api-client.js';
import { mdKeyValue, mdQuote, mdSection, mdTitle } from '../lib/format.js';

const captionPlatforms = [
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
  'threads',
  'linkedin',
  'youtube',
  'pinterest',
  'google_business',
] as const;

const manualBrandVoiceSchema = z.object({
  summary: z.string().min(10).max(500),
  traits: z.array(z.string()).max(10).optional(),
  style_guidelines: z.array(z.string()).max(10).optional(),
});

export const generateCaptionsTool = {
  name: 'generate_captions',
  description:
    'Generate or adapt AI caption suggestions for one or more social platforms. Uses AI Caption Assist quota and returns options only; it does not create or schedule posts. After the user chooses final copy, pass it to create_post or create_posts_batch.',
  inputSchema: z.object({
    platforms: z
      .array(z.enum(captionPlatforms))
      .min(1)
      .max(captionPlatforms.length)
      .describe('Target platforms such as instagram, linkedin, twitter, tiktok, youtube, pinterest, or google_business.'),
    brief: z.string().max(1200).optional().describe('What the post is about. Recommended for generate mode.'),
    tone: z.string().max(60).optional(),
    allow_emojis: z.boolean().default(true).optional(),
    hashtag_strategy: z.enum(['none', 'smart', 'minimal', 'aggressive']).default('smart').optional(),
    count: z.number().int().min(1).max(5).default(3).optional(),
    mode: z.enum(['generate', 'adapt']).default('generate').optional(),
    source_caption: z.string().max(4000).optional().describe('Required when mode=adapt. The master caption to adapt.'),
    source_platform: z.enum(captionPlatforms).optional(),
    preserve_links: z.boolean().default(true).optional(),
    preserve_mentions: z.boolean().default(true).optional(),
    preserve_call_to_action: z.boolean().default(true).optional(),
    social_account_id: z.string().optional().describe('Optional connected account ID for brand voice and workspace billing context.'),
    workspace_id: z.string().optional(),
    manual_brand_voice: manualBrandVoiceSchema.optional().describe('Use when posterly asks for brand voice input.'),
  }),

  async execute(client: PosterlyClient, input: GenerateCaptionsPayload) {
    if (input.mode === 'adapt' && !input.source_caption?.trim()) {
      throw new Error('source_caption is required when mode=adapt');
    }
    const result = await client.generateCaptions(input);
    const suggestions = result.suggestions || {};

    const sections = Object.entries(suggestions).map(([platform, captions]) => {
      const body = captions.length > 0
        ? captions.map((caption, index) => `**Option ${index + 1}**\n${mdQuote(caption)}`).join('\n\n')
        : 'No suggestions returned.';
      return mdSection(platform, body);
    });

    const usage = result.usage || {};
    return [
      mdTitle('Caption suggestions'),
      ...sections,
      Object.keys(usage).length
        ? mdSection('Usage', mdKeyValue([
            ['Tier', typeof usage.tier === 'string' ? usage.tier : undefined],
            ['Used', typeof usage.used === 'number' ? usage.used : undefined],
            ['Limit', typeof usage.limit === 'number' ? usage.limit : undefined],
            ['Period', typeof usage.period === 'string' ? usage.period : undefined],
          ]))
        : '',
    ].filter(Boolean).join('\n\n');
  },
};
