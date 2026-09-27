export const ASK_N = 13;

export const LAND_OPTS = [
  { v: "Public Sale", lab: "Public sale" },
  { v: "URA Transfer", lab: "URA" },
  { v: "PLB Transfer", lab: "Land Bank" },
  { v: "CDC Property Reserve", lab: "CDC reserve" },
];

export function defaultAsk() {
  return {
    askTypes: ["duplex", "small_multifamily"],
    askByRight: "prefer",
    askLand: [],
    askCluster: 0,
    askWho: "skip",
    askPressure: "flag",
    askFlood: "warn",
    askSlope: "warn",
    askBus: 0,
    askTrees: 0,
    askLihtc: "skip",
    askAllCity: false,
    askPlaces: [],
    transitMaxFt: 0,
  };
}

export function ensureAsk(s) {
  const d = defaultAsk();
  if (!Array.isArray(s.askTypes) || !s.askTypes.length) {
    s.askTypes = (s.missionTypes || d.askTypes).filter((t) => t === "duplex" || t === "small_multifamily");
    if (!s.askTypes.length) s.askTypes = ["duplex"];
  }
  if (!s.askByRight) s.askByRight = s.missionByRight === false ? "skip" : "prefer";
  if (!Array.isArray(s.askLand)) s.askLand = [];
  if (s.askCluster == null) s.askCluster = 0;
  if (!s.askWho) s.askWho = "skip";
  if (!s.askPressure) s.askPressure = "flag";
  if (!s.askFlood) s.askFlood = "warn";
  if (!s.askSlope) s.askSlope = "warn";
  if (s.askBus == null) s.askBus = Number(s.transitMaxFt || 0);
  if (s.askTrees == null) s.askTrees = 0;
  if (!s.askLihtc) s.askLihtc = "skip";
  if (s.askAllCity == null) s.askAllCity = Boolean(s.missionAllCity);
  if (!Array.isArray(s.askPlaces)) s.askPlaces = s.missionPlaces || [];
  return s;
}

export function snapshotAsk(s) {
  return {
    askTypes: [...(s.askTypes || [])],
    askByRight: s.askByRight,
    askLand: [...(s.askLand || [])],
    askCluster: s.askCluster,
    askWho: s.askWho,
    askPressure: s.askPressure,
    askFlood: s.askFlood,
    askSlope: s.askSlope,
    askBus: s.askBus,
    askTrees: s.askTrees,
    askLihtc: s.askLihtc,
    askAllCity: s.askAllCity,
    askPlaces: [...(s.askPlaces || [])],
  };
}

export function restoreAsk(s, snap) {
  if (!snap) return;
  Object.assign(s, snap);
}

export function syncMix(s) {
  ensureAsk(s);
  const w = s.weights || {};
  w.feasibility = { skip: 0, prefer: 50, must: 100 }[s.askByRight] ?? 50;
  w.demand_fit = s.askWho === "renters" ? 100 : s.askWho === "lower" ? 70 : 10;
  w.affordability_impact = { toward: 90, flag: 55, avoid: 15, skip: 0 }[s.askPressure] ?? 20;
  w.displacement_risk = { toward: 100, flag: 70, avoid: 45, skip: 0 }[s.askPressure] ?? 20;
  w.climate_proxy = s.askBus >= 400 && s.askBus <= 500 ? 100 : s.askBus === 1320 ? 70 : s.askBus === 2640 ? 40 : 0;
  s.weights = w;
  s.transitMaxFt = Number(s.askBus || 0);
  s.missionByRight = s.askByRight === "must";
  s.missionTypes = s.askTypes.filter((t) => t === "duplex" || t === "small_multifamily");
  if (!s.missionTypes.length) s.missionTypes = ["duplex"];
  s.missionType = s.missionTypes.length === 1 ? s.missionTypes[0] : "any";
  s.missionPlaces = s.askAllCity ? [] : s.askPlaces || [];
  s.missionAllCity = Boolean(s.askAllCity) || !(s.missionPlaces || []).length;
}

