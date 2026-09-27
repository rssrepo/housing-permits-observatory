import { districtBase, useAllows, usePlain } from "./zone.js?v=cdc28";

export { districtBase, useAllows, usePlain };

export const USES = [
  { id: "affordable", lab: "Affordable housing" },
  { id: "single_family", lab: "Single-family housing" },
  { id: "duplex", lab: "Two-family house" },
  { id: "small_multifamily", lab: "Small apartment" },
  { id: "office", lab: "Offices" },
  { id: "commercial", lab: "Commercial" },
  { id: "industrial", lab: "Industrial" },
];

export const USE_LABELS = Object.fromEntries(USES.map((u) => [u.id, u.lab]));

export function primaryUse(site) {
  const order = ["industrial", "commercial", "office", "small_multifamily", "duplex", "single_family"];
  for (const id of order) {
    if (useAllows(site, id) === "by_right") return id;
  }
  if (!districtBase(site.zoned_as)) return "unk";
  return "none";
}

export function useCounts(sites) {
  const out = {};
  for (const u of USES) {
    out[u.id] = { yes: 0, no: 0, unk: 0 };
    for (const s of sites || []) {
      const st = useAllows(s, u.id);
      if (st === "by_right") out[u.id].yes += 1;
      else if (st === "unknown") out[u.id].unk += 1;
      else out[u.id].no += 1;
    }
  }
  return out;
}

export function useChipsHtml(site) {
  return `<p class="eyebrow" style="margin-top:1.2rem">What this district can take</p>
    <p class="muted">Ch. 911 primary-use reading from the listed district, not a zoning certificate. Affordable housing is not a district. It is a home that is already allowed in a tract below Pittsburgh typical income.</p>
    <div class="use-chips">${USES.map((u) => {
      const st = useAllows(site, u.id);
      const cls = st === "by_right" ? "tag-go" : st === "not_allowed" ? "tag-bad" : "tag-info";
      const lab = u.id === "affordable" && st === "by_right" ? "in play" : usePlain(st);
      return `<span class="tag ${cls}">${u.lab}: ${lab}</span>`;
    }).join("")}</div>`;
}
