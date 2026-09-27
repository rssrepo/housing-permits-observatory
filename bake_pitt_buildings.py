"""Extract schematic building boxes from Pittsburgh_schematic.slpk (I3S)."""

from __future__ import annotations

import gzip
import json
import struct
from pathlib import Path

import numpy as np

SLPK = Path("/tmp/slpk/nodes")
OUT = Path(__file__).resolve().parent / "web" / "data" / "pitt-buildings.bin"
META = Path(__file__).resolve().parent / "web" / "data" / "pitt-buildings.json"


def load_heights(path: Path, n: int) -> np.ndarray:
    if not path.exists():
        return np.zeros(n, dtype=np.float32)
    raw = gzip.decompress(path.read_bytes())
    count = struct.unpack_from("<I", raw, 0)[0]
    return np.frombuffer(raw, dtype="<f4", count=min(count, n), offset=4)


def main() -> None:
    recs = []
    for d in sorted(SLPK.iterdir()):
        idx = d / "3dNodeIndexDocument.json.gz"
        feat_p = d / "features/0.json.gz"
        geom_p = d / "geometries/0.bin.gz"
        if not idx.exists() or not feat_p.exists() or not geom_p.exists():
            continue
        node = json.loads(gzip.decompress(idx.read_bytes()))
        if node.get("children"):
            continue
        mbs = node["mbs"]
        feat = json.loads(gzip.decompress(feat_p.read_bytes()))
        rows = feat.get("featureData") or []
        if not rows:
            continue
        raw = gzip.decompress(geom_p.read_bytes())
        vc, _fc = struct.unpack_from("<II", raw, 0)
        pos = np.frombuffer(raw, dtype="<f4", count=vc * 3, offset=8).reshape(-1, 3)
        heights = load_heights(d / "attributes/f_1/0.bin.gz", len(rows))
        for i, f in enumerate(rows):
            geos = f.get("geometries") or []
            if not geos:
                continue
            a, b = geos[0]["params"]["faceRange"]
            chunk = pos[a * 3 : (b + 1) * 3]
            if chunk.size < 9:
                continue
            lon = float(mbs[0] + chunk[:, 0].mean())
            lat = float(mbs[1] + chunk[:, 1].mean())
            dx = float(chunk[:, 0].max() - chunk[:, 0].min())
            dy = float(chunk[:, 1].max() - chunk[:, 1].min())
            zspan = float(chunk[:, 2].max() - chunk[:, 2].min())
            h_ft = float(heights[i]) if i < len(heights) else 0.0
            h_m = h_ft * 0.3048 if h_ft > 1 else zspan
            if dx <= 0 or dy <= 0 or h_m < 3:
                continue
            recs.append((lon, lat, dx, dy, h_m))
    arr = np.array(recs, dtype=np.float32)
    # dedupe near-identical centroids
    key = np.round(arr[:, 0] * 1e4) * 1e6 + np.round(arr[:, 1] * 1e4)
    _, idx = np.unique(key, return_index=True)
    arr = arr[np.sort(idx)]
    OUT.write_bytes(arr.tobytes())
    META.write_text(
        json.dumps(
            {
                "count": int(len(arr)),
                "stride": 5,
                "fields": ["lon", "lat", "dx_deg", "dy_deg", "height_m"],
                "source": "Pittsburgh_schematic.slpk (I3S 1.6 Building3dSchematic)",
                "extent": [-80.09203623202333, 40.35826960851506, -79.86396348651247, 40.50332713251498],
            }
        )
    )
    print(f"Wrote {len(arr)} buildings → {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
