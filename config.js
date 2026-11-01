// Campus configuration. Edit this file to adapt Manhunt to your campus.
// Nothing here is personal: no names, no accounts, no tracking.
window.CAMPUS = {
  name: "SNUC",
  tagline: "Campus Manhunt",

  // Always out of bounds, whatever zone is picked.
  offLimits: [
    "Roads and car parks",
    "Hostel / dorm interiors",
    "Labs, server rooms and construction sites",
    "Rooftops and restricted areas",
    "Anywhere after dark outside lit paths",
  ],

  // Shown on the Safety panel and the in-game SOS sheet. Put the real number here
  // before launch; while it is empty the SOS sheet says so.
  safety: {
    label: "Campus security",
    phone: "",
  },

  defaults: { headStartMin: 5, durationMin: 45 },

  // Impersonal codenames: "<adjective> <noun>".
  adjectives: ["Silver", "Quiet", "Swift", "Amber", "Cobalt", "Lunar", "Mellow", "Rapid", "Velvet", "Hidden", "Bright", "Dusky"],
  nouns: ["Falcon", "Otter", "Heron", "Lynx", "Gecko", "Panda", "Raven", "Fox", "Ibis", "Moth", "Wolf", "Crane"],
};
