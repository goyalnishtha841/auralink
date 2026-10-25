"""After-landing features: deplaning info, lost & found, and post-flight feedback."""
import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main
from hub import report as flight_report
from hub.state import Cabin


@pytest.fixture(autouse=True)
def fresh_cabin(monkeypatch):
    monkeypatch.setattr(main, "cabin", Cabin(Lexicon()))


@pytest.fixture
def client():
    return TestClient(main.app)


def test_arrival_info_is_public(client):
    r = client.get("/api/arrival")
    assert r.status_code == 200
    body = r.json()
    assert body["gate"] and body["baggage_belt"]
    assert body["connections"][0]["flight"]


def test_report_lost_item(client):
    r = client.post("/api/lost-item", json={"seat": "34K", "description": "grey water bottle"})
    assert r.status_code == 200
    item = r.json()
    assert item["seat"] == "34K" and item["status"] == "reported"
    assert main.cabin.lost_items[item["id"]].description == "grey water bottle"

    assert client.post("/api/lost-item", json={"seat": "99Z", "description": "x"}).status_code == 404
    assert client.post("/api/lost-item", json={"seat": "34K", "description": ""}).status_code == 422


def test_lost_item_status_needs_crew_pin(client, crew_login):
    item = client.post("/api/lost-item", json={"seat": "34K", "description": "umbrella"}).json()
    assert client.get("/api/lost-items").status_code == 401
    assert client.post(f"/api/lost-item/{item['id']}/status", json={"status": "found"}).status_code == 401

    crew = crew_login(client)
    assert crew.get("/api/lost-items").json()["items"][0]["id"] == item["id"]
    updated = crew.post(f"/api/lost-item/{item['id']}/status", json={"status": "found"}).json()
    assert updated["status"] == "found"
    assert crew.post("/api/lost-item/nope/status", json={"status": "found"}).status_code == 404


def test_feedback_submission_and_crew_listing(client, crew_login):
    r = client.post("/api/feedback", json={"seat": "34K", "category": "compliment", "rating": 5, "message": "Loved it"})
    assert r.status_code == 200
    fb = r.json()
    assert fb["category"] == "compliment" and fb["rating"] == 5

    assert client.get("/api/feedback").status_code == 401
    crew = crew_login(client)
    items = crew.get("/api/feedback").json()["items"]
    assert items[0]["message"] == "Loved it"

    assert client.post("/api/feedback", json={"seat": "34K", "rating": 6, "message": "x"}).status_code == 422


def test_cabin_reset_clears_afterflight_state():
    cabin = Cabin(Lexicon())
    cabin.report_lost_item("34K", "bag")
    cabin.add_feedback("34K", "improvement", 3, "slow service")
    cabin.reset()
    assert cabin.lost_items == {} and cabin.feedback == {}


def test_report_includes_lost_items_and_feedback():
    from hub.templates import Templates

    cabin = Cabin(Lexicon())
    item = cabin.report_lost_item("34K", "bag")
    cabin.set_lost_item_status(item.id, "found")
    cabin.add_feedback("34K", "compliment", 5, "great")
    cabin.add_feedback("31C", "inconvenience", None, "cold food")

    rep = flight_report.build(cabin, Templates())
    assert rep["lost_items"] == {"total": 1, "by_status": {"reported": 0, "found": 1, "returned": 0}}
    assert rep["feedback"]["total"] == 2
    assert rep["feedback"]["by_category"]["compliment"] == 1
    assert rep["feedback"]["average_rating"] == 5.0
