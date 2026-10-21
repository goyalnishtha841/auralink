"""Tests never touch the real saved cabin state or check-ins: point them at a throwaway folder.
Crew screens need the crew PIN (hub/auth.py); tests use a fixed one and the `crew_login` fixture."""
import os
import tempfile

import pytest

os.environ.setdefault("AURALINK_FLIGHT_DIR", tempfile.mkdtemp(prefix="auralink-test-"))
os.environ["AURALINK_CREW_PIN"] = "246810"
TEST_PIN = "246810"


@pytest.fixture(scope="session")
def crew_login():
    """crew_login(client) logs the client in with the crew PIN (sets the cookie) and returns it."""
    def login(client):
        assert client.post("/api/crew/login", json={"pin": TEST_PIN}).status_code == 200
        return client
    return login
