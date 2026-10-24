"""Cabin state: seats, request cards and the safety broadcast. No networking here, so it is easy to test."""
from __future__ import annotations

import itertools
import time
from typing import Literal

from pydantic import BaseModel, Field

from engine import Candidate, Context, Hypothesis, Lexicon, Result, interpret
from engine.prosody import STRESS_FLOOR

CardStatus = Literal["awaiting_confirm", "urgent_unconfirmed", "confirmed", "needs_human", "acknowledged", "closed"]
CREW_VISIBLE = {"urgent_unconfirmed", "confirmed", "needs_human", "acknowledged"}
MAX_ROUNDS = 2  # after this many failed clarifications the crew gets "Needs human help"
SHAKE_WINDOW_S = 12     # several phones shaking within this window looks like turbulence, not passengers
SHAKE_SEATS = 5         # ...once at least this many distinct seats have shaken

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
    source: Literal["voice", "text", "picture", "shake"] = "text"   # how the passenger asked
    symptom: str | None = None                              # medical requests: what the passenger tapped
    voice_stress: float | None = None                      # engine/prosody.py: sounded distressed, words unclear
    translated: str | None = None          # Free Talk: unreviewed machine translation of `heard`, for crew
    lang: str = "en"                                        # passenger's language when asking
    round_id: str | None = None                             # on a care round (hub/rounds.py)
    claimed_by: str | None = None                            # crew member's name, so only one picks it up
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    timeline: dict[str, float] = Field(default_factory=dict)   # status -> when it was first reached (flight report)


class Seat(BaseModel):
    id: str
    lang: str = "en"
    senior: bool = False
    pictures: bool = False   # picture-only mode: crew should answer visually or in person
    read: bool = False       # read aloud on the passenger's phone
    accessibility: str | None = None   # None, "deaf_hoh", "low_vision", "mobility", "cognitive"
    checked_in: bool = False # preferences set at the airport / gate before boarding
    connected: bool = False
    failed_attempts: int = 0
    conv_mode: bool = False  # Live Conversation panel is open: audio goes to engine/translate.py,
                              # not the intent matcher (hub/main.py handle_conv_audio)


# understood: first time; understood_again: after the simpler step-by-step version;
# reexplaining: going through that version now; stuck: still unclear at `step` -> crew should go
SafetyStatus = Literal["understood", "understood_again", "reexplaining", "stuck"]


class SafetyAnswer(BaseModel):
    status: SafetyStatus
    step: int | None = None
    at: float = Field(default_factory=time.time)


class Broadcast(BaseModel):
    id: str
    template_id: str
    sent_at: float = Field(default_factory=time.time)
    responses: dict[str, SafetyAnswer] = Field(default_factory=dict)


class ExitCheck(BaseModel):
    """Exit-row picture check at boarding (supports the crew's own confirmation; it does not replace it)."""
    seat: str
    answers: dict[str, bool] = Field(default_factory=dict)
    reseat: bool = False
    result: Literal["pending", "pass", "talk"] = "pending"
    at: float = Field(default_factory=time.time)


