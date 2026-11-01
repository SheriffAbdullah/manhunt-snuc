// Map editor: draw zones on satellite imagery, then combine them into configurations.
window.MHEditor = (() => {
  async function show({ h, mount, exit }) {
    let lib = await MH.loadLibrary();
    let drawing = null; // { pts: [], line }
    let cur = { id: null, label: "", about: "", play: [], nogo: [] };

    const mapEl = h("div", { id: "map", class: "map" });
    const panel = h("div");
    mount(h("div", { class: "row" }, h("h1", {}, "Map editor"), h("button", { class: "ghost", onclick: () => { map.remove(); exit(); } }, "Done")), mapEl, panel);

    const map = MH.newMap(mapEl);
    const group = L.layerGroup().addTo(map);
    const draft = L.layerGroup().addTo(map);
    const preview = () => MH.drawConfig(map, group, MH.resolve({ zones: lib.zones, configs: [{ ...cur, id: "p" }] }, "p"));
    const refresh = async () => { lib = await MH.loadLibrary(); render(); preview(); };

    map.on("click", (e) => {
      if (!drawing) return;
      drawing.pts.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      draft.clearLayers();
      drawing.pts.forEach((p) => L.circleMarker(p, { radius: 5, color: "#f5c451" }).addTo(draft));
      if (drawing.pts.length > 1) L.polygon(drawing.pts, { color: "#f5c451", weight: 2, dashArray: "6" }).addTo(draft);
      render();
    });

    const saveCustom = (fn) => { const c = MH.readCustom(); fn(c); MH.saveCustom(c); return refresh(); };

    function render() {
      const name = h("input", { placeholder: "Zone name, e.g. Girls hostel", value: drawing?.name || "", id: "zname" });
      name.addEventListener("input", () => { if (drawing) drawing.name = name.value; });

      const draw = drawing
        ? h("div", { class: "card" },
            h("strong", {}, "Drawing: tap the map to add corners"), h("p", { class: "muted" }, `${drawing.pts.length} points`), name,
            h("div", { class: "row" },
              h("button", { class: "ghost", onclick: () => { drawing.pts.pop(); draft.clearLayers(); drawing.pts.forEach((p) => L.circleMarker(p, { radius: 5, color: "#f5c451" }).addTo(draft)); render(); } }, "Undo point"),
              h("button", { class: "ghost", onclick: () => { drawing = null; draft.clearLayers(); render(); } }, "Cancel")),
            h("button", {
              onclick: () => {
                if (drawing.pts.length < 3) return alert("Add at least 3 points.");
                if (!(drawing.name || "").trim()) return alert("Give the zone a name.");
                const z = { id: "x-" + Math.random().toString(36).slice(2, 8), name: drawing.name.trim(), pts: drawing.pts };
                drawing = null; draft.clearLayers();
                saveCustom((c) => c.zones.push(z));
              },
            }, "Save zone"))
        : h("button", { onclick: () => { drawing = { pts: [], name: "" }; render(); } }, "+ Draw a new zone");

      const zoneRows = lib.zones.map((z) => h("div", { class: "row zr" },
        h("span", {}, z.name, z.approx ? h("span", { class: "muted" }, " (approx.)") : null),
        h("button", { class: "ghost sm", onclick: () => map.fitBounds(L.latLngBounds(z.pts), { padding: [30, 30] }) }, "Show"),
        lib.customZoneIds.has(z.id)
          ? h("button", { class: "ghost sm", onclick: () => saveCustom((c) => { c.zones = c.zones.filter((x) => x.id !== z.id); }) }, "Delete")
          : h("span", { class: "muted" }, "preset")));

      const sel = h("select", { "aria-label": "Configuration" },
        h("option", { value: "" }, "New configuration"),
        lib.configs.map((c) => h("option", { value: c.id, ...(c.id === cur.id ? { selected: "" } : {}) }, c.label)));
      sel.addEventListener("change", () => {
        const c = lib.configs.find((x) => x.id === sel.value);
        cur = c ? { ...c, play: [...c.play], nogo: [...c.nogo] } : { id: null, label: "", about: "", play: [], nogo: [] };
        render(); preview();
      });
      const label = h("input", { placeholder: "Configuration name, e.g. Women's hostel night", value: cur.label });
      label.addEventListener("input", () => { cur.label = label.value; });

      const roleOf = (id) => (cur.play.includes(id) ? "play" : cur.nogo.includes(id) ? "nogo" : "none");
      const roles = lib.zones.map((z) => {
        const s = h("select", { "aria-label": z.name },
          h("option", { value: "none" }, "Not used"), h("option", { value: "play" }, "Play area"), h("option", { value: "nogo" }, "No-go"));
        s.value = roleOf(z.id);
        s.addEventListener("change", () => {
          cur.play = cur.play.filter((i) => i !== z.id); cur.nogo = cur.nogo.filter((i) => i !== z.id);
          if (s.value === "play") cur.play.push(z.id); if (s.value === "nogo") cur.nogo.push(z.id);
          preview();
        });
        return h("div", { class: "row zr" }, h("span", {}, z.name), s);
      });

      const isCustom = cur.id && lib.customConfigIds.has(cur.id);
      const exportBox = h("textarea", { rows: 4, readonly: "", "aria-label": "Export" });
      exportBox.value = JSON.stringify(MH.readCustom());
      const importBox = h("textarea", { rows: 3, placeholder: "Paste exported JSON here", "aria-label": "Import" });

      panel.replaceChildren(
        draw,
        h("h2", {}, "Zones"), h("div", { class: "card" }, zoneRows),
        h("h2", {}, "Configurations"),
        h("div", { class: "card" }, sel, label, h("p", { class: "muted" }, "Green = where the game is played. Red = out of bounds."), roles,
          h("button", {
            onclick: () => {
              if (!cur.label.trim()) return alert("Name the configuration.");
              if (!cur.play.length) return alert("Pick at least one play area.");
              const c = { id: isCustom ? cur.id : "x-" + Math.random().toString(36).slice(2, 8), label: cur.label.trim(), about: cur.about || "", play: cur.play, nogo: cur.nogo };
              cur = { ...c };
              saveCustom((cc) => { cc.configs = [...cc.configs.filter((x) => x.id !== c.id), c]; });
            },
          }, isCustom ? "Save changes" : "Save as new configuration"),
          isCustom ? h("button", { class: "ghost", onclick: () => { const id = cur.id; cur = { id: null, label: "", about: "", play: [], nogo: [] }; saveCustom((c) => { c.configs = c.configs.filter((x) => x.id !== id); }); } }, "Delete this configuration") : null),
        h("h2", {}, "Share your maps"),
        h("div", { class: "card" },
          h("p", { class: "muted" }, "Your zones live on this phone. Copy this to send them to another phone, or give it to the repo owner to make them permanent presets."),
          exportBox,
          importBox,
          h("button", { class: "ghost", onclick: () => {
            try {
              const inc = JSON.parse(importBox.value);
              if (!Array.isArray(inc.zones) || !Array.isArray(inc.configs)) throw 0;
              saveCustom((c) => {
                const m = (a, b) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
                c.zones = m(c.zones, inc.zones); c.configs = m(c.configs, inc.configs);
              });
            } catch { alert("That doesn't look like exported maps."); }
          } }, "Import")),
      );
    }
    render(); preview();
  }
  return { show };
})();
