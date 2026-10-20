# Recordings (Member B)

Collected with the **Record voices** page (`/record.html`) on the hub. Audio stays out of git
(consent + size): copy this folder to the team drive after each collection day.

```
speakers.csv                     speaker_id, age_band, first_lang, english_level, device, split
manifest.csv                     one row per clip: file, speaker_id, prompt_id, kind, intents, environment, …
S-XXXX/<prompt_id>_<take>.wav    16 kHz mono 16-bit
```

- **No names.** Each volunteer gets a code like `S-7KQ2`. They can withdraw on the page with that
  code; this deletes their folder and their rows.
- **Split by speaker:** `split` is fixed per speaker (≈60% train / 20% heldout / 20% test), so one
  voice never appears in both tuning and test data. Tune t1/t2 on `heldout`, report on `test`.
- **`intents` empty** means a "not a request" prompt ("Thank you, that's all"), used to measure the
  wrong-action rate.
- **`kind`:** `free` (said in their own words, comes first in every session) or `read` (read aloud).
- Save somewhere else with `AURALINK_RECORDINGS_DIR=/path scripts/run.sh`.

Before collecting, check the consent text on the page against your institution's rules and make
sure the team actually deletes the clips after the hackathon, as the page promises.

Targets for a credible evaluation: 25+ speakers, at least 5 aged 50+, at least 4 first languages,
and one set per speaker in a noisy place.
