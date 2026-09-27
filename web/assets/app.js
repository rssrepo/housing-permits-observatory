import { loadSession, saveSession, signIn, signOut, DEMO } from "./auth.js?v=cdc27";
import { answerQuery, ASK_PROMPTS } from "./ask.js?v=cdc27";
import {
  FACTOR_LABELS,
  FACTORS,
  HOUSING_TYPES,
  TYPOLOGIES,
  TYPOLOGY_HINTS,
  TYPOLOGY_LABELS,
  isUnknown,
  ranked,
  readField,
  scoreSite,
  normalizeWeights,
} from "./scoring.js?v=cdc27";
import {
  VERDICT_LABEL,
  buildPairing,
  affordHtml,
  assemblyNote,
  compareInsight,
  scenarioInsight,
  splitLegendHtml,
  currentWalks,
  deckPairings,
  districtPlain,
  featuredPairing,
  filterSites,
  factsStrip,
  mapsUrl,
  pointsHtml,
  verdictFor,
  scorecardHtml,
  steerCitywide,
  steerHtml,
  scorecardTags,
  sortPairings,
  stampClusters,
  tradeoffHtml,
  typicalRentLine,
  walkActionsHtml,
  walkLine,
} from "./match.js?v=cdc27";
import {
  ASK_N,
  SLIDES,
  detectClash,
  ensureAsk,
  restoreAsk,
  snapshotAsk,
  syncMix,
} from "./onboard.js?v=cdc27";

const root = document.getElementById("app");
let SITES = [];

const ROLE_LABELS = {
  planner: "City, county, or state planning",
  econdev: "Economic development",
  cdc: "CDC / nonprofit staff",
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
    ["/city", "City"],
    ["/steer", "Steering"],
    ["/pipeline", "Find a lot"],
    ["/compare", "Compare"],
    ["/scorecard", "CDC screen"],
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
        <strong>Ask</strong>
        <button class="pill ghost" id="ask-close" type="button">Close</button>
      </div>
      <p class="small ask-limit">I only answer these prompts from your visits list.</p>
      <div class="ask-prompts">${ASK_PROMPTS.map((t) => `<button type="button" class="choice chip" data-ask="${t.replace(/"/g, "&quot;")}">${t}</button>`).join("")}</div>
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
  log.innerHTML = ASK_LOG.map((m) => {
    if (m.who === "bot") return `<div class="ask-msg bot">${m.html || `<span>${escAsk(m.text || "")}</span>`}</div>`;
    return `<p class="ask-msg you"><span>${escAsk(m.text || "")}</span></p>`;
  }).join("");
  log.scrollTop = log.scrollHeight;
}

function escAsk(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      html: `<div class="ask-card"><p class="ask-title">Tap a chip. I will not invent a lot or a tenant.</p></div>`,
    });
  }
  renderAskLog();
  const send = (q) => {
    if (!q) return;
    ASK_LOG.push({ who: "you", text: q });
    const session = loadSession();
    const html = answerQuery(q, { sites: SITES, session, filters: readFilters() });
    ASK_LOG.push({ who: "bot", html });
    renderAskLog();
  };
  document.querySelectorAll("[data-ask]").forEach((btn) => {
    btn.onclick = () => send(btn.dataset.ask);
  });
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
    send(q);
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

const BUS_FEET = [0, 2640, 1320, 400];

