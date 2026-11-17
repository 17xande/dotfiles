// Run: node --test test/   (Node >= 23 strips types). Fake /proc and fake
// signalling only: nothing here can touch a real process.
import test from "node:test"
import assert from "node:assert/strict"
import { findClaudeProcesses, parseClaudeArgv, signalIfSame, type Proc } from "../lib/proc.ts"
import { lookupAccount, type AccountDeps } from "../lib/account.ts"
import { ActivityTracker } from "../lib/activity.ts"
import { preview, restartAll, restartSession, type ServiceDeps } from "../lib/service.ts"

const SERVER = 100
const U1 = "11111111-1111-4111-8111-111111111111"
const U2 = "22222222-2222-4222-8222-222222222222"

const statLine = (ppid: number, start: string) => `1 (claude) S ${ppid} 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 0 0`
const argv = (...a: string[]) => a.join("\0") + "\0"
const claude = (id: string, flag = "--session-id") => argv("/usr/bin/claude", "--output-format", "stream-json", `${flag}=${id}`)

class FakeProc implements Proc {
  procs = new Map<number, { stat: string; cmdline: string }>()
  killed: number[] = []
  onStat?: (pid: number) => void
  add(pid: number, cmdline: string, ppid = SERVER, start = "5000") {
    this.procs.set(pid, { stat: statLine(ppid, start), cmdline })
  }
  pids = () => [...this.procs.keys(), "self", "net"].map(String)
  stat = (pid: number) => (this.onStat?.(pid), this.procs.get(pid)?.stat)
  cmdline = (pid: number) => this.procs.get(pid)?.cmdline
  kill = (pid: number) => void this.killed.push(pid)
}

const account = (over: Partial<AccountDeps> = {}): AccountDeps => ({
  run: () => ({ status: 0, stdout: "/acct/b\n" }),
  isDirectory: () => true,
  env: {},
  home: "/h",
  ...over,
})

function setup(opts: { busy?: string[]; down?: boolean; sessions?: Record<string, any>; messages?: Record<string, any[]>; acct?: AccountDeps } = {}) {
  const proc = new FakeProc()
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/acct/a" }
  const sessions = opts.sessions ?? { ses_a: { id: "ses_a", time: { created: 1000, busy: 1500, idle: 1600 } } }
  const tracker = new ActivityTracker()
  for (const id of opts.busy ?? []) tracker.observe({ type: "session.status", created: 5000, data: { sessionID: id, status: { type: "busy" } } })
  const messages = opts.messages ?? { ses_a: [{ type: "assistant", time: { created: 2000 }, content: [{ type: "text", native: { sessionID: U1 } }] }] }
  const deps: ServiceDeps = {
    proc,
    parentPid: SERVER,
    account: opts.acct ?? account(),
    env,
    getSession: async (id) => {
      if (opts.down) throw new Error("boom")
      return sessions[id]
    },
    listMessages: async ({ sessionID }) => ({ messages: messages[sessionID] ?? [] }),
    isBusy: (info) => tracker.isBusy(info),
    busyCount: () => tracker.busyCount(),
  }
  return { proc, env, deps }
}

test("argv parsing is exact", () => {
  assert.equal(parseClaudeArgv(claude(U1)), U1)
  assert.equal(parseClaudeArgv(claude(U1, "--resume")), U1)
  assert.equal(parseClaudeArgv(argv("claude", "--output-format", "x", "--session-id", U1)), U1) // space form
  assert.equal(parseClaudeArgv(argv("claude", "-p", `--session-id=${U1}`)), undefined) // no --output-format
  assert.equal(parseClaudeArgv(argv("claude", "--output-format", "x", "-p", `mentions --session-id=${U1}`)), undefined) // substring only
  assert.equal(parseClaudeArgv(argv("claude", "--output-format", "x", "--session-id=nope")), undefined)
  assert.equal(parseClaudeArgv(argv("claude", "--output-format", "x", `--session-id=${U1}`, `--resume=${U2}`)), undefined) // two ids
  assert.equal(parseClaudeArgv(argv("node", "--output-format", "x", `--session-id=${U1}`)), undefined)
})

test("only direct children of the server are found", () => {
  const p = new FakeProc()
  p.add(1, claude(U1))
  p.add(2, claude(U2), 999) // other parent
  p.add(3, argv("bash", "-c", "claude"), SERVER)
  assert.deepEqual(findClaudeProcesses(p, SERVER).map((x) => x.pid), [1])
})

