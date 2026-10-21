# Learned accent costs

From 24 of 42 recordings (synthetic voices only); the rest were skipped because Whisper heard a different sentence (over 50% of sounds differ).
Rule: cost = max(0.15, 1 − n/(n+3)), only swaps seen at least 3 times, and only when cheaper than the hand-set cost.

| Heard ↔ meant | Times seen | Hand-set cost | Learned cost |
|---|---|---|---|
| (no swap seen often enough yet) | | | |

Most common swaps overall (including ones not used):

- ɑ ↔ ɔ: 3
- eɪ ↔ ɛ: 3
- oʊ ↔ ɔ: 2
- d ↔ r: 2
- æ ↔ ʌ: 2
- h ↔ θ: 1
- b ↔ w: 1
- ə ↔ ɛ: 1
