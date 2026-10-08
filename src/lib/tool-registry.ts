/**
 * Pure, dependency-free helpers over the MCP tool registry
 * (mcp-server/tool-registry.json). Shared by BOTH surfaces:
 *   - the npm stdio package (mcp-server/src/index.ts, alias-transport.ts)
 *   - the hosted endpoint (lib/mcp/tool-registry.ts re-exports these with the
 *     registry bound)
 *
 * This module never imports the JSON itself: each surface loads the registry
 * its own way (createRequire on stdio, a static JSON import on hosted) and
 * passes it in. Keep it free of Node, Next, and zod imports so it compiles
 * unchanged under both the package tsconfig and the app tsconfig.
 */

export type ToolsetName = string;
export type ConfirmLevel = 'none' | 'confirm' | 'preview';
export type ToolSurface = 'hosted' | 'stdio';
export type ModeSelector = 'view' | 'action' | 'type' | 'params';

export type ExceptionCategory =
  | 'money'
  | 'secret'
  | 'signup'
  | 'publishing'
  | 'ai_generation'
  | 'feedback'
  | 'connect'
  | 'single_action'
  | 'session'
  | 'dispatcher'
  | 'report';

export interface ModeParamSpec {
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: Array<string | number>;
  /** Keep an explicit null (for example workspace_id: null clears a webhook's workspace). */
  nullable?: boolean;
}

/** One view (read) or action (write) inside a multi-mode tool. */
export interface ToolModeEntry {
  label: string;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  confirm?: ConfirmLevel;
  /** Preview actions whose confirm may be used once only (public writes). */
  nonce?: boolean;
  /** When present, the only params this mode accepts (besides the selector, confirm, preview_id). */
  params?: Record<string, ModeParamSpec>;
  /**
   * Param-driven tools (selector "params") only: this mode is chosen when any
   * of these params is present. The one mode without `when` is the default.
   */
  when?: string[];
}

export interface ToolRegistryTool {
  set: ToolsetName;
  label: string;
  /** Surfaces that register this tool. Defaults to both. */
  surfaces?: ToolSurface[];
  exception?: { category: ExceptionCategory; reason: string };
  /** Single-mode tools carry their hints here; multi-mode tools derive them from views/actions. */
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  confirm?: ConfirmLevel;
  /**
   * How a multi-mode tool picks its mode: an enum param (view/action/type), or
   * "params" when the mode follows from which params are present (for example
   * update_post with status vs content fields). Param-driven modes are still
   * recorded as views/actions so the action count is derived from the registry.
   */
  selector?: ModeSelector;
  /** Default view/action when the selector param is omitted. */
  defaultMode?: string;
  views?: Record<string, ToolModeEntry>;
  actions?: Record<string, ToolModeEntry>;
}

export interface ToolRegistryAlias {
  target: string;
  /** Params forced onto the translated call (inject wins over caller args). */
  inject?: Record<string, unknown>;
  /** Old param name -> new param name. */
  rename?: Record<string, string>;
  /** Accept confirm:true without preview_id until sunset (per call, never stored on shared context). */
  legacyConfirm?: boolean;
  /**
   * Param-driven targets (selector "params") only: the mode the old tool
   * always ran in, so for example get_comment without comment_id is still
   * rejected instead of silently listing every comment.
   */
  mode?: string;
  added: string;
  sunset: string;
}

export interface ToolRegistry {
  $comment?: string;
  version: number;
  designRules: 'off' | 'on';
  budgets: { maxTotal: number; maxCore: number };
  sunset: string | null;
  toolsets: Record<ToolsetName, { label: string; description: string; alwaysOn?: boolean; surfaces?: ToolSurface[] }>;
  tools: Record<string, ToolRegistryTool>;
  aliases: Record<string, ToolRegistryAlias>;
}

export interface ResolvedAlias extends ToolRegistryAlias {
  name: string;
}

