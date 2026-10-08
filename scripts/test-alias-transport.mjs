// Tests the stdio AliasTransport (src/lib/alias-transport.ts) over an
// in-memory transport pair with a real McpServer and Client, using a small
// fake registry that has aliases (the shipped registry has none yet):
//   - aliases never appear in tools/list
//   - an alias call is rewritten onto its target with translated args
//     (rename + inject, inject wins) before the SDK validates it
//   - handlers read the called name / legacyConfirm via extra.requestId
//   - the response keeps content[0] untouched and gets exactly one appended
//     rename note plus _meta["posterly/deprecation"]
//   - canonical calls are untouched, including when run concurrently with an
//     alias call (legacyConfirm never leaks across calls)
//   - an alias call that fails per-mode validation returns a plain error
//     (plus the note) without reaching the handler
//   - per-request entries are cleaned up after the response, and after a
//     notifications/cancelled (the SDK sends no response for those)
//   - a visible set filters ONLY tools/list: hidden tools stay callable,
//     including in the real built package with POSTERLY_TOOLSETS=core
//   - an alias to a param-driven tool is pinned to the old tool's mode, and a
//     legacy validator reproduces the old tool's exact schema error text
// Run: npm run test:alias-transport (builds first)
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AliasTransport } from '../dist/lib/alias-transport.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SUNSET = '2027-01-12';

const registry = {
  version: 1,
  designRules: 'off',
  budgets: { maxTotal: 70, maxCore: 30 },
  sunset: SUNSET,
  toolsets: { core: { label: 'Core', description: 'Core tools.' } },
  tools: {
    manage_thing: {
      set: 'core',
      label: 'Manage a thing',
      selector: 'action',
      actions: {
        rename: {
          label: 'Rename a thing',
          destructive: false,
          idempotent: true,
          openWorld: false,
          confirm: 'confirm',
          params: {
            thing_id: { type: 'string', required: true },
            title: { type: 'string', required: true },
          },
        },
        delete: { label: 'Delete a thing', destructive: true, idempotent: true, openWorld: false, confirm: 'preview' },
      },
    },
    slow_thing: { set: 'core', label: 'Slow thing', readOnly: true, destructive: false, idempotent: true, openWorld: false, confirm: 'none' },
    list_things: {
      set: 'core',
      label: 'Things',
      selector: 'view',
      defaultMode: 'all',
      views: {
        all: { label: 'All things' },
        one: { label: 'One thing', params: { thing_id: { type: 'string', required: true }, limit: { type: 'integer', min: 1, max: 50, default: 10 } } },
      },
    },
  },
  aliases: {
    old_slow: {
      target: 'slow_thing',
      added: '2026-10-01',
      sunset: SUNSET,
    },
    delete_thing: {
      target: 'manage_thing',
      inject: { action: 'delete' },
      rename: { id: 'thing_id' },
      legacyConfirm: true,
      added: '2026-10-01',
      sunset: SUNSET,
    },
    rename_thing: {
      target: 'manage_thing',
      inject: { action: 'rename' },
      added: '2026-10-01',
      sunset: SUNSET,
    },
    get_thing: {
      target: 'list_things',
      inject: { view: 'one' },
      added: '2026-10-01',
      sunset: SUNSET,
    },
  },
};

const server = new McpServer({ name: 'alias-transport-test', version: '0.0.0' });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const transport = new AliasTransport(serverSide, registry);

const seen = [];
server.tool(
  'manage_thing',
  'Rename or delete a thing.',
  {
    action: z.enum(['rename', 'delete']),
    thing_id: z.string(),
    title: z.string().optional(),
    confirm: z.boolean().optional(),
  },
  async (input, extra) => {
    const info = transport.getCallInfo(extra.requestId);
    seen.push({ tool: 'manage_thing', input, calledName: info?.calledName ?? null, legacyConfirm: info?.legacyConfirm ?? false });
    // Give a concurrent call the chance to interleave.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { content: [{ type: 'text', text: `did ${input.action} on ${input.thing_id}` }] };
  },
);
server.tool(
  'list_things',
  'List things.',
  { view: z.enum(['all', 'one']).optional(), thing_id: z.string().optional(), limit: z.number().optional() },
  async (input, extra) => {
    const info = transport.getCallInfo(extra.requestId);
    seen.push({ tool: 'list_things', input, calledName: info?.calledName ?? null, legacyConfirm: info?.legacyConfirm ?? false });
    return { content: [{ type: 'text', text: `view ${input.view} ${input.thing_id ?? ''} ${input.limit ?? ''}`.trim() }] };
  },
);

