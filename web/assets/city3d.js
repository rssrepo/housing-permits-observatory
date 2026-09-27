import * as THREE from "three";
import {
  FACTORS,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  isUnknown,
  normalizeWeights,
  scoreSite,
} from "./scoring.js?v=cdc26";
import { primaryUse, useAllows } from "./uses.js?v=cdc26";

const LAYERS = [
  { id: "mix", lab: "Mix score" },
  { id: "visits", lab: "Your visits" },
  { id: "path", lab: "Whose land" },
  { id: "flood", lab: "Flood" },
  { id: "heat", lab: "Surface heat" },
  { id: "slope", lab: "Hillside" },
  { id: "build", lab: "By-right homes" },
  { id: "use", lab: "Land use" },
  { id: "shade", lab: "Street trees" },
  { id: "credit", lab: "LIHTC nearby" },
];

const FACTOR_SHORT = {
  feasibility: "Allowed",
  demand_fit: "Renters",
  affordability_impact: "Strain",
  displacement_risk: "Overpay",
  climate_proxy: "Bus",
};

const LEGEND = {
  mix: [
    { id: "high", hex: "#4c6fff", lab: "Stronger mix" },
    { id: "mid", hex: "#8aa6ff", lab: "Middle" },
    { id: "low", hex: "#c5d0dc", lab: "Weaker mix" },
    { id: "unk", hex: "#e8e4dc", lab: "Too little data" },
  ],
  visits: [
    { id: "visit", hex: "#4c6fff", lab: "On your visits list" },
    { id: "other", hex: "#1c2430", lab: "Other city vacant lots" },
  ],
  path: [
    { id: "ura", hex: "#2a9d8f", lab: "URA" },
    { id: "plb", hex: "#e9c46a", lab: "Land Bank" },
    { id: "cdc", hex: "#e76f51", lab: "CDC reserve" },
    { id: "sale", hex: "#4c6fff", lab: "Public sale" },
    { id: "other", hex: "#8b95a5", lab: "Other public" },
  ],
  flood: [
    { id: "sfha", hex: "#3db5c8", lab: "Special flood hazard (NFHL)" },
    { id: "ok", hex: "#c5d0dc", lab: "Not SFHA / not flagged" },
  ],
  heat: [
    { id: "hot", hex: "#e76f51", lab: "Hotter than city mean (4–5)" },
    { id: "mid", hex: "#d69a30", lab: "Near the mean (3)" },
    { id: "cool", hex: "#4c6fff", lab: "Cooler than city mean (1–2)" },
    { id: "unk", hex: "#e8e4dc", lab: "No pixel" },
  ],
  slope: [
    { id: "steep", hex: "#d69a30", lab: "Inside 25%+ slope polygons" },
    { id: "ok", hex: "#c5d0dc", lab: "Not in those polygons" },
  ],
  build: [
    { id: "both", hex: "#4e9470", lab: "Two-family and small apartment" },
    { id: "duplex", hex: "#4c6fff", lab: "Two-family only" },
    { id: "mf", hex: "#7b6cc7", lab: "Small apartment only" },
    { id: "none", hex: "#c5d0dc", lab: "Neither by-right" },
  ],
  shade: [
    { id: "more", hex: "#1d4a32", lab: "More street trees within 400 ft" },
    { id: "few", hex: "#d8e4d4", lab: "Fewer or none" },
  ],
  use: [
    { id: "affordable", hex: "#4e9470", lab: "Affordable in play" },
    { id: "single_family", hex: "#4c6fff", lab: "Single-family" },
    { id: "duplex", hex: "#7b6cc7", lab: "Two-family" },
    { id: "small_multifamily", hex: "#2a9d8f", lab: "Small apartment" },
    { id: "office", hex: "#d69a30", lab: "Offices" },
    { id: "commercial", hex: "#e76f51", lab: "Commercial" },
    { id: "industrial", hex: "#1c2430", lab: "Industrial" },
    { id: "none", hex: "#c5d0dc", lab: "None of these / other district" },
  ],
  credit: [
    { id: "near", hex: "#d69a30", lab: "LIHTC within a quarter mile" },
    { id: "far", hex: "#c5d0dc", lab: "Farther or unmapped" },
  ],
};

function pathColor(site) {
  const inv = String(site.inventory_type || "");
  if (inv === "URA Transfer") return 0x2a9d8f;
  if (inv === "PLB Transfer") return 0xe9c46a;
  if (inv === "CDC Property Reserve") return 0xe76f51;
  if (inv === "Public Sale") return 0x4c6fff;
  return 0x8b95a5;
}

