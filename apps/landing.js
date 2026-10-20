// Auralink landing page behaviour. Plain JS, no dependencies, so the page works on the offline hub.
document.documentElement.classList.add("js");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* nav background once the page scrolls */
const nav = $("#nav");
const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ---------------------------------------------------------------------------
   Hero aurora. Ported from the 21st.dev "Aurora voice Hero" (simplex-noise ribbons
   on a canvas) and given a meaning: ribbons are chaotic on the left (speech in a
   loud cabin) and settle into one calm line on the right (the request the crew get).
   The cursor stirs the noise, like a voice.
--------------------------------------------------------------------------- */
function makeSimplex() {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), perm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; perm12[i] = perm[i] % 12; }
  const g = [1,1, -1,1, 1,-1, -1,-1, 1,0, -1,0, 1,0, -1,0, 0,1, 0,-1, 0,1, 0,-1];
  return (x, y) => {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const corner = (tx, ty, gi) => {
      let tt = 0.5 - tx * tx - ty * ty;
      if (tt < 0) return 0;
      tt *= tt;
      return tt * tt * (g[gi * 2] * tx + g[gi * 2 + 1] * ty);
    };
    return 70 * (corner(x0, y0, perm12[ii + perm[jj]]) + corner(x1, y1, perm12[ii + i1 + perm[jj + j1]]) +
                 corner(x2, y2, perm12[ii + 1 + perm[jj + 1]]));
  };
}

function startAurora(canvas) {
  const ctx = canvas.getContext("2d");
  const noise = makeSimplex();
  const colors = ["#3ce8c8", "#5b8cff", "#a87cff", "#3ce8c8", "#7aa2ff"];
  const mouse = { x: -9999, y: -9999 };
  let w = 0, h = 0, t = 0, raf = 0, visible = true;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) draw();
  };
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const cy = h * (w < 960 ? 0.78 : 0.56);
    const amp = Math.min(h * 0.28, 220);
    colors.forEach((color, idx) => {
      ctx.beginPath();
      for (let x = 0; x <= w + 6; x += 6) {
        const u = x / w;
        const chaos = 1 - smooth(0.28, 0.84, u);              // noise fades out towards the right
        const d = Math.hypot(x - mouse.x, cy - mouse.y);
        const stir = 1 + (1 - Math.min(1, d / 380)) * 0.9;     // the cursor adds energy, like a voice
        const n = noise(x * 0.0024 * stir, idx * 11.3 + t);
        const pulse = Math.sin(t * 0.5 + idx) * 0.12 + 0.88;
        const y = cy + n * amp * (chaos * 0.96 + 0.04) * pulse * stir + (idx - 2) * 16 * chaos;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.18, color);
      grad.addColorStop(0.85, color);
      grad.addColorStop(1, "#ffd28a");
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.16; ctx.lineWidth = 7; ctx.stroke();   // soft glow
      ctx.globalAlpha = 0.85; ctx.lineWidth = 1.4; ctx.stroke(); // crisp line
    });
    // the delivered request: a warm call-light where the ribbons meet
    const r = ctx.createRadialGradient(w - 2, cy, 0, w - 2, cy, 90);
    r.addColorStop(0, "rgba(255,181,71,.55)");
    r.addColorStop(1, "rgba(255,181,71,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = r; ctx.fillRect(w - 92, cy - 92, 92, 184);
    ctx.globalCompositeOperation = "source-over";
  }

  const loop = () => { t += 0.0045; draw(); raf = requestAnimationFrame(loop); };
  const run = () => { cancelAnimationFrame(raf); if (!reduceMotion && visible && !document.hidden) loop(); };

  addEventListener("resize", resize);
  addEventListener("pointermove", (e) => { const b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; }, { passive: true });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(canvas);
  document.addEventListener("visibilitychange", run);
  resize();
  draw();
  run();
}
startAurora($("#aurora"));

/* rotating "understood" in six languages */
(() => {
  const words = $$(".rotor-word");
  if (reduceMotion || words.length < 2) return;
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    const cur = words[i], next = words[(i + 1) % words.length];
    cur.classList.replace("is-on", "is-off");
    next.classList.remove("is-off");
    next.classList.add("is-on");
    setTimeout(() => cur.classList.remove("is-off"), 750);
    i = (i + 1) % words.length;
  }, 2600);
})();

