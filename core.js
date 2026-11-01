// Game model: the link encoding, its validation, impersonal identity (codename,
// tag code) and the phase clock. Pure functions apart from the identity store.
window.MHCore = (() => {
  const C = window.CAMPUS;
  const { store } = window.MHUI;

  // ---- link encoding ----------------------------------------------------------
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  const HASH_MAX = 24000;

  // The hash is attacker-controlled. Every field is checked for type and range,
  // and inline maps are rebuilt through MH.unpack, so nothing downstream has to.
  const YEAR = (y) => Date.UTC(y, 0, 1);
  const validateGame = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
    const i = typeof raw.i === "string" && /^[a-z0-9]{3,12}$/.test(raw.i) ? raw.i : null;
    const s = int(raw.s, YEAR(2024), YEAR(2100));
    const hd = int(raw.h, 0, 60), d = int(raw.d, 5, 240);
    const r = raw.r === "h" || raw.r === "r" ? raw.r : null;
    if (!i || s === null || hd === null || d === null || !r) return null;
    const g = { i, s, h: hd, d, r };
    if (raw.x !== undefined) { g.map = MH.unpack(raw.x); if (!g.map) return null; g.x = raw.x; }
    else if (typeof raw.c === "string" && /^[\w-]{1,40}$/.test(raw.c)) g.c = raw.c;
    else return null;
    if (raw.e !== undefined) { const e = int(raw.e, s + 60000, s + 48 * 3600000); if (e === null) return null; g.e = e; }
    if (raw.k === true) g.k = true;
    return g;
  };
  // `#g=<payload>` optionally followed by `&hk=<host key>` (host backup link).
  // The hash never leaves the phone: browsers don't send it with requests.
  const readHash = (key) => {
    const m = location.hash.match(new RegExp(`^#${key}=([\\w-]+)(?:&hk=([\\w-]{16,64}))?$`));
    if (!m || m[1].length > HASH_MAX) return null;
    try { const g = validateGame(dec(m[1])); return g ? { game: g, hostKey: m[2] || null } : null; } catch { return null; }
  };
  // Wire form only: strip derived fields before encoding.
  const wire = (g, role) => { const { map, ...rest } = g; return { ...rest, r: role }; };
  const linkFor = (g, role) => `${location.origin}${location.pathname}#g=${enc(wire(g, role))}`;
  const lobbyHash = (g) => `#lobby=${enc(wire(g, "r"))}`;

  // ---- identity (random, impersonal) -------------------------------------------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const newGameId = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join(""); };
  const codename = () => {
    let n = store.get("manhunt:codename");
    if (!n || typeof n !== "string" || !C.adjectives.includes(n.split(" ")[0]) || !C.nouns.includes(n.split(" ")[1])) {
      n = `${pick(C.adjectives)} ${pick(C.nouns)}`; store.set("manhunt:codename", n);
    }
    return n;
  };
  const hash32 = (str) => { let x = 2166136261; for (const ch of str) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; };
  // Tag code = 2 random digits (fixed per phone per game, so two "Quiet Otters"
  // get different codes) + 2 check digits derived from game, codename and the
  // random part. A hunter's phone can verify a code without any server.
  const checkDigits = (gameId, name, rnd) => String(hash32(`${gameId}|${name}|${rnd}`) % 100).padStart(2, "0");
  const myTagCode = (gameId, name) => {
    const k = `manhunt:tag:${gameId}`;
    let rnd = store.get(k);
    if (!/^\d{2}$/.test(rnd || "")) { rnd = String(Math.floor(Math.random() * 100)).padStart(2, "0"); store.set(k, rnd); }
    return rnd + checkDigits(gameId, name, rnd);
  };
  const codeMatches = (gameId, name, code) => /^\d{4}$/.test(code) && code.slice(2) === checkDigits(gameId, name, code.slice(0, 2));

  // ---- phase clock ------------------------------------------------------------------
  // Hard stop (curfew) shortens the game; it can cut into the head start too.
  const times = (g) => {
    let headEnd = g.s + g.h * 60000, end = headEnd + g.d * 60000;
    if (g.e && g.e < end) { end = g.e; headEnd = Math.min(headEnd, end); }
    return { headEnd, end };
  };
  const phaseOf = (g, now) => {
    const { headEnd, end } = times(g);
    if (now < g.s) return { key: "pre", left: g.s - now, headEnd, end };
    if (now < headEnd) return { key: "head", left: headEnd - now, headEnd, end };
    if (now < end) return { key: "hunt", left: end - now, headEnd, end };
    return { key: "over", left: 0, headEnd, end };
  };

  // ---- recent games (local only, so a closed tab can find its way back) ------------
  const remember = (g, label) => {
    const list = store.get("manhunt:recent", []).filter((x) => x && x.i !== g.i);
    list.unshift({ i: g.i, l: label, s: g.s, e: times(g).end, r: g.r, hash: `g=${enc(wire(g, g.r))}` });
    store.set("manhunt:recent", list.slice(0, 6));
  };

  return { enc, dec, validateGame, readHash, wire, linkFor, lobbyHash, newGameId, codename, myTagCode, codeMatches, times, phaseOf, remember };
})();
