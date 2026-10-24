"use client";
import "../tools.css";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { crewFetch, loadConfig } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { Ambient, AppHeader, ease } from "@/components/ui";

const OUTCOMES = [
  ["first_try", "Understood first try", "var(--ok)"], ["picked_from_two", "Picked from two pictures", "#ffffff"], ["via_grid", "Picked from the picture grid", "#ff9a8a"],
  ["picture", "Tapped a picture", "var(--violet)"], ["needs_human", "Crew helped in person", "var(--warn)"], ["urgent_unconfirmed", "Urgent, not confirmed", "var(--bad)"], ["unanswered", "Passenger did not answer", "var(--idle)"],
];
const SAFETY = [["understood", "Understood", "var(--ok)"], ["understood_again", "After explaining again", "#2fb37f"], ["reexplaining", "Being re-explained", "var(--violet)"], ["stuck", "Needed a crew visit", "var(--bad)"], ["no_answer", "No answer", "var(--idle)"]];
const secs = (s) => (s == null ? "–" : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);

function Stack({ parts, total }) {
  const on = parts.filter(([, , , v]) => v);
  return (<div className="rp-stack" role="img" aria-label={on.map(([, l, , v]) => `${l} ${v}`).join(", ") || "none"}>
    {on.map(([k, label, color, v]) => <motion.i key={k} initial={{ width: 0 }} animate={{ width: `${(v / total) * 100}%` }} transition={{ duration: 0.9, ease }} style={{ background: color }} title={`${label}: ${v}`} />)}</div>);
}
const Legend = ({ parts }) => <div className="rp-legend">{parts.filter(([, , , v]) => v).map(([k, label, color, v]) => <span key={k}><i className="rp-sw" style={{ background: color }} />{label}: {v}</span>)}</div>;

