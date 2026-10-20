from engine import Context, Hypothesis, Lexicon, interpret

lex = Lexicon()


def run(*texts, phase="cruise"):
    nbest = [Hypothesis(text=t, conf=1.0 - 0.2 * i) for i, t in enumerate(texts)]
    return interpret(nbest, Context(seat="34K", phase=phase), lex)


def top_intents(result):
    return [c.candidates[0].intent for c in result.cards]


def test_worked_example_splits_into_two_cards():
    r = run("thoda wotter and kambal")
    assert r.rule == "split"
    assert top_intents(r) == ["water", "blanket"]


def test_asr_error_recovered_from_nbest():
    r = run("thoda water and camel", "thoda wotter and kambal")
    assert top_intents(r) == ["water", "blanket"]


def test_hindi_medical_is_urgent():
    r = run("madam dawai chahiye")
    assert r.urgent
    assert top_intents(r) == ["medical"]


def test_disagreeing_nbest_asks_instead_of_guessing():
    nbest = [Hypothesis(text="water please", conf=0.5), Hypothesis(text="toilet please", conf=0.5)]
    r = interpret(nbest, Context(seat="34K"), lex)
    assert r.rule == "close"
    assert {c.intent for c in r.cards[0].candidates[:2]} == {"water", "toilet"}


def test_pain_is_urgent():
    r = run("pain")
    assert r.urgent and top_intents(r) == ["medical"]


def test_symptoms_in_one_sentence_make_one_card():
    r = run("I need medicine, I have chased pain.")  # real Whisper output for "chest pain"
    assert r.rule == "confident" and top_intents(r) == ["medical"]


def test_hindi_function_words_do_not_trigger_requests():
    assert top_intents(run("Shochale kaha hai")) == ["toilet"]  # "kaha" is not "chai"
    assert top_intents(run("Can I get some water please?")) == ["water"]  # "can i" is not "khana"


def test_noise_gives_flat_and_no_cards():
    assert run("hmm").rule == "flat"


def test_empty_transcript():
    assert run("").rule == "empty"


def test_devanagari_input():
    assert top_intents(run("पानी")) == ["water"]


def test_context_prior_raises_meal_at_meal_time():
    cruise = run("khana").cards[0].candidates[0].score
    meal = run("khana", phase="meal").cards[0].candidates[0].score
    assert meal > cruise
