# Housing Typology Matchmaker

**Track:** Housing Typology, Equity & Climate Matchmaker  
**Event:** AI Horizons 2026 — AI for Housing Hackathon (Pittsburgh)  
**Team:** Rahul (solo)

## What this does

A CDC-scale Streamlit tool that scores three housing types (ADU, duplex, small multifamily) on four inspectable factors for **four real City of Pittsburgh parcels**. Weights are user-controlled. Missing inputs show as **Insufficient data** and are dropped from the composite, not scored as zero.

## Sites

Hand-picked from WPRDC City-Owned Properties after `fetch_sites.py` filtered to Centre Ave **or** `inventory_type = CDC Property Reserve`:

| Site | Why it is in the set |
| --- | --- |
| 2523 Centre Ave (Middle Hill, RM-M, Available for Sale) | Hill District corridor, URA transfer, vacant land |
| 2901 Centre Ave (Middle Hill, LNC, Available for Sale) | Same corridor, neighborhood commercial district |
| 1800 Cliff St (Crawford-Roberts, RM-M, CDC Property Reserve) | Already earmarked for CDC use; larger lot |
| 849 Vista St (East Allegheny, R1A-VH, CDC Property Reserve) | Different district; **ACS geography does not match** — left blank |

`sites.csv` is the ground-truth table the app reads. Empty cells stay empty.

## What it does NOT do

- Not a citywide matchmaker or parcel-by-parcel production model.
- No measured climate emissions — transit distance + density is a proxy.
- Weights are one CDC-style framework, not a neutral standard.
- Zoning calls are a Chapter 911 use-table reading for `zoned_as`, not a ROZA or variance outcome. Pittsburgh still had **no citywide ADU use** as of this build (CB 2025-1545 pending).
- No rent forecast, no household-flow model. ACS renter share and rent burden are tract proxies only.

## Data sources

- City-Owned Properties — City of Pittsburgh / WPRDC. https://data.wprdc.org/dataset/city-owned-properties  
  Dump: `https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7`  
  **License/terms:** the dataset page’s click-through Data Use Agreement (attribution, no warranty, do not redistribute non-public information).
- Pittsburgh Zoning Code, Chapter 911 Primary Uses. https://ecode360.com/45476528
- ACS 2024 5-year (2020–2024) via Census Reporter for tracts `42003050100` and `42003030500`. Tract `42003563200` is **not in that release**; those ACS cells are blank.
- Pittsburgh Regional Transit Stops (WPRDC GeoJSON) — nearest-stop distance in feet, computed once and stored in `sites.csv`.

## Libraries / tools

- Python, pandas, Streamlit
- `scoring.py` for the rule-based engine
- `fetch_sites.py` to download and filter WPRDC candidates (not used at app runtime)
- requests only for the optional OpenAI explanation (and for `fetch_sites.py`)

## AI tools used and how

I used **Cursor** to write `fetch_sites.py`, the scoring rules, the Streamlit layout, and the missing-data path. I used an **optional OpenAI call** in the app to phrase a 2–3 sentence explanation of the *already computed* ranking. **I decided** which four parcels and three typologies to include, what the four factors are, that weights re-normalize when a factor is missing, and which limitations to put on screen. I did not ask the model to invent ACS or zoning values; 849 Vista St stays blank where ACS does not resolve.

## Limitations / uncertainty

This prototype compares three typologies on four real publicly owned sites using published zoning categories, lot size, tract ACS (where the tract exists), and distance to a PRT stop. It is not a citywide equity/climate model, not measured emissions, and not a permit. Missing ACS or zoning fields display as insufficient data and are omitted from that typology’s composite so a gap cannot masquerade as a zero.

## Human-in-the-loop / escalation path

A CDC or planner should confirm the parcel with City Planning / OneStopPGH (ROZA), read overlays and lot standards that this scorecard does not encode, and treat ACS tract figures as neighborhood context rather than site-level household data. This dashboard is not a substitute for that review.

## How to run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Optional: `export OPENAI_API_KEY=...` then use **Explain this ranking**.

Refresh the candidate list (does not overwrite `sites.csv`):

```bash
python fetch_sites.py
```

## Attestation

I am 18+ and all code in this repository was written during the hackathon build window (Saturday 9:00 a.m. ET onward). Commit history reflects this.
