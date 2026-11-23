// app.js - Yonkers Prime: Stadt aus OSM-Kacheln + OSM-Gebaeude, Mech steht auf und trampft.
import * as THREE from './vendor/three.module.js';
import { buildMech, sampleRise, legWalkPose, STANDING } from './mech.js';

// ---------------------------------------------------------------- boot
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

const $ = (id) => document.getElementById(id);
const ui = {
  status: $('status'), speed: $('speed'), speedVal: $('speedVal'),
  prog: $('prog').firstElementChild, replay: $('replay'),
  camCine: $('camCine'), camOrbit: $('camOrbit'), camTop: $('camTop'),
  loader: $('loader'),
};

// Fallback-Gebaeude, falls buildings.json fehlt
function fallbackBuildings(tm) {
  const p = tm.points;
  const out = [];
  const clusters = [
    { c: p.manhattan, w: 2600, d: 7000, n: 700, hmax: 400 },
    { c: p.brooklyn, w: 4200, d: 3600, n: 700, hmax: 220 },
    { c: p.queens, w: 3600, d: 3200, n: 600, hmax: 260 },
  ];
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const cl of clusters) {
    for (let i = 0; i < cl.n; i++) {
      out.push([
        cl.c[2] + (rnd() - 0.5) * cl.w,
        cl.c[3] + (rnd() - 0.5) * cl.d,
        10 + rnd() * 22, 10 + rnd() * 22,
        25 + Math.pow(rnd(), 2.2) * cl.hmax,
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Sim
const S = {
  t: 0,            // Simulationszeit (bereits mit S.speed skaliert)
  speed: 3,
  state: 'rise',   // rise | walk | pause | end
  stateT: 0,
  phase: 0,        // Ganges-Phase in "Schritten" (1.0 = 1 Fuss-Planting)
  seg: 0,
  traveled: 0,
  camMode: 'cine',
  shake: 0,
};

const STRIDE = 128;      // m pro Schritt (skaliert mit MECH_SCALE)
const BASE_SPEED = 30;   // m/s bei 1x - groessere Schritte, langsamere Kadenz
const MECH_SCALE = 2.2;  // Mech ~990 m hoch - dominierender als der 417 m WTC
const RISE_DUR = 7.0;
const RISE_GLOW_END = 1.2;
const PAUSE_DUR = 2.6;

let tilemap, route, totalDist = 0;
let mech, cam, fx, city, renderer, scene, nameplate;

async function main() {
  const t0 = performance.now();
  try {
    tilemap = await loadJSON('data/tilemap.json');
  } catch (e) {
    ui.loader.querySelector('p').textContent = 'tilemap.json fehlt - erst scripts/build_map.py laufen lassen';
    throw e;
  }
  let buildings, usedFallback = false;
  try {
    buildings = await loadJSON('data/buildings.json');
  } catch {
    buildings = fallbackBuildings(tilemap);
    usedFallback = true;
  }

  const p = tilemap.points;
  route = [
    { name: 'Yonkers', x: p.yonkers[2], z: p.yonkers[3] },
    { name: 'Manhattan', x: p.manhattan[2], z: p.manhattan[3] },
    { name: 'Brooklyn', x: p.brooklyn[2], z: p.brooklyn[3] },
    { name: 'Queens', x: p.queens[2], z: p.queens[3] },
  ];
  for (let i = 1; i < route.length; i++) {
    totalDist += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  }

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  $('stage').appendChild(renderer.domElement);

  scene = makeScene();
  makeGround(tilemap);
  city = makeCity(buildings);
  mech = makeMech();
  fx = makeFX();
  makeLabels();
  cam = makeCamera();
  nameplate = makeNameplate();
  scene.add(nameplate);

  applyURLJump();
  wireUI();
  ui.loader.classList.add('hide');
  setStatus('Yonkers hebt sich aus dem Boden…');
  console.log(`ready in ${Math.round(performance.now() - t0)} ms, ${buildings.length} buildings${usedFallback ? ' (Fallback)' : ''}`);

  lastNow = performance.now();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- Sim-Update
function updateSim(sdt) {
  const m = mech;
  const target = route[S.seg + 1];
  const dx = target ? target.x - m.pos.x : 0;
  const dz = target ? target.z - m.pos.z : 0;
  const dist = target ? Math.hypot(dx, dz) : 0;

  // Zustandsmaschine
  if (S.state === 'rise') {
    if (S.stateT >= RISE_DUR) {
      S.state = 'walk';
      S.stateT = 0;
      setStatus('Trampft nach Manhattan…');
    }
  } else if (S.state === 'walk') {
    const v = BASE_SPEED * sdt;
    m.pos.x += (dx / dist) * v;
    m.pos.z += (dz / dist) * v;
    S.traveled += v;
    S.phase += v / STRIDE;
    if (dist < 80) {
      m.pos.x = target.x;
      m.pos.z = target.z;
      S.traveled = Math.min(totalDist, S.traveled + dist);
      S.seg++;
      S.phase = Math.ceil(S.phase);
      S.state = S.seg >= route.length - 1 ? 'end' : 'pause';
      S.stateT = 0;
      if (S.state === 'end') setStatus('Tour komplett - Yonkers Prime über Queens');
      else setStatus('Erdebeben: ' + target.name);
    }
  } else if (S.state === 'pause') {
    if (S.stateT >= PAUSE_DUR) {
      S.state = 'walk';
      S.stateT = 0;
      setStatus('Trampft nach ' + route[S.seg + 1].name + '…');
    }
  }

  // Mech-Koerper folgt der Ganges-Position (y wird in poseMech als Bob gesetzt)
  m.parts.root.position.x = m.pos.x;
  m.parts.root.position.z = m.pos.z;
  poseMech();

  // Heading in Richtung Ziel
  if (target) {
    const want = Math.atan2(dx, dz);
    let d = want - m.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    m.heading += d * Math.min(1, 3.5 * sdt);
  }
  m.parts.root.rotation.y = m.heading;
}

// Pause-Stomps
let pauseStomp1 = false, pauseStomp2 = false;
function updateSimFX() {
  if (S.state === 'pause') {
    if (S.stateT >= 0.55 && !pauseStomp1) {
      pauseStomp1 = true;
      const v = new THREE.Vector3();
      mech.parts.footL.getWorldPosition(v);
      stomp(v.x, v.z, 1.8);
    }
    if (S.stateT >= 1.35 && !pauseStomp2) {
      pauseStomp2 = true;
      const v = new THREE.Vector3();
      mech.parts.footR.getWorldPosition(v);
      stomp(v.x, v.z, 1.8);
    }
  } else {
    pauseStomp1 = pauseStomp2 = false;
  }

  // Glow am Startpunkt
  const g = S.state === 'rise'
    ? (S.stateT < RISE_GLOW_END ? 1 : Math.max(0, 1 - (S.stateT - RISE_GLOW_END) / 2.5))
    : 0;
  const pulse = 0.6 + 0.4 * Math.sin(S.t * 7);
  fx.glowRing.material.opacity = 0.85 * g * pulse;
  fx.glowLight.intensity = 2.6 * g * pulse;
  if (g > 0) {
    fx.glowRing.scale.setScalar(60 + 140 * (S.t % 1.2));
    if (Math.random() < 0.35 * g) {
      fx.dust.burst(mech.pos.x + (Math.random() - 0.5) * 300, mech.pos.z + (Math.random() - 0.5) * 300, 0.5);
    }
  }
}

function poseMech() {
  const P = mech.parts;
  P.pelvis.rotation.set(0, 0, 0);
  P.torso.rotation.set(0, 0, 0);
  P.head.rotation.set(0, 0, 0);

  const setLeg = (L, phi, mixStand = 0) => {
    const p = legWalkPose(phi);
    L.hip.rotation.x = p.hip + (STANDING.hip - p.hip) * mixStand;
    L.knee.rotation.x = p.knee + (STANDING.knee - p.knee) * mixStand;
    L.ankle.rotation.x = p.ankle + (STANDING.ankle - p.ankle) * mixStand;
  };

  if (S.state === 'rise') {
    const s = Math.min(1, Math.max(0, (S.stateT - RISE_GLOW_END) / (RISE_DUR - RISE_GLOW_END)));
    const k = sampleRise(s);
    P.root.position.y = k.rootY;
    P.torso.rotation.x = k.torso;
    P.head.rotation.x = k.head;
    P.legL.hip.rotation.x = k.thigh; P.legR.hip.rotation.x = k.thigh;
    P.legL.knee.rotation.x = k.knee; P.legR.knee.rotation.x = k.knee;
    P.legL.ankle.rotation.x = k.ankle; P.legR.ankle.rotation.x = k.ankle;
    P.armL.shoulder.rotation.set(k.shX, 0, -k.shZ);
    P.armR.shoulder.rotation.set(k.shX, 0, k.shZ);
    P.armL.elbow.rotation.x = k.elX;
    P.armR.elbow.rotation.x = k.elX;
  } else if (S.state === 'walk') {
    const phiL = S.phase % 1;
    const phiR = (S.phase + 0.5) % 1;
    setLeg(P.legL, phiL);
    setLeg(P.legR, phiR);
    P.root.position.y = -10 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phiL), 2);
    P.pelvis.rotation.x = 0.045;
    P.torso.rotation.x = -0.02;
    P.head.rotation.x = 0.02;
    const sw = Math.cos(2 * Math.PI * S.phase) * 0.27;
    P.armL.shoulder.rotation.set(-sw, 0, -0.15);
    P.armR.shoulder.rotation.set(sw, 0, 0.15);
    P.armL.elbow.rotation.x = 0.35;
    P.armR.elbow.rotation.x = 0.35;
  } else {
    // pause / end: stehen bleiben, Endpose in Queens
    const phiL = S.phase % 1;
    const phiR = (S.phase + 0.5) % 1;
    const mix = Math.min(1, S.stateT / 0.35);
    setLeg(P.legL, phiL, mix);
    setLeg(P.legR, phiR, mix);
    P.root.position.y = -10 * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phiL), 2) * (1 - mix);
    P.pelvis.rotation.x = 0.045 * (1 - mix);

    if (S.state === 'end') {
      const up = Math.min(1, Math.max(0, (S.stateT - 0.8) / 1.4));
      P.head.rotation.x = -0.12 * up;
      P.armL.shoulder.rotation.set(-0.35 * up, 0, -1.15 * up);
      P.armR.shoulder.rotation.set(-0.35 * up, 0, 1.15 * up);
      P.armL.elbow.rotation.x = 0.35 - 0.45 * up;
      P.armR.elbow.rotation.x = 0.35 - 0.45 * up;
      P.torso.rotation.x = -0.05 * up;
    } else {
      P.head.rotation.x = 0.05;
      P.armL.shoulder.rotation.set(0.1, 0, -0.18);
      P.armR.shoulder.rotation.set(0.1, 0, 0.18);
      P.armL.elbow.rotation.x = 0.4;
      P.armR.elbow.rotation.x = 0.4;
    }
  }

  // Blob-Schatten folgen den Fuesse
  const wp = new THREE.Vector3();
  P.footL.getWorldPosition(wp);
  mech.shadowL.position.set(wp.x, 1.5, wp.z);
  P.footR.getWorldPosition(wp);
  mech.shadowR.position.set(wp.x, 1.5, wp.z);
}

function stomp(x, z, power) {
  fx.dust.burst(x, z, power);
  fx.ring(x, z, power);
  S.shake = Math.max(S.shake, 0.5 * power);
  city.crushAround(x, z, (55 + 20 * power) * MECH_SCALE);
}

// ---------------------------------------------------------------- Kamera
function updateCamera(dt) {
  const m = mech;
  const C = cam.camera;

  if (S.camMode === 'frozen') return;
  if (S.camMode === 'top') {
    C.position.set(m.pos.x, 9500, m.pos.z + 2);
    C.lookAt(m.pos.x, 0, m.pos.z);
    return;
  }
  if (S.camMode === 'orbit') {
    const c = cam.orbit;
    const cx = m.pos.x + c.r * Math.cos(c.phi) * Math.sin(c.theta);
    const cy = Math.max(60, 250 + c.r * Math.sin(c.phi));
    const cz = m.pos.z + c.r * Math.cos(c.phi) * Math.cos(c.theta);
    C.position.set(cx, cy, cz);
    C.lookAt(m.pos.x, 250, m.pos.z);
    return;
  }

  // cine: lokale Zielposition relativ zum Mech
  let lx = 0, ly = 0, lz = 0, lookY = 280;
  if (S.state === 'rise') {
    const s = Math.min(1, S.stateT / (RISE_DUR - 1));
    const e = s * s * (3 - 2 * s);
    lx = -750 * e * MECH_SCALE; ly = (650 - 520 * e) * MECH_SCALE; lz = (-2400 + 3350 * e) * MECH_SCALE;
    lookY = 240 * MECH_SCALE;
  } else if (S.state === 'walk') {
    lx = (-650 + Math.sin(S.t * 0.23) * 90) * MECH_SCALE; ly = 520 * MECH_SCALE; lz = -1150 * MECH_SCALE;
    lookY = 330 * MECH_SCALE;
  } else if (S.state === 'pause') {
    lx = -950 * MECH_SCALE; ly = 430 * MECH_SCALE; lz = 800 * MECH_SCALE;
    lookY = 330 * MECH_SCALE;
  } else {
    const a = S.t * 0.14;
    lx = Math.sin(a) * 1700 * MECH_SCALE; ly = 430 * MECH_SCALE; lz = Math.cos(a) * 1700 * MECH_SCALE;
    lookY = 280 * MECH_SCALE;
  }
  const cos = Math.cos(m.heading), sin = Math.sin(m.heading);
  const wx = m.pos.x + lx * cos - lz * sin;
  const wz = m.pos.z + lx * sin + lz * cos;

  const k = 1 - Math.exp(-3.2 * dt);
  cam.smPos.x += (wx - cam.smPos.x) * k;
  cam.smPos.y += (ly - cam.smPos.y) * k;
  cam.smPos.z += (wz - cam.smPos.z) * k;
  const ks = 1 - Math.exp(-4.0 * dt);
  cam.smLook.x += (m.pos.x - cam.smLook.x) * ks;
  cam.smLook.y += (lookY - cam.smLook.y) * ks;
  cam.smLook.z += (m.pos.z - cam.smLook.z) * ks;

  S.shake *= Math.exp(-4 * dt);
  const sh = 14 * S.shake;
  C.position.set(
    cam.smPos.x + (Math.random() - 0.5) * sh,
    cam.smPos.y + (Math.random() - 0.5) * sh,
    cam.smPos.z + (Math.random() - 0.5) * sh
  );
  C.lookAt(cam.smLook.x, cam.smLook.y, cam.smLook.z);
}

// ---------------------------------------------------------------- Welt
function makeScene() {
  const sc = new THREE.Scene();
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#79a8d9');
  gr.addColorStop(0.55, '#b6cde2');
  gr.addColorStop(1, '#e6edf3');
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 512);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  sc.background = sky;
  sc.fog = new THREE.Fog(0xcfd9e2, 26000, 72000);

  sc.add(new THREE.HemisphereLight(0xbfd4e6, 0x5a5148, 0.85));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.7);
  sun.position.set(-6000, 12000, -5000);
  sc.add(sun);
  return sc;
}

