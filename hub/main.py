"""Cabin hub: FastAPI + WebSocket. Runs offline on a laptop on the cabin router.

Run:  scripts/run.sh   then open  http://<laptop-ip>:8000/
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import stat
import threading
import time
from collections import defaultdict
from contextlib import asynccontextmanager

import anyio
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine import PHASES, Context, Hypothesis, Lexicon, assist, interpret
from engine.lexicon import ROOT
from engine.matcher import tokenize
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
# How a seat says it needs help, set at check-in or on the passenger phone (web/app/passenger).
# Each one switches the passenger UI (captions/vibration, large text, picture-first, ...) and
# shows the crew a badge so they know *how* to help, not just what was asked.
ACCESSIBILITY_PROFILES = ("deaf_hoh", "low_vision", "mobility", "cognitive")
ACCESSIBILITY_LABEL_EN = {
    "deaf_hoh": "deaf/hard of hearing", "low_vision": "low vision",
    "mobility": "reduced mobility", "cognitive": "prefers simple/picture screens",
}
# Free Talk needs ctranslate2 + transformers + a ~2.4 GB model (downloaded once, then offline).
# Heavy enough that it is opt-out rather than always-on: AURALINK_FREE_TALK=0 hides it even when
# the dependencies are installed, for a laptop that would rather keep the RAM for Whisper.
FREE_TALK_ENABLED = os.environ.get("AURALINK_FREE_TALK", "1") != "0"


def free_talk_available() -> bool:
    if not FREE_TALK_ENABLED:
        return False
    from engine.translate import available

    return available()
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


def warm_live_conversation() -> None:
    """Translation (NLLB), voice (Kokoro) and the live assist LLM are lazy singletons: nothing
    loads them into memory until first used. Without this, that load -- several seconds each,
    for three separate models -- lands on the passenger's very first Live Conversation turn,
    on top of the translate+speak work itself. Runs once here instead, in the background, behind
    each model's own `available()` check, so it's a no-op (fast) when a model isn't installed."""
    from engine import assist
    from engine.translate import available as translate_available
    from engine.tts import available as tts_available

    if translate_available():
        try:
            from engine.translate import translate

            translate("hello", "en", "ja")
        except Exception as e:
            log.warning("translation warm-up failed (%s)", e)
    if tts_available():
        try:
            from engine.tts import synthesize

            synthesize("こんにちは", "ja")
        except Exception as e:
            log.warning("voice warm-up failed (%s)", e)
    if assist.available():
        try:
            assist.classify("hello", ["water"])
        except Exception as e:
            log.warning("live assist warm-up failed (%s)", e)
    log.info("live conversation models warm")


# --- cascade when nothing in the fixed list matched: try understanding by meaning, then by
# translating what was actually typed/said, before falling back to "pick a picture". Both are
# best-effort and never auto-send; the passenger always confirms. ------------------------------

_semantic_sim = None
_semantic_lock = threading.Lock()
SUGGEST_T1 = 0.45   # lower bar than the matcher's normal T1=0.70: this only offers a confirm


def _get_semantic_sim():
    global _semantic_sim
    with _semantic_lock:
        if _semantic_sim is None:
            from engine.matcher import make_similarity

            _semantic_sim = make_similarity("trimodal")
        return _semantic_sim


def _semantic_guess(text: str, phase: str, lang: str) -> dict | None:
    try:
        sim = _get_semantic_sim()
        result = interpret([Hypothesis(text=text)], Context(seat="x", phase=phase), lexicon, t1=SUGGEST_T1, sim=sim)
    except Exception as e:  # fastembed/model not installed or not downloaded
        log.info("semantic suggestion unavailable (%s)", e)
        return None
    if not result.cards:
        return None
    top = result.cards[0].candidates[0]
    i = lexicon.get(top.intent)
    return {"intent": top.intent, "icon": i.icon, "label": lexicon.label(top.intent, lang), "score": top.score}


def _free_text_translation(text: str, lang: str) -> str | None:
    if not free_talk_available() or lang == "ja":
        return None
    try:
        from engine.translate import translate

        return translate(text, lang, "ja")
    except Exception as e:
        log.info("free talk suggestion unavailable (%s)", e)
        return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=warm_matcher, daemon=True).start()
    if os.environ.get("AURALINK_PRELOAD_ASR") == "1":
        threading.Thread(target=get_asr, daemon=True).start()
        threading.Thread(target=get_asr, args=(PA_ASR_MODEL,), daemon=True).start()   # first PA is not slow
    threading.Thread(target=warm_live_conversation, daemon=True).start()
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

