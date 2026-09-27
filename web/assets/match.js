import {
  FACTOR_LABELS,
  FACTORS,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  isUnknown,
  readField,
  scoreSite,
  PGH_MEDIAN_GROSS_RENT,
  predictedRentUsd,
  typicalRentUsd,
} from "./scoring.js";

const ZONING_KEY = {
  adu: "zoning_allows_adu",
  duplex: "zoning_allows_duplex",
  small_multifamily: "zoning_allows_small_multifamily",
};

export function districtPlain(zoned) {
  const z = (zoned || "").trim();
  if (!z) return "an unknown zoning district";
  const base = z.split("-")[0];
  const names = {
    RM: "mid-density residential",
    R1A: "single-family attached",
    R1D: "single-family detached",
    R2: "two-family residential",
    R3: "three-unit residential",
    LNC: "local neighborhood storefront",
    UNC: "urban neighborhood commercial",
    NDI: "neighborhood industrial",
    UI: "urban industrial",
    GI: "general industrial",
  };
  return names[base] ? `${z} (${names[base]})` : z;
}

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
  go: "Visit",
  caution: "Hold",
  "no-go": "Skip",
};

function whyZoning(site, typology) {
  const z = zoningAllows(site, typology);
  const district = districtPlain(site.zoned_as);
  if (typology === "adu") {
    if (z === "not_allowed") {
      return "Pittsburgh does not yet allow accessory dwellings citywide. A pending council bill has not passed. A high number here is not permission.";
    }
    return `Accessory dwelling reading for ${district}: ${z}. Confirm with City Planning.`;
  }
  if (typology === "duplex") {
    if (z === "by_right") {
      return `A two-family house is allowed without a special hearing in ${district}. That is why it can outrank an accessory dwelling here.`;
    }
    if (z === "not_allowed") {
      return `${district} is not a two-family district. Do not visit to pursue a two-family house on this lot.`;
    }
  }
  if (typology === "small_multifamily") {
    if (z === "by_right") {
      return `A small apartment building is allowed without a special hearing in ${district}. Lot size then decides how comfortable the fit is.`;
    }
    if (z === "not_allowed") {
      return `${district} does not allow a small apartment building by the use table. Not a visit for that type.`;
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
    return `The lot is ${sq.toLocaleString()} square feet, at or above the ${full.toLocaleString()} square foot comfort line we use for ${TYPOLOGY_LABELS[typology]}.`;
  }
  if (sq <= floor) {
    return `The lot is ${sq.toLocaleString()} square feet, tight against a ${floor.toLocaleString()} square foot floor for ${TYPOLOGY_LABELS[typology]}.`;
  }
  return `The lot is ${sq.toLocaleString()} square feet, between the ${floor.toLocaleString()} floor and ${full.toLocaleString()} comfort line for ${TYPOLOGY_LABELS[typology]}.`;
}

function whyDemand(site, factors) {
  const f = factors.demand_fit;
  if (isUnknown(f.score)) {
    return "The Census does not have a renter share for this neighborhood in our file, so that factor was left out.";
  }
  return `${readField(site, "tract_renter_share")}% of nearby households rent, according to the Census. That is neighborhood context, not a waitlist.`;
}

function whyAfford(site, factors) {
  const f = factors.affordability_impact;
  if (isUnknown(f.score)) {
    return "The Census does not have rent-cost strain for this neighborhood in our file, so that factor was left out.";
  }
  const rent = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  const burden = `${readField(site, "tract_rent_burden_pct")}% of nearby renters spend 30% or more of income on rent (Census).`;
  const bits = [burden];
  if (!isUnknown(rent)) bits.push(`Typical rent nearby is about $${rent.toLocaleString()} a month.`);
  if (!isUnknown(pred)) bits.push(`Typical income here can carry about $${pred.toLocaleString()} at 30%.`);
  if (!isUnknown(rent)) {
    const delta = rent - PGH_MEDIAN_GROSS_RENT;
    const vs =
      delta === 0
        ? `In line with Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
        : delta < 0
          ? `$${Math.abs(delta).toLocaleString()} below Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
          : `$${delta.toLocaleString()} above Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`;
    bits.push(vs);
  }
  return bits.join(" ");
}

export function typicalRentLine(site) {
  const rent = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  const parts = [];
  if (!isUnknown(rent)) {
    parts.push(`People nearby typically pay about $${rent.toLocaleString()} a month.`);
    const delta = rent - PGH_MEDIAN_GROSS_RENT;
    if (delta < 0) {
      parts.push(`That is $${Math.abs(delta).toLocaleString()} below Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`);
    } else if (delta > 0) {
      parts.push(`That is $${delta.toLocaleString()} above Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`);
    } else {
      parts.push(`That matches Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`);
    }
  }
  if (!isUnknown(pred)) {
    parts.push(`Typical neighborhood income can carry about $${pred.toLocaleString()} a month at 30% of income.`);
  }
  return parts.join(" ");
}

function whyClimate(site, factors) {
  const f = factors.climate_proxy;
  if (isUnknown(f.score)) {
    return "Distance to a bus stop is missing, so it was left out of the score.";
  }
  return `${readField(site, "transit_distance_ft")} feet to the nearest Port Authority bus stop. Closer is treated as better. This is not a pollution model.`;
}

function whyWeights(weights, composite) {
  const dropped = composite.dropped || [];
  const parts = FACTORS.filter((k) => !dropped.includes(k)).map((k) => `${FACTOR_LABELS[k]} at ${weights[k]}`);
  const dropNote = dropped.length
    ? ` Missing ${dropped.map((k) => FACTOR_LABELS[k]).join(", ")} was left out of the mix.`
    : "";
  return `Your weights (not the parcel file) decide the blend: ${parts.join("; ")}.${dropNote}`;
}

export function mapsUrl(site) {
  const lat = Number(site.latitude);
  const lon = Number(site.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://www.google.com/maps/?q=${lat},${lon}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site.address}, Pittsburgh, PA`)}`;
}

export function walkLine(site, typology, verdict) {
  const type = TYPOLOGY_LABELS[typology].toLowerCase();
  if (verdict === "go") return `Walk ${site.address} this week for a ${type}.`;
  if (verdict === "no-go") return `Skip ${site.address} for a ${type}. Zoning does not allow it.`;
  return `Hold ${site.address} for a ${type} until you confirm zoning.`;
}

export function factsStrip(site) {
  const sq = Number(readField(site, "parc_sq_ft"));
  const pin = readField(site, "pin");
  const rent = typicalRentUsd(site);
  return [
    site.neighborhood_name,
    Number.isFinite(sq) ? `${sq.toLocaleString()} sq ft` : null,
    site.zoned_as || null,
    !isUnknown(pin) ? `PIN ${pin}` : null,
    site.current_status || null,
    !isUnknown(rent) ? `typical rent $${rent.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function walkActionsHtml(site) {
  const pin = readField(site, "pin");
  const lat = Number(site.latitude);
  const lon = Number(site.longitude);
  const hasMaps = (Number.isFinite(lat) && Number.isFinite(lon)) || site.address;
  const maps = hasMaps
    ? `<a class="pill" href="${mapsUrl(site)}" target="_blank" rel="noopener">Open in Maps</a>`
    : "";
  const pinBtn = isUnknown(pin)
    ? ""
    : `<button type="button" class="pill ghost copy-pin" data-pin="${String(pin).replace(/"/g, "")}">Copy PIN</button>`;
  if (!maps && !pinBtn) return "";
  return `<div class="cta-row walk-actions">${maps}${pinBtn}</div>`;
}

export function cardPoints(site, typology, verdict) {
  const type = TYPOLOGY_LABELS[typology];
  const z = zoningAllows(site, typology);
  const district = districtPlain(site.zoned_as);
  const sqRaw = readField(site, "parc_sq_ft");
  const sq = Number(sqRaw);
  const pin = readField(site, "pin");
  const rows = [{ k: "Do", v: walkLine(site, typology, verdict) }];

  if (z === "by_right") {
    rows.push({
      k: "Zoning",
      v: `You can pursue a ${type.toLowerCase()} here without a special hearing (${district}).`,
    });
  } else if (z === "not_allowed") {
    rows.push({
      k: "Zoning",
      v: `Do not walk this for a ${type.toLowerCase()}. ${district} does not allow it.`,
    });
  }

  if (Number.isFinite(sq)) rows.push({ k: "Lot", v: `${sq.toLocaleString()} square feet.` });
  const rent = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  if (!isUnknown(rent)) {
    const delta = rent - PGH_MEDIAN_GROSS_RENT;
    const vs =
      delta < 0
        ? `$${Math.abs(delta).toLocaleString()} below Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
        : delta > 0
          ? `$${delta.toLocaleString()} above Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
          : `In line with Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`;
    rows.push({
      k: "Rent nearby",
      v: `About $${rent.toLocaleString()} a month typical. ${vs}`,
    });
  }
  if (!isUnknown(pred)) {
    rows.push({
      k: "Predicted",
      v: `Typical income here can carry about $${pred.toLocaleString()} a month at 30%.`,
    });
  }
  if (!isUnknown(pin)) rows.push({ k: "PIN", v: pin });
  return rows;
}

export function pointsHtml(points) {
  const rows = (points || []).filter((p) => p && p.v);
  if (!rows.length) return "";
  return `<dl class="card-points">${rows
    .map((p) => `<div><dt>${p.k}</dt><dd>${p.v}</dd></div>`)
    .join("")}</dl>`;
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
  const points = cardPoints(site, typology, verdict);
  return {
    key: pairingKey(site.site_id, typology),
    site,
    typology,
    verdict,
    score,
    why,
    brief,
    points,
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
    if (f.neighborhoods && f.neighborhoods.length) {
      if (!f.neighborhoods.includes(s.neighborhood_name)) return false;
    } else if (f.neighborhood && f.neighborhood !== "all" && s.neighborhood_name !== f.neighborhood) {
      return false;
    }
    if (f.status && f.status !== "all" && s.current_status !== f.status) return false;
    if (f.genesis === "sample" && s.genesis_sample !== "yes") return false;
    if (q) {
      const compact = q.replace(/[^a-z0-9]/g, "");
      const blob = `${s.address} ${s.neighborhood_name} ${s.zoned_as} ${s.pin}`.toLowerCase();
      const pin = String(s.pin || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const hit = blob.includes(q) || (compact.length >= 3 && pin.includes(compact));
      if (!hit) return false;
    }
    return true;
  });
}

export function chosenTypes(f = {}) {
  if (f.typologies && f.typologies.length) return f.typologies;
  if (f.typology && f.typology !== "any") return [f.typology];
  return [...TYPOLOGIES];
}

export function deckPairings(sites, session, f = {}) {
  const filtered = filterSites(sites, f);
  const types = chosenTypes(f);
  const rows = [];
  for (const site of filtered) {
    for (const typology of types) {
      rows.push(buildPairing(site, typology, session));
    }
  }
  return { filtered, pairings: sortPairings(rows) };
}

function matchBrief(session, site, typology, verdict, score, block) {
  const type = (TYPOLOGY_LABELS[typology] || "housing type").toLowerCase();
  if (verdict === "no-go") {
    return `Skip this visit for a ${type}. ${districtPlain(site.zoned_as)} does not allow it.`;
  }
  if (verdict === "caution") {
    return `Hold the visit. Open Maps, look at the lot, then confirm zoning for a ${type} before you spend a week on drawings.`;
  }
  const feas = block.factors.feasibility.detail;
  return `Walk it. You are ranking a ${type} here because your weights put this pairing on the list (${feas}).`;
}

export function featuredPairing(pairings, lastKey) {
  if (lastKey) {
    const hit = pairings.find((p) => p.key === lastKey);
    if (hit) return hit;
  }
  return pairings.find((p) => p.verdict === "go") || pairings[0];
}

function callRank(verdict) {
  return { go: 0, caution: 1, "no-go": 2 }[verdict] ?? 3;
}

function factorNum(pairing, key) {
  const s = pairing.factors[key]?.score;
  return isUnknown(s) ? null : Number(s);
}

export function pickCompareType(left, right, session, preferred) {
  if (preferred && preferred !== "any" && TYPOLOGIES.includes(preferred)) return preferred;
  const leftBest = sortPairings(TYPOLOGIES.map((t) => buildPairing(left, t, session)))[0];
  const sharedGo = TYPOLOGIES.find(
    (t) => verdictFor(left, t) === "go" && verdictFor(right, t) === "go"
  );
  if (sharedGo) return sharedGo;
  const oneGo = TYPOLOGIES.find((t) => verdictFor(left, t) === "go" || verdictFor(right, t) === "go");
  return oneGo || leftBest?.typology || "duplex";
}

export function compareInsight(leftSite, rightSite, session, preferredType) {
  if (!leftSite || !rightSite) {
    return {
      type: preferredType && preferredType !== "any" ? preferredType : "duplex",
      left: null,
      right: null,
      winner: null,
      headline: "Pick two lots.",
      reasons: [],
    };
  }
  if (leftSite.site_id === rightSite.site_id) {
    return {
      type: preferredType && preferredType !== "any" ? preferredType : "duplex",
      left: null,
      right: null,
      winner: null,
      headline: "Pick two different lots.",
      reasons: [],
    };
  }
  const type = pickCompareType(leftSite, rightSite, session, preferredType);
  const left = buildPairing(leftSite, type, session);
  const right = buildPairing(rightSite, type, session);

  let winner = left;
  let loser = right;
  const byCall = callRank(left.verdict) - callRank(right.verdict);
  if (byCall > 0) {
    winner = right;
    loser = left;
  } else if (
    byCall === 0 &&
    (isUnknown(right.score) ? -1 : Number(right.score)) > (isUnknown(left.score) ? -1 : Number(left.score))
  ) {
    winner = right;
    loser = left;
  }

  const typeLabel = TYPOLOGY_LABELS[type].toLowerCase();
  const reasons = [];
  const zW = zoningAllows(winner.site, type);
  const zL = zoningAllows(loser.site, type);
  if (zW === "by_right" && zL !== "by_right") {
    reasons.push(
      `${winner.site.address} already allows a ${typeLabel} without a hearing. ${loser.site.address} does not.`
    );
  } else if (winner.verdict === "go" && loser.verdict !== "go") {
    reasons.push(
      `${winner.site.address} is a visit for a ${typeLabel}. ${loser.site.address} is a ${VERDICT_LABEL[loser.verdict].toLowerCase()}.`
    );
  }

  const sqW = Number(readField(winner.site, "parc_sq_ft"));
  const sqL = Number(readField(loser.site, "parc_sq_ft"));
  if (Number.isFinite(sqW) && Number.isFinite(sqL) && sqW > sqL) {
    reasons.push(`Larger lot: ${sqW.toLocaleString()} sq ft vs ${sqL.toLocaleString()} sq ft.`);
  } else if (Number.isFinite(sqW) && Number.isFinite(sqL) && sqL > sqW && winner.verdict === "go" && loser.verdict !== "go") {
    reasons.push(`The other lot is bigger, but it is not a visit for a ${typeLabel}.`);
  }

  const saleW = winner.site.current_status === "Available for Sale";
  const saleL = loser.site.current_status === "Available for Sale";
  if (saleW && !saleL) {
    reasons.push(
      `${winner.site.address} is listed for sale. ${loser.site.address} is ${String(loser.site.current_status || "not for sale").toLowerCase()}.`
    );
  }

  const places = session.missionPlaces || [];
  if (places.length) {
    const inW = places.includes(winner.site.neighborhood_name);
    const inL = places.includes(loser.site.neighborhood_name);
    if (inW && !inL) {
      reasons.push(`${winner.site.address} is in ${winner.site.neighborhood_name}, which you are staffing this month.`);
    }
  }

  const dW = Number(readField(winner.site, "transit_distance_ft"));
  const dL = Number(readField(loser.site, "transit_distance_ft"));
  if (Number.isFinite(dW) && Number.isFinite(dL) && dW + 50 < dL && Number(session.weights?.climate_proxy || 0) > 0) {
    reasons.push(`Closer to a bus stop (${Math.round(dW)} ft vs ${Math.round(dL)} ft).`);
  }

  const rentW = typicalRentUsd(winner.site);
  const rentL = typicalRentUsd(loser.site);
  if (!isUnknown(rentW) && !isUnknown(rentL) && rentW !== rentL) {
    const vsCity = rentW - PGH_MEDIAN_GROSS_RENT;
    reasons.push(
      `Typical rent nearby is $${rentW.toLocaleString()} here vs $${rentL.toLocaleString()} on the other tract. ${
        vsCity < 0
          ? `This tract sits $${Math.abs(vsCity).toLocaleString()} below Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
          : vsCity > 0
            ? `This tract sits $${vsCity.toLocaleString()} above Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()}).`
            : `This tract matches Pittsburgh typical.`
      }`
    );
  } else if (!isUnknown(rentW) && isUnknown(rentL)) {
    const vsCity = rentW - PGH_MEDIAN_GROSS_RENT;
    reasons.push(
      `Typical rent nearby at ${winner.site.address} is about $${rentW.toLocaleString()} a month, ${
        vsCity < 0 ? `$${Math.abs(vsCity).toLocaleString()} below` : vsCity > 0 ? `$${vsCity.toLocaleString()} above` : "in line with"
      } Pittsburgh typical. The other tract has no rent number in this file.`
    );
  }
  const predW = predictedRentUsd(winner.site);
  const predL = predictedRentUsd(loser.site);
  if (!isUnknown(predW) && !isUnknown(predL) && predW !== predL) {
    reasons.push(
      `Predicted carry from typical income is $${predW.toLocaleString()} here vs $${predL.toLocaleString()} on the other tract (30% of Census income).`
    );
  }

  if (!reasons.length) {
    reasons.push(
      `Both lots can take a ${typeLabel}. ${winner.site.address} ranks higher on the mix you set this month (allowed type, renter blocks, rent need, bus).`
    );
  }

  let headline;
  if (winner.verdict === "go") {
    headline = `Walk ${winner.site.address} for a ${typeLabel}.`;
  } else if (winner.verdict === "caution") {
    headline = `Hold both, but ${winner.site.address} is the better of the two for a ${typeLabel}.`;
  } else {
    headline = `Skip both for a ${typeLabel}.`;
  }

  return { type, left, right, winner, loser, headline, reasons: reasons.slice(0, 3) };
}
