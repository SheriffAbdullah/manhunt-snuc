# manhunt-snuc

A campus Manhunt (hide-and-chase) game as an installable PWA. Static files, no backend, no accounts, no personal data.

Live: https://sheriffabdullah.github.io/manhunt-snuc/

## How it works

- A host creates a game in three steps: map, start time (head start + hunt length), options (hard stop time for curfew, "caught runners become hunters").
- The game config is encoded in the share URL (`#g=...`). The lobby shows a **runner link** and a **hunter link**, each with a QR code generated on the phone (no external service).
- Every phone computes the same clock from the same start time, so nothing needs a server. Phones must have automatic time on.
- Players get a random codename (e.g. "Cobalt Moth") stored only on their device.
- Runners show a tag code (`COBALT MOTH · 4821`). A hunter picks the two codename words and types the 4 digits; the hunter's phone verifies the code offline (2 random digits + 2 check digits bound to the game and codename) before logging the catch. Runners press "I've been tagged" to go out.
- During the game: the screen stays awake (Wake Lock where supported), phase changes vibrate and beep, an SOS sheet shows the security number and a "STOP" broadcast message, and the optional on-device map warns when you leave the play area or enter a no-go zone.
- When the game ends, each phone shows its result (survived / caught at, or the catch list) with a share button.

## Customise for your campus

Edit `config.js`: campus name, off-limits list, security phone number, defaults, codename words. Set the security number before launch; the SOS button says it is missing otherwise.

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

Everything in the link hash is untrusted. `app.js` validates every field (types, ranges, lengths) and `mapview.js` rebuilds inline maps through the same validator used for imports and local storage. All text is rendered via DOM text nodes; Leaflet tooltips receive DOM nodes, not strings.

## Roadmap

- Scoreboard (needs a small backend: Cloudflare Worker + Durable Object or Supabase, keyed by game id). The catch log format `{n, c, t}` per game id is designed to be uploaded as-is.
- Live "pings" for hunters (opt-in, expiring location)
- Host "end game now" broadcast (needs the same backend)

## Limits

Catches are logged per phone, not synced. The host reconciles at the end until a scoreboard backend exists. Tag codes catch typos and stop made-up codes, not determined cheating.
