"""Data collection for evaluation (Member B). Volunteers record prompts on recording.html.

Privacy: no names. Each volunteer gets a random speaker code and can withdraw with it.
Files stay on the hub laptop under data/recordings/ (gitignored); share them on the team drive.

Layout:
    data/recordings/speakers.csv              one row per volunteer (profile + split)
    data/recordings/manifest.csv              one row per clip
    data/recordings/<speaker>/<prompt>_<n>.wav  16 kHz mono 16-bit
"""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
import secrets
import shutil
import threading
import time
import wave
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from engine.lexicon import ROOT

RECORDINGS_DIR = Path(os.environ.get("AURALINK_RECORDINGS_DIR", ROOT / "data" / "recordings"))
PROMPTS_FILE = ROOT / "data" / "prompts" / "recording_prompts.json"
SAMPLE_RATE = 16_000
MIN_S, MAX_S = 0.4, 12.0
QUIET_PEAK = 0.03     # below this the clip is probably silent or the mic is muted
CLIP_SHARE = 0.01     # more than 1% of samples at full scale means distorted audio

SPEAKER_FIELDS = ["speaker_id", "created_at", "age_band", "first_lang", "english_level", "device", "split"]
CLIP_FIELDS = ["file", "speaker_id", "prompt_id", "kind", "intents", "prompt_text", "environment",
               "duration_s", "peak", "split", "recorded_at"]
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I: codes are read aloud and typed

router = APIRouter(prefix="/api/recordings")
_lock = threading.Lock()


def prompts() -> list[dict]:
    return json.loads(PROMPTS_FILE.read_text("utf-8"))["prompts"]


def split_for(speaker_id: str) -> str:
    """Deterministic split by speaker, so one voice never lands in both tuning and test data."""
    bucket = int(hashlib.sha1(speaker_id.encode()).hexdigest(), 16) % 10
    return "train" if bucket < 6 else "heldout" if bucket < 8 else "test"


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _append_csv(path: Path, fields: list[str], row: dict) -> None:
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        if new:
            writer.writeheader()
        writer.writerow(row)


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _speaker(speaker_id: str) -> dict:
    for row in _read_csv(RECORDINGS_DIR / "speakers.csv"):
        if row["speaker_id"] == speaker_id:
            return row
    raise HTTPException(404, "Unknown speaker code")


class SpeakerIn(BaseModel):
    consent: bool
    age_band: Literal["18-29", "30-49", "50-64", "65+"]
    first_lang: str = Field(min_length=2, max_length=24, pattern=r"^[a-z_]+$")
    english_level: Literal["basic", "conversational", "fluent"]
    device: Literal["phone", "laptop", "other"]


class ClipIn(BaseModel):
    speaker_id: str = Field(pattern=r"^S-[A-Z2-9]{4}$")
    prompt_id: str
    environment: Literal["quiet", "some_noise", "noisy"]
    page_lang: str = Field(default="en", pattern=r"^[a-z]{2}$")   # the language the prompt was shown in
    audio_b64: str  # 16 kHz mono int16 little-endian PCM


@router.get("/prompts")
def get_prompts() -> list[dict]:
    return prompts()


