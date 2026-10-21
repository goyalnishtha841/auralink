"""Flight report numbers from a scripted mini-flight."""
from fastapi.testclient import TestClient

from engine import Hypothesis, Lexicon
from hub import main
from hub import report as flight_report
from hub.state import Cabin
from hub.templates import Templates


def scripted_flight() -> Cabin:
    cabin = Cabin(Lexicon())
    cabin.seats["34K"].lang = "hi"
    cabin.seats["31C"].connected = True

    _, (water,), _ = cabin.handle_text("34K", "water please")                  # clear request
    cabin.confirm(water.id, "water")
    cabin.acknowledge(water.id)
    cabin.close(water.id)
    t0 = water.timeline["created"]
    water.timeline.update(acknowledged=t0 + 40, closed=t0 + 160)             # pin the timings

    pillow = cabin.icon_request("31C", "pillow")                               # tapped a picture
    cabin.acknowledge(pillow.id)
    pillow.timeline["acknowledged"] = pillow.timeline["created"] + 20

    nbest = [Hypothesis(text="water please", conf=0.5), Hypothesis(text="toilet please", conf=0.5)]
    _, (unsure,), _ = cabin.handle_text("33H", "", nbest)                      # too close to call
    cabin.confirm(unsure.id, "toilet")

    _, (lost,), _ = cabin.handle_text("32D", "blanket")                        # passenger said No twice
    cabin.reject(lost.id)
    cabin.reject(lost.id)

    cabin.handle_text("30A", "I have chest pain")                              # urgent, not confirmed yet

    cabin.start_broadcast("turbulence")
    cabin.safety_response("34K", "understood")
    cabin.safety_response("31C", "stuck", step=1)
    cabin.start_exit_check(["30A", "30K"])
    cabin.exit_answer("30K", {"open_door": True, "help_others": True, "follow_crew": True}, True,
                      ["open_door", "help_others", "follow_crew"])
    return cabin


def test_request_numbers():
    r = flight_report.build(scripted_flight(), Templates())["requests"]
    assert r["total"] == 5
    assert r["outcomes"] == {"first_try": 1, "picked_from_two": 1, "via_grid": 0, "picture": 1,
                             "needs_human": 1, "urgent_unconfirmed": 1, "unanswered": 0}
    assert r["time_to_acknowledge_s"]["median"] == 30.0 and r["time_to_done_s"]["median"] == 160.0
    assert r["recovery"] == {"unclear": 2, "resolved_by_passenger": 1, "rate": 0.5}
    assert r["by_source"] == {"picture": 1, "text": 4}
    assert r["by_language"]["hi"] == 1 and r["urgent"]["count"] == 1


def test_safety_and_exit_numbers():
    rep = flight_report.build(scripted_flight(), Templates())
    b = rep["briefings"][0]
    assert (b["understood"], b["stuck"], b["stuck_by_step"][0]["step"]) == (1, 1, 2)
    assert rep["exit_row"]["talk"] == 1 and rep["exit_row"]["talk_seats"][0]["reseat"] is True


def test_csv_and_endpoint(monkeypatch, crew_login):
    cabin = scripted_flight()
    lines = flight_report.to_csv(cabin).strip().splitlines()
    assert lines[0].startswith("request,seat,language") and len(lines) == 6
    monkeypatch.setattr(main, "cabin", cabin)
    client = crew_login(TestClient(main.app))
    assert client.get("/api/report").json()["requests"]["total"] == 5
    csv = client.get("/api/report.csv")
    assert csv.headers["content-type"].startswith("text/csv") and "attachment" in csv.headers["content-disposition"]
