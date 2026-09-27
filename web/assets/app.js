import { loadSession, saveSession, signIn, signOut, DEMO } from "./auth.js?v=cdc29";
import { answerQuery, ASK_PROMPTS } from "./ask.js?v=cdc53";
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
} from "./scoring.js?v=cdc51";
import {
  VERDICT_LABEL,
  buildPairing,
  affordHtml,
  investLotHtml,
  investBest,
  sortInvestLots,
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
  typicalHomeLine,
  typicalRentLine,
  walkActionsHtml,
  walkChipState,
  walkChipsOn,
  walkLine,
} from "./match.js?v=cdc56";
import {
  ASK_N,
  LAND_OPTS,
  SLIDES,
  detectClash,
  ensureAsk,
  restoreAsk,
  snapshotAsk,
  syncMix,
} from "./onboard.js?v=cdc31";

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
      <a class="pill" href="#/login">Sign in</a>
    </header>
    <main class="wrap">${inner}</main>
  `;
}

function layoutApp(session, inner, current) {
  const links = [
    ["/home", "Home"],
    ["/city", "City map"],
    ["/match", "Visits"],
    ["/invest", "Investment"],
    ["/steer", "Dashboard"],
    ["/pipeline", "Find a lot"],
    ["/compare", "Compare"],
    ["/scorecard", "This lot"],
    ["/briefing", "How it works"],
    ["/account", "Account"],
  ];
  return `
    <header class="nav">
      <a class="brand" href="#/home"><span class="mark"></span> Parcel Fit</a>
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
  sessionStorage.removeItem(VISIT_OK);
  const s = signIn({
    email: DEMO.email,
    password: DEMO.password,
    name: DEMO.name,
    org: DEMO.org,
  });
  go(s.onboarded ? "/home" : "/onboarding");
}

function viewLanding() {
  root.innerHTML = layoutPublic(`
    <section class="hero">
      <span class="eyebrow">Pittsburgh · empty lots the city owns</span>
      <h1>Which lots should you walk this week?</h1>
      <p class="lede">Pick a kind of building and a neighborhood. We show empty city lots that already allow it.</p>
      <div class="cta-row">
        <a class="pill" href="#/demo">Start as Hill District demo</a>
        <a class="pill ghost" href="#/login">Sign in</a>
      </div>
    </section>
    <div class="grid2">
      <article class="card">
        <p class="eyebrow">Use it to</p>
        <h3>Find empty lots where you work</h3>
        <p class="muted">The city owns thousands of vacant lots. You choose the neighborhoods you will actually visit.</p>
      </article>
      <article class="card">
        <p class="eyebrow">Use it to</p>
        <h3>See if a house is already allowed</h3>
        <p class="muted">Some lots already allow a two-family house or a small apartment. Those are the ones worth walking first.</p>
      </article>
      <article class="card">
        <p class="eyebrow">Use it to</p>
        <h3>Look at the city in 3D</h3>
        <p class="muted">Spin the map. Color lots by flood, steep hills, trees, or a nearby bus stop.</p>
      </article>
      <article class="card">
        <p class="eyebrow">Use it to</p>
        <h3>Ask if building here could pay for itself</h3>
        <p class="muted">We show what nearby homes sell for, what this empty lot might cost, and a simple build cost. Help from a housing subsidy only if you still come up short.</p>
      </article>
    </div>
    <p class="footer">City vacant-lot records, recent empty-lot sales, and typical nearby home prices.</p>
  `);
}

