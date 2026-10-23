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
import { createSignedUploadTool } from '../dist/tools/create-signed-upload.js';
import { createMediaDropTool } from '../dist/tools/create-media-drop.js';
import { PosterlyClient } from '../dist/lib/api-client.js';

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

await check('instagram story caption is preserved', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'instagram',
    media_url: IMAGE,
    post_type: 'story',
    caption: 'Hello from the Story',
  }, createAccountPlatformResolver(fakeClient()));
  assert.equal(payload.caption, 'Hello from the Story');
  assert.equal(payload.post_type, 'story');
});

await check('instagram story series caption is preserved', async () => {
  const payload = await buildCreatePostPayload({
    platform: 'instagram',
    media_urls: [IMAGE, IMAGE],
    post_type: 'story_series',
    caption: 'Series caption',
  }, createAccountPlatformResolver(fakeClient()));
  assert.equal(payload.caption, 'Series caption');
  assert.equal(payload.post_type, 'story_series');
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

// create_signed_upload: one file keeps its old output, up to 20 files share one call.
function fakeUploadClient() {
  const seen = { single: [], batch: [] };
  return {
    seen,
    getSignedUploadUrl: async (...args) => {
      seen.single.push(args);
      return { upload_url: 'https://r2.example/one?sig=1', token: 'tok', path: 'u/one.jpg', public_url: 'https://assets.poster.ly/u/one.jpg' };
    },
    getSignedUploadUrls: async (files, workspaceId) => {
      seen.batch.push({ files, workspaceId });
      return {
        slots: [
          { index: 0, filename: files[0].filename, ok: true, upload_url: 'https://r2.example/a?sig=1', token: 't1', path: 'u/a.jpg', public_url: 'https://assets.poster.ly/u/a.jpg', expires_at: '2026-10-14T12:15:00.000Z', max_size: 10, headers: { 'content-type': 'image/jpeg' }, provider: 'r2' },
          { index: 1, filename: files[1].filename, ok: true, upload_url: 'https://r2.example/b?sig=1', token: 't2', path: 'u/b.pdf', public_url: 'https://assets.poster.ly/u/b.pdf', expires_at: '2026-10-14T12:15:00.500Z', max_size: 10, headers: { 'content-type': 'application/pdf' }, provider: 'r2' },
          { index: 2, filename: files[2].filename, ok: true, upload_url: 'https://r2.example/c?sig=1', token: 't3', path: 'u/c.mp4', public_url: 'https://assets.poster.ly/u/c.mp4', expires_at: '2026-10-14T12:15:01.000Z', max_size: 30, headers: { 'content-type': 'video/mp4' }, provider: 'r2' },
          { index: 3, filename: files[3].filename, ok: false, error: 'Unsupported file type: image/heic. Accepted: JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF (up to 50MB, for LinkedIn document posts). HEIC is not accepted.', code: 'unsupported_file_type' },
        ],
        summary: { requested: 4, ok: 3, failed: 1 },
      };
    },
  };
}

await check('create_signed_upload single file output is unchanged and never uses the batch call', async () => {
  const client = fakeUploadClient();
  const text = await createSignedUploadTool.execute(client, { filename: 'one.jpg', content_type: 'image/jpeg', size: 10 });
  assert.equal(client.seen.single.length, 1);
  assert.equal(client.seen.batch.length, 0);
  assert.equal(text, [
    'Signed upload created.',
    '• Upload URL: https://r2.example/one?sig=1',
    '• Token: tok',
    '• Storage path: u/one.jpg',
    '• Public URL after upload: https://assets.poster.ly/u/one.jpg',
    'PUT the raw file bytes to the upload URL with the same Content-Type. Then pass public_url to create_post.',
  ].join('\n'));
});

await check('create_signed_upload with files makes one batch call and lists every file', async () => {
  const client = fakeUploadClient();
  const files = [
    { filename: 'a.jpg', content_type: 'image/jpeg', size: 10 },
    { filename: 'b.pdf', content_type: 'application/pdf', size: 10 },
    { filename: 'c.mp4', content_type: 'video/mp4', size: 30 },
    { filename: 'photo.heic', content_type: 'image/heic', size: 10 },
  ];
  const text = await createSignedUploadTool.execute(client, { files, workspace_id: 'ws_1' });
  assert.equal(client.seen.batch.length, 1);
  assert.equal(client.seen.single.length, 0);
  assert.equal(client.seen.batch[0].workspaceId, 'ws_1');
  assert.match(text, /4 requested, 3 ready, 1 failed/);
  assert.match(text, /1\. a\.jpg\n   PUT https:\/\/r2\.example\/a\?sig=1\n   Content-Type: image\/jpeg\n   Public URL after upload: https:\/\/assets\.poster\.ly\/u\/a\.jpg/);
  assert.match(text, /2\. b\.pdf\n   PUT https:\/\/r2\.example\/b\?sig=1\n   Content-Type: application\/pdf\n   Public URL after upload: https:\/\/assets\.poster\.ly\/u\/b\.pdf/, 'a PDF slot is listed like any other file');
  assert.match(text, /4\. photo\.heic\n   Failed \(unsupported_file_type\): Unsupported file type: image\/heic\. Accepted: JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF/);
  assert.doesNotMatch(text, /pdf_not_supported/);
  assert.match(text, /3\. c\.mp4\n   PUT https:\/\/r2\.example\/c\?sig=1\n   Content-Type: video\/mp4/);
  assert.match(text, /PUT each file, then pass public_url to create_post \/ create_posts_batch\. Slots expire at 2026-10-14T12:15:00\.000Z, call again for fresh slots\.$/);
});

await check('create_signed_upload and create_media_drop descriptions state exactly what is accepted', async () => {
  for (const tool of [createSignedUploadTool, createMediaDropTool]) {
    assert.match(tool.description, /JPEG, PNG, GIF, WebP, MP4, MOV, WebM, and PDF up to 50MB/);
    assert.match(tool.description, /LinkedIn document posts/);
    assert.match(tool.description, /HEIC is not accepted/);
    assert.doesNotMatch(tool.description, /PDFs? (is|are) (rejected|not supported)/);
  }
  assert.match(createSignedUploadTool.description, /post_type document/);
  assert.match(createSignedUploadTool.description, /document_title/);
});

await check('create_signed_upload rejects mixed or empty input and a 21 file batch', async () => {
  const client = fakeUploadClient();
  await assert.rejects(
    createSignedUploadTool.execute(client, { files: [{ filename: 'a.jpg', content_type: 'image/jpeg', size: 1 }], filename: 'a.jpg' }),
    /either files or the single-file fields/,
  );
  await assert.rejects(createSignedUploadTool.execute(client, {}), /Provide filename, content_type and size/);
  const entry = { filename: 'a.jpg', content_type: 'image/jpeg', size: 1 };
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ files: Array.from({ length: 20 }, () => entry) }).success, true);
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ files: Array.from({ length: 21 }, () => entry) }).success, false);
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ files: [] }).success, false);
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ filename: 'a.jpg', content_type: 'image/jpeg', size: 1 }).success, true);
});

