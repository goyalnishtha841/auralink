"""Live PA captions: spoken announcements are matched to the library and shown in every seat's language."""
import json

import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from engine.lexicon import ROOT
from hub import languages, main, pa
from hub.state import Cabin

LIB = pa.Library()


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))


@pytest.mark.parametrize("heard,expected,n", [
    ("Ladies and gentlemen, the captain has turned on the fasten seatbelt sign.", "seatbelt_on", None),
    ("The seatbelt sign has now been switched off, you may move about the cabin.", "seatbelt_off", None),
    ("We have started our descent and will be landing in about twenty five minutes.", "descent", "25"),
    ("当機はただいまから降下を始めます。あと二十分で着陸の予定です。", "descent", "20"),
    ("Welcome to Tokyo Haneda. We are arriving at gate 12, please remain seated.", "arrived", "12"),
    ("Is there a doctor or a nurse on board? Please press your call button.", "doctor", None),
    ("お客様の中にお医者様はいらっしゃいますか", "doctor", None),
    ("We are delayed by about 15 minutes due to air traffic.", "delay", "15"),
    ("シートベルト着用サインが点灯しました", "seatbelt_on", None),
])
def test_announcements_are_recognised(heard, expected, n):
    r = LIB.match(heard)
    assert r["verdict"] in {"sure", "check"} and r["matches"][0]["id"] == expected
    assert r["matches"][0]["n"] == n


def test_unknown_announcement_is_not_captioned():
    r = LIB.match("Our captain would like to tell you that the weather in Tokyo is sunny today.")
    assert r["verdict"] == "none"     # no machine translation: crew are told, nothing is guessed


def test_numbers_in_words_and_kanji():
    assert pa.numbers_to_digits("twenty-five minutes") == "25 minutes"
    assert pa.numbers_to_digits("あと三十五分") == "あと35分"


def test_every_announcement_has_every_language():
    codes = [lang["code"] for lang in languages.registry()] + ["ja"]
    data = json.loads((ROOT / "data" / "templates" / "announcements.json").read_text("utf-8"))
    for a in data["announcements"]:
        for field in ("text", "text_n"):
            if field in a:
                missing = [c for c in codes if c not in a[field]]
                assert not missing, f"{a['id']}.{field} is missing {missing}"
                if field == "text_n":
                    assert all("{n}" in v for v in a[field].values()), a["id"]


def test_caption_reaches_each_seat_in_its_language(crew_login):
    with crew_login(TestClient(main.app)) as client:
        with client.websocket_connect("/ws/passenger/31A") as hi, client.websocket_connect("/ws/passenger/32C") as th:
            hi.send_json({"type": "hello", "lang": "hi"})
            th.send_json({"type": "hello", "lang": "th"})
            m = client.post("/api/pa/match", json={"text": "We will be landing in about 20 minutes, we have started our descent"}).json()
            assert m["verdict"] == "sure" and m["matches"][0]["n"] == "20"
            assert client.post("/api/pa/send", json={"id": "descent", "n": "20"}).json()["seats"] == 2
            got_hi, got_th = hi.receive_json(), th.receive_json()
    assert got_hi["type"] == "pa" and "20 मिनट" in got_hi["caption"]["text"]
    assert "20 นาที" in got_th["caption"]["text"]
    assert main.cabin.pa_log[0]["id"] == "descent"


def test_send_rejects_unknown_and_bad_numbers(crew_login):
    client = crew_login(TestClient(main.app))
    assert client.post("/api/pa/send", json={"id": "nope"}).status_code == 404
    assert client.post("/api/pa/send", json={"id": "descent", "n": "<b>"}).status_code == 422
