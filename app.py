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
    is_unknown,
    load_sites,
    ranked,
    read_field,
    score_site,
    site_record,
)

ROOT = Path(__file__).resolve().parent
SITES_PATH = ROOT / "sites.csv"

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,500;0,600;1,500&family=Outfit:wght@400;500;600&display=swap');
html, body, [class*="css"] { font-family: Outfit, ui-sans-serif, system-ui, sans-serif; }
.stApp {
  background:
    radial-gradient(900px 420px at 78% -8%, rgba(255, 186, 140, 0.42), transparent 55%),
    radial-gradient(700px 380px at 12% 0%, rgba(120, 178, 230, 0.45), transparent 50%),
    linear-gradient(180deg, #8ec4ee 0%, #d5e7f6 26%, #eef3f7 52%, #f6f3ee 100%);
}
.stApp, .stApp p, .stApp li, .stApp label { color: #1A2230; }
#MainMenu, header[data-testid="stHeader"], .stDeployButton,
footer, [data-testid="stToolbar"], [data-testid="stDecoration"] { display: none !important; }
.eyebrow {
  display: inline-flex; padding: 0.28rem 0.7rem; border-radius: 999px;
  background: rgba(255,255,255,0.55); border: 1px solid rgba(255,255,255,0.7);
  font-size: 0.68rem; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 500; color: #3a4658;
}
h1, .hero-title {
  font-family: "EB Garamond", Georgia, serif !important; font-weight: 500 !important;
  letter-spacing: -0.03em; line-height: 1.08; text-wrap: balance;
}
.hero-title { font-size: clamp(2.2rem, 4.5vw, 3.2rem); margin: 0.35rem 0 0.35rem; color: #152033; }
.hero-lede { max-width: 36rem; font-size: 1.02rem; line-height: 1.5; color: #3d4a5c; }
.kicker { font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: #66758a; font-weight: 500; }
.answer {
  font-family: "EB Garamond", Georgia, serif; font-size: clamp(1.5rem, 3vw, 2.05rem);
  line-height: 1.2; margin: 0.4rem 0 1rem; color: #152033; text-wrap: balance;
}
.score-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.8rem; margin: 0.6rem 0 1rem; }
@media (max-width: 900px) { .score-row { grid-template-columns: 1fr; } }
.score-card { background: rgba(255,255,255,0.82); border-radius: 1.2rem; padding: 1rem 1.1rem; }
.score-card.top { outline: 2px solid #4C6FFF; }
.score-card .rank { font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: #7a8798; }
.score-card .name { font-size: 0.95rem; font-weight: 500; margin-top: 0.2rem; }
.score-card .num {
  font-family: "EB Garamond", Georgia, serif; font-size: 2.5rem; font-variant-numeric: tabular-nums;
  line-height: 1; margin-top: 0.45rem;
}
.score-card.missing .num { color: #8a93a3; font-size: 1.5rem; }
.why { background: rgba(255,255,255,0.72); border-radius: 1.2rem; padding: 1rem 1.15rem; max-width: 40rem; }
.why li { margin: 0.35rem 0; }
.gap {
  display: inline-block; margin: 0.2rem 0.35rem 0.2rem 0; padding: 0.28rem 0.65rem;
  border-radius: 999px; background: rgba(232, 196, 120, 0.35); font-size: 0.8rem;
}
div.stButton > button {
  border-radius: 999px !important; padding: 0.45rem 1.15rem !important;
  background: #4C6FFF !important; color: white !important; border: 0 !important; font-weight: 500 !important;
}
</style>
"""

ZONING_PLAIN = {
    "by_right": "allowed by right",
    "conditional": "conditional",
    "not_allowed": "not allowed",
}


def shown(row: dict, key: str) -> str:
    value = read_field(row, key)
    return "Unknown" if is_unknown(value) else str(value)


def zoning_plain(row: dict, key: str) -> str:
    value = read_field(row, key)
    if is_unknown(value):
        return "Unknown"
    return ZONING_PLAIN.get(str(value).lower(), str(value))


def why_winner(row: dict, result: dict, winner: str) -> list[str]:
    factors = result["typologies"][winner]["factors"]
    lines = []
    zkey = {
        "duplex": "zoning_allows_duplex",
        "small_multifamily": "zoning_allows_small_multifamily",
    }[winner]
    lines.append(
        f"Zoning: {TYPOLOGY_LABELS[winner]} is {zoning_plain(row, zkey)} in {shown(row, 'zoned_as')} "
        f"({shown(row, 'parc_sq_ft')} sq ft lot)."
    )
    demand = factors["demand_fit"]["score"]
    if is_unknown(demand):
        lines.append("Neighborhood renter share: no ACS data for this tract, so demand was left out of the score.")
    else:
        lines.append(f"Neighborhood renter share is {shown(row, 'tract_renter_share')}% (ACS). That supports rental product.")
    burden = factors["affordability_impact"]["score"]
    if is_unknown(burden):
        lines.append("Rent burden: no ACS data, so affordability was left out of the score (not treated as zero).")
    else:
        lines.append(f"About {shown(row, 'tract_rent_burden_pct')}% of renters here are cost-burdened (ACS).")
    dist = factors["climate_proxy"]["score"]
    if not is_unknown(dist):
        lines.append(f"Nearest PRT stop is {shown(row, 'transit_distance_ft')} ft away (a climate proxy, not emissions).")
    return lines


def missing_labels(row: dict) -> list[str]:
    checks = [
        ("tract_renter_share", "renter share"),
        ("tract_rent_burden_pct", "rent burden"),
        ("tract_median_income", "median income"),
        ("steep_slope", "steep slope"),
        ("transit_distance_ft", "transit distance"),
        ("zoning_allows_duplex", "duplex zoning"),
        ("zoning_allows_small_multifamily", "small multifamily zoning"),
    ]
    return [label for key, label in checks if is_unknown(read_field(row, key))]


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


st.set_page_config(page_title="Typology Matchmaker", layout="centered")
st.markdown(CSS, unsafe_allow_html=True)

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
    rec["site_id"]: (rec.get("label") or rec.get("address") or rec["site_id"])
    for rec in sites.to_dict(orient="records")
}

st.markdown('<span class="eyebrow">For a CDC staffer  ·  four Pittsburgh lots</span>', unsafe_allow_html=True)
st.markdown('<h1 class="hero-title">Pick a site. See what type of housing fits.</h1>', unsafe_allow_html=True)
st.markdown(
    '<p class="hero-lede">You are choosing among two-family houses and small apartment buildings. '
    "This is a ranking under your priorities, not a permit.</p>",
    unsafe_allow_html=True,
)

st.markdown('<p class="kicker">1. Choose a parcel</p>', unsafe_allow_html=True)
site_id = st.radio(
    "Site",
    options=list(labels),
    format_func=lambda sid: labels[sid],
    label_visibility="collapsed",
)

with st.expander("2. Optional: change what you care about (weights)"):
    st.caption("These sliders are your value judgment. They are not in the data. They sum to 100% after normalize.")
    w_feas = st.slider("Can we build it (zoning + lot)", 0, 100, 25)
    w_demand = st.slider("Does the neighborhood rent", 0, 100, 25)
    w_aff = st.slider("Are renters cost-burdened", 0, 100, 25)
    w_clim = st.slider("Close to transit (climate proxy)", 0, 100, 25)
    st.caption("Leave these at 25 if you just want an even split.")

weights = {
    "feasibility": w_feas,
    "demand_fit": w_demand,
    "affordability_impact": w_aff,
    "climate_proxy": w_clim,
}

row = site_record(sites, site_id)
result = score_site(row, weights)
order = ranked(result)
winner = order[0][0]
winner_score = order[0][1]
winner_name = TYPOLOGY_LABELS[winner]
addr = shown(row, "address")

st.markdown('<p class="kicker" style="margin-top:1.2rem">3. Read the recommendation</p>', unsafe_allow_html=True)
if is_unknown(winner_score):
    rec = f"Not enough scored factors to rank types on {addr}."
else:
    rec = (
        f"On {addr}, <em>{winner_name.lower()}</em> ranks first "
        f"({float(winner_score):.0f} / 100) under the weights you set."
    )
st.markdown(f'<p class="answer">{rec}</p>', unsafe_allow_html=True)

cards = []
for i, (typ, score) in enumerate(order, start=1):
    missing = is_unknown(score)
    num = "n/a" if missing else f"{float(score):.0f}"
    klass = "score-card missing" if missing else ("score-card top" if i == 1 else "score-card")
    cards.append(
        f'<div class="{klass}"><div class="rank">0{i}</div>'
        f'<div class="name">{TYPOLOGY_LABELS[typ]}</div>'
        f'<div class="num">{num}</div></div>'
    )
st.markdown('<div class="score-row">' + "".join(cards) + "</div>", unsafe_allow_html=True)

st.markdown('<p class="kicker">Why (for the top type only)</p>', unsafe_allow_html=True)
why_html = "".join(f"<li>{line}</li>" for line in why_winner(row, result, winner))
st.markdown(f'<div class="why"><ul>{why_html}</ul></div>', unsafe_allow_html=True)

gaps = missing_labels(row)
if gaps:
    st.markdown('<p class="kicker" style="margin-top:1rem">Unknown on this site</p>', unsafe_allow_html=True)
    st.markdown(
        "".join(f'<span class="gap">{g}</span>' for g in gaps)
        + "<p style='font-size:0.85rem;color:#5a6778;margin-top:0.5rem'>Unknown fields are excluded from the score. They are not entered as zero.</p>",
        unsafe_allow_html=True,
    )

st.caption("A City Planning / PLI review still has to happen before anyone buys drawings.")

with st.expander("Parcel snapshot"):
    st.write(
        {
            "Neighborhood": shown(row, "neighborhood_name"),
            "Inventory": shown(row, "inventory_type"),
            "Class": shown(row, "class"),
            "PIN": shown(row, "pin"),
            "Duplex": zoning_plain(row, "zoning_allows_duplex"),
            "Small multifamily": zoning_plain(row, "zoning_allows_small_multifamily"),
        }
    )

with st.expander("How each type was scored"):
    st.caption("From data vs unknown vs your weights. Insufficient data is not a zero.")
    table_rows = []
    for typ in TYPOLOGIES:
        block = result["typologies"][typ]
        for fac in FACTORS:
            cell = block["factors"][fac]
            score = cell["score"]
            table_rows.append(
                {
                    "Type": TYPOLOGY_LABELS[typ],
                    "Factor": FACTOR_LABELS[fac],
                    "State": "Unknown" if is_unknown(score) else "From data",
                    "Score": "Insufficient data" if is_unknown(score) else str(score),
                    "Source": cell.get("source", ""),
                }
            )
    st.dataframe(pd.DataFrame(table_rows), width="stretch", hide_index=True)

with st.expander("Ask AI to phrase this ranking"):
    st.caption("Optional. Numbers are already computed. This only writes 2-3 sentences.")
    if st.button("Explain this ranking"):
        payload = {
            "site": addr,
            "winner": winner_name,
            "ranking": [
                {"type": TYPOLOGY_LABELS[t], "score": s if not is_unknown(s) else "Insufficient data"}
                for t, s in order
            ],
            "why": why_winner(row, result, winner),
            "unknown": gaps,
        }
        try:
            st.markdown(f"**AI-generated (not a zoning determination):** {ai_explain(payload)}")
        except Exception as exc:  # noqa: BLE001
            st.error(f"Explanation request failed. No substitute text was generated.\n\n{exc}")

with st.expander("Limits and sources"):
    st.markdown(
        """
- Four illustrative city-owned sites, not a citywide model.
- Climate is distance to a PRT stop, not measured emissions.
- Weights are one CDC-style framework.
- Zoning is a Chapter 911 reading, not a ROZA or permit.
- Vista St has no matching ACS tract in the 2024 5-year file; those cells stay blank.
- Accessory dwelling is not a type: it is not allowed citywide on these lots.
- Not legal, financial, or zoning advice.

Sources: [WPRDC City-Owned Properties](https://data.wprdc.org/dataset/city-owned-properties) (Data Use Agreement on that page);
[Pittsburgh Zoning Code Ch. 911](https://ecode360.com/45476528);
ACS 2024 5-year via Census Reporter (tracts 501 and 305);
WPRDC PRT stops.
"""
    )
