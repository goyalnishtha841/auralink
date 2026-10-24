"""Live Conversation assist: a small local LLM that watches the passenger's side of a Live
Conversation turn and, when it clearly states something already on Auralink's fixed request list
(water, a blanket, feeling unwell...), hands back that intent id so the hub can file it as a normal
request card -- exactly the card a crew member would get from the tap-a-picture flow, with the same
review and reply buttons. It never writes anything a passenger or crew member reads and is never
asked to invent a new kind of request: its only output is one id from a fixed list, or "none", so a
bad guess is a missed or spurious request, never a wrong instruction put in front of anyone.

This is the one place in Auralink that runs a general-purpose LLM, by design: Free Talk and Live
Conversation's own translation (engine/translate.py) are dedicated, narrow models with no reasoning
to get wrong. Keeping this piece's output constrained to the existing, reviewed intent list is what
makes it safe to add without weakening that guarantee.

Model: Qwen2.5-1.5B-Instruct, 4-bit, via MLX (Apple Silicon only -- CPU/GPU on the Mac's own chip,
no separate runtime to install). The smaller 0.5B checkpoint was tried first and dropped: on this
one-word classification task it flipped between false positives ("how long until we land?" ->
meal) and false negatives (a clear "my head hurts and I feel dizzy" -> none) depending on tiny
prompt changes -- too unreliable for something that pops a confirm in front of a passenger. 1.5B
is consistent on the same test sentences. Opt-out like Free Talk: AURALINK_LIVE_ASSIST=0 hides it
even when the dependency and model are there, for a laptop that would rather keep the RAM for
Whisper, translation and voice.

    pip install mlx-lm
    python -c "from huggingface_hub import snapshot_download as d; \
               d('mlx-community/Qwen2.5-1.5B-Instruct-4bit')"   # ~1 GB, once

Downloads into the Hugging Face cache on first use, then runs fully offline, like the other models.
"""
from __future__ import annotations

import logging
import os
import re
import threading

log = logging.getLogger("auralink.assist")

MODEL_REPO = "mlx-community/Qwen2.5-1.5B-Instruct-4bit"
ASSIST_ENABLED = os.environ.get("AURALINK_LIVE_ASSIST", "1") != "0"

_shared = None
_shared_lock = threading.Lock()


def _model():
    global _shared
    with _shared_lock:
        if _shared is None:
            from mlx_lm import load

            _shared = load(MODEL_REPO)
        return _shared


def available() -> bool:
    """True if the assist can run right now, without starting a (possibly 300 MB, first-time)
    download: the library is importable AND the model is already fully cached locally."""
    if not ASSIST_ENABLED:
        return False
    try:
        import mlx_lm  # noqa: F401
        from huggingface_hub import snapshot_download

        snapshot_download(MODEL_REPO, local_files_only=True)
    except Exception:
        return False
    return True


# Few-shot, not zero-shot: the plain instruction alone was the biggest source of the 0.5B model's
# mistakes (see the module docstring); showing both a couple of real matches and a couple of
# deliberate "none"s (small talk, a yes/no answer, a question back to crew) cut false positives on
# every small model tried, including this one.
SYSTEM_PROMPT = """You classify one line from an airline passenger into exactly one label from \
this list, or "none" if it does not ask for any of them:
{intents}
Greetings, thanks, small talk, yes/no answers, and questions the passenger asks crew are always \
"none".
Examples:
Sentence: "Can I get a blanket please" -> blanket
Sentence: "My head hurts and I feel dizzy" -> medical
Sentence: "Thank you so much for your help" -> none
Sentence: "Yes that is correct" -> none
Sentence: "How long until we land?" -> none
Answer with only the label word, nothing else."""


def classify(text: str, intent_ids: list[str]) -> str | None:
    """`text`: the passenger's turn (already transcribed, in whatever language -- callers should
    translate to English first for a model this size; see hub/main.py maybe_auto_file_from_conv).
    Returns one id from `intent_ids`, or None -- for nothing on the list, or on any failure. Never
    raises: a classification miss should never interrupt or crash the conversation it is watching."""
    if not text.strip():
        return None
    try:
        from mlx_lm import generate

        model, tokenizer = _model()
        system = SYSTEM_PROMPT.format(intents=", ".join(intent_ids))
        user = f'Sentence: "{text.strip().replace(chr(34), chr(39))}"\nLabel:'
        rendered = tokenizer.apply_chat_template(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            add_generation_prompt=True, tokenize=False,
        )
        out = generate(model, tokenizer, prompt=rendered, max_tokens=6, verbose=False)
    except Exception as e:  # model unavailable, or a generation error -- never block the call
        log.warning("live assist classify failed (%s)", e)
        return None
    match = re.search(r"[a-z_]+", out.lower())
    word = match.group(0) if match else ""
    return word if word in intent_ids else None


BRIEFING_SYSTEM = """You help cabin crew get the state of the cabin in one glance. You are given \
short facts, one per line, already pulled from the real request system -- never invent, add or \
guess anything beyond them. Write 1-2 short plain-English sentences a busy crew member can read in \
two seconds: what needs attention first (urgent and overdue items), then a brief total. No \
greeting, no "here is a summary", just the sentences."""


def summarize(facts: list[str]) -> str | None:
    """`facts`: short English bullet-style lines already derived from the cabin's real state
    (hub/main.py crew_briefing) -- e.g. "31C: urgent, possible medical, unacknowledged for 4 min".
    Returns a short plain-English summary, or None on no facts or any failure. Read-only and
    advisory: this never creates, changes or closes anything, only describes what's already there."""
    if not facts:
        return None
    try:
        from mlx_lm import generate

        model, tokenizer = _model()
        user = "Facts:\n" + "\n".join(f"- {f}" for f in facts)
        rendered = tokenizer.apply_chat_template(
            [{"role": "system", "content": BRIEFING_SYSTEM}, {"role": "user", "content": user}],
            add_generation_prompt=True, tokenize=False,
        )
        out = generate(model, tokenizer, prompt=rendered, max_tokens=120, verbose=False)
    except Exception as e:
        log.warning("live assist summarize failed (%s)", e)
        return None
    return out.strip() or None
