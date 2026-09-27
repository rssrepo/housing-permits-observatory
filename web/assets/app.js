import { loadSession, saveSession, signIn, signOut, DEMO } from "./auth.js";
import { answerQuery } from "./ask.js";
import {
  FACTORS,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  isUnknown,
  ranked,
  readField,
  scoreSite,
  normalizeWeights,
} from "./scoring.js";
import {
  VERDICT_LABEL,
  buildPairing,
  compareInsight,
  deckPairings,
  districtPlain,
  featuredPairing,
  filterSites,
  factsStrip,
  mapsUrl,
  pointsHtml,
  verdictFor,
  typicalRentLine,
  walkActionsHtml,
  walkLine,
} from "./match.js";

const root = document.getElementById("app");
let SITES = [];

const ROLE_LABELS = {
  cdc: "CDC / nonprofit staff",
  planner: "City or county planning",
  advocate: "Community advocate",
  journalist: "Reporter or researcher",
  other: "Others",
};

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  return { path: "/" + parts.join("/"), parts };
}

function go(path) {
  const next = "#" + (path.startsWith("/") ? path : "/" + path);
  if (location.hash === next || location.hash === path) {
    render();
    return;
  }
  location.hash = next;
}

function sessionGuard(needOnboarded) {
  const s = loadSession();
  if (!s) {
    go("/login");
    return null;
  }
  if (needOnboarded && !s.onboarded) {
    go("/onboarding");
    return null;
  }
  return s;
}

function layoutPublic(inner) {
  return `
    <header class="nav">
      <a class="brand" href="#/"><span class="mark"></span> Parcel Fit</a>
      <nav class="nav-links">
        <a href="#/login">Sign in</a>
      </nav>
      <a class="pill" href="#/login">Open the studio</a>
    </header>
    <main class="wrap">${inner}</main>
  `;
}

function layoutApp(session, inner, current) {
  const links = [
    ["/match", "Visits"],
    ["/pipeline", "Find a lot"],
    ["/compare", "Compare"],
    ["/briefing", "Briefing room"],
    ["/account", "Account"],
  ];
  return `
    <header class="nav">
      <a class="brand" href="#/match"><span class="mark"></span> Parcel Fit</a>
      <span class="small">${session.org} · ${session.name}</span>
      <button class="pill ghost" id="out">Sign out</button>
    </header>
    <div class="wrap app-shell">
      <aside class="side">
        ${links.map(([href, label]) => `<a class="${current === href ? "on" : ""}" href="#${href}">${label}</a>`).join("")}
      </aside>
      <section>${inner}</section>
    </div>
    <button class="ask-fab" id="ask-toggle" type="button" aria-label="Ask">?</button>
    <aside class="ask-panel" id="ask-panel" hidden>
      <div class="ask-head">
        <strong>Ask about this week's visits</strong>
        <button class="pill ghost" id="ask-close" type="button">Close</button>
      </div>
      <div class="ask-log" id="ask-log"></div>
      <form class="ask-form" id="ask-form">
        <input id="ask-q" autocomplete="off" placeholder="Where should I walk first?" />
        <button class="pill" type="submit">Send</button>
      </form>
    </aside>
  `;
}

function bindCopyPins() {
  document.querySelectorAll(".copy-pin").forEach((btn) => {
    btn.onclick = async () => {
      const pin = btn.dataset.pin;
      try {
        await navigator.clipboard.writeText(pin);
        btn.textContent = "PIN copied";
      } catch {
        btn.textContent = pin;
      }
    };
  });
}

const ASK_LOG = [];

function renderAskLog() {
  const log = document.getElementById("ask-log");
  if (!log) return;
  log.innerHTML = ASK_LOG.map(
    (m) => `<p class="ask-msg ${m.who}"><span>${m.text}</span></p>`
  ).join("");
  log.scrollTop = log.scrollHeight;
}

function bindAsk() {
  const panel = document.getElementById("ask-panel");
  const toggle = document.getElementById("ask-toggle");
  const close = document.getElementById("ask-close");
  const form = document.getElementById("ask-form");
  if (!panel || !toggle || !form) return;
  if (!ASK_LOG.length) {
    ASK_LOG.push({
      who: "bot",
      text: "Ask for a walking order, Maps, a PIN, or a neighborhood. I only use this week's lots.",
    });
  }
  renderAskLog();
  const open = () => {
    panel.hidden = false;
    document.getElementById("ask-q")?.focus();
  };
  toggle.onclick = open;
  close.onclick = () => {
    panel.hidden = true;
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("ask-q");
    const q = (input.value || "").trim();
    if (!q) return;
    input.value = "";
    ASK_LOG.push({ who: "you", text: q });
    const session = loadSession();
    const reply = answerQuery(q, { sites: SITES, session, filters: readFilters() });
    ASK_LOG.push({ who: "bot", text: reply });
    renderAskLog();
  };
}

function bindSignOut() {
  const out = document.getElementById("out");
  if (out) {
    out.onclick = () => {
      signOut();
      go("/");
    };
  }
  bindAsk();
}

const LOT_ASK = [
  {
    key: "feasibility",
    q: "Do you need the housing type to already be allowed on the lot?",
    options: [
      { w: 0, lab: "Doesn't matter" },
      { w: 50, lab: "Prefer already allowed" },
      { w: 100, lab: "Must already be allowed" },
    ],
  },
  {
    key: "demand_fit",
    q: "Do you want lots on blocks where people already rent?",
    options: [
      { w: 0, lab: "Doesn't matter" },
      { w: 50, lab: "Prefer those blocks" },
      { w: 100, lab: "Look for renter neighborhoods" },
    ],
  },
  {
    key: "affordability_impact",
    q: "Are you targeting places where rent is already hard to pay?",
    options: [
      { w: 0, lab: "Doesn't matter" },
      { w: 50, lab: "Prefer high need" },
      { w: 100, lab: "Look for high need" },
    ],
  },
  {
    key: "climate_proxy",
    q: "How close to a bus stop should the lot be?",
    options: [
      { w: 0, lab: "Doesn't matter", ft: 0 },
      { w: 40, lab: "Within a half mile", ft: 2640 },
      { w: 70, lab: "Within a quarter mile", ft: 1320 },
      { w: 100, lab: "Within a 5-minute walk", ft: 400 },
    ],
  },
];

