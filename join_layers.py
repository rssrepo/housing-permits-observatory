"""Join public exposure layers onto web/data/sites.json.

Downloads (cached under data/):
  PRT stops GeoJSON (WPRDC)
  2014 FEMA flood zones GeoJSON (City / WPRDC extract)
  25%+ slope shapefile (City / WPRDC)
  ACS 5-year via Census Reporter for every tract on the lots

Heat/carbon rasters are not joined. See DATA notes at bottom of this file.
"""

from __future__ import annotations

import json
import math
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
CACHE = ROOT / "data"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; public GIS joins)"}

PRT_URL = "https://data.wprdc.org/dataset/33d5f44b-5315-4374-b3e3-e4246e8ad5c9/resource/d6e6ed6e-9220-4a0e-9796-e72d83ce8e7a/download/stops.geojson"
FLOOD_URL = "https://data.wprdc.org/dataset/4c9b78ee-d044-418d-97c9-130ccdcb3435/resource/122717f9-f08a-4be1-82b9-c213cc069e8c/download/flood_zones.geojson"
SLOPE_ZIP = "https://data.wprdc.org/dataset/0f643c56-1c53-4c88-824d-3a3876c0d3a0/resource/e0f34683-cb95-4ae1-b76b-9f29dacac6a7/download/slopes.zip"
CR_SHOW = "https://api.censusreporter.org/1.0/data/show/acs2024_5yr"
def _est(data: dict, table: str, col: str):
    e = ((data.get(table) or {}).get("estimate") or {})
    if col in e:
        return e[col]
    compact = col.replace("_", "")
    return e.get(compact)


def parse_acs_table(payload: dict, geoid: str) -> dict | None:
    data = (payload.get("data") or {}).get(geoid) or {}
    hh = _est(data, "B25003", "B25003_001")
    renters = _est(data, "B25003", "B25003_003")
    income = _est(data, "B19013", "B19013_001")
    med_rent = _est(data, "B25064", "B25064_001")
    tot = _est(data, "B25070", "B25070_001")
    na = _est(data, "B25070", "B25070_011") or 0
    burden_n = sum((_est(data, "B25070", f"B25070_{i:03d}") or 0) for i in range(7, 11))
    if hh in (None, 0) and income is None and med_rent is None:
        return None
    out = {
        "tract_median_income": "" if income is None else str(int(round(income))),
        "tract_median_gross_rent": "" if med_rent is None else str(int(round(med_rent))),
        "tract_renter_share": "",
        "tract_rent_burden_pct": "",
        "acs_note": "ACS 2024 5-year via Census Reporter (B25003, B25064, B19013, B25070). Missing cells left blank.",
    }
    if hh and renters is not None:
        out["tract_renter_share"] = str(round(100.0 * renters / hh, 1))
    denom = (tot - na) if tot and (tot - na) else None
    if denom:
        out["tract_rent_burden_pct"] = str(round(100.0 * burden_n / denom, 1))
    return out


def pull_acs(tracts: list[str]) -> dict[str, dict]:
    by = {}
    for i, t in enumerate(tracts):
        url = f"{CR_SHOW}?table_ids=B25003,B25064,B19013,B25070&geo_ids=14000US{t}"
        r = requests.get(url, headers=HEADERS, timeout=90)
        if r.status_code != 200:
            print(f"  ACS miss {t} {r.status_code}")
            continue
        parsed = parse_acs_table(r.json(), f"14000US{t}")
        if parsed:
            by[t] = parsed
        else:
            print(f"  empty ACS {t}")
        if i % 15 == 0:
            print(f"ACS {i + 1}/{len(tracts)}")
        time.sleep(0.12)
    print(f"ACS filled {len(by)} / {len(tracts)} tracts")
    return by


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        print(f"cache hit {dest.name} ({dest.stat().st_size} bytes)")
        return dest
    print(f"GET {url}")
    r = requests.get(url, headers=HEADERS, timeout=300)
    r.raise_for_status()
    dest.write_bytes(r.content)
    print(f"wrote {dest} ({len(r.content)} bytes)")
    return dest


def coords_of(feat: dict):
    geom = feat.get("geometry") or {}
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "Point" and c and len(c) >= 2:
        return float(c[0]), float(c[1])
    if t == "MultiPoint" and c:
        p = c[0]
        return float(p[0]), float(p[1])
    return None


def nearest_stop_ft(lon: float, lat: float, stops: list[tuple[float, float]]) -> int | None:
    if not stops:
        return None
    best = None
    # crude prefilter ~0.03 deg (~2 mi)
    for slon, slat in stops:
        if abs(slat - lat) > 0.03 or abs(slon - lon) > 0.04:
            continue
        dlat = (slat - lat) * 69.0
        dlon = (slon - lon) * 69.0 * math.cos(math.radians(lat))
        ft = math.hypot(dlat, dlon) * 5280
        if best is None or ft < best:
            best = ft
    if best is None:
        for slon, slat in stops:
            dlat = (slat - lat) * 69.0
            dlon = (slon - lon) * 69.0 * math.cos(math.radians(lat))
            ft = math.hypot(dlat, dlon) * 5280
            if best is None or ft < best:
                best = ft
    return int(round(best)) if best is not None else None


