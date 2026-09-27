import {
  FACTOR_LABELS,
  FACTORS,
  HOUSING_TYPES,
  PGH_MEDIAN_GROSS_RENT,
  PGH_MEDIAN_HOME_VALUE,
  PGH_MEDIAN_INCOME,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  buildAfford,
  displacementGapUsd,
  isUnknown,
  normalizeWeights,
  predictedRentUsd,
  readField,
  scoreSite,
  typicalHomeValueUsd,
  typicalRentUsd,
  usd,
} from "./scoring.js?v=cdc27";
import { useChipsHtml, useCounts } from "./uses.js?v=cdc27";
import { useAllows } from "./zone.js?v=cdc27";

const ZONING_KEY = {
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
  return useAllows(site, typology);
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
  const lab = (TYPOLOGY_LABELS[typology] || typology).toLowerCase();
  if (typology === "affordable" && z === "by_right") {
    return `Affordable housing is in play: a home is already allowed here and this tract sits below Pittsburgh typical income. That is not a tax-credit award.`;
  }
  if (z === "by_right") {
    return `${TYPOLOGY_LABELS[typology] || typology} is allowed without a special hearing in ${district}.`;
  }
  if (z === "not_allowed") {
    return `${district} is not a ${lab} district in this reading. Do not visit to pursue ${lab} on this lot.`;
  }
  return `Zoning for ${lab} is ${z}.`;
}

