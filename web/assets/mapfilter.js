import { primaryUse, useAllows } from "./uses.js?v=cdc30";

export const LAYERS = [
  { id: "mix", lab: "Fit" },
  { id: "visits", lab: "Your visits" },
  { id: "path", lab: "Whose land" },
  { id: "flood", lab: "Flood" },
  { id: "heat", lab: "Hotter ground" },
  { id: "slope", lab: "Hillside" },
  { id: "use", lab: "Already allowed" },
  { id: "shade", lab: "Street trees" },
  { id: "credit", lab: "Tax-credit nearby" },
];

export const LEGEND = {
  mix: [
    { id: "high", hex: "#4c6fff", lab: "Stronger fit (62 and up)" },
    { id: "mid", hex: "#8aa6ff", lab: "Middle (38 to 61)" },
    { id: "low", hex: "#c5d0dc", lab: "Weaker fit (under 38)" },
    { id: "unk", hex: "#e8e4dc", lab: "Too little data" },
  ],
  visits: [
    { id: "visit", hex: "#4c6fff", lab: "On your visits list" },
    { id: "other", hex: "#1c2430", lab: "Other city vacant lots" },
  ],
  path: [
    { id: "ura", hex: "#2a9d8f", lab: "URA" },
    { id: "plb", hex: "#e9c46a", lab: "Land Bank" },
    { id: "cdc", hex: "#e76f51", lab: "CDC reserve" },
    { id: "sale", hex: "#4c6fff", lab: "Public sale" },
    { id: "other", hex: "#8b95a5", lab: "Other public" },
  ],
  flood: [
    { id: "sfha", hex: "#3db5c8", lab: "Flood hazard" },
    { id: "ok", hex: "#c5d0dc", lab: "Not flagged for flood" },
  ],
  heat: [
    { id: "hot", hex: "#e76f51", lab: "Hotter ground (4–5)" },
    { id: "mid", hex: "#d69a30", lab: "About average (3)" },
    { id: "cool", hex: "#4c6fff", lab: "Cooler ground (1–2)" },
    { id: "unk", hex: "#e8e4dc", lab: "No pixel" },
  ],
  slope: [
    { id: "steep", hex: "#d69a30", lab: "Steep hillside" },
    { id: "ok", hex: "#c5d0dc", lab: "Not a steep hillside" },
  ],
  shade: [
    { id: "more", hex: "#1d4a32", lab: "More street trees within 400 ft" },
    { id: "few", hex: "#d8e4d4", lab: "Fewer or none" },
  ],
  use: [
    { id: "single_family", hex: "#4c6fff", lab: "Single-family" },
    { id: "duplex", hex: "#7b6cc7", lab: "Two-family" },
    { id: "small_multifamily", hex: "#2a9d8f", lab: "Small apartment" },
    { id: "affordable", hex: "#4e9470", lab: "Affordable in play" },
    { id: "office", hex: "#d69a30", lab: "Offices" },
    { id: "commercial", hex: "#e76f51", lab: "Commercial" },
    { id: "industrial", hex: "#1c2430", lab: "Industrial" },
    { id: "none", hex: "#c5d0dc", lab: "None of these" },
  ],
  credit: [
    { id: "near", hex: "#d69a30", lab: "Tax-credit apartments within a quarter mile" },
    { id: "far", hex: "#c5d0dc", lab: "Farther or unmapped" },
  ],
};

export function layerLabel(id) {
  return (LAYERS.find((l) => l.id === id) || {}).lab || id;
}

export function swatchLabel(layer, id) {
  const row = (LEGEND[layer] || []).find((r) => r.id === id);
  return row ? row.lab : id;
}

export function bucketOf(layer, site, ctx = {}) {
  const visitIds = ctx.visitIds || new Set();
  const mixById = ctx.mixById || new Map();
  if (layer === "mix") return (mixById.get(site.site_id) || {}).bucket || "unk";
  if (layer === "visits") return visitIds.has(site.site_id) ? "visit" : "other";
  if (layer === "path") {
    const inv = String(site.inventory_type || "");
    if (inv === "URA Transfer") return "ura";
    if (inv === "PLB Transfer") return "plb";
    if (inv === "CDC Property Reserve") return "cdc";
    if (inv === "Public Sale") return "sale";
    return "other";
  }
  if (layer === "flood") return String(site.flood_sfha || "").toUpperCase() === "T" ? "sfha" : "ok";
  if (layer === "heat") {
    const h = Number(site.heat_severity);
    if (!Number.isFinite(h)) return "unk";
    if (h >= 4) return "hot";
    if (h <= 2) return "cool";
    return "mid";
  }
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? "steep" : "ok";
  if (layer === "use") return primaryUse(site);
  if (layer === "shade") return Number(site.trees_400ft) >= 8 ? "more" : "few";
  if (layer === "credit") {
    const ft = Number(site.lihtc_ft);
    return Number.isFinite(ft) && ft <= 1320 ? "near" : "far";
  }
  return "other";
}

export function activeStack(stacked = {}) {
  const out = {};
  Object.entries(stacked || {}).forEach(([layer, ids]) => {
    const keep = (ids || []).filter(Boolean);
    if (keep.length) out[layer] = keep;
  });
  return out;
}

export function passesMapFilters(site, stacked, ctx = {}) {
  const active = activeStack(stacked);
  return Object.entries(active).every(([layer, ids]) => {
    if (layer === "use" || layer === "build") {
      return ids.some((id) => {
        if (id === "both") {
          return useAllows(site, "duplex") === "by_right" && useAllows(site, "small_multifamily") === "by_right";
        }
        if (id === "mf") return useAllows(site, "small_multifamily") === "by_right";
        if (id === "none") {
          const p = primaryUse(site);
          return p === "none" || p === "unk";
        }
        if (id === "affordable") return useAllows(site, "affordable") === "by_right";
        return useAllows(site, id) === "by_right";
      });
    }
    return ids.includes(bucketOf(layer, site, ctx));
  });
}
