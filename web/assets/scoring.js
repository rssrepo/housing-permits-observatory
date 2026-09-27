import { useAllows } from "./zone.js?v=cdc28";

export const UNKNOWN = "unknown";
export const TYPOLOGIES = [
  "duplex",
  "small_multifamily",
  "single_family",
  "affordable",
  "office",
  "commercial",
  "industrial",
];
export const TYPOLOGY_LABELS = {
  duplex: "Two-family house",
  small_multifamily: "Small apartment building",
  single_family: "Single-family house",
  affordable: "Affordable housing",
  office: "Offices",
  commercial: "Commercial",
  industrial: "Industrial",
};
export const TYPOLOGY_HINTS = {
  duplex: "A house split into two homes.",
  small_multifamily: "About three to six homes on one city lot.",
  single_family: "One house on the lot.",
  affordable: "A home already allowed in a tract below Pittsburgh typical income. Not a tax-credit award.",
  office: "Workspace. Mix uses district, lot, and bus. Not a rent score.",
  commercial: "Storefront or commercial space. Mix uses district, lot, and bus.",
  industrial: "Industrial or workshop space. Mix uses district, lot, and bus.",
};
export const HOUSING_TYPES = ["duplex", "small_multifamily", "single_family", "affordable"];
export const FACTORS = ["feasibility", "demand_fit", "affordability_impact", "displacement_risk", "climate_proxy"];
export const FACTOR_LABELS = {
  feasibility: "Allowed to build, lot is big enough",
  demand_fit: "Neighbors who rent",
  affordability_impact: "Neighbors stretched on rent",
  displacement_risk: "Neighbors already overpaying rent",
  climate_proxy: "Close to a bus stop",
};
export const FACTOR_HELP = {
  feasibility: "Zoning permission plus whether the lot is large enough for this housing type.",
  demand_fit: "Share of nearby households that rent, from the Census. Not a waitlist.",
  affordability_impact: "Share of nearby renters who spend 30% or more of income on rent. Typical neighborhood rent is ACS median gross rent, not a listing for this lot.",
  displacement_risk: "Gap between typical rent paid nearby and what typical income can carry at 30%. Neighborhood pressure, not a household eviction model.",
  climate_proxy: "Walking distance to the nearest Port Authority bus stop. Transit access, not a carbon score.",
};
const ZONING_FIELDS = {
  duplex: "zoning_allows_duplex",
  small_multifamily: "zoning_allows_small_multifamily",
};
const LOT_FULL = {
  duplex: 2800,
  small_multifamily: 5000,
  single_family: 2500,
  affordable: 2800,
  office: 4000,
  commercial: 4000,
  industrial: 8000,
};
const LOT_MIN = {
  duplex: 1200,
  small_multifamily: 1800,
  single_family: 1200,
  affordable: 1200,
  office: 1500,
  commercial: 1500,
  industrial: 3000,
};

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
  const zoning = useAllows(row, typology);
  const lot = parseFloatField(row, "parc_sq_ft");
  const slope = readField(row, "steep_slope");
  const sources = [ZONING_FIELDS[typology] || "zoned_as", "parc_sq_ft"];
  if (isUnknown(zoning) || isUnknown(lot)) {
    const missing = [];
    if (isUnknown(zoning)) missing.push(ZONING_FIELDS[typology] || "zoned_as");
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
  if (!HOUSING_TYPES.includes(typology)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "not used for this type", detail: "Workplace types do not use renter share" };
  }
  const share = parseFloatField(row, "tract_renter_share");
  if (isUnknown(share)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "tract_renter_share", detail: "Insufficient data" };
  }
  const bump = { duplex: 1.0, small_multifamily: 1.05, single_family: 0.9, affordable: 1.0 }[typology] ?? 1;
  return {
    status: "from_data",
    score: Math.round(clamp(share * bump) * 10) / 10,
    source: "tract_renter_share",
    detail: `renter share ${share}%`,
  };
}

function affordability(row, typology) {
  if (!HOUSING_TYPES.includes(typology)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "not used for this type", detail: "Workplace types do not use rent burden" };
  }
  const burden = parseFloatField(row, "tract_rent_burden_pct");
  if (isUnknown(burden)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "tract_rent_burden_pct", detail: "Insufficient data" };
  }
  const bump = { duplex: 0.95, small_multifamily: 1.0, single_family: 0.9, affordable: 1.05 }[typology] ?? 1;
  return {
    status: "from_data",
    score: Math.round(clamp(burden * bump) * 10) / 10,
    source: "tract_rent_burden_pct",
    detail: `rent burden ${burden}%`,
  };
}

