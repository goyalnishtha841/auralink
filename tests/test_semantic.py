import pytest

pytest.importorskip("fastembed")

from engine import Context, Hypothesis, Lexicon, interpret  # noqa: E402
from engine.matcher import make_similarity  # noqa: E402
from engine.semantic import SemanticSimilarity  # noqa: E402

try:
    sem = SemanticSimilarity()
    sem("water", "water")
except Exception as e:  # model not downloaded and no network on this machine
    pytest.skip(f"semantic model unavailable: {e}", allow_module_level=True)

lex = Lexicon()
tri = make_similarity("trimodal")


def test_semantic_separates_a_real_paraphrase_from_noise():
    toilet = max(sem("where is the bathroom", v) for v in lex.variants("toilet"))
    unrelated = max(sem("the weather is nice today", v) for v in lex.variants("toilet"))
    assert toilet > unrelated
    assert toilet > 0.5


def test_semantic_exact_string_is_perfect_match():
    assert sem("water", "water") == 1.0


def test_trimodal_still_catches_the_worked_example():
    r = interpret([Hypothesis(text="thoda wotter and kambal")], Context(seat="34K"), lex, sim=tri)
    assert [c.candidates[0].intent for c in r.cards] == ["water", "blanket"]


def test_trimodal_name_is_reported_for_the_judge_view():
    assert tri.name == "trimodal"
