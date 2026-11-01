// Optional live scoreboard sync (see server/API.md). Entirely off when
// CAMPUS.api is empty: no network calls, no UI. Only ever sends the random
// codename, the random game id, join/catch/out events and the host key.
// Never location. Every call here returns a result object and never throws.
(() => {
  const C = window.CAMPUS || {};
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

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
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(v || "")) { if (!create) return null; v = rand(32); store.set(k, v); }
    return v;
  };
  const hasHostKey = (gameId) => !!hostKeyFor(gameId, false);
  // Names/labels: the server rejects <>&" and control characters.
  const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>&"]/g, "").trim().slice(0, max);

  const request = async (method, path, body, ms) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(base + path, {
        method, signal: ctl.signal, cache: "no-store", credentials: "omit",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      if (r.status !== 204) { try { data = await r.json(); } catch { data = null; } }
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: null }; }
    finally { clearTimeout(t); }
  };

  // Server data is untrusted: parse it into a fixed shape with bounded strings.
  const num = (v, hi) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.trunc(v))) : 0);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const sanitize = (d) => {
    if (!d || typeof d !== "object") return null;
    const players = d.players && typeof d.players === "object" ? d.players : {};
    return {
      label: str(d.label, 40),
      startAt: num(d.startAt, 1e14), endAt: num(d.endAt, 1e14),
      ended: d.ended === true, endedAt: Number.isFinite(d.endedAt) ? d.endedAt : null,
      hunters: num(players.hunters, 1e6), alive: num(players.alive, 1e6), caught: num(d.caught, 1e6),
      board: (Array.isArray(d.board) ? d.board : []).slice(0, 10).filter((x) => x && typeof x === "object").map((x) => ({ name: str(x.name, 24), catches: num(x.catches, 1e6) })),
      feed: (Array.isArray(d.feed) ? d.feed : []).slice(0, 15).filter((x) => x && typeof x === "object").map((x) => ({ t: num(x.t, 1e14), hunter: x.hunter == null ? null : str(x.hunter, 24), runner: str(x.runner, 24) })),
      serverTime: num(d.serverTime, 1e14),
    };
  };

  // ---- outbox: events wait here until the server has accepted them -----------
  // Events are idempotent server-side, so retrying is always safe. Order within
  // a game matters (join before catch), so one failure pauses that game's queue.
  const BOX = "manhunt:outbox", MAX_ITEMS = 200, MAX_AGE = 36 * 3600000;
  let box = (store.get(BOX, []) || []).filter((e) => e && ID_OK(e.g) && e.b && typeof e.s === "string");
  const save = () => store.set(BOX, box);
  const notify = () => { try { document.dispatchEvent(new CustomEvent("mh:sync", { detail: { pending: box.length } })); } catch {} };
  const sig = (g, b) => [g, b.type, b.pid, b.role || "", b.code || "", b.runner ? `${b.runner.name}#${b.runner.code}` : ""].join("|");
  const DROP = new Set([400, 409, 422]); // invalid, game ended, not joined / full: retrying can't help
  let busy = false, retryTimer = null;

  const schedule = () => {
    clearTimeout(retryTimer); retryTimer = null;
    if (!box.length) return;
    const next = Math.min(...box.map((e) => e.at || 0));
    retryTimer = setTimeout(flush, Math.max(1000, next - Date.now()));
  };
  const flush = async () => {
    if (!enabled() || busy) return;
    busy = true;
    try {
      const paused = new Set();
      for (const e of [...box]) {
        if (paused.has(e.g)) continue;
        const now = Date.now();
        if (now - e.t > MAX_AGE) { box = box.filter((x) => x !== e); continue; }
        if ((e.at || 0) > now) { paused.add(e.g); continue; }
        const r = await request("POST", `/v1/games/${e.g}/events`, e.b, 8000);
        if (r.ok || DROP.has(r.status)) { box = box.filter((x) => x !== e); save(); continue; }
        // Network error, 404 (host hasn't created the game yet), 429, 5xx: back off and keep it.
        e.n = (e.n || 0) + 1;
        e.at = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(e.n, 6)) + Math.random() * 1500;
        paused.add(e.g); save();
      }
    } finally { busy = false; save(); notify(); schedule(); }
  };
  const enqueue = (gameId, body) => {
    if (!enabled() || !ID_OK(gameId)) return;
    const s = sig(gameId, body);
    if (!box.some((e) => e.s === s)) {
      box.push({ s, g: gameId, b: body, t: Date.now(), n: 0, at: 0 });
      if (box.length > MAX_ITEMS) box.splice(0, box.length - MAX_ITEMS);
      save(); notify();
    }
    flush();
  };
  addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { for (const e of box) e.at = 0; flush(); } });

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
  const createGame = async (g, label) => {
    if (!enabled() || !ID_OK(g.i)) return { ok: false, status: 0 };
    const body = { hostKey: hostKeyFor(g.i, true), label: clean(label, 40) || "Manhunt", startAt: g.s, headMin: g.h, durMin: g.d };
    if (g.e) body.endAt = g.e;
    const r = await request("PUT", `/v1/games/${g.i}`, body, 10000);
    return { ok: r.ok, status: r.status, data: r.ok ? sanitize(r.data) : null };
  };
  const poll = async (gameId) => {
    if (!enabled() || !ID_OK(gameId)) return { ok: false, status: 0 };
    const r = await request("GET", `/v1/games/${gameId}`, null, 6000);
    const data = r.ok ? sanitize(r.data) : null;
    if (!data) return { ok: false, status: r.ok ? 0 : r.status };
    return { ok: true, status: r.status, data, skew: data.serverTime ? data.serverTime - Date.now() : 0 };
  };
  const endGame = async (gameId) => {
    const key = hostKeyFor(gameId, false);
    if (!enabled() || !ID_OK(gameId) || !key) return { ok: false, status: 0 };
    const r = await request("POST", `/v1/games/${gameId}/end`, { hostKey: key }, 10000);
    return { ok: r.ok, status: r.status, data: r.ok ? sanitize(r.data) : null };
  };
  const pending = (gameId) => box.filter((e) => !gameId || e.g === gameId).length;

  window.MHSync = { enabled, join, report, createGame, poll, endGame, hasHostKey, pending, flush };
  if (enabled() && box.length) setTimeout(flush, 500);
})();
