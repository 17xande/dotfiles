# My Dotfiles

Two stow packages, plus personal plugins. Preview with `stow -nvt ~ claude agents`;
drop the `-n` to apply.

## claude

`~/.claude` pieces worth carrying between machines: `settings.json`, `hooks/plan-file-allow.sh`,
`CLAUDE.md`. `CLAUDE.md` is a symlink into the `agents` package: Claude Code reads only
`CLAUDE.md`, so that name has to exist, but nothing is maintained here. Skills live in
`skill-packs/` (below).

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

The single source for instructions shared by every agent CLI:

- `.agents/AGENTS.md`: global instructions. `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and
  `~/.config/opencode/AGENTS.md` are symlinks to `~/.agents/AGENTS.md` (`install.sh` makes the
  last two; they are outside the stow packages).

## skill-packs

Skills are not global. Each pack is a folder of skills (my own, or symlinks to where a tool keeps
its skills) that an `opencode.json` turns on for one directory tree with
`"skills": ["~/dev/dotfiles/skill-packs/<pack>"]`. Config is merged from `/` down to the working
directory, so a pack listed in `~/dev/opencode.json` applies to every repo below it.

| Pack | Turned on by |
|---|---|
| dev, go | `~/dev/opencode.json` |
| cloudflare, basecamp | `~/dev/riverschurch/opencode.json` |
| ipad | `~/dev/17xande.dev/opencode.json` |
| swamp | `~/dev/tools/opencode.json` |
| desktop (omarchy, superwhisper) | `~/dev/dotfiles/opencode.json`, `~/.config/opencode.json` |

Those `opencode.json` files (other than this repo's) are not tracked. Tool-installed skill folders
(basecamp, swamp) were moved to `~/.local/share/agent-skills/`. The only global skill is herdr.
`~/.agents/skills/omarchy*` and `~/.claude/skills/omarchy*` are empty placeholder folders: they
stop Omarchy migrations (`omarchy-agent-skills-link`) from linking its skills back in globally.
Claude Code does not read the `skills` config key, so it sees only the global skills.

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
