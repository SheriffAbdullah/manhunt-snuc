// Optional live scoreboard sync (see server/API.md). Entirely off when
// CAMPUS.api is empty: no network calls, no UI. Only ever sends the random
// codename, the random game id, join/catch/out/ping events and the host key.
// Never location. Every call here returns a result object and never throws.
//
// Several tabs of the same game may be open: Web Locks elect one leader tab
// that owns the outbox and the poll; the others read what it broadcasts.
(() => {
  const C = window.CAMPUS || {};
  const { store } = window.MHUI;

  // The API URL comes from config.js. A `?api=` override is honoured only on
  // localhost for development; a shared link must never be able to point the
  // app at someone else's server.
  const base = (() => {
    let b = typeof C.api === "string" ? C.api.trim() : "";
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      const o = new URLSearchParams(location.search).get("api");
      if (o && /^https?:\/\/[\w.:[\]-]+(\/[\w./-]*)?$/.test(o)) b = o;
    }
    return b.replace(/\/+$/, "");
  })();
  const enabled = () => !!base;

  const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (x) => ALPH[x & 63]).join(""); };
  const ID_OK = (id) => typeof id === "string" && /^[a-z0-9]{4,12}$/.test(id);
  const KEY_OK = (k) => typeof k === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(k);
  // Random per-phone-per-game id. Only ever stored on this phone.
  const pid = (gameId) => {
    const k = `manhunt:pid:${gameId}`;
    let p = store.get(k);
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(p || "")) { p = rand(16); store.set(k, p); }
    return p;
  };
  // The host key only ever lives on the host's phone; the server keeps a hash.
  const hostKeyFor = (gameId, create) => {
    const k = `manhunt:hostkey:${gameId}`;
    let v = store.get(k);
    if (!KEY_OK(v)) { if (!create) return null; v = rand(32); store.set(k, v); }
    return v;
  };
  const hasHostKey = (gameId) => !!hostKeyFor(gameId, false);
  // A host backup link carries the key in the URL hash; a second phone adopts it.
  const adoptHostKey = (gameId, key) => { if (ID_OK(gameId) && KEY_OK(key)) { store.set(`manhunt:hostkey:${gameId}`, key); return true; } return false; };
  // Names/labels: the server rejects <>&" and control characters.
  const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>&"]/g, "").trim().slice(0, max);

  // Captive portals and hotel Wi-Fi answer every request with a 200 HTML login
  // page. Only a 204, or JSON with the right content type, counts as an answer
  // from our server; anything else is reported as "no network" so it is retried.
  const request = async (method, path, body, ms) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(base + path, {
        method, signal: ctl.signal, cache: "no-store", credentials: "omit",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 204) return { ok: true, status: 204, data: null };
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) return { ok: false, status: 0, data: null, portal: true };
      let data = null;
      try { data = await r.json(); } catch { return { ok: false, status: 0, data: null }; }
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: null }; }
    finally { clearTimeout(t); }
  };

  // Server data is untrusted: parse it into a fixed shape with bounded strings.
  const num = (v, hi) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.trunc(v))) : 0);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const REASONS = new Set(["host", "allCaught", "timeUp"]), WINNERS = new Set(["hunters", "runners"]);
  const result = (r) => (r && typeof r === "object" && REASONS.has(r.reason) ? { reason: r.reason, winner: WINNERS.has(r.winner) ? r.winner : null } : null);
  const sanitize = (d) => {
    if (!d || typeof d !== "object") return null;
    const players = d.players && typeof d.players === "object" ? d.players : {};
    return {
      label: str(d.label, 40),
      startAt: num(d.startAt, 1e14), endAt: num(d.endAt, 1e14),
      ended: d.ended === true, endedAt: Number.isFinite(d.endedAt) ? d.endedAt : null,
      result: d.ended === true ? result(d.result) || { reason: "host", winner: null } : null,
      hunters: num(players.hunters, 1e6), alive: num(players.alive, 1e6), caught: num(d.caught, 1e6),
      runners: num(players.runners, 1e6), total: num(players.total, 1e6), unreachable: num(players.unreachable, 1e6),
      board: (Array.isArray(d.board) ? d.board : []).slice(0, 10).filter((x) => x && typeof x === "object").map((x) => ({ name: str(x.name, 24), catches: num(x.catches, 1e6) })),
      feed: (Array.isArray(d.feed) ? d.feed : []).slice(0, 15).filter((x) => x && typeof x === "object").map((x) => ({ t: num(x.t, 1e14), hunter: x.hunter == null ? null : str(x.hunter, 24), runner: str(x.runner, 24) })),
      serverTime: num(d.serverTime, 1e14),
      me: d.me && typeof d.me === "object" ? { role: d.me.role === "hunter" ? "hunter" : "runner", outAt: Number.isFinite(d.me.outAt) ? d.me.outAt : null, catches: num(d.me.catches, 1e6) } : null,
    };
  };

  // ---- one leader per browser -------------------------------------------------------
  // Web Locks: the first tab takes "manhunt:leader" and keeps it until it
  // closes; the next tab in line then becomes leader. Without Web Locks every
  // tab is its own leader (the server dedupes everything anyway).
  let leader = !(navigator.locks && typeof navigator.locks.request === "function");
  const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel("manhunt:sync") : null;
  const post = (m) => { try { bc && bc.postMessage(m); } catch {} };
  const shared = new Map(); // gameId -> { data, at } from the leader's polls
  if (!leader) {
    navigator.locks.request("manhunt:leader", () => { leader = true; flush(); return new Promise(() => {}); }).catch(() => { leader = true; });
  }
  if (bc) bc.onmessage = (e) => {
    const m = e.data || {};
    if (m.t === "kick" && leader) flush();
    else if (m.t === "state" && ID_OK(m.id)) { const d = sanitize(m.data); if (d) { shared.set(m.id, { data: d, at: Date.now() }); notify(); } }
  };

  // ---- outbox: events wait here until the server has accepted them -----------
  // Events are idempotent server-side, so retrying is always safe. Order within
  // a game matters (join before catch), so one failure pauses that game's queue.
  // The box lives in localStorage (shared by every tab) and is re-read on each
  // pass; in-memory only when storage is broken.
  const BOX = "manhunt:outbox", MAX_ITEMS = 200, MAX_AGE = 36 * 3600000;
  let mem = [];
  const valid = (e) => e && ID_OK(e.g) && e.b && typeof e.s === "string";
  const readBox = () => (store.broken ? mem : (store.get(BOX, []) || []).filter(valid));
  const writeBox = (box) => { mem = box; if (!store.broken) store.set(BOX, box); };
  const notify = () => { try { document.dispatchEvent(new CustomEvent("mh:sync", { detail: { pending: readBox().length } })); } catch {} };
  const sig = (g, b) => [g, b.type, b.pid, b.role || "", b.code || "", b.runner ? `${b.runner.name}#${b.runner.code}` : ""].join("|");
  const DROP = new Set([400, 409, 422]); // invalid, game ended, not joined / full: retrying can't help
  let busy = false, retryTimer = null;

  const schedule = () => {
    clearTimeout(retryTimer); retryTimer = null;
    const box = readBox();
    if (!box.length || !leader) return;
    const next = Math.min(...box.map((e) => e.at || 0));
    retryTimer = setTimeout(flush, Math.max(1000, next - Date.now()));
  };
  const flush = async () => {
    if (!enabled() || busy) return;
    if (!leader) { post({ t: "kick" }); return; }
    busy = true;
    try {
      const paused = new Set();
      for (const e of readBox()) {
        if (paused.has(e.g)) continue;
        const now = Date.now();
        if (now - e.t > MAX_AGE) { writeBox(readBox().filter((x) => x.s !== e.s)); continue; }
        if ((e.at || 0) > now) { paused.add(e.g); continue; }
        const r = await request("POST", `/v1/games/${e.g}/events`, e.b, 8000);
        if (r.ok || DROP.has(r.status)) { writeBox(readBox().filter((x) => x.s !== e.s)); continue; }
        // Network error, captive portal, 404 (host hasn't created the game yet), 429, 5xx: back off and keep it.
        const box = readBox(), cur = box.find((x) => x.s === e.s);
        if (cur) { cur.n = (cur.n || 0) + 1; cur.at = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(cur.n, 6)) + Math.random() * 1500; writeBox(box); }
        paused.add(e.g);
      }
    } finally { busy = false; notify(); schedule(); }
  };
  const enqueue = (gameId, body) => {
    if (!enabled() || !ID_OK(gameId)) return;
    const s = sig(gameId, body), box = readBox();
    if (!box.some((e) => e.s === s)) {
      box.push({ s, g: gameId, b: body, t: Date.now(), n: 0, at: 0 });
      if (box.length > MAX_ITEMS) box.splice(0, box.length - MAX_ITEMS);
      writeBox(box); notify();
    }
    flush();
  };
  addEventListener("online", () => flush());
  addEventListener("storage", (e) => { if (e.key === BOX) { notify(); if (leader) flush(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const box = readBox(); for (const e of box) e.at = 0; writeBox(box); flush();
  });

  // ---- public API -----------------------------------------------------------------
  const join = (gameId, { name, role, code }) => {
    const body = { pid: pid(gameId), name: clean(name, 24), type: "join", role: role === "hunter" ? "hunter" : "runner" };
    if (body.role === "runner") body.code = String(code);
    enqueue(gameId, body);
  };
  // event: { type:"catch", name, runner:{name,code} } or { type:"out", name, code }
  const report = (gameId, ev) => {
    if (!ev || (ev.type !== "catch" && ev.type !== "out")) return;
    const body = { pid: pid(gameId), name: clean(ev.name, 24), type: ev.type };
    if (ev.type === "catch") body.runner = { name: clean(ev.runner && ev.runner.name, 24), code: String(ev.runner && ev.runner.code) };
    else body.code = String(ev.code);
    enqueue(gameId, body);
  };
  // Heartbeat so the host can see how many phones went quiet. Fire-and-forget:
  // a stale ping is worthless, so it never enters the outbox. Leader tab only.
  const ping = async (gameId, name) => {
    if (!enabled() || !ID_OK(gameId) || !leader) return { ok: false, status: 0 };
    const r = await request("POST", `/v1/games/${gameId}/events`, { pid: pid(gameId), name: clean(name, 24), type: "ping" }, 6000);
    return { ok: r.ok, status: r.status, result: r.status === 409 && r.data ? result(r.data.result) : null };
  };
  const createGame = async (g, label) => {
    if (!enabled() || !ID_OK(g.i)) return { ok: false, status: 0 };
    const body = { hostKey: hostKeyFor(g.i, true), label: clean(label, 40) || "Manhunt", startAt: g.s, headMin: g.h, durMin: g.d };
    if (g.e) body.endAt = g.e;
    const r = await request("PUT", `/v1/games/${g.i}`, body, 10000);
    return { ok: r.ok, status: r.status, data: r.ok ? sanitize(r.data) : null };
  };
  // Followers reuse the leader's last broadcast while it is fresh; if the
  // leader is gone or stuck they fetch for themselves.
  const poll = async (gameId) => {
    if (!enabled() || !ID_OK(gameId)) return { ok: false, status: 0 };
    const sh = shared.get(gameId);
    if (!leader && sh && Date.now() - sh.at < 12000) return { ok: true, status: 200, data: sh.data, skew: 0, viaLeader: true };
    const r = await request("GET", `/v1/games/${gameId}?pid=${pid(gameId)}`, null, 6000);
    const data = r.ok ? sanitize(r.data) : null;
    if (!data) return { ok: false, status: r.ok ? 0 : r.status };
    if (leader) post({ t: "state", id: gameId, data: r.data });
    return { ok: true, status: r.status, data, skew: data.serverTime ? data.serverTime - Date.now() : 0 };
  };
  const endGame = async (gameId) => {
    const key = hostKeyFor(gameId, false);
    if (!enabled() || !ID_OK(gameId) || !key) return { ok: false, status: 0 };
    const r = await request("POST", `/v1/games/${gameId}/end`, { hostKey: key }, 10000);
    return { ok: r.ok, status: r.status, data: r.ok ? sanitize(r.data) : null };
  };
  const pending = (gameId) => readBox().filter((e) => !gameId || e.g === gameId).length;
  const hostKey = (gameId) => hostKeyFor(gameId, false);
  const isLeader = () => leader;

  window.MHSync = { enabled, join, report, ping, createGame, poll, endGame, hasHostKey, hostKey, adoptHostKey, pending, flush, isLeader };
  if (enabled() && readBox().length) setTimeout(flush, 500);
})();
