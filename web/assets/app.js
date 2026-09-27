import { loadSession, saveSession, signIn, signOut, DEMO } from "./auth.js";
import {
  FACTOR_LABELS,
  FACTORS,
  TYPOLOGY_LABELS,
  isUnknown,
  missingFields,
  ranked,
  readField,
  scoreSite,
} from "./scoring.js";
import {
  VERDICT_LABEL,
  buildPairing,
  deckPairings,
  featuredPairing,
  filterSites,
} from "./match.js";

const root = document.getElementById("app");
let SITES = [];

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  return { path: "/" + parts.join("/"), parts };
}

function go(path) {
  location.hash = path;
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
    ["/match", "Match"],
    ["/pipeline", "Pipeline"],
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
  `;
}

function bindSignOut() {
  const out = document.getElementById("out");
  if (!out) return;
  out.onclick = () => {
    signOut();
    go("/");
  };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function viewLanding() {
  root.innerHTML = layoutPublic(`
    <section class="hero">
      <span class="eyebrow">AI Horizons · Housing typology matchmaker</span>
      <h1>Match a CDC to a city-owned lot anywhere in Pittsburgh.</h1>
      <p class="lede">The live pool is vacant city-owned land from the WPRDC inventory, across dozens of neighborhoods. The first four lots were a Hill CDC sample, not the whole city. You set the weights. Missing Census data stays missing.</p>
      <div class="cta-row">
        <a class="pill" href="#/login">Start as Hill CDC demo</a>
        <a class="pill ghost" href="#/login">Create a workspace</a>
      </div>
    </section>
    <div class="bento">
      <article class="card">
        <p class="eyebrow">Inside the studio</p>
        <h3>Not a parcel search. A pairing desk.</h3>
        <p class="muted">You land on Match: organization × lot × ADU, duplex, or small multifamily. Pipeline is the bench. Compare is a second opinion. Nothing here is a permit.</p>
      </article>
      <article class="card">
        <p class="eyebrow">Integrity</p>
        <h3>Unknown is a state, not a zero.</h3>
        <p class="muted">ACS was pulled for two tracts that show up on Hill District lots. Other tracts stay blank. 849 Vista St is still in the set because its WPRDC tract does not match ACS 2024 5-year at all.</p>
      </article>
    </div>
    <section class="section">
      <h2>How a new staffer is onboarded</h2>
      <div class="grid3">
        <article class="card"><h3>1. Identity</h3><p class="muted">Name, CDC, and whether you are staff, planning, or advocacy.</p></article>
        <article class="card"><h3>2. Priorities</h3><p class="muted">Four weights: buildability, renters, cost burden, transit. A value judgment.</p></article>
        <article class="card"><h3>3. First parcel</h3><p class="muted">You leave onboarding on a real Hill District lot, not an empty dashboard.</p></article>
      </div>
    </section>
    <section class="section">
      <h2>Why four lots showed up first</h2>
      <p class="muted">Weekend constraint: prove the matcher on a CDC desk before scoring the whole dump. Centre Ave was the Hill corridor filter. CDC Property Reserve was the other. Vista was the integrity stress test. The Match screen now scores the citywide vacant city-owned pool (parks and hold-for-study lots left out on purpose).</p>
      <div class="grid2">
        ${SITES.filter((s) => s.genesis_sample === "yes")
          .map((s) => `<article class="card"><h3>${s.address}</h3><p class="muted">${s.neighborhood_name} · ${s.zoned_as} · genesis sample</p></article>`)
          .join("")}
      </div>
      <p class="muted" style="margin-top:1rem">${SITES.length} lots in the live file · ${new Set(SITES.map((s) => s.neighborhood_name).filter(Boolean)).size} neighborhoods.</p>
    </section>
    <p class="footer">Decision support only. Not a permit. Data: WPRDC City-Owned Properties, Pittsburgh Zoning Code Ch. 911, ACS 2024 5-year, PRT stops.</p>
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
        email: fd.get("email"),
        password: fd.get("password"),
        name: fd.get("name"),
        org: fd.get("org"),
      });
      go(s.onboarded ? "/match" : "/onboarding");
    } catch (err) {
      document.getElementById("err").textContent = err.message;
    }
  };
}