@router.post("/speakers")
def create_speaker(body: SpeakerIn) -> dict:
    if not body.consent:
        raise HTTPException(400, "Consent is required before recording")
    with _lock:
        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
        taken = {r["speaker_id"] for r in _read_csv(RECORDINGS_DIR / "speakers.csv")}
        while (code := "S-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))) in taken:
            pass
        _append_csv(RECORDINGS_DIR / "speakers.csv", SPEAKER_FIELDS, {
            "speaker_id": code, "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "age_band": body.age_band, "first_lang": body.first_lang,
            "english_level": body.english_level, "device": body.device, "split": split_for(code),
        })
    return {"speaker_id": code}


@router.post("/clips")
def save_clip(body: ClipIn) -> dict:
    speaker = _speaker(body.speaker_id)
    prompt = next((p for p in prompts() if p["id"] == body.prompt_id), None)
    if prompt is None:
        raise HTTPException(404, "Unknown prompt")
    try:
        pcm = base64.b64decode(body.audio_b64, validate=True)
    except ValueError:
        raise HTTPException(400, "Audio is not valid base64") from None
    samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16)
    duration = len(samples) / SAMPLE_RATE
    # errors carry a code so the page can explain them in the volunteer's language
    if duration < MIN_S:
        raise HTTPException(422, {"code": "too_short", "message": f"Clip is {duration:.1f} s; please speak a little longer."})
    if duration > MAX_S:
        raise HTTPException(422, {"code": "too_long", "message": f"Clip is {duration:.1f} s; please keep it under {MAX_S:.0f} s."})
    peak = float(np.abs(samples.astype(np.int32)).max()) / 32768 if len(samples) else 0.0
    clipped = float(np.mean(np.abs(samples.astype(np.int32)) >= 32700))
    warning = None
    if peak < QUIET_PEAK:
        raise HTTPException(422, {"code": "silent", "message": "We could not hear anything. Check the microphone and try again."})
    if clipped > CLIP_SHARE:
        warning = "loud"

    with _lock:
        folder = RECORDINGS_DIR / body.speaker_id
        folder.mkdir(parents=True, exist_ok=True)
        take = len(list(folder.glob(f"{body.prompt_id}_*.wav"))) + 1
        path = folder / f"{body.prompt_id}_{take}.wav"
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(samples.tobytes())
        _append_csv(RECORDINGS_DIR / "manifest.csv", CLIP_FIELDS, {
            "file": str(path.relative_to(RECORDINGS_DIR)), "speaker_id": body.speaker_id,
            "prompt_id": prompt["id"], "kind": prompt["kind"], "intents": "+".join(prompt["intents"]),
            # what this volunteer actually saw (and, for read prompts, said), e.g. Devanagari or Tamil script
            "prompt_text": prompt["text"].get(body.page_lang, prompt["text"]["en"]), "environment": body.environment,
            "duration_s": round(duration, 2), "peak": round(peak, 3), "split": speaker["split"],
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
    return {"saved": path.name, "duration_s": round(duration, 2), "warning": warning}


@router.delete("/speakers/{speaker_id}")
def withdraw(speaker_id: str) -> dict:
    """A volunteer withdraws consent: remove their profile, clips and manifest rows."""
    with _lock:
        _speaker(speaker_id)
        manifest = RECORDINGS_DIR / "manifest.csv"
        kept = [r for r in _read_csv(manifest) if r["speaker_id"] != speaker_id]
        removed = len(_read_csv(manifest)) - len(kept)
        if manifest.exists():
            _write_csv(manifest, CLIP_FIELDS, kept)
        speakers = RECORDINGS_DIR / "speakers.csv"
        _write_csv(speakers, SPEAKER_FIELDS, [r for r in _read_csv(speakers) if r["speaker_id"] != speaker_id])
        shutil.rmtree(RECORDINGS_DIR / speaker_id, ignore_errors=True)
    return {"withdrawn": speaker_id, "clips_removed": removed}


@router.get("/stats")
def stats() -> dict:
    clips = _read_csv(RECORDINGS_DIR / "manifest.csv")
    speakers = _read_csv(RECORDINGS_DIR / "speakers.csv")

    def count(rows: list[dict], key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for r in rows:
            k = r[key] or "none"  # prompts with no intent are the false-alarm checks
            out[k] = out.get(k, 0) + 1
        return dict(sorted(out.items()))

    return {
        "clips": len(clips),
        "speakers": len(speakers),
        "minutes": round(sum(float(r["duration_s"]) for r in clips) / 60, 1),
        "by_intent": count(clips, "intents"),
        "by_age": count(speakers, "age_band"),
        "by_first_lang": count(speakers, "first_lang"),
        "by_split": count(speakers, "split"),
    }
