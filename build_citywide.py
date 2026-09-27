"""Build citywide vacant city-owned sites.json from the WPRDC dump.

The original four rows in sites.csv stay the Hill CDC genesis sample (ACS + transit
filled). Every other lot gets zoning from a conservative Chapter 911 subset;
ACS and transit stay blank unless the tract already has a pull in sites.csv.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
DUMP_URL = "https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; WPRDC)"}
RAW = ROOT / "data" / "city_owned_properties.csv"
SEED = ROOT / "sites.csv"
OUT_JSON = ROOT / "web" / "data" / "sites.json"
OUT_CSV = ROOT / "sites_citywide.csv"

INV_EXCLUDE = {
    "Park",
    "Legislated Greenway",
    "Greenway",
    "Potential Greenway",
    "Infrastructure Protection",
    "City Facility",
    "Unknown Public Use",
}
STATUS_EXCLUDE = {
    "Permanent City Ownership",
    "Hold for Study",
    "Hold For Study",
    "Privately Owned",
    "Cancelled",
    "Redeemed",
    "Transferred",
    "Litigation Pending",
    "Acquisition Pending",
}
ZONE_EXCLUDE = {"P", "H"}  # parks; hillside overlay with no base residential district

SEED_IDS = {
    "0010M00114000000": "centre-2523",
    "0027E00036000000": "centre-2901",
    "0009M00218000000": "cliff-1800",
    "0024E00193000000": "vista-849",
}


def base_zone(zoned: str) -> str:
    token = (zoned or "").strip().upper()
    if not token:
        return ""
    return token.split("-")[0]


def zoning_allows(zoned: str) -> tuple[str, str, str, str]:
    adu = "not_allowed"
    b = base_zone(zoned)
    district = (zoned or "").strip() or "unknown"
    if b in {"RM", "LNC", "UNC", "NDI", "R3"}:
        return (
            adu,
            "by_right",
            "by_right",
            f"Ch. 911 use table: Two-Unit and Multi-Unit are P in {b}. ADU is not citywide by-right (CB 2025-1545 pending). District as listed: {district}.",
        )
    if b == "R2":
        return (
            adu,
            "by_right",
            "not_allowed",
            f"Ch. 911: R2 is a two-unit district; Two-Unit is P, Multi-Unit is not treated as P in this build. ADU not citywide. District: {district}.",
        )
    if b in {"R1A", "R1D", "R1"}:
        return (
            adu,
            "not_allowed",
            "not_allowed",
            f"Ch. 911: {b} is single-unit; Two-Unit and Multi-Unit are not P. ADU not citywide. District: {district}.",
        )
    if b in {"UI", "GI"}:
        return (
            adu,
            "not_allowed",
            "not_allowed",
            f"{b} is not a residential use district in this reading. District: {district}.",
        )
    return (
        adu,
        "",
        "",
        f"District {district} is not in the weekend Ch. 911 subset. Duplex and small multifamily left unknown, not guessed.",
    )


def slug_id(pin: str, address: str) -> str:
    pin = re.sub(r"\D", "", pin or "")
    if pin:
        return f"pin-{pin}"
    slug = re.sub(r"[^a-z0-9]+", "-", (address or "lot").lower()).strip("-")
    return slug[:40] or "lot"


def tract_key(raw: str) -> str:
    if raw is None or str(raw).strip() in {"", "nan"}:
        return ""
    text = str(raw).split(".")[0]
    if text.endswith("00") and len(text) > 11:
        text = text[:-2] if False else text
    # WPRDC stores 42003050100.0
    if "." in str(raw):
        text = str(int(float(raw)))
    return text


def main() -> None:
    RAW.parent.mkdir(parents=True, exist_ok=True)
    if not RAW.exists() or RAW.stat().st_size < 1000:
        print("Downloading WPRDC city-owned dump…")
        r = requests.get(DUMP_URL, headers=HEADERS, timeout=180)
        r.raise_for_status()
        RAW.write_bytes(r.content)
    df = pd.read_csv(RAW, low_memory=False, dtype=str)
    seed = pd.read_csv(SEED, dtype=str).fillna("")
    acs_by_tract = {}
    for _, row in seed.iterrows():
        t = tract_key(row.get("census_tract", ""))
        if t and row.get("tract_renter_share"):
            acs_by_tract[t] = {
                "tract_median_income": row.get("tract_median_income", ""),
                "tract_renter_share": row.get("tract_renter_share", ""),
                "tract_rent_burden_pct": row.get("tract_rent_burden_pct", ""),
                "tract_median_gross_rent": row.get("tract_median_gross_rent", ""),
                "acs_note": row.get("acs_note", ""),
            }
    seed_by_pin = {str(r["pin"]): r.to_dict() for _, r in seed.iterrows()}

    vacant = df["class"].fillna("").str.contains("Vacant", case=False)
    inv = ~df["inventory_type"].fillna("").isin(INV_EXCLUDE)
    status = ~df["current_status"].fillna("").isin(STATUS_EXCLUDE)
    zone = ~df["zoned_as"].fillna("").isin(ZONE_EXCLUDE)
    geo = df["latitude"].notna() & (df["latitude"].str.strip() != "")
    sq = pd.to_numeric(df["parc_sq_ft"], errors="coerce").fillna(0) >= 800
    pool = df.loc[vacant & inv & status & zone & geo & sq].copy()
    pool = pool.drop_duplicates(subset=["pin"], keep="first")

    records = []
    for _, row in pool.iterrows():
        pin = str(row.get("pin") or "").strip()
        seed_row = seed_by_pin.get(pin)
        zoned = str(row.get("zoned_as") or "").strip()
        adu, duplex, mf, znote = zoning_allows(zoned)
        tract = tract_key(row.get("census_tract", ""))
        acs = acs_by_tract.get(tract, {})
        site_id = SEED_IDS.get(pin, slug_id(pin, row.get("address", "")))
        rec = {
            "site_id": site_id,
            "label": f"{row.get('address')} ({row.get('neighborhood_name')})",
            "address": str(row.get("address") or "").strip(),
            "pin": pin,
            "neighborhood_name": str(row.get("neighborhood_name") or "").strip(),
            "inventory_type": str(row.get("inventory_type") or "").strip(),
            "current_status": str(row.get("current_status") or "").strip(),
            "class": str(row.get("class") or "").strip(),
            "zoned_as": zoned,
            "census_tract": tract,
            "latitude": str(row.get("latitude") or "").strip(),
            "longitude": str(row.get("longitude") or "").strip(),
            "parc_sq_ft": "",
            "zoning_allows_adu": adu,
            "zoning_allows_duplex": duplex,
            "zoning_allows_small_multifamily": mf,
            "zoning_note": znote,
            "tract_median_income": acs.get("tract_median_income", ""),
            "tract_renter_share": acs.get("tract_renter_share", ""),
            "tract_rent_burden_pct": acs.get("tract_rent_burden_pct", ""),
            "tract_median_gross_rent": acs.get("tract_median_gross_rent", ""),
            "acs_note": acs.get(
                "acs_note",
                "ACS not pulled for this tract this weekend. Left unknown, not filled from a neighbor.",
            )
            if not acs
            else acs.get("acs_note", ""),
            "steep_slope": "",
            "transit_distance_ft": "",
            "transit_note": "",
            "genesis_sample": "yes" if seed_row else "",
        }
        try:
            rec["parc_sq_ft"] = str(int(float(row.get("parc_sq_ft") or 0)))
        except ValueError:
            rec["parc_sq_ft"] = ""
        if seed_row:
            for key in (
                "site_id",
                "label",
                "zoning_allows_adu",
                "zoning_allows_duplex",
                "zoning_allows_small_multifamily",
                "zoning_note",
                "tract_median_income",
                "tract_renter_share",
                "tract_rent_burden_pct",
                "tract_median_gross_rent",
                "acs_note",
                "transit_distance_ft",
                "transit_note",
            ):
                if seed_row.get(key) not in (None, ""):
                    rec[key] = seed_row[key]
            rec["genesis_sample"] = "yes"
        records.append(rec)

    # Ensure the four genesis lots are present even if a filter dropped them.
    have = {r["pin"] for r in records}
    for pin, row in seed_by_pin.items():
        if pin not in have:
            extra = dict(row)
            extra["genesis_sample"] = "yes"
            records.insert(0, extra)

    records.sort(key=lambda r: (0 if r.get("genesis_sample") == "yes" else 1, r.get("neighborhood_name") or "", r.get("address") or ""))
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(records))
    pd.DataFrame(records).to_csv(OUT_CSV, index=False)
    neigh = {r["neighborhood_name"] for r in records if r.get("neighborhood_name")}
    print(f"Wrote {len(records)} lots across {len(neigh)} neighborhoods → {OUT_JSON}")


if __name__ == "__main__":
    main()
