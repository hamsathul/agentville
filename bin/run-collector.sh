#!/bin/bash
# launchd entry point: find the current nvm Node, put claude/gh/git on PATH, run the collector.
# Resolving Node at start (not hard-coding it) keeps the service working after an nvm upgrade.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NVM_DIR="$HOME/.nvm"
NODE_BIN=""
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" --no-use
  NODE_BIN="$(nvm which default 2>/dev/null || true)"
fi
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
export PATH="$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec "$NODE_BIN" "$ROOT/collector/index.mjs"
