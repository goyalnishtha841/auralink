"""Intent matcher: n-best text in, request cards and an ambiguity rule out.

This is the text-level baseline of the Phonetic Intent Matcher. Member A replaces
`similarity()` with phoneme edit distance (eSpeak-NG + accent cost matrix). The rest
of the pipeline (n-best weighting, context priors, span grouping, ambiguity rules,
urgency override) is the real design from the deck and should stay.
"""
from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

from .lexicon import Lexicon
from .types import Candidate, CardDraft, Context, Hypothesis, Result

log = logging.getLogger("auralink.matcher")

T1 = 0.70            # an intent counts as heard only above this score
T2 = 0.10            # top two candidates on the same words must differ by this much
URGENT_FLOOR = 0.60  # urgent intents are raised at a lower score, favouring recall
MATCH_FLOOR = 0.50   # weaker span/intent pairs are ignored entirely
MAX_NGRAM = 3
LONGER_MATCH_WINS = 0.85  # a word inside a longer phrase that matched just as well (nam inside hong nam)

_TOKEN = re.compile(r"[^\s.,!?;:()\"।]+")
_FOLDS = [
    ("ph", "f"), ("th", "t"), ("dh", "d"), ("bh", "b"), ("kh", "k"), ("gh", "g"),
    ("sh", "s"), ("ck", "k"), ("c", "k"), ("q", "k"), ("w", "v"), ("z", "s"),
]
_VOWELS = set("aeiouy")


def tokenize(text: str) -> list[str]:
    # keep apostrophes inside words ("can't"), drop them at the edges
    return [t for t in (m.lower().strip("'’") for m in _TOKEN.findall(text)) if t]


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


Similarity = Callable[[str, str], float]
_default: Similarity | None = None


def default_similarity() -> Similarity:
    """AURALINK_MATCHER=hybrid (default), phonetic, phonetic_uniform or text."""
    global _default
    if _default is None:
        _default = make_similarity(os.environ.get("AURALINK_MATCHER", "hybrid"))
    return _default


class HybridSimilarity:
    """Mean of sound (phonemes + accent costs) and spelling similarity.

    Sound evidence catches Devanagari and accents that spelling misses; spelling evidence vetoes
    sound-alikes that look nothing alike ("tokyo" vs "takia"). Best of the variants on the dev set
    (scripts/evaluate.py), to be confirmed on held-out volunteer recordings.
    """

    def __init__(self, phonetic):
        self.phonetic = phonetic
        self.name = "hybrid"

        @lru_cache(maxsize=65536)
        def sim(a: str, b: str) -> float:
            if not phonetic.phones(a) or not phonetic.phones(b):
                return similarity(a, b)   # a script eSpeak cannot read (e.g. Thai): spelling evidence only
            return (phonetic(a, b) + similarity(a, b)) / 2

        self._sim = sim

    def warm(self, texts: list[str]) -> None:
        self.phonetic.warm(texts)

    def __call__(self, heard: str, variant: str) -> float:
        return self._sim(heard, variant)

    def explain(self, heard: str, variant: str) -> dict:
        return {**self.phonetic.explain(heard, variant), "sound": round(self.phonetic(heard, variant), 3),
                "spelling": round(similarity(heard, variant), 3), "score": round(self(heard, variant), 3)}


