#!/usr/bin/env bash
# Demo day: run the pre-flight check, then start the hub (only if nothing critical is missing).
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python scripts/preflight.py
# on stage, quiet large-text / picture-only passengers get a check-in stop after 2 minutes, not 90
export AURALINK_CARE_AFTER_S="${AURALINK_CARE_AFTER_S:-120}"
exec scripts/run.sh
