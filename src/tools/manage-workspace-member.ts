import { z } from 'zod';
import type {
  PosterlyClient,
  WorkspaceMemberChangeResponse,
  WorkspaceMemberRole,
} from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTitle } from '../lib/format.js';
import { formatApiAccess, formatBrandIds } from './list-workspace-members.js';

const ACTIONS = ['invite', 'update', 'remove'] as const;
const ROLES = ['publisher', 'editor', 'viewer'] as const;

export type ManageWorkspaceMemberInput = {
  action: (typeof ACTIONS)[number];
  workspace_id: string;
  email?: string;
  role?: WorkspaceMemberRole;
  brand_ids?: string[];
  resend?: boolean;
  member_id?: string;
  invite_id?: string;
  api_access?: boolean;
  confirm?: boolean;
  preview_id?: string;
};

const TITLES: Record<string, string> = {
  invited: 'Invite sent',
  invite_updated: 'Invite updated and sent again',
  invite_resent: 'Invite email sent again',
  already_invited: 'Already invited, nothing sent',
  added: 'Teammate added',
  updated: 'Access updated',
  removed: 'Teammate removed',
  revoked: 'Invite revoked',
};

function formatChange(result: WorkspaceMemberChangeResponse): string {
  if (result.requires_confirmation && result.preview) {
    const preview = result.preview;
    return [
      mdTitle('Preview only: nothing has changed yet'),
      preview.summary,
      mdSection('Details', mdKeyValue([
        ['Action', preview.action],
        ['Email', preview.email],
        ['Role', preview.previous_role && preview.previous_role !== preview.role ? `${preview.previous_role} -> ${preview.role}` : preview.role],
        ['Brands', preview.brand_ids ? formatBrandIds(preview.brand_ids) : ''],
        ['Sends an email', preview.sends_email ? 'yes' : 'no'],
        ['Seats', preview.counts_toward_seats && preview.seat_limit != null
          ? `${preview.seats_used} in use of ${preview.seat_limit === -1 ? 'unlimited' : preview.seat_limit}`
          : ''],
        ['API access', typeof preview.api_access === 'boolean'
          ? `${preview.previous_api_access ? 'on' : 'off'} -> ${preview.api_access ? 'on' : 'off'}`
          : ''],
      ])),
      mdSection('Preview ID', `${code(result.preview_id || '')} (expires ${result.preview_expires_at || 'soon'})`),
      mdSection('Next step', 'Show this preview to the user. Only after they explicitly approve, call manage_workspace_member again with the same fields plus confirm: true and this preview_id.'),
    ].filter(Boolean).join('\n\n');
  }
  const subject = result.invite || result.member;
  return [
    mdTitle(TITLES[result.status || ''] || 'Team updated'),
    result.message || '',
    mdSection('Details', mdKeyValue([
      [result.invite ? 'Invite ID' : 'Member ID', subject?.id ? code(subject.id) : ''],
      ['Email', subject?.email],
      ['Role', subject?.role],
      ['Status', subject?.status],
      ['Brands', subject?.brand_ids ? formatBrandIds(subject.brand_ids) : ''],
      ['API access', result.member ? formatApiAccess(result.member) : ''],
      ['Invite email sent', typeof result.email_sent === 'boolean' ? (result.email_sent ? 'yes' : 'no, ask them to check spam or resend later') : ''],
      ['Workspace owner notified', result.owner_notified ? 'yes' : ''],
    ])),
  ].filter(Boolean).join('\n\n');
}

function has(input: Record<string, unknown>, key: string): boolean {
  return input[key] !== undefined && input[key] !== null;
}

/** Per-action validation with clear errors. Exported for tests. */
export function validateManageWorkspaceMemberInput(input: ManageWorkspaceMemberInput): string | null {
  const raw = input as unknown as Record<string, unknown>;
  if (!ACTIONS.includes(input.action)) return 'action must be one of: invite, update, remove.';
  if (!input.workspace_id?.trim()) return 'workspace_id is required. Get it from whoami.';
  if (input.confirm === true && !input.preview_id) {
    return 'confirm: true needs the preview_id from a preview call. Call once without confirm, show the preview to the user, then confirm.';
  }
  if (input.action === 'invite') {
    const extra = ['member_id', 'invite_id'].filter((key) => has(raw, key));
    if (extra.length) return `action=invite does not take ${extra.join(', ')}. To change an existing seat use action=update.`;
    if (!has(raw, 'email') || !has(raw, 'role')) return 'action=invite needs email and role (publisher, editor or viewer).';
    return null;
  }
  const notAllowed = input.action === 'update' ? ['email', 'resend'] : ['email', 'resend', 'role', 'brand_ids', 'api_access'];
  const extra = notAllowed.filter((key) => has(raw, key));
  if (extra.length) return `action=${input.action} does not take ${extra.join(', ')}.`;
  if (has(raw, 'member_id') === has(raw, 'invite_id')) {
    return `action=${input.action} needs exactly one of member_id or invite_id (from list_workspace_members).`;
  }
  if (input.action === 'update' && has(raw, 'api_access')) {
    if (has(raw, 'invite_id')) return 'api_access can only be set on a member (member_id), not a pending invite.';
    if (has(raw, 'role') || has(raw, 'brand_ids')) return 'Change api_access in its own call, without role or brand_ids.';
    return null;
  }
  if (input.action === 'update' && !has(raw, 'role') && !has(raw, 'brand_ids')) {
    return 'action=update needs role, brand_ids, or both; or api_access on its own.';
  }
  return null;
}