function nearestChoice(options, n) {
  const x = Number(n);
  const v = Number.isFinite(x) ? x : 0;
  return options.reduce((best, o) => (Math.abs(o.w - v) < Math.abs(best.w - v) ? o : best));
}

const FACTOR_FOCUS = {
  feasibility: "allowed type and lot size",
  demand_fit: "renter share",
  affordability_impact: "rent burden",
  climate_proxy: "walking distance to a bus stop",
};

function mixPointer(weights) {
  const w = weights || {};
  const vals = FACTORS.map((k) => w[k] || 0);
  if (vals.every((v) => v === vals[0])) {
    if (vals[0] <= 0) return "Ok. Everything is off, so nothing is pulling the list.";
    return "Ok. These are even. Nothing is the main focus yet.";
  }
  const n = normalizeWeights(weights);
  const top = FACTORS.slice().sort((a, b) => n[b] - n[a])[0];
  const share = Math.round(n[top] * 100);
  if (share >= 50) return `Ok. This represents a high focus on ${FACTOR_FOCUS[top]}.`;
  return `Ok. Slightly more focus on ${FACTOR_FOCUS[top]} than the rest.`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function enterDemo() {
  signOut();
  const s = signIn({
    email: DEMO.email,
    password: DEMO.password,
    name: DEMO.name,
    org: DEMO.org,
  });
  go(s.onboarded ? "/match" : "/onboarding");
}

function viewLanding() {
  root.innerHTML = layoutPublic(`
    <section class="hero">
      <span class="eyebrow">For community development staff</span>
      <h1>Which city lot do you walk this month, and what do you try to build there?</h1>
      <p class="lede">Tell Parcel Fit where you work and what you want to build. It returns city-owned lots worth walking this month, with a housing type attached to each one.</p>
      <div class="cta-row">
        <a class="pill" href="#/demo">Start as Hill District demo</a>
        <a class="pill ghost" href="#/login">Create a workspace</a>
      </div>
    </section>
    <div class="bento">
      <article class="card">
        <p class="eyebrow">Inside the studio</p>
        <h3>A pairing desk, not a parcel search.</h3>
        <p class="muted">Each result is a housing type on a city lot. Match is the walk list. Compare is how you pick between two visits.</p>
      </article>
      <article class="card">
        <p class="eyebrow">This month</p>
        <h3>Five visits, not three thousand rows.</h3>
        <p class="muted">Filter to the neighborhoods you actually staff. Rank by the type you can build. Walk the top pairings.</p>
      </article>
    </div>
    <section class="section">
      <h2>How a new staffer is onboarded</h2>
      <div class="grid3">
        <article class="card"><h3>1. Identity</h3><p class="muted">Name, CDC, and whether you are staff, planning, or advocacy.</p></article>
        <article class="card"><h3>2. This month's lots</h3><p class="muted">What you want to walk toward: already allowed, renter blocks, high rent need, or a short walk to the bus.</p></article>
        <article class="card"><h3>3. First parcel</h3><p class="muted">You leave onboarding on a real Hill District lot, not an empty dashboard.</p></article>
      </div>
    </section>
    <p class="footer">City-owned lot list · Pittsburgh zoning code · Census neighborhood numbers · Port Authority bus stops</p>
  `);
}

function viewLogin() {
  root.innerHTML = layoutPublic(`
    <div class="auth-box card">
      <p class="eyebrow">Workspace</p>
      <h2 class="serif">Sign in to Parcel Fit</h2>
      <p class="muted">Demo: ${DEMO.email} / ${DEMO.password}</p>
      <form id="login">
        <label>Work email</label>
        <input name="email" type="email" value="${DEMO.email}" required />
        <label>Password</label>
        <input name="password" type="password" value="${DEMO.password}" required minlength="6" />
        <label>Your name</label>
        <input name="name" value="${DEMO.name}" />
        <label>Organization</label>
        <input name="org" value="${DEMO.org}" />
        <p class="err" id="err"></p>
        <div class="cta-row"><button class="pill" type="submit">Continue</button></div>
      </form>
    </div>
  `);
  document.getElementById("login").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const s = signIn({
        email: String(fd.get("email") || ""),
        password: String(fd.get("password") || ""),
        name: String(fd.get("name") || ""),
        org: String(fd.get("org") || ""),
      });
      go(s.onboarded ? "/match" : "/onboarding");
      render();
    } catch (err) {
      document.getElementById("err").textContent = err.message;
    }
  };
}

function viewOnboarding() {
  const s = sessionGuard(false);
  if (!s) return;
  let step = Number(new URLSearchParams(location.hash.split("?")[1] || "").get("step") || 1);
  if (step > 2) step = 2;
  if (step < 1) step = 1;
  const body = {
    1: `
      <h2 class="serif">Who is using this desk?</h2>
      <p class="muted">This is only so the home screen talks to you the right way.</p>
      ${Object.keys(ROLE_LABELS)
        .map((role) => `<button class="choice ${s.role === role ? "on" : ""}" data-role="${role}">${ROLE_LABELS[role]}</button>`)
        .join("")}
    `,
    2: `
      <h2 class="serif">What kind of lots are you looking for this month?</h2>
      <p class="muted">Tap what you actually want to walk toward. Skip anything that is not a filter for you.</p>
      ${LOT_ASK.map((item) => {
        const on = nearestChoice(item.options, s.weights[item.key]);
        return `<div class="weight-block">
            <label>${item.q}</label>
            <div class="chip-row">
              ${item.options
                .map(
                  (o) =>
                    `<button type="button" class="choice chip ${o.w === on.w ? "on" : ""}" data-wk="${item.key}" data-w="${o.w}" ${
                      o.ft != null ? `data-ft="${o.ft}"` : ""
                    }>${o.lab}</button>`
                )
                .join("")}
            </div>
          </div>`;
      }).join("")}
      <p class="weight-mix" id="mix">${mixPointer(s.weights)}</p>
    `,
  }[step];

  root.innerHTML = layoutPublic(`
    <div class="auth-box" style="max-width:560px">
      <div class="steps">${[1, 2].map((n) => `<div class="step-dot ${n <= step ? "on" : ""}"></div>`).join("")}</div>
      ${body}
      <div class="cta-row" style="margin-top:1.2rem">
        ${step > 1 ? `<button class="pill ghost" id="back">Back</button>` : ""}
        <button class="pill" id="next">${step === 2 ? "Set this month's neighborhoods" : "Continue"}</button>
      </div>
    </div>
  `);

  document.querySelectorAll("[data-role]").forEach((btn) => {
    btn.onclick = () => {
      s.role = btn.dataset.role;
      saveSession(s);
      render();
    };
  });
  document.querySelectorAll("[data-wk]").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.wk;
      s.weights[k] = Number(btn.dataset.w);
      if (k === "climate_proxy") s.transitMaxFt = Number(btn.dataset.ft || 0);
      saveSession(s);
      document.querySelectorAll(`[data-wk="${k}"]`).forEach((b) => b.classList.toggle("on", b === btn));
      const mix = document.getElementById("mix");
      if (mix) mix.textContent = mixPointer(s.weights);
    };
  });
  const back = document.getElementById("back");
  if (back) back.onclick = () => go(`/onboarding?step=${step - 1}`);
  document.getElementById("next").onclick = () => {
    if (step === 1) {
      if (!s.role) s.role = "cdc";
      saveSession(s);
      go("/onboarding?step=2");
      return;
    }
    s.onboarded = true;
    s.replayPriorities = false;
    s.missionSet = false;
    s.lastSiteId = "centre-2523";
    saveSession(s);
    go("/match");
  };
}

