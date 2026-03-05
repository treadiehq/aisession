# aisession — Detailed Documentation

Full reference for commands, config, sync behavior, security, and architecture.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [All Commands](#all-commands)
- [Provider Setup](#provider-setup)
- [Session Handoff](#session-handoff)
- [Session Timeline & Replay](#session-timeline--replay)
- [Export & Share](#export--share)
- [Local API Server](#local-api-server)
- [Locks](#locks)
- [Snapshots & Restore](#snapshots--restore)
- [Doctor](#doctor)
- [Config Reference](#config-reference)
- [Security](#security)
- [Local State](#local-state)
- [How It Works](#how-it-works)
- [Development](#development)

---

## Prerequisites

- **Node.js ≥ 18**
- A sync provider folder accessible on each machine:
  - **macOS**: iCloud Drive, Dropbox, Google Drive, or OneDrive (auto-detected)
  - **Windows**: OneDrive, Dropbox, or Google Drive (auto-detected)
  - **Linux**: Dropbox or any mounted sync folder (Syncthing, rclone, etc.)

---

## All Commands

```bash
ais setup                          # Interactive provider selection
ais init                           # Initialize config + DB
ais config                         # Print resolved config
ais set-sync --provider <name>     # Switch sync provider
ais status                         # Show sync status
ais doctor                         # Validate environment
ais push                           # One-shot push to sync folder
ais pull                           # One-shot pull from sync folder
ais watch                          # Push on file changes (foreground)
ais daemon:start                   # Start background daemon
ais daemon:stop                    # Stop daemon
ais daemon:status                  # Check daemon status
ais sessions [--limit N]           # List recent sessions
ais resume <id> [--turns N]        # Print LLM resume block
ais handoff <id> [--format] [--turns N] [--include-git]
ais timeline [--session <id>] [--limit N]
ais replay <id> [--speed normal|fast] [--step]
ais export <id> [--out <dir>]
ais share <id> [--out <file>]
ais server                         # Start local API at http://localhost:3900
ais normalize                      # Normalize all sessions into unified model
ais discover all                   # Show detected source paths + providers
ais discover opencode              # Scan for OpenCode data
ais lock <projectKey> [--source]   # Acquire sync lock
ais unlock <projectKey> [--source] # Release sync lock
ais cursor:restore <id> --to <dir> # Restore Cursor DB snapshot
ais opencode:restore <id> --to <path> # Restore OpenCode DB snapshot
```

---

## Provider Setup

`ais setup` detects your OS and auto-finds available providers.

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

Dropbox (`~/Dropbox`) is the most common native option. For anything else, use `custom`:

```bash
ais setup --non-interactive --provider custom --path ~/Sync
```

Switch provider at any time:

```bash
ais set-sync --provider dropbox
ais set-sync --provider custom --path /mnt/gdrive
```

The sync folder layout inside the provider root:

```
SessionSync/
  machines/<machineId>/<source>/<relPath>
  locks/<source>/<projectKey>.lock.json
```

---

## Session Handoff

Generate a paste-ready continuation prompt from any normalized session.

```bash
ais handoff <sessionId>                     # Markdown (default)
ais handoff <sessionId> --format text       # Plain text
ais handoff <sessionId> --format json       # JSON (for scripting)
ais handoff <sessionId> --turns 10          # Inspect last 10 turns (default: 6)
ais handoff <sessionId> --include-git false # Skip git status
```

The handoff block includes:
- What was completed (summary bullets from timeline)
- Last user prompt and assistant response
- Files modified
- Git status (if the project is a git repo)
- Suggested next task

Also available via API:

```bash
curl http://localhost:3900/sessions/<id>/handoff
```

---

## Session Timeline & Replay

```bash
ais timeline                    # Global activity timeline
ais timeline --session <id>     # Timeline for one session
ais timeline --limit 50

ais replay <id>                 # Step through turns interactively
ais replay <id> --speed fast    # No pauses
ais replay <id> --step          # Manual ENTER between steps
```

---

## Export & Share

```bash
ais export <id>                 # Export to ./session-export-<id>/
ais export <id> --out ~/exports

ais share <id>                  # Bundle as session-<id>.ssbundle (tar.gz)
ais share <id> --out ~/Desktop/session.ssbundle
```

Exported directory contains: `transcript.md`, `turns.json`, `timeline.json`, `metadata.json`, `patches/`.

---

## Local API Server

```bash
ais server   # runs at http://localhost:3900
```

Endpoints:

```
GET /sessions
GET /sessions/:id
GET /sessions/:id/timeline
GET /sessions/:id/turns
GET /sessions/:id/files
GET /sessions/:id/handoff
```

The server binds to `127.0.0.1` only and restricts CORS to localhost origins.

---

## Locks

Prevents two machines from pushing conflicting updates to the same project simultaneously.

```bash
ais lock myproject --source claude    # Acquire lock (TTL: 10 min, auto-renewed by daemon)
ais unlock myproject --source claude  # Release lock
```

Locks are stored as JSON files in `<syncRoot>/locks/<source>/<projectKey>.lock.json`. If another machine holds a lock, push is skipped for those files (indexed locally, not lost).

---

## Snapshots & Restore

Cursor and OpenCode SQLite DB files are **never pushed live**. Before any push, a snapshot copy is made:

```
~/.sessionsync/snapshots/<source>/<snapshotId>/<filename>
```

To restore:

```bash
ais cursor:restore <snapshotId> --to ~/Library/Application\ Support/Cursor/User/workspaceStorage/<hash>
ais opencode:restore <snapshotId> --to ~/.opencode/sessions/mydb.sqlite
```

Both commands refuse to run if the target app is still open.

---

## Doctor

```bash
ais doctor
```

Checks and reports:
- OS and Node.js version
- Config file existence and validity
- Sync provider and syncRoot (exists, writable)
- All source paths (exists, readable)
- Lock folder and snapshot folder writability
- Warnings for large DB files (> 50 MB)
- Warning if `~/.openai` is included in config

Returns exit code 1 if any critical check fails.

---

## Config Reference

Located at `~/.sessionsync/config.json`. Created by `ais init`.

```json
{
  "machineId": "<stable-id>",
  "sync": {
    "provider": "icloud",
    "syncRoot": "~/Library/Mobile Documents/com~apple~CloudDocs/SessionSync"
  },
  "include": [
    { "name": "claude",   "path": "~/.claude" },
    { "name": "codex",    "path": "~/.codex" },
    { "name": "opencode", "path": "~/.opencode" },
    { "name": "cursor",   "path": "~/Library/Application Support/Cursor/User/workspaceStorage" }
  ],
  "exclude": [
    "**/Cache/**", "**/*.lock", "**/*.tmp",
    "**/*.temp", "**/*.swp", "**/node_modules/**"
  ],
  "redactFileNamePatterns": [
    "*token*", "*auth*", "*credential*",
    "*api_key*", "*.pem", "*.key", "*.env"
  ],
  "pollIntervalMs": 1500,
  "pullIntervalMs": 30000,
  "lockTtlMs": 600000
}
```

Edit directly to add sources or change paths.

---

## Security

- **`~/.openai` is excluded by default.** Adding it to `include` requires `--i-know-what-im-doing` and triggers a loud warning.
- **Redact patterns** — files matching `*token*`, `*auth*`, `*credential*`, `*api_key*`, `*.pem`, `*.key`, `*.env` are silently skipped at push time and never synced.
- **Cursor/OpenCode DBs** are never pushed live — only read-only snapshots.
- **Config and index DB** are created with `0600` permissions (owner read/write only).
- **Git commands** use `execFileSync` with argument arrays — no shell injection possible.
- **Pulled file paths** are validated to stay within the cache directory — no path traversal from malicious sync folders.
- **Local API** binds to `127.0.0.1` only. CORS is restricted to localhost origins.

---

## Local State

| Path | Purpose |
|------|---------|
| `~/.sessionsync/config.json` | User config (0600) |
| `~/.sessionsync/index.db` | SQLite index — sources, files, sessions (0600) |
| `~/.sessionsync/logs/ais.log` | JSON structured logs (pino) |
| `~/.sessionsync/cache/machines/` | Pulled remote sessions |
| `~/.sessionsync/snapshots/` | Local DB snapshots before push |
| `~/.sessionsync/sessions/` | Normalized unified session model |
| `~/.sessionsync/daemon.pid` | Daemon PID file |

---

## How It Works

### Push

1. Walk all `include` paths, skip `exclude` patterns and `redactFileNamePatterns`
2. For each file: size+mtime quick check, then sha256 hash for files < 5 MB
3. Cursor/OpenCode DB files → snapshot first, push snapshot, skip live file
4. Check lock: if another machine holds the lock for this project, skip
5. Atomic copy: write to `.sstmp` temp file, then rename

### Pull

1. Scan `<syncRoot>/machines/` for other machine IDs
2. For each remote file: check if newer than local cache copy
3. Validate the destination path stays within the cache directory
4. Atomic copy to `~/.sessionsync/cache/machines/<otherId>/<source>/`

### Daemon loop

- Runs `push` on every file change (chokidar watcher, debounced)
- Runs `pull` every `pullIntervalMs` (default 30 s)
- Renews held locks every 60 s

### Session normalization

Raw session files (JSONL, JSON, SQLite) are parsed into a unified model at `~/.sessionsync/sessions/<id>/`:
- `metadata.json` — source, kind, project, timestamps
- `turns.jsonl` — normalized role/content turns (append-only, idempotent)
- `files.json` — file events
- `timeline.json` — ordered activity events

---

## Development

```bash
git clone https://github.com/treadiehq/aisession
cd aisession
npm install
npm run dev -- status    # run without building
npm run build            # compile to dist/
npm test                 # vitest (71 tests)
npm run smoke            # end-to-end smoke test in a temp HOME
```