function displacement(row, typology) {
  if (!HOUSING_TYPES.includes(typology)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "not used for this type", detail: "Workplace types do not use overpay" };
  }
  const burden = parseFloatField(row, "tract_rent_burden_pct");
  const paid = typicalRentUsd(row);
  const pred = predictedRentUsd(row);
  if (isUnknown(paid) || isUnknown(pred) || pred <= 0) {
    if (isUnknown(burden)) {
      return { status: UNKNOWN, score: UNKNOWN, source: "tract_median_gross_rent", detail: "Insufficient data" };
    }
    return {
      status: "from_data",
      score: Math.round(clamp(burden) * 10) / 10,
      source: "tract_rent_burden_pct",
      detail: `rent burden ${burden}%`,
    };
  }
  const overPct = clamp(((paid - pred) / pred) * 100);
  const burdenPart = isUnknown(burden) ? overPct : burden;
  const bump = { duplex: 1.0, small_multifamily: 0.92, single_family: 1.05, affordable: 0.9 }[typology] ?? 1;
  return {
    status: "from_data",
    score: Math.round(clamp((0.55 * burdenPart + 0.45 * overPct) * bump) * 10) / 10,
    source: "tract_median_gross_rent + tract_median_income",
    detail: `paid $${paid} vs carry $${pred}`,
  };
}

function climate(row, typology) {
  const dist = parseFloatField(row, "transit_distance_ft");
  if (isUnknown(dist)) {
    return { status: UNKNOWN, score: UNKNOWN, source: "transit_distance_ft", detail: "Insufficient data" };
  }
  const access = 100 - linear(dist, 400, 2640);
  const density = { duplex: 8, small_multifamily: 16, single_family: 4, affordable: 10, office: 12, commercial: 10, industrial: 4 }[typology] ?? 0;
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
  displacement_risk: displacement,
  climate_proxy: climate,
};

export function normalizeWeights(weights) {
  const cleaned = Object.fromEntries(FACTORS.map((k) => [k, Math.max(0, Number(weights[k] || 0))]));
  const total = FACTORS.reduce((s, k) => s + cleaned[k], 0);
  if (total <= 0) return Object.fromEntries(FACTORS.map((k) => [k, 1 / FACTORS.length]));
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

export const PGH_MEDIAN_GROSS_RENT = 1261;
export const PGH_MEDIAN_HOME_VALUE = 239865;
export const HOME_2BR_USD = 261595;
export const TYPE_UNITS = {
  duplex: 2,
  small_multifamily: 4,
  single_family: 1,
  affordable: 4,
};

export function usd(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n));
}

