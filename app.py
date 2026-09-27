"""Track 3: housing typology matchmaker for a handful of real Pittsburgh sites."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import streamlit as st

from scoring import (
    FACTOR_LABELS,
    FACTORS,
    TYPOLOGIES,
    TYPOLOGY_LABELS,
    UNKNOWN,
    is_unknown,
    load_sites,
    ranked,
    read_field,
    score_site,
    site_record,
)

ROOT = Path(__file__).resolve().parent
SITES_PATH = ROOT / "sites.csv"


def ai_explain(payload: dict) -> str:
    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_KEY")
    if not key:
        raise RuntimeError("No OPENAI_API_KEY in the environment.")
    r = __import__("requests").post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You explain a transparent housing-typology scorecard. "
                        "Use only the JSON facts. Do not invent scores, zoning, or ACS numbers. "
                        "If a factor is unknown, say so. 2-3 sentences. "
                        "Mention this is decision support, not a permit determination."
                    ),
                },
                {"role": "user", "content": json.dumps(payload, default=str)},
            ],
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


st.set_page_config(page_title="Typology Matchmaker", layout="wide")
st.title("Housing typology matchmaker")
st.caption(
    "CDC-scale decision support for a handful of real City of Pittsburgh parcels — "
    "not a citywide model, not a zoning opinion, not measured emissions."
)

if not SITES_PATH.exists():
    st.error("sites.csv is missing. Nothing was estimated to replace it.")
    st.stop()

try:
    sites = load_sites(SITES_PATH)
except Exception as exc:  # noqa: BLE001
    st.error(f"Could not read sites.csv.\n\n{exc}")
    st.stop()

if sites.empty or "site_id" not in sites.columns:
    st.error("sites.csv has no site_id rows. The app will not invent sites.")
    st.stop()

labels = {
    row["site_id"]: (row.get("label") or row.get("address") or row["site_id"])
    for row in sites.to_dict(orient="records")
}

st.sidebar.markdown("### 1. Pick a site")
site_id = st.sidebar.radio(
    "Candidate parcel",
    options=list(labels),
    format_func=lambda sid: labels[sid],
)

st.sidebar.markdown("### 2. Your weighting choice")
st.sidebar.caption("These sliders are a value judgment, not data. They are normalized to 100%.")
w_feas = st.sidebar.slider("Feasibility", 0, 100, 25)
w_demand = st.sidebar.slider("Demand fit", 0, 100, 25)
w_aff = st.sidebar.slider("Affordability impact", 0, 100, 25)
w_clim = st.sidebar.slider("Climate (proxy)", 0, 100, 25)
weights = {
    "feasibility": w_feas,
    "demand_fit": w_demand,
    "affordability_impact": w_aff,
    "climate_proxy": w_clim,
}

row = site_record(sites, site_id)
result = score_site(row, weights)
norm = result["weights"]

st.sidebar.markdown(
    f"Normalized: feasibility {norm['feasibility']:.0%} · "
    f"demand {norm['demand_fit']:.0%} · "
    f"affordability {norm['affordability_impact']:.0%} · "
    f"climate {norm['climate_proxy']:.0%}"
)

# --- Site facts (from the CSV only) ---
st.subheader("Selected site (from data)")
c1, c2, c3, c4 = st.columns(4)
c1.markdown(f"**Address**  \n{read_field(row, 'address') if not is_unknown(read_field(row, 'address')) else 'no data'}")
c2.markdown(f"**Zoning**  \n{read_field(row, 'zoned_as') if not is_unknown(read_field(row, 'zoned_as')) else 'no data'}")
c3.markdown(f"**Lot sq ft**  \n{read_field(row, 'parc_sq_ft') if not is_unknown(read_field(row, 'parc_sq_ft')) else 'no data'}")
c4.markdown(f"**Status**  \n{read_field(row, 'current_status') if not is_unknown(read_field(row, 'current_status')) else 'no data'}")

facts = pd.DataFrame(
    [
        ["PIN", read_field(row, "pin")],
        ["Neighborhood", read_field(row, "neighborhood_name")],
        ["Inventory type", read_field(row, "inventory_type")],
        ["Class", read_field(row, "class")],
        ["Census tract (WPRDC)", read_field(row, "census_tract")],
        ["Median HH income (ACS)", read_field(row, "tract_median_income")],
        ["Renter share % (ACS)", read_field(row, "tract_renter_share")],
        ["Rent burden 30%+ (ACS)", read_field(row, "tract_rent_burden_pct")],
        ["Transit distance (ft)", read_field(row, "transit_distance_ft")],
        ["Steep slope", read_field(row, "steep_slope")],
        ["ADU zoning", read_field(row, "zoning_allows_adu")],
        ["Duplex zoning", read_field(row, "zoning_allows_duplex")],
        ["Small multifamily zoning", read_field(row, "zoning_allows_small_multifamily")],
    ],
    columns=["Field", "Value"],
)
facts["Value"] = facts["Value"].map(lambda v: "Unknown/not available" if is_unknown(v) else v)
st.dataframe(facts, width="stretch", hide_index=True)

note_z = read_field(row, "zoning_note")
note_a = read_field(row, "acs_note")
if not is_unknown(note_z):
    st.caption(f"Zoning note: {note_z}")
if not is_unknown(note_a):
    st.caption(f"ACS note: {note_a}")

# --- Ranking chart ---
st.subheader("Typology ranking under your weights")
order = ranked(result)
chart_rows = []
for typ, score in order:
    if is_unknown(score):
        st.info(
            f"**{TYPOLOGY_LABELS[typ]}:** composite is Insufficient data "
            "(no scored factors). It is omitted from the chart, not plotted as 0."
        )
        continue
    chart_rows.append({"typology": TYPOLOGY_LABELS[typ], "composite": float(score)})

if chart_rows:
    st.bar_chart(pd.DataFrame(chart_rows).set_index("typology"))
else:
    st.warning("No typology has enough data to rank. Filters and other sites still work.")

# --- Factor table: data vs unknown vs weights ---
st.markdown("#### From data vs. unknown vs. your weighting choice")
st.markdown(
    "- **From data** — a 0–100 factor score with the CSV field it used.  \n"
    "- **Unknown/not available** — the input cell was blank or unusable; shown as "
    "Insufficient data, **not** scored as 0.  \n"
    "- **Your weighting choice** — the sliders in the sidebar; they are not in the CSV."
)

table_rows = []
for typ in TYPOLOGIES:
    block = result["typologies"][typ]
    for fac in FACTORS:
        cell = block["factors"][fac]
        score = cell["score"]
        table_rows.append(
            {
                "Typology": TYPOLOGY_LABELS[typ],
                "Factor": FACTOR_LABELS[fac],
                "State": "Unknown/not available" if is_unknown(score) else "From data",
                "Score": "Insufficient data" if is_unknown(score) else str(score),
                "Source field": cell.get("source", ""),
                "How it was computed": cell.get("detail", ""),
            }
        )
    comp = block["composite"]
    dropped = comp.get("dropped_factors") or []
    table_rows.append(
        {
            "Typology": TYPOLOGY_LABELS[typ],
            "Factor": "Composite (usable factors only)",
            "State": "Unknown/not available" if is_unknown(comp["score"]) else "From data + your weights",
            "Score": "Insufficient data" if is_unknown(comp["score"]) else str(comp["score"]),
            "Source field": "weights sliders; missing factors excluded (not zeroed)",
            "How it was computed": (
                f"dropped={dropped}" if dropped else "all four factors present"
            ),
        }
    )

st.dataframe(pd.DataFrame(table_rows), width="stretch", hide_index=True)

# --- AI panel ---
st.subheader("AI explanation")
st.caption("AI-generated. Rankings above are computed in scoring.py before this call.")
if st.button("Explain this ranking"):
    facts_payload = {
        "site": {k: read_field(row, k) for k in row},
        "weights_normalized": norm,
        "ranking": [
            {
                "typology": TYPOLOGY_LABELS[t],
                "composite": s if not is_unknown(s) else "Insufficient data",
            }
            for t, s in order
        ],
        "factors": {
            TYPOLOGY_LABELS[typ]: {
                FACTOR_LABELS[fac]: {
                    "score": result["typologies"][typ]["factors"][fac]["score"]
                    if not is_unknown(result["typologies"][typ]["factors"][fac]["score"])
                    else "Insufficient data",
                    "source": result["typologies"][typ]["factors"][fac].get("source"),
                }
                for fac in FACTORS
            }
            for typ in TYPOLOGIES
        },
        "task": (
            "Explain why the top typology ranked first and what weight or data change "
            "would be needed to flip the ranking. Call out any Insufficient data factors."
        ),
    }
    try:
        text = ai_explain(facts_payload)
        st.markdown(f"**AI-generated (not a zoning determination):** {text}")
    except Exception as exc:  # noqa: BLE001
        st.error(f"Explanation request failed. No substitute text was generated.\n\n{exc}")

st.markdown("## What this does and doesn't show")
st.markdown(
    """
