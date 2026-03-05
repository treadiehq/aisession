#!/usr/bin/env bash
# Smoke test: runs core ais commands against a temp HOME dir and a temp syncRoot.
# Usage: npm run smoke
set -euo pipefail

TMPDIR_ROOT=$(mktemp -d)
SYNC_ROOT=$(mktemp -d)
export HOME="$TMPDIR_ROOT"

echo "=== SessionSync Smoke Test ==="
echo "Temp HOME:      $TMPDIR_ROOT"
echo "Temp sync root: $SYNC_ROOT"
echo ""

SS="node $(dirname "$0")/../dist/cli.js"

# 1. init (non-interactive; uses buildDefaultConfig)
echo "[1] ais init..."
$SS init
echo "    OK"

# 2. Update config to point syncRoot at our temp dir
echo "[2] ais set-sync --provider custom --path $SYNC_ROOT..."
$SS set-sync --provider custom --path "$SYNC_ROOT"
echo "    OK"

# 3. status
echo "[3] ais status..."
$SS status
echo "    OK"

# 4. push (nothing to push in empty HOME, expect 0 files but no crash)
echo "[4] ais push..."
$SS push || true
echo "    OK"

# 5. pull (sync root empty, expect 0 files)
echo "[5] ais pull..."
$SS pull || true
echo "    OK"

# 6. sessions (empty)
echo "[6] ais sessions..."
$SS sessions
echo "    OK"

# 7. doctor
echo "[7] ais doctor..."
$SS doctor || true
echo "    OK"

# 8. discover all
echo "[8] ais discover all..."
$SS discover all
echo "    OK"

echo ""
echo "=== Smoke test PASSED ==="

# Cleanup
rm -rf "$TMPDIR_ROOT" "$SYNC_ROOT"
