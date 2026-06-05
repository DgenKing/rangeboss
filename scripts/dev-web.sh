#!/usr/bin/env bash
# Start the dashboard cleanly on port 3000 — every single time.
#
# Kills any stale Next dev server, force-frees ports 3000-3002 (retrying until
# they're actually free), wipes the .next build cache, then starts pinned to
# 3000. This stops the two recurring annoyances:
#   - "port 3000 in use, trying 3001" drift from a zombie dev server
#   - "Cannot find module './NNN.js'" / unstyled page from a stale .next

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[web] cleaning stale dev servers ..."
# Pattern lives in this file, not on the launching shell's command line, so it
# can't match (and kill) itself.
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -x "next-server" 2>/dev/null || true

# Force-free a port: kill whatever holds it, retry until it's actually free.
free_port() {
  port="$1"
  for _ in $(seq 1 15); do
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -z "$pids" ]; then return 0; fi
    kill -9 $pids 2>/dev/null || true
    sleep 0.2
  done
  return 1
}

for p in 3000 3001 3002; do
  free_port "$p" || echo "[web] WARNING: port $p still busy after retries"
done

# Wipe the build cache so dev never starts against stale/prod artifacts.
rm -rf "$ROOT/packages/web/.next"

echo "[web] starting dev server on http://localhost:3000 ..."
cd "$ROOT/packages/web"
exec bun run dev
