import * as THREE from 'three';
import { rand } from './rng.js';

// Extruded OpenStreetMap footprints. Static buildings are merged into grid
// cells; buildings near the mech's route stay individual meshes so they can
// topple on footfalls.

export const LAND_H = 3.2;

const CELL = 1500; // merge cell size, metres
const TOPPLE_RADIUS = 260; // buildings near route become dynamic
const TOPPLE_CAP = 2600;
const ROUTE_MARGIN = 300;

const BOROUGH_COLORS = {
  Manhattan: [new THREE.Color('#68727e'), new THREE.Color('#a6d3e6')],
  Brooklyn: [new THREE.Color('#7d7466'), new THREE.Color('#8f8878')],
  Queens: [new THREE.Color('#6f7a84'), new THREE.Color('#83909c')],
  Bronx: [new THREE.Color('#69716a'), new THREE.Color('#7d857e')],
  Yonkers: [new THREE.Color('#746f68'), new THREE.Color('#857f77')],
};
const LAND_COLOR = new THREE.Color('#3a413a');
const tmpC = new THREE.Color();

function ringSignedAreaXZ(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

// Push one prism into the given buffers. pts: [[x,z],...] normalised to
// A<0 winding; (ox,oz) an optional origin offset for local geometry.
function addPrism(pts, h, ox, oz, colTop, colSide, posArr, colArr) {
  const n = pts.length;
  // sides
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const quad = [
      ax - ox, 0, az - oz,
      bx - ox, 0, bz - oz,
      bx - ox, h, bz - oz,
      ax - ox, h, az - oz,
    ];
    // A<0 winding in (x,z) makes (a,b,b',a') quads face outward
    const tris = [0, 1, 2, 0, 2, 3];
    for (const t of tris) {
      posArr.push(quad[t * 3], quad[t * 3 + 1], quad[t * 3 + 2]);
      colArr.push(colSide.r, colSide.g, colSide.b);
    }
  }
  // top cap
  const v2 = pts.map(([x, z]) => new THREE.Vector2(x - ox, z - oz));
  // triangulate in (x, -z): CCW there means upward normal in world
  const vv = pts.map(([x, z]) => new THREE.Vector2(x - ox, -(z - oz)));
  const faces = THREE.ShapeUtils.triangulateShape(vv, []);
  for (const f of faces) {
    for (const idx of [f[0], f[1], f[2]]) {
      posArr.push(v2[idx].x, h, v2[idx].y);
      colArr.push(colTop.r, colTop.g, colTop.b);
    }
  }
}

