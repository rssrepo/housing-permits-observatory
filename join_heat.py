"""Join Trust for Public Land Heat Severity USA 2023 onto sites.json.

Landsat 8 TIRS band 10, summer, 30 m. Pixel 1–5 is land-surface temperature
relative to the city's mean, not air temperature and not a health score.
"""

from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
CACHE = ROOT / "data" / "heat_cells.json"
HEAT = "https://server4.tplgis.org/arcgis4/rest/services/NATIONAL/uhi_city_severity_2023/ImageServer/identify"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; TPL heat severity)"}
NOTE = (
    "Trust for Public Land Heat Severity USA 2023 (Landsat 8 band 10, summer, 30 m). "
    "Score 1–5 is land surface versus the city's mean LST. Not air temperature. Not a health score."
)
R = 20037508.34
CELL = 30.0


def merc(lon: float, lat: float) -> tuple[float, float]:
    x = lon * R / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0)
    y = y * R / 180.0
    return x, y


def cell_key(x: float, y: float) -> str:
    return f"{int(math.floor(x / CELL) * CELL)},{int(math.floor(y / CELL) * CELL)}"


def parse_value(payload: dict) -> int | None:
    props = payload.get("properties") or {}
    raws = [payload.get("value"), *(props.get("Values") or [])]
    hits: list[int] = []
    for raw in raws:
        if raw in (None, "", "NoData", "nodata"):
            continue
        try:
            n = int(float(str(raw).split()[0]))
        except (TypeError, ValueError):
            continue
        if 1 <= n <= 5:
            hits.append(n)
    if not hits:
        return None
    return max(set(hits), key=hits.count)


def identify(x: float, y: float) -> int | None:
    last = None
    for attempt in range(4):
        try:
            q = urlencode(
                {
                    "geometry": json.dumps({"x": x, "y": y, "spatialReference": {"wkid": 102100}}),
                    "geometryType": "esriGeometryPoint",
                    "sr": 102100,
                    "imageDisplay": "400,400,96",
                    "returnGeometry": "false",
                    "returnCatalogItems": "true",
                    "f": "json",
                }
            )
            req = Request(f"{HEAT}?{q}", headers=HEADERS)
            with urlopen(req, timeout=45) as r:
                payload = json.loads(r.read().decode())
            return parse_value(payload)
        except Exception as exc:
            last = exc
            time.sleep(0.4 * (attempt + 1))
    if last:
        print("identify fail", last)
    return None


def main() -> None:
    sites = json.loads(SITES.read_text())
    cached: dict[str, int | None] = {}
    if CACHE.exists():
        cached = json.loads(CACHE.read_text())
    todo: dict[str, tuple[float, float]] = {}
    for s in sites:
        try:
            lon, lat = float(s["longitude"]), float(s["latitude"])
        except (KeyError, TypeError, ValueError):
            continue
        x, y = merc(lon, lat)
        key = cell_key(x, y)
        if (key not in cached or cached.get(key) is None) and key not in todo:
            todo[key] = (x, y)
    print(f"lots {len(sites)}, cells cached {len(cached)}, to fetch {len(todo)}")
    done = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(identify, x, y): key for key, (x, y) in todo.items()}
        for fut in as_completed(futs):
            key = futs[fut]
            cached[key] = fut.result()
            done += 1
            if done % 100 == 0 or done == len(futs):
                print(f"  fetched {done}/{len(futs)}")
                CACHE.write_text(json.dumps(cached))
    CACHE.write_text(json.dumps(cached))
    n = 0
    hist = {str(i): 0 for i in range(1, 6)}
    hist["blank"] = 0
    for s in sites:
        try:
            lon, lat = float(s["longitude"]), float(s["latitude"])
        except (KeyError, TypeError, ValueError):
            s["heat_severity"] = ""
            s["heat_note"] = NOTE + " No coordinates on this lot."
            hist["blank"] += 1
            continue
        x, y = merc(lon, lat)
        val = cached.get(cell_key(x, y))
        if val is None:
            s["heat_severity"] = ""
            s["heat_note"] = NOTE + " No pixel at this point."
            hist["blank"] += 1
        else:
            s["heat_severity"] = str(val)
            s["heat_note"] = NOTE
            hist[str(val)] += 1
            n += 1
    SITES.write_text(json.dumps(sites))
    print("joined", n, "hist", hist)
    print("updated", SITES)


if __name__ == "__main__":
    main()
