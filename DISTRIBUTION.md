# Distribution & multi-machine auto-update (private)

This extension is distributed from a **private Git repo** rather than the Marketplace.
There is no runtime dependency, and the compiled `out/` is committed, so a consumer
machine only needs `git` — no Node/build step.

There are two machine roles:

- **Dev machine** (where you edit it — this repo's working copy, loaded into VS Code via
  a symlink): you edit, compile, and `push`.
- **Consumer machines** (your other Macs/Windows PCs): they `git clone` the repo straight
  into the VS Code extensions folder and auto-pull on a schedule.

> Auth: the repo is private, so each consumer machine needs Git access. Run
> `gh auth login` once per machine (it configures a git credential helper so scheduled,
> non-interactive `git pull` works). SSH keys work too — then use the `git@github.com:…`
> URL in the install scripts.

---

## Consumer machine — first-time install

Bootstrap by cloning the (private) repo straight into the VS Code extensions folder with
`gh` (which handles auth). After that, `dist/install.sh` / `install.ps1` (now present in
the cloned folder) handle all future updates.

**macOS / Linux**
```bash
gh auth login   # one-time, for the private repo
gh repo clone gyuheelee-nanovique/vscode-md-html-preview \
  "$HOME/.vscode/extensions/nanovique.vscode-md-html-preview"
```

**Windows (PowerShell)**
```powershell
gh auth login
gh repo clone gyuheelee-nanovique/vscode-md-html-preview `
  "$env:USERPROFILE\.vscode\extensions\nanovique.vscode-md-html-preview"
```

Then restart VS Code. `Markdown HTML Preview (Paper)` should appear in the Extensions
list and its commands in the palette.

> No GitHub CLI? Use plain git with the same destination path:
> `git clone https://github.com/gyuheelee-nanovique/vscode-md-html-preview.git <dest>`
> (you'll be prompted for credentials / a PAT since the repo is private).

---

## Consumer machine — enable auto-update

The extension lives at `~/.vscode/extensions/nanovique.vscode-md-html-preview`. Auto-update
just re-runs `dist/install.sh` (which does `git fetch` + `reset --hard origin/<branch>`),
so the folder always matches the latest pushed version. **VS Code loads the new code on the
next window reload / restart** (extensions don't hot-swap while running).

**macOS** — LaunchAgent (every 6 h + at login):
```bash
cp ~/.vscode/extensions/nanovique.vscode-md-html-preview/dist/com.nanovique.mdpreview.update.plist \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nanovique.mdpreview.update.plist
# log: /tmp/mdpreview-update.log   |  remove: launchctl unload …
```

**Windows** — Scheduled Task (daily):
```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\nanovique.vscode-md-html-preview\dist\install.ps1"
schtasks /Create /SC DAILY /ST 09:00 /TN "mdpreview-update" `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$ext`""
# remove: schtasks /Delete /TN "mdpreview-update" /F
```

---

## Dev machine — publish a new version

1. Edit `src/…` / `media/preview.css`.
2. Bump `"version"` in `package.json` (optional but recommended).
3. Compile, commit (incl. `out/`), push — one command:
   ```bash
   dist/release.sh "what changed"
   ```
4. Consumer machines auto-pull on their schedule; tell users to reload VS Code, or they
   pick it up on the next restart. To push immediately on a consumer, run `dist/install.sh`.

The dev machine keeps using the **symlink** install
(`~/.vscode/extensions/vscode-md-html-preview-<version>` → this folder) for live editing,
so it does not need the clone/auto-pull setup.

---

## Why not the Marketplace?

The Marketplace gives true native auto-update but is **public**. This private-Git setup
keeps the extension unlisted at the cost of (a) a one-time `gh auth login` per machine and
(b) auto-update being a scheduled pull rather than VS Code's built-in updater. If you ever
decide public listing is fine, `vsce publish` + VS Code Settings Sync is simpler — see the
project notes.
