import { z } from 'zod';
import type { PosterlyClient, PublicSignupSession } from '../lib/api-client.js';

export const getSignupSessionTool = {
  name: 'get_signup_session',
  description:
    'Poll a public posterly signup session created by start_signup. Use this to narrate payment (Link virtual card or browser Checkout), password setup, and agent access status before a posterly API key is installed. Keep updates user-facing; do not narrate raw HTTP, curl, or API plumbing.',
  inputSchema: z.object({
    session_id: z
      .string()
      .min(8)
      .describe('Signup session ID returned by start_signup, usually the Stripe checkout session ID.'),
    debug: z
      .boolean()
      .optional()
      .describe('When true, include the raw signup session JSON for debugging. Keep false for normal user-facing agent flows.'),
  }),

  async execute(client: PosterlyClient, input: { session_id: string; debug?: boolean }) {
    const result = await client.getSignupSession(input.session_id);
    return formatSignupSession(result.signup_session, Boolean(input.debug));
  },
};

function formatSignupSession(session: PublicSignupSession, includeRaw: boolean): string {
  const nextAction = session.next_action;
  const checkoutRedirectUrl = session.checkout_redirect_url || stringFromRecord(session.links, 'checkout_redirect_url');
  const checkoutUrl = stringFromRecord(session.links, 'checkout_url');
  const passwordUrl = stringFromRecord(session.links, 'password_setup_url');
  const completeUrl = stringFromRecord(session.links, 'complete_url');
  const agentPay = session.agent_pay;
  const payment = session.payment;

  const lines = [
    `posterly signup session: ${session.id}`,
    `Status: ${session.status}`,
    session.status_message ? `Message: ${session.status_message}` : '',
    nextAction?.label ? `Next action: ${nextAction.label}` : '',
    nextAction?.description ? `Next action detail: ${nextAction.description}` : '',
    agentPay?.amount_display ? `Agent pay amount: ${agentPay.amount_display}` : '',
    agentPay?.payment_intent_id ? `PaymentIntent: ${agentPay.payment_intent_id}` : '',
    agentPay?.status ? `PaymentIntent status: ${agentPay.status}` : '',
    agentPay?.requires_tos_acceptance ? 'Terms acceptance required before client_secret is released.' : '',
    agentPay?.client_secret ? `PaymentIntent client_secret: ${agentPay.client_secret}` : '',
    agentPay?.confirm_url ? `Confirm URL: ${agentPay.confirm_url}` : '',
    !agentPay?.enabled && payment?.amount_display
      ? `Amount due: ${payment.amount_display} ${String(payment.currency || 'usd').toUpperCase()} to ${payment.merchant_name || 'posterly'} (${payment.billing || 'subscription'})`
      : '',
    !agentPay?.enabled && payment?.agent_wallet?.how
      ? `Agent wallet option: ${payment.agent_wallet.how}`
      : '',
    checkoutRedirectUrl ? `Checkout handoff URL: ${checkoutRedirectUrl}` : '',
    checkoutUrl ? `Checkout URL: ${checkoutUrl}` : '',
    passwordUrl ? `Password setup URL: ${passwordUrl}` : '',
    completeUrl ? `Completion URL: ${completeUrl}` : '',
    '',
    guidanceForStatus(
      session.status,
      Boolean(agentPay?.enabled || agentPay?.payment_intent_id),
      Boolean(agentPay?.requires_tos_acceptance),
    ),
    session.agent_next_steps?.length
      ? `Agent next steps:\n${session.agent_next_steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
      : '',
    includeRaw ? `\nRaw signup session:\n${JSON.stringify(session, null, 2)}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function guidanceForStatus(status: string, agentPayAvailable = false, requiresTosAcceptance = false): string {
  switch (status) {
    case 'checkout_pending':
      if (agentPayAvailable && requiresTosAcceptance) {
        return 'Payment is still pending on terms acceptance. Ask the user to explicitly confirm they accept the posterly terms at https://www.poster.ly/terms, then POST { "tos_accepted": true } to Confirm URL to receive client_secret, or send the user the Checkout handoff URL. Keep polling; never ask for card numbers.';
      }
      return agentPayAvailable
        ? 'Payment is still pending. Confirm the prepaid PaymentIntent with a Link virtual card (credential_type: card), or send the user the Checkout handoff URL. Keep polling; never ask for card numbers.'
        : 'Tell the user checkout is still pending. If you hold an approved payment credential such as a Link agent wallet, you may pay the Checkout handoff URL yourself instead of asking the user; otherwise keep polling. Never ask for card details.';
    case 'checkout_expired':
      return 'Tell the user checkout expired and offer to call start_signup again.';
    case 'payment_confirmed':
      return 'Tell the user payment is confirmed and posterly is preparing access. Keep polling.';
    case 'password_required':
      return 'Tell the user posterly has sent a password setup email. They need to open that email and set a password in the browser.';
    case 'authorize_agent':
      return 'Tell the user posterly is ready for agent authorization. Send them the provided authorization or completion link if one is present.';
    case 'agent_access_required':
      return 'Tell the user API access is active, but this AI still needs posterly access. Ask them to paste the posterly MCP/API setup instructions here or install the posterly MCP server. Then onboard them IN THIS chat: about you, connect, brand voice, first post. Do not send them to /onboarding-v2.';
    case 'api_access_active':
      return 'posterly API access is active. Call whoami, then onboard them IN THIS chat: about you (name and timezone), connect the first account, brand voice, first post. Do not send them to /onboarding-v2.';
    default:
      return 'Explain the current status to the user and keep polling unless the session is terminal.';
  }
}