function buildColor(site) {
  const d = String(site.zoning_allows_duplex || "") === "by_right";
  const m = String(site.zoning_allows_small_multifamily || "") === "by_right";
  if (d && m) return 0x4e9470;
  if (d) return 0x4c6fff;
  if (m) return 0x7b6cc7;
  return 0xc5d0dc;
}

function shadeColor(site) {
  const n = Number(site.trees_400ft);
  const t = Number.isFinite(n) ? Math.max(0, Math.min(1, n / 16)) : 0;
  return new THREE.Color(0xd8e4d4).lerp(new THREE.Color(0x1d4a32), t).getHex();
}

function bucketFor(layer, site, visitIds, mixById, sub) {
  if (layer === "mix") return (mixById.get(site.site_id) || {}).bucket || "unk";
  if (layer === "visits") return visitIds.has(site.site_id) ? "visit" : "other";
  if (layer === "path") {
    const inv = String(site.inventory_type || "");
    if (inv === "URA Transfer") return "ura";
    if (inv === "PLB Transfer") return "plb";
    if (inv === "CDC Property Reserve") return "cdc";
    if (inv === "Public Sale") return "sale";
    return "other";
  }
  if (layer === "flood") return String(site.flood_sfha || "").toUpperCase() === "T" ? "sfha" : "ok";
  if (layer === "heat") {
    const h = Number(site.heat_severity);
    if (!Number.isFinite(h)) return "unk";
    if (h >= 4) return "hot";
    if (h <= 2) return "cool";
    return "mid";
  }
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? "steep" : "ok";
  if (layer === "build") {
    const d = String(site.zoning_allows_duplex || "") === "by_right";
    const m = String(site.zoning_allows_small_multifamily || "") === "by_right";
    if (d && m) return "both";
    if (d) return "duplex";
    if (m) return "mf";
    return "none";
  }
  if (layer === "use") {
    if (sub === "affordable") return useAllows(site, "affordable") === "by_right" ? "affordable" : "miss";
    if (sub && sub !== "none") return useAllows(site, sub) === "by_right" ? sub : "miss";
    if (sub === "none") {
      const p = primaryUse(site);
      return p === "none" || p === "unk" ? "none" : "miss";
    }
    return primaryUse(site);
  }
  if (layer === "shade") return Number(site.trees_400ft) >= 8 ? "more" : "few";
  if (layer === "credit") {
    const ft = Number(site.lihtc_ft);
    return Number.isFinite(ft) && ft <= 1320 ? "near" : "far";
  }
  return "other";
}

function mixHex(n) {
  if (n == null || n < 0) return 0xe8e4dc;
  const t = Math.max(0, Math.min(1, n / 100));
  return new THREE.Color(0xc5d0dc).lerp(new THREE.Color(0x4c6fff), t).getHex();
}

function useHex(site) {
  const id = primaryUse(site);
  const hex = {
    industrial: 0x1c2430,
    commercial: 0xe76f51,
    office: 0xd69a30,
    small_multifamily: 0x2a9d8f,
    duplex: 0x7b6cc7,
    single_family: 0x4c6fff,
    none: 0xc5d0dc,
    unk: 0xe8e4dc,
  };
  return hex[id] || 0xc5d0dc;
}

function heatColor(site) {
  const h = Number(site.heat_severity);
  if (!Number.isFinite(h)) return 0xe8e4dc;
  if (h >= 5) return 0xe76f51;
  if (h >= 4) return 0xd69a30;
  if (h >= 3) return 0xc5d0dc;
  if (h >= 2) return 0x7aa0c8;
  return 0x4c6fff;
}

function colorFor(layer, site, visitIds, mixById, sub) {
  if (layer === "mix") return mixHex((mixById.get(site.site_id) || {}).n);
  if (layer === "visits") return visitIds.has(site.site_id) ? 0x4c6fff : 0x1c2430;
  if (layer === "path") return pathColor(site);
  if (layer === "flood") return String(site.flood_sfha || "").toUpperCase() === "T" ? 0x3db5c8 : 0xc5d0dc;
  if (layer === "heat") return heatColor(site);
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? 0xd69a30 : 0xc5d0dc;
  if (layer === "build") return buildColor(site);
  if (layer === "use") {
    if (sub === "affordable") return useAllows(site, "affordable") === "by_right" ? 0x4e9470 : 0xc5d0dc;
    return useHex(site);
  }
  if (layer === "shade") return shadeColor(site);
  if (layer === "credit") {
    const ft = Number(site.lihtc_ft);
    return Number.isFinite(ft) && ft <= 1320 ? 0xd69a30 : 0xc5d0dc;
  }
  return 0x1c2430;
}