function makeGround(tm) {
  const tex = new THREE.TextureLoader().load('data/atlas.png');
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(tm.width_m, tm.height_m),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(tm.width_m / 2, 0, tm.height_m / 2);
  scene.add(ground);
}

function makeCity(list) {
  const n = list.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const data = new Array(n);
  for (let i = 0; i < n; i++) {
    const [x, z, hx, hz, h] = list[i];
    data[i] = { x, z, hx, hz, h, state: 0, t0: 0, tiltX: 0, tiltZ: 0 };
    const s = 0.52 + Math.min(1, h / 420) * 0.26 + Math.random() * 0.05;
    col.setRGB(0.16 + 0.5 * s, 0.18 + 0.5 * s, 0.21 + 0.55 * s);
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(hx * 2, h, hz * 2);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    im.setColorAt(i, col);
  }
  scene.add(im);

  const active = [];
  function crushAround(x, z, r) {
    for (let i = 0; i < n; i++) {
      const b = data[i];
      if (b.state !== 0) continue;
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz < r * r) {
        b.state = 1;
        b.t0 = S.t;
        b.tiltX = (Math.random() - 0.5) * 0.24;
        b.tiltZ = (Math.random() - 0.5) * 0.24;
        active.push(i);
      }
    }
  }
  function update() {
    for (let k = active.length - 1; k >= 0; k--) {
      const i = active[k];
      const b = data[i];
      const t = S.t - b.t0;
      const e = t < 0.4 ? 1 - Math.pow(1 - Math.min(1, t / 0.4), 3) : 1;
      dummy.position.set(b.x, -b.h * 0.04 * e, b.z);
      dummy.rotation.set(b.tiltX * e, 0, b.tiltZ * e);
      const sxz = 1 + 0.3 * e;
      dummy.scale.set(b.hx * 2 * sxz, Math.max(2, b.h * (1 - 0.88 * e)), b.hz * 2 * sxz);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (t > 0.4) {
        active.splice(k, 1);
        data[i].state = 2;
      }
    }
    if (active.length) im.instanceMatrix.needsUpdate = true;
  }
  function resetAll() {
    active.length = 0;
    for (let i = 0; i < n; i++) {
      const b = data[i];
      b.state = 0;
      dummy.position.set(b.x, 0, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.hx * 2, b.h, b.hz * 2);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return { crushAround, update, resetAll };
}

function makeMech() {
  const parts = buildMech();
  parts.root.scale.setScalar(MECH_SCALE);
  scene.add(parts.root);
  const m = {
    parts,
    pos: new THREE.Vector3(route[0].x, 0, route[0].z),
    heading: Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z),
    shadowL: null, shadowR: null,
  };
  const shTex = makeBlobShadow();
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.32, depthWrite: false })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.scale.set(110 * MECH_SCALE, 130 * MECH_SCALE, 1);
    scene.add(sh);
    if (side < 0) m.shadowL = sh; else m.shadowR = sh;
  }
  return m;
}

function makeBlobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeFX() {
  const glowRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.5, 64),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  glowRing.rotation.x = -Math.PI / 2;
  glowRing.position.set(route[0].x, 1, route[0].z);
  scene.add(glowRing);
  const glowLight = new THREE.PointLight(0xff6a10, 0, 2500, 1.6);
  glowLight.position.set(route[0].x, 60, route[0].z);
  scene.add(glowLight);

  const dust = makeDust(1800);
  const rings = makeShockwaves();
  return {
    glowRing, glowLight, dust,
    ring: (x, z, p) => rings.spawn(x, z, p),
    update(dt) { dust.update(dt); rings.update(dt); city.update(); },
  };
}

function makeDustSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeDust(cap) {
  const pos = new Float32Array(cap * 3).fill(-9999);
  const vel = new Float32Array(cap * 3);
  const life = new Float32Array(cap);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 16, map: makeDustSprite(), color: 0xcfc8bd, transparent: true, opacity: 0.8,
    depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let cursor = 0;
  return {
    burst(x, z, power) {
      const n = 40 + Math.round(60 * power);
      for (let j = 0; j < n; j++) {
        const i = cursor; cursor = (cursor + 1) % cap;
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * (8 + 22 * power);
        pos[i * 3] = x + Math.cos(a) * 6;
        pos[i * 3 + 1] = 2 + Math.random() * 8;
        pos[i * 3 + 2] = z + Math.sin(a) * 6;
        vel[i * 3] = Math.cos(a) * sp;
        vel[i * 3 + 1] = 3 + Math.random() * (6 + 14 * power);
        vel[i * 3 + 2] = Math.sin(a) * sp;
        life[i] = 1.2 + Math.random() * 1.8;
      }
    },
    update(dt) {
      let dirty = false;
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue;
        dirty = true;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] -= 26 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 0;
          vel[i * 3 + 1] = 0;
          vel[i * 3] *= 0.9;
          vel[i * 3 + 2] *= 0.9;
        }
      }
      if (dirty) geo.attributes.position.needsUpdate = true;
    },
  };
}

