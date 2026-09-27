# Parcel Fit

**Track:** Housing Typology, Equity & Climate Matchmaker  
**Event:** AI Horizons 2026, AI for Housing Hackathon (Pittsburgh)  
**Team:** Rahul (solo)

**Live:** https://rssrepo.github.io/housing-permits-observatory/  
CDC demo desk: `cdc@hillcdc.org` / `pittsburgh` (Hill District CDC as the example shopper). The map is still every empty city lot. After login you land on Home. Set this week’s walk, then use Visits, City map, and Investment.

## What this is

A walk-list desk for **vacant lots the City of Pittsburgh already owns**. Staff pick a housing type and where they will actually go. The app shows lots that already allow that type, whether a nearby finished-home sale could cover land plus a simple wood-frame build, and a 3D city map of the same inventory.

It is decision support for who to walk this week. It is not a permit, a listing, legal advice, or a bid.

The ranking spec is [`MATCHING.md`](MATCHING.md). CDC screens: [`FRAMEWORK.md`](FRAMEWORK.md).

## What you can do

- **Visits:** Walk / Wait / Skip from zoning. Mix score only orders lots that share a call. Missing inputs are dropped, never scored as zero.
- **City map:** Color all ~3,260 lots by mix, flood, hills, heat, trees, bus, or your visits. Click a peg to add that PIN to Visits.
- **Investment:** Nearby Zillow typical home, this lot's land from 2024-2025 vacant sales, wood-frame hard cost at $180/sf. Leftover math uses only house counts the district already allows. HOME $261,595 per 2-bedroom is a subsidy ceiling, not construction cost.
- **Find a lot / Compare / This lot / How it works:** Search by address or PIN, compare two lots or two types, copy a PIN, read every public file we joined.

## Lots

The studio reads `web/data/sites.json`: **3,260 vacant city-owned lots** in **76 named neighborhoods** (one lot has no neighborhood in the city file). Built by `build_citywide.py` from the WPRDC dump. Parks, greenways, and permanent city ownership are out.

Each lot is keyed by **county PIN**. Pegs do not share IDs.

`sites.csv` is only the original four Hill / East Allegheny sample rows used while the citywide file was built. The live app does not rank from that CSV.

| Sample row | Why it was first |
| --- | --- |
| 2523 Centre Ave (Middle Hill, RM-M) | Hill corridor, for sale |
| 2901 Centre Ave (Middle Hill, LNC) | Same corridor, storefront district |
| 1800 Cliff St (Crawford-Roberts, RM-M) | CDC property reserve |
| 849 Vista St (East Allegheny, R1A-VH) | Geography that used to miss ACS; tract is remapped, blanks stay blank if tables are missing |

## Housing types

Two-family house, small apartment, single-family house, affordable housing (a home already allowed in a below-typical-income tract, not a tax-credit award), offices, commercial, industrial. Accessory dwelling is not offered: it is not allowed citywide on these lots.

Walk / Wait / Skip is a Chapter 911 reading of the listed district, not a ROZA certificate.

## What it does not do

- Does not invent ACS, zoning, or a tenant.
- Does not treat missing as zero.
- Does not measure air temperature, flood BFE, or carbon of a new building. Trees use the city’s street-tree calculator. Heat is land surface vs the city mean (TPL 2023).
- Does not scrape Zillow listings. ZHVI is a neighborhood typical finished home, not this vacant lot.
- Does not use 2012 tax-roll land as the headline. That roll is a footnote. Headline land is 2024-2025 recorded vacant-lot sales, scaled by square feet (almost never this PIN's own sale).
- Does not pretend a four-house sale on a lot that only allows a house.

## Data sources

Full list with links is on **How it works** in the app. In short:

- City-Owned Properties, City of Pittsburgh / WPRDC. https://data.wprdc.org/dataset/city-owned-properties  
  Dump: `https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7`  
  **Terms:** that page’s Data Use Agreement.
- Pittsburgh Zoning Code, Chapter 911. https://ecode360.com/45476528
- ACS 2024 5-year via Census Reporter (renters, rent, income, rent strain, tract home value when Zillow has no name). Blank tracts stay blank.
- Zillow Research ZHVI (neighborhood, middle third, through August 2026 in this file). Pittsburgh city typical about $239,865. Unmatched names (Homewood West, St. Clair, and others) stay without ZHVI.
- WPRDC real-estate sales 2024 and 2025 (vacant 0-address Pittsburgh lots). County assessments 2012 FAIRMARKETLAND as footnote.
- HOME 2-bedroom ceiling $261,595, Allegheny County 2025 addendum.
- PRT stops, FEMA NFHL (plus 2014 city extract), 25% slope, TPL heat, DPW street trees, HUD LIHTC.
- Schematic 3D buildings for the city map (downsampled; the original SLPK is not in the repo).

Wood-frame $180/sf is a midpoint assumption ($150-$210 Type V garden range), not a public dataset and not a contractor bid.

## How to run

```bash
python3 serve.py
```

Open http://127.0.0.1:8080 · same demo.

Rebuild lots from WPRDC (then re-run the `join_*.py` scripts if you need ACS, flood, ZHVI, land, heat):

```bash
python3 build_citywide.py
```

Optional leftover Streamlit scorecard on the four sample rows in `sites.csv`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

That Streamlit app is not the product judges should open.

## Code map

| Path | Role |
| --- | --- |
| `web/` | Static studio (GitHub Pages root) |
| `web/assets/app.js` | Routes, home, visits, investment, briefing |
| `web/assets/match.js` | Walk cards, compare, investment stacks |
| `web/assets/scoring.js` | Mix factors, land/sale/build math |
| `web/assets/city3d.js` | 3D map |
| `web/data/sites.json` | Lot file the studio loads |
| `join_layers.py`, `join_policy.py`, `join_heat.py`, `join_zillow.py`, `join_land_sales.py`, `join_value.py` | Public-file joins onto `sites.json` |

## AI tools used

I used **Cursor** to build the static studio, joins, scoring, and copy. Ranking numbers come from joined public files and staff weights, not from a model inventing ACS or zoning. Vista and other gaps stay blank where the source is blank.

## Human-in-the-loop

Confirm zoning in ROZA / City Planning. Confirm flood on the printed FIRM if NFHL says SFHA. Confirm slope and overlays in the field. Treat Census as the tract, Zillow as the neighborhood typical, and land sales as a citywide vacant $/sf unless this PIN has its own 2024–2025 market sale.

## Attestation

I am 18+ and all code in this repository was written during the hackathon build window (Saturday 9:00 a.m. ET onward). Commit history reflects this.
