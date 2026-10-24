"""Crew PIN: crew-only routes and sockets refuse a client without the PIN; passenger routes stay open."""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hub import auth, main

CREW_GETS = ["/api/status", "/api/report", "/api/report.csv"]
CREW_POSTS = [("/api/presenter/reset", {}), ("/api/presenter/say", {"seat": "34K", "text": "water"}),
              ("/api/presenter/crew", {"type": "phase", "phase": "cruise"}),
              ("/api/pa/match", {"text": "fasten your seatbelt"}), ("/api/pa/send", {"id": "seatbelt_on"})]


@pytest.fixture(autouse=True)
def no_lockout():
    auth._failures.clear()
    yield
    auth._failures.clear()


def test_crew_routes_refuse_without_pin():
    client = TestClient(main.app)
    for path in CREW_GETS:
        assert client.get(path).status_code == 401, path
    for path, body in CREW_POSTS:
        assert client.post(path, json=body).status_code == 401, path


@pytest.mark.parametrize("path", ["/ws/crew", "/ws/judge"])
def test_crew_sockets_close_4401_without_pin(path):
    with TestClient(main.app).websocket_connect(path) as ws, pytest.raises(WebSocketDisconnect) as e:
        ws.receive_json()
    assert e.value.code == auth.WS_CLOSE


def test_crew_routes_work_with_pin(crew_login):
    client = crew_login(TestClient(main.app))
    cookie = client.cookies.get(auth.COOKIE)
    assert cookie and cookie != "246810"                     # derived token, never the PIN itself
    for path in CREW_GETS:
        assert client.get(path).status_code == 200, path
    with client.websocket_connect("/ws/crew") as crew:
        assert crew.receive_json()["type"] == "state"


def test_cookie_is_httponly():
    r = TestClient(main.app).post("/api/crew/login", json={"pin": "246810"})
    assert "httponly" in r.headers["set-cookie"].lower() and "samesite=strict" in r.headers["set-cookie"].lower()


def test_wrong_pin_refused_then_locked_out():
    client = TestClient(main.app)
    for _ in range(auth.MAX_TRIES):
        assert client.post("/api/crew/login", json={"pin": "000000"}).status_code == 401
    assert client.post("/api/crew/login", json={"pin": "246810"}).status_code == 429   # even the right one, for a minute
    assert auth.COOKIE not in client.cookies


def test_passenger_side_stays_open():
    client = TestClient(main.app)
    for path in ["/", "/passenger.html", "/checkin.html", "/record.html", "/api/config", "/api/seat/34K"]:
        assert client.get(path).status_code == 200, path
    with client.websocket_connect("/ws/passenger/34K") as pax:
        pax.send_json({"type": "hello", "lang": "en"})


def test_pin_hint_only_on_the_hub_laptop():
    other = TestClient(main.app)                                   # TestClient's address is "testclient"
    assert other.get("/api/crew/pin-hint").status_code == 403       # a passenger on the Wi-Fi never sees it
    local = TestClient(main.app, client=("127.0.0.1", 50000))
    assert local.get("/api/crew/pin-hint").json() == {"pin": auth.PIN}


def test_languages_have_english_names():
    langs = TestClient(main.app).get("/api/config").json()["languages"]
    names = {lang["code"]: lang["english"] for lang in langs}
    assert all(names.values()), "every registered language needs an English name"
    assert names["en"] == "English" and names["hi"] == "Hindi" and names["ta"] == "Tamil" and names["th"] == "Thai"
