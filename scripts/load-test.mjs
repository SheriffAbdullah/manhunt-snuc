#!/usr/bin/env node
// Load test for the sync server: N headless players from one IP (campus NAT shape).
// Each player joins, polls every 5 s with ?pid=, pings every 30 s; hunters catch
// runners at a steady rate; one abusive pid bursts 60 events to confirm the
// per-pid 429 without hurting anyone else. Deterministic: seeded PRNG, fixed schedule.
//
//   node scripts/load-test.mjs --api http://localhost:8084 [--players 300] [--seconds 60] [--seed 1]
//
// Exit code 1 if any 5xx or network error occurred. Needs Node 22+.
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const API = (arg("api", "http://localhost:8084")).replace(/\/+$/, "");
const PLAYERS = +arg("players", 300), SECONDS = +arg("seconds", 60), SEED = +arg("seed", 1);
const HUNTERS = Math.max(1, Math.round(PLAYERS * 0.1));

let seed = SEED >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const ALPH = "abcdefghijklmnopqrstuvwxyz0123456789";
const token = (n) => Array.from({ length: n }, () => ALPH[Math.floor(rnd() * 36)]).join("");
const ADJ = ["Silver", "Quiet", "Swift", "Amber", "Cobalt", "Lunar", "Mellow", "Rapid", "Velvet", "Hidden", "Bright", "Dusky"];
const NOUN = ["Falcon", "Otter", "Heron", "Lynx", "Gecko", "Panda", "Raven", "Fox", "Ibis", "Moth", "Wolf", "Crane"];

const id = "lt" + token(6), hostKey = "loadtest-hostkey-" + token(16);
const lat = { GET: [], POST: [] }, status = {}, errs = [];
let inflight = 0, maxInflight = 0;
const call = async (method, path, body) => {
  const t0 = performance.now(); inflight++; maxInflight = Math.max(maxInflight, inflight);
  try {
    const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    status[r.status] = (status[r.status] || 0) + 1;
    if (r.status !== 204) await r.text();
    lat[method === "GET" ? "GET" : "POST"].push(performance.now() - t0);
    return r.status;
  } catch (e) { errs.push(String(e.cause?.code || e.message)); return 0; }
  finally { inflight--; }
};
const pct = (a, p) => { if (!a.length) return "-"; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };

const created = await call("PUT", `/v1/games/${id}`, { hostKey, label: "Load test", startAt: Date.now() - 60_000, headMin: 0, durMin: 240 });
if (created !== 201) { console.error(`could not create game (${created}); is the API up and is this origin allowed?`); process.exit(1); }
const players = Array.from({ length: PLAYERS }, (_, i) => ({ pid: token(16), name: `${ADJ[i % 12]} ${NOUN[(i * 7) % 12]}`, role: i < HUNTERS ? "hunter" : "runner", code: String(1000 + ((i * 37) % 9000)) }));

const tJoin = performance.now();
await Promise.all(players.map((p) => call("POST", `/v1/games/${id}/events`, { pid: p.pid, name: p.name, type: "join", role: p.role, ...(p.role === "runner" ? { code: p.code } : {}) })));
console.log(`join burst of ${PLAYERS}: ${(performance.now() - tJoin).toFixed(0)} ms wall, max inflight ${maxInflight}`);

const stopAt = Date.now() + SECONDS * 1000, timers = [];
players.forEach((p, i) => {
  const jitter = (i / PLAYERS) * 5000; // spread evenly instead of randomly
  timers.push(setTimeout(() => timers.push(setInterval(() => Date.now() < stopAt && call("GET", `/v1/games/${id}?pid=${p.pid}`), 5000)), jitter));
  timers.push(setTimeout(() => timers.push(setInterval(() => Date.now() < stopAt && call("POST", `/v1/games/${id}/events`, { pid: p.pid, name: p.name, type: "ping" }), 30000)), jitter));
});
const runnersLeft = players.filter((p) => p.role === "runner").slice(20); // keep 20 alive so the game never settles
let catches = 0, hunterIdx = 0;
const catchTimer = setInterval(() => {
  if (!runnersLeft.length || Date.now() >= stopAt) return;
  const r = runnersLeft.pop(), hunter = players[hunterIdx++ % HUNTERS];
  catches++;
  call("POST", `/v1/games/${id}/events`, { pid: hunter.pid, name: hunter.name, type: "catch", runner: { name: r.name, code: r.code } });
}, 700);
let got429 = 0;
setTimeout(async () => {
  const bad = players[PLAYERS - 1];
  await Promise.all(Array.from({ length: 60 }, () => call("POST", `/v1/games/${id}/events`, { pid: bad.pid, name: bad.name, type: "ping" }).then((s) => { if (s === 429) got429++; })));
}, Math.min(10_000, SECONDS * 500));

await new Promise((r) => setTimeout(r, SECONDS * 1000 + 1500));
for (const t of timers) { clearTimeout(t); clearInterval(t); }
clearInterval(catchTimer);
await new Promise((r) => setTimeout(r, 1500));
const state = await fetch(`${API}/v1/games/${id}`).then((r) => r.json());
const total = lat.GET.length + lat.POST.length;
console.log(`\n${PLAYERS} players for ${SECONDS}s: ${total} requests (${(total / SECONDS).toFixed(0)} req/s), max inflight ${maxInflight}`);
console.log(`GET  n=${lat.GET.length}  p50=${pct(lat.GET, 0.5)}ms  p95=${pct(lat.GET, 0.95)}ms  p99=${pct(lat.GET, 0.99)}ms  max=${pct(lat.GET, 1)}ms`);
console.log(`POST n=${lat.POST.length}  p50=${pct(lat.POST, 0.5)}ms  p95=${pct(lat.POST, 0.95)}ms  p99=${pct(lat.POST, 0.99)}ms  max=${pct(lat.POST, 1)}ms`);
console.log(`status: ${JSON.stringify(status)}; abusive pid got ${got429}/60 x 429; network errors: ${errs.length}${errs.length ? " " + errs.slice(0, 3).join(",") : ""}`);
console.log(`server state: total=${state.players.total} hunters=${state.players.hunters} alive=${state.players.alive} caught=${state.caught} (sent ${catches}) unreachable=${state.players.unreachable} ended=${state.ended}`);
const fiveXX = Object.entries(status).filter(([k]) => +k >= 500).reduce((a, [, v]) => a + v, 0);
const ok = fiveXX === 0 && errs.length === 0 && state.caught === catches && got429 > 0;
console.log(ok ? "OK: no 5xx, no network errors, every catch landed, abusive pid was throttled" : `PROBLEM: ${fiveXX} 5xx, ${errs.length} network errors, caught ${state.caught}/${catches}, 429s ${got429}`);
process.exit(ok ? 0 : 1);
