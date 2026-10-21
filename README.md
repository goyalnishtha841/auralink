# Auralink

Repair-first passenger–crew communication for JAL-PS-02 (Thapar Japan Hackathon 2026).
When speech recognition is unsure, Auralink asks the passenger the easiest possible follow-up
instead of guessing, and it checks that passengers actually understood safety instructions.

## Run it

```bash
uv venv .venv --python 3.12
uv pip install -p .venv/bin/python -r requirements-dev.txt
brew install espeak-ng          # phoneme matcher; apt install espeak-ng on Linux
scripts/run.sh
```

On demo day use `scripts/demo.sh` instead: it runs a pre-flight check (packages, Whisper downloaded,
eSpeak-NG, HTTPS certificate, free port, a test sentence), prints the address and a QR code for
phones, then starts the hub. Demo tools: `/presenter.html` (pitch checklist with timer, health,
backup buttons that send requests as a seat, and a two-tap cabin reset between rehearsals),
`/seats.html` (printable seat QR cards) and `/noise.html` (cabin-noise player with a level meter).
`/report.html` is the flight report: requests by outcome, type and language, median time to
acknowledge, recovery rate, urgent handling, safety comprehension per briefing step and exit-row
results, with a CSV download (`/api/report.csv`). It covers everything since the last cabin reset.
The presenter endpoints have no password: fine on the demo network, not for a real aircraft.

Open <http://localhost:8000> and put **Passenger** and **Crew** side by side. Tap the microphone
and say "thoda wotter and kambal", or type it.

The first start downloads Whisper `base` (~145 MB) into the Hugging Face cache; after that
everything runs offline. Choose another model with `AURALINK_ASR_MODEL=small scripts/run.sh`.

Run the tests with `.venv/bin/python -m pytest -q`.

### On phones (week 1 task for Member C)

Phones only allow the microphone over HTTPS. Create a local certificate once:

```bash
brew install mkcert && mkcert -install
mkdir -p certs && mkcert -cert-file certs/hub.pem -key-file certs/hub-key.pem <laptop-ip> localhost
```

`scripts/run.sh` switches to HTTPS automatically when `certs/` exists. Install the mkcert root
certificate on each demo phone.

## Layout and owners

| Folder | Owner | What lives there |
|---|---|---|
| `engine/` | A | `interpret(nbest, context, lexicon) -> Result`. ASR in `asr.py`, matcher in `matcher.py` |
| `data/`, `eval/` | B | Intent lexicon, message templates, recording prompts and API (`hub/recordings.py`), evaluation |
| `hub/`, `hardware/` | C | FastAPI + WebSocket hub, card state machine, safety heat map, ESP32 panel |
| `apps/` | D | Passenger, crew and judge screens (current ones are placeholders) |

## Collecting voices

Open `/record.html` on a phone connected to the hub (HTTPS needed for the microphone on phones).
Volunteers consent, get a speaker code, and record 24 prompts in about 5 minutes. Clips land in
`data/recordings/`; see [data/recordings/README.md](data/recordings/README.md).

## Adding a language (no code, no retraining)

1. `data/languages.json`: add `{"code": "bn", "name": "বাংলা", "asr": ["en", "bn"]}`, and the script's
   character range + eSpeak-NG voice under `scripts` if it has its own writing system.
2. `data/i18n/bn.json`: the passenger screen text (copy `en.json`, translate the values).
3. `data/lexicon/intents.json`: a `bn` label and spoken words for each of the 8 intents.
4. `data/templates/messages.json`: `bn` for crew replies, statuses, safety steps and the exit-row check.
5. Run `.venv/bin/python -m pytest -q tests/test_languages.py`: it lists anything still missing.

The hub reloads the word list as soon as it is saved. Tamil (`ta`) was added this way. All Hindi,
Tamil and Japanese text is a draft until a native speaker has checked it.

## Contracts (change only as a team)

- **Engine types** – `engine/types.py`: `Hypothesis`, `Context`, `Candidate`, `CardDraft`, `Result`.
- **Lexicon** – `data/lexicon/intents.json`. The hub reloads it when the file changes, so a new
  word or language works without a restart.