function siteById(id) {
  return SITES.find((s) => s.site_id === id) || null;
}

function lotOptionLabel(s) {
  const pin = String(s.pin || "").trim();
  const tail = pin ? `PIN ${pin}` : "";
  return [s.address, s.neighborhood_name, tail].filter(Boolean).join(" · ");
}

function viewHome(session) {
  return viewMatch(session);
}

const VISIT_OK = "hpo_visit_ok";

function visitConfirmed() {
  return sessionStorage.getItem(VISIT_OK) === "1";
}

function markVisitOk() {
  sessionStorage.setItem(VISIT_OK, "1");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function missionTypesOf(s) {
  if (s.missionTypes?.length) return s.missionTypes.filter((t) => TYPOLOGIES.includes(t));
  if (s.missionType === "any") return [...TYPOLOGIES];
  if (s.missionType && TYPOLOGIES.includes(s.missionType)) return [s.missionType];
  return ["duplex"];
}

function typeListLabel(types) {
  return types.map((t) => TYPOLOGY_LABELS[t]).join(", ");
}

function readFilters() {
  const s = loadSession() || {};
  const typologies = missionTypesOf(s);
  return {
    neighborhoods: s.missionPlaces || [],
    neighborhood: s.filterNeighborhood || "all",
    status: s.missionForSale === false ? s.filterStatus || "all" : "Available for Sale",
    typologies,
    typology: s.filterTypology || (typologies.length === 1 ? typologies[0] : "any"),
    genesis: "all",
    q: s.filterQ || "",
    byRight: s.missionByRight !== false,
  };
}

function saveFilters(partial) {
  const s = loadSession();
  if (!s) return;
  Object.assign(s, partial);
  saveSession(s);
}

function viewMission(session) {
  const places = uniqueSorted(SITES.map((s) => s.neighborhood_name));
  const suggested = ["Middle Hill", "Crawford-Roberts", "Bedford Dwellings", "Terrace Village"].filter((n) =>
    places.includes(n)
  );
  const picked = new Set(
    session.missionPlaces?.length ? session.missionPlaces : suggested.slice(0, 2)
  );
  const pickedTypes = new Set(missionTypesOf(session));
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">This month</p>
    <h2 class="serif">What are you staffing this month?</h2>
    <p class="muted">Answer these and you get five pairings to walk. The city file stays in the background until you say where and what.</p>
    <article class="card">
      <h3>Where are you walking?</h3>
      <p class="muted">Pick the neighborhoods your CDC will actually visit.</p>
      <div id="places" class="chip-row">
        ${suggested
          .concat(places.filter((p) => !suggested.includes(p)))
          .slice(0, 12)
          .map((n) => `<button type="button" class="choice chip ${picked.has(n) ? "on" : ""}" data-place="${n}">${n}</button>`)
          .join("")}
      </div>
      <label>More neighborhoods</label>
      <select id="more">
        <option value="">Add another</option>
        ${places.map((n) => `<option value="${n}">${n}</option>`).join("")}
      </select>
    </article>
    <article class="card" style="margin-top:1rem">
      <h3>What do you want to put on the ground?</h3>
      <p class="muted">Select every type you would actually try. A pairing is one type on one lot.</p>
      ${[
        ["duplex", "Two-family house", "A house split into two homes."],
        ["small_multifamily", "Small apartment building", "About three to six homes on one city lot."],
        ["adu", "Accessory dwelling", "A small second home on the lot. Pittsburgh does not allow this citywide yet."],
      ]
        .map(
          ([v, lab, sub]) =>
            `<button type="button" class="choice ${pickedTypes.has(v) ? "on" : ""}" data-type="${v}"><strong>${lab}</strong><span class="muted"> ${sub}</span></button>`
        )
        .join("")}
    </article>
    <article class="card" style="margin-top:1rem">
      <label class="choice"><input type="checkbox" id="sale" ${session.missionForSale === false ? "" : "checked"} /> Only lots listed as available for sale</label>
      <label class="choice"><input type="checkbox" id="right" ${session.missionByRight === false ? "" : "checked"} /> Only types allowed without a special zoning hearing</label>
    </article>
    <p id="merr" class="err"></p>
    <div class="cta-row"><button class="pill" id="run" type="button">Build this month's walk list</button></div>
  `,
    "/match"
  );
  bindSignOut();
  const selected = new Set(picked);
  const baseList = suggested.concat(places.filter((p) => !suggested.includes(p))).slice(0, 12);

  const fillMore = () => {
    const more = document.getElementById("more");
    more.innerHTML =
      `<option value="">Add another</option>` +
      places
        .filter((n) => !selected.has(n))
        .map((n) => `<option value="${n}">${n}</option>`)
        .join("");
  };

  const paint = () => {
    const extra = [...selected].filter((n) => !baseList.includes(n));
    const row = document.getElementById("places");
    row.innerHTML = baseList
      .concat(extra)
      .map((n) => `<button type="button" class="choice chip ${selected.has(n) ? "on" : ""}" data-place="${n}">${n}</button>`)
      .join("");
    row.querySelectorAll("[data-place]").forEach((btn) => {
      btn.onclick = () => {
        if (selected.has(btn.dataset.place)) selected.delete(btn.dataset.place);
        else selected.add(btn.dataset.place);
        paint();
      };
    });
    fillMore();
  };

  paint();
  document.getElementById("more").onchange = (e) => {
    const name = e.target.value;
    if (!name) return;
    selected.add(name);
    paint();
  };
  document.querySelectorAll("[data-type]").forEach((btn) => {
    btn.onclick = () => {
      const v = btn.dataset.type;
      if (pickedTypes.has(v)) pickedTypes.delete(v);
      else pickedTypes.add(v);
      document.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("on", pickedTypes.has(b.dataset.type)));
    };
  });
  document.getElementById("run").onclick = () => {
    const placesNow = [...selected];
    if (!placesNow.length) {
      document.getElementById("merr").textContent = "Pick at least one neighborhood.";
      return;
    }
    const typesNow = [...pickedTypes];
    if (!typesNow.length) {
      document.getElementById("merr").textContent = "Pick at least one housing type.";
      return;
    }
    const typeNow = typesNow.length === 1 ? typesNow[0] : "any";
    session.missionSet = true;
    session.missionPlaces = placesNow;
    session.missionTypes = typesNow;
    session.missionType = typeNow;
    session.missionForSale = document.getElementById("sale").checked;
    session.missionByRight = document.getElementById("right").checked;
    session.visitsAsked = false;
    saveSession(session);
    markVisitOk();
    go("/match");
    render();
  };
}

function viewReturning(session) {
  const places = (session.missionPlaces || []).join(", ") || "your last neighborhoods";
  const types = missionTypesOf(session);
  const type = typeListLabel(types);
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Welcome back</p>
    <h2 class="serif">Are your priorities different from last visit?</h2>
    <p class="muted">Last time you staffed ${places} for ${type}.</p>
    <div class="cta-row">
      <button class="pill" id="same" type="button">No, same as last time</button>
      <button class="pill ghost" id="diff" type="button">Yes, redo priorities</button>
    </div>
  `,
    "/match"
  );
  bindSignOut();
  document.getElementById("same").onclick = () => {
    markVisitOk();
    render();
  };
  document.getElementById("diff").onclick = () => {
    session.replayPriorities = true;
    session.missionSet = false;
    session.visitsAsked = false;
    saveSession(session);
    go("/onboarding?step=2");
  };
}

