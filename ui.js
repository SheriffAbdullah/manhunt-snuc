// Shared UI primitives: safe DOM builder, storage wrapper, toast, sheets,
// screen-reader announcements and time formatting. No game logic here.
window.MHUI = (() => {
  // ---- storage -----------------------------------------------------------------
  // localStorage can be missing, blocked (private mode on some browsers), full,
  // or wiped by the OS. Every call is guarded and a broken store is reported
  // once so the screen can say so plainly instead of failing silently.
  const store = {
    broken: false,
    _mark(e) { if (!store.broken) { store.broken = true; try { document.dispatchEvent(new CustomEvent("mh:storage", { detail: String((e && e.name) || e) })); } catch {} } },
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { if (!(e instanceof SyntaxError)) store._mark(e); return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { store._mark(e); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { store._mark(e); } },
    probe() { try { const k = "manhunt:probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { store._mark(e); return false; } },
  };

  // ---- DOM helper ----------------------------------------------------------------
  // Children are always text nodes or elements, never HTML strings, so data from
  // a link or a server can be shown without escaping.
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
    trophy: "M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6",
    flag: "M5 21V4M5 4h12l-2 4 2 4H5",
    battery: "M3 8h14v8H3zM17 10h2v4h-2zM5 10h5v4H5",
    key: "M14 3a5 5 0 1 0 2.5 9.3L21 16.8V21h-4v-2h-2v-2h-2l-1.3-1.3A5 5 0 0 0 14 3z",
    off: "M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0",
  };
  const icon = (name, size = 20) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[name]); s.append(p);
    return s;
  };

  // ---- toast + announcements ----------------------------------------------------------
  let toastTimer = null;
  const toast = (msg, ms = 2600) => {
    let t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  };
  // Visually hidden live region for screen readers (phase changes, end states).
  let liveEl = null;
  const announce = (msg, assertive = false) => {
    if (!liveEl) { liveEl = h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" }); document.body.append(liveEl); }
    liveEl.setAttribute("aria-live", assertive ? "assertive" : "polite");
    liveEl.textContent = ""; setTimeout(() => { liveEl.textContent = msg; }, 50);
  };

  // ---- sheets (bottom dialogs) ---------------------------------------------------------
  const sheet = (title, ...body) => {
    const d = h("dialog", { class: "sheet", "aria-label": title });
    d.append(h("div", { class: "sheet-body" }, h("h2", { class: "sheet-title" }, title), ...body,
      h("button", { class: "ghost", type: "button", onclick: () => d.close() }, "Close")));
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.append(d); d.showModal();
    return d;
  };
  // Two-button question instead of window.confirm: styled, keyboard friendly, never blocks timers.
  const ask = (title, text, { ok = "Yes", cls = "primary" } = {}) => new Promise((res) => {
    let answered = false;
    const d = h("dialog", { class: "sheet", "aria-label": title });
    const done = (v) => { answered = true; d.close(); res(v); };
    d.append(h("div", { class: "sheet-body" }, h("h2", { class: "sheet-title" }, title), text ? h("p", { class: "muted" }, text) : null,
      h("button", { class: `${cls} big`, type: "button", onclick: () => done(true) }, ok),
      h("button", { class: "ghost", type: "button", onclick: () => done(false) }, "Cancel")));
    d.addEventListener("click", (e) => { if (e.target === d) done(false); });
    d.addEventListener("close", () => { d.remove(); if (!answered) res(false); });
    document.body.append(d); d.showModal();
  });

  // ---- share / copy ------------------------------------------------------------------------
  const copyOrShare = async (text, { title = "Campus Manhunt", url } = {}) => {
    try {
      if (navigator.share) { await navigator.share(url ? { title, text, url } : { title, text }); return true; }
    } catch (e) { if (e && e.name === "AbortError") return false; }
    try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); toast("Copied"); return true; }
    catch { toast("Couldn't copy. Long-press the text to select it."); return false; }
  };

  // ---- time formatting ----------------------------------------------------------------------
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
  };
  const clockTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const whenText = (t, now = Date.now()) => (sameDay(t, now) ? `today ${clockTime(t)}` : new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return { store, h, icon, toast, announce, sheet, ask, copyOrShare, fmt, clockTime, whenText, toLocalInput };
})();
