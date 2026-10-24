import datetime

from hub.bcbp import BoardingPass, decode, encode


def test_round_trip():
    bp = BoardingPass(last_name="Tanaka", first_name="Yuki", pnr="abc123", origin="DEL",
                       destination="HND", carrier="jl", flight="6", seat="34K", sequence=25)
    text = encode(bp, at=datetime.date(2026, 1, 15))
    assert len(text) == 60
    out = decode(text)
    assert out == BoardingPass(last_name="TANAKA", first_name="YUKI", pnr="ABC123", origin="DEL",
                                destination="HND", carrier="JL", flight="6", seat="34K",
                                sequence=25, compartment="Y", status="1")


def test_single_digit_row_seat():
    # JAL 787 economy only goes 30-35, but the field width logic should hold for any row.
    bp = BoardingPass(last_name="Lee", first_name="A", pnr="XYZ999", origin="HND", destination="DEL",
                       carrier="JL", flight="1", seat="3A")
    text = encode(bp)
    assert "003A" in text
    assert decode(text).seat == "3A"


def test_long_name_is_truncated_not_broken():
    bp = BoardingPass(last_name="Verylongsurnamethatoverflows", first_name="X", pnr="ABC123",
                       origin="DEL", destination="HND", carrier="JL", flight="6", seat="34K")
    text = encode(bp)
    assert len(text) == 60
    assert decode(text) is not None


def test_decode_rejects_short_or_wrong_format():
    assert decode("") is None
    assert decode("not a boarding pass") is None
    assert decode("Q1" + "x" * 58) is None   # wrong format code


def test_decode_rejects_bad_seat_field():
    bp = BoardingPass(last_name="Tanaka", first_name="Yuki", pnr="ABC123", origin="DEL",
                       destination="HND", carrier="JL", flight="6", seat="34K")
    text = encode(bp)
    corrupted = text[:48] + "XXXX" + text[52:]   # seat field is letters, not digits+letter
    assert decode(corrupted) is None
