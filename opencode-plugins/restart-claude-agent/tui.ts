import { Plugin } from "@opencode/plugin/tui"
import { RestartClaudeAgent } from "./rpc.ts"
import type { Result } from "./lib/contract.ts"
import { describeError } from "./lib/errors.ts"

// TUI part: two Ctrl+P commands. Both only call the server RPC, so neither
// makes a model call and both work with the Claude allowance exhausted.
export default Plugin.define({
  id: "restart-claude-agent.tui",
  setup(context) {
    const client = () => context.client.rpc(RestartClaudeAgent)
    // Every call names the location whose loaded plugin should handle it; without
    // it the server picks its default location (the home directory).
    const options = () => ({ location: context.location ?? context.data.location.default() })
    const rpc = () => {
      const c = client()
      return {
        preview: (input: Record<string, never>) => c.preview(input, options()),
        restartSession: (input: { sessionID: string }) => c.restartSession(input, options()),
        restartAll: (input: Parameters<typeof c.restartAll>[0]) => c.restartAll(input, options()),
      }
    }

    const call = async (run: () => Promise<Result>): Promise<Result | undefined> => {
      try {
        return await run()
      } catch (error) {
        context.ui.toast.show({
          title: "Restart Claude agent",
          message: `Server call failed: ${describeError(error)}`,
          variant: "error",
          duration: 8000,
        })
        return undefined
      }
    }

    const show = (result: Result) =>
      context.ui.toast.show({
        title: "Restart Claude agent",
        message: result.message,
        variant: result.ok ? "success" : result.reason === "no_process" || result.reason === "no_mapping" ? "info" : "warning",
        duration: 10000,
      })

    const currentSession = () => {
      const route = context.ui.router.current()
      return route?.type === "session" ? (route.sessionID as string) : undefined
    }

    const restartThisSession = async () => {
      const sessionID = currentSession()
      if (!sessionID) {
        context.ui.toast.show({ message: "Open a session first.", variant: "warning" })
        return
      }
      // Friendly early exit; the server checks again and is authoritative.
      const status = context.data.session.status(sessionID)
      if (status && status !== "idle") {
        context.ui.toast.show({ title: "Restart Claude agent", message: "This session is busy. Wait for it to finish, then try again.", variant: "warning" })
        return
      }
      const result = await call(() => rpc().restartSession({ sessionID }) as Promise<Result>)
      if (result) show(result)
    }

    const restartAllSessions = async () => {
      const info = await call(() => rpc().preview({}) as Promise<Result>)
      if (!info) return
      if (!info.ok) return show(info)
      const processes = info.processes ?? []
      if (processes.length === 0) {
        context.ui.toast.show({ title: "Restart Claude agents", message: "No Claude processes are running on this server.", variant: "info" })
        return
      }
      const local = context.data.session.list().filter((s) => context.data.session.status(s.id) === "running").length
      const running = Math.max(info.activeSessions ?? 0, local)
      const confirmed = await context.ui.dialog.confirm({
        title: "Restart Claude agents for ALL sessions?",
        message:
          `This stops ${processes.length} Claude process(es) on this OpenCode server: every session and subagent, not just this one.\n\n` +
          `WARNING: ${running > 0 ? `At least ${running} session(s) are running a turn right now (sessions in other projects may not be counted), and any` : "Any"} turn in progress will be interrupted.\n\n` +
          `Each session starts a new process on its next message, on ${info.account ?? "the active account"}` +
          `${info.pinned ? " (pinned by the server environment)" : ""}. Future Claude processes on this server use that account; ` +
          `processes that are not restarted keep their current one.`,
        label: { confirm: `Stop ${processes.length}`, cancel: "Cancel" },
      })
      if (!confirmed) return
      const result = await call(() => rpc().restartAll({ processes, account: info.account ?? "" }) as Promise<Result>)
      if (result) show(result)
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "restart-claude-agent.session",
          title: "Restart Claude agent (this session)",
          group: "Claude",
          palette: true,
          enabled: () => currentSession() !== undefined,
          run: restartThisSession,
        },
        {
          id: "restart-claude-agent.all",
          title: "Restart Claude agents (ALL sessions on this server)",
          group: "Claude",
          palette: true,
          run: restartAllSessions,
        },
      ],
    }))
  },
})
