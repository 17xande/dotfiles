// Server-side logic. No model/AI call exists anywhere in this module: it only
// reads session metadata and messages, scans /proc, and sends SIGTERM.

import { AccountError, applyAccount, lookupAccount, type AccountDeps } from "./account.ts"
import type { Result } from "./contract.ts"
import { UUID, findClaudeProcesses, identityOf, sameIdentity, signalIfSame, type Identity, type Proc } from "./proc.ts"

export interface SessionInfo {
  id: string
  parentID?: string
  fork?: { sessionID: string }
  time: { created: number; busy?: number; idle?: number }
}

export interface ServiceDeps {
  proc: Proc
  parentPid: number
  account: AccountDeps
  env: Record<string, string | undefined>
  getSession(sessionID: string): Promise<SessionInfo | undefined>
  /** One page of the session's messages, newest page first. */
  listMessages(input: { sessionID: string; cursor?: string }): Promise<{ messages: unknown[]; next?: string }>
  /** True when the session is running a turn (retrying counts). Conservative: unknown => true. */
  isBusy(session: SessionInfo): boolean
  /** Sessions seen running a turn right now (events since this plugin loaded). */
  busyCount(): number
}

const MAX_PAGES = 10
const fail = (reason: NonNullable<Result["reason"]>, message: string): Result => ({ ok: false, reason, message })

function accountNote(label: string, pinned: boolean): string {
  return (
    `Future Claude processes on this server start on ${label}` +
    (pinned ? " (pinned by OMARCHY_AGENT_CLAUDE_HOME in the server environment)" : "") +
    ". Other live sessions keep their current account until their process is replaced."
  )
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined

function nativeID(value: unknown): string | undefined {
  const id = asRecord(asRecord(value)?.native)?.sessionID
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : undefined
}

/**
 * Newest Claude session UUID recorded in the session's own assistant
 * messages (message.native / content[].native, set by the provider), with the
 * time of the message that carries it. undefined when none is recorded.
 */
export async function newestClaudeID(
  deps: ServiceDeps,
  sessionID: string,
): Promise<{ uuid: string; created: number } | undefined> {
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const { messages, next } = await deps.listMessages({ sessionID, cursor })
    // Pick the newest by time, so the order the API returns messages in does not matter.
    let best: { uuid: string; created: number } | undefined
    for (const message of messages) {
      const record = asRecord(message)
      if (!record || record.type !== "assistant") continue
      const created = asRecord(record.time)?.created
      if (typeof created !== "number") continue
      const content = Array.isArray(record.content) ? record.content : []
      const uuid = nativeID(record) ?? content.map(nativeID).find((id) => id !== undefined)
      if (uuid && (!best || created > best.created)) best = { uuid, created }
    }
    if (best) return best
    if (!next) return undefined
    cursor = next
  }
  return undefined
}

async function isBusy(deps: ServiceDeps, sessionID: string): Promise<boolean | undefined> {
  try {
    const session = await deps.getSession(sessionID)
    return session ? deps.isBusy(session) : undefined
  } catch {
    return undefined
  }
}

export async function preview(deps: ServiceDeps): Promise<Result> {
  let account
  try {
    account = lookupAccount(deps.account)
  } catch (error) {
    return fail("account_unavailable", error instanceof AccountError ? error.message : "Account lookup failed")
  }
  const activeSessions = deps.busyCount()
  const processes = findClaudeProcesses(deps.proc, deps.parentPid).map(identityOf)
  return { ok: true, message: `${processes.length} Claude process(es)`, account: account.label, pinned: account.pinned, processes, activeSessions }
}

