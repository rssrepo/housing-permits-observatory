"""Join county land value and ACS median home value onto sites.json.

Land is Allegheny County FAIRMARKETLAND (2012 base year) by PIN.
Nearby finished-home value is ACS 2024 5-year B25077 (owner-occupied median).
Neither is an appraisal of a building that does not exist yet.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "web" / "data" / "sites.json"
CACHE = ROOT / "data"
ASSESS_RID = "65855e14-549e-4992-b5be-d629afc676fa"
CR = "https://api.censusreporter.org/1.0/data/show/acs2024_5yr"
CKAN = "https://data.wprdc.org/api/3/action/datastore_search_sql"
HEADERS = {"User-Agent": "housing-typology-matchmaker/0.1 (hackathon; assessments/ACS value)"}
NOTE_LAND = (
    "Allegheny County Office of Property Assessments via WPRDC. "
    "FAIRMARKETLAND is 2012 base-year appraised land value, not a 2026 asking price."
)
NOTE_HOME = (
    "ACS 2024 5-year median value of owner-occupied homes in this tract (B25077). "
    "Typical nearby finished home, not a listing for a unit you would build on this vacant lot."
)


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def pull_acs_home(tracts: list[str]) -> dict[str, str]:
    dest = CACHE / "acs_home_value.json"
    cached = json.loads(dest.read_text()) if dest.exists() else {}
    out = dict(cached)
    todo = [t for t in tracts if t and t not in out]
    print(f"ACS home value cached {len(cached)}, to fetch {len(todo)}")
    for i, t in enumerate(todo):
        url = f"{CR}?table_ids=B25077&geo_ids=14000US{t}"
        try:
            payload = get_json(url)
        except Exception as exc:
            print(" ACS fail", t, exc)
            time.sleep(2.5)
            continue
        data = ((payload.get("data") or {}).get(f"14000US{t}") or {}).get("B25077") or {}
        est = (data.get("estimate") or {})
        val = est.get("B25077_001", est.get("B25077001"))
        if val is None:
            print(" empty B25077", t)
        else:
            out[t] = str(int(round(float(val))))
        if i % 15 == 0:
            print(f"  ACS {i + 1}/{len(todo)}")
            dest.write_text(json.dumps(out))
        time.sleep(0.35)
    dest.write_text(json.dumps(out))
    return out


def pull_assess(pins: list[str]) -> dict[str, dict]:
    dest = CACHE / "assess_land.json"
    cached = json.loads(dest.read_text()) if dest.exists() else {}
    out = dict(cached)
    todo = [p for p in pins if p and p not in out]
    print(f"assessments cached {len(cached)}, to fetch {len(todo)}")
    chunk = 70
    done = 0
    for i in range(0, len(todo), chunk):
        batch = todo[i : i + chunk]
        ins = ",".join("'" + p.replace("'", "") + "'" for p in batch)
        sql = urllib.parse.urlencode(
            {"sql": f'SELECT * FROM "{ASSESS_RID}" WHERE "PARID" IN ({ins})'}
        )
        try:
            payload = get_json(CKAN + "?" + sql)
        except Exception as exc:
            print(" assess fail", exc)
            time.sleep(1)
            continue
        recs = (payload.get("result") or {}).get("records") or []
        found = set()
        for rec in recs:
            parid = str(rec.get("PARID") or "").strip()
            if not parid:
                continue
            found.add(parid)
            land = rec.get("FAIRMARKETLAND")
            total = rec.get("FAIRMARKETTOTAL")
            out[parid] = {
                "assess_land_fmv": "" if land in (None, "") else str(int(round(float(land)))),
                "assess_total_fmv": "" if total in (None, "") else str(int(round(float(total)))),
                "assess_zip": str(rec.get("PROPERTYZIP") or "").strip(),
                "assess_sale_price": ""
                if rec.get("SALEPRICE") in (None, "")
                else str(int(round(float(rec["SALEPRICE"])))),
                "assess_sale_desc": str(rec.get("SALEDESC") or "").strip(),
            }
        for p in batch:
            if p not in found and p not in out:
                out[p] = {
                    "assess_land_fmv": "",
                    "assess_total_fmv": "",
                    "assess_zip": "",
                    "assess_sale_price": "",
                    "assess_sale_desc": "",
                }
        done += len(batch)
        dest.write_text(json.dumps(out))
        print(f"  assess {done}/{len(todo)} rows {len(recs)}")
        time.sleep(0.15)
    dest.write_text(json.dumps(out))
    return out


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    sites = json.loads(SITES.read_text())
    tracts = sorted({str(s.get("census_tract") or "").strip() for s in sites if str(s.get("census_tract") or "").strip()})
    pins = [str(s.get("pin") or "").strip() for s in sites]
    home = pull_acs_home(tracts)
    assess = pull_assess(pins)
    n_land = n_home = 0
    for s in sites:
        pin = str(s.get("pin") or "").strip()
        tract = str(s.get("census_tract") or "").strip()
        row = assess.get(pin) or {}
        for k, v in row.items():
            s[k] = v
        if row.get("assess_land_fmv"):
            n_land += 1
            s["assess_note"] = NOTE_LAND
        else:
            s["assess_note"] = "No Allegheny County assessment row for this PIN."
        val = home.get(tract, "")
        s["tract_median_home_value"] = val
        if val:
            n_home += 1
            s["home_value_note"] = NOTE_HOME
        else:
            s["home_value_note"] = "No ACS median home value for this tract. Left blank."
    SITES.write_text(json.dumps(sites))
    print(f"land {n_land}, home value {n_home}")
    print("updated", SITES)


if __name__ == "__main__":
    main()
