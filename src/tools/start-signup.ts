import { z } from 'zod';
import type { PosterlyClient, PublicSignupResponse, PublicSignupTier } from '../lib/api-client.js';

const DEFAULT_RETURN_PATH = '/dashboard/api?api_signup=success';

export const startSignupTool = {
  name: 'start_signup',
  description:
    'Start the public posterly paid signup flow for a user before posterly API access exists. Returns a signup poll URL, a browser Checkout fallback URL, and, when enabled, a prepaid PaymentIntent the agent can pay with a Link Agent Wallet virtual card (credential_type: card). The user still sets a password and approves social OAuth in the browser. Never ask for card numbers, a posterly password, or social passwords in chat.',
  inputSchema: z.object({
    email: z
      .string()
      .email()
      .describe('User email address to sign up. Confirm this with the user before calling.'),
    name: z
      .string()
      .optional()
      .describe('Optional user or workspace name to pass into posterly signup.'),
    tier: z
      .enum(['starter', 'pro', 'power_user', 'agency'])
      .default('starter')
      .describe('posterly plan to start. Use starter unless the user explicitly chooses another plan.'),
    interval: z
      .enum(['month'])
      .default('month')
      .describe('Billing interval. Public agent signup currently supports monthly billing.'),
    api_addon: z
      .boolean()
      .default(true)
      .describe('Always true for AI agent setup because MCP/API access requires the API add-on.'),
    return_path: z
      .string()
      .default(DEFAULT_RETURN_PATH)
      .describe('Where posterly should continue after checkout and password setup.'),
    source: z
      .string()
      .default('posterly_mcp_pre_auth_signup')
      .describe('Source label for analytics and support diagnostics.'),
    tos_accepted: z
      .boolean()
      .optional()
      .describe('Set true only after the user has explicitly confirmed, in this conversation, that they accept the posterly terms at https://www.poster.ly/terms. Sending it here avoids a separate terms-confirmation step before client_secret is released.'),
    debug: z
      .boolean()
      .optional()
      .describe('When true, include the raw signup response JSON for debugging. Keep false for normal user-facing agent flows.'),
  }),

  async execute(
    client: PosterlyClient,
    input: {
      email: string;
      name?: string;
      tier?: PublicSignupTier;
      interval?: 'month';
      api_addon?: boolean;
      return_path?: string;
      source?: string;
      tos_accepted?: boolean;
      debug?: boolean;
    },
  ) {
    const response = await client.startSignup({
      email: input.email,
      name: input.name,
      tier: input.tier ?? 'starter',
      interval: input.interval ?? 'month',
      api_addon: input.api_addon ?? true,
      return_path: input.return_path ?? DEFAULT_RETURN_PATH,
      source: input.source ?? 'posterly_mcp_pre_auth_signup',
      tos_accepted: input.tos_accepted,
    });

    return formatSignupStart(response, Boolean(input.debug));
  },
};

function valueFromLinks(response: PublicSignupResponse, key: string): string | null {
  const links = response.signup_session?.links ?? response.links;
  const value = links?.[key];
  return typeof value === 'string' ? value : null;
}

