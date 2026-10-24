"use client";
// Shared bubble-thread renderer for Live Conversation (passenger and crew screens send/receive
// the same {type:"conv_message"} stream — see hub/main.py handle_conv_text). Unreviewed, like
// Free Talk: every bubble shows the machine-translated text, growing token by token while
// `done` is false, never used for safety content.
import { useEffect, useRef } from "react";
import { Icon } from "@/lib/icons";

export function ConvThread({ messages, mineFrom, partial = "" }) {
  const end = useRef(null);
  const last = messages[messages.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.translated, last?.done, partial]);

  if (!messages.length && !partial) return <p className="conv-empty">…</p>;
  return (
    <div className="conv-thread">
      {messages.map((m) => (
        <div key={m.id} className={`conv-bubble speaker-${m.from} ${m.from === mineFrom ? "mine" : "theirs"}`}>
          <span className="conv-speaker">{m.from === "crew" ? "乗務員 · Crew" : "乗客 · Passenger"}</span>
          {m.from === mineFrom ? <p className="conv-original">{m.original}</p> : null}
          <p className="conv-text">{m.translated || "…"}{!m.done ? <span className="conv-typing"> ●●●</span> : null}</p>
        </div>
      ))}
      {partial ? (
        <div className={`conv-bubble speaker-${mineFrom} mine draft`}>
          <span className="conv-speaker">{mineFrom === "crew" ? "乗務員 · Crew" : "乗客 · Passenger"}</span>
          <p className="conv-original">{partial}<span className="conv-typing"> ●●●</span></p>
        </div>
      ) : null}
      <div ref={end} />
    </div>
  );
}

export function ConvToggle({ on, onClick, label }) {
  return (
    <button type="button" className={`conv-toggle ${on ? "on" : ""}`} onClick={onClick}>
      <Icon id={on ? "stop" : "chat"} />{label}
    </button>
  );
}

export function MuteButton({ muted, onClick, label }) {
  return (
    <button type="button" className="hdr-icon-btn" onClick={onClick} aria-pressed={muted} aria-label={label} title={label}>
      <Icon id={muted ? "mute" : "speaker"} />
    </button>
  );
}
