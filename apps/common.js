// Shared helpers for all Auralink screens.

export async function loadConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

// WebSocket that reconnects on its own; onStatus gets true/false for the connection dot.
export function connect(path, onMessage, onStatus = () => {}) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws;
  let queue = [];
  const open = () => {
    ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.onopen = () => { onStatus(true); queue.forEach((m) => ws.send(m)); queue = []; };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      onStatus(false);
      if (e.code === 4401) askCrewPin(); else setTimeout(open, 1000);   // crew screens: PIN first
    };
  };
  open();
  return {
    send(msg) {
      const raw = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(raw); else queue.push(raw);
    },
    sendBinary(buffer) {
      if (ws.readyState === WebSocket.OPEN) ws.send(buffer); else queue.push(buffer);
    },
  };
}

// Crew PIN (hub/auth.py). Crew screens get 401 or a socket close 4401 without it: ask once, then reload.
export function askCrewPin() {
  if (document.getElementById("crew-pin")) return;
  const box = document.createElement("div");
  box.id = "crew-pin";
  box.style.cssText = "position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;" +
    "background:rgba(6,9,21,.82);backdrop-filter:blur(6px)";
  box.innerHTML = `
    <form role="dialog" aria-modal="true" aria-labelledby="crew-pin-title" style="background:var(--surface,#0f1630);
        color:var(--fg,#edf2ff);border:1px solid var(--line,rgba(150,175,255,.16));border-radius:16px;padding:20px;
        width:min(340px,100%);display:flex;flex-direction:column;gap:12px">
      <h2 id="crew-pin-title" style="margin:0;font-size:18px">乗務員PIN<br><small style="font-weight:500;color:var(--muted,#a3afcf)">Crew PIN</small></h2>
      <input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="32" required
        aria-label="乗務員PIN / Crew PIN" style="font:600 24px system-ui;letter-spacing:.3em;text-align:center;padding:10px;
        border-radius:10px;border:1px solid var(--line,#334);background:var(--bg,#060915);color:inherit">
      <p class="crew-pin-err" role="alert" style="margin:0;min-height:1.5em;color:var(--bad,#ff6b6b)"></p>
      <button class="primary" type="submit">入る / Enter</button>
    </form>`;
  document.body.append(box);
  const form = box.querySelector("form"), err = box.querySelector(".crew-pin-err");
  form.pin.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch("/api/crew/login", { method: "POST", headers: { "Content-Type": "application/json" },
                                                 body: JSON.stringify({ pin: form.pin.value }) });
    if (res.ok) { location.reload(); return; }
    err.textContent = (await res.json().catch(() => ({}))).detail || "PINが違います / Wrong PIN";
    form.pin.select();
  };
}

// fetch for crew-only routes: shows the PIN prompt on 401.
export async function crewFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) { askCrewPin(); throw new Error("乗務員PINが必要です / Crew PIN required"); }
  return res;
}

// Tap-to-talk recorder. Resolves to 16 kHz mono int16 PCM, the format the hub expects.
// Uses the browser's own noise suppression, which helps a lot in a loud cabin.
export class Recorder {
  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
  }

  async start(maxSeconds = 8, onAutoStop = () => {}) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but works everywhere, including older iOS Safari.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    this.timer = setTimeout(onAutoStop, maxSeconds * 1000);
  }

  async stop() {
    clearTimeout(this.timer);
    this.node.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    const rate = this.ctx.sampleRate;
    await this.ctx.close();
    return toPcm16(this.chunks, rate);
  }
}

function toPcm16(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { input.set(c, offset); offset += c.length; }
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    // average the source samples that fall into this output sample (cheap low-pass)
    const from = Math.floor(i * ratio), to = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}
