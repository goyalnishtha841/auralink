"""Cabin state: seats, request cards and the safety broadcast. No networking here, so it is easy to test."""
from __future__ import annotations

import itertools
import time
from typing import Literal

from pydantic import BaseModel, Field

from engine import Candidate, Context, Hypothesis, Lexicon, Result, interpret

CardStatus = Literal["awaiting_confirm", "urgent_unconfirmed", "confirmed", "needs_human", "acknowledged", "closed"]
CREW_VISIBLE = {"urgent_unconfirmed", "confirmed", "needs_human", "acknowledged"}
MAX_ROUNDS = 2  # after this many failed clarifications the crew gets "Needs human help"

# JAL 787 economy layout, 3-3-3
SEAT_IDS = [f"{row}{letter}" for row in range(30, 36) for letter in "ABCDEGHJK"]


class Card(BaseModel):
    id: str
    seat: str
    status: CardStatus
    intent: str | None = None
    candidates: list[Candidate] = Field(default_factory=list)
    heard: str = ""
    rounds: int = 0
    urgent: bool = False
    confident: bool = True   # False: show a choice between close candidates instead of yes/no
    reply_id: str | None = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class Seat(BaseModel):
    id: str
    lang: str = "en"
    senior: bool = False
    connected: bool = False
    failed_attempts: int = 0


class Broadcast(BaseModel):
    id: str
    template_id: str
    sent_at: float = Field(default_factory=time.time)
    responses: dict[str, Literal["understood", "explain_again"]] = Field(default_factory=dict)


class Cabin:
    def __init__(self, lexicon: Lexicon):
        self.lex = lexicon
        self.phase = "cruise"
        self.seats = {s: Seat(id=s) for s in SEAT_IDS}
        self.cards: dict[str, Card] = {}
        self.broadcast: Broadcast | None = None
        self._ids = itertools.count(1)

    # passenger side

    def handle_text(self, seat: str, text: str, nbest: list[Hypothesis] | None = None
                    ) -> tuple[Result, list[Card], Card | None]:
        """Interpret one utterance. Returns the result, new draft cards, and an escalation card if any."""
        self.lex.reload_if_changed()
        s = self.seats[seat]
        ctx = Context(seat=seat, lang=s.lang, phase=self.phase, senior_mode=s.senior)
        result = interpret(nbest or [Hypothesis(text=text)], ctx, self.lex)

        cards = [
            self._new_card(seat, "urgent_unconfirmed" if d.urgent else "awaiting_confirm",
                           candidates=d.candidates, heard=d.span, urgent=d.urgent,
                           confident=d.status == "confident")
            for d in result.cards
        ]
        escalated = None
        if cards:
            s.failed_attempts = 0
        else:
            s.failed_attempts += 1
            if s.failed_attempts >= MAX_ROUNDS:
                s.failed_attempts = 0
                escalated = self._new_card(seat, "needs_human", candidates=result.best_guesses,
                                           heard=text, rounds=MAX_ROUNDS)
        return result, cards, escalated

    def icon_request(self, seat: str, intent: str) -> Card:
        self._check_intent(intent)
        self.seats[seat].failed_attempts = 0
        return self._new_card(seat, "confirmed", intent=intent, urgent=self.lex.is_urgent(intent))

    def confirm(self, card_id: str, intent: str) -> Card:
        self._check_intent(intent)
        card = self.cards[card_id]
        card.intent = intent
        card.urgent = self.lex.is_urgent(intent)
        return self._set(card, "confirmed")

    def reject(self, card_id: str) -> Card:
        card = self.cards[card_id]
        card.rounds += 1
        if card.rounds >= MAX_ROUNDS:
            return self._set(card, "needs_human")
        card.updated_at = time.time()
        return card

    def safety_response(self, seat: str, understood: bool) -> None:
        if self.broadcast:
            self.broadcast.responses[seat] = "understood" if understood else "explain_again"

    # crew side

    def acknowledge(self, card_id: str) -> Card:
        return self._set(self.cards[card_id], "acknowledged")

    def reply(self, card_id: str, reply_id: str) -> Card:
        card = self.cards[card_id]
        card.reply_id = reply_id
        return self._set(card, "acknowledged")

    def close(self, card_id: str) -> Card:
        return self._set(self.cards[card_id], "closed")

    def start_broadcast(self, template_id: str) -> Broadcast:
        self.broadcast = Broadcast(id=f"b{next(self._ids)}", template_id=template_id)
        return self.broadcast

    def heatmap(self) -> dict[str, str]:
        """Per seat: understood / explain_again / pending / offline (no device connected)."""
        out = {}
        for sid, seat in self.seats.items():
            if self.broadcast and sid in self.broadcast.responses:
                out[sid] = self.broadcast.responses[sid]
            elif not seat.connected:
                out[sid] = "offline"
            else:
                out[sid] = "pending" if self.broadcast else "idle"
        return out

    def crew_cards(self) -> list[Card]:
        visible = [c for c in self.cards.values() if c.status in CREW_VISIBLE]
        return sorted(visible, key=lambda c: (not c.urgent, c.status == "acknowledged", c.created_at))

    # helpers

    def _new_card(self, seat: str, status: CardStatus, **fields) -> Card:
        card = Card(id=f"c{next(self._ids)}", seat=seat, status=status, **fields)
        self.cards[card.id] = card
        return card

    def _set(self, card: Card, status: CardStatus) -> Card:
        card.status = status
        card.updated_at = time.time()
        return card

    def _check_intent(self, intent: str) -> None:
        if not self.lex.has(intent):
            raise ValueError(f"unknown intent {intent!r}")