/** The alias entry for `name`, or null when `name` is not an alias. */
export function resolveAlias(registry: ToolRegistry, name: string): ResolvedAlias | null {
  if (!Object.prototype.hasOwnProperty.call(registry.aliases, name)) return null;
  return { name, ...registry.aliases[name] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Translates an alias call's arguments into the target tool's arguments.
 * Always returns a fresh object (never mutates the caller's args): renames
 * first, then injected params, which win over anything the caller passed.
 */
export function translateArgs(alias: ToolRegistryAlias, args: unknown): Record<string, unknown> {
  const source = isPlainObject(args) ? args : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const renamed = alias.rename && Object.prototype.hasOwnProperty.call(alias.rename, key) ? alias.rename[key] : key;
    out[renamed] = value;
  }
  for (const [key, value] of Object.entries(alias.inject ?? {})) {
    out[key] = value;
  }
  return out;
}

export type ValidateModeResult =
  | { ok: true; mode: string | null; args: Record<string, unknown> }
  | { ok: false; error: string };

const MODE_COMMON_PARAMS = new Set(['confirm', 'preview_id']);

function modeEntries(tool: ToolRegistryTool): Record<string, ToolModeEntry> | null {
  return tool.views ?? tool.actions ?? null;
}

function normalizeParam(name: string, value: unknown, spec: ModeParamSpec, where: string): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (spec.type) {
    case 'integer':
    case 'number': {
      let n: unknown = value;
      if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim())) n = Number(value.trim());
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: `${name} must be a number${where}.` };
      if (spec.type === 'integer' && !Number.isInteger(n)) return { ok: false, error: `${name} must be a whole number${where}.` };
      if (spec.min != null && n < spec.min) return { ok: false, error: `${name} must be at least ${spec.min}${where}.` };
      if (spec.max != null && n > spec.max) return { ok: false, error: `${name} must be at most ${spec.max}${where}.` };
      if (spec.enum && !spec.enum.includes(n)) return { ok: false, error: `${name} must be one of ${spec.enum.join(', ')}${where}.` };
      return { ok: true, value: n };
    }
    case 'string': {
      if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
      if (typeof value !== 'string') return { ok: false, error: `${name} must be a string${where}.` };
      if (spec.enum && !spec.enum.includes(value)) return { ok: false, error: `${name} must be one of ${spec.enum.join(', ')}${where}.` };
      return { ok: true, value };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, error: `${name} must be true or false${where}.` };
      return { ok: true, value };
    case 'array':
      if (!Array.isArray(value)) return { ok: false, error: `${name} must be a list${where}.` };
      return { ok: true, value };
    case 'object':
      if (!isPlainObject(value)) return { ok: false, error: `${name} must be an object${where}.` };
      return { ok: true, value };
    default:
      return { ok: true, value };
  }
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * The mode a param-driven tool (selector "params") runs in for these args:
 * the first mode whose `when` params are present, otherwise the tool's
 * default mode (the one without `when`). Undefined for other tools.
 */
export function detectParamsMode(tool: ToolRegistryTool, args: unknown): string | undefined {
  if (tool.selector !== 'params') return undefined;
  const entries = modeEntries(tool);
  if (!entries) return undefined;
  const source = isPlainObject(args) ? args : {};
  for (const [mode, entry] of Object.entries(entries)) {
    if (entry.when?.some((key) => isPresent(source[key]))) return mode;
  }
  if (tool.defaultMode !== undefined) return tool.defaultMode;
  return Object.entries(entries).find(([, entry]) => !entry.when)?.[0];
}

/**
 * Validates and normalises a call's arguments against the registry's per-mode
 * rules, BEFORE any request is made. It is the normaliser on both surfaces
 * (the hosted endpoint has no zod), so a preview call and its confirm call
 * hash identically: numeric strings become numbers, defaults are applied, and
 * params outside the selected mode are rejected with a plain error.
 *
 * `explicitMode` forces a mode for param-driven tools (selector "params"), for
 * example an alias of the old get_comment tool always runs in the comment
 * mode. Without it, a param-driven tool's mode is detected from which params
 * are present (see detectParamsMode).
 *
 * Tools without views/actions, and modes without a `params` spec, pass
 * through unchanged (a fresh copy).
 */
