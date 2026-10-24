#!/usr/bin/env bash
# Start the cabin hub. Uses HTTPS automatically when certs/ exists (needed for the phone microphone).
set -euo pipefail
cd "$(dirname "$0")/.."
# settings from .env (copy .env.example): exported, but anything already set in the shell wins
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    if [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ && -n "$value" && -z "${!key:-}" ]]; then export "$key=$value"; fi
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env | sed 's/[[:space:]]*#.*$//')
fi
HOST="${HOST:-0.0.0.0}"
source scripts/_port.sh
export AURALINK_PRELOAD_ASR="${AURALINK_PRELOAD_ASR:-1}"   # load Whisper at startup, not on the first request
ARGS=(hub.main:app --host "$HOST" --port "$PORT" --reload)
if [[ -f certs/hub.pem && -f certs/hub-key.pem ]]; then
  ARGS+=(--ssl-certfile certs/hub.pem --ssl-keyfile certs/hub-key.pem)
fi
SCHEME=http; [[ -f certs/hub.pem ]] && SCHEME=https
echo "Auralink: open ${SCHEME}://localhost:${PORT}/start.html on this laptop"
exec .venv/bin/uvicorn "${ARGS[@]}"