function viewLogin() {
  root.innerHTML = layoutPublic(`
    <div class="auth-box card">
      <p class="eyebrow">Sign in</p>
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
      sessionStorage.removeItem(VISIT_OK);
      if (s.onboarded && s.missionSet) persistWalk(s);
      saveSession(s);
      go(s.onboarded ? "/home" : "/onboarding");
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
    persistWalk(s);
    saveSession(s);
    markVisitOk();
    go("/home");
    render();
  };
}

function siteById(id) {
  const want = String(id || "").trim();
  if (!want) return null;
  const pinHit = SITES.find((s) => String(s.pin || "") === want);
  if (pinHit) return pinHit;
  const compact = want.replace(/^pin-/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const pinCompact = SITES.find((s) => String(s.pin || "").replace(/[^a-z0-9]/gi, "").toUpperCase() === compact);
  if (pinCompact) return pinCompact;
  const hits = SITES.filter((s) => s.site_id === want);
  if (hits.length === 1) return hits[0];
  return null;
}

function pinWalk(session, siteId, typology) {
  const site = siteById(siteId);
  if (!session || !site) return null;
  const t = typology && TYPOLOGIES.includes(typology) ? typology : leadTypeFor(site, session);
  session.extraWalks = [
    ...(session.extraWalks || []).filter((x) => x.siteId !== site.site_id && x.siteId !== site.pin),
    { siteId: site.site_id, typology: t },
  ];
  session.lastSiteId = site.site_id;
  session.visitsAsked = true;
  return { site, typology: t };
}

function goWalk(session, siteId, typology) {
  const pinned = pinWalk(session, siteId, typology);
  if (!pinned) return;
  saveSession(session);
  go(`/match/${pinned.site.site_id}/${pinned.typology}`);
}

function lotOptionLabel(s) {
  const pin = String(s.pin || "").trim();
  const tail = pin ? `PIN ${pin}` : "";
  return [s.address, s.neighborhood_name, tail].filter(Boolean).join(" · ");
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

function persistWalk(session) {
  ensureAsk(session);
  const types = missionTypesOf(session);
  session.lastWalk = {
    at: new Date().toISOString(),
    types: typeListLabel(types),
    places: placesLabel(session),
    typeIds: [...types],
    placesList: session.missionAllCity ? [] : [...(session.missionPlaces || [])],
    allCity: Boolean(session.missionAllCity || !(session.missionPlaces || []).length),
    forSale: session.missionForSale !== false,
    byRight: session.missionByRight !== false,
    land: [...(session.askLand || [])],
    ask: snapshotAsk(session),
  };
}

function walkPromptHtml(session) {
  if (!session.missionSet) {
    return `<article class="card home-prompt">
      <p class="eyebrow">This week's walk</p>
      <h2 class="serif">No walk is saved yet</h2>
      <p>The map shows every empty city lot. Tell us what you want to build and where, so Visits knows which ones to staff.</p>
      <div class="cta-row">
        <button class="pill" id="walk-set" type="button">Set this week's walk</button>
        <a class="pill ghost" href="#/city">Open city map</a>
      </div>
    </article>`;
  }
  const saved = session.lastWalk;
  const types = saved?.types || typeListLabel(missionTypesOf(session));
  const places = saved?.places || placesLabel(session);
  const landLabs = (saved?.land || session.askLand || [])
    .map((v) => LAND_OPTS.find((o) => o.v === v)?.lab || v)
    .filter(Boolean);
  const tags = [
    ...missionTypesOf(session).map((t) => TYPOLOGY_LABELS[t] || t),
    ...(session.missionAllCity || !(session.missionPlaces || []).length
      ? ["All Pittsburgh"]
      : (session.missionPlaces || []).slice(0, 3)),
  ]
    .map((lab) => `<span class="tag tag-info">${lab}</span>`)
    .join("");
  const sale =
    (saved ? saved.forSale : session.missionForSale !== false)
      ? "You asked for lots listed for sale when the file says so."
      : "Sale status is not required on this cut.";
  const landP = landLabs.length ? ` Public path: ${landLabs.join(", ")}.` : "";
  const asked = visitConfirmed();
  const title = asked
    ? `You are staffing ${types} in ${places}.`
    : `Still walking ${types} in ${places}?`;
  const keepBtn = asked
    ? ""
    : `<button class="pill" id="walk-keep" type="button">Yes, keep this</button>`;
  return `<article class="card home-prompt">
    <p class="eyebrow">This week's walk</p>
    <div class="tag-row">${tags}</div>
    <h2 class="serif">${title}</h2>
    <p>${sale}${landP} Saved on this computer. The map is the whole city. Visits is this week's list.</p>
    <div class="cta-row">
      ${keepBtn}
      <button class="pill ghost" id="walk-change" type="button">Change the walk</button>
      <a class="pill" href="#/city">Open city map</a>
      <a class="pill ghost" href="#/match">Open visits</a>
    </div>
  </article>`;
}

function bindHomePrompt(session) {
  const keep = document.getElementById("walk-keep");
  const change = document.getElementById("walk-change");
  const set = document.getElementById("walk-set");
  if (keep) {
    keep.onclick = () => {
      persistWalk(session);
      saveSession(session);
      markVisitOk();
      render();
    };
  }
  if (change) {
    change.onclick = () => {
      session.replayPriorities = true;
      session.missionSet = false;
      session.visitsAsked = false;
      saveSession(session);
      go("/onboarding?step=1");
    };
  }
  if (set) {
    set.onclick = () => go("/onboarding?step=1");
  }
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
    mapMatchIds: Array.isArray(s.mapMatchIds) ? s.mapMatchIds : null,
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
    <h2 class="serif">What are you walking this month?</h2>
    <p class="muted">Pick neighborhoods and a kind of building. We only list empty lots the city owns. Private lots are not in this file.</p>
    <article class="card">
      <h3>Where are you walking?</h3>
      <p class="muted">All of Pittsburgh, or only the neighborhoods you will actually visit.</p>
      <div id="places" class="chip-row"></div>
      <label>More neighborhoods</label>
      <select id="more">
        <option value="">Add another</option>
        ${places.map((n) => `<option value="${n}">${n}</option>`).join("")}
      </select>
    </article>
    <article class="card" style="margin-top:1rem">
      <h3>What do you want to put on the ground?</h3>
      <p class="muted">A house, a small apartment, a shop, or a workplace. Pick at least one.</p>
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
    persistWalk(session);
    saveSession(session);
    markVisitOk();
    go("/home");
    render();
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

function walkFilterBar(session) {
  const w = walkChipState(session);
  const types = missionTypesOf(session);
  const typeBtns = [
    `<button type="button" class="choice chip${!w.type ? " on" : ""}" data-walk-type="">Any type</button>`,
    ...types.map(
      (t) =>
        `<button type="button" class="choice chip${w.type === t ? " on" : ""}" data-walk-type="${t}">${TYPOLOGY_LABELS[t]}</button>`
    ),
  ];
  const landBtns = [
    `<button type="button" class="choice chip${!w.land ? " on" : ""}" data-walk-land="">Any path</button>`,
    ...LAND_OPTS.map(
      (o) =>
        `<button type="button" class="choice chip${w.land === o.v ? " on" : ""}" data-walk-land="${o.v}">${o.lab}</button>`
    ),
  ];
  const flags = [
    ["walkSkipFlood", w.skipFlood, "Hide flood"],
    ["walkSkipSteep", w.skipSteep, "Hide hillside"],
    ["walkSkipHot", w.skipHot, "Hide hotter lots"],
    ["walkLihtcNear", w.lihtcNear, "Near LIHTC"],
    ["walkTrees", w.trees, "More street trees"],
  ];
  return `<div class="card walk-filters">
    <p class="eyebrow">Cut this week's list</p>
    <div class="chip-row">${typeBtns.join("")}</div>
    <div class="chip-row">${landBtns.join("")}</div>
    <div class="chip-row">${flags
      .map(
        ([key, on, lab]) =>
          `<button type="button" class="choice chip${on ? " on" : ""}" data-walk-flag="${key}">${lab}</button>`
      )
      .join("")}${walkChipsOn(session) ? `<button type="button" class="choice chip" data-walk-clear>Clear chips</button>` : ""}</div>
  </div>`;
}

function bindWalkFilters() {
  document.querySelectorAll("[data-walk-type]").forEach((btn) => {
    btn.onclick = () => {
      const s = loadSession();
      s.walkType = btn.dataset.walkType || "";
      saveSession(s);
      render();
    };
  });
  document.querySelectorAll("[data-walk-land]").forEach((btn) => {
    btn.onclick = () => {
      const s = loadSession();
      s.walkLand = btn.dataset.walkLand || "";
      saveSession(s);
      render();
    };
  });
  document.querySelectorAll("[data-walk-flag]").forEach((btn) => {
    btn.onclick = () => {
      const s = loadSession();
      const key = btn.dataset.walkFlag;
      s[key] = !s[key];
      saveSession(s);
      render();
    };
  });
  const wipe = document.querySelector("[data-walk-clear]");
  if (wipe) {
    wipe.onclick = () => {
      const s = loadSession();
      s.walkType = "";
      s.walkLand = "";
      s.walkSkipFlood = false;
      s.walkSkipSteep = false;
      s.walkSkipHot = false;
      s.walkLihtcNear = false;
      s.walkTrees = false;
      saveSession(s);
      render();
    };
  }
}

function visitDeck(session) {
  const filters = readFilters();
  const { pairings } = deckPairings(SITES, session, filters);
  const rankedWalk = applyVisitMemory(
    filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings,
    session
  );
  return currentWalks(SITES, session, rankedWalk).map((p) =>
    p.tradeoffs ? p : buildPairing(p.site, p.typology, session)
  );
}

function viewMatch(session) {
  if (!session.missionSet) return viewMission(session);
  const hash = location.hash.replace(/^#/, "");
  const segs = hash.split("/").filter(Boolean);
  if (segs[0] === "match" && segs[1]) {
    pinWalk(session, segs[1], segs[2]);
    saveSession(session);
  }
  if (!session.visitsAsked) return viewVisited(session);
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/match");
    bindSignOut();
    return;
  }
  const filters = readFilters();
  const { pairings } = deckPairings(SITES, session, filters);
  const rankedWalk = applyVisitMemory(
    filters.byRight ? pairings.filter((p) => p.verdict === "go") : pairings,
    session
  );
  const visible = visitDeck(session);
  let featured;
  if (segs[0] === "match" && segs[1]) {
    const site = siteById(segs[1]);
    if (site) featured = buildPairing(site, segs[2] || leadTypeFor(site, session), session);
  }
  if (!featured) {
    featured = visible[0] || featuredPairing(rankedWalk, session.lastPairing);
  }
  if (featured && !visible.some((p) => p.site.site_id === featured.site.site_id)) {
    visible.unshift(featured);
  } else if (featured) {
    const idxHit = visible.findIndex((p) => p.site.site_id === featured.site.site_id);
    if (idxHit > 0) {
      visible.splice(idxHit, 1);
      visible.unshift(featured);
    } else if (idxHit === 0) visible[0] = featured;
  }
  if (!visible.length) {
    const chipEmpty = walkChipsOn(session);
    root.innerHTML = layoutApp(
      session,
      `
      ${walkFilterBar(session)}
      <h2 class="serif">${chipEmpty ? "Nothing matches these chips" : "Nothing to walk under this month's answers"}</h2>
      <p class="muted">${chipEmpty ? "Clear the chips or loosen one. This week's walk is still the month's cut." : `${placesLabel(session)} has no matching for-sale by-right pairings for ${typeListLabel(missionTypesOf(session))}${(session.lotVisits || []).some((v) => !v.prefer) ? ", or you already walked the rest." : "."}${(session.mapMatchIds || []).length ? " The map cut is also on." : ""}`}</p>
      ${chipEmpty ? "" : `<button class="pill" id="retarget" type="button">Change this month's cut</button>`}
      ${(session.mapMatchIds || []).length ? `<button class="pill ghost" id="clear-map-cut" type="button">Clear map filters</button>` : ""}
    `,
      "/match"
    );
    bindSignOut();
    bindWalkFilters();
    const retarget = document.getElementById("retarget");
    if (retarget) {
      retarget.onclick = () => {
        session.missionSet = false;
        session.visitsAsked = false;
        saveSession(session);
        render();
      };
    }
    const wipe = document.getElementById("clear-map-cut");
    if (wipe) {
      wipe.onclick = () => {
        session.mapFilters = {};
        session.mapMatchIds = null;
        saveSession(session);
        render();
      };
    }
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
      <p class="muted">${placesLabel(session)} · ${typeListLabel(missionTypesOf(session))}${session.missionForSale !== false ? " · for sale" : ""}${session.missionByRight !== false ? " · already allowed" : ""}${(session.mapMatchIds || []).length ? ` · ${session.mapMatchIds.length} lots from the map` : ""} · <a href="#/invest">See if a sale could cover a build</a></p>
    ${walkFilterBar(session)}
    <p><button class="pill ghost" id="retarget" type="button">Change this month's cut</button>${(session.mapMatchIds || []).length ? ` <button class="pill ghost" id="clear-map-cut" type="button">Clear map filters</button>` : ""}</p>

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
      <p class="muted">Lots you added sit first, then this week's cut. ${visible.length} on the list. Add more from the city map or Find a lot.</p>
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
              ${affordHtml(p.site, p.typology)}
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
  bindWalkFilters();
  document.getElementById("retarget").onclick = () => {
    session.missionSet = false;
    session.visitsAsked = false;
    saveSession(session);
    render();
  };
  const wipeCut = document.getElementById("clear-map-cut");
  if (wipeCut) {
    wipeCut.onclick = () => {
      session.mapFilters = {};
      session.mapMatchIds = null;
      saveSession(session);
      render();
    };
  }
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

function viewInvest(session) {
  if (!session.missionSet) return viewMission(session);
  if (!session.visitsAsked) return viewVisited(session);
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/invest");
    bindSignOut();
    return;
  }
  const visible = visitDeck(session);
  if (!visible.length) {
    root.innerHTML = layoutApp(
      session,
      `
      <p class="eyebrow">Investment</p>
      <h2 class="serif">No visits on this cut</h2>
      <p class="muted">Add lots on Visits or Find a lot first.</p>
      <div class="cta-row"><a class="pill" href="#/match">Your visits</a></div>
    `,
      "/invest"
    );
    bindSignOut();
    return;
  }
  const nGo = visible.filter((p) => investBest(p.site).rank === 0).length;
  const nWarn = visible.filter((p) => investBest(p.site).rank === 1).length;
  const nBad = visible.filter((p) => investBest(p.site).rank >= 2).length;
  const cut = ["go", "warn", "bad", "all"].includes(session.investCut) ? session.investCut : "go";
  const shown = visible.filter((p) => {
    const r = investBest(p.site).rank;
    if (cut === "go") return r === 0;
    if (cut === "warn") return r === 1;
    if (cut === "bad") return r >= 2;
    return true;
  });
  const sorted = sortInvestLots(shown);
  const emptyLine =
    cut === "go"
      ? "None of this week's lots have nearby sale covering land plus a simple house build. Try subsidy walk."
      : cut === "warn"
        ? "None of this week's lots have a gap a housing subsidy could fill."
        : cut === "bad"
          ? "None of this week's lots are too short even with the usual subsidy cap."
          : "Nothing on this cut.";
  const chips = [
    ["go", `Most possible (${nGo})`],
    ["warn", `Subsidy could close (${nWarn})`],
    ["bad", `Still too short (${nBad})`],
    ["all", `Every visit (${visible.length})`],
  ]
    .map(
      ([id, lab]) =>
        `<button type="button" class="choice chip${cut === id ? " on" : ""}" data-invest-cut="${id}">${lab}</button>`
    )
    .join("");
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Investment</p>
    <h2 class="serif">Could selling nearby homes cover a build?</h2>
    <p class="lede">Sorted by leftover after land plus a simple house build. Most possible means nearby sale already covers that stack on at least one house count, no subsidy required. We do not make construction cheaper to force a yes.</p>
    <div class="chip-row invest-cuts">${chips}</div>
    ${
      sorted.length
        ? `<div class="invest-stack">${sorted.map((p) => `<section class="card invest-tract">${investLotHtml(p)}</section>`).join("")}</div>`
        : `<p class="muted">${emptyLine}</p>`
    }
  `,
    "/invest"
  );
  bindSignOut();
  document.querySelectorAll("[data-invest-cut]").forEach((btn) => {
    btn.onclick = () => {
      session.investCut = btn.dataset.investCut;
      saveSession(session);
      viewInvest(session);
    };
  });
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
    <p class="muted">Search an address or tax ID. Each card says whether the lot fits this week.${(session.mapMatchIds || []).length ? ` Map filters are on: ${session.mapMatchIds.length} lots.` : ""}</p>
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
      mapMatchIds: session.mapMatchIds || null,
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
          pinWalk(session, id);
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
    ${typicalHomeLine(site) ? `<p>${typicalHomeLine(site)}</p>` : ""}
    ${typicalRentLine(site) ? `<p>${typicalRentLine(site)}</p>` : ""}
    ${affordHtml(site, visits[0]?.typology || "duplex")}
    ${walkActionsHtml(site)}
    <div class="cta-row"><button type="button" class="pill" id="add-walk">Add to visits</button></div>
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
  const addWalk = document.getElementById("add-walk");
  if (addWalk) addWalk.onclick = () => goWalk(session, site.site_id);
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
    <p class="muted">${mixPointer(raw)} Sliding is what you care about. The lot numbers stay the same.</p>
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
      <p class="eyebrow">Two kinds of building</p>
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
      ${affordHtml(pairing.site, pairing.typology)}
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
      <p class="muted">This is the brief. Same place, two kinds of building, and what we cannot claim.</p>
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
    <h2 class="serif">Would you put this lot on the list?</h2>
    <p class="muted">Tags, then what helps, then what to watch. Nearby home price, this lot's land, and a simple build cost. Open More if you want the source.</p>
    <label>Lot</label>
    <select id="op-site">${pool
      .map((s) => `<option value="${s.site_id}" ${s.site_id === site.site_id ? "selected" : ""}>${lotOptionLabel(s)}</option>`)
      .join("")}</select>
    ${scorecardHtml(site, SITES, session)}
    <div class="cta-row" style="margin-top:1rem">
      <button type="button" class="pill" id="op-walk">Add to visits</button>
      <button type="button" class="pill ghost" id="op-copy">Copy this lot</button>
      ${walkActionsHtml(site)}
    </div>
  `,
    "/scorecard"
  );
  document.getElementById("op-site").onchange = () => {
    const id = document.getElementById("op-site").value;
    go(`/scorecard/${id}`);
  };
  document.getElementById("op-walk").onclick = () => goWalk(session, site.site_id);
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

function viewHome(session) {
  if (session.missionSet && !session.lastWalk) {
    persistWalk(session);
    saveSession(session);
  }
  const first = (session.name || "there").split(" ")[0];
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Home</p>
    <h2 class="serif" style="margin:0.2rem 0 0.85rem">${greeting()}, ${first}.</h2>
    ${walkPromptHtml(session)}
    <div class="grid2 home-desk">
      <article class="card">
        <p class="eyebrow">3D map</p>
        <h3 class="serif">City map</h3>
        <p class="muted">See every empty city lot. Color by flood, hills, trees, or the bus.</p>
        <div class="cta-row"><a class="pill" href="#/city">Open city map</a></div>
      </article>
      <article class="card">
        <p class="eyebrow">This week's list</p>
        <h3 class="serif">Visits and investment</h3>
        <p class="muted">The list of lots to walk this week, and whether a nearby sale could cover a simple build.</p>
        <div class="cta-row">
          <a class="pill ghost" href="#/match">Open visits</a>
          <a class="pill ghost" href="#/invest">Investment</a>
        </div>
      </article>
    </div>
  `,
    "/home"
  );
  bindSignOut();
  bindHomePrompt(session);
}

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
    <div class="city-page">
      <p class="eyebrow">City map</p>
      <h2 class="serif">Empty city lots, in 3D</h2>
      <p class="muted">Pick a color. Click a class in the list to keep those lots. You can stack more than one filter.</p>
      <div class="city-desk">
        <div class="city-stage" id="city-stage"></div>
        <aside class="city-rail" id="city-rail"></aside>
      </div>
      <p class="small">Buildings are simple boxes. Flood marks the lot, not a surveyed flood map. Confirm on Google Maps before you walk.</p>
    </div>
  `,
    "/city"
  );
  bindSignOut();
  const host = document.getElementById("city-stage");
  const rail = document.getElementById("city-rail");
  import("./city3d.js?v=cdc52")
    .then(({ mountCity }) =>
      mountCity(host, {
        lots: SITES,
        visitIds: sites.map((s) => s.site_id),
        focusId: session.lastSiteId,
        weights: session.weights,
        types: missionTypesOf(session),
        rail,
        mapFilters: session.mapFilters || {},
        onPick: (id) => go(`/scorecard/${id}`),
        onAddVisit: (id) => goWalk(loadSession() || session, id),
        formatCompare: (a, b) => mapCompareHtml(a, b, session),
        onDossier: (id) => go(`/scorecard/${id}`),
        onFullCompare: (a, b) => go(`/compare/${a}/${b}`),
        onWeights: (w, types) => {
          const s = loadSession();
          const next = {
            ...s,
            weights: w,
            missionTypes: types,
            askTypes: types,
          };
          persistWalk(next);
          saveSession(next);
        },
        onMapFilter: (stacked, ids, goList) => {
          const s = loadSession();
          if (!s) return;
          if (goList && ids && ids.length) {
            ids.slice(0, 80).forEach((id) => pinWalk(s, id));
            saveSession({
              ...s,
              mapFilters: stacked,
              mapMatchIds: null,
            });
            const first = siteById(ids[0]);
            const t = first ? leadTypeFor(first, s) : "duplex";
            go(`/match/${first ? first.site_id : ids[0]}/${t}`);
            return;
          }
          saveSession({
            ...s,
            mapFilters: stacked,
            mapMatchIds: ids,
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

function dashPolar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function dashDonut(parts, holeLab, holeSub, extraClass = "") {
  const rows = (parts || [])
    .filter((p) => Number(p.n) > 0)
    .sort((a, b) => Number(b.n) - Number(a.n));
  const total = rows.reduce((s, p) => s + Number(p.n), 0) || 1;
  const cx = 54;
  const cy = 54;
  const r = 44;
  let deg = 0;
  const slices = rows
    .map((p) => {
      const span = (Number(p.n) / total) * 360;
      const start = deg;
      const end = deg + span;
      deg = end;
      if (span >= 359.9) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.hex}" />`;
      }
      const large = span > 180 ? 1 : 0;
      const [x1, y1] = dashPolar(cx, cy, r, start);
      const [x2, y2] = dashPolar(cx, cy, r, end);
      return `<path fill="${p.hex}" d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z"/>`;
    })
    .join("");
  const legend = rows
    .map((p) => {
      const share = Math.round((Number(p.n) / total) * 100);
      return `<li><i style="background:${p.hex}"></i><span>${p.lab}</span><b>${Number(p.n).toLocaleString()} · ${share}%</b></li>`;
    })
    .join("");
  return `<div class="dash-viz${extraClass ? ` ${extraClass}` : ""}">
    <div class="dash-pie-wrap">
      <svg class="dash-pie" viewBox="0 0 108 108" aria-hidden="true">${slices}<circle cx="${cx}" cy="${cy}" r="26" fill="#f7f5f2"/></svg>
      <div class="dash-pie-hole"><strong>${holeLab}</strong><span>${holeSub}</span></div>
    </div>
    <ul class="dash-leg">${legend}</ul>
  </div>`;
}

