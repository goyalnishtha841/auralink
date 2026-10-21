"""Live PA captions: the crew's spoken announcement becomes a caption on every seat, in that seat's language.

Speech (Japanese or English) -> Whisper -> match against data/templates/announcements.json by key
phrases -> the crew see the match and tap Send -> each seat gets the pre-written text in its language,
with a number from the speech filled in ("land in about {n} minutes", "gate {n}").

No machine translation: if nothing in the library matches, nothing is captioned and the crew are
told so. Passengers who are deaf or hard of hearing (picture-only mode) get a flash and vibration.
"""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from engine.lexicon import ROOT

LIBRARY = ROOT / "data" / "templates" / "announcements.json"
SURE = 2.0       # score at which a match is shown as "sure"
MAYBE = 0.9      # below this: no caption, crew are told it is not in the library
FUZZY = 0.82     # an English key phrase counts if a window of the speech is this similar (Whisper typos)

_EN_NUM = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen".split())}
_EN_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_KANJI = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _kanji_number(s: str) -> int:
    """二十五 -> 25, 十 -> 10, 三十 -> 30, 七 -> 7 (1-99, enough for minutes and gates)."""
    if "十" in s:
        tens, _, ones = s.partition("十")
        return (_KANJI.get(tens, 1) if tens else 1) * 10 + (_KANJI.get(ones, 0) if ones else 0)
    return _KANJI.get(s, 0)


def numbers_to_digits(text: str) -> str:
    """'twenty five minutes' -> '25 minutes'; '二十分' -> '20分'. Whisper writes either."""
    out, words = [], re.split(r"(\s+|-)", text)
    for w in words:
        low = w.lower().strip(".,")
        if low in _EN_NUM or low in _EN_TENS:
            value = _EN_NUM.get(low, _EN_TENS.get(low))
            # "twenty" + "five" -> 25 (skip the space or hyphen between them)
            prev = next((i for i in range(len(out) - 1, -1, -1) if out[i].strip() not in {"", "-"}), None)
            if low in _EN_NUM and prev is not None and out[prev].isdigit() and int(out[prev]) % 10 == 0 \
                    and int(out[prev]) >= 20 and value < 10:
                out[prev] = str(int(out[prev]) + value)
                del out[prev + 1:]
                continue
            out.append(str(value))
        else:
            out.append(w)
    text = "".join(out)
    return re.sub(r"[一二三四五六七八九十]+", lambda m: str(_kanji_number(m.group())), text)


SLOT_PATTERNS = {
    "minutes": [r"(\d{1,3})\s*(?:more\s+)?(?:minutes?|mins?)\b", r"(\d{1,3})\s*分"],
    "gate": [r"\bgate\s*(?:number\s*)?(\d{1,3}[a-z]?)\b", r"(\d{1,3})\s*番?\s*ゲート", r"ゲート\s*(\d{1,3})"],
}


def slot_value(kind: str | None, text: str) -> str | None:
    if not kind:
        return None
    for pattern in SLOT_PATTERNS[kind]:
        if m := re.search(pattern, text, flags=re.I):
            return m.group(1).upper()
    return None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s'-]", " ", text.lower())).strip()


def _hit(key: str, text: str, words: list[str]) -> float:
    """1.0 for an exact phrase, the similarity for a near miss (English only), else 0."""
    key = key.lower()
    if key in text:
        return 1.0
    if not key.isascii():
        return 0.0
    n = len(key.split())
    best = max((SequenceMatcher(None, key, " ".join(words[i:i + n])).ratio()
                for i in range(max(1, len(words) - n + 1))), default=0.0)
    return best if best >= FUZZY else 0.0


class Library:
    def __init__(self, path: Path = LIBRARY):
        self.path = path
        self._mtime = -1.0
        self.reload_if_changed()

    def reload_if_changed(self) -> None:
        mtime = self.path.stat().st_mtime
        if mtime != self._mtime:
            self.items = {a["id"]: a for a in json.loads(self.path.read_text("utf-8"))["announcements"]}
            self._mtime = mtime

    def match(self, heard: str) -> dict:
        """Rank the library against what was heard. 'sure' / 'check' / 'none' says how to show it to the crew."""
        self.reload_if_changed()
        text = _clean(numbers_to_digits(heard))
        words = text.split()
        ranked = []
        for a in self.items.values():
            keys = [k for ks in a["keys"].values() for k in ks]
            hits = {k: h for k in keys if (h := _hit(k, text, words))}
            score = sum(hits.values()) - 1.5 * sum(1 for ks in a.get("not", {}).values() for k in ks if k.lower() in text)
            if score > 0:
                ranked.append({"id": a["id"], "score": round(score, 2), "keys": sorted(hits, key=hits.get, reverse=True),
                               "n": slot_value(a.get("slot"), numbers_to_digits(heard))})
        ranked.sort(key=lambda r: -r["score"])
        top = ranked[0]["score"] if ranked else 0.0
        margin = top - (ranked[1]["score"] if len(ranked) > 1 else 0.0)
        verdict = "sure" if top >= SURE and margin >= 1.0 else "check" if top >= MAYBE else "none"
        return {"heard": heard, "verdict": verdict, "matches": ranked[:3]}

    def caption(self, announcement_id: str, lang: str, n: str | None = None) -> dict:
        """What one seat shows: icon, title and text in its language (English under it as a check)."""
        a = self.items[announcement_id]
        texts = a["text_n"] if n and "text_n" in a else a["text"]
        pick = lambda d: (d.get(lang) or d["en"]).replace("{n}", n or "")  # noqa: E731
        return {"id": a["id"], "icon": a["icon"], "text": pick(texts), "text_en": pick({"en": texts["en"]}),
                "title_en": a["title"]["en"], "title_ja": a["title"]["ja"]}

    def menu(self) -> list[dict]:
        self.reload_if_changed()
        return [{"id": a["id"], "icon": a["icon"], "title": a["title"], "slot": a.get("slot"), "text_en": a["text"]["en"]}
                for a in self.items.values()]