function leadTypeFor(site, session) {
  const types = missionTypesOf(session);
  const hits = types
    .map((t) => buildPairing(site, t, session))
    .sort((a, b) => {
      const order = { go: 0, caution: 1, "no-go": 2 };
      const d = (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3);
      if (d) return d;
      const as = isUnknown(a.score) ? -1 : Number(a.score);
      const bs = isUnknown(b.score) ? -1 : Number(b.score);
      return bs - as;
    });
  return hits[0]?.typology || types[0] || "duplex";
}

function applyVisitMemory(pairings, session) {
  const visits = session.lotVisits || [];
  const skip = new Set(visits.filter((v) => !v.prefer).map((v) => v.siteId));
  const prefer = new Set(visits.filter((v) => v.prefer && v.typology).map((v) => v.typology));
  const rows = pairings.filter((p) => !skip.has(p.site.site_id));
  const order = { go: 0, caution: 1, "no-go": 2 };
  return rows.slice().sort((a, b) => {
    const d = (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3);
    if (d) return d;
    if (prefer.size) {
      const ap = prefer.has(a.typology) ? 0 : 1;
      const bp = prefer.has(b.typology) ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    const as = isUnknown(a.score) ? -1 : Number(a.score);
    const bs = isUnknown(b.score) ? -1 : Number(b.score);
    return bs - as;
  });
}

function viewVisited(session) {
  const filters = readFilters();
  const pool = filterSites(SITES, filters);
  const picked = new Map((session.lotVisits || []).map((v) => [v.siteId, { ...v }]));
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Before you walk</p>
    <h2 class="serif">Have you visited any of these places before?</h2>
    <p class="muted">Mark lots you already walked in ${(session.missionPlaces || []).join(", ") || "your neighborhoods"}. Add a note. Say if you prefer that kind of property so the next five can follow it.</p>
    <div class="cta-row">
      <button class="pill" id="none" type="button">No, none of them</button>
    </div>
    <article class="card" style="margin-top:1rem">
      <label>Find a lot you already walked</label>
      <input id="vq" placeholder="Address" />
      <div id="vhits" class="chip-row" style="margin-top:0.8rem"></div>
    </article>
    <div id="vnotes" style="margin-top:1rem"></div>
    <div class="cta-row"><button class="pill" id="vdone" type="button">Save and build the walk list</button></div>
  `,
    "/match"
  );
  bindSignOut();

  const paintHits = () => {
    const q = (document.getElementById("vq").value || "").trim().toLowerCase();
    const rows = pool
      .filter((s) => {
        if (picked.has(s.site_id)) return false;
        if (!q) return true;
        return `${s.address} ${s.neighborhood_name} ${s.pin}`.toLowerCase().includes(q);
      })
      .slice(0, 12);
    document.getElementById("vhits").innerHTML = rows
      .map((s) => `<button type="button" class="choice chip" data-add="${s.site_id}">${s.address}</button>`)
      .join("");
    document.querySelectorAll("[data-add]").forEach((btn) => {
      btn.onclick = () => {
        const site = siteById(btn.dataset.add);
        if (!site) return;
        picked.set(site.site_id, {
          siteId: site.site_id,
          address: site.address,
          typology: leadTypeFor(site, session),
          notes: "",
          prefer: false,
        });
        paintNotes();
        paintHits();
      };
    });
  };

  const paintNotes = () => {
    const box = document.getElementById("vnotes");
    const rows = [...picked.values()];
    if (!rows.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = rows
      .map(
        (v) => `<article class="card" style="margin-top:0.7rem">
          <h3>${v.address}</h3>
          <p class="muted">${TYPOLOGY_LABELS[v.typology] || v.typology}</p>
          <label>Notes from the visit</label>
          <input data-note="${v.siteId}" value="${String(v.notes || "").replace(/"/g, "&quot;")}" placeholder="What did you see?" />
          <label class="choice"><input type="checkbox" data-pref="${v.siteId}" ${v.prefer ? "checked" : ""} /> I prefer this type of property</label>
          <button type="button" class="pill ghost" data-drop="${v.siteId}">Remove</button>
        </article>`
      )
      .join("");
    box.querySelectorAll("[data-note]").forEach((el) => {
      el.oninput = () => {
        const row = picked.get(el.dataset.note);
        if (row) row.notes = el.value;
      };
    });
    box.querySelectorAll("[data-pref]").forEach((el) => {
      el.onchange = () => {
        const row = picked.get(el.dataset.pref);
        if (row) row.prefer = el.checked;
      };
    });
    box.querySelectorAll("[data-drop]").forEach((btn) => {
      btn.onclick = () => {
        picked.delete(btn.dataset.drop);
        paintNotes();
        paintHits();
      };
    });
  };

  const finish = (savePicked) => {
    if (savePicked) session.lotVisits = [...picked.values()];
    session.visitsAsked = true;
    saveSession(session);
    render();
  };

  document.getElementById("none").onclick = () => finish(false);
  document.getElementById("vdone").onclick = () => finish(true);
  let t;
  document.getElementById("vq").oninput = () => {
    clearTimeout(t);
    t = setTimeout(paintHits, 150);
  };
  paintHits();
  paintNotes();
}

function viewMatch(session) {
  if (session.missionSet && !visitConfirmed()) return viewReturning(session);
  if (!session.missionSet) return viewMission(session);
  if (!session.visitsAsked) return viewVisited(session);
  const filters = readFilters();
  const { pairings } = deckPairings(SITES, session, filters);
  const rankedWalk = applyVisitMemory(
    filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings,
    session
  );
  const extras = (session.extraWalks || [])
    .map((x) => {
      const site = siteById(x.siteId);
      if (!site) return null;
      return buildPairing(site, x.typology || leadTypeFor(site, session), session);
    })
    .filter(Boolean);
  const rest = rankedWalk.filter((p) => !extras.some((e) => e.site.site_id === p.site.site_id));
  const visible = [...extras, ...rest].slice(0, Math.max(5, extras.length));
  const hash = location.hash.replace(/^#/, "");
  const segs = hash.split("/").filter(Boolean);
  let featured;
  if (segs[0] === "match" && segs[1] && segs[2]) {
    const site = siteById(segs[1]);
    if (site) featured = buildPairing(site, segs[2], session);
  }
  if (!featured) {
    featured = visible[0] || featuredPairing(rankedWalk, session.lastPairing);
  }
  if (!visible.length) {
    root.innerHTML = layoutApp(
      session,
      `
      <h2 class="serif">Nothing to walk under this month's answers</h2>
      <p class="muted">${(session.missionPlaces || []).join(", ")} has no matching for-sale by-right pairings for ${typeListLabel(missionTypesOf(session))}${(session.lotVisits || []).some((v) => !v.prefer) ? ", or you already walked the rest." : "."}</p>
      <button class="pill" id="retarget" type="button">Change this month's cut</button>
    `,
      "/match"
    );
    bindSignOut();
    document.getElementById("retarget").onclick = () => {
      session.missionSet = false;
      session.visitsAsked = false;
      saveSession(session);
      render();
    };
    return;
  }
  session.lastPairing = featured.key;
  session.lastSiteId = featured.site.site_id;
  saveSession(session);
  const idx = visible.findIndex((p) => p.key === featured.key);
  const next = visible[(Math.max(idx, 0) + 1) % Math.max(visible.length, 1)] || featured;

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">This week's visits</p>
    <h2 class="serif" style="margin:0.2rem 0 0.35rem">${greeting()}, ${session.name.split(" ")[0]}. Here is what to do.</h2>
    <p class="muted">${(session.missionPlaces || []).join(", ")} · ${typeListLabel(missionTypesOf(session))}${session.missionForSale !== false ? " · for sale" : ""}${session.missionByRight !== false ? " · by-right only" : ""}</p>
    <p><button class="pill ghost" id="retarget" type="button">Change this month's cut</button></p>

    <article class="card match-hero">
      <div class="match-top">
        <span class="verdict ${featured.verdict}">${VERDICT_LABEL[featured.verdict]}</span>
        <span class="small">#${Math.max(idx, 0) + 1} of ${visible.length}</span>
      </div>
      <h2 class="serif pairing-title">${walkLine(featured.site, featured.typology, featured.verdict)}</h2>
      <p class="muted">${factsStrip(featured.site)}</p>
      ${pointsHtml(featured.points.filter((p) => p.k !== "Do"))}
      ${walkActionsHtml(featured.site)}
      <div class="cta-row">
        <a class="pill ghost" href="#/compare">Compare to another lot</a>
        <button class="pill ghost" id="next-match" type="button">Next visit</button>
      </div>
      <div class="been-box">
        <p><strong>Have you visited this place before?</strong></p>
        <input id="been-note" placeholder="Notes from the visit" value="${String((session.lotVisits || []).find((v) => v.siteId === featured.site.site_id)?.notes || "").replace(/"/g, "&quot;")}" />
        <label class="choice"><input type="checkbox" id="been-pref" ${
          (session.lotVisits || []).find((v) => v.siteId === featured.site.site_id)?.prefer ? "checked" : ""
        } /> I prefer this type of property</label>
        <button class="pill ghost" id="been-save" type="button">Save note</button>
        <p class="muted" id="been-ok"></p>
      </div>
    </article>

    <section class="section" style="padding-top:1.4rem">
      <h3 class="serif">Your five</h3>
      <div class="match-deck">
        ${visible
          .map((p, i) => {
            const on = p.key === featured.key ? "on" : "";
            return `<article class="card deck-card ${on}">
              <div class="match-top">
                <span class="verdict ${p.verdict}">${VERDICT_LABEL[p.verdict]}</span>
                <span class="small">${i + 1}</span>
              </div>
              <h3>${walkLine(p.site, p.typology, p.verdict)}</h3>
              <p class="muted">${factsStrip(p.site)}</p>
              ${walkActionsHtml(p.site)}
              <div class="cta-row">
                <a class="pill ghost" href="#/match/${p.site.site_id}/${p.typology}">Open this visit</a>
                <a class="pill ghost" href="#/compare">Compare</a>
              </div>
            </article>`;
          })
          .join("")}
      </div>
    </section>
  `,
    "/match"
  );
  bindSignOut();
  document.getElementById("retarget").onclick = () => {
    session.missionSet = false;
    session.visitsAsked = false;
    saveSession(session);
    render();
  };
  document.getElementById("next-match").onclick = () => go(`/match/${next.site.site_id}/${next.typology}`);
  bindCopyPins();
  document.getElementById("been-save").onclick = () => {
    const notes = document.getElementById("been-note").value;
    const prefer = document.getElementById("been-pref").checked;
    const row = {
      siteId: featured.site.site_id,
      address: featured.site.address,
      typology: featured.typology,
      notes,
      prefer,
    };
    session.lotVisits = [...(session.lotVisits || []).filter((v) => v.siteId !== row.siteId), row];
    saveSession(session);
    document.getElementById("been-ok").textContent = prefer
      ? "Saved. Next lists will lean toward this housing type."
      : "Saved. This lot will drop off the walk list.";
  };
}

