# Matching and prioritization

This is the ranking specification for Parcel Fit. Implementation lives in `web/assets/scoring.js` (factor scores) and `web/assets/match.js` (gates, walk order, compare, tradeoffs). Joins that fill lot fields live in `join_layers.py` and `join_policy.py`.

Parcel Fit does **not** pick a correct lot. It ranks **lot × housing type** pairings under staff weights, then staff walk, hold, or skip. A high number is not a permit.

## 1. Unit of ranking

A **pairing** is one vacant city-owned lot and one type. Two-family and small apartment use `zoning_allows_duplex` / `zoning_allows_small_multifamily`. Single-family, office, commercial, industrial, and affordable use the Chapter 911 reading in `web/assets/zone.js`. Accessory dwelling is not ranked.

The live UI labels the gate **Walk / Wait / Skip** (same as Visit / Hold / Skip below).

The studio pool is about **3,260** WPRDC city-owned vacant lots. Parks, greenways, hold-for-study, and permanent city ownership are excluded upstream in `build_citywide.py`.

## 2. Two layers: hard call vs mix number

These are not the same thing.

### Hard call (Visit / Hold / Skip)

`verdictFor` reads only the Chapter 911 use-table field for that type:

| Zoning token | Call | UI |
| --- | --- | --- |
| `by_right` | `go` | Visit |
| `conditional` or missing | `caution` | Hold |
| `not_allowed` | `no-go` | Skip |

Lot square feet, flood, slope, trees, LIHTC, and ACS **do not** change Visit/Hold/Skip. They change the mix number, the tradeoff sentences, and (for slope) feasibility.

### Mix number (0–100 composite)

Used only after the call, to order Visit lots against other Visit lots (then Hold, then Skip).

## 3. How a pairing gets a number

`scoreSite(row, weights)` scores every type in `TYPOLOGIES`. Each type has five factors. Each factor is either a 0–100 number **from data** or `unknown`.

**Missing is dropped, never zero.** If a factor is unknown, it is omitted and the remaining staff weights are renormalized onto what exists.

```
usable = factors whose score is not unknown
w'_k   = staff_weight_k / sum(staff weights on usable)
composite = sum(w'_k × score_k)
```

If **every** factor is unknown, the composite is unknown. Unknown composites sort last among a given call (`-1` vs a real number).

Default staff weights are even (20 each). Zeroing a factor in onboarding removes it from the mix. If all five are zero, the normalizer treats them as equal so the list does not collapse.

## 4. Factor formulas

Comfort lot sizes (scored, not a second hard gate):

| Type | Tight floor | Comfort line |
| --- | --- | --- |
| Two-family | 1,200 | 2,800 |
| Small apartment | 1,800 | 5,000 |

### Feasibility (`feasibility`) — 70% zoning, 30% lot

Zoning points: by-right 100, conditional 55, not allowed 8.

Lot points: 100 at or above the comfort line, 15 at or below the floor, linear in between.

If zoning or lot size is missing, the whole factor is unknown.

If `steep_slope` is yes, feasibility is multiplied by **0.7** (a 30% cut). Slope is the city 25%+ slope polygons, reprojected from NAD83 Pennsylvania South feet (EPSG:2272) to WGS84 for the join.

### Demand (`demand_fit`)

ACS 2024 5-year renter share of households (B25003), times a type bump: two-family 1.0, small apartment 1.05. Capped at 100. This is who already rents nearby, not a waitlist.

### Affordability need (`affordability_impact`)

ACS share of renters spending 30%+ of income on rent (B25070), times: two-family 0.95, small apartment 1.0. High need raises the score when staff weight this factor. It is not “this lot will be cheap.”

### Displacement pressure (`displacement_risk`)

Hackathon construct. Not HUD displacement, not eviction filings.

```
paid  = ACS median gross rent (B25064)
carry = ACS median household income (B19013) × 0.30 / 12
gap   = paid − carry
overpay % = clamp((paid − carry) / carry × 100, 0, 100)
score = clamp((0.55 × rent-burden % + 0.45 × overpay %) × type bump)
```

Type bump: two-family 1.00, small apartment 0.92 (more homes treated as more pressure). If rent and income are missing, fall back to burden only, or drop the factor.

A **high** displacement score means the tract is already overpaying. Staff who weight this factor are asking the list to **surface** those blocks (so they can keep the product affordable), not to hide them.

### Transit (`climate_proxy`) — labeled climate, measured as bus

Feet to nearest Port Authority stop (`transit_distance_ft` from PRT GeoJSON).

