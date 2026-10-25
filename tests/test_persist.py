"""Crash recovery: a restarted hub gets the cabin back."""
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main, persist
from hub.state import Cabin


def test_round_trip_and_ids_continue(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    before = Cabin(Lexicon())
    before.seats["34K"].lang = "hi"
    _, (card,), _ = before.handle_text("34K", "water please")
    before.confirm(card.id, "water")
    before.start_broadcast("turbulence")
    before.safety_response("34K", "stuck", step=1)
    before.start_exit_check(["30A"])
    lost = before.report_lost_item("34K", "a grey water bottle")
    before.add_feedback("34K", "compliment", 5, "great flight")
    persist.save(before)

    after = Cabin(Lexicon())                       # a fresh hub after a crash
    assert persist.restore(after) is not None
    assert after.cards[card.id].status == "confirmed" and after.cards[card.id].intent == "water"
    assert after.broadcast.responses["34K"].step == 1 and "30A" in after.exit_checks
    assert after.lost_items[lost.id].description == "a grey water bottle"
    assert [f.message for f in after.feedback.values()] == ["great flight"]
    assert after.seats["34K"].lang == "hi" and after.seats["34K"].connected is False
    _, (fresh,), _ = after.handle_text("34K", "blanket")
    assert fresh.id != card.id                     # new ids do not clash with restored ones


def test_fresh_start_ignores_saved_state(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    c = Cabin(Lexicon())
    c.handle_text("31C", "tea")
    persist.save(c)
    monkeypatch.setenv("AURALINK_FRESH", "1")
    assert persist.restore(Cabin(Lexicon())) is None


def test_hub_saves_after_each_change(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))
    with TestClient(main.app).websocket_connect("/ws/passenger/33H") as pax:
        pax.send_json({"type": "icon", "intent": "pillow"})
        pax.receive_json()
    restored = Cabin(Lexicon())
    persist.restore(restored)
    assert [c.intent for c in restored.cards.values()] == ["pillow"]
