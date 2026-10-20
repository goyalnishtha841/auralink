"""Pre-flight check before a demo: is everything needed for an offline run in place?

    .venv/bin/python scripts/preflight.py          # check only
    scripts/demo.sh                                # check, then start the hub

Exit code 1 if something critical is missing.
"""
from __future__ import annotations

import importlib
import json
import os
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

GREEN, AMBER, RED, DIM, END = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"
critical_failed = False


def report(ok: bool | None, name: str, detail: str = "", fix: str = "") -> None:
    """ok: True pass, None warning, False critical failure."""
    global critical_failed
    mark = f"{GREEN}✔{END}" if ok else f"{AMBER}!{END}" if ok is None else f"{RED}✘{END}"
    print(f" {mark} {name}{f'  {DIM}{detail}{END}' if detail else ''}")
    if fix and not ok:
        print(f"     {DIM}fix:{END} {fix}")
    if ok is False:
        critical_failed = True


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    print("\nAuralink pre-flight check\n")

    for mod, why in [("fastapi", "hub server"), ("uvicorn", "hub server"), ("faster_whisper", "speech-to-text"),
                     ("phonemizer", "phonetic matcher"), ("segno", "seat QR cards")]:
        try:
            importlib.import_module(mod)
            report(True, f"Python package {mod}", why)
        except ImportError:
            critical = mod in ("fastapi", "uvicorn", "faster_whisper")
            report(False if critical else None, f"Python package {mod}", f"missing ({why})",
                   "uv pip install -p .venv/bin/python -r requirements-dev.txt")

    for name in ("data/lexicon/intents.json", "data/templates/messages.json", "data/lexicon/phone_costs.json"):
        try:
            json.loads((ROOT / name).read_text("utf-8"))
            report(True, f"{name} is valid JSON")
        except Exception as e:
            report(False, f"{name} is valid JSON", str(e)[:80], "fix the JSON syntax (a missing comma or quote)")

    try:
        from faster_whisper.utils import download_model

        download_model(os.environ.get("AURALINK_ASR_MODEL", "base"), local_files_only=True)
        report(True, "Whisper model downloaded", "voice works offline")
    except Exception:
        report(False, "Whisper model downloaded", "not on this laptop yet",
               "connect to the internet once and run scripts/run.sh; it downloads about 145 MB")

    try:
        from engine import Context, Hypothesis, Lexicon, interpret
        from engine.matcher import make_similarity

        sim = make_similarity("hybrid")
        kind = getattr(sim, "name", "text")
        report(True if kind == "hybrid" else None, "Phonetic matcher (eSpeak-NG)",
               "hybrid matcher ready" if kind == "hybrid" else "falling back to spelling matching",
               "brew install espeak-ng")
        r = interpret([Hypothesis(text="thoda wotter and kambal")], Context(seat="34K"), Lexicon(), sim=sim)
        got = [c.candidates[0].intent for c in r.cards]
        report(got == ["water", "blanket"], "Test sentence \"thoda wotter and kambal\"", f"→ {got or 'nothing'}",
               "run .venv/bin/python -m pytest -q to find what broke")
    except Exception as e:
        report(False, "Matcher", str(e)[:100], "run .venv/bin/python -m pytest -q")

    https = (ROOT / "certs" / "hub.pem").exists() and (ROOT / "certs" / "hub-key.pem").exists()
    report(True if https else None, "HTTPS certificate", "phones can use the microphone" if https else
           "phones will block the microphone (typing and pictures still work)",
           "see 'Use it on a real phone' in the README (mkcert)")

    with socket.socket() as s:
        free = s.connect_ex(("127.0.0.1", port)) != 0
    report(free, f"Port {port} is free", "" if free else "another hub or app is using it",
           f"stop the other hub (Ctrl+C in its terminal) or: lsof -ti:{port} | xargs kill")

    base = f"{'https' if https else 'http'}://{lan_ip()}:{port}"
    print(f"\nOpen on this laptop:   {base.replace(lan_ip(), 'localhost')}")
    print(f"Phones on this Wi-Fi:  {base}/passenger.html?seat=34K")
    print(f"Crew tablet:           {base}/crew.html")
    print(f"Under the hood:        {base}/judge.html")
    print(f"Seat QR cards:         {base}/seats.html     Cabin noise: {base}/noise.html")
    try:
        import segno

        print("\nScan for seat 34K:")
        segno.make(f"{base}/passenger.html?seat=34K", error="m").terminal(compact=True)
    except ImportError:
        pass

    print(f"\n{RED}Not ready: fix the ✘ items above.{END}\n" if critical_failed else f"\n{GREEN}Ready for take-off.{END}\n")
    sys.exit(1 if critical_failed else 0)


if __name__ == "__main__":
    main()
