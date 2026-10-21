"""Phonetic similarity for the Phonetic Intent Matcher (deck slide 3). OWNER: Member A.

Words become phoneme sequences with eSpeak-NG (Hindi voice for Devanagari, English voice
for Latin script), then are compared with a weighted edit distance whose costs come from
data/lexicon/phone_costs.json. So "wotter" ≈ "water", "kambal" ≈ "कंबल" and
"shochale" ≈ "शौचालय", without any per-word spelling rules.

Requires `brew install espeak-ng` (or apt install espeak-ng) and `pip install phonemizer`.
"""
from __future__ import annotations

import json
import os
import re
import threading
from functools import lru_cache
from pathlib import Path

from .lexicon import ROOT

COSTS_FILE = ROOT / "data" / "lexicon" / "phone_costs.json"
LANGUAGES_FILE = ROOT / "data" / "languages.json"
_VOWEL_CHARS = set("aeiouyɑæʌɐəɛɪɔʊɚɜøœɒɤɯʉ")


def script_voices() -> list[tuple[re.Pattern, str]]:
    """(character range, eSpeak voice) per writing system, from data/languages.json. Latin script -> English."""
    data = json.loads(LANGUAGES_FILE.read_text("utf-8"))
    return [(re.compile("[" + re.escape(chr(int(s["from"], 16))) + "-" + re.escape(chr(int(s["to"], 16))) + "]"),
             s["espeak"]) for s in data["scripts"]]
_STRIP = str.maketrans("", "", "ːʰ̃ʲˑ")
_SPLIT = {"ɚ": ("ə", "r"), "ɝ": ("ɜ", "r"), "əl": ("ə", "l"), "ɹ": ("r",), "ɡ": ("g",), "ɫ": ("l",)}
_LIBS = ["/opt/homebrew/lib/libespeak-ng.dylib", "/usr/local/lib/libespeak-ng.dylib",
         "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1", "/usr/lib/aarch64-linux-gnu/libespeak-ng.so.1"]


class Costs:
    """Substitution and insertion/deletion costs between normalised phones."""

    def __init__(self, data: dict | None):
        self.uniform = data is None
        data = data or {}
        self.default_sub = data.get("default_sub", 1.0)
        self.default_indel = data.get("default_indel", 1.0)
        self.vowel_sub = data.get("vowel_sub", 1.0)
        self.vowel_indel = data.get("vowel_indel", 1.0)
        self.vowel_group_sub = data.get("vowel_group_sub", 1.0)
        self.vowel_groups = [set(g) for g in data.get("vowel_groups", [])]
        self.indel_costs = data.get("indel", {})
        self.pairs: dict[frozenset, float] = {}
        self.reasons: dict[frozenset, str] = {}
        for g in data.get("groups", []):
            for a in g["phones"]:
                for b in g["phones"]:
                    if a != b:
                        key = frozenset((a, b))
                        if g["cost"] < self.pairs.get(key, 1.0):
                            self.pairs[key] = g["cost"]
                            self.reasons[key] = g.get("why", "")

    @classmethod
    def load(cls, path: Path = COSTS_FILE) -> "Costs":
        return cls(json.loads(path.read_text("utf-8")))

    @staticmethod
    def is_vowel(p: str) -> bool:
        return p[:1] in _VOWEL_CHARS

    def sub(self, a: str, b: str) -> float:
        if a == b:
            return 0.0
        if self.uniform:
            return 1.0
        if (c := self.pairs.get(frozenset((a, b)))) is not None:
            return c
        if self.is_vowel(a) and self.is_vowel(b):
            if any(a in g and b in g for g in self.vowel_groups):
                return self.vowel_group_sub
            return self.vowel_sub
        return self.default_sub

    def reason(self, a: str, b: str | None = None) -> str:
        """Why a substitution (or, with b=None, an insertion/deletion) is cheap; for the glass-box view."""
        if self.uniform:
            return ""
        if b is None:
            if a in self.indel_costs:
                return {"ə": "extra schwa (epenthesis)", "h": "dropped h", "j": "glide y",
                        "ɪ": "short i", "r": "dropped r (non-rhotic)"}.get(a, "cheap to drop")
            return "vowel dropped or added" if self.is_vowel(a) else ""
        if (r := self.reasons.get(frozenset((a, b)))):
            return r
        if self.is_vowel(a) and self.is_vowel(b):
            return "similar vowel" if any(a in g and b in g for g in self.vowel_groups) else "vowel change"
        return ""

    def indel(self, p: str) -> float:
        if self.uniform:
            return 1.0
        if p in self.indel_costs:
            return self.indel_costs[p]
        return self.vowel_indel if self.is_vowel(p) else self.default_indel


