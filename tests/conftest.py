"""Tests never touch the real saved cabin state or check-ins: point them at a throwaway folder."""
import os
import tempfile

os.environ.setdefault("AURALINK_FLIGHT_DIR", tempfile.mkdtemp(prefix="auralink-test-"))
