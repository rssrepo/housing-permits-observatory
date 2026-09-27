import { TYPOLOGIES } from "./scoring.js?v=cdc28";

const KEY = "hpo_session_v2";

export const DEMO = { email: "cdc@hillcdc.org", password: "pittsburgh", name: "Maya Chen", org: "Hill District CDC" };

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function signOut() {
  localStorage.removeItem(KEY);
}

export function defaultWeights() {
  return { feasibility: 20, demand_fit: 20, affordability_impact: 20, displacement_risk: 20, climate_proxy: 20 };
}

export function signIn({ email, password, name, org }) {
  const e = email.trim().toLowerCase();
  if (!e.includes("@") || password.length < 6) {
    throw new Error("Use a work email and a password of at least 6 characters.");
  }
  const existing = loadSession();
  const isDemo = e === DEMO.email;
  if (isDemo && password !== DEMO.password) {
    throw new Error("Demo password is pittsburgh");
  }
  const session = {
    email: e,
    name: name || existing?.name || (isDemo ? DEMO.name : e.split("@")[0]),
    org: org || existing?.org || (isDemo ? DEMO.org : "Your CDC"),
    role: existing?.role || (isDemo ? "cdc" : null),
    weights: { ...defaultWeights(), ...(existing?.weights || {}) },
    onboarded: existing?.onboarded || false,
    lastSiteId: existing?.lastSiteId || "centre-2523",
    missionSet: existing?.missionSet || false,
    missionPlaces: existing?.missionPlaces || [],
    missionAllCity: existing?.missionAllCity || false,
    missionType: existing?.missionType === "adu" ? "duplex" : existing?.missionType || "duplex",
    missionTypes: (() => {
      const t = (existing?.missionTypes ||
        (existing?.missionType === "any" ? ["duplex", "small_multifamily"] : [existing?.missionType || "duplex"])
      ).filter((x) => TYPOLOGIES.includes(x));
      return t.length ? t : ["duplex"];
    })(),
    missionForSale: existing?.missionForSale !== false,
    missionByRight: existing?.missionByRight !== false,
    lotVisits: existing?.lotVisits || [],
    extraWalks: existing?.extraWalks || [],
    visitsAsked: existing?.visitsAsked || false,
    askTypes: (() => {
      const t = (existing?.askTypes || existing?.missionTypes || ["duplex", "small_multifamily"]).filter(
        (x) => TYPOLOGIES.includes(x)
      );
      return t.length ? t : ["duplex"];
    })(),
    askByRight: existing?.askByRight || (existing?.missionByRight === false ? "skip" : "prefer"),
    askLand: existing?.askLand || [],
    askCluster: existing?.askCluster || 0,
    askWho: existing?.askWho || "skip",
    askPressure: existing?.askPressure || "flag",
    askFlood: existing?.askFlood || "warn",
    askSlope: existing?.askSlope || "warn",
    askBus: existing?.askBus ?? existing?.transitMaxFt ?? 0,
    askTrees: existing?.askTrees || 0,
    askHeat: existing?.askHeat || "warn",
    askLihtc: existing?.askLihtc || "skip",
    askAllCity: existing?.askAllCity ?? existing?.missionAllCity ?? false,
    askPlaces: existing?.askPlaces || existing?.missionPlaces || [],
    transitMaxFt: existing?.transitMaxFt || 0,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  saveSession(session);
  return session;
}
