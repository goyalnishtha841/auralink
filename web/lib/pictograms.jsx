"use client";
// Safety pictograms: one consistent line style (96x96, round caps). The amber stroke (.acc) marks
// the one thing to do or notice. Inline SVG so they work offline and scale on any screen.
// Drafts for the prototype: a real deployment would use the airline's approved safety-card artwork.

const wrap = (body, label) =>
  `<svg viewBox="0 0 96 96" role="img" aria-label="${label}" class="picto" xmlns="http://www.w3.org/2000/svg">` +
  `<g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

const seat = `<path d="M26 18 L30 66 H68"/><path d="M40 66 V80 M62 66 V80"/>`;
const sitter = `<circle cx="42" cy="24" r="7"/><path d="M42 32 L40 56 H58 L60 74"/><path d="M41 38 L56 48"/>`;
const arrowHead = (x, y, dir) => ({
  down: `<path class="acc" d="M${x - 6} ${y - 6} L${x} ${y} L${x + 6} ${y - 6}"/>`,
  up: `<path class="acc" d="M${x - 6} ${y + 6} L${x} ${y} L${x + 6} ${y + 6}"/>`,
  right: `<path class="acc" d="M${x - 6} ${y - 6} L${x} ${y} L${x - 6} ${y + 6}"/>`,
  left: `<path class="acc" d="M${x + 6} ${y - 6} L${x} ${y} L${x + 6} ${y + 6}"/>`,
}[dir]);

export const PICTOGRAMS = {
  return_seat: wrap(
    `${seat}<path class="acc" d="M86 14 C70 14 58 24 54 44"/>${arrowHead(54, 46, "down")}
     <circle cx="80" cy="30" r="0"/>`, "Return to your seat"),

  seatbelt: wrap(
    `${seat}${sitter}<path class="acc" d="M30 58 H66"/><rect class="acc" x="42" y="53" width="11" height="10" rx="2"/>`,
    "Fasten your seatbelt"),

  toilet_closed: wrap(
    `<rect x="18" y="12" width="44" height="72" rx="3"/><circle cx="40" cy="30" r="6"/><path d="M40 37 V60 M31 44 H49 M40 60 L33 74 M40 60 L47 74"/>
     <circle class="acc" cx="70" cy="66" r="15"/><path class="acc" d="M59 77 L81 55"/>`, "Toilets closed"),

  upright: wrap(
    `<path d="M14 24 L30 66" stroke-dasharray="4 6" opacity=".55"/><path d="M34 16 L36 66 H72"/><path d="M48 66 V80 M66 66 V80"/>
     <path class="acc" d="M18 40 C22 26 28 20 34 18"/>${arrowHead(34, 18, "right")}
     <path d="M48 42 H66 V50 H48" opacity=".9"/>`, "Seat upright, tray table folded"),

  window_shade: wrap(
    `<rect x="22" y="12" width="44" height="66" rx="20"/><path d="M28 34 H60" /><path d="M30 24 H58" opacity=".5"/>
     <path class="acc" d="M80 70 V26"/>${arrowHead(80, 24, "up")}`, "Open the window shade"),

  mask_drop: wrap(
    `<path d="M10 14 H86"/><path d="M34 14 V22 H62 V14"/><path d="M48 22 C48 34 44 38 44 46"/>
     <path class="acc" d="M34 52 Q44 70 54 52 Z"/><path d="M28 58 L20 50 M68 58 L76 50" opacity=".6"/>
     <path d="M16 70 V86 M80 70 V86" opacity=".4"/>`, "Oxygen mask drops from above"),

  mask_on: wrap(
    `<path d="M58 16 C38 12 24 24 24 44 C24 58 30 66 38 70 V84"/><path d="M58 16 C66 22 70 30 70 38 L76 48 L70 52"/>
     <path class="acc" d="M62 50 Q76 52 76 62 Q72 74 60 70 Z"/><path class="acc" d="M62 54 L34 40"/>
     <path d="M70 64 C78 72 80 80 80 88" opacity=".6"/>`, "Mask over nose and mouth"),

  self_first: wrap(
    `<circle cx="28" cy="30" r="12"/><path class="acc" d="M30 38 Q40 40 38 48 Q32 52 26 46 Z"/><path d="M28 44 V76 M16 54 H40"/>
     <text x="24" y="14" font-family="sans-serif" font-size="13" fill="currentColor" stroke="none">1</text>
     <circle cx="70" cy="46" r="9"/><path d="M70 55 V78 M61 62 H79"/>
     <text x="66" y="30" font-family="sans-serif" font-size="13" fill="currentColor" stroke="none">2</text>
     <path class="acc" d="M44 30 C52 22 60 24 62 32"/>${arrowHead(62, 34, "down")}`, "Your mask first, then help others"),

  exit_door: wrap(
    `<rect x="12" y="10" width="42" height="76" rx="6"/><path d="M44 46 H48"/><path d="M22 22 H44 V40 H22 Z" opacity=".6"/>
     <circle cx="70" cy="28" r="6"/><path d="M70 35 L66 56 L58 74 M66 56 L76 72 M68 42 L80 50 M68 42 L58 46"/>
     <path class="acc" d="M60 84 H88"/>${arrowHead(88, 84, "right")}`, "Open the exit door and step out"),

  help_others: wrap(
    `<circle cx="28" cy="22" r="7"/><path d="M28 30 V56 L20 76 M28 56 L36 76"/><path class="acc" d="M28 38 L50 46"/>
     <circle cx="64" cy="34" r="7"/><path d="M64 42 L60 62 L50 78 M60 62 L68 78"/><path d="M62 48 L52 46"/>
     <path d="M78 52 L88 52" opacity=".5"/>`, "Help other passengers"),

  listen_crew: wrap(
    `<path d="M20 22 H40"/><path d="M22 22 L24 16 H36 L38 22"/><circle cx="30" cy="30" r="7"/><path d="M30 38 V64 L22 84 M30 64 L38 84 M30 46 L42 40"/>
     <path class="acc" d="M50 18 H84 Q88 18 88 22 V40 Q88 44 84 44 H62 L54 52 V44 H50 Q46 44 46 40 V22 Q46 18 50 18 Z"/>
     <path class="acc" d="M67 24 V33"/><circle class="acc" cx="67" cy="38.5" r=".6"/>`, "Listen to the crew"),
};

export function pictogram(id) {
  return PICTOGRAMS[id] || wrap(`<circle cx="48" cy="48" r="30"/>`, id);
}

export function Picto({ id, big = false }) {
  const box = <div className="picto-box" dangerouslySetInnerHTML={{ __html: pictogram(id) }} />;
  return big ? <div className="picto-big">{box}</div> : box;
}
