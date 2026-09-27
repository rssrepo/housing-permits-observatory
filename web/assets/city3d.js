import * as THREE from "three";
import {
  FACTORS,
  TYPOLOGIES,
  TYPOLOGY_LABELS,
  isUnknown,
  normalizeWeights,
  scoreSite,
} from "./scoring.js?v=cdc30";
import { primaryUse, useAllows } from "./uses.js?v=cdc30";
import { LAYERS, LEGEND, bucketOf, layerLabel, passesMapFilters, swatchLabel, activeStack } from "./mapfilter.js?v=cdc39";

const FACTOR_SHORT = {
  feasibility: "Allowed",
  demand_fit: "Renters",
  affordability_impact: "Strain",
  displacement_risk: "Overpay",
  climate_proxy: "Bus",
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

function bucketFor(layer, site, visitIds, mixById) {
  return bucketOf(layer, site, { visitIds, mixById });
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
  if (layer === "mix") {
    const b = (mixById.get(site.site_id) || {}).bucket || "unk";
    if (b === "high") return 0x4c6fff;
    if (b === "mid") return 0x8aa6ff;
    if (b === "low") return 0xc5d0dc;
    return 0xe8e4dc;
  }
  if (layer === "visits") return visitIds.has(site.site_id) ? 0x4c6fff : 0x1c2430;
  if (layer === "path") return pathColor(site);
  if (layer === "flood") return String(site.flood_sfha || "").toUpperCase() === "T" ? 0x3db5c8 : 0xc5d0dc;
  if (layer === "heat") return heatColor(site);
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? 0xd69a30 : 0xc5d0dc;
  if (layer === "use" || layer === "build") {
    if ((sub || "").split(",").includes("affordable") || sub === "affordable") {
      return useAllows(site, "affordable") === "by_right" ? 0x4e9470 : 0xc5d0dc;
    }
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
    onMapFilter = null,
    mapFilters = null,
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
  hud.innerHTML = `<div class="city-layers">${LAYERS.map(
      (l, i) => `<button type="button" class="choice chip${i === 0 ? " on" : ""}" data-layer="${l.id}">${l.lab}</button>`
    ).join("")}</div>
    <p class="algo-note">Color is one layer. Click a legend class to keep those pegs. By-right lets you pick more than one type: a lot stays if it already allows any of them. Mix score is four classes. Stack other layers too.</p>
    <div class="city-legend" id="city-legend"></div>
    <div class="city-stack" id="city-stack"></div>
    <div class="city-hits" id="city-hits"></div>`;
  dock.appendChild(hud);
  const algo = document.createElement("div");
  algo.className = "city-algo";
  dock.appendChild(algo);
  const duel = document.createElement("div");
  duel.className = "city-duel";
  duel.hidden = true;
  dock.appendChild(duel);
  const tools = document.createElement("div");
  tools.className = "city-tools";
  tools.innerHTML = `<p class="eyebrow">When you click a peg</p>
    <p class="algo-note">Not a filter. Compare two lots on the map, or open one lot card.</p>
    <div class="city-pick">
      <button type="button" class="choice chip on" data-mode="compare">Compare two</button>
      <button type="button" class="choice chip" data-mode="open">Open this lot</button>
    </div>`;
  dock.appendChild(tools);
  const tip = document.createElement("div");
  tip.className = "city-tip";
  tip.id = "city-tip";
  tip.hidden = true;
  host.appendChild(tip);
  const legendEl = hud.querySelector("#city-legend");
  const stackEl = hud.querySelector("#city-stack");
  const hitsEl = hud.querySelector("#city-hits");
  let layer = "mix";
  let stacked = { ...(mapFilters || {}) };
  if (stacked.build) {
    const mapped = [];
    (stacked.build || []).forEach((id) => {
      if (id === "both" || id === "duplex") mapped.push("duplex");
      if (id === "both" || id === "mf") mapped.push("small_multifamily");
      if (id === "none") mapped.push("none");
    });
    stacked.use = [...new Set([...(stacked.use || []), ...mapped])];
    delete stacked.build;
  }
  let clickMode = "compare";
  let pickA = null;
  let pickB = null;
  let dragMoved = false;

  function paintLegend() {
    const on = new Set(stacked[layer] || []);
    legendEl.innerHTML = (LEGEND[layer] || [])
      .map(
        (row) =>
          `<button type="button" class="city-swatch${on.has(row.id) ? " on" : ""}" data-sub="${row.id}"><i style="background:${row.hex}"></i>${row.lab}</button>`
      )
      .join("");
    legendEl.querySelectorAll("[data-sub]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.sub;
        const cur = new Set(stacked[layer] || []);
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
        stacked[layer] = [...cur];
        if (!stacked[layer].length) delete stacked[layer];
        applyView();
        paintLegend();
      };
    });
    const active = activeStack(stacked);
    const chips = Object.entries(active).flatMap(([ly, ids]) =>
      ids.map(
        (id) =>
          `<button type="button" class="choice chip on" data-drop="${ly}:${id}">${layerLabel(ly)} · ${swatchLabel(ly, id)}</button>`
      )
    );
    stackEl.innerHTML = chips.length
      ? `${chips.join("")}<button type="button" class="choice chip" data-clear-stack>Clear stacked filters</button>`
      : `<p class="muted">No stacked filters. Every vacant lot is on the map.</p>`;
    stackEl.querySelectorAll("[data-drop]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [ly, id] = btn.dataset.drop.split(":");
        stacked[ly] = (stacked[ly] || []).filter((x) => x !== id);
        if (!(stacked[ly] || []).length) delete stacked[ly];
        applyView();
        paintLegend();
      };
    });
    const wipe = stackEl.querySelector("[data-clear-stack]");
    if (wipe) {
      wipe.onclick = (e) => {
        e.stopPropagation();
        stacked = {};
        applyView();
        paintLegend();
      };
    }
  }

  let mixTimer = 0;
  function pushMix() {
    layer = "mix";
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
    const ctx = { visitIds: visits, mixById };
    const active = activeStack(stacked);
    const matched = [];
    plotted.forEach((site, i) => {
      const show = passesMapFilters(site, stacked, ctx);
      hidden[i] = show ? 0 : 1;
      if (show) matched.push(site);
      const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.2);
      const h = 1.1 * scales[i];
      dummy.position.set(p.x, p.y + h / 2, p.z);
      dummy.scale.set(show ? scales[i] : 0.001, show ? h : 0.001, show ? scales[i] : 0.001);
      dummy.updateMatrix();
      pegs.setMatrixAt(i, dummy.matrix);
      pegColor.setHex(
        colorFor(layer, site, visits, mixById, (stacked.use || []).includes("affordable") ? "affordable" : "")
      );
      pegs.setColorAt(i, pegColor);
    });
    pegs.instanceMatrix.needsUpdate = true;
    if (pegs.instanceColor) pegs.instanceColor.needsUpdate = true;
    const floodOn = layer === "flood" || Boolean(active.flood);
    discs.visible = floodOn && floodIdx.length > 0;
    if (discs.visible) {
      floodIdx.forEach((idx, i) => {
        const site = plotted[idx];
        const show = !hidden[idx];
        const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.12);
        dummy.position.copy(p);
        dummy.scale.set(show ? 1.6 : 0.001, 1, show ? 1.6 : 0.001);
        dummy.updateMatrix();
        discs.setMatrixAt(i, dummy.matrix);
      });
      discs.instanceMatrix.needsUpdate = true;
    }
    if (focusMesh && focusSite) {
      focusMesh.visible = passesMapFilters(focusSite, stacked, ctx) && !(pickA || pickB);
    }
    const n = matched.length;
    hitsEl.innerHTML = `<p class="eyebrow">${n.toLocaleString()} lot${n === 1 ? "" : "s"} on this cut</p>
      ${matched
        .slice(0, 16)
        .map(
          (s) =>
            `<button type="button" class="choice chip" data-hit="${s.site_id}">${s.address || s.site_id}</button>`
        )
        .join("")}${n > 16 ? `<p class="muted">First 16 shown. The map holds the rest.</p>` : ""}
      ${Object.keys(active).length ? `<div class="cta-row"><button type="button" class="pill" data-to-visits>Use this cut on visits</button></div>` : ""}`;
    hitsEl.querySelectorAll("[data-hit]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (onDossier) onDossier(btn.dataset.hit);
      };
    });
    const goVisits = hitsEl.querySelector("[data-to-visits]");
    if (goVisits) {
      goVisits.onclick = (e) => {
        e.stopPropagation();
        if (onMapFilter) onMapFilter(active, matched.map((s) => s.site_id), true);
      };
    }
    if (onMapFilter) onMapFilter(active, Object.keys(active).length ? matched.map((s) => s.site_id) : null, false);
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
      hud.querySelectorAll("[data-layer]").forEach((b) => b.classList.toggle("on", b === btn));
      applyView();
      paintLegend();
    };
  });
  tools.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      clickMode = btn.dataset.mode;
      tools.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === btn));
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
    if (e.target.closest(".city-hud, .city-algo, .city-duel, .city-tools")) return;
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
    if (e.target.closest?.(".city-hud, .city-algo, .city-duel, .city-tools")) return;
    applyPick(hitLot(e));
  }
  function onWheel(e) {
    e.preventDefault();
    radius = Math.max(18, Math.min(220, radius + e.deltaY * 0.08));
    placeCam();
  }
  function onClick(e) {
    if (e.target.closest(".city-hud, .city-algo, .city-duel, .city-tools")) return;
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
        const show = !hidden[idx];
        const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.12);
        dummy.position.copy(p);
        dummy.scale.set(show ? pulse : 0.001, 1, show ? pulse : 0.001);
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
