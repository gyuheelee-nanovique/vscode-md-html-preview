#!/usr/bin/env bash
#
# Install OR update the extension on a CONSUMER machine (macOS / Linux) by cloning the
# repo directly into the VS Code extensions directory. Idempotent: run again to update.
#
#   ./install.sh [repo-url]
#
# Requires git + access to the (private) repo. Run `gh auth login` once first so that
# git can authenticate non-interactively (needed for scheduled auto-updates too).
set -euo pipefail

REPO="${1:-https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git}"
DEST="$HOME/.vscode/extensions/nanovique.vscode-md-html-preview"

if [ -d "$DEST/.git" ]; then
  echo "Updating $DEST"
  git -C "$DEST" fetch --quiet origin
  BR="$(git -C "$DEST" rev-parse --abbrev-ref HEAD)"
  git -C "$DEST" reset --hard "origin/$BR"
else
  echo "Cloning into $DEST"
  rm -rf "$DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 "$REPO" "$DEST"
fi

echo "Done. Restart VS Code (or run 'Developer: Reload Window') to load the new version."
