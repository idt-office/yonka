import { project } from './proj.js';

// Route in lon/lat. Starts on the Yonkers waterfront, cuts through the Bronx
// into Manhattan, down the island, over the East River into Brooklyn and on
// through Queens to Flushing Meadows.
const ROUTE_YONKERS = [
  [-73.8905, 40.9375], // Yonkers waterfront
  [-73.899, 40.915],
  [-73.908, 40.893],
  [-73.916, 40.8745], // Spuyten Duyvil
  [-73.924, 40.867], // Inwood (Manhattan)
  [-73.933, 40.848],
  [-73.9385, 40.83],
  [-73.944, 40.813],
  [-73.95, 40.798],
  [-73.958, 40.783],
  [-73.966, 40.768], // central park south
  [-73.974, 40.76],
  [-73.982, 40.752],
  [-73.987, 40.745], // midtown canyon
  [-73.9905, 40.738],
  [-73.99, 40.729],
  [-73.992, 40.718],
  [-73.9945, 40.7095], // city hall, manhattan bridge west
  [-73.988, 40.702], // manhattan bridge east / york st
  [-73.981, 40.6975],
  [-73.972, 40.6945],
  [-73.96, 40.696],
  [-73.947, 40.6985],
  [-73.933, 40.7005], // bushwick
  [-73.916, 40.701], // ridgewood
  [-73.899, 40.7035],
  [-73.882, 40.714],
  [-73.868, 40.728], // corona
  [-73.854, 40.74],
  [-73.8452, 40.7462], // flushing meadows
];

const ROUTE_MANHATTAN = ROUTE_YONKERS.slice(4); // fallback start: Inwood

// Cinematic jump-cuts: after `after` metres walked, the mech "arrives" at
// `to` (waypoint index) with a flash. The long stretches north of midtown
// would otherwise take minutes of real stomping.
const CUTS_YONKERS = [
  { after: 700, to: 10, cap: 'SECTOR // MIDTOWN' },
  { after: 2100, to: 17, cap: 'SECTOR // EAST RIVER' },
  { after: 2800, to: 23, cap: 'SECTOR // BROOKLYN' },
  { after: 2400, to: 'END', cap: 'SECTOR // FLUSHING MEADOWS' },
];
const CUTS_MANHATTAN = [
  { after: 600, to: 6, cap: 'SECTOR // MIDTOWN' },
  { after: 2100, to: 13, cap: 'SECTOR // EAST RIVER' },
  { after: 2800, to: 19, cap: 'SECTOR // BROOKLYN' },
  { after: 2400, to: 'END', cap: 'SECTOR // FLUSHING MEADOWS' },
];

export function buildRoute(landNames) {
  const hasYonkers = landNames.includes('Yonkers');
  const wgs = hasYonkers ? ROUTE_YONKERS : ROUTE_MANHATTAN;
  const cuts = hasYonkers ? CUTS_YONKERS : CUTS_MANHATTAN;
  const pts = wgs.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return { x, z: -y }; // three.js: north is -z
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const total = cum[cum.length - 1];
  const cutDefs = cuts.map((c) => ({
    after: c.after,
    to: c.to === 'END' ? total - 2400 : cum[c.to],
    cap: c.cap,
  }));
  const route = { pts, cum, total, cuts: cutDefs, start: pts[0], hasYonkers };
  route._posAt = (d) => posAt(route, d);
  route._headingAt = (d) => headingAt(route, d);
  return route;
}

// Position at distance d along the polyline.
export function posAt(route, d) {
  d = Math.max(0, Math.min(route.total, d));
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i] < d) i++;
  const a = route.pts[i - 1];
  const b = route.pts[i];
  const s = (d - route.cum[i - 1]) / Math.max(1e-6, route.cum[i] - route.cum[i - 1]);
  return { x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s };
}

// Heading (yaw so that local +z faces travel direction) at distance d.
// Near the route end sample backwards, otherwise the forward sample clamps
// to the same point and atan2(0,0) turns the mech to north.
export function headingAt(route, d) {
  const d1 = Math.min(d + 60, route.total);
  const d0 = d1 - 60 >= 0 ? Math.min(d, d1 - 60) : d1 - 60;
  const a = posAt(route, d0);
  const b = posAt(route, d1);
  return Math.atan2(b.x - a.x, b.z - a.z);
}
