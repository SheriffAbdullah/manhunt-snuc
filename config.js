// Campus configuration. Edit this file to adapt Manhunt to your campus.
// Nothing here is personal: no names, no accounts, no tracking.
window.CAMPUS = {
  // Shown under the wordmark and in the About line. One university, one campus:
  // SSN College of Engineering became the SSN School of Engineering within
  // Shiv Nadar University Chennai from the 2026-27 academic year.
  name: "Shiv Nadar University Chennai",
  place: "Kalavakkam",
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

  // Live scoreboard server (see server/API.md), e.g. "https://manhunt-api.example.com".
  // Leave empty to run fully offline: no network calls, no sync UI. When set,
  // phones send only their random codename, the random game id and
  // join/catch/out/ping events. Never location. Games are deleted 24 h after they end.
  api: "",

  // Impersonal codenames: "<adjective> <noun>".
  adjectives: ["Silver", "Quiet", "Swift", "Amber", "Cobalt", "Lunar", "Mellow", "Rapid", "Velvet", "Hidden", "Bright", "Dusky"],
  nouns: ["Falcon", "Otter", "Heron", "Lynx", "Gecko", "Panda", "Raven", "Fox", "Ibis", "Moth", "Wolf", "Crane"],
};
