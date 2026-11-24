"""Synthetic stand-in for data/city.json so the renderer can be tested
before the Overpass download finishes. Same schema as fetch_osm.py output."""
import json
import math
import random

R = 6378137.0
CLON, CLAT = -73.945, 40.725


def proj(lon, lat):
    x = R * math.radians(lon - CLON)
    y = R * (math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
             - math.log(math.tan(math.pi / 4 + math.radians(CLAT) / 2)))
    return (x, y)


def rect(cx, cy, w, h):
    return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
            [cx + w / 2, cy + h * 0.2], [cx + w * 0.2, cy + h / 2],
            [cx - w / 2, cy + h / 2]]


boroughs = [
    {"name": "Manhattan", "rings": [[list(map(round, p)) for p in rect(*proj(-73.965, 40.765), 3500, 16000)]]},
    {"name": "Brooklyn", "rings": [[list(map(round, p)) for p in rect(*proj(-73.955, 40.694), 7000, 7000)]]},
    {"name": "Queens", "rings": [[list(map(round, p)) for p in rect(*proj(-73.870, 40.726), 9000, 8000)]]},
]
boroughs = [{"name": b["name"], "rings": [[[round(v, 1) for v in pt] for pt in r] for r in b["rings"]]} for b in boroughs]

random.seed(4)
buildings = []
specs = [
    (0, proj(-73.965, 40.765), (3000, 14000), 4000, 220),
    (1, proj(-73.955, 40.694), (6000, 6000), 3000, 60),
    (2, proj(-73.870, 40.726), (8000, 7000), 3000, 45),
]
for bi, pos, span, count, hmax in specs:
    cx, cy = pos
    for _ in range(count):
        x = cx + random.uniform(-span[0] / 2, span[0] / 2)
        y = cy + random.uniform(-span[1] / 2, span[1] / 2)
        w = random.uniform(12, 45)
        h = random.uniform(6, hmax)
        flat = [x - w / 2, y - w / 2, x + w / 2, y - w / 2, x + w / 2, y + w / 2, x - w / 2, y + w / 2]
        buildings.append([bi, round(h, 1), [round(v, 1) for v in flat]])

json.dump({"center": [CLON, CLAT], "boroughs": boroughs, "buildings": buildings},
          open("data/city_test.json", "w"), separators=(",", ":"))
print("synthetic city:", len(buildings), "buildings")
