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


def test_assist_asks_before_filing_never_files_on_its_own(monkeypatch):
    """engine/assist.py must only ever pop a "did you mean...?" confirm -- the same one Free Talk
    already shows for typed text -- never create a request card by itself (see hub/main.py
    maybe_auto_file_from_conv). A passenger's live-call line is not a tap, so it must not act like one."""
    import asyncio

    monkeypatch.setattr(main.assist, "available", lambda: True)
    monkeypatch.setattr(main.assist, "classify", lambda text, ids: "blanket")
    sent = []
    monkeypatch.setattr(main, "to_seat", lambda seat, msg: sent.append((seat, msg)) or _noop())
    main._conv_suggested.clear()

    asyncio.run(main.maybe_auto_file_from_conv("30A", "Can I get a blanket please", "en"))

    assert len(sent) == 1 and sent[0][0] == "30A"
    assert sent[0][1]["type"] == "suggest" and sent[0][1]["guess"]["intent"] == "blanket"
    assert not main.cabin.cards, "a suggestion must never file a card by itself"


def test_confirming_the_suggestion_files_a_normal_request(client):
    """The popup's "yes" button sends exactly {type: "icon", intent}: the same message a tap on
    the picture grid sends, so confirming a Live Conversation suggestion is indistinguishable
    from any other confirmed request once the passenger has actually said yes to it."""
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/30A") as pax:
        while crew.receive_json()["type"] != "state":
            pass
        pax.send_json({"type": "hello", "lang": "en"})
        pax.send_json({"type": "icon", "intent": "blanket"})
        state = crew.receive_json()
        while not state.get("cards"):
            state = crew.receive_json()
        assert state["cards"][0]["seat"] == "30A" and state["cards"][0]["intent"] == "blanket"


def test_a_second_suggestion_for_the_same_intent_is_suppressed_for_a_while(monkeypatch):
    import asyncio

    monkeypatch.setattr(main.assist, "available", lambda: True)
    monkeypatch.setattr(main.assist, "classify", lambda text, ids: "water")
    sent = []
    monkeypatch.setattr(main, "to_seat", lambda seat, msg: sent.append(msg) or _noop())
    main._conv_suggested.clear()

    asyncio.run(main.maybe_auto_file_from_conv("30A", "I need some water", "en"))
    asyncio.run(main.maybe_auto_file_from_conv("30A", "water please", "en"))

    assert len(sent) == 1, "the same intent came up twice in one chat -- only the first should pop a confirm"


async def _noop():
    return None


def test_crew_listening_flag_reflects_whether_a_tablet_is_actually_connected(client, monkeypatch):
    """app/passenger/page.jsx only speaks the passenger's own line out loud (in Japanese) when
    this is False -- real two-device use already has crew's own tablet speak that side, so a
    real passenger's phone shouldn't also narrate Japanese at them after every sentence."""
    import asyncio

    sent = []
    monkeypatch.setattr(main, "to_seat", lambda seat, msg: sent.append(msg) or _noop())

    monkeypatch.setattr(main, "crew", set())
    asyncio.run(main.handle_conv_text("30A", "passenger", "hi"))
    assert sent and all(m["crew_listening"] is False for m in sent)

    with client.websocket_connect("/ws/crew"):
        sent.clear()
        asyncio.run(main.handle_conv_text("30A", "passenger", "hi"))
        assert sent and all(m["crew_listening"] is True for m in sent)