_background_tasks: set[asyncio.Task] = set()   # fire-and-forget tasks (engine/assist.py), kept
                                                 # alive so asyncio doesn't garbage-collect them mid-flight


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


passengers: dict[str, set[WebSocket]] = defaultdict(set)
crew: set[WebSocket] = set()
judges: set[WebSocket] = set()
crew_meta: dict[WebSocket, dict] = {}   # crew socket -> {"name": str, "zone": str}, set by a "hello" message

# Rows split evenly into zones (front to back) so each crew member's tablet can show "mine" first.
# "all" is not a zone itself: every crew member can always see and claim every seat.
_rows = sorted({int(s[:-1]) for s in SEAT_IDS})
ZONE_SIZE = max(1, -(-len(_rows) // 3))   # 3 zones, ~even split
CREW_ZONES = [
    {"id": chr(ord("A") + i), "rows": _rows[i * ZONE_SIZE:(i + 1) * ZONE_SIZE],
     "seats": [s for s in SEAT_IDS if int(s[:-1]) in _rows[i * ZONE_SIZE:(i + 1) * ZONE_SIZE]]}
    for i in range((len(_rows) + ZONE_SIZE - 1) // ZONE_SIZE)
]
SEAT_ZONE = {seat: z["id"] for z in CREW_ZONES for seat in z["seats"]}


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
    data["accessibility"] = cabin.seats[card.seat].accessibility
    data["zone"] = SEAT_ZONE.get(card.seat)
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
        "turbulence": cabin.turbulence,
        "exit_checks": [{**c.model_dump(), "connected": cabin.seats[c.seat].connected}
                        for c in cabin.exit_checks.values()],
        "round_plan": rounds.plan(cabin),
        "round": cabin.round,
        "pa_log": [{**a, **pa_library.caption(a["id"], "en", a.get("n"))} for a in cabin.pa_log[-5:]][::-1],
        "seat_needs": [s.model_dump(include={"id", "lang", "senior", "pictures", "read", "accessibility",
                                             "checked_in", "connected"})
                       for s in cabin.seats.values()
                       if s.lang != "en" or s.senior or s.pictures or s.read or s.accessibility],
        # Live Conversation panels open right now, so a crew tablet that reconnects mid-call still
        # knows which seats to show (conv_message itself only reaches sockets already connected).
        "conv_seats": [s.id for s in cabin.seats.values() if s.conv_mode],
        # Who else is on the crew network right now, and which zone each tablet picked, so the
        # crew can split up work between devices instead of everyone seeing one undivided queue.
        "crew_roster": [{"name": m["name"], "zone": m["zone"]} for m in crew_meta.values() if m["name"]],
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


# --- Free Talk: open-vocabulary translation for anything outside the fixed intent list -------------
# Unreviewed, unlike everything above: never used for safety briefings, exit rows or PA captions.

class FreeTalkIn(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    src: str = Field(pattern=r"^[a-z]{2,3}$")
    tgt: str = Field(pattern=r"^[a-z]{2,3}$")


@app.post("/api/freetalk/translate")
def freetalk_translate(body: FreeTalkIn) -> dict:
    from engine.translate import translate

    if body.src == body.tgt:
        return {"translated": body.text, "src": body.src, "tgt": body.tgt}
    try:
        t0 = time.perf_counter()
        translated = translate(body.text, body.src, body.tgt)
        return {"translated": translated, "src": body.src, "tgt": body.tgt,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # model not downloaded yet, no network on first use, ctranslate2/transformers missing
        log.warning("free talk translation unavailable (%s)", e)
        raise HTTPException(503, "Free Talk is not ready on this hub yet (model still downloading or missing)") from e


class FreeTalkSpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    lang: str = Field(pattern=r"^[a-z]{2,3}$")


@app.post("/api/freetalk/speak")
def freetalk_speak(body: FreeTalkSpeakIn) -> Response:
    from engine.tts import synthesize

    try:
        wav = synthesize(body.text, body.lang)
    except Exception as e:  # model files missing, kokoro-onnx not installed
        log.warning("free talk TTS unavailable (%s)", e)
        raise HTTPException(503, "Free Talk voice is not ready on this hub yet") from e
    if wav is None:  # Kokoro has no voice for this language; caller falls back to the browser's own voice
        raise HTTPException(422, f"no Free Talk voice for language {body.lang!r}")
    return Response(content=wav, media_type="audio/wav")


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


@app.get("/api/crew/briefing", dependencies=CREW)
async def crew_briefing() -> dict:
    """On-demand, read-only: a couple of plain-English sentences on what needs attention right
    now, from engine/assist.py's local LLM. Built only from facts the crew screen already shows
    (open requests, how long they've waited, accessibility-flagged seats that have gone quiet) --
    this never creates, changes or closes anything, so a bad summary costs a wasted glance, never
    a wrong action."""
    now = time.time()
    facts = []
    for c in cabin.crew_cards():
        age_min = int((now - c.created_at) // 60)
        what = (lexicon.get(c.intent).label.get("en", c.intent) if c.intent
                else c.translated or "an unclear request")
        facts.append(f"seat {c.seat}: {'URGENT, ' if c.urgent else ''}{what}, "
                     f"{'acknowledged' if c.status == 'acknowledged' else 'not yet acknowledged'}, "
                     f"{age_min} min ago")
    care_after_min = rounds.care_after_s() / 60
    for sid, seat in cabin.seats.items():
        if seat.accessibility and (seat.connected or seat.checked_in):
            quiet_min = int((now - cabin.last_visit.get(sid, cabin.started_at)) // 60)
            if quiet_min >= care_after_min:
                facts.append(f"seat {sid}: {ACCESSIBILITY_LABEL_EN[seat.accessibility]}, "
                             f"no contact for {quiet_min} min")
    summary = await asyncio.to_thread(assist.summarize, facts) if assist.available() and facts else None
    return {"summary": summary, "facts": facts}


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
        await handle_crew(None, msg)
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
    accessibility: str | None = None


@app.post("/api/checkin")
async def post_checkin(body: CheckinIn) -> dict:
    """Airport / boarding gate: set how this seat's screen opens. Seat and preferences only, no names."""
    if body.seat not in cabin.seats:
        raise HTTPException(404, f"No seat {body.seat}")
    if body.lang not in languages.codes():
        raise HTTPException(422, f"Unknown language {body.lang!r}")
    if body.accessibility not in (None, *ACCESSIBILITY_PROFILES):
        raise HTTPException(422, f"Unknown accessibility profile {body.accessibility!r}")
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
            ("&mode=pictures" if body.pictures else "") + ("&read=1" if body.read else "") + \
            (f"&accessibility={body.accessibility}" if body.accessibility else "")
    return {"seat": body.seat, **prefs, "passenger_path": f"/passenger?{query}"}


@app.get("/api/seat/{seat}")
def get_seat(seat: str) -> dict:
    """What a seat's screen should open with (set at check-in, or by the passenger last time)."""
    if seat not in cabin.seats:
        raise HTTPException(404, f"No seat {seat}")
    return cabin.seats[seat].model_dump(include={"lang", "senior", "pictures", "read", "checked_in", "accessibility"})


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
        "free_talk": free_talk_available(),
        "live_assist": assist.available(),
        "accessibility_profiles": list(ACCESSIBILITY_PROFILES),
        "crew_zones": [{"id": z["id"], "seats": z["seats"]} for z in CREW_ZONES],
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
                    if cabin.seats[seat].conv_mode:
                        raw = frame["bytes"]   # 1-byte tag (0 final, 1 still-speaking partial) + PCM
                        await handle_conv_audio(seat, raw[1:], final=not raw or raw[0] == 0)
                    else:
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
    result, cards, escalated = cabin.handle_text(seat, text, nbest, source="voice" if asr else "text",
                                                 voice_stress=(asr or {}).get("voice_stress", 0.0))
    if asr:
        result.latency_ms = {**asr["latency_ms"], **result.latency_ms}
    if judges:
        from engine.matcher import default_similarity

        why = explain(result, lexicon, default_similarity(), cabin.phase, audio=asr and asr.get("audio"),
                      speech=asr and asr.get("speech"), rejected=asr and asr["rejected"])
        await _send(judges, {"type": "result", "seat": seat, "source": "voice" if asr else "text",
                             "phase": cabin.phase, "result": result.model_dump(), "explain": why,
                             "voice_stress": asr and asr.get("voice_stress")})
    if cards:
        await to_seat(seat, {"type": "confirm", "rule": result.rule,
                             "cards": [card_for_passenger(c, s.lang) for c in cards]})
    elif escalated:
        await send_status(escalated, "needs_human")
    elif len(tokenize(text)) >= 2:   # a single word ("hi", "hmm") isn't enough to guess or translate
        guess, translated = await asyncio.gather(
            asyncio.to_thread(_semantic_guess, text, cabin.phase, s.lang),
            asyncio.to_thread(_free_text_translation, text, s.lang),
        )
        if guess or translated:
            await to_seat(seat, {"type": "suggest", "heard": text, "guess": guess, "translated": translated})
        else:
            await to_seat(seat, {"type": "grid", "reason": result.rule})
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
    from engine.prosody import analyze as analyze_prosody

    stress = await asyncio.to_thread(analyze_prosody, audio)
    await interpret_and_reply(seat, top, tr.hypotheses or [Hypothesis(text="")],
                              asr={"latency_ms": tr.latency_ms, "rejected": tr.rejected,
                                   "audio": audio, "speech": tr.speech, "voice_stress": stress.score})
    await push_crew()


# --- Live Conversation: a free-running, two-way, streaming-translated chat between one seat and
# crew. Unreviewed, like Free Talk's suggest cascade — shown with that same label, never used for
# safety content. Turned on per seat with {type: "conv_start"}; while on, that seat's audio frames
# go here instead of the intent matcher (see passenger_ws's dispatch, above). -------------------

_conv_ids = itertools.count(1)


async def _stream_translate_to(text: str, src: str, tgt: str, send) -> str | None:
    """Runs engine.translate.translate_stream (sync, callback-driven) in a background thread and
    awaits send(partial) for each token as it arrives, bridging it onto the event loop."""
    from engine.translate import translate_stream

    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    def worker() -> None:
        try:
            for partial in translate_stream(text, src, tgt):
                loop.call_soon_threadsafe(q.put_nowait, partial)
        except Exception as e:  # model unavailable, bad language code
            loop.call_soon_threadsafe(q.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)

    threading.Thread(target=worker, daemon=True).start()
    last: str | None = None
    while (item := await q.get()) is not None:
        if isinstance(item, Exception):
            raise item
        last = item
        await send(last)
    return last


async def handle_conv_text(seat: str, sender: str, text: str) -> None:
    """One Live Conversation turn (typed by crew, or transcribed from passenger audio), streamed
    through translation to both sides as it decodes, token by token."""
    if not text.strip():
        return
    s = cabin.seats[seat]
    src, tgt = ("ja", s.lang) if sender == "crew" else (s.lang, "ja")
    mid = f"m{next(_conv_ids)}"

    async def send(partial: str, done: bool = False) -> None:
        msg = {"type": "conv_message", "seat": seat, "id": mid, "from": sender,
              "original": text, "translated": partial, "done": done,
              # lets the passenger's own screen decide whether to also speak its own line out
              # loud: only worth it solo-testing with no crew tablet actually listening, since a
              # connected crew tablet already speaks it (see app/passenger/page.jsx onMessage).
              "crew_listening": bool(crew)}
        await to_seat(seat, msg)
        await _send(crew, msg)

    try:
        final = await _stream_translate_to(text, src, tgt, send)
    except Exception as e:
        log.warning("live conversation translation failed (%s)", e)
        final = None
    await send(final, done=True)
    if sender == "passenger":
        _spawn(maybe_auto_file_from_conv(seat, text, s.lang))


_conv_suggested: dict[str, dict[str, float]] = defaultdict(dict)   # seat -> intent -> last-suggested time
SUGGEST_COOLDOWN_S = 3 * 60   # don't re-pop the same suggestion every time it comes up again in one chat


async def maybe_auto_file_from_conv(seat: str, text: str, lang: str) -> None:
    """Live Conversation assist (engine/assist.py): if the passenger's turn clearly asked for
    something already on the fixed request list, ask -- the same "did you mean...?" popup Free
    Talk already shows for typed text (showSuggest in app/passenger/page.jsx), never files
    anything on its own. Only the passenger's own tap (type: "icon") turns it into a real request,
    so a wrong guess costs one ignored popup, not a card crew wastes a trip on.
    Runs after the turn is already on screen, so a slow or unavailable model never delays the chat."""
    if not assist.available():
        return
    try:
        from engine.translate import translate

        en_text = text if lang == "en" else await asyncio.to_thread(translate, text, lang, "en")
    except Exception:
        en_text = text
    intent = await asyncio.to_thread(assist.classify, en_text, [i.id for i in lexicon.intents])
    if not intent:
        return
    if time.time() - _conv_suggested[seat].get(intent, 0.0) < SUGGEST_COOLDOWN_S:
        return
    _conv_suggested[seat][intent] = time.time()
    i = lexicon.get(intent)
    guess = {"intent": intent, "icon": i.icon, "label": lexicon.label(intent, lang), "score": 1.0}
    await to_seat(seat, {"type": "suggest", "heard": text, "guess": guess, "translated": None})


async def handle_conv_audio(seat: str, pcm: bytes, final: bool = True) -> None:
    """`final=False`: the passenger is still talking — this is a quick re-transcribe of the
    utterance so far, shown only on their own screen as a live caption (never sent to crew,
    never translated). `final=True`: the real turn, same as before: transcribe, then
    handle_conv_text streams it through translation to both sides."""
    import numpy as np

    if len(pcm) > MAX_AUDIO_S * 16_000 * 2:
        if not final:
            return   # a stale partial for an utterance that has since run long; the final will 400 as before
        raise ValueError(f"utterance longer than {MAX_AUDIO_S} s")
    audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768
    try:
        tr = await asyncio.to_thread(run_asr, audio, languages.asr_languages(cabin.seats[seat].lang))
    except ImportError:
        if final:
            await to_seat(seat, {"type": "error", "detail": "voice unavailable: faster-whisper not installed"})
        return
    text = tr.hypotheses[0].text if tr.hypotheses else ""
    if not final:
        if text:
            await to_seat(seat, {"type": "conv_partial", "seat": seat, "text": text})
        return
    if text:
        await handle_conv_text(seat, "passenger", text)


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
        acc = msg.get("accessibility", s.accessibility)
        s.accessibility = acc if acc in (None, *ACCESSIBILITY_PROFILES) else s.accessibility

    elif kind == "text":
        await interpret_and_reply(seat, msg.get("text", ""))

    elif kind == "icon":
        if msg.get("card_id"):
            card = cabin.confirm(msg["card_id"], msg["intent"])
        else:
            card = cabin.icon_request(seat, msg["intent"], source=msg.get("source", "picture"))
        await send_status(card, "urgent" if card.urgent else "sent")
        await ask_symptom(card)

    elif kind == "confirm":
        card = cabin.confirm(msg["card_id"], msg["intent"])
        await send_status(card, "urgent" if card.urgent else "sent")
        await ask_symptom(card)

    elif kind == "send_free_text":
        card = cabin.escalate_free_text(seat, msg.get("text", ""), msg.get("translated"))
        await send_status(card, "needs_human")

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

    elif kind == "conv_start":
        s.conv_mode = True
        await _send(crew, {"type": "conv_state", "seat": seat, "open": True})

    elif kind == "conv_end":
        s.conv_mode = False
        await _send(crew, {"type": "conv_state", "seat": seat, "open": False})

    await push_crew()


@app.websocket("/ws/crew")
async def crew_ws(ws: WebSocket) -> None:
    if not await auth.crew_socket_ok(ws):
        return
    crew.add(ws)
    crew_meta[ws] = {"name": None, "zone": "all"}
    await ws.send_json(crew_state())
    try:
        while True:
            msg = await ws.receive_json()
            try:
                await handle_crew(ws, msg)
            except (KeyError, ValueError) as e:
                await ws.send_json({"type": "error", "detail": str(e)})
    except WebSocketDisconnect:
        crew.discard(ws)
        crew_meta.pop(ws, None)
        await push_crew()


async def handle_crew(ws: WebSocket, msg: dict) -> None:
    kind = msg.get("type")
    if kind == "hello":
        name = (msg.get("name") or "").strip()[:40]
        zone = msg.get("zone") if msg.get("zone") in {z["id"] for z in CREW_ZONES} else "all"
        crew_meta[ws] = {"name": name or None, "zone": zone}
    elif kind == "claim":
        cabin.claim(msg["card_id"], crew_meta.get(ws, {}).get("name") or "crew")
    elif kind == "release":
        cabin.release(msg["card_id"])
    elif kind == "ack":
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
    elif kind == "dismiss_turbulence":
        cabin.clear_turbulence()
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
    elif kind == "conv_text":
        await handle_conv_text(msg["seat"], "crew", msg.get("text", ""))
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


class CleanUrlStaticFiles(StaticFiles):
    """/passenger serves passenger.html (no visible extension, no redirect), still falling back
    to the normal index.html / 404.html lookup for everything else StaticFiles already handles."""

    async def get_response(self, path, scope):
        last_segment = path.rsplit("/", 1)[-1]
        if last_segment and "." not in last_segment:
            full_path, stat_result = await anyio.to_thread.run_sync(self.lookup_path, f"{path}.html")
            if stat_result and stat.S_ISREG(stat_result.st_mode):
                return self.file_response(full_path, stat_result, scope)
        return await super().get_response(path, scope)


app.mount("/", CleanUrlStaticFiles(directory=UI_DIR, html=True), name="apps")
