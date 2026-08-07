# My Dotfiles

## Using stow
```zsh
stow -nvt ~ nvim
```

Drop the `-n` to actually apply it. Packages: `zsh`, `nvim`, `starship`, `claude`.

## The claude package

Claude Code skills — reusable instructions it loads on demand.

Only `.claude/skills/` is tracked, deliberately. The rest of `~/.claude` holds an OAuth
token in `.credentials.json`, every prompt ever typed in `history.jsonl`, and tens of
megabytes of conversation transcripts under `projects/`, none of which belongs in a
public repo.

Because `~/.claude` and `~/.claude/skills` already exist, stow descends and links each
skill individually rather than folding the directory. Skills installed by something else
— omarchy symlinks its own in — are left alone, and an unversioned scratch skill can sit
alongside these without stow touching it.

