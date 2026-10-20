import pytest

pytest.importorskip("phonemizer")

from engine import Context, Hypothesis, Lexicon, interpret  # noqa: E402
from engine.matcher import make_similarity  # noqa: E402
from engine.phonetic import Costs, normalise, weighted_distance  # noqa: E402

try:
    accent = make_similarity("phonetic")
    uniform = make_similarity("phonetic_uniform")
    hybrid = make_similarity("hybrid")
    accent("water", "water")
except Exception as e:  # eSpeak-NG not installed on this machine
    pytest.skip(f"eSpeak-NG unavailable: {e}", allow_module_level=True)

lex = Lexicon()


def tops(text, sim=hybrid):
    r = interpret([Hypothesis(text=text)], Context(seat="1"), lex, sim=sim)
    return [c.candidates[0].intent for c in r.cards], r


def test_normalise_splits_rhotic_and_strips_length():
    assert normalise("w ɔː ɾ ɚ") == ("w", "ɔ", "ɾ", "ə", "r")


def test_free_ends_finds_word_inside_glued_word():
    c = Costs.load()
    glued, word = tuple("xxtakiyaxx"), tuple("takiya")
    assert weighted_distance(glued, word, c, free_ends=True) == 0
    assert weighted_distance(glued, word, c) > 0


def test_accent_costs_beat_plain_phoneme_distance():
    for heard, variant in [("wotter", "water"), ("vater", "water"), ("dvaay", "dawai"), ("shochale", "sauchalay")]:
        assert accent(heard, variant) > uniform(heard, variant), (heard, variant)


def test_cross_script_matches():
    assert accent("camel", "कंबल") > 0.75     # Whisper's English pass vs Devanagari lexicon entry
    assert accent("शोचाले", "शौचालय") > 0.85  # Whisper's misspelling vs the correct word


def test_glued_words():
    assert accent("takyaadiji", "takiya") > 0.75   # "takiya dijiye" written as one word


def test_requests_found_by_sound():
    assert tops("मुजी एक तक्या दीजे")[0] == ["pillow"]
    assert tops("Thura Pani & Cumble Chahi")[0] == ["water", "blanket"]
    assert tops("where is the wash room")[0] == ["toilet"]   # split word rejoined


def test_fillers_matched_by_sound_but_not_request_words():
    assert tops("Madham Thora Water & Cumble Please")[0] == ["water", "blanket"]  # "madham" ≈ "madam", not "madad"
    assert tops("I am feeling dizzy")[0] == ["medical"]  # "dizzy" ≈ "dijiye", but it is a request word


def test_hybrid_vetoes_sound_alikes_that_look_different():
    found, r = tops("my son is waiting in Tokyo")
    assert not any(c.status == "confident" for c in r.cards)  # "tokyo" sounds a bit like "takia"


def test_cant_is_one_word():
    found, r = tops("I can't breathe")
    assert found == ["medical"] and r.urgent