const FACTOR_FOCUS = {
  feasibility: "allowed type and lot size",
  demand_fit: "renter share",
  affordability_impact: "rent burden",
  climate_proxy: "walking distance to a bus stop",
  displacement_risk: "displacement pressure",
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
      <span class="eyebrow">Public land, zoning, and the few tools a city actually holds</span>
      <h1>Local government barely builds housing. It steers where private money goes.</h1>
      <p class="lede">The steering wheel is zoning and land use, tax incentives, and public land. Parcel Fit reads those three on Pittsburgh city-owned vacant lots, then names the housing type tradeoff. Private parcels and most local tax deals are not in this file.</p>
      <div class="cta-row">
        <a class="pill" href="#/demo">Start as Hill District demo</a>
        <a class="pill ghost" href="#/login">Create a workspace</a>
      </div>
    </section>
    <div class="bento">
      <article class="card">
        <p class="eyebrow">The match</p>
        <h3>One lot times one type.</h3>
        <p class="muted">A two-family house and a small apartment on the same lot are different deals. Zoning is the hard gate. Your mix is a value judgment, not a hidden model.</p>
      </article>
      <article class="card">
        <p class="eyebrow">The conflict</p>
        <h3>Every visit has a cost.</h3>
        <p class="muted">More homes can press neighbors already overpaying rent. Live FEMA flood, street-tree shade, and nearby LIHTC now show on the pairing. Building carbon is still not kilograms.</p>
      </article>
    </div>
    <section class="section">
      <h2>Who this is for</h2>
      <div class="grid3">
        <article class="card"><h3>Planning and economic development</h3><p class="muted">See how this vacant inventory sits against zoning, nearby tax-credit housing, and the public land path. Not a log of every TIF.</p></article>
        <article class="card"><h3>CDC staff</h3><p class="muted">Public vacant lots, title pathway, clusters, then a type you can walk this week.</p></article>
        <article class="card"><h3>Neighbors at the table</h3><p class="muted">Who benefits and who might be harmed, in sentences, not a composite that hides the conflict.</p></article>
      </div>
    </section>
    <p class="footer">WPRDC city-owned lots · Pittsburgh zoning Ch. 911 · ACS on two Hill tracts · PRT stops on the genesis sample</p>
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
  ensureAsk(s);
  let step = Number(new URLSearchParams(location.hash.split("?")[1] || "").get("step") || 1);
  if (step > ASK_N) step = ASK_N;
  if (step < 1) step = 1;
  const slide = SLIDES[step - 1];
  const clash = s._clash;

  const tile = (on, attrs, lab, sub) =>
    `<button type="button" class="choice ${on ? "on" : ""}" ${attrs}><strong>${lab}</strong>${
      sub ? `<span class="muted"> ${sub}</span>` : ""
    }</button>`;

  let body = `<p class="eyebrow">Question ${step} of ${ASK_N}</p><h2 class="serif">${slide.title}</h2><p class="muted">${slide.muted}</p>`;
  if (slide.kind === "role") {
    body += Object.keys(ROLE_LABELS)
      .map((role) => tile(s.role === role, `data-role="${role}"`, ROLE_LABELS[role], ""))
      .join("");
  } else if (slide.kind === "tiles") {
    body += slide.options.map((o) => tile(s[slide.key] === o.v, `data-v="${o.v}"`, o.lab, o.sub || "")).join("");
  } else if (slide.kind === "multi") {
    const set = new Set(s[slide.key] || []);
    body += slide.options.map((o) => tile(set.has(o.v), `data-v="${o.v}"`, o.lab, o.sub || "")).join("");
    if (slide.id === "land") body += `<p class="small">Leave every chip off to keep all public vacant lots.</p>`;
  } else if (slide.kind === "slider") {
    const n = Number(s[slide.key] || 0);
    body += `<input type="range" id="ask-range" min="0" max="${slide.max}" step="1" value="${n}" />
      <p class="weight-mix" id="ask-lab">${slide.labels[n] || slide.labels[0]}</p>`;
  } else if (slide.kind === "bus") {
    const ft = Number(s.askBus || 0);
    const idx = Math.max(0, BUS_FEET.indexOf(ft));
    body += `<input type="range" id="ask-range" min="0" max="3" step="1" value="${idx}" />
      <p class="weight-mix" id="ask-lab">${slide.labels[idx]}</p>`;
  } else if (slide.kind === "places") {
    const names = uniqueSorted(SITES.map((row) => row.neighborhood_name));
    body += `<div id="places" class="chip-row"></div>
      <label>More neighborhoods</label>
      <select id="more"><option value="">Add another</option>${names.map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
      ${!SITES.length ? `<p class="muted">Loading lots…</p>` : ""}`;
  }

  const clashHtml = clash
    ? `<article class="clash-card" id="clash">
        <p class="eyebrow">This narrows the list</p>
        <h3 class="serif">${clash.text}</h3>
        <p class="muted">${clash.thisLab} fights ${clash.vsLab}.</p>
        <button type="button" class="choice" data-clash="this">This matters more than ${clash.vsLab}</button>
        <button type="button" class="choice" data-clash="both">Keep both, show the conflict on the pairing</button>
        <button type="button" class="choice" data-clash="undo">Undo this answer</button>
      </article>`
    : "";

  root.innerHTML = layoutPublic(`
    <div class="auth-box ask-slide">
      <div class="steps">${SLIDES.map((_, i) => `<div class="step-dot ${i < step ? "on" : ""}"></div>`).join("")}</div>
      ${body}
      ${clashHtml}
      <p class="err" id="ask-err"></p>
      <div class="cta-row" style="margin-top:1.2rem">
        ${step > 1 ? `<button class="pill ghost" id="back">Back</button>` : ""}
        <button class="pill" id="next" ${clash ? "disabled" : ""}>${step === ASK_N ? "Build your visits" : "Continue"}</button>
      </div>
    </div>
  `);

  const showClash = (justId, snap) => {
    const hit = detectClash(s, justId);
    if (!hit) {
      s._clash = null;
      s._clashSnap = null;
      return false;
    }
    s._clash = { justId, text: hit.text, thisLab: hit.thisLab, vsLab: hit.vsLab };
    s._clashSnap = snap;
    saveSession(s);
    return true;
  };

  const afterAnswer = (justId, snap) => {
    syncMix(s);
    if (showClash(justId, snap)) {
      saveSession(s);
      render();
      return;
    }
    s._clash = null;
    saveSession(s);
    render();
  };

  document.querySelectorAll("[data-role]").forEach((btn) => {
    btn.onclick = () => {
      s.role = btn.dataset.role;
      saveSession(s);
      render();
    };
  });

  document.querySelectorAll("[data-v]").forEach((btn) => {
    btn.onclick = () => {
      if (clash) return;
      const snap = snapshotAsk(s);
      const v = btn.dataset.v;
      if (slide.kind === "tiles") s[slide.key] = v;
      else {
        const cur = new Set(s[slide.key] || []);
        if (cur.has(v)) cur.delete(v);
        else cur.add(v);
        s[slide.key] = [...cur];
      }
      afterAnswer(slide.id, snap);
    };
  });

  const range = document.getElementById("ask-range");
  if (range) {
    range.oninput = () => {
      const n = Number(range.value);
      const lab = document.getElementById("ask-lab");
      if (slide.kind === "bus") {
        if (lab) lab.textContent = SLIDES.find((x) => x.id === "bus").labels[n];
      } else if (lab) lab.textContent = slide.labels[n];
    };
    range.onchange = () => {
      if (clash) return;
      const snap = snapshotAsk(s);
      const n = Number(range.value);
      if (slide.kind === "bus") s.askBus = BUS_FEET[n];
      else s[slide.key] = n;
      afterAnswer(slide.id, snap);
    };
  }

  if (slide.kind === "places") {
    const names = uniqueSorted(SITES.map((row) => row.neighborhood_name));
    const suggested = ["Middle Hill", "Crawford-Roberts", "Bedford Dwellings", "Terrace Village"].filter((n) =>
      names.includes(n)
    );
    const selected = new Set(s.askAllCity ? [] : s.askPlaces || []);
    let allCity = Boolean(s.askAllCity) || !selected.size;
    const baseList = suggested.concat(names.filter((p) => !suggested.includes(p))).slice(0, 12);
    const paint = () => {
      const extra = [...selected].filter((n) => !baseList.includes(n));
      const row = document.getElementById("places");
      if (!row) return;
      row.innerHTML = [
        `<button type="button" class="choice chip ${allCity ? "on" : ""}" data-all="1">All Pittsburgh</button>`,
        ...baseList.concat(extra).map(
          (n) =>
            `<button type="button" class="choice chip ${!allCity && selected.has(n) ? "on" : ""}" data-place="${n}">${n}</button>`
        ),
      ].join("");
      row.querySelector("[data-all]").onclick = () => {
        allCity = true;
        selected.clear();
        s.askAllCity = true;
        s.askPlaces = [];
        saveSession(s);
        paint();
      };
      row.querySelectorAll("[data-place]").forEach((btn) => {
        btn.onclick = () => {
          allCity = false;
          if (selected.has(btn.dataset.place)) selected.delete(btn.dataset.place);
          else selected.add(btn.dataset.place);
          if (!selected.size) allCity = true;
          s.askAllCity = allCity;
          s.askPlaces = allCity ? [] : [...selected];
          saveSession(s);
          paint();
        };
      });
      const more = document.getElementById("more");
      if (more) {
        more.innerHTML =
          `<option value="">Add another</option>` +
          names.filter((n) => !selected.has(n)).map((n) => `<option value="${n}">${n}</option>`).join("");
      }
    };
    paint();
    const more = document.getElementById("more");
    if (more) {
      more.onchange = (e) => {
        const name = e.target.value;
        if (!name) return;
        allCity = false;
        selected.add(name);
        s.askAllCity = false;
        s.askPlaces = [...selected];
        paint();
      };
    }
  }

  document.querySelectorAll("[data-clash]").forEach((btn) => {
    btn.onclick = () => {
      const how = btn.dataset.clash;
      if (how === "undo") restoreAsk(s, s._clashSnap);
      if (how === "this") {
        const hit = detectClash(s, s._clash.justId);
        if (hit) hit.soften(s);
      }
      s._clash = null;
      s._clashSnap = null;
      syncMix(s);
      saveSession(s);
      render();
    };
  });

  const back = document.getElementById("back");
  if (back) {
    back.onclick = () => {
      s._clash = null;
      saveSession(s);
      go(`/onboarding?step=${step - 1}`);
    };
  }
  document.getElementById("next").onclick = () => {
    if (s._clash) return;
    const err = document.getElementById("ask-err");
    if (slide.id === "role" && !s.role) s.role = "cdc";
    if (slide.id === "type" && !(s.askTypes || []).length) {
      err.textContent = "Pick at least one housing type.";
      return;
    }
    if (slide.id === "places") {
      if (!s.askAllCity && !(s.askPlaces || []).length) {
        s.askAllCity = true;
        s.askPlaces = [];
      }
    }
    syncMix(s);
    saveSession(s);
    if (step < ASK_N) {
      go(`/onboarding?step=${step + 1}`);
      return;
    }
    s.onboarded = true;
    s.replayPriorities = false;
    s.missionSet = true;
    s.visitsAsked = false;
    s.lastSiteId = "centre-2523";
    saveSession(s);
    go("/match");
    render();
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
  const raw = s.missionTypes?.length
    ? s.missionTypes
    : s.missionType === "any"
      ? [...TYPOLOGIES]
      : s.missionType && TYPOLOGIES.includes(s.missionType)
        ? [s.missionType]
        : ["duplex"];
  const types = raw.filter((t) => TYPOLOGIES.includes(t));
  return types.length ? types : ["duplex"];
}

function typeListLabel(types) {
  return types.map((t) => TYPOLOGY_LABELS[t]).join(", ");
}

function placesLabel(session) {
  if (session.missionAllCity || !(session.missionPlaces || []).length) return "All Pittsburgh";
  return (session.missionPlaces || []).join(", ");
}

function readFilters() {
  const s = loadSession() || {};
  const typologies = missionTypesOf(s);
  return {
    neighborhoods: s.missionAllCity ? [] : s.missionPlaces || [],
    neighborhood: s.filterNeighborhood || "all",
    status: s.missionForSale === false ? s.filterStatus || "all" : "Available for Sale",
    typologies,
    typology: s.filterTypology || (typologies.length === 1 ? typologies[0] : "any"),
    genesis: "all",
    q: s.filterQ || "",
    byRight: s.askByRight === "must" || (!s.askByRight && s.missionByRight !== false),
    inventoryTypes: s.askLand || [],
    skipSfha: s.askFlood === "skip",
    skipSteep: s.askSlope === "skip",
    transitMaxFt: Number(s.askBus || s.transitMaxFt || 0),
    minTrees: Number(s.askTrees) >= 2 ? 8 : 0,
    skipHot: s.askHeat === "skip",
    lihtc: s.askLihtc === "near" || s.askLihtc === "avoid" ? s.askLihtc : "",
    minCluster: Number(s.askCluster) >= 2 ? 1 : 0,
    minRenter: s.askWho === "renters" ? 45 : 0,
    lowerIncome: s.askWho === "lower",
    avoidPressure: s.askPressure === "avoid",
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
  const picked = new Set(session.missionAllCity || !session.missionPlaces?.length ? [] : session.missionPlaces);
  let allCity = Boolean(session.missionAllCity) || (session.missionSet && !session.missionPlaces?.length);
  if (!session.missionSet && !session.missionAllCity && !session.missionPlaces?.length) {
    suggested.slice(0, 2).forEach((n) => picked.add(n));
    allCity = false;
  }
  const pickedTypes = new Set(missionTypesOf(session));
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">This month</p>
    <h2 class="serif">What are you staffing this month?</h2>
    <p class="muted">This is the CDC targeting screen: public land in the neighborhoods you staff, a housing type that is already allowed, then a visit list. Private tax-delinquent lots are not in this file.</p>
    <article class="card">
      <h3>Where are you walking?</h3>
      <p class="muted">All Pittsburgh, or the neighborhoods your CDC will actually visit.</p>
      <div id="places" class="chip-row"></div>
      <label>More neighborhoods</label>
      <select id="more">
        <option value="">Add another</option>
        ${places.map((n) => `<option value="${n}">${n}</option>`).join("")}
      </select>
    </article>
    <article class="card" style="margin-top:1rem">
      <h3>What do you want to put on the ground?</h3>
      <p class="muted">Homes and workplaces. A pairing is one type on one lot. Office, commercial, and industrial mix use district, lot, and bus, not rent.</p>
      ${TYPOLOGIES.map(
        (v) =>
          `<button type="button" class="choice ${pickedTypes.has(v) ? "on" : ""}" data-type="${v}"><strong>${TYPOLOGY_LABELS[v]}</strong><span class="muted"> ${TYPOLOGY_HINTS[v]}</span></button>`
      ).join("")}
    </article>
    <article class="card" style="margin-top:1rem">
      <label class="choice"><input type="checkbox" id="sale" ${session.missionForSale === false ? "" : "checked"} /> Only lots listed as available for sale</label>
      <label class="choice"><input type="checkbox" id="right" ${session.missionByRight === false ? "" : "checked"} /> Only types allowed without a special zoning hearing</label>
    </article>
    <p id="merr" class="err"></p>
    <div class="cta-row"><button class="pill" id="run" type="button">Build your visits</button></div>
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
    const chips = [
      `<button type="button" class="choice chip ${allCity ? "on" : ""}" data-all="1">All Pittsburgh</button>`,
      ...baseList.concat(extra).map(
        (n) => `<button type="button" class="choice chip ${!allCity && selected.has(n) ? "on" : ""}" data-place="${n}">${n}</button>`
      ),
    ];
    row.innerHTML = chips.join("");
    row.querySelector("[data-all]").onclick = () => {
      allCity = true;
      selected.clear();
      paint();
    };
    row.querySelectorAll("[data-place]").forEach((btn) => {
      btn.onclick = () => {
        allCity = false;
        if (selected.has(btn.dataset.place)) selected.delete(btn.dataset.place);
        else selected.add(btn.dataset.place);
        if (!selected.size) allCity = true;
        paint();
      };
    });
    fillMore();
  };

  paint();
  document.getElementById("more").onchange = (e) => {
    const name = e.target.value;
    if (!name) return;
    allCity = false;
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
    const placesNow = allCity ? [] : [...selected];
    if (!allCity && !placesNow.length) {
      document.getElementById("merr").textContent = "Pick All Pittsburgh or at least one neighborhood.";
      return;
    }
    const typesNow = [...pickedTypes];
    if (!typesNow.length) {
      document.getElementById("merr").textContent = "Pick at least one type.";
      return;
    }
    const typeNow = typesNow.length === 1 ? typesNow[0] : "any";
    session.missionSet = true;
    session.missionPlaces = placesNow;
    session.missionAllCity = allCity || !placesNow.length;
    session.missionTypes = typesNow;
    session.missionType = typeNow;
    session.missionForSale = document.getElementById("sale").checked;
    session.missionByRight = document.getElementById("right").checked;
    session.askByRight = session.missionByRight ? "must" : "prefer";
    session.askTypes = typesNow;
    session.askAllCity = session.missionAllCity;
    session.askPlaces = placesNow;
    session.visitsAsked = false;
    saveSession(session);
    markVisitOk();
    go("/match");
    render();
  };
}

function viewReturning(session) {
  const places = placesLabel(session);
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
    go("/onboarding?step=1");
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
    <p class="muted">Mark lots you already walked in ${placesLabel(session)}. Add a note. Say if you prefer that kind of property so later visits can follow it.</p>
    <div class="cta-row">
      <button class="pill" id="none" type="button">No, none of them</button>
    </div>
    <article class="card" style="margin-top:1rem">
      <label>Find a lot you already walked</label>
      <input id="vq" placeholder="Address" />
      <div id="vhits" class="chip-row" style="margin-top:0.8rem"></div>
    </article>
    <div id="vnotes" style="margin-top:1rem"></div>
    <div class="cta-row"><button class="pill" id="vdone" type="button">Save and build your visits</button></div>
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
  const visible = currentWalks(SITES, session, rankedWalk);
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
      <p class="muted">${placesLabel(session)} has no matching for-sale by-right pairings for ${typeListLabel(missionTypesOf(session))}${(session.lotVisits || []).some((v) => !v.prefer) ? ", or you already walked the rest." : "."}</p>
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
    <p class="eyebrow">Your visits</p>
    <h2 class="serif" style="margin:0.2rem 0 0.35rem">${greeting()}, ${session.name.split(" ")[0]}. Here is what to do.</h2>
    <p class="muted">${placesLabel(session)} · ${typeListLabel(missionTypesOf(session))}${session.missionForSale !== false ? " · for sale" : ""}${session.missionByRight !== false ? " · by-right only" : ""}</p>
    <p><button class="pill ghost" id="retarget" type="button">Change this month's cut</button></p>

    <article class="card match-hero">
      <div class="match-top">
        <span class="verdict ${featured.verdict}">${VERDICT_LABEL[featured.verdict]}</span>
        <span class="small">#${Math.max(idx, 0) + 1} of ${visible.length}</span>
      </div>
      ${affordHtml(featured.site, featured.typology)}
      <h2 class="serif pairing-title">${walkLine(featured.site, featured.typology, featured.verdict)}</h2>
      <p class="muted">${factsStrip(featured.site)}</p>
      <p class="small">${assemblyNote(featured.site, SITES)}</p>
      ${tradeoffHtml(featured.tradeoffs)}
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
      <h3 class="serif">Your visits</h3>
      <p class="muted">${visible.length} lot${visible.length === 1 ? "" : "s"} on the list. Add more from Find a lot.</p>
      <div class="match-deck">
        ${visible
          .map((p, i) => {
            const on = p.key === featured.key ? "on" : "";
            return `<article class="card deck-card ${on}">
              <div class="match-top">
                <span class="verdict ${p.verdict}">${VERDICT_LABEL[p.verdict]}</span>
                <span class="small">${i + 1}</span>
              </div>
              ${affordHtml(p.site, p.typology)}
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
      : "Saved. This lot will drop off your visits.";
  };
}

function monthFit(site, session) {
  const places = session.missionPlaces || [];
  const types = missionTypesOf(session);
  const needSale = session.missionForSale !== false;
  const needRight = session.missionByRight !== false;
  const hits = [];
  const misses = [];
  if (session.missionAllCity || !places.length) {
    hits.push("anywhere in Pittsburgh");
  } else if (places.includes(site.neighborhood_name)) {
    hits.push(`in ${site.neighborhood_name}`);
  } else {
    misses.push(`outside ${places.join(", ")}`);
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
    <h2 class="serif">Add a lot to your visits</h2>
    <p class="muted">Search a full address or PIN. Each card says whether the lot fits this month's cut. Add as many as you will actually walk.</p>
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
        const addLab = onWalk ? "Remove from visits" : fit.tone === "go" ? "Add to your visits" : "Add anyway";
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
          session.extraWalks = [...(session.extraWalks || []).filter((x) => x.siteId !== id), { siteId: id, typology }];
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
    : `Do not walk ${site.address} for a two-family house or a small apartment building. ${districtPlain(site.zoned_as)} does not allow those uses.`;

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
    <p style="margin-top:1rem"><a href="#/match">Back to your visits</a></p>
  `,
    "/match"
  );
  bindSignOut();
  bindCopyPins();
}

function compareTypeOf(session) {
  const filters = readFilters();
  if (filters.typology && (filters.typology === "any" || TYPOLOGIES.includes(filters.typology))) {
    return filters.typology;
  }
  return missionTypesOf(session).length === 1 ? missionTypesOf(session)[0] : "any";
}

function mapCompareHtml(left, right, session) {
  const ins = compareInsight(left, right, session, compareTypeOf(session), SITES);
  const winId = ins.winner?.site?.site_id;
  const card = (pairing, letter) => {
    if (!pairing) return "";
    const win = winId && pairing.site.site_id === winId;
    return `<article class="duel-col${win ? " on" : ""}">
      <p class="eyebrow">${letter}${win ? " · walk this" : ""}</p>
      <h3>${pairing.site.address || pairing.site.site_id}</h3>
      <p class="muted">${VERDICT_LABEL[pairing.verdict]} · ${TYPOLOGY_LABELS[pairing.typology]} · mix ${
        isUnknown(pairing.score) ? "unknown" : pairing.score
      }</p>
      <p class="muted">${factsStrip(pairing.site)}</p>
      <div class="cta-row">
        <a class="pill ghost" href="${mapsUrl(pairing.site)}" target="_blank" rel="noopener">Maps</a>
        <button type="button" class="pill ghost" data-dossier="${pairing.site.site_id}">This lot</button>
      </div>
    </article>`;
  };
  return `<p class="eyebrow">Map compare</p>
    <h3 class="serif duel-title">${ins.headline}</h3>
    ${(ins.reasons || []).slice(0, 3).map((r) => `<p class="duel-why">${r}</p>`).join("")}
    <div class="duel-grid">${card(ins.left, "A")}${card(ins.right, "B")}</div>
    <div class="cta-row">
      <button type="button" class="pill" data-full>Full compare</button>
      <button type="button" class="pill ghost" data-clear>Clear pins</button>
    </div>`;
}

function mixSlidersHtml(session) {
  const raw = session.weights || {};
  const n = normalizeWeights(raw);
  return `<div class="scen-mix card">
    <p class="eyebrow">Change the mix</p>
    <p class="muted">${mixPointer(raw)} Moving a slider is a value judgment. The factor scores stay the file.</p>
    ${FACTORS.map(
      (k) => `<label class="algo-row">${FACTOR_LABELS[k]}
        <input type="range" min="0" max="100" step="5" data-wk="${k}" value="${Math.round(Number(raw[k] || 0))}" />
        <b>${Math.round((n[k] || 0) * 100)}%</b>
      </label>`
    ).join("")}
  </div>`;
}

function bindMixRedraw(session, redraw) {
  document.querySelectorAll("[data-wk]").forEach((input) => {
    input.oninput = () => {
      const next = { ...(session.weights || {}) };
      document.querySelectorAll("[data-wk]").forEach((el) => {
        next[el.dataset.wk] = Number(el.value);
      });
      session.weights = next;
      saveSession(session);
      redraw();
    };
  });
}

function viewCompare(session) {
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/compare");
    bindSignOut();
    return;
  }
  const { parts } = route();
  const filters = readFilters();
  const lotMode = Boolean(parts[1] && parts[2]);
  const site = siteById(parts[1]) || siteById(session.lastSiteId) || SITES[0];
  const other =
    siteById(parts[2]) ||
    (site && SITES.find((s) => s.site_id !== site.site_id)) ||
    SITES[1] ||
    SITES[0];
  if (!site) {
    root.innerHTML = layoutApp(session, `<p class="muted">Need a lot to compare.</p>`, "/compare");
    bindSignOut();
    return;
  }
  session.lastSiteId = site.site_id;
  saveSession(session);
  const optionPool = (() => {
    const filtered = filterSites(SITES, { ...filters, neighborhoods: [], q: "" });
    const keep = new Map();
    [site, other, ...filtered.slice(0, 150)].forEach((s) => {
      if (s && s.site_id) keep.set(s.site_id, s);
    });
    return [...keep.values()];
  })();
  const asked = (session.askTypes || []).filter((t) => HOUSING_TYPES.includes(t));
  const typeA = HOUSING_TYPES.includes(session.scenarioA) ? session.scenarioA : asked[0] || "duplex";
  const typeB = HOUSING_TYPES.includes(session.scenarioB) && session.scenarioB !== typeA
    ? session.scenarioB
    : asked.find((t) => t !== typeA) || (typeA === "duplex" ? "small_multifamily" : "duplex");
  const typeChoices = HOUSING_TYPES.map((t) => [t, TYPOLOGY_LABELS[t]]);
  const modeBar = `<div class="city-pick" style="margin:0.6rem 0 1rem">
    <a class="choice chip${!lotMode ? " on" : ""}" href="#/compare">Two types, one lot</a>
    <a class="choice chip${lotMode ? " on" : ""}" href="#/compare/${site.site_id}/${other?.site_id || ""}">Two lots, one type</a>
  </div>`;

  function recHtml(ins) {
    if (!ins.winner) {
      return `<article class="card insight" id="insight"><h2 class="serif pairing-title">${ins.headline}</h2></article>`;
    }
    return `<article class="card insight" id="insight">
      <p class="eyebrow">Scenarios, not a winner from the sky</p>
      <h2 class="serif pairing-title">${ins.headline}</h2>
      ${(ins.reasons || []).map((r) => `<p>${r}</p>`).join("")}
      ${splitLegendHtml(ins.winner, session)}
      ${tradeoffHtml(ins.winner.tradeoffs)}
      ${walkActionsHtml(ins.winner.site)}
    </article>`;
  }

  function typeCol(pairing, win) {
    if (!pairing) return `<article class="card"><p class="muted">Pick a type.</p></article>`;
    return `<article class="card ${win ? "on" : ""}">
      <div class="match-top">
        <span class="verdict ${pairing.verdict}">${VERDICT_LABEL[pairing.verdict]}</span>
        ${win ? `<span class="small">This scenario</span>` : ""}
        <span class="small">${isUnknown(pairing.score) ? "mix unknown" : `mix ${pairing.score}`}</span>
      </div>
      ${affordHtml(pairing.site, pairing.typology)}
      <h3>${TYPOLOGY_LABELS[pairing.typology]}</h3>
      <p class="muted">${walkLine(pairing.site, pairing.typology, pairing.verdict)}</p>
      ${pointsHtml(pairing.points)}
    </article>`;
  }

  function lotCol(pairing, win, why) {
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

  if (!lotMode) {
    const insight = scenarioInsight(site, typeA, typeB, session);
    const winType = insight.winner?.typology;
    root.innerHTML = layoutApp(
      session,
      `
      <p class="eyebrow">Compare</p>
      <h2 class="serif">Two housing types on a real lot</h2>
      <p class="muted">This is the brief. Same place, two scenarios, your mix, and what the file cannot claim.</p>
      ${modeBar}
      <label>This lot</label>
      <select id="sc-site">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === site.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`).join("")}</select>
      <div class="grid2" style="margin:1rem 0">
        <div><label>Scenario A</label><select id="sc-a">${typeChoices.map(([v, lab]) => `<option value="${v}" ${v === typeA ? "selected" : ""}>${lab}</option>`).join("")}</select></div>
        <div><label>Scenario B</label><select id="sc-b">${typeChoices.map(([v, lab]) => `<option value="${v}" ${v === typeB ? "selected" : ""}>${lab}</option>`).join("")}</select></div>
      </div>
      ${mixSlidersHtml(session)}
      ${recHtml(insight)}
      <div class="grid2" id="cols" style="margin-top:1rem">${typeCol(insight.left, winType === insight.left?.typology)}${typeCol(insight.right, winType === insight.right?.typology)}</div>
    `,
      "/compare"
    );
    const redraw = () => {
      const nextSite = siteById(document.getElementById("sc-site").value) || site;
      const a = document.getElementById("sc-a").value;
      const b = document.getElementById("sc-b").value;
      session.lastSiteId = nextSite.site_id;
      session.scenarioA = a;
      session.scenarioB = b;
      saveSession(session);
      const next = scenarioInsight(nextSite, a, b, session);
      const win = next.winner?.typology;
      document.getElementById("insight").outerHTML = recHtml(next);
      document.getElementById("cols").innerHTML = `${typeCol(next.left, win === next.left?.typology)}${typeCol(next.right, win === next.right?.typology)}`;
      const mix = document.querySelector(".scen-mix");
      if (mix) mix.outerHTML = mixSlidersHtml(session);
      bindMixRedraw(session, redraw);
      bindCopyPins();
    };
    document.getElementById("sc-site").onchange = redraw;
    document.getElementById("sc-a").onchange = redraw;
    document.getElementById("sc-b").onchange = redraw;
    bindMixRedraw(session, redraw);
    bindSignOut();
    bindCopyPins();
    return;
  }

  const type = filters.typology && (filters.typology === "any" || TYPOLOGIES.includes(filters.typology))
    ? filters.typology
    : missionTypesOf(session).length === 1
      ? missionTypesOf(session)[0]
      : "any";
  const insight = compareInsight(site, other, session, type, SITES);
  const typeLotChoices = [
    ["any", "Best allowed type"],
    ...missionTypesOf(session).map((t) => [t, TYPOLOGY_LABELS[t]]),
  ];
  const recLot = (ins) => {
    if (!ins.winner) {
      return `<article class="card insight" id="insight"><h2 class="serif pairing-title">${ins.headline}</h2></article>`;
    }
    return `<article class="card insight" id="insight">
      <p class="eyebrow">Which lot</p>
      <h2 class="serif pairing-title">${ins.headline}</h2>
      ${(ins.reasons || []).map((r) => `<p>${r}</p>`).join("")}
      ${splitLegendHtml(ins.winner, session)}
      ${tradeoffHtml(ins.winner.tradeoffs)}
      ${walkActionsHtml(ins.winner.site)}
    </article>`;
  };
  const paintCols = (ins) =>
    lotCol(ins.left, ins.winner && ins.left && ins.winner.site.site_id === ins.left.site.site_id, ins.reasons) +
    lotCol(ins.right, ins.winner && ins.right && ins.winner.site.site_id === ins.right.site.site_id, ins.reasons);

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Compare</p>
    <h2 class="serif">Which lot do you walk?</h2>
    ${modeBar}
    <div class="grid2" style="margin-bottom:1rem">
      <div><label>This lot</label><select id="sa">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === site.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`).join("")}</select></div>
      <div><label>Or this lot</label><select id="sb">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === other.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`).join("")}</select></div>
    </div>
    <label>For this housing type</label>
    <select id="ft">
      ${typeLotChoices.map(([v, lab]) => `<option value="${v}" ${type === v ? "selected" : ""}>${lab}</option>`).join("")}
    </select>
    ${mixSlidersHtml(session)}
    ${recLot(insight)}
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
    session.lastSiteId = left.site_id;
    saveSession(session);
    go(`/compare/${left.site_id}/${right.site_id}`);
  };
  document.getElementById("sa").onchange = redraw;
  document.getElementById("sb").onchange = redraw;
  document.getElementById("ft").onchange = () => {
    saveFilters({ filterTypology: document.getElementById("ft").value });
    const next = compareInsight(
      siteById(document.getElementById("sa").value),
      siteById(document.getElementById("sb").value),
      session,
      document.getElementById("ft").value,
      SITES
    );
    document.getElementById("insight").outerHTML = recLot(next);
    document.getElementById("cols").innerHTML = paintCols(next);
    bindCopyPins();
  };
  bindMixRedraw(session, () => viewCompare(session));
  bindSignOut();
  bindCopyPins();
}

function viewScorecard(session, siteId) {
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/scorecard");
    bindSignOut();
    return;
  }
  const filters = readFilters();
  const pool = (() => {
    const filtered = filterSites(SITES, { ...filters, neighborhoods: [], q: "" });
    const keep = new Map();
    const first = siteById(siteId) || siteById(session.lastSiteId) || SITES[0];
    [first, ...filtered.slice(0, 120), ...SITES.filter((s) => s.genesis_sample === "yes")].forEach((s) => {
      if (s && s.site_id) keep.set(s.site_id, s);
    });
    return [...keep.values()];
  })();
  const site = siteById(siteId) || siteById(session.lastSiteId) || pool[0] || SITES[0];
  session.lastSiteId = site.site_id;
  saveSession(session);
  const best = sortPairings(TYPOLOGIES.map((t) => buildPairing(site, t, session)))[0];
  const tags = scorecardTags(site, SITES);
  const report = [
    `Parcel Fit lot card`,
    `${site.address} · ${site.neighborhood_name || ""} · PIN ${site.pin || "none"}`,
    `Tags: ${tags.map((t) => t.label).join(", ")}`,
    best ? `Call: ${VERDICT_LABEL[best.verdict]} for ${TYPOLOGY_LABELS[best.typology]}. Mix ${isUnknown(best.score) ? "unknown" : best.score}.` : "",
    "Strengths:",
    ...(best?.tradeoffs.gain || []).map((t) => `- ${t}`),
    "Watch-outs:",
    ...(best?.tradeoffs.cost || []).map((t) => `- ${t}`),
    "Not answered:",
    ...(best?.tradeoffs.miss || []).map((t) => `- ${t}`),
  ]
    .filter(Boolean)
    .join("\n");

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">This lot</p>
    <h2 class="serif">Would a Pittsburgh CDC put this lot on the list?</h2>
    <p class="muted">Tags first, then strengths versus watch-outs, then the five CDC filters. Open More for the source sentence. Ranking rules are in MATCHING.md.</p>
    <label>Lot</label>
    <select id="op-site">${pool
      .map((s) => `<option value="${s.site_id}" ${s.site_id === site.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`)
      .join("")}</select>
    ${scorecardHtml(site, SITES, session)}
    <div class="cta-row" style="margin-top:1rem">
      <button type="button" class="pill" id="op-copy">Copy this lot</button>
      ${walkActionsHtml(site)}
    </div>
  `,
    "/scorecard"
  );
  document.getElementById("op-site").onchange = () => {
    const id = document.getElementById("op-site").value;
    go(`/scorecard/${id}`);
  };
  document.getElementById("op-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(report);
      document.getElementById("op-copy").textContent = "Copied";
    } catch {
      document.getElementById("op-copy").textContent = "Copy failed";
    }
  };
  bindSignOut();
  bindCopyPins();
}