function clusterScales(plotted, visits) {
  const cell = 0.00075;
  const buckets = new Map();
  plotted.forEach((s, i) => {
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    const key = `${Math.round(lat / cell)}_${Math.round(lon / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  return plotted.map((s, i) => {
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    const cx = Math.round(lat / cell);
    const cy = Math.round(lon / cell);
    let n = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const hit = buckets.get(`${cx + dx}_${cy + dy}`);
        if (!hit) continue;
        n += hit.length;
      }
    }
    n = Math.max(0, n - 1);
    const visit = visits.has(s.site_id) ? 1.35 : 1;
    return visit * (1 + Math.min(8, n) * 0.12);
  });
}

function scoreLots(lots, weights, types) {
  const mixById = new Map();
  const pool = types?.length ? types : TYPOLOGIES;
  for (const site of lots) {
    const result = scoreSite(site, weights);
    let pick = null;
    for (const t of pool) {
      const block = result.typologies[t];
      if (!block) continue;
      const raw = useAllows(site, t);
      const rank = raw === "by_right" ? 0 : raw === "not_allowed" ? 2 : 1;
      const n = isUnknown(block.composite.score) ? -1 : Number(block.composite.score);
      if (!pick || rank < pick.rank || (rank === pick.rank && n > pick.n)) {
        pick = { t, n, rank };
      }
    }
    const n = pick ? pick.n : -1;
    const bucket = n < 0 ? "unk" : n >= 62 ? "high" : n >= 38 ? "mid" : "low";
    mixById.set(site.site_id, { n, bucket, t: pick?.t });
  }
  return mixById;
}

function radarSvg(weights) {
  const n = normalizeWeights(weights);
  const cx = 54;
  const cy = 56;
  const r = 34;
  const pts = FACTORS.map((k, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / FACTORS.length;
    const mag = 0.18 + 0.82 * (n[k] || 0);
    return [cx + r * mag * Math.cos(a), cy + r * mag * Math.sin(a)];
  });
  const ring = FACTORS.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / FACTORS.length;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  const labels = FACTORS.map((k, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / FACTORS.length;
    const x = cx + (r + 13) * Math.cos(a);
    const y = cy + (r + 13) * Math.sin(a);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${FACTOR_SHORT[k]}</text>`;
  }).join("");
  return `<svg class="algo-radar" viewBox="0 0 108 112" aria-hidden="true">
    <polygon class="algo-ring" points="${ring}" />
    <polygon class="algo-fill" points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" ")}" />
    ${labels}
  </svg>`;
}