function viewOnboarding() {
  const s = sessionGuard(false);
  if (!s) return;
  const step = Number(new URLSearchParams(location.hash.split("?")[1] || "").get("step") || 1);
  const body = {
    1: `
      <h2 class="serif">Who is using this desk?</h2>
      <p class="muted">This shapes the home screen, not the math.</p>
      ${["cdc", "planner", "advocate", "journalist"]
        .map((role) => {
          const labels = { cdc: "CDC / nonprofit staff", planner: "City or county planning", advocate: "Community advocate", journalist: "Reporter or researcher" };
          return `<button class="choice ${s.role === role ? "on" : ""}" data-role="${role}">${labels[role]}</button>`;
        })
        .join("")}
    `,
    2: `
      <h2 class="serif">What should count when types compete?</h2>
      <p class="muted">These are your weights. They are not in the parcel file.</p>
      ${FACTORS.map(
        (k) => `<label>${FACTOR_LABELS[k]} (${s.weights[k]})</label><input type="range" min="0" max="100" name="${k}" value="${s.weights[k]}" />`
      ).join("")}
    `,
    3: `
      <h2 class="serif">One rule before you see scores</h2>
      <div class="card">
        <p>If a field is blank, Parcel Fit shows <strong>unknown</strong>. It will not fill Census from a nearby tract or score a missing factor as zero.</p>
        <p class="muted">849 Vista St is in the pipeline specifically because ACS does not match that WPRDC tract.</p>
      </div>
      <p class="muted">A planner still has to pull the official PLI / zoning record.</p>
    `,
    4: `
      <h2 class="serif">Your first parcel is ready</h2>
      <p class="muted">2523 Centre Ave, Middle Hill. URA transfer, vacant land, RM-M. After this you land on Match, a pairing of your CDC with this lot and a typology.</p>
      <article class="card"><h3>2523 CENTRE AVE</h3><p class="muted">Available for sale · 2,195 sq ft · duplex and small multifamily allowed by right in the use table. ADU is not a citywide use yet.</p></article>
    `,
  }[step];

  root.innerHTML = layoutPublic(`
    <div class="auth-box" style="max-width:560px">
      <div class="steps">${[1, 2, 3, 4].map((n) => `<div class="step-dot ${n <= step ? "on" : ""}"></div>`).join("")}</div>
      ${body}
      <div class="cta-row" style="margin-top:1.2rem">
        ${step > 1 ? `<button class="pill ghost" id="back">Back</button>` : ""}
        <button class="pill" id="next">${step === 4 ? "Enter the studio" : "Continue"}</button>
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
  FACTORS.forEach((k) => {
    const el = document.querySelector(`[name="${k}"]`);
    if (el) {
      el.oninput = () => {
        s.weights[k] = Number(el.value);
        saveSession(s);
        el.previousElementSibling.textContent = `${FACTOR_LABELS[k]} (${s.weights[k]})`;
      };
    }
  });
  const back = document.getElementById("back");
  if (back) back.onclick = () => go(`/onboarding?step=${step - 1}`);
  document.getElementById("next").onclick = () => {
    if (step < 4) {
      if (step === 1 && !s.role) s.role = "cdc";
      saveSession(s);
      go(`/onboarding?step=${step + 1}`);
    } else {
      s.onboarded = true;
      s.lastSiteId = "centre-2523";
      saveSession(s);
      go("/match");
    }
  };
}

function siteById(id) {
  return SITES.find((s) => s.site_id === id);
}

function viewHome(session) {
  return viewMatch(session);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function readFilters() {
  const s = loadSession() || {};
  return {
    neighborhood: s.filterNeighborhood || "all",
    status: s.filterStatus || "all",
    typology: s.filterTypology || "any",
    genesis: s.filterGenesis || "all",
    q: s.filterQ || "",
  };
}

function saveFilters(partial) {
  const s = loadSession();
  if (!s) return;
  Object.assign(s, partial);
  saveSession(s);
}

function viewMatch(session) {
  const filters = readFilters();
  const { filtered, pairings } = deckPairings(SITES, session, filters);
  const visible = pairings.slice(0, 36);
  const hash = location.hash.replace(/^#/, "");
  const segs = hash.split("/").filter(Boolean);
  let featured;
  if (segs[0] === "match" && segs[1] && segs[2]) {
    const site = siteById(segs[1]);
    if (site) featured = buildPairing(site, segs[2], session);
  }
  if (!featured) {
    featured = featuredPairing(visible.length ? visible : pairings, session.lastPairing) || pairings[0];
  }
  if (!featured) {
    root.innerHTML = layoutApp(session, `<p>No lots match these filters.</p>`, "/match");
    bindSignOut();
    return;
  }
  session.lastPairing = featured.key;
  session.lastSiteId = featured.site.site_id;
  saveSession(session);
  const idx = visible.findIndex((p) => p.key === featured.key);
  const next = visible[(Math.max(idx, 0) + 1) % Math.max(visible.length, 1)] || featured;
  const goCount = pairings.filter((p) => p.verdict === "go").length;
  const scoreLabel = isUnknown(featured.score) ? "n/a" : featured.score;
  const type = TYPOLOGY_LABELS[featured.typology];
  const neighborhoods = uniqueSorted(SITES.map((s) => s.neighborhood_name));
  const statuses = uniqueSorted(SITES.map((s) => s.current_status));

  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Matchmaker · ${SITES.length} city-owned vacant lots</p>
    <h2 class="serif" style="margin:0.2rem 0 0.35rem">${greeting()}, ${session.name.split(" ")[0]}. Pair your CDC with a lot, then a housing type.</h2>
    <p class="muted">${filtered.length} lots in this cut · ${goCount} by-right pairings under the type filter. Parks, greenways, and hold-for-study inventory are out of the pool.</p>

    <article class="card genesis">
      <p class="eyebrow">Why these lots exist</p>
      <p>The first four addresses (Centre Ave ×2, Cliff St, Vista St) were a <strong>Hill CDC weekend sample</strong>: corridor lots plus a CDC Property Reserve, plus Vista because ACS tract 42003563200 does not exist in ACS 2024 5-year. They are not the only options. The live file is vacant city-owned land citywide from WPRDC (${SITES.length} lots, ${neighborhoods.length} neighborhoods). ACS renter and burden numbers are filled only where we already pulled a tract (mostly 501 and 305). Other tracts stay unknown.</p>
    </article>

    <div class="filters card">
      <label>Neighborhood</label>
      <select id="fn">
        <option value="all">All Pittsburgh (${SITES.length})</option>
        ${neighborhoods.map((n) => `<option value="${n}" ${filters.neighborhood === n ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <label>Status</label>
      <select id="fs">
        <option value="all">Any status</option>
        ${statuses.map((n) => `<option value="${n}" ${filters.status === n ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <label>Type</label>
      <select id="ft">
        ${[
          ["any", "Best type per lot"],
          ["duplex", "Duplex"],
          ["small_multifamily", "Small multifamily"],
          ["adu", "ADU"],
        ]
          .map(([v, lab]) => `<option value="${v}" ${filters.typology === v ? "selected" : ""}>${lab}</option>`)
          .join("")}
      </select>
      <label>Set</label>
      <select id="fg">
        <option value="all" ${filters.genesis === "all" ? "selected" : ""}>Citywide pool</option>
        <option value="sample" ${filters.genesis === "sample" ? "selected" : ""}>Hill CDC genesis four</option>
      </select>
      <label>Search</label>
      <input id="fq" placeholder="Address or PIN" value="${filters.q || ""}" />
    </div>

    <article class="card match-hero">
      <div class="match-top">
        <span class="verdict ${featured.verdict}">${VERDICT_LABEL[featured.verdict]}</span>
        <span class="small">Rule-based score ${scoreLabel} · not a permit${featured.site.genesis_sample === "yes" ? " · genesis sample" : ""}</span>
      </div>
      <div class="pair-stack">
        <div><span class="small">Organization</span><strong>${session.org}</strong></div>
        <div class="pair-x" aria-hidden="true">×</div>
        <div><span class="small">City lot</span><strong>${featured.site.address}</strong><p class="muted" style="margin:0.2rem 0 0">${featured.site.neighborhood_name} · ${featured.site.zoned_as} · ${featured.site.current_status}</p></div>
        <div class="pair-x" aria-hidden="true">×</div>
        <div><span class="small">Housing type</span><strong>${type}</strong></div>
      </div>
      <p class="brief">${featured.brief}</p>
      <h3 class="serif">Why this is the way it is</h3>
      <ol class="why-list">
        ${featured.why.map((line) => `<li>${line}</li>`).join("")}
      </ol>
      <div class="cta-row">
        <button class="pill" id="next-match">Next pairing</button>
        <a class="pill ghost" href="#/sites/${featured.site.site_id}">Full ranking on this lot</a>
      </div>
      <div class="ask">
        <p class="eyebrow">Ask the matchmaker</p>
        <p class="small">These answers only rephrase numbers already on this card.</p>
        <div class="cta-row">
          <button class="pill ghost ask-btn" data-ask="zoning">Why this zoning call?</button>
          <button class="pill ghost ask-btn" data-ask="unknown">What is unknown?</button>
          <button class="pill ghost ask-btn" data-ask="weights">Did my weights change this?</button>
          <button class="pill ghost ask-btn" data-ask="genesis">Why this lot is in the file?</button>
        </div>
        <p class="muted" id="ask-out"></p>
      </div>
    </article>

    <section class="section" style="padding-top:1.4rem">
      <h3 class="serif">Deck</h3>
      <p class="muted">Showing ${visible.length} of ${pairings.length} lots in this cut, sorted by-right then score. Narrow neighborhood if you want the whole list on screen.</p>
      <div class="match-deck">
        ${visible
          .map((p) => {
            const on = p.key === featured.key ? "on" : "";
            const n = isUnknown(p.score) ? "n/a" : p.score;
            return `<a class="card site-link deck-card ${on}" href="#/match/${p.site.site_id}/${p.typology}">
              <span class="verdict ${p.verdict}">${p.verdict}</span>
              <h3>${TYPOLOGY_LABELS[p.typology]}</h3>
              <p class="muted">${p.site.address}<br>${p.site.neighborhood_name}</p>
              <p class="n">${n}</p>
            </a>`;
          })
          .join("")}
      </div>
    </section>
  `,
    "/match"
  );
  bindSignOut();
  const apply = () => {
    saveFilters({
      filterNeighborhood: document.getElementById("fn").value,
      filterStatus: document.getElementById("fs").value,
      filterTypology: document.getElementById("ft").value,
      filterGenesis: document.getElementById("fg").value,
      filterQ: document.getElementById("fq").value,
    });
    render();
  };
  ["fn", "fs", "ft", "fg"].forEach((id) => {
    document.getElementById(id).onchange = apply;
  });
  let t;
  document.getElementById("fq").oninput = () => {
    clearTimeout(t);
    t = setTimeout(apply, 250);
  };
  document.getElementById("next-match").onclick = () => go(`/match/${next.site.site_id}/${next.typology}`);
  const askOut = document.getElementById("ask-out");
  document.querySelectorAll(".ask-btn").forEach((btn) => {
    btn.onclick = () => {
      const gaps = missingFields(featured.site);
      const map = {
        zoning: featured.why[0],
        unknown: gaps.length
          ? `${featured.site.address} is missing ${gaps.join(", ")}. Unknown factors are omitted from the composite so a gap cannot tank a type.`
          : "No ACS or slope gaps on this pairing besides what the why list already named.",
        weights: featured.why[featured.why.length - 1],
        genesis:
          featured.site.genesis_sample === "yes"
            ? "This address is one of the four Hill CDC weekend lots: Centre Ave corridor or CDC Property Reserve, with Vista kept because ACS does not resolve. The citywide vacant dump is the rest of the deck."
            : `This lot is in the WPRDC city-owned vacant pool (${featured.site.inventory_type}, ${featured.site.current_status}, ${featured.site.neighborhood_name}). Parks and hold-for-study rows were excluded.`,
      };
      askOut.textContent = map[btn.dataset.ask] || "";
    };
  });
}

function viewPipeline(session) {
  const filters = readFilters();
  const lots = filterSites(SITES, filters);
  const show = lots.slice(0, 48);
  const neighborhoods = uniqueSorted(SITES.map((s) => s.neighborhood_name));
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Pipeline</p>
    <h2 class="serif">City-owned vacant lots in this workspace</h2>
    <p class="muted">${lots.length} of ${SITES.length} lots. Same WPRDC dump as Match. Showing ${show.length}.</p>
    <div class="filters card">
      <label>Neighborhood</label>
      <select id="fn"><option value="all">All Pittsburgh</option>${neighborhoods
        .map((n) => `<option value="${n}" ${filters.neighborhood === n ? "selected" : ""}>${n}</option>`)
        .join("")}</select>
      <label>Search</label>
      <input id="fq" value="${filters.q || ""}" placeholder="Address" />
    </div>
    <div class="grid2">
      ${show
        .map((s) => {
          const r = ranked(scoreSite(s, session.weights))[0];
          const gaps = missingFields(s);
          return `<a class="card site-link" href="#/sites/${s.site_id}">
          <p class="small">${s.neighborhood_name} · ${s.zoned_as}</p>
          <h3>${s.address}</h3>
          <p class="muted">${s.current_status} · ${s.inventory_type}</p>
          <p>Lead: <strong>${TYPOLOGY_LABELS[r[0]]}</strong> ${isUnknown(r[1]) ? "n/a" : r[1]}</p>
          ${gaps.length ? `<span class="gap">${gaps.length} unknown field(s)</span>` : ""}
          ${s.genesis_sample === "yes" ? `<span class="gap">genesis sample</span>` : ""}
        </a>`;
        })
        .join("")}
    </div>
  `,
    "/pipeline"
  );
  bindSignOut();
  const apply = () => {
    saveFilters({
      filterNeighborhood: document.getElementById("fn").value,
      filterQ: document.getElementById("fq").value,
    });
    render();
  };
  document.getElementById("fn").onchange = apply;
  let t;
  document.getElementById("fq").oninput = () => {
    clearTimeout(t);
    t = setTimeout(apply, 250);
  };
}

function viewSite(session, id) {
  const site = siteById(id) || SITES[0];
  session.lastSiteId = site.site_id;
  saveSession(session);
  const result = scoreSite(site, session.weights);
  const order = ranked(result);
  const gaps = missingFields(site);
  const winner = order[0][0];
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">${site.neighborhood_name}</p>
    <h2 class="serif">${site.address}</h2>
    <p class="muted">${site.zoned_as} · ${site.parc_sq_ft} sq ft · ${site.current_status}. Not a permit.</p>
    <p style="font-size:1.4rem;font-family:EB Garamond,Georgia,serif">
      ${TYPOLOGY_LABELS[winner]} ranks first${isUnknown(order[0][1]) ? "" : ` at ${order[0][1]}`} under your weights.
    </p>
    ${
      readField(site, `zoning_allows_${winner}`) === "not_allowed"
        ? `<p class="muted">That lead is among types that are <strong>not allowed</strong> on this lot. The rank is a relative score, not a green light.</p>`
        : ""
    }
    <div class="score-row">
      ${order
        .map(([t, sc], i) => {
          const miss = isUnknown(sc);
          return `<div class="score ${i === 0 ? "top" : ""} ${miss ? "missing" : ""}"><div class="small">0${i + 1}</div><div>${TYPOLOGY_LABELS[t]}</div><div class="n">${miss ? "n/a" : sc}</div></div>`;
        })
        .join("")}
    </div>
    ${gaps.length ? `<p>${gaps.map((g) => `<span class="gap">${g}</span>`).join("")}</p><p class="small">Unknown factors are dropped from the composite.</p>` : ""}
    <div class="card" style="margin-top:1rem">
      <h3>Why ${TYPOLOGY_LABELS[winner]} leads</h3>
      <ul>
        <li>Zoning: ADU ${readField(site, "zoning_allows_adu")}; duplex ${readField(site, "zoning_allows_duplex")}; small multifamily ${readField(site, "zoning_allows_small_multifamily")}.</li>
        <li>Lot ${readField(site, "parc_sq_ft")} sq ft. Transit ${readField(site, "transit_distance_ft")} ft to nearest PRT stop.</li>
        <li>ACS renter share ${readField(site, "tract_renter_share")}; rent burden ${readField(site, "tract_rent_burden_pct")}.</li>
      </ul>
    </div>
    <p><a href="#/pipeline">Back to pipeline</a></p>
  `,
    "/pipeline"
  );
  bindSignOut();
}

function viewCompare(session) {
  const a = siteById(session.lastSiteId) || SITES[0];
  const b = SITES.find((s) => s.site_id !== a.site_id) || SITES[1];
  const optionPool = (() => {
    const filtered = filterSites(SITES, readFilters());
    const keep = new Map();
    [a, b, ...filtered.slice(0, 150)].forEach((s) => keep.set(s.site_id, s));
    return [...keep.values()];
  })();
  function col(site) {
    const order = ranked(scoreSite(site, session.weights));
    return `<article class="card"><h3>${site.address}</h3>
      ${order.map(([t, sc]) => `<p>${TYPOLOGY_LABELS[t]} · ${isUnknown(sc) ? "n/a" : sc}</p>`).join("")}</article>`;
  }
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Compare</p>
    <h2 class="serif">Same weights, two lots</h2>
    <div class="grid2" id="cols">${col(a)}${col(b)}</div>
    <div class="grid2" style="margin-top:1rem">
      <div><label>Left</label><select id="sa">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === a.site_id ? "selected" : ""}>${s.address} (${s.neighborhood_name})</option>`).join("")}</select></div>
      <div><label>Right</label><select id="sb">${optionPool.map((s) => `<option value="${s.site_id}" ${s.site_id === b.site_id ? "selected" : ""}>${s.address} (${s.neighborhood_name})</option>`).join("")}</select></div>
    </div>
  `,
    "/compare"
  );
  const redraw = () => {
    const left = siteById(document.getElementById("sa").value);
    const right = siteById(document.getElementById("sb").value);
    document.getElementById("cols").innerHTML = col(left) + col(right);
  };
  document.getElementById("sa").onchange = redraw;
  document.getElementById("sb").onchange = redraw;
  bindSignOut();
}