```
access = 100 at 400 ft, 0 at 2,640 ft, linear between
score  = clamp(access + density add)
```

Density add: two-family 8, small apartment 16. This is access, **not** operational carbon of a building.

## 5. Sort order (the walk list)

`sortPairings` / `applyVisitMemory`:

1. **Call:** Visit, then Hold, then Skip.
2. **Visit memory:** lots marked “already walked” without a preferred type are removed. If staff marked a preferred type on a visit, those types sort above others inside the same call.
3. **Composite:** higher mix number first. Unknown last.
4. **Pinned extras:** `currentWalks` puts `extraWalks` (Find a lot / Compare extras) **first**, then the ranked rest, **unique by `site_id`**. There is no five-visit cap.

Neighborhood, status, PIN search, and “by-right only” are **filters**. They shrink the pool before ranking. They are not weights.

Mission neighborhoods (`missionPlaces`) do **not** change the composite. They show up in Compare copy when one lot is in a place you staff.

## 6. Compare

Staff pick two lots and a type (or “best allowed”). Winner:

1. Better call (Visit beats Hold beats Skip).
2. Else higher composite under **this month’s** weights.

Reasons can include zoning, lot size, for-sale status, acquisition path, cluster count within 220 ft, mission neighborhood, bus, typical rent vs Pittsburgh ($1,261 ACS city median gross rent), carry, displacement gap, and **which weighted factor tipped** the mix (`weight × score gap`). If nothing else differs, the copy says the mix ranked one higher.

## 7. What is on the lot but **not** in the composite

These fields are joined for tradeoffs, tags, and the CDC screen. They **do not** currently move the 0–100 mix number. If onboarding later hard-filters them, that is a filter, not a fifth-and-a-half factor.

| Field | Source | How it is used |
| --- | --- | --- |
| `inventory_type` | WPRDC vacant dump | Pathway: Public Sale, URA Transfer, PLB Transfer, CDC Property Reserve |
| Nearby lots ≤ 220 ft | Haversine on lat/lon | Assembly / cluster |
| `flood_zone_nfhl`, `flood_sfha` | Live FEMA NFHL MapServer (point) | Flood sentences. 2014 extract kept as `flood_zone` |
| `steep_slope` | City 25% slope polygons | Feasibility cut **and** tradeoff |
| `trees_400ft`, `tree_co2_lbs` | DPW street trees ~2020 | Shade proxy + city forestry CO2 calculator on **trees**, not the building |
| `lihtc_ft`, `lihtc_name` | HUD LIHTC FeatureServer, Pittsburgh | Distance to nearest mapped tax-credit project |
| `who_note`, `income_vs_city_pct` | Tract ACS income vs city $65,742 | Who lives nearby now, not who gets a future key |
| ACS GEOID remap | Census geocoder | Retired tract ids (example: Vista `42003563200` → `42003563202`) |
| `zillow_zhvi_usd` | Zillow Research ZHVI neighborhood | Typical finished home nearby. Not this vacant lot. Unmatched names stay blank. |
| `land_comp_usd`, `land_sale_usd` | WPRDC 2024–2025 vacant sales | Headline land. 2012 `assess_land_fmv` is a footnote. |
| `heat_severity` | TPL Heat Severity USA 2023 | Land surface vs city mean, not air temperature. |

**Still not in the model:** operational kilograms of a new building, named future tenant, VPRP eligibility, master-plan polygons, private tax-delinquent stock, schools, health. Investment leftover is a separate stack (`buildAfford`): it is not the mix number, and it only uses house counts already allowed on the lot.

## 8. Tradeoff sheet (You get / You give up / Not answered)

Built in `tradeoffSheet` from the same pairing. Caps at five unique lines per column. Staff displacement/demand weights can prepend a line when they clash with the lot (renter block vs overpaying neighbors).

Not answered always includes building operational carbon. ACS-missing tracts stay blank, not filled from a neighbor.

## 9. Worked intuition

Same lot, two types, even weights:

- Two-family **by-right** vs small apartment **not allowed:** two-family is Visit and ranks first no matter how “needed” apartments are. Zoning is the gate.
- Both by-right, staff crank transit: the lot closer to a PRT stop wins the mix, even if the other lot has more street trees (trees are not in the mix).
- Staff crank displacement: overpaying tracts **rise**, because that factor scores high where the gap is high. The card must still say the visit only makes sense if the product stays affordable.

## 10. Human loop

Confirm zoning in ROZA / City Planning. Treat ACS as the **tract**, not the parcel. Confirm BFE on the FIRM if NFHL says SFHA. Confirm slope and overlays in the field. This file is decision support for a walk list.
