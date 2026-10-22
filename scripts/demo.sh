#!/usr/bin/env bash
# Demo day: run the pre-flight check, then start the hub (only if nothing critical is missing).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_port.sh          # first free port from 8000; run.sh keeps the same one
.venv/bin/python scripts/preflight.py
# on stage, quiet large-text / picture-only passengers get a check-in stop after 2 minutes, not 90
export AURALINK_CARE_AFTER_S="${AURALINK_CARE_AFTER_S:-120}"
# crew tablet, presenter, report and Under the hood ask for this PIN once per device (hub/auth.py)
export AURALINK_CREW_PIN="${AURALINK_CREW_PIN:-$(.venv/bin/python -c 'import secrets; print(f"{secrets.randbelow(10**6):06d}")')}"
echo "Crew PIN / 乗務員PIN: $AURALINK_CREW_PIN"
exec scripts/run.sh
