"""Join 2024-2025 Pittsburgh vacant-lot sales onto sites.json.

Allegheny County still assesses land on a 2012 base year. FAIRMARKETLAND is
not a 2025 ask. This uses WPRDC property sale transactions for Pittsburgh
wards, 0-address parcels, time-on-market or new-building sales, scaled by
lot square feet.

Government and treasurer sales are kept off the market rate. They are the
cheap public-path sales, not what a private vacant lot fetched.
"""

from __future__ import annotations

import json
import re
import statistics
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
DATA = ROOT / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 housing-typology-matchmaker/0.1 (hackathon; 2025 sales)"}
SALES = {
    "2024": ("9366b400-e4a2-403f-ab14-64cf708ec2f7", DATA / "sales_2024.csv"),
    "2025": ("57b84145-f9eb-493b-a78f-9bc803413d99", DATA / "sales_2025.csv"),
}
ASSESS_RID = "65855e14-549e-4992-b5be-d629afc676fa"
COMP_CACHE = DATA / "vacant_sale_assess.json"
BAD = {
    "LOVE AND AFFECTION SALE",
    "MULTI-PARCEL SALE",
    "CORRECTIVE DEED / DUPLICATE SALE",
    "QUIT CLAIM",
    "SHERIFF SALE",
    "OTHER INVALID SALES INDICATED",
    "CORPORATION TRANSFER",
}
MARKET = {"TIME ON MARKET (INSUFF/EXCESS)", "BUILDING NOT YET ASSESSED"}
NOTE = (
    "WPRDC Allegheny County property sale transactions, 2024 and 2025. "
    "Pittsburgh ward, vacant (0-address) lots that sat on the market. "
    "Scaled to this lot's square feet. Not the 2012 county tax roll."
)


def download_sales() -> None:
    DATA.mkdir(exist_ok=True)
    for year, (rid, dest) in SALES.items():
        if dest.exists() and dest.stat().st_size > 1000:
            continue
        url = f"https://data.wprdc.org/datastore/dump/{rid}"
        print("download sales", year)
        with requests.get(url, headers=HEADERS, timeout=180, stream=True) as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    if chunk:
                        f.write(chunk)


def load_sales() -> pd.DataFrame:
    frames = []
    for year, (_, dest) in SALES.items():
        df = pd.read_csv(dest, low_memory=False)
        df["_year"] = int(year)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    muni = df["MUNIDESC"].fillna("").astype(str)
    pgh = muni.str.contains(r"Ward - PITTSBURGH", case=False, regex=True)
    z = df[pgh & df["FULL_ADDRESS"].astype(str).str.match(r"^0 ")].copy()
    z = z[(z["PRICE"] >= 2000) & (z["PRICE"] <= 200000)]
    z = z[~z["SALEDESC"].isin(BAD)]
    z["ward"] = z["MUNIDESC"].astype(str).str.extract(r"(\d+)", expand=False)
    z["PARID"] = z["PARID"].astype(str).str.strip()
    return z


def fetch_lotarea(pins: list[str]) -> dict:
    cached = json.loads(COMP_CACHE.read_text()) if COMP_CACHE.exists() else {}
    todo = [p for p in pins if p and p not in cached]
    print(f"lotarea cached {len(cached)}, fetch {len(todo)}")
    for i, pin in enumerate(todo):
        r = requests.get(
            "https://data.wprdc.org/api/3/action/datastore_search",
            params={"resource_id": ASSESS_RID, "limit": 1, "filters": json.dumps({"PARID": pin})},
            headers=HEADERS,
            timeout=60,
        )
        recs = (r.json().get("result") or {}).get("records") or [] if r.ok else []
        rec = recs[0] if recs else {}
        cached[pin] = {
            "lotarea": rec.get("LOTAREA"),
            "neigh": rec.get("NEIGHCODE"),
            "use": rec.get("USEDESC"),
            "cls": rec.get("CLASSDESC"),
        }
        if i % 40 == 0:
            COMP_CACHE.write_text(json.dumps(cached))
            print(" ", i, pin)
    COMP_CACHE.write_text(json.dumps(cached))
    return cached


def psf_rows(sales: pd.DataFrame, lotarea: dict, descs: set[str] | None) -> list[float]:
    xs = []
    sub = sales[sales["SALEDESC"].isin(descs)] if descs else sales
    for _, row in sub.iterrows():
        a = lotarea.get(str(row["PARID"]).strip()) or {}
        try:
            area = float(a.get("lotarea") or 0)
        except (TypeError, ValueError):
            continue
        if area < 400:
            continue
        xs.append(float(row["PRICE"]) / area)
    return xs


def main() -> None:
    download_sales()
    sales = load_sales()
    pins = sorted({str(p).strip() for p in sales["PARID"] if str(p).strip()})
    lotarea = fetch_lotarea(pins)
    market = psf_rows(sales, lotarea, MARKET)
    if len(market) < 20:
        market = psf_rows(sales, lotarea, None)
    psf = statistics.median(market)
    print(f"market comps {len(market)} median $/sf {psf:.3f}")

    by_pin = {}
    for _, row in sales.sort_values("_year").iterrows():
        pin = str(row["PARID"]).strip()
        by_pin[pin] = {
            "land_sale_usd": str(int(round(float(row["PRICE"])))),
            "land_sale_year": str(int(row["_year"])),
            "land_sale_desc": str(row["SALEDESC"] or "").strip(),
        }

    sites = json.loads(SITES.read_text())
    n_sale = n_comp = 0
    for s in sites:
        pin = str(s.get("pin") or "").strip()
        try:
            sq = float(s.get("parc_sq_ft") or 0)
        except (TypeError, ValueError):
            sq = 0
        sale = by_pin.get(pin)
        if sale and sale.get("land_sale_desc") in MARKET:
            s.update(sale)
            n_sale += 1
        else:
            s["land_sale_usd"] = ""
            s["land_sale_year"] = ""
            s["land_sale_desc"] = ""
        if sq >= 400 and psf > 0:
            s["land_comp_usd"] = str(int(round(sq * psf)))
            s["land_comp_psf"] = f"{psf:.4f}"
            s["land_comp_n"] = str(len(market))
            s["land_comp_note"] = NOTE
            n_comp += 1
        else:
            s["land_comp_usd"] = ""
            s["land_comp_psf"] = ""
            s["land_comp_n"] = ""
            s["land_comp_note"] = "No 2024-2025 vacant-lot sale rate to scale."
    SITES.write_text(json.dumps(sites))
    print(f"this-PIN market sales {n_sale}, scaled comps {n_comp}")
    print("updated", SITES)


if __name__ == "__main__":
    main()
