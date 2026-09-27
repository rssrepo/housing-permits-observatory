# Parcel Fit risk and ranking framework

**Track:** Housing Typology, Equity & Climate Matchmaker (AI Horizons 2026)  
**Decision:** which vacant city-owned lots are worth a CDC site visit this week, and for which housing type.  
**Code:** `web/assets/scoring.js` (factors), `web/assets/match.js` (visit / hold / skip + compare), `web/assets/auth.js` (weights).

This is a **decision-support framework**, not a permit, listing rent, eviction model, or measured carbon inventory.

## 1. What is being compared

Each **pairing** is one lot × one type:

| Type | Studio label |
| --- | --- |
| Two-family house | Duplex |
| Small apartment building | Small multifamily |

Accessory dwelling is not a type: every lot in this file is `not_allowed` for ADU, so it was removed from ranking.

Lots are real City of Pittsburgh vacant city-owned parcels (WPRDC). The genesis sample is four Hill / East Allegheny lots. The studio pool is 3,260 lots. ACS 2024 5-year is joined by current tract GEOID (retired ids remapped). Lots with no tract id, or a tract with no tables, stay blank.

The tool **does not** declare one objectively correct neighborhood or type. It ranks pairings under **staff-chosen weights**, then staff walk, hold, or skip.

## 1a. CDC targeting screens (product)

Pittsburgh CDCs filter vacant lots; they do not acquire at random. Parcel Fit maps those five screens onto **fields that exist** in the WPRDC city-owned vacant dump:

| CDC screen | What we use | What we do not invent |
| --- | --- | --- |
| 1. Data / ownership | `inventory_type`, `current_status`, PIN | Private tax-delinquency, Parcels N'At blight scores |
| 2. Acquisition pathway | Public Sale, URA Transfer, PLB Transfer, CDC Property Reserve | Allegheny County VPRP eligibility, side-lot program flags |
| 3. Clustering | Other city vacant lots within 220 ft (haversine) | Private adjacent owners, engineered site plans |
| 4. By-right density | Chapter 911 reading + `parc_sq_ft` | A full 2024 minimum-lot-size rewrite model |
| 5. Master plan / stewardship | Neighborhood name you staff | Hill District master-plan polygons, Greenways Stewardship, Adopt-A-Lot |

Steep-slope is joined from city 25% polygons. Greenway vs infill is still a staff call: the overlay is a flag, not a conservation ordinance.

## 2. Data vs value judgments

| Layer | What it is | Who sets it |
| --- | --- | --- |
| Data | Zoning reading, lot square feet, ACS tract figures, feet to a PRT stop | Public files |
| Values | How much each factor pulls the walk list this month | CDC staff chips in onboarding |
| Call | Visit / Hold / Skip | Zoning permission for that type (hard gate), not the composite score |

If a factor is missing, it is **dropped from the composite**, not scored as zero. The remaining weights are re-normalized. Gaps stay off the card.

## 3. Hard gate (feasibility risk)

Before mix ranking:

- **Skip** if Chapter 911 use table says the type is not allowed (`not_allowed`).
- **Hold** if zoning is unknown or conditional.
- **Visit** only if the type is by-right in the listed district.

Lot size is scored, not a second hard gate:

- Comfort lines: two-family 2,800 sq ft, small apartment 5,000.
- Tight floors: 1,200 / 1,800 sq ft.

Feasibility score: `0.7 × zoning + 0.3 × lot size`. Zoning: by-right 100, conditional 55, not allowed 8. A recorded steep slope cuts feasibility by 30% when present.

## 4. Five mix factors (0–100 each)

Default weights are even (20 each). Staff can zero a factor.

### Demand (`demand_fit`)

**Metric:** ACS renter share of households (B25003).  
**Meaning:** neighborhood already rents; not a waitlist.  
**Score:** share × type bump (two-family 1.0, small apartment 1.05).

### Affordability need (`affordability_impact`)

**Metric:** ACS share of renters spending 30%+ of income on rent (B25070).  
**Meaning:** cost strain among renters already there.  
**Score:** burden % × type bump (two-family 0.95, small apartment 1.0).

