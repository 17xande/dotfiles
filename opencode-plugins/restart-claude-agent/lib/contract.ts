// SCHEMA SUBSET: these schemas are decoded by OpenCode's RPC codec (effect
// SchemaRepresentation), which REJECTS `pattern` outright (rpc.invalid_output /
// HTTP 400) and ignores `format`. It strips (does not reject) extra properties
// even with additionalProperties:false. So schemas use only type, properties,
// required, items, enum, minimum, minLength/maxLength, and every format rule
// (session ID, start time, digest) is enforced again at runtime in service.ts.
// Plain JSON Schema + types for the RPC shared by the server and TUI parts.
// rpc.ts wraps these with Rpc.define; keeping them here lets tests import them
// without the OpenCode SDK.

export const RPC_ID = "restart-claude-agent"

export type Reason =
  | "invalid"
  | "unavailable" // session/active/message APIs unusable: fail closed
  | "busy"
  | "no_mapping" // no Claude session ID recorded for this OpenCode session
  | "ambiguous" // fork/duplicate: cannot prove which process belongs to the session
  | "no_process" // mapping is fine but nothing is running for it
  | "account_unavailable"
  | "account_changed" // account differs from the one confirmed: re-preview

export interface Identity {
  pid: number
  startTime: string
  /** sha256 of the exact argv (argv itself is never sent). */
  digest: string
}

export interface Result {
  ok: boolean
  reason?: Reason
  message: string
  account?: string
  pinned?: boolean
  /** PIDs signalled. */
  killed?: number[]
  /** Confirmed PIDs that were gone or replaced before signalling. */
  skipped?: number[]
  /** preview: matching processes (all sessions + subagents), as non-secret identities. */
  processes?: Identity[]
  /** preview: OpenCode sessions currently running a turn (any provider). */
  activeSessions?: number
  /** restartAll: matching processes that appeared after the confirmation (left alone). */
  unconfirmed?: number
}

const int = { type: "integer", minimum: 1 } as const
const identity = {
  type: "object",
  properties: { pid: int, startTime: { type: "string", minLength: 1, maxLength: 32 }, digest: { type: "string", minLength: 64, maxLength: 64 } },
  required: ["pid", "startTime", "digest"],
  additionalProperties: false,
} as const
const ints = { type: "array", items: int } as const

export const resultSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    reason: {
      type: "string",
      enum: ["invalid", "unavailable", "busy", "no_mapping", "ambiguous", "no_process", "account_unavailable", "account_changed"],
    },
    message: { type: "string" },
    account: { type: "string" },
    pinned: { type: "boolean" },
    killed: ints,
    skipped: ints,
    processes: { type: "array", items: identity },
    activeSessions: { type: "integer", minimum: 0 },
    unconfirmed: { type: "integer", minimum: 0 },
  },
  required: ["ok", "message"],
  additionalProperties: false,
} as const

export const methods = {
  /** Read-only: matching processes, active account, running sessions. */
  preview: {
    input: { type: "object", properties: {}, additionalProperties: false },
    output: resultSchema,
  },
  /** Restart only the Claude process of one OpenCode session (never its children). Refuses busy sessions. */
  restartSession: {
    input: {
      type: "object",
      properties: { sessionID: { type: "string", minLength: 5, maxLength: 80 } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    output: resultSchema,
  },
  /** Restart exactly the confirmed processes (all sessions, subagents, busy included). */
  restartAll: {
    input: {
      type: "object",
      properties: {
        processes: { type: "array", items: identity },
        /** The account label shown in the confirmation. */
        account: { type: "string" },
      },
      required: ["processes", "account"],
      additionalProperties: false,
    },
    output: resultSchema,
  },
} as const
