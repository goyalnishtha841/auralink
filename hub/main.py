"""Cabin hub: FastAPI + WebSocket. Runs offline on a laptop on the cabin router.

Run:  scripts/run.sh   then open  http://<laptop-ip>:8000/
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine import PHASES, Context, Hypothesis, Lexicon, interpret
from engine.lexicon import ROOT
from engine.types import Phase

from . import auth, checkin, demo, languages, pa, persist, recordings, rounds
from . import report as flight_report
from .explain import explain
from .state import SEAT_IDS, Cabin, Card
from .templates import Templates

log = logging.getLogger("auralink.hub")

ASR_MODEL = os.environ.get("AURALINK_ASR_MODEL", "base")  # base: ~0.7 s on an M1; small: ~2.9 s
# Crew announcements are long, formal Japanese and not time-critical: `base` misheard 点灯 and 二十分
# in tests with spoken PAs, `small` heard them right in ~3-5 s. Passenger requests stay on the fast model.
PA_ASR_MODEL = os.environ.get("AURALINK_PA_ASR_MODEL", "small")
MAX_AUDIO_S = 10
_models: dict[str, object] = {}
_asr_lock = threading.Lock()


def get_asr(model: str | None = None):
    """Load a Whisper model once, on first use (or at startup when AURALINK_PRELOAD_ASR=1)."""
    model = model or ASR_MODEL
    with _asr_lock:
        if model not in _models:
            from engine.asr import WhisperASR  # heavy import: keep it out of text-only runs and tests
            log.info("loading Whisper %s", model)
            _models[model] = WhisperASR(model)
        return _models[model]


def run_asr(audio, langs: tuple[str, ...] = ("en", "hi"), model: str | None = None):
    asr = get_asr(model)
    with _asr_lock:  # one decode at a time; CPU-bound anyway
        return asr.transcribe(audio, langs=langs)


def warm_matcher() -> None:
    """Phonemise the lexicon once at startup so the first passenger request is fast."""
    from engine.matcher import default_similarity

    sim = default_similarity()
    if hasattr(sim, "warm"):
        sim.warm([v for i in lexicon.intents for v in lexicon.variants(i.id)] + sorted(lexicon.stopwords))
    log.info("matcher ready: %s", getattr(sim, "name", "text"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=warm_matcher, daemon=True).start()
    if os.environ.get("AURALINK_PRELOAD_ASR") == "1":
        threading.Thread(target=get_asr, daemon=True).start()
        threading.Thread(target=get_asr, args=(PA_ASR_MODEL,), daemon=True).start()   # first PA is not slow
    yield


app = FastAPI(title="Auralink cabin hub", lifespan=lifespan)
CREW = [Depends(auth.require_crew)]       # crew-only routes: see hub/auth.py


@app.middleware("http")
async def revalidate_static(request, call_next):
    """Browsers must check for a newer screen file every time (cheap: unchanged files answer 304),
    so phones and the crew tablet never run an old stylesheet after an update."""
    response = await call_next(request)
    if not request.url.path.startswith("/api") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response
lexicon = Lexicon()
templates = Templates()
pa_library = pa.Library()
cabin = Cabin(lexicon)
for _seat, _prefs in checkin.load().items():          # check-ins survive a hub restart
    if _seat in cabin.seats:
        cabin.seats[_seat] = cabin.seats[_seat].model_copy(update={**_prefs, "checked_in": True})
restored_at = persist.restore(cabin)                    # crash recovery: requests, briefings, exit checks
if restored_at:
    log.warning("restored cabin state saved at %s", time.strftime("%H:%M:%S", time.localtime(restored_at)))

passengers: dict[str, set[WebSocket]] = defaultdict(set)
crew: set[WebSocket] = set()
judges: set[WebSocket] = set()


# views: what each screen receives

def card_for_passenger(card: Card, lang: str) -> dict:
    def option(intent: str) -> dict:
        i = lexicon.get(intent)
        return {"intent": intent, "icon": i.icon, "label": lexicon.label(intent, lang)}

    return {
        "id": card.id,
        "status": card.status,
        "urgent": card.urgent,
        "confident": card.confident,
        "heard": card.heard,
        "intent": option(card.intent) if card.intent else None,
        "options": [option(c.intent) for c in card.candidates],
    }


def card_for_crew(card: Card) -> dict:
    data = card.model_dump()
    if card.intent:
        i = lexicon.get(card.intent)
        data.update(icon=i.icon, label_ja=i.label["ja"], label_en=i.label["en"], crew_ja=i.crew_ja)
    data["guesses"] = [
        {"intent": c.intent, "icon": lexicon.get(c.intent).icon, "label_ja": lexicon.get(c.intent).label["ja"],
         "label_en": lexicon.get(c.intent).label["en"], "score": c.score, "heard": c.heard}
        for c in card.candidates
    ]
    data["lang"] = cabin.seats[card.seat].lang
    if (sym := templates.symptom(card.symptom)):
        data["symptom_ja"], data["symptom_en"], data["symptom_icon"] = sym["label"]["ja"], sym["label"]["en"], sym["icon"]
    data["pictures"] = cabin.seats[card.seat].pictures
    return data


def exit_seats() -> list[str]:
    rows = {str(r) for r in templates.exit_rows}
    return [s for s in SEAT_IDS if s[:-1] in rows]


def crew_state() -> dict:
    b = cabin.broadcast
    briefing = None
    if b:
        t = templates.safety[b.template_id]
        briefing = {
            "id": b.id, "template_id": b.template_id, "title_ja": t["title"]["ja"], "title_en": t["title"]["en"],
            "steps": [{"pictogram": st["pictogram"], "ja": st["text"]["ja"], "en": st["simple"]["en"]} for st in t["steps"]],
            "detail": {seat: a.model_dump() for seat, a in b.responses.items()},
        }
    return {
        "type": "state",
        "phase": cabin.phase,
        "cards": [card_for_crew(c) for c in cabin.crew_cards()],
        "heatmap": cabin.heatmap(),
        "broadcast": briefing,
        "exit_checks": [{**c.model_dump(), "connected": cabin.seats[c.seat].connected}
                        for c in cabin.exit_checks.values()],
        "round_plan": rounds.plan(cabin),
        "round": cabin.round,
        "pa_log": [{**a, **pa_library.caption(a["id"], "en", a.get("n"))} for a in cabin.pa_log[-5:]][::-1],
        "seat_needs": [s.model_dump(include={"id", "lang", "senior", "pictures", "read", "checked_in", "connected"})
                       for s in cabin.seats.values() if s.lang != "en" or s.senior or s.pictures or s.read],
    }


# fan-out

async def _send(sockets: set[WebSocket], msg: dict) -> None:
    for ws in list(sockets):
        try:
            await ws.send_json(msg)
        except Exception:  # client vanished mid-send
            sockets.discard(ws)


async def to_seat(seat: str, msg: dict) -> None:
    await _send(passengers[seat], msg)


async def push_crew() -> None:
    """Every change ends here, so this is where the cabin state is saved for crash recovery."""
    try:
        persist.save(cabin)
    except OSError as e:  # a full or read-only disk must never stop the cabin
        log.error("could not save cabin state: %s", e)
    await _send(crew, crew_state())


async def send_status(card: Card, key: str) -> None:
    lang = cabin.seats[card.seat].lang
    await to_seat(card.seat, {"type": "status", "card": card_for_passenger(card, lang),
                              "message": templates.status(key, lang)})


# HTTP

class InterpretIn(BaseModel):
    text: str = Field(max_length=200)
    phase: Phase = "cruise"
    lang: str = Field("en", pattern=r"^[a-z]{2,3}$")


@app.post("/api/interpret")
def interpret_text(body: InterpretIn) -> dict:
    """Stateless matcher call for the landing page's "try it" box. Creates no cards."""
    lexicon.reload_if_changed()
    result = interpret([Hypothesis(text=body.text)], Context(seat="demo", phase=body.phase), lexicon)
    return {
        "rule": result.rule,
        "urgent": result.urgent,
        "latency_ms": result.latency_ms,
        "cards": [
            {
                "span": d.span, "status": d.status, "urgent": d.urgent,
                "crew_ja": lexicon.get(d.candidates[0].intent).crew_ja,
                "candidates": [
                    {"intent": c.intent, "label": lexicon.label(c.intent, body.lang), "score": c.score,
                     "p": c.p, "heard": c.heard, "matched": c.matched}
                    for c in d.candidates
                ],
            }
            for d in result.cards
        ],
    }


