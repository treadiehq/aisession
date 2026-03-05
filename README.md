# AI Session

**Pick up any AI coding session on any machine, instantly.**

You're deep in a Claude or Codex session on your laptop. You sit down at your desktop. You want to continue, same context, same files, same momentum.

That's what `aisession` does.

---

## What it does

- **Syncs** your local AI session files across machines (Claude, Codex, Cursor, OpenCode)
- **Generates a handoff prompt** you can paste into any LLM to resume exactly where you left off
- **Works with the folder you already have** like iCloud, Dropbox, Google Drive, OneDrive, or any custom folder
- **Runs in the background**, you don't think about it

No accounts. No cloud APIs. No servers. Just files.

---

## Install

```bash
npm install -g aisession
```

Requires Node.js 18+.

---

## Get started

```bash
ss setup        # choose your sync provider (iCloud, Dropbox, etc.)
ss init         # initialize on this machine
ss daemon:start # start syncing in the background
```

On your other machine:

```bash
ss setup        # same provider
ss init
ss daemon:start
```

That's it. Both machines are now in sync.

---

## The handoff

This is the killer feature. When you switch machines:

```bash
ss sessions              # see your recent sessions
ss handoff <sessionId>   # generate a continuation prompt
```

You get something like this, ready to paste into Claude, Codex, or Cursor:

```
## WORK COMPLETED
- Refactored billing service
- Added retry logic

## LAST USER PROMPT
Add retry backoff logic

## LAST ASSISTANT RESPONSE
Here is an exponential backoff implementation...

## NEXT SUGGESTED TASK
Continue implementing: "Add retry backoff logic"
```

Paste it in. Continue immediately.

---

## Supported tools

| Tool | Synced |
|------|--------|
| Claude Code | ✅ |
| OpenAI Codex CLI | ✅ |
| Cursor | ✅ (snapshots) |
| OpenCode | ✅ |

Works on macOS, Windows, and Linux.

---

## More

- [Detailed docs](DETAILS.md) — all commands, config, security, architecture
- [GitHub](https://github.com/treadiehq/aisession)
- [npm](https://www.npmjs.com/package/aisession)

---

## License

[FSL-1.1-MIT](LICENSE)