test("signalIfSame refuses a reused pid or changed argv", () => {
  const p = new FakeProc()
  p.add(1, claude(U1), SERVER, "5000")
  const [target] = findClaudeProcesses(p, SERVER)
  p.add(1, claude(U1), SERVER, "6000") // same pid, new start time
  assert.equal(signalIfSame(p, SERVER, target!), false)
  p.add(1, claude(U2), SERVER, "5000")
  assert.equal(signalIfSame(p, SERVER, target!), false)
  p.add(1, claude(U1), 7, "5000") // reparented
  assert.equal(signalIfSame(p, SERVER, target!), false)
  p.procs.delete(1)
  assert.equal(signalIfSame(p, SERVER, target!), false)
  assert.deepEqual(p.killed, [])
  p.add(1, claude(U1), SERVER, "5000")
  assert.equal(signalIfSame(p, SERVER, target!), true)
  assert.deepEqual(p.killed, [1])
})

test("restartSession: happy path kills only the matching process and applies the account", async () => {
  const { proc, env, deps } = setup()
  proc.add(10, claude(U1))
  proc.add(11, claude(U2))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.ok, true)
  assert.deepEqual(proc.killed, [10])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/b")
  assert.match(r.message, /Other live sessions keep/)
})

test("restartSession: busy (server side) refuses and changes nothing", async () => {
  const { proc, env, deps } = setup({ busy: ["ses_a"] })
  proc.add(10, claude(U1))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "busy")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
})

test("restartSession: active lookup failure fails closed", async () => {
  const { proc, deps } = setup({ down: true })
  proc.add(10, claude(U1))
  assert.equal((await restartSession(deps, { sessionID: "ses_a" })).reason, "unavailable")
  assert.deepEqual(proc.killed, [])
})

test("restartSession: no mapping never falls back to kill-all", async () => {
  const { proc, deps } = setup({ messages: { ses_a: [{ type: "assistant", content: [{ type: "text" }] }] } })
  proc.add(10, claude(U1))
  proc.add(11, claude(U2))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "no_mapping")
  assert.deepEqual(proc.killed, [])
})

test("restartSession: mapped but no live process", async () => {
  const { proc, deps, env } = setup()
  proc.add(11, claude(U2))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "no_process")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/b")
})

test("restartSession: duplicate live processes for one UUID refuse", async () => {
  const { proc, deps } = setup()
  proc.add(10, claude(U1))
  proc.add(12, claude(U1, "--resume"))
  assert.equal((await restartSession(deps, { sessionID: "ses_a" })).reason, "ambiguous")
  assert.deepEqual(proc.killed, [])
})

test("restartSession: fork with copied ID (same as source) refuses", async () => {
  const copied = { type: "assistant", time: { created: 2000 }, content: [{ native: { sessionID: U1 } }] }
  const { proc, deps } = setup({
    sessions: { ses_src: { id: "ses_src", time: { created: 1000 } }, ses_fork: { id: "ses_fork", fork: { sessionID: "ses_src" }, time: { created: 1500 } } },
    messages: { ses_src: [copied], ses_fork: [copied] },
  })
  proc.add(10, claude(U1))
  const r = await restartSession(deps, { sessionID: "ses_fork" })
  assert.equal(r.reason, "ambiguous")
  assert.deepEqual(proc.killed, [])
})

test("restartSession: fork whose newest ID predates the fork refuses even if source moved on", async () => {
  const old = { type: "assistant", time: { created: 1200 }, content: [{ native: { sessionID: U1 } }] }
  const moved = { type: "assistant", time: { created: 3000 }, content: [{ native: { sessionID: U2 } }] }
  const { proc, deps } = setup({
    sessions: { ses_src: { id: "ses_src", time: { created: 1000 } }, ses_fork: { id: "ses_fork", fork: { sessionID: "ses_src" }, time: { created: 1500 } } },
    messages: { ses_src: [moved, old], ses_fork: [old] },
  })
  proc.add(10, claude(U1))
  assert.equal((await restartSession(deps, { sessionID: "ses_fork" })).reason, "ambiguous")
  assert.deepEqual(proc.killed, [])
})

test("restartSession: fork with its own process works; unreadable source fails closed", async () => {
  const own = { type: "assistant", time: { created: 2000 }, content: [{ native: { sessionID: U2 } }] }
  const src = { type: "assistant", time: { created: 1100 }, content: [{ native: { sessionID: U1 } }] }
  const sessions = { ses_src: { id: "ses_src", time: { created: 1000 } }, ses_fork: { id: "ses_fork", fork: { sessionID: "ses_src" }, time: { created: 1500 } } }
  const a = setup({ sessions, messages: { ses_src: [src], ses_fork: [own, src] } })
  a.proc.add(10, claude(U1))
  a.proc.add(11, claude(U2))
  assert.equal((await restartSession(a.deps, { sessionID: "ses_fork" })).ok, true)
  assert.deepEqual(a.proc.killed, [11])

  const b = setup({ sessions, messages: { ses_fork: [own, src] } })
  b.deps.listMessages = async ({ sessionID }) => {
    if (sessionID === "ses_src") throw new Error("gone")
    return { messages: [own, src] }
  }
  b.proc.add(11, claude(U2))
  assert.equal((await restartSession(b.deps, { sessionID: "ses_fork" })).reason, "unavailable")
  assert.deepEqual(b.proc.killed, [])
})

