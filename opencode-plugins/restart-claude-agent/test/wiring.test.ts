// Wiring tests: the real index.ts / tui.ts / rpc.ts / lib/runtime.ts run against
// fake plugin contexts. @opencode/* is stubbed (define = identity); the real SDK
// types are checked separately with tsc. No real process is read for signalling
// decisions that matter here: every test overrides /proc and kill via fakes.
import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

const stubs: Record<string, string> = {
  "@opencode/plugin": "export const Plugin = { define: (x) => x }",
  "@opencode/plugin/tui": "export const Plugin = { define: (x) => x }",
  "@opencode/plugin/rpc": "export const Rpc = { define: (x) => x }",
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]!), shortCircuit: true }
    return next(specifier, context)
  },
})

const { default: server } = await import("../index.ts")
const { default: tui } = await import("../tui.ts")
const { RestartClaudeAgent } = await import("../rpc.ts")
const { methods } = await import("../lib/contract.ts")
const { serviceDeps } = await import("../lib/runtime.ts")
const { ActivityTracker, sharedTracker } = await import("../lib/activity.ts")

// --- minimal JSON Schema validator (the subset the contract uses) ---
function validate(schema: any, value: any, path = "$"): string[] {
  const errs: string[] = []
  const t = schema.type
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value
  if (t === "integer" ? kind !== "integer" : t === "number" ? typeof value !== "number" : t && kind !== t) return [`${path}: expected ${t}, got ${kind}`]
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not in enum`)
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: pattern`)
  if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: minimum`)
  if (t === "array") value.forEach((v: any, i: number) => errs.push(...validate(schema.items, v, `${path}[${i}]`)))
  if (t === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}.${k}: missing`)
    for (const k of Object.keys(value)) {
      if (!schema.properties?.[k]) {
        if (schema.additionalProperties === false) errs.push(`${path}.${k}: additional property`)
      } else errs.push(...validate(schema.properties[k], value[k], `${path}.${k}`))
    }
  }
  return errs
}

const U1 = "11111111-1111-4111-8111-111111111111"
const SERVER_PID = process.pid

test("schema validator catches bad shapes (sanity)", () => {
  assert.ok(validate(methods.restartAll.input, { processes: [{ pid: 1 }], account: "a" }).length > 0)
  assert.ok(validate(methods.restartSession.input, { sessionID: "nope" }).length > 0)
  assert.deepEqual(validate(methods.restartSession.input, { sessionID: "ses_a" }), [])
})

function fakeServerCtx(session: Record<string, unknown>) {
  const handlers: any = {}
  let disposed = false
  let release: (() => void) | undefined
  const events = {
    subscribe: ({ signal }: any) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "session.status", created: 100, data: { sessionID: "ses_busy", status: { type: "busy" } } }
        await new Promise<void>((resolve) => {
          release = resolve
          signal.addEventListener("abort", () => resolve())
        })
      },
    }),
  }
  const ctx = {
    session,
    event: events,
    rpc: {
      register: async (def: any, h: any) => {
        assert.equal(def, RestartClaudeAgent)
        Object.assign(handlers, h)
        return { dispose: async () => void (disposed = true) }
      },
    },
  }
  return { ctx, handlers, isDisposed: () => disposed, release: () => release?.() }
}

test("server part: registers the shared RPC, no tool, outputs validate, busy event refuses", async () => {
  const savedEnv = process.env.CLAUDE_CONFIG_DIR
  const sessions: Record<string, any> = {
    ses_busy: { id: "ses_busy", time: { created: 1, busy: 50, idle: 60 } },
    ses_new: { id: "ses_new", time: { created: 1 } },
  }
  const f = fakeServerCtx({
    get: async ({ sessionID }: any) => sessions[sessionID],
    context: async () => [], // new / just-compacted: nothing to map
  })
  const dispose = await server.setup(f.ctx as any)
  assert.equal(server.id, "restart-claude-agent")
  assert.equal(typeof dispose, "function")
  await new Promise((r) => setTimeout(r, 20)) // let the event pump run
  assert.equal("tool" in f.ctx, false)

  const busy = await f.handlers.restartSession({ sessionID: "ses_busy" })
  assert.equal(busy.reason, "busy")
  assert.deepEqual(validate(methods.restartSession.output, busy), [])

  const none = await f.handlers.restartSession({ sessionID: "ses_new" })
  assert.ok(["no_mapping", "account_unavailable"].includes(none.reason)) // account script may not exist on a test host
  assert.deepEqual(validate(methods.restartSession.output, none), [])
  assert.deepEqual(validate(methods.restartSession.output, await f.handlers.restartSession({})), [])
  assert.deepEqual(validate(methods.restartAll.output, await f.handlers.restartAll({})), [])
  const p = await f.handlers.preview({})
  assert.deepEqual(validate(methods.preview.output, p), [])
  assert.ok(sharedTracker().busyCount() >= 1)

  await dispose!()
  assert.equal(f.isDisposed(), true)
  f.release()
  if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedEnv
})

