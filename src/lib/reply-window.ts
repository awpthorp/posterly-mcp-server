/**
 * Keep in step with lib/inbox/reply-window.ts. The npm package cannot import
 * the Next.js app, so this copy only formats the stored window for assistants.
 */

const MESSAGING_WINDOW_LABEL = 'reply window'

export function replyWindowPhrase(expiresAt: unknown, now = Date.now()): string | null {
  if (typeof expiresAt !== 'string' || !expiresAt) return null
  const ms = new Date(expiresAt).getTime()
  if (!Number.isFinite(ms)) return null
  const stamp = `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return ms > now ? `${MESSAGING_WINDOW_LABEL} open until ${stamp}` : `${MESSAGING_WINDOW_LABEL} closed ${stamp}`
}
