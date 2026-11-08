# My Dotfiles

Two stow packages, plus a plugin marketplace. Preview with `stow -nvt ~ claude agents`;
drop the `-n` to apply.

## claude

`~/.claude` pieces worth carrying between machines: `settings.json`, `CLAUDE.md`,
`hooks/plan-file-allow.sh`, and `skills/` (each skill is a symlink into the `agents` package).

Deliberately not tracked: `.credentials.json` (OAuth token), `history.jsonl` and `projects/`
(prompts and conversation transcripts), and `settings.local.json`. Put per-machine settings
and secrets (the `env` block with API tokens) in `settings.local.json`, never in
`settings.json` — this repo is public.

Not portable: the `alex-local` marketplace path in `settings.json` is absolute
(`/home/alex/dev/dotfiles/claude-plugins`), so clone this repo to `~/dev/dotfiles`.
Plugins themselves are reinstalled from `enabledPlugins` and `extraKnownMarketplaces`.
Hooks installed by other tools (herdr) and skills symlinked in by omarchy or swamp are not
tracked.

## agents

The skills themselves, under `.agents/skills/`. Stow links them to `~/.agents/skills/`.

## claude-plugins

A personal Claude Code plugin marketplace (`alex-local`), not a stow package. Add it with
`claude plugin marketplace add ~/dev/dotfiles/claude-plugins`, then
`claude plugin install deno-lsp@alex-local`. `deno-lsp` is a language-server plugin; `deno lsp`
is force-enabled (`initializationOptions.enable`) so it also covers Node projects.
