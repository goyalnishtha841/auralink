"""The cost learner only learns real, repeated, same-kind sound swaps from sentences that line up."""
import pytest

pytest.importorskip("phonemizer")

from engine.phonetic import Phonemizer  # noqa: E402
from scripts import learn_costs  # noqa: E402

try:
    phon = Phonemizer()
    phon("water")
except Exception as e:
    pytest.skip(f"eSpeak-NG unavailable: {e}", allow_module_level=True)


def test_repeated_swap_is_counted_and_garbage_is_skipped():
    pairs = [("a", "water please", "vater please")] * 3 + [("b", "thoda water", "a little bit of rum today")]
    swaps, used = learn_costs.count_swaps(pairs, phon)
    assert used == 3                                   # the hallucinated sentence is skipped
    assert swaps[frozenset(("w", "v"))] == 3           # w heard as v, three times
    assert all(len(p) == 2 for p in swaps)


def test_cost_rule():
    cost = lambda n: round(max(learn_costs.MIN_COST, 1 - n / (n + learn_costs.K)), 2)  # noqa: E731
    assert (cost(1), cost(3), cost(9), cost(100)) == (0.75, 0.5, 0.25, 0.15)
