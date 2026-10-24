"""End-to-end through the real WebSockets: passenger -> hub -> crew."""
import os

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
    """One client for the module, so the crew and passenger sockets share an event loop
    (separate loops can deadlock when the hub sends from one socket's loop to another's)."""
    with crew_login(TestClient(main.app)) as c:
        yield c


def crew_state(crew):
    while True:
        msg = crew.receive_json()
        if msg["type"] == "state":
            return msg


def test_split_request_reaches_crew_after_confirm(client):
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


def test_scanned_boarding_pass_name_reaches_crew(client):
    """A name only ever arrives from a scanned boarding pass (web/app/passenger's SeatGate), so
    crew should see it on the seat's request cards once the passenger says hello with one."""
    with client.websocket_connect("/ws/crew") as crew, client.websocket_connect("/ws/passenger/34K") as pax:
        crew_state(crew)
        pax.send_json({"type": "hello", "lang": "en", "name": "Yuki Tanaka"})
        pax.send_json({"type": "icon", "intent": "water"})
        pax.receive_json()

        state = crew_state(crew)
        while not state["cards"]:
            state = crew_state(crew)
        assert state["cards"][0]["name"] == "Yuki Tanaka"

        # a later hello with no name (e.g. a language change) must not erase it
        pax.send_json({"type": "hello", "lang": "hi"})
        state = crew_state(crew)
        assert state["cards"][0]["name"] == "Yuki Tanaka"


def test_two_failed_rounds_escalate_to_needs_human(client):
    with client.websocket_connect("/ws/passenger/30A") as pax:
        pax.send_json({"type": "text", "text": "hmm"})
        assert pax.receive_json()["type"] == "grid"
        pax.send_json({"type": "text", "text": "uh"})
        msg = pax.receive_json()
        assert msg["type"] == "status" and msg["card"]["status"] == "needs_human"


def test_safety_heatmap(client):
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


def test_bad_card_id_does_not_drop_socket(client):
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


def _needs_whisper():
    pytest.importorskip("faster_whisper")
    if os.environ.get("AURALINK_SKIP_WHISPER") == "1":  # CI: don't download the model
        pytest.skip("Whisper disabled by AURALINK_SKIP_WHISPER")


def test_voice_request_end_to_end(client):
    _needs_whisper()
    with client.websocket_connect("/ws/passenger/33H") as pax:
        pax.send_bytes(_clip_pcm("rishi_water_blanket"))  # "Madam, thoda wotter and kambal please"
        assert pax.receive_json()["type"] == "thinking"
        msg = pax.receive_json()
        assert msg["type"] == "confirm"
        assert [c["options"][0]["intent"] for c in msg["cards"]] == ["water", "blanket"]


def test_silence_goes_to_icon_grid(client):
    _needs_whisper()
    with client.websocket_connect("/ws/passenger/33J") as pax:
        pax.send_bytes(bytes(16_000 * 2))  # one second of silence
        assert pax.receive_json()["type"] == "thinking"
        assert pax.receive_json() == {"type": "grid", "reason": "empty"}


def test_interpret_endpoint_is_stateless(client):
    r = client.post("/api/interpret", json={"text": "thoda wotter and kambal", "lang": "hi"})
    body = r.json()
    assert body["rule"] == "split"
    assert [c["candidates"][0]["label"] for c in body["cards"]] == ["पानी", "कंबल"]
    assert body["cards"][1]["crew_ja"] == "毛布をご希望です"
    assert main.cabin.cards == {}  # nothing reaches the crew
    assert client.post("/api/interpret", json={"text": "x" * 201}).status_code == 422
    assert client.post("/api/interpret", json={"text": "tea", "phase": "landed"}).status_code == 422


def test_explain_endpoint_shows_the_reasoning(client):
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


def test_judge_gets_explanation_for_voice(crew_login):
    _needs_whisper()
    # one shared event loop for both sockets, as on the real server (separate TestClient portals stall
    # when one connection's handler sends a large message to the other)
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/judge") as judge, \
            shared.websocket_connect("/ws/passenger/33K") as pax:
        pax.send_bytes(_clip_pcm("rishi_water_blanket"))
        msg = judge.receive_json()
        assert msg["source"] == "voice" and msg["seat"] == "33K"
        wave = msg["explain"]["waveform"]
        assert len(wave["peaks"]) == 160 and wave["speech"]
        assert msg["explain"]["stages"]["speech_to_text"] > 0


def test_exit_row_check(crew_login):
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/crew") as crew, \
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


def test_exit_row_check_resends_on_late_connect(crew_login):
    """A seat that connects (or reconnects) after crew started the check still gets asked --
    not just whoever happened to be connected at that moment."""
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/crew") as crew:
        crew.send_json({"type": "exit_check"})
        crew_state(crew)   # the state push from starting the check
        with shared.websocket_connect("/ws/passenger/30B") as late:
            q = late.receive_json()
            assert q["type"] == "exit_check" and len(q["check"]["questions"]) == 3


def test_seat_by_voice(client):
    r = client.post("/api/seat/by-voice", json={"text": "three four kay"})
    assert r.status_code == 200
    assert r.json() == {"heard": "three four kay", "seat": "34K"}

    r = client.post("/api/seat/by-voice", json={"text": "um, not sure"})
    assert r.json()["seat"] is None


