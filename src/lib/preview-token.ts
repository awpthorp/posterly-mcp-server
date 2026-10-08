/**
 * Stdio (npm package) preview tokens: a random key per process and an
 * in-memory one-time-use set. A preview only survives as long as the local
 * MCP process does, which matches how a local client uses it (preview and
 * confirm happen in the same session). This is UX protection only: REST
 * authorization on the posterly API is unchanged.
 */

import { randomBytes } from 'node:crypto';
import {
  createPreviewToken,
  previewTokenFingerprint,
  verifyPreviewToken,
  type PreviewBinding,
  type VerifyPreviewResult,
} from './preview-token-core.js';

export const STDIO_PREVIEW_TTL_SECONDS = 10 * 60;

export class StdioPreviewTokens {
  private readonly key: Buffer;
  private readonly used = new Map<string, number>();

  constructor(key: Buffer = randomBytes(32), private readonly ttlSeconds = STDIO_PREVIEW_TTL_SECONDS) {
    this.key = key;
  }

  create(binding: PreviewBinding, nowMs?: number): string {
    return createPreviewToken(this.key, binding, { ttlSeconds: this.ttlSeconds, nowMs });
  }

  verify(token: unknown, binding: PreviewBinding, nowMs?: number): VerifyPreviewResult {
    return verifyPreviewToken(this.key, token, binding, { nowMs });
  }

  /**
   * Marks a verified token as used. Returns false when it was already used
   * (a second confirm with the same preview_id). Call only after verify().
   */
  claimOnce(token: string, expSeconds: number, nowMs = Date.now()): boolean {
    this.sweep(nowMs);
    const fingerprint = previewTokenFingerprint(token);
    if (this.used.has(fingerprint)) return false;
    this.used.set(fingerprint, expSeconds);
    return true;
  }

  private sweep(nowMs: number): void {
    const now = Math.floor(nowMs / 1000);
    for (const [fingerprint, exp] of this.used) {
      if (exp <= now) this.used.delete(fingerprint);
    }
  }
}