def weighted_distance(a: tuple[str, ...], b: tuple[str, ...], costs: Costs, free_ends: bool = False) -> float:
    """Weighted Levenshtein. With free_ends, b may match anywhere inside a (word glued to another)."""
    prev = [0.0] * (len(b) + 1)
    for j in range(1, len(b) + 1):
        prev[j] = prev[j - 1] + costs.indel(b[j - 1])
    best_end = prev[-1]
    for i in range(1, len(a) + 1):
        cur = [0.0 if free_ends else prev[0] + costs.indel(a[i - 1])]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + costs.indel(a[i - 1]),
                           cur[j - 1] + costs.indel(b[j - 1]),
                           prev[j - 1] + costs.sub(a[i - 1], b[j - 1])))
        prev = cur
        best_end = min(best_end, prev[-1])
    return best_end if free_ends else prev[-1]


def align(a: tuple[str, ...], b: tuple[str, ...], costs: Costs, free_ends: bool = False) -> list[dict]:
    """Cheapest edit path from heard phones a to lexicon phones b, as steps for display.

    op: match | sub | extra (heard but not in the word) | missing (in the word, not heard) | skip (free end)
    """
    n, m = len(a), len(b)
    INF = float("inf")
    d = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[str | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    d[0][0] = 0.0
    for i in range(1, n + 1):
        d[i][0], back[i][0] = (0.0, "skip") if free_ends else (d[i - 1][0] + costs.indel(a[i - 1]), "extra")
    for j in range(1, m + 1):
        d[0][j], back[0][j] = d[0][j - 1] + costs.indel(b[j - 1]), "missing"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            options = [(d[i - 1][j - 1] + costs.sub(a[i - 1], b[j - 1]), "diag"),
                       (d[i - 1][j] + costs.indel(a[i - 1]), "extra"),
                       (d[i][j - 1] + costs.indel(b[j - 1]), "missing")]
            d[i][j], back[i][j] = min(options, key=lambda o: o[0])
    end = min(range(n + 1), key=lambda i: d[i][m]) if free_ends else n
    steps: list[dict] = [{"op": "skip", "heard": a[k], "word": None, "cost": 0.0, "why": ""} for k in range(end, n)][::-1]
    i, j = end, m
    while i > 0 or j > 0:
        move = back[i][j]
        if move == "diag":
            c = costs.sub(a[i - 1], b[j - 1])
            steps.append({"op": "match" if c == 0 else "sub", "heard": a[i - 1], "word": b[j - 1],
                          "cost": round(c, 2), "why": costs.reason(a[i - 1], b[j - 1]) if c else ""})
            i, j = i - 1, j - 1
        elif move in ("extra", "skip"):
            c = 0.0 if move == "skip" else costs.indel(a[i - 1])
            steps.append({"op": move, "heard": a[i - 1], "word": None, "cost": round(c, 2),
                          "why": "" if move == "skip" else costs.reason(a[i - 1])})
            i -= 1
        else:
            c = costs.indel(b[j - 1])
            steps.append({"op": "missing", "heard": None, "word": b[j - 1], "cost": round(c, 2),
                          "why": costs.reason(b[j - 1])})
            j -= 1
    steps.reverse()
    return steps


def normalise(raw: str) -> tuple[str, ...]:
    """eSpeak phones ("w ɔː ɾ ɚ") -> comparable tokens ("w", "ɔ", "ɾ", "ə", "r")."""
    out: list[str] = []
    for tok in raw.split():
        if tok == "|":
            continue
        tok = tok.translate(_STRIP)
        if not tok:
            continue
        out.extend(_SPLIT.get(tok, (tok,)))
    return tuple(out)


class Phonemizer:
    """Thread-safe, cached text -> phones using eSpeak-NG through the phonemizer package."""

    def __init__(self):
        from phonemizer.backend import EspeakBackend
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        from phonemizer.separator import Separator

        if not os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"):
            lib = next((p for p in _LIBS if Path(p).exists()), None)
            if lib:
                EspeakWrapper.set_library(lib)
        self._make = lambda voice: EspeakBackend(voice, with_stress=False, language_switch="remove-flags")
        self._sep = Separator(phone=" ", word=" | ", syllable="")
        self._scripts = script_voices()
        self._backends: dict[str, object] = {}
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[str, ...]] = {}

    def voice_for(self, text: str) -> str | None:
        """eSpeak voice for a string: its writing system's voice (Hindi, Tamil, ...), None if eSpeak cannot
        read that script reliably (Thai), or English for Latin."""
        return next((voice for pattern, voice in self._scripts if pattern.search(text)), "en-us")

    def warm(self, texts: list[str]) -> None:
        """Phonemise many strings in one batch call per voice (much faster than one by one)."""
        todo = [t for t in dict.fromkeys(texts) if t not in self._cache]
        by_voice: dict[str, list[str]] = {}
        for t in todo:
            by_voice.setdefault(self.voice_for(t), []).append(t)
        for voice, items in by_voice.items():
            if voice is None:
                self._cache.update({t: () for t in items})
                continue
            with self._lock:
                if voice not in self._backends:
                    self._backends[voice] = self._make(voice)
                raw = self._backends[voice].phonemize(items, separator=self._sep, strip=True, njobs=1)
            self._cache.update({t: normalise(r) for t, r in zip(items, raw)})

    def __call__(self, text: str) -> tuple[str, ...]:
        if text not in self._cache:
            self.warm([text])
        return self._cache[text]


