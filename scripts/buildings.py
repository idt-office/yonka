#!/usr/bin/env python3
"""Fetch tall buildings (building=, height>=25m or levels>=8) for the NYC bbox from Overpass,
parse footprints and write data/buildings.json as [x, z, halfX, halfZ, height]."""
import json, os, sys, time, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT_S, LAT_N = 40.535, 41.015
LON_W, LON_E = -74.035, -73.645
UA = "yonkers-mech-demo/1.0 (local visualisation)"

QUERY = (
    '[out:json][timeout:120];('
    f'way["building"]["height"~"^(2[5-9]|[3-9][0-9]|[1-9][0-9]{{2,}})(\\.[0-9]+)?$"]({LAT_S},{LON_W},{LAT_N},{LON_E});'
    f'way["building"]["building:levels"~"^([89]|[1-9][0-9])(\\.[0-9]+)?$"]({LAT_S},{LON_W},{LAT_N},{LON_E});'
    ');out geom;'
)

meta = json.load(open(os.path.join(ROOT, "data", "tilemap.json")))
lat_n, lon_w = meta["origin"]["lat"], meta["origin"]["lon"]
m_per_lon, m_per_lat = meta["m_per_lon"], meta["m_per_lat"]

def to_world(lat, lon):
    return ((lon - lon_w) * m_per_lon, (lat_n - lat) * m_per_lat)

raw_path = os.path.join(ROOT, "data", "overpass_raw.json")
raw = None
if os.path.exists(raw_path):
    raw = open(raw_path, "rb").read()
    print("using cached raw", len(raw) // 1024, "KB", flush=True)
else:
    for attempt in range(40):
        wait = min(240, 15 * (2 ** (attempt // 2)))
        ok = False
        for host in ["https://overpass-api.de/api/interpreter", "https://maps.overpass-api.de/api/interpreter"]:
            try:
                body = urllib.parse.urlencode({"data": QUERY}).encode()
                req = urllib.request.Request(host, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=240) as r:
                    raw = r.read()
                print(f"OK via {host} on try {attempt+1}, {len(raw)//1024} KB", flush=True)
                ok = True
                break
            except Exception as e:
                print(f"try {attempt+1} {host}: {e}", flush=True)
        if ok:
            with open(raw_path, "wb") as f:
                f.write(raw)
            break
        time.sleep(wait)
    else:
        print("FAILED to fetch from Overpass")
        sys.exit(1)

data = json.loads(raw)
out = []
seen = set()
for el in data.get("elements", []):
    if el.get("type") != "way":
        continue
    geom = el.get("geometry")
    if not geom or len(geom) < 3:
        continue
    # Overpass "out geom" gives the outer ring as a flat list of {lat, lon}
    # (sometimes nested as {"coordinates": [...]}); normalize to (lon, lat).
    first = geom[0]
    if isinstance(first, dict) and "coordinates" in first:
        raw_ring = first["coordinates"]
    elif isinstance(first, list):
        raw_ring = first
    else:
        raw_ring = geom
    ring = [(c["lon"], c["lat"]) for c in raw_ring]
    if len(ring) < 3:
        continue
    tags = el.get("tags", {})
    h = tags.get("height")
    if h is None:
        levels = float(tags.get("building:levels", 0) or 0)
        h = None if levels < 8 else levels * 3.5
    else:
        try:
            h = float(h)
        except ValueError:
            continue
    if h is None or h < 25 or h > 420:
        continue
    lats = [c[1] for c in ring]
    lons = [c[0] for c in ring]
    w1 = to_world(min(lats), min(lons))
    w2 = to_world(max(lats), max(lons))
    cx, cz = (w1[0] + w2[0]) / 2, (w1[1] + w2[1]) / 2
    hx, hz = abs(w2[0] - w1[0]) / 2, abs(w2[1] - w1[1]) / 2
    if hx < 3 or hz < 3 or hx > 800 or hz > 800:
        continue
    key = (round(cx, 1), round(cz, 1), round(h, 0))
    if key in seen:
        continue
    seen.add(key)
    out.append([round(cx, 1), round(cz, 1), round(hx, 1), round(hz, 1), round(h, 1)])

out.sort(key=lambda b: b[4])
with open(os.path.join(ROOT, "data", "buildings.json"), "w") as f:
    json.dump(out, f)
print(f"buildings: {len(out)} written")
