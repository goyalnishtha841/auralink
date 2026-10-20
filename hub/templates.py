"""Pre-approved message templates (crew replies, status lines, safety briefings)."""
from __future__ import annotations

import json
from pathlib import Path

from engine.lexicon import ROOT

DEFAULT_TEMPLATES = ROOT / "data" / "templates" / "messages.json"


class Templates:
    def __init__(self, path: Path | str = DEFAULT_TEMPLATES):
        self.path = Path(path)
        self._mtime = -1.0
        self.reload_if_changed()

    def reload_if_changed(self) -> None:
        mtime = self.path.stat().st_mtime
        if mtime != self._mtime:
            self.data = json.loads(self.path.read_text("utf-8"))
            self.replies = {r["id"]: r for r in self.data["replies"]}
            self.safety = {s["id"]: s for s in self.data["safety"]}
            self._mtime = mtime

    def status(self, key: str, lang: str) -> str:
        texts = self.data["status"][key]
        return texts.get(lang) or texts["en"]

    def reply(self, reply_id: str, lang: str) -> str:
        r = self.replies[reply_id]
        return r.get(lang) or r["en"]

    def safety_view(self, template_id: str, lang: str) -> dict:
        t = self.safety[template_id]
        pick = lambda d: d.get(lang) or d["en"]  # noqa: E731
        return {
            "id": t["id"],
            "title": pick(t["title"]),
            "steps": [{"pictogram": st["pictogram"], "text": pick(st["text"]), "simple": pick(st["simple"]),
                       "text_en": st["text"]["en"]} for st in t["steps"]],
        }

    def exit_view(self, lang: str) -> dict:
        e = self.data["exit_row"]
        pick = lambda d: d.get(lang) or d["en"]  # noqa: E731
        return {
            "title": pick(e["title"]), "intro": pick(e["intro"]),
            "questions": [{"id": q["id"], "pictogram": q["pictogram"], "text": pick(q["text"])} for q in e["questions"]],
            "answers": {k: pick(v) for k, v in e["answers"].items()},
        }

    def exit_done(self, result: str, lang: str) -> str:
        d = self.data["exit_row"]["done"]["pass" if result == "pass" else "talk"]
        return d.get(lang) or d["en"]

    @property
    def exit_question_ids(self) -> list[str]:
        return [q["id"] for q in self.data["exit_row"]["questions"]]

    @property
    def exit_rows(self) -> list[int]:
        return self.data.get("exit_rows", [])