export function validateMode(
  registry: ToolRegistry,
  toolName: string,
  args: unknown,
  explicitMode?: string,
): ValidateModeResult {
  const tool = registry.tools[toolName];
  const source = isPlainObject(args) ? { ...args } : {};
  if (!tool) return { ok: false, error: `Unknown tool: ${toolName}` };
  const entries = modeEntries(tool);
  if (!entries || !tool.selector) return { ok: true, mode: null, args: source };

  const selector = tool.selector;
  let mode: string | undefined = explicitMode;
  if (selector === 'params' && mode === undefined) {
    mode = detectParamsMode(tool, source);
  } else if (selector !== 'params') {
    const raw = source[selector];
    if (raw === undefined || raw === null || raw === '') {
      mode = tool.defaultMode;
      if (mode === undefined) {
        return { ok: false, error: `${selector} is required. Use one of: ${Object.keys(entries).join(', ')}.` };
      }
      source[selector] = mode;
    } else if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(entries, raw)) {
      return { ok: false, error: `${selector} must be one of: ${Object.keys(entries).join(', ')}.` };
    } else {
      mode = raw;
    }
  }
  if (mode === undefined) return { ok: true, mode: null, args: source };
  const entry = entries[mode];
  if (!entry) return { ok: false, error: `Unknown ${selector === 'params' ? 'mode' : selector} ${mode} for ${toolName}.` };
  if (!entry.params) return { ok: true, mode, args: source };

  const where = selector === 'params' ? '' : ` with ${selector}=${mode}`;
  const notAllowedWhere = selector === 'params'
    ? (entry.when?.length ? ` together with ${entry.when.join(' or ')}` : '')
    : where;
  for (const key of Object.keys(source)) {
    if (key === selector || MODE_COMMON_PARAMS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(entry.params, key)) {
      // Many clients send every optional field, unset ones as null or "".
      // Those carry no value, so they are dropped (never rejected), which
      // also keeps a preview call and its confirm call hashing identically.
      if (!isPresent(source[key])) {
        delete source[key];
        continue;
      }
      return { ok: false, error: `${key} is not allowed${notAllowedWhere}.` };
    }
  }
  for (const [name, spec] of Object.entries(entry.params)) {
    // The old hosted tools skipped falsy values (`if (input?.limit)`), so an
    // empty string for a non-string param still means "not given".
    if (source[name] === '' && spec.type && spec.type !== 'string') delete source[name];
    const value = source[name];
    if (value === null && spec.nullable) continue;
    if (value === undefined || value === null) {
      if (spec.required) return { ok: false, error: `${name} is required${where}.` };
      if (spec.default !== undefined) source[name] = spec.default;
      else delete source[name];
      continue;
    }
    const normalized = normalizeParam(name, value, spec, where);
    if (!normalized.ok) return normalized;
    source[name] = normalized.value;
  }
  return { ok: true, mode, args: source };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortKeysDeep(item)));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) continue;
      out[key] = sortKeysDeep(item);
    }
    return out;
  }
  return value;
}

/**
 * The canonical form of a call's arguments for hashing: `confirm` and
 * `preview_id` removed, undefined dropped, object keys sorted recursively,
 * arrays kept in order. Pass args AFTER validateMode so defaults and number
 * coercion are already applied.
 */
export function canonicalArgs(args: unknown): Record<string, unknown> {
  const source = isPlainObject(args) ? args : {};
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'confirm' || key === 'preview_id') continue;
    stripped[key] = value;
  }
  return sortKeysDeep(stripped) as Record<string, unknown>;
}

export interface DeprecationInfo {
  old: string;
  new: string;
  action: string | null;
  sunset: string;
}

