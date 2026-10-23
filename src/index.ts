#!/usr/bin/env node

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z } from 'zod';
import { PosterlyClient, setMcpClientNameResolver } from './lib/api-client.js';
import { POSTERLY_MCP_VERSION } from './lib/version.js';
import { getToolAnnotations } from './lib/tool-annotations.js';
import { CLAUDE_DIRECTORY_INSTRUCTIONS, isClaudeDirectoryTool } from './lib/claude-directory-profile.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { AliasTransport, type LegacyAliasValidator } from './lib/alias-transport.js';
import { StdioPreviewTokens } from './lib/preview-token.js';
import { loosenIdObject, loosenIdShape } from './lib/id-schema.js';
import { parseToolsets, toolsetInstructions, visibleTools, type ToolRegistry } from './lib/tool-registry.js';
import type { ToolContext } from './lib/tool-runtime.js';
import { getAgentSignupInfoTool } from './tools/get-agent-signup-info.js';
import { getSignupSessionTool } from './tools/get-signup-session.js';
import { startSignupTool } from './tools/start-signup.js';
import { whoamiTool } from './tools/whoami.js';
import { listAccountsTool } from './tools/list-accounts.js';
import { disconnectAccountTool } from './tools/disconnect-account.js';
import { connectAccountTool } from './tools/connect-account.js';
import { createConnectSessionTool } from './tools/create-connect-session.js';
import { createApiKeyTool } from './tools/create-api-key.js';
import { deleteApiKeyTool } from './tools/delete-api-key.js';
import { listWorkspaceMembersTool } from './tools/list-workspace-members.js';
import { manageWorkspaceMemberTool } from './tools/manage-workspace-member.js';
import { listPublishingPausesTool } from './tools/list-publishing-pauses.js';
import { managePublishingPauseTool } from './tools/manage-publishing-pause.js';
import { getCreditsTool } from './tools/get-credits.js';
import { posterlyStatusTool } from './tools/posterly-status.js';
import { getSubscriptionTool } from './tools/get-subscription.js';
import { cancelSubscriptionTool } from './tools/cancel-subscription.js';
import { pauseSubscriptionTool } from './tools/pause-subscription.js';
import { resumeSubscriptionTool } from './tools/resume-subscription.js';
import { downgradeSubscriptionTool } from './tools/downgrade-subscription.js';
import { upgradeSubscriptionTool } from './tools/upgrade-subscription.js';
import { manageExtraAccountTool } from './tools/manage-extra-account.js';
import { listOAuthClientsTool } from './tools/list-oauth-clients.js';
import { manageOAuthClientTool } from './tools/manage-oauth-client.js';
import { listPlatformsTool } from './tools/list-platforms.js';
import { triggerPlatformHelperTool } from './tools/trigger-platform-helper.js';
import { listBrandsTool } from './tools/list-brands.js';
import { manageBrandsTool } from './tools/manage-brands.js';
import { listPostSuggestionsTool } from './tools/list-post-suggestions.js';
import { dismissSuggestionTool } from './tools/dismiss-suggestion.js';
import { submitAgentFeedbackTool } from './tools/submit-agent-feedback.js';
import { submitProductFeedbackTool } from './tools/submit-product-feedback.js';
import { validatePostTool } from './tools/validate-post.js';
import { createPostTool } from './tools/create-post.js';
import { createPostsBatchTool } from './tools/create-posts-batch.js';
import { findSlotTool } from './tools/find-slot.js';
import { listPostsTool } from './tools/list-posts.js';
import { uploadMediaTool } from './tools/upload-media.js';
import { createSignedUploadTool } from './tools/create-signed-upload.js';
import { createMediaDropTool } from './tools/create-media-drop.js';
import { listMediaTool } from './tools/list-media.js';
import { getVideoOptionsTool } from './tools/get-video-options.js';
import { runVideoFunctionTool } from './tools/run-video-function.js';
import { generateVideoTool } from './tools/generate-video.js';
import { listJobsTool } from './tools/list-jobs.js';
import { generateCaptionsTool } from './tools/generate-captions.js';
import { generateImageTool } from './tools/generate-image.js';
import { getPostTool } from './tools/get-post.js';
import { askSupportTool } from './tools/ask-support.js';
import { updatePostTool } from './tools/update-post.js';
import { deletePostTool } from './tools/delete-post.js';
import { listAnalyticsTool } from './tools/list-analytics.js';
import { listGoogleBusinessReviewsTool } from './tools/list-google-business-reviews.js';
import { auditGoogleBusinessProfileTool } from './tools/audit-google-business-profile.js';
import { manageGoogleBusinessReviewTool } from './tools/manage-google-business-review.js';
import { listGoogleBusinessMediaTool } from './tools/list-google-business-media.js';
import { manageGoogleBusinessMediaTool } from './tools/manage-google-business-media.js';
import { listGoogleBusinessServiceAreasTool } from './tools/list-google-business-service-areas.js';
import { manageGoogleBusinessServiceAreaTool } from './tools/manage-google-business-service-area.js';
import { listGoogleBusinessLocationsTool } from './tools/list-google-business-locations.js';
import { manageGoogleBusinessLocationTool } from './tools/manage-google-business-location.js';
import { listConversationsTool } from './tools/list-conversations.js';
import { manageConversationTool } from './tools/manage-conversation.js';
import { listCommentsTool } from './tools/list-comments.js';
import { manageCommentTool } from './tools/manage-comment.js';
import { listActivityTool } from './tools/list-activity.js';
import { getUpdatesTool } from './tools/get-updates.js';
import { listWebhooksTool } from './tools/list-webhooks.js';
import { createWebhookTool } from './tools/create-webhook.js';
import { manageWebhookTool } from './tools/manage-webhook.js';
import { getXPostingQuotaTool } from './tools/get-x-posting-quota.js';
import { manageXPostingAddonTool } from './tools/manage-x-posting-addon.js';

