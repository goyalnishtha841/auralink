"""Evaluate Auralink against baselines (deck slide 5). OWNERS: Members A and B.

    .venv/bin/python scripts/evaluate.py                 # text challenge set + synthetic audio
    .venv/bin/python scripts/evaluate.py --skip-audio    # text set only (seconds)
    .venv/bin/python scripts/evaluate.py --real          # also data/recordings/manifest.csv (test split)

Systems
    baseline_a        first speech-to-text result, exact keyword lookup, no confirmation
    text              Auralink, spelling similarity
    phonetic_uniform  Auralink, phoneme edit distance with equal costs
    phonetic          Auralink, phoneme edit distance with the accent cost matrix
    hybrid            Auralink default: mean of phonetic and spelling similarity

Metrics (per utterance)
    first_try      the cards' top intents are exactly what the passenger asked for
    one_tap        every requested intent is offered on screen (confirm or pick one of two)
    wrong_card     a confident card for something the passenger did not ask for (they must say No)
    wrong_action   baseline only: a wrong request goes straight to crew (Auralink always confirms)
    false_alarm    on "not a request" phrases, any card raised
    urgent_recall  medical requests flagged urgent

Speech-to-text results are cached in eval/cache/ so matcher variants re-run in seconds.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine import Context, Hypothesis, Lexicon, interpret  # noqa: E402
from engine.matcher import make_similarity, tokenize  # noqa: E402

SYSTEMS = ["baseline_a", "text", "phonetic_uniform", "phonetic", "hybrid"]
if (ROOT / "data" / "lexicon" / "phone_costs_learned.json").exists():   # made by scripts/learn_costs.py
    SYSTEMS.append("hybrid_learned")
try:
    import fastembed  # noqa: F401

    SYSTEMS.append("trimodal")
except ImportError:
    pass
NAMES = {"baseline_a": "Baseline A: first result, keywords", "text": "Auralink, spelling",
         "phonetic_uniform": "Auralink, phonemes", "phonetic": "Auralink, phonemes + accent costs",
         "hybrid": "Auralink, hybrid (default)", "hybrid_learned": "Auralink, hybrid, learned costs",
         "trimodal": "Auralink, trimodal (+ semantic embeddings)"}
CACHE = ROOT / "eval" / "cache"
OUT_MD = ROOT / "eval" / "results.md"
OUT_JSON = ROOT / "eval" / "results.json"
OUT_SVG = ROOT / "eval" / "results_chart.svg"


# ---------------------------------------------------------------- systems

def baseline_a(nbest: list[Hypothesis], lex: Lexicon) -> dict:
    """What a basic tool does: take the first transcript, look for exact keywords, send them."""
    text = nbest[0].text if nbest else ""
    toks = tokenize(text)
    joined = f" {' '.join(toks)} "
    found = {i.id for i in lex.intents for v in lex.variants(i.id)
             if (f" {v} " in joined if " " in v else v in toks)}
    return {"top": found, "options": found, "confident": found, "urgent": "medical" in found}


def auralink(nbest: list[Hypothesis], lex: Lexicon, sim) -> dict:
    r = interpret(nbest, Context(seat="eval"), lex, sim=sim)
    top = {c.candidates[0].intent for c in r.cards}
    options = set()
    for c in r.cards:
        options |= {x.intent for x in c.candidates[: 1 if c.status == "confident" else 2]}
    confident = {c.candidates[0].intent for c in r.cards if c.status == "confident"}
    return {"top": top, "options": options, "confident": confident, "urgent": r.urgent,
            "match_ms": r.latency_ms.get("match", 0.0)}


def score(pred: dict, expected: set[str]) -> dict:
    return {
        "first_try": pred["top"] == expected,
        "one_tap": expected <= pred["options"] and (bool(expected) or not pred["options"]),
        "wrong_card": bool(pred["confident"] - expected),
        "false_alarm": not expected and bool(pred["top"]),
        "urgent_hit": pred["urgent"] if "medical" in expected else None,
    }


def run_systems(items: list[dict], lex: Lexicon) -> dict:
    """items: {"id", "group", "expected": set, "nbest": [Hypothesis]} -> per-system rows."""
    sims = {k: make_similarity(k) for k in SYSTEMS if k != "baseline_a"}
    for sim in sims.values():  # pre-phonemise the lexicon so timing measures matching, not setup
        if hasattr(sim, "warm"):
            sim.warm([v for i in lex.intents for v in lex.variants(i.id)] + sorted(lex.stopwords))
    rows = {k: [] for k in SYSTEMS}
    for it in items:
        for k in SYSTEMS:
            t0 = time.perf_counter()
            pred = baseline_a(it["nbest"], lex) if k == "baseline_a" else auralink(it["nbest"], lex, sims[k])
            ms = (time.perf_counter() - t0) * 1000
            rows[k].append({"id": it["id"], "group": it["group"], "expected": sorted(it["expected"]),
                            "top": sorted(pred["top"]), "ms": ms, **score(pred, it["expected"])})
    return rows


def summarise(rows: list[dict]) -> dict:
    pos = [r for r in rows if r["expected"]]
    neg = [r for r in rows if not r["expected"]]
    urg = [r for r in rows if r["urgent_hit"] is not None]
    pct = lambda xs, k: round(100 * sum(1 for x in xs if x[k]) / len(xs), 1) if xs else None  # noqa: E731
    return {
        "n": len(rows),
        "first_try": pct(pos, "first_try"),
        "one_tap": pct(pos, "one_tap"),
        "wrong_card": pct(pos, "wrong_card"),
        "false_alarm": pct(neg, "false_alarm"),
        "urgent_recall": pct(urg, "urgent_hit"),
        "median_ms": round(statistics.median(r["ms"] for r in rows), 2) if rows else None,
        "by_group": {g: pct([r for r in pos if r["group"] == g], "first_try")
                     for g in sorted({r["group"] for r in pos})},
    }


# ---------------------------------------------------------------- data sets

def text_items() -> list[dict]:
    cases = json.loads((ROOT / "data" / "eval" / "text_cases.json").read_text("utf-8"))["cases"]
    return [{"id": f"t{i}", "group": c["group"], "expected": set(c["intents"]),
             "nbest": [Hypothesis(text=c["text"])]} for i, c in enumerate(cases)]


def audio_items(model: str, clips: list[tuple[str, Path, set[str], str]], snrs: list) -> list[dict]:
    """clips: (id, wav path, expected intents, group). Transcribes each clip at each SNR, cached."""
    import numpy as np

    from engine.asr import WhisperASR, load_wav
    from scripts.asr_spike import mix

    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / f"asr_{model}.json"
    cache = json.loads(cache_file.read_text("utf-8")) if cache_file.exists() else {}
    asr = None
    rng = np.random.default_rng(0)
    items = []
    for cid, path, expected, group in clips:
        clean = load_wav(path)
        for snr in snrs:
            key = f"{path.relative_to(ROOT)}@{snr}"
            if key not in cache:
                asr = asr or WhisperASR(model)
                tr = asr.transcribe(mix(clean, snr, rng))
                cache[key] = {"nbest": [h.model_dump() for h in tr.hypotheses], "latency_ms": tr.latency_ms}
            nbest = [Hypothesis(**h) for h in cache[key]["nbest"]] or [Hypothesis(text="")]
            items.append({"id": f"{cid}@{snr}", "group": "clean" if snr is None else f"{snr} dB",
                          "expected": expected, "nbest": nbest})
    cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    return items


def synthetic_clips() -> list[tuple[str, Path, set[str], str]]:
    from scripts.asr_spike import CLIP_DIR, CLIPS, make_clips

    make_clips()
    return [(cid, CLIP_DIR / f"{cid}.wav", exp, "synthetic") for cid, _, _, exp in CLIPS]


def real_clips(split: str) -> list[tuple[str, Path, set[str], str]]:
    rec = ROOT / "data" / "recordings"
    manifest = rec / "manifest.csv"
    if not manifest.exists():
        return []
    with manifest.open(newline="", encoding="utf-8") as f:
        return [(r["file"], rec / r["file"], set(filter(None, r["intents"].split("+"))), r["kind"])
                for r in csv.DictReader(f) if r["split"] == split]


# ---------------------------------------------------------------- report

def table(results: dict, title: str, note: str) -> list[str]:
    lines = [f"## {title}", "", note, "",
             "| System | First try | Within one tap | Wrong confident card | False alarms | Urgent caught | Median match |",
             "|---|---|---|---|---|---|---|"]
    fmt = lambda v, unit="%": "–" if v is None else f"{v:g}{unit}"  # noqa: E731
    for k in SYSTEMS:
        s = results[k]
        lines.append(f"| {NAMES[k]} | {fmt(s['first_try'])} | {fmt(s['one_tap'])} | {fmt(s['wrong_card'])} | "
                     f"{fmt(s['false_alarm'])} | {fmt(s['urgent_recall'])} | {fmt(s['median_ms'], ' ms')} |")
    groups = list(results["hybrid"]["by_group"])
    lines += ["", "First-try accuracy by group:", "",
              "| System | " + " | ".join(groups) + " |", "|---|" + "---|" * len(groups)]
    for k in SYSTEMS:
        lines.append(f"| {NAMES[k]} | " + " | ".join(fmt(results[k]["by_group"].get(g)) for g in groups) + " |")
    return lines + [""]


def chart(results: dict, path: Path) -> None:
    """Grouped bar chart of first-try accuracy by group, as a standalone SVG for the deck."""
    groups = list(results["hybrid"]["by_group"])
    colors = {"baseline_a": "#7d89ab", "text": "#5b8cff", "phonetic_uniform": "#a87cff", "phonetic": "#3ce8c8",
              "hybrid": "#ffb547", "hybrid_learned": "#3ddc97", "trimodal": "#ff6b6b"}
    W, H, left, top, bottom = 900, 380, 48, 30, 70
    gw = (W - left - 20) / len(groups)
    bw = (gw - 18) / len(SYSTEMS)
    ph = H - top - bottom
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Outfit, Noto Sans, sans-serif">',
           f'<rect width="{W}" height="{H}" fill="#060915"/>']
    for v in (0, 25, 50, 75, 100):
        y = top + ph * (1 - v / 100)
        out.append(f'<line x1="{left}" x2="{W - 20}" y1="{y}" y2="{y}" stroke="#a3afcf" stroke-opacity=".15"/>')
        out.append(f'<text x="{left - 8}" y="{y + 4}" fill="#a3afcf" font-size="11" text-anchor="end">{v}%</text>')
    for gi, g in enumerate(groups):
        for si, k in enumerate(SYSTEMS):
            v = results[k]["by_group"].get(g) or 0
            x = left + gi * gw + 9 + si * bw
            h = ph * v / 100
            out.append(f'<rect x="{x:.1f}" y="{top + ph - h:.1f}" width="{bw - 3:.1f}" height="{h:.1f}" rx="3" fill="{colors[k]}"/>')
        out.append(f'<text x="{left + gi * gw + gw / 2:.1f}" y="{H - bottom + 18}" fill="#edf2ff" font-size="12" text-anchor="middle">{g.replace("_", " ")}</text>')
    for si, k in enumerate(SYSTEMS):
        x = left + si * (W - left - 20) / len(SYSTEMS)
        out.append(f'<rect x="{x}" y="{H - 28}" width="12" height="12" rx="2" fill="{colors[k]}"/>')
        out.append(f'<text x="{x + 18}" y="{H - 18}" fill="#a3afcf" font-size="11">{NAMES[k].replace("Auralink, ", "")}</text>')
    out.append("</svg>")
    path.write_text("\n".join(out), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-audio", action="store_true")
    ap.add_argument("--real", action="store_true", help="also evaluate data/recordings (test split)")
    ap.add_argument("--split", default="test")
    ap.add_argument("--model", default="base")
    args = ap.parse_args()

    lex = Lexicon()
    report = {"text": {k: summarise(v) for k, v in run_systems(text_items(), lex).items()}}
    md = ["# Auralink evaluation", "", f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `scripts/evaluate.py`.", ""]
    md += table(report["text"], "Text challenge set",
                f"{report['text']['hybrid']['n']} transcripts written by the team to mimic accented and code-mixed "
                "speech-to-text output (`data/eval/text_cases.json`). Development benchmark, not real passengers.")
    chart(report["text"], OUT_SVG)

    if not args.skip_audio:
        rows = run_systems(audio_items(args.model, synthetic_clips(), [None, 10, 0]), lex)
        report["synthetic_audio"] = {k: summarise(v) for k, v in rows.items()}
        md += table(report["synthetic_audio"], f"Synthetic audio (Whisper {args.model}, English + Hindi n-best)",
                    "macOS Indian English and Hindi voices, clean / 10 dB / 0 dB brown noise. Smoke test only.")
    if args.real:
        clips = real_clips(args.split)
        if clips:
            rows = run_systems(audio_items(args.model, clips, [None, 10, 0]), lex)
            report["real_audio"] = {k: summarise(v) for k, v in rows.items()}
            md += table(report["real_audio"], f"Volunteer recordings ({args.split} split)",
                        f"{len(clips)} clips from data/recordings, each at clean / 10 dB / 0 dB.")
        else:
            md += ["## Volunteer recordings", "", "No recordings in this split yet.", ""]

    md += ["Auralink never sends an unconfirmed request (except urgent ones, which are flagged as unconfirmed), so its",
           "wrong-action rate is zero by design; *wrong confident card* counts the cases where the passenger has to tap No.", ""]
    OUT_MD.write_text("\n".join(md), encoding="utf-8")
    OUT_JSON.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("\n".join(md))
    print(f"wrote {OUT_MD.relative_to(ROOT)}, {OUT_JSON.relative_to(ROOT)}, {OUT_SVG.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
