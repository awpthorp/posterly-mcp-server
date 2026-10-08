/**
 * Per-call context and shared helpers for the npm stdio tools that merge
 * several old tools (MCP tool consolidation, 0.45.0).
 *
 *   - validateArgs(): the registry's per-mode rules (mcp-server/tool-registry.json)
 *     run before any request, same as the hosted endpoint
 *   - previewThenConfirm(): preview then confirm for public or destructive
 *     actions; alias calls (ctx.legacyConfirm) keep their old one-step confirm
 *     until the alias sunset date
 *
 * The context is built per call in index.ts from the transport's request map,
 * never stored in the arguments or on shared state.
 */

import { canonicalArgs, validateMode, type ToolRegistry } from './tool-registry.js';
import { previewFailureMessage } from './preview-token-core.js';
import type { StdioPreviewTokens } from './preview-token.js';
import { code, mdSection, mdTitle } from './format.js';

export interface ToolContext {
  /** The name the client called: an alias or the canonical tool. */
  calledName: string;
  /** True for alias calls: confirm: true alone still runs preview actions until the sunset date. */
  legacyConfirm: boolean;
  registry: ToolRegistry;
  previews: StdioPreviewTokens;
  /** The tool sets listed in this process (POSTERLY_TOOLSETS); every set when all is true. */
  toolsets?: { enabled: string[]; all: boolean };
}

/** The local process serves one user; preview tokens are bound to this process's key anyway. */
const STDIO_PREVIEW_USER = 'stdio-local';

/**
 * Validates a merged tool's args against the registry's per-mode rules and
 * returns the normalised args and mode. Throws a plain error before any request.
 */
export function validateArgs(
  ctx: ToolContext,
  tool: string,
  input: unknown,
): { mode: string | null; args: Record<string, any> } {
  const validated = validateMode(ctx.registry, tool, input);
  if (!validated.ok) throw new Error(validated.error);
  return { mode: validated.mode, args: validated.args };
}

/** A shallow copy of args without the given keys. */
export function omitKeys(args: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}

function formatPreview(body: string, previewId: string, tool: string): string {
  return [
    mdTitle('Preview only: nothing has changed yet'),
    body,
    mdSection('Preview ID', `${code(previewId)} (expires in 10 minutes)`),
    mdSection('Next step', `Show this preview to the user. Only after they explicitly approve, call ${tool} again with the same fields plus confirm: true and this preview_id.`),
  ].filter(Boolean).join('\n\n');
}

export interface PreviewStep {
  tool: string;
  action: string;
  /** Validated (normalised) args: the preview and the confirm call must hash identically. */
  args: Record<string, any>;
  /** Public writes: a preview_id can be confirmed once only. */
  nonce: boolean;
  /** The old tool's refusal when confirm is missing, for alias calls. */
  legacyRefusal: string;
  ctx: ToolContext;
  /** What will change (may make one read request; must not throw). */
  describe: () => Promise<string>;
  run: () => Promise<string>;
}

/**
 * Preview then confirm (docs/mcp-tool-design.md section 4). Canonical calls:
 * no confirm returns a preview and a preview_id bound to this tool, action,
 * and exact args; confirm needs that preview_id. Alias calls keep the old
 * contract until the sunset: confirm: true alone runs the action.
 */
export async function previewThenConfirm(step: PreviewStep): Promise<string> {
  const { ctx, args } = step;
  if (ctx.legacyConfirm) {
    if (args.confirm !== true) throw new Error(step.legacyRefusal);
    return step.run();
  }
  const binding = { userId: STDIO_PREVIEW_USER, tool: step.tool, action: step.action, args: canonicalArgs(args) };
  if (args.confirm !== true) {
    const previewId = ctx.previews.create(binding);
    return formatPreview(await step.describe(), previewId, step.tool);
  }
  const token = args.preview_id;
  if (typeof token !== 'string' || !token) throw new Error(previewFailureMessage('missing'));
  const verified = ctx.previews.verify(token, binding);
  if (!verified.ok) throw new Error(previewFailureMessage(verified.reason));
  if (step.nonce && !ctx.previews.claimOnce(token, verified.exp)) throw new Error(previewFailureMessage('used'));
  return step.run();
}

/** Runs one read for a preview; a failed read (for example a 403 on a narrower key) falls back to echoing the request. */
export async function readForPreview<T>(read: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await read() };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export function readFailedNote(error: string): string {
  return `_posterly could not read the current item (${error}), so the preview shows the request as given._`;
}
