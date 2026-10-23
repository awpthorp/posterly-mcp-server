import { z } from 'zod';
import type { PosterlyClient } from '../lib/api-client.js';

export const getAgentSignupInfoTool = {
  name: 'get_agent_signup_info',
  description:
    'Explain how to use posterly MCP for agent-led signup before an API key exists, including the safe human-in-the-browser boundaries.',
  inputSchema: z.object({}),

  async execute(client: PosterlyClient) {
    const authState = client.hasApiKey()
      ? 'posterly API key is installed. Authenticated scheduling and connect tools are available.'
      : 'No posterly API key is installed. Only public setup tools are available until the user starts the free trial and gives this AI posterly access.';

    return [
      'posterly agent signup info',
      '',
      authState,
      '',
      'Pre-auth tools:',
      '- whoami with view=status: checks the installed server version, latest npm version, MCP endpoint health, API auth health, and whether POSTERLY_API_KEY is configured.',
      '- start_signup: starts the card-backed 7-day free trial (nothing is charged today; the card is charged on day 8 unless the paid plan starts sooner) and returns a signup poll URL, a browser Checkout handoff, and a payment object with the trial length, whether anything is charged today, and agent-wallet instructions. An account that already had a trial is charged at checkout. The API add-on is still required. Agent-card pay is not available during a trial.',
      '- get_signup_session: polls checkout, card save, password, and agent-access status.',
      '',
      'After posterly access is installed, onboard the user IN THIS chat (do not send them to /onboarding-v2):',
      '- whoami: confirm the account and read onboarding.next_step.',
      '- About you: confirm name and IANA timezone.',
      '- create_connect_session, then list_accounts with view=connect_session: first social account in the browser.',
      '- Brand voice: ask how they want to sound, then use that on captions.',
      '- create_post: first scheduled post after validate_post and explicit confirm.',
      '',
      'Conversation style:',
      '- Keep the user updated in plain language: checkout pending, payment confirmed, password setup needed, account connected, post scheduled.',
      '- Prefer the posterly dashboard links returned by tools when the user wants to inspect posts.',
      '- Do not narrate raw curl, HTTP, JSON, API keys, or implementation details unless the user explicitly asks for debugging.',
      '',
      'Boundaries:',
      '- Checkout starts a 7-day free trial for a new account: a card is required, nothing is charged today, and the card is charged on day 8 unless the paid plan starts sooner. The user enters the card in their browser.',
      '- If you complete Checkout yourself, use only a reusable card the person has approved for recurring posterly charges. A one-time virtual card fails on day 8.',
      '- Never send card numbers to posterly. Send checkout_redirect_url, or complete that Checkout page with a reusable card.',
      '- Agent-card pay (a prepaid PaymentIntent) is not available during the trial.',
      '- The user sets their posterly password in their browser.',
      '- The user approves social OAuth in their browser.',
      '- Publish approval stays with the user.',
      '- The AI should never ask for card details, posterly passwords, social passwords, or OAuth codes.',
    ].join('\n');
  },
};
