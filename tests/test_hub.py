"""End-to-end through the real WebSockets: passenger -> hub -> crew."""
import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main
from hub.state import Cabin


@pytest.fixture(autouse=True)
def fresh_cabin(monkeypatch):
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))


client = TestClient(main.app)


def crew_state(crew):
    while True:
        msg = crew.receive_json()
        if msg["type"] == "state":
            return msg


def test_split_request_reaches_crew_after_confirm():
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/34K") as pax:
        crew_state(crew)
        pax.send_json({"type": "hello", "lang": "hi"})
        pax.send_json({"type": "text", "text": "thoda wotter and kambal"})
        msg = pax.receive_json()
        assert msg["type"] == "confirm" and msg["rule"] == "split"
        water, blanket = msg["cards"]
        assert water["options"][0]["label"] == "पानी"

        pax.send_json({"type": "confirm", "card_id": water["id"], "intent": "water"})
        status = pax.receive_json()
        assert status["type"] == "status" and status["message"] == "क्रू को भेज दिया गया"

        state = crew_state(crew)
        while not state["cards"]:
            state = crew_state(crew)
        assert [c["intent"] for c in state["cards"]] == ["water"]
        assert state["cards"][0]["crew_ja"] == "お水をご希望です"

        crew.send_json({"type": "reply", "card_id": water["id"], "reply_id": "coming"})
        reply = pax.receive_json()
        assert reply == {"type": "reply", "card_id": water["id"], "text": "अभी लेकर आ रहे हैं।"}


def test_two_failed_rounds_escalate_to_needs_human():
    with client.websocket_connect("/ws/passenger/30A") as pax:
        pax.send_json({"type": "text", "text": "hmm"})
        assert pax.receive_json()["type"] == "grid"
        pax.send_json({"type": "text", "text": "uh"})
        msg = pax.receive_json()
        assert msg["type"] == "status" and msg["card"]["status"] == "needs_human"


def test_safety_heatmap():
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/31C") as pax:
        crew.send_json({"type": "broadcast", "template_id": "turbulence"})
        safety = pax.receive_json()
        assert safety["type"] == "safety"
        assert [st["pictogram"] for st in safety["template"]["steps"]] == ["return_seat", "seatbelt", "toilet_closed"]
        pax.send_json({"type": "safety", "status": "reexplaining"})
        pax.send_json({"type": "safety", "status": "stuck", "step": 1})
        state = crew_state(crew)
        while state["heatmap"]["31C"] != "stuck":
            state = crew_state(crew)
        assert state["broadcast"]["detail"]["31C"]["step"] == 1
        assert state["heatmap"]["30A"] == "offline"


def test_bad_card_id_does_not_drop_socket():
    with client.websocket_connect("/ws/passenger/32D") as pax:
        pax.send_json({"type": "confirm", "card_id": "nope", "intent": "water"})
        assert pax.receive_json()["type"] == "error"
        pax.send_json({"type": "text", "text": "blanket"})
        assert pax.receive_json()["type"] == "confirm"


def _clip_pcm(name: str) -> bytes:
    import wave
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "data" / "recordings" / "synthetic" / f"{name}.wav"
    if not path.exists():
        pytest.skip("run scripts/asr_spike.py once to generate the synthetic clips")
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes())


def test_voice_request_end_to_end():
    pytest.importorskip("faster_whisper")
    with client.websocket_connect("/ws/passenger/33H") as pax:
        pax.send_bytes(_clip_pcm("rishi_water_blanket"))  # "Madam, thoda wotter and kambal please"
        assert pax.receive_json()["type"] == "thinking"
        msg = pax.receive_json()
        assert msg["type"] == "confirm"
        assert [c["options"][0]["intent"] for c in msg["cards"]] == ["water", "blanket"]


def test_silence_goes_to_icon_grid():
    pytest.importorskip("faster_whisper")
    with client.websocket_connect("/ws/passenger/33J") as pax:
        pax.send_bytes(bytes(16_000 * 2))  # one second of silence
        assert pax.receive_json()["type"] == "thinking"
        assert pax.receive_json() == {"type": "grid", "reason": "empty"}


def test_interpret_endpoint_is_stateless():
    r = client.post("/api/interpret", json={"text": "thoda wotter and kambal", "lang": "hi"})
    body = r.json()
    assert body["rule"] == "split"
    assert [c["candidates"][0]["label"] for c in body["cards"]] == ["पानी", "कंबल"]
    assert body["cards"][1]["crew_ja"] == "毛布をご希望です"
    assert main.cabin.cards == {}  # nothing reaches the crew
    assert client.post("/api/interpret", json={"text": "x" * 201}).status_code == 422
    assert client.post("/api/interpret", json={"text": "tea", "phase": "landed"}).status_code == 422


def test_explain_endpoint_shows_the_reasoning():
    pytest.importorskip("phonemizer")
    body = client.post("/api/explain", json={"text": "madam thoda wotter and kambal"}).json()["explain"]
    assert body["rule"] == "split"
    fillers = [t["text"] for t in body["tokens"] if t["filler"]]
    assert "madam" in fillers and "thoda" in fillers
    water = body["cards"][0]["candidates"][0]
    assert water["intent"] == "water" and water["heard"] == "wotter"
    if "detail" in water:  # phonetic matcher available
        assert water["detail"]["heard_phones"][0] == "w"
        assert {s["op"] for s in water["detail"]["steps"]} <= {"match", "sub", "extra", "missing", "skip"}
    assert body["thresholds"]["t1"] == 0.7


def test_judge_gets_explanation_for_voice():
    pytest.importorskip("faster_whisper")
    # one shared event loop for both sockets, as on the real server (separate TestClient portals stall
    # when one connection's handler sends a large message to the other)
    with TestClient(main.app) as shared, shared.websocket_connect("/ws/judge") as judge, \
            shared.websocket_connect("/ws/passenger/33K") as pax:
        pax.send_bytes(_clip_pcm("rishi_water_blanket"))
        msg = judge.receive_json()
        assert msg["source"] == "voice" and msg["seat"] == "33K"
        wave = msg["explain"]["waveform"]
        assert len(wave["peaks"]) == 160 and wave["speech"]
        assert msg["explain"]["stages"]["speech_to_text"] > 0


def test_exit_row_check():
    with TestClient(main.app) as shared, shared.websocket_connect("/ws/crew") as crew, \
            shared.websocket_connect("/ws/passenger/30A") as ok, shared.websocket_connect("/ws/passenger/30K") as unsure:
        ok.send_json({"type": "hello", "lang": "hi"})
        crew.send_json({"type": "exit_check"})
        q = ok.receive_json()
        assert q["type"] == "exit_check" and len(q["check"]["questions"]) == 3
        assert q["check"]["answers"]["yes"] == "हाँ"
        assert unsure.receive_json()["type"] == "exit_check"
        ids = [x["id"] for x in q["check"]["questions"]]
        ok.send_json({"type": "exit_answer", "answers": {i: True for i in ids}})
        assert ok.receive_json()["result"] == "pass"
        unsure.send_json({"type": "exit_answer", "answers": {i: True for i in ids}, "reseat": True})
        assert unsure.receive_json()["result"] == "talk"
        state = crew_state(crew)
        while sum(c["result"] != "pending" for c in state["exit_checks"]) < 2:
            state = crew_state(crew)
        results = {c["seat"]: c["result"] for c in state["exit_checks"]}
        assert results["30A"] == "pass" and results["30K"] == "talk" and results["30B"] == "pending"
