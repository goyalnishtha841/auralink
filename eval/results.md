# Auralink evaluation

Generated 2026-10-21 01:40 by `scripts/evaluate.py`.

## Text challenge set

65 transcripts written by the team to mimic accented and code-mixed speech-to-text output (`data/eval/text_cases.json`). Development benchmark, not real passengers.

| System | First try | Within one tap | Wrong confident card | False alarms | Urgent caught | Median match |
|---|---|---|---|---|---|---|
| Baseline A: first result, keywords | 56.1% | 56.1% | 0% | 0% | 76.9% | 0.02 ms |
| Auralink, spelling | 84.2% | 86% | 1.8% | 0% | 100% | 1.76 ms |
| Auralink, phonemes | 78.9% | 80.7% | 1.8% | 0% | 92.3% | 3.52 ms |
| Auralink, phonemes + accent costs | 86% | 93% | 0% | 37.5% | 100% | 7.01 ms |
| Auralink, hybrid (default) | 91.2% | 93% | 0% | 12.5% | 100% | 8.09 ms |

First-try accuracy by group:

| System | asr_error | devanagari | hinglish | japanese_accent | multi | sea_accent | urgent |
|---|---|---|---|---|---|---|---|
| Baseline A: first result, keywords | 35.7% | 62.5% | 100% | 0% | 100% | 0% | 100% |
| Auralink, spelling | 92.9% | 75% | 100% | 42.9% | 100% | 83.3% | 80% |
| Auralink, phonemes | 64.3% | 87.5% | 100% | 57.1% | 100% | 66.7% | 80% |
| Auralink, phonemes + accent costs | 78.6% | 100% | 100% | 57.1% | 100% | 83.3% | 80% |
| Auralink, hybrid (default) | 85.7% | 100% | 100% | 71.4% | 100% | 100% | 80% |

## Synthetic audio (Whisper base, English + Hindi n-best)

macOS Indian English and Hindi voices, clean / 10 dB / 0 dB brown noise. Smoke test only.

| System | First try | Within one tap | Wrong confident card | False alarms | Urgent caught | Median match |
|---|---|---|---|---|---|---|
| Baseline A: first result, keywords | 64.3% | 64.3% | 0% | – | 66.7% | 0.02 ms |
| Auralink, spelling | 90.5% | 92.9% | 0% | – | 100% | 4.61 ms |
| Auralink, phonemes | 83.3% | 85.7% | 0% | – | 100% | 9.79 ms |
| Auralink, phonemes + accent costs | 83.3% | 97.6% | 0% | – | 100% | 17.58 ms |
| Auralink, hybrid (default) | 92.9% | 95.2% | 0% | – | 100% | 19.33 ms |

First-try accuracy by group:

| System | 0 dB | 10 dB | clean |
|---|---|---|---|
| Baseline A: first result, keywords | 57.1% | 71.4% | 64.3% |
| Auralink, spelling | 92.9% | 85.7% | 92.9% |
| Auralink, phonemes | 85.7% | 78.6% | 85.7% |
| Auralink, phonemes + accent costs | 78.6% | 78.6% | 92.9% |
| Auralink, hybrid (default) | 92.9% | 85.7% | 100% |

Auralink never sends an unconfirmed request (except urgent ones, which are flagged as unconfirmed), so its
wrong-action rate is zero by design; *wrong confident card* counts the cases where the passenger has to tap No.
