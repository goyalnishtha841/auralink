"""Care rounds: one trolley trip instead of one walk per request, plus proactive check-ins.

The crew tablet always shows a planned round:
  - every open, non-urgent request for something the crew bring (water, tea, blanket ...),
  - plus "care stops": passengers who use large text or pictures only and have not asked for
    anything (and not been visited) for a while. Older or deaf passengers often do not ask.
Stops are ordered as one loop from the front galley: down the left aisle, back up the right one.
The trolley load list counts what to bring. Starting the round tells each waiting passenger
where they are in the queue ("stop 3 of 7"), in their own language.

Urgent and medical requests are never put in a round: they stay at the top of the crew screen.
"""
from __future__ import annotations

import os
import time

from .state import Cabin

DELIVER = {"water", "tea", "blanket", "pillow", "meal"}   # things the crew carry on a trolley
GALLEY_ROW = 29                                          # front galley, just ahead of row 30
LEFT_AISLE = set("ABCDE")                                # 3-3-3: A-C window block + D-E of the middle


def care_after_s() -> float:
    """How long a vulnerable passenger may go without contact before a check-in stop (default 90 min)."""
    return float(os.environ.get("AURALINK_CARE_AFTER_S", 90 * 60))


def _route_key(seat: str) -> tuple:
    row, letter = int(seat[:-1]), seat[-1]
    if letter in LEFT_AISLE:
        return (0, row, letter)            # down the left aisle, front to back
    return (1, -row, letter)               # back up the right aisle


def plan(cabin: Cabin, now: float | None = None) -> dict:
    now = now or time.time()
    stops: dict[str, dict] = {}
    for c in cabin.crew_cards():
        if c.urgent or c.intent not in DELIVER or c.round_id:
            continue
        stop = stops.setdefault(c.seat, {"seat": c.seat, "cards": [], "items": [], "care": None})
        stop["cards"].append(c.id)
        stop["items"].append(c.intent)

    last_contact: dict[str, float] = dict(cabin.last_visit)
    for c in cabin.cards.values():
        last_contact[c.seat] = max(last_contact.get(c.seat, 0.0), c.created_at)
    for s in cabin.seats.values():
        if not (s.senior or s.pictures or s.accessibility) or not (s.connected or s.checked_in):
            continue
        quiet_for = now - max(last_contact.get(s.id, 0.0), cabin.started_at)
        if quiet_for >= care_after_s() and s.id not in cabin.round_seats():
            stop = stops.setdefault(s.id, {"seat": s.id, "cards": [], "items": [], "care": None})
            stop["care"] = {"minutes": int(quiet_for // 60), "senior": s.senior, "pictures": s.pictures,
                            "accessibility": s.accessibility, "lang": s.lang}

    ordered = sorted(stops.values(), key=lambda st: _route_key(st["seat"]))
    load: dict[str, int] = {}
    for st in ordered:
        for i in st["items"]:
            load[i] = load.get(i, 0) + 1
    # walking, in rows: one return trip from the galley per request vs. one loop for the round
    requests = sum(len(st["cards"]) for st in ordered)
    separate = sum(2 * (int(st["seat"][:-1]) - GALLEY_ROW) * len(st["cards"]) for st in ordered)
    loop = 2 * (max((int(st["seat"][:-1]) for st in ordered), default=GALLEY_ROW) - GALLEY_ROW)
    return {
        "stops": ordered,
        "load": load,
        "requests": requests,
        "care_stops": sum(1 for st in ordered if st["care"]),
        "walk_rows": {"separate": separate, "round": loop if ordered else 0},
    }