function monthFit(site, session) {
  const places = session.missionPlaces || [];
  const types = missionTypesOf(session);
  const needSale = session.missionForSale !== false;
  const needRight = session.missionByRight !== false;
  const hits = [];
  const misses = [];
  if (places.length) {
    if (places.includes(site.neighborhood_name)) hits.push(`in ${site.neighborhood_name}`);
    else misses.push(`outside ${places.join(", ")}`);
  }
  if (needSale) {
    if (site.current_status === "Available for Sale") hits.push("for sale");
    else misses.push(site.current_status ? site.current_status.toLowerCase() : "not for sale");
  }
  const allowed = types.filter((t) => verdictFor(site, t) === "go");
  if (needRight) {
    if (allowed.length) hits.push(`${allowed.map((t) => TYPOLOGY_LABELS[t].toLowerCase()).join(" or ")} allowed`);
    else misses.push("your housing type is not allowed without a hearing");
  } else if (allowed.length) {
    hits.push(`${allowed.map((t) => TYPOLOGY_LABELS[t].toLowerCase()).join(" or ")} allowed`);
  }
  if (!misses.length) {
    return { tone: "go", label: "Fits this month", text: hits.join(" · ") || "Fits what you set for this month." };
  }
  if (hits.length) {
    return { tone: "caution", label: "Partial fit", text: `${hits.join(" · ")}. Gap: ${misses.join("; ")}.` };
  }
  return { tone: "no-go", label: "Does not fit this month", text: misses.join("; ") };
}

