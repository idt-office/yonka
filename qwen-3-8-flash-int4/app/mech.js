import * as THREE from 'three';

// "YONKERS" - a 150 m class mech. Built facing +z; root.yaw=atan2(dx,dz)
// points it along the walk direction. All limb pivots hang along -y, so a
// positive rotation.x swings a limb backward; the torso grows +y, so a
// positive rotation.x leans it forward.

const M = {
  body: new THREE.MeshStandardMaterial({ color: 0x2b313a, metalness: 0.85, roughness: 0.38 }),
  body2: new THREE.MeshStandardMaterial({ color: 0x454e5c, metalness: 0.8, roughness: 0.32 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.6, roughness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xff6a1f, metalness: 0.5, roughness: 0.45 }),
  piston: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.95, roughness: 0.22 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x081018, emissive: 0x66f0ff, emissiveIntensity: 0 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x120a04, emissive: 0xff5a10, emissiveIntensity: 0 }),
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(mat, w, h, d, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// canvas texture: chest stencils and markings
function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#14181e';
  g.fillRect(0, 0, 1024, 256);
  // warning stripes on both ends
  for (const x0 of [0, 924]) {
    g.save();
    g.translate(x0, 0);
    for (let i = -2; i < 8; i++) {
      g.fillStyle = i % 2 ? '#0f0f0f' : '#c9a227';
      g.beginPath();
      g.moveTo(i * 22, 0);
      g.lineTo(i * 22 + 22, 0);
      g.lineTo(i * 22 - 14, 256);
      g.lineTo(i * 22 - 36, 256);
      g.fill();
    }
    g.restore();
  }
  g.strokeStyle = '#2e3640';
  g.lineWidth = 10;
  g.strokeRect(94, 12, 836, 232);
  g.fillStyle = '#ff8a2a';
  g.font = 'bold 130px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Y O N K E R S', 512, 108);
  g.fillStyle = '#7c8794';
  g.font = 'bold 44px Arial, sans-serif';
  g.fillText('MECH PROTOCOL 01  ·  FH-AACHEN CLASS', 512, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const HIP_STAND = 88.4;
const WALK_HIP = 72;

// Joint names for the pose engine. Value: [x,y,z] euler.
const JOINTS = [
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
  'torso', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
  'ventL', 'ventR',
];

const DELAY = { // cascaded deployment during the rise, seconds
  thighL: -0.15, thighR: -0.15, shinL: -0.05, shinR: -0.05,
  footL: 0.1, footR: 0.1, torso: 0.18, head: 0.32,
  shoulderL: 0.42, elbowL: 0.5, shoulderR: 0.42, elbowR: 0.5,
  ventL: 0.8, ventR: 0.8,
};

// Rise keyframes: [time, {joint: [x,y,z], ...}, hipY]. Hip heights are the
// fitted values at which the soles touch ground for the given leg angles
// (see the tuning script in the session log): full extension stands 88.4.
const RISE = [
  [2.6, { // deep squat, chest up, hands braced over the knees
    thighL: [-1.0, 0, 0.09], shinL: [1.75, 0, -0.07], footL: [-0.45, 0, 0],
    thighR: [-1.0, 0, -0.09], shinR: [1.75, 0, 0.07], footR: [-0.45, 0, 0],
    torso: [0.6, 0.1, 0], head: [-0.5, -0.14, 0],
    shoulderL: [-0.9, 0, 0.32], elbowL: [1.0, 0, 0],
    shoulderR: [-0.9, 0, -0.32], elbowR: [1.0, 0, 0],
  }, 60.8],
  [6.4, { // rising, still deep
    thighL: [-0.7, 0, 0.07], shinL: [1.15, 0, -0.06], footL: [-0.25, 0, 0],
    thighR: [-0.7, 0, -0.07], shinR: [1.15, 0, 0.06], footR: [-0.25, 0, 0],
    torso: [0.42, 0.08, 0], head: [-0.34, -0.1, 0],
    shoulderL: [-0.5, 0, 0.24], elbowL: [0.8, 0, 0],
    shoulderR: [-0.5, 0, -0.24], elbowR: [0.8, 0, 0],
  }, 75.8],
  [7.7, { // knees unloading
    thighL: [-0.35, 0, 0.04], shinL: [0.55, 0, -0.03], footL: [-0.1, 0, 0],
    thighR: [-0.35, 0, -0.04], shinR: [0.55, 0, 0.03], footR: [-0.1, 0, 0],
    torso: [0.16, 0.03, 0], head: [-0.08, 0, 0],
    shoulderL: [-0.15, 0, 0.12], elbowL: [0.45, 0, 0],
    shoulderR: [-0.15, 0, -0.12], elbowR: [0.45, 0, 0],
  }, 85.4],
  [8.75, { // nearly locked out
    thighL: [-0.08, 0, 0.015], shinL: [0.12, 0, -0.01], footL: [0, 0, 0],
    thighR: [-0.08, 0, -0.015], shinR: [0.12, 0, 0.01], footR: [0, 0, 0],
    torso: [-0.03, 0, 0], head: [0, 0, 0],
    shoulderL: [-0.02, 0, 0.05], elbowL: [0.25, 0, 0],
    shoulderR: [-0.02, 0, -0.05], elbowR: [0.25, 0, 0],
  }, 88.3],
  [9.45, { // overshoot: hips surge above the lockout, chest springs back
    thighL: [0.1, 0, 0.01], shinL: [-0.16, 0, 0], footL: [0.08, 0, 0],
    thighR: [0.1, 0, -0.01], shinR: [-0.16, 0, 0], footR: [0.08, 0, 0],
    torso: [-0.08, 0, 0], head: [0.08, 0.06, 0],
    shoulderL: [0.14, 0, 0.02], elbowL: [0.15, 0, 0],
    shoulderR: [0.14, 0, -0.02], elbowR: [0.15, 0, 0],
  }, 95.5],
  [10.4, { // settle at full height
    thighL: [0, 0, 0.015], shinL: [0.02, 0, 0], footL: [0, 0, 0],
    thighR: [0, 0, -0.015], shinR: [0.02, 0, 0], footR: [0, 0, 0],
    torso: [-0.01, 0, 0], head: [0, 0, 0],
    shoulderL: [0, 0, 0.04], elbowL: [0.14, 0, 0],
    shoulderR: [0, 0, -0.04], elbowR: [0.14, 0, 0],
    ventL: [-0.95, 0, 0], ventR: [-0.95, 0, 0],
  }, 88.4],
];

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Mech {
  constructor(scene, start, walkStart) {
    this.scene = scene;
    this.start = start;
    this.walkStart = walkStart; // mech-clock time when stomping begins
    this.state = 'rise';
    this.T = 0;
    this.progress = 0;
    this.stepPhase = 0;
    this.swingL = true;
    this.prevPlant = null;
    this.newPlant = null;
    this.stepCount = 0;
    this.stride = 70;
    this.stepDur = 0.95;
    this.hipBase = HIP_STAND;
    this.footfalls = []; // queued {side, x, z, first}
    this.victoryT = -1;
    this.targetYaw = null;
    this.onCut = null; // main.js sets: (cut)=>{}

    this.root = new THREE.Group();
    this.root.position.set(start.x, 0, start.z);
    scene.add(this.root);

    const j = (this.j = {});
    j.hip = pivot(this.root, 0, 34, 0);
    j.hip.add(box(M.dark, 30, 13, 21, 0, 0, 0));
    j.hip.add(box(M.body2, 33, 5, 23, 0, 5, 0));

    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 10 : -10;
      const thigh = pivot(j.hip, sx, -2, 0);
      thigh.add(box(M.body, 15, 36, 17, 0, -18, 0));
      thigh.add(box(M.accent, 15.6, 3, 17.6, 0, -8, 0));
      const knee = pivot(thigh, 0, -36, 0);
      knee.add(box(M.dark, 12, 8, 14, 0, 0, 0));
      const shin = pivot(knee, 0, -2, 0);
      shin.add(box(M.body2, 11, 30, 13, 0, -16, -1));
      shin.add(box(M.body, 7, 24, 8, 0, -14, 6.5)); // shin guard
      const ankle = pivot(shin, 0, -32, 0);
      const foot = pivot(ankle, 0, -6, 0);
      foot.add(box(M.dark, 27, 9, 47, 0, -1, 6)); // foot, toes forward
      foot.add(box(M.body, 25, 4, 14, 0, -5.6, 20)); // toe plate
      for (let i = 0; i < 3; i++) {
        foot.add(box(M.accent, 3, 2.4, 6, -8 + i * 8, -5.6, 27));
      }
      j['thigh' + side] = thigh;
      j['knee' + side] = knee;
      j['shin' + side] = shin;
      j['foot' + side] = foot;
    }

    j.torso = pivot(j.hip, 0, 7, 0);
    j.torso.add(box(M.body, 46, 50, 24, 0, 25, 0));
    j.torso.add(box(M.body2, 50, 10, 26, 0, 46, 0)); // collar
    j.torso.add(box(M.dark, 30, 22, 6, 0, 20, -13)); // back pack
    j.torso.add(box(M.accent, 4, 44, 2, -23.4, 25, 6));
    j.torso.add(box(M.accent, 4, 44, 2, 23.4, 25, 6));
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 9.5),
      new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6, metalness: 0.2 })
    );
    plate.position.set(0, 33, 12.3);
    j.torso.add(plate);
    // chest vents: plates that hinge open at full stand
    j.ventL = pivot(j.torso, 7.5, 14, 12);
    j.ventL.add(box(M.body2, 14, 9, 2.4, 0, 4.4, 0));
    const glowL = box(M.glow, 12, 7, 1, 0, 4.4, -1.6);
    j.ventL.add(glowL);
    j.ventR = pivot(j.torso, -7.5, 14, 12);
    j.ventR.add(box(M.body2, 14, 9, 2.4, 0, 4.4, 0));
    j.ventR.add(box(M.glow, 12, 7, 1, 0, 4.4, -1.6));

    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 25 : -25;
      const sh = pivot(j.torso, sx, 44, 0);
      sh.add(box(M.body2, 15, 12, 21, sx > 0 ? 3 : -3, 2, 0)); // pauldron
      sh.add(box(M.accent, 15.6, 2.4, 21.6, sx > 0 ? 3 : -3, 8, 0));
      sh.add(box(M.body, 12, 30, 13, 0, -15, 0));
      const el = pivot(sh, 0, -30, 0);
      el.add(box(M.body2, 10, 26, 11, 0, -13, 0));
      el.add(box(M.dark, 11, 6, 12, 0, 1, 0));
      const hand = pivot(el, 0, -27, 0);
      hand.add(box(M.dark, 9, 9, 7, 0, -3.5, 0));
      for (let i = 0; i < 3; i++) {
        hand.add(box(M.body, 2.6, 8, 3, -3 + i * 3, -8, 1.5));
      }
      j['shoulder' + side] = sh;
      j['elbow' + side] = el;
    }

    j.head = pivot(j.torso, 0, 50, 0);
    j.head.add(box(M.dark, 8, 7, 9, 0, 2, 0)); // neck
    const headG = pivot(j.head, 0, 6, 0);
    headG.add(box(M.body, 17, 12, 18, 0, 6, 0));
    headG.add(box(M.body2, 13, 6, 6, 0, 12.4, -1)); // crest
    j.visor = box(M.visor, 14, 3.2, 1.6, 0, 6.6, 8.9);
    headG.add(j.visor);
    const antL = box(M.body2, 1.2, 14, 1.2, -7.6, 14, -5);
    antL.rotation.z = 0.35;
    headG.add(antL);
    const antR = box(M.body2, 1.2, 14, 1.2, 7.6, 14, -5);
    antR.rotation.z = -0.35;
    headG.add(antR);
    const tip = box(M.accent, 2, 2, 2, -9.9, 20.5, -5);
    headG.add(tip);
    this.headTip = tip;
    this._headG = headG;

    // hydraulic pistons: cylinder stretched between two anchors
    this.pistons = [];
    const mkPiston = (a, b, r = 1.5) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), M.piston);
      mesh.userData = { a, b, r };
      scene.add(mesh);
      this.pistons.push(mesh);
    };
    const local = (obj, x, y, z) => ({ obj, v: new THREE.Vector3(x, y, z) });
    mkPiston(local(j.hip, 10, 2, -9), local(j['shinL'], 0, -8, -8), 1.8);
    mkPiston(local(j.hip, -10, 2, -9), local(j['shinR'], 0, -8, -8), 1.8);
    mkPiston(local(j.hip, 13, 3, 8), local(j['thighL'], 4, -22, 8.5), 2.2);
    mkPiston(local(j.hip, -13, 3, 8), local(j['thighR'], -4, -22, 8.5), 2.2);
    mkPiston(local(j.torso, 19, 40, -10), local(j['shoulderL'], 2, -22, -7));
    mkPiston(local(j.torso, -19, 40, -10), local(j['shoulderR'], -2, -22, -7));

    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion();
    this._footW = new THREE.Vector3();

    this.setRisePose(0);
  }

  _apply(euler) {
    for (const name of JOINTS) {
      const e = euler[name];
      if (e) this.j[name].rotation.set(e[0], e[1], e[2]);
    }
  }

  // blend between rise keyframes with per-joint delay for a cascaded deploy
  setRisePose(t) {
    const euler = {};
    let hipY = 34;
    if (t <= RISE[0][0]) {
      for (const name of JOINTS) {
        const v = RISE[0][1][name];
        if (v) euler[name] = [v[0], v[1], v[2]];
      }
      hipY = RISE[0][2];
    } else if (t >= RISE[RISE.length - 1][0]) {
      for (const name of JOINTS) {
        const v = RISE[RISE.length - 1][1][name];
        if (v) euler[name] = [v[0], v[1], v[2]];
      }
      hipY = RISE[RISE.length - 1][2];
    } else {
      let k = 0;
      while (RISE[k + 1][0] < t) k++;
      const [t0, p0, h0] = RISE[k];
      const [t1, p1, h1] = RISE[k + 1];
      for (const name of JOINTS) {
        const a = p0[name] || [0, 0, 0];
        const b = p1[name] || [0, 0, 0];
        const d = DELAY[name] || 0;
        const s = smoothstep(t0 + d, t1 + d + 0.25, t);
        euler[name] = [
          a[0] + (b[0] - a[0]) * s,
          a[1] + (b[1] - a[1]) * s,
          a[2] + (b[2] - a[2]) * s,
        ];
      }
      // hip height keeps its own (undelayed) smooth curve, plus overshoot feel
      const s = smoothstep(t0, t1, t);
      hipY = h0 + (h1 - h0) * s;
    }
    // idle micro-movement: hydraulics breathing
    const sway = Math.sin(t * 1.15) * 0.012 + Math.sin(t * 0.5) * 0.008;
    if (euler.torso) euler.torso[0] += sway;
    if (euler.head) euler.head[1] += Math.sin(t * 0.35) * 0.06;
    if (t > 9.8 && t < 12) {
      // head scan after rising
      euler.head[1] = Math.sin((t - 9.8) * 2.1) * 0.5;
    }
    this._apply(euler);
    this.j.hip.position.y = hipY + Math.sin(t * 1.15) * 0.7;
    M.visor.emissiveIntensity = t < 2.6 ? 0 : Math.min(1.4, (t - 2.6) * 2.4) *
      (1 + 0.5 * Math.sin(t * 30) * Math.exp(-Math.max(0, t - 3.4)));
    M.glow.emissiveIntensity = Math.max(0, (t - 9.6) * 1.6);
  }

  update(dt, route) {
    this.T += dt;
    const t = this.T;
    this.footfalls.length = 0;

    if (this.state === 'rise') {
      this.setRisePose(t);
      if (t >= this.walkStart) {
        this.state = 'walk';
        this.prevPlant = { x: this.root.position.x, z: this.root.position.z };
      }
      return;
    }
    if (this.state === 'victory') {
      this.updateVictory(dt);
      return;
    }

    // ---- walking state machine
    if (this.state === 'arrive') {
      this._easeYaw(dt);
      this.setRisePose(10.4); // stand pose
      this.j.hip.position.y = HIP_STAND;
      this.j.hip.position.x = 0;
      return;
    }

    this.stepPhase += dt / this.stepDur;
    const u = Math.min(1, this.stepPhase);
    if (this.newPlant) {
      const p0 = this.prevPlant;
      const p1 = this.newPlant;
      this.root.position.x = p0.x + (p1.x - p0.x) * u;
      this.root.position.z = p0.z + (p1.z - p0.z) * u;
    }
    if (u >= 1) {
      // plant foot, fire footfall
      this.prevPlant = this.newPlant || this.prevPlant;
      const side = this.swingL ? 'L' : 'R';
      this.j['foot' + side].getWorldPosition(this._footW);
      this.footfalls.push({ side, x: this._footW.x, z: this._footW.z, first: this.stepCount === 0 });
      this.stepCount++;
      this.swingL = !this.swingL;
      this.stepPhase = 0;
      this._planStep(route);
      if (this.newPlant) {
        this.root.position.x = this.newPlant.x;
        this.root.position.z = this.newPlant.z;
      }
    }

    // ease yaw toward the route heading (or a forced target)
    this._easeYaw(dt);
    // pose: walk cycle at a lowered hip (full-height legs cannot span the
    // stance; the mech stomps half-crouched), hip ramps down after the rise
    this.hipBase += (WALK_HIP - this.hipBase) * Math.min(1, dt * 1.4);
    const su = Math.sin(Math.PI * u);
    const bob = 3 * su * su;
    const hipY = this.hipBase + bob;
    const e = {};
    const swingSide = this.swingL ? 'L' : 'R';
    const stanceSide = this.swingL ? 'R' : 'L';
    // feet via sagittal IK: stance foot stays planted, swing foot arcs in
    const dirX = Math.sin(this.root.rotation.y);
    const dirZ = Math.cos(this.root.rotation.y);
    const planted = this.prevPlant || this.newPlant;
    const target = this.newPlant || this.prevPlant;
    const lift = 16 * su;
    const hipPivotY = hipY - 2;
    for (const [side, pos, yUp, footX] of [
      [stanceSide, planted, 0, 0],
      [swingSide, target, lift, 0.18 * su],
    ]) {
      const fwd = -((pos.x - this.root.position.x) * dirX + (pos.z - this.root.position.z) * dirZ);
      const ankleY = 10.5 + yUp;
      const [th, kn] = this._ikLeg(fwd, hipPivotY - ankleY);
      e['thigh' + side] = [th, 0, side === 'L' ? 0.05 : -0.05];
      e['shin' + side] = [kn, 0, 0];
      e['foot' + side] = [footX, 0, 0];
    }
    e.torso = [0.07, 0.05 * su * (this.swingL ? 1 : -1), -0.03 * su * (this.swingL ? 1 : -1)];
    e.head = [0.02, -0.04 * su * (this.swingL ? 1 : -1), 0];
    const armSwing = 0.38 * su * (this.swingL ? 1 : -1); // opposite to leg
    e.shoulderL = [armSwing + 0.05, 0, 0.05];
    e.shoulderR = [armSwing + 0.05, 0, -0.05];
    e.elbowL = [0.3 + 0.25 * su, 0, 0];
    e.elbowR = [0.3 + 0.25 * su, 0, 0];
    e.ventL = [-0.95, 0, 0];
    e.ventR = [-0.95, 0, 0];
    this._apply(e);
    this.j.hip.position.y = hipY;
    M.visor.emissiveIntensity = 1.4;
    M.glow.emissiveIntensity = 1.2 + 0.4 * Math.sin(t * 6);

    // lateral weight shift toward the planted foot
    this.j.hip.position.x = (this.swingL ? -1 : 1) * 4 * su;
  }

  _easeYaw(dt) {
    const target = this.targetYaw;
    if (target == null) return;
    let d = target - this.root.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.root.rotation.y += d * Math.min(1, dt * 2.2);
  }

  // two-bone IK in the sagittal plane: hip-pivot to ankle. b = backward
  // offset (+z behind the hip), v = drop below the hip pivot. Knee leads
  // forward, heel folds back. Returns [thighX, shinX] euler.
  _ikLeg(b, v) {
    const L1 = 38; // hip pivot -> knee pivot
    const L2 = 34; // knee pivot -> ankle
    let c = Math.hypot(b, v);
    const maxC = L1 + L2 - 2;
    const minC = Math.abs(L1 - L2) + 4;
    if (c > maxC || c < minC) {
      const s = (c > maxC ? maxC : minC) / Math.max(c, 1e-3);
      b *= s;
      v *= s;
      c = Math.hypot(b, v);
    }
    const clamp1 = (x) => Math.min(1, Math.max(-1, x));
    const alpha = Math.atan2(b, v);
    const beta = Math.acos(clamp1((L1 * L1 + c * c - L2 * L2) / (2 * L1 * c)));
    const bend = Math.PI - Math.acos(clamp1((L1 * L1 + L2 * L2 - c * c) / (2 * L1 * L2)));
    return [alpha - beta, bend];
  }

  _planStep(route) {
    // decide next foot placement along the route; also handles cinematic cuts
    for (const cut of route.cuts) {
      if (!cut.done && (this._walked || 0) >= cut.after) {
        cut.done = true;
        this._walked = 0;
        this.progress = cut.to;
        const pos = route._posAt(this.progress);
        this.prevPlant = pos;
        this.root.position.x = pos.x;
        this.root.position.z = pos.z;
        this.targetYaw = route._headingAt(this.progress);
        if (this.onCut) this.onCut(cut);
        break;
      }
    }
    if (route.total - this.progress < 130) {
      // arrival: plant the last step and stand
      this.newPlant = { x: route.pts.at(-1).x, z: route.pts.at(-1).z };
      this.root.position.x = this.newPlant.x;
      this.root.position.z = this.newPlant.z;
      this.state = 'arrive';
      this.targetYaw = route._headingAt(route.total);
      return;
    }
    const stride = this.stride;
    const d0 = this.progress;
    const d1 = Math.min(route.total, this.progress + stride);
    const p = route._posAt(d1);
    const h = route._headingAt(d0 + 40);
    // stagger slightly so the two feet use parallel tracks
    const perp = this.swingL ? 1 : -1;
    this.newPlant = { x: p.x + Math.cos(h) * 12 * perp, z: p.z - Math.sin(h) * 12 * perp };
    this.progress = d1;
    this._walked = (this._walked || 0) + stride;
    if (Math.abs(h - this.root.rotation.y) > 0.02) this.targetYaw = h;
  }

  beginVictory(yaw) {
    this.state = 'victory';
    this.victoryT = 0;
    this.targetYaw = yaw;
  }

  updateVictory(dt) {
    this.victoryT += dt;
    const v = this.victoryT;
    this._easeYaw(dt);
    const s1 = smoothstep(0.2, 1.4, v);
    const s2 = smoothstep(1.0, 2.6, v);
    const pump = v > 2.6 ? Math.sin((v - 2.6) * 2.4) : 0;
    const e = {};
    e.thighL = [0, 0, 0.16];
    e.thighR = [0, 0, -0.16];
    e.torso = [-0.07 + 0.02 * pump, -0.1 * s2, 0];
    e.head = [-0.24 - 0.06 * pump, 0.15, 0];
    e.shoulderL = [0.05, 0, 0.1 + 0.05 * pump];
    e.elbowL = [0.25, 0, 0];
    e.shoulderR = [-2.75 * s2 - 0.12 * pump, 0, -0.22];
    e.elbowR = [0.55 - 0.3 * s2, 0, 0];
    e.ventL = [-0.95, 0, 0];
    e.ventR = [-0.95, 0, 0];
    this._apply(e);
    this.j.hip.position.y = HIP_STAND + 0.8 * Math.sin(v * 1.3);
    this.j.hip.position.x = 0;
    M.visor.emissiveIntensity = 2.2 + Math.sin(v * 3.1) * 0.9;
    M.glow.emissiveIntensity = 2.2 + Math.sin(v * 2.2) * 0.8;
  }

  reset() {
    this.state = 'rise';
    this.T = 0;
    this.progress = 0;
    this.stepPhase = 0;
    this.swingL = true;
    this.prevPlant = null;
    this.newPlant = null;
    this.stepCount = 0;
    this.footfalls.length = 0;
    this.victoryT = -1;
    this._walked = 0;
    this._arriveAt = 0;
    this.root.position.set(this.start.x, 0, this.start.z);
    this.root.rotation.y = 0;
    this.j.hip.position.set(0, 34, 0);
    this.hipBase = HIP_STAND;
    this.targetYaw = null;
  }

  // keep pistons stretched between their anchors; call after matrices update
  postUpdate() {
    this.scene.updateMatrixWorld(false);
    for (const m of this.pistons) {
      const { a, b } = m.userData;
      // anchors are local offsets: transform by the pivot's world quaternion
      a.obj.getWorldPosition(this._tmpA).add(a.v.clone().applyQuaternion(a.obj.getWorldQuaternion(this._q)));
      b.obj.getWorldPosition(this._tmpB).add(b.v.clone().applyQuaternion(b.obj.getWorldQuaternion(this._q)));
      const dir = this._tmpB.clone().sub(this._tmpA);
      const len = dir.length();
      if (len < 1e-3) continue;
      m.position.copy(this._tmpA).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(this._up, dir.normalize());
      m.scale.set(1, len, 1);
    }
  }
}

export { HIP_STAND, smoothstep };
