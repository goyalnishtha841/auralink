"""Demo kit endpoints: the address phones should use, and QR codes for seat cards (offline)."""
from __future__ import annotations

import io
import os
import socket

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api")


def lan_ip() -> str:
    """This laptop's address on the cabin Wi-Fi (no packet is sent; the OS just picks a route)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


@router.get("/hub-info")
def hub_info(request: Request) -> dict:
    """Base URL that phones on the same Wi-Fi should open. AURALINK_PUBLIC_URL overrides it."""
    public = os.environ.get("AURALINK_PUBLIC_URL")
    if not public:
        port = request.url.port or (443 if request.url.scheme == "https" else 80)
        public = f"{request.url.scheme}://{lan_ip()}:{port}"
    return {"public_url": public.rstrip("/"), "https": public.startswith("https")}


@router.get("/qr")
def qr(data: str = Query(..., max_length=300)) -> Response:
    try:
        import segno
    except ImportError:
        raise HTTPException(501, "QR codes need the segno package: uv pip install segno") from None
    buf = io.BytesIO()
    segno.make(data, error="m").save(buf, kind="svg", scale=6, border=2, dark="#000", light="#fff", xmldecl=False)
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "max-age=3600"})
