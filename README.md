# manhunt-snuc

A campus Manhunt (hide-and-chase) game as an installable PWA. Static files, no backend, no accounts, no personal data.

## How it works

- A host creates a game: play area, start time, head start, hunt length.
- The game config is encoded in the share URL (`#g=...`). The host sends a **runner link** and a **hunter link**.
- Every phone computes the same clock from the same start time, so nothing needs a server.
- Players get a random codename (e.g. "Cobalt Moth") stored only on their device.
- Runners show a tag code (`COBALT MOTH 4821`). Hunters enter the 4 digits to log a catch. Runners press "I've been tagged" to go out.

## Customise for your campus

Edit `config.js`: campus name, play zones and rules, off-limits list, security phone number, defaults, codename words. Set the security number before launch.

## Run locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. A service worker caches the shell for offline use (network-first, so edits go live).

## Deploy

Served by GitHub Pages from `main` / root. Any static host works.

## Roadmap

- Scoreboard (needs a small backend: Cloudflare Worker + Durable Object or Supabase, keyed by game id)
- Live "pings" for hunters (opt-in, expiring location)
- Host dashboard, QR join codes

## Limits of v1

Catches are logged per phone, not synced. The host reconciles at the end until a scoreboard backend exists. Tag codes prevent typos, not determined cheating.

## Maps

- `maps.json` holds preset **zones** (polygons) and **configurations** (which zones are play areas and which are no-go). Presets: Classic, Open campus, Forbidden zones unlocked.
- Staff quarters, boys/PG hostels and the CDC come from OpenStreetMap building footprints. The campus boundary and cricket ground were traced from satellite imagery and are approximate: correct them in the editor.
- Open **Map editor** in the app to draw zones on satellite imagery (Esri World Imagery) and build configurations, such as a women's-hostel-only game. Custom maps are saved on that phone and travel inside the game link when hosted. Export the JSON from the editor and merge it into `maps.json` to make a map a permanent preset.
- During a game, players can opt in to see themselves on the map and get a warning if they leave the green area or enter a red zone. Location is read on-device and never sent anywhere.
