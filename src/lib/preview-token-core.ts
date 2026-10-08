/**
 * Preview-then-confirm tokens for MCP write actions, shared by both surfaces.
 * Depends on node:crypto only.
 *
 * Format: pv1.<exp>.<nonce>.<mac>
 *   exp   unix seconds when the preview stops being confirmable
 *   nonce random, base64url; also the one-time-use key for nonce actions
 *   mac   base64url HMAC-SHA256(key,
 *           "posterly-mcp-preview-v1|" + exp + "|" + nonce + "|" + userId
 *           + "|" + tool + "|" + action + "|" + canonicalJson(args))
 *
 * The token binds the preview to one user, one tool, one action, and the
 * exact (normalised) arguments, so a confirm call with different args, from a
 * different user, or after expiry is refused. It is UX protection that a
 * human saw what will change, not authorization: REST scopes and ownership
 * checks still decide what is allowed.
 *
 * Callers own the key (hosted: derived from a server secret; stdio: random
 * per process) and the one-time-use store (hosted: Redis; stdio: memory).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PREVIEW_TOKEN_VERSION = 'pv1';
const MAC_DOMAIN = 'posterly-mcp-preview-v1';

export interface PreviewBinding {
  userId: string;
  tool: string;
  action: string;
  /** Arguments AFTER validation/normalisation (defaults applied, numbers coerced). */
  args: unknown;
}

export type VerifyPreviewResult =
  | { ok: true; exp: number; nonce: string; remainingSeconds: number }
  | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
 * Canonical JSON of a call's arguments: `confirm` and `preview_id` removed
 * (top level), undefined dropped, keys sorted recursively, arrays kept in
 * order, no whitespace. Same rules as canonicalArgs in tool-registry.ts.
 */
export function canonicalJson(args: unknown): string {
  const source = isPlainObject(args) ? args : {};
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'confirm' || key === 'preview_id') continue;
    stripped[key] = value;
  }
  return JSON.stringify(sortKeysDeep(stripped));
}

/** Derives the MAC key from a server secret with a domain prefix, so the raw secret is never the key. */
export function derivePreviewKey(secret: string | Buffer, domain = 'posterly-mcp-preview-key-v1'): Buffer {
  return createHmac('sha256', secret).update(domain).digest();
}

function field(value: string): string {
  // Pipes separate fields; ids never contain them, but never let one shift a
  // boundary. Percent is escaped first so the encoding is injective: a value
  // that already contains "%7C" cannot collide with one that contains "|".
  return value.replace(/%/g, '%25').replace(/\|/g, '%7C');
}

function computeMac(key: Buffer, exp: number, nonce: string, binding: PreviewBinding): string {
  const payload = [
    MAC_DOMAIN,
    String(exp),
    nonce,
    field(binding.userId),
    field(binding.tool),
    field(binding.action),
    canonicalJson(binding.args),
  ].join('|');
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createPreviewToken(
  key: Buffer,
  binding: PreviewBinding,
  options: { ttlSeconds: number; nowMs?: number; nonce?: string },
): string {
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const exp = now + Math.max(1, Math.floor(options.ttlSeconds));
  const nonce = options.nonce ?? randomBytes(16).toString('base64url');
  const mac = computeMac(key, exp, nonce, binding);
  return `${PREVIEW_TOKEN_VERSION}.${exp}.${nonce}.${mac}`;
}

export function parsePreviewToken(token: unknown): { exp: number; nonce: string; mac: string } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== PREVIEW_TOKEN_VERSION) return null;
  const [, expRaw, nonce, mac] = parts;
  if (!/^\d{1,12}$/.test(expRaw) || !/^[A-Za-z0-9_-]{8,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{20,100}$/.test(mac)) return null;
  return { exp: Number(expRaw), nonce, mac };
}

export function verifyPreviewToken(
  key: Buffer,
  token: unknown,
  binding: PreviewBinding,
  options: { nowMs?: number } = {},
): VerifyPreviewResult {
  const parsed = parsePreviewToken(token);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(computeMac(key, parsed.exp, parsed.nonce, binding));
  const actual = Buffer.from(parsed.mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'mismatch' };
  }
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (parsed.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, exp: parsed.exp, nonce: parsed.nonce, remainingSeconds: parsed.exp - now };
}

/** Stable fingerprint of a token for one-time-use bookkeeping (never store the raw token). */
export function previewTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Plain-language refusal for each verification failure. */
export function previewFailureMessage(reason: 'malformed' | 'expired' | 'mismatch' | 'used' | 'missing' | 'unavailable'): string {
  switch (reason) {
    case 'missing':
      return 'confirm: true needs the preview_id from a preview call. Call once without confirm, show the preview to the user, then confirm with its preview_id.';
    case 'expired':
      return 'This preview expired, so nothing was changed. Call again without confirm to get a fresh preview.';
    case 'mismatch':
      return 'This preview does not match these arguments, so nothing was changed. Call again without confirm to get a fresh preview for exactly what should happen.';
    case 'used':
      return 'This preview was already used, so nothing was changed. Call again without confirm to get a fresh preview.';
    case 'unavailable':
      return 'posterly could not check this preview right now, so nothing was changed. Please retry in a moment.';
    default:
      return 'preview_id is not valid, so nothing was changed. Call again without confirm to get a fresh preview.';
  }
}
