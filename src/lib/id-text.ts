/**
 * Identifiers must round-trip. A numeric id printed with a thousands
 * separator ("1,961") is not the same id when an agent pastes it back, and
 * list or validate calls then miss the account or post with no useful error.
 *
 * Counts and metrics stay on the cell formatter (toLocaleString). Only
 * values that are ids, or strings that are nothing but a grouped integer,
 * use these helpers.
 */

const GROUPED_INTEGER = /^[+-]?\d{1,3}(?:,\d{3})+$/

/** True for account_id, post_id, account_ids, preview_id, and the same shape. */
export function isIdParamName(name: string): boolean {
  return /(?:^|_)ids?$/.test(name)
}

/**
 * "1,961" becomes "1961". Any other string, including UUIDs and resource
 * names, is returned unchanged.
 */
export function stripGroupedInteger(value: string): string {
  const trimmed = value.trim()
  if (!GROUPED_INTEGER.test(trimmed)) return value
  return trimmed.replace(/,/g, '')
}

/**
 * Digits to put inside backticks for an id, or null when the value is not
 * an id-shaped number or grouped integer (the caller keeps its own formatter).
 */
export function idCodeText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') {
    const stripped = stripGroupedInteger(value)
    if (stripped !== value) return stripped
  }
  return null
}

function normalizeIdValue(value: unknown): unknown {
  if (typeof value === 'string') return stripGroupedInteger(value)
  if (Array.isArray(value)) return value.map((item) => normalizeIdValue(item))
  return value
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isIdParamName(key) ? normalizeIdValue(child) : walk(child, depth + 1)
  }
  return out
}

/**
 * Rewrites id arguments so a pasted "1,961" is the digits "1961".
 * Numbers stay numbers. Non-id strings are left alone.
 */
export function normalizeIdArgs<T>(args: T): T {
  return walk(args, 0) as T
}
