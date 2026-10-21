"""Cabin hub: FastAPI + WebSocket. Runs offline on a laptop on the cabin router.

Run:  scripts/run.sh   then open  http://<laptop-ip>:8000/
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from engine import PHASES, Context, Hypothesis, Lexicon, interpret
from engine.types import Phase
from engine.lexicon import ROOT

from . import demo, languages, recordings
from . import report as flight_report
from .explain import explain
from .state import SEAT_IDS, Cabin, Card
from .templates import Templates

log = logging.getLogger("auralink.hub")

ASR_MODEL = os.environ.get("AURALINK_ASR_MODEL", "base")  # base: ~0.7 s on an M1; small: ~2.9 s
MAX_AUDIO_S = 10
_asr = None
_asr_lock = threading.Lock()


def get_asr():
    """Load Whisper once, on first use (or at startup when AURALINK_PRELOAD_ASR=1)."""
    global _asr
    with _asr_lock:
        if _asr is None:
            from engine.asr import WhisperASR  # heavy import: keep it out of text-only runs and tests
            log.info("loading Whisper %s", ASR_MODEL)
            _asr = WhisperASR(ASR_MODEL)
        return _asr


def run_asr(audio, langs: tuple[str, ...] = ("en", "hi")):
    asr = get_asr()
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
    yield


app = FastAPI(title="Auralink cabin hub", lifespan=lifespan)


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
cabin = Cabin(lexicon)

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


@app.get("/api/status")
def status() -> dict:
    from engine.matcher import default_similarity

    open_cards = cabin.crew_cards()
    return {
        "speech_model": ASR_MODEL if _asr is not None else None,
        "matcher": getattr(default_similarity(), "name", "text"),
        "phase": cabin.phase,
        "seats_connected": sorted(sid for sid, seat in cabin.seats.items() if seat.connected),
        "crew_screens": len(crew),
        "judge_screens": len(judges),
        "open_requests": len(open_cards),
        "urgent_open": sum(1 for c in open_cards if c.urgent and c.status != "acknowledged"),
        "briefing": cabin.broadcast.template_id if cabin.broadcast else None,
    }


@app.post("/api/presenter/reset")
async def presenter_reset() -> dict:
    cabin.reset()
    for sockets in passengers.values():
        await _send(sockets, {"type": "reset"})
    await push_crew()
    return {"reset": True}


@app.post("/api/presenter/say")
async def presenter_say(body: SayIn) -> dict:
    """Send a request as if a passenger typed it at `seat` (backup when a phone or microphone fails)."""
    if body.seat not in cabin.seats:
        raise HTTPException(404, f"No seat {body.seat}")
    await interpret_and_reply(body.seat, body.text)
    await push_crew()
    return {"sent": True, "seat_has_screen": cabin.seats[body.seat].connected}


@app.post("/api/presenter/crew")
async def presenter_crew(msg: dict) -> dict:
    """Trigger a crew action (broadcast, exit_check, phase, end_broadcast) as if tapped on the crew tablet."""
    if msg.get("type") not in {"broadcast", "exit_check", "phase", "end_broadcast"}:
        raise HTTPException(400, "Allowed: broadcast, exit_check, phase, end_broadcast")
    try:
        await handle_crew(msg)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e)) from None
    return {"done": msg["type"]}


@app.get("/api/report")
def report() -> dict:
    """Flight report since the last cabin reset (report.html)."""
    templates.reload_if_changed()
    return flight_report.build(cabin, templates)


@app.get("/api/report.csv")
def report_csv() -> Response:
    return Response(flight_report.to_csv(cabin), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="auralink-flight-report.csv"'})


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
        "exit_seats": exit_seats(),
        "languages": [{"code": lang["code"], "name": lang["name"]} for lang in languages.registry()],
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


async def handle_passenger(seat: str, msg: dict) -> None:
    s = cabin.seats[seat]
    kind = msg.get("type")

    if kind == "hello":
        s.lang = msg.get("lang", s.lang)
        s.senior = bool(msg.get("senior", s.senior))
        s.pictures = bool(msg.get("pictures", s.pictures))

    elif kind == "text":
        await interpret_and_reply(seat, msg.get("text", ""))

    elif kind == "icon":
        if msg.get("card_id"):
            card = cabin.confirm(msg["card_id"], msg["intent"])
        else:
            card = cabin.icon_request(seat, msg["intent"])
        await send_status(card, "urgent" if card.urgent else "sent")

    elif kind == "confirm":
        card = cabin.confirm(msg["card_id"], msg["intent"])
        await send_status(card, "urgent" if card.urgent else "sent")

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
    await ws.accept()
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
    elif kind == "exit_check":
        templates.reload_if_changed()
        for check in cabin.start_exit_check(exit_seats()):
            view = templates.exit_view(cabin.seats[check.seat].lang)
            await _send(passengers[check.seat], {"type": "exit_check", "check": view})
    await push_crew()


@app.websocket("/ws/judge")
async def judge_ws(ws: WebSocket) -> None:
    await ws.accept()
    judges.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        judges.discard(ws)


app.include_router(recordings.router)
app.include_router(demo.router)
app.include_router(languages.router)
app.mount("/", StaticFiles(directory=ROOT / "apps", html=True), name="apps")
