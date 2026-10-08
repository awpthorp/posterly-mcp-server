import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const annotations = JSON.parse(readFileSync(resolve(root, 'tool-annotations.json'), 'utf8'));
const registry = JSON.parse(readFileSync(resolve(root, 'tool-registry.json'), 'utf8'));
const expectedToolCount = annotations.knownTools.length;
const aliases = new Set(Object.keys(registry.aliases));

async function listTools(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'posterly-annotation-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}

function checkAnnotations(tools, label) {
  for (const tool of tools) {
    assert(!aliases.has(tool.name), `${label}: tools/list must never list the alias ${tool.name}`);
    assert(tool.annotations, `${tool.name} is missing annotations`);
    assert(tool.annotations.title, `${tool.name} is missing an annotation title`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} destructiveHint`);
    assert.equal(typeof tool.annotations.idempotentHint, 'boolean', `${tool.name} idempotentHint`);
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} openWorldHint`);
    assert(
      !(tool.annotations.readOnlyHint && tool.annotations.destructiveHint),
      `${tool.name} cannot be both read-only and destructive`,
    );
  }
}

// Default: every tool set.
const all = await listTools({ POSTERLY_TOOLSETS: '' });
assert.equal(
  all.length,
  expectedToolCount,
  `stdio tool count ${all.length} must match tool-annotations.json knownTools (${expectedToolCount})`,
);
checkAnnotations(all, 'all sets');
// Editing may import remote media or email external brand reviewers.
assert.equal(all.find((tool) => tool.name === 'update_post')?.annotations?.openWorldHint, true);
assert.equal(all.find((tool) => tool.name === 'submit_product_feedback')?.annotations?.openWorldHint, true);


// POSTERLY_TOOLSETS=core lists the core set plus the always-on signup tools.
const core = await listTools({ POSTERLY_TOOLSETS: 'core' });
const expectedCore = Object.entries(registry.tools).filter(([, tool]) => tool.set === 'core' || tool.set === 'signup').length;
assert.equal(core.length, expectedCore, `POSTERLY_TOOLSETS=core should list ${expectedCore} tools, got ${core.length}`);
for (const tool of core) {
  assert(['core', 'signup'].includes(registry.tools[tool.name]?.set), `${tool.name} is not in the core or signup set`);
}
checkAnnotations(core, 'core set');

console.log(`OK  stdio MCP emits complete annotations for ${all.length} tools (all sets) and ${core.length} tools (core + signup), and never lists aliases.`);
