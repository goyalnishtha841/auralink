"""Demo dry run: plays the whole pitch story against a running hub and checks every step.

    scripts/demo.sh                                   # in one terminal (prints the crew PIN)
    .venv/bin/python scripts/rehearse.py --pin 123456 # in another, before going on stage

Uses the same WebSockets and buttons as the real screens (no shortcuts), so a PASS here means the hub,
matcher, crew PIN, PA captions, briefing, symptoms, care round and report all work on this laptop.
It does not test phones, microphones or voices. It resets the cabin first: do not run it mid-demo.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import ssl
import sys
import time

import httpx
from websockets.sync.client import connect

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")
    return ok


def wait_for(ws, want, timeout: float = 15.0) -> dict | None:
    """Read messages until one matches `want` (a predicate), or give up."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            msg = json.loads(ws.recv(timeout=max(0.1, end - time.time())))
        except TimeoutError:
            return None
        if want(msg):
            return msg
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hub", default="http://127.0.0.1:8000")
    ap.add_argument("--pin", required=True, help="the crew PIN the hub printed at start")
    args = ap.parse_args()
    https = args.hub.startswith("https")
    ws_base = args.hub.replace("http", "ws", 1)
    tls = ssl._create_unverified_context() if https else None   # the local mkcert certificate
    http = httpx.Client(base_url=args.hub, timeout=60, verify=not https)
    t0 = time.time()

    if not check("crew PIN accepted", http.post("/api/crew/login", json={"pin": args.pin}).status_code == 200):
        sys.exit("Wrong PIN: use the one scripts/demo.sh printed.")
    cookie = "; ".join(f"{k}={v}" for k, v in http.cookies.items())
    check("crew screens refuse requests without the PIN",
          httpx.get(f"{args.hub}/api/report", verify=not https).status_code == 401)
    http.post("/api/presenter/reset")
    replies = http.get("/api/config").json()["replies"]

    with contextlib.ExitStack() as sockets:
        crew = sockets.enter_context(connect(f"{ws_base}/ws/crew", additional_headers={"Cookie": cookie}, ssl=tls))
        hindi = sockets.enter_context(connect(f"{ws_base}/ws/passenger/33H", ssl=tls))
        tamil = sockets.enter_context(connect(f"{ws_base}/ws/passenger/34K", ssl=tls))
        story(http, crew, hindi, tamil, replies)
    http.post("/api/presenter/reset")
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed in {time.time() - t0:.1f} s; cabin reset again.")
    if failed:
        sys.exit("FAILED: " + "; ".join(failed))


