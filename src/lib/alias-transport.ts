/**
 * Transport wrapper that keeps renamed MCP tools working on the stdio package
 * without registering the old names with McpServer (so they never appear in
 * tools/list).
 *
 * Incoming: a tools/call whose name is an alias is rewritten BEFORE McpServer
 * sees it: params.name becomes the target tool and params.arguments become
 * the translated arguments, so the SDK validates them against the canonical
 * schema. The request id is remembered with the alias details.
 *
 * Handlers read that per-request info through getCallInfo(extra.requestId):
 * the called name (for the X-Posterly-Tool telemetry header) and whether the
 * alias may still confirm in one step. Nothing is stored in the arguments.
 *
 * Outgoing: the response for that id gets the rename note APPENDED as a final
 * text item (content[0] is never touched) plus _meta["posterly/deprecation"],
 * and the remembered entry is deleted. A notifications/cancelled for that id
 * also deletes it (the SDK sends no response for a cancelled request).
 *
 * Legacy input schemas: when a legacyValidator is given, an alias call's
 * arguments are first checked against the OLD tool's exact input schema, so a
 * call the old tool rejected gets the same SDK validation error text (and a
 * call it accepted gets the same parsed arguments, defaults included) before
 * translation. The npm package passes the old zod schemas here.
 *
 * Tool sets: every tool stays registered (so a call to any tool always
 * works); when a visible set is given, only the outgoing tools/list result is
 * filtered to it.
 *
 * Only the public Transport interface is used; no SDK private fields.
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo, RequestId } from '@modelcontextprotocol/sdk/types.js';
import { claudeDirectoryDescription, claudeDirectorySchema, isClaudeDirectoryTool } from './claude-directory-profile.js';
import {
  DEPRECATION_META_KEY,
  deprecationNote,
  resolveAlias,
  translateArgs,
  validateMode,
  type ResolvedAlias,
  type ToolRegistry,
} from './tool-registry.js';

export interface AliasCallInfo {
  /** The name the client called (the alias). */
  calledName: string;
  /** The canonical tool the call was routed to. */
  target: string;
  /** The alias may confirm with confirm:true alone until its sunset date. */
  legacyConfirm: boolean;
  alias: ResolvedAlias;
}

/**
 * Checks an alias call's raw arguments against the old tool's input schema.
 * Return null when the alias has no legacy schema (no check), the parsed
 * arguments when they are valid, or the exact error text the old tool gave.
 */
export type LegacyAliasValidator = (
  aliasName: string,
  args: unknown,
) => { ok: true; args: Record<string, unknown> } | { ok: false; message: string } | null;

function requestKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class AliasTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  private readonly calls = new Map<string, AliasCallInfo>();
  /** In-flight tools/list request ids, so only their responses are filtered. */
  private readonly listRequests = new Set<string>();

  /**
   * @param visibleTools names to list in tools/list, or null to list every
   *   registered tool unchanged (the default: every set).
   */
  constructor(
    private readonly inner: Transport,
    private readonly registry: ToolRegistry,
    private readonly visibleTools: Set<string> | null = null,
    private readonly legacyValidator: LegacyAliasValidator | null = null,
    private readonly claudeDirectoryProfile = false,
  ) {
    inner.onmessage = (message, extra) => this.handleIncoming(message as JSONRPCMessage, extra);
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => this.onerror?.(error);
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  close(): Promise<void> {
    this.calls.clear();
    this.listRequests.clear();
    return this.inner.close();
  }

  /** Alias details for an in-flight tools/call, or undefined for a canonical call. */
  getCallInfo(requestId: RequestId | undefined): AliasCallInfo | undefined {
    if (requestId === undefined || requestId === null) return undefined;
    return this.calls.get(requestKey(requestId));
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const outgoing = this.filterToolsList(this.decorateResponse(message));
    return this.inner.send(outgoing, options);
  }

  private handleIncoming(message: JSONRPCMessage, extra?: MessageExtraInfo): void {
    const request = message as { id?: RequestId; method?: string; params?: any };
    if (request.method === 'notifications/cancelled') {
      const cancelled = isObject(request.params) ? request.params.requestId : undefined;
      if (typeof cancelled === 'string' || typeof cancelled === 'number') {
        this.calls.delete(requestKey(cancelled));
        this.listRequests.delete(requestKey(cancelled));
      }
      this.onmessage?.(message, extra);
      return;
    }
    if (request.method === 'tools/list' && (this.visibleTools || this.claudeDirectoryProfile) && request.id !== undefined && request.id !== null) {
      this.listRequests.add(requestKey(request.id));
      this.onmessage?.(message, extra);
      return;
    }
    if (request.method !== 'tools/call' || request.id === undefined || request.id === null || !isObject(request.params)) {
      this.onmessage?.(message, extra);
      return;
    }
    const name = request.params.name;
    if (this.claudeDirectoryProfile && (typeof name !== 'string' || !isClaudeDirectoryTool(name))) {
      // Omitted tools and legacy aliases reach the SDK unchanged and fail as
      // unregistered names, rather than being rewritten into callable tools.
      this.onmessage?.(message, extra);
      return;
    }
    const alias = typeof name === 'string' ? resolveAlias(this.registry, name) : null;
    if (!alias) {
      this.onmessage?.(message, extra);
      return;
    }

    const info: AliasCallInfo = {
      calledName: alias.name,
      target: alias.target,
      legacyConfirm: alias.legacyConfirm === true,
      alias,
    };
    this.calls.set(requestKey(request.id), info);

    let callerArgs: unknown = request.params.arguments;
    const legacy = this.legacyValidator ? this.legacyValidator(alias.name, callerArgs) : null;
    if (legacy && !legacy.ok) {
      this.respondWithError(request.id, legacy.message);
      return;
    }
    if (legacy?.ok) callerArgs = legacy.args;

    // alias.mode pins a param-driven target to the old tool's mode.
    const validated = validateMode(this.registry, alias.target, translateArgs(alias, callerArgs), alias.mode);
    if (!validated.ok) {
      // A plain error before any request, same as the hosted endpoint; the
      // rename note is still appended by send() so the caller learns the new
      // name either way.
      this.respondWithError(request.id, validated.error);
      return;
    }

    const rewritten = {
      ...(message as object),
      params: { ...request.params, name: alias.target, arguments: validated.args },
    } as unknown as JSONRPCMessage;
    this.onmessage?.(rewritten, extra);
  }

  /** Answers an alias call directly with a plain isError result; send() appends the rename note. */
  private respondWithError(id: RequestId, text: string): void {
    void this.send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text }], isError: true },
    } as JSONRPCMessage).catch((error) => this.onerror?.(error instanceof Error ? error : new Error(String(error))));
  }

  private filterToolsList(message: JSONRPCMessage): JSONRPCMessage {
    const response = message as { id?: RequestId; result?: any; method?: string };
    if ((!this.visibleTools && !this.claudeDirectoryProfile) || response.method !== undefined || response.id === undefined || response.id === null) return message;
    const key = requestKey(response.id);
    if (!this.listRequests.has(key)) return message;
    this.listRequests.delete(key);
    if (!isObject(response.result) || !Array.isArray(response.result.tools)) return message;
    const visible = this.visibleTools;
    const filtered = {
      ...(message as object),
      result: {
        ...response.result,
        tools: response.result.tools
          .filter((tool: { name?: unknown }) => typeof tool?.name === 'string' && (!visible || visible.has(tool.name)) && (!this.claudeDirectoryProfile || isClaudeDirectoryTool(tool.name)))
          .map((tool: { name: string; inputSchema: unknown }) => this.claudeDirectoryProfile ? {
            ...tool, description: claudeDirectoryDescription(tool.name), inputSchema: claudeDirectorySchema(tool.inputSchema),
          } : tool),
      },
    };
    return filtered as unknown as JSONRPCMessage;
  }

  private decorateResponse(message: JSONRPCMessage): JSONRPCMessage {
    const response = message as { id?: RequestId; result?: any; error?: unknown; method?: string };
    if (response.method !== undefined || response.id === undefined || response.id === null) return message;
    const key = requestKey(response.id);
    const info = this.calls.get(key);
    if (!info) return message;
    this.calls.delete(key);
    if (!isObject(response.result) || !Array.isArray(response.result.content)) return message;

    const note = deprecationNote(info.alias);
    const decorated = {
      ...(message as object),
      result: {
        ...response.result,
        content: [...response.result.content, { type: 'text', text: note.text }],
        _meta: { ...(isObject(response.result._meta) ? response.result._meta : {}), [DEPRECATION_META_KEY]: note.meta },
      },
    };
    return decorated as unknown as JSONRPCMessage;
  }
}
