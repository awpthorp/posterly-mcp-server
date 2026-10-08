// Version of the npm stdio MCP package (posterly-mcp-server).
//
// MUST stay in lockstep with the hosted HTTP endpoint version in
// lib/mcp/version.ts. The two MCP surfaces share one version namespace and
// tool set (minus the intentional pre-auth signup tools that only this stdio
// package exposes). `npm run check:mcp-parity` enforces both the version match
// and the tool-list match, and runs in the pre-commit hook.
export const POSTERLY_MCP_VERSION = '0.50.5';