function formatSignupStart(response: PublicSignupResponse, includeRaw: boolean): string {
  const session = response.signup_session;
  const sessionId = session?.id || response.checkout_session_id;
  const checkoutUrl = response.checkout_url || valueFromLinks(response, 'checkout_url');
  const checkoutRedirectUrl = response.checkout_redirect_url || session?.checkout_redirect_url || valueFromLinks(response, 'checkout_redirect_url');
  const pollUrl = response.poll_url || valueFromLinks(response, 'poll_url');
  const completeUrl = response.complete_url || valueFromLinks(response, 'complete_url');
  const status = session?.status || response.status || 'checkout_pending';
  const message = session?.status_message || response.status_message;
  const agentPay = response.agent_pay || session?.agent_pay;
  const payment = response.payment || session?.payment;

  const lines = [
    'posterly signup started.',
    sessionId ? `Signup session: ${sessionId}` : '',
    `Status: ${status}`,
    message ? `Message: ${message}` : '',
    agentPay?.amount_display
      ? `Agent pay amount: ${agentPay.amount_display} ${String(agentPay.currency || 'usd').toUpperCase()}`
      : '',
    agentPay?.payment_intent_id ? `PaymentIntent: ${agentPay.payment_intent_id}` : '',
    agentPay?.requires_tos_acceptance ? 'Terms acceptance required before client_secret is released.' : '',
    agentPay?.client_secret ? `PaymentIntent client_secret: ${agentPay.client_secret}` : '',
    agentPay?.confirm_url ? `Confirm URL: ${agentPay.confirm_url}` : '',
    agentPay?.pay_instructions ? `Pay instructions: ${agentPay.pay_instructions}` : '',
    !agentPay?.enabled && payment?.amount_display
      ? `Amount due: ${payment.amount_display} ${String(payment.currency || 'usd').toUpperCase()} to ${payment.merchant_name || 'posterly'} (${payment.billing || 'subscription'})`
      : '',
    !agentPay?.enabled && payment?.agent_wallet?.how
      ? `Agent wallet option: ${payment.agent_wallet.how}`
      : '',
    checkoutRedirectUrl ? `Checkout handoff URL (browser fallback): ${checkoutRedirectUrl}` : '',
    checkoutUrl ? `Checkout URL: ${checkoutUrl}` : '',
    pollUrl ? `Poll URL: ${pollUrl}` : '',
    completeUrl ? `Completion URL: ${completeUrl}` : '',
    '',
    'Next steps for the AI agent:',
    ...(agentPay?.enabled && agentPay?.requires_tos_acceptance
      ? [
          '1. Ask the user to explicitly confirm they accept the posterly terms at https://www.poster.ly/terms.',
          '2. Once confirmed, POST { "tos_accepted": true } to Confirm URL (optionally with payment_method in the same call) to receive client_secret.',
          '3. If the user would rather pay on the website, send them the Checkout handoff URL instead.',
          '4. Call get_signup_session with the signup session ID until the status changes.',
          '5. Do not ask for card details, the posterly password, social passwords, or OAuth codes.',
        ]
      : agentPay?.enabled
      ? [
          '1. Prefer agent_pay: confirm the PaymentIntent with a one-time Link Agent Wallet virtual card (credential_type: card). Never paste card numbers into chat or send them to posterly.',
          '2. If the user would rather pay on the website, send them the Checkout handoff URL instead.',
          '3. Call get_signup_session with the signup session ID until the status changes.',
          '4. Tell the user when posterly sends the password setup email. Password, social OAuth, and publish approval stay in the browser.',
          '5. If status becomes agent_access_required, ask the user to install or paste the posterly MCP/API setup instructions into this trusted AI chat, then onboard them in this conversation (about you, connect, brand voice, first post). Do not send them to /onboarding-v2.',
          '6. Do not ask for card details, the posterly password, social passwords, or OAuth codes.',
        ]
      : [
          '1. If you hold an approved payment credential such as a Link agent wallet, you can pay the Checkout handoff URL yourself: create a spend request for the amount and merchant above, get the user\'s approval in the wallet, then complete the Checkout page with that credential. Never paste card numbers into chat or send them to posterly.',
          '2. Otherwise, send the Checkout handoff URL to the user so they can pay securely in their browser. Use the raw Stripe checkout URL only if you preserve the full URL including any fragment. posterly does not email this link, so do not tell the user to check their inbox at this stage.',
          '3. Call get_signup_session with the signup session ID until the status changes.',
          '4. Tell the user when posterly sends the password setup email.',
          '5. If status becomes agent_access_required, ask the user to install or paste the posterly MCP/API setup instructions into this trusted AI chat, then onboard them in this conversation (about you, connect, brand voice, first post). Do not send them to /onboarding-v2.',
          '6. Do not ask for card details, the posterly password, social passwords, or OAuth codes.',
        ]),
    includeRaw ? `\nRaw signup response:\n${JSON.stringify(response, null, 2)}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}