function whyLot(site, typology) {
  const sq = Number(readField(site, "parc_sq_ft"));
  if (!Number.isFinite(sq)) return "Lot size is unknown, so buildability is incomplete.";
  const full = { duplex: 2800, small_multifamily: 5000, single_family: 2500, affordable: 2800, office: 4000, commercial: 4000, industrial: 8000 }[typology] || 4000;
  const floor = { duplex: 1200, small_multifamily: 1800, single_family: 1200, affordable: 1200, office: 1500, commercial: 1500, industrial: 3000 }[typology] || 1500;
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
    return f.source === "not used for this type"
      ? "Renter share is not used for this type, so that factor was left out."
      : "The Census does not have a renter share for this neighborhood in our file, so that factor was left out.";
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

function whyDisplace(site, factors) {
  const f = factors.displacement_risk;
  if (!f || isUnknown(f.score)) {
    return "Displacement pressure is missing for this tract, so it was left out of the mix.";
  }
  const gap = displacementGapUsd(site);
  if (isUnknown(gap)) {
    return `${readField(site, "tract_rent_burden_pct")}% of nearby renters are cost-burdened (Census). That is pressure, not an eviction count.`;
  }
  if (gap > 0) {
    return `People nearby pay about $${gap.toLocaleString()} more a month than typical income can carry. A visit only makes sense if this housing type stays affordable.`;
  }
  return `Typical rent nearby is at or under what typical income can carry. Displacement pressure looks lower than in tighter tracts.`;
}

function whyClimate(site, factors) {
  const f = factors.climate_proxy;
  if (isUnknown(f.score)) {
    return "Distance to a bus stop is missing, so it was left out of the score.";
  }
  return `${readField(site, "transit_distance_ft")} feet to the nearest Port Authority bus stop. That is transit access, not a carbon model.`;
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
  const home = typicalHomeValueUsd(site);
  return [
    site.neighborhood_name,
    Number.isFinite(sq) ? `${sq.toLocaleString()} sq ft` : null,
    site.zoned_as || null,
    !isUnknown(pin) ? `PIN ${pin}` : null,
    site.current_status || null,
    !isUnknown(rent) ? `typical rent $${rent.toLocaleString()}` : null,
    !isUnknown(home) ? `nearby home $${home.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function feetBetween(a, b) {
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const r = 20902231;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathwayFor(site) {
  const inv = String(site.inventory_type || "").trim();
  if (inv === "PLB Transfer") {
    return {
      k: "Land Bank",
      v: "WPRDC lists a Pittsburgh Land Bank transfer. Public land with a title-clearing path. Confirm with PLB before you treat it as ready.",
    };
  }
  if (inv === "URA Transfer") {
    return {
      k: "URA",
      v: "Already held for URA transfer. CDCs favor city/URA/Housing Authority land because the handoff is cleaner than a private tax sale.",
    };
  }
  if (inv === "CDC Property Reserve") {
    return {
      k: "CDC reserve",
      v: "Already in the CDC property reserve. This is earmarked inventory, not a random private lot.",
    };
  }
  if (inv === "Public Sale") {
    return {
      k: "Public sale",
      v: "On the city public-sale list. Still public land. Check Available for Sale versus Sale Pending, then title.",
    };
  }
  return {
    k: "Public land",
    v: inv ? `Inventory type: ${inv}. This file is city vacant land, not private tax-delinquent stock.` : "City vacant land. Private tax-delinquent parcels are not in this file.",
  };
}

function allowLabel(z) {
  if (z === "by_right") return "already allowed";
  if (z === "not_allowed") return "not allowed";
  if (z === "conditional") return "needs a hearing";
  return "unknown";
}

export function steerTools(site) {
  const dist = districtPlain(site.zoned_as);
  const d = zoningAllows(site, "duplex");
  const m = zoningAllows(site, "small_multifamily");
  const zKnown = !isUnknown(site.zoned_as) || !isUnknown(d) || !isUnknown(m);
  const zHave = zKnown
    ? `${dist}. Two-family ${allowLabel(d)}. Small apartment ${allowLabel(m)}.`
    : "Zoning district is not in this file.";
  const path = pathwayFor(site);
  const ft = Number(site.lihtc_ft);
  const nm = site.lihtc_name || "a HUD LIHTC project";
  let taxHave;
  if (Number.isFinite(ft) && ft <= 1320) {
    taxHave = `HUD tax-credit housing within a quarter mile: ${nm} (${Math.round(ft).toLocaleString()} ft).`;
  } else if (Number.isFinite(ft)) {
    taxHave = `Nearest mapped HUD LIHTC is ${Math.round(ft).toLocaleString()} ft (${nm}).`;
  } else {
    taxHave = "LIHTC distance was not joined on this lot.";
  }
  return [
    {
      k: "Zoning and land use",
      have: zHave,
      miss: "Overlays, lot standards, and a live ROZA reading are not encoded here.",
    },
    {
      k: "Tax incentives",
      have: taxHave,
      miss: "TIF, LERTA, KOZ, Opportunity Zone, and city tax abatement are not in this file. LIHTC is a federal credit map, not a local incentive log.",
    },
    {
      k: "Public land",
      have: `${path.k}. ${site.current_status || "Status missing"}. City vacant land, not a private lot.`,
      miss: "Private tax-delinquent land and most of what private capital will build are not in this file.",
    },
  ];
}

export function steerHtml(site) {
  return `<p class="eyebrow" style="margin-top:1.2rem">How local government can steer here</p>
    <p class="muted">Cities barely build housing. They steer private money with zoning, tax tools, and the land they already hold. This lot only has what this file joined.</p>
    <div class="steer-grid">${steerTools(site)
      .map(
        (r) => `<article class="card steer-col">
      <p class="eyebrow">${r.k}</p>
      <p>${r.have}</p>
      <p class="small">${r.miss}</p>
    </article>`
      )
      .join("")}</div>`;
}

export function steerCitywide(sites) {
  const land = { "Public Sale": 0, "URA Transfer": 0, "PLB Transfer": 0, "CDC Property Reserve": 0, other: 0 };
  let duplex = 0;
  let mf = 0;
  let both = 0;
  let neither = 0;
  let zUnk = 0;
  let lihtcNear = 0;
  let lihtcFar = 0;
  let lihtcUnk = 0;
  for (const s of sites || []) {
    const inv = String(s.inventory_type || "").trim();
    if (inv in land) land[inv] += 1;
    else land.other += 1;
    const d = zoningAllows(s, "duplex");
    const m = zoningAllows(s, "small_multifamily");
    const dOk = d === "by_right";
    const mOk = m === "by_right";
    if ((isUnknown(d) || !d) && (isUnknown(m) || !m)) zUnk += 1;
    else if (dOk && mOk) both += 1;
    else if (dOk) duplex += 1;
    else if (mOk) mf += 1;
    else neither += 1;
    const ft = Number(s.lihtc_ft);
    if (!Number.isFinite(ft)) lihtcUnk += 1;
    else if (ft <= 1320) lihtcNear += 1;
    else lihtcFar += 1;
  }
  return { n: (sites || []).length, land, duplex, mf, both, neither, zUnk, lihtcNear, lihtcFar, lihtcUnk, uses: useCounts(sites) };
}

export function assemblyAround(site, sites, maxFt = 220) {
  return (sites || [])
    .filter((s) => s && s.site_id !== site.site_id && feetBetween(site, s) <= maxFt)
    .sort((a, b) => feetBetween(site, a) - feetBetween(site, b));
}

export function cdcScreen(site, sites) {
  const path = pathwayFor(site);
  const near = assemblyAround(site, sites);
  const allowed = TYPOLOGIES.filter((t) => zoningAllows(site, t) === "by_right");
  const sq = Number(readField(site, "parc_sq_ft"));
  const place = site.neighborhood_name || "this neighborhood";
  return [
    {
      step: "1. Public land",
      title: site.current_status || "City vacant lot",
      body: `PIN ${isUnknown(readField(site, "pin")) ? "not listed" : readField(site, "pin")}. ${path.k}. WPRDC city-owned vacant land, not Parcels N'At private delinquency.`,
    },
    {
      step: "2. Pathway",
      title: path.k,
      body: path.v,
    },
    {
      step: "3. Assembly",
      title: near.length ? `${near.length} city lot${near.length === 1 ? "" : "s"} within 220 ft` : "Isolated in this file",
      body: near.length
        ? `Cluster: ${near
            .slice(0, 3)
            .map((s) => s.address)
            .join("; ")}. Contiguous assembly is how CDCs get mixed-income scale.`
        : "No other city vacant lot in this file within 220 feet. Isolated lots are harder to build efficiently.",
    },
    {
      step: "4. By-right density",
      title: allowed.length ? allowed.map((t) => TYPOLOGY_LABELS[t]).join(" and ") : "No two-family or small apartment by-right",
      body: Number.isFinite(sq)
        ? `${sq.toLocaleString()} sq ft in ${districtPlain(site.zoned_as)}. Visit if the type is already allowed; skip a variance fight this week.`
        : `Zoning ${districtPlain(site.zoned_as)}. Lot size missing.`,
    },
    {
      step: "5. Stewardship",
      title: place,
      body:
        String(site.steep_slope || "").toLowerCase() === "yes"
          ? `This point sits in the city's 25% or greater slope polygons. Infill here fights hillside stewardship. Cross-check the ${place} plan before you treat it as a build site.`
          : `Cross-check the ${place} master plan. Slope at this point is not flagged as 25%+. Greenway and Adopt-A-Lot programs are still not polygons in this file.`,
    },
  ];
}

export function assemblyNote(site, sites) {
  const near = assemblyAround(site, sites);
  if (!near.length) return "Isolated in this city vacant file: no neighbor lot within 220 feet.";
  return `${near.length} other city vacant lot${near.length === 1 ? "" : "s"} within 220 feet. First: ${near[0].address}.`;
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
  const card = site.site_id
    ? `<a class="pill ghost" href="#/scorecard/${site.site_id}">CDC screen</a>`
    : "";
  if (!maps && !pinBtn && !card) return "";
  return `<div class="cta-row walk-actions">${maps}${pinBtn}${card}</div>`;
}