let slowRequestId;
server.tool('slow_thing', 'Takes a while.', {}, async (_input, extra) => {
  slowRequestId = extra.requestId;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 500);
    extra.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return { content: [{ type: 'text', text: 'slow done' }] };
});

const client = new Client({ name: 'alias-transport-test-client', version: '0.0.0' });
await server.connect(transport);
await client.connect(clientSide);

try {
  // 1. Aliases never appear in tools/list.
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['list_things', 'manage_thing', 'slow_thing']);

  // 2. Alias call: rename + inject (inject wins over a caller-supplied action).
  seen.length = 0;
  const aliased = await client.callTool({ name: 'delete_thing', arguments: { id: 't_1', action: 'rename', confirm: true } });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].input, { action: 'delete', thing_id: 't_1', confirm: true });
  assert.equal(seen[0].calledName, 'delete_thing', 'handler reads the called (alias) name via extra.requestId');
  assert.equal(seen[0].legacyConfirm, true);
  assert.equal(aliased.content.length, 2, 'exactly one appended deprecation item');
  assert.deepEqual(aliased.content[0], { type: 'text', text: 'did delete on t_1' }, 'content[0] is untouched');
  assert.equal(
    aliased.content[1].text,
    `Renamed: delete_thing is now manage_thing with action=delete. The old name may stop working after ${SUNSET}.`,
  );
  assert.deepEqual(aliased._meta?.['posterly/deprecation'], {
    old: 'delete_thing',
    new: 'manage_thing',
    action: 'delete',
    sunset: SUNSET,
  });

  // 3. Canonical call: untouched, no note, no _meta, no alias info.
  seen.length = 0;
  const canonical = await client.callTool({ name: 'manage_thing', arguments: { action: 'rename', thing_id: 't_2', title: 'New' } });
  assert.equal(canonical.content.length, 1);
  assert.equal(canonical._meta, undefined);
  assert.equal(seen[0].calledName, null);
  assert.equal(seen[0].legacyConfirm, false);

  // 4. Concurrent alias + canonical calls: legacyConfirm never leaks.
  seen.length = 0;
  const [a, b] = await Promise.all([
    client.callTool({ name: 'delete_thing', arguments: { id: 't_3', confirm: true } }),
    client.callTool({ name: 'manage_thing', arguments: { action: 'delete', thing_id: 't_4' } }),
  ]);
  const byThing = Object.fromEntries(seen.map((entry) => [entry.input.thing_id, entry]));
  assert.equal(byThing.t_3.legacyConfirm, true);
  assert.equal(byThing.t_3.calledName, 'delete_thing');
  assert.equal(byThing.t_4.legacyConfirm, false);
  assert.equal(byThing.t_4.calledName, null);
  assert.equal(a.content.length, 2);
  assert.equal(b.content.length, 1);

  // 5. Per-mode validation (registry params) normalises before the SDK sees it:
  //    the default limit is applied.
  seen.length = 0;
  const viewed = await client.callTool({ name: 'get_thing', arguments: { thing_id: 't_5' } });
  assert.deepEqual(seen[0].input, { view: 'one', thing_id: 't_5', limit: 10 });
  assert.equal(viewed.content[0].text, 'view one t_5 10');
  assert.equal(viewed._meta?.['posterly/deprecation']?.action, 'one');

  // 6. A validation failure is a plain error plus the note; the handler never runs.
  seen.length = 0;
  const invalid = await client.callTool({ name: 'rename_thing', arguments: { thing_id: 't_6' } });
  assert.equal(seen.length, 0, 'handler must not run when validation fails');
  assert.equal(invalid.isError, true);
  assert.equal(invalid.content[0].text, 'title is required with action=rename.');
  assert.equal(invalid.content.length, 2);
  const extra = await client.callTool({ name: 'rename_thing', arguments: { thing_id: 't_6', title: 'x', bogus: 1 } });
  assert.equal(extra.isError, true);
  assert.equal(extra.content[0].text, 'bogus is not allowed with action=rename.');

  // 7. Entries are cleaned up after each response.
  for (let id = 0; id < 50; id += 1) {
    assert.equal(transport.getCallInfo(id), undefined, `request ${id} still tracked after its response`);
  }

  // 8. A cancelled alias call (no response is ever sent) is still cleaned up.
  const controller = new AbortController();
  const pendingSlow = client.callTool({ name: 'old_slow', arguments: {} }, undefined, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.notEqual(slowRequestId, undefined, 'slow handler started');
  assert.equal(transport.getCallInfo(slowRequestId)?.calledName, 'old_slow', 'tracked while in flight');
  controller.abort();
  await assert.rejects(pendingSlow);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(transport.getCallInfo(slowRequestId), undefined, 'notifications/cancelled clears the entry');
} finally {
  await client.close();
  await server.close();
}

