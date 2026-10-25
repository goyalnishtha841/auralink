"""Crash recovery: the cabin state is saved after every change and restored when the hub starts.

A hub restart mid-flight (or mid-demo) keeps every request, briefing answer, exit-row check and the
flight report. Saved atomically (write a temp file, then rename) so a crash cannot leave half a file.
Stored next to check-ins in data/flight/ (git-ignored). Seat and preference data only, no names.
"""
from __future__ import annotations

import itertools
import json
import os
import re
import time
from pathlib import Path

from .state import Broadcast, Cabin, Card, ExitCheck, Feedback, LostItem

SEAT_FIELDS = {"lang", "senior", "pictures", "read", "checked_in"}


def path() -> Path:
    from .checkin import path as checkin_path
    return checkin_path().with_name("cabin_state.json")


def snapshot(cabin: Cabin) -> dict:
    return {
        "saved_at": time.time(),
        "phase": cabin.phase,
        "seats": {sid: s.model_dump(include=SEAT_FIELDS) for sid, s in cabin.seats.items()
                  if s.lang != "en" or s.senior or s.pictures or s.read or s.checked_in},
        "cards": [c.model_dump() for c in cabin.cards.values()],
        "broadcast": cabin.broadcast.model_dump() if cabin.broadcast else None,
        "past_broadcasts": [b.model_dump() for b in cabin.past_broadcasts],
        "exit_checks": [e.model_dump() for e in cabin.exit_checks.values()],
        "lost_items": [i.model_dump() for i in cabin.lost_items.values()],
        "feedback": [f.model_dump() for f in cabin.feedback.values()],
        "pa_log": cabin.pa_log,
        "round": cabin.round,
        "past_rounds": cabin.past_rounds,
        "last_visit": cabin.last_visit,
        "started_at": cabin.started_at,
    }


def save(cabin: Cabin) -> None:
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot(cabin), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)   # atomic on the same disk


def restore(cabin: Cabin) -> float | None:
    """Load the saved state into `cabin`. Returns when it was saved, or None if nothing was restored."""
    p = path()
    if not p.exists() or os.environ.get("AURALINK_FRESH") == "1":
        return None
    data = json.loads(p.read_text("utf-8"))
    cabin.phase = data.get("phase", cabin.phase)
    for sid, prefs in data.get("seats", {}).items():
        if sid in cabin.seats:
            cabin.seats[sid] = cabin.seats[sid].model_copy(update=prefs)
    cabin.cards = {c["id"]: Card(**c) for c in data.get("cards", [])}
    cabin.broadcast = Broadcast(**data["broadcast"]) if data.get("broadcast") else None
    cabin.past_broadcasts = [Broadcast(**b) for b in data.get("past_broadcasts", [])]
    cabin.exit_checks = {e["seat"]: ExitCheck(**e) for e in data.get("exit_checks", [])}
    cabin.lost_items = {i["id"]: LostItem(**i) for i in data.get("lost_items", [])}
    cabin.feedback = {f["id"]: Feedback(**f) for f in data.get("feedback", [])}
    cabin.pa_log = data.get("pa_log", [])
    cabin.round = data.get("round")
    cabin.past_rounds = data.get("past_rounds", [])
    cabin.last_visit = data.get("last_visit", {})
    cabin.started_at = data.get("started_at", cabin.started_at)
    # new ids must continue after the restored ones (c12 -> next card is c13)
    used = [int(m.group()) for key in list(cabin.cards) + [b.id for b in cabin.all_broadcasts()]
            + [a["pa_id"] for a in cabin.pa_log] + [r["id"] for r in cabin.past_rounds + [cabin.round] if r]
            + list(cabin.lost_items) + list(cabin.feedback)
            if (m := re.search(r"\d+", key))]
    cabin._ids = itertools.count(max(used, default=0) + 1)
    return data.get("saved_at")
