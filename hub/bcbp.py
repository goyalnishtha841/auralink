"""IATA Bar Coded Boarding Pass (BCBP, Resolution 792) -- the fixed-width text format every
airline already prints into the barcode on a paper or mobile boarding pass. Reading it is how
the shared scanner learns a passenger's seat without any airline integration: the barcode is
already standard, so there is nothing to integrate with.

Only the mandatory "unique" fields are implemented (60 characters: name, PNR, route, flight,
date, seat, sequence, status) -- enough to carry a seat number, which is all Auralink needs. A
real boarding pass may also carry "repeated" (a second leg) and "conditional" (frequent-flyer
number, bag tag, ...) item blocks after these 60 characters; decode() reads past them without
touching their contents, so a real multi-leg or loyalty-carrying pass still decodes fine.

hub/main.py's /api/boarding-pass/demo (encode) and /api/seat/by-boarding-pass (decode) are the
HTTP side of this; this module is the pure, independently-testable parsing/building logic.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass

FORMAT_CODE = "M"
LEG_COUNT = "1"
ELECTRONIC_TICKET = "E"
MANDATORY_LEN = 60   # name ... passenger status + the (here always empty) conditional-item size


@dataclass
class BoardingPass:
    last_name: str
    first_name: str
    pnr: str             # booking reference, e.g. "ABC123"
    origin: str           # 3-letter airport code
    destination: str
    carrier: str           # 2-3 letter airline code, e.g. "JL"
    flight: str              # digits only, e.g. "6"
    seat: str                 # this cabin's seat id, e.g. "34K"
    sequence: int = 1        # check-in sequence number
    compartment: str = "Y"  # cabin class letter
    status: str = "1"      # passenger status: 1 = checked in


def _seat_field(seat: str) -> str:
    """"34K" -> "034K": BCBP's seat field is a fixed 3-digit row + 1-letter column."""
    row, letter = seat[:-1], seat[-1]
    return f"{int(row):03d}{letter}"


def _seat_from_field(field: str) -> str:
    """"034K" -> "34K": drop the BCBP row's leading zero to match this cabin's own seat ids."""
    row, letter = field[:3], field[3:4]
    return f"{int(row)}{letter}"


def encode(bp: BoardingPass, *, at: datetime.date | None = None) -> str:
    """The 60-character mandatory-item barcode string for `bp`, same shape as a real airline
    would print (minus any optional conditional items, which this cabin never needs)."""
    name = f"{bp.last_name.upper()}/{bp.first_name.upper()}"[:20].ljust(20)
    julian = (at or datetime.date.today()).timetuple().tm_yday
    s = (
        f"{FORMAT_CODE}{LEG_COUNT}{name}{ELECTRONIC_TICKET}"
        f"{bp.pnr.upper():<7.7}{bp.origin.upper():<3.3}{bp.destination.upper():<3.3}"
        f"{bp.carrier.upper():<3.3}{int(bp.flight):05d}{julian:03d}{bp.compartment.upper():.1}"
        f"{_seat_field(bp.seat)}{bp.sequence:05d}{bp.status}00"
    )
    assert len(s) == MANDATORY_LEN, f"BCBP mandatory block should be {MANDATORY_LEN} chars, got {len(s)}"
    return s


def decode(text: str) -> BoardingPass | None:
    """The reverse of `encode`, or None if `text` isn't a BCBP mandatory-items string (too
    short, wrong format code) -- never raises, so a bad scan just reads as "no boarding pass"."""
    text = text.strip()
    if len(text) < MANDATORY_LEN or text[0] != FORMAT_CODE:
        return None
    try:
        name = text[2:22].strip()
        last, _, first = name.partition("/")
        return BoardingPass(
            last_name=last.strip(), first_name=first.strip(),
            pnr=text[23:30].strip(), origin=text[30:33].strip(), destination=text[33:36].strip(),
            carrier=text[36:39].strip(), flight=text[39:44].strip().lstrip("0") or "0",
            compartment=text[47:48].strip() or "Y",
            seat=_seat_from_field(text[48:52]),
            sequence=int(text[52:57].strip() or 0),
            status=text[57:58] or "1",
        )
    except (ValueError, IndexError):
        return None
