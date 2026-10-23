/**
 * npm tool schemas are zod, and a z.number() id rejects both "1961" and
 * "1,961", while a z.string() id rejects the number 1961. Agents copy ids
 * from either shape. Loosen id fields only: counts, limits, and ratings
 * stay strict.
 */

import { z, type ZodTypeAny } from 'zod'
import { isIdParamName, stripGroupedInteger } from './id-text.js'

const PLAIN_INTEGER = /^[+-]?\d+$/

function coerceIdInput(value: unknown, expect: 'number' | 'string'): unknown {
  if (expect === 'number') {
    if (typeof value === 'string') {
      const stripped = stripGroupedInteger(value).trim()
      if (PLAIN_INTEGER.test(stripped)) {
        const n = Number(stripped)
        if (Number.isSafeInteger(n)) return n
      }
    }
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return stripGroupedInteger(value)
  return value
}

function withDescription(schema: ZodTypeAny, description: string | undefined): ZodTypeAny {
  if (!description || schema.description === description) return schema
  return schema.describe(description)
}

/** Accept a number or a digit string (with or without thousands separators) for one id schema. */
export function loosenIdSchema(schema: ZodTypeAny): ZodTypeAny {
  const description = schema.description
  let next: ZodTypeAny = schema

  if (schema instanceof z.ZodOptional) {
    next = loosenIdSchema(schema.unwrap()).optional()
  } else if (schema instanceof z.ZodNullable) {
    next = loosenIdSchema(schema.unwrap()).nullable()
  } else if (schema instanceof z.ZodDefault) {
    const fallback = schema._def.defaultValue
    next = loosenIdSchema(schema.removeDefault()).default(typeof fallback === 'function' ? fallback() : fallback)
  } else if (schema instanceof z.ZodNumber) {
    next = z.preprocess((value) => coerceIdInput(value, 'number'), schema)
  } else if (schema instanceof z.ZodString) {
    next = z.preprocess((value) => coerceIdInput(value, 'string'), schema)
  } else if (schema instanceof z.ZodUnion) {
    next = z.preprocess(
      (value) => (typeof value === 'string' ? stripGroupedInteger(value) : value),
      schema,
    )
  } else if (schema instanceof z.ZodArray) {
    // Keep the original def so .min()/.max() limits survive the loosening.
    next = new z.ZodArray({ ...schema._def, type: loosenIdSchema(schema.element as ZodTypeAny) })
  }

  return withDescription(next, description)
}

export function loosenIdShape(shape: Record<string, ZodTypeAny>): Record<string, ZodTypeAny> {
  const out: Record<string, ZodTypeAny> = {}
  for (const [key, schema] of Object.entries(shape)) {
    out[key] = isIdParamName(key) ? loosenIdSchema(schema) : schema
  }
  return out
}

/** Used by scripts/test-mcp-plain-ids.ts so the assertion shares this file's zod. */
export function parseFlexibleId(kind: 'number' | 'string', value: unknown): unknown {
  const schema = kind === 'number'
    ? loosenIdSchema(z.number().int().positive())
    : loosenIdSchema(z.string())
  return schema.parse(value)
}

/** Same loosening for an alias's old object schema, so a pasted id still validates. */
export function loosenIdObject(schema: ZodTypeAny): ZodTypeAny {
  if (!(schema instanceof z.ZodObject)) return schema
  const shape = schema.shape as Record<string, ZodTypeAny>
  return schema.extend(loosenIdShape(shape))
}