function injectedMode(alias: ToolRegistryAlias): { key: string; value: string } | null {
  const inject = alias.inject ?? {};
  for (const key of ['action', 'view', 'type'] as const) {
    const value = inject[key];
    if (typeof value === 'string') return { key, value };
  }
  return null;
}

/**
 * The note appended (as a final text content item, never touching content[0])
 * to every alias call's result, plus the matching _meta payload. `action` in
 * the payload is the injected view/action/type value (null when none).
 */
export function deprecationNote(alias: ResolvedAlias): { text: string; meta: DeprecationInfo } {
  const mode = injectedMode(alias);
  const target = mode ? `${alias.target} with ${mode.key}=${mode.value}` : alias.target;
  return {
    text: `Renamed: ${alias.name} is now ${target}. The old name may stop working after ${alias.sunset}.`,
    meta: { old: alias.name, new: alias.target, action: mode ? mode.value : null, sunset: alias.sunset },
  };
}

export const DEPRECATION_META_KEY = 'posterly/deprecation';

export interface ParsedToolsets {
  /** Enabled set names, or every set when "all" (the default). */
  enabled: ToolsetName[];
  /** Requested names that are not known sets (ignored). */
  unknown: string[];
  /** True when every set is enabled. */
  all: boolean;
}

/**
 * Parses a toolset selection such as "core,inbox" or "all". Empty, missing,
 * or all-unknown input means every set (nobody loses tools by mistake).
 * With a surface, sets not available on it (for example signup, stdio only,
 * on the hosted endpoint) are treated as unknown.
 */
export function parseToolsets(
  registry: ToolRegistry,
  value: string | null | undefined,
  surface?: ToolSurface,
): ParsedToolsets {
  const available = Object.entries(registry.toolsets)
    .filter(([, set]) => !surface || !set.surfaces || set.surfaces.includes(surface))
    .map(([name]) => name);
  const requested = String(value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0 || requested.includes('all')) {
    return { enabled: available, unknown: requested.filter((name) => name !== 'all' && !available.includes(name)), all: true };
  }
  const enabled = available.filter((name) => requested.includes(name));
  const unknown = requested.filter((name) => !available.includes(name));
  if (enabled.length === 0) return { enabled: available, unknown, all: true };
  return { enabled, unknown, all: enabled.length === available.length };
}

/**
 * Names of the canonical tools visible on `surface` for the enabled sets.
 * Aliases are never listed. Sets marked alwaysOn (signup on stdio) are always
 * visible. Surfaces keep their own registration order by filtering with this.
 */
export function visibleTools(registry: ToolRegistry, sets: ToolsetName[], surface: ToolSurface): Set<string> {
  const enabled = new Set(sets);
  const visible = new Set<string>();
  for (const [name, tool] of Object.entries(registry.tools)) {
    const surfaces = tool.surfaces ?? ['hosted', 'stdio'];
    if (!surfaces.includes(surface)) continue;
    const set = registry.toolsets[tool.set];
    if (enabled.has(tool.set) || set?.alwaysOn) visible.add(name);
  }
  return visible;
}

export interface DerivedAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * Annotation hints derived from the registry: a multi-action tool is
 * destructive if any action is, idempotent only if all are, openWorld if any
 * is; multi-view reads are readOnly + idempotent, openWorld if any view is.
 */
export function deriveAnnotations(tool: ToolRegistryTool): DerivedAnnotations {
  if (tool.views && !tool.actions) {
    const views = Object.values(tool.views);
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: views.some((view) => view.openWorld === true),
    };
  }
  if (tool.actions) {
    const actions = Object.values(tool.actions);
    return {
      readOnlyHint: false,
      destructiveHint: actions.some((action) => action.destructive === true),
      idempotentHint: actions.length > 0 && actions.every((action) => action.idempotent === true),
      openWorldHint: actions.some((action) => action.openWorld === true),
    };
  }
  const readOnly = tool.readOnly === true;
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && tool.destructive === true,
    idempotentHint: readOnly || tool.idempotent === true,
    openWorldHint: tool.openWorld === true,
  };
}