export async function restartSession(deps: ServiceDeps, input: { sessionID?: unknown }): Promise<Result> {
  const sessionID = input.sessionID
  if (typeof sessionID !== "string" || !/^ses/.test(sessionID)) return fail("invalid", "Invalid session ID.")

  // 1. Busy check, server side. Unknown => refuse.
  const active = await isBusy(deps, sessionID)
  if (active === undefined) return fail("unavailable", "Could not read which sessions are running; nothing was restarted.")
  if (active) return fail("busy", "This session is running a turn. Wait for it to finish (or interrupt it), then try again.")

  // 2. Session + mapping.
  let session: SessionInfo | undefined
  let own: Awaited<ReturnType<typeof newestClaudeID>>
  try {
    session = await deps.getSession(sessionID)
    if (!session) return fail("unavailable", "Session not found.")
    own = await newestClaudeID(deps, sessionID)
  } catch {
    return fail("unavailable", "Could not read the session's messages; nothing was restarted.")
  }
  if (!own) {
    // New or just-compacted session: its Claude ID is not in the messages we can read, so
    // no process can be attributed to it and none is touched (a live one is left running).
    // The launch environment is still updated, so the next launch uses the active account.
    let account
    try {
      account = lookupAccount(deps.account)
    } catch (error) {
      return fail("account_unavailable", `${error instanceof Error ? error.message : "Account lookup failed"}; nothing was changed.`)
    }
    applyAccount(account, deps.env)
    return {
      ok: false,
      reason: "no_mapping",
      account: account.label,
      pinned: account.pinned,
      killed: [],
      message:
        "Could not identify this session's Claude process (the session is new or was just compacted), so no process was stopped; any running one was left untouched. " +
        accountNote(account.label, account.pinned),
    }
  }

  // 3. Fork guard: forks copy history (including provider metadata) from their
  // source, so a copied UUID points at the source's process, not ours.
  if (session.fork) {
    if (own.created < session.time.created) {
      return fail("ambiguous", "This fork has not started its own Claude process yet (its Claude ID was copied from the source session).")
    }
    try {
      const source = await newestClaudeID(deps, session.fork.sessionID)
      if (source && source.uuid === own.uuid) {
        return fail("ambiguous", "This fork shares its Claude ID with its source session, so the process cannot be attributed to it; nothing was restarted.")
      }
    } catch {
      return fail("unavailable", "Could not read the fork's source session; nothing was restarted.")
    }
  }

  // 4. Account lookup before anything is changed.
  let account
  try {
    account = lookupAccount(deps.account)
  } catch (error) {
    return fail("account_unavailable", `${error instanceof Error ? error.message : "Account lookup failed"}; nothing was changed.`)
  }

  // 5. Exactly one direct-child process with this exact UUID.
  const matches = findClaudeProcesses(deps.proc, deps.parentPid).filter((p) => p.claudeSessionID === own.uuid)
  if (matches.length > 1) return fail("ambiguous", "More than one process claims this Claude session; nothing was restarted.")

  applyAccount(account, deps.env)
  if (matches.length === 0) {
    return { ok: false, reason: "no_process", account: account.label, pinned: account.pinned, killed: [], message: `No live Claude process for this session. ${accountNote(account.label, account.pinned)}` }
  }

  // 6. Re-check busy immediately before signalling.
  if ((await isBusy(deps, sessionID)) !== false) {
    return fail("busy", "This session started running a turn; nothing was restarted.")
  }
  const target = matches[0]!
  const done = signalIfSame(deps.proc, deps.parentPid, target)
  return done
    ? { ok: true, account: account.label, pinned: account.pinned, killed: [target.pid], message: `Stopped Claude process ${target.pid}; it restarts on your next message. ${accountNote(account.label, account.pinned)}` }
    : { ok: false, reason: "no_process", account: account.label, pinned: account.pinned, killed: [], message: "The process exited or changed before it could be stopped; nothing was signalled." }
}

const isIdentity = (v: unknown): v is Identity => {
  const r = asRecord(v)
  return (
    !!r &&
    Number.isInteger(r.pid) &&
    (r.pid as number) > 0 &&
    typeof r.startTime === "string" &&
    /^\d+$/.test(r.startTime) &&
    typeof r.digest === "string" &&
    /^[0-9a-f]{64}$/.test(r.digest)
  )
}

export async function restartAll(deps: ServiceDeps, input: { processes?: unknown; account?: unknown }): Promise<Result> {
  const confirmed = input.processes
  if (!Array.isArray(confirmed) || !confirmed.every(isIdentity) || typeof input.account !== "string") {
    return fail("invalid", "Invalid process list.")
  }

  let account
  try {
    account = lookupAccount(deps.account)
  } catch (error) {
    return fail("account_unavailable", `${error instanceof Error ? error.message : "Account lookup failed"}; nothing was changed.`)
  }

  // The user confirmed a specific account; never switch to a different one silently.
  if (account.label !== input.account) {
    return fail("account_changed", "The active Claude account changed since the confirmation; nothing was changed. Run the command again to re-confirm.")
  }

  // Only a process with exactly the confirmed identity (pid + start time + argv hash) is a target.
  const procs = findClaudeProcesses(deps.proc, deps.parentPid)
  const targets = procs.filter((p) => confirmed.some((c) => sameIdentity(c, identityOf(p))))
  const unconfirmed = procs.length - targets.length

  applyAccount(account, deps.env)
  const killed: number[] = []
  const skipped: number[] = []
  for (const c of confirmed) {
    const target = targets.find((p) => sameIdentity(c, identityOf(p)))
    if (target && signalIfSame(deps.proc, deps.parentPid, target)) killed.push(c.pid)
    else skipped.push(c.pid)
  }
  return {
    ok: true,
    account: account.label,
    pinned: account.pinned,
    killed,
    skipped,
    unconfirmed,
    message:
      `Stopped ${killed.length} Claude process(es)` +
      (skipped.length ? `, ${skipped.length} already gone or replaced` : "") +
      (unconfirmed ? `, ${unconfirmed} new one(s) left running` : "") +
      `. ${accountNote(account.label, account.pinned)}`,
  }
}
