"""Semantic similarity: catches paraphrases that share no sound or spelling with any lexicon
word ("I haven't eaten since this morning" -> food, "mujhe bahut bhookh lagi hai" -> food).

A small multilingual sentence embedding model (~50 languages, 90 MB ONNX, no torch) turns both
the heard text and each lexicon variant into a vector; cosine similarity between the two is the
score. Downloaded once into the Hugging Face cache on first use, like the Whisper model, then
runs fully offline. Requires `pip install fastembed`.

This is the weakest of the three signals on short, single-word variants (eSpeak phonemes and
edit distance are more precise there), so it is blended in as a minority vote by
matcher.TriSimilarity rather than used alone. See engine/matcher.py: AURALINK_MATCHER=trimodal.
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("auralink.semantic")

MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

_shared = None
_shared_lock = threading.Lock()


def _model():
    global _shared
    with _shared_lock:
        if _shared is None:
            from fastembed import TextEmbedding  # heavy import: only paid when semantic matching is used

            _shared = TextEmbedding(model_name=MODEL_NAME)
        return _shared


def _cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


class SemanticSimilarity:
    """similarity(heard, variant) -> 0..1, same contract as matcher.similarity."""

    def __init__(self):
        self.name = "semantic"
        self._cache: dict[str, tuple] = {}

    def _vec(self, text: str):
        v = self._cache.get(text)
        if v is None:
            v = tuple(float(x) for x in next(_model().embed([text])))
            self._cache[text] = v
        return v

    def warm(self, texts: list[str]) -> None:
        """Embed every not-yet-seen text in one batched model call instead of hundreds of single ones."""
        todo = sorted({t for t in texts if t and t not in self._cache})
        if not todo:
            return
        for t, v in zip(todo, _model().embed(todo)):
            self._cache[t] = tuple(float(x) for x in v)

    def __call__(self, heard: str, variant: str) -> float:
        if heard == variant:
            return 1.0
        if not heard.strip() or not variant.strip():
            return 0.0
        return max(0.0, min(1.0, _cosine(self._vec(heard), self._vec(variant))))

    def explain(self, heard: str, variant: str) -> dict:
        return {"cosine": round(self(heard, variant), 3), "model": MODEL_NAME}
