import { z } from 'zod';
import type { ConnectSession, PosterlyClient } from '../lib/api-client.js';
import {
  DASHBOARD_CONNECT_URL,
  code,
  formatConnectedAccounts,
  formatDateTime,
  formatLocalDateTime,
  formatPercent,
  mdBullets,
  mdEmpty,
  mdKeyValue,
  mdLearnedVoice,
  mdQuote,
  mdSection,
  mdTable,
  mdTitle,
} from '../lib/format.js';
import { validateArgs, type ToolContext } from '../lib/tool-runtime.js';

type ListAccountsInput = {
  view?: 'accounts' | 'learned_voice' | 'performance_profile' | 'connect_session';
  workspace_id?: string;
  account_id?: string | number;
  session_id?: string;
  debug?: boolean;
};

export const listAccountsTool = {
  name: 'list_accounts',
  description:
    "Connected social accounts and what posterly has learned about them. view=accounts (default): connected accounts, optionally one workspace_id or one account_id; Instagram rows identify direct-login versus Meta-linked connections and whether native media tags/collaborators are available, so check this before Instagram user_tags or collaborators. view=learned_voice (account_id): the voice learned from the account's real published captions (summary, traits, style guidelines, habits); read-only, never overwrites the saved brand profile. view=performance_profile (account_id): 90-day coaching stats, engagement-rate trend, and summary (Pro plan or higher; platforms without per-post analytics never get one). view=connect_session (session_id): poll a session from create_connect_session and keep the user updated in plain language; stop when status is connected, failed, cancelled, or expired.",
  inputSchema: z.object({
    view: z
      .enum(['accounts', 'learned_voice', 'performance_profile', 'connect_session'])
      .optional()
      .describe('accounts (default), learned_voice, performance_profile, or connect_session.'),
    workspace_id: z
      .string()
      .optional()
      .describe('view=accounts: filter to accounts in a specific workspace (get IDs via whoami).'),
    account_id: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Social account ID from list_accounts. Required for learned_voice and performance_profile; with view=accounts it returns just that account.'),
    session_id: z.string().optional().describe('view=connect_session: connect session ID returned by create_connect_session.'),
    debug: z
      .boolean()
      .optional()
      .describe('view=connect_session: when true, include the raw connect session JSON for debugging. Keep false for normal user-facing agent flows.'),
  }),
  /** The old tools' exact input schemas, for alias calls (see alias-transport.ts). */
  legacySchemas: {
    get_learned_voice: z.object({ account_id: z.union([z.string(), z.number()]) }),
    get_performance_profile: z.object({ account_id: z.union([z.string(), z.number()]) }),
    get_connect_session: z.object({ session_id: z.string(), debug: z.boolean().optional() }),
  },

  async execute(client: PosterlyClient, input: ListAccountsInput, ctx: ToolContext) {
    const { mode, args } = validateArgs(ctx, 'list_accounts', input);
    if (mode === 'learned_voice') return learnedVoice(client, args as { account_id: string | number });
    if (mode === 'performance_profile') return performanceProfile(client, args as { account_id: string | number });
    if (mode === 'connect_session') {
      const result = await client.getConnectSession(args.session_id);
      return formatConnectSession(result.connect_session, Boolean(args.debug));
    }
    return accountsList(client, args as ListAccountsInput);
  },
};

async function accountsList(client: PosterlyClient, input: ListAccountsInput): Promise<string> {
  const listed = await client.listAccounts({ workspace_id: input.workspace_id });
  // There is no GET /accounts/:id, so account_id filters the list here.
  const accounts = input.account_id !== undefined
    ? listed.filter((account) => String(account.id) === String(input.account_id))
    : listed;

  if (input.account_id !== undefined && accounts.length === 0) {
    return mdEmpty('connected account', `No connected account has the ID ${String(input.account_id)}.`);
  }

  if (accounts.length === 0) {
    return input.workspace_id
      ? mdEmpty('connected accounts', 'This workspace does not have any social accounts connected yet.')
      : mdEmpty('connected accounts', 'posterly does not see any connected social accounts yet.', 'Connect accounts in the posterly dashboard, then run this again.');
  }

  const hasInstagram = accounts.some((account) => account.platform === 'instagram');

  return [
    mdTitle(`Connected accounts (${accounts.length})`),
    mdTable(
      hasInstagram
        ? ['Platform', 'Account', 'Account ID', 'Workspace', 'Connection', 'Native tags', 'Collaborators']
        : ['Platform', 'Account', 'Account ID', 'Workspace'],
      accounts.map((account) => [
        account.platform,
        `@${account.username}`,
        code(account.id),
        account.workspace_id ? code(account.workspace_id) : 'default',
        ...(hasInstagram
          ? account.platform === 'instagram'
            ? [
                account.connection_mode === 'meta' ? 'Meta-linked' : account.connection_mode === 'instagram_direct' ? 'Direct login' : 'unknown',
                account.instagram_tagging?.media_user_tags?.supported ? 'yes' : 'no',
                account.instagram_tagging?.collaborators?.supported ? 'yes' : 'no',
              ]
            : ['n/a', 'n/a', 'n/a']
          : []),
      ]),
    ),
    hasInstagram
      ? '_Instagram caption @mentions use @username in caption text. Native media tags work with eligible direct or Meta-linked accounts; collaborator invitations require an eligible Meta-linked account._'
      : '',
  ].filter(Boolean).join('\n\n');
}