/* hero story: hear -> check -> deliver, on a loop with a pause button */
(() => {
  const stages = $$(".story .st"), steps = $$(".story-steps li"), btn = $("#storyToggle");
  let i = 0, timer = 0, playing = !reduceMotion;
  const show = (k) => {
    stages.forEach((s, j) => s.classList.toggle("is-on", j === k));
    steps.forEach((s, j) => s.classList.toggle("is-on", j <= k));
  };
  const tick = () => { i = (i + 1) % stages.length; show(i); timer = setTimeout(tick, i === 2 ? 4200 : 3400); };
  const setIcon = () => {
    btn.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
    btn.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
  };
  btn.addEventListener("click", () => {
    playing = !playing;
    clearTimeout(timer);
    if (playing) timer = setTimeout(tick, 1200);
    setIcon();
  });
  show(reduceMotion ? 2 : 0);   // reduced motion: show the outcome, still frame
  setIcon();
  if (playing) timer = setTimeout(tick, 3400);
})();

/* scroll reveals */
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
$$(".reveal").forEach((el, k) => { el.style.transitionDelay = `${(k % 4) * 70}ms`; revealer.observe(el); });

/* ---------------------------------------------------------------------------
   Try the real engine: POST /api/interpret on the hub.
--------------------------------------------------------------------------- */
(() => {
  const form = $("#tryForm"), input = $("#tryText"), out = $("#tryOut");
  const INTENTS = ["water", "tea", "blanket", "pillow", "toilet", "meal", "medical", "call_crew"];
  const LABELS = { water: "Water", tea: "Tea or coffee", blanket: "Blanket", pillow: "Pillow", toilet: "Toilet",
                   meal: "Food", medical: "I feel unwell", call_crew: "Call crew" };
  const RULES = {
    confident: ["Confident", "ok", "Clear. The passenger confirms it with one tap."],
    split: ["Two requests", "ok", "Two requests in one sentence, so each gets its own card."],
    close: ["Asks to check", "call", "Two meanings are close, so Auralink asks with big pictures instead of guessing."],
    flat: ["Not sure", "call", "Auralink could not tell, so instead of guessing it shows the picture grid."],
    empty: ["Nothing yet", "call", "Type what a passenger might say."],
  };
  let phase = "cruise", seq = 0, debounce = 0;

  const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function render(r, ms) {
    const [name, tone, text] = r.urgent
      ? ["Urgent", "bad", "Sounds like a medical problem, so it skips the queue."]
      : RULES[r.rule];
    const parts = [`<div class="verdict"><span class="pill ${tone}">${name}</span><span class="verdict-text">${text}</span>
      <span class="verdict-ms mono">matched in ${ms} ms</span></div>`];
    if (r.urgent) parts.push(`<div class="urgent-bar">${icon("alert")}Urgent: the crew are alerted now, while the passenger confirms.</div>`);
    if (r.cards.length) {
      parts.push(`<div class="cards">${r.cards.map((c) => {
        const top = c.candidates[0];
        const status = c.urgent ? `<span class="pill bad">Urgent</span>` : c.status === "close" ? `<span class="pill call">Check</span>` : `<span class="pill ok">Clear</span>`;
        return `<article class="rcard ${c.urgent ? "is-urgent" : ""}">
          <div class="rcard-head">${icon(top.intent)}<div><div class="rcard-title">${esc(top.label)}</div>
            <div class="rcard-ja" lang="ja">${esc(c.crew_ja)}</div></div>${status}</div>
          ${c.candidates.map((x, k) => `<div class="cand ${k === 0 ? "top" : ""}"><span>${esc(LABELS[x.intent] || x.intent)}</span>
            <span class="cand-bar"><i style="width:${Math.min(100, x.score * 100).toFixed(0)}%"></i></span>
            <span class="cand-score">${x.score.toFixed(2)}</span></div>`).join("")}
          <div class="rcard-why">heard “${esc(top.heard)}” ≈ “${esc(top.matched)}”</div>
        </article>`;
      }).join("")}</div>`);
    } else if (r.rule === "flat") {
      parts.push(`<div class="grid-fallback">${INTENTS.map((id) => `<span>${icon(id)}${LABELS[id]}</span>`).join("")}</div>`);
    }
    out.innerHTML = parts.join("");
  }

  async function run() {
    const text = input.value.trim();
    const mine = ++seq;
    if (!text) { render({ rule: "empty", cards: [], urgent: false }, 0); return; }
    const t0 = performance.now();
    try {
      const res = await fetch("/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({ text, phase, lang: "en" }) });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (mine === seq) render(data, (data.latency_ms?.match ?? performance.now() - t0).toFixed(1));
    } catch {
      if (mine === seq) out.innerHTML = `<p class="lab-offline">The live engine runs on the Auralink hub. Start it with
        <span class="mono">scripts/run.sh</span> and open this page from the hub to try it.</p>`;
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(run, 320); });
  $$(".lab-examples button").forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.try; run(); }));
  $$(".lab-phase button").forEach((b) => b.addEventListener("click", () => {
    phase = b.dataset.phase;
    $$(".lab-phase button").forEach((o) => o.setAttribute("aria-checked", String(o === b)));
    run();
  }));
  run();
})();

