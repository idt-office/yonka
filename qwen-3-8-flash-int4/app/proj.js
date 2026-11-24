// Web-Mercator projection to a local metre grid, shared with tools/fetch_osm.py.
const CENTER = [-73.945, 40.725]; // lon, lat
const R = 6378137.0;
const LAT0 = Math.log(Math.tan(Math.PI / 4 + (CENTER[1] * Math.PI) / 360));

export function project(lon, lat) {
  const x = (R * (lon - CENTER[0]) * Math.PI) / 180;
  const y = R * (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) - LAT0);
  return [x, y];
}

export { CENTER };
