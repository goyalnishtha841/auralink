#!/usr/bin/env bash
# Start the cabin hub. Uses HTTPS automatically when certs/ exists (needed for the phone microphone).
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
export AURALINK_PRELOAD_ASR="${AURALINK_PRELOAD_ASR:-1}"   # load Whisper at startup, not on the first request
ARGS=(hub.main:app --host "$HOST" --port "$PORT" --reload)
if [[ -f certs/hub.pem && -f certs/hub-key.pem ]]; then
  ARGS+=(--ssl-certfile certs/hub.pem --ssl-keyfile certs/hub-key.pem)
fi
exec .venv/bin/uvicorn "${ARGS[@]}"
