/**
 * Node's fetch (undici) THROWS when a header value contains anything outside
 * printable Latin-1 with no control characters, not just rejects it. The
 * X-Posterly-Client header carries the connected MCP client's self-reported
 * name straight through, so a client identifying itself as e.g. "通义灵码" or
 * with an en/em dash in its name would otherwise break every single tool
 * call this package makes. sanitizeClientHeaderValue strips anything outside
 * printable ASCII before the header is ever built.
 *
 * These tests prove the raw value would have thrown building a real fetch
 * Headers object, and that the sanitized value never does.
 */

import assert from 'node:assert/strict';
import { sanitizeClientHeaderValue } from '../dist/lib/api-client.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

function throwsBuildingHeaders(value) {
  try {
    new Headers({ 'X-Posterly-Client': value });
    return false;
  } catch {
    return true;
  }
}

check('plain ASCII name passes through unchanged', () => {
  assert.equal(sanitizeClientHeaderValue('claude-ai'), 'claude-ai');
});

check('non-ASCII client name is stripped to printable ASCII', () => {
  const raw = '通义灵码';
  assert.equal(throwsBuildingHeaders(raw), true, 'the raw value should be unsafe to use as a header value directly');
  assert.equal(sanitizeClientHeaderValue(raw), '', 'nothing printable-ASCII remains');
});

check('mixed name with an en/em dash keeps the ASCII letters and drops the dash', () => {
  const raw = 'Claude\u2014Code';
  assert.equal(throwsBuildingHeaders(raw), true, 'an em dash is outside Latin-1 header-safe range and is unsafe raw');
  const cleaned = sanitizeClientHeaderValue(raw);
  assert.equal(cleaned, 'ClaudeCode');
  assert.equal(throwsBuildingHeaders(cleaned), false, 'the cleaned value must be safe to use as a header value');
});

check('newline in a client name is stripped, not passed through', () => {
  const raw = 'chatgpt\ndesktop';
  assert.equal(throwsBuildingHeaders(raw), true, 'a raw newline is unsafe as a header value');
  const cleaned = sanitizeClientHeaderValue(raw);
  assert.equal(cleaned, 'chatgptdesktop');
  assert.equal(throwsBuildingHeaders(cleaned), false);
});

check('a name that is entirely non-ASCII sanitizes to empty (caller omits the header)', () => {
  assert.equal(sanitizeClientHeaderValue('通义灵码'), '');
  assert.equal(sanitizeClientHeaderValue('   '), '', 'whitespace-only also sanitizes to empty after trim');
});

check('over-length values are truncated to 200 characters', () => {
  const cleaned = sanitizeClientHeaderValue('a'.repeat(250));
  assert.equal(cleaned.length, 200);
  assert.equal(throwsBuildingHeaders(cleaned), false);
});

if (failures > 0) {
  console.error(`\n${failures} client-header-sanitization test(s) failed.`);
  process.exit(1);
}
console.log('\nOK  X-Posterly-Client is always safe to send as a header value.');