export function cardPoints(site, typology, verdict, weights) {
  const type = TYPOLOGY_LABELS[typology];
  const z = zoningAllows(site, typology);
  const district = districtPlain(site.zoned_as);
  const sqRaw = readField(site, "parc_sq_ft");
  const sq = Number(sqRaw);
  const pin = readField(site, "pin");
  const a = buildAfford(site, typology);
  const rows = [];
  if (a.housing) {
    const bits = [];
    if (a.home != null) bits.push(`nearby finished home $${a.home.toLocaleString()}`);
    if (a.land != null) bits.push(`this land $${a.land.toLocaleString()} (2012 FMV)`);
    if (a.cost != null) bits.push(`${a.units} × HOME 2BR ceiling $${a.cost.toLocaleString()}`);
    if (a.sale != null) bits.push(`if sold at tract typical $${a.sale.toLocaleString()}`);
    if (a.spread != null) {
      bits.push(
        a.spread >= 0
          ? `$${a.spread.toLocaleString()} above land plus that ceiling`
          : `$${Math.abs(a.spread).toLocaleString()} short of land plus that ceiling`
      );
    }
    rows.push({
      k: "Build",
      v: bits.length
        ? `${bits.join(". ")}. Not a bid or an appraisal.`
        : "No land value or tract home value to stack a build against.",
    });
  } else if (a.land != null) {
    rows.push({ k: "Land", v: `County 2012 fair-market land $${a.land.toLocaleString()}.` });
  }
  rows.push({ k: "Do", v: walkLine(site, typology, verdict) });

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
  const path = pathwayFor(site);
  rows.push({ k: "Pathway", v: `${path.k}. ${path.v}` });
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
  const gap = displacementGapUsd(site);
  if (!isUnknown(gap) && gap > 0) {
    rows.push({
      k: "Displacement",
      v: `People nearby pay about $${gap.toLocaleString()} more than typical income can carry. Walk only if this type stays affordable.`,
    });
  }
  const bus = readField(site, "transit_distance_ft");
  if (!isUnknown(bus)) {
    rows.push({
      k: "Opportunity",
      v: `${bus} feet to a bus stop. Transit access, not jobs or schools.`,
    });
  }
  if (weights) {
    const n = normalizeWeights(weights);
    const top = FACTORS.slice().sort((a, b) => n[b] - n[a])[0];
    rows.push({
      k: "Your mix",
      v: `This rank uses your weights, not a city default. Strongest pull: ${FACTOR_LABELS[top].toLowerCase()}.`,
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

function money(n) {
  const v = usd(n);
  return v == null ? null : `$${v.toLocaleString()}`;
}

export function affordHtml(site, typology) {
  const a = buildAfford(site, typology);
  const land = money(a.land);
  const home = money(a.home);
  const vs = a.home != null ? a.home - PGH_MEDIAN_HOME_VALUE : null;
  const vsLab =
    vs == null
      ? ""
      : vs < 0
        ? `${money(Math.abs(vs))} below Pittsburgh typical (${money(PGH_MEDIAN_HOME_VALUE)})`
        : vs > 0
          ? `${money(vs)} above Pittsburgh typical (${money(PGH_MEDIAN_HOME_VALUE)})`
          : `In line with Pittsburgh typical (${money(PGH_MEDIAN_HOME_VALUE)})`;
  if (!a.housing) {
    return `<div class="afford-band">
      <p class="eyebrow">This land on the books</p>
      <p class="serif afford-n">${land || "No assessment"}</p>
      <p class="muted">County 2012 fair-market land value. Workplace types are not given a home-sale number.</p>
    </div>`;
  }
  const sale = money(a.sale);
  const cost = money(a.cost);
  const tone = a.spread == null ? "warn" : a.spread >= 0 ? "go" : "bad";
  const spreadClean =
    a.spread == null
      ? "Need both a tract home value and land value to stack typical sales against land plus the HOME ceiling."
      : a.spread >= 0
        ? `If each unit sold at the tract typical, that is ${money(a.spread)} above land plus the HOME 2-bedroom ceiling. Not a bid and not an appraisal.`
        : `If each unit sold at the tract typical, you are about ${money(Math.abs(a.spread))} short of land plus the HOME 2-bedroom ceiling. Not a bid and not an appraisal.`;
  return `<div class="afford-band tone-${tone}">
    <p class="eyebrow">Can you cover a build?</p>
    <p class="serif afford-n">${home ? `Nearby finished home ${home}` : "No tract home value"}</p>
    <p>${home && vsLab ? vsLab + "." : ""} Land on this PIN ${land || "not in the assessment file"}. ${a.units} unit${a.units === 1 ? "" : "s"} × HOME 2-bedroom ceiling ${cost || "—"}${sale ? ` · if sold at tract typical ${sale}` : ""}.</p>
    <p class="muted">${spreadClean} County land is 2012 base-year FMV. HOME ceiling is Allegheny County's 2025 HUD 2-bedroom elevator limit ($261,595), a subsidy cap not a contractor price. ACS home value is nearby owner-occupied stock, not this vacant lot.</p>
  </div>`;
}

function numField(site, key) {
  const n = Number(readField(site, key));
  return Number.isFinite(n) ? n : null;
}

export function tradeoffSheet(site, typology, session = {}) {
  const type = (TYPOLOGY_LABELS[typology] || "this type").toLowerCase();
  const gain = [];
  const cost = [];
  const miss = [];
  const z = zoningAllows(site, typology);
  const sq = numField(site, "parc_sq_ft");
  const share = numField(site, "tract_renter_share");
  const burden = numField(site, "tract_rent_burden_pct");
  const bus = numField(site, "transit_distance_ft");
  const flood = String(site.flood_zone_nfhl || site.flood_zone || "").trim();
  const sfha = String(site.flood_sfha || "").trim().toUpperCase();
  const steep = String(site.steep_slope || "").trim().toLowerCase();
  const trees = numField(site, "trees_400ft");
  const treeCo2 = numField(site, "tree_co2_lbs");
  const lihtcFt = numField(site, "lihtc_ft");
  const gap = displacementGapUsd(site);
  const rent = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  const w = normalizeWeights(session.weights || {});
  const aff = buildAfford(site, typology);
  if (aff.housing && aff.spread != null) {
    if (aff.spread >= 0) {
      gain.push(
        `If ${aff.units} unit${aff.units === 1 ? "" : "s"} sold at the tract typical home value, that is about $${aff.spread.toLocaleString()} above this land plus the HOME 2-bedroom ceiling. A stack of public numbers, not a bid.`
      );
    } else {
      cost.push(
        `If ${aff.units} unit${aff.units === 1 ? "" : "s"} sold at the tract typical, you are about $${Math.abs(aff.spread).toLocaleString()} short of this land plus the HOME 2-bedroom ceiling. Subsidy or a cheaper build has to close that.`
      );
    }
  } else if (aff.housing && aff.home == null) {
    miss.push("No ACS median home value on this tract, so an expected sale is not claimed.");
  }

  if (z === "by_right") {
    gain.push(`A ${type} is already allowed. The CDC is not spending this cycle on a variance.`);
  } else if (z === "not_allowed") {
    cost.push(`A ${type} is not allowed here. Treating this as a fit would ignore zoning.`);
  } else {
    miss.push(`Zoning for a ${type} is not a clean by-right reading in this file.`);
  }

  const otherAllowed = TYPOLOGIES.filter((t) => t !== typology && zoningAllows(site, t) === "by_right");
  if (typology === "duplex" && otherAllowed.includes("small_multifamily")) {
    cost.push("A small apartment is also allowed. You get a two-family house and give up more homes on the same lot.");
  }
  if (typology === "small_multifamily") {
    gain.push("More homes on one city lot than a two-family house.");
    if (otherAllowed.includes("duplex")) {
      cost.push("Neighbors who wanted a house-scale building get apartments instead.");
    }
  }

  const path = pathwayFor(site);
  if (path.k === "Land Bank" || path.k === "URA" || path.k === "CDC reserve") {
    gain.push(`${path.k} land. Public control, not a private speculative flip.`);
  }

  if (share != null) {
    if (share >= 55) {
      gain.push(`About ${share}% of nearby households already rent. A ${type} serves people in this market, not a homeowner-only block.`);
    } else {
      cost.push(`Only about ${share}% of nearby households rent. A ${type} may be more homes than this block currently absorbs.`);
    }
  } else {
    miss.push("Census renter share is not on this tract, so demand is not claimed.");
  }

  if (!isUnknown(gap) && gap > 0) {
    cost.push(
      `Neighbors already pay about $${gap.toLocaleString()} a month more than typical income can carry. New ${type} units help only if they stay below that strain. We do not have a listing rent for this lot, so we do not claim they will.`
    );
  } else if (burden != null && burden >= 40) {
    cost.push(`About ${burden}% of nearby renters are stretched on rent. Building without an affordability rule can add pressure.`);
  }
  if (!isUnknown(rent) && !isUnknown(pred) && rent <= pred) {
    gain.push(`Typical rent nearby ($${rent.toLocaleString()}) sits at or under what typical income can carry ($${pred.toLocaleString()}). Less strain than the overpaying tracts.`);
  }

  if (sfha === "T") {
    cost.push(`Live FEMA NFHL: special flood hazard area, zone ${flood || "listed"}. Building here takes on flood exposure. Confirm BFE on the FIRM.`);
  } else if (flood) {
    gain.push(`Live FEMA NFHL zone ${flood}${site.flood_subty ? ` (${String(site.flood_subty).toLowerCase()})` : ""}.`);
  }
  if (steep === "yes") {
    cost.push("This point is inside the city's 25% or greater slope polygons. Infill here trades away easy grading and may belong in a conservation conversation.");
  }
  const heat = numField(site, "heat_severity");
  if (heat != null) {
    if (heat >= 4) {
      cost.push(`TPL heat severity ${heat} of 5. Summer land surface is hotter than the city's mean. Not air temperature.`);
    } else if (heat <= 2) {
      gain.push(`TPL heat severity ${heat} of 5. Summer land surface is cooler than the city's mean. Not air temperature.`);
    }
  } else {
    miss.push("No TPL heat-severity pixel on this lot. Surface heat is not claimed.");
  }
  if (trees != null) {
    if (trees >= 8) {
      gain.push(`${trees} city street trees within 400 ft. More curb shade than a bare block. 2020 DPW inventory.`);
    } else {
      cost.push(`Only ${trees} city street trees within 400 ft. Less shade at the curb.`);
    }
  }
  if (treeCo2 != null && treeCo2 > 0) {
    gain.push(`Those street trees sequester about ${Math.round(treeCo2).toLocaleString()} lbs CO2/year on the city's forestry calculator. That is not operational carbon of a new building.`);
  }
  if (lihtcFt != null) {
    const nm = site.lihtc_name || "a LIHTC property";
    if (lihtcFt <= 1320) {
      cost.push(`HUD LIHTC already nearby: ${nm} about ${lihtcFt.toLocaleString()} ft away${site.lihtc_units ? ` (${site.lihtc_units} units)` : ""}. Another credit deal is a QAP competition, not a vacant-lot yes.`);
    } else {
      gain.push(`Nearest mapped HUD LIHTC is ${lihtcFt.toLocaleString()} ft (${nm}). This walk is not on top of that project point.`);
    }
  }
  if (site.who_note) {
    gain.push(site.who_note);
  }

  if (bus != null) {
    if (bus <= 1320) {
      gain.push(`${Math.round(bus)} feet to a bus stop. Transit access for new households.`);
    } else {
      cost.push(`${Math.round(bus)} feet to a bus stop. You give up a short walk to transit.`);
    }
  } else {
    miss.push("No bus distance on this lot. Transit is not claimed.");
  }

  miss.push("Operational carbon of a new building is not measured. Tree calculator pounds are street trees only.");
  if (steep !== "yes" && steep !== "no") {
    miss.push("Steep-slope overlay was not joined on this lot.");
  }
  if (share == null && isUnknown(rent)) {
    miss.push("ACS 2024 5-year has no tables for this tract GEOID. Left blank, not filled from a neighbor.");
  }

  if (w.displacement_risk >= 0.28 && !isUnknown(gap) && gap > 0) {
    cost.unshift("Your mix flagged overpaying neighbors as important. Walking this lot for more homes trades that concern for units.");
  }
  if (w.demand_fit >= 0.28 && share != null && share >= 55) {
    gain.unshift("Your mix asked for renter blocks. This tract matches that.");
  }

  const uniq = (arr) => [...new Set(arr)].slice(0, 5);
  return { gain: uniq(gain), cost: uniq(cost), miss: uniq(miss) };
}

function tagHtml(tags) {
  return `<div class="tag-row">${(tags || [])
    .map((t) => `<span class="tag tag-${t.tone || "info"}">${t.label}</span>`)
    .join("")}</div>`;
}

export function scorecardTags(site, sites) {
  const tags = [];
  const path = pathwayFor(site);
  tags.push({ label: path.k, tone: "info" });
  if (site.current_status) tags.push({ label: site.current_status, tone: "info" });
  const near = assemblyAround(site, sites);
  tags.push({
    label: near.length ? `${near.length} lot cluster` : "Isolated lot",
    tone: near.length ? "go" : "warn",
  });
  const allowed = TYPOLOGIES.filter((t) => zoningAllows(site, t) === "by_right");
  tags.push({
    label: allowed.length ? allowed.map((t) => TYPOLOGY_LABELS[t]).join(" + ") : "No by-right density",
    tone: allowed.length ? "go" : "bad",
  });
  const sfha = String(site.flood_sfha || "").toUpperCase();
  const flood = String(site.flood_zone_nfhl || site.flood_zone || "").trim();
  if (sfha === "T") tags.push({ label: `Flood ${flood || "SFHA"}`, tone: "bad" });
  else if (flood) tags.push({ label: `NFHL ${flood}`, tone: "go" });
  const steep = String(site.steep_slope || "").toLowerCase();
  if (steep === "yes") tags.push({ label: "25%+ slope", tone: "bad" });
  else if (steep === "no") tags.push({ label: "Not a steep polygon", tone: "go" });
  const trees = numField(site, "trees_400ft");
  if (trees != null) tags.push({ label: `${trees} street trees / 400 ft`, tone: trees >= 8 ? "go" : "warn" });
  const heat = numField(site, "heat_severity");
  if (heat != null) {
    tags.push({
      label: `Surface heat ${heat}/5`,
      tone: heat >= 4 ? "bad" : heat <= 2 ? "go" : "warn",
    });
  }
  const lihtc = numField(site, "lihtc_ft");
  if (lihtc != null) {
    tags.push({
      label: lihtc <= 1320 ? "LIHTC nearby" : `LIHTC ${Math.round(lihtc).toLocaleString()} ft`,
      tone: lihtc <= 1320 ? "warn" : "info",
    });
  }
  const share = numField(site, "tract_renter_share");
  if (share == null) tags.push({ label: "No tract ACS", tone: "warn" });
  return tags;
}

function marketRows(site) {
  const rows = [];
  const aff = buildAfford(site, "duplex");
  if (aff.home != null) {
    const vs = aff.home - PGH_MEDIAN_HOME_VALUE;
    rows.push({
      tone: vs >= 0 ? "info" : "warn",
      k: "Nearby home value",
      v: `$${aff.home.toLocaleString()}`,
      more: `${site.home_value_note || "ACS owner-occupied median in this tract."} Pittsburgh typical is $${PGH_MEDIAN_HOME_VALUE.toLocaleString()}.`,
    });
  } else {
    rows.push({
      tone: "warn",
      k: "Nearby home value",
      v: "Not on this tract",
      more: "ACS B25077 was blank or not fetched. Left empty, not filled from a neighbor.",
    });
  }
  if (aff.land != null) {
    rows.push({
      tone: "info",
      k: "This land (2012 FMV)",
      v: `$${aff.land.toLocaleString()}`,
      more: site.assess_note || "Allegheny County FAIRMARKETLAND via WPRDC. 2012 base year, not a 2026 ask.",
    });
  }
  const sq = numField(site, "parc_sq_ft");
  const allowed = TYPOLOGIES.filter((t) => zoningAllows(site, t) === "by_right");
  rows.push({
    tone: allowed.length ? "go" : "bad",
    k: "By-right types",
    v: allowed.length ? allowed.map((t) => TYPOLOGY_LABELS[t]).join(", ") : "Neither type by-right",
    more: `${Number.isFinite(sq) ? `${sq.toLocaleString()} sq ft. ` : ""}${districtPlain(site.zoned_as)}.`,
  });
  const rent = typicalRentUsd(site);
  const pred = predictedRentUsd(site);
  const gap = displacementGapUsd(site);
  const burden = numField(site, "tract_rent_burden_pct");
  if (!isUnknown(rent) || burden != null) {
    const bits = [];
    if (!isUnknown(rent)) bits.push(`Typical rent nearby $${rent.toLocaleString()}. Pittsburgh typical $${PGH_MEDIAN_GROSS_RENT.toLocaleString()}.`);
    if (burden != null) bits.push(`${burden}% of nearby renters spend 30% or more of income on rent.`);
    if (!isUnknown(gap) && gap > 0) bits.push(`About $${gap.toLocaleString()} over a 30% income carry.`);
    rows.push({
      tone: !isUnknown(gap) && gap > 0 ? "warn" : "info",
      k: "Rent nearby",
      v: !isUnknown(rent) ? `$${rent.toLocaleString()} / mo` : `${burden}% burden`,
      more: bits.join(" "),
    });
  } else {
    rows.push({
      tone: "warn",
      k: "Rent nearby",
      v: "Not on this tract",
      more: `City typical rent $${PGH_MEDIAN_GROSS_RENT.toLocaleString()} is a floor, not this block.`,
    });
  }
  const inc = numField(site, "tract_median_income");
  if (inc != null) {
    const pct = Math.round((inc / PGH_MEDIAN_INCOME) * 100);
    rows.push({
      tone: "info",
      k: "Typical income",
      v: `$${Math.round(inc).toLocaleString()} (${pct}% of city)`,
      more: `${site.who_note || "Tract typical versus Pittsburgh ACS typical."}${!isUnknown(pred) ? ` Carry at 30% is about $${pred.toLocaleString()} a month.` : ""}`,
    });
  } else {
    rows.push({
      tone: "warn",
      k: "Typical income",
      v: "Not on this tract",
      more: `No ACS income. City typical is $${PGH_MEDIAN_INCOME.toLocaleString()}. That is not a household on this lot.`,
    });
  }
  const bus = numField(site, "transit_distance_ft");
  rows.push({
    tone: bus == null ? "warn" : bus <= 1320 ? "go" : "warn",
    k: "Bus",
    v: bus == null ? "Not joined" : `${Math.round(bus).toLocaleString()} ft`,
    more: "Port Authority stop distance. Transit access, not jobs, schools, or carbon kilograms.",
  });
  const trees = numField(site, "trees_400ft");
  const co2 = numField(site, "tree_co2_lbs");
  rows.push({
    tone: trees == null ? "warn" : trees >= 8 ? "go" : "warn",
    k: "Curb shade",
    v: trees == null ? "No tree count" : `${trees} trees / 400 ft`,
    more: co2
      ? `City forestry calculator: about ${Math.round(co2).toLocaleString()} lbs CO2/year on those street trees. Not operational carbon of a new building. DPW inventory ~2020.`
      : "DPW street-tree inventory within 400 ft. Shade, not the heat raster.",
  });
  const heat = numField(site, "heat_severity");
  rows.push({
    tone: heat == null ? "warn" : heat >= 4 ? "bad" : heat <= 2 ? "go" : "info",
    k: "Surface heat",
    v: heat == null ? "No pixel" : `${heat} of 5`,
    more: site.heat_note || "TPL Heat Severity USA 2023. Land surface versus city mean, not air temperature.",
  });
  const lihtc = numField(site, "lihtc_ft");
  rows.push({
    tone: lihtc == null ? "warn" : lihtc <= 1320 ? "warn" : "info",
    k: "Nearest LIHTC",
    v: lihtc == null ? "Not mapped" : `${Math.round(lihtc).toLocaleString()} ft`,
    more: site.lihtc_name
      ? `${site.lihtc_name}${site.lihtc_units ? ` · ${site.lihtc_units} units` : ""}. HUD mapped project point. QAP is a separate competition.`
      : "Distance to nearest HUD LIHTC point in Pittsburgh.",
  });
  return rows;
}

export function scorecardHtml(site, sites, session) {
  const tags = scorecardTags(site, sites);
  const screens = cdcScreen(site, sites);
  const best = sortPairings(TYPOLOGIES.map((t) => buildPairing(site, t, session)))[0];
  const sheet = best?.tradeoffs || { gain: [], cost: [], miss: [] };
  const mix = best
    ? FACTORS.map((k) => {
        const f = best.factors[k];
        const n = f && !isUnknown(f.score) ? Number(f.score) : null;
        return { k: FACTOR_LABELS[k], n, detail: f?.detail || "Left out" };
      })
    : [];
  const col = (title, tone, items) =>
    `<article class="sw-col ${tone}">
      <p class="eyebrow">${title}</p>
      <ul>${(items && items.length ? items : ["Nothing named from this file."]).map((t) => `<li>${t}</li>`).join("")}</ul>
    </article>`;
  const rail = screens
    .map(
      (s, i) => `<article class="rail-step">
        <span class="rail-n">${i + 1}</span>
        <div>
          <p class="eyebrow">${s.step.replace(/^\d+\.\s*/, "")}</p>
          <h3 class="serif">${s.title}</h3>
          <p>${s.body}</p>
        </div>
      </article>`
    )
    .join("");
  const facts = marketRows(site)
    .map(
      (r) => `<div class="fact-row tone-${r.tone}">
        <div>
          <span class="tag tag-${r.tone}">${r.k}</span>
          <strong>${r.v}</strong>
        </div>
        <details class="more"><summary>More</summary><p>${r.more}</p></details>
      </div>`
    )
    .join("");
  const mixHtml = mix
    .map((m) => {
      const w = m.n == null ? 0 : Math.max(4, Math.min(100, m.n));
      return `<div class="mix-row">
        <span>${m.k}</span>
        <div class="opp-track ${m.n == null ? "empty" : ""}">${m.n == null ? "" : `<span class="opp-fill" style="width:${w}%"></span>`}</div>
        <b>${m.n == null ? "—" : Math.round(m.n)}</b>
      </div>`;
    })
    .join("");
  const call = best ? VERDICT_LABEL[best.verdict] : "Hold";
  const type = best ? TYPOLOGY_LABELS[best.typology] : "";
  const n = best && !isUnknown(best.score) ? Math.round(Number(best.score)) : "—";
  return `
    <div class="dossier-head card">
      ${affordHtml(site, best?.typology)}
      ${tagHtml(tags)}
      <p class="eyebrow">${site.neighborhood_name || "Pittsburgh"} · PIN ${isUnknown(readField(site, "pin")) ? "none" : readField(site, "pin")}</p>
      <h2 class="serif pairing-title">${site.address}</h2>
      <p class="brief"><span class="verdict ${best?.verdict || "caution"}">${call}</span> Best type on file: <strong>${type}</strong>. Mix ${n} under your weights. Zoning is the visit gate; the number only orders lots that share a call.</p>
      <p class="cta-row" style="margin-top:0.85rem"><a class="pill" href="#/compare">Two types on this lot</a></p>
    </div>
    ${steerHtml(site)}
    ${useChipsHtml(site)}
    <div class="sw-grid">
      ${col("Strengths", "go", sheet.gain)}
      ${col("Watch-outs", "bad", sheet.cost)}
    </div>
    <p class="eyebrow" style="margin-top:1.2rem">CDC filters</p>
    <div class="rail">${rail}</div>
    <p class="eyebrow" style="margin-top:1.2rem">On this lot</p>
    <div class="fact-list card">${facts}</div>
    <p class="eyebrow" style="margin-top:1.2rem">Why this type ranks</p>
    <div class="card mix-card">${mixHtml}
      <p class="small">Unknown bars are empty on purpose. Flood, trees, and LIHTC are tags above, not part of this mix. ${sheet.miss[0] || ""}</p>
    </div>`;
}

export function tradeoffHtml(sheet) {
  if (!sheet) return "";
  const col = (eyebrow, title, items) =>
    `<article class="card tradeoff-col">
      <p class="eyebrow">${eyebrow}</p>
      <h3 class="serif">${title}</h3>
      <ul>${(items && items.length ? items : ["Nothing named from this file."]).map((t) => `<li>${t}</li>`).join("")}</ul>
    </article>`;
  return `<div class="tradeoff-grid">
    ${col("Who benefits", "You get", sheet.gain)}
    ${col("Who might be harmed", "You give up", sheet.cost)}
    ${col("What we get wrong", "Not answered", sheet.miss)}
  </div>`;
}

export function pairingKey(siteId, typology) {
  return `${siteId}:${typology}`;
}

export function parsePairingKey(key) {
  const [siteId, typology] = String(key || "").split(":");
  return { siteId, typology };
}

export function buildPairing(site, typology, session) {
  const t = TYPOLOGIES.includes(typology) ? typology : "duplex";
  const result = scoreSite(site, session.weights);
  const block = result.typologies[t];
  const verdict = verdictFor(site, t);
  const score = block.composite.score;
  const why = [
    whyZoning(site, t),
    whyLot(site, t),
    whyDemand(site, block.factors),
    whyAfford(site, block.factors),
    whyDisplace(site, block.factors),
    whyClimate(site, block.factors),
    whyWeights(session.weights, block.composite),
  ];
  const brief = matchBrief(session, site, t, verdict, score, block);
  const points = cardPoints(site, t, verdict, session.weights);
  const tradeoffs = tradeoffSheet(site, t, session);
  return {
    key: pairingKey(site.site_id, t),
    site,
    typology: t,
    verdict,
    score,
    why,
    brief,
    points,
    tradeoffs,
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

export function stampClusters(sites) {
  const cell = 0.00075;
  const buckets = new Map();
  (sites || []).forEach((s) => {
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      s._cluster_n = 0;
      return;
    }
    const key = `${Math.round(lat / cell)}_${Math.round(lon / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  });
  (sites || []).forEach((s) => {
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      s._cluster_n = 0;
      return;
    }
    const cx = Math.round(lat / cell);
    const cy = Math.round(lon / cell);
    let n = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        n += (buckets.get(`${cx + dx}_${cy + dy}`) || []).length;
      }
    }
    s._cluster_n = Math.max(0, n - 1);
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
    if (f.inventoryTypes && f.inventoryTypes.length) {
      if (!f.inventoryTypes.includes(s.inventory_type)) return false;
    }
    if (f.skipSfha && String(s.flood_sfha || "").toUpperCase() === "T") return false;
    if (f.skipSteep && String(s.steep_slope || "").toLowerCase() === "yes") return false;
    if (f.transitMaxFt > 0) {
      const dist = Number(s.transit_distance_ft);
      if (Number.isFinite(dist) && dist > f.transitMaxFt) return false;
    }
    if (f.minTrees > 0) {
      const t = Number(s.trees_400ft);
      if (!Number.isFinite(t) || t < f.minTrees) return false;
    }
    if (f.skipHot) {
      const h = Number(s.heat_severity);
      if (Number.isFinite(h) && h >= 4) return false;
    }
    if (f.lihtc === "near") {
      const ft = Number(s.lihtc_ft);
      if (!Number.isFinite(ft) || ft > 1320) return false;
    }
    if (f.lihtc === "avoid") {
      const ft = Number(s.lihtc_ft);
      if (Number.isFinite(ft) && ft <= 1320) return false;
    }
    if (f.minCluster > 0 && Number(s._cluster_n || 0) < f.minCluster) return false;
    if (f.minRenter > 0) {
      const share = Number(s.tract_renter_share);
      if (Number.isFinite(share) && share < f.minRenter) return false;
    }
    if (f.lowerIncome) {
      const vs = Number(s.income_vs_city_pct);
      if (Number.isFinite(vs) && vs >= 100) return false;
    }
    if (f.avoidPressure) {
      const gap = displacementGapUsd(s);
      const burden = Number(s.tract_rent_burden_pct);
      if (!isUnknown(gap) && gap > 0) return false;
      if (Number.isFinite(burden) && burden >= 40) return false;
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

export function currentWalks(sites, session, rankedWalk) {
  const extras = (session.extraWalks || [])
    .map((x) => {
      const site = (sites || []).find((s) => s.site_id === x.siteId);
      if (!site) return null;
      const typology =
        x.typology && TYPOLOGIES.includes(x.typology)
          ? x.typology
          : TYPOLOGIES.find((t) => verdictFor(site, t) === "go") || "duplex";
      return buildPairing(site, typology, session);
    })
    .filter(Boolean);
  const rest = (rankedWalk || []).filter((p) => !extras.some((e) => e.site.site_id === p.site.site_id));
  const seen = new Set();
  return [...extras, ...rest].filter((p) => {
    if (seen.has(p.site.site_id)) return false;
    seen.add(p.site.site_id);
    return true;
  });
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

export function compareInsight(leftSite, rightSite, session, preferredType, allSites = []) {
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

  const pathW = pathwayFor(winner.site);
  const pathL = pathwayFor(loser.site);
  if (pathW.k !== pathL.k) {
    reasons.push(`Acquisition path: ${pathW.k} on ${winner.site.address} vs ${pathL.k} on the other lot.`);
  }

  const nW = assemblyAround(winner.site, allSites).length;
  const nL = assemblyAround(loser.site, allSites).length;
  if (nW > nL + 1) {
    reasons.push(
      `Better assembly: ${nW} nearby city vacant lots within 220 ft vs ${nL}. CDCs prefer clusters over isolated lots.`
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

  const gapW = displacementGapUsd(winner.site);
  const gapL = displacementGapUsd(loser.site);
  if (!isUnknown(gapW) && gapW > 0 && (isUnknown(gapL) || gapW !== gapL)) {
    reasons.push(
      `Displacement pressure is higher here: neighbors pay about $${gapW.toLocaleString()} more than typical income can carry. Walk only if the ${typeLabel} stays affordable.`
    );
  }

  const wMix = normalizeWeights(session.weights || {});
  let tip = null;
  let tipDelta = 0;
  for (const k of FACTORS) {
    const nw = factorNum(winner, k);
    const nl = factorNum(loser, k);
    if (nw == null || nl == null) continue;
    const d = wMix[k] * (nw - nl);
    if (d > tipDelta) {
      tipDelta = d;
      tip = k;
    }
  }
  if (tip && tipDelta >= 0.4) {
    reasons.push(
      `Your mix tipped this. You weighted ${FACTOR_LABELS[tip].toLowerCase()} more, and ${winner.site.address} scores higher there. Change the mix in onboarding if that is not what you meant.`
    );
  }

  if (!reasons.length) {
    reasons.push(
      `Both lots can take a ${typeLabel}. ${winner.site.address} ranks higher on the mix you set this month.`
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

  return { type, left, right, winner, loser, headline, reasons: reasons.slice(0, 4) };
}

export function scenarioInsight(site, typeA, typeB, session = {}) {
  if (!site) {
    return { left: null, right: null, winner: null, headline: "Pick a lot.", reasons: [] };
  }
  const aType = HOUSING_TYPES.includes(typeA) ? typeA : "duplex";
  const bType = HOUSING_TYPES.includes(typeB) ? typeB : "small_multifamily";
  if (aType === bType) {
    return {
      left: buildPairing(site, aType, session),
      right: null,
      winner: null,
      headline: "Pick two different types.",
      reasons: [],
    };
  }
  const left = buildPairing(site, aType, session);
  const right = buildPairing(site, bType, session);
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
  const wLab = TYPOLOGY_LABELS[winner.typology].toLowerCase();
  const lLab = TYPOLOGY_LABELS[loser.typology].toLowerCase();
  const reasons = [];
  const zW = zoningAllows(site, winner.typology);
  const zL = zoningAllows(site, loser.typology);
  if (zW !== zL) {
    if (zW === "by_right" && zL !== "by_right") {
      reasons.push(
        `From the file: a ${wLab} is already allowed here. A ${lLab} is not. Visit/Hold/Skip is zoning, not your sliders.`
      );
    } else {
      reasons.push(
        `From the file: zoning reads ${String(zW).replace(/_/g, " ")} for a ${wLab} and ${String(zL).replace(/_/g, " ")} for a ${lLab}.`
      );
    }
  } else if (zW === "by_right") {
    reasons.push(`From the file: both types are already allowed on this lot. Zoning does not pick a winner.`);
  } else {
    reasons.push(`From the file: neither type is a clean by-right visit here. The mix is only ordering two weak calls.`);
  }
  reasons.push(
    "Census rent, income, and overpay are the same tract on both scenarios. They describe the block. They do not pick a housing type."
  );
  const sq = Number(readField(site, "parc_sq_ft"));
  if (Number.isFinite(sq) && winner.typology === "duplex" && loser.typology === "small_multifamily" && sq < 5000) {
    reasons.push(
      `This lot is ${sq.toLocaleString()} sq ft. That is a more comfortable two-family size than a small apartment in this file.`
    );
  } else if (Number.isFinite(sq) && winner.typology === "small_multifamily" && sq >= 5000) {
    reasons.push(`This lot is ${sq.toLocaleString()} sq ft. The file treats that as enough room for a small apartment.`);
  }
  const wMix = normalizeWeights(session.weights || {});
  let tip = null;
  let tipDelta = 0;
  for (const k of FACTORS) {
    const nw = factorNum(winner, k);
    const nl = factorNum(loser, k);
    if (nw == null || nl == null) continue;
    const d = wMix[k] * (nw - nl);
    if (d > tipDelta) {
      tipDelta = d;
      tip = k;
    }
  }
  if (winner.verdict === loser.verdict && tip && tipDelta >= 0.15) {
    reasons.push(
      `Your mix tipped the number. You weighted ${FACTOR_LABELS[tip].toLowerCase()} more, and a ${wLab} scores higher there. Move the sliders if that is not the judgment you meant.`
    );
  } else if (winner.verdict !== loser.verdict) {
    reasons.push("Changing sliders will not flip Visit to Skip. Zoning already decided the call.");
  }
  const dropped = [...new Set([...(winner.composite?.dropped || []), ...(loser.composite?.dropped || [])])];
  if (dropped.length) {
    reasons.push(
      `Left out of the mix because it is blank: ${dropped.map((k) => FACTOR_LABELS[k].toLowerCase()).join(", ")}. Blank is dropped, not scored as zero.`
    );
  }
  let headline;
  if (winner.verdict === "go" && loser.verdict !== "go") {
    headline = `On this lot, walk a ${wLab}. Skip a ${lLab}.`;
  } else if (winner.verdict === "go") {
    headline = `On this lot, both can be a visit. The mix prefers a ${wLab} over a ${lLab}.`;
  } else if (winner.verdict === "caution") {
    headline = `Hold both. If you had to staff one hearing, the mix leans ${wLab}.`;
  } else {
    headline = `Skip both types here. Zoning does not allow a ${wLab} or a ${lLab}.`;
  }
  return { left, right, winner, loser, headline, reasons: reasons.slice(0, 5), tip };
}

export function splitLegendHtml(pairing, session = {}) {
  const dropped = pairing?.composite?.dropped || [];
  const w = normalizeWeights(session.weights || {});
  const top = FACTORS.slice()
    .filter((k) => !dropped.includes(k))
    .sort((a, b) => (w[b] || 0) - (w[a] || 0))[0];
  const file = [
    "Visit / Hold / Skip is zoning on this lot.",
    "Lot size, bus distance, flood, hillside, trees, and surface heat are parcel or overlay joins.",
    "Rent, income, and overpay are ACS for the tract, not a listing for this building.",
  ];
  const values = [
    top
      ? `The mix number follows your sliders. Strongest pull right now: ${FACTOR_LABELS[top].toLowerCase()}.`
      : "The mix number follows your sliders on the factors that exist.",
    "Even sliders are still a judgment: you chose not to prefer one screen.",
  ];
  const missing = [
    dropped.length
      ? `${dropped.map((k) => FACTOR_LABELS[k]).join(", ")} is blank on this pairing, so it was dropped.`
      : "Every mix factor has a number on this pairing.",
    "Not in this file: operational carbon, jobs, schools, HUD CHAS, BFE, townhomes, accessory units, senior housing.",
  ];
  const col = (title, items) =>
    `<article class="split-col"><p class="eyebrow">${title}</p><ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul></article>`;
  return `<div class="split-board">${col("From the file", file)}${col("Your call", values)}${col("Not claimed", missing)}</div>`;
}
