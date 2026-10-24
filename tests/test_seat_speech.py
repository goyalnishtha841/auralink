from hub import seat_speech
from hub.state import SEAT_IDS

SEATS = set(SEAT_IDS)


def test_digits_and_letter_together():
    assert seat_speech.parse("34K", SEATS) == "34K"
    assert seat_speech.parse("seat 34 k", SEATS) == "34K"


def test_spoken_digits_separately():
    assert seat_speech.parse("three four kay", SEATS) == "34K"


def test_spoken_tens_and_ones():
    assert seat_speech.parse("thirty four kay", SEATS) == "34K"
    assert seat_speech.parse("row thirty two charlie", SEATS) == "32C"


def test_phonetic_alphabet_letter():
    assert seat_speech.parse("thirty one alpha", SEATS) == "31A"
    assert seat_speech.parse("I'm in thirty five hotel", SEATS) == "35H"


def test_no_letter_returns_none():
    assert seat_speech.parse("thirty four", SEATS) is None


def test_no_digits_returns_none():
    assert seat_speech.parse("kay", SEATS) is None


def test_nonexistent_seat_returns_none():
    # row 36 and letter F don't exist in this cabin layout
    assert seat_speech.parse("thirty six F", SEATS) is None


def test_empty_text_returns_none():
    assert seat_speech.parse("", SEATS) is None
    assert seat_speech.parse("um, uh", SEATS) is None
