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
  return { feasibility: 25, demand_fit: 25, affordability_impact: 25, climate_proxy: 25 };
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
    missionType: existing?.missionType || "duplex",
    missionTypes: existing?.missionTypes || (existing?.missionType === "any" ? ["adu", "duplex", "small_multifamily"] : [existing?.missionType || "duplex"]),
    missionForSale: existing?.missionForSale !== false,
    missionByRight: existing?.missionByRight !== false,
    lotVisits: existing?.lotVisits || [],
    extraWalks: existing?.extraWalks || [],
    visitsAsked: existing?.visitsAsked || false,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  saveSession(session);
  return session;
}
