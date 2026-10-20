"""Glass-box explanation of one interpretation, for the "Under the hood" screen (judge.html)."""
from __future__ import annotations

import numpy as np

from engine import Lexicon, Result
from engine.matcher import T1, T2, URGENT_FLOOR, is_filler, tokenize

# deck slide 4 latency targets
TARGETS_MS = {"speech_to_text": 1500, "match": 100}
RULE_TEXT = {
    "confident": "One clear request. The passenger confirms it with a single tap.",
    "split": "Several clear requests in one sentence, so each becomes its own card.",
    "close": "Two meanings scored within t2 of each other, so Auralink asks with big pictures instead of guessing.",
    "flat": "Nothing scored above t1, so Auralink shows the picture grid instead of guessing.",
    "empty": "No usable speech, so Auralink shows the picture grid.",
}


def envelope(audio: np.ndarray, bins: int = 160) -> list[float]:
    """Peak level per bin, 0..1, for drawing the waveform."""
    if len(audio) == 0:
        return []
    edges = np.linspace(0, len(audio), bins + 1, dtype=int)
    return [round(float(np.abs(audio[a:b]).max()) if b > a else 0.0, 3) for a, b in zip(edges[:-1], edges[1:])]


def explain(result: Result, lex: Lexicon, sim, phase: str, audio: np.ndarray | None = None,
            speech: list[tuple[int, int]] | None = None, rejected: str | None = None) -> dict:
    top_text = result.nbest[0].text if result.nbest else ""
    tokens = tokenize(top_text)
    can_explain = hasattr(sim, "explain")

    cards = []
    for d in result.cards:
        cands = []
        for k, c in enumerate(d.candidates):
            prior = lex.prior(c.intent, phase)
            entry = {"intent": c.intent, "label": lex.label(c.intent, "en"), "label_ja": lex.label(c.intent, "ja"),
                     "score": c.score, "raw": round(c.score / prior, 3), "prior": prior,
                     "heard": c.heard, "matched": c.matched, "urgent": lex.is_urgent(c.intent)}
            if can_explain and k < 2:
                entry["detail"] = sim.explain(c.heard, c.matched)
            cands.append(entry)
        margin = round(d.candidates[0].score - d.candidates[1].score, 3) if len(d.candidates) > 1 else None
        cards.append({"span": d.span, "status": d.status, "urgent": d.urgent, "margin": margin, "candidates": cands})

    lat = dict(result.latency_ms)
    stt = sum(v for k, v in lat.items() if k in ("vad", "encode") or k.startswith("decode_"))
    waveform = None
    if audio is not None and len(audio):
        waveform = {"peaks": envelope(audio), "seconds": round(len(audio) / 16_000, 2),
                    "speech": [[round(a / len(audio), 4), round(b / len(audio), 4)] for a, b in (speech or [])]}

    return {
        "phase": phase,
        "matcher": getattr(sim, "name", "text"),
        "thresholds": {"t1": T1, "t2": T2, "urgent": URGENT_FLOOR},
        "rule": result.rule,
        "rule_text": RULE_TEXT[result.rule],
        "urgent": result.urgent,
        "rejected": rejected,
        "nbest": [{"text": h.text, "conf": h.conf, "lang": h.lang} for h in result.nbest if h.text],
        "tokens": [{"text": t, "filler": is_filler(t, lex, sim)} for t in tokens],
        "cards": cards,
        "best_guesses": [{"intent": c.intent, "score": c.score} for c in result.best_guesses],
        "latency_ms": lat,
        "stages": {"speech_to_text": round(stt, 1) if stt else None, "match": lat.get("match")},
        "targets_ms": TARGETS_MS,
        "waveform": waveform,
    }
