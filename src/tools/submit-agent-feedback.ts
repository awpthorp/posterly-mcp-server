import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

const tokenSchema = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,63}$/);
const printableSchema = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      'Control characters are not allowed',
    );

export const submitAgentFeedbackInputSchema = z.object({
  source: z.enum(['mcp', 'cli', 'rest', 'skill']),
  tool: tokenSchema,
  outcome: z.enum(['success', 'error', 'abandoned']),
  error_code: tokenSchema.optional(),
  client: printableSchema(80).optional(),
  comment: printableSchema(1000)
    .refine(
      (value) => !/(?:pst_(?:live|test)_|sk-[a-z0-9_-]{12,})/i.test(value),
      'Comments must not contain secrets',
    )
    .optional(),
  context: z.object({
    request_id: z.string().regex(/^[a-zA-Z0-9_.:-]{8,80}$/).optional(),
    http_status: z.number().int().min(100).max(599).optional(),
    latency_ms: z.number().int().min(0).max(300000).optional(),
    attempt: z.number().int().min(1).max(20).optional(),
  }).strict().optional(),
}).strict();

export type SubmitAgentFeedbackInput = z.infer<typeof submitAgentFeedbackInputSchema>;

export const submitAgentFeedbackTool = {
  name: 'submit_agent_feedback',
  description:
    'Submit bounded private operational telemetry after a concrete posterly workflow outcome. This does not alter product content but writes a private feedback event. Never include API keys, prompts, captions, media URLs, personal data, or fabricated outcomes.',
  inputSchema: submitAgentFeedbackInputSchema,

  async execute(client: PosterlyClient, input: SubmitAgentFeedbackInput) {
    const result = await client.submitAgentFeedback(input);
    return [
      'Agent feedback accepted.',
      `• Feedback ID: ${result.feedback_id}`,
      `• Request ID: ${result.request_id}`,
    ].join('\n');
  },
};
