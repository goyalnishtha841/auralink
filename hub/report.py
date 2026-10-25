"""Flight report: how communication went, from the cabin's own records (since the last cabin reset).

Measures the deck's success metrics that only a live flight can show: time to acknowledge,
recovery rate (unclear requests the passenger resolved without crew guesswork), and safety
comprehension per briefing step.
"""
from __future__ import annotations

import csv
import io
import statistics
import time

from .rounds import GALLEY_ROW
from .state import Cabin, Card


def outcome(card: Card) -> str:
    """One label per request, from the passenger's side."""
    t = card.timeline
    if "needs_human" in t:
        return "needs_human"            # Auralink failed twice; crew got the best guesses
    if card.source == "picture":
        return "picture"                # tapped a picture directly
    if "confirmed" not in t:
        return "urgent_unconfirmed" if card.urgent else "unanswered"
    if card.rounds:
        return "via_grid"               # said No, then picked from the picture grid
    return "first_try" if card.confident else "picked_from_two"


def seconds(card: Card, status: str) -> float | None:
    if status in card.timeline:
        return round(card.timeline[status] - card.timeline["created"], 1)
    return None


def summary(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "median": None, "p90": None, "max": None}
    ordered = sorted(values)
    return {"n": len(values), "median": round(statistics.median(ordered), 1),
            "p90": round(ordered[max(0, int(0.9 * len(ordered)) - 1)], 1), "max": round(ordered[-1], 1)}


def pa_report(cabin: Cabin, library) -> dict:
    """Announcements captioned on the seats: which, when, and how many seats and languages got them."""
    items = []
    for a in cabin.pa_log:
        item = library.items.get(a["id"]) if library else None
        items.append({"at": a["at"], "id": a["id"], "n": a.get("n"),
                      "title_en": item["title"]["en"] if item else a["id"], "title_ja": item["title"]["ja"] if item else "",
                      "seats": a.get("seats"), "langs": a.get("langs", [])})
    return {"count": len(items), "items": items,
            "languages": sorted({code for i in items for code in i["langs"]})}


def rounds_report(cabin: Cabin) -> dict:
    """Care rounds: requests delivered in one trip, check-in stops, and walking saved (in rows, an estimate)."""
    done = [r for r in cabin.past_rounds + ([cabin.round] if cabin.round else [])]
    stops = [st for r in done for st in r["stops"]]
    separate = loop = 0
    for r in done:
        rows = [int(st["seat"][:-1]) for st in r["stops"]]
        separate += sum(2 * (int(st["seat"][:-1]) - GALLEY_ROW) * len(st["cards"]) for st in r["stops"])
        loop += 2 * (max(rows, default=GALLEY_ROW) - GALLEY_ROW)
    minutes = [round((r["ended_at"] - r["started_at"]) / 60, 1) for r in done if r.get("ended_at")]
    return {
        "count": len(done),
        "in_progress": cabin.round is not None,
        "stops": len(stops),
        "requests_delivered": sum(len(st["cards"]) for st in stops if st.get("done")),
        "check_ins": sum(1 for st in stops if st.get("care")),
        "check_ins_done": sum(1 for st in stops if st.get("care") and st.get("done")),
        "minutes": summary(minutes),
        "walk_rows": {"separate": separate, "rounds": loop,
                      "saved": round(1 - loop / separate, 3) if separate else None},
    }


def feedback_report(cabin: Cabin) -> dict:
    """Post-flight feedback: how many, what kind, and the average star rating where given."""
    items = list(cabin.feedback.values())
    rated = [f.rating for f in items if f.rating is not None]
    return {
        "total": len(items),
        "by_category": {k: sum(1 for f in items if f.category == k)
                        for k in ("inconvenience", "improvement", "compliment")},
        "average_rating": round(sum(rated) / len(rated), 2) if rated else None,
    }


def lost_items_report(cabin: Cabin) -> dict:
    items = list(cabin.lost_items.values())
    return {
        "total": len(items),
        "by_status": {k: sum(1 for i in items if i.status == k) for k in ("reported", "found", "returned")},
    }