function makeShockwaves() {
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.4, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.userData = { t0: -9, power: 1 };
    scene.add(m);
    pool.push(m);
  }
  let cursor = 0;
  return {
    spawn(x, z, power) {
      const m = pool[cursor]; cursor = (cursor + 1) % pool.length;
      m.position.set(x, 1.5, z);
      m.userData = { t0: S.t, power };
      m.visible = true;
    },
    update(dt) {
      for (const m of pool) {
        if (!m.visible) continue;
        const t = S.t - m.userData.t0;
        if (t > 0.9) { m.visible = false; m.material.opacity = 0; continue; }
        const e = t / 0.9;
        m.scale.setScalar(10 + 160 * m.userData.power * (1 - Math.pow(1 - e, 3)));
        m.material.opacity = 0.75 * (1 - e);
      }
    },
  };
}

function makeTextSprite(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 46px "Segoe UI", sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 44;
  c.width = w; c.height = 72;
  g.fillStyle = 'rgba(10,14,20,0.55)';
  roundRect(g, 4, 8, w - 8, 56, 16);
  g.fill();
  g.fillStyle = '#f2f6fa';
  g.textBaseline = 'middle';
  g.fillText(text, 22, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const s = 3.2;
  sp.scale.set(c.width * s / 4, 72 * s / 4, 1);
  return sp;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function makeLabels() {
  for (const pt of route) {
    const sp = makeTextSprite(pt.name);
    sp.position.set(pt.x, 40, pt.z);
    scene.add(sp);
  }
}

function makeNameplate() {
  const sp = makeTextSprite('YONKERS PRIME');
  sp.scale.multiplyScalar(1.6);
  sp.position.set(route[0].x, 470 * MECH_SCALE, route[0].z);
  return sp;
}

function makeCamera() {
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 10, 200000);
  const c = {
    camera,
    smPos: new THREE.Vector3(route[0].x + 1200 * MECH_SCALE, 700 * MECH_SCALE, route[0].z - 2200 * MECH_SCALE),
    smLook: new THREE.Vector3(route[0].x, 240 * MECH_SCALE, route[0].z),
    orbit: { theta: 2.2, phi: 0.5, r: 2600 },
  };
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
  window.addEventListener('pointermove', (e) => {
    if (!drag || S.camMode !== 'orbit') return;
    c.orbit.theta -= (e.clientX - drag[0]) * 0.006;
    c.orbit.phi = Math.max(0.08, Math.min(1.45, c.orbit.phi + (e.clientY - drag[1]) * 0.006));
    drag = [e.clientX, e.clientY];
  });
  window.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('wheel', (e) => {
    if (S.camMode !== 'orbit') return;
    c.orbit.r = Math.max(300, Math.min(9000, c.orbit.r * (1 + e.deltaY * 0.001)));
    e.preventDefault();
  }, { passive: false });
  return c;
}

// ---------------------------------------------------------------- UI
function setStatus(t) { ui.status.textContent = t; }

// ?goto=1|2|3 springt direkt in Manhattan / Brooklyn / Queens (Gang)
function applyURLJump() {
  const params = new URLSearchParams(location.search);
  const sp = parseFloat(params.get('speed'));
  if (sp > 0) { S.speed = sp; ui.speed.value = sp; ui.speedVal.textContent = sp.toFixed(1); }
  const g = parseInt(params.get('goto'), 10);
  if (!g || g < 1 || g > 3) return;
  S.seg = g;
  let traveled = 0;
  for (let i = 1; i <= S.seg; i++) {
    traveled += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  }
  mech.pos.set(route[S.seg].x, 0, route[S.seg].z);
  mech.heading = Math.atan2(route[S.seg + 1].x - mech.pos.x, route[S.seg + 1].z - mech.pos.z);
  S.state = 'walk';
  S.traveled = traveled;
  // Kamera start: hoch und hinter dem Mech, laesst sich per Lerp einklappen
  cam.smPos.set(mech.pos.x - 2000 * MECH_SCALE * Math.sin(mech.heading), 900 * MECH_SCALE, mech.pos.z - 2000 * MECH_SCALE * Math.cos(mech.heading));
  cam.smLook.set(mech.pos.x, 300 * MECH_SCALE, mech.pos.z);
  setStatus('Trampft nach ' + route[S.seg + 1].name + '…');
}

function wireUI() {
  ui.speed.addEventListener('input', () => {
    S.speed = parseFloat(ui.speed.value);
    ui.speedVal.textContent = S.speed.toFixed(1);
  });
  ui.replay.addEventListener('click', resetAll);
  ui.camCine.addEventListener('click', () => setCam('cine'));
  ui.camOrbit.addEventListener('click', () => setCam('orbit'));
  ui.camTop.addEventListener('click', () => setCam('top'));
}

function setCam(mode) {
  S.camMode = mode;
  ui.camCine.classList.toggle('on', mode === 'cine');
  ui.camOrbit.classList.toggle('on', mode === 'orbit');
  ui.camTop.classList.toggle('on', mode === 'top');
}

function resetAll() {
  S.t = 0; S.state = 'rise'; S.stateT = 0; S.phase = 0;
  S.seg = 0; S.traveled = 0; S.shake = 0;
  mech.pos.set(route[0].x, 0, route[0].z);
  mech.heading = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
  cam.smPos.set(route[0].x + 1200 * MECH_SCALE, 700 * MECH_SCALE, route[0].z - 2200 * MECH_SCALE);
  cam.smLook.set(route[0].x, 240 * MECH_SCALE, route[0].z);
  city.resetAll();
  setStatus('Yonkers hebt sich aus dem Boden…');
  ui.prog.style.width = '0%';
}

window.addEventListener('resize', () => {
  cam.camera.aspect = window.innerWidth / window.innerHeight;
  cam.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- Frame-Loop
let lastNow = 0;
let prevStep = -1;

function tick(dt) {
  const sdt = dt * S.speed;
  S.t += sdt;
  S.stateT += sdt;

  updateSim(sdt);
  updateSimFX();
  fx.update(dt * S.speed);
  updateCamera(dt);

  // Fuss-Planting: phase*2 laeuft 2x pro Gang-Zyklus, je 1 Stomp
  const stepCount = Math.floor(S.phase * 2 + 1e-6);
  if (stepCount > prevStep && S.state === 'walk') {
    const left = stepCount % 2 === 1;
    const v = new THREE.Vector3();
    (left ? mech.parts.footL : mech.parts.footR).getWorldPosition(v);
    stomp(v.x, v.z, 1.0);
  }
  prevStep = stepCount;

  nameplate.position.set(mech.pos.x, 470 * MECH_SCALE, mech.pos.z);
  ui.prog.style.width = (Math.min(1, S.traveled / totalDist) * 100).toFixed(1) + '%';
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  tick(dt);
  renderer.render(scene, cam.camera);
}

main().catch((e) => {
  console.error(e);
  ui.loader.querySelector('p').textContent = 'Fehler: ' + e.message;
});