// 9. A visible set filters tools/list only; hidden tools stay callable.
{
  const filteredServer = new McpServer({ name: 'alias-transport-filter-test', version: '0.0.0' });
  const [filteredClientSide, filteredServerSide] = InMemoryTransport.createLinkedPair();
  const filteredTransport = new AliasTransport(filteredServerSide, registry, new Set(['list_things']));
  filteredServer.tool('list_things', 'List things.', {}, async () => ({ content: [{ type: 'text', text: 'listed' }] }));
  filteredServer.tool('manage_thing', 'Manage a thing.', { action: z.string(), thing_id: z.string() }, async (input) => ({
    content: [{ type: 'text', text: `managed ${input.thing_id}` }],
  }));
  const filteredClient = new Client({ name: 'alias-transport-filter-client', version: '0.0.0' });
  await filteredServer.connect(filteredTransport);
  await filteredClient.connect(filteredClientSide);
  try {
    const { tools: listed } = await filteredClient.listTools();
    assert.deepEqual(listed.map((tool) => tool.name), ['list_things'], 'hidden tool is not listed');
    const hiddenCall = await filteredClient.callTool({ name: 'manage_thing', arguments: { action: 'delete', thing_id: 't_9' } });
    assert.equal(hiddenCall.isError, undefined);
    assert.equal(hiddenCall.content[0].text, 'managed t_9', 'hidden tool is still callable');
    const aliasToHidden = await filteredClient.callTool({ name: 'delete_thing', arguments: { id: 't_10' } });
    assert.equal(aliasToHidden.content[0].text, 'managed t_10', 'an alias to a hidden tool still works');
  } finally {
    await filteredClient.close();
    await filteredServer.close();
  }
}

// 10. The real built package: POSTERLY_TOOLSETS=core hides get_subscription
//     (billing) from tools/list, but calling it still reaches the tool. With
//     no API key the tool answers its own "not installed" error before any
//     network request, which proves it ran (an unregistered tool would give
//     the SDK's "Tool get_subscription not found").
{
  const stdioClient = new Client({ name: 'alias-transport-toolsets-client', version: '0.0.0' });
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(packageRoot, 'dist/index.js')],
    env: { POSTERLY_TOOLSETS: 'core' },
    stderr: 'ignore',
  });
  await stdioClient.connect(stdioTransport);
  try {
    const { tools: coreTools } = await stdioClient.listTools();
    const names = coreTools.map((tool) => tool.name);
    assert(!names.includes('get_subscription'), 'billing tool hidden from tools/list under core');
    assert(names.includes('create_post'), 'core tool listed');
    assert(names.includes('start_signup'), 'signup tools are always listed on stdio');
    const hidden = await stdioClient.callTool({ name: 'get_subscription', arguments: {} });
    assert.equal(hidden.isError, true);
    assert.match(hidden.content[0].text, /posterly access is not installed yet/, 'the hidden tool itself answered');
  } finally {
    await stdioClient.close();
  }
}

