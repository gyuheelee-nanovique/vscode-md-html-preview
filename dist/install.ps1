# Install OR update the extension on a CONSUMER machine (Windows).
#
# Keeps a git checkout of this repo in a cache directory and hands the packaged
# dist\vscode-md-html-preview.vsix to the VS Code CLI. Idempotent: re-run to update.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 [-Force] [-Repo <url>]
#
# Requires git (with access to the private repo) and the VS Code CLI. Run
# `gh auth login` once first so git can authenticate non-interactively (needed for the
# scheduled auto-update task too).
param(
  [string]$Repo = "https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git",
  [switch]$Force
)
$ErrorActionPreference = "Stop"

$ExtId = "nanovique.vscode-md-html-preview"
$Src = if ($env:MDPREVIEW_HOME) { $env:MDPREVIEW_HOME } else { Join-Path $env:LOCALAPPDATA "vscode-md-html-preview" }

# Scheduled tasks often run with a stripped PATH — fall back to the standard install
# locations. Override with the CODE_CLI environment variable.
function Find-CodeCli {
  if ($env:CODE_CLI) { return $env:CODE_CLI }
  foreach ($name in @("code.cmd", "code", "code-insiders.cmd")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"),
    (Join-Path $env:ProgramFiles "Microsoft VS Code\bin\code.cmd"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft VS Code\bin\code.cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

$Code = Find-CodeCli
if (-not $Code) {
  Write-Error "VS Code CLI not found. Add VS Code's bin\ folder to PATH, or set CODE_CLI=<path to code.cmd>."
}

# 1. Sync the checkout (a cache, not the extension itself — VS Code never reads it).
if (Test-Path (Join-Path $Src ".git")) {
  Write-Host "Updating $Src"
  git -C $Src fetch --quiet origin
  git -C $Src reset --quiet --hard '@{u}'   # match the tracked upstream (origin/<branch>)
} else {
  Write-Host "Cloning into $Src"
  if (Test-Path $Src) { Remove-Item -Recurse -Force $Src }
  New-Item -ItemType Directory -Force -Path (Split-Path $Src) | Out-Null
  git clone --quiet --depth 1 $Repo $Src
}

$Vsix = Join-Path $Src "dist\vscode-md-html-preview.vsix"
if (-not (Test-Path $Vsix)) {
  Write-Error "$Vsix is missing - run dist/release.sh (or dist\release.ps1) on the dev machine."
}

# 2. Skip the reinstall when the installed version already matches.
$New = (Get-Content (Join-Path $Src "package.json") -Raw | ConvertFrom-Json).version
$Cur = & $Code --list-extensions --show-versions |
  Where-Object { $_ -like "$ExtId@*" } |
  ForEach-Object { $_.Split("@")[-1] } |
  Select-Object -First 1

if ((-not $Force) -and $Cur -and ($Cur -eq $New)) {
  Write-Host "Already up to date ($ExtId@$Cur)."
  exit 0
}

# 3. Install. --force also covers same-version reinstalls and downgrades.
& $Code --install-extension $Vsix --force
if ($LASTEXITCODE -ne 0) { Write-Error "code --install-extension failed with exit code $LASTEXITCODE." }

$was = if ($Cur) { $Cur } else { "none" }
Write-Host "Installed $ExtId@$New (was $was)."
Write-Host "Reload VS Code ('Developer: Reload Window') to load the new version."
