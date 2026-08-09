# Distribution & multi-machine auto-update (private)

This extension is distributed from a **private Git repo** rather than the Marketplace.
The built `dist/vscode-md-html-preview.vsix` is committed, so a consumer machine only
needs **git + VS Code** — no Node, no build step.

There are two machine roles:

- **Dev machine** (where you edit it): you edit, package, and `push` with `dist/release.sh`.
- **Consumer machines** (your other Macs/Windows PCs): they keep a git checkout in a cache
  directory and re-install the `.vsix` through the VS Code CLI on a schedule.

> Auth: the repo is private, so each consumer machine needs Git access. Run
> `gh auth login` once per machine (it configures a git credential helper so scheduled,
> non-interactive `git pull` works). SSH keys work too — then use the `git@github.com:…`
> URL in the install scripts.

> **Do not clone the repo into `~/.vscode/extensions/`.** That used to work, but since
> VS Code ~1.74 (verified broken on 1.132) user extensions are loaded from
> `~/.vscode/extensions/extensions.json`, and a hand-placed folder is never scanned —
> it does not appear in `code --list-extensions` and never activates. Installing the
> `.vsix` through the CLI registers it properly, which is what the scripts below do.

---

## Consumer machine — first-time install

Clone the (private) repo into a cache directory with `gh` (which handles auth), then run
the install script. That script handles all future updates too.

**macOS / Linux**
```bash
gh auth login   # one-time, for the private repo
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/vscode-md-html-preview"
gh repo clone gyuheelee-nanovique/vscode-md-html-preview "$DEST"
"$DEST/dist/install.sh"
```

**Windows (PowerShell)**
```powershell
gh auth login
$dest = "$env:LOCALAPPDATA\vscode-md-html-preview"
gh repo clone gyuheelee-nanovique/vscode-md-html-preview $dest
powershell -NoProfile -ExecutionPolicy Bypass -File "$dest\dist\install.ps1"
```

Then reload VS Code. `Markdown HTML Preview (Paper)` should appear in the Extensions list
and its commands in the palette; `code --list-extensions` should show
`nanovique.vscode-md-html-preview`.

The scripts need the `code` CLI. On macOS run *Shell Command: Install `code` command in
PATH* from the command palette once — otherwise they fall back to the standard install
locations, and `CODE_CLI=/path/to/code` overrides both.

> No GitHub CLI? Use plain git with the same destination path:
> `git clone https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git <dest>`
> (you'll be prompted for credentials / a PAT since the repo is private).
>
> Just want a one-off install without the checkout? Grab the `.vsix` from the repo and run
> `code --install-extension vscode-md-html-preview.vsix --force`. You then update by hand.

---

## Consumer machine — enable auto-update

Auto-update just re-runs `dist/install.sh` / `install.ps1`, which does `git fetch` +
`reset --hard origin/<branch>` on the cache checkout, compares the repo's `package.json`
version against the installed one, and re-installs the `.vsix` only when they differ.
**VS Code loads the new code on the next window reload / restart** (extensions don't
hot-swap while running).

**macOS** — LaunchAgent (every 6 h + at login):
```bash
cp "${XDG_DATA_HOME:-$HOME/.local/share}/vscode-md-html-preview/dist/com.nanovique.mdpreview.update.plist" \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nanovique.mdpreview.update.plist
# log: /tmp/mdpreview-update.log   |  remove: launchctl unload …
```

**Windows** — Scheduled Task (daily):
```powershell
$script = "$env:LOCALAPPDATA\vscode-md-html-preview\dist\install.ps1"
schtasks /Create /SC DAILY /ST 09:00 /TN "mdpreview-update" `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`""
# remove: schtasks /Delete /TN "mdpreview-update" /F
```

Force a reinstall regardless of version with `install.sh --force` / `install.ps1 -Force`.

---

## Dev machine — publish a new version

1. Edit `src/…` / `media/preview.css`.
2. Bump `"version"` in `package.json` — **required**: consumers skip the install when the
   version is unchanged.
3. Package, commit (incl. the rebuilt `.vsix`), and push — one command:
   ```bash
   dist/release.sh "what changed"
   ```
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File dist\release.ps1 "what changed"
   ```
4. Consumer machines auto-pull on their schedule; tell users to reload VS Code, or they
   pick it up on the next restart. To update immediately, run `dist/install.sh` there.

`release.sh` runs `npm install` (first time only), refetches `media/vendor/` if a checkout
is missing it, and calls `npx @vscode/vsce package`, which triggers `npm run compile` via
the `vscode:prepublish` hook — so the `.vsix` always contains freshly compiled output.

`media/vendor/` holds the third-party assets a saved HTML file inlines (KaTeX + its fonts,
highlight.js, Mermaid, the webfont — ~4.5 MB, committed). Refresh them after bumping a
version in `dist/fetch-vendor.mjs` with `node dist/fetch-vendor.mjs --force`. They are the
reason the `.vsix` is ~2 MB rather than ~50 KB, and therefore why each release commit adds
roughly that much to the repo.

For day-to-day work, don't install the extension on the dev machine at all: press **F5**
in this repo to launch an Extension Development Host with the working copy loaded, which
reloads on rebuild. Install the `.vsix` locally only to smoke-test the real artifact
(`code --install-extension dist/vscode-md-html-preview.vsix --force`).

---

## Why not the Marketplace?

The Marketplace gives true native auto-update but is **public**. This private-Git setup
keeps the extension unlisted at the cost of (a) a one-time `gh auth login` per machine and
(b) auto-update being a scheduled pull rather than VS Code's built-in updater. If you ever
decide public listing is fine, `vsce publish` + VS Code Settings Sync is simpler — see the
project notes.