function viewPipeline(session) {
  const neighborhoods = uniqueSorted(SITES.map((s) => s.neighborhood_name));
  const place = session.pipeNeighborhood || "all";
  const q0 = session.pipeQ || "";
  const forSale = session.pipeForSale === true;
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Find a lot</p>
    <h2 class="serif">Add a lot to this week's walk</h2>
    <p class="muted">Search a full address or PIN. Each card says whether the lot fits this month's walk, not only that you can add it.</p>
    <div class="filters card">
      <label>Neighborhood</label>
      <select id="fn"><option value="all">All Pittsburgh</option>${neighborhoods
        .map((n) => `<option value="${n}" ${place === n ? "selected" : ""}>${n}</option>`)
        .join("")}</select>
      <label>Address or PIN</label>
      <input id="fq" value="${q0.replace(/"/g, "&quot;")}" placeholder="2523 CENTRE or 0009M00218000000" />
      <label class="choice" style="grid-column:1/-1"><input type="checkbox" id="sale" ${forSale ? "checked" : ""} /> Only for sale</label>
    </div>
    <p class="muted" id="pcount"></p>
    <div class="grid2" id="plist"></div>
  `,
    "/pipeline"
  );
  bindSignOut();

  const paintList = () => {
    const neighborhood = document.getElementById("fn").value;
    const q = document.getElementById("fq").value;
    const sale = document.getElementById("sale").checked;
    session.pipeNeighborhood = neighborhood;
    session.pipeQ = q;
    session.pipeForSale = sale;
    saveSession(session);
    const lots = filterSites(SITES, {
      neighborhood,
      q,
      status: sale ? "Available for Sale" : "all",
    });
    const show = lots.slice(0, 40);
    const added = new Set((session.extraWalks || []).map((x) => x.siteId));
    const fitN = show.filter((s) => monthFit(s, session).tone === "go").length;
    document.getElementById("pcount").textContent = `${lots.length.toLocaleString()} lots match this search. ${fitN} of the ${show.length} on screen also fit this month's walk.`;
    document.getElementById("plist").innerHTML = show
      .map((s) => {
        const onWalk = added.has(s.site_id);
        const pin = s.pin && String(s.pin).trim() ? `PIN ${s.pin}` : "";
        const fit = monthFit(s, session);
        const addLab = onWalk ? "Remove from walk" : fit.tone === "go" ? "Add to this week's walk" : "Add anyway";
        return `<article class="card">
          <div class="match-top"><span class="verdict ${fit.tone}">${fit.label}</span></div>
          <p class="small">${[s.neighborhood_name, s.zoned_as].filter(Boolean).join(" · ")}</p>
          <h3>${s.address}</h3>
          <p class="muted">${[s.current_status, Number(s.parc_sq_ft) ? `${Number(s.parc_sq_ft).toLocaleString()} sq ft` : "", pin].filter(Boolean).join(" · ")}</p>
          <p>${fit.text}</p>
          <div class="cta-row">
            <button type="button" class="pill ${onWalk || fit.tone !== "go" ? "ghost" : ""}" data-add="${s.site_id}">${addLab}</button>
            <a class="pill ghost" href="${mapsUrl(s)}" target="_blank" rel="noopener">Maps</a>
          </div>
        </article>`;
      })
      .join("");
    document.querySelectorAll("[data-add]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.add;
        const had = (session.extraWalks || []).some((x) => x.siteId === id);
        if (had) {
          session.extraWalks = (session.extraWalks || []).filter((x) => x.siteId !== id);
        } else {
          const site = siteById(id);
          const typology = leadTypeFor(site, session);
          session.extraWalks = [...(session.extraWalks || []).filter((x) => x.siteId !== id), { siteId: id, typology }].slice(-8);
        }
        saveSession(session);
        paintList();
      };
    });
  };

  document.getElementById("fn").onchange = paintList;
  document.getElementById("sale").onchange = paintList;
  document.getElementById("fq").oninput = paintList;
  paintList();
  document.getElementById("fq").focus();
}

