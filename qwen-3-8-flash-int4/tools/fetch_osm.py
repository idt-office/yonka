#!/usr/bin/env python3
"""Fetch OpenStreetMap data for the Yonkers mech scene.

Pulls borough boundary polygons and building footprints from Overpass API,
filters and deduplicates them, projects to a local Web-Mercator metre grid
and writes a compact scene file to data/city.json.

Usage: python3 tools/fetch_osm.py [--force]
Raw responses are cached under data/raw/ and reused when present.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data", "raw")
OUT = os.path.join(BASE, "data", "city.json")
UA = "yonkers-mech/0.1 (local research; contact: office)"
ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

CENTER = (-73.945, 40.725)  # lon, lat -> scene origin

# Relation ids of the administrative boundaries (checked against name+bbox on
# OSM, see data/raw/rels_probe.json).
BOROUGH_RELS = {
    "Manhattan": 8398124,
    "Brooklyn": 9691750,
    "Queens": 9691819,
    "Bronx": 9691916,
}

# bbox = (south, west, north, east)
BOROUGH_BBOX = {
    "Manhattan": (40.699, -74.022, 40.883, -73.906),
    "Bronx": (40.735, -73.940, 40.917, -73.755),
    "Brooklyn": (40.551, -74.047, 40.740, -73.833),
    "Queens": (40.563, -73.970, 40.790, -73.699),
    "Yonkers": (40.900, -73.950, 40.970, -73.850),
}

# Buildings below this footprint area are dropped (m2). Manhattan is dense
# enough to keep everything; the outer boroughs are mostly row houses.
MIN_AREA = {"Manhattan": 80, "Bronx": 260, "Brooklyn": 260, "Queens": 260, "Yonkers": 150}
DEFAULT_H = {"Manhattan": 22, "Bronx": 12, "Brooklyn": 10, "Queens": 10, "Yonkers": 9}
BOROUGH_ORDER = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Yonkers"]
MAX_PER_BOROUGH = 90000


def overpass(query, tries_per_round=1):
    last = None
    for _ in range(80):
        for ep in ENDPOINTS:
            for _ in range(tries_per_round):
                try:
                    body = urllib.parse.urlencode({"data": query}).encode()
                    req = urllib.request.Request(ep, data=body, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=600) as resp:
                        return json.loads(resp.read().decode())
                except Exception as exc:  # noqa: BLE001 - retry any transport error
                    last = exc
                    print(f"  retry after error from {ep}: {exc}", flush=True)
        time.sleep(20)
    raise RuntimeError(f"all overpass endpoints failed: {last}")


def cached(name, query):
    path = os.path.join(RAW, name)
    if os.path.exists(path) and os.path.getsize(path) > 100:
        with open(path) as fh:
            return json.load(fh)
    print(f"fetching {name} ...", flush=True)
    data = overpass(query)
    with open(path, "w") as fh:
        json.dump(data, fh)
    return data


# ---------------------------------------------------------------- boundaries

def fetch_boundary(rel_id, force):
    path = os.path.join(RAW, f"boundary_{rel_id}.json")
    if os.path.exists(path) and os.path.getsize(path) > 100 and not force:
        with open(path) as fh:
            return json.load(fh)
    q = f"[out:json][timeout:300];rel(id:{rel_id});out body;>;out skel qt;"
    data = overpass(q)
    with open(path, "w") as fh:
        json.dump(data, fh)
    return data


def assemble_rings(data, rel_id):
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in data["elements"] if e["type"] == "node"}
    ways = {}
    outer_ids = []
    for e in data["elements"]:
        if e["type"] == "way":
            ways[e["id"]] = list(e["nodes"])
        elif e["type"] == "relation" and e["id"] == rel_id:
            for m in e.get("members", []):
                if m["type"] == "way" and m.get("role", "") in ("outer", ""):
                    if m["ref"] not in outer_ids:
                        outer_ids.append(m["ref"])

    # walk the boundary graph: at each open end follow the next unused way.
    adj = defaultdict(list)
    for wid in outer_ids:
        if wid not in ways:
            continue
        nd = ways[wid]
        adj[nd[0]].append(wid)
        adj[nd[-1]].append(wid)

    unused = {w for w in outer_ids if w in ways}
    rings = []
    for _pass in range(3):
        for start in list(unused):
            if start not in unused:
                continue
            unused.discard(start)
            consumed = [start]
            pts = list(ways[start])
            guard = 0
            while pts[0] != pts[-1] and guard < 5000:
                guard += 1
                nxt = [w for w in adj[pts[-1]] if w in unused]
                if not nxt:
                    break
                w = nxt[0]
                unused.discard(w)
                consumed.append(w)
                nd = ways[w]
                pts.extend(nd[1:] if nd[0] == pts[-1] else list(reversed(nd))[1:])
            if pts[0] == pts[-1] and len(pts) > 5:
                rings.append([nodes[n] for n in pts[:-1] if n in nodes])
            else:
                unused.update(consumed)  # retry the pieces in a later pass
        if not unused:
            break
    return rings


# ---------------------------------------------------------------- buildings

def fetch_buildings(bbox_key, force):
    """Query building ways; dense boroughs go in 2x2 sub-bboxes so single
    requests stay inside the public Overpass servers' memory and time budget."""
    bb = BOROUGH_BBOX[bbox_key]
    (s, w, n, e) = bb
    if bbox_key in ("Brooklyn", "Queens", "Bronx", "Manhattan"):
        mid_s, mid_n = (s + n) / 2, (s + n) / 2
        mid_w, mid_e = (w + e) / 2, (w + e) / 2
        boxes = [(s, w, mid_n, mid_e), (s, mid_w, mid_n, e),
                 (mid_s, w, n, mid_e), (mid_s, mid_w, n, e)]
    else:
        boxes = [bb]
    elements = []
    for k, box in enumerate(boxes, 1):
        path = os.path.join(RAW, f"buildings_{bbox_key}_{k}.json")
        if os.path.exists(path) and os.path.getsize(path) > 100 and not force:
            with open(path) as fh:
                elements.extend(json.load(fh)["elements"])
            continue
        q = f'[out:json][timeout:900];way["building"]({box[0]},{box[1]},{box[2]},{box[3]});out geom;'
        data = overpass(q)
        with open(path, "w") as fh:
            json.dump(data, fh)
        elements.extend(data["elements"])
        time.sleep(5)
    return {"elements": elements}


