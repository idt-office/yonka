#!/usr/bin/env bash
# Serve the Yonkers mech scene on http://localhost:8123
cd "$(dirname "$0")"
if [ ! -f data/city.json ]; then
  echo "data/city.json missing - run: python3 tools/fetch_osm.py" >&2
  exit 1
fi
echo "YONKERS mech scene: http://localhost:8123"
exec python3 -m http.server 8123 --bind 127.0.0.1
