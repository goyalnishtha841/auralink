"""Voice-stress heuristic: does this utterance *sound* distressed, independent of whether the
words were understood? A panicked or shouted request may not transcribe cleanly enough for the
matcher to reach T1, but a raised, strained voice is itself evidence worth acting on — this is
what lets Auralink escalate to crew even when it cannot make out the words.

Three hand-rolled signals from the raw PCM, no model, no training data (numpy only, same
dependency footprint as the rest of engine/):
- pitch (F0) mean and variability, via autocorrelation on 32 ms frames, restricted to the human
  voice range (80-400 Hz). Panicked or shouted speech tends to run higher and less steady.
- energy (RMS) mean and variability. Raised voices are both louder and more erratic.
- speaking rate, approximated by energy-onset peaks per second. Distress often speeds speech up.

Like T1/T2 in engine/matcher.py, STRESS_FLOOR and the feature weights below are starting values,
not measured ones: there is no labelled distressed-speech set to tune them against yet. Treat the
score as a weak, supporting signal (hub/state.py only uses it to escalate an utterance that
*already* failed to match any intent, never to override a calm, successfully matched request) and
replace the constants once data/recordings/ has real examples with triage labels.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
FRAME_MS = 32
HOP_MS = 10
MIN_F0, MAX_F0 = 80.0, 400.0   # human voice fundamental frequency range
# Calm-speech reference points the score is measured against (rough, unvalidated).
CALM_PITCH_MEAN, CALM_PITCH_STD = 160.0, 25.0
CALM_ENERGY_STD_RATIO = 0.35    # energy std / mean for ordinary speech
CALM_RATE = 3.5                 # onsets per second

STRESS_FLOOR = 0.65   # score at or above this is treated as "sounds distressed" by hub/state.py


@dataclass
class Prosody:
    pitch_mean: float
    pitch_std: float
    energy_std_ratio: float
    rate: float
    score: float


def _frame(audio: np.ndarray, frame: int, hop: int) -> np.ndarray:
    n = 1 + max(0, (len(audio) - frame) // hop)
    return np.stack([audio[i * hop: i * hop + frame] for i in range(n)]) if n else np.empty((0, frame))


def _pitch(frame: np.ndarray, sr: int) -> float | None:
    """One frame's F0 via autocorrelation, or None if it isn't voiced enough to trust."""
    frame = frame - frame.mean()
    if np.sqrt(np.mean(frame ** 2)) < 1e-4:   # near silence
        return None
    ac = np.correlate(frame, frame, mode="full")[len(frame) - 1:]
    lo, hi = int(sr / MAX_F0), int(sr / MIN_F0)
    if hi >= len(ac):
        return None
    segment = ac[lo:hi]
    if segment.size == 0 or ac[0] <= 0:
        return None
    peak = lo + int(np.argmax(segment))
    if ac[peak] / ac[0] < 0.3:   # too weak a periodicity to trust as voiced
        return None
    return sr / peak


def analyze(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> Prosody:
    frame, hop = int(sample_rate * FRAME_MS / 1000), int(sample_rate * HOP_MS / 1000)
    frames = _frame(audio.astype(np.float64), frame, hop)
    if len(frames) < 4:
        return Prosody(0.0, 0.0, 0.0, 0.0, 0.0)

    energy = np.sqrt((frames ** 2).mean(axis=1))
    voiced = energy > max(energy.max() * 0.15, 1e-4)
    pitches = [p for f, v in zip(frames, voiced) if v for p in [_pitch(f, sample_rate)] if p is not None]

    e_mean = float(energy[voiced].mean()) if voiced.any() else 0.0
    e_std_ratio = float(energy[voiced].std() / e_mean) if e_mean > 0 else 0.0
    p_mean = float(np.mean(pitches)) if pitches else 0.0
    p_std = float(np.std(pitches)) if len(pitches) > 1 else 0.0

    onsets = np.sum((energy[1:] > energy[:-1] * 1.4) & voiced[1:])
    duration_s = len(audio) / sample_rate
    rate = float(onsets / duration_s) if duration_s > 0 else 0.0

    if not pitches:   # too little voiced audio (clipped, whispered) to say anything
        return Prosody(p_mean, p_std, e_std_ratio, rate, 0.0)

    pitch_signal = max(0.0, (p_mean - CALM_PITCH_MEAN) / CALM_PITCH_MEAN) + max(0.0, (p_std - CALM_PITCH_STD) / CALM_PITCH_STD)
    energy_signal = max(0.0, (e_std_ratio - CALM_ENERGY_STD_RATIO) / CALM_ENERGY_STD_RATIO)
    rate_signal = max(0.0, (rate - CALM_RATE) / CALM_RATE)
    raw = 0.45 * pitch_signal + 0.35 * energy_signal + 0.2 * rate_signal
    score = 1 - 1 / (1 + raw)   # squashed into 0..1, saturating rather than unbounded

    return Prosody(p_mean, p_std, e_std_ratio, rate, round(score, 3))
