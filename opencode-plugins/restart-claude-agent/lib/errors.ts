// Readable text for whatever an RPC call rejects with. The client rejects with
// a plain { type, message, data? } object for server-side RPC errors, so
// String(error) would print "[object Object]".
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    const { type, message } = error as { type?: unknown; message?: unknown }
    const text = typeof message === "string" ? message : undefined
    const kind = typeof type === "string" ? type : undefined
    if (text && kind) return `${kind}: ${text}`
    if (text ?? kind) return (text ?? kind)!
    try {
      return JSON.stringify(error).slice(0, 200)
    } catch {
      return "unknown error"
    }
  }
  return String(error)
}