function viewSite(session, id) {
  const site = siteById(id) || SITES[0];
  session.lastSiteId = site.site_id;
  saveSession(session);
  const pairings = TYPOLOGIES.map((t) => buildPairing(site, t, session));
  const visits = pairings.filter((p) => p.verdict === "go");
  const headline = visits.length
    ? `Walk this lot for ${visits.map((p) => TYPOLOGY_LABELS[p.typology]).join(" or ")}.`
    : `Do not walk ${site.address} for an accessory dwelling, a two-family house, or a small apartment building. ${districtPlain(site.zoned_as)} does not allow those uses.`;

  const signals = [];
  for (const p of pairings) {
    const z = readField(site, `zoning_allows_${p.typology}`);
    if (z === "by_right") {
      signals.push({ tone: "pos", label: `${TYPOLOGY_LABELS[p.typology]} zoning`, text: `Allowed without a special hearing in ${districtPlain(site.zoned_as)}. This supports a visit.` });
    } else if (z === "not_allowed") {
      signals.push({ tone: "neg", label: `${TYPOLOGY_LABELS[p.typology]} zoning`, text: `Not allowed in ${districtPlain(site.zoned_as)}. This blocks a visit for this type.` });
    }
  }
  const sq = Number(readField(site, "parc_sq_ft"));
  const pin = readField(site, "pin");
  const meta = [
    site.neighborhood_name,
    districtPlain(site.zoned_as),
    Number.isFinite(sq) ? `${sq.toLocaleString()} square feet` : null,
    site.current_status || null,
    !isUnknown(pin) ? `PIN ${pin}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">${site.neighborhood_name || "City lot"}</p>
    <h2 class="serif">${site.address}</h2>
    <p class="muted">${meta}</p>
    <p class="brief">${headline}</p>
    ${typicalRentLine(site) ? `<p>${typicalRentLine(site)}</p>` : ""}
    ${walkActionsHtml(site)}
    ${
      signals.length
        ? `<h3 class="serif">Signals</h3>
    <div class="signal-list">
      ${signals
        .map(
          (s) => `<div class="signal ${s.tone}"><span class="signal-k">${s.label}</span><span>${s.text}</span></div>`
        )
        .join("")}
    </div>`
        : ""
    }
    <div class="grid2" style="margin-top:1rem">
      ${pairings
        .map((p) => {
          const n = isUnknown(p.score) ? "" : p.score;
          return `<article class="card">
            <div class="match-top">
              <span class="verdict ${p.verdict}">${VERDICT_LABEL[p.verdict]}</span>
              ${n !== "" ? `<span class="small">${n}</span>` : ""}
            </div>
            <h3>${TYPOLOGY_LABELS[p.typology]}</h3>
            ${pointsHtml(p.points)}
          </article>`;
        })
        .join("")}
    </div>
    <p style="margin-top:1rem"><a href="#/match">Back to walk list</a></p>
  `,
    "/match"
  );
  bindSignOut();
  bindCopyPins();
}