let disposeCity = null;

function viewCity(session) {
  if (disposeCity) {
    disposeCity();
    disposeCity = null;
  }
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/city");
    bindSignOut();
    return;
  }
  const filters = readFilters();
  const { pairings } = deckPairings(SITES, session, filters);
  const rankedWalk = applyVisitMemory(
    filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings,
    session
  );
  const visits = currentWalks(SITES, session, rankedWalk);
  const sites = visits.map((p) => p.site);
  const focus = siteById(session.lastSiteId);
  if (focus && !sites.some((s) => s.site_id === focus.site_id)) sites.unshift(focus);
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">City</p>
    <h2 class="serif">Every city vacant lot on the terrain</h2>
    <p class="muted">The terrain is the vacant file. Mix weights, layers, and the two-lot compare sit beside the map. Steering counts zoning, tax-credit distance, and whose land across the whole file.</p>
    <div class="city-desk">
      <div class="city-stage" id="city-stage"></div>
      <aside class="city-rail" id="city-rail"></aside>
    </div>
    <p class="small">Buildings are schematic boxes from the city I3S plan. Flood discs mark the lot, not the FIRM boundary. Cluster size is nearby city lots, not a surveyed assembly. Confirm on Maps before you walk.</p>
  `,
    "/city"
  );
  bindSignOut();
  const host = document.getElementById("city-stage");
  const rail = document.getElementById("city-rail");
  import("./city3d.js?v=cdc27")
    .then(({ mountCity }) =>
      mountCity(host, {
        lots: SITES,
        visitIds: sites.map((s) => s.site_id),
        focusId: session.lastSiteId,
        weights: session.weights,
        types: missionTypesOf(session),
        rail,
        onPick: (id) => go(`/scorecard/${id}`),
        formatCompare: (a, b) => mapCompareHtml(a, b, session),
        onDossier: (id) => go(`/scorecard/${id}`),
        onFullCompare: (a, b) => go(`/compare/${a}/${b}`),
        onWeights: (w, types) => {
          const s = loadSession();
          saveSession({
            ...s,
            weights: w,
            missionTypes: types,
            askTypes: types,
          });
        },
      })
    )
    .then((stop) => {
      disposeCity = stop;
    })
    .catch((err) => {
      host.innerHTML = `<p class="err">${String(err.message || err)}</p>`;
    });
}

function viewSteer(session) {
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/steer");
    bindSignOut();
    return;
  }
  const c = steerCitywide(SITES);
  const n = (x) => Number(x).toLocaleString();
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Steering</p>
    <h2 class="serif">Three tools. That is most of the wheel.</h2>
    <p class="muted">Local government does not build most buildings. It steers private investment with zoning and land use, tax incentives, and the land it already owns. This page counts those three on ${n(c.n)} city vacant lots. It is not a history of rezonings, and it is not private land.</p>
    <div class="steer-grid">
      <article class="card steer-col">
        <p class="eyebrow">Zoning and land use</p>
        <p><strong>${n(c.both)}</strong> lots already allow both a two-family house and a small apartment by-right.</p>
        <p class="muted">Two-family only ${n(c.duplex)} · small apartment only ${n(c.mf)} · neither ${n(c.neither)} · zoning not on file ${n(c.zUnk)}</p>
        <p class="small">Primary-use by-right from this dump, not overlays or a live ROZA pull. Switch the City map to By-right type to see it.</p>
      </article>
      <article class="card steer-col">
        <p class="eyebrow">Tax incentives</p>
        <p><strong>${n(c.lihtcNear)}</strong> lots sit within a quarter mile of a mapped HUD LIHTC project.</p>
        <p class="muted">Farther ${n(c.lihtcFar)} · distance not joined ${n(c.lihtcUnk)}</p>
        <p class="small">This is a federal tax-credit map. TIF, LERTA, KOZ, Opportunity Zone, and city abatement are not joined. We will not invent them.</p>
      </article>
      <article class="card steer-col">
        <p class="eyebrow">Public land</p>
        <p><strong>${n(c.land["Public Sale"])}</strong> on public sale · <strong>${n(c.land["URA Transfer"])}</strong> URA · <strong>${n(c.land["PLB Transfer"])}</strong> Land Bank · <strong>${n(c.land["CDC Property Reserve"])}</strong> CDC reserve.</p>
        <p class="muted">${c.land.other ? `${n(c.land.other)} other public labels.` : "Those four labels are the whole vacant dump."}</p>
        <p class="small">This is the land the city already holds. Private tax-delinquent stock is not here. Switch City to Whose land.</p>
      </article>
    </div>
    <p class="eyebrow" style="margin-top:1.4rem">What the district can take</p>
    <p class="muted">Same Ch. 911 weekend reading as the lot card. Affordable housing is not a zone. It is a home already allowed in a tract below Pittsburgh typical income.</p>
    <div class="steer-grid">
      ${["affordable", "single_family", "duplex", "small_multifamily", "office", "commercial", "industrial"]
        .map((id) => {
          const labs = {
            affordable: "Affordable housing",
            single_family: "Single-family housing",
            duplex: "Two-family house",
            small_multifamily: "Small apartment",
            office: "Offices",
            commercial: "Commercial",
            industrial: "Industrial",
          };
          const u = c.uses[id];
          return `<article class="card steer-col">
            <p class="eyebrow">${labs[id]}</p>
            <p><strong>${n(u.yes)}</strong> lots where this is already allowed or in play.</p>
            <p class="muted">Not this district ${n(u.no)} · unknown ${n(u.unk)}</p>
          </article>`;
        })
        .join("")}
    </div>
    <article class="card" style="margin-top:1rem">
      <h3>What this still cannot do</h3>
      <p>It cannot show where most private buildings will go. It cannot show which tax deal a council actually used. Open a lot for the three tools on that parcel, or compare two lots on the map.</p>
      <div class="cta-row">
        <a class="pill" href="#/city">City map</a>
        <a class="pill ghost" href="#/scorecard">This lot</a>
      </div>
    </article>
  `,
    "/steer"
  );
  bindSignOut();
}

