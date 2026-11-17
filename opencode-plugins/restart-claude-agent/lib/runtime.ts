// Real-world wiring: /proc, process.kill, the account script, and the plugin
// context's session API. Only index.ts uses this; tests use fakes.

import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import type { AccountDeps } from "./account.ts"
import type { ActivityTracker } from "./activity.ts"
import type { Proc } from "./proc.ts"
import type { ServiceDeps, SessionInfo } from "./service.ts"

export const realProc: Proc = {
  pids: () => readdirSync("/proc"),
  stat(pid) {
    try {
      return readFileSync(`/proc/${pid}/stat`, "utf8")
    } catch {
      return undefined
    }
  },
  cmdline(pid) {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8")
    } catch {
      return undefined
    }
  },
  kill: (pid, signal) => process.kill(pid, signal),
}

export const realAccount = (): AccountDeps => ({
  run() {
    const result = spawnSync("omarchy-agent-account-home", ["claude"], { encoding: "utf8", timeout: 10_000 })
    if (result.error) throw result.error
    return { status: result.status, stdout: result.stdout ?? "" }
  },
  isDirectory(path) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  env: process.env,
  home: process.env.HOME,
})

// The read-only subset of ctx.session this plugin uses. Neither call starts a
// model request.
export interface SessionApi {
  get(input: { sessionID: string }): Promise<unknown>
  /** Active context messages: everything after the last compaction. */
  context(input: { sessionID: string }): Promise<unknown>
}

export function serviceDeps(session: SessionApi, activity: ActivityTracker): ServiceDeps {
  return {
    proc: realProc,
    parentPid: process.pid,
    account: realAccount(),
    env: process.env,
    async getSession(sessionID) {
      return (await session.get({ sessionID })) as SessionInfo | undefined
    },
    async listMessages({ sessionID }) {
      const messages = await session.context({ sessionID })
      if (!Array.isArray(messages)) throw new Error("unexpected context shape")
      return { messages }
    },
    isBusy: (info) => activity.isBusy(info),
    busyCount: () => activity.busyCount(),
  }
}
