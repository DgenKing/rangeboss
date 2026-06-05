#!/usr/bin/env bash
# Start the dashboard cleanly: kill any stale Next dev server(s) and wipe the
# .next build cache first. This prevents the "Cannot find module './NNN.js'"
# breakage caused by stacked/zombie dev servers or a dev/prod .next mismatch.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[web] cleaning stale dev servers and .next ..."

# Kill the dev-server parent (next dev) and its worker. The pattern lives in
# this file, not on the launching shell's command line, so it can't self-kill.
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -x "next-server" 2>/dev/null || true

# Free the dev ports in case anything is still holding them.
for port in 3000 3001 3002; do
  pid="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pid" ]; then kill -9 $pid 2>/dev/null || true; fi
done

# Wipe the build cache so dev never starts against stale/prod artifacts.
rm -rf "$ROOT/packages/web/.next"

echo "[web] starting dev server on http://localhost:3000 ..."
cd "$ROOT/packages/web"
exec bun run dev