/* ---------------------------------------------------------------------------
   Safety heat map: seats confirm one by one; a few need the crew.
--------------------------------------------------------------------------- */
(() => {
  const map = $("#seatmap"), count = $("#seatCount");
  const letters = [..."ABCDEGHJK"], rows = [30, 31, 32, 33, 34, 35];
  const NEEDS_HELP = new Set(["32E", "34K"]), NO_ANSWER = new Set(["33A"]);
  const seats = [];
  for (const r of rows) {
    map.append(Object.assign(document.createElement("span"), { className: "row-n", textContent: r }));
    letters.forEach((l, k) => {
      if (k === 3 || k === 6) map.append(document.createElement("span"));
      const s = Object.assign(document.createElement("span"), { className: "seat", textContent: l, title: `${r}${l}` });
      s.dataset.id = `${r}${l}`;
      map.append(s);
      seats.push(s);
    });
  }
  let timers = [];
  const total = seats.length;
  function play() {
    timers.forEach(clearTimeout);
    timers = [];
    seats.forEach((s) => s.className = "seat");
    let ok = 0;
    count.textContent = `0 / ${total} understood`;
    const order = [...seats].sort(() => Math.random() - 0.5);
    order.forEach((s, k) => {
      const id = s.dataset.id;
      if (NO_ANSWER.has(id)) return;
      const finish = () => {
        s.classList.add(NEEDS_HELP.has(id) ? "bad" : "ok");
        if (!NEEDS_HELP.has(id)) count.textContent = `${++ok} / ${total} understood`;
      };
      if (reduceMotion) return finish();
      timers.push(setTimeout(() => { finish(); s.classList.add("pop"); setTimeout(() => s.classList.remove("pop"), 300); }, 300 + k * 70));
    });
  }
  let started = false;
  new IntersectionObserver(([e]) => { if (e.isIntersecting && !started) { started = true; play(); } }, { threshold: 0.4 }).observe(map);
  $("#seatReplay").addEventListener("click", play);
})();

/* count-up numbers */
(() => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target, end = parseFloat(el.dataset.count), dec = (el.dataset.count.split(".")[1] || "").length;
      const pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
      if (reduceMotion) continue;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1200), v = end * (1 - Math.pow(1 - k, 3));
        el.textContent = `${pre}${v.toFixed(dec)}${suf}`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => io.observe(el));
})();

/* hub status for the launch section */
(async () => {
  const box = $("#hubStatus");
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error();
    const cfg = await res.json();
    box.classList.add("on");
    box.lastElementChild.textContent = `Hub online · ${cfg.seats.length} seats · ${cfg.intents.length} request types`;
  } catch {
    box.classList.add("off");
    box.lastElementChild.textContent = "Hub offline. Run scripts/run.sh to use the live screens.";
  }
})();