test("restartSession: account lookup failures fail closed and leave env alone", async () => {
  for (const acct of [
    account({ run: () => ({ status: 1, stdout: "" }) }),
    account({ run: () => { throw new Error("ENOENT") } }),
    account({ run: () => ({ status: 0, stdout: "relative/path" }) }),
    account({ isDirectory: () => false }),
  ]) {
    const { proc, env, deps } = setup({ acct })
    proc.add(10, claude(U1))
    const r = await restartSession(deps, { sessionID: "ses_a" })
    assert.equal(r.reason, "account_unavailable")
    assert.deepEqual(proc.killed, [])
    assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
  }
})

test("account: empty output = primary (deletes env), pin reported", async () => {
  const { proc, env, deps } = setup({ acct: account({ run: () => ({ status: 0, stdout: "" }), env: { OMARCHY_AGENT_CLAUDE_HOME: "" } }) })
  proc.add(10, claude(U1))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.pinned, true)
  assert.equal("CLAUDE_CONFIG_DIR" in env, false)
  assert.equal(lookupAccount(account({ run: () => ({ status: 0, stdout: "/h/x" }) })).label, "~/x")
})

test("proc race: process vanishes or is replaced between scan and signal", async () => {
  const { proc, deps } = setup()
  proc.add(10, claude(U1), SERVER, "5000")
  let calls = 0
  proc.onStat = (pid) => {
    // Scan reads stat once; the second read (identity re-check) sees a new process.
    if (pid === 10 && ++calls === 2) proc.add(10, claude(U1), SERVER, "9999")
  }
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.ok, false)
  assert.deepEqual(proc.killed, [])
})

test("restartSession: busy flips between check and signal", async () => {
  const { proc, deps } = setup()
  proc.add(10, claude(U1))
  let n = 0
  deps.getSession = async () => ({ id: "ses_a", time: { created: 1000, busy: ++n >= 2 ? 2000 : 1500, idle: 1600 } })
  assert.equal((await restartSession(deps, { sessionID: "ses_a" })).reason, "busy")
  assert.deepEqual(proc.killed, [])
})

test("invalid input", async () => {
  const { deps } = setup()
  assert.equal((await restartSession(deps, {})).reason, "invalid")
  assert.equal((await restartSession(deps, { sessionID: "x" })).reason, "invalid")
  assert.equal((await restartAll(deps, { pids: ["1"] })).reason, "invalid")
})

const ids = (p: any) => p.processes as any[]

test("restartAll: kills exactly the confirmed identities (subagents/busy included), leaves new ones", async () => {
  const { proc, env, deps } = setup({ busy: ["ses_a"] })
  proc.add(10, claude(U1))
  proc.add(11, claude(U2))
  proc.add(12, claude("33333333-3333-4333-8333-333333333333"))
  const p = await preview(deps)
  assert.deepEqual(ids(p).map((x) => x.pid), [10, 11, 12])
  assert.equal(p.activeSessions, 1)
  assert.doesNotMatch(JSON.stringify(p), /--session-id|stream-json/) // argv never leaves the server
  const gone = { pid: 77, startTime: "1", digest: "a".repeat(64) }
  const r = await restartAll(deps, { processes: [ids(p)[0], ids(p)[1], gone], account: p.account })
  assert.deepEqual(proc.killed, [10, 11])
  assert.deepEqual(r.skipped, [77])
  assert.equal(r.unconfirmed, 1)
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/b")
})

test("restartAll: PID reuse between preview and confirm is not signalled", async () => {
  const { proc, deps } = setup()
  proc.add(10, claude(U1), SERVER, "5000")
  const p = await preview(deps)
  // Same pid, new start time (reuse) / same start time but different argv.
  proc.add(10, claude(U2), SERVER, "7777")
  let r = await restartAll(deps, { processes: ids(p), account: p.account })
  assert.deepEqual(proc.killed, [])
  assert.equal(r.unconfirmed, 1)
  assert.deepEqual(r.skipped, [10])
  proc.add(10, claude(U2), SERVER, "5000")
  r = await restartAll(deps, { processes: ids(p), account: p.account })
  assert.deepEqual(proc.killed, [])
  proc.add(10, claude(U1), SERVER, "5000") // the original
  r = await restartAll(deps, { processes: ids(p), account: p.account })
  assert.deepEqual(proc.killed, [10])
})

test("restartAll: account changed since the confirmation fails without touching anything", async () => {
  const { proc, env, deps } = setup()
  proc.add(10, claude(U1))
  const p = await preview(deps)
  deps.account = account({ run: () => ({ status: 0, stdout: "/acct/c\n" }) })
  const r = await restartAll(deps, { processes: ids(p), account: p.account })
  assert.equal(r.reason, "account_changed")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
})

