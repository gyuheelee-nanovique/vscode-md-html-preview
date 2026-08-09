#!/usr/bin/env bash
#
# Publish an update from the DEV machine: compile, package dist/vscode-md-html-preview.vsix,
# commit and push. Consumer machines pick it up on their next dist/install.sh run.
#
#   dist/release.sh ["commit message"]     # bump "version" in package.json first
#
# Requires Node (for `tsc` + `vsce`). Consumers do not — they only need git + VS Code.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install --no-audit --no-fund

# `vsce package` runs the vscode:prepublish script, i.e. `npm run compile`.
npx --yes @vscode/vsce package --out dist/vscode-md-html-preview.vsix

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"

git add -A
if git diff --cached --quiet; then
  echo "Nothing to release (no changes)."
  exit 0
fi
git commit -m "${1:-release v$VERSION}"
git push

echo "Pushed v$VERSION. Consumers update on their next scheduled run (or dist/install.sh)."
