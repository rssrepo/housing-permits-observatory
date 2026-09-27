"""Download WPRDC city-owned properties and list Hill District / CDC Reserve sites."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import requests

DUMP_URL = "https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; WPRDC)"}
OUT = Path(__file__).resolve().parent / "sites_candidates.csv"


def main() -> None:
    print(f"Downloading {DUMP_URL}")
    r = requests.get(DUMP_URL, headers=HEADERS, timeout=180)
    r.raise_for_status()
    tmp = Path(__file__).resolve().parent / "data"
    tmp.mkdir(parents=True, exist_ok=True)
    raw_path = tmp / "city_owned_properties.csv"
    raw_path.write_bytes(r.content)
    df = pd.read_csv(raw_path, low_memory=False, dtype={"census_tract": str, "pin": str, "address": str})
    print("columns:", list(df.columns))
    print("rows:", len(df))

    address = df["address"] if "address" in df.columns else pd.Series([""] * len(df))
    inv = df["inventory_type"] if "inventory_type" in df.columns else pd.Series([""] * len(df))
    centre = address.fillna("").astype(str).str.contains("Centre Ave", case=False, na=False)
    cdc = inv.fillna("").astype(str).str.strip().str.casefold() == "cdc property reserve".casefold()
    filtered = df.loc[centre | cdc].copy()
    print(f"Centre Ave rows: {int(centre.sum())}")
    print(f"CDC Property Reserve rows: {int(cdc.sum())}")
    print(f"union: {len(filtered)}")

    show_cols = [
        c
        for c in [
            "address",
            "inventory_type",
            "zoned_as",
            "census_tract",
            "latitude",
            "longitude",
            "parc_sq_ft",
            "class",
            "current_status",
            "pin",
            "parcel_id",
            "neighborhood",
        ]
        if c in filtered.columns
    ]
    pd.set_option("display.max_rows", 200)
    pd.set_option("display.max_colwidth", 80)
    pd.set_option("display.width", 200)
    print("\n=== FILTERED CANDIDATES ===\n")
    print(filtered[show_cols].to_string(index=True))
    filtered.to_csv(OUT, index=False)
    print(f"\nWrote {OUT} ({len(filtered)} rows)")


if __name__ == "__main__":
    main()