export function typicalHomeValueUsd(row) {
  for (const key of ["zillow_zhvi_usd", "tract_median_home_value"]) {
    const raw = readField(row, key);
    if (isUnknown(raw)) continue;
    const n = Number(String(raw).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return UNKNOWN;
}

export function landRollUsd(row) {
  const raw = readField(row, "assess_land_fmv");
  if (isUnknown(raw)) return UNKNOWN;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : UNKNOWN;
}

export function landFmvUsd(row) {
  for (const key of ["land_sale_usd", "land_comp_usd", "assess_land_fmv"]) {
    const raw = readField(row, key);
    if (isUnknown(raw)) continue;
    const n = Number(String(raw).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return UNKNOWN;
}

export function homeValueSource(row) {
  const z = usd(readField(row, "zillow_zhvi_usd"));
  if (z != null && z > 0) return "zillow";
  const a = usd(readField(row, "tract_median_home_value"));
  if (a != null && a > 0) return "acs";
  return null;
}

export function landValueSource(row) {
  const sale = usd(readField(row, "land_sale_usd"));
  if (sale != null && sale > 0) return "sale";
  const comp = usd(readField(row, "land_comp_usd"));
  if (comp != null && comp > 0) return "comp";
  const roll = usd(readField(row, "assess_land_fmv"));
  if (roll != null && roll > 0) return "roll";
  return null;
}

export function buildAfford(row, typology) {
  const land = landFmvUsd(row);
  const home = typicalHomeValueUsd(row);
  const units = TYPE_UNITS[typology] || 0;
  const housing = HOUSING_TYPES.includes(typology);
  const cost = housing ? HOME_2BR_USD * units : null;
  const sale = housing && !isUnknown(home) ? home * units : null;
  const landN = isUnknown(land) ? null : land;
  let spread = null;
  if (sale != null && cost != null && landN != null) spread = sale - (landN + cost);
  return { land: landN, home: isUnknown(home) ? null : home, units, cost, sale, spread, housing };
}

export function typicalRentUsd(row) {
  const raw = readField(row, "tract_median_gross_rent");
  if (isUnknown(raw)) return UNKNOWN;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : UNKNOWN;
}

export function predictedRentUsd(row) {
  const inc = parseFloatField(row, "tract_median_income");
  if (isUnknown(inc) || inc <= 0) return UNKNOWN;
  return Math.round((inc * 0.3) / 12);
}

export function displacementGapUsd(row) {
  const paid = typicalRentUsd(row);
  const pred = predictedRentUsd(row);
  if (isUnknown(paid) || isUnknown(pred)) return UNKNOWN;
  return paid - pred;
}

export function missingFields(row) {
  const checks = [
    ["tract_renter_share", "Neighbors who rent"],
    ["tract_rent_burden_pct", "Neighbors stretched on rent"],
    ["tract_median_income", "Typical neighborhood income"],
    ["tract_median_gross_rent", "Typical rent nearby"],
    ["steep_slope", "Steep hillside"],
  ];
  return checks.filter(([k]) => isUnknown(readField(row, k))).map(([, label]) => label);
}

export function acsGaps(row) {
  return ["tract_renter_share", "tract_rent_burden_pct", "tract_median_income", "tract_median_gross_rent"].filter((k) =>
    isUnknown(readField(row, k))
  );
}

export const PGH_MEDIAN_INCOME = 65742;

export function opportunityOutcomes(site) {
  const burdenRaw = readField(site, "tract_rent_burden_pct");
  const incomeRaw = readField(site, "tract_median_income");
  const distRaw = readField(site, "transit_distance_ft");
  const paid = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  const gap = displacementGapUsd(site);
  const sq = Number(readField(site, "parc_sq_ft"));

  const allowed = TYPOLOGIES.filter((t) => useAllows(site, t) === "by_right");
  const buildScore = Math.round((allowed.length / TYPOLOGIES.length) * 1000) / 10;
  const typeBits = TYPOLOGIES.map((t) => {
    const raw = useAllows(site, t);
    const lab = TYPOLOGY_LABELS[t];
    if (raw === "by_right") return `${lab} is allowed without a hearing, or in play.`;
    if (raw === "not_allowed") return `${lab} is not this district.`;
    return `${lab} is not decided in this file.`;
  });

  const housing = (() => {
    if (!isUnknown(paid) || !isUnknown(burdenRaw)) {
      const burden = isUnknown(burdenRaw) ? null : Number(burdenRaw);
      const score = burden != null && Number.isFinite(burden) ? Math.round(clamp(100 - burden) * 10) / 10 : UNKNOWN;
      const bits = [];
      if (!isUnknown(paid)) bits.push(`This tract typically pays $${paid.toLocaleString()} a month.`);
      bits.push(`Pittsburgh typical is $${PGH_MEDIAN_GROSS_RENT.toLocaleString()}.`);
      if (burden != null && Number.isFinite(burden)) bits.push(`${burden}% of nearby renters are cost-burdened.`);
      if (!isUnknown(gap) && gap > 0) bits.push(`About $${gap.toLocaleString()} over a 30% income carry.`);
      return {
        display: !isUnknown(paid) ? `$${paid.toLocaleString()}` : `${burden}% burden`,
        score,
        scope: "This census tract",
        note: bits.join(" "),
      };
    }
    return {
      display: `$${PGH_MEDIAN_GROSS_RENT.toLocaleString()}`,
      score: UNKNOWN,
      scope: "Pittsburgh city, not this tract",
      note: "No ACS rent for this tract. Use the city typical ($1,261) as the market floor until you pull a local comp.",
    };
  })();

  const economic = (() => {
    if (!isUnknown(incomeRaw)) {
      const inc = Number(String(incomeRaw).replace(/,/g, ""));
      if (Number.isFinite(inc) && inc > 0) {
        const score = Math.round(clamp((inc / PGH_MEDIAN_INCOME) * 100) * 10) / 10;
        const carry = isUnknown(pred) ? "" : ` Carry at 30% is about $${pred.toLocaleString()} a month.`;
        return {
          display: `$${Math.round(inc).toLocaleString()}`,
          score,
          scope: "This census tract",
          note: `Typical household income versus Pittsburgh $${PGH_MEDIAN_INCOME.toLocaleString()}.${carry}`,
        };
      }
    }
    return {
      display: `$${PGH_MEDIAN_INCOME.toLocaleString()}`,
      score: UNKNOWN,
      scope: "Pittsburgh city, not this tract",
      note: "No ACS income for this tract. City typical household income is the benchmark, not a household on this vacant lot.",
    };
  })();

  const mobility = (() => {
    if (!isUnknown(distRaw)) {
      const dist = Number(distRaw);
      if (Number.isFinite(dist)) {
        const score = Math.round(clamp(100 - linear(dist, 400, 2640)) * 10) / 10;
        return {
          display: `${Math.round(dist)} ft`,
          score,
          scope: "This lot",
          note: "Feet to a Port Authority stop. Transit access, not jobs or schools.",
        };
      }
    }
    const lat = Number(site.latitude);
    const lon = Number(site.longitude);
    const pin = Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "Open Maps from this lot";
    return {
      display: "Maps",
      score: UNKNOWN,
      scope: "This lot",
      note: `No bus distance in this file. Pin ${pin}. Confirm a stop on Maps before you treat this as transit-oriented.`,
    };
  })();

  return [
    {
      id: "site",
      name: "What you can build",
      enterprise: "Lot and zoning, always on file.",
      display: `${allowed.length} of 3`,
      score: buildScore,
      scope: "This lot",
      note: `${Number.isFinite(sq) ? `${sq.toLocaleString()} square feet. ` : ""}${typeBits.join(" ")}`,
    },
    {
      id: "housing",
      name: "Housing cost",
      enterprise: "Opportunity360 housing stability, as rent.",
      ...housing,
    },
    {
      id: "economic",
      name: "Income",
      enterprise: "Opportunity360 economic security.",
      ...economic,
    },
    {
      id: "mobility",
      name: "Getting there",
      enterprise: "Opportunity360 mobility.",
      ...mobility,
    },
  ];
}
