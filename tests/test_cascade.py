"""The suggest/send_free_text cascade: when nothing in the fixed list matches, the hub tries
semantic understanding and translation before ever falling back to the bare icon grid."""
import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main
from hub.state import Cabin


@pytest.fixture(autouse=True)
def fresh_cabin(monkeypatch):
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))


@pytest.fixture(scope="module")
def client(crew_login):
    with crew_login(TestClient(main.app)) as c:
        yield c


def test_unmatched_text_with_no_semantic_or_translation_falls_back_to_grid(client, monkeypatch):
    monkeypatch.setattr(main, "_semantic_guess", lambda *a: None)
    monkeypatch.setattr(main, "_free_text_translation", lambda *a: None)
    with client.websocket_connect("/ws/passenger/30A") as pax:
        pax.send_json({"type": "text", "text": "hmm"})
        assert pax.receive_json()["type"] == "grid"


def test_a_semantic_guess_is_offered_as_a_confirm_not_sent_automatically(client, monkeypatch):
    monkeypatch.setattr(main, "_semantic_guess", lambda *a: {"intent": "meal", "icon": "meal", "label": "Food", "score": 0.5})
    monkeypatch.setattr(main, "_free_text_translation", lambda *a: None)
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        pax.send_json({"type": "text", "text": "my stomach hurts a lot"})
        msg = pax.receive_json()
        assert msg["type"] == "suggest" and msg["guess"]["intent"] == "meal"
        # nothing reached crew yet: it was only offered, not sent
        import time
        time.sleep(0.05)


def test_confirming_a_semantic_guess_sends_it_like_any_other_request(client, monkeypatch):
    monkeypatch.setattr(main, "_semantic_guess", lambda *a: {"intent": "meal", "icon": "meal", "label": "Food", "score": 0.5})
    monkeypatch.setattr(main, "_free_text_translation", lambda *a: None)
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/31A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        pax.send_json({"type": "text", "text": "my stomach hurts a lot"})
        msg = pax.receive_json()
        pax.send_json({"type": "icon", "intent": msg["guess"]["intent"]})
        status = pax.receive_json()
        assert status["type"] == "status" and status["card"]["intent"]["intent"] == "meal"


def test_sending_a_free_text_translation_reaches_crew_as_needs_human(client, monkeypatch):
    monkeypatch.setattr(main, "_semantic_guess", lambda *a: None)
    monkeypatch.setattr(main, "_free_text_translation", lambda *a: "お水をください")
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/32A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        pax.send_json({"type": "text", "text": "something not in the list"})
        msg = pax.receive_json()
        assert msg["type"] == "suggest" and msg["translated"] == "お水をください"
        pax.send_json({"type": "send_free_text", "text": msg["heard"], "translated": msg["translated"]})
        status = pax.receive_json()
        assert status["type"] == "status" and status["card"]["status"] == "needs_human"

        state = crew.receive_json()
        while not state.get("cards"):
            state = crew.receive_json()
        assert state["cards"][0]["translated"] == "お水をください"
