"""Intent matcher: n-best text in, request cards and an ambiguity rule out.

This is the text-level baseline of the Phonetic Intent Matcher. Member A replaces
`similarity()` with phoneme edit distance (eSpeak-NG + accent cost matrix). The rest
of the pipeline (n-best weighting, context priors, span grouping, ambiguity rules,
urgency override) is the real design from the deck and should stay.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from functools import lru_cache

from .lexicon import Lexicon
from .types import Candidate, CardDraft, Context, Hypothesis, Result

T1 = 0.70            # an intent counts as heard only above this score
T2 = 0.10            # top two candidates on the same words must differ by this much
URGENT_FLOOR = 0.60  # urgent intents are raised at a lower score, favouring recall
MATCH_FLOOR = 0.50   # weaker span/intent pairs are ignored entirely
MAX_NGRAM = 3

_TOKEN = re.compile(r"[^\s.,!?;:()\"'।]+")
_FOLDS = [
    ("ph", "f"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("kh", "k"), ("gh", "g"),
    ("sh", "s"), ("ck", "k"), ("c", "k"), ("q", "k"), ("w", "v"), ("z", "s"),
]
_VOWELS = set("aeiouy")


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text)]


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return len(a) or len(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _ratio(a: str, b: str) -> float:
    return 1 - levenshtein(a, b) / max(len(a), len(b))


@lru_cache(maxsize=8192)
def fold(word: str) -> str:
    """Crude sound-alike key so that wotter/water and kambal/kambel collide."""
    if not word.isascii():
        return word
    w = word.lower().replace(" ", "")
    for a, b in _FOLDS:
        w = w.replace(a, b)
    w = re.sub(r"(.)\1+", r"\1", w)
    return w[:1] + "".join(ch for ch in w[1:] if ch not in _VOWELS)


@lru_cache(maxsize=65536)  # n-best lists repeat the same words; this keeps matching < 100 ms
def similarity(heard: str, variant: str) -> float:
    """0..1 match strength. PLACEHOLDER: Member A swaps in phoneme distance here."""
    direct = _ratio(heard, variant)
    fh, fv = fold(heard), fold(variant)
    # short keys collide too easily ("can i" and "khana" both fold to "kn")
    folded = 0.9 * _ratio(fh, fv) if min(len(fh), len(fv)) >= 3 else 0.0
    return max(direct, folded)


@dataclass
class _Hit:
    intent: str
    score: float
    start: int
    end: int
    heard: str
    matched: str

    def candidate(self, total: float) -> Candidate:
        return Candidate(intent=self.intent, score=round(self.score, 3), p=round(self.score / total, 3),
                         heard=self.heard, matched=self.matched)


    def overlaps(self, other: "_Hit") -> bool:
        return self.start <= other.end and other.start <= self.end


def _all_hits(hyps: list[Hypothesis], ctx: Context, lex: Lexicon) -> list[_Hit]:
    """Best match for every (intent, word span) across all hypotheses, context prior applied."""
    anchor_len = len(tokenize(hyps[0].text)) or 1
    max_conf = max(h.conf for h in hyps) or 1.0
    best: dict[tuple[str, int, int], _Hit] = {}
    for h in hyps:
        toks = tokenize(h.text)
        weight = (max(h.conf, 0.0) / max_conf) ** 0.5
        # map token positions of every hypothesis onto the top hypothesis
        scale = (anchor_len - 1) / (len(toks) - 1) if len(toks) > 1 else 0.0
        for i in range(len(toks)):
            for n in range(1, MAX_NGRAM + 1):
                if i + n > len(toks):
                    break
                window = toks[i:i + n]
                if n == 1 and window[0] in lex.stopwords:
                    continue
                heard = " ".join(window)
                for intent in lex.intents:
                    s, matched = max((similarity(heard, v), v) for v in lex.variants(intent.id))
                    s *= weight
                    if s < MATCH_FLOOR:
                        continue
                    s *= lex.prior(intent.id, ctx.phase)
                    key = (intent.id, round(i * scale), round((i + n - 1) * scale))
                    if key not in best or s > best[key].score:
                        best[key] = _Hit(intent.id, s, key[1], key[2], heard, matched)
    return list(best.values())


def _segment(hits: list[_Hit], floor: float) -> list[list[_Hit]]:
    """Strongest hits claim their words first; each claimed span becomes one card.

    The card's candidates are every intent heard on those words (and on no other card's words),
    so "pain" can compete with "pani" while "wotter" and "kambal" stay separate requests.
    """
    anchors: list[_Hit] = []
    for h in sorted(hits, key=lambda h: -h.score):
        if h.score < floor:
            break
        if not any(h.overlaps(a) for a in anchors):
            anchors.append(h)
    groups = []
    for a in sorted(anchors, key=lambda a: a.start):
        rivals: dict[str, _Hit] = {}
        for h in hits:
            if h.overlaps(a) and not any(h.overlaps(o) for o in anchors if o is not a):
                if h.intent not in rivals or h.score > rivals[h.intent].score:
                    rivals[h.intent] = h
        rivals.setdefault(a.intent, a)
        groups.append(sorted(rivals.values(), key=lambda h: -h.score))
    return groups


def interpret(nbest: list[Hypothesis], ctx: Context, lex: Lexicon, *, t1: float = T1, t2: float = T2) -> Result:
    t0 = time.perf_counter()
    hyps = [h for h in nbest if h.text.strip()]
    if not hyps:
        return Result(seat=ctx.seat, nbest=nbest, cards=[], rule="empty", urgent=False,
                      latency_ms={"match": round((time.perf_counter() - t0) * 1000, 2)})

    hits = _all_hits(hyps, ctx, lex)

    by_intent: dict[str, CardDraft] = {}
    for ranked in _segment(hits, min(t1, URGENT_FLOOR)):
        ranked = ranked[:3]
        top = ranked[0]
        # urgent when the urgent intent wins, or when nothing is clear and it is a plausible reading
        urgent = (lex.is_urgent(top.intent) and top.score >= URGENT_FLOOR) or (
            top.score < t1 and any(lex.is_urgent(h.intent) and h.score >= URGENT_FLOOR for h in ranked))
        if top.score < t1 and not urgent:
            continue
        total = sum(h.score for h in ranked)
        close = len(ranked) > 1 and top.score - ranked[1].score < t2
        draft = CardDraft(
            span=top.heard,
            candidates=[h.candidate(total) for h in ranked],
            status="close" if close or top.score < t1 else "confident",
            urgent=urgent,
        )
        # one card per request: "medicine ... chest pain" is a single medical request
        prev = by_intent.get(top.intent)
        rank = lambda d: (d.status == "confident", d.candidates[0].score)  # noqa: E731
        if prev is None or rank(draft) > rank(prev):
            by_intent[top.intent] = draft
    cards = list(by_intent.values())

    if not cards:
        rule = "flat"
    elif any(c.status == "close" for c in cards):
        rule = "close"
    elif len(cards) > 1:
        rule = "split"
    else:
        rule = "confident"

    per_intent: dict[str, _Hit] = {}
    for h in hits:
        if h.intent not in per_intent or h.score > per_intent[h.intent].score:
            per_intent[h.intent] = h
    top3 = sorted(per_intent.values(), key=lambda h: -h.score)[:3]
    total = sum(h.score for h in top3) or 1.0
    return Result(
        seat=ctx.seat, nbest=nbest, cards=cards, rule=rule,
        urgent=any(c.urgent for c in cards),
        best_guesses=[h.candidate(total) for h in top3],
        latency_ms={"match": round((time.perf_counter() - t0) * 1000, 2)},
    )