def load_stops(path: Path) -> list[tuple[float, float]]:
    data = json.loads(path.read_text())
    out = []
    for feat in data.get("features") or []:
        xy = coords_of(feat)
        if xy:
            out.append(xy)
    print(f"PRT stops: {len(out)}")
    return out


def flood_label(props: dict) -> str:
    for k in ("FLD_ZONE", "fld_zone", "ZONE", "zone", "FLOODZONE", "SFHA_TF"):
        if k in props and props[k] not in (None, ""):
            return str(props[k]).strip()
    return "floodplain"


def try_shapely():
    try:
        from shapely.geometry import Point, shape  # type: ignore

        return Point, shape
    except ImportError:
        return None, None


def index_polygons(geojson_path: Path, label_fn):
    Point, shape = try_shapely()
    if Point is None:
        raise SystemExit("pip3 install shapely  (needed for flood/slope point-in-polygon)")
    data = json.loads(geojson_path.read_text())
    polys = []
    for feat in data.get("features") or []:
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            g = shape(geom)
        except Exception:
            continue
        if g.is_empty:
            continue
        minx, miny, maxx, maxy = g.bounds
        polys.append((minx, miny, maxx, maxy, g, label_fn(feat.get("properties") or {})))
    print(f"{geojson_path.name}: {len(polys)} polygons")
    return polys


def hit_poly(lon: float, lat: float, polys) -> str:
    from shapely.geometry import Point

    p = Point(lon, lat)
    for minx, miny, maxx, maxy, g, lab in polys:
        if lon < minx or lon > maxx or lat < miny or lat > maxy:
            continue
        if g.contains(p) or g.intersects(p):
            return lab
    return ""


def load_slope_zip(zpath: Path):
    Point, shape = try_shapely()
    import shapefile  # type: ignore

    with zipfile.ZipFile(zpath) as zf:
        names = zf.namelist()
        shp = next(n for n in names if n.lower().endswith(".shp") and not n.startswith("__"))
        extract = CACHE / "slope_shp"
        extract.mkdir(exist_ok=True)
        zf.extractall(extract)
    shp_path = next(extract.rglob("*.shp"))
    r = shapefile.Reader(str(shp_path))
    polys = []
    for sr in r.shapeRecords():
        geom = sr.shape.__geo_interface__
        try:
            g = shape(geom)
        except Exception:
            continue
        if g.is_empty:
            continue
        minx, miny, maxx, maxy = g.bounds
        polys.append((minx, miny, maxx, maxy, g, "yes"))
    print(f"slope polys: {len(polys)}")
    return polys


def main() -> None:
    sites = json.loads(SITES.read_text())
    tracts = sorted({str(s.get("census_tract") or "").strip() for s in sites if str(s.get("census_tract") or "").strip()})
    print(f"{len(sites)} lots, {len(tracts)} tracts")

    acs = pull_acs(tracts)

    prt_path = download(PRT_URL, CACHE / "prt_stops.geojson")
    stops = load_stops(prt_path)
    flood_path = download(FLOOD_URL, CACHE / "flood_zones.geojson")
    flood_polys = index_polygons(flood_path, flood_label)
    slope_path = download(SLOPE_ZIP, CACHE / "slopes.zip")
    slope_polys = load_slope_zip(slope_path)
    from pyproj import Transformer

    to2272 = Transformer.from_crs("EPSG:4326", "EPSG:2272", always_xy=True)

    n_acs = n_bus = n_flood = n_slope = 0
    for s in sites:
        tract = str(s.get("census_tract") or "").strip()
        if tract in acs:
            for k, v in acs[tract].items():
                s[k] = v
            n_acs += 1
        elif tract:
            s["acs_note"] = s.get("acs_note") or "Census Reporter had no tables for this tract GEOID. Left blank."
        try:
            lat = float(s["latitude"])
            lon = float(s["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        ft = nearest_stop_ft(lon, lat, stops)
        if ft is not None:
            s["transit_distance_ft"] = str(ft)
            s["transit_note"] = "Nearest PRT stop from WPRDC Pittsburgh Regional Transit Stops GeoJSON; haversine in feet."
            n_bus += 1
        zone = hit_poly(lon, lat, flood_polys)
        s["flood_zone"] = zone
        s["flood_note"] = (
            "City of Pittsburgh 2014 FEMA flood-zone extract on WPRDC. Point-in-polygon. Not the live NFHL."
            if zone
            else "Outside the 2014 Pittsburgh FEMA extract polygons (or extract has no SFHA here)."
        )
        if zone:
            n_flood += 1
        sx, sy = to2272.transform(lon, lat)
        steep = hit_poly(sx, sy, slope_polys)
        s["steep_slope"] = "yes" if steep else "no"
        s["slope_note"] = "City of Pittsburgh 25% or greater slope polygons (WPRDC / PGH GIS). Point-in-polygon."
        if steep:
            n_slope += 1
        if not str(s.get("heat_severity") or "").strip():
            s["heat_note"] = "No TPL heat-severity pixel on this lot. Street trees are shade, not LST."

    SITES.write_text(json.dumps(sites))
    print(f"ACS lots {n_acs}, transit {n_bus}, flood {n_flood}, steep {n_slope}")
    print(f"updated {SITES}")


if __name__ == "__main__":
    main()
