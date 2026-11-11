# My Dotfiles

Two stow packages, plus a plugin marketplace. Preview with `stow -nvt ~ claude agents`;
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
