# My Dotfiles

## Using stow
```zsh
stow -nvt ~ nvim
```

Drop the `-n` to actually apply it. Packages: `zsh`, `nvim`, `starship`, `claude`.

## The claude package

Claude Code settings, and skills — reusable instructions it loads on demand.

Only `.claude/settings.json` and `.claude/skills/` are tracked, deliberately. The rest of
`~/.claude` holds an OAuth token in `.credentials.json`, every prompt ever typed in
`history.jsonl`, and tens of megabytes of conversation transcripts under `projects/`, none
of which belongs in a public repo. `settings.local.json` stays untracked too — it is the
per-machine override file, which is the whole point of it.

Two things in `settings.json` are **not portable**, and will need fixing on another
machine: the `statusLine` command hardcodes `/home/alex`, and it points into a plugin cache
directory named after a commit hash (`.../caveman/63e797cd753b/...`) that changes whenever
that plugin updates.

Because `~/.claude` and `~/.claude/skills` already exist, stow descends and links each
skill individually rather than folding the directory. Skills installed by something else
— omarchy symlinks its own in — are left alone, and an unversioned scratch skill can sit
alongside these without stow touching it.

