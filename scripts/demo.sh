#!/usr/bin/env bash
# Demo day: run the pre-flight check, then start the hub (only if nothing critical is missing).
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python scripts/preflight.py
exec scripts/run.sh