# ---------------------------------------------------------------- geometry

R = 6378137.0


def project(lon, lat):
    x = R * math.radians(lon - CENTER[0])
    y = R * (math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
             - math.log(math.tan(math.pi / 4 + math.radians(CENTER[1]) / 2)))
    return (x, y)


def ring_area(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def centroid(poly):
    x = sum(p[0] for p in poly) / len(poly)
    y = sum(p[1] for p in poly) / len(poly)
    return (x, y)


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_borough(pt, rings):
    return any(point_in_ring(pt, r) for r in rings)


def parse_height(tags):
    h = tags.get("height") or tags.get("building:height")
    if h:
        num = ""
        for ch in str(h):
            if ch.isdigit() or ch == ".":
                num += ch
            elif num:
                break
        if num:
            try:
                val = float(num)
                if "ft" in str(h):
                    val *= 0.3048
                return val
            except ValueError:
                pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return float(str(lv).split(";")[0].split(":")[0]) * 3.2
        except ValueError:
            pass
    return None


def simplify_ring(pts, min_dist=0.8):
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1])) > min_dist:
            out.append(p)
    if len(out) > 2:
        d = abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1])
        if d < min_dist:
            out.pop()
    return out


def main():
    force = "--force" in sys.argv
    os.makedirs(RAW, exist_ok=True)

    borough_rings = {}
    for name, rid in BOROUGH_RELS.items():
        data = fetch_boundary(rid, force)
        rings = assemble_rings(data, rid)
        # project to metres
        proj = [[project(lon, lat) for lon, lat in ring] for ring in rings]
        proj = [r for r in proj if ring_area(r) > 1e5]  # drop specks
        borough_rings[name] = proj
        total = sum(ring_area(r) for r in proj)
        print(f"{name}: {len(proj)} outer rings, {total/1e6:.1f} km2", flush=True)

    # Yonkers city boundary (only used as stage for the rise, no buildings).
    yonkers_ring_file = os.path.join(RAW, "yonkers_rel.json")
    if os.path.exists(yonkers_ring_file):
        with open(yonkers_ring_file) as fh:
            yrel = json.load(fh)
        rid = yrel["rel_id"]
        data = fetch_boundary(rid, force)
        rings = assemble_rings(data, rid)
        proj = [[project(lon, lat) for lon, lat in ring] for ring in rings]
        proj = [r for r in proj if ring_area(r) > 1e5]
        borough_rings["Yonkers"] = proj
        print(f"Yonkers: {len(proj)} rings", flush=True)
    else:
        print("Yonkers boundary not available (data/raw/yonkers_rel.json missing), "
              "mech will start in upper Manhattan", flush=True)

    # buildings
    seen_ids = set()
    buildings = {k: [] for k in BOROUGH_ORDER}
    for borough in BOROUGH_ORDER:
        if borough not in borough_rings:
            continue
        data = fetch_buildings(borough, force)
        rings = borough_rings[borough]
        kept = 0
        for e in data["elements"]:
            if e["id"] in seen_ids:
                continue
            tags = e.get("tags", {})
            if "building" not in tags:
                continue
            pts = e.get("geometry")
            if not pts or len(pts) < 3:
                continue
            if pts[0]["lon"] == pts[-1]["lon"] and pts[0]["lat"] == pts[-1]["lat"]:
                pts = pts[:-1]
            projected = [project(p["lon"], p["lat"]) for p in pts]
            projected = simplify_ring(projected)
            if len(projected) < 3:
                continue
            c = centroid(projected)
            if not point_in_borough(c, rings):
                continue
            area = ring_area(projected)
            if area < MIN_AREA[borough]:
                continue
            h = parse_height(tags)
            if h is None:
                h = DEFAULT_H[borough]
                if borough == "Manhattan" and area < 400:
                    h = 12  # small footprints in Manhattan are shops, not towers
            h = max(4.0, min(500.0, h))
            seen_ids.add(e["id"])
            buildings[borough].append((area, h, projected))
            kept += 1
        print(f"{borough}: kept {kept} buildings", flush=True)

    # cap: keep the largest buildings if a borough is over budget
    for borough, items in buildings.items():
        if len(items) > MAX_PER_BOROUGH:
            items.sort(key=lambda t: -t[0])
            print(f"{borough}: capped {len(items)} -> {MAX_PER_BOROUGH}", flush=True)
            buildings[borough] = items[:MAX_PER_BOROUGH]

    order = [b for b in BOROUGH_ORDER if b in borough_rings]
    out = {
        "center": CENTER,
        "boroughs": [
            {"name": b, "rings": [[[round(x, 1), round(y, 1)] for x, y in r]
                                  for r in borough_rings[b]]}
            for b in order
        ],
        "buildings": [],
    }
    for bi, borough in enumerate(order):
        for area, h, pts in buildings[borough]:
            flat = [round(v, 1) for p in pts for v in p]
            out["buildings"].append([bi, round(h, 1), flat])

    total = len(out["buildings"])
    verts = sum(len(b[2]) // 2 for b in out["buildings"])
    print(f"total buildings: {total}, footprint vertices: {verts}")
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
