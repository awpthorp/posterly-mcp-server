import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

const tokenSchema = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,63}$/);
const printableSchema = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      'Control characters are not allowed',
    );

const secretFreeSchema = (maxLength: number) =>
  printableSchema(maxLength).refine(
    (value) => !/(?:pst_(?:live|test)_|sk-[a-z0-9_-]{12,})/i.test(value),
    'Must not contain secrets',
  );

export const submitProductFeedbackInputSchema = z.object({
  category: z.enum(['bug', 'idea', 'feedback']),
  title: secretFreeSchema(120).refine((value) => value.length >= 3, 'Title must be at least 3 characters'),
  description: secretFreeSchema(4000).optional(),
  client: printableSchema(80).optional(),
  confirm: z.literal(true),
  source: z.enum(['mcp', 'cli', 'rest', 'skill']).optional(),
  context: z
    .object({
      request_id: z.string().regex(/^[a-zA-Z0-9_.:-]{8,80}$/).optional(),
      related_tool: tokenSchema.optional(),
    })
    .strict()
    .optional(),
}).strict();

export type SubmitProductFeedbackInput = z.infer<typeof submitProductFeedbackInputSchema>;

export const submitProductFeedbackTool = {
  name: 'submit_product_feedback',
  description:
    'File a product bug, idea, or general feedback on the public posterly feedback board (same board users see in the dashboard). Only call this when the human explicitly asks to report a bug, suggest a feature, or send feedback to posterly. Require confirm=true after they approve the title and category. Never use this for tool failures or retries - use submit_agent_feedback for private operational telemetry. Never include API keys, secrets, captions, media URLs, or personal data about third parties.',
  inputSchema: submitProductFeedbackInputSchema,

  async execute(client: PosterlyClient, input: SubmitProductFeedbackInput) {
    if (input.confirm !== true) {
      return 'Refusing to file product feedback without confirm=true after explicit user approval of the title and category.';
    }
    const result = await client.submitProductFeedback({
      ...input,
      source: input.source || 'mcp',
    });
    return [
      'Product feedback filed on the public board.',
      `• Feedback ID: ${result.feedback_id}`,
      `• Board: ${result.board_url}`,
      `• Request ID: ${result.request_id}`,
    ].join('\n');
  },
};