- **Templates** – `data/templates/messages.json`. Pre-approved text only; every Japanese and
  Hindi line needs a native-speaker check before the demo.
- **WebSocket messages** – see below.

### Passenger socket `/ws/passenger/{seat}`

| Sends | Receives |
|---|---|
| *binary frame*: one utterance, 16 kHz mono int16 PCM, max 10 s | `thinking` – speech received, working on it |
| `hello {lang, senior}` | `confirm {rule, cards[]}` – each card has `confident`, `options[]`, `urgent` |
| `text {text}` | `grid {reason, card_id?}` – show the icon grid |
| `icon {intent, card_id?}` | `status {card, message}` – message already in the passenger's language |
| `confirm {card_id, intent}` | `reply {card_id, text}` – crew reply, translated from a template |
| `reject {card_id}` | `safety {broadcast_id, template}` |
| `safety {understood}` | `notice {message}`, `error {detail}` |

### Crew socket `/ws/crew`

Sends `ack`, `reply {card_id, reply_id}`, `close`, `phase {phase}`, `broadcast {template_id}`.
Receives `state {phase, cards[], heatmap{seat: understood|explain_again|pending|idle|offline}, broadcast}`
after every change.

### Judge socket `/ws/judge`

Receives `result {phase, result}` for every interpretation – the raw material for the glass-box view.

## Request lifecycle

```
awaiting_confirm ──confirm──▶ confirmed ──ack──▶ acknowledged ──close──▶ closed
       │                         ▲
       └─reject ×2──▶ needs_human┘ (crew sees best guesses)
urgent_unconfirmed: medical/emergency, shown to crew immediately while the passenger confirms
```

## What is real and what is a placeholder

- **Real:** n-best weighting, context priors, splitting one sentence into several requests,
  ambiguity rules (t1, t2, flat, empty), urgency override, card state machine, safety heat map.
- **Real:** voice. Silero VAD gate, Whisper encoder once, then English and Hindi decoding with
  5 hypotheses each (`engine/asr.py`). The Hindi pass is blocked from writing Urdu script, and
  repetitive output ("तो तो तो …") is dropped.
- **Real:** the Phonetic Intent Matcher (`engine/phonetic.py`). eSpeak-NG turns words into phonemes
  (Hindi voice for Devanagari, English for Latin script) and a weighted edit distance compares them
  using the accent cost matrix in `data/lexicon/phone_costs.json` (v/w, retroflex t/d, ch/च, dropped
  final r, r/l …). The default `hybrid` matcher averages this with spelling similarity; choose with
  `AURALINK_MATCHER=hybrid|phonetic|phonetic_uniform|text`. Without eSpeak-NG it falls back to spelling.
- **Untuned:** `T1 = 0.70` and `T2 = 0.10` are starting values. Member B tunes them on the
  held-out split.

## Evaluation

```bash
.venv/bin/python scripts/evaluate.py --skip-audio   # text challenge set, seconds
.venv/bin/python scripts/evaluate.py                # + synthetic audio at clean / 10 / 0 dB
.venv/bin/python scripts/evaluate.py --real         # + volunteer recordings, test split
```

Writes [eval/results.md](eval/results.md), `eval/results.json` and `eval/results_chart.svg` (for the
deck). Compares Baseline A (first result, keywords, no confirmation) with four Auralink matchers.
The text challenge set was used to develop the matcher, so its numbers are optimistic; the claims
for the final presentation must come from the held-out volunteer recordings.

## Speech-to-text spike (2026-10-21)

`scripts/asr_spike.py` → [eval/asr_spike_results.md](eval/asr_spike_results.md). Stand-in voices
(macOS Rishi, Aman, Lekha), 14 phrases, clean / 10 dB / 0 dB brown noise, Apple M1 CPU:

| Model | Intent accuracy (en+hi n-best) | Median ASR latency | Verdict |
|---|---|---|---|
| `base` | 88% | 0.67 s | default for the demo |
| `small` | 95% | 2.9 s | too slow on CPU |

Measured in the browser: end of speech → confirm screen in about 1.0–1.2 s (deck target < 2 s).
Silence and noise-only clips are rejected by the VAD gate. These are synthetic voices, so they are
a smoke test, not results; Member B's recordings replace them.
