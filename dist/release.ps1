# Publish an update from the DEV machine (Windows): compile, package
# dist\vscode-md-html-preview.vsix, commit and push. Consumer machines pick it up on
# their next dist\install.ps1 run.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dist\release.ps1 ["commit message"]
#
# Requires Node (for `tsc` + `vsce`). Consumers do not - they only need git + VS Code.
param(
  [string]$Message
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
# The vendored KaTeX / highlight.js / Mermaid / webfont files are committed; refetch them
# only if a checkout is missing them, otherwise the export silently reverts to CDN links.
if (-not (Test-Path "media\vendor\mermaid.min.js")) { node dist/fetch-vendor.mjs }

# `vsce package` runs the vscode:prepublish script, i.e. `npm run compile`.
npx --yes @vscode/vsce package --out dist/vscode-md-html-preview.vsix
if ($LASTEXITCODE -ne 0) { Write-Error "vsce package failed with exit code $LASTEXITCODE." }

$version = (Get-Content "package.json" -Raw | ConvertFrom-Json).version

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "Nothing to release (no changes)."
  exit 0
}

if (-not $Message) { $Message = "release v$version" }
git commit -m $Message
git push

Write-Host "Pushed v$version. Consumers update on their next scheduled run (or dist\install.ps1)."