export async function mountCity(
  host,
  {
    lots = [],
    visitIds = [],
    focusId = null,
    onPick = null,
    weights = {},
    types = [],
    onWeights = null,
    formatCompare = null,
    onDossier = null,
    onFullCompare = null,
    rail = null,
  } = {}
) {
  const visits = visitIds instanceof Set ? visitIds : new Set(visitIds);
  let mixWeights = Object.fromEntries(FACTORS.map((k) => [k, Number(weights[k] ?? 20)]));
  let mixTypes = (types || []).filter((t) => TYPOLOGIES.includes(t));
  if (!mixTypes.length) mixTypes = [...TYPOLOGIES];
  let mixById = new Map();

  const meta = await (await fetch("./data/pitt-height.json")).json();
  const buf = await (await fetch("./data/pitt-height.u16")).arrayBuffer();
  const u16 = new Uint16Array(buf);
  const n = meta.n;

  host.innerHTML = "";
  host.style.position = "relative";
  if (rail) rail.innerHTML = "";
  const dock = rail || host;
  const hud = document.createElement("div");
  hud.className = "city-hud";
  hud.innerHTML = `<div class="city-pick">
      <button type="button" class="choice chip on" data-mode="compare">Compare two</button>
      <button type="button" class="choice chip" data-mode="open">Open this lot</button>
    </div>
    <div class="city-layers">${LAYERS.map(
      (l, i) => `<button type="button" class="choice chip${i === 0 ? " on" : ""}" data-layer="${l.id}">${l.lab}</button>`
    ).join("")}</div><div class="city-legend" id="city-legend"></div>`;
  dock.appendChild(hud);
  const algo = document.createElement("div");
  algo.className = "city-algo";
  dock.appendChild(algo);
  const duel = document.createElement("div");
  duel.className = "city-duel";
  duel.hidden = true;
  dock.appendChild(duel);
  const tip = document.createElement("div");
  tip.className = "city-tip";
  tip.id = "city-tip";
  tip.hidden = true;
  host.appendChild(tip);
  const legendEl = hud.querySelector("#city-legend");
  let layer = "mix";
  let sub = "";
  let clickMode = "compare";
  let pickA = null;
  let pickB = null;
  let dragMoved = false;

  function paintLegend() {
    legendEl.innerHTML = (LEGEND[layer] || [])
      .map(
        (row) =>
          `<button type="button" class="city-swatch${sub === row.id ? " on" : ""}" data-sub="${row.id}"><i style="background:${row.hex}"></i>${row.lab}</button>`
      )
      .join("");
    legendEl.querySelectorAll("[data-sub]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        sub = sub === btn.dataset.sub ? "" : btn.dataset.sub;
        applyView();
        paintLegend();
      };
    });
  }

  let mixTimer = 0;
  function pushMix() {
    layer = "mix";
    sub = "";
    hud.querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", b.dataset.layer === "mix"));
    const n = normalizeWeights(mixWeights);
    const radar = algo.querySelector(".algo-radar");
    if (radar) radar.outerHTML = radarSvg(mixWeights);
    algo.querySelectorAll("[data-wk]").forEach((input) => {
      const b = input.parentElement.querySelector("b");
      if (b) b.textContent = `${Math.round((n[input.dataset.wk] || 0) * 100)}%`;
    });
    clearTimeout(mixTimer);
    mixTimer = setTimeout(() => {
      mixById = scoreLots(plotted, mixWeights, mixTypes);
      applyView();
      paintLegend();
      if (onWeights) onWeights({ ...mixWeights }, [...mixTypes]);
    }, 50);
  }

  function paintAlgo() {
    const n = normalizeWeights(mixWeights);
    const rows = FACTORS.map(
      (k) => `<label class="algo-row">${FACTOR_SHORT[k]}
        <input type="range" min="0" max="100" step="5" data-wk="${k}" value="${Math.round(mixWeights[k] || 0)}" />
        <b>${Math.round((n[k] || 0) * 100)}%</b>
      </label>`
    ).join("");
    const typeBtns = TYPOLOGIES.map(
      (t) =>
        `<button type="button" class="choice chip${mixTypes.includes(t) ? " on" : ""}" data-type="${t}">${TYPOLOGY_LABELS[t]}</button>`
    ).join("");
    algo.innerHTML = `<p class="eyebrow">Typology mix</p>
      <div class="algo-split">
        ${radarSvg(mixWeights)}
        <div class="algo-sliders">${rows}</div>
      </div>
      <p class="algo-types">${typeBtns}</p>`;
    algo.querySelectorAll("[data-wk]").forEach((input) => {
      input.oninput = () => {
        mixWeights[input.dataset.wk] = Number(input.value);
        pushMix();
      };
    });
    algo.querySelectorAll("[data-type]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const t = btn.dataset.type;
        if (mixTypes.includes(t) && mixTypes.length === 1) return;
        mixTypes = mixTypes.includes(t) ? mixTypes.filter((x) => x !== t) : [...mixTypes, t];
        layer = "mix";
        sub = "";
        hud.querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", b.dataset.layer === "mix"));
        mixById = scoreLots(plotted, mixWeights, mixTypes);
        paintAlgo();
        applyView();
        paintLegend();
        if (onWeights) onWeights({ ...mixWeights }, [...mixTypes]);
      };
    });
  }

  function paintDuel() {
    host.classList.toggle("has-duel", clickMode === "compare" && Boolean(pickA));
    if (clickMode !== "compare" || !pickA) {
      duel.hidden = true;
      duel.innerHTML = "";
      placePins();
      return;
    }
    duel.hidden = false;
    if (!pickB) {
      duel.innerHTML = `<p class="eyebrow">First lot</p>
        <p class="duel-addr">${pickA.address || pickA.site_id}</p>
        <p class="algo-note">${pickA.neighborhood_name || ""} · click a second peg</p>
        <div class="cta-row"><button type="button" class="pill ghost" data-clear>Clear</button></div>`;
    } else if (formatCompare) {
      duel.innerHTML = formatCompare(pickA, pickB);
    } else {
      duel.innerHTML = `<p class="duel-addr">${pickA.address} vs ${pickB.address}</p>
        <div class="cta-row"><button type="button" class="pill ghost" data-clear>Clear</button></div>`;
    }
    placePins();
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe0f2);
  scene.fog = new THREE.Fog(0xcfe0f2, 90, 260);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const geo = new THREE.PlaneGeometry(120, 120, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const cLow = new THREE.Color(0xd5e6d4);
  const cHigh = new THREE.Color(0x4c6fff);
  for (let i = 0; i < pos.count; i += 1) {
    const col = i % n;
    const row = Math.floor(i / n);
    const h = u16[row * n + col] / 65535;
    pos.setY(i, h * 18);
    const c = cLow.clone().lerp(cHigh, h);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  );
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x8aa0b8, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  const bMeta = await (await fetch("./data/pitt-buildings.json")).json();
  const bBuf = await (await fetch("./data/pitt-buildings.bin")).arrayBuffer();
  const bArr = new Float32Array(bBuf);
  const bCount = bMeta.count;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xf4f1ea, transparent: true, opacity: 0.72 });
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, bCount);
  const dummy = new THREE.Object3D();
  const lon0 = meta.lon_west;
  const lonW = meta.lon_east - meta.lon_west;
  const lat0 = meta.lat_south;
  const latW = meta.lat_north - meta.lat_south;
  for (let i = 0; i < bCount; i += 1) {
    const lon = bArr[i * 5];
    const lat = bArr[i * 5 + 1];
    const dx = bArr[i * 5 + 2];
    const dy = bArr[i * 5 + 3];
    const hm = bArr[i * 5 + 4];
    const x = ((lon - lon0) / lonW - 0.5) * 120;
    const z = (0.5 - (lat - lat0) / latW) * 120;
    const col = Math.max(0, Math.min(n - 1, Math.round(((x + 60) / 120) * (n - 1))));
    const row = Math.max(0, Math.min(n - 1, Math.round(((z + 60) / 120) * (n - 1))));
    const ground = (u16[row * n + col] / 65535) * 18;
    const sx = Math.max(0.12, (dx / lonW) * 120);
    const sz = Math.max(0.12, (dy / latW) * 120);
    const sy = Math.max(0.25, hm / 28);
    dummy.position.set(x, ground + sy / 2, z);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    boxes.setMatrixAt(i, dummy.matrix);
  }
  boxes.instanceMatrix.needsUpdate = true;
  scene.add(boxes);

  function lonLatToLocal(lon, lat, lift = 0.55) {
    const x = ((lon - meta.lon_west) / (meta.lon_east - meta.lon_west) - 0.5) * 120;
    const z = (0.5 - (lat - meta.lat_south) / (meta.lat_north - meta.lat_south)) * 120;
    const col = Math.max(0, Math.min(n - 1, Math.round(((x + 60) / 120) * (n - 1))));
    const row = Math.max(0, Math.min(n - 1, Math.round(((z + 60) / 120) * (n - 1))));
    const y = (u16[row * n + col] / 65535) * 18 + lift;
    return new THREE.Vector3(x, y, z);
  }

  const plotted = lots.filter((s) => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude)));
  mixById = scoreLots(plotted, mixWeights, mixTypes);
  const pegGeo = new THREE.CylinderGeometry(0.42, 0.42, 1, 8);
  const pegMat = new THREE.MeshLambertMaterial();
  const pegs = new THREE.InstancedMesh(pegGeo, pegMat, plotted.length);
  pegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const pegColor = new THREE.Color();
  const scales = clusterScales(plotted, visits);
  const hidden = new Uint8Array(plotted.length);
  function applyView() {
    plotted.forEach((site, i) => {
      const show = !sub || bucketFor(layer, site, visits, mixById, sub) === sub;
      hidden[i] = show ? 0 : 1;
      const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.2);
      const h = 1.1 * scales[i];
      dummy.position.set(p.x, p.y + h / 2, p.z);
      dummy.scale.set(show ? scales[i] : 0.001, show ? h : 0.001, show ? scales[i] : 0.001);
      dummy.updateMatrix();
      pegs.setMatrixAt(i, dummy.matrix);
      pegColor.setHex(colorFor(layer, site, visits, mixById, sub));
      pegs.setColorAt(i, pegColor);
    });
    pegs.instanceMatrix.needsUpdate = true;
    if (pegs.instanceColor) pegs.instanceColor.needsUpdate = true;
    discs.visible = layer === "flood" && floodIdx.length > 0 && (!sub || sub === "sfha");
    if (focusMesh && focusSite) {
      focusMesh.visible = !sub || bucketFor(layer, focusSite, visits, mixById, sub) === sub;
    }
  }
  scene.add(pegs);

  const floodIdx = plotted
    .map((s, i) => (String(s.flood_sfha || "").toUpperCase() === "T" ? i : -1))
    .filter((i) => i >= 0);
  const discGeo = new THREE.CircleGeometry(1, 24);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x3db5c8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const discs = new THREE.InstancedMesh(discGeo, discMat, Math.max(floodIdx.length, 1));
  floodIdx.forEach((idx, i) => {
    const site = plotted[idx];
    const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.12);
    dummy.position.copy(p);
    dummy.scale.set(1.6, 1, 1.6);
    dummy.updateMatrix();
    discs.setMatrixAt(i, dummy.matrix);
  });
  discs.instanceMatrix.needsUpdate = true;
  discs.visible = false;
  scene.add(discs);

  let focusMesh = null;
  let focusBaseY = 0;
  const focusSite = plotted.find((s) => s.site_id === focusId) || plotted.find((s) => visits.has(s.site_id));
  if (focusSite) {
    focusMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 3.2, 10),
      new THREE.MeshBasicMaterial({ color: 0x4c6fff })
    );
    const p = lonLatToLocal(Number(focusSite.longitude), Number(focusSite.latitude), 2.4);
    focusMesh.position.copy(p);
    focusBaseY = p.y;
    scene.add(focusMesh);
  }
  const pinGeo = new THREE.ConeGeometry(0.78, 3.6, 10);
  const pinA = new THREE.Mesh(pinGeo, new THREE.MeshBasicMaterial({ color: 0x4c6fff }));
  const pinB = new THREE.Mesh(pinGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xe76f51 }));
  pinA.visible = false;
  pinB.visible = false;
  scene.add(pinA, pinB);
  let pinABaseY = 0;
  let pinBBaseY = 0;

  function placePins() {
    const put = (mesh, site, storeY) => {
      if (!site) {
        mesh.visible = false;
        return 0;
      }
      const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 2.5);
      mesh.position.copy(p);
      mesh.visible = true;
      return p.y;
    };
    pinABaseY = put(pinA, pickA);
    pinBBaseY = put(pinB, pickB);
    if (focusMesh) focusMesh.visible = !(pickA || pickB);
  }
  applyView();
  paintLegend();
  paintAlgo();

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let theta = 0.7;
  let phi = 0.85;
  let radius = 118;
  const target = new THREE.Vector3(0, 4, 0);
  if (focusSite) {
    const p = lonLatToLocal(Number(focusSite.longitude), Number(focusSite.latitude));
    target.set(p.x, 4, p.z);
    radius = 42;
  }

  function placeCam() {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    camera.lookAt(target);
  }
  placeCam();

  function size() {
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 420;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  hud.querySelectorAll("[data-layer]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      layer = btn.dataset.layer;
      sub = "";
      hud.querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", b === btn));
      applyView();
      paintLegend();
    };
  });
  hud.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      clickMode = btn.dataset.mode;
      hud.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === btn));
      if (clickMode !== "compare") {
        pickA = null;
        pickB = null;
      }
      paintDuel();
    };
  });
  duel.onclick = (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-clear]")) {
      pickA = null;
      pickB = null;
      paintDuel();
      return;
    }
    const dossier = e.target.closest("[data-dossier]");
    if (dossier && onDossier) onDossier(dossier.dataset.dossier);
    const full = e.target.closest("[data-full]");
    if (full && pickA && pickB && onFullCompare) onFullCompare(pickA.site_id, pickB.site_id);
  };

  function hitLot(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const flags = [pinA, pinB, focusMesh].filter((m) => m && m.visible);
    const pinHit = flags.length ? ray.intersectObjects(flags)[0] : null;
    if (pinHit) {
      if (pinHit.object === pinA && pickA) return pickA;
      if (pinHit.object === pinB && pickB) return pickB;
      if (pinHit.object === focusMesh && focusSite) return focusSite;
    }
    const hit = ray.intersectObject(pegs)[0];
    if (!hit || hit.instanceId == null) return null;
    if (hidden[hit.instanceId]) return null;
    return plotted[hit.instanceId] || null;
  }

  function onDown(e) {
    if (e.target.closest(".city-hud, .city-algo, .city-duel")) return;
    dragging = true;
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
  }
  function onMove(e) {
    if (dragging) {
      if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 14) dragMoved = true;
      theta -= (e.clientX - lastX) * 0.008;
      phi = Math.max(0.15, Math.min(1.35, phi - (e.clientY - lastY) * 0.008));
      lastX = e.clientX;
      lastY = e.clientY;
      placeCam();
      return;
    }
    const site = hitLot(e);
    if (!site) {
      tip.hidden = true;
      renderer.domElement.style.cursor = "grab";
      return;
    }
    renderer.domElement.style.cursor = "pointer";
    const rect = host.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${e.clientX - rect.left + 12}px`;
    tip.style.top = `${e.clientY - rect.top + 12}px`;
    const bits = [site.address, site.neighborhood_name, site.inventory_type].filter(Boolean);
    const mix = mixById.get(site.site_id);
    if (layer === "mix" && mix) {
      bits.push(mix.n < 0 ? "mix unknown" : `mix ${Math.round(mix.n)}${mix.t ? ` · ${TYPOLOGY_LABELS[mix.t] || mix.t}` : ""}`);
    }
    if (clickMode === "compare") {
      bits.push(!pickA ? "click for lot A" : !pickB || pickA.site_id === site.site_id ? "click for lot B" : "click to start a new pair");
    }
    tip.textContent = bits.join(" · ");
  }
  function applyPick(site) {
    if (!site) return;
    if (clickMode === "compare") {
      if (!pickA) {
        pickA = site;
        pickB = null;
      } else if (!pickB && site.site_id !== pickA.site_id) {
        pickB = site;
      } else if (pickB && site.site_id === pickA.site_id) {
        pickB = null;
      } else if (pickB && site.site_id === pickB.site_id) {
        return;
      } else {
        pickA = site;
        pickB = null;
      }
      paintDuel();
      return;
    }
    if (onPick) onPick(site.site_id);
  }
  function onUp(e) {
    const was = dragging;
    dragging = false;
    if (!was) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 18) return;
    if (e.target.closest?.(".city-hud, .city-algo, .city-duel")) return;
    applyPick(hitLot(e));
  }
  function onWheel(e) {
    e.preventDefault();
    radius = Math.max(18, Math.min(220, radius + e.deltaY * 0.08));
    placeCam();
  }
  function onClick(e) {
    if (e.target.closest(".city-hud, .city-algo, .city-duel")) return;
  }

  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("click", onClick);

  let raf = 0;
  const t0 = performance.now();
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (focusMesh) {
      focusMesh.position.y = focusBaseY + Math.sin((now - t0) / 420) * 0.35;
    }
    if (pinA.visible) pinA.position.y = pinABaseY + Math.sin((now - t0) / 380) * 0.32;
    if (pinB.visible) pinB.position.y = pinBBaseY + Math.sin((now - t0) / 340) * 0.32;
    if (discs.visible && floodIdx.length) {
      const pulse = 1.4 + Math.sin((now - t0) / 380) * 0.25;
      floodIdx.forEach((idx, i) => {
        const site = plotted[idx];
        const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.12);
        dummy.position.copy(p);
        dummy.scale.set(pulse, 1, pulse);
        dummy.updateMatrix();
        discs.setMatrixAt(i, dummy.matrix);
      });
      discs.instanceMatrix.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }
  tick(t0);

  return () => {
    clearTimeout(mixTimer);
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.domElement.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("click", onClick);
    renderer.dispose();
    geo.dispose();
    mesh.material.dispose();
    boxGeo.dispose();
    boxMat.dispose();
    boxes.dispose();
    pegGeo.dispose();
    pegMat.dispose();
    pegs.dispose();
    discGeo.dispose();
    discMat.dispose();
    discs.dispose();
    if (focusMesh) {
      focusMesh.geometry.dispose();
      focusMesh.material.dispose();
    }
    pinGeo.dispose();
    pinA.material.dispose();
    pinB.geometry.dispose();
    pinB.material.dispose();
    host.innerHTML = "";
    if (rail) rail.innerHTML = "";
  };
}