test("runtime wiring: serviceDeps adapts ctx.session.get/context and the tracker", async () => {
  const tracker = new ActivityTracker()
  const calls: string[] = []
  const deps = serviceDeps(
    {
      get: async ({ sessionID }) => (calls.push("get:" + sessionID), { id: sessionID, time: { created: 1, busy: 5, idle: 9 } }),
      context: async ({ sessionID }) => (calls.push("context:" + sessionID), [{ type: "assistant" }]),
    },
    tracker,
  )
  assert.equal(deps.parentPid, process.pid)
  assert.deepEqual((await deps.getSession("ses_x"))?.id, "ses_x")
  assert.deepEqual((await deps.listMessages({ sessionID: "ses_x" })).messages, [{ type: "assistant" }])
  assert.equal(deps.isBusy({ id: "ses_x", time: { created: 1, busy: 5, idle: 9 } }), false)
  assert.deepEqual(calls, ["get:ses_x", "context:ses_x"])
  const bad = serviceDeps({ get: async () => undefined, context: async () => ({}) as any }, tracker)
  await assert.rejects(bad.listMessages({ sessionID: "s" }))
})

function fakeTui(opts: { route: any; status?: string; rpc: any; confirm?: boolean; sessions?: any[] }) {
  const toasts: any[] = []
  const confirms: any[] = []
  let layer: any
  const context = {
    client: { rpc: (def: any) => (assert.equal(def, RestartClaudeAgent), opts.rpc) },
    ui: {
      toast: { show: (t: any) => toasts.push(t) },
      dialog: { confirm: async (c: any) => (confirms.push(c), opts.confirm ?? true) },
      router: { current: () => opts.route },
    },
    data: { session: { status: () => opts.status ?? "idle", list: () => opts.sessions ?? [] } },
    keymap: { layer: (f: any) => (layer = f()) },
  }
  tui.setup(context as any)
  const cmd = (id: string) => layer.commands.find((c: any) => c.id === id)
  return { toasts, confirms, layer, cmd }
}

test("TUI: two palette commands, session one only enabled on a session route, no slash aliases", () => {
  const t = fakeTui({ route: { type: "session", sessionID: "ses_a" }, rpc: {} })
  assert.deepEqual(t.layer.commands.map((c: any) => [c.id, c.palette, c.slash]), [
    ["restart-claude-agent.session", true, undefined],
    ["restart-claude-agent.all", true, undefined],
  ])
  assert.equal(t.cmd("restart-claude-agent.session").enabled(), true)
  assert.equal(fakeTui({ route: { type: "home" }, rpc: {} }).cmd("restart-claude-agent.session").enabled(), false)
})

test("TUI: this-session command sends only the shown session; busy short-circuits locally", async () => {
  const sent: any[] = []
  const rpc = { restartSession: async (i: any) => (sent.push(i), { ok: true, message: "done" }) }
  const t = fakeTui({ route: { type: "session", sessionID: "ses_a" }, rpc })
  await t.cmd("restart-claude-agent.session").run()
  assert.deepEqual(sent, [{ sessionID: "ses_a" }])
  assert.equal(t.toasts.at(-1).variant, "success")

  const b = fakeTui({ route: { type: "session", sessionID: "ses_a" }, status: "running", rpc })
  await b.cmd("restart-claude-agent.session").run()
  assert.equal(sent.length, 1)
  assert.equal(b.toasts.at(-1).variant, "warning")

  const failing = fakeTui({ route: { type: "session", sessionID: "ses_a" }, rpc: { restartSession: async () => { throw new Error("down") } } })
  await failing.cmd("restart-claude-agent.session").run()
  assert.equal(failing.toasts.at(-1).variant, "error")
})

test("TUI: all-sessions confirms with count/account/interruption warning and sends the confirmed identities", async () => {
  const procs = [
    { pid: 10, startTime: "1", digest: "a".repeat(64) },
    { pid: 11, startTime: "2", digest: "b".repeat(64) },
  ]
  const sent: any[] = []
  const rpc = {
    preview: async () => ({ ok: true, message: "", account: "~/acct", pinned: false, processes: procs, activeSessions: 1 }),
    restartAll: async (i: any) => (sent.push(i), { ok: true, message: "stopped" }),
  }
  const sessions = [{ id: "s1" }, { id: "s2" }]
  const t = fakeTui({ route: { type: "home" }, rpc, sessions, status: "running" })
  await t.cmd("restart-claude-agent.all").run()
  const text = t.confirms[0].message as string
  assert.match(text, /stops 2 Claude process/)
  assert.match(text, /subagent/)
  assert.match(text, /At least 2 session\(s\) are running/)
  assert.match(text, /interrupted/)
  assert.match(text, /~\/acct/)
  assert.deepEqual(sent, [{ processes: procs, account: "~/acct" }])

  const declined = fakeTui({ route: { type: "home" }, rpc, confirm: false })
  await declined.cmd("restart-claude-agent.all").run()
  assert.equal(sent.length, 1)

  const failed = fakeTui({ route: { type: "home" }, rpc: { preview: async () => ({ ok: false, reason: "account_unavailable", message: "no account" }) } })
  await failed.cmd("restart-claude-agent.all").run()
  assert.equal(failed.confirms.length, 0)
  assert.equal(failed.toasts.at(-1).variant, "warning")
})

test("contract: Rpc definition is the shared methods object", () => {
  assert.equal(RestartClaudeAgent.id, "restart-claude-agent")
  assert.equal(RestartClaudeAgent.methods, methods)
  assert.ok(SERVER_PID > 0 && U1)
})
