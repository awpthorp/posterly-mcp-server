import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';
import { formatPublishingPauseChange, formatPublishMissed } from './list-publishing-pauses.js';

/** Same wording as EMPTY_BRAND_ID_MESSAGE in lib/publish/publishing-pause-service.ts. */
const EMPTY_BRAND_ID_MESSAGE = 'brand_id is empty; omit it to target the whole workspace.';

type ManagePublishingPauseInput = {
  action: 'pause' | 'resume' | 'publish_missed';
  workspace_id?: string;
  brand_id?: string;
  post_ids?: number[];
  confirm?: boolean;
};

export const managePublishingPauseTool = {
  name: 'manage_publishing_pause',
  description:
    'Pause or resume publishing for a whole workspace or one brand (check it first with list_publishing_pauses). Only act when the user asks; never pause on your own initiative. action=pause (optional brand_id; leave it out for the whole workspace): holds every scheduled post in that scope and blocks Post now until an admin resumes. Call it first without confirm to get a preview (scope and how many scheduled posts it holds), show it to the user, and only after they agree call again with confirm=true. Publisher or higher; a seat limited to some brands can only pause those brands. action=resume (optional brand_id; admin or higher): future posts are scheduled again; posts whose time passed while paused stay paused and are listed as missed. Missed posts never publish on their own. action=publish_missed (post_ids from the resume, confirm=true after the user agrees; admin or higher): publishes those missed posts now.',
  inputSchema: z.object({
    action: z.enum(['pause', 'resume', 'publish_missed']).describe('pause, resume, or publish_missed.'),
    workspace_id: z.string().optional().describe('Workspace ID from whoami. Defaults to your default workspace.'),
    brand_id: z.string().optional().describe('pause and resume: a brand ID from list_brands. Leave it out (never empty) for the whole workspace.'),
    post_ids: z.array(z.number().int().positive()).max(500).optional().describe('publish_missed: the missed post IDs a resume returned.'),
    confirm: z.boolean().optional().describe('pause: leave out to get a preview; true only after the user agreed. publish_missed: true after the user agreed. resume: not needed.'),
  }),

  async execute(client: PosterlyClient, input: ManagePublishingPauseInput, ctx: ToolContext) {
    // A present but empty brand_id is refused, never read as the whole
    // workspace (same rule and wording as the API and the hosted endpoint).
    if ((input?.action === 'pause' || input?.action === 'resume') && input && Object.prototype.hasOwnProperty.call(input, 'brand_id')) {
      const value = (input as { brand_id?: unknown }).brand_id;
      if (value === null || (typeof value === 'string' && value.trim() === '')) throw new Error(EMPTY_BRAND_ID_MESSAGE);
    }
    const { mode, args } = validateArgs(ctx, 'manage_publishing_pause', input);
    const call = args as ManagePublishingPauseInput;
    const workspace = call.workspace_id ? { workspace_id: call.workspace_id } : {};

    if (mode === 'publish_missed') {
      if (call.confirm !== true) {
        throw new Error('Refusing to publish missed posts without confirm=true after explicit user confirmation.');
      }
      const result = await client.publishMissedPausedPosts({ ...workspace, post_ids: call.post_ids || [], confirm: true });
      return formatPublishMissed(result);
    }

    const brand = call.brand_id ? { brand_id: call.brand_id } : {};
    if (mode === 'pause') {
      const result = await client.changePublishingPause({
        action: 'pause',
        ...workspace,
        ...brand,
        ...(call.confirm === true ? { confirm: true } : {}),
      });
      return formatPublishingPauseChange(result);
    }

    const result = await client.changePublishingPause({ action: 'resume', ...workspace, ...brand });
    return formatPublishingPauseChange(result);
  },
};
