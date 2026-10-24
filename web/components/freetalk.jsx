"use client";
// Free Talk: open-vocabulary translation for anything outside the fixed intent list. Unlike the
// rest of Auralink, this is machine-translated and not reviewed, so every result says so and it
// is never wired into safety briefings, exit-row checks or PA captions.
import { useState } from "react";
import { postJson } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { speakNatural as trySpeak } from "@/lib/speech";

export function FreeTalkPanel({ fromLang, toLang, fromLabel, toLabel, langPicker = null }) {
  const [text, setText] = useState("");
  const [translated, setTranslated] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true); setError(""); setTranslated("");
    try {
      const data = await postJson("/api/freetalk/translate", { text: value, src: fromLang, tgt: toLang });
      setTranslated(data.translated);
      trySpeak(data.translated, toLang);
    } catch (err) {
      setError(err.message || "Free Talk is not ready on this hub yet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="row">
        <span className="panel-title grow"><Icon id="globe" /> Free Talk <span className="pill dim" style={{ fontWeight: 400, textTransform: "none" }}>unreviewed translation</span></span>
        {langPicker}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        For anything the picture list doesn&apos;t cover. Machine-translated, not checked by a person —
        never used for safety instructions.
      </p>
      <form className="row" onSubmit={go}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`Type in ${fromLabel}…`} autoComplete="off" />
        <button className="primary" type="submit" disabled={busy}>{busy ? "…" : "Translate"}</button>
      </form>
      {translated ? (
        <div className="item">
          <Icon id="chat" /><strong>{toLabel}</strong>
          <span className="grow">{translated}</span>
          <button className="listen" aria-label="Play" title="Play" onClick={() => trySpeak(translated, toLang)}>
            <Icon id="speaker" />
          </button>
        </div>
      ) : null}
      {error ? <p className="muted" style={{ color: "var(--bad)", margin: 0, fontSize: 13 }}>{error}</p> : null}
    </section>
  );
}
