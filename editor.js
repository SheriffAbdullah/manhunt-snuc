// Map editor: draw zones on satellite imagery, then combine them into configurations.
window.MHEditor = (() => {
  const EMPTY = () => ({ id: null, label: "", about: "", play: [], nogo: [] });
  const newId = () => "x-" + Math.random().toString(36).slice(2, 8);

  async function show({ h, mount, icon, toast, exit }) {
    let lib = await MH.loadLibrary();
    let drawing = null; // { id|null, name, pts }
    let cur = EMPTY();

    const mapEl = h("div", { id: "map", class: "map" });
    const panel = h("div");
    const hint = h("div", { class: "map-hint", hidden: true });
    mount(
      h("div", { class: "page-head" }, h("a", { class: "icon-btn", href: "#", "aria-label": "Back" }, icon("back")), h("h1", {}, "Map editor"),
        h("button", { class: "ghost sm", type: "button", onclick: () => exit() }, "Done")),
      h("div", { class: "map-wrap" }, mapEl, hint), panel);

    if (!MH.hasLeaflet()) {
      mapEl.replaceChildren(h("div", { class: "map-fallback" }, "The map library couldn't load. Connect to the internet and reload to edit maps."));
      panel.append(h("div", { class: "card" }, h("p", { class: "muted" }, "Your saved zones are safe; you can still export them below."), exportCard()));
      return;
    }

    const map = MH.newMap(mapEl, { onTileError: () => toast("Satellite imagery isn't loading. Check your connection.") });
    map.doubleClickZoom.disable();
    const outlines = L.layerGroup().addTo(map);
    const group = L.layerGroup().addTo(map);
    const draft = L.layerGroup().addTo(map);
    const preview = () => MH.drawConfig(map, group, MH.resolve({ zones: lib.zones, configs: [{ ...cur, id: "p" }] }, "p"), { fit: false });
    const drawOutlines = () => { outlines.clearLayers(); for (const z of lib.zones) L.polygon(z.pts, { color: "#ffc53d", weight: 1.5, opacity: .7, fillOpacity: 0.04, dashArray: "4" }).bindTooltip(MH.tip(z.name)).addTo(outlines); };
    const refresh = async () => { lib = await MH.loadLibrary(); drawOutlines(); render(); preview(); };
    const saveCustom = (fn) => { const c = MH.readCustom(); fn(c); MH.saveCustom(c); return refresh(); };
    const fit = (pts) => map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });

    // ---- drawing -------------------------------------------------------------
    const vtxIcon = L.divIcon({ className: "vtx", iconSize: [22, 22] });
    const redrawDraft = () => {
      draft.clearLayers();
      if (!drawing) { hint.hidden = true; return; }
      hint.hidden = false;
      hint.textContent = drawing.pts.length < 3 ? `Tap the map to add corners (${drawing.pts.length}/3 minimum)` : `${drawing.pts.length} corners · drag to move · tap a corner to remove`;
      if (drawing.pts.length > 1) L.polygon(drawing.pts, { color: "#ffc53d", weight: 2, dashArray: "6", fillOpacity: 0.12 }).addTo(draft);
      drawing.pts.forEach((p, i) => {
        const m = L.marker(p, { draggable: true, icon: vtxIcon, keyboard: false }).addTo(draft);
        m.on("drag", (e) => { const { lat, lng } = e.target.getLatLng(); drawing.pts[i] = [+lat.toFixed(6), +lng.toFixed(6)]; });
        m.on("dragend", () => { redrawDraft(); render(); });
        m.on("click", () => { drawing.pts.splice(i, 1); redrawDraft(); render(); });
      });
    };
    map.on("click", (e) => {
      if (!drawing) return;
      drawing.pts.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      redrawDraft(); render();
    });
    const startDrawing = (z) => { drawing = z ? { id: z.id, name: z.name, pts: z.pts.map((p) => [...p]) } : { id: null, name: "", pts: [] }; if (z) fit(z.pts); redrawDraft(); render(); };
    const stopDrawing = () => { drawing = null; redrawDraft(); render(); };
    const addMyLocation = () => {
      if (!navigator.geolocation) return toast("Location isn't supported here.");
      toast("Getting your position…");
      navigator.geolocation.getCurrentPosition((p) => {
        if (!drawing) return;
        const pt = [+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)];
        drawing.pts.push(pt); map.setView(pt, Math.max(map.getZoom(), 17)); redrawDraft(); render();
      }, () => toast("Couldn't get your position."), { enableHighAccuracy: true, timeout: 15000 });
    };

    // ---- import / export --------------------------------------------------------
    function exportCard() {
      const importBox = h("textarea", { rows: 3, placeholder: "Paste exported maps JSON here", "aria-label": "Import maps" });
      const custom = MH.readCustom();
      const json = () => JSON.stringify(MH.readCustom(), null, 1);
      return h("div", { class: "card" },
        h("div", { class: "card-head" }, h("strong", {}, "Share your maps")),
        h("p", { class: "muted" }, `Zones and configurations you draw live only on this phone (${custom.zones.length} zone${custom.zones.length === 1 ? "" : "s"}, ${custom.configs.length} configuration${custom.configs.length === 1 ? "" : "s"}). Export to move them to another phone, or send them to the repo owner to become presets.`),
        h("div", { class: "row" },
          h("button", { class: "ghost sm", type: "button", disabled: !custom.zones.length && !custom.configs.length, onclick: async () => {
            try { if (navigator.share) await navigator.share({ title: "Manhunt maps", text: json() }); else { await navigator.clipboard.writeText(json()); toast("Copied JSON"); } } catch {}
          } }, "Copy / share JSON"),
          h("button", { class: "ghost sm", type: "button", disabled: !custom.zones.length && !custom.configs.length, onclick: () => {
            const a = h("a", { href: URL.createObjectURL(new Blob([json()], { type: "application/json" })), download: "manhunt-maps.json" }); document.body.append(a); a.click(); a.remove();
          } }, "Download file")),
        importBox,
        h("div", { class: "row" },
          h("button", { class: "ghost sm", type: "button", onclick: () => {
            let inc;
            try { inc = MH.sanitizeCustom(JSON.parse(importBox.value)); } catch { inc = null; }
            if (!inc || (!inc.zones.length && !inc.configs.length)) return toast("That doesn't look like exported maps.");
            saveCustom((c) => {
              const m = (a, b) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
              c.zones = m(c.zones, inc.zones); c.configs = m(c.configs, inc.configs);
            }).then(() => toast(`Imported ${inc.zones.length} zones, ${inc.configs.length} configurations`));
          } }, "Import"),
          h("button", { class: "ghost sm danger", type: "button", disabled: !custom.zones.length && !custom.configs.length, onclick: () => { if (confirm("Delete every custom zone and configuration on this phone?")) saveCustom((c) => { c.zones = []; c.configs = []; }); } }, "Delete all custom")));
    }

    // ---- panel ----------------------------------------------------------------------
    function render() {
      const name = h("input", { placeholder: "Zone name, e.g. Girls hostel", value: drawing?.name || "", id: "zname", "aria-label": "Zone name", maxlength: MH.LIMITS.name });
      name.addEventListener("input", () => { if (drawing) drawing.name = name.value; });

      const drawCard = drawing
        ? h("div", { class: "card drawing" },
            h("div", { class: "card-head" }, h("strong", {}, drawing.id ? "Editing zone" : "New zone"), h("span", { class: "muted tiny" }, `${drawing.pts.length} corners`)),
            name,
            h("div", { class: "row" },
              h("button", { class: "ghost sm", type: "button", disabled: !drawing.pts.length, onclick: () => { drawing.pts.pop(); redrawDraft(); render(); } }, "Undo corner"),
              h("button", { class: "ghost sm", type: "button", onclick: addMyLocation }, icon("pin", 16), " Add my position")),
            h("button", { class: "primary", type: "button", disabled: drawing.pts.length < 3, onclick: () => {
              if (!(drawing.name || "").trim()) { toast("Give the zone a name."); name.focus(); return; }
              const z = { id: drawing.id || newId(), name: drawing.name.trim(), pts: drawing.pts };
              drawing = null; redrawDraft();
              saveCustom((c) => { c.zones = [...c.zones.filter((x) => x.id !== z.id), z]; }).then(() => toast("Zone saved"));
            } }, drawing.pts.length < 3 ? "Add at least 3 corners" : "Save zone"),
            h("button", { class: "ghost sm", type: "button", onclick: stopDrawing }, "Cancel"))
        : h("button", { class: "primary", type: "button", onclick: () => startDrawing(null) }, "+ Draw a new zone");

      const zoneRows = lib.zones.map((z) => {
        const custom = lib.customZoneIds.has(z.id);
        return h("div", { class: "zr" },
          h("span", { class: "zr-name" }, z.name, z.approx ? h("span", { class: "muted" }, " · approx.") : null, custom ? null : h("span", { class: "muted" }, " · preset")),
          h("button", { class: "ghost sm", type: "button", "aria-label": `Show ${z.name}`, onclick: () => fit(z.pts) }, "Show"),
          custom
            ? h("button", { class: "ghost sm", type: "button", "aria-label": `Edit ${z.name}`, onclick: () => startDrawing(z) }, "Edit")
            : h("button", { class: "ghost sm", type: "button", "aria-label": `Copy ${z.name} to edit`, onclick: () => startDrawing({ id: null, name: z.name + " (edited)", pts: z.pts }) }, "Copy"),
          custom ? h("button", { class: "ghost sm danger", type: "button", "aria-label": `Delete ${z.name}`, onclick: () => { if (confirm(`Delete zone "${z.name}"?`)) saveCustom((c) => { c.zones = c.zones.filter((x) => x.id !== z.id); }); } }, "Delete") : null);
      });

      const sel = h("select", { "aria-label": "Configuration" },
        h("option", { value: "" }, "New configuration…"),
        lib.configs.map((c) => h("option", { value: c.id, selected: c.id === cur.id }, c.label + (lib.customConfigIds.has(c.id) ? "" : " (preset)"))));
      sel.addEventListener("change", () => {
        const c = lib.configs.find((x) => x.id === sel.value);
        cur = c ? { ...c, play: [...c.play], nogo: [...c.nogo] } : EMPTY();
        render(); preview();
        const pts = MH.bounds(MH.resolve({ zones: lib.zones, configs: [{ ...cur, id: "p" }] }, "p"));
        if (pts.length) fit(pts);
      });
      const isPreset = cur.id && !lib.customConfigIds.has(cur.id);
      const label = h("input", { placeholder: "Configuration name, e.g. Women's hostel night", value: cur.label, "aria-label": "Configuration name", maxlength: MH.LIMITS.label });
      label.addEventListener("input", () => { cur.label = label.value; });
      const about = h("input", { placeholder: "One-line description (optional)", value: cur.about || "", "aria-label": "Description", maxlength: 200 });
      about.addEventListener("input", () => { cur.about = about.value; });

      const roleOf = (id) => (cur.play.includes(id) ? "play" : cur.nogo.includes(id) ? "nogo" : "none");
      const roles = lib.zones.map((z) => {
        const s = h("select", { "aria-label": `${z.name} role` },
          h("option", { value: "none" }, "Not used"), h("option", { value: "play" }, "Play area"), h("option", { value: "nogo" }, "No-go"));
        s.value = roleOf(z.id);
        s.addEventListener("change", () => {
          cur.play = cur.play.filter((i) => i !== z.id); cur.nogo = cur.nogo.filter((i) => i !== z.id);
          if (s.value === "play") cur.play.push(z.id); if (s.value === "nogo") cur.nogo.push(z.id);
          s.className = s.value; preview();
        });
        s.className = s.value;
        return h("div", { class: "zr" }, h("span", { class: "zr-name" }, z.name), s);
      });

      panel.replaceChildren(
        drawCard,
        h("h2", {}, "Zones"),
        h("div", { class: "card" }, lib.zones.length ? zoneRows : h("p", { class: "muted" }, "No zones yet. Draw one above."),
          h("p", { class: "muted tiny" }, "Presets come from maps.json and can't be changed here. Copy one to adjust it.")),
        h("h2", {}, "Configurations"),
        h("div", { class: "card stack" },
          h("p", { class: "muted" }, "A configuration is a map for one game: which zones you play in (green) and which are no-go (red)."),
          sel, label, about,
          roles,
          isPreset ? h("p", { class: "muted tiny" }, "Presets can't be overwritten. Saving creates a copy.") : null,
          h("button", { class: "primary", type: "button", onclick: () => {
            if (!cur.label.trim()) { toast("Name the configuration."); label.focus(); return; }
            if (!cur.play.length) return toast("Pick at least one play area.");
            const c = { id: cur.id && !isPreset ? cur.id : newId(), label: cur.label.trim(), about: (cur.about || "").trim(), play: cur.play, nogo: cur.nogo };
            cur = { ...c };
            saveCustom((cc) => { cc.configs = [...cc.configs.filter((x) => x.id !== c.id), c]; }).then(() => toast("Configuration saved. It's now in the host menu."));
          } }, cur.id && !isPreset ? "Save changes" : "Save as new configuration"),
          cur.id && !isPreset ? h("button", { class: "ghost sm danger", type: "button", onclick: () => { if (!confirm(`Delete "${cur.label}"?`)) return; const id = cur.id; cur = EMPTY(); saveCustom((c) => { c.configs = c.configs.filter((x) => x.id !== id); }); } }, "Delete this configuration") : null),
        h("h2", {}, "Backup"),
        exportCard(),
      );
    }
    drawOutlines(); render(); preview();
    const all = MH.bounds(MH.resolve({ zones: lib.zones, configs: [{ id: "p", label: "p", play: lib.zones.map((z) => z.id), nogo: [] }] }, "p"));
    if (all.length) fit(all);
  }
  return { show };
})();