def story(http, crew, hindi, tamil, replies) -> None:
    hindi.send(json.dumps({"type": "hello", "lang": "hi"}))
    tamil.send(json.dumps({"type": "hello", "lang": "ta"}))

    # 1. Mrs. Sharma: one sentence, two requests, confirmed in Hindi
    hindi.send(json.dumps({"type": "text", "text": "Madam, thoda wotter and kambal please"}))
    msg = wait_for(hindi, lambda m: m["type"] in ("confirm", "grid"))
    cards = msg.get("cards", []) if msg else []
    got = [(c["intent"] or c["options"][0])["intent"] for c in cards]
    check("\"thoda wotter and kambal\" becomes water + blanket", sorted(got) == ["blanket", "water"], ", ".join(got))
    for c in cards:
        hindi.send(json.dumps({"type": "confirm", "card_id": c["id"], "intent": (c["intent"] or c["options"][0])["intent"]}))
    state = wait_for(crew, lambda m: m["type"] == "state" and sum(c["status"] == "confirmed" for c in m["cards"]) >= 2)
    check("crew tablet shows both in Japanese", bool(state), ", ".join(c.get("crew_ja", "") for c in (state or {}).get("cards", [])))

    # 2. crew reply arrives in Hindi
    if cards:
        crew.send(json.dumps({"type": "reply", "card_id": cards[0]["id"], "reply_id": replies[0]["id"]}))
        msg = wait_for(hindi, lambda m: m["type"] == "reply")
        check("crew reply reaches the passenger in Hindi", bool(msg) and msg["text"] == replies[0]["hi"], msg and msg["text"])

    # 3. urgent: chest pain, then the symptom picture
    tamil.send(json.dumps({"type": "text", "text": "I have chest pain"}))
    msg = wait_for(tamil, lambda m: m["type"] == "confirm")
    urgent = msg and msg["cards"][0]
    check("chest pain is urgent at once", bool(urgent) and urgent["urgent"])
    state = wait_for(crew, lambda m: m["type"] == "state" and any(c["urgent"] for c in m["cards"]))
    check("crew alarm before the passenger confirms", bool(state))
    if urgent:
        tamil.send(json.dumps({"type": "confirm", "card_id": urgent["id"], "intent": "medical"}))
        msg = wait_for(tamil, lambda m: m["type"] == "triage")
        check("passenger is asked what is wrong (6 pictures)", bool(msg) and len(msg["triage"]["symptoms"]) == 6)
        tamil.send(json.dumps({"type": "symptom", "card_id": urgent["id"], "symptom": "dizzy"}))
        state = wait_for(crew, lambda m: m["type"] == "state" and any(c.get("symptom_ja") for c in m["cards"]))
        check("crew see the symptom in Japanese", bool(state),
              next((c["symptom_ja"] for c in state["cards"] if c.get("symptom_ja")), "") if state else "")

    # 4. the crew ask for a doctor: Japanese PA, captioned in Hindi and Tamil
    m = http.post("/api/pa/match", json={"text": "お客様の中に、お医者様または看護師の方はいらっしゃいませんか"}).json()
    check("Japanese doctor announcement recognised", m["verdict"] == "sure" and m["matches"][0]["id"] == "doctor")
    http.post("/api/pa/send", json={"id": "doctor"})
    hi_pa, ta_pa = wait_for(hindi, lambda x: x["type"] == "pa"), wait_for(tamil, lambda x: x["type"] == "pa")
    check("caption shown in Hindi and Tamil", bool(hi_pa and ta_pa) and "डॉक्टर" in hi_pa["caption"]["text"]
          and "மருத்துவர்" in ta_pa["caption"]["text"])
    unknown = http.post("/api/pa/match", json={"text": "The weather in Tokyo is sunny today"}).json()
    check("an announcement not in the library is not captioned", unknown["verdict"] == "none")

    # 5. turbulence briefing: one passenger is stuck at step 2
    http.post("/api/presenter/crew", json={"type": "broadcast", "template_id": "turbulence"})
    check("briefing reaches the Hindi seat", bool(wait_for(hindi, lambda x: x["type"] == "safety")))
    hindi.send(json.dumps({"type": "safety", "status": "reexplaining"}))
    hindi.send(json.dumps({"type": "safety", "status": "stuck", "step": 1}))
    state = wait_for(crew, lambda x: x["type"] == "state" and x["heatmap"].get("33H") == "stuck")
    check("crew seat map: 33H stuck at step 2", bool(state))
    http.post("/api/presenter/crew", json={"type": "end_broadcast"})

    # 6. care round with a queue position
    tamil.send(json.dumps({"type": "icon", "intent": "tea"}))
    wait_for(tamil, lambda x: x["type"] == "status")
    http.post("/api/presenter/crew", json={"type": "start_round"})
    msg = wait_for(tamil, lambda x: x["type"] == "status" and "2" in x.get("message", ""))
    check("care round tells the Tamil passenger their stop", bool(msg), msg and msg["message"])

    # 7. the flight report has it all
    r = http.get("/api/report").json()
    check("flight report: requests, urgent, caption, round",
          r["requests"]["total"] >= 4 and r["requests"]["urgent"]["count"] >= 1
          and r["announcements"]["count"] == 1 and r["care_rounds"]["count"] == 1,
          f"{r['requests']['total']} requests")



if __name__ == "__main__":
    main()
