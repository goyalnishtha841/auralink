// Talking to the Auralink hub (FastAPI). Same protocol as the original apps/common.js.
"use client";

export async function loadConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

// Crew screens get 401 or a socket close 4401 without the PIN cookie: ask once (PinDialog listens).
export function askCrewPin() {
  window.dispatchEvent(new Event("auralink:pin"));
}

// WebSocket that reconnects on its own; onStatus gets true/false for the connection dot.
export function connect(path, onMessage, onStatus = () => {}) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws;
  let queue = [];
  let closed = false;
  const open = () => {
    ws = new WebSocket(`${proto}://${location.host}${path}`);
    ws.onopen = () => { onStatus(true); queue.forEach((m) => ws.send(m)); queue = []; };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      onStatus(false);
      if (closed) return;
      if (e.code === 4401) askCrewPin(); else setTimeout(open, 1000);
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
    close() { closed = true; ws.close(); },
  };
}

// fetch for crew-only routes: shows the PIN prompt on 401.
export async function crewFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) { askCrewPin(); throw new Error("乗務員PINが必要です / Crew PIN required"); }
  return res;
}

export async function postJson(url, body, { crew = false } = {}) {
  const f = crew ? crewFetch : fetch;
  const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Error ${res.status}`);
  return data;
}

// Tap-to-talk recorder. Resolves to 16 kHz mono int16 PCM, the format the hub expects.
export class Recorder {
  static supported() {
    return typeof window !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
  }

  async start(maxSeconds = 8, onAutoStop = () => {}, onLevel = null) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(d);
      if (onLevel) {
        let s = 0;
        for (let i = 0; i < d.length; i += 8) s += d[i] * d[i];
        onLevel(Math.min(1, Math.sqrt(s / (d.length / 8)) * 6));
      }
    };
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
    const from = Math.floor(i * ratio), to = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

export function toBase64(buffer) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",", 2)[1]);
    reader.readAsDataURL(new Blob([buffer]));
  });
}

export function params() {
  return new URLSearchParams(typeof location === "undefined" ? "" : location.search);
}