export function detectClash(s, justId) {
  const smf = (s.askTypes || []).includes("small_multifamily");
  if ((justId === "right" || justId === "type") && s.askByRight === "must" && smf) {
    return {
      thisLab: "must already be allowed",
      vsLab: "small apartment",
      text: "Must by-right will drop most single-family districts. Does by-right matter more than chasing a small apartment?",
      soften:
        justId === "right"
          ? (row) => {
              row.askTypes = (row.askTypes || []).filter((t) => t !== "small_multifamily");
              if (!row.askTypes.length) row.askTypes = ["duplex"];
            }
          : (row) => {
              row.askByRight = "prefer";
            },
    };
  }
  if ((justId === "cluster" || justId === "slope") && Number(s.askCluster) >= 2 && s.askSlope === "skip") {
    return {
      thisLab: justId === "cluster" ? "must be a cluster" : "skip hillsides",
      vsLab: justId === "cluster" ? "skip hillsides" : "must be a cluster",
      text: "Clusters of city lots often sit on slopes. Requiring neighbors will keep steep lots. Does this matter more than the other?",
      soften:
        justId === "cluster"
          ? (row) => {
              row.askSlope = "warn";
            }
          : (row) => {
              row.askCluster = 0;
            },
    };
  }
  if (
    (justId === "flood" || justId === "who" || justId === "pressure") &&
    s.askFlood === "skip" &&
    (s.askWho === "renters" || s.askPressure === "toward")
  ) {
    return {
      thisLab: justId === "flood" ? "skip flood lots" : "high-need / renter tracts",
      vsLab: justId === "flood" ? "high-need tracts" : "skip flood lots",
      text: "Skipping special flood hazard lots drops some river and high-need tracts. Does this matter more than the other?",
      soften:
        justId === "flood"
          ? (row) => {
              if (row.askPressure === "toward") row.askPressure = "flag";
              if (row.askWho === "renters") row.askWho = "skip";
            }
          : (row) => {
              row.askFlood = "warn";
            },
    };
  }
  if ((justId === "bus" || justId === "slope") && Number(s.askBus) > 0 && Number(s.askBus) <= 1320 && s.askSlope === "skip") {
    return {
      thisLab: justId === "bus" ? "a short walk to the bus" : "skip hillsides",
      vsLab: justId === "bus" ? "skip hillsides" : "a short walk to the bus",
      text: "A short walk to the bus will keep some steep lots. Does this matter more than the other?",
      soften:
        justId === "bus"
          ? (row) => {
              row.askSlope = "warn";
            }
          : (row) => {
              row.askBus = 0;
            },
    };
  }
  if (justId === "trees" && Number(s.askTrees) >= 2) {
    return {
      thisLab: "lots with street trees",
      vsLab: "bare vacant land",
      text: "Requiring street trees drops empty corridors that are otherwise ready to walk. Does shade matter more than walking vacant land?",
      soften: (row) => {
        row.askTrees = 0;
      },
    };
  }
  if ((justId === "lihtc" || justId === "who") && s.askLihtc === "avoid" && (s.askWho === "lower" || s.askWho === "renters")) {
    return {
      thisLab: justId === "lihtc" ? "avoid stacking on LIHTC" : "serve lower-income tracts",
      vsLab: justId === "lihtc" ? "serve that income band" : "avoid stacking on LIHTC",
      text: "Serving lower-income tracts often means walking toward existing tax-credit projects. Does this matter more than the other?",
      soften:
        justId === "lihtc"
          ? (row) => {
              row.askWho = "skip";
            }
          : (row) => {
              row.askLihtc = "skip";
            },
    };
  }
  if ((justId === "who" || justId === "pressure") && s.askWho === "renters" && s.askPressure === "avoid") {
    return {
      thisLab: justId === "who" ? "serve people who already rent here" : "avoid stretched tracts",
      vsLab: justId === "who" ? "avoid stretched tracts" : "serve renters",
      text: "Renter blocks are often the overpaying blocks. Serving people who rent here will put you in high-pressure tracts. Does this matter more than the other?",
      soften:
        justId === "who"
          ? (row) => {
              row.askPressure = "flag";
            }
          : (row) => {
              row.askWho = "skip";
            },
    };
  }
  return null;
}

