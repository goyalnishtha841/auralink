# ASR spike results

Stand-in data: macOS voices Rishi, Aman (Indian English) and Lekha (Hindi), 14 phrases, brown noise as a cabin-noise proxy. A smoke test of the pipeline, **not** an evaluation; real speakers will score differently.

## Whisper `base` (int8, CPU)

Model load 1.2 s · median latency en only 462 ms · en+hi 669 ms (p90 779 ms) · deck target < 1500 ms

| Setup | Clean | 10 dB | 0 dB | All |
|---|---|---|---|---|
| top-1 (en) | 86% | 86% | 86% | 86% |
| n-best (en) | 86% | 86% | 86% | 86% |
| n-best (en+hi) | 93% | 79% | 93% | 88% |

| Silence gate | Result |
|---|---|
| 2 s silence | no speech detected |
| 2 s brown noise | no speech detected |

<details><summary>Per clip</summary>

| Clip | Noise | Best English guess | Best Hindi guess | # guesses | top-1 / en n-best / en+hi | ms |
|---|---|---|---|---|---|---|
| rishi_water_blanket | clean | Madam, Thora water and Cumble please. | Madam, Thora Water & Cumble Please. | 9 | ✅ ✅ ✅ | 802 |
| rishi_water_blanket | 10 dB | Madam, Thora water and Campbell please. | Madam, Thora Water & Cumble Please. | 8 | ✅ ✅ ✅ | 760 |
| rishi_water_blanket | 0 dB | Madam, hold our water and come well please. | Madam Thora Water & Cumble Please | 9 | ✅ ✅ ✅ | 644 |
| rishi_water | clean | Can I get some water please? | can i get some water please. | 7 | ✅ ✅ ✅ | 593 |
| rishi_water | 10 dB | Can I get some water please? | can i get some water please | 7 | ✅ ✅ ✅ | 633 |
| rishi_water | 0 dB | Can I get some water please? | can i get some water please | 6 | ✅ ✅ ✅ | 598 |
| rishi_blanket | clean | Excuse me, I need a blanket, it is very cold. | Excuse me, i need a blanket, it is very cold. | 8 | ✅ ✅ ✅ | 969 |
| rishi_blanket | 10 dB | Excuse me, I need a blanket, it is very cold. | Excuse me, i need a blanket, it is very cold. | 7 | ✅ ✅ ✅ | 736 |
| rishi_blanket | 0 dB | Excuse me, I need a blanket. It is very cold. | Excuse me, i need a blanket, it is very cold. | 6 | ✅ ✅ ✅ | 779 |
| rishi_toilet | clean | Where is the washroom? | Where is the washroom?. | 5 | ✅ ✅ ✅ | 935 |
| rishi_toilet | 10 dB | Where is the washroom? | Where is the washroom ? | 6 | ✅ ✅ ✅ | 669 |
| rishi_toilet | 0 dB | Where is the washroom? | Where is the washroom ? | 7 | ✅ ✅ ✅ | 630 |
| rishi_medical | clean | I need medicine, I have chased pain. | i need medicine, i have chased pain | 7 | ✅ ✅ ✅ | 757 |
| rishi_medical | 10 dB | I need medicine. I have chased pain. | i need medicine, i have chased pain | 7 | ✅ ✅ ✅ | 627 |
| rishi_medical | 0 dB | I need medicine. I have chased pain. | i need medicine, i have chased pain | 8 | ✅ ✅ ✅ | 646 |
| aman_tea | clean | One cup of chai peas. | 1 cup of chai piece | 8 | ✅ ✅ ✅ | 616 |
| aman_tea | 10 dB | One cup of chai peas. | 1 cup of Chai Peas | 8 | ✅ ✅ ✅ | 672 |
| aman_tea | 0 dB | One cup of chai peas. | 1 cup of Chai Peas | 10 | ✅ ✅ ✅ | 620 |
| aman_pillow | clean | Can I have a pillow? | can i have a pillow? | 6 | ✅ ✅ ✅ | 594 |
| aman_pillow | 10 dB | Can I have a pillow? | Can I have a pillow ? | 6 | ✅ ✅ ✅ | 660 |
| aman_pillow | 0 dB | Can I have a pillow? | Can I have a pillow ? | 5 | ✅ ✅ ✅ | 611 |
| aman_meal | clean | I am hungry is their vegetarian food. | I am hungry is there vegetarian food. | 8 | ✅ ✅ ✅ | 734 |
| aman_meal | 10 dB | I am hungry is their vegetarian food. | i am hungry is their vegetarian food | 8 | ✅ ✅ ✅ | 602 |
| aman_meal | 0 dB | I am hungry is their vegetarian food. | I am hungry is there vegetarian food. | 8 | ✅ ✅ ✅ | 625 |
| lekha_water_blanket | clean | a little water and a little bit of water. | Thoura Pani & Kambal Chahi | 10 | ❌ ❌ ✅ | 738 |
| lekha_water_blanket | 10 dB | A little water and a cup of tea. | Khura Pani & Kambal Chahi | 9 | ❌ ❌ ❌ | 624 |
| lekha_water_blanket | 0 dB | full of water and fuel. | Phudafani & Kambal Chahi | 9 | ❌ ❌ ✅ | 650 |
| lekha_medical | clean | I need medicine, it's pain in my body. | முத்திவாயிற்றாயே, சிரமித்தர்வே. | 10 | ✅ ✅ ✅ | 1043 |
| lekha_medical | 10 dB | I need medicine, it is just pain. | Mujhi dvaay chahiye sir mein dard hai. | 10 | ✅ ✅ ❌ | 797 |
| lekha_medical | 0 dB | I need the medicine, it is just a pain. | ...muchhe dvaay chahiye sir mein dert hai. | 10 | ✅ ✅ ✅ | 750 |
| lekha_toilet | clean | Shochale Kaha hai. | Shachale Kaha hai. | 9 | ✅ ✅ ✅ | 575 |
| lekha_toilet | 10 dB | So, let's see where it is | Shachale Kaha hai. | 9 | ✅ ✅ ✅ | 721 |
| lekha_toilet | 0 dB | So, let's see where it is | Shachale Kaha hai. | 9 | ✅ ✅ ✅ | 743 |
| lekha_pillow | clean | Please give me one piece. | Moi je ik ta kiyadiji. | 10 | ❌ ❌ ❌ | 763 |
| lekha_pillow | 10 dB | Give me one piece. | Mujhi ik takyaadiji. | 10 | ❌ ❌ ❌ | 700 |
| lekha_pillow | 0 dB | Give me a piece of paper. | ..muchi ik takyaadiji. | 10 | ❌ ❌ ❌ | 735 |
| lekha_tea | clean | Muci chai chahi. | муji chai chahi | 10 | ✅ ✅ ✅ | 620 |
| lekha_tea | 10 dB | I need tea. | muji chai chahi | 10 | ✅ ✅ ✅ | 636 |
| lekha_tea | 0 dB | Muci chai chahi. | muci chai chahi | 9 | ✅ ✅ ✅ | 749 |
| lekha_help | clean | Listen, help. | Sune, Madag Chahi. | 10 | ✅ ✅ ✅ | 662 |
| lekha_help | 10 dB | Listen, help. | Sune Maadha Chahi. | 10 | ✅ ✅ ✅ | 669 |
| lekha_help | 0 dB | Listen, help me. | Sune, Madag Chahi. | 10 | ✅ ✅ ✅ | 686 |

