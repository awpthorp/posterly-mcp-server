/**
 * Behavioural tests for the payload builders.
 *
 * scripts/check-mcp-schema-parity.ts compares the JSON Schema each surface
 * publishes, which catches a field going missing or an enum narrowing. It does
 * NOT catch validation written as code rather than schema, and that is exactly
 * how the caption bug shipped: buildCreatePostPayload threw
 * "caption is required" for every post without caption text while the schema
 * happily declared caption optional. Nothing compared behaviour, so the npm
 * package rejected every media-only post (Instagram and Facebook Stories carry
 * no caption) for as long as it did.
 *
 * These tests pin the rules the server actually applies, so a future edit that
 * tightens the client past the server fails here.
 *
 * buildCreatePostPayload also takes an AccountPlatformResolver (built from a
 * PosterlyClient by createAccountPlatformResolver) so it can resolve an
 * account_id's real platform for thread_posts when the caller did not pass
 * `platform` (there is no other way to tell an X thread from a Threads
 * thread). fakeClient() below stands in for the real client, and counts
 * calls so the "one lookup per workspace_id" batching behaviour can be
 * asserted directly.
 */

import assert from 'node:assert/strict';
import { buildCreatePostPayload, createAccountPlatformResolver } from '../dist/tools/create-post.js';

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

const IMAGE = 'https://assets.poster.ly/users/test/a.jpg';

/**
 * A minimal PosterlyClient stand-in. Throws if listAccounts is called when
 * the test does not expect it (accounts === null), or rejects with `fail`
 * when a lookup-failure test needs a realistic error. Tracks call count so
 * "one lookup per workspace_id" can be asserted.
 */
function fakeClient(accounts = null, { fail } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    async listAccounts() {
      calls += 1;
      if (fail) throw new Error(fail);
      if (accounts === null) {
        throw new Error('listAccounts should not have been called for this input');
      }
      return accounts;
    },
  };
}

// The server rule (lib/api-v1-post-create.ts) is "provide caption or media".
// Media-only posts are valid and must not be rejected by the client.
await check('media-only post is accepted (Instagram Story shape)', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'instagram',
    media_url: IMAGE,
    post_type: 'story',
    instagram_settings: { post_type: 'story' },
  }, createAccountPlatformResolver(fakeClient()));
  assert.equal(typeof payload.caption, 'string', 'caption should be sent as a string');
  assert.equal(payload.post_type, 'story');
});

await check('media-only post is accepted (Facebook Story shape)', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'facebook',
    media_url: IMAGE,
    post_type: 'story',
    platform_settings: { __type: 'facebook', post_type: 'story' },
  }, createAccountPlatformResolver(fakeClient()));
  assert.equal(typeof payload.caption, 'string');
});

await check('media_urls-only post is accepted', async () => {
  const payload = await buildCreatePostPayload(
    { platform: 'instagram', media_urls: [IMAGE] },
    createAccountPlatformResolver(fakeClient()),
  );
  assert.equal(typeof payload.caption, 'string');
});

await check('caption-only post is accepted', async () => {
  const payload = await buildCreatePostPayload(
    { platform: 'linkedin', caption: 'hello' },
    createAccountPlatformResolver(fakeClient()),
  );
  assert.equal(payload.caption, 'hello');
});

await check('post with neither caption nor media is rejected', async () => {
  await assert.rejects(
    () => buildCreatePostPayload({ platform: 'instagram' }, createAccountPlatformResolver(fakeClient())),
    /caption or media/i,
    'should reject, and the message should tell the caller media is an option',
  );
});

await check('thread_posts still bypasses the caption rule', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'twitter',
    thread_posts: ['one', 'two'],
  }, createAccountPlatformResolver(fakeClient()));
  assert.equal(payload.caption, 'one');
  assert.equal(payload.post_type, 'x_thread');
});

// Regression: thread_posts with only account_id (no platform) used to always
// guess an X thread, so a Threads account_id built x_thread_tweets and the
// server rejected it with "post_type x_thread requires a Twitter/X account".
await check('thread_posts + account_id resolves to threads_thread for a Threads account', async () => {
  const payload = await buildCreatePostPayload({
    account_id: 'acct_threads',
    thread_posts: ['one', 'two'],
  }, createAccountPlatformResolver(fakeClient([{ id: 'acct_threads', platform: 'threads', username: 'brand' }])));
  assert.equal(payload.platform, 'threads');
  assert.equal(payload.post_type, 'threads_thread');
  assert.deepEqual(payload.metadata.threads_thread_posts, ['one', 'two']);
  assert.equal(payload.metadata.x_thread_tweets, undefined);
});

