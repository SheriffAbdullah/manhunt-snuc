import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

const HOST = "hostkey-aaaaaaaaaaaaaaaa";
const T0 = 1_800_000_000_000;
const game = (o = {}) => ({ hostKey: HOST, label: "Friday Hunt", startAt: T0, headMin: 5, durMin: 45, ...o });

function setup(opts = {}) {
  let clock = T0 + 60_000;
  const app = buildApp({ now: () => clock, origins: ["https://sheriffabdullah.github.io"], ...opts });
  const call = (method, url, payload, headers) => app.inject({ method, url, payload, headers });
  return { app, call, tick: (ms) => (clock += ms), set: (t) => (clock = t) };
}
const join = (pid, name, role, code) => ({ pid, name, type: "join", role, ...(code ? { code } : {}) });

test("create is idempotent for the host and refused for anyone else", async () => {
  const { app, call } = setup();
  assert.equal((await call("PUT", "/v1/games/abc123", game())).statusCode, 201);
  assert.equal((await call("PUT", "/v1/games/abc123", game())).statusCode, 200);
  assert.equal((await call("PUT", "/v1/games/abc123", game({ hostKey: "other-key-bbbbbbbbbbbbbbbb" }))).statusCode, 403);
  await app.close();
});

test("rejects malformed ids, bodies, html in names, out-of-range times", async () => {
  const { app, call } = setup();
  assert.equal((await call("PUT", "/v1/games/AB", game())).statusCode, 400);
  assert.equal((await call("PUT", "/v1/games/abc123", game({ label: "<img src=x onerror=1>" }))).statusCode, 400);
  assert.equal((await call("PUT", "/v1/games/abc123", game({ durMin: 99999 }))).statusCode, 400);
  assert.equal((await call("PUT", "/v1/games/abc123", game({ startAt: T0 + 90 * 86_400_000 }))).statusCode, 400);
  assert.equal((await call("PUT", "/v1/games/abc123", { ...game(), extra: 1 })).statusCode, 400);
  await call("PUT", "/v1/games/abc123", game());
  assert.equal((await call("POST", "/v1/games/abc123/events", { pid: "p1xxxxxx", name: "<b>x</b>", type: "join", role: "hunter" })).statusCode, 400);
  assert.equal((await call("POST", "/v1/games/abc123/events", join("p1xxxxxx", "Fox", "runner"))).statusCode, 400, "runner needs a code");
  assert.equal((await call("GET", "/v1/games/nope000")).statusCode, 404);
  await app.close();
});

test("full game: join, catch, self-out dedupe, board, feed, conversion", async () => {
  const { app, call, tick } = setup();
  await call("PUT", "/v1/games/abc123", game());
  const ev = (b) => call("POST", "/v1/games/abc123/events", b);

  assert.equal((await ev(join("hunter-01", "Red Wolf", "hunter"))).statusCode, 204);
  assert.equal((await ev(join("runner-01", "Silver Fox", "runner", "1234"))).statusCode, 204);
  assert.equal((await ev(join("runner-02", "Quiet Moth", "runner", "5678"))).statusCode, 204);
  assert.equal((await ev(join("runner-01", "Silver Fox", "runner", "1234"))).statusCode, 204, "join is idempotent");
  let s = (await call("GET", "/v1/games/abc123")).json();
  assert.deepEqual(s.players, { hunters: 1, alive: 2 });
  assert.equal(s.caught, 0);

  tick(1000);
  assert.equal((await ev({ pid: "hunter-01", name: "Red Wolf", type: "catch", runner: { name: "Silver Fox", code: "1234" } })).statusCode, 204);
  // hunter logs the same catch again and the runner also reports out: still one catch
  await ev({ pid: "hunter-01", name: "Red Wolf", type: "catch", runner: { name: "Silver Fox", code: "1234" } });
  await ev({ pid: "runner-01", name: "Silver Fox", type: "out", code: "1234" });
  // conversion: caught runner becomes hunter
  await ev(join("runner-01", "Silver Fox", "hunter"));
  s = (await call("GET", "/v1/games/abc123")).json();
  assert.equal(s.caught, 1);
  assert.deepEqual(s.players, { hunters: 2, alive: 1 });
  assert.deepEqual(s.board, [{ name: "Red Wolf", catches: 1 }]);
  assert.equal(s.feed[0].hunter, "Red Wolf");
  assert.equal(s.feed[0].runner, "Silver Fox");
  assert.equal(typeof s.serverTime, "number");

  // runner reports out first, then hunter confirms: hunter still gets credit
  await ev({ pid: "runner-02", name: "Quiet Moth", type: "out", code: "5678" });
  await ev({ pid: "hunter-01", name: "Red Wolf", type: "catch", runner: { name: "Quiet Moth", code: "5678" } });
  s = (await call("GET", "/v1/games/abc123")).json();
  assert.equal(s.caught, 2);
  assert.deepEqual(s.board, [{ name: "Red Wolf", catches: 2 }]);
  assert.equal(s.players.alive, 0);
  assert.equal((await call("GET", "/v1/games/abc123")).headers["cache-control"], "no-store");
  await app.close();
});

