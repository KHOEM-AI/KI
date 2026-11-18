#!/usr/bin/env bash
# KI: thin wrapper. The real launcher lives in KSV (single source of truth).
# It starts the KI API on :5001 (start_ki) together with the other services.
# KI alone (no other service):  PORT=5001 node src/server.mjs
# Usage: ./ai.sh [run|stop|restart|status]
set -u
LAUNCHER="${KSV_LAUNCHER:-$HOME/KSV/ai.sh}"
if [ ! -f "$LAUNCHER" ]; then
  echo "Launcher not found: $LAUNCHER (set KSV_LAUNCHER to override)" >&2
  exit 1
fi
exec bash "$LAUNCHER" "$@"
