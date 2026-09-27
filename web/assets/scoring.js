export const UNKNOWN = "unknown";
export const TYPOLOGIES = ["adu", "duplex", "small_multifamily"];
export const TYPOLOGY_LABELS = {
  adu: "ADU",
  duplex: "Duplex",
  small_multifamily: "Small multifamily",
};
export const FACTORS = ["feasibility", "demand_fit", "affordability_impact", "climate_proxy"];
export const FACTOR_LABELS = {
  feasibility: "Can we build it",
  demand_fit: "Neighborhood rents",
  affordability_impact: "Cost burden",
  climate_proxy: "Transit proximity",
};
const ZONING_FIELDS = {
  adu: "zoning_allows_adu",
  duplex: "zoning_allows_duplex",
  small_multifamily: "zoning_allows_small_multifamily",
};
const LOT_FULL = { adu: 1800, duplex: 2800, small_multifamily: 5000 };
const LOT_MIN = { adu: 800, duplex: 1200, small_multifamily: 1800 };

export function isUnknown(v) {
  return v === UNKNOWN;
}

export function readField(row, key) {
  if (!(key in row) || row[key] == null) return UNKNOWN;
  const text = String(row[key]).trim();
  if (!text || ["na", "n/a", "nan", "none", "unknown", "no data"].includes(text.toLowerCase())) {
    return UNKNOWN;
  }
  return text;
}

function parseFloatField(row, key) {
  const raw = readField(row, key);
  if (isUnknown(raw)) return UNKNOWN;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : UNKNOWN;
}

function parseZoning(row, key) {
  const raw = readField(row, key);
  if (isUnknown(raw)) return UNKNOWN;
  const token = String(raw).trim().toLowerCase().replace(/ /g, "_");
  if (["by_right", "by-right", "p", "permitted"].includes(token)) return "by_right";
  if (["conditional", "s", "special", "special_exception"].includes(token)) return "conditional";
  if (["not_allowed", "not-allowed", "n", "prohibited"].includes(token)) return "not_allowed";
  return UNKNOWN;
}

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function linear(value, start, end) {
  if (end === start) return value >= end ? 100 : 0;
  return clamp((100 * (value - start)) / (end - start));
}

function scoreZoning(allows) {
  if (allows === "by_right") return 100;
  if (allows === "conditional") return 55;
  return 8;
}

function scoreLot(typology, sqFt) {
  const full = LOT_FULL[typology];
  const floor = LOT_MIN[typology];
  if (sqFt >= full) return 100;
  if (sqFt <= floor) return 15;
  return 15 + (85 * (sqFt - floor)) / (full - floor);
}

function feasibility(row, typology) {
  const zoning = parseZoning(row, ZONING_FIELDS[typology]);
  const lot = parseFloatField(row, "parc_sq_ft");
  const slope = readField(row, "steep_slope");
  const sources = [ZONING_FIELDS[typology], "parc_sq_ft"];
  if (isUnknown(zoning) || isUnknown(lot)) {
    const missing = [];
    if (isUnknown(zoning)) missing.push(ZONING_FIELDS[typology]);
    if (isUnknown(lot)) missing.push("parc_sq_ft");
    return { status: UNKNOWN, score: UNKNOWN, source: missing.join(", "), detail: "Insufficient data" };
  }
  let score = 0.7 * scoreZoning(zoning) + 0.3 * scoreLot(typology, lot);
  if (!isUnknown(slope) && ["yes", "true", "steep", "1"].includes(String(slope).toLowerCase())) {
    score *= 0.7;
    sources.push("steep_slope");
  }
  return {
    status: "from_data",
    score: Math.round(clamp(score) * 10) / 10,
    source: sources.join(" + "),
    detail: `zoning=${zoning}; lot=${lot} sq ft`,
    zoning,
  };
}

