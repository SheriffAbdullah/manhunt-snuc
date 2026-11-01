// Shared map helpers. Zones are a library; a "configuration" says which zones
// are play areas and which are no-go for a given game.
window.MH = (() => {
  const KEY = "manhunt:lib";
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || { zones: [], configs: [] }; } catch { return { zones: [], configs: [] }; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  };
  const CENTER = [12.752, 80.196];

  async function loadLibrary() {
    const base = await fetch("maps.json").then((r) => r.json()).catch(() => ({ zones: [], configs: [] }));
    const custom = store.get();
    const merge = (a, b) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
    return {
      zones: merge(base.zones, custom.zones),
      configs: merge(base.configs, custom.configs),
      customZoneIds: new Set(custom.zones.map((z) => z.id)),
      customConfigIds: new Set(custom.configs.map((c) => c.id)),
    };
  }

  const resolve = (lib, id) => {
    const c = lib.configs.find((x) => x.id === id);
    if (!c) return null;
    const zs = (ids) => ids.map((i) => lib.zones.find((z) => z.id === i)).filter(Boolean).map((z) => ({ n: z.name, pts: z.pts }));
    return { id: c.id, label: c.label, about: c.about || "", play: zs(c.play), nogo: zs(c.nogo) };
  };

  // Compact form that fits in a share link (3 decimals ~ 100 m is too coarse, so keep 5).
  const pack = (r) => ({ l: r.label, p: r.play.map((z) => [z.n, z.pts.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])]), x: r.nogo.map((z) => [z.n, z.pts.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])]) });
  const unpack = (o) => ({ id: "inline", label: o.l, about: "", play: o.p.map(([n, pts]) => ({ n, pts })), nogo: o.x.map(([n, pts]) => ({ n, pts })) });

  const inside = (lat, lng, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [yi, xi] = pts[i], [yj, xj] = pts[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // ok | out (outside every play area) | nogo (inside a forbidden zone)
  const check = (r, lat, lng) => {
    for (const z of r.nogo) if (inside(lat, lng, z.pts)) return { s: "nogo", n: z.n };
    if (r.play.length && !r.play.some((z) => inside(lat, lng, z.pts))) return { s: "out" };
    return { s: "ok" };
  };

  function newMap(el) {
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(CENTER, 16);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery © Esri",
    }).addTo(map);
    return map;
  }

  function drawConfig(map, group, r) {
    group.clearLayers();
    if (!r) return;
    for (const z of r.play) L.polygon(z.pts, { color: "#3ddc97", weight: 3, fillOpacity: 0.08 }).bindTooltip(z.n).addTo(group);
    for (const z of r.nogo) L.polygon(z.pts, { color: "#ff5a4f", weight: 2, fillOpacity: 0.35 }).bindTooltip(`No-go: ${z.n}`).addTo(group);
    const all = [...r.play, ...r.nogo].flatMap((z) => z.pts);
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
  }

  return { loadLibrary, resolve, pack, unpack, check, newMap, drawConfig, saveCustom: store.set, readCustom: store.get, CENTER };
})();
