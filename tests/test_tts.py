import pytest

pytest.importorskip("kokoro_onnx")

from engine.tts import available, synthesize, voice_for  # noqa: E402

if not available():
    pytest.skip("Kokoro model files not downloaded", allow_module_level=True)


def test_synthesizes_a_wav_for_a_supported_language():
    wav = synthesize("Hello, this is a test.", "en")
    assert wav is not None
    assert wav[:4] == b"RIFF" and b"WAVE" in wav[:12]


def test_returns_none_for_an_unsupported_language_so_the_caller_can_fall_back():
    assert synthesize("สวัสดี", "th") is None  # Kokoro has no Thai voice; browser voice takes over


def test_voice_for_reports_what_synthesize_will_actually_use():
    assert voice_for("en") is not None
    assert voice_for("xx") is None
