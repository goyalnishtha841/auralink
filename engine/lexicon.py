"""Loads the intent lexicon JSON and reloads it whenever the file changes on disk."""
from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEXICON = ROOT / "data" / "lexicon" / "intents.json"
LANGUAGES_FILE = ROOT / "data" / "languages.json"


def unspaced_script_pattern() -> re.Pattern | None:
    """Runs of characters from scripts written without spaces between words (Thai), per data/languages.json."""
    if not LANGUAGES_FILE.exists():
        return None
    scripts = [s for s in json.loads(LANGUAGES_FILE.read_text("utf-8"))["scripts"] if s.get("spaces") is False]
    if not scripts:
        return None
    ranges = "".join(re.escape(chr(int(s["from"], 16))) + "-" + re.escape(chr(int(s["to"], 16))) for s in scripts)
    return re.compile(f"[{ranges}]+")


class Intent(BaseModel):
    id: str
    icon: str
    urgent: bool = False
    label: dict[str, str]
    variants: dict[str, list[str]]
    crew_ja: str
    prior: dict[str, float] = Field(default_factory=dict)


class LexiconFile(BaseModel):
    version: int
    stopwords: list[str] = Field(default_factory=list)
    intents: list[Intent]


class Lexicon:
    def __init__(self, path: Path | str = DEFAULT_LEXICON):
        self.path = Path(path)
        self._mtime = -1.0
        self.reload_if_changed()

    def reload_if_changed(self) -> bool:
        mtime = self.path.stat().st_mtime
        if mtime == self._mtime:
            return False
        data = LexiconFile.model_validate_json(self.path.read_text("utf-8"))
        self.intents = data.intents
        self.stopwords = {w.lower() for w in data.stopwords}
        self._by_id = {i.id: i for i in data.intents}
        self._variants = {
            i.id: sorted({v.lower() for vs in i.variants.values() for v in vs}) for i in data.intents
        }
        self.unspaced = unspaced_script_pattern()
        words = {v for vs in self._variants.values() for v in vs} | self.stopwords
        self.unspaced_vocab = sorted((w for w in words if self.unspaced and self.unspaced.fullmatch(w.replace(" ", ""))),
                                     key=len, reverse=True)
        self._mtime = mtime
        self.version_key = (str(self.path), mtime)  # changes whenever the file is reloaded
        return True

    def get(self, intent_id: str) -> Intent:
        return self._by_id[intent_id]

    def has(self, intent_id: str) -> bool:
        return intent_id in self._by_id

    def variants(self, intent_id: str) -> list[str]:
        return self._variants[intent_id]

    def prior(self, intent_id: str, phase: str) -> float:
        return self._by_id[intent_id].prior.get(phase, 1.0)

    def is_urgent(self, intent_id: str) -> bool:
        return self._by_id[intent_id].urgent

    def label(self, intent_id: str, lang: str) -> str:
        labels = self._by_id[intent_id].label
        return labels.get(lang) or labels["en"]
