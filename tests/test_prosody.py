import numpy as np

from engine import Lexicon
from engine.prosody import STRESS_FLOOR, analyze
from hub.state import MAX_ROUNDS, Cabin


def test_calm_synthetic_tone_scores_low():
    sr = 16_000
    t = np.linspace(0, 1, sr, endpoint=False)
    calm = (0.1 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)
    assert analyze(calm, sr).score < STRESS_FLOOR


def test_loud_wobbling_pitch_scores_higher_than_calm():
    sr = 16_000
    t = np.linspace(0, 1, sr, endpoint=False)
    calm = 0.1 * np.sin(2 * np.pi * 150 * t)
    f0 = 260 + 60 * np.sin(2 * np.pi * 6 * t)
    agitated = 0.35 * np.sin(2 * np.pi * np.cumsum(f0) / sr) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 6 * t)))
    assert analyze(agitated.astype(np.float32), sr).score > analyze(calm.astype(np.float32), sr).score


def test_silence_scores_zero_not_an_error():
    assert analyze(np.zeros(16_000, dtype=np.float32)).score == 0.0


def test_high_voice_stress_escalates_before_max_rounds_without_any_matched_card():
    cabin = Cabin(Lexicon())
    _, cards, escalated = cabin.handle_text("30A", "hmm", voice_stress=0.9)
    assert not cards
    assert escalated is not None and escalated.status == "needs_human"
    assert escalated.voice_stress == 0.9


def test_low_voice_stress_still_waits_for_max_rounds_like_before():
    cabin = Cabin(Lexicon())
    for _ in range(MAX_ROUNDS - 1):
        _, cards, escalated = cabin.handle_text("30A", "hmm", voice_stress=0.1)
        assert not cards and escalated is None
    _, cards, escalated = cabin.handle_text("30A", "hmm", voice_stress=0.1)
    assert escalated is not None and escalated.voice_stress is None


def test_a_calm_successfully_matched_request_is_never_second_guessed():
    cabin = Cabin(Lexicon())
    _, cards, escalated = cabin.handle_text("30A", "water please", voice_stress=0.95)
    assert cards and cards[0].candidates[0].intent == "water"
    assert escalated is None