test("events need a prior join; unknown game 404s", async () => {
  const { app, call } = setup();
  await call("PUT", "/v1/games/abc123", game());
  assert.equal((await call("POST", "/v1/games/abc123/events", { pid: "ghost-01", name: "Ghost", type: "out", code: "1111" })).statusCode, 422);
  assert.equal((await call("POST", "/v1/games/zzzz99/events", join("p1xxxxxx", "Fox", "hunter"))).statusCode, 404);
  await app.close();
});

test("only the host can end; ended games reject events but stay readable", async () => {
  const { app, call } = setup();
  await call("PUT", "/v1/games/abc123", game());
  await call("POST", "/v1/games/abc123/events", join("hunter-01", "Red Wolf", "hunter"));
  assert.equal((await call("POST", "/v1/games/abc123/end", { hostKey: "other-key-bbbbbbbbbbbbbbbb" })).statusCode, 403);
  const r = await call("POST", "/v1/games/abc123/end", { hostKey: HOST });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ended, true);
  assert.equal((await call("POST", "/v1/games/abc123/events", join("hunter-02", "Blue Owl", "hunter"))).statusCode, 409);
  assert.equal((await call("GET", "/v1/games/abc123")).json().ended, true);
  await app.close();
});

test("events after end time + grace are refused", async () => {
  const { app, call, set } = setup();
  await call("PUT", "/v1/games/abc123", game());
  set(T0 + (5 + 45) * 60_000 + 16 * 60_000);
  assert.equal((await call("POST", "/v1/games/abc123/events", join("hunter-01", "Red Wolf", "hunter"))).statusCode, 409);
  await app.close();
});

test("per-player rate limit, player cap, and body size cap", async () => {
  const { app, call } = setup();
  await call("PUT", "/v1/games/abc123", game());
  let last;
  for (let i = 0; i < 31; i++) last = await call("POST", "/v1/games/abc123/events", join("spammer-1", "Fox", "hunter"));
  assert.equal(last.statusCode, 429);
  const big = await call("POST", "/v1/games/abc123/events", { pid: "p1xxxxxx", name: "x".repeat(5000), type: "join", role: "hunter" });
  assert.equal(big.statusCode, 413);
  await app.close();
});

test("CORS only for the configured origin", async () => {
  const { app, call } = setup();
  const ok = await call("GET", "/healthz", undefined, { origin: "https://sheriffabdullah.github.io" });
  assert.equal(ok.headers["access-control-allow-origin"], "https://sheriffabdullah.github.io");
  const bad = await call("GET", "/healthz", undefined, { origin: "https://evil.example" });
  assert.equal(bad.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("expired games are purged with their data", async () => {
  const { app, call, set } = setup();
  await call("PUT", "/v1/games/abc123", game());
  await call("POST", "/v1/games/abc123/events", join("hunter-01", "Red Wolf", "hunter"));
  set(T0 + 3 * 86_400_000);
  assert.equal(app.purgeNow(), 1);
  assert.equal((await call("GET", "/v1/games/abc123")).statusCode, 404);
  await app.close();
});
