#!/usr/bin/env bash
# Serve the game locally. Usage: ./serve.sh [port]
set -e
PORT="${1:-8181}"
cd "$(dirname "$0")"
echo "Chicken Cross → http://localhost:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