### Displacement pressure (`displacement_risk`)

Hackathon construct. Not HUD displacement, not eviction filings.

**Shown metric (dollars):**

```
gap = ACS median gross rent (B25064)
    − (ACS median household income (B19013) × 0.30 / 12)
```

**Carry** is the HUD-style 30% of income rule, monthly.  
**Paid** is typical rent in the tract, not a listing for this vacant lot.

Worked examples (ACS 2024 5-year):

| Place | Paid | Carry | Gap |
| --- | --- | --- | --- |
| Tract 501 (Centre Ave) | $837 | $761 | ~$76 / month over |
| Tract 305 (Cliff St) | $1,230 | $909 | ~$321 / month over |
| Pittsburgh city (benchmark) | $1,261 median gross rent | — | area benchmark only |

**Ranking score** when paid and carry exist:

```
overpay % = clamp((paid − carry) / carry × 100, 0, 100)
score = clamp((0.55 × rent-burden % + 0.45 × overpay %) × type bump)
```

Type bump: two-family 1.00, small apartment 0.92 (larger product treated as more pressure).  
If rent/income are missing: fall back to burden only, or drop the factor.

**How to say it:** neighborhood cost-pressure flag. A visit only makes sense if the type stays affordable. It does not say a household will be pushed out.

### Transit access (`climate_proxy`)

**Metric:** feet to nearest Port Authority stop (WPRDC PRT GeoJSON, genesis sample).  
**Meaning:** access to opportunity by bus. **Not** marginal carbon, jobs, or schools.  
**Score:** 100 at 400 ft, 0 at 2,640 ft, plus a small density add (two-family 8, small apartment 16).

## 5. Composite (how a pairing gets a number)

For usable (non-missing) factors only:

```
w'_k = staff_weight_k / sum(staff weights on usable factors)
composite = sum(w'_k × score_k)
```

Staff weights are the onboarding chips. Changing chips changes the walk list. Compare names which factor **tipped** the pick when two lots can both take the type.

## 6. Area rent mechanism (not a listing)

When ACS exists, cards also show:

1. Typical paid nearby (B25064).
2. Predicted carry (30% of B19013 / 12).
3. Gap vs Pittsburgh city median gross rent **$1,261** (ACS 2024 5-year).

This is tract context for a vacant lot. There is no unit yet.

## 7. Compare mechanism

Staff pick two lots and a type (or “best allowed”). Winner is:

1. Better visit call (Visit beats Hold beats Skip).
2. Else higher composite under **this month’s mix**.

Reasons (up to four): zoning, lot size, for-sale, mission neighborhood, bus, typical rent vs city, predicted carry, displacement gap, **which weight tipped it**.

## 8. Risks this framework accepts vs refuses

| Risk the challenge named | How this prototype treats it |
| --- | --- |
| Physical feasibility | Zoning + lot size; skip if not allowed |
| Demand | Tract renter share |
| Affordability | Tract rent burden + rent vs carry |
| Displacement | Rent-vs-carry gap + burden; not moves or filings |
| Access to opportunity | Bus distance only |
| Infrastructure capacity | Not in file; omitted |
| Marginal carbon | Not measured; bus is access, not emissions |
| Townhomes / senior housing / ADU | Not in the two-type set |

Human loop: confirm zoning in ROZA / City Planning. Treat ACS as tract, not the parcel. Confirm overlays and lot standards this scorecard does not encode.

## 9. CDC screen (studio route `#/scorecard`)

The visit dossier uses colored tags, strengths vs watch-outs, a vertical CDC filter rail, and expandable facts. Ranking math is specified in `MATCHING.md`. Education and health stay off the board. Steep slope is tagged when the city 25% polygons hit the point.

Tract `42003563200` (Vista) is remapped to ACS vintage `42003563202` when the Census geocoder returns a current GEOID. Blank ACS is only for lots with no tract id or a tract that still has no tables.

## 10. One-sentence pitch

Parcel Fit is CDC vacant-lot targeting on WPRDC public land: ownership, title pathway, cluster assembly, by-right type, neighborhood stewardship, then five visits to walk.
