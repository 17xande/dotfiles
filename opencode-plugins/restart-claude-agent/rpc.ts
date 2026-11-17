import { Rpc } from "@opencode/plugin/rpc"
import { RPC_ID, methods } from "./lib/contract.ts"

// Shared by the server part (implements) and the TUI part (calls).
export const RestartClaudeAgent = Rpc.define({ id: RPC_ID, methods, events: {} })
