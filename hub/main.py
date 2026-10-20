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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles

from engine import PHASES, Context, Hypothesis, Lexicon, interpret
from engine.types import Phase
from engine.lexicon import ROOT

from . import recordings
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


def run_asr(audio):
    asr = get_asr()
    with _asr_lock:  # one decode at a time; CPU-bound anyway
        return asr.transcribe(audio)


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
    return data


def crew_state() -> dict:
    b = cabin.broadcast
    return {
        "type": "state",
        "phase": cabin.phase,
        "cards": [card_for_crew(c) for c in cabin.crew_cards()],
        "heatmap": cabin.heatmap(),
        "broadcast": {"id": b.id, "template_id": b.template_id} if b else None,
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
    lang: str = Field("en", pattern=r"^(en|hi|ja)$")


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
    result, cards, escalated = cabin.handle_text(seat, text, nbest)
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
        tr = await asyncio.to_thread(run_asr, audio)
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
        cabin.safety_response(seat, bool(msg.get("understood")))

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
        b = cabin.start_broadcast(msg["template_id"])
        for seat, sockets in passengers.items():
            view = templates.safety_view(b.template_id, cabin.seats[seat].lang)
            await _send(sockets, {"type": "safety", "broadcast_id": b.id, "template": view})
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
app.mount("/", StaticFiles(directory=ROOT / "apps", html=True), name="apps")
