#!/usr/bin/env bash
#
# Publish an update from the DEV machine: compile, commit (including out/), and push.
# Consumer machines pick it up on their next scheduled pull + VS Code reload.
#
#   dist/release.sh ["commit message"]   (also bump "version" in package.json first)
set -euo pipefail
cd "$(dirname "$0")/.."

npm run compile
git add -A
if git diff --cached --quiet; then
  echo "Nothing to release (no changes)."
  exit 0
fi
git commit -m "${1:-update}"
git push
echo "Pushed. Consumers will update on their next scheduled pull (or run dist/install.sh)."
