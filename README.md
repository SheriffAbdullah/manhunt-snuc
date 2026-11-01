# manhunt-snuc

A campus Manhunt (hide-and-chase) game as an installable PWA. Static files, no accounts, no personal data. An optional small sync server (`server/`) adds a live scoreboard; without it the app runs entirely on the phones.

Live: https://sheriffabdullah.github.io/manhunt-snuc/

## How it works

- A host creates a game in three steps: map, start time (head start + hunt length), options (hard stop time for curfew, "caught runners become hunters").
- The game config is encoded in the share URL (`#g=...`). The lobby shows a **runner link** and a **hunter link**, each with a QR code generated on the phone (no external service).
- Every phone computes the same clock from the same start time, so nothing needs a server. Phones must have automatic time on.
- Players get a random codename (e.g. "Cobalt Moth") stored only on their device.
- Runners show a tag code (`COBALT MOTH · 4821`). A hunter picks the two codename words and types the 4 digits; the hunter's phone verifies the code offline (2 random digits + 2 check digits bound to the game and codename) before logging the catch. Runners press "I've been tagged" to go out.
- During the game: the screen stays awake (Wake Lock where supported), phase changes vibrate and beep, an SOS sheet shows the security number and a "STOP" broadcast message, and the optional on-device map warns when you leave the play area or enter a no-go zone.
- When the game ends, each phone shows its result (survived / caught at, or the catch list) with a share button.

## Live scoreboard (optional)

`sync.js` talks to the API in `server/API.md` when `CAMPUS.api` in `config.js` is set. With it empty (the default) nothing changes: no network calls, no sync UI.

- The host's phone registers the game from the lobby (`PUT /v1/games/:id`) with a random **host key** that only that phone stores (`manhunt:hostkey:<id>`); the lobby shows "Live scoreboard: on/off" with a retry. The same phone gets an **End game for everyone** button on the game and results screens.
- Each phone sends a `join` when it opens the game screen (role from the link; runners include their tag code, and a caught runner who switches to hunting re-joins as a hunter), a `catch` when a hunter logs a verified catch, and an `out` when a runner presses "I've been tagged". A catch and an out for the same runner count once.
- Events go through an outbox in `localStorage` (deduplicated, capped, retried with backoff). Offline for a while? The chip says "Offline, scores will sync" and the queue flushes when the server is reachable again. Invalid or post-game events (400/409/422) are dropped; network errors, 429 and 5xx are retried.
- The game screen polls `GET /v1/games/:id` every ~5 s while visible (paused when the tab is hidden) and shows runners left, hunters, caught, top hunters and the latest feed. If the server reports the game ended, every phone shows game over at once. `serverTime` is compared with the phone clock; a difference over 20 s shows a one-line warning.
- Results and the share text include "Everyone: N caught, M survived" and the top hunters when server data is available.

**What is sent:** the random game id, your random codename, your random per-game player id, tag codes inside catch/out events, and the host key hash check for hosts. **Never location.** Games are deleted from the server 24 hours after they end.

For local development, `?api=http://localhost:8084` is honoured only when the page is served from `localhost`; a shared link can never point the app at another server.

## Customise for your campus

Edit `config.js`: campus name, off-limits list, security phone number, defaults, codename words, and `api` (the live scoreboard URL; leave empty to stay offline). Set the security number before launch; the SOS button says it is missing otherwise.

## Run locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. A service worker caches the shell (and Leaflet) for offline use; bump `VERSION` in `sw.js` when shell files change.

## Deploy

Served by GitHub Pages from `main` / root. Any static host works.

## Maps

- `maps.json` holds preset **zones** (polygons) and **configurations** (which zones are play areas and which are no-go). Presets: Classic, Open campus, Forbidden zones unlocked.
- Staff quarters, boys/PG hostels and the CDC come from OpenStreetMap building footprints. The campus boundary and cricket ground were traced from satellite imagery and are approximate: copy and correct them in the editor.
- Open **Map editor** in the app to draw zones on satellite imagery (Esri World Imagery): tap to add corners, drag them, tap one to remove it, or add your current position while walking the boundary. Combine zones into configurations. Custom maps are saved on that phone and travel inside the game link (delta-encoded, so a 20-corner polygon costs about 150 characters). Export the JSON from the editor and merge it into `maps.json` to make a map a permanent preset.
- Location is read on-device and never sent anywhere.

## Security notes

Everything in the link hash is untrusted. `app.js` validates every field (types, ranges, lengths) and `mapview.js` rebuilds inline maps through the same validator used for imports and local storage. Server responses are untrusted too: `sync.js` parses them into a fixed shape with bounded strings and numbers before the UI sees them. All text is rendered via DOM text nodes; Leaflet tooltips receive DOM nodes, not strings.

## Roadmap

- Live "pings" for hunters (opt-in, expiring location)

## Limits

Without the sync server, catches are logged per phone and the host reconciles at the end. With it, "Undo (misclick)" only fixes the local phone; the server keeps the out. Tag codes catch typos and stop made-up codes, not determined cheating.
