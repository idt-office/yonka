// mech.js - "Yonkers Prime": ein aus Kisten gebauter Riesen-Mech, ~450 m groess.
// Lokal: forward = +z, up = +y. Alle Maasse in Metern (1 Welt-Unit = 1 m).
import * as THREE from './vendor/three.module.js';

export const D = {
  hip: 252,          // Huefte-Hohe (Beinlaenge 230 + Fuss 22)
  thigh: 115, shin: 115, footH: 22, footL: 62, footW: 52,
  pelvisW: 100, pelvisH: 58, pelvisD: 66,
  torsoW: 134, torsoH: 122, torsoD: 84,
  headW: 40, headH: 38, headD: 46,
  armUpper: 100, armFore: 90,
  hipX: 46,
};

const matBody = new THREE.MeshStandardMaterial({ color: 0x9aa7b5, metalness: 0.35, roughness: 0.5 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x5a6472, metalness: 0.3, roughness: 0.6 });
const matAccent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5500, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
const matVisor = new THREE.MeshStandardMaterial({ color: 0xbaffff, emissive: 0x33ddff, emissiveIntensity: 1.8 });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildMech() {
  const root = new THREE.Group();

  // -- Becken
  const pelvis = new THREE.Group();
  pelvis.position.y = D.hip;
  root.add(pelvis);
  pelvis.add(box(D.pelvisW, D.pelvisH, D.pelvisD, matDark));
  pelvis.add(box(D.pelvisW * 0.5, 14, D.pelvisD + 6, matAccent, 0, 8, 0));

  // -- Rumpf
  const torso = new THREE.Group();
  torso.position.y = 26;
  pelvis.add(torso);
  torso.add(box(D.torsoW, D.torsoH, D.torsoD, matBody, 0, 55, 0));
  torso.add(box(26, 26, 12, matAccent, 0, 74, D.torsoD / 2 - 4));      // Kern
  torso.add(box(34, 30, 64, matDark, -(D.torsoW / 2 + 10), 96, 0));    // Schulterpads
  torso.add(box(34, 30, 64, matDark, D.torsoW / 2 + 10, 96, 0));
  torso.add(box(D.torsoW * 0.8, 26, 20, matDark, 0, 66, -D.torsoD / 2 - 8)); // Rückenpack

  // -- Kopf
  const head = new THREE.Group();
  head.position.y = 128;
  torso.add(head);
  head.add(box(D.headW, D.headH, D.headD, matBody, 0, 8, 0));
  head.add(box(D.headW - 10, 10, 8, matVisor, 0, 10, D.headD / 2 - 2));
  head.add(box(4, 30, 4, matDark, -9, 36, 0));
  head.add(box(4, 30, 4, matDark, 9, 36, 0));

  // -- Beine
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * D.hipX, 0, 0);
    pelvis.add(hip);
    hip.add(box(62, D.thigh, 58, matBody, 0, -D.thigh / 2, 0));
    const knee = new THREE.Group();
    knee.position.y = -D.thigh;
    hip.add(knee);
    knee.add(box(46, D.shin, 48, matDark, 0, -D.shin / 2, 0));
    const ankle = new THREE.Group();
    ankle.position.y = -D.shin;
    knee.add(ankle);
    const foot = box(D.footW, D.footH, D.footL, matBody, 0, -D.footH / 2, 14);
    ankle.add(foot);
    ankle.add(box(D.footW, 6, 20, matAccent, 0, -D.footH + 3, 14));
    return { hip, knee, ankle, foot };
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // -- Arme
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (D.torsoW / 2 + 14), 94, 0);
    torso.add(shoulder);
    shoulder.add(box(42, D.armUpper, 44, matBody, 0, -D.armUpper / 2, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -D.armUpper;
    shoulder.add(elbow);
    elbow.add(box(34, D.armFore, 36, matDark, 0, -D.armFore / 2, 0));
    elbow.add(box(38, 30, 38, matBody, 0, -D.armFore - 8, 0));
    return { shoulder, elbow };
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  return {
    root, pelvis, torso, head,
    legL, legR, armL, armR,
    footL: legL.foot, footR: legR.foot,
  };
}

// ---- Aufstehen-Sequenz: Keyframes, s in [0,1]
//  torso: +1.42 = Rumpf flach (Kopf nach vorn), 0 = aufrecht
//  thigh: negativ = Knie nach vorn gefaltet, knee: positiv = Waden nach hinten (Ferse oben)
export const RISE_KEYS = [
  { t: 0.00, rootY: -135, torso: 1.42, thigh: -1.25, knee: 1.95, ankle: -0.55, head: -0.35, shX: 1.05, elX: 1.50, shZ: 0.00 },
  { t: 0.30, rootY: -100, torso: 1.10, thigh: -1.05, knee: 1.80, ankle: -0.45, head: -0.30, shX: 0.95, elX: 1.40, shZ: 0.00 },
  { t: 0.60, rootY: -22,  torso: 0.38, thigh: -0.50, knee: 1.00, ankle: -0.10, head: -0.05, shX: 0.50, elX: 0.95, shZ: 0.05 },
  { t: 0.85, rootY: -2,   torso: 0.03, thigh: -0.04, knee: 0.08, ankle: 0.00, head: 0.02,  shX: 0.22, elX: 0.45, shZ: 0.10 },
  { t: 1.00, rootY: 0,    torso: 0.00, thigh: 0.00,  knee: 0.00, ankle: 0.00, head: 0.00,  shX: 0.12, elX: 0.30, shZ: 0.15 },
];

const smooth = (t) => t * t * (3 - 2 * t);

export function sampleRise(s) {
  s = Math.max(0, Math.min(1, s));
  const K = RISE_KEYS;
  let i = 0;
  while (i < K.length - 2 && s > K[i + 1].t) i++;
  const a = K[i], b = K[i + 1];
  const f = smooth((s - a.t) / (b.t - a.t));
  const out = {};
  for (const k of ['rootY', 'torso', 'thigh', 'knee', 'ankle', 'head', 'shX', 'elX', 'shZ']) {
    out[k] = a[k] + (b[k] - a[k]) * f;
  }
  return out;
}

// ---- Ganges: phi in [0,1) pro Bein
//  0..0.30 Standbein (Fuss am Boden), 0.30..0.75 Schwung (Fuss hebt), 0.75..1 Stomp (Fuss waechst)
//  Stomp-Ereignis, wenn phi bei 1.0 auf 0.0 zurueckspaengt (Fuss plant).
export function legWalkPose(phi) {
  let hip, knee, ankle;
  if (phi < 0.30) {
    const t = phi / 0.30;
    hip = -0.10 + 0.28 * t;
    knee = 0.02;
    ankle = 0;
  } else if (phi < 0.75) {
    const t = (phi - 0.30) / 0.45;
    const e = t * t * (3 - 2 * t);
    hip = 0.18 + 0.34 * e;
    knee = -0.62 * Math.sin(Math.PI * e);
    ankle = 0.30 * Math.sin(Math.PI * e);
  } else {
    const t = (phi - 0.75) / 0.25;
    const e = 1 - (1 - t) * (1 - t);
    hip = 0.52 - 0.38 * e;
    knee = -0.30 * (1 - e);
    ankle = 0.15 * (1 - e);
  }
  return { hip, knee, ankle };
}

export const STANDING = { hip: 0.08, knee: 0.0, ankle: 0.0 };