function viewBriefing(session) {
  root.innerHTML = layoutApp(
    session,
    `
    <p class="eyebrow">Briefing room</p>
    <h2 class="serif">What Parcel Fit will not say</h2>
    <div class="grid2">
      <article class="card"><h3>Not completions</h3><p class="muted">An allowed typology is not a built unit or an occupied home.</p></article>
      <article class="card"><h3>Not rent</h3><p class="muted">No HUD FMR or listing join in this weekend build.</p></article>
      <article class="card"><h3>Not emissions</h3><p class="muted">Transit feet is a proxy. It is not a carbon model.</p></article>
      <article class="card"><h3>Not legal advice</h3><p class="muted">Chapter 911 reading still needs Planning / OneStopPGH.</p></article>
    </div>
    <article class="card" style="margin-top:1rem">
      <h3>Sources</h3>
      <p><a href="https://data.wprdc.org/dataset/city-owned-properties">WPRDC City-Owned Properties</a> (Data Use Agreement on that page)</p>
      <p><a href="https://ecode360.com/45476528">Pittsburgh Zoning Code Ch. 911</a></p>
      <p>ACS 2024 5-year via Census Reporter (tracts 42003050100 and 42003030500)</p>
      <p>WPRDC PRT stops for nearest-stop distance</p>
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
      <p>Role: ${session.role || "unset"}</p>
      <p>Onboarded: ${session.onboarded ? "yes" : "no"}</p>
      <p>Default weights: ${FACTORS.map((k) => `${FACTOR_LABELS[k]} ${session.weights[k]}`).join(" · ")}</p>
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
  const { path, parts } = route();
  if (path === "/") return viewLanding();
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
}

async function boot() {
  const res = await fetch("./data/sites.json");
  SITES = await res.json();
  window.addEventListener("hashchange", render);
  render();
}

boot();
