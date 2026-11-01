# Campus Manhunt · Shiv Nadar University Chennai

A campus Manhunt (hide-and-chase) game as an installable PWA, made for students of Shiv Nadar University Chennai at Kalavakkam. Static files, no accounts, no personal data. An optional small sync server (`server/`) adds a live scoreboard; without it the app runs entirely on the phones.

Live: https://sheriffabdullah.github.io/manhunt-snuc/

One university, one campus: from the 2026-27 academic year SSN College of Engineering became the SSN School of Engineering within Shiv Nadar University Chennai, so the app simply says "Shiv Nadar University Chennai". The wordmark is typographic; no official logos or trademarks are used. This is a student project, not an official university app.

## How it works

- A host creates a game in three steps: map, start time (head start + hunt length), options (hard stop time for curfew, "caught runners become hunters").
- The game config is encoded in the share URL (`#g=...`). The lobby shows a **runner link** and a **hunter link**, each with a QR code generated on the phone (no external service).
- Every phone computes the same clock from the same start time, so nothing needs a server. Phones must have automatic time on (with the sync server, the server's clock corrects a phone that is off).
- Players get a random codename (e.g. "Cobalt Moth") stored only on their device.
- Runners show a tag code (`COBALT MOTH · 4821`). A hunter picks the two codename words and types the 4 digits; the hunter's phone verifies the code offline (2 random digits + 2 check digits bound to the game and codename) before logging the catch. Runners press "I've been tagged" to go out.
- During the game: the screen stays awake (Wake Lock where supported), phase changes vibrate and beep, an SOS sheet shows the security number and a "STOP" broadcast message, and the optional on-device map warns when you leave the play area or enter a no-go zone (only on a good GPS fix held for a few seconds; a weak fix says "Weak GPS" instead of raising a false alarm).
- Low battery (where the Battery API exists) offers a **low-power mode**: slower scoreboard updates, no animations, location off. It can also be switched on by hand from the battery chip.
- End states are explicit and shareable: **Hunters win** (every runner caught), **Runners win** (time up or hard stop with runners still free), **Game ended** (host ended it, neutral). Results stay available from **Your games** on the home screen.

## Live scoreboard (optional)

`sync.js` talks to the API in `server/API.md` when `CAMPUS.api` in `config.js` is set. With it empty (the default) nothing changes: no network calls, no sync UI.

- The host's phone registers the game from the lobby (`PUT /v1/games/:id`) with a random **host key** that only that phone stores (`manhunt:hostkey:<id>`). The same phone gets **End game for everyone** and a **Host backup** link/QR: a hunter link that also carries the host key in the URL hash, so a co-host can take over if the host's phone dies. The key lives only in the hash (never sent in a request) and is stripped from the address bar once stored.
- Each phone sends a `join` when it opens the game screen, a `catch` when a hunter logs a verified catch, an `out` when a runner presses "I've been tagged", and a `ping` every ~30 s while the screen is open. The host sees "N phones not heard from in 2 min". No location is ever involved.
- A catch and an out for the same runner count once; the first hunter to report gets the credit. A hunter who logs a runner already on the caught list is warned first. A runner whose phone was off when a hunter logged them learns it on return ("A hunter logged your catch").
- Events go through an outbox in `localStorage` (deduplicated, capped, retried with backoff). Offline, on a captive-portal Wi-Fi (HTML instead of JSON is never treated as success), or with the server down, the chip says "Offline · will sync" and the queue flushes when the server is reachable again. Only one browser tab per phone runs the outbox and the poll (Web Locks + BroadcastChannel); other tabs read what it broadcasts.
- The game screen polls `GET /v1/games/:id?pid=...` every ~5 s while visible (15 s in low-power mode, paused when hidden). If the server reports the game ended (host, all caught, time up), every phone shows the matching end screen within a poll. `serverTime` corrects the countdown on phones whose clock is off; a difference over 20 s shows a one-line note.
- The server ends the game itself when every known runner has been caught during the hunt, and still accepts late catch/out reports for 15 minutes after any end so hunters who were offline keep their credit.

**What is sent:** the random game id, your random codename, your random per-game player id, tag codes inside catch/out events, pings, and the host key for create/end. **Never location.** Games are deleted from the server 24 hours after they end.

For local development, `?api=http://localhost:8084` is honoured only when the page is served from `localhost`; a shared link can never point the app at another server.

## Customise for your campus

Edit `config.js`: campus name and place, off-limits list, security phone number, defaults, codename words, and `api` (the live scoreboard URL; leave empty to stay offline). Set the security number before launch; the SOS button says it is missing otherwise.

## Run locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. A service worker caches the shell (and Leaflet) for offline use; bump `VERSION` in `sw.js` when shell files change.

Server: `cd server && npm install && npm test`, then `PORT=8084 DB_PATH=/tmp/manhunt.db ALLOWED_ORIGINS=http://localhost:8000 node src/server.js`.

## Code layout

| File | Role |
| --- | --- |
| `ui.js` | DOM builder (text nodes only), guarded `localStorage` wrapper, toast, sheets, screen-reader announcements, time formatting |
| `core.js` | Link encoding and validation, codename and tag codes, phase clock, recent games |
| `device.js` | Sound/vibration cues, wake lock, battery, low-power mode |
| `sync.js` | Live scoreboard client: outbox, polling, pings, leader election between tabs |
| `game.js` | The game screen (runner and hunter), end states, live card, host box, map card with GPS |
| `app.js` | Home, host flow, lobby, routing |
| `mapview.js`, `editor.js` | Map library, geometry, Leaflet drawing, zone editor |
| `server/` | Fastify + SQLite API (`server/API.md`) |

## Deploy

Served by GitHub Pages from `main` / root. Any static host works. The server is a Docker image (`server/Dockerfile`); new columns are added to an existing SQLite database on start.

## Maps

- `maps.json` holds preset **zones** (polygons) and **configurations** (which zones are play areas and which are no-go). Presets: Classic, Open campus, Forbidden zones unlocked.
- Staff quarters, boys/PG hostels and the CDC come from OpenStreetMap building footprints. The campus boundary and cricket ground were traced from satellite imagery and are approximate: copy and correct them in the editor.
- Open **Map editor** in the app to draw zones on satellite imagery (Esri World Imagery): tap to add corners, drag them, tap one to remove it, or add your current position while walking the boundary. Combine zones into configurations. Custom maps are saved on that phone and travel inside the game link (delta-encoded, so a 20-corner polygon costs about 150 characters). Export the JSON from the editor and merge it into `maps.json` to make a map a permanent preset.
- Location is read on-device and never sent anywhere.

## Security notes

Everything in the link hash is untrusted. `core.js` validates every field (types, ranges, lengths) and `mapview.js` rebuilds inline maps through the same validator used for imports and local storage. Server responses are untrusted too: `sync.js` parses them into a fixed shape with bounded strings and numbers before the UI sees them. All text is rendered via DOM text nodes; Leaflet tooltips receive DOM nodes, not strings. The host key travels only in URL fragments (host backup link) and in the create/end request bodies.

## Limits

- Without the sync server, catches are logged per phone and the host reconciles at the end; "all runners caught" cannot be detected, so the game ends on the clock.
- "Undo (misclick)" only fixes the local phone; the server keeps the out.
- Tag codes catch typos and stop made-up codes, not determined cheating.
- Two runners with the same codename have a 1-in-100 chance of the same tag code; the server would then count them as one runner.
- A phone whose storage is wiped mid-game gets a fresh codename and rejoins as a new player; the old entry stays on the server as an unreachable phone.
- The Battery API does not exist on iOS Safari, so the low-battery prompt never appears there; low-power mode is still available from the chip.
