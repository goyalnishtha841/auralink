import pytest

pytest.importorskip("ctranslate2")
pytest.importorskip("transformers")

from engine.translate import NLLB_LANG, available, translate  # noqa: E402

try:
    if not available():
        raise RuntimeError("ctranslate2/transformers not importable")
    translate("water", "en", "hi")
except Exception as e:  # model not downloaded, or no network on first use
    pytest.skip(f"NLLB model unavailable: {e}", allow_module_level=True)


def test_translates_a_simple_sentence_en_to_hi():
    out = translate("I would like some water", "en", "hi")
    assert out and out != "I would like some water"


def test_round_trip_keeps_the_meaning_recognisable():
    hi = translate("my head hurts", "en", "hi")
    back = translate(hi, "hi", "en")
    assert "head" in back.lower() or "pain" in back.lower() or "hurt" in back.lower()


def test_same_language_is_not_asked_of_translate_directly():
    # the hub endpoint short-circuits src == tgt; this module itself still translates if asked
    out = translate("water", "en", "en")
    assert isinstance(out, str)


def test_unknown_language_raises_key_error():
    with pytest.raises(KeyError):
        translate("hello", "en", "xx")


def test_empty_text_is_empty_translation():
    assert translate("", "en", "hi") == ""


def test_known_languages_cover_auralinks_existing_set():
    for code in ("en", "hi", "ta", "th"):
        assert code in NLLB_LANG
