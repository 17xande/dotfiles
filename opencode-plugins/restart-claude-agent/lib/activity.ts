// Server-side "is this session running a turn?" from public data only:
// Session.Info timestamps (busy/idle) plus live `session.status` events.
// The plugin context has no active-sessions call, so this is the check.
//
// Upstream facts (opencode v2.3.0, core/src/session/projector.ts):
//  - time.busy = created of Execution.Started.
//  - time.idle = max(created, previous idle + 1) on every terminal event, so
//    idle can be >= busy for a run that started in the same millisecond as the
//    previous terminal. Timestamps alone are therefore only trusted when they
//    clearly say "idle" (idle > busy); equality counts as busy.
//  - A shutdown interruption does not set idle, so a session that was busy at
//    shutdown looks busy forever. Refusing there is deliberate (fail closed).

import type { SessionInfo } from "./service.ts"

export interface StatusEvent {
  type: string
  created?: number
  data?: { sessionID?: string; status?: { type?: string } }
}

export class ActivityTracker {
  #latest = new Map<string, { busy: boolean; created: number }>()

  observe(event: StatusEvent): void {
    if (event.type !== "session.status") return
    const sessionID = event.data?.sessionID
    const status = event.data?.status?.type
    if (typeof sessionID !== "string" || typeof status !== "string") return
    this.#latest.set(sessionID, { busy: status !== "idle", created: typeof event.created === "number" ? event.created : Date.now() })
  }

  /**
   * With a live event for the session, the newest event is authoritative: busy
   * (running or retrying) means busy whatever the timestamps say; idle means
   * idle unless a run started at or after it (stored busy >= event time).
   * Without events, stored timestamps decide, and only a strictly newer idle
   * counts as idle.
   */
  isBusy(session: SessionInfo): boolean {
    const { busy, idle } = session.time
    const seen = this.#latest.get(session.id)
    if (seen) {
      if (seen.busy) return true
      return busy !== undefined && busy >= seen.created
    }
    return busy !== undefined && (idle === undefined || busy >= idle)
  }

  /** Sessions whose newest observed event is busy. Only covers what this process observed: a lower bound. */
  busyCount(): number {
    let n = 0
    for (const seen of this.#latest.values()) if (seen.busy) n++
    return n
  }
}

// Plugin instances load once per location in the same process; they share one
// tracker so events from every loaded location count towards busy checks.
const KEY = Symbol.for("restart-claude-agent.activity")
export function sharedTracker(): ActivityTracker {
  const g = globalThis as unknown as Record<symbol, ActivityTracker | undefined>
  return (g[KEY] ??= new ActivityTracker())
}
