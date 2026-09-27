import {
  FACTOR_LABELS,
  FACTORS,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  acsGaps,
  isUnknown,
  readField,
  scoreSite,
} from "./scoring.js";

const ZONING_KEY = {
  adu: "zoning_allows_adu",
  duplex: "zoning_allows_duplex",
  small_multifamily: "zoning_allows_small_multifamily",
};

export function zoningAllows(site, typology) {
  return readField(site, ZONING_KEY[typology]);
}

export function verdictFor(site, typology) {
  const z = zoningAllows(site, typology);
  if (z === "not_allowed") return "no-go";
  if (z === "conditional") return "caution";
  if (z === "by_right") return "go";
  return "caution";
}

export const VERDICT_LABEL = {
  go: "Worth a staff look",
  caution: "Hold. Something is incomplete or conditional",
  "no-go": "Not a match under current zoning",
};

function whyZoning(site, typology) {
  const z = zoningAllows(site, typology);
  const district = site.zoned_as;
  if (typology === "adu") {
    if (z === "not_allowed") {
      return "ADU is not a citywide by-right use in Pittsburgh yet. CB 2025-1545 has not been adopted. A high number here is not permission.";
    }
    return `ADU zoning reading for ${district}: ${z}. Confirm with Planning.`;
  }
  if (typology === "duplex") {
    if (z === "by_right") {
      return `Two-Unit Residential is Permitted in ${district} on the Chapter 911 use table. That is why duplex can outrank ADU on this lot.`;
    }
    if (z === "not_allowed") {
      return `${district} is not a Two-Unit district. Duplex is not Permitted on that table, so this pairing is a no-go until a different process exists.`;
    }
  }
  if (typology === "small_multifamily") {
    if (z === "by_right") {
      return `Multi-Unit Residential is Permitted in ${district}. Small multifamily can compete here on use, then lot size decides how comfortable the fit is.`;
    }
    if (z === "not_allowed") {
      return `${district} does not list Multi-Unit as Permitted. Small multifamily is not a by-right match on this parcel.`;
    }
  }
  return `Zoning for this type is ${z}.`;
}

function whyLot(site, typology) {
  const sq = Number(readField(site, "parc_sq_ft"));
  if (!Number.isFinite(sq)) return "Lot size is unknown, so buildability is incomplete.";
  const full = { adu: 1800, duplex: 2800, small_multifamily: 5000 }[typology];
  const floor = { adu: 800, duplex: 1200, small_multifamily: 1800 }[typology];
  if (sq >= full) {
    return `The lot is ${sq.toLocaleString()} sq ft, at or above the ${full.toLocaleString()} sq ft comfort line we use for ${TYPOLOGY_LABELS[typology]}.`;
  }
  if (sq <= floor) {
    return `The lot is ${sq.toLocaleString()} sq ft, tight against a ${floor.toLocaleString()} sq ft floor for ${TYPOLOGY_LABELS[typology]}. Feasibility is penalized for size, not invented away.`;
  }
  return `The lot is ${sq.toLocaleString()} sq ft, between the ${floor.toLocaleString()} floor and ${full.toLocaleString()} comfort line for ${TYPOLOGY_LABELS[typology]}.`;
}

function whyDemand(site, factors) {
  const f = factors.demand_fit;
  if (isUnknown(f.score)) {
    return "Renter share is unknown for this tract, so neighborhood-renter fit is dropped from the composite. It is not scored as zero.";
  }
  return `Tract renter share is ${readField(site, "tract_renter_share")}%. That is ACS context, not a waitlist.`;
}

function whyAfford(site, factors) {
  const f = factors.affordability_impact;
  if (isUnknown(f.score)) {
    return "Rent burden is unknown, so cost-burden fit is dropped. Filling a nearby tract would hide the gap.";
  }
  return `Tract rent burden (30%+) is ${readField(site, "tract_rent_burden_pct")}%. This is not a rent forecast.`;
}

function whyClimate(site, factors) {
  const f = factors.climate_proxy;
  if (isUnknown(f.score)) {
    return "Transit distance is unknown, so the climate proxy is dropped.";
  }
  return `${readField(site, "transit_distance_ft")} ft to the nearest PRT stop. That is a proximity proxy, not measured emissions.`;
}