function demandFit(row, typology) {
  const share = parseFloatField(row, "tract_renter_share");
  if (isUnknown(share)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "tract_renter_share", detail: "Insufficient data" };
  }
  const bump = { adu: 0.9, duplex: 1.0, small_multifamily: 1.05 }[typology];
  return {
    status: "from_data",
    score: Math.round(clamp(share * bump) * 10) / 10,
    source: "tract_renter_share",
    detail: `renter share ${share}%`,
  };
}

function affordability(row, typology) {
  const burden = parseFloatField(row, "tract_rent_burden_pct");
  if (isUnknown(burden)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "tract_rent_burden_pct", detail: "Insufficient data" };
  }
  const bump = { adu: 0.85, duplex: 0.95, small_multifamily: 1.0 }[typology];
  return {
    status: "from_data",
    score: Math.round(clamp(burden * bump) * 10) / 10,
    source: "tract_rent_burden_pct",
    detail: `rent burden ${burden}%`,
  };
}

function climate(row, typology) {
  const dist = parseFloatField(row, "transit_distance_ft");
  if (isUnknown(dist)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "transit_distance_ft", detail: "Insufficient data" };
  }
  const access = 100 - linear(dist, 400, 2640);
  const density = { adu: 0, duplex: 8, small_multifamily: 16 }[typology];
  return {
    status: "from_data",
    score: Math.round(clamp(access + density) * 10) / 10,
    source: "transit_distance_ft",
    detail: `${dist} ft to PRT stop`,
  };
}

const FNS = {
  feasibility,
  demand_fit: demandFit,
  affordability_impact: affordability,
  climate_proxy: climate,
};

export function normalizeWeights(weights) {
  const cleaned = Object.fromEntries(FACTORS.map((k) => [k, Math.max(0, Number(weights[k] || 0))]));
  const total = FACTORS.reduce((s, k) => s + cleaned[k], 0);
  if (total <= 0) return Object.fromEntries(FACTORS.map((k) => [k, 0.25]));
  return Object.fromEntries(FACTORS.map((k) => [k, cleaned[k] / total]));
}

function composite(factors, weights) {
  const usable = Object.fromEntries(
    FACTORS.filter((k) => !isUnknown(factors[k].score)).map((k) => [k, factors[k].score])
  );
  if (!Object.keys(usable).length) {
    return { status: UNKNOWN, score: UNKNOWN, dropped: FACTORS.slice() };
  }
  const w = normalizeWeights(weights);
  const sub = Object.keys(usable).reduce((s, k) => s + w[k], 0);
  const score = Object.keys(usable).reduce((s, k) => s + (w[k] / sub) * Number(usable[k]), 0);
  return {
    status: "from_data",
    score: Math.round(score * 10) / 10,
    dropped: FACTORS.filter((k) => !(k in usable)),
  };
}

export function scoreSite(row, weights) {
  const typologies = {};
  for (const typ of TYPOLOGIES) {
    const factors = Object.fromEntries(FACTORS.map((name) => [name, FNS[name](row, typ)]));
    typologies[typ] = { factors, composite: composite(factors, weights) };
  }
  return { typologies, weights: normalizeWeights(weights) };
}

export function ranked(result) {
  const rows = TYPOLOGIES.map((t) => [t, result.typologies[t].composite.score]);
  const numeric = rows.filter(([, s]) => !isUnknown(s)).sort((a, b) => b[1] - a[1]);
  const missing = rows.filter(([, s]) => isUnknown(s));
  return [...numeric, ...missing];
}

export function missingFields(row) {
  const checks = [
    ["tract_renter_share", "Renter share"],
    ["tract_rent_burden_pct", "Rent burden"],
    ["tract_median_income", "Median income"],
    ["steep_slope", "Steep slope"],
  ];
  return checks.filter(([k]) => isUnknown(readField(row, k))).map(([, label]) => label);
}

export function acsGaps(row) {
  return ["tract_renter_share", "tract_rent_burden_pct", "tract_median_income"].filter((k) =>
    isUnknown(readField(row, k))
  );
}
