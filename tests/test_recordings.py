import base64
import csv
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hub import main, recordings

client = TestClient(main.app)
PROFILE = {"consent": True, "age_band": "65+", "first_lang": "hindi", "english_level": "basic", "device": "phone"}


@pytest.fixture(autouse=True)
def tmp_recordings(tmp_path, monkeypatch):
    monkeypatch.setattr(recordings, "RECORDINGS_DIR", tmp_path)
    return tmp_path


def tone(seconds=1.0, amp=0.3):
    t = np.arange(int(16_000 * seconds)) / 16_000
    wave_ = np.clip(amp * np.sin(2 * np.pi * 220 * t), -1, 1)  # an overloaded mic clips, it does not wrap
    pcm = (wave_ * 32767).astype("<i2").tobytes()
    return base64.b64encode(pcm).decode()


def new_speaker():
    r = client.post("/api/recordings/speakers", json=PROFILE)
    assert r.status_code == 200
    return r.json()["speaker_id"]


def clip(speaker, prompt="f_water", audio=None):
    return client.post("/api/recordings/clips", json={
        "speaker_id": speaker, "prompt_id": prompt, "environment": "quiet", "audio_b64": audio or tone()})


def test_consent_required():
    r = client.post("/api/recordings/speakers", json={**PROFILE, "consent": False})
    assert r.status_code == 400


def test_clip_saved_as_wav_with_manifest_row(tmp_recordings):
    sid = new_speaker()
    r = clip(sid, "r_water_kambal")
    assert r.status_code == 200 and r.json()["warning"] is None

    with wave.open(str(tmp_recordings / sid / "r_water_kambal_1.wav")) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16_000, 1, 2)
    rows = list(csv.DictReader((tmp_recordings / "manifest.csv").open()))
    assert rows[0]["intents"] == "water+blanket"
    assert rows[0]["split"] == recordings.split_for(sid)

    assert clip(sid, "r_water_kambal").json()["saved"] == "r_water_kambal_2.wav"  # re-takes are kept


def test_bad_audio_rejected():
    sid = new_speaker()
    assert clip(sid, audio=tone(0.1)).json()["detail"]["code"] == "too_short"
    assert clip(sid, audio=tone(13)).json()["detail"]["code"] == "too_long"
    assert clip(sid, audio=tone(1.0, amp=0.001)).json()["detail"]["code"] == "silent"
    assert clip(sid, audio=tone(1.0, amp=1.5)).json()["warning"] == "loud"  # distorted: saved, with a warning
    assert clip("S-ZZZZ").status_code == 404                        # unknown speaker
    assert clip(sid, prompt="nope").status_code == 404


def test_withdraw_removes_everything(tmp_recordings):
    keep, leave = new_speaker(), new_speaker()
    clip(keep)
    clip(leave)
    clip(leave, "n_thanks")
    r = client.delete(f"/api/recordings/speakers/{leave}")
    assert r.json() == {"withdrawn": leave, "clips_removed": 2}
    assert not (tmp_recordings / leave).exists()
    stats = client.get("/api/recordings/stats").json()
    assert stats["speakers"] == 1 and stats["clips"] == 1


def test_stats_counts_false_alarm_prompts_as_none():
    sid = new_speaker()
    clip(sid, "n_fine")
    assert client.get("/api/recordings/stats").json()["by_intent"] == {"none": 1}


def test_split_is_stable_and_roughly_60_20_20():
    splits = [recordings.split_for(f"S-{i:04d}") for i in range(2000)]
    assert recordings.split_for("S-AB12") == recordings.split_for("S-AB12")
    assert 0.55 < splits.count("train") / 2000 < 0.65


def test_every_prompt_uses_known_intents():
    from engine import Lexicon

    lex = Lexicon()
    for p in recordings.prompts():
        assert all(lex.has(i) for i in p["intents"]), p["id"]
        assert p["kind"] in {"free", "read"} and p["text"]["en"], p["id"]
        assert all(p["text"].get(code) for code in p.get("for", ["en", "hi", "ta", "th"])), p["id"]
        assert set(p.get("for", [])) <= {"en", "hi", "ta", "th"}, p["id"]


def test_each_language_gets_a_full_session():
    for code in ("en", "hi", "ta", "th"):
        mine = [p for p in recordings.prompts() if code in p.get("for", [code])]
        assert len(mine) >= 20 and {"free", "read"} <= {p["kind"] for p in mine}, code


def test_clip_records_the_text_shown():
    sid = client.post("/api/recordings/speakers", json=PROFILE).json()["speaker_id"]
    r = client.post("/api/recordings/clips", json={"speaker_id": sid, "prompt_id": "r_ta_thanni", "environment": "quiet",
                                                   "page_lang": "ta", "audio_b64": tone()})
    assert r.status_code == 200
    rows = (recordings.RECORDINGS_DIR / "manifest.csv").read_text("utf-8")
    assert "கொஞ்சம் தண்ணீர் கொடுங்க." in rows
