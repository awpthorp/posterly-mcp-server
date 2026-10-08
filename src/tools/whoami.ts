import { z } from 'zod';
import { POSTERLY_MCP_VERSION } from '../lib/version.js';
import type { PosterlyClient } from '../lib/api-client.js';
import { resolvePosterlyBaseUrl } from '../lib/api-client.js';
import { code, mdKeyValue, mdTable, mdTitle } from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

const NPM_LATEST_URL = 'https://registry.npmjs.org/posterly-mcp-server/latest';

export const whoamiTool = {
  name: 'whoami',
  description:
    'Who you are and how posterly is connected. view=identity (default): the authenticated user, API key scopes, workspaces, and onboarding next step. ALWAYS call this at the start of a session; if onboarding.completed is false, walk the remaining onboarding steps IN THIS conversation (about you, connect, brand voice, first post) and do not send the user to /onboarding-v2 or the dashboard composer wizard. view=status: MCP server version, latest npm version, endpoint and API key health, and update guidance; works before POSTERLY_API_KEY is configured.',
  inputSchema: z.object({
    view: z
      .enum(['identity', 'status'])
      .optional()
      .describe('identity (default): user, scopes, workspaces, onboarding. status: MCP server and connection health.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_mcp_status: z.object({}),
  },

  async execute(client: PosterlyClient, input: { view?: 'identity' | 'status' }, ctx: ToolContext) {
    const { mode } = validateArgs(ctx, 'whoami', input);
    if (mode === 'status') return mcpStatus(client);
    return identity(client, ctx);
  },
};

async function identity(client: PosterlyClient, ctx: ToolContext): Promise<string> {
  const info = await client.whoami();

  const text = [
    mdTitle('posterly identity'),
    mdKeyValue([
      ['User', info.user.email || code(info.user.id)],
      ['API scopes', info.api_key.scopes.join(', ') || 'none'],
      ['Default workspace', `${info.default_workspace.name} (${code(info.default_workspace.id)})`],
      ['Default timezone', info.default_workspace.timezone || 'n/a'],
      ['Onboarding', info.onboarding?.completed ? 'complete' : info.onboarding?.next_step_label || 'unknown'],
    ]),
    info.onboarding && !info.onboarding.completed
      ? `**Onboarding next:** ${info.onboarding.next_step_label}. ${info.onboarding.instruction}`
      : '',
    mdTable(
      ['Workspace', 'Workspace ID', 'Role', 'Timezone', 'Default'],
      info.workspaces.map((workspace) => [
        `${workspace.name}${workspace.is_personal ? ' (personal)' : ''}`,
        code(workspace.id),
        workspace.role || 'member',
        workspace.timezone || 'n/a',
        workspace.id === info.default_workspace.id,
      ]),
    ),
    '**Tip:** Pass `workspace_id` to `create_post`, `list_posts`, `list_accounts`, and `find_available_slot` when you want the assistant to stay inside one workspace.',
  ].filter(Boolean).join('\n\n');

  // Only when tool sets are filtered, so the default answer is unchanged.
  const toolsets = ctx.toolsets;
  if (!toolsets || toolsets.all) return text;
  return `${text}\n\n**Tool sets:** ${toolsets.enabled.join(', ')} are listed in this connection. Every tool can still be called by name. To list every set, unset POSTERLY_TOOLSETS (or set it to all) and restart the MCP client.`;
}

async function mcpStatus(client: PosterlyClient): Promise<string> {
  const apiOrigin = client.getBaseUrl();
  const [latest, apiProbe, authProbe] = await Promise.all([
    fetchLatestNpmVersion(),
    probeHostedMcp(apiOrigin),
    client.hasApiKey() ? client.probeWhoami() : Promise.resolve(null),
  ]);
  const updateStatus = describeUpdateStatus(POSTERLY_MCP_VERSION, latest.version, latest.error);
  const versionMatch = apiProbe.version ? yesNo(apiProbe.version === POSTERLY_MCP_VERSION) : 'unknown';
  const rows: Array<[string, string | number | boolean]> = [
    ['Connection type', 'local app process (stdio)'],
    ['Current server version', POSTERLY_MCP_VERSION],
    ['Latest npm version', latest.version || 'unknown'],
    ['Update status', updateStatus],
    ['posterly API origin', code(apiOrigin)],
    ['MCP endpoint health', formatApiProbe(apiProbe)],
    ['Hosted MCP version', apiProbe.version || 'unknown'],
    ['Version match', versionMatch],
    ['API key configured', client.hasApiKey()],
    ['API auth check', formatAuthProbe(authProbe)],
  ];

  if (authProbe?.ok && authProbe.whoami) {
    rows.push(
      ['User', authProbe.whoami.user.email || code(authProbe.whoami.user.id)],
      ['Default workspace', `${authProbe.whoami.default_workspace.name} (${code(authProbe.whoami.default_workspace.id)})`],
      ['API scopes', authProbe.whoami.api_key.scopes.join(', ') || 'none'],
    );
  }

  return [
    mdTitle('posterly MCP status'),
    mdKeyValue(rows),
    latest.error ? `**Latest check:** ${latest.error}` : '',
    apiProbe.error ? `**MCP endpoint check:** ${apiProbe.error}` : '',
    authProbe && !authProbe.ok ? `**API auth check:** ${authProbe.error || 'API key validation failed'}` : '',
    nextStep({ hasApiKey: client.hasApiKey(), updateStatus, apiProbe, authProbe }),
  ].filter(Boolean).join('\n\n');
}

type HostedMcpProbe = {
  ok: boolean;
  status?: number;
  version?: string;
  error?: string;
  durationMs: number;
};

type AuthProbe = Awaited<ReturnType<PosterlyClient['probeWhoami']>> | null;

async function probeHostedMcp(apiOrigin: string): Promise<HostedMcpProbe> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${resolvePosterlyBaseUrl(apiOrigin)}/api/mcp`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    const data = parseJson(text);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: formatError(data, text, res.statusText),
        durationMs: Date.now() - startedAt,
      };
    }
    const version = typeof data?.serverInfo?.version === 'string' ? data.serverInfo.version : undefined;
    return {
      ok: Boolean(version),
      status: res.status,
      version,
      error: version ? undefined : 'Hosted MCP response did not include serverInfo.version',
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'timed out after 2500ms' : err?.message || String(err),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLatestNpmVersion(): Promise<{ version?: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(NPM_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `npm registry returned HTTP ${res.status}` };
    }
    const data = await res.json() as { version?: unknown };
    return typeof data.version === 'string'
      ? { version: data.version }
      : { error: 'npm registry response did not include a version' };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'timed out' : err?.message || String(err);
    return { error: `could not check npm latest: ${reason}` };
  } finally {
    clearTimeout(timeout);
  }
}

function describeUpdateStatus(current: string, latest?: string, error?: string): string {
  if (!latest) return error ? 'unknown' : 'unknown';

  const comparison = compareSemver(current, latest);
  if (comparison < 0) {
    return `update available: restart the MCP client or run ${code('npx -y posterly-mcp-server@latest')}`;
  }
  if (comparison > 0) {
    return 'running newer than npm latest; npm may not have been published yet';
  }
  return 'current';
}

function formatApiProbe(probe: HostedMcpProbe): string {
  if (probe.ok) return `ok (HTTP ${probe.status}, ${probe.durationMs}ms)`;
  const status = probe.status ? `HTTP ${probe.status}` : 'network';
  return `failed (${status}, ${probe.durationMs}ms)`;
}

function formatAuthProbe(probe: AuthProbe): string {
  if (!probe) return 'skipped (POSTERLY_API_KEY not configured)';
  if (probe.ok) return `valid (HTTP ${probe.status}, ${probe.durationMs}ms)`;
  const status = probe.status ? `HTTP ${probe.status}` : 'network';
  return `failed (${status}, ${probe.durationMs}ms)`;
}

function nextStep(input: {
  hasApiKey: boolean;
  updateStatus: string;
  apiProbe: HostedMcpProbe;
  authProbe: AuthProbe;
}): string {
  const { hasApiKey, updateStatus, apiProbe, authProbe } = input;
  if (updateStatus.startsWith('update available')) {
    return '**Next step:** Restart your MCP client so it pulls `posterly-mcp-server@latest`, then call `whoami` with `view: "status"` again.';
  }
  if (!apiProbe.ok) {
    return '**Next step:** Check `POSTERLY_URL` / `POSTERLY_API_BASE_URL`, DNS, and network access to the hosted MCP endpoint, then call `whoami` with `view: "status"` again.';
  }
  if (!hasApiKey) {
    return '**Next step:** Add `POSTERLY_API_KEY` after activating API and MCP access, then call `whoami`.';
  }
  if (authProbe && !authProbe.ok) {
    return '**Next step:** Create or reinstall a valid posterly API key, then restart the MCP client and call `whoami` with `view: "status"` again.';
  }
  return '**Next step:** Call `whoami` to confirm the user, workspace, and scopes before scheduling posts.';
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function parseJson(text: string): any {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

function formatError(data: any, fallback: string, statusText: string): string {
  if (data && typeof data === 'object') {
    return data.error || data.message || data.code || statusText || 'API request failed';
  }
  return fallback || statusText || 'API request failed';
}

function compareSemver(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function parts(value: string): [number, number, number] {
  const nums = value.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10));
  return [
    Number.isFinite(nums[0]) ? nums[0] : 0,
    Number.isFinite(nums[1]) ? nums[1] : 0,
    Number.isFinite(nums[2]) ? nums[2] : 0,
  ];
}
