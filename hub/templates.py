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
        return {
            "id": t["id"],
            "pictogram": t["pictogram"],
            "title": t["title"].get(lang) or t["title"]["en"],
            "caption": t["caption"].get(lang) or t["caption"]["en"],
            "caption_en": t["caption"]["en"],
        }