function viewBriefing(session) {
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">What this is</p>
    <h2 class="serif">A matchmaker that shows the conflict</h2>
    <p class="muted">The useful output is not a winner. It is what you get, what you give up, and what this file cannot answer. For planning and economic development, the file is how public vacant land sits against the three tools a city actually holds.</p>
    <div class="grid2">
      <article class="card"><h3>Zoning</h3><p class="muted">By-right two-family and small apartment on the vacant dump. Visit/Hold/Skip is that gate. Overlays are not encoded.</p></article>
      <article class="card"><h3>Tax incentives</h3><p class="muted">Nearest HUD LIHTC point. Not TIF, LERTA, KOZ, or a city abatement log.</p></article>
      <article class="card"><h3>Public land</h3><p class="muted">Sale, URA, Land Bank, CDC reserve. Private land is most of the market and is not in this file.</p></article>
      <article class="card"><h3>Demand</h3><p class="muted">Census renter share where the tract joined. Blank elsewhere. Not a waitlist.</p></article>
      <article class="card"><h3>Equity</h3><p class="muted">Rent burden and the gap between typical rent paid and 30% of typical income. Neighborhood strain, not evictions or who gets the new unit.</p></article>
      <article class="card"><h3>Climate</h3><p class="muted">Live FEMA NFHL at the point. TPL 2023 land-surface heat 1–5 versus the city mean, not air temperature. Street-tree count and the city's tree CO2 calculator within 400 ft. Building operational carbon is still not measured.</p></article>
      <article class="card"><h3>What a judge should click</h3><p class="muted">Compare: two types on one lot, move the mix, read From the file / Your call / Not claimed. That is the success line. It is not CHAS, jobs, schools, or a carbon kilogram.</p></article>
    </div>
    <article class="card" style="margin-top:1rem">
      <h3>Sources</h3>
      <p><a href="https://data.wprdc.org/dataset/city-owned-properties">City-owned properties (WPRDC)</a></p>
      <p><a href="https://ecode360.com/45476528">Pittsburgh zoning code, primary uses</a></p>
      <p>ACS 2024 5-year for two Hill tracts; others blank</p>
      <p><a href="https://www.arcgis.com/home/item.html?id=db5bdb0f0c8c4b85b8270ec67448a0b6">TPL Heat Severity USA 2023</a></p>
      <p><a href="https://data.wprdc.org/dataset/property-assessments">Allegheny County property assessments (WPRDC)</a> · land FMV is 2012 base year</p>
      <p>ACS 2024 5-year B25077 median owner-occupied home value · Pittsburgh city typical $205,800</p>
      <p><a href="https://www.alleghenycounty.us/files/assets/county/v/2/government/economic-development/documents/housing/achdf-2025-addendum.pdf">Allegheny County 2025 HOME 2-bedroom elevator ceiling $261,595</a> · subsidy cap, not a bid</p>
      <p>PRT stops on the genesis sample only</p>
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
    if (disposeCity && path !== "/city") {
      disposeCity();
      disposeCity = null;
    }
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
    if (path === "/compare" || path.startsWith("/compare/")) return viewCompare(session);
    if (path === "/city") return viewCity(session);
    if (path === "/steer") return viewSteer(session);
    if (path === "/scorecard" || path.startsWith("/scorecard/")) return viewScorecard(session, parts[1]);
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
    stampClusters(SITES);
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