class TriSimilarity:
    """Weighted blend of the hybrid (phonetic + spelling) score and a semantic embedding score.

    Semantic similarity is the weakest signal on short, single-word variants ("pani" vs "jal"
    scores lower than an exact phonetic match would), so it gets a minority weight: enough to
    rescue a genuine paraphrase that shares no sound or spelling with any lexicon word, not
    enough to override a strong direct match on its own.

    Measured, not assumed: on data/eval/text_cases.json (accent/spelling cases, no paraphrases),
    any semantic weight costs first-try accuracy (90.8% at 0.0 down to 87.7% at 0.3) because that
    set has nothing for it to rescue, while cutting false alarms (12.5% -> 0%). 0.15 is chosen as
    the smallest weight that still lets a real paraphrase ("where is the bathroom" -> toilet,
    0.72 cosine) outvote a weak or absent hybrid score. Re-tune once paraphrase cases exist in
    the eval set, the same way T1/T2 in interpret() are starting values, not final ones.
    """

    SEMANTIC_WEIGHT = 0.15

    def __init__(self, hybrid: HybridSimilarity, semantic):
        self.hybrid = hybrid
        self.semantic = semantic
        self.name = "trimodal"

    def warm(self, texts: list[str]) -> None:
        self.hybrid.warm(texts)
        self.semantic.warm(texts)

    def __call__(self, heard: str, variant: str) -> float:
        h = self.hybrid(heard, variant)
        s = self.semantic(heard, variant)
        return (1 - self.SEMANTIC_WEIGHT) * h + self.SEMANTIC_WEIGHT * s

    def explain(self, heard: str, variant: str) -> dict:
        return {**self.hybrid.explain(heard, variant), "semantic": self.semantic.explain(heard, variant),
                "score": round(self(heard, variant), 3)}


def is_filler(token: str, lex: Lexicon, sim: Similarity) -> bool:
    return _is_filler(token, lex, sim)


def make_similarity(kind: str) -> Similarity:
    """kind: "text" (spelling), "phonetic_uniform" (plain phoneme distance), "phonetic" (accent costs),
    "hybrid" (phonetic + spelling, the default) or "trimodal" (hybrid + a semantic embedding vote,
    catches paraphrases that share no sound or spelling with any lexicon word)."""
    if kind == "text":
        return similarity
    try:
        from .phonetic import make_similarity as make_phonetic

        if kind == "hybrid":
            return HybridSimilarity(make_phonetic("phonetic"))
        if kind == "hybrid_learned":
            h = HybridSimilarity(make_phonetic("phonetic_learned"))
            h.name = "hybrid_learned"
            return h
        if kind == "trimodal":
            from .semantic import SemanticSimilarity

            return TriSimilarity(HybridSimilarity(make_phonetic("phonetic")), SemanticSimilarity())
        return make_phonetic(kind)
    except Exception as e:  # eSpeak-NG, phonemizer or fastembed missing: keep working with spelling matching
        log.warning("phonetic/semantic matcher unavailable (%s); using text similarity", e)
        return similarity


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


FILLER_SOUNDALIKE = 0.9
_filler_cache: dict[tuple, bool] = {}


def _is_filler(token: str, lex: Lexicon, sim: Similarity) -> bool:
    """Fillers ("madam", "chahiye") are matched by sound too, so "madham" or "chahiyee" count."""
    if token in lex.stopwords or (len(token) == 1 and token.isascii()):  # eSpeak reads "t" as "tee"
        return True
    if sim is similarity or len(token) < 4:  # text mode keeps the exact list; short words collide
        return False
    key = (id(sim), lex.version_key, token)
    if key not in _filler_cache:
        filler = max((sim(token, w) for w in lex.stopwords if len(w) >= 4), default=0.0)
        request = max(sim(token, v) for i in lex.intents for v in lex.variants(i.id))
        # "madham" sounds like "madam" (filler); "dizzy" sounds like "dijiye" but is itself a request word
        _filler_cache[key] = filler >= FILLER_SOUNDALIKE and filler > request
    return _filler_cache[key]


_warmed: set[tuple] = set()


def _prepare(hyps: list[Hypothesis], lex: Lexicon, sim: Similarity) -> None:
    """Phonemise everything this call will compare in two batch calls instead of hundreds of single ones."""
    if not hasattr(sim, "warm"):
        return
    key = (id(sim), lex.version_key)
    if key not in _warmed:
        sim.warm([v for i in lex.intents for v in lex.variants(i.id)] + sorted(lex.stopwords))
        _warmed.add(key)
    texts = []
    for h in hyps:
        toks = tokenize(h.text)
        for i in range(len(toks)):
            for n in range(1, MAX_NGRAM + 1):
                if i + n <= len(toks):
                    texts += [" ".join(toks[i:i + n]), "".join(toks[i:i + n])]
    sim.warm(texts)


