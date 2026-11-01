// Campus Manhunt PWA: home, host flow, lobby and routing. The whole game lives
// in the share link (URL hash), so every phone computes the same clock from the
// same start time without a server. The optional live scoreboard (sync.js) is
// layered on top and off by default. The game screen itself is in game.js.
(() => {
  const C = window.CAMPUS;
  const S = window.MHSync;
  const D = window.MHDevice;
  const G = window.MHGame;
  const { store, h, icon, toast, announce, sheet, copyOrShare, fmt, clockTime, whenText, toLocalInput } = window.MHUI;
  const { enc, validateGame, readHash, wire, linkFor, lobbyHash, newGameId, codename, times, phaseOf } = window.MHCore;
  const $app = document.getElementById("app");

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

  // ---- shell -----------------------------------------------------------------
  const storageBanner = () => (store.broken ? h("div", { class: "notice warn" }, "This browser isn't saving data (private mode or storage full). The app works, but nothing survives closing the tab.") : null);
  const shell = (...nodes) => {
    const bar = h("header", { class: "topbar" },
      h("a", { class: "brand", href: "#", "aria-label": "Campus Manhunt home" }, icon("target", 22), h("span", { class: "brand-text" }, h("span", { class: "brand-name" }, "Campus Manhunt"), h("span", { class: "brand-sub" }, C.name))),
      themeButton());
    $app.replaceChildren(bar, h("div", { class: "screen" }, storageBanner(), ...nodes));
    window.scrollTo(0, 0);
  };
  const nav = (hash) => { location.hash = hash; };

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

  // ---- QR (vendor lib loaded on demand) ------------------------------------------
  let qrLoading = null;
  const loadQr = () => qrLoading || (qrLoading = new Promise((res, rej) => {
    if (window.qrcode) return res(window.qrcode);
    const s = document.createElement("script"); s.src = "vendor/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = () => { qrLoading = null; rej(new Error("qr")); };
    document.head.append(s);
  }));
  const qrSvg = async (url, labelText = "QR code for the link") => {
    await loadQr();
    const q = window.qrcode(0, "L"); q.addData(url); q.make();
    const n = q.getModuleCount(), cell = 4, m = 2 * cell, size = n * cell + 2 * m;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`); svg.setAttribute("shape-rendering", "crispEdges"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", labelText);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect"); bg.setAttribute("width", size); bg.setAttribute("height", size); bg.setAttribute("fill", "#fff"); svg.append(bg);
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${m + c * cell} ${m + r * cell}h${cell}v${cell}h-${cell}z`;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "#000"); svg.append(p);
    return svg;
  };

  // ---- home -----------------------------------------------------------------------
  const leaveScreen = () => { G.stop(); D.keepAwake(false); };
  function home() {
    leaveScreen();
    const name = codename();
    const seen = store.get("manhunt:seen", false);
    const recent = store.get("manhunt:recent", []).filter((x) => x && typeof x.hash === "string" && /^g=[\w-]+$/.test(x.hash));
    const paste = h("input", { type: "url", inputmode: "url", placeholder: "Paste a game link", "aria-label": "Paste a game link" });
    const join = () => {
      const m = paste.value.match(/#(g=[\w-]+(?:&hk=[\w-]+)?)/);
      if (!m) return toast("That isn't a game link. It should contain #g=…");
      nav(m[1]);
    };
    paste.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    const stateOf = (x) => {
      const t = Date.now(), ended = store.get(`manhunt:ended:${x.i}`, null);
      if (ended || (x.e && t > x.e)) return { text: "Results", cls: "done" };
      if (t < x.s) return { text: `Starts ${whenText(x.s)}`, cls: "" };
      return { text: "Live now", cls: "live" };
    };
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
          const st = stateOf(x);
          return h("li", {}, h("a", { href: `#${x.hash}` }, h("span", { class: `pill ${x.r === "h" ? "hunter" : "runner"}` }, x.r === "h" ? "Hunter" : "Runner"), " ", x.l), h("span", { class: `muted tiny state ${st.cls}` }, st.text));
        })),
        h("button", { class: "ghost sm", onclick: () => { store.del("manhunt:recent"); home(); } }, "Clear list")) : null,
      h("details", { class: "card", open: !seen, ontoggle: () => store.set("manhunt:seen", true) },
        h("summary", {}, h("strong", {}, "How to play")),
        h("ol", { class: "steps" },
          h("li", {}, h("b", {}, "Host makes a game."), " Pick a map and a start time. Send the runner link to runners, the hunter link to hunters."),
          h("li", {}, h("b", {}, "Runners get a head start."), " Hunters' phones stay frozen until the countdown hits zero. Everyone's clock is in sync."),
          h("li", {}, h("b", {}, "Tag and log."), " Tagged runner shows their code; hunter logs it. Runners still free when time runs out win; catch everyone and the hunters win."))),
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("strong", {}, "Your codename")),
        h("div", { class: "codename" }, name),
        h("p", { class: "muted" }, "Random and private to this phone. Nobody sees your real name."),
        h("button", { class: "ghost sm", onclick: () => { store.del("manhunt:codename"); home(); } }, "New codename")),
      safetyCard(),
      h("div", { class: "row" },
        h("button", { class: "ghost", onclick: () => nav("editor") }, "Map editor")),
      h("p", { class: "muted tiny center" }, "Location is read on your phone only and never sent anywhere. ",
        S.enabled()
          ? "The live scoreboard receives only your random codename, the random game id and catch events. Games are deleted 24 hours after they end."
          : "Catches are stored on this phone."),
      h("p", { class: "muted tiny center about" }, `Made for students of ${C.name}, ${C.place}. Not an official university app.`),
    );
  }

  // ---- host ------------------------------------------------------------------------
  async function host() {
    leaveScreen();
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
      const g = { i: newGameId(), c: zone.value, s, h: +head.value, d: +dur.value, r: "r" };
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
  let lobbyTimer = null;
  async function lobby(g) {
    leaveScreen(); clearInterval(lobbyTimer);
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
      shareBtn.onclick = () => copyOrShare(`Join our Campus Manhunt as a ${word.toLowerCase()}. Starts ${whenText(g.s)}.`, { title: `Campus Manhunt: ${word.toLowerCase()} link`, url: links[role] });
      openBtn.textContent = `Open on this phone as ${word.toLowerCase()}`;
      openBtn.onclick = () => nav(`g=${enc(wire(g, role))}`);
      qrBox.replaceChildren(h("p", { class: "muted tiny center" }, "Loading QR…"));
      if (long) { qrBox.replaceChildren(h("p", { class: "muted tiny" }, "This map is too detailed for a QR code. Share the link instead.")); return; }
      qrSvg(links[role], `QR code for the ${word.toLowerCase()} link`).then((svg) => { if (document.body.contains(qrBox)) qrBox.replaceChildren(svg, h("p", { class: "muted tiny center" }, `${word}s scan this with their camera`)); })
        .catch(() => qrBox.replaceChildren(h("p", { class: "muted tiny" }, "QR unavailable offline. Share the link instead.")));
    };
    paintRole();

    const count = h("div", { class: "clock sm" });
    const tick = () => { const p = phaseOf(g, Date.now()); count.textContent = p.key === "pre" ? fmt(p.left) : p.key === "over" ? "Over" : "Live"; };
    tick(); lobbyTimer = setInterval(tick, 1000);
    const { end } = times(g);

    // Live scoreboard: register the game with the host key kept on this phone.
    // Retried from here if the first attempt failed (e.g. no signal).
    const liveVal = h("b", {});
    const liveRetry = h("button", { class: "ghost sm", hidden: true }, "Retry");
    const backupBtn = h("button", { class: "ghost sm", hidden: true }, icon("key", 16), " Host backup");
    const liveRow = S.enabled() ? h("div", { class: "kv live-kv" }, h("span", {}, "Live scoreboard"), h("span", { class: "live-val" }, liveVal, liveRetry)) : null;
    const register = async () => {
      liveVal.textContent = "connecting…"; liveRetry.hidden = true;
      const r = await S.createGame(g, label);
      if (!document.body.contains(liveVal)) return;
      if (r.ok) { liveVal.textContent = "on"; backupBtn.hidden = false; }
      else if (r.status === 403) liveVal.textContent = "off (game id already in use; change settings to get a new one)";
      else if (r.status === 400) liveVal.textContent = "off (the server rejected these settings)";
      else { liveVal.textContent = "off, server not reachable"; liveRetry.hidden = false; }
    };
    liveRetry.addEventListener("click", register);
    backupBtn.addEventListener("click", () => {
      const url = `${links.h}&hk=${S.hostKey(g.i)}`;
      const qr = h("div", { class: "qr" }, h("p", { class: "muted tiny center" }, "Loading QR…"));
      qrSvg(url, "QR code for the host backup link").then((svg) => qr.replaceChildren(svg)).catch(() => qr.replaceChildren(h("p", { class: "muted tiny" }, "QR unavailable offline. Copy the link instead.")));
      sheet("Host backup",
        h("p", { class: "muted" }, "If your phone dies mid-game, a co-host who opened this link can still end the game for everyone. It is a hunter link that also carries your host key; share it only with someone you trust."),
        qr,
        h("button", { class: "primary", onclick: () => copyOrShare("Campus Manhunt host backup link. Keep it private.", { title: "Host backup", url }) }, icon("key", 18), " Share backup link"));
    });
    if (liveRow) register();

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
        liveRow,
        h("div", { class: "row" },
          h("button", { class: "ghost sm", onclick: () => { store.set("manhunt:draft", { c: g.c, h: g.h, d: g.d, k: !!g.k, e: g.e, s: g.s }); nav("host"); } }, "Change settings"),
          backupBtn)),
      h("p", { class: "muted" }, "Send the runner link to runners and the hunter link to hunters. The role is baked into the link."),
      seg,
      h("div", { class: "card" }, qrBox, linkBox, shareBtn),
      openBtn,
      h("p", { class: "muted tiny" }, `Phone time now: ${new Date().toLocaleTimeString()}. Every phone must have automatic date & time on, or countdowns will differ.`),
    );
  }

  // ---- routing -------------------------------------------------------------------------------
  const notFound = () => { leaveScreen(); shell(h("h1", {}, "That link doesn't work"), h("div", { class: "card" }, h("p", {}, "The game link is incomplete or was made by a different version of the app."), h("p", { class: "muted" }, "Ask the host to share it again, or paste the whole link on the home screen.")), h("button", { class: "primary", onclick: () => nav("") }, "Go home")); };
  const crashed = (e) => { leaveScreen(); console.error(e); shell(h("h1", {}, "Something went wrong"), h("div", { class: "card" }, h("p", {}, "The screen couldn't be drawn. Your game data on this phone is untouched."), h("p", { class: "muted" }, "Reload, or go home and open the game again from Your games.")), h("button", { class: "primary", onclick: () => location.reload() }, "Reload"), h("button", { class: "ghost", onclick: () => nav("") }, "Go home")); };
  function route() {
    document.querySelectorAll("dialog.sheet").forEach((d) => d.remove());
    clearInterval(lobbyTimer);
    const hsh = location.hash;
    try {
      if (hsh === "#editor") { leaveScreen(); return MHEditor.show({ h, mount: shell, icon, toast, exit: () => nav("") }); }
      if (hsh === "#host") return host().catch(crashed);
      if (hsh.startsWith("#lobby=")) { const r = readHash("lobby"); return r ? lobby(r.game).catch(crashed) : notFound(); }
      if (hsh.startsWith("#g")) {
        const r = readHash("g");
        if (!r) return notFound();
        // A host backup link: keep the key on this phone, then drop it from the address bar.
        if (r.hostKey) { history.replaceState(null, "", `${location.pathname}${location.search}#g=${enc(wire(r.game, r.game.r))}`); }
        return G.play(r.game, { hostKeyFromLink: r.hostKey }).catch(crashed);
      }
      home();
    } catch (e) { crashed(e); }
  }
  window.MHApp = { shell, nav, safetyCard, sosSheet, qrSvg };
  applyTheme();
  store.probe();
  addEventListener("hashchange", route);
  route();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
