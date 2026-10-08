import { z } from 'zod';
import type { ConnectSession, PosterlyClient } from '../lib/api-client.js';
import { DASHBOARD_CONNECT_URL, formatConnectedAccounts, formatLocalDateTime } from '../lib/format.js';
import { CONNECT_INPUTS } from '../generated/platform-manifest.js';

export const createConnectSessionTool = {
  name: 'create_connect_session',
  description:
    'Create a short-lived posterly dashboard handoff session for connecting a social account. Send the secure connection URL to the user, then poll list_accounts with view=connect_session to narrate progress. Do not ask for social media passwords or OAuth codes; posterly handles those browser steps.',
  inputSchema: z.object({
    platform: z
      .enum(CONNECT_INPUTS)
      .describe('Connection target such as instagram, meta, linkedin_page, twitter, google_business, telegram, bluesky, discord, mastodon, devto, hashnode, wordpress, or lemmy.'),
    workspace_id: z
      .string()
      .optional()
      .describe('Workspace to connect the account into. Workspace-scoped API keys ignore this.'),
    auto_start: z
      .boolean()
      .optional()
      .describe('When true, the dashboard starts the provider flow after the user opens the URL. Defaults to true.'),
    debug: z
      .boolean()
      .optional()
      .describe('When true, include the raw connect session JSON for debugging. Keep false for normal user-facing agent flows.'),
  }),

  async execute(
    client: PosterlyClient,
    input: { platform: string; workspace_id?: string; auto_start?: boolean; debug?: boolean },
  ) {
    const { debug, ...payload } = input;
    const result = await client.createConnectSession(payload);
    return formatConnectSession(result.connect_session, Boolean(debug));
  },
};

function formatConnectSession(session: ConnectSession, includeRaw: boolean): string {
  const connected = session.connected_count ?? session.connected_accounts?.length ?? 0;
  return [
    `posterly connect session created: ${session.id}`,
    `Platform: ${session.platform}`,
    `Status: ${session.status}`,
    `Message: ${session.status_message}`,
    `Secure connection URL: ${session.connect_url}`,
    `Poll URL: ${session.poll_url}`,
    `Connected accounts: ${connected}`,
    `Accounts: ${formatConnectedAccounts(session.connected_accounts)}`,
    `Expires: ${formatLocalDateTime(session.expires_at)}`,
    `Dashboard connect page: ${DASHBOARD_CONNECT_URL}`,
    '',
    'Next step for the AI agent: send the secure connection URL to the user, explain that posterly will handle the browser OAuth step, then poll list_accounts with view=connect_session until the account is connected or the session ends.',
    includeRaw ? `\nRaw connect session:\n${JSON.stringify(session, null, 2)}` : '',
  ].filter(Boolean).join('\n');
}