function dashCols(rows) {
  const max = Math.max(1, ...rows.map((r) => Number(r.n) || 0));
  const n = Math.max(1, rows.length);
  return `<div class="dash-cols" style="--dash-n:${n}">${rows
    .map((r) => {
      const h = Math.max(6, ((Number(r.n) || 0) / max) * 100);
        return `<div class="dash-col" style="--dash-hex:${r.hex}">
        <b>${Number(r.n).toLocaleString()}</b>
        <div class="dash-col-track"><i style="height:${h}%"></i></div>
        <span>${r.lab}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function viewSteer(session) {
  if (!SITES.length) {
    root.innerHTML = layoutApp(session, `<p class="muted">Loading lots…</p>`, "/steer");
    bindSignOut();
    return;
  }
  const c = steerCitywide(SITES);
  const n = (x) => Number(x).toLocaleString();
  const primary = [
    { n: c.primary.single_family, lab: "Single-family", hex: "#4c6fff" },
    { n: c.primary.duplex, lab: "Two-family", hex: "#7b6cc7" },
    { n: c.primary.small_multifamily, lab: "Small apt", hex: "#2a9d8f" },
    { n: c.primary.office, lab: "Office", hex: "#d69a30" },
    { n: c.primary.commercial, lab: "Commercial", hex: "#e76f51" },
    { n: c.primary.industrial, lab: "Industrial", hex: "#1c2430" },
    { n: c.primary.none, lab: "None of these", hex: "#c5d0dc" },
    { n: c.primary.unk, lab: "Missing", hex: "#e8e4dc" },
  ];
  const land = [
    { n: c.land["Public Sale"], lab: "Sale", hex: "#4c6fff" },
    { n: c.land["URA Transfer"], lab: "URA", hex: "#2a9d8f" },
    { n: c.land["PLB Transfer"], lab: "Land Bank", hex: "#d69a30" },
    { n: c.land["CDC Property Reserve"], lab: "CDC", hex: "#e76f51" },
    { n: c.land.other, lab: "Other", hex: "#8b95a5" },
  ];
  const tax = [
    { n: c.lihtcNear, lab: "Near", hex: "#d69a30" },
    { n: c.lihtcFar, lab: "Farther", hex: "#c5d0dc" },
    { n: c.lihtcUnk, lab: "Missing", hex: "#e8e4dc" },
  ];
  const uses = [
    { n: c.uses.single_family.yes, lab: "Single-family", hex: "#4c6fff" },
    { n: c.uses.duplex.yes, lab: "Two-family", hex: "#7b6cc7" },
    { n: c.uses.small_multifamily.yes, lab: "Small apt", hex: "#2a9d8f" },
    { n: c.uses.affordable.yes, lab: "Affordable", hex: "#4e9470" },
    { n: c.uses.office.yes, lab: "Office", hex: "#d69a30" },
    { n: c.uses.commercial.yes, lab: "Shop", hex: "#e76f51" },
    { n: c.uses.industrial.yes, lab: "Industrial", hex: "#1c2430" },
  ];
  const walk = [
    { n: c.flood, lab: "Flood", hex: "#3db5c8" },
    { n: c.steep, lab: "Hillside", hex: "#d69a30" },
    { n: c.heatHot, lab: "Hotter", hex: "#e76f51" },
    { n: c.treesMore, lab: "More trees", hex: "#1d4a32" },
  ];
  root.innerHTML = layoutApp(
    session,
    `
    <div class="dash-page">
    <p class="eyebrow">Dashboard</p>
    <h2 class="serif">${n(c.n)} city vacant lots</h2>
    <p class="muted">${n(c.n)} empty lots the city owns. Each pie is the whole list.</p>

    <div class="dash-pies">
      <article class="card">
        <h3 class="serif">By-right use</h3>
        <p class="small">One lot, one slice. Industrial first, then shop, office, homes. Affordable is not a district.</p>
        ${dashDonut(primary, n(c.n), "lots", "dash-viz-wide")}
      </article>
      <article class="card">
        <h3 class="serif">Land path</h3>
        <p class="small">Sale, URA, Land Bank, CDC. Sale is largest.</p>
        ${dashDonut(land, n(c.n), "lots")}
      </article>
      <article class="card">
        <h3 class="serif">Tax-credit apartments nearby</h3>
        <p class="small">Near is within a quarter mile of a mapped project.</p>
        ${dashDonut(tax, n(c.n), "lots")}
      </article>
    </div>

    <article class="card dash-panel">
      <div class="dash-split">
        <div>
          <h3 class="serif">Already allowed</h3>
          <p class="small">A lot can sit in more than one column. Affordable is income plus an allowed home.</p>
          ${dashCols(uses)}
        </div>
        <div>
          <h3 class="serif">Walk flags</h3>
          <p class="small">Heat is land surface, not air temperature.</p>
          ${dashCols(walk)}
        </div>
      </div>
    </article>

    <div class="cta-row">
      <a class="pill" href="#/city">Open city map</a>
      <a class="pill ghost" href="#/match">Your visits</a>
    </div>
    </div>
  `,
    "/steer"
  );
  bindSignOut();
}

function viewBriefing(session) {
  const sources = [
    {
      t: "City empty lots",
      p: "About 3,260 vacant city-owned parcels: address, PIN, neighborhood, sale status, who holds the land, lot size, and the map pin.",
      href: "https://data.wprdc.org/dataset/city-owned-properties",
      lab: "WPRDC City-Owned Properties",
    },
    {
      t: "Already allowed",
      p: "Walk / wait / skip comes from Pittsburgh Zoning Code Chapter 911, read against the district listed on the lot. Not a zoning certificate.",
      href: "https://ecode360.com/45476528",
      lab: "Chapter 911 primary uses",
    },
    {
      t: "Who lives nearby",
      p: "Census ACS 2024 5-year via Census Reporter: renters, rent, income, rent strain, and a tract typical home price when Zillow has no name match. Blank stays blank.",
      href: "https://censusreporter.org",
      lab: "Census Reporter ACS 2024 5-year",
    },
    {
      t: "Nearby finished homes",
      p: "Zillow Home Value Index by neighborhood, middle third of houses and condos, through August 2026. Typical finished home, not this vacant lot and not a Zestimate.",
      href: "https://www.zillow.com/research/data/",
      lab: "Zillow Research ZHVI",
    },
    {
      t: "Land from recent sales",
      p: "Allegheny County property sales on WPRDC for 2024 and 2025. Pittsburgh vacant (0-address) lots that sat on the market, scaled to this lot's square feet.",
      href: "https://data.wprdc.org/dataset/real-estate-sales",
      lab: "WPRDC real estate sales",
    },
    {
      t: "2012 tax-roll land",
      p: "County FAIRMARKETLAND kept as a footnote. Allegheny still uses a 2012 base year. Not the 2024-2025 sale rate.",
      href: "https://data.wprdc.org/dataset/property-assessments",
      lab: "WPRDC property assessments",
    },
    {
      t: "Housing subsidy ceiling",
      p: "HOME 2-bedroom max $261,595 for Pittsburgh. That is the most that program can put in, not the cost to build.",
      href: "https://www.alleghenycounty.us/files/assets/county/v/2/government/economic-development/documents/housing/achdf-2025-addendum.pdf",
      lab: "Allegheny County 2025 HOME addendum",
    },
    {
      t: "Bus",
      p: "Feet to the nearest Port Authority stop.",
      href: "https://data.wprdc.org/dataset/prt-of-allegheny-county-transit-stops",
      lab: "WPRDC PRT stops",
    },
    {
      t: "Flood",
      p: "Live FEMA flood map at the lot point. An older 2014 city extract on WPRDC is also joined. Confirm the printed flood map before you walk a river lot.",
      href: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
      lab: "FEMA National Flood Hazard Layer",
    },
    {
      t: "2014 city flood extract",
      p: "City of Pittsburgh flood-zone polygons on WPRDC. Older than the live FEMA layer. Kept as a second reading.",
      href: "https://data.wprdc.org/dataset/2014-fema-flood-zones",
      lab: "WPRDC 2014 flood zones",
    },
    {
      t: "Steep hills",
      p: "City polygons for 25% or steeper slope. Point in the polygon, not a surveyed grade.",
      href: "https://data.wprdc.org/dataset/25-or-greater-slope",
      lab: "WPRDC 25% slope",
    },
    {
      t: "Hotter ground",
      p: "Trust for Public Land Heat Severity USA 2023. Summer land surface versus the city mean. Not air temperature. Not a health score.",
      href: "https://www.tpl.org/heat-severity",
      lab: "TPL Heat Severity USA 2023",
    },
    {
      t: "Street trees",
      p: "City DPW tree inventory on WPRDC (last big refresh about 2020). Count within 400 feet, plus the city's tree carbon calculator on those trees, not on a new building.",
      href: "https://data.wprdc.org/dataset/city-trees",
      lab: "WPRDC city trees",
    },
    {
      t: "Tax-credit apartments nearby",
      p: "Distance to the nearest mapped HUD Low-Income Housing Tax Credit project in Pittsburgh. A map pin, not an award.",
      href: "https://www.huduser.gov/portal/datasets/lihtc.html",
      lab: "HUD LIHTC",
    },
    {
      t: "City map buildings",
      p: "Simple boxes from a Pittsburgh schematic 3D file. They show the street, not a survey of this vacant lot.",
      href: null,
      lab: "Pittsburgh schematic city model",
    },
  ];
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">How it works</p>
    <h2 class="serif">A walk list, not a verdict from the sky</h2>
    <p class="muted">You see what you get, what you give up, and what this file cannot answer. It does not tell you who gets the unit.</p>
    <div class="grid2">
      <article class="card"><h3>Already allowed?</h3><p class="muted">Walk / wait / skip is whether a two-family house or small apartment is already allowed on that lot.</p></article>
      <article class="card"><h3>Whose land?</h3><p class="muted">City sale, URA, Land Bank, or already held for a neighborhood group. Private lots are not in this file.</p></article>
      <article class="card"><h3>Who lives nearby?</h3><p class="muted">Census rent and income for the area. Blank if we do not have it. Not a waitlist.</p></article>
      <article class="card"><h3>Could a sale cover a build?</h3><p class="muted">Nearby home prices, this empty lot's land, and a simple build cost. A housing subsidy only if you still come up short.</p></article>
      <article class="card"><h3>Flood, hills, heat, trees</h3><p class="muted">Flood at the point, steep hills, hotter ground, street trees. Not air temperature. Not a new building's energy use.</p></article>
      <article class="card"><h3>Try Compare</h3><p class="muted">Two kinds of building on one lot. Move what you care about. Read what is in the file vs what you chose.</p></article>
    </div>
    <article class="card" style="margin-top:1.2rem">
      <h3>Where the numbers come from</h3>
      <p class="muted">Every public file this desk joined. Missing cells stay blank. We do not copy a neighbor tract. Simple build cost is $180 a square foot for a wood house. That last one is a mid-range assumption, not a bid, and not a public dataset.</p>
      <div class="source-list">
        ${sources
          .map(
            (s) => `<div class="source-row">
            <h4>${s.t}</h4>
            <p>${s.p}</p>
            ${s.href ? `<p><a href="${s.href}" target="_blank" rel="noopener">${s.lab}</a></p>` : `<p class="muted">${s.lab}</p>`}
          </div>`
          )
          .join("")}
      </div>
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
    if (path === "/match" || path.startsWith("/match/")) return viewMatch(session);
    if (path === "/invest") return viewInvest(session);
    if (path === "/pipeline") return viewPipeline(session);
    if (path === "/compare" || path.startsWith("/compare/")) return viewCompare(session);
    if (path === "/home") return viewHome(session);
    if (path === "/city") return viewCity(session);
    if (path === "/steer") return viewSteer(session);
    if (path === "/scorecard" || path.startsWith("/scorecard/")) return viewScorecard(session, parts[1]);
    if (path === "/briefing") return viewBriefing(session);
    if (path === "/account") return viewAccount(session);
    if (parts[0] === "sites" && parts[1]) return viewSite(session, parts[1]);
    viewHome(session);
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
