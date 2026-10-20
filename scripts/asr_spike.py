"""Day-1 ASR spike (Member A): can we get an n-best list, how fast is it, and does
decoding in both English and Hindi help the matcher?

Uses macOS built-in Indian voices as stand-ins until real recordings exist, and brown
noise as a stand-in for cabin noise. Treat the numbers as a smoke test, not results.

    .venv/bin/python scripts/asr_spike.py --models base small
"""
from __future__ import annotations

import argparse
import statistics
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import Context, Hypothesis, Lexicon, interpret  # noqa: E402
from engine.asr import SAMPLE_RATE, WhisperASR, load_wav  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CLIP_DIR = ROOT / "data" / "recordings" / "synthetic"
REPORT = ROOT / "eval" / "asr_spike_results.md"

# (id, macOS voice, text, expected intents)
CLIPS = [
    ("rishi_water_blanket", "Rishi", "Madam, thoda wotter and kambal please", {"water", "blanket"}),
    ("rishi_water", "Rishi", "Can I get some water please", {"water"}),
    ("rishi_blanket", "Rishi", "Excuse me, I need a blanket, it is very cold", {"blanket"}),
    ("rishi_toilet", "Rishi", "Where is the washroom", {"toilet"}),
    ("rishi_medical", "Rishi", "I need medicine, I have chest pain", {"medical"}),
    ("aman_tea", "Aman", "One cup of chai please", {"tea"}),
    ("aman_pillow", "Aman", "Can I have a pillow", {"pillow"}),
    ("aman_meal", "Aman", "I am hungry, is there vegetarian food", {"meal"}),
    ("lekha_water_blanket", "Lekha", "थोड़ा पानी और कंबल चाहिए", {"water", "blanket"}),
    ("lekha_medical", "Lekha", "मुझे दवाई चाहिए, सिर में दर्द है", {"medical"}),
    ("lekha_toilet", "Lekha", "शौचालय कहाँ है", {"toilet"}),
    ("lekha_pillow", "Lekha", "मुझे एक तकिया दीजिए", {"pillow"}),
    ("lekha_tea", "Lekha", "मुझे चाय चाहिए", {"tea"}),
    ("lekha_help", "Lekha", "सुनिए, मदद चाहिए", {"call_crew"}),
]
SNRS = [None, 10, 0]  # None = clean


def make_clips() -> None:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for cid, voice, text, _ in CLIPS:
        out = CLIP_DIR / f"{cid}.wav"
        if not out.exists():
            subprocess.run(["say", "-v", voice, "-o", str(out), "--data-format=LEI16@16000", text], check=True)


def brown_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    x = np.cumsum(rng.standard_normal(n))
    x -= np.convolve(x, np.ones(1600) / 1600, mode="same")  # remove drift, keep the low rumble
    return x / (np.abs(x).max() + 1e-9)


def mix(speech: np.ndarray, snr_db: float | None, rng: np.random.Generator) -> np.ndarray:
    pad = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
    speech = np.concatenate([pad, speech, pad])
    if snr_db is None:
        return speech
    noise = brown_noise(len(speech), rng)
    p_s, p_n = np.mean(speech ** 2), np.mean(noise ** 2)
    noise *= np.sqrt(p_s / (p_n * 10 ** (snr_db / 10)))
    out = speech + noise
    return (out / max(1.0, np.abs(out).max())).astype(np.float32)


def predicted(hyps: list[Hypothesis], lex: Lexicon) -> set[str]:
    r = interpret(hyps, Context(seat="34K"), lex)
    return {c.candidates[0].intent for c in r.cards}