@app.post("/api/explain")
def explain_text(body: InterpretIn) -> dict:
    """Glass-box view of a typed phrase, for judge.html. Stateless, like /api/interpret."""
    from engine.matcher import default_similarity

    lexicon.reload_if_changed()
    result = interpret([Hypothesis(text=body.text)], Context(seat="demo", phase=body.phase), lexicon)
    return {"source": "typed", "seat": None, "phase": body.phase,
            "explain": explain(result, lexicon, default_similarity(), body.phase)}


# --- presenter console (demo control): same code paths as the real screens -----------------------

class SayIn(BaseModel):
    seat: str
    text: str = Field(min_length=1, max_length=200)


@app.get("/api/status", dependencies=CREW)
def status() -> dict:
    from engine.matcher import default_similarity

    open_cards = cabin.crew_cards()
    return {
        "speech_model": ASR_MODEL if ASR_MODEL in _models else None,
        "matcher": getattr(default_similarity(), "name", "text"),
        "phase": cabin.phase,
        "seats_connected": sorted(sid for sid, seat in cabin.seats.items() if seat.connected),
        "crew_screens": len(crew),
        "judge_screens": len(judges),
        "open_requests": len(open_cards),
        "urgent_open": sum(1 for c in open_cards if c.urgent and c.status != "acknowledged"),
        "briefing": cabin.broadcast.template_id if cabin.broadcast else None,
        "restored_from": restored_at,
    }


