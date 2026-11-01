# Manhunt sync API (v1)

Base URL is `CAMPUS.api` in `config.js` (empty string = offline mode, no sync). JSON everywhere. CORS is limited to the configured origins. Every response that carries game state is `Cache-Control: no-store`.

No accounts. A game **id** (`^[a-z0-9]{4,12}$`) is a capability: anyone with the game link can post events. The **host key** (random, 16-64 chars of `[A-Za-z0-9_-]`, generated on the host's phone and kept only there) is the only secret; the server stores its SHA-256. A **pid** is a random per-phone-per-game id (`^[A-Za-z0-9_-]{6,32}$`). Names are the random codenames (1-24 chars, no `<>&"` or control characters). A runner's **key** is `name#code` where `code` is their 4-digit tag code, so two runners who share a codename stay distinct.

Strict validation: unknown fields are rejected (400). Body limit 4 KB.

## `PUT /v1/games/:id`: create (idempotent)
Body: `{ hostKey, label (1-40), startAt (ms epoch, within -1d..+30d), headMin (0-60), durMin (5-240), endAt? (ms epoch hard stop) }`
- `201` created, `200` same host key again (returns current state), `403` id already used by another host, `400` invalid.
- Game data is deleted 24 h after it ends (or 24 h after it is ended by the host).

## `GET /v1/games/:id`: state (poll every ~5 s)
`200`
```json
{ "id":"abc123", "label":"Friday Hunt", "startAt":0, "endAt":0,
  "ended":false, "endedAt":null, "result":null,
  "players":{"hunters":3,"alive":14,"runners":20,"total":23,"unreachable":2}, "caught":6,
  "board":[{"name":"Red Wolf","catches":4}],
  "feed":[{"t":0,"hunter":"Red Wolf","runner":"Silver Fox"}],
  "serverTime":0 }
```
- `ended` is true once the host ended the game, every known runner was caught during the hunt, or `serverTime > endAt`.
- `result` is `null` while the game runs, otherwise `{ reason, winner }` with `reason` one of `"host"` (winner `null`), `"allCaught"` (winner `"hunters"`), `"timeUp"` (winner `"runners"` if anyone is still alive, `"hunters"` if nobody is, `null` if nothing happened).
- `endedAt` is set only for `host` and `allCaught` ends (the moment the server locked the game); `timeUp` leaves it `null` because the end time comes from the link.
- `players.unreachable` counts phones that have not sent anything (join, ping, catch, out) for 2 minutes. No location is involved.
- `board` = top 10 hunters by catches. `feed` = latest 15 catches/outs (`hunter` is `null` for a self-reported out nobody has claimed yet). `serverTime` lets the client correct clock skew. `404` unknown game.

Fields added in this version (`result`, `players.runners/total/unreachable`) are additive; older clients ignore them.

## `POST /v1/games/:id/events`: report (idempotent; `204` on success)
Body is one of:
- Join: `{ pid, name, type:"join", role:"runner"|"hunter", code? }`. `code` is required for runners. Re-send with `role:"hunter"` when a caught runner converts.
- Catch (sent by a hunter): `{ pid, name, type:"catch", runner:{ name, code } }`.
- Out (sent by the runner): `{ pid, name, type:"out", code }`.
- Ping (heartbeat, every ~30 s while the game screen is open): `{ pid, name, type:"ping" }`. Only updates last-seen.

A catch and an out for the same runner key count once. If the runner's "out" arrives first, a later hunter catch still credits the hunter. Every event also refreshes the sender's last-seen time.

Once every known runner is caught (during the hunt, i.e. after the head start), the server ends the game itself with `result.reason = "allCaught"`.

Errors: `404` unknown game, `409 {"error":"ended","result":{...}}` (game over; `result` tells the phone which end screen to show), `422` (not joined yet / game full: 300 players / too many events), `429` (more than 30 events per minute per pid), `400` invalid.

After an end, `catch` and `out` reports are still accepted for 15 minutes (phones that were offline flush their queues; the board may still change). Joins and pings are refused immediately once ended. Nothing is accepted more than 15 minutes past `endAt`.

## `POST /v1/games/:id/end`: host ends the game for everyone
Body `{ hostKey }` returns the state with `ended:true` and `result:{ "reason":"host", "winner":null }`. `403` for a wrong key.

## `GET /healthz`
`{ "ok": true }`

## Operations
- SQLite in WAL mode at `DB_PATH`; new columns are added automatically on start, so redeploying over an existing database needs no migration step.
- Rate limits: 30 events/min per pid (fairness between phones) and 30 000 requests/min per IP (campus NAT puts hundreds of phones behind one address, so this is only a runaway-client guard).