def run_model(size: str, lex: Lexicon, rng: np.random.Generator) -> tuple[list[str], dict]:
    t = time.perf_counter()
    asr = WhisperASR(size)
    load_s = time.perf_counter() - t
    asr.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32) + 0.0)  # warm-up

    configs = {"top-1 (en)": 0, "n-best (en)": 0, "n-best (en+hi)": 0}
    per_snr = {snr: dict.fromkeys(configs, 0) for snr in SNRS}
    lat_en, lat_both = [], []
    rows = []
    for cid, _, text, expected in CLIPS:
        clean = load_wav(CLIP_DIR / f"{cid}.wav")
        for snr in SNRS:
            tr = asr.transcribe(mix(clean, snr, rng), langs=("en", "hi"), n_best=5)
            en = [h for h in tr.hypotheses if h.lang == "en"]
            hi = [h for h in tr.hypotheses if h.lang == "hi"]
            preds = {
                "top-1 (en)": predicted(en[:1], lex),
                "n-best (en)": predicted(en, lex),
                "n-best (en+hi)": predicted(tr.hypotheses, lex),
            }
            for k, p in preds.items():
                if p == expected:
                    configs[k] += 1
                    per_snr[snr][k] += 1
            vad, enc = tr.latency_ms.get("vad", 0), tr.latency_ms.get("encode", 0)
            lat_en.append(vad + enc + tr.latency_ms.get("decode_en", 0))
            lat_both.append(vad + enc + tr.latency_ms.get("decode_en", 0) + tr.latency_ms.get("decode_hi", 0))
            mark = lambda k: "✅" if preds[k] == expected else "❌"  # noqa: E731
            rows.append(
                f"| {cid} | {'clean' if snr is None else f'{snr} dB'} | {en[0].text if en else '–'} | "
                f"{hi[0].text if hi else '–'} | {len(tr.hypotheses)} | "
                f"{mark('top-1 (en)')} {mark('n-best (en)')} {mark('n-best (en+hi)')} | {lat_both[-1]:.0f} |"
            )

    # hallucination checks: silence and noise only
    gate = []
    for name, audio in [("2 s silence", np.zeros(2 * SAMPLE_RATE, dtype=np.float32)),
                        ("2 s brown noise", (0.3 * brown_noise(2 * SAMPLE_RATE, rng)).astype(np.float32))]:
        tr = asr.transcribe(audio)
        gate.append(f"| {name} | {tr.rejected or 'NOT rejected: ' + repr(tr.hypotheses[0].text)} |")

    n = len(CLIPS) * len(SNRS)
    summary = {
        "load_s": load_s,
        "acc": {k: v / n for k, v in configs.items()},
        "per_snr": {snr: {k: v / len(CLIPS) for k, v in d.items()} for snr, d in per_snr.items()},
        "lat_en_med": statistics.median(lat_en),
        "lat_both_med": statistics.median(lat_both),
        "lat_both_p90": sorted(lat_both)[int(0.9 * len(lat_both)) - 1],
    }
    lines = [
        f"## Whisper `{size}` (int8, CPU)",
        "",
        f"Model load {summary['load_s']:.1f} s · median latency en only {summary['lat_en_med']:.0f} ms · "
        f"en+hi {summary['lat_both_med']:.0f} ms (p90 {summary['lat_both_p90']:.0f} ms) · deck target < 1500 ms",
        "",
        "| Setup | Clean | 10 dB | 0 dB | All |",
        "|---|---|---|---|---|",
        *[
            f"| {k} | " + " | ".join(f"{summary['per_snr'][s][k]:.0%}" for s in SNRS) + f" | {summary['acc'][k]:.0%} |"
            for k in configs
        ],
        "",
        "| Silence gate | Result |",
        "|---|---|",
        *gate,
        "",
        "<details><summary>Per clip</summary>",
        "",
        "| Clip | Noise | Best English guess | Best Hindi guess | # guesses | top-1 / en n-best / en+hi | ms |",
        "|---|---|---|---|---|---|---|",
        *rows,
        "",
        "</details>",
        "",
    ]
    return lines, summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=["base", "small"])
    args = ap.parse_args()

    make_clips()
    lex = Lexicon()
    out = [
        "# ASR spike results",
        "",
        "Stand-in data: macOS voices Rishi, Aman (Indian English) and Lekha (Hindi), "
        f"{len(CLIPS)} phrases, brown noise as a cabin-noise proxy. A smoke test of the pipeline, "
        "**not** an evaluation; real speakers will score differently.",
        "",
    ]
    for size in args.models:
        print(f"running {size}…", flush=True)
        lines, s = run_model(size, lex, np.random.default_rng(0))
        out += lines
        print(f"  accuracy {s['acc']}  median en+hi {s['lat_both_med']:.0f} ms", flush=True)
    REPORT.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
