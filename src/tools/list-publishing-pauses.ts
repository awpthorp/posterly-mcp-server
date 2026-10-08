import { z } from 'zod';
import type {
  PosterlyClient,
  PublishingPauseChangeResponse,
  PublishingPauseState,
  PublishMissedResponse,
} from '../lib/api-client.js';

// Plain-text output shared by list_publishing_pauses and
// manage_publishing_pause. The hosted endpoint (lib/mcp/http-tools.ts) renders
// the same text from the same API responses; scripts/test-publishing-pause-api.ts
// checks the two surfaces match.

function yesNo(value: unknown): string {
  return value ? 'yes' : 'no';
}

function idList(ids: number[] | undefined): string {
  return Array.isArray(ids) && ids.length > 0 ? ids.join(', ') : 'none';
}

function scopeText(data: { scope?: string; workspace_id?: string; brand_id?: string | null; brand_name?: string | null; workspace_name?: string | null }): string {
  if (data.scope === 'brand') return `brand ${data.brand_name ? `${data.brand_name} ` : ''}(${data.brand_id})`;
  return `the workspace ${data.workspace_name ? `${data.workspace_name} ` : ''}(${data.workspace_id})`;
}

export function formatPublishingPauseState(data: PublishingPauseState): string {
  const workspace = data.workspace;
  const brands = Array.isArray(data.brands) ? data.brands : [];
  const viewer = data.viewer;
  return [
    `Publishing pause for ${workspace.name || 'this workspace'} (${workspace.id})`,
    `Workspace: ${workspace.paused ? `paused since ${workspace.paused_at}` : 'publishing normally'}`,
    brands.length > 0
      ? ['Paused brands:', ...brands.map((brand) => `- ${brand.name || 'Unnamed brand'} (${brand.id}), paused since ${brand.paused_at}`)].join('\n')
      : 'Paused brands: none',
    `Your role: ${viewer.role}. Pause the workspace: ${yesNo(viewer.can_pause_workspace)}. Pause a brand: ${yesNo(viewer.can_pause_brand)}. Resume and publish missed posts: ${yesNo(viewer.can_resume)}.`,
    'While paused, nothing in that scope publishes (scheduled posts are held, Post now is refused). Pause and resume with manage_publishing_pause.',
  ].join('\n');
}

export function formatPublishingPauseChange(data: PublishingPauseChangeResponse): string {
  if (data.requires_confirmation) {
    return [
      'Preview only: nothing has changed yet.',
      data.error || '',
      `Scope: ${scopeText(data)}`,
      `Scheduled posts to hold: ${typeof data.scheduled_posts_to_hold === 'number' ? data.scheduled_posts_to_hold : 'unknown'}`,
      `Already paused: ${yesNo(data.already_paused)}`,
      'Next step: show this to the user. Only after they agree, call manage_publishing_pause again with action=pause, the same fields, and confirm=true.',
    ].filter(Boolean).join('\n');
  }

  if (data.action === 'pause') {
    const failed = data.failed_post_ids || [];
    return [
      `Publishing paused for ${scopeText(data)}.`,
      `Held posts: ${data.held_count ?? 0}`,
      failed.length > 0 ? `Posts that could not be marked as held (the publish guard still holds them): ${idList(failed)}` : '',
      data.message || '',
    ].filter(Boolean).join('\n');
  }

  const missed = data.missed_post_ids || [];
  const failed = data.failed_post_ids || [];
  return [
    `Publishing resumed for ${scopeText(data)}.`,
    `Scheduled again: ${data.resumed_count ?? 0}`,
    `Missed their time while paused (still paused): ${missed.length}${missed.length > 0 ? ` [post IDs: ${idList(missed)}]` : ''}`,
    `Still held by another pause: ${data.still_held_count ?? 0}`,
    (data.disconnected_count ?? 0) > 0 ? `Still paused because the account is disconnected: ${data.disconnected_count}` : '',
    failed.length > 0 ? `Could not be released (try resume again): ${idList(failed)}` : '',
    missed.length > 0
      ? 'Next step: missed posts never publish on their own. Ask the user whether to publish them now (action=publish_missed with these post_ids and confirm=true) or reschedule them.'
      : '',
  ].filter(Boolean).join('\n');
}

export function formatPublishMissed(data: PublishMissedResponse): string {
  return [
    `Missed posts: ${data.started} publishing now, ${data.skipped} skipped.`,
    data.message || '',
  ].filter(Boolean).join('\n');
}

export const listPublishingPausesTool = {
  name: 'list_publishing_pauses',
  description:
    'Is publishing paused? Shows whether the workspace is paused, which brands are paused (only brands you can see), and whether you may pause, resume, or publish missed posts. Read-only. Change it with manage_publishing_pause.',
  inputSchema: z.object({
    workspace_id: z.string().optional().describe('Workspace ID from whoami. Defaults to your default workspace.'),
  }),

  async execute(client: PosterlyClient, input: { workspace_id?: string }) {
    const state = await client.getPublishingPause(input.workspace_id ? { workspace_id: input.workspace_id } : undefined);
    return formatPublishingPauseState(state);
  },
};
