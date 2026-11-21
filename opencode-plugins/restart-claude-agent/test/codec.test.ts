// Regression: the contract must decode through OpenCode's REAL RPC JSON Schema
// codec (core/src/rpc.ts: effect JsonSchema -> SchemaRepresentation -> Schema).
// A homemade validator accepted `pattern`, which the real codec rejects with
// rpc.invalid_output, breaking every call.
//
// The real codec needs `effect` (the version @opencode/plugin@2.3.0 depends on).
// Set EFFECT_DIR to a node_modules/effect directory, or install into
// /tmp/oc-codec-scratch (see README in the plan). Without it only the static
// scan runs; with it, the codec tests run (CI-style: set REQUIRE_CODEC=1 to fail instead of skip).
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { methods, resultSchema } from "../lib/contract.ts"

// Keywords the real codec (or its decoder) cannot honour safely here.
const FORBIDDEN = ["pattern", "format", "$ref", "oneOf", "anyOf", "allOf", "not", "patternProperties", "if", "then", "else", "const", "uniqueItems", "multipleOf"]

function walk(node: unknown, path: string, out: string[]) {
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, out))
  if (!node || typeof node !== "object") return
  for (const [key, value] of Object.entries(node)) {
    // Keys under `properties` are field names, not keywords.
    if (path.endsWith(".properties")) walk(value, `${path}.${key}`, out)
    else {
      if (FORBIDDEN.includes(key)) out.push(`${path}.${key}`)
      walk(value, `${path}.${key}`, out)
    }
  }
}

test("production schemas (all methods, nested) use no unsupported JSON Schema keywords", () => {
  const bad: string[] = []
  walk(methods, "methods", bad)
  walk(resultSchema, "resultSchema", bad)
  assert.deepEqual(bad, [])
})

const dir = process.env.EFFECT_DIR ?? "/tmp/oc-codec-scratch/node_modules/effect"
const have = existsSync(dir + "/dist/index.js")
if (!have && process.env.REQUIRE_CODEC) throw new Error("real codec required but effect not found at " + dir)

test("real OpenCode codec: every production schema compiles and decodes valid payloads", { skip: !have && "effect not installed (set EFFECT_DIR)" }, async () => {
  const { JsonSchema, Schema, SchemaRepresentation, Effect } = await import(pathToFileURL(dir + "/dist/index.js").href)
  // Exactly core/src/rpc.ts parse().
  const decode = (schema: unknown, value: unknown) => {
    const codec = Schema.make(SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema)).ast)
    return Effect.runSync(Schema.decodeUnknownEffect(codec)(value))
  }
  const digest = "a".repeat(64)
  const ident = { pid: 10, startTime: "123", digest }
  assert.deepEqual(decode(methods.restartSession.input, { sessionID: "ses_e35077a3fffewX7wvSgckzNYDa" }), { sessionID: "ses_e35077a3fffewX7wvSgckzNYDa" })
  assert.deepEqual(decode(methods.preview.input, {}), {})
  assert.deepEqual(decode(methods.restartAll.input, { processes: [ident], account: "~/x" }), { processes: [ident], account: "~/x" })
  const result = { ok: true, message: "m", account: "a", pinned: false, killed: [1], skipped: [2], processes: [ident], activeSessions: 0, unconfirmed: 0 }
  for (const method of Object.values(methods)) assert.deepEqual(decode(method.output, result), result)
  assert.equal(decode(resultSchema, { ok: false, reason: "no_mapping", message: "m" }).reason, "no_mapping")
  // Type checks that remain enforced by the codec.
  assert.throws(() => decode(methods.restartAll.input, { processes: [{ pid: 0, startTime: "1", digest }], account: "a" }))
  assert.throws(() => decode(methods.restartAll.input, { processes: [{ pid: 1, startTime: "1" }], account: "a" }))
  assert.throws(() => decode(methods.restartSession.input, { sessionID: 5 }))
  assert.throws(() => decode(resultSchema, { ok: true, message: "m", reason: "nope" }))
})
