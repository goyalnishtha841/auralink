# Auralink evaluation

Generated 2026-10-24 15:48 by `scripts/evaluate.py`.

## Text challenge set

65 transcripts written by the team to mimic accented and code-mixed speech-to-text output (`data/eval/text_cases.json`). Development benchmark, not real passengers.

| System | First try | Within one tap | Wrong confident card | False alarms | Urgent caught | Median match |
|---|---|---|---|---|---|---|
| Baseline A: first result, keywords | 56.1% | 56.1% | 0% | 0% | 76.9% | 0.01 ms |
| Auralink, spelling | 84.2% | 86% | 1.8% | 0% | 100% | 1.76 ms |
| Auralink, phonemes | 78.9% | 80.7% | 1.8% | 0% | 92.3% | 3.22 ms |
| Auralink, phonemes + accent costs | 86% | 93% | 1.8% | 50% | 100% | 6.22 ms |
| Auralink, hybrid (default) | 91.2% | 93% | 1.8% | 12.5% | 100% | 7.1 ms |
| Auralink, hybrid, learned costs | 91.2% | 93% | 1.8% | 12.5% | 100% | 6.54 ms |
| Auralink, trimodal (+ semantic embeddings) | 86% | 87.7% | 1.8% | 0% | 100% | 31.81 ms |

First-try accuracy by group:

| System | asr_error | devanagari | hinglish | japanese_accent | multi | sea_accent | urgent |
|---|---|---|---|---|---|---|---|
| Baseline A: first result, keywords | 35.7% | 62.5% | 100% | 0% | 100% | 0% | 100% |
| Auralink, spelling | 92.9% | 75% | 100% | 42.9% | 100% | 83.3% | 80% |
| Auralink, phonemes | 64.3% | 87.5% | 100% | 57.1% | 100% | 66.7% | 80% |
| Auralink, phonemes + accent costs | 78.6% | 100% | 100% | 57.1% | 100% | 83.3% | 80% |
| Auralink, hybrid (default) | 85.7% | 100% | 100% | 71.4% | 100% | 100% | 80% |
| Auralink, hybrid, learned costs | 85.7% | 100% | 100% | 71.4% | 100% | 100% | 80% |
| Auralink, trimodal (+ semantic embeddings) | 85.7% | 87.5% | 100% | 57.1% | 100% | 83.3% | 80% |

Auralink never sends an unconfirmed request (except urgent ones, which are flagged as unconfirmed), so its
wrong-action rate is zero by design; *wrong confident card* counts the cases where the passenger has to tap No.
