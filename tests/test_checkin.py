"""Check-in preferences (airport stage) reach the seat screen and the crew."""
import json

import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main
from hub.state import Cabin


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))
    return tmp_path


client = TestClient(main.app)


def test_checkin_saves_and_seat_opens_with_it(fresh):
    r = client.post("/api/checkin", json={"seat": "34K", "lang": "hi", "senior": True, "read": True}).json()
    assert r["passenger_path"] == "/passenger?seat=34K&lang=hi&senior=1&read=1"
    assert client.get("/api/seat/34K").json() == {"lang": "hi", "senior": True, "pictures": False, "read": True,
                                                   "accessibility": None, "checked_in": True}
    saved = json.loads((fresh / "checkin.json").read_text())
    assert saved["34K"] == {"lang": "hi", "senior": True, "pictures": False, "read": True, "accessibility": None}   # seat + preferences only


def test_checkin_rejects_unknown_seat_and_language():
    assert client.post("/api/checkin", json={"seat": "99Z"}).status_code == 404
    assert client.post("/api/checkin", json={"seat": "34K", "lang": "xx"}).status_code == 422


def test_crew_sees_passenger_needs(crew_login):
    crew_login(client)
    client.post("/api/checkin", json={"seat": "31C", "lang": "ta", "pictures": True})
    with client.websocket_connect("/ws/crew") as crew:
        needs = {n["id"]: n for n in crew.receive_json()["seat_needs"]}
    assert needs["31C"]["pictures"] is True and needs["31C"]["lang"] == "ta" and needs["31C"]["checked_in"] is True
    assert "34K" not in needs   # default English, no modes: nothing to flag