def build(cabin: Cabin, templates, pa_library=None) -> dict:
    cards = list(cabin.cards.values())
    outcomes = {c.id: outcome(c) for c in cards}
    count = lambda key: {k: sum(1 for c in cards if key(c) == k) for k in sorted({key(c) for c in cards})}  # noqa: E731

    unclear = [c for c in cards if c.source != "picture" and (not c.confident or c.rounds or outcomes[c.id] == "needs_human")]
    resolved = [c for c in unclear if outcomes[c.id] in ("picked_from_two", "via_grid")]
    urgent = [c for c in cards if c.urgent]

    briefings = []
    connected = sum(1 for s in cabin.seats.values() if s.connected)
    for b in cabin.all_broadcasts():
        t = templates.safety.get(b.template_id, {})
        steps = t.get("steps", [])
        states = [a.status for a in b.responses.values()]
        stuck_steps: dict[int, int] = {}
        for a in b.responses.values():
            if a.status == "stuck" and a.step is not None:
                stuck_steps[a.step] = stuck_steps.get(a.step, 0) + 1
        briefings.append({
            "id": b.id, "template_id": b.template_id,
            "title_en": t.get("title", {}).get("en", b.template_id), "title_ja": t.get("title", {}).get("ja", ""),
            "sent_at": b.sent_at,
            "understood": states.count("understood"),
            "understood_again": states.count("understood_again"),
            "reexplaining": states.count("reexplaining"),
            "stuck": states.count("stuck"),
            "no_answer": max(0, connected - len(states)) if b is cabin.broadcast else None,
            "stuck_by_step": [{"step": n + 1, "en": steps[n]["simple"]["en"] if n < len(steps) else "", "seats": k}
                              for n, k in sorted(stuck_steps.items())],
        })

    exits = list(cabin.exit_checks.values())
    return {
        "generated_at": time.time(),
        "requests": {
            "total": len(cards),
            "outcomes": {k: sum(1 for v in outcomes.values() if v == k) for k in
                         ("first_try", "picked_from_two", "via_grid", "picture", "needs_human", "urgent_unconfirmed", "unanswered")},
            "by_intent": count(lambda c: c.intent or (c.candidates[0].intent if c.candidates else "unknown")),
            "by_language": count(lambda c: c.lang),
            "by_source": count(lambda c: c.source),
            "time_to_acknowledge_s": summary([v for c in cards if (v := seconds(c, "acknowledged")) is not None]),
            "time_to_done_s": summary([v for c in cards if (v := seconds(c, "closed")) is not None]),
            "recovery": {"unclear": len(unclear), "resolved_by_passenger": len(resolved),
                         "rate": round(len(resolved) / len(unclear), 3) if unclear else None},
            "urgent": {"count": len(urgent),
                       "time_to_acknowledge_s": summary([v for c in urgent if (v := seconds(c, "acknowledged")) is not None])},
        },
        "briefings": briefings,
        "announcements": pa_report(cabin, pa_library),
        "care_rounds": rounds_report(cabin),
        "feedback": feedback_report(cabin),
        "lost_items": lost_items_report(cabin),
        "exit_row": {"checked": len(exits), "pass": sum(e.result == "pass" for e in exits),
                     "talk": sum(e.result == "talk" for e in exits), "pending": sum(e.result == "pending" for e in exits),
                     "talk_seats": [{"seat": e.seat, "reseat": e.reseat,
                                     "no_to": [q for q, ok in e.answers.items() if not ok]} for e in exits if e.result == "talk"]},
    }


def to_csv(cabin: Cabin) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["request", "seat", "language", "asked_by", "request_type", "urgent", "outcome", "clarification_rounds",
                "created_utc", "seconds_to_acknowledge", "seconds_to_done", "symptom", "heard"])
    for c in sorted(cabin.cards.values(), key=lambda c: c.created_at):
        w.writerow([c.id, c.seat, c.lang, c.source, c.intent or (c.candidates[0].intent if c.candidates else ""),
                    c.urgent, outcome(c), c.rounds, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(c.created_at)),
                    seconds(c, "acknowledged") or "", seconds(c, "closed") or "", c.symptom or "", c.heard])
    return out.getvalue()
