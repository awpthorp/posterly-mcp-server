import { z } from 'zod';
import type { AskSupportPayload, AskSupportResponse, PosterlyClient } from '../lib/api-client.js';
import { mdBullets, mdQuote, mdSection, mdTitle } from '../lib/format.js';

function formatSupportAnswer(result: AskSupportResponse): string {
  const citations = Array.isArray(result.message?.citations) ? result.message.citations : [];
  const sources = citations.slice(0, 5).map((citation: any) => {
    const label = citation.heading || citation.title || citation.slug || citation.url;
    const parent = citation.heading && citation.title ? ` (${citation.title})` : '';
    const url = citation.url ? ` - ${citation.url}` : '';
    return `${label}${parent}${url}`;
  });
  const supportAccess = result.support_access || {};
  const status = [
    `Conversation: ${result.conversation.id}`,
    `Confidence: ${typeof result.confidence === 'number' ? `${Math.round(result.confidence * 100)}%` : 'unknown'}`,
    `Human recommended: ${result.needs_human ? 'yes' : 'no'}`,
    supportAccess.confirmation_required ? 'Human ticket not created: confirm_escalation=true is required.' : '',
    supportAccess.ticket_created && result.ticket?.id ? `Ticket: ${result.ticket.id} (${result.ticket.status})` : '',
  ].filter(Boolean);

  return [
    mdTitle('posterly Support'),
    mdQuote(result.message?.content || 'No support answer returned.'),
    sources.length ? mdSection('Sources', mdBullets(sources)) : '',
    mdSection('Status', mdBullets(status)),
  ].filter(Boolean).join('\n\n');
}

const supportInputSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  workspace_id: z.string().optional().describe('Workspace to inspect. Omit to use the API-key scoped workspace or personal workspace.'),
  conversation_id: z.string().optional().describe('Continue a previous support conversation.'),
  page_url: z.string().max(2000).optional().describe('Optional posterly page URL for context.'),
  post_id: z.number().int().positive().optional().describe('Optional post ID to inspect directly.'),
  referenced_post_ids: z.array(z.number().int().positive()).max(5).optional().describe('Optional post IDs to include in read-only diagnostics.'),
  request_human: z.boolean().default(false).optional().describe('Ask for human review. Does not create a ticket unless confirm_escalation is also true.'),
  confirm_escalation: z.boolean().default(false).optional().describe('Must be true after explicit user confirmation before a human support ticket can be created.'),
});

async function executeSupport(client: PosterlyClient, input: AskSupportPayload) {
  if (input.confirm_escalation === true && input.request_human !== true) {
    throw new Error('confirm_escalation=true only has an effect when request_human=true.');
  }
  const result = await client.askSupport(input);
  return formatSupportAnswer(result);
}

export const askSupportTool = {
  name: 'ask_support',
  description:
    'Ask posterly Support AI an authenticated question using posterly docs plus read-only account/post diagnostics for the caller workspace. Requires POSTERLY_API_KEY with accounts:read and posts:read scopes. Human ticket creation requires request_human=true and confirm_escalation=true after explicit user confirmation.',
  inputSchema: supportInputSchema,
  execute: executeSupport,
};