def test_boarding_pass_demo_and_scan(client):
    gen = client.get("/api/boarding-pass/demo", params={"name": "Yuki Tanaka", "seat": "34K"})
    assert gen.status_code == 200
    text = gen.json()["text"]
    assert len(text) == 60

    scan = client.post("/api/seat/by-boarding-pass", json={"text": text})
    assert scan.json() == {"seat": "34K", "name": "Yuki Tanaka"}

    bad = client.post("/api/seat/by-boarding-pass", json={"text": "not a boarding pass"})
    assert bad.json() == {"seat": None, "name": None}


def test_boarding_pass_demo_rejects_unknown_seat(client):
    r = client.get("/api/boarding-pass/demo", params={"name": "A B", "seat": "99Z"})
    assert r.status_code == 404


def test_demo_kit_endpoints(client):
    info = client.get("/api/hub-info").json()
    assert info["public_url"].startswith("http")
    svg = client.get("/api/qr", params={"data": "http://192.168.1.5:8000/passenger.html?seat=34K"})
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in svg.content
    assert client.get("/api/qr", params={"data": "x" * 301}).status_code == 422


def test_picture_mode_reaches_crew_card(crew_login):
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/crew") as crew, \
            shared.websocket_connect("/ws/passenger/32D") as pax:
        pax.send_json({"type": "hello", "lang": "en", "pictures": True})
        pax.send_json({"type": "icon", "intent": "water"})
        assert pax.receive_json()["type"] == "status"
        state = crew_state(crew)
        while not state["cards"]:
            state = crew_state(crew)
        assert state["cards"][0]["pictures"] is True and state["cards"][0]["intent"] == "water"


def test_presenter_backup_reset_and_status(crew_login):
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/crew"), \
            shared.websocket_connect("/ws/passenger/34K") as pax:
        r = shared.post("/api/presenter/say", json={"seat": "34K", "text": "I have chest pain"}).json()
        assert r["seat_has_screen"] is True
        assert pax.receive_json()["type"] == "confirm"           # the passenger screen reacts as if typed
        st = shared.get("/api/status").json()
        assert st["urgent_open"] == 1 and "34K" in st["seats_connected"] and st["crew_screens"] == 1

        assert shared.post("/api/presenter/crew", json={"type": "broadcast", "template_id": "landing"}).status_code == 200
        assert shared.post("/api/presenter/crew", json={"type": "ack", "card_id": "c1"}).status_code == 400
        assert shared.post("/api/presenter/say", json={"seat": "99Z", "text": "water"}).status_code == 404

        shared.post("/api/presenter/reset")
        msg = pax.receive_json()
        while msg["type"] != "reset":
            msg = pax.receive_json()
        st = shared.get("/api/status").json()
        assert st["open_requests"] == 0 and st["briefing"] is None and "34K" in st["seats_connected"]


def test_ca_certificate_is_public_part_only(client, tmp_path, monkeypatch):
    monkeypatch.setenv("AURALINK_CA_ROOT", str(tmp_path))
    assert client.get("/api/ca.pem").status_code == 404
    (tmp_path / "rootCA.pem").write_text("-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----\n")
    (tmp_path / "rootCA-key.pem").write_text("SECRET KEY")
    r = client.get("/api/ca.pem")
    assert r.status_code == 200 and b"PUBLIC" in r.content and b"SECRET" not in r.content
    info = client.get("/api/hub-info").json()
    assert info["ca_available"] is True and info["this_page_https"] is False


def test_medical_request_asks_for_symptom(crew_login):
    with crew_login(TestClient(main.app)) as shared, shared.websocket_connect("/ws/crew") as crew, \
            shared.websocket_connect("/ws/passenger/34K") as pax:
        pax.send_json({"type": "hello", "lang": "hi"})
        pax.send_json({"type": "icon", "intent": "medical"})
        assert pax.receive_json()["type"] == "status"
        ask = pax.receive_json()
        assert ask["type"] == "triage" and ask["triage"]["title"] == "क्या तकलीफ़ है? एक पर टैप करें।"
        assert [x["id"] for x in ask["triage"]["symptoms"]][:2] == ["chest_pain", "breathing"]
        pax.send_json({"type": "symptom", "card_id": ask["card_id"], "symptom": "nowhere"})
        assert pax.receive_json()["type"] == "error"
        pax.send_json({"type": "symptom", "card_id": ask["card_id"], "symptom": "chest_pain"})
        assert pax.receive_json()["type"] == "triage_done"
        state = crew_state(crew)
        while not state["cards"] or "symptom_ja" not in state["cards"][0]:
            state = crew_state(crew)
        assert state["cards"][0]["symptom_ja"] == "胸の痛み" and state["cards"][0]["urgent"]


def test_non_medical_request_never_asks_for_symptom(client):
    with client.websocket_connect("/ws/passenger/31A") as pax:
        pax.send_json({"type": "icon", "intent": "water"})
        assert pax.receive_json()["type"] == "status"
        pax.send_json({"type": "text", "text": "blanket"})
        assert pax.receive_json()["type"] == "confirm"   # the next message is the confirm, not a triage
