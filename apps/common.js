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
    ws.onclose = () => { onStatus(false); setTimeout(open, 1000); };
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