@app.post("/api/presenter/reset", dependencies=CREW)
async def presenter_reset() -> dict:
    cabin.reset()
    for sockets in passengers.values():
        await _send(sockets, {"type": "reset"})
    await push_crew()
    return {"reset": True}


@app.post("/api/presenter/say", dependencies=CREW)
async def presenter_say(body: SayIn) -> dict:
    """Send a request as if a passenger typed it at `seat` (backup when a phone or microphone fails)."""
    if body.seat not in cabin.seats:
        raise HTTPException(404, f"No seat {body.seat}")
    await interpret_and_reply(body.seat, body.text)
    await push_crew()
    return {"sent": True, "seat_has_screen": cabin.seats[body.seat].connected}


@app.post("/api/presenter/crew", dependencies=CREW)
async def presenter_crew(msg: dict) -> dict:
    """Trigger a crew action (broadcast, exit_check, phase, end_broadcast) as if tapped on the crew tablet."""
    allowed = {"broadcast", "exit_check", "phase", "end_broadcast", "start_round", "stop_done", "end_round"}
    if msg.get("type") not in allowed:
        raise HTTPException(400, f"Allowed: {', '.join(sorted(allowed))}")
    try:
        await handle_crew(msg)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e)) from None
    return {"done": msg["type"]}


# --- live PA captions --------------------------------------------------------------------------------

PA_MAX_S = 30


class PaHeardIn(BaseModel):
    text: str | None = Field(None, max_length=600)   # typed (presenter backup, tests) ...
    audio_b64: str | None = None                       # ... or the crew's announcement, 16 kHz mono int16


@app.post("/api/pa/match", dependencies=CREW)
async def pa_match(body: PaHeardIn) -> dict:
    """What did the crew announce? Speech is decoded as Japanese and English; every reading is matched
    against the library and the best one wins. Nothing is sent to passengers until the crew tap Send."""
    import base64

    import numpy as np

    if body.audio_b64:
        pcm = base64.b64decode(body.audio_b64)
        if len(pcm) > PA_MAX_S * 16_000 * 2:
            raise HTTPException(413, f"Announcement longer than {PA_MAX_S} s: send it in parts")
        audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768
        try:
            tr = await asyncio.to_thread(run_asr, audio, ("ja", "en"), PA_ASR_MODEL)
        except ImportError:
            raise HTTPException(503, "voice unavailable: faster-whisper not installed") from None
        readings = [h.text for h in tr.hypotheses] or [""]
        latency = tr.latency_ms
    else:
        readings, latency = [body.text or ""], {}
    t = time.perf_counter()
    results = [pa_library.match(r) for r in readings]
    best = max(results, key=lambda r: r["matches"][0]["score"] if r["matches"] else 0.0)
    latency = {**latency, "match": round((time.perf_counter() - t) * 1000, 1)}
    for m in best["matches"]:
        m.update(pa_library.caption(m["id"], "en", m["n"]))
    return {**best, "readings": readings, "latency_ms": latency}


