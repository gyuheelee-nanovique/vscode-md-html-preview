#!/usr/bin/env bash
#
# Install OR update the extension on a CONSUMER machine (macOS / Linux).
#
# Keeps a git checkout of this repo in a cache directory and hands the packaged
# dist/vscode-md-html-preview.vsix to the VS Code CLI. Idempotent: re-run to update.
#
#   ./install.sh [-f|--force] [repo-url]
#
# Requires git (with access to the private repo) and the VS Code CLI. Run
# `gh auth login` once per machine so scheduled, non-interactive pulls authenticate.
set -euo pipefail

EXT_ID="nanovique.vscode-md-html-preview"
REPO="https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git"
SRC="${MDPREVIEW_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/vscode-md-html-preview}"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    -f|--force) FORCE=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) REPO="$arg" ;;
  esac
done

# The `code` CLI is not on PATH by default on macOS, and scheduled jobs often run with a
# stripped PATH — fall back to the standard install locations. Override with CODE_CLI.
find_code() {
  if [ -n "${CODE_CLI:-}" ]; then echo "$CODE_CLI"; return 0; fi
  for c in code code-insiders; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  for p in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
           "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
           "/usr/share/code/bin/code" \
           "/snap/bin/code"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

if ! CODE="$(find_code)"; then
  echo "error: VS Code CLI not found." >&2
  echo "       Run 'Shell Command: Install \`code\` command in PATH' from the VS Code" >&2
  echo "       command palette, or set CODE_CLI=/path/to/code." >&2
  exit 1
fi

# 1. Sync the checkout (this is a cache, not the extension itself — VS Code never reads it).
if [ -d "$SRC/.git" ]; then
  echo "Updating $SRC"
  git -C "$SRC" fetch --quiet origin
  git -C "$SRC" reset --quiet --hard '@{u}'   # match the tracked upstream (origin/<branch>)
else
  echo "Cloning into $SRC"
  rm -rf "$SRC"
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet --depth 1 "$REPO" "$SRC"
fi

VSIX="$SRC/dist/vscode-md-html-preview.vsix"
if [ ! -f "$VSIX" ]; then
  echo "error: $VSIX is missing — run dist/release.sh on the dev machine." >&2
  exit 1
fi

# 2. Skip the reinstall when the installed version already matches.
NEW="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -1)"
CUR="$("$CODE" --list-extensions --show-versions 2>/dev/null | sed -n "s/^${EXT_ID}@//p" | head -1)"

if [ "$FORCE" -eq 0 ] && [ -n "$CUR" ] && [ "$CUR" = "$NEW" ]; then
  echo "Already up to date (${EXT_ID}@${CUR})."
  exit 0
fi

# 3. Install. --force also covers same-version reinstalls and downgrades.
"$CODE" --install-extension "$VSIX" --force

echo "Installed ${EXT_ID}@${NEW} (was ${CUR:-none})."
echo "Reload VS Code ('Developer: Reload Window') to load the new version."
