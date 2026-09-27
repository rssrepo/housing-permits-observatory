"""Join live NFHL, HUD LIHTC, and city street trees onto sites.json.

Carbon of a future building is still not measured. Tree CO2 figures are
the City's 2020 forestry calculator on street trees, labeled as such.
"""

from __future__ import annotations

import csv
import io
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
CACHE = ROOT / "data"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; NFHL/LIHTC/trees)"}

NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
LIHTC = "https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer/0/query"
TREES = "https://data.wprdc.org/datastore/dump/1515a93c-73e3-4425-9b35-1cd11b2196da"


def feet(lat1, lon1, lat2, lon2):
    dlat = (lat2 - lat1) * 69.0
    dlon = (lon2 - lon1) * 69.0 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlon) * 5280


def nfhl_one(lon: float, lat: float) -> dict:
    r = requests.get(
        NFHL,
        params={
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "FLD_ZONE,SFHA_TF,ZONE_SUBTY",
            "returnGeometry": "false",
            "f": "json",
        },
        headers=HEADERS,
        timeout=45,
    )
    r.raise_for_status()
    feats = r.json().get("features") or []
    if not feats:
        return {"flood_zone_nfhl": "", "flood_sfha": "", "flood_subty": ""}
    a = feats[0].get("attributes") or {}
    return {
        "flood_zone_nfhl": str(a.get("FLD_ZONE") or "").strip(),
        "flood_sfha": str(a.get("SFHA_TF") or "").strip(),
        "flood_subty": str(a.get("ZONE_SUBTY") or "").strip(),
    }


def load_lihtc() -> list[dict]:
    dest = CACHE / "lihtc_pgh.json"
    if dest.exists() and dest.stat().st_size > 1000:
        return json.loads(dest.read_text())
    rows = []
    offset = 0
    while True:
        r = requests.get(
            LIHTC,
            params={
                "where": "PROJ_ST='PA' AND UPPER(PROJ_CTY) LIKE '%PITTSBURGH%'",
                "outFields": "PROJECT,PROJ_ADD,N_UNITS,LI_UNITS,YR_PIS,INC_CEIL",
                "returnGeometry": "true",
                "outSR": 4326,
                "f": "json",
                "resultRecordCount": 200,
                "resultOffset": offset,
            },
            headers=HEADERS,
            timeout=90,
        )
        r.raise_for_status()
        chunk = r.json().get("features") or []
        if not chunk:
            break
        for f in chunk:
            g = f.get("geometry") or {}
            a = f.get("attributes") or {}
            try:
                lon, lat = float(g["x"]), float(g["y"])
            except (KeyError, TypeError, ValueError):
                continue
            rows.append(
                {
                    "name": a.get("PROJECT") or "LIHTC property",
                    "address": a.get("PROJ_ADD") or "",
                    "units": a.get("N_UNITS"),
                    "li_units": a.get("LI_UNITS"),
                    "year": a.get("YR_PIS"),
                    "lon": lon,
                    "lat": lat,
                }
            )
        offset += len(chunk)
        if len(chunk) < 200:
            break
    dest.write_text(json.dumps(rows))
    print(f"LIHTC Pittsburgh properties: {len(rows)}")
    return rows


