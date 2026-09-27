import { TYPOLOGY_LABELS, displacementGapUsd, isUnknown, predictedRentUsd, PGH_MEDIAN_GROSS_RENT, readField } from "./scoring.js?v=cdc13";
import {
  currentWalks,
  deckPairings,
  mapsUrl,
  walkLine,
  featuredPairing,
} from "./match.js?v=cdc13";

let pendingPlan = null;

export const ASK_PROMPTS = [
  "Where should I walk first?",
  "Plan a walking order",
  "Open Maps for this lot",
  "What is the PIN?",
  "Is this Land Bank land?",
  "What is typical rent nearby?",
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function card({ kicker, title, items, links, note }) {
  const list = items?.length
    ? `<ol class="ask-ol">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`
    : "";
  const hrefs = links?.length
    ? `<p class="ask-links">${links
        .map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.lab)}</a>`)
        .join("")}</p>`
    : "";
  return `<div class="ask-card">
    ${kicker ? `<p class="eyebrow">${esc(kicker)}</p>` : ""}
    ${title ? `<p class="ask-title">${esc(title)}</p>` : ""}
    ${list}
    ${hrefs}
    ${note ? `<p class="ask-note">${esc(note)}</p>` : ""}
  </div>`;
}

function visitsOnList(sites, session, filters) {
  const { pairings } = deckPairings(sites, session, filters);
  const rankedWalk = filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings;
  return currentWalks(sites, session, rankedWalk);
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
  const maps = dirUrl(order);
  return card({
    kicker: "One day",
    title: `Walk these ${order.length} visits in this order.`,
    items: order.map((p, i) => esc(lineFor(p, i + 1).replace(/^\d+\.\s*/, ""))),
    links: maps ? [{ href: maps, lab: "Open route in Maps" }] : [],
  });
}

function twoDayText(order) {
  const [d1, d2] = splitDays(order);
  const m1 = dirUrl(d1);
  const m2 = dirUrl(d2);
  const links = [];
  if (m1) links.push({ href: m1, lab: "Day 1 in Maps" });
  if (m2) links.push({ href: m2, lab: "Day 2 in Maps" });
  return card({
    kicker: "Two days",
    title: "Split the list at the longest gap between stops.",
    items: [
      `<strong>Day 1.</strong> ${d1.length ? d1.map((p) => esc(p.site.address)).join(" → ") : "Nothing yet."}`,
      `<strong>Day 2.</strong> ${d2.length ? d2.map((p) => esc(p.site.address)).join(" → ") : "Nothing yet."}`,
    ],
    links,
  });
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
  if (/\badu\b|accessory/.test(q)) return "dropped_adu";
  if (/apartment|multifamily|small apartment/.test(q)) return "small_multifamily";
  if (/duplex|two-family|two family/.test(q)) return "duplex";
  return null;
}

function isRouteAsk(q) {
  return /route|itinerar|optim|order to walk|walking order|which order|sequence|path|loop|tour|plan my walk|plan the walk|plan a walking|one day|two day|2 day|1 day|same day/.test(
    q
  );
}

export function answerQuery(raw, { sites, session, filters }) {
  const q = raw.trim().toLowerCase();
  if (!q) {
    return card({ title: "Pick a prompt below.", note: "I only answer from your visits list and these city lots." });
  }

  if (!session.missionSet) {
    return card({
      title: "Set this month's cut first.",
      note: "Finish onboarding or Change this month's cut. Then I can name lots.",
    });
  }

  const visits = visitsOnList(sites, session, filters);
  const top = visits[0] || featuredPairing(visits, session.lastPairing);
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
    if (!visits.length) {
      return card({ title: "Your visits list is empty.", note: "Add lots on Visits or Find a lot, then ask for a route." });
    }
    const order = orderStops(visits);
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
    return card({
      kicker: "Walking order",
      title: `I can order your ${order.length} visits so nearby ones sit in a row.`,
      note: "Reply with one day or two days.",
    });
  }

  if (/land bank|plb|ura transfer|pathway|cluster|assembl|greenway|master plan|public land/.test(q) && !isRouteAsk(q)) {
    const s = site || top?.site;
    if (!s) {
      return card({ title: "No lot is in focus.", note: "Set this month's cut, then ask about Land Bank, clusters, or by-right." });
    }
    const pin = readField(s, "pin");
    return card({
      kicker: s.inventory_type || "Public land",
      title: s.address,
      items: [
        esc(`${s.current_status || "Status missing"}. City vacant land, not a private tax sale.`),
        isUnknown(pin) ? "No PIN in this file." : `PIN ${esc(pin)}`,
      ],
      links: [{ href: mapsUrl(s), lab: "Open in Maps" }],
      note: "Open CDC screen on the lot for pathway, 220-foot clusters, and by-right. VPRP is not in this dump.",
    });
  }

  if (/help|what can|what do you/.test(q)) {
    return card({
      title: "I can do these six things.",
      items: ASK_PROMPTS.map((t) => esc(t)),
      note: "Tap a chip under the box. I do not invent ACS, carbon, or a named tenant.",
    });
  }

  if (/first|top|should i walk|where should|this week|recommend|best/.test(q) && !place && !site) {
    if (!top) {
      return card({ title: "Nothing to walk under this month's cut.", note: "Change neighborhoods or type." });
    }
    return card({
      kicker: "First visit",
      title: walkLine(top.site, top.typology, top.verdict),
      items: [esc(top.site.neighborhood_name || "Pittsburgh")],
      links: [{ href: mapsUrl(top.site), lab: "Open in Maps" }],
      note: "Ask for a walking order if you want 1 then 2 then 3.",
    });
  }

  if (/list|five|my visits|walk list/.test(q)) {
    if (!visits.length) {
      return card({ title: "Your visits list is empty under this month's answers." });
    }
    return card({
      kicker: "Your visits",
      title: `${visits.length} lots in walk order.`,
      items: visits.slice(0, 12).map((p) => esc(walkLine(p.site, p.typology, p.verdict))),
    });
  }

  if ((/map|maps|google|directions|how do i get/.test(q) && (site || top)) || (/map/.test(q) && !site && top)) {
    const s = site || top.site;
    return card({
      kicker: "Maps",
      title: s.address,
      links: [{ href: mapsUrl(s), lab: "Open in Maps" }],
    });
  }

  if (/pin|parcel/.test(q)) {
    const s = site || top?.site;
    if (!s) return card({ title: "No lot is in focus yet." });
    const pin = readField(s, "pin");
    if (isUnknown(pin)) {
      return card({ title: s.address, note: "No PIN in this file, so I am not showing one." });
    }
    return card({
      kicker: "PIN",
      title: s.address,
      items: [esc(pin)],
      note: "Copy it into the City sale record.",
    });
  }

  if (place) {
    const local = sites.filter((s) => s.neighborhood_name === place);
    const inCut = visits.filter((p) => p.site.neighborhood_name === place);
    if (inCut.length) {
      return card({
        kicker: place,
        title: `Walk ${inCut[0].site.address} for a ${TYPOLOGY_LABELS[inCut[0].typology].toLowerCase()}.`,
        items: [`${inCut.length} of your visits are in ${esc(place)}.`],
        links: [{ href: mapsUrl(inCut[0].site), lab: "Open in Maps" }],
      });
    }
    return card({
      kicker: place,
      title: `${local.length} city vacant lots in the file.`,
      note: "None are on your visits list under this cut.",
    });
  }

  if (type === "dropped_adu") {
    return card({
      title: "Accessory dwelling is not a type here.",
      note: "Pittsburgh does not allow it citywide on these lots. The studio only matches two-family houses and small apartment buildings.",
    });
  }

  if (type) {
    const hits = visits.filter((p) => p.typology === type);
    if (hits.length) {
      return card({
        kicker: TYPOLOGY_LABELS[type],
        title: `Start at ${hits[0].site.address}.`,
        links: [{ href: mapsUrl(hits[0].site), lab: "Open in Maps" }],
      });
    }
    if (!(session.missionTypes || []).includes(type) && session.missionType !== "any" && session.missionType !== type) {
      return card({
        title: `You did not pick ${TYPOLOGY_LABELS[type].toLowerCase()} for this month.`,
        note: "Add it under what you want to put on the ground.",
      });
    }
    return card({
      title: `No ${TYPOLOGY_LABELS[type].toLowerCase()} visit made the list.`,
      note: "Zoning is blocking it in this cut, or nothing is for sale.",
    });
  }

  if (site) {
    const pairing = visits.find((p) => p.site.site_id === site.site_id);
    const line = pairing
      ? walkLine(site, pairing.typology, pairing.verdict)
      : `${site.address} is in ${site.neighborhood_name || "Pittsburgh"}. It is not on your visits list.`;
    const sq = Number(readField(site, "parc_sq_ft"));
    return card({
      kicker: site.neighborhood_name || "Lot",
      title: line,
      items: Number.isFinite(sq) ? [`${sq.toLocaleString()} sq ft`] : [],
      links: [{ href: mapsUrl(site), lab: "Open in Maps" }],
    });
  }

  if (/opportunit|scorecard|enterprise|360/.test(q)) {
    return card({
      title: "Open the visit dossier (CDC screen).",
      note: "Tags, strengths vs watch-outs, then the five CDC filters. Ranking is in MATCHING.md.",
    });
  }

  if (/displace|overpay|evict/.test(q)) {
    const gap = top ? displacementGapUsd(top.site) : "unknown";
    if (top && !isUnknown(gap) && gap > 0) {
      return card({
        kicker: "Displacement pressure",
        title: top.site.address,
        items: [
          esc(`Neighbors typically pay about $${gap.toLocaleString()} more a month than typical income can carry.`),
        ],
        note: "Neighborhood pressure, not an eviction count. Walk only if the housing type stays affordable.",
      });
    }
    return card({
      title: "Displacement pressure is Census rent vs typical income.",
      note: "Where ACS is missing, I hide it rather than guess.",
    });
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
      const items = [
        esc(`Typical rent nearby is about $${paid.toLocaleString()} a month.`),
        esc(vs),
      ];
      if (!isUnknown(pred)) items.push(esc(`Typical income can carry about $${pred.toLocaleString()} at 30%.`));
      return card({
        kicker: "Rent nearby",
        title: top.site.address,
        items,
        note: "Tract typical, not a listing for this vacant lot.",
      });
    }
    return card({
      title: "No ACS rent on this tract.",
      note: "I hide typical rent, carry, renter share, and burden rather than guessing.",
    });
  }

  if (/bus|transit|stop/.test(q)) {
    const dist = top ? readField(top.site, "transit_distance_ft") : "unknown";
    if (!top || isUnknown(dist)) {
      return card({ title: "No bus distance on this lot.", note: "I hide it rather than guess." });
    }
    return card({
      kicker: "Bus",
      title: top.site.address,
      items: [esc(`${dist} feet to the nearest Port Authority stop.`)],
      note: "Transit access, not a carbon score.",
    });
  }

  if (/slope|steep/.test(q)) {
    const steep = top ? String(top.site.steep_slope || "").toLowerCase() : "";
    if (steep === "yes") {
      return card({
        title: top.site.address,
        note: "This point sits in the city's 25% or greater slope polygons.",
      });
    }
    if (steep === "no") {
      return card({ title: top?.site.address || "This lot", note: "Not inside those slope polygons in this file." });
    }
    return card({ title: "Slope was not joined on this lot.", note: "I will not guess it." });
  }

  if (/climate|carbon|flood|tree/.test(q)) {
    return card({
      title: "Climate on the pairing is flood, street trees, and bus distance.",
      note: "Building operational carbon is not measured. Open the visit dossier for those tags.",
    });
  }

  if (/compare/.test(q)) {
    return card({ title: "Open Compare and pick two lots.", note: "It names which one to walk for the type you are deciding." });
  }

  if (top) {
    return card({
      title: "I did not catch a lot name.",
      items: [esc(`Your first visit is ${top.site.address}.`)],
      note: "Use a chip: walking order, Maps, or PIN.",
    });
  }
  return card({
    title: "I only answer from these city lots and your visits.",
    note: "Tap a chip below.",
  });
}
