"""Rule-based typology scores. Every number is inspectable; missing inputs never become 0."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

import pandas as pd

UNKNOWN = "unknown"

TYPOLOGIES = ("duplex", "small_multifamily")
TYPOLOGY_LABELS = {
    "duplex": "Duplex",
    "small_multifamily": "Small multifamily",
}
FACTORS = ("feasibility", "demand_fit", "affordability_impact", "climate_proxy")
FACTOR_LABELS = {
    "feasibility": "Feasibility",
    "demand_fit": "Demand fit",
    "affordability_impact": "Affordability impact",
    "climate_proxy": "Climate (proxy)",
}
ZONING_FIELDS = {
    "duplex": "zoning_allows_duplex",
    "small_multifamily": "zoning_allows_small_multifamily",
}

# Lot-size targets in sq ft. These are scoring heuristics, not code minimums.
LOT_FULL_SCORE = {"duplex": 2800, "small_multifamily": 5000}
LOT_MIN_SCORE = {"duplex": 1200, "small_multifamily": 1800}


def is_unknown(value: Any) -> bool:
    return value is UNKNOWN


def read_field(row: Mapping[str, Any], key: str) -> Any:
    """Return the cell as-is, or UNKNOWN. Never coerce blank/NaN to 0."""
    if key not in row:
        return UNKNOWN
    value = row[key]
    try:
        if value is None or pd.isna(value):
            return UNKNOWN
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if text == "" or text.lower() in {"na", "n/a", "nan", "none", "unknown", "no data"}:
        return UNKNOWN
    return text


def parse_float(row: Mapping[str, Any], key: str) -> Any:
    raw = read_field(row, key)
    if is_unknown(raw):
        return UNKNOWN
    try:
        return float(str(raw).replace(",", ""))
    except ValueError:
        return UNKNOWN


def parse_zoning(row: Mapping[str, Any], key: str) -> Any:
    raw = read_field(row, key)
    if is_unknown(raw):
        return UNKNOWN
    token = str(raw).strip().lower().replace(" ", "_")
    if token in {"by_right", "by-right", "p", "permitted"}:
        return "by_right"
    if token in {"conditional", "s", "special", "special_exception", "a", "administrator"}:
        return "conditional"
    if token in {"not_allowed", "not-allowed", "n", "prohibited"}:
        return "not_allowed"
    return UNKNOWN


def _clamp(n: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, n))


def _linear(value: float, start: float, end: float) -> float:
    """Map value from [start, end] onto 0–100 (start → 0, end → 100)."""
    if end == start:
        return 100.0 if value >= end else 0.0
    return _clamp(100.0 * (value - start) / (end - start))


def score_zoning(allows: str) -> float:
    """Ch. 911 permission only. Variance is a human path, not a score bump."""
    if allows == "by_right":
        return 100.0
    if allows == "conditional":
        return 55.0
    return 8.0  # known not_allowed — a real low score, not a missing value


def score_lot(typology: str, sq_ft: float) -> float:
    full = LOT_FULL_SCORE[typology]
    floor = LOT_MIN_SCORE[typology]
    if sq_ft >= full:
        return 100.0
    if sq_ft <= floor:
        return 15.0
    return 15.0 + 85.0 * (sq_ft - floor) / (full - floor)


def feasibility(row: Mapping[str, Any], typology: str) -> dict[str, Any]:
    """Zoning (required) + lot size (required). Slope is recorded but not required.

    If zoning or lot size is unknown, the whole factor is UNKNOWN so it cannot
    drag the composite down as a fake zero.
    """
    zoning = parse_zoning(row, ZONING_FIELDS[typology])
    lot = parse_float(row, "parc_sq_ft")
    slope = read_field(row, "steep_slope")
    sources = [ZONING_FIELDS[typology], "parc_sq_ft"]
    if is_unknown(zoning) or is_unknown(lot):
        missing = []
        if is_unknown(zoning):
            missing.append(ZONING_FIELDS[typology])
        if is_unknown(lot):
            missing.append("parc_sq_ft")
        return {
            "status": UNKNOWN,
            "score": UNKNOWN,
            "source": ", ".join(missing),
            "detail": "Insufficient data for feasibility",
            "slope": slope if not is_unknown(slope) else UNKNOWN,
        }
    z = score_zoning(zoning)
    lot_s = score_lot(typology, float(lot))
    score = 0.7 * z + 0.3 * lot_s
    # Optional modifier only when we actually know slope.
    if not is_unknown(slope) and str(slope).lower() in {"yes", "true", "steep", "1"}:
        score *= 0.7
        sources.append("steep_slope")
    return {
        "status": "from_data",
        "score": round(_clamp(score), 1),
        "source": " + ".join(sources),
        "detail": f"zoning={zoning}; lot={lot:.0f} sq ft; slope={slope if not is_unknown(slope) else 'unknown (not used)'}",
        "slope": slope if not is_unknown(slope) else UNKNOWN,
    }


def demand_fit(row: Mapping[str, Any], typology: str) -> dict[str, Any]:
    """Renter share is a rough demand proxy, not a household-flow model.

    Small multifamily is assumed to fit high-renter tracts slightly better;
    ADU slightly less so (one extra unit vs several).
    """
    share = parse_float(row, "tract_renter_share")
    if is_unknown(share):
        return {
            "status": UNKNOWN,
            "score": UNKNOWN,
            "source": "tract_renter_share",
            "detail": "Insufficient data for demand fit",
        }
    bump = {"duplex": 1.0, "small_multifamily": 1.05}[typology]
    return {
        "status": "from_data",
        "score": round(_clamp(float(share) * bump), 1),
        "source": "tract_renter_share",
        "detail": f"renter share={float(share):.1f}% × typology factor {bump}",
    }


def affordability_impact(row: Mapping[str, Any], typology: str) -> dict[str, Any]:
    """Higher tract rent burden → more weight on adding relatively denser types.

    This is not a rent forecast and not an AMI model.
    """
    burden = parse_float(row, "tract_rent_burden_pct")
    if is_unknown(burden):
        return {
            "status": UNKNOWN,
            "score": UNKNOWN,
            "source": "tract_rent_burden_pct",
            "detail": "Insufficient data for affordability impact",
        }
    bump = {"duplex": 0.95, "small_multifamily": 1.0}[typology]
    return {
        "status": "from_data",
        "score": round(_clamp(float(burden) * bump), 1),
        "source": "tract_rent_burden_pct",
        "detail": f"rent burden 30%+ = {float(burden):.1f}% × typology factor {bump}",
    }


def climate_proxy(row: Mapping[str, Any], typology: str) -> dict[str, Any]:
    """Closer to a PRT stop scores higher; denser types get a small additive bump.

    Not measured GHG. Walk-shed: 100 at ≤400 ft, 0 at ≥½ mile (2640 ft).
    """
    dist = parse_float(row, "transit_distance_ft")
    if is_unknown(dist):
        return {
            "status": UNKNOWN,
            "score": UNKNOWN,
            "source": "transit_distance_ft",
            "detail": "Insufficient data for climate proxy",
        }
    access = 100.0 - _linear(float(dist), 400.0, 2640.0)
    density = {"duplex": 8.0, "small_multifamily": 16.0}[typology]
    return {
        "status": "from_data",
        "score": round(_clamp(access + density), 1),
        "source": "transit_distance_ft (+ typology density heuristic)",
        "detail": f"{float(dist):.0f} ft to nearest PRT stop; density bump {density:.0f}",
    }


FACTOR_FNS = {
    "feasibility": feasibility,
    "demand_fit": demand_fit,
    "affordability_impact": affordability_impact,
    "climate_proxy": climate_proxy,
}


def normalize_weights(weights: Mapping[str, float]) -> dict[str, float]:
    cleaned = {k: max(0.0, float(weights.get(k, 0))) for k in FACTORS}
    total = sum(cleaned.values())
    if total <= 0:
        even = 1.0 / len(FACTORS)
        return {k: even for k in FACTORS}
    return {k: v / total for k, v in cleaned.items()}


def composite_for_typology(factors: Mapping[str, dict[str, Any]], weights: Mapping[str, float]) -> dict[str, Any]:
    """Drop UNKNOWN factors, then re-normalize remaining weights so a gap is not a zero."""
    usable = {k: factors[k]["score"] for k in FACTORS if not is_unknown(factors[k]["score"])}
    if not usable:
        return {"status": UNKNOWN, "score": UNKNOWN, "used_factors": []}
    w = normalize_weights(weights)
    subtotal = sum(w[k] for k in usable)
    if subtotal <= 0:
        return {"status": UNKNOWN, "score": UNKNOWN, "used_factors": list(usable)}
    score = sum(w[k] / subtotal * float(usable[k]) for k in usable)
    return {
        "status": "from_data",
        "score": round(score, 1),
        "used_factors": list(usable),
        "dropped_factors": [k for k in FACTORS if k not in usable],
    }


def score_site(row: Mapping[str, Any], weights: Mapping[str, float]) -> dict[str, Any]:
    out: dict[str, Any] = {"typologies": {}, "weights": normalize_weights(weights)}
    for typ in TYPOLOGIES:
        factors = {name: fn(row, typ) for name, fn in FACTOR_FNS.items()}
        out["typologies"][typ] = {
            "factors": factors,
            "composite": composite_for_typology(factors, weights),
        }
    return out


def ranked(result: Mapping[str, Any]) -> list[tuple[str, Any]]:
    rows = []
    for typ in TYPOLOGIES:
        comp = result["typologies"][typ]["composite"]["score"]
        rows.append((typ, comp))
    numeric = [(t, s) for t, s in rows if not is_unknown(s)]
    missing = [(t, s) for t, s in rows if is_unknown(s)]
    numeric.sort(key=lambda x: x[1], reverse=True)
    return numeric + missing


def load_sites(path: str) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=True)


def site_record(df: pd.DataFrame, site_id: str) -> dict[str, Any]:
    match = df[df["site_id"] == site_id]
    if match.empty:
        raise KeyError(site_id)
    return match.iloc[0].to_dict()


@dataclass
class FactorView:
    typology: str
    factor: str
    score: Any
    source: str
    detail: str
    state: str = field(default="from_data")