// 11. Param-driven targets and legacy schemas (mcp 0.45.0): an alias with
//     `mode` is validated in the old tool's mode (a missing id is rejected,
//     never silently widened into a list), and a legacy validator reproduces
//     the old tool's exact error text before any translation.
{
  const modeRegistry = {
    ...registry,
    tools: {
      list_notes: {
        set: 'core',
        label: 'Notes',
        selector: 'params',
        defaultMode: 'list',
        views: {
          list: { label: 'List notes', params: { limit: { type: 'integer', min: 1, max: 50 } } },
          note: { label: 'One note', when: ['note_id'], params: { note_id: { type: 'string', required: true } } },
        },
      },
    },
    aliases: {
      get_note: { target: 'list_notes', mode: 'note', added: '2026-10-01', sunset: SUNSET },
    },
  };
  const legacyValidator = (aliasName, args) => {
    if (aliasName !== 'get_note') return null;
    if (!args || typeof args.note_id !== 'string') return { ok: false, message: 'MCP error -32602: old get_note schema error' };
    return { ok: true, args: { note_id: args.note_id } };
  };
  const modeServer = new McpServer({ name: 'alias-transport-mode-test', version: '0.0.0' });
  const [modeClientSide, modeServerSide] = InMemoryTransport.createLinkedPair();
  const modeTransport = new AliasTransport(modeServerSide, modeRegistry, null, legacyValidator);
  const noteCalls = [];
  modeServer.tool('list_notes', 'Notes.', { note_id: z.string().optional(), limit: z.number().optional() }, async (input) => {
    noteCalls.push(input);
    return { content: [{ type: 'text', text: input.note_id ? `note ${input.note_id}` : 'all notes' }] };
  });
  const modeClient = new Client({ name: 'alias-transport-mode-client', version: '0.0.0' });
  await modeServer.connect(modeTransport);
  await modeClient.connect(modeClientSide);
  try {
    const legacyError = await modeClient.callTool({ name: 'get_note', arguments: {} });
    assert.equal(legacyError.isError, true);
    assert.equal(legacyError.content[0].text, 'MCP error -32602: old get_note schema error', 'the old schema error text is kept');
    assert.equal(legacyError.content.length, 2, 'the rename note is still appended');
    assert.equal(noteCalls.length, 0, 'the handler never ran');
    const one = await modeClient.callTool({ name: 'get_note', arguments: { note_id: 'n_1', extra: 'dropped' } });
    assert.equal(one.content[0].text, 'note n_1');
    assert.deepEqual(noteCalls, [{ note_id: 'n_1' }], 'the legacy-parsed args (unknown keys dropped) reach the handler');
  } finally {
    await modeClient.close();
    await modeServer.close();
  }

  // Without a legacy validator, the pinned mode still rejects a missing id.
  const pinServer = new McpServer({ name: 'alias-transport-pin-test', version: '0.0.0' });
  const [pinClientSide, pinServerSide] = InMemoryTransport.createLinkedPair();
  const pinTransport = new AliasTransport(pinServerSide, modeRegistry);
  let pinHandlerRan = false;
  pinServer.tool('list_notes', 'Notes.', { note_id: z.string().optional() }, async () => {
    pinHandlerRan = true;
    return { content: [{ type: 'text', text: 'all notes' }] };
  });
  const pinClient = new Client({ name: 'alias-transport-pin-client', version: '0.0.0' });
  await pinServer.connect(pinTransport);
  await pinClient.connect(pinClientSide);
  try {
    const pinned = await pinClient.callTool({ name: 'get_note', arguments: {} });
    assert.equal(pinned.isError, true);
    assert.equal(pinned.content[0].text, 'note_id is required.');
    assert.equal(pinHandlerRan, false, 'get_note without note_id never becomes a list call');
  } finally {
    await pinClient.close();
    await pinServer.close();
  }
}

console.log('OK  alias transport: hidden aliases, translated args, appended note, no leaks, tool sets filter tools/list only, pinned modes, legacy schemas.');