def _all_hits(hyps: list[Hypothesis], ctx: Context, lex: Lexicon, sim: Similarity) -> list[_Hit]:
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
                stops = [_is_filler(t, lex, sim) for t in window]
                if all(stops):
                    continue
                # Multi-word windows match multi-word variants ("please come"). Without filler words
                # they may also match a single word written as two ("wash room" -> "washroom"); with
                # fillers they may not, or "can i" sounds just like "khana".
                heard = " ".join(window)
                joined = "".join(window) if n > 1 and not any(stops) else None
                for intent in lex.intents:
                    scored = [(sim(heard if (n == 1 or " " in v) else joined, v), v)
                              for v in lex.variants(intent.id) if n == 1 or " " in v or joined]
                    if not scored:
                        continue
                    s, matched = max(scored)
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
    # equal scores: the longer phrase claims first ("hong nam" = toilet before "nam" = water)
    for h in sorted(hits, key=lambda h: (-h.score, -(h.end - h.start))):
        if h.score < floor:
            break
        if not any(h.overlaps(a) for a in anchors):
            anchors.append(h)
    groups = []
    for a in sorted(anchors, key=lambda a: a.start):
        rivals: dict[str, _Hit] = {}
        for h in hits:
            if h.overlaps(a) and not any(h.overlaps(o) for o in anchors if o is not a):
                if a.start <= h.start and h.end <= a.end and (h.end - h.start) < (a.end - a.start) and h.score <= a.score:
                    # a word inside a longer phrase that matched at least as well is weaker evidence
                    h = _Hit(h.intent, h.score * LONGER_MATCH_WINS, h.start, h.end, h.heard, h.matched)
                if h.intent not in rivals or h.score > rivals[h.intent].score:
                    rivals[h.intent] = h
        rivals.setdefault(a.intent, a)
        groups.append(sorted(rivals.values(), key=lambda h: -h.score))
    return groups


def split_unspaced(text: str, lex: Lexicon) -> str:
    """Thai and similar scripts have no spaces between words. Split each run by longest match against
    the lexicon's words (dictionary maximal matching), so "ขอน้ำหน่อย" becomes "ขอ น้ำ หน่อย" and
    "ห้องน้ำ" (toilet) stays whole instead of being read as "น้ำ" (water)."""
    if not lex.unspaced or not lex.unspaced_vocab:
        return text

    def seg(m: re.Match) -> str:
        run, i, out, unknown = m.group(0), 0, [], ""
        while i < len(run):
            word = next((w for w in lex.unspaced_vocab if run.startswith(w, i)), None)
            if word:
                if unknown:
                    out.append(unknown)
                    unknown = ""
                out.append(word)
                i += len(word)
            else:
                unknown += run[i]
                i += 1
        if unknown:
            out.append(unknown)
        return f" {' '.join(out)} "

    return lex.unspaced.sub(seg, text)


def interpret(nbest: list[Hypothesis], ctx: Context, lex: Lexicon, *, t1: float = T1, t2: float = T2,
              sim: Similarity | None = None) -> Result:
    t0 = time.perf_counter()
    hyps = [Hypothesis(text=split_unspaced(h.text, lex), conf=h.conf, lang=h.lang) for h in nbest if h.text.strip()]
    if not hyps:
        return Result(seat=ctx.seat, nbest=nbest, cards=[], rule="empty", urgent=False,
                      latency_ms={"match": round((time.perf_counter() - t0) * 1000, 2)})

    sim = sim or default_similarity()
    _prepare(hyps, lex, sim)
    hits = _all_hits(hyps, ctx, lex, sim)

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
