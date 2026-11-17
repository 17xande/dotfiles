# My Dotfiles

Two stow packages, plus personal plugins. Preview with `stow -nvt ~ claude agents`;
drop the `-n` to apply.

## claude

`~/.claude` pieces worth carrying between machines: `settings.json`, `hooks/plan-file-allow.sh`,
`CLAUDE.md` and `skills/`. `CLAUDE.md` and every skill are symlinks into the `agents` package:
Claude Code reads only `CLAUDE.md` and `~/.claude/skills`, so those names have to exist, but
nothing is maintained here.

Deliberately not tracked: `.credentials.json` (OAuth token), `history.jsonl` and `projects/`
(prompts and conversation transcripts). `settings.json` must stay free of secrets (this repo is
public): no `env` block with tokens. A secret belongs to the project that uses it, in that
project's git-ignored `.env` or `mise.local.toml`.

Not portable: the `alex-local` marketplace path in `settings.json` is absolute
(`/home/alex/dev/dotfiles/claude-plugins`), so clone this repo to `~/dev/dotfiles`.
Plugins themselves are reinstalled from `enabledPlugins` and `extraKnownMarketplaces`.
Hooks installed by other tools (herdr) and skills symlinked in by omarchy or swamp are not
tracked.

## agents

The single source for instructions and skills shared by every agent CLI:

- `.agents/AGENTS.md`: global instructions. `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and
  `~/.config/opencode/AGENTS.md` are symlinks to `~/.agents/AGENTS.md` (`install.sh` makes the
  last two; they are outside the stow packages).
- `.agents/skills/`: the skills. Stow links them to `~/.agents/skills/`, which Codex and
  OpenCode read directly.

## claude-plugins

A personal Claude Code plugin marketplace (`alex-local`), not a stow package. Add it with
`claude plugin marketplace add ~/dev/dotfiles/claude-plugins`, then
`claude plugin install deno-lsp@alex-local`. `deno-lsp` is a language-server plugin; `deno lsp`
is force-enabled (`initializationOptions.enable`) so it also covers Node projects.

## opencode-plugins

Personal OpenCode plugins, not a stow package. `./install.sh` links
`opencode-plugins/restart-claude-agent` to
`~/.config/opencode/plugins/restart-claude-agent`; existing directories must be moved
aside first. OpenCode discovers the server and TUI parts from that directory.

`restart-claude-agent` adds two token-free Ctrl+P actions:

- **Restart Claude agent (this session)**: refuses busy sessions and stops only the
  current session's Claude process.
- **Restart Claude agents (ALL sessions on this server)**: asks for confirmation and
  includes busy sessions and subagents.

Replacement processes use Omarchy's active Claude account. Other running processes
keep their account until replaced. Neither action restarts the OpenCode service.
This plugin requires Linux `/proc`, Omarchy's account commands, and OpenCode 2.3.0's
plugin API. It does not contain credentials or account state.

Run the non-destructive tests with a recent Node.js supporting TypeScript stripping
and `node:module.registerHooks` (verified with Node.js 26):

```sh
node --test opencode-plugins/restart-claude-agent/test/*.test.ts
```