/**
 * One tool module per file in ./tools. `execute` takes the shared client,
 * the validated input, and the per-call context (tools that do not need the
 * input or context simply ignore them). Merged tools also carry the exact
 * input schemas of the old tools they replaced (`legacySchemas`), so alias
 * calls are validated exactly as before until the alias sunset date.
 */
interface ToolModule {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  legacySchemas?: Record<string, z.ZodTypeAny>;
  execute(client: PosterlyClient, input: any, ctx: ToolContext): Promise<string>;
}

/**
 * Every stdio tool, in registration order. The order is what tools/list
 * returns, so keep new tools appended where they belong rather than
 * re-sorting: reordering changes the published tool list.
 */
const STDIO_TOOLS: ToolModule[] = [
  getAgentSignupInfoTool,
  startSignupTool,
  getSignupSessionTool,
  whoamiTool,
  listAccountsTool,
  disconnectAccountTool,
  connectAccountTool,
  createConnectSessionTool,
  createApiKeyTool,
  deleteApiKeyTool,
  listWorkspaceMembersTool,
  manageWorkspaceMemberTool,
  listPublishingPausesTool,
  managePublishingPauseTool,
  getCreditsTool,
  getSubscriptionTool,
  cancelSubscriptionTool,
  pauseSubscriptionTool,
  resumeSubscriptionTool,
  downgradeSubscriptionTool,
  upgradeSubscriptionTool,
  manageExtraAccountTool,
  listOAuthClientsTool,
  manageOAuthClientTool,
  listPlatformsTool,
  triggerPlatformHelperTool,
  listBrandsTool,
  manageBrandsTool,
  listPostSuggestionsTool,
  dismissSuggestionTool,
  submitAgentFeedbackTool,
  submitProductFeedbackTool,
  validatePostTool,
  createPostTool,
  createPostsBatchTool,
  findSlotTool,
  listPostsTool,
  uploadMediaTool,
  createSignedUploadTool,
  createMediaDropTool,
  listMediaTool,
  getVideoOptionsTool,
  runVideoFunctionTool,
  generateVideoTool,
  listJobsTool,
  generateCaptionsTool,
  generateImageTool,
  getPostTool,
  askSupportTool,
  updatePostTool,
  deletePostTool,
  listAnalyticsTool,
  listGoogleBusinessReviewsTool,
  auditGoogleBusinessProfileTool,
  manageGoogleBusinessReviewTool,
  listGoogleBusinessMediaTool,
  manageGoogleBusinessMediaTool,
  listGoogleBusinessServiceAreasTool,
  manageGoogleBusinessServiceAreaTool,
  listGoogleBusinessLocationsTool,
  manageGoogleBusinessLocationTool,
  listConversationsTool,
  manageConversationTool,
  listCommentsTool,
  manageCommentTool,
  listActivityTool,
  getUpdatesTool,
  listWebhooksTool,
  createWebhookTool,
  manageWebhookTool,
  getXPostingQuotaTool,
  manageXPostingAddonTool,
  posterlyStatusTool,
];