await check('thread_posts + account_id resolves to x_thread for a Twitter/X account', async () => {
  const payload = await buildCreatePostPayload({
    account_id: 'acct_x',
    thread_posts: ['one', 'two'],
  }, createAccountPlatformResolver(fakeClient([{ id: 'acct_x', platform: 'twitter', username: 'brand' }])));
  assert.equal(payload.platform, 'twitter');
  assert.equal(payload.post_type, 'x_thread');
  assert.deepEqual(payload.metadata.x_thread_tweets, ['one', 'two']);
  assert.equal(payload.metadata.threads_thread_posts, undefined);
});

await check('thread_posts + explicit platform never looks up the account (unchanged request shape)', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'threads',
    account_id: 'acct_threads',
    thread_posts: ['one', 'two'],
  }, createAccountPlatformResolver(fakeClient(null)));
  assert.equal(payload.platform, 'threads');
  assert.equal(payload.post_type, 'threads_thread');
});

await check('thread_posts + account_id on a non-thread platform is rejected with a clear error', async () => {
  await assert.rejects(
    () => buildCreatePostPayload({
      account_id: 'acct_ig',
      thread_posts: ['one', 'two'],
    }, createAccountPlatformResolver(fakeClient([{ id: 'acct_ig', platform: 'instagram', username: 'brand' }]))),
    /resolved to platform "instagram"/,
  );
});

await check('thread_posts + account_id that cannot be found is rejected with a clear error', async () => {
  await assert.rejects(
    () => buildCreatePostPayload({
      account_id: 'does-not-exist',
      thread_posts: ['one', 'two'],
    }, createAccountPlatformResolver(fakeClient([{ id: 'acct_threads', platform: 'threads', username: 'brand' }]))),
    /that exists in list_accounts/,
  );
});

// The lookup itself can fail (non-2xx, missing accounts:read scope, network
// error): the caller needs that real cause, not just a generic "pass
// platform explicitly" that hides why resolution failed.
await check('thread_posts + account_id surfaces the real lookup failure, not a generic message', async () => {
  await assert.rejects(
    () => buildCreatePostPayload({
      account_id: 'acct_threads',
      thread_posts: ['one', 'two'],
    }, createAccountPlatformResolver(fakeClient(null, { fail: 'Missing required scope: accounts:read' }))),
    /Missing required scope: accounts:read/,
  );
});

// Batching: a batch of items sharing one workspace_id must cost one
// accounts lookup, not one per item. create_posts_batch builds a single
// resolver and reuses it across every buildCreatePostPayload call; this
// pins that the resolver itself (not the caller) is what dedupes.
await check('one resolver shared across a batch makes exactly one accounts lookup per workspace_id', async () => {
  const client = fakeClient([
    { id: 'acct_threads', platform: 'threads', username: 'brand' },
    { id: 'acct_x', platform: 'twitter', username: 'brand2' },
  ]);
  const resolvePlatform = createAccountPlatformResolver(client);
  const [threadsPayload, xPayload, thirdPayload] = await Promise.all([
    buildCreatePostPayload({ account_id: 'acct_threads', workspace_id: 'ws_1', thread_posts: ['a', 'b'] }, resolvePlatform),
    buildCreatePostPayload({ account_id: 'acct_x', workspace_id: 'ws_1', thread_posts: ['c', 'd'] }, resolvePlatform),
    buildCreatePostPayload({ account_id: 'acct_threads', workspace_id: 'ws_1', thread_posts: ['e', 'f'] }, resolvePlatform),
  ]);
  assert.equal(threadsPayload.platform, 'threads');
  assert.equal(xPayload.platform, 'twitter');
  assert.equal(thirdPayload.platform, 'threads');
  assert.equal(client.calls(), 1, `expected exactly one accounts lookup for one workspace_id, got ${client.calls()}`);
});

if (failures > 0) {
  console.error(`\n${failures} payload-builder test(s) failed.`);
  process.exit(1);
}
