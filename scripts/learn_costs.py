"""Learn the accent cost table from recordings (Member A). Deck: "cost matrix learned from our recordings".

For every recording where we know what the speaker meant to say, compare it with what Whisper heard:
both become phonemes (eSpeak-NG), are aligned sound by sound, and every swap is counted
("d" heard as "ɾ", "ɑ" heard as "ɔ" ...). Swaps that happen often become cheap:

    cost = max(MIN_COST, 1 - n / (n + K))        n = times seen;  1 -> 0.75, 3 -> 0.50, 9 -> 0.25

A swap must be seen MIN_SEEN times before it changes anything, so one-off noise is ignored. The
hand-set table stays the starting point; a learned cost only ever makes a pair cheaper.

    .venv/bin/python scripts/learn_costs.py              # synthetic voices (eval/cache, after evaluate.py)
    .venv/bin/python scripts/learn_costs.py --real       # + volunteer recordings, train split only

Writes data/lexicon/phone_costs_learned.json and eval/learned_costs.md. Then
`scripts/evaluate.py` adds a "hybrid, learned costs" row to compare against the hand-set table.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine.phonetic import COSTS_FILE, LEARNED_COSTS_FILE, Costs, Phonemizer, align  # noqa: E402

K = 3.0
MIN_COST = 0.15
MIN_SEEN = 3
MAX_MISMATCH = 0.5      # skip pairs where Whisper heard something else entirely (hallucinations)
CACHE = ROOT / "eval" / "cache"
REPORT = ROOT / "eval" / "learned_costs.md"


def pairs_from_cache(model: str, refs: dict[str, str], split_ok) -> list[tuple[str, str, str]]:
    """(source, what was meant, what Whisper heard) from the speech-to-text cache."""
    cache_file = CACHE / f"asr_{model}.json"
    if not cache_file.exists():
        sys.exit("No speech-to-text cache yet: run scripts/evaluate.py first (it transcribes the clips).")
    cache = json.loads(cache_file.read_text("utf-8"))
    out = []
    for key, entry in cache.items():
        file = key.rsplit("@", 1)[0]
        if file not in refs or not split_ok(file):
            continue
        ref = refs[file]
        # compare like with like: a Devanagari reference against the Hindi pass, Latin against English
        want = "hi" if any("ऀ" <= ch <= "ॿ" for ch in ref) else "en"
        heard = next((h["text"] for h in entry["nbest"] if h.get("lang") == want), None)
        if heard:
            out.append((key, ref, heard))
    return out


def synthetic_refs() -> dict[str, str]:
    from scripts.asr_spike import CLIP_DIR, CLIPS
    return {str((CLIP_DIR / f"{cid}.wav").relative_to(ROOT)): text for cid, _, text, _ in CLIPS}


def real_refs() -> tuple[dict[str, str], set[str]]:
    """Read-aloud prompts only (the speaker's exact words are known), train split only."""
    rec = ROOT / "data" / "recordings"
    manifest = rec / "manifest.csv"
    if not manifest.exists():
        return {}, set()
    refs, train = {}, set()
    with manifest.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "read":
                path = str((rec / r["file"]).relative_to(ROOT))
                refs[path] = r["prompt_text"]
                if r["split"] == "train":
                    train.add(path)
    return refs, train


def clean(text: str) -> str:
    return re.sub(r"[^\w\s']", " ", text).strip()


def count_swaps(pairs, phon: Phonemizer) -> tuple[Counter, int]:
    """Count sound swaps between what was meant and what was heard, in pairs that mostly line up."""
    uniform = Costs(None)
    swaps, used = Counter(), 0
    phon.warm([clean(t) for _, a, b in pairs for t in (a, b)])
    for _, meant, heard in pairs:
        steps = align(phon(clean(heard)), phon(clean(meant)), uniform)
        mismatch = sum(s["op"] != "match" for s in steps) / max(1, len(steps))
        if mismatch > MAX_MISMATCH:
            continue   # a different sentence, not an accented version of this one
        used += 1
        for s in steps:
            # vowel<->consonant "swaps" are alignment artefacts, not accent
            if s["op"] == "sub" and Costs.is_vowel(s["heard"]) == Costs.is_vowel(s["word"]):
                swaps[frozenset((s["heard"], s["word"]))] += 1
    return swaps, used


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true", help="also learn from data/recordings (train split)")
    ap.add_argument("--model", default="base")
    args = ap.parse_args()

    refs = synthetic_refs()
    train = set(refs)
    if args.real:
        real, real_train = real_refs()
        refs.update(real)
        train |= real_train
    pairs = pairs_from_cache(args.model, refs, lambda f: f in train)
    if not pairs:
        sys.exit("No usable recordings found.")

    swaps, used = count_swaps(pairs, Phonemizer())
    hand = json.loads(COSTS_FILE.read_text("utf-8"))
    hand_costs = Costs(hand)
    learned = []
    for pair, n in swaps.most_common():
        if n < MIN_SEEN or len(pair) != 2:
            continue
        a, b = sorted(pair)
        cost = round(max(MIN_COST, 1 - n / (n + K)), 2)
        before = hand_costs.sub(a, b)
        if cost < before:   # learning only ever makes a swap cheaper than the hand-set table
            learned.append({"phones": [a, b], "cost": cost, "why": f"learned: seen {n} times", "was": before, "seen": n})

    out = dict(hand)
    out["_note"] = ("Learned by scripts/learn_costs.py from " + ("synthetic voices and volunteer recordings" if args.real
                    else "synthetic voices only") + f" ({used} of {len(pairs)} recordings usable). Hand-set table + cheaper learned pairs.")
    out["groups"] = hand["groups"] + [{k: g[k] for k in ("phones", "cost", "why")} for g in learned]
    LEARNED_COSTS_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lines = ["# Learned accent costs", "",
             f"From {used} of {len(pairs)} recordings ({'synthetic + volunteer, train split' if args.real else 'synthetic voices only'}); "
             f"the rest were skipped because Whisper heard a different sentence (over {MAX_MISMATCH:.0%} of sounds differ).",
             f"Rule: cost = max({MIN_COST}, 1 − n/(n+{K:g})), only swaps seen at least {MIN_SEEN} times, and only when cheaper than the hand-set cost.",
             "", "| Heard ↔ meant | Times seen | Hand-set cost | Learned cost |", "|---|---|---|---|"]
    lines += [f"| {g['phones'][0]} ↔ {g['phones'][1]} | {g['seen']} | {g['was']:.2f} | {g['cost']:.2f} |" for g in learned]
    if not learned:
        lines.append("| (no swap seen often enough yet) | | | |")
    lines += ["", "Most common swaps overall (including ones not used):", ""]
    lines += [f"- {' ↔ '.join(sorted(p))}: {n}" for p, n in swaps.most_common(12)]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nwrote {LEARNED_COSTS_FILE.relative_to(ROOT)} and {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
