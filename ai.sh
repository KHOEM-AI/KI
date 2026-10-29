#!/usr/bin/env bash
# KI: thin wrapper. The KI API (:8790) is started by the KHOEM_AI launcher.
# This starts the API only; the AI app (:8787/:5175) is not touched.
# Usage: ./ai.sh [run|stop|restart]
set -u
LAUNCHER="${KHOEM_LAUNCHER:-$HOME/KHOEM_AI/KHOEM_AI/ai.sh}"
if [ ! -f "$LAUNCHER" ]; then
  echo "Launcher not found: $LAUNCHER (set KHOEM_LAUNCHER to override)" >&2
  exit 1
fi
# A folder that does not exist makes the launcher skip the AI app ("API only").
export AI_DIR="${KI_AI_DIR:-$HOME/.ki-no-ai-app}"
exec bash "$LAUNCHER" "$@"