export const SLIDES = [
  {
    id: "role",
    kind: "role",
    title: "Who is using this desk?",
    muted: "This only changes how the home screen talks to you. It does not rank lots.",
  },
  {
    id: "type",
    kind: "multi",
    key: "askTypes",
    title: "What are you trying to put on the ground?",
    muted: "A pairing is one type on one lot. Pick every type you would actually try this month.",
    options: [
      { v: "duplex", lab: "Two-family house", sub: "A house split into two homes." },
      { v: "small_multifamily", lab: "Small apartment building", sub: "About three to six homes on one city lot." },
    ],
  },
  {
    id: "right",
    kind: "tiles",
    key: "askByRight",
    title: "Must the type already be allowed?",
    muted: "By-right is the visit gate. A variance fight is a different week.",
    options: [
      { v: "skip", lab: "Doesn't matter" },
      { v: "prefer", lab: "Prefer already allowed" },
      { v: "must", lab: "Must already be allowed" },
    ],
  },
  {
    id: "land",
    kind: "multi",
    key: "askLand",
    title: "Whose land?",
    muted: "Empty pick means any city vacant lot in this file. Private tax-delinquent stock is not in the file.",
    options: LAND_OPTS.map((o) => ({ v: o.v, lab: o.lab })),
  },
  {
    id: "cluster",
    kind: "slider",
    key: "askCluster",
    max: 2,
    title: "Isolated lot or a cluster?",
    muted: "CDCs assemble scale from nearby city lots. We count other vacant lots within about 220 feet.",
    labels: ["Doesn't matter", "Prefer a neighbor lot", "Must have a cluster"],
  },
  {
    id: "who",
    kind: "tiles",
    key: "askWho",
    title: "Who should this housing serve?",
    muted: "Tract typicals, not a named future tenant.",
    options: [
      { v: "renters", lab: "People who already rent nearby" },
      { v: "lower", lab: "Lower income than Pittsburgh typical" },
      { v: "skip", lab: "Don't claim a tenant from this file" },
    ],
  },
  {
    id: "pressure",
    kind: "tiles",
    key: "askPressure",
    title: "Neighborhoods already stretched on rent?",
    muted: "Census rent vs what typical income can carry. Not evictions.",
    options: [
      { v: "toward", lab: "Walk toward high burden" },
      { v: "flag", lab: "Flag it and keep the product affordable" },
      { v: "avoid", lab: "Avoid those tracts" },
      { v: "skip", lab: "Ignore" },
    ],
  },
  {
    id: "flood",
    kind: "tiles",
    key: "askFlood",
    title: "Flood",
    muted: "Live FEMA NFHL at the point, not a survey. Skip drops special flood hazard lots.",
    options: [
      { v: "skip", lab: "Skip special flood hazard" },
      { v: "warn", lab: "Show it and warn" },
      { v: "ignore", lab: "Ignore" },
    ],
  },
  {
    id: "slope",
    kind: "tiles",
    key: "askSlope",
    title: "Hillside",
    muted: "City 25% or greater slope polygons at the point.",
    options: [
      { v: "skip", lab: "Skip 25%+ slope" },
      { v: "warn", lab: "Warn only" },
      { v: "ignore", lab: "Ignore" },
    ],
  },
  {
    id: "bus",
    kind: "bus",
    title: "How close to a bus stop?",
    muted: "Feet to a Port Authority stop. Access, not carbon kilograms.",
    labels: ["Doesn't matter", "Within a half mile", "Within a quarter mile", "Within a 5-minute walk"],
    feet: [0, 2640, 1320, 400],
  },
  {
    id: "trees",
    kind: "slider",
    key: "askTrees",
    max: 2,
    title: "Shade at the curb",
    muted: "City street trees within 400 feet. Not a satellite temperature.",
    labels: ["Doesn't matter", "Prefer more trees", "Want trees on the block"],
  },
  {
    id: "lihtc",
    kind: "tiles",
    key: "askLihtc",
    title: "Tax-credit geography",
    muted: "Nearest mapped HUD LIHTC project. QAP is a separate competition.",
    options: [
      { v: "near", lab: "Stay near existing LIHTC" },
      { v: "avoid", lab: "Avoid stacking on a project" },
      { v: "skip", lab: "Ignore" },
    ],
  },
  {
    id: "places",
    kind: "places",
    title: "Where are you walking this month?",
    muted: "All Pittsburgh, or the neighborhoods you will actually visit.",
  },
];
