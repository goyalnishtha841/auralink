"""Care rounds: open requests become one trolley loop; quiet vulnerable passengers get a check-in stop."""
import pytest
from fastapi.testclient import TestClient

from engine import Lexicon
from hub import main, rounds
from hub.state import Cabin


@pytest.fixture
def cabin(monkeypatch, tmp_path):
    monkeypatch.setenv("AURALINK_FLIGHT_DIR", str(tmp_path))
    c = Cabin(Lexicon())
    monkeypatch.setattr(main, "cabin", c)
    return c


def test_plan_groups_deliveries_in_aisle_order_and_skips_urgent(cabin):
    cabin.icon_request("34K", "water")
    cabin.icon_request("31A", "blanket")
    cabin.icon_request("33B", "water")
    cabin.icon_request("32C", "medical")      # urgent: never waits for a round
    cabin.icon_request("30D", "toilet")       # nothing to carry
    p = rounds.plan(cabin)
    assert [s["seat"] for s in p["stops"]] == ["31A", "33B", "34K"]   # down the left aisle, back up the right
    assert p["load"] == {"blanket": 1, "water": 2}
    assert p["walk_rows"]["round"] < p["walk_rows"]["separate"]


def test_quiet_senior_passenger_gets_a_care_stop(cabin, monkeypatch):
    monkeypatch.setenv("AURALINK_CARE_AFTER_S", "60")
    cabin.seats["33H"].senior = True
    cabin.seats["33H"].checked_in = True
    cabin.seats["35A"].pictures = True       # not checked in, no screen: crew cannot know about them
    cabin.started_at -= 120
    p = rounds.plan(cabin)
    assert [(s["seat"], s["care"]["minutes"]) for s in p["stops"]] == [("33H", 2)]
    cabin.icon_request("33H", "tea")         # asking resets the clock, but the tea is still a stop
    assert rounds.plan(cabin)["stops"][0]["care"] is None


def test_round_tells_passengers_their_place_and_closes_requests(cabin, crew_login):
    with crew_login(TestClient(main.app)) as client, client.websocket_connect("/ws/passenger/31A") as a, \
            client.websocket_connect("/ws/passenger/34K") as k:
        a.send_json({"type": "hello", "lang": "hi"})
        k.send_json({"type": "icon", "intent": "water"})
        assert k.receive_json()["type"] == "status"
        a.send_json({"type": "icon", "intent": "blanket"})
        assert a.receive_json()["type"] == "status"
        client.post("/api/presenter/crew", json={"type": "start_round"})
        assert a.receive_json()["message"] == "क्रू आपका सामान लेकर आ रहे हैं। आप 2 में से 1वें स्टॉप पर हैं।"
        assert "stop 2 of 2" in k.receive_json()["message"]
        assert rounds.plan(cabin)["stops"] == []           # on the round, so not planned again
        client.post("/api/presenter/crew", json={"type": "stop_done", "seat": "31A"})
        assert a.receive_json()["card"]["status"] == "closed"
        client.post("/api/presenter/crew", json={"type": "stop_done", "seat": "34K"})
    assert cabin.round is None and len(cabin.past_rounds) == 1


def test_empty_round_is_refused(cabin):
    with pytest.raises(ValueError):
        cabin.start_round(rounds.plan(cabin))