// The tool registry (sets, labels, aliases) ships at the package root next to
// tool-annotations.json; dist/index.js reads it from one level up.
const require = createRequire(import.meta.url);
const registry = require('../tool-registry.json') as ToolRegistry;
const directoryProfile = process.env.POSTERLY_DIRECTORY_PROFILE;
if (directoryProfile && directoryProfile !== 'claude') throw new Error('Unknown posterly directory profile');
const claudeDirectoryProfile = directoryProfile === 'claude';

/**
 * Tool sets to list (POSTERLY_TOOLSETS env or --toolsets=core,inbox). Default
 * is every set, so nobody loses tools. Signup tools are always listed. Sets
 * only filter tools/list: every tool is still registered and callable.
 */
function requestedToolsets(): string | undefined {
  const flag = process.argv.find((arg) => arg.startsWith('--toolsets='));
  if (flag) return flag.slice('--toolsets='.length);
  return process.env.POSTERLY_TOOLSETS;
}

const toolsets = parseToolsets(registry, requestedToolsets(), 'stdio');
if (toolsets.unknown.length > 0) {
  console.error(`posterly MCP: ignoring unknown tool set(s): ${toolsets.unknown.join(', ')}`);
}

const server = new McpServer(
  {
    name: 'posterly',
    version: POSTERLY_MCP_VERSION,
  },
  {
    // Which tool sets exist, that every set is on by default, how to load
    // fewer, and how preview then confirm works (built from the registry).
    instructions: claudeDirectoryProfile ? CLAUDE_DIRECTORY_INSTRUCTIONS : toolsetInstructions(registry, 'stdio'),
  },
);

const client = new PosterlyClient();

// The SDK only learns the connected client's identity (e.g. "claude-ai",
// "chatgpt") once the initialize handshake completes, so this is a resolver
// read fresh on every request rather than a value captured once here.
setMcpClientNameResolver(() => server.server.getClientVersion()?.name);

// Old tools' exact input schemas, keyed by alias name, from the merged tool
// modules that replaced them.
const LEGACY_SCHEMAS = new Map<string, z.ZodTypeAny>();
for (const tool of STDIO_TOOLS) {
  for (const [alias, schema] of Object.entries(tool.legacySchemas ?? {})) LEGACY_SCHEMAS.set(alias, loosenIdObject(schema));
}

/**
 * Validates an alias call against the old tool's own schema, so a call the
 * old tool rejected gets the same SDK error text it always got (same wording
 * the SDK builds for any tool), and a valid call keeps the old defaults.
 */
const legacyValidator: LegacyAliasValidator = (aliasName, args) => {
  const schema = LEGACY_SCHEMAS.get(aliasName);
  if (!schema) return null;
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return { ok: true, args: parsed.data as Record<string, unknown> };
  const message = new McpError(
    ErrorCode.InvalidParams,
    `Input validation error: Invalid arguments for tool ${aliasName}: ${parsed.error.message}`,
  ).message;
  return { ok: false, message };
};

// Renamed tools (aliases) are never registered with McpServer: the transport
// rewrites an alias call onto its target before the SDK sees it, and handlers
// read the called name back through getCallInfo(extra.requestId).
const transport = new AliasTransport(
  new StdioServerTransport(),
  registry,
  toolsets.all ? null : visibleTools(registry, toolsets.enabled, 'stdio'),
  legacyValidator,
  claudeDirectoryProfile,
);

// Preview then confirm tokens: a random key and an in-memory one-time-use
// set per process (UX protection only; REST authorization is unchanged).
const previews = new StdioPreviewTokens();

function registerAll(tools: ToolModule[]): void {
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      loosenIdShape(tool.inputSchema.shape),
      getToolAnnotations(tool.name),
      async (input, extra) => {
        // The CALLED name (an alias, or the tool itself) is what telemetry
        // records as X-Posterly-Tool. The per-call context lives only here:
        // never in the arguments, never on shared state.
        const callInfo = transport.getCallInfo(extra.requestId);
        const calledName = callInfo?.calledName ?? tool.name;
        const ctx: ToolContext = {
          calledName,
          legacyConfirm: callInfo?.legacyConfirm === true,
          registry,
          previews,
          toolsets: { enabled: toolsets.enabled, all: toolsets.all },
        };
        try {
          const text = await client.runToolCall(calledName, () => tool.execute(client, input, ctx));
          return { content: [{ type: 'text' as const, text }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
        }
      },
    );
  }
}

registerAll(claudeDirectoryProfile ? STDIO_TOOLS.filter((tool) => isClaudeDirectoryTool(tool.name)) : STDIO_TOOLS);

// Start the server
async function main() {
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
