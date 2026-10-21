"""Passenger languages as data (data/languages.json + data/i18n/<code>.json). No code change to add one."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from engine.lexicon import ROOT

LANGUAGES_FILE = ROOT / "data" / "languages.json"
I18N_DIR = ROOT / "data" / "i18n"

router = APIRouter(prefix="/api")


def registry() -> list[dict]:
    return json.loads(LANGUAGES_FILE.read_text("utf-8"))["languages"]


def codes() -> set[str]:
    return {lang["code"] for lang in registry()}


def asr_languages(code: str) -> tuple[str, ...]:
    """Which languages Whisper should decode for a passenger who chose `code`."""
    for lang in registry():
        if lang["code"] == code:
            return tuple(lang["asr"])
    return ("en", "hi")


def strings(code: str) -> dict:
    """Screen text for `code`, with English filling any missing keys."""
    def load(c: str) -> dict:
        path = I18N_DIR / f"{c}.json"
        return {k: v for k, v in json.loads(path.read_text("utf-8")).items() if not k.startswith("_")} if path.exists() else {}
    return {**load("en"), **load(code)}


@router.get("/i18n/{code}")
def get_strings(code: str) -> dict:
    if code not in codes():
        raise HTTPException(404, f"Unknown language {code!r}. Add it to data/languages.json.")
    return strings(code)