class PhoneticSimilarity:
    """similarity(heard, variant) -> 0..1, same contract as matcher.similarity."""

    MIN_SUBSTRING_PHONES = 4   # shorter variants ("tea", "loo") would match inside too many words
    SUBSTRING_PENALTY = 0.9

    def __init__(self, phonemizer: Phonemizer, costs: Costs, name: str):
        self.phones = phonemizer
        self.costs = costs
        self.name = name

        @lru_cache(maxsize=65536)
        def sim(heard: str, variant: str) -> float:
            if heard == variant:
                return 1.0
            a, b = self.phones(heard), self.phones(variant)
            if not a or not b:
                return 0.0
            whole = 1 - weighted_distance(a, b, self.costs) / max(len(a), len(b))
            if len(a) > len(b) + 2 and len(b) >= self.MIN_SUBSTRING_PHONES:
                inner = 1 - weighted_distance(a, b, self.costs, free_ends=True) / len(b)
                whole = max(whole, self.SUBSTRING_PENALTY * inner)
            return max(0.0, whole)

        self._sim = sim

    def warm(self, texts: list[str]) -> None:
        self.phones.warm(texts)

    def __call__(self, heard: str, variant: str) -> float:
        return self._sim(heard, variant)

    def explain(self, heard: str, variant: str) -> dict:
        """Phones, alignment steps and score behind one comparison, for the glass-box view."""
        a, b = self.phones(heard), self.phones(variant)
        inside = (len(a) > len(b) + 2 and len(b) >= self.MIN_SUBSTRING_PHONES
                  and self.SUBSTRING_PENALTY * (1 - weighted_distance(a, b, self.costs, True) / len(b))
                  > 1 - weighted_distance(a, b, self.costs) / max(len(a), len(b), 1))
        return {"heard_phones": list(a), "word_phones": list(b), "inside": inside,
                "steps": align(a, b, self.costs, free_ends=inside), "score": round(self(heard, variant), 3)}


_shared: Phonemizer | None = None
_shared_lock = threading.Lock()


def make_similarity(kind: str = "phonetic") -> PhoneticSimilarity:
    """kind: "phonetic" (accent cost matrix) or "phonetic_uniform" (plain phoneme edit distance)."""
    global _shared
    with _shared_lock:
        if _shared is None:
            _shared = Phonemizer()
    costs = Costs(None) if kind == "phonetic_uniform" else Costs.load()
    return PhoneticSimilarity(_shared, costs, kind)
