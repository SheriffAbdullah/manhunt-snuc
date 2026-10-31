// Campus configuration. Edit this file to adapt Manhunt to your campus.
// Nothing here is personal: no names, no accounts, no tracking.
window.CAMPUS = {
  name: "SNUC",
  tagline: "Campus Manhunt",

  // Pre-set play areas shown when a game master creates a game.
  // Replace these with real, safe, well-lit areas on your campus.
  zones: [
    { id: "core", label: "Core Campus", rule: "Between the main gate, library and student centre." },
    { id: "north", label: "North Quad", rule: "North Quad lawns and walkways only." },
    { id: "full", label: "Full Campus", rule: "Anywhere inside the campus perimeter wall." },
  ],

  // Always out of bounds, whatever zone is picked.
  offLimits: [
    "Roads and car parks",
    "Hostel / dorm interiors",
    "Labs, server rooms and construction sites",
    "Rooftops and restricted areas",
    "Anywhere after dark outside lit paths",
  ],

  // Shown on the Safety panel. Put real numbers here before launch.
  safety: {
    label: "Campus security",
    phone: "",
  },

  defaults: { headStartMin: 5, durationMin: 45 },

  // Impersonal codenames: "<adjective> <noun>".
  adjectives: ["Silver", "Quiet", "Swift", "Amber", "Cobalt", "Lunar", "Mellow", "Rapid", "Velvet", "Hidden", "Bright", "Dusky"],
  nouns: ["Falcon", "Otter", "Heron", "Lynx", "Gecko", "Panda", "Raven", "Fox", "Ibis", "Moth", "Wolf", "Crane"],
};
