"""Shared data contracts between engine, hub and apps. Change these only as a team."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Phase = Literal["boarding", "cruise", "meal", "post_meal", "descent"]
PHASES: tuple[str, ...] = ("boarding", "cruise", "meal", "post_meal", "descent")

# confident: one clear request        split: several clear requests in one utterance
# close: top two candidates too near  flat: nothing scored above t1     empty: no usable speech
Rule = Literal["confident", "split", "close", "flat", "empty"]


class Hypothesis(BaseModel):
    """One entry of the speech-to-text n-best list."""
    text: str
    conf: float = 1.0
    lang: str | None = None   # language the decoder was forced to, e.g. "en" or "hi"


class Context(BaseModel):
    seat: str
    lang: str = "en"
    phase: Phase = "cruise"
    senior_mode: bool = False


class Candidate(BaseModel):
    intent: str
    score: float          # match strength after context prior
    p: float = 0.0        # share of the score within its card
    heard: str            # what the passenger said, e.g. "wotter"
    matched: str          # lexicon variant it matched, e.g. "water"


class CardDraft(BaseModel):
    """One request found in an utterance, before the passenger confirms it."""
    span: str
    candidates: list[Candidate]
    status: Literal["confident", "close"]
    urgent: bool = False


class Result(BaseModel):
    seat: str
    nbest: list[Hypothesis]
    cards: list[CardDraft]
    rule: Rule
    urgent: bool
    best_guesses: list[Candidate] = Field(default_factory=list)
    latency_ms: dict[str, float] = Field(default_factory=dict)