async function learnedVoice(client: PosterlyClient, input: { account_id: string | number }): Promise<string> {
  const { learned_voice } = await client.getAccountLearnedVoice(input.account_id);

  const body = mdLearnedVoice(learned_voice);
  if (!body) {
    return [
      mdTitle('No learned voice yet'),
      'posterly has not learned a voice for this account yet. It learns automatically once the account has enough published posts (the captions are analyzed; the saved brand profile is never overwritten).',
    ].join('\n\n');
  }

  return [mdTitle('Learned voice (from published captions)'), body].join('\n\n');
}

async function performanceProfile(client: PosterlyClient, input: { account_id: string | number }): Promise<string> {
  const { performance_profile, reason } = await client.getAccountPerformanceProfile(input.account_id);

  if (!performance_profile) {
    const detail = reason === 'platform_not_measurable'
      ? 'This platform does not produce per-post analytics, so posterly cannot build a performance profile for it.'
      : reason === 'feature_not_available'
        ? 'Performance profiles require a Pro plan or higher.'
        : 'posterly has not built a performance profile for this account yet. It needs about 90 days of tracked posts to learn from.';
    return mdEmpty('performance profile yet', detail);
  }

  const label = performance_profile.username
    ? `@${performance_profile.username}${performance_profile.platform ? ` (${performance_profile.platform})` : ''}`
    : `account ${performance_profile.social_account_id}`;

  const rate = performance_profile.engagement_rate_avg != null
    ? formatPercent(performance_profile.engagement_rate_avg * 100)
    : 'n/a';

  return [
    mdTitle('Account performance profile', `${label} · last ${performance_profile.window_days ?? 90} days`),
    performance_profile.narrative_summary ? mdSection('Summary', mdQuote(performance_profile.narrative_summary)) : '',
    performance_profile.bullets.length ? mdSection('What is working', mdBullets(performance_profile.bullets)) : '',
    mdSection('Stats', mdKeyValue([
      ['Posts sampled', performance_profile.sample_size],
      ['Avg engagement rate', rate],
      ['Engagement trend', performance_profile.engagement_rate_trend],
      ['Derived at', formatDateTime(performance_profile.derived_at)],
    ])),
  ].filter(Boolean).join('\n\n');
}

function formatConnectSession(session: ConnectSession, includeRaw: boolean): string {
  const connected = session.connected_count ?? session.connected_accounts?.length ?? 0;
  return [
    `posterly connect session: ${session.id}`,
    `Platform: ${session.platform}`,
    `Status: ${session.status}`,
    `Message: ${session.status_message}`,
    `Connected accounts: ${connected}`,
    `Accounts: ${formatConnectedAccounts(session.connected_accounts)}`,
    session.error_message ? `Error: ${session.error_message}` : '',
    `Expires: ${formatLocalDateTime(session.expires_at)}`,
    `Dashboard connect page: ${DASHBOARD_CONNECT_URL}`,
    '',
    guidanceForStatus(session),
    includeRaw ? `\nRaw connect session:\n${JSON.stringify(session, null, 2)}` : '',
  ].filter(Boolean).join('\n');
}

function guidanceForStatus(session: ConnectSession): string {
  switch (session.status) {
    case 'created':
    case 'opened':
    case 'awaiting_provider':
      return 'Next step for the AI agent: tell the user posterly is waiting for browser approval, then keep polling this session. Do not ask for social passwords or OAuth codes.';
    case 'awaiting_credentials':
      return 'Next step for the AI agent: tell the user posterly needs them to finish the browser credential step, then keep polling. Do not ask the user to paste credentials into chat.';
    case 'connected':
      return `Next step for the AI agent: tell the user ${formatConnectedAccounts(session.connected_accounts)} is connected, then ask what they want to schedule first or offer to create a test post.`;
    case 'failed':
      return 'Next step for the AI agent: tell the user the connection failed, share the error if present, and offer to create a fresh connect session.';
    case 'cancelled':
      return 'Next step for the AI agent: tell the user the connection was cancelled and offer to create a fresh connect session when they are ready.';
    case 'expired':
      return 'Next step for the AI agent: tell the user the connection link expired and create a fresh connect session if they still want to connect this account.';
    default:
      return 'Next step for the AI agent: explain the current connection status in plain language and keep polling unless the session is terminal.';
  }
}
