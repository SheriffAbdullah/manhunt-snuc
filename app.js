// Manhunt PWA. No backend: the whole game lives in the share link (URL hash),
// so every phone computes the same clock from the same start time.
(() => {
  const C = window.CAMPUS;
  const $app = document.getElementById("app");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ---- tiny DOM helper -------------------------------------------------------
  // Children are always text nodes or elements, never HTML strings, so data from
  // a link can be shown without escaping.
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(2)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const ICONS = {
    target: "M12 2v3M12 19v3M2 12h3M19 12h3M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3",
    share: "M12 3v13M7 8l5-5 5 5M5 13v6h14v-6",
    sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l-1.4-1.4M20.4 20.4L19 19M19 5l1.4-1.4M3.6 20.4L5 19M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
    moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    back: "M15 5l-7 7 7 7",
    pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
    check: "M5 12.5l4.5 4.5L19 7",
    alert: "M12 3L2 20h20L12 3zM12 10v4M12 17v1",
  };
  const icon = (name, size = 20) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[name]); s.append(p);
    return s;
  };

  // ---- theme -----------------------------------------------------------------
  const THEMES = ["auto", "dark", "light"];
  const applyTheme = () => { const t = store.get("manhunt:theme", "auto"); document.documentElement.dataset.theme = t; return t; };
  const themeButton = () => {
    const b = h("button", { class: "icon-btn", type: "button", "aria-label": "Switch colour theme", title: "Theme" });
    const paint = () => { const t = applyTheme(); b.replaceChildren(icon(t === "light" ? "sun" : "moon"), h("span", { class: "sr-only" }, `Theme: ${t}`)); };
    b.addEventListener("click", () => { const t = store.get("manhunt:theme", "auto"); store.set("manhunt:theme", THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]); paint(); toast(`Theme: ${applyTheme()}`); });
    paint();
    return b;
  };

  const shell = (...nodes) => {
    const bar = h("header", { class: "topbar" },
      h("a", { class: "brand", href: "#", "aria-label": "Manhunt home" }, icon("target", 22), h("span", {}, "Manhunt"), h("span", { class: "brand-sub" }, C.name)),
      themeButton());
    $app.replaceChildren(bar, h("div", { class: "screen" }, ...nodes));
    window.scrollTo(0, 0);
  };
  const mount = (...nodes) => { $app.replaceChildren(...nodes); window.scrollTo(0, 0); };

  let toastTimer = null;
  const toast = (msg) => {
    let t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  };

  // ---- game encoding -----------------------------------------------------------
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
  const readHash = (key) => {
    const m = location.hash.match(new RegExp(`^#${key}=([\\w-]+)$`));
    if (!m || m[1].length > HASH_MAX) return null;
    try { return validateGame(dec(m[1])); } catch { return null; }
  };
  // Wire form only: strip derived fields before encoding.
  const wire = (g, role) => { const { map, ...rest } = g; return { ...rest, r: role }; };
  const linkFor = (g, role) => `${location.origin}${location.pathname}#g=${enc(wire(g, role))}`;
  const lobbyHash = (g) => `#lobby=${enc(wire(g, "r"))}`;

  // ---- identity (random, impersonal) -------------------------------------------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
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

  // ---- time ---------------------------------------------------------------------
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
  };
  const clockTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const whenText = (t) => (sameDay(t, Date.now()) ? `today ${clockTime(t)}` : new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

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

  let timer = null;
  const clearTimer = () => { if (timer) clearInterval(timer); timer = null; };

  // ---- cues: vibration + a short beep ----------------------------------------
  let audio = null;
  const unlockAudio = () => { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch {} };
  addEventListener("pointerdown", unlockAudio, { passive: true });
  const soundOn = () => store.get("manhunt:sound", true);
  const beep = (notes) => {
    if (!soundOn() || !audio || audio.state !== "running") return;
    let t = audio.currentTime;
    for (const [freq, dur] of notes) {
      const o = audio.createOscillator(), gnode = audio.createGain();
      o.type = "square"; o.frequency.value = freq;
      gnode.gain.setValueAtTime(0.0001, t); gnode.gain.exponentialRampToValueAtTime(0.25, t + 0.02); gnode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gnode).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
      t += dur + 0.06;
    }
  };
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  const CUES = {
    head: () => { vibrate([300, 100, 300]); beep([[660, 0.12], [880, 0.2]]); },
    hunt: () => { vibrate([200, 80, 200, 80, 600]); beep([[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.35]]); },
    over: () => { vibrate([800]); beep([[784, 0.15], [523, 0.15], [392, 0.4]]); },
    soon: () => { vibrate([120]); beep([[988, 0.08]]); },
    warn: () => { vibrate([250, 100, 250]); beep([[220, 0.25], [220, 0.25]]); },
  };

  // ---- wake lock -------------------------------------------------------------------
  let wake = null, wantWake = false, wakeListener = null;
  const requestWake = async () => {
    if (!wantWake || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } catch { wake = null; }
    document.dispatchEvent(new Event("mh:wake"));
  };
  const releaseWake = () => { wantWake = false; try { wake && wake.release(); } catch {} wake = null; };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestWake(); });

  // ---- recent games (local only, so a closed tab can find its way back) --------
  const remember = (g, label) => {
    const list = store.get("manhunt:recent", []).filter((x) => x && x.i !== g.i);
    list.unshift({ i: g.i, l: label, s: g.s, r: g.r, hash: `g=${enc(wire(g, g.r))}` });
    store.set("manhunt:recent", list.slice(0, 6));
  };

  // ---- shared bits -----------------------------------------------------------------
  const nav = (hash) => { location.hash = hash; };
  const copyOrShare = async (text, { title = "Manhunt", url } = {}) => {
    try {
      if (navigator.share) { await navigator.share(url ? { title, text, url } : { title, text }); return true; }
    } catch (e) { if (e && e.name === "AbortError") return false; }
    try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); toast("Copied"); return true; }
    catch { toast("Couldn't copy. Long-press the text instead."); return false; }
  };
  const sheet = (title, ...body) => {
    const d = h("dialog", { class: "sheet", "aria-label": title });
    d.append(h("div", { class: "sheet-body" }, h("h2", { class: "sheet-title" }, title), ...body,
      h("button", { class: "ghost", type: "button", onclick: () => d.close() }, "Close")));
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.append(d); d.showModal();
    return d;
  };

  const safetyCard = ({ compact = false } = {}) => h("div", { class: "card safety" },
    h("div", { class: "card-head" }, icon("alert"), h("strong", {}, "Always off limits")),
    h("ul", {}, C.offLimits.map((x) => h("li", {}, x))),
    C.safety.phone ? h("p", {}, `${C.safety.label}: `, h("a", { href: `tel:${C.safety.phone}` }, C.safety.phone)) : null,
    compact ? null : h("p", { class: "muted" }, "Never run into traffic. Stop the game if anyone is hurt or uncomfortable."));

  const sosSheet = (name) => sheet("Stop the game",
    h("p", {}, "Tell everyone near you to stop. Walk, don't run, to the meeting point."),
    C.safety.phone
      ? h("a", { class: "btn hunter", href: `tel:${C.safety.phone}` }, `Call ${C.safety.label} (${C.safety.phone})`)
      : h("p", { class: "muted" }, "No campus security number is set in this app. Call the host or security directly."),
    h("button", { class: "ghost", type: "button", onclick: () => copyOrShare(`STOP the Manhunt game now. ${name} says everyone back to the meeting point.`) }, "Send a STOP message to the group"),
    safetyCard({ compact: true }));

  // ---- home -----------------------------------------------------------------------
  function home() {
    clearTimer(); releaseWake();
    const name = codename();
    const seen = store.get("manhunt:seen", false);
    const recent = store.get("manhunt:recent", []).filter((x) => x && typeof x.hash === "string" && /^g=[\w-]+$/.test(x.hash));
    const paste = h("input", { type: "url", inputmode: "url", placeholder: "Paste a game link", "aria-label": "Paste a game link" });
    const join = () => {
      const m = paste.value.match(/#(g=[\w-]+)/);
      if (!m) return toast("That isn't a game link.");
      nav(m[1]);
    };
    paste.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    shell(
      h("section", { class: "hero" },
        h("h1", {}, "Campus ", h("em", {}, "Manhunt")),
        h("p", { class: "lede" }, "Runners hide and move. Hunters chase. One link, every phone on the same clock. No accounts, no names, no tracking.")),
      h("button", { class: "primary big", onclick: () => nav("host") }, "Host a game"),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("strong", {}, "Joining a game?")),
        h("p", { class: "muted" }, "Open the link your host sent. It brings you straight in with your role."),
        h("div", { class: "row join" }, paste, h("button", { class: "ghost", onclick: join }, "Go"))),
      recent.length ? h("div", { class: "card" },
        h("div", { class: "card-head" }, h("strong", {}, "Your games")),
        h("ul", { class: "list" }, recent.map((x) => {
          const p = phaseOf({ s: x.s, h: 0, d: 0 }, Date.now());
          const tag = Date.now() < x.s ? "upcoming" : "";
          return h("li", {}, h("a", { href: `#${x.hash}` }, h("span", { class: `pill ${x.r === "h" ? "hunter" : "runner"}` }, x.r === "h" ? "Hunter" : "Runner"), " ", x.l), h("span", { class: "muted" }, tag || whenText(x.s)));
        })),
        h("button", { class: "ghost sm", onclick: () => { store.del("manhunt:recent"); home(); } }, "Clear list")) : null,
      h("details", { class: "card", open: !seen, ontoggle: () => store.set("manhunt:seen", true) },
        h("summary", {}, h("strong", {}, "How to play")),
        h("ol", { class: "steps" },
          h("li", {}, h("b", {}, "Host makes a game."), " Pick a map and a start time. Send the runner link to runners, the hunter link to hunters."),
          h("li", {}, h("b", {}, "Runners get a head start."), " Hunters' phones stay frozen until the countdown hits zero. Everyone's clock is in sync."),
          h("li", {}, h("b", {}, "Tag and log."), " Tagged runner shows their code; hunter logs it. Last runner standing wins."))),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("strong", {}, "Your codename")),
        h("div", { class: "codename" }, name),
        h("p", { class: "muted" }, "Random and private to this phone. Nobody sees your real name."),
        h("button", { class: "ghost sm", onclick: () => { store.del("manhunt:codename"); home(); } }, "New codename")),
      safetyCard(),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => nav("editor") }, "Map editor")),
      h("p", { class: "muted tiny center" }, "Location is read on your phone only and never sent anywhere. Catches are stored on this phone."),
    );
  }

  // ---- host ------------------------------------------------------------------------
  async function host() {
    clearTimer(); releaseWake();
    const lib = await MH.loadLibrary();
    if (!lib.configs.length) return shell(h("h1", {}, "Host a game"), h("div", { class: "card" }, "No maps could be loaded. Check your connection and try again."), h("button", { class: "ghost", onclick: () => nav("") }, "Back"));
    const draft = store.get("manhunt:draft", {}) || {};
    const roundUp5 = (d) => new Date(Math.ceil(d.getTime() / 300000) * 300000);
    const start = roundUp5(new Date(Date.now() + 15 * 60000));

    // 1. Map
    const about = h("p", { class: "muted" });
    const zone = h("select", { id: "zone" }, lib.configs.map((c) => h("option", { value: c.id, selected: c.id === draft.c }, c.label + (lib.customConfigIds.has(c.id) ? " (custom)" : ""))));
    const mapEl = h("div", { class: "map preview", "aria-hidden": "true" });
    let map = null, group = null;
    const showAbout = () => {
      const cfg = MH.resolve(lib, zone.value);
      about.textContent = cfg ? (cfg.about || `${cfg.play.length} play area${cfg.play.length === 1 ? "" : "s"}, ${cfg.nogo.length} no-go zone${cfg.nogo.length === 1 ? "" : "s"}.`) : "";
      if (map) MH.drawConfig(map, group, cfg);
    };
    zone.addEventListener("change", showAbout); showAbout();
    queueMicrotask(() => {
      if (!MH.hasLeaflet()) { mapEl.replaceChildren(h("div", { class: "map-fallback" }, "Map preview needs a connection.")); return; }
      map = MH.newMap(mapEl); map.dragging.disable(); map.scrollWheelZoom.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable(); map.zoomControl.remove();
      group = L.layerGroup().addTo(map); showAbout();
    });

    // 2. When
    const when = h("input", { type: "datetime-local", id: "when", value: toLocalInput(draft.s && draft.s > Date.now() ? new Date(draft.s) : start) });
    const chips = h("div", { class: "chips", role: "group", "aria-label": "Quick start times" }, [5, 15, 30].map((m) => h("button", { class: "chip", type: "button", onclick: () => { when.value = toLocalInput(roundUp5(new Date(Date.now() + m * 60000))); } }, `In ${m} min`)));
    const sel = (id, opts, val, unit) => h("select", { id }, opts.map((v) => h("option", { value: v, selected: v === val }, `${v} ${unit}`)));
    const head = sel("head", [0, 2, 3, 5, 10, 15, 20, 30], draft.h ?? C.defaults.headStartMin, "min");
    const dur = sel("dur", [10, 15, 20, 30, 45, 60, 90, 120, 180], draft.d ?? C.defaults.durationMin, "min");

    // 3. Options
    const stop = h("input", { type: "time", id: "stop", value: draft.e ? new Date(draft.e).toTimeString().slice(0, 5) : "" });
    const convert = h("input", { type: "checkbox", id: "convert", checked: !!draft.k });

    const create = () => {
      const s = new Date(when.value).getTime();
      if (!Number.isFinite(s)) return toast("Pick a valid start time.");
      if (s < Date.now() - 60000) return toast("Start time is in the past.");
      const g = { i: Math.random().toString(36).slice(2, 8), c: zone.value, s, h: +head.value, d: +dur.value, r: "r" };
      if (stop.value) {
        const [hh, mm] = stop.value.split(":").map(Number);
        let e = new Date(s); e.setHours(hh, mm, 0, 0); e = e.getTime();
        if (e <= s) e += 86400000; // a stop time earlier than the start means tomorrow
        if (e < s + 60000 || e > s + 48 * 3600000) return toast("Hard stop must be after the start.");
        g.e = e;
      }
      if (convert.checked) g.k = true;
      // Custom maps only exist on this phone, so ship them inside the link.
      if (lib.customConfigIds.has(g.c)) { g.x = MH.pack(MH.resolve(lib, g.c)); delete g.c; }
      const v = validateGame(g);
      if (!v) return toast("Something is off with these settings.");
      store.set("manhunt:draft", { c: zone.value, h: g.h, d: g.d, k: !!g.k, e: g.e, s });
      nav(lobbyHash(v).slice(1));
    };

    shell(
      h("div", { class: "page-head" }, h("a", { class: "icon-btn", href: "#", "aria-label": "Back" }, icon("back")), h("h1", {}, "Host a game")),
      h("section", { class: "step" },
        h("div", { class: "step-head" }, h("span", { class: "step-n" }, "1"), h("h2", {}, "Map")),
        h("label", { for: "zone", class: "sr-only" }, "Map"), zone, about, mapEl,
        h("button", { class: "ghost sm", onclick: () => nav("editor") }, "Draw or edit maps")),
      h("section", { class: "step" },
        h("div", { class: "step-head" }, h("span", { class: "step-n" }, "2"), h("h2", {}, "When")),
        h("label", { for: "when" }, "Start time"), when, chips,
        h("div", { class: "row" },
          h("div", {}, h("label", { for: "head" }, "Head start"), head),
          h("div", {}, h("label", { for: "dur" }, "Hunt length"), dur)),
        h("p", { class: "muted tiny" }, "Hunters' phones unlock tagging when the head start ends. Phones must have automatic time on.")),
      h("section", { class: "step" },
        h("div", { class: "step-head" }, h("span", { class: "step-n" }, "3"), h("h2", {}, "Options")),
        h("label", { class: "switch" }, convert, h("span", {}, "Caught runners become hunters")),
        h("label", { for: "stop" }, "Hard stop (optional)"), stop,
        h("p", { class: "muted tiny" }, "Hostel curfew? The game ends at this time no matter what.")),
      h("div", { class: "sticky-actions" }, h("button", { class: "primary big", onclick: create }, "Create game")),
    );
  }

  // ---- lobby -------------------------------------------------------------------------
  let qrLoading = null;
  const loadQr = () => qrLoading || (qrLoading = new Promise((res, rej) => {
    if (window.qrcode) return res(window.qrcode);
    const s = document.createElement("script"); s.src = "vendor/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = () => { qrLoading = null; rej(new Error("qr")); };
    document.head.append(s);
  }));
  const qrSvg = (url) => {
    const q = window.qrcode(0, "L"); q.addData(url); q.make();
    const n = q.getModuleCount(), cell = 4, m = 2 * cell, size = n * cell + 2 * m;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("shape-rendering", "crispEdges"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "QR code for the join link");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect"); bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff"); svg.append(bg);
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${m + c * cell} ${m + r * cell}h${cell}v${cell}h-${cell}z`;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "#000"); svg.append(p);
    return svg;
  };

  async function lobby(g) {
    clearTimer(); releaseWake();
    const lib = g.map ? null : await MH.loadLibrary();
    const cfg = g.map || MH.resolve(lib, g.c);
    const label = cfg ? cfg.label : "Unknown map";
    let role = "r";
    const links = { r: linkFor(g, "r"), h: linkFor(g, "h") };
    const long = links.r.length > 1800;

    const seg = h("div", { class: "seg", role: "tablist" });
    const qrBox = h("div", { class: "qr" });
    const linkBox = h("div", { class: "linkbox" });
    const shareBtn = h("button", { class: "big" });
    const openBtn = h("button", { class: "ghost" });
    const paintRole = () => {
      const isH = role === "h", word = isH ? "Hunter" : "Runner";
      seg.replaceChildren(...["r", "h"].map((k) => h("button", { class: `seg-btn ${k === "h" ? "hunter" : "runner"}`, role: "tab", "aria-selected": String(k === role), onclick: () => { role = k; paintRole(); } }, k === "h" ? "Hunter link" : "Runner link")));
      linkBox.textContent = links[role];
      shareBtn.className = `big ${isH ? "hunter" : "runner"}`; shareBtn.replaceChildren(icon("share"), ` Share ${word.toLowerCase()} link`);
      shareBtn.onclick = () => copyOrShare(`Join our Manhunt as a ${word.toLowerCase()}. Starts ${whenText(g.s)}.`, { title: `Manhunt: ${word.toLowerCase()} link`, url: links[role] });
      openBtn.textContent = `Open on this phone as ${word.toLowerCase()}`;
      openBtn.onclick = () => nav(`g=${enc(wire(g, role))}`);
      qrBox.replaceChildren(h("p", { class: "muted tiny center" }, "Loading QR…"));
      if (long) { qrBox.replaceChildren(h("p", { class: "muted tiny" }, "This map is too detailed for a QR code. Share the link instead.")); return; }
      loadQr().then(() => { if (!document.body.contains(qrBox)) return; qrBox.replaceChildren(qrSvg(links[role]), h("p", { class: "muted tiny center" }, `${word}s scan this with their camera`)); })
        .catch(() => qrBox.replaceChildren(h("p", { class: "muted tiny" }, "QR unavailable offline. Share the link instead.")));
    };
    paintRole();

    const count = h("div", { class: "clock sm" });
    const tick = () => { const p = phaseOf(g, Date.now()); count.textContent = p.key === "pre" ? fmt(p.left) : p.key === "over" ? "Over" : "Live"; };
    tick(); timer = setInterval(tick, 1000);
    const { end } = times(g);

    shell(
      h("div", { class: "page-head" }, h("a", { class: "icon-btn", href: "#", "aria-label": "Home" }, icon("back")), h("h1", {}, "Game ready")),
      h("div", { class: "card summary" },
        h("div", { class: "kv" }, h("span", {}, "Map"), h("b", {}, label)),
        h("div", { class: "kv" }, h("span", {}, "Starts"), h("b", {}, whenText(g.s))),
        h("div", { class: "kv" }, h("span", {}, "Head start"), h("b", {}, `${g.h} min`)),
        h("div", { class: "kv" }, h("span", {}, "Hunt"), h("b", {}, `${g.d} min · ends ${clockTime(end)}`)),
        g.e ? h("div", { class: "kv" }, h("span", {}, "Hard stop"), h("b", {}, clockTime(g.e))) : null,
        g.k ? h("div", { class: "kv" }, h("span", {}, "Mode"), h("b", {}, "Caught runners join the hunt")) : null,
        h("div", { class: "kv" }, h("span", {}, "Starts in"), count),
        h("button", { class: "ghost sm", onclick: () => { store.set("manhunt:draft", { c: g.c, h: g.h, d: g.d, k: !!g.k, e: g.e, s: g.s }); nav("host"); } }, "Change settings")),
      h("p", { class: "muted" }, "Send the runner link to runners and the hunter link to hunters. The role is baked into the link."),
      seg,
      h("div", { class: "card" }, qrBox, linkBox, shareBtn),
      openBtn,
      h("p", { class: "muted tiny" }, `Phone time now: ${new Date().toLocaleTimeString()}. Every phone must have automatic date & time on, or countdowns will differ.`),
    );
  }

  // ---- play ------------------------------------------------------------------------------
  async function play(g) {
    clearTimer();
    const name = codename();
    const lib = g.map ? null : await MH.loadLibrary();
    const cfg = g.map || MH.resolve(lib, g.c);
    const label = cfg ? cfg.label : "Unknown map";
    remember(g, label);
    const keyOut = `manhunt:out:${g.i}`, keyLog = `manhunt:log:${g.i}`, keyRole = `manhunt:role:${g.i}`;
    const converted = g.r === "r" && store.get(keyRole) === "h";
    const isHunter = g.r === "h" || converted;
    const myCode = myTagCode(g.i, name);
    const skewed = g.s - Date.now() > 36 * 3600000;

    wantWake = true; requestWake();

    const clock = h("div", { class: "clock", "aria-live": "off" });
    const phaseEl = h("div", { class: "phase" });
    const subEl = h("div", { class: "phase-sub" });
    const band = h("section", { class: "band" }, phaseEl, clock, subEl);
    const action = h("div");
    const bottom = h("div", { class: "sticky-actions" });

    const PHASE = {
      pre: { label: "Starts in", sub: (p) => `Head start ${clockTime(g.s)} · hunters released ${clockTime(p.headEnd)}` },
      head: { label: isHunter ? "Hunters frozen" : "Head start. Run!", sub: (p) => (isHunter ? `Released at ${clockTime(p.headEnd)}` : `Hunters released at ${clockTime(p.headEnd)}`) },
      hunt: { label: "Hunt ends in", sub: (p) => `Ends ${clockTime(p.end)}${g.e && g.e === p.end ? " (hard stop)" : ""}` },
      over: { label: "Game over", sub: (p) => `Ended ${clockTime(p.end)}` },
    };

    const runnerPanel = (p) => {
      const out = store.get(keyOut, null);
      if (out) {
        return h("div", { class: "card" },
          h("div", { class: "card-head" }, h("strong", {}, "You're out"), h("span", { class: "muted" }, typeof out === "object" ? clockTime(out.t) : "")),
          h("p", { class: "muted" }, g.k ? "Caught runners hunt now. Switch roles when you're ready." : "Head to the meeting point and cheer on the others."),
          g.k && p.key !== "over" ? h("button", { class: "hunter", onclick: () => { store.set(keyRole, "h"); play(g); } }, "Join the hunters") : null,
          h("button", { class: "ghost sm", onclick: () => { store.del(keyOut); render(true); } }, "Undo (misclick)"));
      }
      if (p.key === "over") return h("div", { class: "card result" }, h("div", { class: "card-head" }, icon("check"), h("strong", {}, "You survived")), h("p", { class: "muted" }, `Never caught in ${g.d} minutes of hunting.`), resultButtons());
      return h("div", { class: "card tag" },
        h("p", { class: "muted" }, "Tagged? Show the hunter this, then press the button below."),
        h("div", { class: "code-name" }, name.toUpperCase()),
        h("div", { class: "code-digits" }, myCode));
    };

    const hunterLog = () => store.get(keyLog, []).filter((e) => e && typeof e.c === "string");
    const hunterPanel = (p) => {
      const log = hunterLog();
      return h("div", {},
        converted ? h("p", { class: "muted tiny center" }, "You were caught and joined the hunters.") : null,
        p.key === "head" ? h("div", { class: "card frozen" }, h("strong", {}, "Stay at the start point."), h("p", { class: "muted" }, "Tagging unlocks when the countdown ends.")) : null,
        p.key === "pre" ? h("div", { class: "card" }, h("strong", {}, "Waiting for kickoff."), h("p", { class: "muted" }, "Runners get a head start, then you're released.")) : null,
        h("div", { class: `card ${p.key === "over" ? "result" : ""}` },
          h("div", { class: "card-head" }, h("strong", {}, p.key === "over" ? `Final: ${log.length} catch${log.length === 1 ? "" : "es"}` : `Catches: ${log.length}`), h("span", { class: "muted tiny" }, "this phone")),
          log.length ? h("ul", { class: "log" }, log.map((e) => h("li", {}, h("b", {}, e.n || "Unknown runner"), h("span", { class: "muted" }, ` ${e.c} · ${clockTime(e.t)}`)))) : h("p", { class: "muted" }, "No catches logged."),
          p.key === "over" ? resultButtons() : null));
    };

    const resultText = () => {
      const log = hunterLog(), out = store.get(keyOut, null);
      const head = `Manhunt · ${label} · ${whenText(g.s)}`;
      if (isHunter) return `${head}\nHunter ${name}: ${log.length} catch${log.length === 1 ? "" : "es"}\n${log.map((e) => `• ${e.n || "?"} (${e.c}) ${clockTime(e.t)}`).join("\n")}`.trim();
      return `${head}\nRunner ${name}: ${out ? `caught at ${clockTime(typeof out === "object" ? out.t : times(g).end)}` : "survived"}`;
    };
    const resultButtons = () => h("div", { class: "row" },
      h("button", { class: "ghost sm", onclick: () => copyOrShare(resultText(), { title: "Manhunt results" }) }, icon("share", 16), " Share result"),
      h("button", { class: "ghost sm", onclick: () => nav("host") }, "Host another"));

    // Hunter: verify a tag before logging it.
    const catchSheet = () => {
      const adj = h("select", { "aria-label": "First word of codename" }, h("option", { value: "" }, "First word…"), C.adjectives.map((a) => h("option", { value: a }, a)));
      const noun = h("select", { "aria-label": "Second word of codename" }, h("option", { value: "" }, "Second word…"), C.nouns.map((a) => h("option", { value: a }, a)));
      const code = h("input", { inputmode: "numeric", pattern: "[0-9]*", maxlength: 4, autocomplete: "off", placeholder: "4 digits", "aria-label": "Runner tag code", class: "code-input" });
      const err = h("p", { class: "err", role: "alert" });
      const d = sheet("Log a catch",
        h("p", { class: "muted" }, "Read the runner's screen: two words and four digits."),
        h("div", { class: "row" }, adj, noun), code, err,
        h("button", { class: "hunter big", onclick: () => {
          const n = `${adj.value} ${noun.value}`, v = code.value.trim();
          if (!adj.value || !noun.value) return (err.textContent = "Pick both words of the codename.");
          if (!/^\d{4}$/.test(v)) return (err.textContent = "Enter the 4 digits.");
          if (!codeMatches(g.i, n, v)) return (err.textContent = `${v} isn't ${n}'s code for this game. Check the words and digits.`);
          const log = hunterLog();
          if (log.some((e) => e.c === v && e.n === n)) return (err.textContent = "Already logged.");
          store.set(keyLog, [...log, { n, c: v, t: Date.now() }]);
          d.close(); vibrate([80, 40, 80]); toast(`Caught ${n}`); render(true);
        } }, "Verify & log"));
      setTimeout(() => adj.focus(), 50);
    };
    const taggedSheet = () => {
      const d = sheet("Were you tagged?",
        h("p", { class: "muted" }, "Show the hunter your code first so they can log it, then confirm."),
        h("div", { class: "code-name" }, name.toUpperCase()), h("div", { class: "code-digits" }, myCode),
        h("button", { class: "runner big", onclick: () => { store.set(keyOut, { t: Date.now() }); d.close(); vibrate([400]); render(true); } }, "Yes, I'm out"));
    };

    let lastKey = null, soonDone = false;
    const render = (force) => {
      const now = Date.now(), p = phaseOf(g, now);
      clock.textContent = fmt(p.left);
      if (p.key === "hunt" && p.left <= 60000 && !soonDone) { soonDone = true; CUES.soon(); }
      if (p.key === lastKey && !force) return;
      if (lastKey && p.key !== lastKey && CUES[p.key]) CUES[p.key]();
      lastKey = p.key;
      band.className = `band ${p.key} ${isHunter ? "is-hunter" : "is-runner"}`;
      phaseEl.textContent = PHASE[p.key].label; subEl.textContent = PHASE[p.key].sub(p);
      action.replaceChildren(isHunter ? hunterPanel(p) : runnerPanel(p));
      const out = store.get(keyOut, null);
      bottom.replaceChildren(
        h("button", { class: "ghost sos", onclick: () => sosSheet(name) }, "SOS"),
        isHunter
          ? h("button", { class: "hunter big", disabled: p.key !== "hunt", onclick: catchSheet }, p.key === "hunt" ? "Log a catch" : p.key === "over" ? "Game over" : "Tagging locked")
          : h("button", { class: "runner big", disabled: p.key === "over" || !!out, onclick: taggedSheet }, out ? "You're out" : "I've been tagged"));
      if (p.key === "over") { releaseWake(); }
    };

    const wakeChip = h("span", { class: "chip-status", "aria-live": "polite" });
    const paintWake = () => { wakeChip.textContent = wake ? "Screen stays on" : ("wakeLock" in navigator ? "Screen may sleep" : ""); };
    if (wakeListener) document.removeEventListener("mh:wake", wakeListener);
    wakeListener = paintWake; document.addEventListener("mh:wake", paintWake); paintWake();
    const soundBtn = h("button", { class: "chip-btn", type: "button" });
    const paintSound = () => { soundBtn.textContent = soundOn() ? "Sound on" : "Sound off"; soundBtn.setAttribute("aria-pressed", String(soundOn())); };
    soundBtn.addEventListener("click", () => { store.set("manhunt:sound", !soundOn()); unlockAudio(); paintSound(); if (soundOn()) beep([[880, 0.08]]); });
    paintSound();

    shell(
      h("div", { class: "role-row" },
        h("span", { class: `pill ${isHunter ? "hunter" : "runner"}` }, isHunter ? "Hunter" : "Runner"),
        h("span", { class: "who" }, name),
        wakeChip, soundBtn),
      skewed ? h("div", { class: "notice" }, "This game starts more than a day from now. If that's wrong, check this phone's clock or ask the host for a fresh link.") : null,
      band, action,
      mapCard(cfg, label),
      safetyCard(),
      h("button", { class: "ghost", onclick: () => { if (confirm("Leave this game screen? Your link still works.")) nav(""); } }, "Leave game"),
      h("div", { class: "bottom-space" }),
      bottom,
    );
    render(true);
    timer = setInterval(() => render(false), 1000);
  }

  // Live map. Your position is read on this phone only and never sent anywhere.
  function mapCard(cfg, label) {
    if (!cfg) return h("div", { class: "card" }, h("strong", {}, "Map unavailable"), h("p", { class: "muted" }, "This link refers to a map that isn't on this phone. Ask the host to resend the link."));
    const el = h("div", { class: "map small" });
    const status = h("div", { class: "status", role: "status" }, "Location off");
    const since = h("div", { class: "muted tiny center" });
    const note = h("p", { class: "muted tiny" });
    const btn = h("button", { class: "ghost" }, icon("pin", 18), " Show me on the map");
    let map = null, group = null, dot = null, ring = null, watch = null, last = "ok", lastChange = 0;
    const draw = () => {
      if (!MH.hasLeaflet()) { el.replaceChildren(h("div", { class: "map-fallback" }, "Satellite map can't load right now (offline?). Boundary warnings still work.")); return; }
      map = MH.newMap(el, { onTileError: () => { note.textContent = "Satellite imagery isn't loading (weak signal?). The zones and your position still work."; } });
      group = L.layerGroup().addTo(map);
      MH.drawConfig(map, group, cfg);
    };
    queueMicrotask(draw);
    const onPos = (p) => {
      const { latitude: la, longitude: lo, accuracy } = p.coords;
      if (map) {
        if (!dot) { ring = L.circle([la, lo], { radius: accuracy || 0, color: "#4aa3ff", weight: 1, fillOpacity: 0.1 }).addTo(map); dot = L.circleMarker([la, lo], { radius: 8, color: "#fff", fillColor: "#4aa3ff", fillOpacity: 1, weight: 3 }).addTo(map); map.setView([la, lo], Math.max(map.getZoom(), 17)); }
        else { dot.setLatLng([la, lo]); ring.setLatLng([la, lo]); ring.setRadius(accuracy || 0); }
      }
      const r = MH.check(cfg, la, lo);
      status.className = "status " + r.s;
      status.textContent = r.s === "ok" ? "In bounds" : r.s === "out" ? "OUT OF BOUNDS. Head back to the green area." : `NO-GO ZONE: ${r.n}. Leave now.`;
      if (r.s !== last) { lastChange = Date.now(); if (r.s !== "ok") CUES.warn(); last = r.s; }
      since.textContent = r.s === "ok" ? (accuracy ? `GPS accuracy ±${Math.round(accuracy)} m` : "") : `for ${fmt(Date.now() - lastChange)}`;
    };
    btn.addEventListener("click", () => {
      if (!navigator.geolocation) return (status.textContent = "Location isn't supported on this phone.");
      if (watch != null) return;
      status.textContent = "Finding you…";
      watch = navigator.geolocation.watchPosition(onPos, (e) => {
        watch = null; status.className = "status";
        status.textContent = e && e.code === 1 ? "Location blocked. Allow it for this site in your browser settings." : "Couldn't get a fix. Try again outdoors.";
        btn.hidden = false;
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      btn.hidden = true;
    });
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("strong", {}, label), h("span", { class: "muted tiny" }, "green = play · red = no-go")),
      el, note, status, since, btn,
      h("p", { class: "muted tiny" }, "Your position stays on this phone. It is never sent anywhere."));
  }

  // ---- routing -------------------------------------------------------------------------------
  const notFound = () => { clearTimer(); releaseWake(); shell(h("h1", {}, "That link doesn't work"), h("div", { class: "card" }, h("p", {}, "The game link is incomplete or was made by a different version of the app."), h("p", { class: "muted" }, "Ask the host to share it again.")), h("button", { class: "primary", onclick: () => nav("") }, "Go home")); };
  function route() {
    document.querySelectorAll("dialog.sheet").forEach((d) => d.remove());
    const hsh = location.hash;
    if (hsh === "#editor") { clearTimer(); releaseWake(); return MHEditor.show({ h, mount: shell, icon, toast, exit: () => nav("") }); }
    if (hsh === "#host") return host();
    if (hsh.startsWith("#lobby=")) { const g = readHash("lobby"); return g ? lobby(g) : notFound(); }
    if (hsh.startsWith("#g=") || hsh.startsWith("#g")) { const g = readHash("g"); return g ? play(g) : notFound(); }
    home();
  }
  applyTheme();
  addEventListener("hashchange", route);
  route();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
