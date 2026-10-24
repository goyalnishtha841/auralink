"use client";
import "../tools.css";
import { useEffect, useRef, useState } from "react";
import { Ambient, AppHeader } from "@/components/ui";

// Cabin-like noise: deep low-passed brown noise (engines, airflow rumble) + quieter pink-ish hiss
function makeNoise(ctx, seconds = 6) {
  const n = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let brown = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = brown * 3.2 + (b0 + b1 + b2 + w * 0.1848) * 0.05 * 0.35;
    }
    for (let i = 0; i < 2000; i++) { d[i] *= i / 2000; d[n - 1 - i] *= i / 2000; }
  }
  return buf;
}
const PRESETS = [["0.25", "Quiet cabin"], ["0.55", "Cruise"], ["0.9", "Loud"]];

export default function Noise() {
  const [playing, setPlaying] = useState(false);
  const [vol, setVol] = useState(0.55);
  const [db, setDb] = useState(null);
  const [note, setNote] = useState("Generated noise is used until you load a file. The file stays on this laptop.");
  const a = useRef({ ctx: null, out: null, src: null, analyser: null, file: null, raf: 0 });
  const bars = useRef(null);

  function start() {
    const x = a.current;
    x.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    x.out = x.ctx.createGain(); x.out.gain.value = vol;
    x.analyser = x.ctx.createAnalyser(); x.analyser.fftSize = 2048;
    x.src = x.ctx.createBufferSource(); x.src.buffer = x.file || makeNoise(x.ctx); x.src.loop = true;
    let node = x.src;
    if (!x.file) { const lp = x.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; node.connect(lp); node = lp; }
    node.connect(x.out); x.out.connect(x.analyser); x.analyser.connect(x.ctx.destination);
    x.src.start(); setPlaying(true); meter();
  }
  function stop() { a.current.src?.stop(); cancelAnimationFrame(a.current.raf); setPlaying(false); setDb(null); }
  function meter() {
    const x = a.current;
    const data = new Float32Array(x.analyser.fftSize);
    x.analyser.getFloatTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
    setDb(20 * Math.log10(Math.max(rms, 1e-6)));
    const f = new Uint8Array(x.analyser.frequencyBinCount); x.analyser.getByteFrequencyData(f);
    if (bars.current) [...bars.current.children].forEach((el, i) => { el.style.height = `${Math.max(4, (f[i * 6] / 255) * 100)}%`; });
    x.raf = requestAnimationFrame(meter);
  }
  useEffect(() => () => stop(), []); // eslint-disable-line
  const setGain = (v) => { setVol(v); if (a.current.out) a.current.out.gain.value = v; };

  return (
    <>
      <Ambient />
      <AppHeader online={playing} title="Cabin noise" sub={'for the "works in noise" demo'} />
      <main className="app" style={{ maxWidth: 740 }}>
        <section className="panel">
          <button className="primary n-big" onClick={() => (playing ? stop() : start())}>{playing ? "■ Stop" : "▶ Play cabin noise"}</button>
          <div className="n-bars" ref={bars} aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ height: "4%" }} />)}</div>
          <div className="n-presets" role="group" aria-label="Noise level">{PRESETS.map(([g, l]) => <button key={g} aria-pressed={String(vol) === g} onClick={() => setGain(Number(g))}>{l}</button>)}</div>
          <label className="muted" htmlFor="vol">Volume</label>
          <input type="range" id="vol" min="0" max="1" step="0.01" value={vol} onChange={(e) => setGain(Number(e.target.value))} />
          <div className="n-meter" aria-hidden="true"><i style={{ width: db == null ? 0 : `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%` }} /></div>
          <div className="n-readout"><span>{db == null ? "–" : `${db.toFixed(1)} dBFS`}</span><span>output level of this page (dBFS)</span></div>
        </section>
        <section className="panel"><h2>Use a real cabin recording instead</h2>
          <input type="file" accept="audio/*" onChange={async (e) => {
            const f = e.target.files[0]; if (!f) return;
            const x = a.current; x.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
            try { x.file = await x.ctx.decodeAudioData(await f.arrayBuffer()); setNote(`Using ${f.name} (${x.file.duration.toFixed(1)} s, looped).`); if (playing) { stop(); start(); } }
            catch { setNote("That file could not be read as audio. Try an mp3, m4a or wav."); }
          }} />
          <p className="muted" style={{ margin: 0 }}>{note}</p></section>
        <section className="panel"><h2>How to run the noise demo</h2>
          <ol className="t-ol">
            <li>Play this page through a speaker next to the passenger phone.</li>
            <li>Measure the level where the phone is with any sound-meter app, and show the number to the jury. Real cabins are often quoted at roughly 75–85 dB(A) in cruise; treat that as a guide, not a measurement.</li>
            <li>Speak the request on the passenger screen. Show the result on Under the hood: the silence filter, the guesses, and the match despite the noise.</li>
          </ol></section>
      </main>
    </>
  );
}