function whyWeights(weights, composite) {
  const dropped = composite.dropped || [];
  const parts = FACTORS.filter((k) => !dropped.includes(k)).map((k) => `${FACTOR_LABELS[k]} at ${weights[k]}`);
  const dropNote = dropped.length
    ? ` Missing ${dropped.map((k) => FACTOR_LABELS[k]).join(", ")} did not count as zero.`
    : "";
  return `Your weights (not the parcel file) decide the blend: ${parts.join("; ")}.${dropNote}`;
}

export function pairingKey(siteId, typology) {
  return `${siteId}:${typology}`;
}

export function parsePairingKey(key) {
  const [siteId, typology] = String(key || "").split(":");
  return { siteId, typology };
}

export function buildPairing(site, typology, session) {
  const result = scoreSite(site, session.weights);
  const block = result.typologies[typology];
  const verdict = verdictFor(site, typology);
  const score = block.composite.score;
  const why = [
    whyZoning(site, typology),
    whyLot(site, typology),
    whyDemand(site, block.factors),
    whyAfford(site, block.factors),
    whyClimate(site, block.factors),
    whyWeights(session.weights, block.composite),
  ];
  const brief = matchBrief(session, site, typology, verdict, score, block);
  return {
    key: pairingKey(site.site_id, typology),
    site,
    typology,
    verdict,
    score,
    why,
    brief,
    factors: block.factors,
    composite: block.composite,
  };
}

export function allPairings(sites, session) {
  const rows = [];
  for (const site of sites) {
    for (const typology of TYPOLOGIES) {
      rows.push(buildPairing(site, typology, session));
    }
  }
  return sortPairings(rows);
}

export function sortPairings(rows) {
  const order = { go: 0, caution: 1, "no-go": 2 };
  return rows.slice().sort((a, b) => {
    const d = order[a.verdict] - order[b.verdict];
    if (d) return d;
    const as = isUnknown(a.score) ? -1 : Number(a.score);
    const bs = isUnknown(b.score) ? -1 : Number(b.score);
    return bs - as;
  });
}

export function filterSites(sites, f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return sites.filter((s) => {
    if (f.neighborhood && f.neighborhood !== "all" && s.neighborhood_name !== f.neighborhood) return false;
    if (f.status && f.status !== "all" && s.current_status !== f.status) return false;
    if (f.genesis === "sample" && s.genesis_sample !== "yes") return false;
    if (q) {
      const blob = `${s.address} ${s.neighborhood_name} ${s.zoned_as} ${s.pin}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

export function deckPairings(sites, session, f = {}) {
  const filtered = filterSites(sites, f);
  const rows = filtered.map((site) => {
    if (f.typology && f.typology !== "any") {
      return buildPairing(site, f.typology, session);
    }
    const rankedSite = sortPairings(TYPOLOGIES.map((t) => buildPairing(site, t, session)));
    return rankedSite[0];
  });
  return { filtered, pairings: sortPairings(rows) };
}

function matchBrief(session, site, typology, verdict, score, block) {
  const type = TYPOLOGY_LABELS[typology];
  const org = session.org;
  const n = isUnknown(score) ? "n/a" : score;
  if (verdict === "no-go") {
    return `${org} × ${site.address} × ${type} is not a match under the current use table (${site.zoned_as}). The score ${n} only ranks this type against other prohibited types. It is not a green light.`;
  }
  if (verdict === "caution") {
    const acs = acsGaps(site).length
      ? ` ACS tract ${site.census_tract} does not resolve, so renter and burden factors stay unknown.`
      : "";
    return `${org} × ${site.address} × ${type} is a caution pairing (score ${n}).${acs} Confirm zoning overlays and the official record before drawings.`;
  }
  const feas = block.factors.feasibility.detail;
  return `${org} × ${site.address} × ${type} is the pairing to staff first (score ${n}). ${feas}. Transit and ACS only support the story; they do not issue a permit.`;
}

export function featuredPairing(pairings, lastKey) {
  if (lastKey) {
    const hit = pairings.find((p) => p.key === lastKey);
    if (hit) return hit;
  }
  return pairings.find((p) => p.verdict === "go") || pairings[0];
}
