"""Crew PIN: the crew tablet, presenter console, flight report and judge screen are crew-only.

Passengers stay open (seat screens, check-in, recording page). The PIN comes from AURALINK_CREW_PIN;
if unset, a 6-digit PIN is made at startup and logged once. POST /api/crew/login with the PIN sets an
HttpOnly cookie; HTTP routes check it with `require_crew`, sockets with `crew_socket_ok` (close 4401).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket
from pydantic import BaseModel, Field

log = logging.getLogger("auralink.hub")

COOKIE = "auralink_crew"
WS_CLOSE = 4401                      # "unauthorised", in the application range of close codes
MAX_TRIES, LOCK_S = 5, 60            # wrong PINs per address before a one-minute wait


def _load_pin() -> str:
    pin = os.environ.get("AURALINK_CREW_PIN", "").strip()
    if pin:
        return pin
    pin = f"{secrets.randbelow(10**6):06d}"
    log.warning("crew PIN for this run: %s (set AURALINK_CREW_PIN to choose one)", pin)
    return pin


PIN = _load_pin()


def token(pin: str | None = None) -> str:
    """Cookie value: derived from the PIN (never the PIN itself), so a new PIN logs every tablet out."""
    return hmac.new((pin or PIN).encode(), b"auralink-crew", hashlib.sha256).hexdigest()


def _ok(cookie: str | None) -> bool:
    return bool(cookie) and hmac.compare_digest(cookie, token())


def require_crew(request: Request) -> None:
    """FastAPI dependency for crew-only HTTP routes."""
    if not _ok(request.cookies.get(COOKIE)):
        raise HTTPException(401, "Crew PIN required / 乗務員PINが必要です")


async def crew_socket_ok(ws: WebSocket) -> bool:
    """Accept, then close with 4401 if the cookie is missing: browsers only see a close code after accept."""
    await ws.accept()
    if _ok(ws.cookies.get(COOKIE)):
        return True
    await ws.close(code=WS_CLOSE, reason="crew PIN required")
    return False


router = APIRouter(prefix="/api/crew")
_failures: dict[str, list[float]] = defaultdict(list)


class LoginIn(BaseModel):
    pin: str = Field(min_length=1, max_length=32)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response) -> dict:
    who = request.client.host if request.client else "?"
    now = time.monotonic()
    recent = _failures[who] = [t for t in _failures[who] if now - t < LOCK_S]
    if len(recent) >= MAX_TRIES:
        raise HTTPException(429, "Too many tries: wait a minute / しばらくお待ちください")
    if not hmac.compare_digest(body.pin.strip().encode(), PIN.encode()):
        recent.append(now)
        raise HTTPException(401, "Wrong PIN / PINが違います")
    _failures.pop(who, None)
    response.set_cookie(COOKIE, token(), max_age=24 * 3600, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https")
    return {"ok": True}


LOCAL = {"127.0.0.1", "::1", "localhost"}


PIN_PUBLIC = os.environ.get("AURALINK_PUBLIC_PIN") == "1"


@router.get("/pin-hint")
def pin_hint(request: Request) -> dict:
    """The PIN, normally only for a browser on the hub laptop itself (the Start page shows it to the
    presenter) -- anyone else on the cabin Wi-Fi gets 403, so a passenger can never read it. Set
    AURALINK_PUBLIC_PIN=1 to show it to anyone on the Start page instead, e.g. for a judged demo where
    the whole point is letting a visitor open the crew tablet themselves."""
    if not PIN_PUBLIC and (request.client.host if request.client else "") not in LOCAL:
        raise HTTPException(403, "The crew PIN is only shown on the laptop that runs Auralink")
    return {"pin": PIN}
