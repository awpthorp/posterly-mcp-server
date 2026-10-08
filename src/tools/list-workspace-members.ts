import { z } from 'zod';
import type { PosterlyClient, WorkspaceMembersResponse } from '../lib/api-client.js';
import { code, mdKeyValue, mdSection, mdTable, mdTitle } from '../lib/format.js';

export function formatBrandIds(value: string[] | null | undefined): string {
  if (!Array.isArray(value)) return 'hidden';
  return value.length === 0 ? 'every brand' : value.map((id) => code(id)).join(', ');
}

/** API and AI app access for one member (issue #1170). */
export function formatApiAccess(member: { role?: string | null; api_access?: boolean; api_usage?: { key_count: number; last_used_at: string | null; connected_apps: string[] } }): string {
  if (member.api_access === undefined) return '';
  const base = member.role === 'owner' ? 'owner' : member.api_access ? 'on' : 'off';
  const usage = member.api_usage;
  if (!usage) return base;
  const parts: string[] = [];
  if (usage.key_count > 0) parts.push(`${usage.key_count} key${usage.key_count === 1 ? '' : 's'}`);
  if (usage.connected_apps.length > 0) parts.push(usage.connected_apps.join(', '));
  if (usage.last_used_at) parts.push(`last used ${usage.last_used_at}`);
  return parts.length > 0 ? `${base} (${parts.join('; ')})` : base;
}

function formatWorkspaceMembers(result: WorkspaceMembersResponse): string {
  const members = result.members || [];
  const invites = result.invites || [];
  return [
    mdTitle(`Team (${members.length} members, ${invites.length} pending invites)`, `Workspace ${result.workspace_id}`),
    mdSection('Members', members.length > 0
      ? mdTable(
          ['Name', 'Member ID', 'Email', 'Role', 'Status', 'Brands', 'API access'],
          members.map((member) => [
            member.name || member.email || member.id,
            code(member.id),
            member.email,
            member.role,
            member.status,
            formatBrandIds(member.brand_ids),
            formatApiAccess(member),
          ]),
        )
      : 'No members found.'),
    mdSection('Pending invites', invites.length > 0
      ? mdTable(
          ['Email', 'Invite ID', 'Role', 'Brands', 'Expires'],
          invites.map((invite) => [
            invite.email,
            code(invite.id),
            invite.role,
            formatBrandIds(invite.brand_ids),
            invite.expires_at,
          ]),
        )
      : ''),
    mdSection('Seats', mdKeyValue([
      ['Active members', result.usage?.active_members],
      ['Pending invites', result.usage?.pending_invites],
      ['Seats in use', result.usage?.seats_used],
    ])),
  ].filter(Boolean).join('\n\n');
}

export const listWorkspaceMembersTool = {
  name: 'list_workspace_members',
  description:
    'List the people in a workspace: members (with role, status, brand access and API access) and pending invites, plus seats in use. API access says whether a teammate can use this workspace\'s API plan from their own keys and AI apps; owners and admins also see each member\'s key count, connected AI apps and last use. Needs an API key with the Manage team permission. Any workspace member can list; brand-limited teammates only see brand ids they can access.',
  inputSchema: z.object({
    workspace_id: z.string().describe('Workspace ID (from whoami).'),
  }),

  async execute(client: PosterlyClient, input: { workspace_id: string }) {
    const workspaceId = input.workspace_id?.trim();
    if (!workspaceId) throw new Error('workspace_id is required. Get it from whoami.');
    return formatWorkspaceMembers(await client.listWorkspaceMembers(workspaceId));
  },
};
