# Install OR update the extension on a CONSUMER machine (Windows) by cloning the repo
# directly into the VS Code extensions directory. Idempotent: run again to update.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Repo <url>]
#
# Requires git + access to the (private) repo. Run `gh auth login` once first so git can
# authenticate non-interactively (needed for the scheduled auto-update task too).
param(
  [string]$Repo = "https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git"
)
$ErrorActionPreference = "Stop"
$Dest = Join-Path $env:USERPROFILE ".vscode\extensions\nanovique.vscode-md-html-preview"

if (Test-Path (Join-Path $Dest ".git")) {
  Write-Host "Updating $Dest"
  git -C $Dest fetch --quiet origin
  git -C $Dest reset --hard '@{u}'   # match the tracked upstream (origin/<branch>)
} else {
  Write-Host "Cloning into $Dest"
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
  git clone --depth 1 $Repo $Dest
}

Write-Host "Done. Restart VS Code (or run 'Developer: Reload Window') to load the new version."
