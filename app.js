// Manhunt PWA. No backend: the whole game lives in the share link (URL hash),
// so every phone computes the same clock from the same start time.
(() => {
  const C = window.CAMPUS;
  const $app = document.getElementById("app");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const mount = (...nodes) => { $app.replaceChildren(...nodes); };

  // ---- game encoding -------------------------------------------------------
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  const readGame = () => {
    const m = location.hash.match(/g=([\w-]+)/);
    if (!m) return null;
    try {
      const g = dec(m[1]);
      return g && g.i && g.s && g.d >= 0 && g.h >= 0 && (g.r === "h" || g.r === "r") ? g : null;
    } catch { return null; }
  };
  const linkFor = (g, role) => `${location.origin}${location.pathname}#g=${enc({ ...g, r: role })}`;

  // ---- identity (random, impersonal) ---------------------------------------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const codename = () => {
    let n = store.get("manhunt:codename");
    if (!n) { n = `${pick(C.adjectives)} ${pick(C.nouns)}`; store.set("manhunt:codename", n); }
    return n;
  };
  const tagCode = (gameId, name) => {
    let x = 2166136261;
    for (const ch of gameId + "|" + name) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
    return String(x % 10000).padStart(4, "0");
  };

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
  };
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  let timer = null;
  const clearTimer = () => { if (timer) clearInterval(timer); timer = null; };

  // ---- screens -------------------------------------------------------------
  function home() {
    clearTimer();
    mount(
      h("h1", {}, `${C.name} ${C.tagline}`),
      h("p", { class: "muted" }, "Runners hide and move. Hunters chase. No accounts, no names, no tracking."),
      h("div", { class: "card" },
        h("strong", {}, "Your codename: "), codename(),
        h("p", { class: "muted" }, "Random and private to this device. Nobody sees your real name."),
        h("button", { class: "ghost", onclick: () => { localStorage.removeItem("manhunt:codename"); home(); } }, "New codename")),
      h("button", { onclick: create }, "Host a game"),
      h("button", { class: "ghost", onclick: () => { location.hash = "editor"; } }, "Map editor"),
      h("p", { class: "muted" }, "Got a link from your host? Just open it. It will bring you straight into the game."),
      rulesCard(),
    );
  }

  function rulesCard() {
    return h("div", { class: "card" },
      h("strong", {}, "Always off limits"),
      h("ul", {}, C.offLimits.map((x) => h("li", {}, x))),
      C.safety.phone ? h("p", {}, `${C.safety.label}: `, h("a", { href: `tel:${C.safety.phone}` }, C.safety.phone)) : null,
      h("p", { class: "muted" }, "Never run into traffic. Stop the game if anyone is hurt or uncomfortable."));
  }

  async function create() {
    clearTimer();
    const lib = await MH.loadLibrary();
    const start = new Date(Date.now() + 15 * 60000);
    const about = h("p", { class: "muted" });
    const zone = h("select", { id: "zone" }, lib.configs.map((c) => h("option", { value: c.id }, c.label)));
    const showAbout = () => { about.textContent = (lib.configs.find((c) => c.id === zone.value) || {}).about || ""; };
    zone.addEventListener("change", showAbout); showAbout();
    const when = h("input", { type: "datetime-local", id: "when", value: toLocalInput(start) });
    const head = h("input", { type: "number", id: "head", min: 0, max: 60, value: C.defaults.headStartMin });
    const dur = h("input", { type: "number", id: "dur", min: 5, max: 240, value: C.defaults.durationMin });
    mount(
      h("h1", {}, "Host a game"),
      h("label", { for: "zone" }, "Map"), zone, about,
      h("button", { class: "ghost", onclick: () => { location.hash = "editor"; } }, "Edit or add maps"),
      h("label", { for: "when" }, "Start time"), when,
      h("div", { class: "row" },
        h("div", {}, h("label", { for: "head" }, "Head start (min)"), head),
        h("div", {}, h("label", { for: "dur" }, "Hunt length (min)"), dur)),
      h("button", {
        onclick: () => {
          const s = new Date(when.value).getTime();
          if (!Number.isFinite(s)) return alert("Pick a valid start time.");
          const g = {
            i: Math.random().toString(36).slice(2, 8), c: zone.value, s,
            h: Math.min(60, Math.max(0, +head.value || 0)),
            d: Math.min(240, Math.max(5, +dur.value || 45)), r: "r",
          };
          // Custom maps only exist on this phone, so ship them inside the link.
          if (lib.customConfigIds.has(g.c)) g.x = MH.pack(MH.resolve(lib, g.c));
          share(g);
        },
      }, "Create game"),
      h("button", { class: "ghost", onclick: home }, "Back"),
    );
  }

  function share(g) {
    const copy = (text, btn) => async () => {
      try {
        if (navigator.share) await navigator.share({ title: "Manhunt", text: "Join our Manhunt", url: text });
        else { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
      } catch {}
    };
    const box = (role, label, cls) => {
      const url = linkFor(g, role);
      const b = h("button", { class: cls }, `Share ${label} link`);
      b.addEventListener("click", copy(url, b));
      return h("div", { class: "card" }, h("strong", {}, `${label} link`), h("div", { class: "linkbox" }, url), b);
    };
    mount(
      h("h1", {}, "Game ready"),
      h("p", { class: "muted" }, "Send the runner link to runners and the hunter link to hunters. The role is baked into the link."),
      box("r", "Runner", "runner"), box("h", "Hunter", "hunter"),
      h("button", { onclick: () => { location.hash = `g=${enc({ ...g, r: "r" })}`; } }, "Open as runner"),
      h("button", { class: "ghost", onclick: () => { location.hash = `g=${enc({ ...g, r: "h" })}`; } }, "Open as hunter"),
    );
  }

  async function play(g) {
    const name = codename();
    const lib = g.x ? null : await MH.loadLibrary();
    const cfg = g.x ? MH.unpack(g.x) : MH.resolve(lib, g.c);
    const isHunter = g.r === "h";
    const keyOut = `manhunt:out:${g.i}`;
    const keyLog = `manhunt:log:${g.i}`;
    const headEnd = g.s + g.h * 60000;
    const end = headEnd + g.d * 60000;

    const clock = h("div", { class: "clock" });
    const phase = h("div", { class: "phase" });
    const action = h("div");
    const render = () => {
      const now = Date.now();
      const out = store.get(keyOut, false);
      let p, t;
      if (now < g.s) { p = "Starts in"; t = g.s - now; }
      else if (now < headEnd) { p = isHunter ? "Hunters frozen. Released in" : "Head start. Run!"; t = headEnd - now; }
      else if (now < end) { p = "Hunt ends in"; t = end - now; }
      else { p = "Game over"; t = 0; }
      phase.textContent = p;
      clock.textContent = fmt(t);
      const live = now >= headEnd && now < end;
      action.replaceChildren(isHunter ? hunterPanel(live) : runnerPanel(out, now >= end));
    };

    const runnerPanel = (out, over) => {
      const code = tagCode(g.i, name);
      if (out) return h("div", { class: "card" }, h("strong", {}, "You are out."), h("p", { class: "muted" }, "Head to the finish point and cheer on the others."),
        h("button", { class: "ghost", onclick: () => { store.set(keyOut, false); render(); } }, "Undo (misclick)"));
      return h("div", { class: "card" },
        h("p", { class: "muted" }, "If a hunter tags you, show them this code, then press the button."),
        h("div", { class: "code" }, `${name.toUpperCase()} ${code}`),
        over ? null : h("button", { class: "runner", onclick: () => { store.set(keyOut, true); render(); } }, "I've been tagged"));
    };

    const hunterPanel = (live) => {
      const log = store.get(keyLog, []);
      const input = h("input", { inputmode: "numeric", maxlength: 4, placeholder: "4-digit code from runner", "aria-label": "Runner tag code" });
      return h("div", {},
        h("div", { class: "card" },
          h("p", { class: "muted" }, live ? "Tagged someone? Enter the code they show you." : "Tagging unlocks when the head start ends."),
          input,
          h("button", {
            class: "hunter", onclick: () => {
              if (!live) return;
              const v = input.value.trim();
              if (!/^\d{4}$/.test(v)) return alert("Enter the 4-digit code.");
              if (log.some((e) => e.c === v)) return alert("Already logged.");
              store.set(keyLog, [...log, { c: v, t: Date.now() }]); render();
            },
          }, "Log catch")),
        h("div", { class: "card" }, h("strong", {}, `Catches on this phone: ${log.length}`),
          h("ul", { class: "log" }, log.map((e) => h("li", {}, `${e.c} at ${new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)))));
    };

    mount(
      h("div", {}, h("span", { class: `pill ${isHunter ? "hunter" : "runner"}` }, isHunter ? "Hunter" : "Runner"), " ", h("span", { class: "muted" }, name)),
      phase, clock, action,
      mapCard(cfg),
      rulesCard(),
      h("button", { class: "ghost", onclick: () => { location.hash = ""; } }, "Leave game"),
    );
    // Re-render only the dynamic parts each second.
    const tick = () => {
      const keep = document.activeElement;
      if (keep && keep.tagName === "INPUT") { // don't clobber typing
        const now = Date.now();
        const t = now < g.s ? g.s - now : now < headEnd ? headEnd - now : now < end ? end - now : 0;
        clock.textContent = fmt(t);
        return;
      }
      render();
    };
    render();
    clearTimer();
    timer = setInterval(tick, 1000);
  }

  // Live map. Your position is read on this phone only and never sent anywhere.
  function mapCard(cfg) {
    if (!cfg) return h("div", { class: "card" }, "This map isn't available. Ask the host to resend the link.");
    const el = h("div", { class: "map small" });
    const status = h("div", { class: "status" }, "Location off");
    const btn = h("button", { class: "ghost" }, "Show me on the map");
    queueMicrotask(() => {
      const map = MH.newMap(el);
      const group = L.layerGroup().addTo(map);
      MH.drawConfig(map, group, cfg);
      let dot = null, watch = null, last = "ok";
      btn.addEventListener("click", () => {
        if (!navigator.geolocation) return (status.textContent = "Location not supported on this device.");
        if (watch != null) return;
        status.textContent = "Finding you...";
        watch = navigator.geolocation.watchPosition((p) => {
          const { latitude: la, longitude: lo } = p.coords;
          dot ? dot.setLatLng([la, lo]) : (dot = L.circleMarker([la, lo], { radius: 8, color: "#fff", fillColor: "#4aa3ff", fillOpacity: 1, weight: 3 }).addTo(map));
          const r = MH.check(cfg, la, lo);
          status.className = "status " + r.s;
          status.textContent = r.s === "ok" ? "In bounds" : r.s === "out" ? "OUT OF BOUNDS. Head back to the green area." : `NO-GO ZONE: ${r.n}. Leave now.`;
          if (r.s !== "ok" && last === "ok" && navigator.vibrate) navigator.vibrate([200, 100, 200]);
          last = r.s;
        }, () => { watch = null; status.textContent = "Couldn't get your location. Allow it in browser settings."; }, { enableHighAccuracy: true, maximumAge: 5000 });
        btn.remove();
      });
    });
    return h("div", { class: "card" }, h("strong", {}, cfg.label), h("p", { class: "muted" }, "Green is where you play. Red is out of bounds."), el, status, btn);
  }

  function route() {
    if (location.hash === "#editor") { clearTimer(); return MHEditor.show({ h, mount, exit: () => { location.hash = ""; } }); }
    const g = readGame();
    g ? play(g) : home();
  }
  addEventListener("hashchange", route);
  route();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
