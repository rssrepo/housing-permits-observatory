const UNKNOWN = "unknown";

const RES = new Set(["R1A", "R1D", "R1", "R2", "R3", "RM"]);
const SHOP = new Set(["LNC", "UNC", "HC", "DR"]);
const IND = new Set(["UI", "GI", "NDI"]);

function blank(v) {
  const text = String(v ?? "").trim();
  if (!text || ["na", "n/a", "nan", "none", "unknown", "no data"].includes(text.toLowerCase())) return true;
  return false;
}

export function districtBase(zoned) {
  const token = String(zoned || "")
    .trim()
    .toUpperCase();
  if (!token || token === "NAN") return "";
  return token.split("-")[0];
}

function rawAllow(site, key) {
  if (!site || blank(site[key])) return UNKNOWN;
  const token = String(site[key]).trim().toLowerCase().replace(/ /g, "_");
  if (token === "by_right" || token === "by-right") return "by_right";
  if (token === "not_allowed" || token === "not-allowed") return "not_allowed";
  if (token === "conditional") return "conditional";
  return UNKNOWN;
}

function fromSets(b, yes, no) {
  if (!b) return UNKNOWN;
  if (yes.has(b)) return "by_right";
  if (no.has(b)) return "not_allowed";
  return UNKNOWN;
}

export function useAllows(site, id) {
  if (id === "duplex") return rawAllow(site, "zoning_allows_duplex");
  if (id === "small_multifamily") return rawAllow(site, "zoning_allows_small_multifamily");
  const b = districtBase(site?.zoned_as);
  if (id === "single_family") {
    return fromSets(b, new Set(["R1A", "R1D", "R1", "R2"]), new Set(["R3", "RM", ...SHOP, ...IND, "RP"]));
  }
  if (id === "office") {
    return fromSets(b, new Set([...SHOP, "NDI"]), new Set([...RES, "UI", "GI", "RP"]));
  }
  if (id === "commercial") {
    return fromSets(b, SHOP, new Set([...RES, ...IND, "RP"]));
  }
  if (id === "industrial") {
    return fromSets(b, IND, new Set([...RES, ...SHOP, "RP"]));
  }
  if (id === "affordable") {
    const house = ["single_family", "duplex", "small_multifamily"].some((u) => useAllows(site, u) === "by_right");
    const inc = Number(site?.income_vs_city_pct);
    if (!house) {
      const anyHouseUnk = ["single_family", "duplex", "small_multifamily"].some((u) => useAllows(site, u) === UNKNOWN);
      return anyHouseUnk && !b ? UNKNOWN : "not_allowed";
    }
    if (!Number.isFinite(inc)) return UNKNOWN;
    return inc < 100 ? "by_right" : "not_allowed";
  }
  return UNKNOWN;
}

export function usePlain(status) {
  if (status === "by_right") return "already allowed";
  if (status === "not_allowed") return "not this district";
  if (status === "conditional") return "needs a hearing";
  return "unknown";
}
