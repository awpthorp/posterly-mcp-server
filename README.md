# posterly MCP server: Instagram, TikTok, LinkedIn and 15 more platforms

Schedule and publish social posts on 18 platforms from any MCP client.

posterly is a social media scheduler with a hosted MCP server. Connect Claude, ChatGPT, Cursor, Windsurf, Cline, or any MCP client and your assistant can list connected accounts, check a post with `validate_post`, schedule it with `create_post`, upload media, write captions, read analytics, reply to comments, and manage Google Business reviews. It covers Instagram, Facebook, TikTok, X, LinkedIn, YouTube, Pinterest, Threads, Google Business, Telegram, Bluesky, Discord, Slack, Mastodon, Dev.to, Hashnode, WordPress, and Lemmy. Use the hosted endpoint (`https://www.poster.ly/api/mcp`, OAuth sign-in) or run it locally with `npx -y posterly-mcp-server@latest`.

People looking for an Instagram MCP, a TikTok MCP, or a LinkedIn MCP can use this same server. It is one connection for all 18 platforms, not a separate server per network.

The installable package is [`posterly-mcp-server` on npm](https://www.npmjs.com/package/posterly-mcp-server). Source code: [github.com/awpthorp/posterly-mcp-server](https://github.com/awpthorp/posterly-mcp-server). The official MCP Registry name is `io.github.awpthorp/posterly`. Smithery lists the same hosted endpoint: [smithery.ai/servers/awpthorp/posterly](https://smithery.ai/servers/awpthorp/posterly).

## What you need

- Node.js 20 or newer, for the local `npx` server.
- A posterly plan with API and MCP access for authenticated tools.
- New accounts that start from [poster.ly/mcp](https://www.poster.ly/mcp) get a plan and API and MCP in one Stripe subscription, with a 7-day free trial. A card is required and is charged on day 8 unless the paid plan starts sooner. An account that already had a trial is charged at checkout. Starter + API is $10/month.
- The add-on on its own is $3/month on Starter, $4/month on new Pro (existing Pro customers stay at $3/month), $5/month on Power, and $29/month on Agency. Base plans start at $7/month. Combined monthly totals are $10, $19, $30, and $78.
- After checkout, create a key at [Dashboard, API and MCP](https://www.poster.ly/dashboard/api) if your client needs one. Hosted OAuth connectors sign in instead of pasting a key.

User-created API keys: Starter 1, Pro 2, Power 3, Agency 4.

## Hosted endpoint

`POST https://www.poster.ly/api/mcp`

Use the `www` host. `https://poster.ly/api/mcp` redirects, and some connector clients do not follow that redirect.

- Wire format: JSON-RPC 2.0 over one HTTPS POST. The response is a JSON body. This v1 endpoint does not open an SSE stream. `GET https://www.poster.ly/api/mcp` returns a short JSON capability hint and does not require auth.
- Auth: OAuth sign-in for Claude and ChatGPT custom connectors, or `Authorization: Bearer pst_live_...` where the client accepts a header.
- Docs: [poster.ly/mcp](https://www.poster.ly/mcp) and [MCP server docs](https://www.poster.ly/docs/integrations/mcp).
- Server card: [/.well-known/mcp/server-card.json](https://www.poster.ly/.well-known/mcp/server-card.json).

```bash
curl -s https://www.poster.ly/api/mcp \
  -H "Authorization: Bearer pst_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Hosted tool calls are JSON only. Chat attachments never reach posterly. On ChatGPT web, Claude.ai, and Gemini web, ask for `create_media_drop`, open the returned `https://www.poster.ly/drop/...` link (up to 20 files per link), then call `list_media`. Clients that can upload bytes (Cursor, Claude Code, Codex) can use `create_signed_upload` (1 to 20 files per call) and PUT each file to its returned `upload_url`. Small images can use `upload_media`.

Create-post calls are limited to 100 requests per hour per key. `create_posts_batch` takes up to 25 posts in one confirmed request. Media writes and reads have separate limits.

`create_post` does not go out until you agree and the call includes confirmation (`confirm: true`). Comment replies, direct messages, Google review replies, and similar public or destructive actions return a preview first, then need the same fields again with that `preview_id`.

## Source

This repository is a read-only mirror, published from the posterly monorepo. Issues are welcome. Pull requests are not merged here: an accepted change is reapplied in the posterly monorepo and arrives in the next sync.

```bash
git clone https://github.com/awpthorp/posterly-mcp-server.git
```

Clients should use the `npx` block below, or the hosted URL. The clone is the public source, not a second install path.

## Local server

```json
{
  "mcpServers": {
    "posterly": {
      "command": "npx",
      "args": ["-y", "posterly-mcp-server@latest"],
      "env": {
        "POSTERLY_API_KEY": "pst_live_your_key_here"
      }
    }
  }
}
```

Leave out `POSTERLY_API_KEY` only when an assistant should start signup first. These public tools work before a key exists: `whoami` with `view` set to `status`, `get_agent_signup_info`, `start_signup`, and `get_signup_session`. They are on the local npm server, not on the hosted endpoint.

The local package exposes the full tool catalog. The hosted endpoint exposes the same catalog without the three signup tools. The current list is on [poster.ly/mcp](https://www.poster.ly/mcp).

## Claude

Custom connector (Claude chat, and the same connector in the Claude desktop app):

1. Open Settings, Connectors, Add custom connector. On claude.ai you can also start from the chat +, Connectors, Add connector, Add custom connector.
2. Name it posterly.
3. Paste `https://www.poster.ly/api/mcp`.
4. Choose Connect, sign in to posterly, and press Allow.
5. Leave the advanced OAuth client ID and secret empty.

Claude Desktop local config file: `claude_desktop_config.json`, using the `npx` block above.

Claude Code, hosted:

```bash
claude mcp add --transport http posterly https://www.poster.ly/api/mcp
```

Claude Code, local stdio:

```bash
claude mcp add --scope user -e POSTERLY_API_KEY=pst_live_your_key_here posterly -- npx -y posterly-mcp-server@latest
```

Setup pages: [poster.ly/claude](https://www.poster.ly/claude).

## ChatGPT

ChatGPT web talks to the hosted endpoint only. Do not paste the `npx` config into ChatGPT.

1. On chatgpt.com open Settings, Security and login, and turn on Developer mode.
2. Open chatgpt.com/plugins, choose +, Create app, Create MCP App.
3. Set the server URL to `https://www.poster.ly/api/mcp` and choose OAuth.
4. Sign in to posterly.

Write actions (`create_post` and other writes) need ChatGPT Business, Enterprise, or Edu. Pro custom MCP is read and fetch only. Custom MCP is web only. There is no mobile MCP.

This is a custom app you add yourself. It is not a one-click directory listing.

Setup pages: [poster.ly/chatgpt](https://www.poster.ly/chatgpt).

## Cursor

Project file `.cursor/mcp.json`, or global file `~/.cursor/mcp.json`. You can also add a server from Settings, MCP.

Local stdio (Cursor Desktop and the local CLI), the `npx` block above. That path can read a real `file_path`.

Hosted HTTP, for Cloud Agents, which cannot see a local `npx` process:

```json
{
  "mcpServers": {
    "posterly": {
      "url": "https://www.poster.ly/api/mcp",
      "headers": {
        "Authorization": "Bearer pst_live_your_key_here"
      }
    }
  }
}
```

OAuth is also supported on Cursor. SSE is not the posterly v1 transport.

Setup pages: [poster.ly/cursor](https://www.poster.ly/cursor).

## Windsurf, Cline, and Codex

Windsurf uses the same `npx` JSON in `~/.codeium/windsurf/mcp_config.json`.

Cline, Continue, and Zed use that same JSON shape in their MCP settings.

Codex (the terminal, the IDE extension, and the Codex tab in the ChatGPT desktop app) shares `~/.codex/config.toml`:

```bash
codex mcp add posterly --env POSTERLY_API_KEY=pst_live_your_key_here -- npx -y posterly-mcp-server@latest
codex mcp add posterly --url https://www.poster.ly/api/mcp
codex mcp list
```

The `--url` command is the hosted endpoint documented on the ChatGPT page. The posterly server answers with a single JSON-RPC body, not an SSE stream.

## Tools

Tools sit in sets: `core` (accounts, posting, media, schedule, analytics, support), `creative` (AI image and video generation, post suggestions), `inbox` (comments and DMs), `google_business` (reviews, media, profile audit), `admin` (API keys, webhooks, workspace members, publishing pause), and `billing` (subscription changes). Signup tools are local only.

Real tool names include `whoami`, `list_accounts`, `list_platforms`, `validate_post`, `create_post`, `create_posts_batch`, `list_posts`, `update_post`, `find_available_slot`, `upload_media`, `generate_captions`, `generate_image`, `list_analytics`, `list_comments`, `manage_comment`, `list_google_business_reviews`, `manage_google_business_review`, and `audit_google_business_profile`.

The full list, with views and actions, is on [poster.ly/mcp](https://www.poster.ly/mcp).

Analytics (`list_analytics`) currently supports Instagram, X, Facebook Pages, LinkedIn, Google Business Profile, Pinterest, YouTube, and Threads.

## Links

- Product and setup: [https://www.poster.ly/mcp](https://www.poster.ly/mcp)
- Docs: [https://www.poster.ly/docs/integrations/mcp](https://www.poster.ly/docs/integrations/mcp)
- Privacy: [https://www.poster.ly/privacy](https://www.poster.ly/privacy)
- Terms: [https://www.poster.ly/terms](https://www.poster.ly/terms)
- npm: [https://www.npmjs.com/package/posterly-mcp-server](https://www.npmjs.com/package/posterly-mcp-server)

## Licence

MIT. See [LICENSE](LICENSE).
