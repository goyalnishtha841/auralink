"""Free Talk voice output: Kokoro, an 82M-parameter offline text-to-speech model, far more
natural than the phone's own OS voice (used elsewhere via apps/speech.js for pre-approved
templates) but only worth the extra weight for Free Talk's open-ended, longer sentences.

Kokoro only covers a handful of languages well (English, Japanese, Hindi, Mandarin, Spanish,
French, Italian, Portuguese) via eSpeak-NG phonemisation, already installed for the phonetic
matcher. For a language Kokoro doesn't cover (Tamil, Thai), `voice_for()` returns None and the
caller falls back to the browser's own offline voice, exactly like the rest of Auralink.

Model files (not committed; downloaded once, then offline):
    data/tts/kokoro-v1.0.onnx   (~326 MB)
    data/tts/voices-v1.0.bin    (~28 MB)
    https://github.com/thewh1teagle/kokoro-onnx/releases/model-files-v1.0

Requires `pip install kokoro-onnx`.
"""
from __future__ import annotations

import io
import logging
import threading
import wave

from .lexicon import ROOT

log = logging.getLogger("auralink.tts")

MODEL_PATH = ROOT / "data" / "tts" / "kokoro-v1.0.onnx"
VOICES_PATH = ROOT / "data" / "tts" / "voices-v1.0.bin"

# One Kokoro voice per Auralink language it actually supports well. Picked for a plain, clear
# read rather than a character voice; swap any of these once native speakers have a preference.
VOICE = {
    "en": ("af_heart", "en-us"),
    "hi": ("hf_alpha", "hi"),
    "ja": ("jf_alpha", "ja"),
    "zh": ("zf_xiaoxiao", "cmn"),
    "es": ("ef_dora", "es"),
    "fr": ("ff_siwis", "fr-fr"),
    "it": ("if_sara", "it"),
    "pt": ("pf_dora", "pt-br"),
    # Bengali, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi: no Kokoro voice for these
    # (see the module docstring's language list). voice_for() returns None for them, same as
    # Tamil/Thai, and the caller falls back to the browser's own offline voice.
}

_shared = None
_shared_lock = threading.Lock()


def _model():
    global _shared
    with _shared_lock:
        if _shared is None:
            from kokoro_onnx import Kokoro

            _shared = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
        return _shared


def available() -> bool:
    try:
        import kokoro_onnx  # noqa: F401
    except ImportError:
        return False
    return MODEL_PATH.exists() and VOICES_PATH.exists()


def voice_for(lang: str) -> tuple[str, str] | None:
    return VOICE.get(lang)


def synthesize(text: str, lang: str) -> bytes | None:
    """text in `lang` -> a 16-bit mono WAV, or None if Kokoro has no voice for this language
    (the caller should fall back to the browser's own offline voice, as the rest of the app does)."""
    pair = voice_for(lang)
    if pair is None or not text.strip():
        return None
    voice, kokoro_lang = pair
    samples, sample_rate = _model().create(text, voice=voice, lang=kokoro_lang)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes((samples * 32767).astype("int16").tobytes())
    return buf.getvalue()