function makeGeo(posArr, colArr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.computeBoundingSphere();
  return g;
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export async function buildCity(data, scene, route, onProgress = () => {}) {
  const group = new THREE.Group();
  scene.add(group);

  const landMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.02,
  });
  const buildMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.08,
  });

  // ---- land islands
  const boroughOf = {};
  let landSkipped = 0;
  data.boroughs.forEach((b, idx) => {
    boroughOf[b.name] = b;
    // slight per-borough height offset: borough boundaries overlap in the
    // rivers (each claims half of them), the offset avoids z-fighting
    const landH = LAND_H - 0.18 * idx;
    const pos = [];
    const col = [];
    for (const ring of b.rings) {
      const pts = ring.map(([x, y]) => [x, -y]); // to world xz
      if (ringSignedAreaXZ(pts) > 0) pts.reverse();
      const side = LAND_COLOR.clone().multiplyScalar(0.5);
      try {
        addPrism(pts, landH, 0, 0, LAND_COLOR, side, pos, col);
      } catch {
        landSkipped++; // degenerate boundary ring from the map data
      }
    }
    if (pos.length) {
      const mesh = new THREE.Mesh(makeGeo(pos, col), landMat);
      group.add(mesh);
    }
  });

  // ---- buildings
  const dynamicCandidates = [];
  const buckets = new Map(); // cellKey -> {pos, col}
  let total = 0;
  let skipped = 0;
  let segs = [];
  for (let i = 0; i < route.pts.length - 1; i++) {
    const a = route.pts[i];
    const b = route.pts[i + 1];
    segs.push([a.x, a.z, b.x, b.z,
      Math.min(a.x, b.x) - ROUTE_MARGIN, Math.max(a.x, b.x) + ROUTE_MARGIN,
      Math.min(a.z, b.z) - ROUTE_MARGIN, Math.max(a.z, b.z) + ROUTE_MARGIN]);
  }

  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
  const buildings = data.buildings;
  for (let i = 0; i < buildings.length; i++) {
    const [bi, h, flat] = buildings[i];
    const borough = data.boroughs[bi];
    if (!borough || !Array.isArray(flat) || flat.length < 6 || !(h > 0)) {
      skipped++;
      continue;
    }
    const name = borough.name;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const pts = [];
    for (let k = 0; k < flat.length; k += 2) {
      const x = flat[k];
      const z = -flat[k + 1];
      pts.push([x, z]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (maxX - minX > 700 || maxZ - minZ > 700) continue; // data glitch guard
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    // colour: borough base, taller = cooler/glassier, deterministic noise
    const pair = BOROUGH_COLORS[name] || BOROUGH_COLORS.Queens;
    const hh = Math.min(1, h / 280);
    tmpC.copy(pair[0]).lerp(pair[1], hh * hh);
    const hash = ((bi * 73856093) ^ (flat.length * 19349663)) % 97 / 97;
    tmpC.offsetHSL(0, 0, (hash - 0.5) * 0.1);
    const colTop = tmpC.clone();
    const colSide = tmpC.clone().multiplyScalar(0.78);

    // near route? -> dynamic (topple-able)
    let near = false;
    if (route) {
      for (const s of segs) {
        if (maxX < s[4] || minX > s[5] || maxZ < s[6] || minZ > s[7]) continue;
        if (distToSeg(cx, cz, s[0], s[1], s[2], s[3]) < TOPPLE_RADIUS) {
          near = true;
          break;
        }
      }
    }
    if (near) {
      dynamicCandidates.push({ pts, h, cx, cz, colTop, colSide, landH: LAND_H - 0.18 * bi });
    } else {
      const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { pos: [], col: [] }));
      if (ringSignedAreaXZ(pts) > 0) pts.reverse();
      try {
        addPrism(pts, h, 0, 0, colTop, colSide, bucket.pos, bucket.col);
      } catch {
        skipped++; // self-intersecting or collapsed footprint
      }
    }
    total++;
    if (i % 8000 === 0) {
      onProgress(i / buildings.length);
      await yieldFrame();
    }
  }

  // Candidates beyond the topple budget become ordinary static buildings;
  // dropping them would leave an invisible trench along the route.
  dynamicCandidates.sort((a, b) => b.h - a.h);
  for (const b of dynamicCandidates.slice(TOPPLE_CAP)) {
    const key = `${Math.floor(b.cx / CELL)},${Math.floor(b.cz / CELL)}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { pos: [], col: [] }));
    if (ringSignedAreaXZ(b.pts) > 0) b.pts.reverse();
    try {
      addPrism(b.pts, b.h, 0, 0, b.colTop, b.colSide, bucket.pos, bucket.col);
    } catch {
      skipped++;
    }
    total++;
  }

  for (const bucket of buckets.values()) {
    group.add(new THREE.Mesh(makeGeo(bucket.pos, bucket.col), buildMat));
  }

  // ---- dynamic buildings along the route
  const dynMeshes = [];
  const grid = new Map();
  const dynMat = buildMat;
  for (const b of dynamicCandidates.slice(0, TOPPLE_CAP)) {
    if (ringSignedAreaXZ(b.pts) > 0) b.pts.reverse();
    const pos = [];
    const col = [];
    try {
      addPrism(b.pts, b.h, b.cx, b.cz, b.colTop, b.colSide, pos, col);
    } catch {
      skipped++;
      continue;
    }
    const mesh = new THREE.Mesh(makeGeo(pos, col), dynMat);
    const baseY = b.landH + 0.06;
    mesh.position.set(b.cx, baseY, b.cz);
    mesh.userData = { fall: null, baseY };
    scene.add(mesh);
    dynMeshes.push(mesh);
    const key = `${Math.floor(b.cx / 260)},${Math.floor(b.cz / 260)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(mesh);
  }

  // ---- collapse handling
  const axis = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let activeFalls = [];

  function toppleNear(x, z, r, now) {
    const c0 = Math.floor((x - r) / 260);
    const c1 = Math.floor((x + r) / 260);
    const d0 = Math.floor((z - r) / 260);
    const d1 = Math.floor((z + r) / 260);
    let hit = 0;
    outer:
    for (let i = c0; i <= c1; i++) {
      for (let j = d0; j <= d1; j++) {
        const cell = grid.get(`${i},${j}`);
        if (!cell) continue;
        for (const m of cell) {
          if (m.userData.fall) continue;
          const dx = m.position.x - x;
          const dz = m.position.z - z;
          const d = Math.hypot(dx, dz);
          if (d > r) continue;
          hit++;
          m.userData.fall = {
            t0: now + 0.04 + rand() * 0.4,
            dir: Math.atan2(dx, dz) + (rand() - 0.5) * 0.7,
            dur: 0.9 + rand() * 0.8,
            done: false,
          };
          activeFalls.push(m);
          if (hit >= 16) break outer;
        }
      }
    }
    return hit;
  }

  function update(now, dt) {
    if (!activeFalls.length) return;
    const rest = [];
    for (const m of activeFalls) {
      const f = m.userData.fall;
      const s = Math.max(0, Math.min(1, (now - f.t0) / f.dur));
      const e = s * s * (3 - 2 * s);
      axis.set(Math.sin(f.dir), 0, Math.cos(f.dir));
      q.setFromAxisAngle(axis, e * (Math.PI / 2 - 0.14));
      m.quaternion.copy(q);
      m.position.y = m.userData.baseY - e * 2.4;
      if (s < 1) rest.push(m);
    }
    activeFalls = rest;
  }

  function reset() {
    activeFalls = [];
    for (const m of dynMeshes) {
      m.userData.fall = null;
      m.quaternion.identity();
      m.position.y = m.userData.baseY;
    }
  }

  onProgress(1);
  return {
    group,
    stats: {
      buildings: total,
      dynamic: dynMeshes.length,
      cells: buckets.size,
      skipped: skipped + landSkipped,
    },
    toppleNear,
    update,
    reset,
    boroughOf,
  };
}
