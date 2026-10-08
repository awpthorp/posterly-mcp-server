import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';

interface AnnotationPolicy {
  knownTools: string[];
  readOnlyTools: string[];
  destructiveTools: string[];
  idempotentMutationTools: string[];
  openWorldTools: string[];
}

const require = createRequire(import.meta.url);
const policy = require('../../tool-annotations.json') as AnnotationPolicy;

const knownTools = new Set<string>(policy.knownTools);
const readOnlyTools = new Set<string>(policy.readOnlyTools);
const destructiveTools = new Set<string>(policy.destructiveTools);
const idempotentMutationTools = new Set<string>(policy.idempotentMutationTools);
const openWorldTools = new Set<string>(policy.openWorldTools);

export function getToolAnnotations(name: string): ToolAnnotations {
  if (!knownTools.has(name)) {
    throw new Error(`Missing MCP tool annotation policy for ${name}`);
  }

  const readOnly = readOnlyTools.has(name);
  return {
    title: humanizeToolName(name),
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && destructiveTools.has(name),
    idempotentHint: readOnly || idempotentMutationTools.has(name),
    openWorldHint: openWorldTools.has(name),
  };
}

function humanizeToolName(name: string): string {
  return name
    .split('_')
    .map((word) => {
      if (word === 'api') return 'API';
      if (word === 'mcp') return 'MCP';
      if (word === 'oauth') return 'OAuth';
      if (word === 'x') return 'X';
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}