export default function Report() {
  const [cfg, setCfg] = useState(null);
  const [r, setR] = useState(null);
  const load = () => crewFetch("/api/report").then((x) => x.json()).then(setR).catch(() => {});
  useEffect(() => { loadConfig().then(setCfg); load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);
  if (!cfg || !r) return <><Ambient /><AppHeader online={false} title="フライトレポート" sub="Flight report" /></>;
  const LABEL = Object.fromEntries(cfg.intents.map((i) => [i.id, i.label.en]));
  const LANG = Object.fromEntries(cfg.languages.map((l) => [l.code, l.name]));
  const q = r.requests;
  const answered = r.briefings.reduce((n, b) => n + b.understood + b.understood_again + b.reexplaining + b.stuck, 0);
  const understood = r.briefings.reduce((n, b) => n + b.understood + b.understood_again, 0);
  const kpis = [
    ["Requests", String(q.total), `${q.outcomes.first_try} understood first try`],
    ["Median time to acknowledge", secs(q.time_to_acknowledge_s.median), q.time_to_acknowledge_s.n ? `slowest ${secs(q.time_to_acknowledge_s.max)}` : "none acknowledged yet"],
    ["Recovery rate", pct(q.recovery.rate), q.recovery.unclear ? `${q.recovery.resolved_by_passenger} of ${q.recovery.unclear} unclear requests solved by the passenger` : "no unclear requests yet"],
    ["Urgent requests", String(q.urgent.count), q.urgent.time_to_acknowledge_s.n ? `acknowledged in ${secs(q.urgent.time_to_acknowledge_s.median)} (median)` : "none acknowledged"],
    ["Safety understood", answered ? pct(understood / answered) : "–", `${understood} of ${answered} passengers who answered`],
    ["Exit row passed", r.exit_row.pass + r.exit_row.talk ? `${r.exit_row.pass}/${r.exit_row.pass + r.exit_row.talk}` : "–", r.exit_row.checked ? `${r.exit_row.talk} need a talk · ${r.exit_row.pending} no answer or no phone` : "no check run"],
  ];
  const parts = OUTCOMES.map(([k, l, c]) => [k, l, c, q.outcomes[k] || 0]);
  const SRC = { voice: "Spoke", text: "Typed", picture: "Tapped a picture" };
  const types = Object.entries(q.by_intent).sort((a, b) => b[1] - a[1]);
  const most = Math.max(1, ...types.map(([, v]) => v));
  const e = r.exit_row, p = r.announcements, c = r.care_rounds;
  return (
    <>
      <Ambient />
      <AppHeader online title="フライトレポート" sub="Flight report">
        <span className="muted">Updated {new Date(r.generated_at * 1000).toLocaleTimeString()}</span>
        <button onClick={load}>Refresh</button>
        <a href="/api/report.csv"><button className="primary">Download CSV</button></a>
      </AppHeader>
      <main className="app">
        <p className="muted" style={{ margin: 0 }}>Everything since the last cabin reset. Times are from the passenger's request to the crew's tap.</p>
        <section className="kpis">{kpis.map(([l, v, n], k) => (
          <motion.div key={l} className="kpi" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06, ease }}><span>{l}</span><b>{v}</b>{n ? <small>{n}</small> : null}</motion.div>))}</section>
        <div className="rp-grid2">
          <section className="panel"><h2>リクエストの結果 · How requests were resolved</h2>
            <Stack parts={parts} total={Math.max(1, q.total)} />{q.total ? <Legend parts={parts} /> : <span className="muted">No requests yet.</span>}
            <h2>伝え方 · How passengers asked</h2><div className="chips">{Object.entries(q.by_source).map(([k, v]) => <span key={k} className="chip2">{SRC[k] || k}: {v}</span>)}</div>
            <h2>言語 · Languages</h2><div className="chips">{Object.entries(q.by_language).map(([k, v]) => <span key={k} className="chip2">{LANG[k] || k}: {v}</span>)}</div>
          </section>
          <section className="panel"><h2>リクエストの種類 · Request types</h2>
            <table className="rp"><thead><tr><th>Type</th><th style={{ width: "45%" }} /><th>Count</th></tr></thead>
              <tbody>{types.length ? types.map(([k, v]) => <tr key={k}><td><span className="rp-type"><Icon id={k} />{LABEL[k] || k}</span></td>
                <td><motion.div className="rp-bar" initial={{ width: 0 }} animate={{ width: `${(v / most) * 100}%` }} transition={{ duration: 0.8, ease }} /></td><td className="n">{v}</td></tr>)
                : <tr><td colSpan={3} className="muted">No requests yet.</td></tr>}</tbody></table>
          </section>
        </div>
        <div className="rp-grid2">
          <section className="panel"><h2>安全案内の理解度 · Safety briefings</h2>
            {r.briefings.length ? r.briefings.map((b, k) => { const bp = SAFETY.map(([kk, l, col]) => [kk, l, col, b[kk] || 0]); return (
              <div key={k} className="rp-brief"><strong>{b.title_ja} · {b.title_en}</strong><Stack parts={bp} total={Math.max(1, bp.reduce((n, [, , , v]) => n + v, 0))} /><Legend parts={bp} />
                {b.stuck_by_step.map((x) => <span key={x.step} className="muted">Step {x.step} (“{x.en}”): {x.seats} seat{x.seats > 1 ? "s" : ""} needed a visit</span>)}</div>); })
              : <p className="muted" style={{ margin: 0 }}>No briefing sent yet.</p>}
          </section>
          <section className="panel"><h2>非常口座席 · Exit row</h2>
            {e.checked ? (<><div className="chips"><span className="chip2">Passed: {e.pass}</span><span className="chip2">Need a talk: {e.talk}</span><span className="chip2">No answer: {e.pending}</span></div>
              {e.talk_seats.map((x) => <p key={x.seat} style={{ margin: 0 }}><strong>{x.seat}</strong> · {x.reseat ? "asked for another seat" : `answered No to: ${x.no_to.map((y) => y.replace("_", " ")).join(", ")}`}</p>)}</>)
              : <p className="muted" style={{ margin: 0 }}>No exit-row check run yet.</p>}
          </section>
        </div>
        <div className="rp-grid2">
          <section className="panel"><h2>機内アナウンス字幕 · PA captions</h2>
            {p.count ? (<><div className="chips"><span className="chip2">Captions sent: {p.count}</span><span className="chip2">Languages: {p.languages.map((x) => LANG[x] || x).join(", ") || "–"}</span></div>
              <table className="rp"><thead><tr><th>Time</th><th>Announcement</th><th>Seats</th></tr></thead><tbody>{p.items.map((a, k) => (
                <tr key={k}><td>{new Date(a.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td><td>{a.title_ja} · {a.title_en}{a.n ? ` (${a.n})` : ""}</td><td className="n">{a.seats == null ? "–" : a.seats}</td></tr>))}</tbody></table></>)
              : <p className="muted" style={{ margin: 0 }}>No announcement captioned yet.</p>}
          </section>
          <section className="panel"><h2>ケアラウンド · Care rounds</h2>
            {c.count ? (<><div className="chips"><span className="chip2">Rounds: {c.count}{c.in_progress ? " (one in progress)" : ""}</span><span className="chip2">Requests delivered: {c.requests_delivered}</span>
              <span className="chip2">Check-in visits: {c.check_ins_done} of {c.check_ins}</span><span className="chip2">Median round: {c.minutes.n ? `${c.minutes.median} min` : "–"}</span></div>
              <p style={{ margin: 0 }}>{c.walk_rows.saved == null ? "No deliveries yet." : `About ${Math.round(c.walk_rows.saved * 100)}% less walking than one trip per request (${c.walk_rows.rounds} rows walked instead of ${c.walk_rows.separate}; an estimate from seat rows).`}</p></>)
              : <p className="muted" style={{ margin: 0 }}>No care round started yet.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
