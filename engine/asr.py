"""Speech-to-text front end. OWNER: Member A.

    audio -> Silero VAD gate -> Whisper encoder (once) -> decode per language -> n-best list

Two choices matter here:
- faster-whisper's `transcribe()` only returns the best path, so we call the CTranslate2
  model's `generate()` directly with `num_hypotheses` to get a real n-best list.
- We decode the same encoder output twice, as English and as Hindi. The English pass
  catches "wotter", the Hindi pass catches "पानी"; the lexicon holds both spellings.
  The encoder (the expensive part) runs only once.

Still to do: RNNoise / WebRTC noise suppression before the VAD.
"""
from __future__ import annotations

import math
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import pad_or_trim
from faster_whisper.tokenizer import Tokenizer
from faster_whisper.transcribe import get_compression_ratio, get_suppressed_tokens
from faster_whisper.vad import VadOptions, get_speech_timestamps

from .types import Hypothesis

SAMPLE_RATE = 16_000
NO_SPEECH_REJECT = 0.6   # Whisper's own "this is silence" probability
MAX_NEW_TOKENS = 96      # Devanagari needs several tokens per letter; still caps runaway loops
MAX_COMPRESSION = 2.4    # Whisper's usual threshold: higher means repetitive, hallucinated text
VAD = VadOptions(threshold=0.5, min_speech_duration_ms=200, speech_pad_ms=200)


def load_wav(path: str | Path) -> np.ndarray:
    """16 kHz mono 16-bit WAV -> float32. (faster-whisper's own loader breaks on newer PyAV.)"""
    with wave.open(str(path), "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise ValueError(f"{path}: need 16 kHz mono 16-bit WAV")
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def _byte_decoder() -> dict[str, int]:
    """Inverse of GPT-2's byte-to-unicode table, which Whisper's tokenizer uses."""
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(bs, cs)}


def _arabic_script_tokens(hf_tokenizer) -> list[int]:
    """Token ids that start an Arabic-script character (UTF-8 lead bytes 0xD8-0xDB).

    Forced to Hindi, Whisper often writes Urdu script instead of Devanagari; our lexicon
    cannot match that, so the Hindi pass is not allowed to emit it.
    """
    decoder = _byte_decoder()
    ids = []
    for i in range(hf_tokenizer.get_vocab_size()):
        piece = hf_tokenizer.id_to_token(i) or ""
        if any(0xD8 <= decoder.get(ch, 0) <= 0xDB for ch in piece):
            ids.append(i)
    return ids


@dataclass
class Transcript:
    hypotheses: list[Hypothesis]
    latency_ms: dict[str, float] = field(default_factory=dict)
    rejected: str | None = None   # why no hypotheses were produced, if any
    speech: list[tuple[int, int]] = field(default_factory=list)  # VAD speech segments, in samples


class WhisperASR:
    def __init__(self, model_size: str = "small", compute_type: str = "int8", cpu_threads: int = 0):
        self.model = WhisperModel(model_size, device="cpu", compute_type=compute_type, cpu_threads=cpu_threads)
        self._tokenizers: dict[str, Tokenizer] = {}
        self._suppress: dict[str, list[int]] = {}

    def _tokenizer(self, lang: str) -> Tokenizer:
        if lang not in self._tokenizers:
            self._tokenizers[lang] = Tokenizer(self.model.hf_tokenizer, self.model.model.is_multilingual,
                                               task="transcribe", language=lang)
        return self._tokenizers[lang]

    def _suppressed(self, lang: str) -> list[int]:
        if lang not in self._suppress:
            ids = get_suppressed_tokens(self._tokenizer(lang), [-1])
            if lang == "hi":
                ids = sorted(set(ids) | set(_arabic_script_tokens(self.model.hf_tokenizer)))
            self._suppress[lang] = ids
        return self._suppress[lang]

    def transcribe(self, audio: np.ndarray | str | Path, langs: tuple[str, ...] = ("en", "hi"),
                   n_best: int = 5, hotwords: str | None = None) -> Transcript:
        timing: dict[str, float] = {}
        t = time.perf_counter()

        def lap(name: str) -> None:
            nonlocal t
            now = time.perf_counter()
            timing[name] = round((now - t) * 1000, 1)
            t = now

        if not isinstance(audio, np.ndarray):
            audio = load_wav(audio)

        speech = get_speech_timestamps(audio, VAD, sampling_rate=SAMPLE_RATE)
        lap("vad")
        if not speech:
            return Transcript([], timing, rejected="no speech detected")
        segments = [(s["start"], s["end"]) for s in speech]
        audio = audio[speech[0]["start"]:speech[-1]["end"]]

        features = self.model.feature_extractor(audio)
        features = pad_or_trim(features[:, : self.model.feature_extractor.nb_max_frames])
        encoded = self.model.encode(features)
        lap("encode")

        best: dict[str, Hypothesis] = {}
        no_speech = 0.0
        for lang in langs:
            tok = self._tokenizer(lang)
            prompt = self.model.get_prompt(tok, [], without_timestamps=True, hotwords=hotwords)
            result = self.model.model.generate(
                encoded, [prompt],
                beam_size=n_best, num_hypotheses=n_best,
                return_scores=True, return_no_speech_prob=True,
                max_length=len(prompt) + MAX_NEW_TOKENS, suppress_blank=True,
                suppress_tokens=self._suppressed(lang),
            )[0]
            no_speech = max(no_speech, result.no_speech_prob)
            for ids, score in zip(result.sequences_ids, result.scores):
                text = tok.decode(ids).strip()
                if not text or get_compression_ratio(text) > MAX_COMPRESSION:
                    continue
                # score is the length-normalised log-probability, so exp() is the
                # geometric-mean token probability: a usable 0..1 confidence
                conf = round(math.exp(score), 4)
                if (text not in best or conf > best[text].conf):
                    best[text] = Hypothesis(text=text, conf=conf, lang=lang)
            lap(f"decode_{lang}")

        if no_speech > NO_SPEECH_REJECT:
            return Transcript([], timing, rejected=f"no-speech probability {no_speech:.2f}", speech=segments)
        hyps = sorted(best.values(), key=lambda h: -h.conf)
        return Transcript(hyps, timing, speech=segments)
