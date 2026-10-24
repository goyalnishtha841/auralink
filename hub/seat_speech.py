"""Turn recognised speech into a seat id, for the shared scanner's "say your seat" mic.

One scanner for the whole cabin means a passenger has no per-seat QR to fall back on, so
instead of only a tap-the-seat-map picker (web/app/passenger SeatGate), they can also say it:
"three four kay", "thirty four K", or just "34K". Pure text in, no ASR here, so it's easy to
test on its own; hub/main.py's /api/seat/by-voice does the speech-to-text part.
"""
from __future__ import annotations

import re

_DIGIT_WORDS = {
    "zero": 0, "oh": 0, "o": 0, "one": 1, "won": 1, "two": 2, "to": 2, "too": 2,
    "three": 3, "four": 4, "for": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "ate": 8, "nine": 9,
}
_TEEN_WORDS = {
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TEN_WORDS = {"ten": 10, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50}
# A-K without F/I (the JAL 787 economy layout skips them, like most wide-body cabins), by
# letter name, NATO phonetic word, and common look-alikes an ASR model actually outputs.
_LETTER_WORDS = {
    "a": "A", "ay": "A", "aye": "A", "alpha": "A",
    "b": "B", "bee": "B", "be": "B", "bravo": "B",
    "c": "C", "cee": "C", "sea": "C", "see": "C", "charlie": "C",
    "d": "D", "dee": "D", "delta": "D",
    "e": "E", "ee": "E", "echo": "E",
    "g": "G", "gee": "G", "golf": "G",
    "h": "H", "aitch": "H", "hotel": "H",
    "j": "J", "jay": "J", "juliet": "J", "juliett": "J", "juliette": "J",
    "k": "K", "kay": "K", "kilo": "K",
}


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z]+|\d+", text.lower())


def _number_groups(tokens: list[str]) -> list[str]:
    """Digit-string groups found in `tokens`: "34", ["thirty", "four"] and ["3", "4"] (kept
    apart, for the caller to also try concatenating) all produce a "34" among their groups."""
    groups: list[str] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.isdigit():
            groups.append(tok)
        elif tok in _TEN_WORDS:
            value = _TEN_WORDS[tok]
            if i + 1 < len(tokens) and _DIGIT_WORDS.get(tokens[i + 1]):
                value += _DIGIT_WORDS[tokens[i + 1]]
                i += 1
            groups.append(str(value))
        elif tok in _TEEN_WORDS:
            groups.append(str(_TEEN_WORDS[tok]))
        elif tok in _DIGIT_WORDS:
            groups.append(str(_DIGIT_WORDS[tok]))
        i += 1
    return groups


def parse(text: str, seats: set[str]) -> str | None:
    """Best-effort seat id from `text`, or None if nothing in `seats` matches.

    Looks for a seat letter first (by name, phonetic-alphabet word, or the raw letter), then a
    row among the spoken digits -- a two-digit number directly, a spoken "thirty four", or two
    single digits said separately ("three", "four") -- and returns the combination only if it
    is one of the known `seats`, never a guess outside that set.
    """
    tokens = _tokenize(text)
    if not tokens:
        return None
    rows = {s[:-1] for s in seats}
    letters = {s[-1] for s in seats}

    letter = None
    for tok in tokens:
        up = tok.upper()
        if len(up) == 1 and up in letters:
            letter = up
        elif tok in _LETTER_WORDS and _LETTER_WORDS[tok] in letters:
            letter = _LETTER_WORDS[tok]
    if letter is None:
        return None

    groups = _number_groups(tokens)
    candidates = list(groups)
    for a, b in zip(groups, groups[1:]):
        if len(a) == 1 and len(b) == 1:
            candidates.append(a + b)
    for row in candidates:
        if row in rows and row + letter in seats:
            return row + letter
    return None