// Content-Type pinning: the tool passes the opt-in through, says so when a slot is
// locked, and the stdio client sends the returned headers verbatim.
await check('create_signed_upload pin_content_type is passed to the client and the locked slot says so', async () => {
  const seen = { single: [], batch: [] };
  const client = {
    getSignedUploadUrl: async (...args) => {
      seen.single.push(args);
      return { upload_url: 'https://r2.example/one?sig=1', token: 'tok', path: 'u/one.pdf', public_url: 'https://assets.poster.ly/u/one.pdf', headers: { 'content-type': 'application/pdf' }, content_type_pinned: true };
    },
    getSignedUploadUrls: async (files, workspaceId, pin) => {
      seen.batch.push({ files, workspaceId, pin });
      return {
        slots: [{ index: 0, filename: 'a.jpg', ok: true, upload_url: 'https://r2.example/a?sig=1', token: 't1', path: 'u/a.jpg', public_url: 'https://assets.poster.ly/u/a.jpg', expires_at: '2026-10-14T12:15:00.000Z', max_size: 10, headers: { 'content-type': 'image/jpeg' }, provider: 'r2', content_type_pinned: true }],
        summary: { requested: 1, ok: 1, failed: 0 },
      };
    },
  };
  const single = await createSignedUploadTool.execute(client, { filename: 'one.pdf', content_type: 'application/pdf', size: 10, pin_content_type: true });
  assert.equal(seen.single[0][4], true, 'single call carries pin = true');
  assert.match(single, /Content-Type to send: application\/pdf/);
  assert.match(single, /Content-Type is locked: PUT the raw file bytes/);
  assert.match(single, /-H "Content-Type: \.\.\."/);
  const batch = await createSignedUploadTool.execute(client, { files: [{ filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }], pin_content_type: true });
  assert.equal(seen.batch[0].pin, true, 'batch call carries pin = true');
  assert.match(batch, /Content-Type is locked: send exactly the Content-Type above/);
  assert.match(batch, /Slots marked "Content-Type is locked"/);
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ filename: 'a.jpg', content_type: 'image/jpeg', size: 1, pin_content_type: true }).success, true);
  assert.equal(createSignedUploadTool.inputSchema.safeParse({ filename: 'a.jpg', content_type: 'image/jpeg', size: 1, pin_content_type: 'yes' }).success, false);
  assert.match(createSignedUploadTool.description, /pin_content_type/);
});

