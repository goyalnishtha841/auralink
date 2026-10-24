"""Free Talk: open-vocabulary offline translation, for anything outside the fixed intent list.

Unlike the Phonetic Intent Matcher (engine/matcher.py), this never decides what a passenger or
crew member needs — it only turns text from one language into another. It is explicitly the
*unreviewed* tier: the hub tags every Free Talk message "machine-translated, not reviewed" and
never uses it for safety briefings, exit-row checks or PA captions, which stay on the
pre-approved template system.

Model: NLLB-200 distilled 600M, the smallest official NLLB checkpoint, run through CTranslate2
(already a dependency via faster-whisper) at compute_type="int8" for speed and memory, the same
pattern engine/asr.py uses for Whisper. No torch: tokenisation uses `transformers`' fast
(Rust-backed) tokenizer, which does not need a torch backend for text-only use.

    pip install transformers
    python -c "from huggingface_hub import snapshot_download as d; \
               d('entai2965/nllb-200-distilled-600M-ctranslate2')"   # ~2.4 GB, once

Requires `pip install ctranslate2 transformers` (ctranslate2 is already pulled in by
faster-whisper). Downloads the model into the Hugging Face cache on first use, then runs
fully offline, like the Whisper model.
"""
from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Iterator

log = logging.getLogger("auralink.translate")

MODEL_REPO = "entai2965/nllb-200-distilled-600M-ctranslate2"

# NLLB-200 language codes for the languages Auralink already supports (data/languages.json)
# plus Japanese, the crew's language. Add here, not per-caller, when a language is added.
NLLB_LANG = {
    "en": "eng_Latn", "hi": "hin_Deva", "ta": "tam_Taml", "th": "tha_Thai", "ja": "jpn_Jpan",
    "zh": "zho_Hans", "es": "spa_Latn", "fr": "fra_Latn", "it": "ita_Latn", "pt": "por_Latn",
    "bn": "ben_Beng", "te": "tel_Telu", "mr": "mar_Deva", "gu": "guj_Gujr", "kn": "kan_Knda",
    "ml": "mal_Mlym", "pa": "pan_Guru",
}

_shared = None
_shared_lock = threading.Lock()


def _load():
    global _shared
    with _shared_lock:
        if _shared is None:
            import ctranslate2
            from huggingface_hub import snapshot_download
            from transformers import AutoTokenizer

            path = snapshot_download(MODEL_REPO)
            translator = ctranslate2.Translator(path, device="cpu", compute_type="int8")
            tokenizer = AutoTokenizer.from_pretrained(path)
            _shared = (translator, tokenizer)
        return _shared


def available() -> bool:
    """True if translation can run right now, without starting a (possibly 2+ GB, first-time)
    download: the libraries are importable AND the model is already fully cached locally."""
    try:
        import ctranslate2  # noqa: F401
        from huggingface_hub import snapshot_download
        from transformers import AutoTokenizer  # noqa: F401

        snapshot_download(MODEL_REPO, local_files_only=True)
    except Exception:
        return False
    return True


def translate(text: str, src: str, tgt: str) -> str:
    """text in language `src` (an Auralink language code) -> text in language `tgt`.

    Raises KeyError for a language Auralink doesn't have an NLLB code for yet, and whatever
    ctranslate2/huggingface_hub raise on a genuine load or network failure (no cached model,
    no internet, on first use). Callers decide how to surface that; this module never guesses.
    """
    if src not in NLLB_LANG:
        raise KeyError(f"no NLLB code for language {src!r}")
    if tgt not in NLLB_LANG:
        raise KeyError(f"no NLLB code for language {tgt!r}")
    if not text.strip():
        return ""
    translator, tokenizer = _load()
    tokenizer.src_lang = NLLB_LANG[src]
    source = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))
    target_prefix = [NLLB_LANG[tgt]]
    result = translator.translate_batch([source], target_prefix=[target_prefix], beam_size=4)
    out_tokens = result[0].hypotheses[0][1:]  # drop the forced target-language prefix token
    return tokenizer.decode(tokenizer.convert_tokens_to_ids(out_tokens), skip_special_tokens=True).strip()


def translate_stream(text: str, src: str, tgt: str) -> Iterator[str]:
    """Like translate(), but yields the growing translation token by token, for a live
    conversation panel that shows text arriving rather than popping in all at once.

    CTranslate2 only supports a per-token callback at beam_size=1 (greedy, not beam search), so
    streamed translations are greedy-decoded — a small quality tradeoff against translate()'s
    beam_size=4, made for the UI feeling alive during a conversation; not used for anything
    requiring translate()'s best accuracy. The callback itself runs on CTranslate2's own worker
    thread, so this generator bridges it to the calling thread with a plain queue.Queue (fine for
    a single utterance at a time: the hub serialises passenger audio per seat already).
    """
    if src not in NLLB_LANG:
        raise KeyError(f"no NLLB code for language {src!r}")
    if tgt not in NLLB_LANG:
        raise KeyError(f"no NLLB code for language {tgt!r}")
    if not text.strip():
        return
    translator, tokenizer = _load()
    tokenizer.src_lang = NLLB_LANG[src]
    source = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))
    target_prefix = [NLLB_LANG[tgt]]

    q: queue.Queue = queue.Queue()
    tokens: list[str] = []

    def on_token(step) -> bool:
        tokens.append(step.token)
        partial = tokenizer.decode(tokenizer.convert_tokens_to_ids(tokens), skip_special_tokens=True).strip()
        q.put(partial)
        return False  # never ask CTranslate2 to stop early

    def run() -> None:
        try:
            translator.translate_batch([source], target_prefix=[target_prefix], beam_size=1, callback=on_token)
        finally:
            q.put(None)  # sentinel: decoding finished (or raised; either way, stop waiting)

    threading.Thread(target=run, daemon=True).start()
    while (item := q.get()) is not None:
        yield item
