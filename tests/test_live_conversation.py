"""Live Conversation: conv_start/conv_text/conv_reply over the real WebSockets, with
engine.translate.translate_stream mocked so these tests are fast and don't need the NLLB model."""
import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main
from hub.state import Cabin


@pytest.fixture(autouse=True)
def fresh_cabin(monkeypatch):
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))


@pytest.fixture(autouse=True)
def fake_translate_stream(monkeypatch):
    def fake(text, src, tgt):
        word = {"ja": "こんにちは", "en": "hello", "hi": "नमस्ते"}.get(tgt, text)
        yield word[:3]
        yield word
    monkeypatch.setattr("engine.translate.translate_stream", fake)


@pytest.fixture(scope="module")
def client(crew_login):
    with crew_login(TestClient(main.app)) as c:
        yield c


def collect_conv_messages(ws, mid=None, until_done=True):
    out = []
    while True:
        msg = ws.receive_json()
        if msg.get("type") != "conv_message":
            continue
        if mid is not None and msg["id"] != mid:
            continue
        out.append(msg)
        if not until_done or msg["done"]:
            return out


def test_a_reconnecting_crew_socket_still_sees_an_open_conversation(client):
    with client.websocket_connect("/ws/passenger/30A") as pax:
        pax.send_json({"type": "conv_start"})
        with client.websocket_connect("/ws/crew") as crew:
            state = crew.receive_json()
            assert state["type"] == "state" and "30A" in state["conv_seats"]
        pax.send_json({"type": "conv_end"})
        with client.websocket_connect("/ws/crew") as crew:
            state = crew.receive_json()
            assert "30A" not in state["conv_seats"]


def test_conv_start_tells_crew_the_panel_is_open(client):
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":  # crew's own connect
            pass
        crew.receive_json()  # "state": passenger connecting also pushes one
        pax.send_json({"type": "conv_start"})
        msg = crew.receive_json()
        assert msg == {"type": "conv_state", "seat": "30A", "open": True}


def test_crew_typed_message_streams_translated_to_the_passenger(client):
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        crew.send_json({"type": "conv_text", "seat": "30A", "text": "お水をお持ちしました"})
        msgs = collect_conv_messages(pax)
        assert msgs[-1]["from"] == "crew"
        assert msgs[-1]["original"] == "お水をお持ちしました"
        assert msgs[-1]["translated"] == "hello"   # from the fake translator, tgt=passenger's lang (en)
        assert len(msgs) >= 2   # at least one partial before the final


def test_the_same_message_also_reaches_crew_so_both_sides_see_the_thread(client):
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        crew.send_json({"type": "conv_text", "seat": "30A", "text": "hi"})
        collect_conv_messages(pax)
        msgs = collect_conv_messages(crew)
        assert msgs[-1]["seat"] == "30A" and msgs[-1]["done"]


def test_empty_text_sends_nothing(client):
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        crew.send_json({"type": "conv_text", "seat": "30A", "text": "   "})
        pax.send_json({"type": "hello", "lang": "en"})   # something harmless to desync on, if a message did arrive
        # no conv_message should have been queued ahead of anything else; nothing to receive here
        # is implicitly checked by the other tests' message ordering, so just confirm the socket
        # is still alive and accepts further messages
        crew.send_json({"type": "conv_text", "seat": "30A", "text": "real message"})
        msgs = collect_conv_messages(pax)
        assert msgs[-1]["original"] == "real message"
