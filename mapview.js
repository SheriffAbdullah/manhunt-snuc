// Shared map helpers. Zones are a library; a "configuration" says which zones
// are play areas and which are no-go for a given game.
window.MH = (() => {
  const KEY = "manhunt:lib";
  const CENTER = [12.752, 80.196];
  const LIMITS = { zones: 24, pts: 400, name: 60, label: 60 };

  const store = {
    get() { try { return sanitizeCustom(JSON.parse(localStorage.getItem(KEY))); } catch { return { zones: [], configs: [] }; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(sanitizeCustom(v))); } catch {} },
  };

  // ---- validation ------------------------------------------------------------
  // Everything that comes from a link, an import box or localStorage goes through
  // here, so the rest of the code can trust shapes, lengths and number ranges.
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const point = (p) => (Array.isArray(p) && p.length === 2 && num(p[0], -90, 90) !== null && num(p[1], -180, 180) !== null ? [p[0], p[1]] : null);
  const polygon = (pts) => {
    if (!Array.isArray(pts) || pts.length < 3 || pts.length > LIMITS.pts) return null;
    const out = pts.map(point);
    return out.every(Boolean) ? out : null;
  };
  const id = (v) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : null);
  const zone = (z) => {
    if (!z || typeof z !== "object") return null;
    const zid = id(z.id), name = str(z.name, LIMITS.name), pts = polygon(z.pts);
    return zid && name && pts ? { id: zid, name, pts, ...(z.approx ? { approx: true } : {}) } : null;
  };
  const config = (c) => {
    if (!c || typeof c !== "object") return null;
    const cid = id(c.id), label = str(c.label, LIMITS.label);
    const ids = (a) => (Array.isArray(a) ? a.map(id).filter(Boolean).slice(0, LIMITS.zones) : []);
    return cid && label ? { id: cid, label, about: str(c.about, 200) || "", play: ids(c.play), nogo: ids(c.nogo) } : null;
  };
  function sanitizeCustom(v) {
    const zones = Array.isArray(v?.zones) ? v.zones.map(zone).filter(Boolean).slice(0, 60) : [];
    const configs = Array.isArray(v?.configs) ? v.configs.map(config).filter(Boolean).slice(0, 30) : [];
    return { zones, configs };
  }

  async function loadLibrary() {
    const base = await fetch("maps.json").then((r) => r.json()).then(sanitizeCustom).catch(() => ({ zones: [], configs: [] }));
    const custom = store.get();
    const merge = (a, b) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
    return {
      zones: merge(base.zones, custom.zones),
      configs: merge(base.configs, custom.configs),
      customZoneIds: new Set(custom.zones.map((z) => z.id)),
      customConfigIds: new Set(custom.configs.map((c) => c.id)),
    };
  }

  const resolve = (lib, cid) => {
    const c = lib.configs.find((x) => x.id === cid);
    if (!c) return null;
    const zs = (ids) => ids.map((i) => lib.zones.find((z) => z.id === i)).filter(Boolean).map((z) => ({ n: z.name, pts: z.pts }));
    return { id: c.id, label: c.label, about: c.about || "", play: zs(c.play), nogo: zs(c.nogo) };
  };

  // ---- compact link form ------------------------------------------------------
  // Points are stored as integers in 1e-5 degrees (about 1 m): the first point
  // absolute, the rest as deltas from the previous point. A 20-corner campus
  // polygon is ~150 characters instead of ~450, which keeps links short enough
  // for QR codes and chat apps.
  const S = 1e5;
  const packPts = (pts) => {
    const out = [];
    let pa = 0, pb = 0;
    for (const [la, lo] of pts) {
      const a = Math.round(la * S), b = Math.round(lo * S);
      out.push(a - pa, b - pb); pa = a; pb = b;
    }
    return out;
  };
  const unpackPts = (flat) => {
    if (!Array.isArray(flat) || flat.length < 6 || flat.length % 2 || flat.length > LIMITS.pts * 2) return null;
    if (!flat.every((n) => Number.isInteger(n) && Math.abs(n) <= 180 * S)) return null;
    const pts = [];
    let a = 0, b = 0;
    for (let i = 0; i < flat.length; i += 2) { a += flat[i]; b += flat[i + 1]; pts.push([a / S, b / S]); }
    return polygon(pts);
  };
  const pack = (r) => ({ v: 2, l: r.label, p: r.play.map((z) => [z.n, packPts(z.pts)]), x: r.nogo.map((z) => [z.n, packPts(z.pts)]) });
  // Accepts v2 (delta ints) and v1 (nested [lat,lng] pairs) payloads. Returns null on anything malformed.
  const unpack = (o) => {
    if (!o || typeof o !== "object") return null;
    const label = str(o.l, LIMITS.label);
    const zones = (arr) => {
      if (!Array.isArray(arr) || arr.length > LIMITS.zones) return null;
      const out = [];
      for (const e of arr) {
        if (!Array.isArray(e) || e.length !== 2) return null;
        const n = str(e[0], LIMITS.name);
        const pts = Array.isArray(e[1]) && Array.isArray(e[1][0]) ? polygon(e[1]) : unpackPts(e[1]);
        if (!n || !pts) return null;
        out.push({ n, pts });
      }
      return out;
    };
    const play = zones(o.p), nogo = zones(o.x);
    return label && play && nogo ? { id: "inline", label, about: "", play, nogo } : null;
  };

  // ---- geometry -----------------------------------------------------------------
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
  const bounds = (r) => [...r.play, ...r.nogo].flatMap((z) => z.pts);

  // ---- Leaflet ---------------------------------------------------------------
  const hasLeaflet = () => typeof window.L !== "undefined";
  const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  // onTileError fires once, the first time imagery fails to load (offline, blocked).
  function newMap(el, { onTileError } = {}) {
    const map = L.map(el, { zoomControl: true, attributionControl: true, tap: false }).setView(CENTER, 16);
    const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: "Imagery © Esri" }).addTo(map);
    let told = false;
    tiles.on("tileerror", () => { if (!told && onTileError) { told = true; onTileError(); } });
    return map;
  }

  // Tooltip content is a DOM node, never a string: Leaflet renders strings as HTML
  // and zone names can come from an untrusted link.
  const tip = (text) => { const s = document.createElement("span"); s.textContent = text; return s; };
  function drawConfig(map, group, r, { fit = true } = {}) {
    group.clearLayers();
    if (!r) return;
    for (const z of r.play) L.polygon(z.pts, { color: "#35e0a1", weight: 3, fillOpacity: 0.08 }).bindTooltip(tip(z.n)).addTo(group);
    for (const z of r.nogo) L.polygon(z.pts, { color: "#ff5d52", weight: 2, fillOpacity: 0.35 }).bindTooltip(tip("No-go: " + z.n)).addTo(group);
    const all = bounds(r);
    if (fit && all.length) map.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
  }

  return { loadLibrary, resolve, pack, unpack, check, inside, bounds, newMap, drawConfig, tip, hasLeaflet, saveCustom: store.set, readCustom: store.get, sanitizeCustom, CENTER, LIMITS };
})();