/** Actions (sub tools) a tool counts for: its views/actions, otherwise 1. */
export function countActions(tool: ToolRegistryTool): number {
  const entries = modeEntries(tool);
  return entries ? Math.max(1, Object.keys(entries).length) : 1;
}

export interface ToolListingAction {
  key: string;
  label: string;
}

export interface ToolListingTool {
  name: string;
  label: string;
  /** The view/action/type param name, or null for param-driven or single-mode tools. */
  selector: string | null;
  /** Views/actions (the "sub tools") with plain-English labels; empty for single-mode tools. */
  actions: ToolListingAction[];
}

export interface ToolListingSet {
  set: ToolsetName;
  label: string;
  description: string;
  tools: ToolListingTool[];
}

/**
 * Every canonical tool on `surface`, grouped by tool set in registry order,
 * each with its views/actions and their labels. This is what every tool list
 * in the docs, marketing pages, and server card renders from, so the "sub
 * tools" inside a merged tool are always shown. Aliases are never listed.
 */
export function listToolsBySet(registry: ToolRegistry, surface: ToolSurface): ToolListingSet[] {
  const groups: ToolListingSet[] = [];
  for (const [set, info] of Object.entries(registry.toolsets)) {
    if (info.surfaces && !info.surfaces.includes(surface)) continue;
    const tools: ToolListingTool[] = [];
    for (const [name, tool] of Object.entries(registry.tools)) {
      if (tool.set !== set) continue;
      if (!(tool.surfaces ?? ['hosted', 'stdio']).includes(surface)) continue;
      const entries = modeEntries(tool);
      tools.push({
        name,
        label: tool.label,
        selector: entries && tool.selector && tool.selector !== 'params' ? tool.selector : null,
        actions: entries ? Object.entries(entries).map(([key, entry]) => ({ key, label: entry.label })) : [],
      });
    }
    if (tools.length > 0) groups.push({ set, label: info.label, description: info.description, tools });
  }
  return groups;
}

/**
 * What a called name resolves to: the canonical tool plus the view/action it
 * runs (for an alias), or the name itself. Used by /admin/mcp to show old
 * names next to the tool they now reach, without any new telemetry column.
 */
export function resolveCalledTool(
  registry: ToolRegistry,
  calledName: string,
): { called: string; tool: string; mode: string | null; alias: boolean } {
  const alias = resolveAlias(registry, calledName);
  if (!alias) return { called: calledName, tool: calledName, mode: null, alias: false };
  const injected = injectedMode(alias);
  return { called: calledName, tool: alias.target, mode: injected?.value ?? alias.mode ?? null, alias: true };
}

/**
 * The initialize `instructions` text: which tool sets exist, that they are
 * all on by default, how to load fewer, and how preview then confirm works.
 */
export function toolsetInstructions(registry: ToolRegistry, surface: ToolSurface): string {
  const sets = Object.entries(registry.toolsets)
    .filter(([, set]) => !set.surfaces || set.surfaces.includes(surface))
    .map(([name, set]) => `${name} (${set.description.split('. ')[0].replace(/\.$/, '')})`);
  const howTo = surface === 'hosted'
    ? 'To load fewer tools with an API key in the Authorization header, add ?toolsets=core,inbox to the endpoint URL. OAuth connectors always get every set.'
    : 'To load fewer tools, set POSTERLY_TOOLSETS=core,inbox (or pass --toolsets=core,inbox). The signup tools are always on.';
  return [
    `posterly groups its tools into sets: ${sets.join('; ')}.`,
    `Every set is on by default. ${howTo} Sets only change which tools are listed; any tool can still be called by name.`,
    'Merged tools pick what to do with a view, action, or type param; each tool description names every option.',
    'Tools that post publicly or delete things use preview then confirm: call once without confirm to get a preview and a preview_id, show it to the user, then call again with confirm: true and that preview_id.',
  ].join(' ');
}
