/**
 * Opt-in catalog for the Anthropic Software Directory. Both MCP transports
 * use this explicit allowlist; omitted tools are unavailable, including aliases.
 * REST authorization and preview confirmation still apply to every operation.
 * Policy: https://support.claude.com/en/articles/13145358
 */
const descriptions: Record<string, string> = {
  get_agent_signup_info: 'Return posterly signup requirements and the human signup link.',
  start_signup: 'Create a short-lived signup session with a browser link for human completion. This operation does not take payment.',
  get_signup_session: 'Read the completion status of a signup session.',
  whoami: 'Return connection status or the authenticated user, scopes, and accessible workspaces.',
  create_api_key: 'Create a scoped posterly API key for the authenticated user. The new key cannot exceed the caller key permissions.',
  delete_api_key: 'Revoke an API key owned by the authenticated user. The current authentication key and managed OAuth keys cannot be revoked here.',
  list_workspace_members: 'List workspace members, pending invites, roles, brand access, API access, and occupied seats.',
  manage_workspace_member: 'Invite, update, or remove a workspace colleague using the action selector. Workspace administrator permissions and existing seat limits apply.',
  list_publishing_pauses: 'Read workspace and brand publishing pauses and the caller permissions to manage them.',
  manage_publishing_pause: 'Pause or resume workspace or brand publishing using the action selector. Resume can keep missed posts paused or publish them.',
  list_accounts: 'List connected social accounts, or read account brand profiles, learned voice, performance profiles, and connection-session status using the view selector.',
  disconnect_account: 'Disconnect a social account, removing its connection and affecting its scheduled posts.',
  connect_account: 'Connect a credential-based Telegram, Bluesky, Discord, WordPress, Dev.to, Hashnode, or Lemmy account.',
  create_connect_session: 'Create a short-lived browser handoff session for a human to connect a social account.',
  list_oauth_clients: 'List self-serve OAuth developer clients owned by the authenticated user.',
  manage_oauth_client: 'Create, update, or delete a public OAuth 2.1 developer client using the action selector. Client secrets are not created.',
  list_platforms: 'List supported platforms, read platform or account settings schemas, or return browser connection links using the view selector.',
  trigger_platform_helper: 'Read account-specific platform discovery data: Pinterest boards, TikTok creator information, LinkedIn recent mentions, or X quota.',
  list_brands: 'List accessible brands, read one brand, or list its social accounts using the view selector.',
  list_post_suggestions: 'List suggested social post drafts, their performance rationale, and their scheduling status.',
  dismiss_suggestion: 'Dismiss a pending post suggestion. Suggestions already converted into posts are unchanged.',
  list_posts: 'List social posts accessible to the caller, filtered by account, brand, workspace, platform, status, or approval state.',
  get_post: 'Read one social post and its current content, media, platform settings, and publication status.',
  ask_support: 'Answer a posterly support question with documentation and read-only workspace diagnostics. A continued support conversation can request a human ticket with explicit escalation confirmation.',
  find_available_slot: 'Find available posting times with a one-hour spacing rule, preferred hours, and an explicit timezone.',
  submit_agent_feedback: 'Record private operational feedback about a completed posterly workflow. Content and credentials are not accepted as telemetry.',
  submit_product_feedback: 'Submit a confirmed title, category, and description to the public posterly feedback board.',
  validate_post: 'Validate and normalize proposed post content without saving, uploading, scheduling, or publishing it.',
  create_post: 'Create one scheduled or immediate social post. Omitting scheduled_at requests immediate publication. The operation creates content on the selected connected social account.',
  create_posts_batch: 'Create one to 25 scheduled or immediate social posts. Partial success is possible and failed items retain their input index.',
  update_post: 'Edit a draft or scheduled post, change its status, assign release and group identifiers, or manage client approval using the action selector. Published posts cannot be edited.',
  delete_post: 'Delete one draft or scheduled post, or all eligible posts in a selected group using the action selector. Published posts cannot be deleted.',
  get_x_posting_quota: 'Read managed X posting usage, quota, remaining posts, URL restrictions, and existing add-on information.',
  upload_media: 'Upload an existing image or video to posterly storage from a file, base64 content, or a public HTTPS URL. Returns a reusable media URL and does not publish content.',
  create_signed_upload: 'Create a signed storage upload URL for an existing large image or video.',
  create_media_drop: 'Create a short-lived browser page for a human to upload existing media without a dashboard login.',
  list_media: 'List uploaded media assets or files uploaded to a selected media-drop session.',
  generate_captions: 'Generate or adapt text caption suggestions for social platforms. Uses the caption allowance and does not create or publish posts.',
  list_analytics: 'Read account analytics, post analytics, post feedback insights, or missing-post requirements using the view selector.',
  list_google_business_reviews: 'Read Google Business Profile reviews or the public review link using the view selector.',
  audit_google_business_profile: 'Read and audit a connected Google Business Profile location: completeness, categories, media, attributes, reviews, and recommendations.',
  manage_google_business_review: 'Suggest text replies, publish owner replies, or delete owner replies to Google Business reviews using the action selector. Suggestions do not publish a reply.',
  list_google_business_media: 'Read existing photos and videos in connected Google Business Profile galleries.',
  manage_google_business_media: 'Add an existing photo or video to a Google Business gallery, or delete a gallery item using the action selector.',
  list_conversations: 'List Instagram or Facebook Page inbox conversations, or read one conversation using the view selector. Requires a Pro plan and posts:read.',
  manage_conversation: 'Reply to an Instagram or Facebook Page inbox conversation, or synchronize supported social inbox data using the action selector. Requires a Pro plan and posts:write.',
  list_comments: 'List Instagram, Facebook Page, Threads, or LinkedIn Page comments, or read one comment using the view selector. Requires a Pro plan and posts:read.',
  manage_comment: 'Reply to, hide, unhide, mark, or delete a social inbox comment using the action selector. Platform limitations apply. Requires a Pro plan and posts:write.',
  list_activity: 'Read recent post activity, status changes, publish attempts, failures, and retries.',
  list_webhooks: 'Read webhook subscriptions, event filters, destinations, and recent delivery status.',
  create_webhook: 'Create a webhook subscription for post, account, or analytics events and return its signing secret once.',
  manage_webhook: 'Update or delete a webhook subscription, or send a signed test event using the action selector.',
  get_credits: 'Read the workspace AI credit balance, included allowance, purchased balance, and next reset time. Does not buy or spend credits.',
  get_subscription: 'Read subscription status, tier, current period, trial end, cancellation-at-period-end, and pause state. Does not change billing.',
  get_updates: 'Read recent posterly product updates.',
}

export const CLAUDE_DIRECTORY_INSTRUCTIONS = 'posterly provides social account discovery, existing-media uploads, social post validation and publication, analytics, and inbox management. AI image, video, and audio generation and billing mutations are unavailable in this directory profile. Public and destructive actions use the existing preview and confirmation contract.'

export function isClaudeDirectoryTool(name: string): boolean {
  return Object.hasOwn(descriptions, name)
}

export function claudeDirectoryDescription(name: string): string {
  const description = descriptions[name]
  if (!description) throw new Error(`Tool is unavailable in the Claude directory profile: ${name}`)
  return description
}

/** Keep validation constraints but omit prose referring to other tools or model behavior. */
export function claudeDirectorySchema<T>(schema: T): T {
  const copy = structuredClone(schema)
  function visit(value: unknown): void {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      if (typeof object.description === 'string') delete object.description
      for (const key of ['properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas']) {
        const schemas = object[key]
        if (schemas && typeof schemas === 'object' && !Array.isArray(schemas)) Object.values(schemas).forEach(visit)
      }
      for (const key of ['items', 'additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'allOf', 'oneOf', 'anyOf', 'prefixItems']) visit(object[key])
    }
  }
  visit(copy)
  return copy
}