test("restartAll: account failure stops before any kill", async () => {
  const { proc, env, deps } = setup()
  proc.add(10, claude(U1))
  const p = await preview(deps)
  deps.account = account({ run: () => ({ status: 2, stdout: "" }) })
  assert.equal((await restartAll(deps, { processes: ids(p), account: p.account })).reason, "account_unavailable")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
  assert.equal((await preview(deps)).reason, "account_unavailable")
})

test("no_mapping (new session) still applies the account and kills nothing", async () => {
  const { proc, env, deps } = setup({ messages: { ses_a: [] } })
  proc.add(10, claude(U1)) // some live process we cannot attribute: untouched
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "no_mapping")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/b")
  assert.doesNotMatch(r.message, /No live Claude process/) // must not claim nothing is running
  assert.match(r.message, /left untouched/)
})

test("no_mapping after compaction: live unmatched process untouched, account applied", async () => {
  const { proc, env, deps } = setup({ messages: { ses_a: [{ type: "compaction", status: "completed", time: { created: 9000 } }] } })
  proc.add(10, claude(U1))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "no_mapping")
  assert.deepEqual(proc.killed, [])
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/b")
})

test("no_mapping with account failure leaves env unchanged", async () => {
  const { proc, env, deps } = setup({ messages: { ses_a: [] }, acct: account({ run: () => ({ status: 1, stdout: "" }) }) })
  proc.add(10, claude(U1))
  const r = await restartSession(deps, { sessionID: "ses_a" })
  assert.equal(r.reason, "account_unavailable")
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
  assert.deepEqual(proc.killed, [])
})

test("no_mapping on a busy session still refuses as busy and changes nothing", async () => {
  const { env, deps } = setup({ messages: { ses_a: [] }, busy: ["ses_a"] })
  assert.equal((await restartSession(deps, { sessionID: "ses_a" })).reason, "busy")
  assert.equal(env.CLAUDE_CONFIG_DIR, "/acct/a")
})

test("no AI codepath: no production file references prompt, generate, tools or interrupt", async () => {
  const { readFileSync, readdirSync } = await import("node:fs")
  const root = new URL("../", import.meta.url)
  const files = ["index.ts", "rpc.ts", "tui.ts", ...readdirSync(new URL("lib/", root)).map((f) => "lib/" + f)]
  assert.ok(files.length >= 9)
  for (const f of files) {
    const src = readFileSync(new URL(f, root), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    assert.doesNotMatch(src, /\.(prompt|generate|command|synthetic|compact|switchModel|switchAgent|interrupt)\s*\(|experimental|tool\.transform|ctx\.tool|\.session\.(prompt|generate)/, f)
  }
})

test("busy detection: timestamps", () => {
  const t = new ActivityTracker()
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 5 } }), true) // never went idle
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 5, idle: 4 } }), true)
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 5, idle: 5 } }), true) // same-ms start: ambiguous => busy
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 5, idle: 6 } }), false) // normal idle session
  assert.equal(t.isBusy({ id: "s", time: { created: 1 } }), false)
})

test("busy detection: events are authoritative", () => {
  const t = new ActivityTracker()
  const ev = (created: number, type: string) => t.observe({ type: "session.status", created, data: { sessionID: "s", status: { type } } })
  ev(100, "busy") // run started in the same ms the previous one ended: idle == busy == 100
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 100, idle: 100 } }), true)
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 100, idle: 101 } }), true) // idle bumped by +1
  ev(110, "retry")
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 5, idle: 200 } }), true)
  assert.equal(t.busyCount(), 1)
  ev(120, "idle")
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 100, idle: 121 } }), false) // normally idle sessions stay restartable
  assert.equal(t.isBusy({ id: "s", time: { created: 1, busy: 120, idle: 121 } }), true) // a run began at/after the idle event
  assert.equal(t.busyCount(), 0)
  t.observe({ type: "other", data: { sessionID: "s2", status: { type: "busy" } } })
  assert.equal(t.busyCount(), 0)
})

test("message order does not matter: newest by time wins", async () => {
  const old = { type: "assistant", time: { created: 1200 }, content: [{ native: { sessionID: U2 } }] }
  const fresh = { type: "assistant", time: { created: 3000 }, native: { sessionID: U1 } }
  for (const order of [[old, fresh], [fresh, old]]) {
    const { proc, deps } = setup({ messages: { ses_a: order } })
    proc.add(10, claude(U1))
    proc.add(11, claude(U2))
    assert.equal((await restartSession(deps, { sessionID: "ses_a" })).ok, true)
    assert.deepEqual(proc.killed, [10])
  }
})
