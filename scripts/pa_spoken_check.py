"""Spoken PA check: say real announcements, run them through the hub's speech and matching, score them.

    .venv/bin/python scripts/pa_spoken_check.py              # Mac voices (Kyoko, Daniel, Samantha, Rishi, Karen)
    .venv/bin/python scripts/pa_spoken_check.py --dir REC    # your own recordings: REC/<id>.wav, ids as in LINES

With the Mac voices it makes the clips with `say`, so it needs macOS. Real crew voices are the better
test: record each line below on the crew tablet or a phone (16 kHz mono WAV) and pass --dir.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hub.main import PA_ASR_MODEL, get_asr  # noqa: E402
from hub.pa import Library  # noqa: E402

# id, Mac voice, what is said, expected announcement (none = must NOT be captioned), expected number
LINES = [
    ("ja_descent", "Kyoko", "皆様、当機はただいまから降下を始めます。あと二十分で着陸の予定です。シートベルトをお締めください。", "descent", "20"),
    ("ja_belt", "Kyoko", "皆様、ただいまシートベルト着用のサインが点灯しました。お席にお戻りください。", "seatbelt_on", None),
    ("ja_doctor", "Kyoko", "お客様にお願い申し上げます。お客様の中に、お医者様または看護師の方はいらっしゃいませんか。", "doctor", None),
    ("ja_meal", "Kyoko", "皆様、これよりお食事とお飲み物のサービスを始めます。", "meal", None),
    ("en_descent", "Daniel", "Ladies and gentlemen, we have started our descent and will be landing in about twenty minutes.", "descent", "20"),
    ("en_doctor", "Samantha", "If there is a doctor or a nurse on board, please press your call button.", "doctor", None),
    ("en_arrived", "Rishi", "Welcome to Tokyo Haneda. We are now arriving at gate twelve. Please remain seated.", "arrived", "12"),
    ("en_delay", "Karen", "We are delayed by about fifteen minutes due to air traffic. Thank you for your patience.", "delay", "15"),
    ("en_weather", "Samantha", "The weather in Tokyo today is sunny with a high of twenty two degrees.", "none", None),
]


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1:
            sys.exit(f"{path}: needs 16 kHz mono WAV (afconvert -f WAVE -d LEI16@16000 -c 1 in.m4a out.wav)")
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def mac_clip(tmp: Path, id_: str, voice: str, text: str) -> Path:
    aiff, wav = tmp / f"{id_}.aiff", tmp / f"{id_}.wav"
    subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)], check=True)
    return wav


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, help="folder of your own recordings, <id>.wav")
    args = ap.parse_args()
    lib, asr = Library(), get_asr(PA_ASR_MODEL)
    passed = 0
    with tempfile.TemporaryDirectory() as tmp:
        for id_, voice, text, want, n in LINES:
            path = args.dir / f"{id_}.wav" if args.dir else mac_clip(Path(tmp), id_, voice, text)
            if not path.exists():
                print(f"SKIP {id_:11} (no {path.name})")
                continue
            t = time.perf_counter()
            tr = asr.transcribe(read_wav(path), langs=("ja", "en"))
            results = [lib.match(h.text) for h in tr.hypotheses] or [lib.match("")]
            best = max(results, key=lambda r: r["matches"][0]["score"] if r["matches"] else 0.0)
            top = best["matches"][0] if best["matches"] and best["verdict"] != "none" else {}
            got, got_n = top.get("id", "none"), top.get("n")
            ok = got == want and (n is None or got_n == n)
            passed += ok
            print(f"{'PASS' if ok else 'FAIL'} {id_:11} expected {want}/{n or '-'}, got {got}/{got_n or '-'} "
                  f"({best['verdict']}, {time.perf_counter() - t:.1f} s)  heard: {best['heard'][:60]}")
    print(f"\n{passed}/{len(LINES)} correct with Whisper {PA_ASR_MODEL}")


if __name__ == "__main__":
    main()