class Cabin:
    def __init__(self, lexicon: Lexicon):
        self.lex = lexicon
        self.phase = "cruise"
        self.seats = {s: Seat(id=s) for s in SEAT_IDS}
        self.cards: dict[str, Card] = {}
        self.broadcast: Broadcast | None = None
        self.past_broadcasts: list[Broadcast] = []
        self.exit_checks: dict[str, ExitCheck] = {}
        self.pa_log: list[dict] = []          # captioned announcements: {pa_id, id, n, at}
        self.round: dict | None = None        # care round in progress (hub/rounds.py)
        self.past_rounds: list[dict] = []
        self.last_visit: dict[str, float] = {}   # seat -> when crew last stopped there on a round
        self.shake_events: list[tuple[float, str]] = []   # recent (time, seat) shake-to-call taps
        self.turbulence: dict | None = None   # {seats, at} once enough seats shook at once
        self.started_at = time.time()
        self._ids = itertools.count(1)

    def reset(self) -> None:
        """Clear requests, briefings and exit checks between demo runs. Connections and languages stay."""
        self.cards.clear()
        self.broadcast = None
        self.past_broadcasts.clear()
        self.exit_checks.clear()
        self.pa_log.clear()
        self.round = None
        self.past_rounds.clear()
        self.last_visit.clear()
        self.shake_events.clear()
        self.turbulence = None
        self.started_at = time.time()
        self.phase = "cruise"
        for seat in self.seats.values():
            seat.failed_attempts = 0

    # passenger side

    def handle_text(self, seat: str, text: str, nbest: list[Hypothesis] | None = None,
                    source: str = "text", voice_stress: float = 0.0) -> tuple[Result, list[Card], Card | None]:
        """Interpret one utterance. Returns the result, new draft cards, and an escalation card if any.

        voice_stress (engine/prosody.py, 0..1): how distressed the voice sounded, independent of
        whether the words were understood. Only acts when nothing matched at all — a calm,
        successfully matched request is never second-guessed by how it sounded.
        """
        self.lex.reload_if_changed()
        s = self.seats[seat]
        ctx = Context(seat=seat, lang=s.lang, phase=self.phase, senior_mode=s.senior)
        result = interpret(nbest or [Hypothesis(text=text)], ctx, self.lex)

        cards = [
            self._new_card(seat, "urgent_unconfirmed" if d.urgent else "awaiting_confirm",
                           candidates=d.candidates, heard=d.span, urgent=d.urgent,
                           confident=d.status == "confident", source=source)
            for d in result.cards
        ]
        escalated = None
        if cards:
            s.failed_attempts = 0
        else:
            s.failed_attempts += 1
            distressed = voice_stress >= STRESS_FLOOR
            if s.failed_attempts >= MAX_ROUNDS or distressed:
                s.failed_attempts = 0
                escalated = self._new_card(seat, "needs_human", candidates=result.best_guesses, heard=text,
                                           rounds=MAX_ROUNDS, source=source,
                                           voice_stress=round(voice_stress, 3) if distressed else None)
        return result, cards, escalated

    def icon_request(self, seat: str, intent: str, source: str = "picture") -> Card:
        self._check_intent(intent)
        self.seats[seat].failed_attempts = 0
        if source == "shake":
            self._record_shake(seat)
        return self._new_card(seat, "confirmed", intent=intent, urgent=self.lex.is_urgent(intent), source=source)

    def escalate_free_text(self, seat: str, heard: str, translated: str | None) -> Card:
        """The passenger explicitly chose to send something outside the fixed list, after seeing
        the Free Talk suggestion. Goes straight to crew, like any other request — never auto-sent."""
        self.seats[seat].failed_attempts = 0
        return self._new_card(seat, "needs_human", heard=heard, translated=translated, source="text")

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

    def set_symptom(self, card_id: str, symptom: str, known: set[str]) -> Card:
        if symptom not in known:
            raise ValueError(f"unknown symptom {symptom!r}")
        card = self.cards[card_id]
        if card.intent != "medical":
            raise ValueError("symptoms are only for medical requests")
        card.symptom = symptom
        card.updated_at = time.time()
        card.timeline.setdefault("symptom", card.updated_at)
        return card

    def safety_response(self, seat: str, status: str, step: int | None = None) -> SafetyAnswer:
        if not self.broadcast:
            raise ValueError("no safety briefing is running")
        answer = SafetyAnswer(status=status, step=step if status == "stuck" else None)
        self.broadcast.responses[seat] = answer
        return answer

    def exit_answer(self, seat: str, answers: dict[str, bool], reseat: bool, question_ids: list[str]) -> ExitCheck:
        check = self.exit_checks.get(seat)
        if check is None:
            raise ValueError(f"no exit-row check for seat {seat}")
        check.answers = {q: bool(answers.get(q)) for q in question_ids}
        check.reseat = reseat
        check.result = "pass" if not reseat and all(check.answers.values()) else "talk"
        check.at = time.time()
        return check

    # crew side

    def acknowledge(self, card_id: str) -> Card:
        return self._set(self.cards[card_id], "acknowledged")

    def reply(self, card_id: str, reply_id: str) -> Card:
        card = self.cards[card_id]
        card.reply_id = reply_id
        return self._set(card, "acknowledged")

    def close(self, card_id: str) -> Card:
        return self._set(self.cards[card_id], "closed")

    def claim(self, card_id: str, crew_name: str) -> Card:
        """One crew member picks this request up, so others see it is being handled."""
        card = self.cards[card_id]
        card.claimed_by = crew_name
        card.updated_at = time.time()
        return card

    def release(self, card_id: str) -> Card:
        card = self.cards[card_id]
        card.claimed_by = None
        card.updated_at = time.time()
        return card

    def start_broadcast(self, template_id: str) -> Broadcast:
        self.end_broadcast()
        self.broadcast = Broadcast(id=f"b{next(self._ids)}", template_id=template_id)
        return self.broadcast

    def end_broadcast(self) -> None:
        if self.broadcast:
            self.past_broadcasts.append(self.broadcast)
        self.broadcast = None

    def all_broadcasts(self) -> list[Broadcast]:
        return self.past_broadcasts + ([self.broadcast] if self.broadcast else [])

    def start_exit_check(self, seats: list[str]) -> list[ExitCheck]:
        self.exit_checks = {s: ExitCheck(seat=s) for s in seats if s in self.seats}
        return list(self.exit_checks.values())

    def add_pa(self, announcement_id: str, n: str | None = None) -> dict:
        entry = {"pa_id": f"pa{next(self._ids)}", "id": announcement_id, "n": n, "at": time.time()}
        self.pa_log.append(entry)
        return entry

    def start_round(self, plan: dict) -> dict:
        """Take the planned stops onto a round: their requests are acknowledged and leave the plan."""
        if self.round:
            raise ValueError("a round is already in progress")
        if not plan["stops"]:
            raise ValueError("nothing to do on a round")
        rid = f"r{next(self._ids)}"
        self.round = {"id": rid, "started_at": time.time(), "stops": [{**st, "done": False} for st in plan["stops"]]}
        for st in plan["stops"]:
            for cid in st["cards"]:
                card = self.cards[cid]
                card.round_id = rid
                self._set(card, "acknowledged")
        return self.round

    def finish_stop(self, seat: str) -> list[Card]:
        if not self.round:
            raise ValueError("no round in progress")
        stop = next((st for st in self.round["stops"] if st["seat"] == seat), None)
        if stop is None:
            raise ValueError(f"seat {seat} is not on this round")
        stop["done"] = True
        self.last_visit[seat] = time.time()
        closed = [self.close(cid) for cid in stop["cards"] if self.cards[cid].status != "closed"]
        if all(st["done"] for st in self.round["stops"]):
            self.end_round()
        return closed

    def end_round(self) -> None:
        if self.round:
            self.round["ended_at"] = time.time()
            self.past_rounds.append(self.round)
            for st in self.round["stops"]:   # unfinished stops go back into the next plan
                for cid in st["cards"] if not st["done"] else []:
                    self.cards[cid].round_id = None
        self.round = None

    def round_seats(self) -> set[str]:
        return {st["seat"] for st in self.round["stops"] if not st["done"]} if self.round else set()

    def heatmap(self) -> dict[str, str]:
        """Per seat: understood / understood_again / reexplaining / stuck / pending / idle / offline."""
        out = {}
        for sid, seat in self.seats.items():
            if self.broadcast and sid in self.broadcast.responses:
                out[sid] = self.broadcast.responses[sid].status
            elif not seat.connected:
                out[sid] = "offline"
            else:
                out[sid] = "pending" if self.broadcast else "idle"
        return out

    def crew_cards(self) -> list[Card]:
        visible = [c for c in self.cards.values() if c.status in CREW_VISIBLE]
        return sorted(visible, key=lambda c: (not c.urgent, c.status == "acknowledged", c.created_at))

    def clear_turbulence(self) -> None:
        self.turbulence = None
        self.shake_events = []

    # helpers

    def _record_shake(self, seat: str) -> None:
        """5+ seats shaking their phones within a few seconds looks like turbulence, not passengers calling."""
        now = time.time()
        self.shake_events = [(t, s) for t, s in self.shake_events if now - t <= SHAKE_WINDOW_S]
        self.shake_events.append((now, seat))
        seats = sorted({s for _, s in self.shake_events})
        if len(seats) >= SHAKE_SEATS:
            self.turbulence = {"seats": seats, "at": now}

    def _new_card(self, seat: str, status: CardStatus, **fields) -> Card:
        card = Card(id=f"c{next(self._ids)}", seat=seat, status=status, lang=self.seats[seat].lang, **fields)
        card.timeline["created"] = card.created_at
        card.timeline[status] = card.created_at
        self.cards[card.id] = card
        return card

    def _set(self, card: Card, status: CardStatus) -> Card:
        card.status = status
        card.updated_at = time.time()
        card.timeline.setdefault(status, card.updated_at)
        return card

    def _check_intent(self, intent: str) -> None:
        if not self.lex.has(intent):
            raise ValueError(f"unknown intent {intent!r}")
