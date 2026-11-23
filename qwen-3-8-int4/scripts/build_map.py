#!/usr/bin/env python3
"""Tile the OSM area around NYC (Manhattan/Queens/Brooklyn/Yonkers) into one PNG atlas."""
import json, math, os, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = 13
# bbox to cover: Yonkers (N) down to southern Brooklyn, Hudson (W) to eastern Queens (E)
LAT_S, LAT_N = 40.535, 41.015
LON_W, LON_E = -74.035, -73.645
UA = "yonkers-mech-demo/1.0 (local visualisation, low volume)"

def deg2tile(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y

def tile2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / n))))
    return lat, lon

x0, y0 = deg2tile(LAT_N, LON_W, Z)
x1, y1 = deg2tile(LAT_S, LON_E, Z)
TX0, TX1 = int(math.floor(x0)), int(math.ceil(x1)) - 1
TY0, TY1 = int(math.floor(y0)), int(math.ceil(y1)) - 1
cols, rows = TX1 - TX0 + 1, TY1 - TY0 + 1
print(f"tiles: x {TX0}..{TX1} ({cols}), y {TY0}..{TY1} ({rows}) -> {cols*rows} tiles")

tile_dir = os.path.join(ROOT, "data", "tiles")
os.makedirs(tile_dir, exist_ok=True)
for ty in range(TY0, TY1 + 1):
    for tx in range(TX0, TX1 + 1):
        p = os.path.join(tile_dir, f"{Z}_{tx}_{ty}.png")
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            continue
        url = f"https://tile.openstreetmap.org/{Z}/{tx}/{ty}.png"
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    data = r.read()
                with open(p, "wb") as f:
                    f.write(data)
                break
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(1.5)
        time.sleep(0.08)  # be polite to the tile server

from PIL import Image
atlas = Image.new("RGB", (cols * 256, rows * 256))
for ty in range(TY0, TY1 + 1):
    for tx in range(TX0, TX1 + 1):
        im = Image.open(os.path.join(tile_dir, f"{Z}_{tx}_{ty}.png")).convert("RGB")
        atlas.paste(im, ((tx - TX0) * 256, (ty - TY0) * 256))
atlas_path = os.path.join(ROOT, "data", "atlas.png")
atlas.save(atlas_path, optimize=True)
print("atlas:", atlas_path, atlas.size, os.path.getsize(atlas_path))

# world mapping: 1 unit = 1 meter, origin = NW corner of the tile grid
lat_n, lon_w = tile2deg(TX0, TY0, Z)
lat_s, lon_e = tile2deg(TX1 + 1, TY1 + 1, Z)
lat_mid = (lat_n + lat_s) / 2
m_per_lon = 111320.0 * math.cos(math.radians(lat_mid))
m_per_lat = 110574.0
world_w = (lon_e - lon_w) * m_per_lon
world_h = (lat_n - lat_s) * m_per_lat

def to_world(lat, lon):
    return ((lon - lon_w) * m_per_lon, (lat_n - lat) * m_per_lat)

meta = {
    "z": Z, "cols": cols, "rows": rows, "tx0": TX0, "ty0": TY0,
    "origin": {"lat": lat_n, "lon": lon_w},
    "width_m": round(world_w, 1), "height_m": round(world_h, 1),
    "m_per_lon": m_per_lon, "m_per_lat": m_per_lat,
}
# label / waypoint positions (city centers)
points = {
    "yonkers": (40.9303, -73.8988),
    "manhattan": (40.7549, -73.9840),
    "brooklyn": (40.6892, -73.9903),
    "queens": (40.7447, -73.9492),
}
meta["points"] = {k: [round(v[0], 4), round(v[1], 4), round(to_world(*v)[0], 1), round(to_world(*v)[1], 1)] for k, v in points.items()}

with open(os.path.join(ROOT, "data", "tilemap.json"), "w") as f:
    json.dump(meta, f, indent=1)
print(json.dumps({k: meta[k] for k in ("width_m", "height_m", "origin")}, indent=1))
print("points:", meta["points"])
