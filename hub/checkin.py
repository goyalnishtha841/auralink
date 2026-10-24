"""Check-in preferences (JAL journey stage 1, the airport): language and modes chosen before boarding.

Stored per seat only, no names, in data/flight/checkin.json (git-ignored) so they survive a hub restart.
In a real deployment this would come from the airline's passenger list at check-in.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from engine.lexicon import ROOT

FIELDS = ("lang", "senior", "pictures", "read", "accessibility")


def path() -> Path:
    return Path(os.environ.get("AURALINK_FLIGHT_DIR", ROOT / "data" / "flight")) / "checkin.json"


def load() -> dict[str, dict]:
    p = path()
    return json.loads(p.read_text("utf-8")) if p.exists() else {}


def save(prefs: dict[str, dict]) -> None:
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(prefs, ensure_ascii=False, indent=1), encoding="utf-8")
