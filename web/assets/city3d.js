import * as THREE from "three";

const LAYERS = [
  { id: "visits", lab: "Your visits" },
  { id: "path", lab: "Whose land" },
  { id: "flood", lab: "Flood" },
  { id: "slope", lab: "Hillside" },
  { id: "build", lab: "By-right type" },
  { id: "shade", lab: "Street trees" },
  { id: "credit", lab: "LIHTC nearby" },
];

const LEGEND = {
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
  credit: [
    { id: "near", hex: "#d69a30", lab: "HUD LIHTC within a quarter mile" },
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

function bucketFor(layer, site, visitIds) {
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
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? "steep" : "ok";
  if (layer === "build") {
    const d = String(site.zoning_allows_duplex || "") === "by_right";
    const m = String(site.zoning_allows_small_multifamily || "") === "by_right";
    if (d && m) return "both";
    if (d) return "duplex";
    if (m) return "mf";
    return "none";
  }
  if (layer === "shade") return Number(site.trees_400ft) >= 8 ? "more" : "few";
  if (layer === "credit") {
    const ft = Number(site.lihtc_ft);
    return Number.isFinite(ft) && ft <= 1320 ? "near" : "far";
  }
  return "other";
}

function colorFor(layer, site, visitIds) {
  if (layer === "visits") return visitIds.has(site.site_id) ? 0x4c6fff : 0x1c2430;
  if (layer === "path") return pathColor(site);
  if (layer === "flood") return String(site.flood_sfha || "").toUpperCase() === "T" ? 0x3db5c8 : 0xc5d0dc;
  if (layer === "slope") return String(site.steep_slope || "").toLowerCase() === "yes" ? 0xd69a30 : 0xc5d0dc;
  if (layer === "build") return buildColor(site);
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

export async function mountCity(
  host,
  { lots = [], visitIds = [], focusId = null, onPick = null } = {}
) {
  const visits = visitIds instanceof Set ? visitIds : new Set(visitIds);
  const meta = await (await fetch("./data/pitt-height.json")).json();
  const buf = await (await fetch("./data/pitt-height.u16")).arrayBuffer();
  const u16 = new Uint16Array(buf);
  const n = meta.n;

  host.innerHTML = "";
  host.style.position = "relative";
  const hud = document.createElement("div");
  hud.className = "city-hud";
  hud.innerHTML = `<div class="city-layers">${LAYERS.map(
    (l, i) => `<button type="button" class="choice chip${i === 0 ? " on" : ""}" data-layer="${l.id}">${l.lab}</button>`
  ).join("")}</div><div class="city-legend" id="city-legend"></div>`;
  host.appendChild(hud);
  const tip = document.createElement("div");
  tip.className = "city-tip";
  tip.id = "city-tip";
  tip.hidden = true;
  host.appendChild(tip);
  const legendEl = hud.querySelector("#city-legend");
  let layer = "visits";
  let sub = "";

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
  const pegGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 8);
  const pegMat = new THREE.MeshLambertMaterial();
  const pegs = new THREE.InstancedMesh(pegGeo, pegMat, plotted.length);
  pegs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const pegColor = new THREE.Color();
  const scales = clusterScales(plotted, visits);
  const hidden = new Uint8Array(plotted.length);
  function applyView() {
    plotted.forEach((site, i) => {
      const show = !sub || bucketFor(layer, site, visits) === sub;
      hidden[i] = show ? 0 : 1;
      const p = lonLatToLocal(Number(site.longitude), Number(site.latitude), 0.2);
      const h = 1.1 * scales[i];
      dummy.position.set(p.x, p.y + h / 2, p.z);
      dummy.scale.set(show ? scales[i] : 0.001, show ? h : 0.001, show ? scales[i] : 0.001);
      dummy.updateMatrix();
      pegs.setMatrixAt(i, dummy.matrix);
      pegColor.setHex(colorFor(layer, site, visits));
      pegs.setColorAt(i, pegColor);
    });
    pegs.instanceMatrix.needsUpdate = true;
    if (pegs.instanceColor) pegs.instanceColor.needsUpdate = true;
    discs.visible = layer === "flood" && floodIdx.length > 0 && (!sub || sub === "sfha");
    if (focusMesh && focusSite) {
      focusMesh.visible = !sub || bucketFor(layer, focusSite, visits) === sub;
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
  applyView();
  paintLegend();

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
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

  function hitLot(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(pegs)[0];
    if (!hit || hit.instanceId == null) return null;
    if (hidden[hit.instanceId]) return null;
    return plotted[hit.instanceId] || null;
  }

  function onDown(e) {
    if (e.target.closest(".city-hud button")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onMove(e) {
    if (dragging) {
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
    tip.textContent = bits.join(" · ");
  }
  function onUp() {
    dragging = false;
  }
  function onWheel(e) {
    e.preventDefault();
    radius = Math.max(18, Math.min(220, radius + e.deltaY * 0.08));
    placeCam();
  }
  function onClick(e) {
    if (e.target.closest(".city-hud button")) return;
    const site = hitLot(e);
    if (site && onPick) onPick(site.site_id);
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
    host.innerHTML = "";
  };
}