function viewCompare(session) {
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/compare");
    bindSignOut();
    return;
  }
  const filters = readFilters();
  const a = siteById(session.lastSiteId) || SITES[0];
  const b = (a && SITES.find((s) => s.site_id !== a.site_id)) || SITES[1] || SITES[0];
  if (!a || !b) {
    root.innerHTML = layoutApp(session, `<p class="muted">Need at least two lots to compare.</p>`, "/compare");
    bindSignOut();
    return;
  }
  const optionPool = (() => {
    const filtered = filterSites(SITES, { ...filters, neighborhoods: [], q: "" });
    const keep = new Map();
    [a, b, ...filtered.slice(0, 150)].forEach((s) => {
      if (s && s.site_id) keep.set(s.site_id, s);
    });
    return [...keep.values()];
  })();
  const type = filters.typology && (filters.typology === "any" || TYPOLOGIES.includes(filters.typology))
    ? filters.typology
    : missionTypesOf(session).length === 1
      ? missionTypesOf(session)[0]
      : "any";
  const insight = compareInsight(a, b, session, type);
  const typeChoices = [
    ["any", "Best allowed type"],
    ...missionTypesOf(session).map((t) => [t, TYPOLOGY_LABELS[t]]),
  ];

  function recHtml(ins) {
    if (!ins.winner) {
      return `<article class="card insight" id="insight">
        <h2 class="serif pairing-title">${ins.headline}</h2>
      </article>`;
    }
    return `<article class="card insight" id="insight">
      <p class="eyebrow">Recommendation</p>
      <h2 class="serif pairing-title">${ins.headline}</h2>
      <p><strong>Why this one</strong></p>
      ${ (ins.reasons || []).map((r) => `<p>${r}</p>`).join("") }
      ${walkActionsHtml(ins.winner.site)}
    </article>`;
  }

  function col(pairing, win, why) {
    if (!pairing) return `<article class="card"><p class="muted">Choose a lot.</p></article>`;
    return `<article class="card ${win ? "on" : ""}">
      <div class="match-top">
        <span class="verdict ${pairing.verdict}">${VERDICT_LABEL[pairing.verdict]}</span>
        ${win ? `<span class="small">Walk this one</span>` : ""}
      </div>
      <h3>${walkLine(pairing.site, pairing.typology, pairing.verdict)}</h3>
      <p class="muted">${factsStrip(pairing.site)}</p>
      ${win && why && why.length ? `<p>${why[0]}</p>` : ""}
      ${walkActionsHtml(pairing.site)}
    </article>`;
  }

  const paintCols = (ins) =>
    col(ins.left, ins.winner && ins.left && ins.winner.site.site_id === ins.left.site.site_id, ins.reasons) +
    col(ins.right, ins.winner && ins.right && ins.winner.site.site_id === ins.right.site.site_id, ins.reasons);

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Compare</p>
    <h2 class="serif">Which lot do you walk?</h2>
    <div class="grid2" style="margin-bottom:1rem">
      <div><label>This lot</label><select id="sa">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === a.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`).join("")}</select></div>
      <div><label>Or this lot</label><select id="sb">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === b.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`).join("")}</select></div>
    </div>
    <label>For this housing type</label>
    <select id="ft">
      ${typeChoices.map(([v, lab]) => `<option value="${v}" ${type === v ? "selected" : ""}>${lab}</option>`).join("")}
    </select>
    ${recHtml(insight)}
    <div class="grid2" id="cols" style="margin-top:1rem">${paintCols(insight)}</div>
  `,
    "/compare"
  );
  const redraw = () => {
    const left = siteById(document.getElementById("sa").value);
    const right = siteById(document.getElementById("sb").value);
    if (!left || !right) return;
    const typ = document.getElementById("ft").value;
    saveFilters({ filterTypology: typ });
    const next = compareInsight(left, right, session, typ);
    document.getElementById("insight").outerHTML = recHtml(next);
    document.getElementById("cols").innerHTML = paintCols(next);
    bindCopyPins();
  };
  document.getElementById("sa").onchange = redraw;
  document.getElementById("sb").onchange = redraw;
  document.getElementById("ft").onchange = redraw;
  bindSignOut();
  bindCopyPins();
}

function viewBriefing(session) {
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Caveats</p>
    <h2 class="serif">What this walk list is not</h2>
    <div class="grid2">
      <article class="card"><h3>Not a finished home</h3><p class="muted">An allowed housing type is not a built unit or a tenant.</p></article>
      <article class="card"><h3>Typical rent nearby</h3><p class="muted">Census median gross rent for the two Hill tracts, benchmarked against Pittsburgh typical ($1,261). Predicted carry is 30% of typical neighborhood income. Hidden where ACS is missing.</p></article>
      <article class="card"><h3>Not pollution</h3><p class="muted">A nearby bus stop is not a carbon score.</p></article>
      <article class="card"><h3>Not City Planning</h3><p class="muted">Staff still confirm the official zoning record.</p></article>
    </div>
    <article class="card" style="margin-top:1rem">
      <h3>Where the numbers come from</h3>
      <p><a href="https://data.wprdc.org/dataset/city-owned-properties">City-owned properties (Western PA Regional Data Center)</a></p>
      <p><a href="https://ecode360.com/45476528">Pittsburgh zoning code, primary uses</a></p>
      <p>Census neighborhood numbers exist for two Hill District census areas; others are left blank</p>
      <p>Port Authority bus stops, nearest stop in feet</p>
    </article>
  `,
    "/briefing"
  );
  bindSignOut();
}

function viewAccount(session) {
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Account</p>
    <h2 class="serif">${session.name}</h2>
    <p class="muted">${session.email} · ${session.org}</p>
    <article class="card">
      <p>Role: ${ROLE_LABELS[session.role] || session.role || "unset"}</p>
      <p>Onboarded: ${session.onboarded ? "yes" : "no"}</p>
      <p>${mixPointer(session.weights)}</p>
      ${(session.lotVisits || []).length
        ? `<h3>Lots you already walked</h3>${(session.lotVisits || [])
            .map(
              (v) =>
                `<p><strong>${v.address}</strong> · ${TYPOLOGY_LABELS[v.typology] || v.typology}${v.prefer ? " · prefer this type" : ""}</p><p class="muted">${v.notes || "No note"}</p>`
            )
            .join("")}`
        : ""}
      <button class="pill ghost" id="redo">Replay onboarding</button>
    </article>
  `,
    "/account"
  );
  document.getElementById("redo").onclick = () => {
    session.onboarded = false;
    saveSession(session);
    go("/onboarding");
  };
  bindSignOut();
}

function render() {
  try {
    const { path, parts } = route();
    if (path === "/" || path === "/demo") {
      if (path === "/demo") return enterDemo();
      return viewLanding();
    }
    if (path === "/login") return viewLogin();
    if (path.startsWith("/onboarding")) return viewOnboarding();
    const session = sessionGuard(true);
    if (!session) return;
    if (path === "/home" || path === "/match" || path.startsWith("/match/")) return viewMatch(session);
    if (path === "/pipeline") return viewPipeline(session);
    if (path === "/compare") return viewCompare(session);
    if (path === "/briefing") return viewBriefing(session);
    if (path === "/account") return viewAccount(session);
    if (parts[0] === "sites" && parts[1]) return viewSite(session, parts[1]);
    viewMatch(session);
  } catch (err) {
    console.error(err);
    root.innerHTML = layoutPublic(`
      <div class="auth-box card">
        <h2 class="serif">Something broke on this screen</h2>
        <p class="muted">Sign in again. If this was a leftover session, the demo button now starts clean.</p>
        <p class="err">${String(err.message || err)}</p>
        <div class="cta-row">
          <a class="pill" href="#/demo">Start as Hill District demo</a>
          <a class="pill ghost" href="#/">Home</a>
        </div>
      </div>
    `);
  }
}

async function boot() {
  window.addEventListener("hashchange", render);
  render();
  try {
    const res = await fetch("./data/sites.json");
    if (!res.ok) throw new Error("sites missing");
    SITES = await res.json();
    render();
  } catch (err) {
    const app = document.getElementById("app");
    if (app && !SITES.length) {
      app.insertAdjacentHTML(
        "beforeend",
        `<p class="err" style="padding:1rem">Could not load lots. Run python3 serve.py and open http://127.0.0.1:8080</p>`
      );
    }
  }
}

boot();
