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
      : 'No posterly API key is installed. Only public setup tools are available until the user completes paid setup and gives this AI posterly access.';

    return [
      'posterly agent signup info',
      '',
      authState,
      '',
      'Pre-auth tools:',
      '- whoami with view=status: checks the installed server version, latest npm version, MCP endpoint health, API auth health, and whether POSTERLY_API_KEY is configured.',
      '- start_signup: starts paid signup and returns a signup poll URL, a browser Checkout fallback, and, when enabled, a prepaid PaymentIntent for a Link virtual card (credential_type: card).',
      '- get_signup_session: polls payment, password, and agent-access status.',
      '',
      'After posterly access is installed, onboard the user IN THIS chat (do not send them to /onboarding-v2):',
      '- whoami: confirm the paid account and read onboarding.next_step.',
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
      '- Payment happens on Stripe Checkout, either by the user in their browser or by the agent with its own approved payment credential (for example a Link agent wallet); never card details in chat.',
      '- Where enabled, payment can instead be a one-time Link Agent Wallet virtual card (credential_type: card) on a prepaid PaymentIntent.',
      '- Never send card numbers to posterly. Confirm the PaymentIntent with Stripe, or send checkout_redirect_url.',
      '- The user sets their posterly password in their browser.',
      '- The user approves social OAuth in their browser.',
      '- Publish approval stays with the user.',
      '- The AI should never ask for card details, posterly passwords, social passwords, or OAuth codes.',
    ].join('\n');
  },
};
