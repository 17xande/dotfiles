// Omarchy's active Claude account for new processes.

export interface AccountDeps {
  /** Runs `omarchy-agent-account-home claude`. status 0 with empty stdout means the primary account. */
  run(): { status: number | null; stdout: string }
  isDirectory(path: string): boolean
  env: Record<string, string | undefined>
  home: string | undefined
}

export interface Account {
  /** CLAUDE_CONFIG_DIR value, or undefined for the primary (~/.claude) account. */
  configDir: string | undefined
  label: string
  /** OMARCHY_AGENT_CLAUDE_HOME is set in the server's environment, so the lookup is pinned. */
  pinned: boolean
}

export class AccountError extends Error {}

/**
 * Looks the account up without changing anything. Throws AccountError on any
 * failure so callers can stop before touching the environment or a process.
 * Never reads inside the account directory.
 */
export function lookupAccount(deps: AccountDeps): Account {
  let result: ReturnType<AccountDeps["run"]>
  try {
    result = deps.run()
  } catch (error) {
    throw new AccountError(`Could not run omarchy-agent-account-home: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (result.status !== 0) throw new AccountError(`omarchy-agent-account-home claude exited with status ${result.status}`)

  const pinned = "OMARCHY_AGENT_CLAUDE_HOME" in deps.env
  const configDir = result.stdout.trim()
  if (!configDir) return { configDir: undefined, label: "primary (~/.claude)", pinned }

  if (!configDir.startsWith("/") || configDir.includes("\0") || configDir.includes("\n")) {
    throw new AccountError("omarchy-agent-account-home returned an unusable path")
  }
  if (!deps.isDirectory(configDir)) throw new AccountError("The active Claude account directory does not exist")
  const label = deps.home && configDir.startsWith(deps.home + "/") ? "~" + configDir.slice(deps.home.length) : configDir
  return { configDir, label, pinned }
}

/** Points future `claude` spawns of this server process at `account`. */
export function applyAccount(account: Account, env: Record<string, string | undefined>): void {
  if (account.configDir) env.CLAUDE_CONFIG_DIR = account.configDir
  else delete env.CLAUDE_CONFIG_DIR
}