def load_trees() -> list[tuple[float, float, float]]:
    dest = CACHE / "city_trees.csv"
    if not dest.exists() or dest.stat().st_size < 1000:
        print("GET city trees dump")
        r = requests.get(TREES, headers=HEADERS, timeout=300)
        r.raise_for_status()
        dest.write_bytes(r.content)
    out = []
    with dest.open(newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            name = (row.get("common_name") or "").strip().lower()
            if name in {"stump", "vacant", "n/a", ""}:
                continue
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            try:
                co2 = float(row.get("co2_benefits_totalco2_lbs") or 0)
            except ValueError:
                co2 = 0.0
            out.append((lon, lat, co2))
    print(f"live street trees: {len(out)}")
    return out


def trees_near(lon, lat, trees, max_ft=400):
    n = 0
    co2 = 0.0
    for tlon, tlat, lbs in trees:
        if abs(tlat - lat) > 0.012 or abs(tlon - lon) > 0.014:
            continue
        if feet(lat, lon, tlat, tlon) <= max_ft:
            n += 1
            co2 += lbs
    return n, round(co2, 1)


def nearest_lihtc(lon, lat, props):
    best = None
    best_ft = None
    for p in props:
        ft = feet(lat, lon, p["lat"], p["lon"])
        if best_ft is None or ft < best_ft:
            best_ft = ft
            best = p
    return best, (None if best_ft is None else int(round(best_ft)))


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    sites = json.loads(SITES.read_text())
    lihtc = load_lihtc()
    trees = load_trees()

    cells = {}
    for s in sites:
        try:
            lat, lon = float(s["latitude"]), float(s["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        cells.setdefault((round(lat, 3), round(lon, 3)), (lon, lat))
    print(f"NFHL cells {len(cells)}")
    nfhl_path = CACHE / "nfhl_cells.json"
    nfhl = json.loads(nfhl_path.read_text()) if nfhl_path.exists() else {}

    todo = [(k, xy) for k, xy in cells.items() if f"{k[0]},{k[1]}" not in nfhl]
    print(f"NFHL to fetch {len(todo)}")

    def job(item):
        key, (lon, lat) = item
        try:
            return f"{key[0]},{key[1]}", nfhl_one(lon, lat)
        except Exception as exc:
            return f"{key[0]},{key[1]}", {"error": str(exc)}

    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(job, item) for item in todo]
        for i, fut in enumerate(as_completed(futs), 1):
            k, val = fut.result()
            nfhl[k] = val
            if i % 100 == 0:
                print(f"NFHL {i}/{len(todo)}")
                nfhl_path.write_text(json.dumps(nfhl))
    nfhl_path.write_text(json.dumps(nfhl))

    n_sfha = n_li = 0
    for s in sites:
        try:
            lat, lon = float(s["latitude"]), float(s["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        cell = nfhl.get(f"{round(lat, 3)},{round(lon, 3)}") or {}
        zone = cell.get("flood_zone_nfhl") or ""
        sfha = cell.get("flood_sfha") or ""
        s["flood_zone_nfhl"] = zone
        s["flood_sfha"] = sfha
        s["flood_subty"] = cell.get("flood_subty") or ""
        s["flood_note"] = (
            "Live FEMA National Flood Hazard Layer (MapServer layer 28) at a ~100 m cell. "
            "SFHA_TF T means special flood hazard area. Not a survey or BFE."
        )
        if str(sfha).upper() == "T":
            n_sfha += 1
        best, ft = nearest_lihtc(lon, lat, lihtc)
        if best and ft is not None:
            s["lihtc_ft"] = str(ft)
            s["lihtc_name"] = best["name"]
            s["lihtc_units"] = "" if best["units"] is None else str(best["units"])
            s["lihtc_note"] = (
                "Nearest HUD LIHTC property in Pittsburgh (HUD USER feature layer). "
                "Distance is to the mapped project point, not a unit mix or QAP score."
            )
            n_li += 1
        n_trees, co2 = trees_near(lon, lat, trees)
        s["trees_400ft"] = str(n_trees)
        s["tree_co2_lbs"] = str(co2)
        s["tree_note"] = (
            "City of Pittsburgh DPW street-tree inventory (WPRDC; last refresh ~2020). "
            "Count within 400 ft. Shade at the curb, not land-surface temperature."
        )
        if not str(s.get("heat_severity") or "").strip():
            s["heat_note"] = (
                "No TPL heat-severity pixel on this lot. Street-tree count is shade, not LST."
            )
        s["carbon_note"] = (
            "Tree CO2 lbs are the city's forestry calculator on those street trees, not operational carbon of a new building."
        )
        inc = s.get("tract_median_income")
        try:
            inc_n = float(inc)
            vs_city = round(100.0 * inc_n / 65742)
            s["income_vs_city_pct"] = str(vs_city)
            s["who_note"] = (
                f"Typical tract household income ${int(inc_n):,} is {vs_city}% of Pittsburgh ACS typical (${65742:,}). "
                "That is who lives nearby now. It is not a named future tenant. LIHTC usually serves households at or below 60% AMI."
            )
        except (TypeError, ValueError):
            s["who_note"] = "No tract income, so we do not guess who would get a future unit."

    SITES.write_text(json.dumps(sites))
    print(f"SFHA lots {n_sfha}, LIHTC joined {n_li}")
    print("updated", SITES)


if __name__ == "__main__":
    main()
