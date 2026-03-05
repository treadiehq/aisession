# AI Session Sync (`ss`)

**Multi-device continuity for Claude Code, OpenAI Codex CLI, OpenCode, and Cursor.**

`ss` mirrors local AI session stores through a provider-backed sync folder (iCloud, Dropbox, Google Drive, OneDrive, or any custom folder) so you can pick up where you left off on any machine — macOS, Windows, or Linux. No cloud API integrations, no web UI, no magic.

---

## What it syncs

| Tool | macOS | Windows | Linux |
|------|-------|---------|-------|
| Claude Code | `~/.claude` | `%UserProfile%\.claude` | `~/.claude` |
| OpenAI Codex CLI | `~/.codex` | `%UserProfile%\.codex` | `~/.codex` |
| OpenCode | `~/.opencode` | `%UserProfile%\.opencode` | `~/.opencode` |
| Cursor | `~/Library/.../workspaceStorage` | `%AppData%\Cursor\...` | `~/.config/Cursor/...` |
| `~/.openai` | **Excluded by default** (credentials) | | |

Paths are auto-detected on first run — no manual config required.

---

## Prerequisites

- **Node.js ≥ 18**
- A sync provider folder on each machine:
  - **macOS**: iCloud Drive, Dropbox, Google Drive, or OneDrive (auto-detected)
  - **Windows**: OneDrive, Dropbox, or Google Drive (auto-detected)
  - **Linux**: Dropbox or any mounted sync folder (Syncthing, rclone, etc.)

---

## Install

```bash
npm install -g aisession # or npx aisession setup
```

This installs `ss` globally via `npm link`.

---

## Recommended first-time setup

### 1. Choose your sync provider

```bash
ss setup
```

This interactive wizard:
- Detects your OS
- Shows available providers (iCloud / Dropbox / Google Drive / OneDrive / Custom)
- Auto-detects provider folder paths
- Creates `SessionSync/` inside the chosen folder
- Auto-fills source paths from platform detection

Non-interactive mode for scripts:

```bash
ss setup --non-interactive --provider dropbox
ss setup --non-interactive --provider custom --path /mnt/shared/sync
```

### 2. Initialize

```bash
ss init         # creates ~/.sessionsync/config.json + index DB
```

### 3. Start syncing

```bash
ss daemon:start
```

### On another machine

```bash
ss setup        # choose the same provider
ss init
ss daemon:start
```

Both machines now continuously push to and pull from the shared folder.

---

## Provider selection

`ss` treats the sync transport as **just a local folder** — whatever keeps that folder in sync across machines is up to you. The folder layout is:

```
<syncRoot>/
  machines/<machineId>/<source>/<relPath>
  locks/<source>/<projectKey>.lock.json
```

### macOS

| Provider | Auto-detected path |
|----------|--------------------|
| iCloud | `~/Library/Mobile Documents/com~apple~CloudDocs` |
| Dropbox | `~/Dropbox` or `~/Library/CloudStorage/Dropbox` |
| Google Drive | `~/Google Drive` or `~/Library/CloudStorage/GoogleDrive-*` |
| OneDrive | `~/OneDrive` or `~/Library/CloudStorage/OneDrive-*` |

### Windows

| Provider | Auto-detected path |
|----------|--------------------|
| OneDrive | `%UserProfile%\OneDrive` |
| Dropbox | `%UserProfile%\Dropbox` |
| Google Drive | `%UserProfile%\Google Drive` or `%UserProfile%\My Drive` |
| iCloud | `%UserProfile%\iCloudDrive` (if installed) |

### Linux

Native cloud sync clients are uncommon on Linux. Recommended options:

- **Dropbox** (`~/Dropbox`) — install the Dropbox daemon
- **Any synced mount** (Syncthing, rclone, SSHFS, etc.) — use `custom` provider
- **Syncthing**: `ss setup --non-interactive --provider custom --path ~/Sync`

Switch provider at any time:

```bash
ss set-sync --provider dropbox
ss set-sync --provider custom --path /mnt/gdrive
```

---

## Usage

### Core commands

```bash
ss setup             # Interactive provider selection + path auto-detection
ss init              # Initialize config + DB
ss config            # Print resolved config
ss set-sync --provider <name>  # Switch sync provider
ss status            # Show sync status (machineId, provider, last push/pull, counts)
ss doctor            # Validate environment, config, and sync health
ss push              # One-shot push to sync folder
ss pull              # One-shot pull from sync folder
ss watch             # Push on file changes (foreground)
```

### Daemon

```bash
ss daemon:start      # Start background daemon (watch + periodic pull + lock renewals)
ss daemon:stop       # Stop daemon
ss daemon:status     # Check daemon status
```

### Sessions

```bash
ss sessions          # List recent sessions (default: 20)
ss sessions --limit 50

ss resume <sessionId>           # Print resume block for LLM
ss resume <sessionId> --turns 5 # Show only last 5 turns
```

### Locks

Locks prevent two machines from pushing conflicting updates to the same project.

```bash
ss lock myproject --source claude    # Acquire lock
ss unlock myproject --source claude  # Release lock
```

### Cursor / OpenCode restore

Cursor and OpenCode DB files are **never pushed live** — only snapshots are synced.

```bash
ss cursor:restore <snapshotId> --to ~/Library/Application\ Support/Cursor/User/workspaceStorage/<hash>
ss opencode:restore <snapshotId> --to ~/.opencode/sessions/mydb.sqlite
```

> Both commands refuse to proceed if the target app is still running.

### Discover

```bash
ss discover all        # Show all detected source paths + sync providers
ss discover opencode   # Scan for OpenCode session data and suggest config entry
```

