#!/usr/bin/env bash
# Link the packages into $HOME. Preview first: stow -nvt ~ claude agents
set -euo pipefail
cd "$(dirname "$0")"

stow -vt ~ claude agents

# Codex and OpenCode read the same global instructions; their config
# directories are not stow packages, so link the one file each needs.
mkdir -p ~/.codex ~/.config/opencode
ln -sfn ~/.agents/AGENTS.md ~/.codex/AGENTS.md
ln -sfn ~/.agents/AGENTS.md ~/.config/opencode/AGENTS.md

# Personal OpenCode plugins are linked individually, not the whole config.
plugin="$HOME/.config/opencode/plugins/restart-claude-agent"
mkdir -p "$(dirname "$plugin")"
if [[ -e "$plugin" && ! -L "$plugin" ]]; then
  echo "Move $plugin aside before installing its dotfiles symlink." >&2
  exit 1
fi
ln -sfn "$PWD/opencode-plugins/restart-claude-agent" "$plugin"