class PaSendIn(BaseModel):
    id: str
    n: str | None = Field(None, max_length=4, pattern=r"^[0-9]{1,3}[A-Z]?$")


@app.post("/api/pa/send", dependencies=CREW)
async def pa_send(body: PaSendIn) -> dict:
    """Caption one announcement on every connected seat, each in its own language."""
    pa_library.reload_if_changed()
    if body.id not in pa_library.items:
        raise HTTPException(404, f"No announcement {body.id!r}")
    entry = cabin.add_pa(body.id, body.n)
    seats, langs = 0, set()
    for seat, sockets in passengers.items():
        if sockets:
            seats += 1
            langs.add(cabin.seats[seat].lang)
            await _send(sockets, {"type": "pa", "pa_id": entry["pa_id"],
                                  "caption": pa_library.caption(body.id, cabin.seats[seat].lang, body.n)})
    entry.update(seats=seats, langs=sorted(langs))      # for the flight report
    await push_crew()
    return {"sent": body.id, "seats": seats}


@app.get("/api/report", dependencies=CREW)
def report() -> dict:
    """Flight report since the last cabin reset (report.html)."""
    templates.reload_if_changed()
    return flight_report.build(cabin, templates, pa_library)


@app.get("/api/report.csv", dependencies=CREW)
def report_csv() -> Response:
    return Response(flight_report.to_csv(cabin), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="auralink-flight-report.csv"'})


class CheckinIn(BaseModel):
    seat: str
    lang: str = "en"
    senior: bool = False
    pictures: bool = False
    read: bool = False


@app.post("/api/checkin")
async def post_checkin(body: CheckinIn) -> dict:
    """Airport / boarding gate: set how this seat's screen opens. Seat and preferences only, no names."""
    if body.seat not in cabin.seats:
        raise HTTPException(404, f"No seat {body.seat}")
    if body.lang not in languages.codes():
        raise HTTPException(422, f"Unknown language {body.lang!r}")
    prefs = body.model_dump(include=set(checkin.FIELDS))
    seat = cabin.seats[body.seat]
    for k, v in prefs.items():
        setattr(seat, k, v)
    seat.checked_in = True
    saved = checkin.load()
    saved[body.seat] = prefs
    checkin.save(saved)
    await push_crew()
    query = f"seat={body.seat}&lang={body.lang}" + ("&senior=1" if body.senior else "") + \
            ("&mode=pictures" if body.pictures else "") + ("&read=1" if body.read else "")
    return {"seat": body.seat, **prefs, "passenger_path": f"/passenger.html?{query}"}


@app.get("/api/seat/{seat}")
def get_seat(seat: str) -> dict:
    """What a seat's screen should open with (set at check-in, or by the passenger last time)."""
    if seat not in cabin.seats:
        raise HTTPException(404, f"No seat {seat}")
    return cabin.seats[seat].model_dump(include={"lang", "senior", "pictures", "read", "checked_in"})


@app.get("/api/config")
def config() -> dict:
    lexicon.reload_if_changed()
    templates.reload_if_changed()
    return {
        "seats": SEAT_IDS,
        "phases": list(PHASES),
        "intents": [{"id": i.id, "icon": i.icon, "label": i.label, "urgent": i.urgent} for i in lexicon.intents],
        "replies": templates.data["replies"],
        "safety": [{"id": s["id"], "title": s["title"]} for s in templates.data["safety"]],
        "phrasebook": {k: v for k, v in templates.data["phrasebook"].items() if not k.startswith("_")},
        "announcements": pa_library.menu(),
        "exit_seats": exit_seats(),
        "languages": [{"code": lang["code"], "name": lang["name"], "english": lang.get("english", lang["name"])}
                      for lang in languages.registry()],
    }


# WebSockets

@app.websocket("/ws/passenger/{seat}")
async def passenger_ws(ws: WebSocket, seat: str) -> None:
    if seat not in cabin.seats:
        await ws.close(code=4404)
        return
    await ws.accept()
    passengers[seat].add(ws)
    cabin.seats[seat].connected = True
    await push_crew()
    try:
        while True:
            frame = await ws.receive()
            if frame["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(frame.get("code", 1000))
            try:
                if frame.get("bytes") is not None:  # one utterance: 16 kHz mono int16 PCM
                    await handle_audio(seat, frame["bytes"])
                else:
                    await handle_passenger(seat, json.loads(frame["text"]))
            except (KeyError, ValueError) as e:  # bad card id or intent: report, keep the socket
                await ws.send_json({"type": "error", "detail": str(e)})
    except WebSocketDisconnect:
        pass
    finally:
        passengers[seat].discard(ws)
        cabin.seats[seat].connected = bool(passengers[seat])
        await push_crew()


async def interpret_and_reply(seat: str, text: str, nbest: list[Hypothesis] | None = None,
                              asr: dict | None = None) -> None:
    s = cabin.seats[seat]
    result, cards, escalated = cabin.handle_text(seat, text, nbest, source="voice" if asr else "text")
    if asr:
        result.latency_ms = {**asr["latency_ms"], **result.latency_ms}
    if judges:
        from engine.matcher import default_similarity

        why = explain(result, lexicon, default_similarity(), cabin.phase, audio=asr and asr.get("audio"),
                      speech=asr and asr.get("speech"), rejected=asr and asr["rejected"])
        await _send(judges, {"type": "result", "seat": seat, "source": "voice" if asr else "text",
                             "phase": cabin.phase, "result": result.model_dump(), "explain": why})
    if cards:
        await to_seat(seat, {"type": "confirm", "rule": result.rule,
                             "cards": [card_for_passenger(c, s.lang) for c in cards]})
    elif escalated:
        await send_status(escalated, "needs_human")
    else:
        await to_seat(seat, {"type": "grid", "reason": result.rule})
    if any(c.urgent for c in cards):
        await to_seat(seat, {"type": "notice", "message": templates.status("urgent", s.lang)})


async def handle_audio(seat: str, pcm: bytes) -> None:
    import numpy as np

    if len(pcm) > MAX_AUDIO_S * 16_000 * 2:
        raise ValueError(f"utterance longer than {MAX_AUDIO_S} s")
    await to_seat(seat, {"type": "thinking"})
    audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768
    try:
        tr = await asyncio.to_thread(run_asr, audio, languages.asr_languages(cabin.seats[seat].lang))
    except ImportError:
        await to_seat(seat, {"type": "error", "detail": "voice unavailable: faster-whisper not installed"})
        await to_seat(seat, {"type": "grid", "reason": "voice_unavailable"})
        return
    top = tr.hypotheses[0].text if tr.hypotheses else ""
    await interpret_and_reply(seat, top, tr.hypotheses or [Hypothesis(text="")],
                              asr={"latency_ms": tr.latency_ms, "rejected": tr.rejected,
                                   "audio": audio, "speech": tr.speech})
    await push_crew()


async def ask_symptom(card: Card) -> None:
    """A confirmed medical request: ask the passenger what is wrong, with pictures, so crew know before arriving."""
    if card.intent == "medical" and card.symptom is None:
        await to_seat(card.seat, {"type": "triage", "card_id": card.id,
                                  "triage": templates.triage_view(cabin.seats[card.seat].lang)})


async def handle_passenger(seat: str, msg: dict) -> None:
    s = cabin.seats[seat]
    kind = msg.get("type")

    if kind == "hello":
        s.lang = msg.get("lang", s.lang)
        s.senior = bool(msg.get("senior", s.senior))
        s.pictures = bool(msg.get("pictures", s.pictures))
        s.read = bool(msg.get("read", s.read))

    elif kind == "text":
        await interpret_and_reply(seat, msg.get("text", ""))

    elif kind == "icon":
        if msg.get("card_id"):
            card = cabin.confirm(msg["card_id"], msg["intent"])
        else:
            card = cabin.icon_request(seat, msg["intent"])
        await send_status(card, "urgent" if card.urgent else "sent")
        await ask_symptom(card)

    elif kind == "confirm":
        card = cabin.confirm(msg["card_id"], msg["intent"])
        await send_status(card, "urgent" if card.urgent else "sent")
        await ask_symptom(card)

    elif kind == "symptom":
        card = cabin.set_symptom(msg["card_id"], msg.get("symptom"), templates.symptom_ids)
        await to_seat(seat, {"type": "triage_done", "message": templates.triage_view(s.lang)["done"]})

    elif kind == "reject":
        card = cabin.reject(msg["card_id"])
        if card.status == "needs_human":
            await send_status(card, "needs_human")
        else:
            await to_seat(seat, {"type": "grid", "reason": "rejected", "card_id": card.id})

    elif kind == "safety":
        status = msg.get("status") or ("understood" if msg.get("understood") else "reexplaining")
        cabin.safety_response(seat, status, msg.get("step"))

    elif kind == "exit_answer":
        check = cabin.exit_answer(seat, msg.get("answers", {}), bool(msg.get("reseat")), templates.exit_question_ids)
        await to_seat(seat, {"type": "exit_done", "result": check.result,
                             "message": templates.exit_done(check.result, s.lang)})

    await push_crew()


@app.websocket("/ws/crew")
async def crew_ws(ws: WebSocket) -> None:
    if not await auth.crew_socket_ok(ws):
        return
    crew.add(ws)
    await ws.send_json(crew_state())
    try:
        while True:
            msg = await ws.receive_json()
            try:
                await handle_crew(msg)
            except (KeyError, ValueError) as e:
                await ws.send_json({"type": "error", "detail": str(e)})
    except WebSocketDisconnect:
        crew.discard(ws)


async def handle_crew(msg: dict) -> None:
    kind = msg.get("type")
    if kind == "ack":
        await send_status(cabin.acknowledge(msg["card_id"]), "acknowledged")
    elif kind == "reply":
        card = cabin.reply(msg["card_id"], msg["reply_id"])
        lang = cabin.seats[card.seat].lang
        await to_seat(card.seat, {"type": "reply", "card_id": card.id,
                                  "text": templates.reply(msg["reply_id"], lang)})
    elif kind == "close":
        await send_status(cabin.close(msg["card_id"]), "closed")
    elif kind == "phase" and msg.get("phase") in PHASES:
        cabin.phase = msg["phase"]
    elif kind == "broadcast":
        templates.reload_if_changed()
        b = cabin.start_broadcast(msg["template_id"])
        for seat, sockets in passengers.items():
            view = templates.safety_view(b.template_id, cabin.seats[seat].lang)
            await _send(sockets, {"type": "safety", "broadcast_id": b.id, "template": view})
    elif kind == "end_broadcast":
        cabin.end_broadcast()
    elif kind == "start_round":
        r = cabin.start_round(rounds.plan(cabin))
        for pos, stop in enumerate(r["stops"], 1):
            for cid in stop["cards"]:
                card = cabin.cards[cid]
                lang = cabin.seats[card.seat].lang
                await to_seat(card.seat, {"type": "status", "card": card_for_passenger(card, lang),
                                          "message": templates.status("on_round", lang).format(pos=pos, n=len(r["stops"]))})
    elif kind == "stop_done":
        for card in cabin.finish_stop(msg["seat"]):
            await send_status(card, "closed")
    elif kind == "end_round":
        cabin.end_round()
    elif kind == "exit_check":
        templates.reload_if_changed()
        for check in cabin.start_exit_check(exit_seats()):
            view = templates.exit_view(cabin.seats[check.seat].lang)
            await _send(passengers[check.seat], {"type": "exit_check", "check": view})
    await push_crew()


@app.websocket("/ws/judge")
async def judge_ws(ws: WebSocket) -> None:
    if not await auth.crew_socket_ok(ws):      # live explanations quote real seats' words
        return
    judges.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        judges.discard(ws)


app.include_router(auth.router)
app.include_router(recordings.router)
app.include_router(demo.router)
app.include_router(languages.router)
# Screens: the Next.js build (web/out, see web/README.md) when it exists, else the original plain-HTML
# screens in apps/. Same URLs either way. AURALINK_UI=classic forces the original screens.
_NEXT_UI = ROOT / "web" / "out"
UI_DIR = _NEXT_UI if _NEXT_UI.is_dir() and os.environ.get("AURALINK_UI", "").lower() != "classic" else ROOT / "apps"
app.mount("/", StaticFiles(directory=UI_DIR, html=True), name="apps")
