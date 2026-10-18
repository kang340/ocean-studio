#!/usr/bin/env sh
# Build the web page (first run only) and start Ocean Studio on http://127.0.0.1:8000
set -e
cd "$(dirname "$0")"
if [ ! -d web/dist ]; then (cd web && npm ci && npm run build); fi
exec python server/app.py "$@"
