import { z } from 'zod';
import type { ImageJob, PosterlyClient, VideoJob } from '../lib/api-client.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type JobsInput = { type: 'image' | 'video'; job_id?: string; status?: string; limit?: number };

export const listJobsTool = {
  name: 'list_jobs',
  description:
    'AI generation jobs. type=image: one image job by job_id, or recent image jobs when job_id is omitted (filter by status, limit); poll it after generate_image for the finished urls. type=video: one Veo or Grok video job by job_id, or recent video jobs (status includes dismissed, limit); poll it after generate_video for the finished video_url.',
  inputSchema: z.object({
    type: z.enum(['image', 'video']).describe('image or video.'),
    job_id: z.string().optional().describe('One job. Leave out to list recent jobs.'),
    status: z
      .enum(['pending', 'processing', 'completed', 'failed', 'dismissed'])
      .optional()
      .describe('Filter a job list. dismissed is video only.'),
    limit: z.number().int().min(1).max(50).default(10).optional(),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_image_job: z.object({
      job_id: z.string().optional(),
      status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    }),
    get_video_job: z.object({
      job_id: z.string().optional(),
      status: z.enum(['pending', 'processing', 'completed', 'failed', 'dismissed']).optional(),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    }),
  },

  async execute(client: PosterlyClient, input: JobsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_jobs', input);
    if (args.job_id) {
      const extra = ['status', 'limit'].filter((key) => args[key] !== undefined);
      if (extra.length) {
        throw new Error(`${extra.join(' and ')} cannot be combined with job_id. Pass job_id alone for one job, or leave it out to list recent jobs.`);
      }
    }
    const params = { job_id: args.job_id, status: args.status, limit: args.limit };
    return mode === 'video' ? videoJobs(client, params) : imageJobs(client, params);
  },
};

async function imageJobs(client: PosterlyClient, input: { job_id?: string; status?: string; limit?: number }): Promise<string> {
  const result = await client.getImageJob(input);
  if (result.job) return formatImageJob(result.job, true);

  const jobs = result.jobs || [];
  return [
    `Image jobs (${jobs.length})`,
    jobs.map((job) => formatImageJob(job, false)).join('\n\n'),
  ].filter(Boolean).join('\n');
}

async function videoJobs(client: PosterlyClient, input: { job_id?: string; status?: string; limit?: number }): Promise<string> {
  const result = await client.getVideoJob(input);
  if (result.job) return formatVideoJob(result.job, true);

  const jobs = result.jobs || [];
  return [
    `Video jobs (${jobs.length})`,
    jobs.map((job) => formatVideoJob(job, false)).join('\n\n'),
  ].filter(Boolean).join('\n');
}

function formatImageJob(job: ImageJob, includeRaw: boolean): string {
  const lines = [
    `${job.id}: ${job.status}`,
    `Prompt: ${job.prompt}`,
    `Model: ${job.model}; resolution: ${job.resolution}; thinking: ${job.thinking_level || 'n/a'}; cost: ${job.credit_cost}`,
    job.urls?.length ? `URLs: ${job.urls.join(', ')}` : null,
    job.error_message ? `Error: ${job.error_message}` : null,
    includeRaw ? `\nRaw job:\n${JSON.stringify(job, null, 2)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function formatVideoJob(job: VideoJob, includeRaw: boolean): string {
  const lines = [
    `${job.id}: ${job.status}`,
    `Prompt: ${job.prompt}`,
    `Model: ${job.model}; duration: ${job.duration_seconds}s; resolution: ${job.resolution || 'n/a'}; cost: ${job.credit_cost}`,
    job.video_url ? `Video URL: ${job.video_url}` : null,
    job.error_message ? `Error: ${job.error_message}` : null,
    includeRaw ? `\nRaw job:\n${JSON.stringify(job, null, 2)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