await check('create_signed_upload without pin_content_type sends no pin field on the wire', async () => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ upload_url: 'u', token: 't', path: 'p', public_url: 'pu', headers: { 'content-type': 'image/jpeg' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new PosterlyClient('test-key', 'https://www.poster.ly');
    await client.getSignedUploadUrl('a.jpg', 'image/jpeg', 10);
    await client.getSignedUploadUrl('a.jpg', 'image/jpeg', 10, 'ws_1', true);
    await client.getSignedUploadUrls([{ filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }]);
    await client.getSignedUploadUrls([{ filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }], undefined, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(bodies[0], { filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }, 'default single body unchanged');
  assert.deepEqual(bodies[1], { filename: 'a.jpg', content_type: 'image/jpeg', size: 10, workspace_id: 'ws_1', pin_content_type: true });
  assert.deepEqual(bodies[2], { files: [{ filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }] }, 'default batch body unchanged');
  assert.deepEqual(bodies[3], { files: [{ filename: 'a.jpg', content_type: 'image/jpeg', size: 10 }], pin_content_type: true });
});

await check('upload_media with a large file_path-style upload PUTs exactly the returned Content-Type, once', async () => {
  const puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/v1/media/signed-upload')) {
      return new Response(JSON.stringify({ upload_url: 'https://r2.example/put?sig=1', token: 't', path: 'u/clip.mp4', public_url: 'https://assets.poster.ly/u/clip.mp4', headers: { 'content-type': 'video/mp4' }, content_type_pinned: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    puts.push(new Headers(init.headers));
    return new Response('', { status: 200 });
  };
  try {
    const client = new PosterlyClient('test-key', 'https://www.poster.ly');
    const data = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
    await client.uploadMedia({ base64Data: data, filename: 'clip.mp4', contentType: 'video/mp4' });
    // The returned type wins even when the caller declared another spelling.
    await client.uploadMedia({ base64Data: data, filename: 'clip.mp4', contentType: 'VIDEO/MP4' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(puts.length, 2);
  for (const headers of puts) {
    assert.equal(headers.get('content-type'), 'video/mp4', 'one Content-Type, exactly the returned one');
  }
});

if (failures > 0) {
  console.error(`\n${failures} payload-builder test(s) failed.`);
  process.exit(1);
}
