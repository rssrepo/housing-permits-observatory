import { TYPOLOGY_LABELS, isUnknown, predictedRentUsd, PGH_MEDIAN_GROSS_RENT, readField } from "./scoring.js";
import {
  deckPairings,
  mapsUrl,
  walkLine,
  featuredPairing,
} from "./match.js";

let pendingPlan = null;

function walkDeck(sites, session, filters) {
  const { pairings } = deckPairings(sites, session, filters);
  const rankedWalk = filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings;
  return rankedWalk.slice(0, 5);
}

function currentWalks(sites, session, filters) {
  const extras = [];
  for (const x of session.extraWalks || []) {
    const site = sites.find((s) => s.site_id === x.siteId);
    if (site) extras.push({ site, typology: x.typology });
  }
  const ranked = walkDeck(sites, session, filters);
  const rest = ranked.filter((p) => !extras.some((e) => e.site.site_id === p.site.site_id));
  return [...extras, ...rest].slice(0, Math.max(5, extras.length));
}

function coords(site) {
  const lat = Number(site.latitude);
  const lon = Number(site.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

function miles(a, b) {
  const toRad = (n) => (n * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function orderStops(stops) {
  const usable = stops.filter((p) => coords(p.site));
  const missing = stops.filter((p) => !coords(p.site));
  if (usable.length <= 1) return stops;
  const start = usable.reduce((best, p) => (coords(p.site)[0] > coords(best.site)[0] ? p : best));
  const left = new Set(usable);
  const order = [];
  let cur = start;
  while (cur && left.size) {
    left.delete(cur);
    order.push(cur);
    let next = null;
    let best = Infinity;
    const here = coords(cur.site);
    for (const p of left) {
      const d = miles(here, coords(p.site));
      if (d < best) {
        best = d;
        next = p;
      }
    }
    cur = next;
  }
  return order.concat(missing);
}

function lineFor(p, i) {
  const type = TYPOLOGY_LABELS[p.typology] ? ` for a ${TYPOLOGY_LABELS[p.typology].toLowerCase()}` : "";
  const hood = p.site.neighborhood_name ? ` in ${p.site.neighborhood_name}` : "";
  return `${i}. ${p.site.address}${hood}${type}`;
}

function dirUrl(stops) {
  const pts = stops.map((p) => coords(p.site)).filter(Boolean);
  if (pts.length < 2) return "";
  return `https://www.google.com/maps/dir/${pts.map((c) => `${c[0]},${c[1]}`).join("/")}`;
}

function splitDays(order) {
  if (order.length <= 2) {
    return [order.slice(0, 1), order.slice(1)];
  }
  let cut = Math.ceil(order.length / 2);
  let gap = -1;
  for (let i = 0; i < order.length - 1; i++) {
    const a = coords(order[i].site);
    const b = coords(order[i + 1].site);
    if (!a || !b) continue;
    const d = miles(a, b);
    if (d > gap) {
      gap = d;
      cut = i + 1;
    }
  }
  if (cut < 1 || cut >= order.length) cut = Math.ceil(order.length / 2);
  return [order.slice(0, cut), order.slice(cut)];
}

function oneDayText(order) {
  const body = order.map((p, i) => lineFor(p, i + 1)).join(". Then ");
  const maps = dirUrl(order);
  return `This week, walk in this order: ${body}.${maps ? ` Maps: ${maps}` : ""}`;
}

function twoDayText(order) {
  const [d1, d2] = splitDays(order);
  const a = d1.length ? d1.map((p, i) => lineFor(p, i + 1)).join(". Then ") : "nothing yet";
  const b = d2.length ? d2.map((p, i) => lineFor(p, i + 1)).join(". Then ") : "nothing yet";
  const m1 = dirUrl(d1);
  const m2 = dirUrl(d2);
  return `Split it across two days. Day 1: ${a}.${m1 ? ` Maps: ${m1}` : ""} Day 2: ${b}.${m2 ? ` Maps: ${m2}` : ""}`;
}

function findNeighborhood(q, sites) {
  const names = [...new Set(sites.map((s) => s.neighborhood_name).filter(Boolean))];
  const hit = names.find((n) => q.includes(n.toLowerCase()));
  return hit || null;
}

function findSite(q, sites) {
  const compact = q.replace(/[^a-z0-9]/g, "");
  let best = null;
  let bestLen = 0;
  for (const s of sites) {
    const addr = String(s.address || "").toLowerCase();
    const pin = String(s.pin || "").toLowerCase();
    if (q.includes(addr) || (pin && q.includes(pin))) return s;
    const digits = addr.replace(/[^a-z0-9]/g, "");
    if (digits.length > 5 && compact.includes(digits) && digits.length > bestLen) {
      best = s;
      bestLen = digits.length;
    }
    const num = addr.match(/^\d+/)?.[0];
    if (num && q.includes(num) && addr.split(" ").slice(1).some((w) => q.includes(w))) return s;
  }
  return best;
}

function typeFromQuery(q) {
  if (/\badu\b|accessory/.test(q)) return "adu";
  if (/apartment|multifamily|small apartment/.test(q)) return "small_multifamily";
  if (/duplex|two-family|two family/.test(q)) return "duplex";
  return null;
}

function isRouteAsk(q) {
  return /route|itinerar|optim|order to walk|walking order|which order|sequence|path|loop|tour|plan my walk|plan the walk|one day|two day|2 day|1 day|same day/.test(
    q
  );
}

export function answerQuery(raw, { sites, session, filters }) {
  const q = raw.trim().toLowerCase();
  if (!q) return "Ask a question about a lot or this week's visits.";

  if (!session.missionSet) {
    return "Set where you are walking this month first. Then I can name lots.";
  }

  const five = currentWalks(sites, session, filters);
  const top = five[0] || featuredPairing(five, session.lastPairing);
  const place = findNeighborhood(q, sites);
  const site = findSite(q, sites);
  const type = typeFromQuery(q);

  if (pendingPlan && /two day|2 day|split|across two/.test(q)) {
    const text = twoDayText(pendingPlan);
    pendingPlan = null;
    return text;
  }
  if (pendingPlan && /one day|1 day|same day|today|all (of )?them|single day/.test(q)) {
    const text = oneDayText(pendingPlan);
    pendingPlan = null;
    return text;
  }

  if (isRouteAsk(q)) {
    if (!five.length) return "Your walk list is empty. Add lots on Visits or Find a lot, then ask for a route.";
    const order = orderStops(five);
    pendingPlan = order;
    const one = /one day|1 day|same day|today/.test(q);
    const two = /two day|2 day|split/.test(q);
    if (one) {
      pendingPlan = null;
      return oneDayText(order);
    }
    if (two) {
      pendingPlan = null;
      return twoDayText(order);
    }
    return `I can order this week's ${order.length} lots so you walk nearby ones in a row. Are you viewing all of them in one day, or splitting across two days?`;
  }

  if (/help|what can|what do you/.test(q)) {
    return "Try: give me a walking order. One day or two days? Where should I walk first? Open maps. What is the PIN?";
  }

  if (/first|top|should i walk|where should|this week|recommend|best/.test(q) && !place && !site) {
    if (!top) return "Nothing to walk under this month's cut. Change neighborhoods or type.";
    return `${walkLine(top.site, top.typology, top.verdict)} ${top.site.neighborhood_name}. Ask me for a walking order if you want 1 then 2 then 3.`;
  }

  if (/list|five|my visits|walk list/.test(q)) {
    if (!five.length) return "Your walk list is empty under this month's answers.";
    return five.map((p, i) => `${i + 1}. ${walkLine(p.site, p.typology, p.verdict)}`).join(" ");
  }

  if ((/map|maps|google|directions|how do i get/.test(q) && (site || top)) || (/map/.test(q) && !site && top)) {
    const s = site || top.site;
    return `Maps for ${s.address}: ${mapsUrl(s)}`;
  }

  if (/pin|parcel/.test(q)) {
    const s = site || top?.site;
    if (!s) return "No lot is in focus yet.";
    const pin = readField(s, "pin");
    if (isUnknown(pin)) return `${s.address} has no PIN in this file, so I am not showing one.`;
    return `PIN for ${s.address} is ${pin}. Copy it into the City sale record.`;
  }

  if (place) {
    const local = sites.filter((s) => s.neighborhood_name === place);
    const inCut = five.filter((p) => p.site.neighborhood_name === place);
    if (inCut.length) {
      return `${place}: walk ${inCut[0].site.address} for a ${TYPOLOGY_LABELS[inCut[0].typology].toLowerCase()}. ${inCut.length} of your visits are there.`;
    }
    return `${place} has ${local.length} city-owned vacant lots in the file. None made this week's list under your cut.`;
  }

  if (type) {
    const hits = five.filter((p) => p.typology === type);
    if (hits.length) {
      return `For ${TYPOLOGY_LABELS[type].toLowerCase()}, start at ${hits[0].site.address}.`;
    }
    if (!(session.missionTypes || []).includes(type) && session.missionType !== "any" && session.missionType !== type) {
      return `You did not pick ${TYPOLOGY_LABELS[type].toLowerCase()} for this month. Add it under what you want to put on the ground.`;
    }
    return `No ${TYPOLOGY_LABELS[type].toLowerCase()} visit made the list. Zoning is blocking it in this cut, or nothing is for sale.`;
  }

  if (site) {
    const pairing = five.find((p) => p.site.site_id === site.site_id);
    const line = pairing
      ? walkLine(site, pairing.typology, pairing.verdict)
      : `${site.address} is in ${site.neighborhood_name}. It is not in this week's list.`;
    const sq = Number(readField(site, "parc_sq_ft"));
    const extra = Number.isFinite(sq) ? ` ${sq.toLocaleString()} sq ft.` : "";
    return `${line}${extra}`;
  }

  if (/rent|burden|census|pay|predict/.test(q)) {
    const rentTop = top ? readField(top.site, "tract_median_gross_rent") : "unknown";
    if (top && !isUnknown(rentTop)) {
      const paid = Number(rentTop);
      const delta = paid - PGH_MEDIAN_GROSS_RENT;
      const vs =
        delta < 0
          ? `$${Math.abs(delta).toLocaleString()} below Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()})`
          : delta > 0
            ? `$${delta.toLocaleString()} above Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()})`
            : `in line with Pittsburgh typical ($${PGH_MEDIAN_GROSS_RENT.toLocaleString()})`;
      const pred = predictedRentUsd(top.site);
      const predBit = isUnknown(pred)
        ? ""
        : ` Typical income there can carry about $${pred.toLocaleString()} at 30%.`;
      return `People near ${top.site.address} typically pay about $${paid.toLocaleString()} a month. That is ${vs}.${predBit} Neighborhood typical, not a listing for this vacant lot. ACS is only filled for two Hill District tracts; elsewhere I hide it.`;
    }
    return "Typical rent, predicted carry, renter share, and rent burden only exist for two Hill District census areas in this file. If a lot is outside those, I hide those fields rather than guessing.";
  }

  if (/bus|transit|stop/.test(q)) {
    const dist = top ? readField(top.site, "transit_distance_ft") : "unknown";
    if (!top || isUnknown(dist)) {
      return "Bus distance is only on the original four Hill sample lots. I hide it everywhere else.";
    }
    return `Nearest Port Authority stop for ${top.site.address} is ${dist} feet.`;
  }

  if (/slope|steep|climate/.test(q)) {
    return "Slope and climate are not in this file, so they do not show on cards and I will not guess them.";
  }

  if (/compare/.test(q)) {
    return "Open Compare and pick two lots. It will tell you which one to walk for the type you are deciding.";
  }

  if (top) {
    return `I did not catch a lot name. Your first visit is ${top.site.address}. Ask for a walking order, Maps, or a PIN.`;
  }
  return "I only answer from these city lots and your walk list. Ask for a walking order, or name a neighborhood.";
}
