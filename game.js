// The game screen for runners and hunters, plus the on-device map card.
// Everything is recomputed from timestamps on every tick, so a phone that was
// locked, backgrounded or rebooted shows the right phase the moment it is back.
window.MHGame = (() => {
  const C = window.CAMPUS;
  const S = window.MHSync;
  const D = window.MHDevice;
  const { store, h, icon, toast, announce, sheet, ask, copyOrShare, fmt, clockTime, whenText } = window.MHUI;
  const { codename, myTagCode, codeMatches, times, phaseOf, remember, linkFor } = window.MHCore;
  const app = () => window.MHApp; // shell, nav, safetyCard, sosSheet, qrSvg (defined in app.js)

  let timer = null, pollTimer = null, pingTimer = null;
  const stop = () => { clearInterval(timer); clearTimeout(pollTimer); clearInterval(pingTimer); timer = pollTimer = pingTimer = null; };

  const END_TEXT = {
    host: { title: "Game ended", line: "The host ended the game.", winner: null },
    allCaught: { title: "Hunters win", line: "Every runner was caught.", winner: "hunters" },
    timeUp: { title: "Runners win", line: "Time's up and runners were still free.", winner: "runners" },
    timeUpAllCaught: { title: "Hunters win", line: "Time's up and no runner was left.", winner: "hunters" },
    hardStop: { title: "Runners win", line: "The hard stop time was reached.", winner: "runners" },
  };

  async function play(g, { hostKeyFromLink = null } = {}) {
    stop();
    const { shell, nav, safetyCard, sosSheet } = app();
    const name = codename();
    const lib = g.map ? null : await MH.loadLibrary();
    const cfg = g.map || MH.resolve(lib, g.c);
    const label = cfg ? cfg.label : "Unknown map";
    remember(g, label);
    const key = (k) => `manhunt:${k}:${g.i}`;
    const sync = S.enabled();
    if (hostKeyFromLink && sync) { if (S.adoptHostKey(g.i, hostKeyFromLink)) toast("This phone can now end the game as host."); }

    const converted = g.r === "r" && store.get(key("role")) === "h";
    const isHunter = g.r === "h" || converted;
    const myCode = myTagCode(g.i, name);

    // ---- clock ---------------------------------------------------------------------
    // With sync on, the server's clock wins: a phone whose clock is off (or that
    // the user changed mid-game) still counts down with everyone else. The
    // offset is remembered per game so it survives a signal drop.
    let skewMs = sync ? Number(store.get(key("skew"), 0)) || 0 : 0;
    if (Math.abs(skewMs) > 86400000) skewMs = 0;
    const now = () => Date.now() + skewMs;
    const skewed = g.s - now() > 36 * 3600000;

    // Local record of how the game ended: {t, reason, winner}. Older builds stored a number.
    const endedRec = () => { const e = store.get(key("ended"), null); if (Number.isFinite(e)) return { t: e, reason: "host", winner: null }; return e && Number.isFinite(e.t) ? e : null; };
    const phase = (t) => {
      const p = phaseOf(g, t), e = endedRec();
      if (e && p.key !== "over") return { key: "over", left: 0, headEnd: p.headEnd, end: Math.min(e.t, p.end), early: true, reason: e.reason, winner: e.winner };
      if (p.key === "over") { const r = e || {}; return { ...p, reason: r.reason || (g.e && g.e === p.end ? "hardStop" : "timeUp"), winner: r.winner }; }
      return p;
    };
    // Someone who opens the link only after the end never played: no join, neutral screen.
    const freshOpen = !store.get(key("joined"), null);
    const firstOpen = freshOpen ? now() : store.get(key("joined"));
    store.set(key("joined"), firstOpen);
    // ...or (below, in applyLive) the server reports an end that happened before this phone first opened the link.
    let lateViewer = freshOpen && phase(now()).key === "over";

    let live = store.get(key("live"), null), liveState = "connecting", liveJson = "";
    if (live && typeof live !== "object") live = null;
    if (sync && !lateViewer) S.join(g.i, { name, role: isHunter ? "hunter" : "runner", code: myCode });
    D.keepAwake(true);

    // ---- static parts of the screen ----------------------------------------------------
    const clock = h("div", { class: "clock", "aria-live": "off" });
    const phaseEl = h("div", { class: "phase" });
    const subEl = h("div", { class: "phase-sub" });
    const band = h("section", { class: "band" }, phaseEl, clock, subEl);
    const action = h("div");
    const bottom = h("div", { class: "sticky-actions" });
    const notices = h("div", { class: "notices" });
    const onScreen = () => document.body.contains(band);

    const PHASE = {
      pre: { label: "Starts in", sub: (p) => `Head start ${clockTime(g.s)} · hunters released ${clockTime(p.headEnd)}` },
      head: { label: isHunter ? "Hunters frozen" : "Head start. Run!", sub: (p) => (isHunter ? `Released at ${clockTime(p.headEnd)}` : `Hunters released at ${clockTime(p.headEnd)}`) },
      hunt: { label: "Hunt ends in", sub: (p) => `Ends ${clockTime(p.end)}${g.e && g.e === p.end ? " (hard stop)" : ""}` },
      over: { label: "Game over", sub: (p) => (p.reason === "host" ? `Ended by the host at ${clockTime(p.end)}` : p.reason === "allCaught" ? `All runners caught by ${clockTime(p.end)}` : `Ended ${clockTime(p.end)}`) },
    };

    // ---- end-state copy --------------------------------------------------------------------
    const endInfo = (p) => {
      let k = p.reason || "timeUp";
      if (k === "timeUp" && live && live.ended && live.result && live.result.winner === "hunters") k = "timeUpAllCaught";
      if (k === "timeUp" && live && live.ended && live.result && live.result.winner === null && live.result.reason === "timeUp") return { title: "Time's up", line: "The game is over.", winner: null };
      return END_TEXT[k] || END_TEXT.timeUp;
    };
    const personal = () => {
      const out = store.get(key("out"), null), log = hunterLog();
      if (lateViewer) return "This game ended before you opened it on this phone.";
      if (isHunter) return `You logged ${log.length} catch${log.length === 1 ? "" : "es"}${converted ? " after being caught" : ""}.`;
      return out ? `You were caught at ${clockTime(typeof out === "object" ? out.t : times(g).end)}.` : "You were never caught.";
    };
    const resultCard = (p) => {
      const e = endInfo(p);
      const mine = !lateViewer && ((isHunter && e.winner === "hunters") || (!isHunter && e.winner === "runners" && !store.get(key("out"), null)));
      return h("div", { class: `card result ${e.winner || "neutral"}` },
        h("div", { class: "result-head" }, icon(e.winner ? "trophy" : "flag", 28), h("div", {}, h("h2", { class: "result-title" }, e.title), h("p", { class: "muted" }, e.line))),
        h("p", { class: `result-mine ${mine ? "win" : ""}` }, mine ? "That's your team. " : "", personal()),
        finalBoard(), resultButtons());
    };

    // ---- panels -------------------------------------------------------------------------------
    const runnerPanel = (p) => {
      const out = store.get(key("out"), null);
      if (p.key === "over") return resultCard(p);
      if (out) {
        return h("div", { class: "card" },
          h("div", { class: "card-head" }, h("strong", {}, "You're out"), h("span", { class: "muted" }, typeof out === "object" ? clockTime(out.t) : "")),
          out.byHunter ? h("p", { class: "muted" }, "A hunter logged your catch on the scoreboard.") : null,
          h("p", { class: "muted" }, g.k ? "Caught runners hunt now. Switch roles when you're ready." : "Head to the meeting point and cheer on the others."),
          g.k ? h("button", { class: "hunter", onclick: () => { store.set(key("role"), "h"); play(g); } }, "Join the hunters") : null,
          out.byHunter ? null : h("button", { class: "ghost sm", onclick: () => { store.del(key("out")); render(true); } }, "Undo (misclick)"),
          sync && !out.byHunter ? h("p", { class: "muted tiny" }, "Undo only fixes this phone; the live scoreboard keeps the out.") : null);
      }
      return h("div", { class: "card tag" },
        h("p", { class: "muted" }, "Tagged? Show the hunter this, then press the button below."),
        h("div", { class: "code-name" }, name.toUpperCase()),
        h("div", { class: "code-digits" }, myCode));
    };
    const hunterLog = () => store.get(key("log"), []).filter((e) => e && typeof e.c === "string");
    const hunterPanel = (p) => {
      const log = hunterLog();
      if (p.key === "over") return h("div", {}, resultCard(p), log.length ? h("div", { class: "card" }, h("div", { class: "card-head" }, h("strong", {}, `Your catches: ${log.length}`), h("span", { class: "muted tiny" }, "this phone")), logList(log)) : null);
      return h("div", {},
        converted ? h("p", { class: "muted tiny center" }, "You were caught and joined the hunters.") : null,
        p.key === "head" ? h("div", { class: "card frozen" }, h("strong", {}, "Stay at the start point."), h("p", { class: "muted" }, "Tagging unlocks when the countdown ends.")) : null,
        p.key === "pre" ? h("div", { class: "card" }, h("strong", {}, "Waiting for kickoff."), h("p", { class: "muted" }, "Runners get a head start, then you're released.")) : null,
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("strong", {}, `Catches: ${log.length}`), h("span", { class: "muted tiny" }, credited(log))),
          log.length ? logList(log) : h("p", { class: "muted" }, "No catches logged yet.")));
    };
    // The scoreboard credits the first hunter to report a runner; a second report of the same runner stays in this phone's log only.
    const credited = (log) => (live && live.me && live.me.role === "hunter" && live.me.catches !== log.length ? `${live.me.catches} credited on the scoreboard` : "this phone");
    const logList = (log) => h("ul", { class: "log" }, log.map((e) => h("li", {}, h("b", {}, e.n || "Unknown runner"), h("span", { class: "muted" }, ` ${e.c} · ${clockTime(e.t)}`))));

    const boardList = (b) => h("ol", { class: "board" }, b.map((x) => h("li", {}, h("span", { class: "board-name" }, x.name || "?"), h("b", {}, String(x.catches)))));
    const finalBoard = () => (live ? h("div", { class: "final" },
      h("div", { class: "card-head" }, h("strong", {}, "Everyone"), h("span", { class: "muted tiny" }, `${live.caught} caught · ${live.alive} survived`)),
      live.board.length ? boardList(live.board) : h("p", { class: "muted tiny" }, "No catches were logged.")) : null);
    const resultText = () => {
      const p = phase(now()), e = endInfo(p), log = hunterLog(), out = store.get(key("out"), null);
      const head = `Campus Manhunt · ${label} · ${whenText(g.s)}\n${e.title}: ${e.line}`;
      const all = live ? `\nEveryone: ${live.caught} caught, ${live.alive} survived${live.board.length ? `\nTop hunters: ${live.board.slice(0, 5).map((b) => `${b.name} ${b.catches}`).join(", ")}` : ""}` : "";
      if (lateViewer) return head + all;
      if (isHunter) return `${head}\nHunter ${name}: ${log.length} catch${log.length === 1 ? "" : "es"}\n${log.map((x) => `• ${x.n || "?"} (${x.c}) ${clockTime(x.t)}`).join("\n")}`.trim() + all;
      return `${head}\nRunner ${name}: ${out ? `caught at ${clockTime(typeof out === "object" ? out.t : times(g).end)}` : "never caught"}${all}`;
    };
    const resultButtons = () => h("div", { class: "row" },
      h("button", { class: "ghost sm", onclick: () => copyOrShare(resultText(), { title: "Campus Manhunt results" }) }, icon("share", 16), " Share result"),
      h("button", { class: "ghost sm", onclick: () => nav("host") }, "Host another"));

    // ---- hunter: verify a tag before logging it ------------------------------------------------
    const alreadyCaught = (n) => (live ? live.feed.find((f) => f.runner === n) : null);
    const catchSheet = () => {
      const adj = h("select", { "aria-label": "First word of codename" }, h("option", { value: "" }, "First word…"), C.adjectives.map((a) => h("option", { value: a }, a)));
      const noun = h("select", { "aria-label": "Second word of codename" }, h("option", { value: "" }, "Second word…"), C.nouns.map((a) => h("option", { value: a }, a)));
      const code = h("input", { inputmode: "numeric", pattern: "[0-9]*", maxlength: 4, autocomplete: "off", placeholder: "4 digits", "aria-label": "Runner tag code", class: "code-input" });
      const err = h("p", { class: "err", role: "alert" });
      let warned = null;
      const btn = h("button", { class: "hunter big", onclick: () => {
        const n = `${adj.value} ${noun.value}`, v = code.value.trim();
        if (!adj.value || !noun.value) return (err.textContent = "Pick both words of the codename.");
        if (!/^\d{4}$/.test(v)) return (err.textContent = "Enter the 4 digits.");
        if (!codeMatches(g.i, n, v)) return (err.textContent = `${v} isn't ${n}'s code for this game. Check the words and digits.`);
        const log = hunterLog();
        if (log.some((e) => e.c === v && e.n === n)) return (err.textContent = "You already logged this catch.");
        const prior = alreadyCaught(n);
        if (prior && warned !== `${n}#${v}`) { warned = `${n}#${v}`; btn.textContent = "Log anyway"; return (err.textContent = `${n} is already on the caught list${prior.hunter ? ` (${prior.hunter}, ${clockTime(prior.t)})` : ""}. Two runners can share a codename, so log it if you're sure.`); }
        store.set(key("log"), [...log, { n, c: v, t: now() }]);
        if (sync) S.report(g.i, { type: "catch", name, runner: { name: n, code: v } });
        d.close(); D.CUES.tap(); toast(`Caught ${n}`); announce(`Caught ${n}`); render(true);
      } }, "Verify & log");
      const d = sheet("Log a catch",
        h("p", { class: "muted" }, "Read the runner's screen: two words and four digits."),
        h("div", { class: "row" }, adj, noun), code, err, btn);
      setTimeout(() => adj.focus(), 50);
    };
    const taggedSheet = () => {
      const d = sheet("Were you tagged?",
        h("p", { class: "muted" }, "Show the hunter your code first so they can log it, then confirm."),
        h("div", { class: "code-name" }, name.toUpperCase()), h("div", { class: "code-digits" }, myCode),
        h("button", { class: "runner big", onclick: () => { store.set(key("out"), { t: now() }); if (sync) S.report(g.i, { type: "out", name, code: myCode }); d.close(); D.vibrate([400]); announce("You're out"); render(true); } }, "Yes, I'm out"));
    };

    // ---- live scoreboard card -------------------------------------------------------------------------
    const liveCard = sync ? h("div", { class: "card live" }) : null;
    const markEnded = (t, result) => {
      if (endedRec()) return false;
      const r = result || { reason: "host", winner: null };
      store.set(key("ended"), { t: Math.min(now(), t || now()), reason: r.reason, winner: r.winner });
      return true;
    };
    const endForAll = async () => {
      if (!(await ask("End the game for everyone?", "Every phone will show game over within a few seconds.", { ok: "End game", cls: "hunter" }))) return;
      const r = await S.endGame(g.i);
      if (!r.ok) return toast(r.status === 403 ? "This phone doesn't hold the host key." : r.status === 404 ? "The server has no record of this game." : "Couldn't reach the server. Try again when you have signal.");
      live = r.data; liveState = "live"; applyLive();
    };
    const hostBackupSheet = () => {
      const url = `${linkFor(g, "h")}&hk=${S.hostKey(g.i)}`;
      const qr = h("div", { class: "qr" }, h("p", { class: "muted tiny center" }, "Loading QR…"));
      app().qrSvg(url).then((svg) => qr.replaceChildren(svg, h("p", { class: "muted tiny center" }, "Scan with a trusted phone"))).catch(() => qr.replaceChildren(h("p", { class: "muted tiny" }, "QR unavailable offline. Copy the link instead.")));
      sheet("Host backup",
        h("p", { class: "muted" }, "If this phone dies, any phone that opens this link can end the game for everyone. Share it only with a co-host."),
        qr,
        h("button", { class: "primary", onclick: () => copyOrShare("Campus Manhunt host backup link. Keep it private.", { title: "Host backup", url }) }, icon("key", 18), " Share backup link"));
    };
    // Called after every poll/end; stores the ended marker and re-renders when the state changed.
    const applyLive = () => {
      if (!live) return;
      store.set(key("live"), live);
      if (live.ended && !lateViewer && !endedRec() && !store.get(key("out"), null) && !hunterLog().length) {
        const endT = live.result && live.result.reason === "timeUp" ? live.endAt : live.endedAt;
        if (endT && firstOpen > endT) lateViewer = true;
      }
      // A hunter logged me while this phone was dead or offline: catch up.
      if (!isHunter && live.me && live.me.outAt && !store.get(key("out"), null)) {
        store.set(key("out"), { t: live.me.outAt, byHunter: true });
        D.vibrate([400]); toast("A hunter logged your catch."); announce("A hunter logged your catch. You're out.", true);
        render(true); return;
      }
      if (live.ended) {
        const t = live.result && live.result.reason === "timeUp" ? live.endAt : live.endedAt || now();
        if (markEnded(t, live.result)) { render(true); return; }
      }
      paintLive();
    };
    const paintLive = () => {
      if (!liveCard) return;
      const pending = S.pending(g.i);
      const over = phase(now()).key === "over";
      const chipText = liveState === "live" ? (live && live.ended ? "Final" : pending ? "Live · syncing" : D.lowPower() ? "Live · low power" : "Live")
        : liveState === "nogame" ? (over ? "Server data expired" : "Waiting for the host's phone")
        : liveState === "connecting" ? "Connecting…" : pending ? "Offline · will sync" : "Offline";
      const kids = [h("div", { class: "card-head" }, h("strong", {}, "Live scoreboard"), h("span", { class: `live-chip ${liveState}` }, chipText))];
      if (live) {
        kids.push(h("div", { class: "live-stats" },
          h("div", {}, h("b", {}, String(live.alive)), h("span", {}, "runners left")),
          h("div", {}, h("b", {}, String(live.hunters)), h("span", {}, "hunters")),
          h("div", {}, h("b", {}, String(live.caught)), h("span", {}, "caught"))));
        if (live.board.length) kids.push(h("h3", { class: "live-h" }, "Top hunters"), boardList(live.board.slice(0, 5)));
        if (live.feed.length) kids.push(h("h3", { class: "live-h" }, "Latest"), h("ul", { class: "feed" }, live.feed.slice(0, 5).map((f) =>
          h("li", {}, h("span", {}, f.hunter ? [h("b", {}, f.hunter), " caught ", h("b", {}, f.runner)] : [h("b", {}, f.runner), " is out"]), h("span", { class: "muted" }, clockTime(f.t))))));
        if (!live.board.length && !live.feed.length) kids.push(h("p", { class: "muted tiny" }, "No catches yet."));
      } else if (liveState === "nogame") kids.push(h("p", { class: "muted tiny" }, over ? "Results are kept on the server for 24 hours after a game. Your own result is above." : "The host's phone hasn't registered this game yet. Your catches are saved here and will sync."));
      if (liveState === "offline" && !over) kids.push(h("p", { class: "muted tiny" }, live ? "No connection right now; these numbers may be old. The game runs on the link's clock, so keep playing; catches are saved on this phone and sent later." : "No connection to the scoreboard. The game runs on the link's clock, so you can keep playing; catches are saved on this phone and sent later."));
      if (S.hasHostKey(g.i)) {
        const hostBits = [h("div", { class: "card-head" }, icon("key", 16), h("strong", {}, "You're the host"))];
        if (live && !live.ended) hostBits.push(h("p", { class: "muted tiny" }, `${live.total} phone${live.total === 1 ? "" : "s"} joined · ${live.unreachable ? `${live.unreachable} not heard from in 2 min` : "all reachable"}`));
        hostBits.push(h("div", { class: "row" },
          h("button", { class: "ghost sm", onclick: hostBackupSheet }, icon("key", 16), " Host backup"),
          !(live && live.ended) ? h("button", { class: "ghost sm danger", onclick: endForAll }, "End game for everyone") : null));
        kids.push(h("div", { class: "host-box" }, ...hostBits));
      }
      liveCard.replaceChildren(...kids);
    };
    const pollEvery = () => (phase(now()).key === "over" ? 15000 : D.lowPower() ? 15000 : 4500) + Math.random() * 1000;
    const pollLater = (ms) => { clearTimeout(pollTimer); pollTimer = setTimeout(doPoll, ms); };
    const doPoll = async () => {
      clearTimeout(pollTimer); pollTimer = null;
      if (!sync || !onScreen() || document.visibilityState !== "visible") return;
      const r = await S.poll(g.i);
      if (!onScreen()) return;
      if (r.ok) {
        liveState = "live";
        let skewJump = false;
        if (!r.viaLeader && r.data.serverTime) { skewJump = Math.abs(r.skew - skewMs) > 2000; skewMs = r.skew; store.set(key("skew"), skewMs); }
        const j = JSON.stringify(r.data); const changed = j !== liveJson; liveJson = j; live = r.data;
        applyLive();
        if (skewJump || (changed && phase(now()).key === "over")) render(true);
      } else { liveState = r.status === 404 ? "nogame" : "offline"; paintLive(); }
      paintNotices();
      if (!(live && live.ended)) pollLater(pollEvery());
    };
    const doPing = async () => {
      if (!sync || lateViewer || !onScreen() || document.visibilityState !== "visible" || phase(now()).key === "over") return;
      const r = await S.ping(g.i, name);
      if (r.status === 409 && r.result && onScreen()) { if (markEnded(now(), r.result)) render(true); }
    };
    const startPing = () => { clearInterval(pingTimer); pingTimer = setInterval(doPing, D.lowPower() ? 60000 : 30000); };

    // ---- notices: clock, storage, battery, GPS ------------------------------------------------------------
    let battWarned = store.get(key("battwarn"), false);
    const paintNotices = () => {
      const kids = [];
      if (skewed) kids.push(h("div", { class: "notice" }, "This game starts more than a day from now. If that's wrong, check this phone's clock or ask the host for a fresh link."));
      if (Math.abs(skewMs) > 20000) kids.push(h("div", { class: "notice" }, `This phone's clock is about ${Math.round(Math.abs(skewMs) / 1000)} s ${skewMs > 0 ? "behind" : "ahead"}. The countdown uses the server's time so it matches everyone else.`));
      if (store.broken) kids.push(h("div", { class: "notice warn" }, "This browser isn't saving game data (private mode or storage full). You can play, but a reload loses your code and catches. Keep this tab open."));
      if (D.lowPower()) kids.push(h("div", { class: "notice dim" }, icon("battery", 16), " Low-power mode on: slower updates, location off. ", h("button", { class: "link-btn", type: "button", onclick: () => { D.setLowPower(false); afterPowerChange(); } }, "Turn off")));
      notices.replaceChildren(...kids);
    };
    const afterPowerChange = () => { paintNotices(); paintLive(); paintChips(); startPing(); if (sync) doPoll(); };
    const lowBatterySheet = () => {
      const pct = Math.round((D.battery.level || 0) * 100);
      sheet(`Battery at ${pct}%`,
        h("p", { class: "muted" }, "Low-power mode updates the scoreboard less often, stops animations and turns location off. The countdown keeps running."),
        h("button", { class: "primary big", onclick: (e) => { D.setLowPower(true); afterPowerChange(); e.target.closest("dialog").close(); } }, icon("battery", 18), " Turn on low-power mode"));
    };
    const onBattery = () => {
      if (!onScreen()) return document.removeEventListener("mh:battery", onBattery);
      const { level, charging } = D.battery;
      if (level != null && level <= 0.15 && !charging && !battWarned && !D.lowPower() && phase(now()).key !== "over") { battWarned = true; store.set(key("battwarn"), true); D.vibrate([60]); lowBatterySheet(); }
    };
    document.addEventListener("mh:battery", onBattery);

    // ---- visibility / background resume -------------------------------------------------------------------
    const onVis = () => {
      if (!onScreen()) return document.removeEventListener("visibilitychange", onVis);
      if (document.visibilityState === "visible") { render(true); if (sync) { doPoll(); doPing(); } }
      else clearTimeout(pollTimer);
    };
    const onSync = () => { if (!onScreen()) return document.removeEventListener("mh:sync", onSync); paintLive(); };
    const onStorage = () => { if (!onScreen()) return document.removeEventListener("mh:storage", onStorage); paintNotices(); };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("mh:storage", onStorage);
    if (sync) document.addEventListener("mh:sync", onSync);

    // ---- render ----------------------------------------------------------------------------------------------
    let lastKey = null, soonDone = false;
    const render = (force) => {
      const t = now(), p = phase(t);
      clock.textContent = fmt(p.left);
      if (p.key === "hunt" && p.left <= 60000 && !soonDone) { soonDone = true; D.CUES.soon(); announce("One minute left"); }
      if (p.key === lastKey && !force) return;
      // A phone that slept through a phase change cues once, for the phase it is in now.
      if (lastKey && p.key !== lastKey) { if (D.CUES[p.key]) D.CUES[p.key](); announce(p.key === "over" ? `Game over. ${endInfo(p).title}.` : PHASE[p.key].label, true); }
      lastKey = p.key;
      band.className = `band ${p.key} ${isHunter ? "is-hunter" : "is-runner"}`;
      phaseEl.textContent = PHASE[p.key].label; subEl.textContent = PHASE[p.key].sub(p);
      action.replaceChildren(lateViewer && p.key === "over" ? resultCard(p) : isHunter ? hunterPanel(p) : runnerPanel(p));
      paintLive(); paintNotices(); paintChips();
      const out = store.get(key("out"), null);
      bottom.replaceChildren(
        h("button", { class: "ghost sos", onclick: () => sosSheet(name) }, "SOS"),
        p.key === "over" || lateViewer
          ? h("button", { class: "ghost big", onclick: () => nav("") }, "Back to home")
          : isHunter
            ? h("button", { class: "hunter big", disabled: p.key !== "hunt", onclick: catchSheet }, p.key === "hunt" ? "Log a catch" : "Tagging locked")
            : h("button", { class: "runner big", disabled: !!out, onclick: taggedSheet }, out ? "You're out" : "I've been tagged"));
      if (p.key === "over") { D.keepAwake(false); clearInterval(pingTimer); }
    };

    // ---- header chips ----------------------------------------------------------------------------------------
    const wakeChip = h("p", { class: "chip-status muted tiny", hidden: true });
    const soundBtn = h("button", { class: "chip-btn", type: "button" });
    const powerBtn = h("button", { class: "chip-btn", type: "button", "aria-label": "Low-power mode" }, icon("battery", 14));
    const paintChips = () => {
      const p = phase(now()).key;
      wakeChip.textContent = !D.awake() && "wakeLock" in navigator && !D.lowPower() && p !== "over" ? "Screen may sleep: keep the app open." : "";
      wakeChip.hidden = !wakeChip.textContent;
      soundBtn.textContent = D.soundOn() ? (D.audioReady() ? "Sound on" : "Tap for sound") : "Muted"; soundBtn.setAttribute("aria-pressed", String(D.soundOn()));
      powerBtn.setAttribute("aria-pressed", String(D.lowPower())); powerBtn.classList.toggle("on", D.lowPower());
    };
    const onWake = () => { if (!onScreen()) return document.removeEventListener("mh:wake", onWake); paintChips(); };
    document.addEventListener("mh:wake", onWake);
    soundBtn.addEventListener("click", () => { store.set("manhunt:sound", !D.soundOn()); D.unlockAudio(); paintChips(); if (D.soundOn()) D.beep([[880, 0.08]]); });
    powerBtn.addEventListener("click", () => { D.setLowPower(!D.lowPower()); afterPowerChange(); toast(D.lowPower() ? "Low-power mode on" : "Low-power mode off"); });

    shell(
      h("div", { class: "role-row" },
        h("span", { class: `pill ${isHunter ? "hunter" : "runner"}` }, isHunter ? "Hunter" : "Runner"),
        h("span", { class: "who" }, name),
        soundBtn, powerBtn),
      wakeChip, notices,
      band, action,
      liveCard,
      mapCard(cfg, label),
      safetyCard(),
      h("button", { class: "ghost", onclick: async () => { if (await ask("Leave this game screen?", "Your link and your result stay saved on this phone.", { ok: "Leave", cls: "ghost" })) nav(""); } }, "Leave game"),
      h("div", { class: "bottom-space" }),
      bottom,
    );
    paintChips();
    render(true);
    timer = setInterval(() => render(false), 1000);
    if (sync) { doPoll(); startPing(); }
    onBattery();
  }

  // ---- live map. Your position is read on this phone only and never sent anywhere. ----
  const WEAK_ACCURACY_M = 60; // worse than this (indoors, under trees) and boundary alarms are suppressed
  function mapCard(cfg, label) {
    if (!cfg) return h("div", { class: "card" }, h("strong", {}, "Map unavailable"), h("p", { class: "muted" }, "This link refers to a map that isn't on this phone. Ask the host to resend the link."));
    const el = h("div", { class: "map small" });
    const status = h("div", { class: "status", role: "status" }, "Location off");
    const since = h("div", { class: "muted tiny center" });
    const note = h("p", { class: "muted tiny" });
    const btn = h("button", { class: "ghost" }, icon("pin", 18), " Show me on the map");
    let map = null, group = null, dot = null, ring = null, watch = null, shown = "ok", lastChange = 0, candidate = null, candidateSince = 0;
    const draw = () => {
      if (!MH.hasLeaflet()) { el.replaceChildren(h("div", { class: "map-fallback" }, "Satellite map can't load right now (offline?). Boundary warnings still work.")); return; }
      map = MH.newMap(el, { onTileError: () => { note.textContent = "Satellite imagery isn't loading (weak signal?). The zones and your position still work."; } });
      group = L.layerGroup().addTo(map);
      MH.drawConfig(map, group, cfg);
    };
    queueMicrotask(draw);
    const setStatus = (cls, text) => { status.className = `status ${cls}`; status.textContent = text; };
    const onPos = (p) => {
      const { latitude: la, longitude: lo, accuracy } = p.coords;
      if (map) {
        if (!dot) { ring = L.circle([la, lo], { radius: accuracy || 0, color: "#4aa3ff", weight: 1, fillOpacity: 0.1 }).addTo(map); dot = L.circleMarker([la, lo], { radius: 8, color: "#fff", fillColor: "#4aa3ff", fillOpacity: 1, weight: 3 }).addTo(map); map.setView([la, lo], Math.max(map.getZoom(), 17)); }
        else { dot.setLatLng([la, lo]); ring.setLatLng([la, lo]); ring.setRadius(accuracy || 0); if (!map.getBounds().contains([la, lo])) map.panTo([la, lo]); }
      }
      // Indoors or under cover the fix can be 100 m off: never raise an alarm on it.
      if (accuracy && accuracy > WEAK_ACCURACY_M) { setStatus("weak", `Weak GPS (±${Math.round(accuracy)} m). Move into the open for boundary checks.`); since.textContent = ""; return; }
      const r = MH.check(cfg, la, lo);
      // GPS jumps: a new state must hold for two fixes or 4 s before it is shown.
      if (r.s !== shown) {
        const sig = r.s + (r.n || "");
        if (candidate !== sig) { candidate = sig; candidateSince = Date.now(); return; }
        if (Date.now() - candidateSince < 4000) return;
        shown = r.s; lastChange = Date.now(); candidate = null;
        if (r.s !== "ok") { D.CUES.warn(); announce(r.s === "out" ? "Out of bounds" : `No-go zone: ${r.n}`, true); }
      } else candidate = null;
      setStatus(r.s, r.s === "ok" ? "In bounds" : r.s === "out" ? "OUT OF BOUNDS. Head back to the green area." : `NO-GO ZONE: ${r.n}. Leave now.`);
      since.textContent = r.s === "ok" ? (accuracy ? `GPS accuracy ±${Math.round(accuracy)} m` : "") : `for ${fmt(Date.now() - lastChange)}`;
    };
    const onErr = (e) => {
      if (e && e.code === 1) { stopWatch(); setStatus("", "Location is blocked. Allow it for this site in your browser settings, then tap the button again."); }
      else if (e && e.code === 2) setStatus("", dot ? "GPS signal lost. Last position shown." : "GPS unavailable right now (indoors?). Move outside.");
      else if (!dot) setStatus("", "Still looking for a GPS fix. Stay outdoors.");
    };
    const startWatch = () => {
      if (!navigator.geolocation) return setStatus("", "Location isn't supported on this phone.");
      if (watch != null) return;
      setStatus("", "Finding you…");
      watch = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      btn.hidden = true;
    };
    const stopWatch = () => { if (watch != null) { try { navigator.geolocation.clearWatch(watch); } catch {} } watch = null; btn.hidden = false; };
    btn.addEventListener("click", () => { if (D.lowPower()) { D.setLowPower(false); toast("Low-power mode off"); } startWatch(); });
    // Some browsers quietly stop a watch in the background; restart it on return.
    const onVis = () => { if (!document.body.contains(el)) return document.removeEventListener("visibilitychange", onVis); if (document.visibilityState === "visible" && watch != null) { navigator.geolocation.clearWatch(watch); watch = null; startWatch(); } };
    const onPower = () => { if (!document.body.contains(el)) return document.removeEventListener("mh:lowpower", onPower); if (D.lowPower() && watch != null) { stopWatch(); setStatus("", "Location paused to save battery."); } };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("mh:lowpower", onPower);
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("strong", {}, label), h("span", { class: "muted tiny" }, "green = play · red = no-go")),
      el, note, status, since, btn,
      h("p", { class: "muted tiny" }, "Your position stays on this phone. It is never sent anywhere."));
  }

  return { play, stop };
})();
