"""Languages are data: every registered language must be complete, and Tamil works end to end."""
import json

import pytest
from fastapi.testclient import TestClient

from engine import Context, Hypothesis, Lexicon, interpret
from engine.lexicon import ROOT
from hub import languages, main

client = TestClient(main.app)
REGISTRY = languages.registry()


@pytest.mark.parametrize("code", [lang["code"] for lang in REGISTRY])
def test_language_is_complete(code):
    """Adding a language? This test lists exactly what is still missing."""
    en = json.loads((ROOT / "data" / "i18n" / "en.json").read_text("utf-8"))
    own = json.loads((ROOT / "data" / "i18n" / f"{code}.json").read_text("utf-8"))
    missing = [k for k in en if not k.startswith("_") and k not in own]
    assert not missing, f"data/i18n/{code}.json is missing {missing}"

    lex = Lexicon()
    if code != "en":
        assert all(code in i.label for i in lex.intents), f"intents.json: a label is missing for {code}"
        assert all(code in i.variants for i in lex.intents), f"intents.json: spoken words are missing for {code}"

    m = json.loads((ROOT / "data" / "templates" / "messages.json").read_text("utf-8"))
    gaps = [r["id"] for r in m["replies"] if code not in r]
    gaps += [k for k, v in m["status"].items() if code not in v]
    gaps += [f"{s['id']} step {n + 1}" for s in m["safety"] for n, st in enumerate(s["steps"])
             if code not in st["text"] or code not in st["simple"]]
    gaps += [q["id"] for q in m["exit_row"]["questions"] if code not in q["text"]]
    assert not gaps, f"messages.json is missing {code} for {gaps}"


def test_config_and_strings_endpoints():
    codes = [lang["code"] for lang in client.get("/api/config").json()["languages"]]
    assert codes == ["en", "hi", "ta"]
    ta = client.get("/api/i18n/ta").json()
    assert ta["yes"] == "ஆம்" and "_note" not in ta
    assert client.get("/api/i18n/xx").status_code == 404


def test_tamil_speech_languages():
    assert languages.asr_languages("ta") == ("en", "ta")
    assert languages.asr_languages("hi") == ("en", "hi")


@pytest.mark.parametrize("text,intents", [
    ("konjam thanni venum", ["water"]),
    ("தண்ணீர் வேண்டும்", ["water"]),
    ("enakku oru porvai kodunga", ["blanket"]),
    ("marundhu venum", ["medical"]),
])
def test_tamil_requests(text, intents):
    r = interpret([Hypothesis(text=text)], Context(seat="1"), Lexicon())
    assert [c.candidates[0].intent for c in r.cards] == intents


def test_tamil_passenger_end_to_end():
    with client.websocket_connect("/ws/passenger/35A") as pax:
        pax.send_json({"type": "hello", "lang": "ta"})
        pax.send_json({"type": "text", "text": "konjam thanni venum"})
        card = pax.receive_json()["cards"][0]
        assert card["options"][0]["label"] == "தண்ணீர்"
        pax.send_json({"type": "confirm", "card_id": card["id"], "intent": "water"})
        assert pax.receive_json()["message"] == "பணியாளருக்கு அனுப்பப்பட்டது"
