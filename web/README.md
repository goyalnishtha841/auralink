# Auralink web (Next.js + React)

The screens in a matte-black design (white type, coral `#FF5B5B` accents, soft Framer Motion animation).
Headings Plus Jakarta Sans, body Inter, labels IBM Plex Mono, Indian and Thai scripts Noto Sans: every
font is bundled, so the UI still works with no internet.

`npm run build` writes a **static export** to `web/out/`. The FastAPI hub serves that folder instead of
`apps/` whenever it exists, at the **same URLs** (`/passenger.html?seat=34K`, `/crew.html`, `/judge.html` …),
so seat QR codes, tests and scripts keep working. No Node server runs during the demo.

`web/out/` is committed on purpose: the demo laptop does not need Node installed.

## Edit and rebuild

```bash
cd web
npm install          # once
npm run build        # rebuild web/out; then just reload the browser (no hub restart needed)
```

Use the original plain-HTML screens instead: `AURALINK_UI=classic scripts/run.sh`.

## Layout

| Path | What |
|---|---|
| `app/page.jsx` + `landing.css` | Landing page: Mount Fuji window hero, sound ribbons, falling petals, live engine box |
| `app/passenger/` | Passenger seat screen (voice, text, pictures, confirm sheets, safety, exit row, PA captions) |
| `app/crew/` | Crew tablet (requests, urgent alarm, safety heat map, PA captions, care round, phrasebook) |
| `app/judge/` | Under the hood (pipeline timing, n-best, tokens, scores, phoneme alignment) |
| `app/{start,presenter,checkin,seats,noise,record,report,phone-setup}/` | Demo tools |
| `lib/hub.js` | WebSocket, crew PIN, recorder (16 kHz PCM) – same protocol as `apps/common.js` |
| `lib/icons.jsx`, `lib/pictograms.jsx`, `lib/speech.js` | Icons, safety pictograms, offline read-aloud |
| `components/ui.jsx` | Header, sheet, reveal-on-scroll, PIN dialog |
| `public/hero.jpg` | Hero artwork |