- **A handful of illustrative sites**, pulled from WPRDC City-Owned Properties (Centre Ave
  and/or CDC Property Reserve), not a citywide suitability surface.
- **Climate scores are a proxy** (distance to the nearest PRT stop + a density bump), not
  measured greenhouse-gas emissions or flood/heat risk.
- **The four weights are one possible CDC framework**, not a neutral or official standard.
  Move the sliders and the ranking is supposed to change.
- **Issued zoning labels are not a permit.** `by_right` / `not_allowed` come from a reading
  of Pittsburgh Zoning Code Chapter 911 for the district on the parcel. A planner still
  has to confirm overlays, parking, slope, and lot standards.
- **849 Vista St is a missing-data demo.** ACS 2024 5-year has no matching GeoID for WPRDC
  tract `42003563200`, so renter share and rent burden stay blank. Those factors show
  Insufficient data and are excluded from that site's composite — they are not scored as 0.
- **ADU is scored `not_allowed` citywide in this build** because Pittsburgh does not yet
  have a citywide ADU use (Council Bill 2025-1545 was pending as of this weekend). That
  is a code-status call, not a prediction that the bill will fail.
- **Not legal, financial, or zoning advice.**
"""
)

st.markdown("### Sources")
st.markdown(
    """
- City-Owned Properties, WPRDC: https://data.wprdc.org/dataset/city-owned-properties  
  (CSV dump `e1dcee82-9179-4306-8167-5891915b62a7`). Data Use Agreement on that dataset page.
- Pittsburgh Zoning Code, Chapter 911 Primary Uses: https://ecode360.com/45476528
- ACS 2024 5-year (2020–2024) via Census Reporter for tracts 42003050100 and 42003030500
- Pittsburgh Regional Transit Stops (WPRDC GeoJSON) for nearest-stop distance
"""
)
