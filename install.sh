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
