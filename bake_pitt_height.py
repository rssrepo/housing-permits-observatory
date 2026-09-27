"""Downsample pittsburgh.stl to a web height field. Does not copy the 110MB STL into git."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

SRC = Path("/tmp/pitt3d/pittsburgh.stl")
OUT_DIR = Path(__file__).resolve().parent / "web" / "data"
N = 160


def main() -> None:
    raw = SRC.read_bytes()
    n = struct.unpack_from("<I", raw, 80)[0]
    dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    tris = np.frombuffer(raw, dtype=dt, count=n, offset=84)
    verts = tris["v"].reshape(-1, 3)
    xmin, ymin, zmin = verts.min(axis=0)
    xmax, ymax, zmax = verts.max(axis=0)
    grid = np.zeros((N, N), dtype=np.float64)
    xs = verts[:, 0]
    ys = verts[:, 1]
    zs = verts[:, 2]
    ix = np.clip(((xs - xmin) / (xmax - xmin) * (N - 1)).astype(np.int32), 0, N - 1)
    iy = np.clip(((ys - ymin) / (ymax - ymin) * (N - 1)).astype(np.int32), 0, N - 1)
    np.maximum.at(grid, (iy, ix), zs)
    u16 = np.clip((grid / max(zmax, 1e-6) * 65535), 0, 65535).astype(np.uint16)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "pitt-height.u16").write_bytes(u16.tobytes())
    meta = {
        "n": N,
        "xmin": float(xmin),
        "xmax": float(xmax),
        "ymin": float(ymin),
        "ymax": float(ymax),
        "zmin": float(zmin),
        "zmax": float(zmax),
        "lat_south": 40.361,
        "lat_north": 40.501,
        "lon_west": -80.095,
        "lon_east": -79.865,
        "source": "pittsburgh.stl (CGTrader listing 1710379), height-field downsample for the visit map",
        "triangles_in": int(n),
    }
    (OUT_DIR / "pitt-height.json").write_text(json.dumps(meta))
    print(f"Wrote {OUT_DIR / 'pitt-height.u16'} ({u16.nbytes} bytes) from {n} triangles")


if __name__ == "__main__":
    main()
