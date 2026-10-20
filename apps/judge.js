// "Under the hood": renders hub/explain.py output. Live from /ws/judge, or typed via /api/explain.
import { connect, el } from "./common.js";

const $ = (id) => document.getElementById(id);
const history = [];
let current = -1;

const STAGES = ["vad", "encode", "decode_en", "decode_hi", "match"];
const RULE_PILL = { confident: ["Confident", "ok"], split: ["Split", "ok"], close: ["Ask", "amber"],
                    flat: ["Not sure", "amber"], empty: ["No speech", "dim"] };
const SCALE_MAX = 1.2;   // context priors can lift a score above 1
const pct = (v) => `${Math.min(100, (v / SCALE_MAX) * 100).toFixed(1)}%`;
const ms = (v) => (v == null ? "–" : v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`);

function add(entry) {
  history.unshift(entry);
  history.length = Math.min(history.length, 12);
  show(0);
}

function show(i) {
  current = i;
  const { x, source, seat } = history[i];
  $("empty").hidden = true;
  $("view").hidden = false;
  renderPipeline(x, source);
  renderWave(x, source);
  renderNbest(x, source);
  renderTokens(x);
  renderDecision(x, source, seat);
  renderCards(x);
  renderHistory();
}

function renderPipeline(x, source) {
  for (const node of document.querySelectorAll(".stage")) {
    const v = x.latency_ms[node.dataset.key];
    const off = v == null;
    node.classList.toggle("off", off);
    node.querySelector("b").textContent = off ? (source === "typed" ? "typed" : "–") : ms(v);
  }
  const meter = (name, value, target) => {
    const over = value != null && value > target;
    return el("div", { class: `meter ${over ? "over" : ""}` },
      el("div", { class: "meter-row" }, el("span", {}, name),
        el("span", {}, value == null ? "not used" : `${ms(value)} of ${target} ms budget`)),
      el("div", { class: "meter-bar" }, el("i", { style: `width:${value == null ? 0 : Math.min(100, (value / target) * 100)}%` })));
  };
  $("budget").replaceChildren(
    meter("Speech to text", x.stages.speech_to_text, x.targets_ms.speech_to_text),
    meter("Matching", x.stages.match, x.targets_ms.match));
}

function renderWave(x, source) {
  const box = $("wave");
  if (!x.waveform) {
    box.replaceChildren(el("div", { class: "typed" },
      source === "typed" ? "Typed phrase: no audio. Speak on a passenger screen to see the waveform." :
      x.rejected ? `Rejected before speech-to-text: ${x.rejected}` : "No audio"));
    return;
  }
  const canvas = el("canvas", { "aria-label": "Waveform with detected speech highlighted", role: "img" });
  box.replaceChildren(canvas, el("div", { class: "wave-cap" },
    el("span", {}, `${x.waveform.seconds} s recorded`), el("span", {}, "highlighted: speech found by the silence filter")));
  requestAnimationFrame(() => {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgba(60,232,200,.10)";
    for (const [a, b] of x.waveform.speech) ctx.fillRect(a * w, 0, (b - a) * w, h);
    const peaks = x.waveform.peaks, bw = w / peaks.length, max = Math.max(...peaks, 0.05);
    peaks.forEach((p, i) => {
      const inSpeech = x.waveform.speech.some(([a, b]) => i / peaks.length >= a && i / peaks.length <= b);
      ctx.fillStyle = inSpeech ? "#3ce8c8" : "#3a4566";
      const bh = Math.max(2, (p / max) * (h - 12));
      ctx.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh);
    });
  });
}

function renderNbest(x, source) {
  const items = x.nbest.length ? x.nbest : [{ text: "(nothing)", conf: 0, lang: null }];
  $("nbest").replaceChildren(...items.map((h) => el("li", {},
    el("span", { class: `lang ${h.lang || "typed"}` }, h.lang ? h.lang.toUpperCase() : "TXT"),
    el("span", { class: "nb-text", lang: h.lang === "hi" ? "hi" : "en" }, h.text),
    el("span", { class: "nb-conf" }, source === "typed" ? "typed" : `p ${h.conf.toFixed(2)}`))));
}

function renderTokens(x) {
  const heard = new Set(x.cards.flatMap((c) => c.candidates.slice(0, 1).flatMap((k) => k.heard.split(" "))));
  $("tokens").replaceChildren(...(x.tokens.length ? x.tokens : [{ text: "(no words)", filler: true }]).map((t) =>
    el("span", { class: `tok ${t.filler ? "filler" : heard.has(t.text) ? "hit" : ""}`, title: t.filler ? "ignored filler word" : "" }, t.text)));
}

function renderDecision(x, source, seat) {
  const [name, tone] = x.urgent ? ["Urgent", "bad"] : RULE_PILL[x.rule];
  $("decision").replaceChildren(...[
    el("div", { class: "rule" }, el("span", { class: `pill ${tone}` }, name), `Rule: ${x.rule}`),
    el("p", {}, x.rule_text),
    x.urgent ? el("p", { class: "urgent-line" }, "Medical request: crew alerted immediately, before the passenger confirms.") : null,
    el("p", { class: "mono", style: "font-size:12px;color:var(--ink-faint)" },
      `${source === "typed" ? "typed" : `seat ${seat} · ${source}`} · phase ${x.phase} · matcher ${x.matcher} · t1 ${x.thresholds.t1} · t2 ${x.thresholds.t2}`),
  ].filter(Boolean));  // replaceChildren would print a null as the text "null"
}

function alignment(c) {
  const d = c.detail;
  const title = el("div", { class: "align-title" },
    el("span", {}, `“${c.heard}” sounds like “${c.matched}”`),
    el("span", { class: "eq" }, "sound ", el("b", {}, d.sound ?? d.score), " · spelling ", el("b", {}, d.spelling ?? "–"),
      " → ", el("b", {}, c.raw), c.prior !== 1 ? ` × phase prior ${c.prior} = ` : "", c.prior !== 1 ? el("b", {}, c.score) : ""));
  const cells = [el("span", { class: "rowlab" }, "heard"), el("span", { class: "rowlab" }, ""), el("span", { class: "rowlab" }, "word")];
  for (const s of d.steps) {
    const cls = `col-${s.op} ${s.cost >= 0.75 ? "costly" : s.cost > 0 ? "cheap" : ""}`;
    cells.push(
      el("span", { class: cls }, el("span", { class: `ph ${s.heard ? "" : "gap"}` }, s.heard || "–")),
      el("span", { class: `op ${cls}` }, s.op === "match" ? "=" : s.op === "skip" ? "" : `+${s.cost}`),
      el("span", { class: cls }, el("span", { class: `ph ${s.word ? "" : "gap"}` }, s.word || "–")));
  }
  const reasons = [...new Set(d.steps.filter((s) => s.why && s.cost < 1).map((s) => `${s.heard || "∅"}→${s.word || "∅"}: ${s.why} (+${s.cost})`))];
  return el("div", { class: "align" }, title,
    el("div", { class: "phones", role: "img", "aria-label": `Phoneme alignment of ${c.heard} and ${c.matched}` }, ...cells),
    d.inside ? el("div", { class: "inside-note" }, "Found inside a longer word (words run together), score × 0.9") : null,
    reasons.length ? el("div", { class: "reasons" }, ...reasons.map((r) => el("span", { class: "reason" }, r))) : null);
}

function renderCards(x) {
  if (!x.cards.length) {
    const g = x.best_guesses.map((b) => `${b.intent} ${b.score.toFixed(2)}`).join(", ");
    $("cards").replaceChildren(el("p", { class: "hint" },
      `No request scored above t1 = ${x.thresholds.t1}. ${g ? `Best guesses: ${g}. ` : ""}The passenger sees the picture grid; after two misses the crew get a “please help” card with these guesses.`));
    return;
  }
  $("cards").replaceChildren(...x.cards.map((card, n) => {
    const top = card.candidates[0];
    const status = card.urgent ? ["Urgent", "bad"] : card.status === "close" ? ["Ask: two pictures", "amber"] : ["Confirm with one tap", "ok"];
    const rows = card.candidates.map((c, k) => el("div", { class: `cand ${k === 0 ? "top" : ""} ${c.urgent ? "urgent" : ""}` },
      el("span", { class: "cand-name" }, c.label, el("small", { lang: "ja" }, c.label_ja)),
      el("span", { class: "track" }, el("i", { style: `width:${pct(c.score)}` }),
        k === 0 ? el("span", { class: "mark", style: `left:${pct(x.thresholds.t1)}` }, el("span", {}, `t1 ${x.thresholds.t1}`)) : null,
        k === 0 && c.urgent ? el("span", { class: "mark urg", style: `left:${pct(x.thresholds.urgent)}` }, el("span", {}, "urgent")) : null),
      el("span", { class: "why" }, `${c.score.toFixed(2)} · “${c.heard}” ≈ “${c.matched}”`)));
    const margin = card.margin == null ? null : el("div", { class: "margin-note" },
      "Gap to second guess ", el("b", {}, card.margin.toFixed(2)),
      card.margin < x.thresholds.t2 ? ` < t2 ${x.thresholds.t2} → too close, ask the passenger` : ` ≥ t2 ${x.thresholds.t2} → clear winner`);
    return el("article", { class: `card ${card.urgent ? "urgent" : ""}` },
      el("div", { class: "card-head" }, el("h3", {}, `Card ${n + 1}: ${top.label}`),
        el("span", { class: "span" }, `from “${card.span}”`), el("span", { class: `pill ${status[1]}` }, status[0])),
      el("div", { class: "scale" }, ...rows),
      margin,
      top.detail ? alignment(top) : null,
      card.status === "close" && card.candidates[1]?.detail ? alignment(card.candidates[1]) : null);
  }));
}

function renderHistory() {
  $("history").replaceChildren(...history.map((h, i) => el("li", {},
    el("button", { class: i === current ? "on" : "", onclick: () => show(i), title: h.label }, `${h.source === "voice" ? "🎤 " : ""}${h.label}`))));
}

async function explainTyped(text) {
  const res = await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ text, phase: $("tryPhase").value }) });
  if (!res.ok) return;
  const body = await res.json();
  add({ x: body.explain, source: "typed", seat: null, label: text });
}

$("try").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("tryText").value.trim();
  if (text) explainTyped(text);
});
for (const b of document.querySelectorAll("#examples button")) {
  b.addEventListener("click", () => { $("tryText").value = b.textContent; explainTyped(b.textContent); });
}

connect("/ws/judge", (msg) => {
  if (msg.type !== "result" || !msg.explain) return;
  add({ x: msg.explain, source: msg.source, seat: msg.seat, label: msg.explain.nbest[0]?.text || "(silence)" });
}, (on) => {
  $("live").classList.toggle("on", on);
  $("live").lastElementChild.textContent = on ? "Live: listening to the cabin" : "Reconnecting…";
});

addEventListener("resize", () => { if (current >= 0) renderWave(history[current].x, history[current].source); });
