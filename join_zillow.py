"""Join Zillow Research neighborhood ZHVI onto sites.json.

Zillow does not publish a public vacant-lot land series or parcel Zestimates.
This file is typical finished-home value (ZHVI, middle third) by neighborhood.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
DATA = ROOT / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 housing-typology-matchmaker/0.1 (hackathon; ZHVI)"}
NBHD_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/Neighborhood_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
CITY_URL = "https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
NOTE = (
    "Zillow Home Value Index (ZHVI), all homes, middle third, smoothed. "
    "Typical finished home in this neighborhood, not a vacant-lot asking price "
    "and not a parcel Zestimate. Zillow Research public CSV."
)


def norm(name: str) -> str:
    s = str(name or "").lower().replace("&", "and")
    s = re.sub(r"\bmount\b", "mt", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def latest_month(path: Path) -> str:
    cols = pd.read_csv(path, nrows=0).columns.tolist()
    months = [c for c in cols if c[:1].isdigit()]
    return months[-1]


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(exist_ok=True)
    print("fetch", url)
    r = requests.get(url, headers=HEADERS, timeout=180)
    r.raise_for_status()
    dest.write_bytes(r.content)
    print(" wrote", dest, dest.stat().st_size)


def main() -> None:
    nb = DATA / "zhvi_neighborhood.csv"
    cityp = DATA / "zhvi_city.csv"
    if not nb.exists() or nb.stat().st_size < 1000:
        download(NBHD_URL, nb)
    if not cityp.exists() or cityp.stat().st_size < 1000:
        download(CITY_URL, cityp)

    month = latest_month(nb)
    df = pd.read_csv(nb, usecols=["RegionName", "State", "City", month])
    city = df[(df["State"] == "PA") & (df["City"] == "Pittsburgh")].copy()
    zmap = {}
    for _, row in city.iterrows():
        val = row[month]
        if pd.isna(val):
            continue
        zmap[norm(row["RegionName"])] = int(round(float(val)))

    cmonth = latest_month(cityp)
    cdf = pd.read_csv(cityp, usecols=["RegionName", "State", cmonth])
    hit = cdf[(cdf["State"] == "PA") & (cdf["RegionName"] == "Pittsburgh")]
    city_zhvi = int(round(float(hit.iloc[0][cmonth]))) if len(hit) else None
    print("neighborhoods", len(zmap), "month", month, "city", city_zhvi)

    sites = json.loads(SITES.read_text())
    n = 0
    for s in sites:
        key = norm(s.get("neighborhood_name"))
        val = zmap.get(key)
        if val:
            s["zillow_zhvi_usd"] = str(val)
            s["zillow_zhvi_month"] = month
            s["zillow_note"] = NOTE
            n += 1
        else:
            s["zillow_zhvi_usd"] = ""
            s["zillow_zhvi_month"] = ""
            s["zillow_note"] = "No Zillow neighborhood ZHVI matched this place name."
    if city_zhvi:
        for s in sites:
            s["zillow_city_zhvi_usd"] = str(city_zhvi)
    SITES.write_text(json.dumps(sites))
    print("matched lots", n, "of", len(sites))
    print("updated", SITES)


if __name__ == "__main__":
    main()