export const manageWorkspaceMemberTool = {
  name: 'manage_workspace_member',
  description:
    'Invite, update, or remove a workspace colleague. This SENDS EMAILS and CHANGES WHO CAN ACCESS the workspace. Needs an API key with the Manage team permission, and the caller must be a workspace owner or admin. ALWAYS preview first: call without confirm, show the returned preview summary to the user, and only call again with confirm: true plus the returned preview_id after the user explicitly approves. action=invite: email and role required (publisher, editor or viewer), optional brand_ids and resend; always sends a pending invite email, never adds anyone instantly. action=update: member_id or invite_id (from list_workspace_members) plus role and/or brand_ids; or member_id plus api_access (true or false, on its own) to turn API and AI app access on or off for that teammate, which lets them use the workspace API plan from their own keys and AI apps (off by default; you cannot change your own; only the owner can change it for an admin; turning it off stops their keys, AI app connections and webhooks for this workspace). action=remove: member_id (removes the teammate and revokes their API keys for this workspace) or invite_id (cancels a pending invite). Admin seats can only be granted in the posterly dashboard. The workspace owner is emailed about every change.',
  inputSchema: z.object({
    action: z.enum(ACTIONS).describe('invite, update, or remove.'),
    workspace_id: z.string().describe('Workspace ID (from whoami).'),
    email: z.string().optional().describe('action=invite only: the colleague email address.'),
    role: z.enum(ROLES).optional().describe('action=invite (required) or action=update: publisher, editor, or viewer. Admin is dashboard-only.'),
    brand_ids: z.array(z.string()).max(100).optional().describe('action=invite or action=update: limit the seat to these brand IDs (from list_brands). Empty array means every brand. Omit on update to keep the current brands.'),
    resend: z.boolean().optional().describe('action=invite only: email an unchanged pending invite again.'),
    member_id: z.string().optional().describe('action=update or action=remove: a member ID from list_workspace_members.'),
    invite_id: z.string().optional().describe('action=update or action=remove: a pending invite ID from list_workspace_members.'),
    api_access: z.boolean().optional().describe('action=update with member_id only, on its own: true lets the teammate use this workspace\'s API plan from their own keys and AI apps; false turns it off.'),
    confirm: z.boolean().optional().describe('Leave out to get a preview. Set true only after the user explicitly approved the preview, together with preview_id.'),
    preview_id: z.string().optional().describe('The preview_id returned by the preview call. Required with confirm: true.'),
  }),

  async execute(client: PosterlyClient, input: ManageWorkspaceMemberInput) {
    const problem = validateManageWorkspaceMemberInput(input);
    if (problem) throw new Error(problem);

    const workspaceId = input.workspace_id.trim();
    const confirmFields = {
      ...(input.confirm === true ? { confirm: true } : {}),
      ...(input.preview_id ? { preview_id: input.preview_id } : {}),
    };
    const target = input.member_id ? { member_id: input.member_id } : { invite_id: input.invite_id };

    let result: WorkspaceMemberChangeResponse;
    if (input.action === 'invite') {
      result = await client.inviteWorkspaceMember(workspaceId, {
        email: input.email as string,
        role: input.role as WorkspaceMemberRole,
        ...(input.brand_ids !== undefined ? { brand_ids: input.brand_ids } : {}),
        ...(input.resend !== undefined ? { resend: input.resend } : {}),
        ...confirmFields,
      });
    } else if (input.action === 'update') {
      result = await client.updateWorkspaceMember(workspaceId, target, {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.brand_ids !== undefined ? { brand_ids: input.brand_ids } : {}),
        ...(input.api_access !== undefined ? { api_access: input.api_access } : {}),
        ...confirmFields,
      });
    } else {
      result = await client.removeWorkspaceMember(workspaceId, target, confirmFields);
    }
    return formatChange(result);
  },
};
