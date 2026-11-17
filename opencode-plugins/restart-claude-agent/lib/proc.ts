import { createHash } from "node:crypto"

// Process discovery and guarded signalling for Claude Agent children.
// Everything touching /proc or process.kill goes through the injected `Proc`
// so tests can use fakes and never signal a real process.

export interface Proc {
  /** Numeric entries of /proc. */
  pids(): string[]
  /** Raw /proc/<pid>/stat, or undefined when it vanished. */
  stat(pid: number): string | undefined
  /** Raw /proc/<pid>/cmdline, or undefined when it vanished. */
  cmdline(pid: number): string | undefined
  kill(pid: number, signal: "SIGTERM"): void
}

export interface ClaudeProcess {
  pid: number
  /** Field 22 of /proc/<pid>/stat: with the pid, uniquely identifies a process. */
  startTime: string
  claudeSessionID: string
  /** The exact argv, used to confirm identity again right before signalling. */
  cmdline: string
}

/** Non-secret identity of a scanned process: argv is hashed, never returned. */
export interface Identity {
  pid: number
  startTime: string
  digest: string
}

export const identityOf = (p: ClaudeProcess): Identity => ({
  pid: p.pid,
  startTime: p.startTime,
  digest: createHash("sha256").update(p.cmdline).digest("hex"),
})

export const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.pid === b.pid && a.startTime === b.startTime && a.digest === b.digest

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseStat(raw: string): { ppid: number; startTime: string } | undefined {
  const close = raw.lastIndexOf(")")
  if (close < 0) return undefined
  // Fields after "(comm) ": state, ppid, ... ; starttime is field 22 => index 19.
  const fields = raw.slice(close + 2).split(" ")
  const ppid = Number(fields[1])
  const startTime = fields[19]
  if (!Number.isInteger(ppid) || !startTime || !/^\d+$/.test(startTime)) return undefined
  return { ppid, startTime }
}

/**
 * Exact-argv parse of a provider-spawned claude. Returns the Claude session
 * UUID only when argv0 is `claude`, `--output-format` is a real argument, and
 * exactly one `--session-id`/`--resume` argument carries a valid UUID.
 * Substring matches (a prompt that merely mentions the flags) never count.
 */
export function parseClaudeArgv(cmdline: string): string | undefined {
  const argv = cmdline.split("\0")
  if (argv[argv.length - 1] === "") argv.pop()
  if (!/(^|\/)claude$/.test(argv[0] ?? "")) return undefined
  const rest = argv.slice(1)
  if (!rest.some((a) => a === "--output-format" || a.startsWith("--output-format="))) return undefined

  const ids: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    for (const flag of ["--session-id", "--resume"]) {
      if (arg.startsWith(flag + "=")) ids.push(arg.slice(flag.length + 1))
      else if (arg === flag) ids.push(rest[i + 1] ?? "")
    }
  }
  if (ids.length !== 1 || !UUID.test(ids[0]!)) return undefined
  return ids[0]!.toLowerCase()
}

/** Claude Agent processes that are direct children of `parentPid`. */
export function findClaudeProcesses(proc: Proc, parentPid: number): ClaudeProcess[] {
  const found: ClaudeProcess[] = []
  for (const entry of proc.pids()) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    try {
      const raw = proc.stat(pid)
      const cmdline = proc.cmdline(pid)
      if (raw === undefined || cmdline === undefined) continue
      const stat = parseStat(raw)
      if (!stat || stat.ppid !== parentPid) continue
      const claudeSessionID = parseClaudeArgv(cmdline)
      if (!claudeSessionID) continue
      found.push({ pid, startTime: stat.startTime, claudeSessionID, cmdline })
    } catch {
      // Exited mid-read; skip it.
    }
  }
  return found
}

/**
 * SIGTERM `target` only if the pid still refers to the same process: same
 * parent, same start time (defeats PID reuse) and same argv. Returns false
 * (without signalling) when it is gone or has been replaced.
 */
export function signalIfSame(proc: Proc, parentPid: number, target: ClaudeProcess): boolean {
  try {
    const raw = proc.stat(target.pid)
    const cmdline = proc.cmdline(target.pid)
    if (raw === undefined || cmdline === undefined) return false
    const stat = parseStat(raw)
    if (!stat || stat.ppid !== parentPid || stat.startTime !== target.startTime) return false
    if (cmdline !== target.cmdline || parseClaudeArgv(cmdline) !== target.claudeSessionID) return false
    proc.kill(target.pid, "SIGTERM")
    return true
  } catch {
    return false
  }
}