</details>

## Whisper `small` (int8, CPU)

Model load 1.4 s · median latency en only 1757 ms · en+hi 2857 ms (p90 3332 ms) · deck target < 1500 ms

| Setup | Clean | 10 dB | 0 dB | All |
|---|---|---|---|---|
| top-1 (en) | 100% | 93% | 93% | 95% |
| n-best (en) | 100% | 93% | 93% | 95% |
| n-best (en+hi) | 93% | 100% | 93% | 95% |

| Silence gate | Result |
|---|---|
| 2 s silence | no speech detected |
| 2 s brown noise | no speech detected |

<details><summary>Per clip</summary>

| Clip | Noise | Best English guess | Best Hindi guess | # guesses | top-1 / en n-best / en+hi | ms |
|---|---|---|---|---|---|---|
| rishi_water_blanket | clean | Madam, Thora water and cumble please. | मदम, तोडा वोटर अंद कमबल प्लीज | 10 | ✅ ✅ ✅ | 3332 |
| rishi_water_blanket | 10 dB | Madam, Thora water and cumble please. | मैदम, तोडा वोटर अंद कमबल प्लीज | 10 | ✅ ✅ ✅ | 3172 |
| rishi_water_blanket | 0 dB | Madam, pour our water and cumble please. | मैदम, तोडा वोटर अंद कमबल प्लीज | 10 | ✅ ✅ ✅ | 3472 |
| rishi_water | clean | Can I get some water please? | – | 5 | ✅ ✅ ✅ | 3221 |
| rishi_water | 10 dB | Can I get some water please? | – | 5 | ✅ ✅ ✅ | 3198 |
| rishi_water | 0 dB | Can I get some water please? | – | 5 | ✅ ✅ ✅ | 3070 |
| rishi_blanket | clean | Excuse me, I need a blanket. It is very cold. | एक्स्कूँस में, आई नीद अब लांकित, इत इस वेरी को | 10 | ✅ ✅ ✅ | 3909 |
| rishi_blanket | 10 dB | Excuse me, I need a blanket. It is very cold. | एक्स्कूँस में आई नीद अ ब्लन्कित, इत इस वेरी कोल | 10 | ✅ ✅ ✅ | 3704 |
| rishi_blanket | 0 dB | Excuse me, I need a blanket. It is very cold. | अच्छुज में, आई नीद अब लांकित, इत इस वेरी कोल | 10 | ✅ ✅ ✅ | 3659 |
| rishi_toilet | clean | Where is the washroom? | वाश्रुम नहीं | 7 | ✅ ✅ ✅ | 2265 |
| rishi_toilet | 10 dB | Where is the washroom? | वाश्रूम नहीं? | 10 | ✅ ✅ ✅ | 2428 |
| rishi_toilet | 0 dB | Where is the washroom? | नहीं, नहीं, नहीं, | 10 | ✅ ✅ ✅ | 2550 |
| rishi_medical | clean | I need medicine. I have chased pain. | I need medicine. I have chaste pain. | 7 | ✅ ✅ ✅ | 2288 |
| rishi_medical | 10 dB | I need medicine. I have chased pain. | I need medicine. I have chaste pain. | 8 | ✅ ✅ ✅ | 2380 |
| rishi_medical | 0 dB | I need medicine. I have chased pain. | I need medicine. I have chaste pain. | 8 | ✅ ✅ ✅ | 2347 |
| aman_tea | clean | One cup of chai please. | वन कुप अप चाए पीस | 10 | ✅ ✅ ✅ | 2659 |
| aman_tea | 10 dB | One cup of tea please. | वन कुप अप चाए पीस | 10 | ✅ ✅ ✅ | 2647 |
| aman_tea | 0 dB | one cup of chai please | 1 कप अप चाए पीस | 10 | ✅ ✅ ✅ | 2570 |
| aman_pillow | clean | Can I have a pillow? | Can I have a pillow. | 9 | ✅ ✅ ✅ | 2507 |
| aman_pillow | 10 dB | Can I have a pillow? | Can I have a pillow. | 9 | ✅ ✅ ✅ | 2206 |
| aman_pillow | 0 dB | Can I have a pillow? | अगर आप आप पिलोग है? | 10 | ✅ ✅ ✅ | 2706 |
| aman_meal | clean | I am hungry is there vegetarian food? | I am hungry is their vegetarian food | 6 | ✅ ✅ ✅ | 2351 |
| aman_meal | 10 dB | I am hungry is their vegetarian food. | अम हुंग्री इस देर वेजिटेरिन फुड | 10 | ✅ ✅ ✅ | 3321 |
| aman_meal | 0 dB | I am hungry is their vegetarian food. | अम हुंगरी इस देर वेजिटेरिन फुड | 10 | ✅ ✅ ✅ | 3207 |
| lekha_water_blanket | clean | Thora pani aur kambal chahiye. | तोरा पानी और कंबल चाहिए. | 10 | ✅ ✅ ✅ | 2848 |
| lekha_water_blanket | 10 dB | Thora pani aur kambal chahiye. | तोरा पानी और कंबल चाहिए. | 10 | ✅ ✅ ✅ | 2968 |
| lekha_water_blanket | 0 dB | Foda pani aur kambal chahiye. | फोडा पानी और कंबल चाहे | 10 | ✅ ✅ ✅ | 2922 |
| lekha_medical | clean | I want medicine, headache. | मुझी दवाई चाही, सिर में द़द है. | 10 | ✅ ✅ ✅ | 3022 |
| lekha_medical | 10 dB | I want medicine, headache. | मुझे दवाई चाहिए, सिर में दर्ध है. | 10 | ✅ ✅ ✅ | 3148 |
| lekha_medical | 0 dB | I want medicine, headache. | मुछी दवाई चाहिए, सिर में दर्ध है | 10 | ✅ ✅ ✅ | 3098 |
| lekha_toilet | clean | Shawchale kaha hai? | शोचाले कहा है | 10 | ✅ ✅ ❌ | 2384 |
| lekha_toilet | 10 dB | Where is Shawchale? | शोचाले कहा है? | 10 | ✅ ✅ ✅ | 2420 |
| lekha_toilet | 0 dB | Where is Shawchale? | शोचाले कहाँ है? | 10 | ✅ ✅ ❌ | 2466 |
| lekha_pillow | clean | Mujhi ek takya diji. | मुजी एक तक्या दीजी. | 9 | ✅ ✅ ✅ | 3455 |
| lekha_pillow | 10 dB | Give me one second. | मुजी एक तक्या दीजे. | 10 | ❌ ❌ ✅ | 3061 |
| lekha_pillow | 0 dB | Give me a hint. | मुजी एक तक्या दीजे. | 10 | ❌ ❌ ✅ | 2702 |
| lekha_tea | clean | Muji chai chahi. | मुछी चाए चाही | 10 | ✅ ✅ ✅ | 2519 |
| lekha_tea | 10 dB | I want tea. | मुझी चाए चाही | 10 | ✅ ✅ ✅ | 2532 |
| lekha_tea | 0 dB | I want tea. | मुछी चाए चाहिए | 10 | ✅ ✅ ✅ | 3218 |
| lekha_help | clean | Sune, Madat Chahiye. | सुने, मदद चाहिए. | 10 | ✅ ✅ ✅ | 3194 |
| lekha_help | 10 dB | Suni, Madad Chahiye. | सुने मदद चाहिए | 10 | ✅ ✅ ✅ | 2866 |
| lekha_help | 0 dB | Suni, madag chahiye. | सुने, मदाख चाहिये | 10 | ✅ ✅ ✅ | 2706 |

</details>