### Validate environment

```bash
ss doctor
```

Checks:
- OS + Node.js version
- Config file validity
- Sync provider + sync root (exists? writable?)
- Source paths (readable?)
- Lock/snapshot folder writability
- Warnings for large DB files or `~/.openai` in config

### Session Handoff

Generate a compact continuation prompt and paste it into any LLM to instantly resume a session on another machine or tool — no API required, fully offline.

```bash
ss handoff <sessionId>                    # Markdown output (default)
ss handoff <sessionId> --format text      # Plain text
ss handoff <sessionId> --format json      # JSON (for scripting)
ss handoff <sessionId> --turns 10         # Use last 10 turns (default: 6)
ss handoff <sessionId> --include-git false # Skip git status
```

Example output:

```
# SESSION HANDOFF

**Project:** billing-api
**Source:** codex
**Updated:** 3/4/2026, 7:05:00 PM

## WORK COMPLETED
- Refactored billing service
- Added retry logic
- Edited billing.ts

## LAST USER PROMPT
Add retry backoff logic

## LAST ASSISTANT RESPONSE
Here is an exponential backoff implementation...

## FILES MODIFIED
- `billing.ts`
- `payment.ts`

## CURRENT GIT STATUS
M billing.ts
M payment.ts

## NEXT SUGGESTED TASK
Continue implementing: "Add retry backoff logic"

---
*Paste this block into Claude, Codex, Cursor, or another LLM to continue the session.*
```

**Typical multi-machine workflow:**

```
Laptop (Machine A)                Desktop (Machine B)
──────────────────                ───────────────────
ss daemon:start                   ss pull
  (coding with Claude...)         ss sessions
                                  ss handoff <id>
                                    → paste into Claude/Cursor/Codex
```

The handoff block is also available via the local API:

```bash
curl http://localhost:3900/sessions/<id>/handoff
```

---

## How it works

### Push / pull

1. `ss push` walks all `include` paths, hashes changed files, and copies them to  
   `~/Library/Mobile Documents/com~apple~CloudDocs/SessionSync/machines/<machineId>/<source>/`
2. `ss pull` scans all other `machines/` folders in the iCloud root and copies them to  
   `~/.sessionsync/cache/machines/<otherMachineId>/`
3. Change detection: size+mtime quick check, then sha256 for files < 5 MB.
4. All file copies are atomic (write to `.sstmp` → rename).

### Safety and continuity

- **Cursor / OpenCode DB files**: snapshotted before any push.  
  Snapshots live at `~/.sessionsync/snapshots/<source>/<snapshotId>/`.
- **Locks**: written to `<syncRoot>/locks/<source>/<projectKey>.lock.json`.  
  Lock TTL: 10 minutes; renewed every 60 s by the daemon.
- **Redact patterns**: files matching `*token*`, `*auth*`, `*credential*`, `*.pem`, `*.key`, etc. are **never synced**.

---

## Config

Default config at `~/.sessionsync/config.json`:

```json
{
  "syncRoot": "~/Library/Mobile Documents/com~apple~CloudDocs/SessionSync",
  "machineId": "<stable-id>",
  "include": [
    { "name": "claude",    "path": "~/.claude" },
    { "name": "codex",     "path": "~/.codex" },
    { "name": "opencode",  "path": "~/.opencode" },
    { "name": "cursor",    "path": "~/Library/Application Support/Cursor/User/workspaceStorage" }
  ],
  "exclude": ["**/Cache/**", "**/*.lock", "**/*.tmp", "**/*.temp", "**/*.swp", "**/node_modules/**"],
  "redactFileNamePatterns": ["*token*", "*auth*", "*credential*", "*api_key*", "*.pem", "*.key"],
  "pollIntervalMs": 1500,
  "pullIntervalMs": 30000,
  "lockTtlMs": 600000
}
```

Edit this file directly to customize paths or add new sources.

---

## Security

- `~/.openai` is excluded by default. The daemon and push command will error if you add it without `--i-know-what-im-doing`.
- Files matching `redactFileNamePatterns` are silently skipped at push time.
- Cursor and OpenCode DB files are never pushed live — only read-only snapshots.

---

## Local state

| Path | Purpose |
|------|---------|
| `~/.sessionsync/config.json` | User config |
| `~/.sessionsync/index.db` | SQLite index (sources, files, sessions) |
| `~/.sessionsync/logs/ss.log` | JSON log (pino) |
| `~/.sessionsync/cache/machines/` | Pulled remote sessions |
| `~/.sessionsync/snapshots/` | Local DB snapshots |
| `~/.sessionsync/daemon.pid` | Daemon PID |

---

## Development

```bash
npm run dev -- <command>   # run via tsx (no build needed)
npm run build              # compile to dist/
npm test                   # run vitest
```

---

## Typical multi-machine workflow

```
Machine A                          iCloud Drive                  Machine B
─────────                          ────────────                  ─────────
ss daemon:start          →→→  machines/machineA/claude/…
                                   machines/machineA/codex/…
                               ←←← machines/machineB/…          ss daemon:start

ss sessions                                                      ss pull
ss resume <id>                                                   ss sessions
                                                                 ss resume <id>
```

---

## Limitations

- macOS only (iCloud Drive path is macOS-specific).
- Cursor workspace context (active files, AI chat history) is approximate — Cursor stores state in SQLite; `ss` snapshots it but cannot extract semantic context.
- Sync is eventually consistent; there is no real-time streaming.
- iCloud Drive sync speed is not controlled by `ss`.


## License

[FSL-1.1-MIT](LICENSE)