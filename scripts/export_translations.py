"""Native-speaker review sheets: every sentence a passenger or crew member reads, one CSV per language.

    .venv/bin/python scripts/export_translations.py      # writes docs/translation-review/<code>.csv

Open a CSV in Google Sheets or Excel, give it to a native speaker, and ask them to fill in the last two
columns (OK? yes/no, and a better wording). Then copy the corrections back into the JSON file named in
the "file" column. English is the reference in every sheet.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "translation-review"
LANGS = {"hi": "Hindi", "ta": "Tamil", "th": "Thai", "ja": "Japanese"}


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text("utf-8"))


def rows_for(code: str) -> list[tuple[str, str, str, str]]:
    """(file, where, English, this language)."""
    out = []
    add = lambda f, where, d: out.append((f, where, d.get("en", ""), d.get(code, ""))) if isinstance(d, dict) and d.get("en") else None  # noqa: E731
    m, mf = load("data/templates/messages.json"), "data/templates/messages.json"
    for r in m["replies"]:
        add(mf, f"crew reply {r['id']}", r)
    for k, v in m["status"].items():
        add(mf, f"status {k}", v)
    for s in m["safety"]:
        add(mf, f"safety {s['id']} title", s["title"])
        for n, st in enumerate(s["steps"], 1):
            add(mf, f"safety {s['id']} step {n}", st["text"])
            add(mf, f"safety {s['id']} step {n} (simple)", st["simple"])
    e = m["exit_row"]
    for k in ("title", "intro"):
        add(mf, f"exit row {k}", e[k])
    for q in e["questions"]:
        add(mf, f"exit row question {q['id']}", q["text"])
    for k, v in e["answers"].items():
        add(mf, f"exit row answer {k}", v)
    for k, v in e["done"].items():
        add(mf, f"exit row done {k}", v)
    for k in ("title", "done"):
        add(mf, f"symptom screen {k}", m["triage"][k])
    for s in m["triage"]["symptoms"]:
        add(mf, f"symptom {s['id']}", s["label"])
    for p in m["phrasebook"]["phrases"]:
        add(mf, f"phrasebook {p['id']}", p["text"])
    a, af = load("data/templates/announcements.json"), "data/templates/announcements.json"
    for x in a["announcements"]:
        add(af, f"PA caption {x['id']}", x["text"])
        if "text_n" in x:
            add(af, f"PA caption {x['id']} (with number)", x["text_n"])
    lx, lf = load("data/lexicon/intents.json"), "data/lexicon/intents.json"
    for i in lx.get("intents", lx if isinstance(lx, list) else []):
        add(lf, f"request label {i['id']}", i["label"])
    if code != "ja":
        en_ui, f = load("data/i18n/en.json"), f"data/i18n/{code}.json"
        own = load(f)
        for k, v in en_ui.items():
            if not k.startswith("_") and isinstance(v, str):
                out.append((f, f"screen text {k}", v, own.get(k, "")))
        pf = "data/prompts/recording_prompts.json"
        for p in load(pf)["prompts"]:
            if code in p.get("for", [code]):
                add(pf, f"recording prompt {p['id']}", p["text"])
        rec = (ROOT / "apps" / "record.html").read_text("utf-8")
        block = re.search(rf"\n  {code}: \{{(.*?)\n  \}},", rec, re.S)
        if block:
            for k, v in re.findall(r'(\w+): "([^"]+)"', block.group(1)):
                out.append(("apps/record.html", f"recording page {k}", "", v))
            for n, v in enumerate(re.findall(r'^\s+"([^"]+)",$', block.group(1), re.M), 1):
                out.append(("apps/record.html", f"recording consent point {n}", "", v))
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for code, name in LANGS.items():
        rows = rows_for(code)
        with (OUT / f"{code}.csv").open("w", newline="", encoding="utf-8-sig") as f:   # BOM: Excel shows the script
            w = csv.writer(f)
            w.writerow(["file", "where it appears", "English", name, "OK? (yes/no)", "Better wording"])
            w.writerows([*r, "", ""] for r in rows)
        missing = sum(1 for r in rows if not r[3])
        print(f"{name}: {len(rows)} sentences -> {(OUT / f'{code}.csv').relative_to(ROOT)}"
              + (f"  ({missing} have no {name} text: English is shown instead)" if missing else ""))
    if not OUT.exists():
        sys.exit(1)


if __name__ == "__main__":
    main()
