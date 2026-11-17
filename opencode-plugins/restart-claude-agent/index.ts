import { Plugin } from "@opencode/plugin"
import { RestartClaudeAgent } from "./rpc.ts"
import { applyAccount, lookupAccount } from "./lib/account.ts"
import { sharedTracker, type ActivityTracker } from "./lib/activity.ts"
import { preview, restartAll, restartSession } from "./lib/service.ts"
import { realAccount, serviceDeps } from "./lib/runtime.ts"

// Server part. Registers the RPC behind the two Ctrl+P commands. There is no
// model-invoked tool here: nothing in this plugin can start a model call.
export default Plugin.define({
  id: "restart-claude-agent",
  async setup(ctx) {
    // A restarted server starts on the active account instead of the primary
    // one. If the lookup fails the environment is left exactly as it is.
    try {
      applyAccount(lookupAccount(realAccount()), process.env)
    } catch {}

    // Live session status feeds the server-side busy check. Events are location
    // scoped; every loaded location's instance feeds the same shared tracker.
    // Sessions of a location with no loaded instance are only seen via timestamps.
    const activity = sharedTracker()
    const stop = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ types: ["session.status"], signal: stop.signal })) {
          activity.observe(event as unknown as Parameters<ActivityTracker["observe"]>[0])
        }
      } catch {
        // Aborted on unload, or the stream ended; the stored timestamps still guard.
      }
    })()

    const deps = () => serviceDeps(ctx.session, activity)
    const registration = await ctx.rpc.register(RestartClaudeAgent, {
      preview: async () => preview(deps()),
      restartSession: async (input) => restartSession(deps(), (input ?? {}) as { sessionID?: unknown }),
      restartAll: async (input) => restartAll(deps(), (input ?? {}) as { processes?: unknown; account?: unknown }),
    })
    return () => {
      stop.abort()
      return registration.dispose()
    }
  },
})
