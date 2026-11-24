import * as THREE from 'three';
import { rand } from './rng.js';

// Impact rings, dust plumes, footprint decals. All pooled, deterministic
// enough for stepping (no internal wall-clock use).

function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(230,220,205,1)');
  r.addColorStop(0.5, 'rgba(200,188,170,0.5)');
  r.addColorStop(1, 'rgba(180,170,150,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene) {
    // shockwave rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.75, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xd8b58a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, r0: 10, r1: 200 });
    }
    // dust particles
    this.N = 1800;
    this.pos = new Float32Array(this.N * 3);
    for (let k = 0; k < this.N; k++) this.pos[k * 3 + 1] = -1e5;
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    this.maxLife = new Float32Array(this.N);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      map: dustTexture(), size: 46, transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true, color: 0xcbbfa8,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // footprint decals
    this.decalGeo = new THREE.CircleGeometry(1, 20);
    this.decalGeo.rotateX(-Math.PI / 2);
    // dust-brown, not black: seen from the crane cam a row of these reads as
    // a track, not as holes in the ground
    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x4a3f33, transparent: true, opacity: 0.16, depthWrite: false,
    });
    this.decals = [];
    this.decalCursor = 0;
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }
    this._active = new Set();
  }

  impact(x, z, power = 1) {
    const slot = this.rings.find((r) => r.t <= 0) || this.rings[0];
    slot.t = 0.001;
    slot.dur = 0.8 + 0.5 * power;
    slot.r1 = (150 + 140 * power) * (0.8 + 0.4 * rand());
    slot.mesh.position.set(x, 3.6, z);
    slot.mesh.visible = true;
    this.dust(x, z, Math.round(70 * power), 60 + 50 * power);
    this.decal(x, z);
  }

  dust(x, z, n, spread) {
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      const a = rand() * Math.PI * 2;
      const r = rand() * spread;
      this.pos[k * 3] = x + Math.cos(a) * r;
      this.pos[k * 3 + 1] = 4 + rand() * 10;
      this.pos[k * 3 + 2] = z + Math.sin(a) * r;
      const up = 22 + rand() * 38;
      this.vel[k * 3] = Math.cos(a) * (8 + rand() * 26);
      this.vel[k * 3 + 1] = up;
      this.vel[k * 3 + 2] = Math.sin(a) * (8 + rand() * 26);
      this.maxLife[k] = this.life[k] = 1.6 + rand() * 1.8;
    }
  }

  decal(x, z) {
    const m = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    if (m.visible) this._active.delete(m);
    m.visible = true;
    m.position.set(x, 3.35, z);
    m.scale.set(30 + rand() * 10, 1, 46 + rand() * 14);
    m.rotation.y = rand() * Math.PI;
    this._active.add(m);
  }

  update(dt) {
    for (const s of this.rings) {
      if (s.t <= 0) continue;
      s.t += dt;
      const u = s.t / s.dur;
      if (u >= 1) {
        s.t = 0;
        s.mesh.visible = false;
        continue;
      }
      const r = s.r0 + (s.r1 - s.r0) * Math.sqrt(u);
      s.mesh.scale.set(r, 1, r);
      s.mesh.material.opacity = 0.55 * (1 - u) * (1 - u);
    }
    for (let k = 0; k < this.N; k++) {
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -1e5;
        continue;
      }
      this.life[k] -= dt;
      const drag = 1 - dt * 0.9;
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 2] *= drag;
      this.vel[k * 3 + 1] -= 14 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  reset() {
    for (const s of this.rings) {
      s.t = 0;
      s.mesh.visible = false;
    }
    this.life.fill(0);
    for (const m of this._active) m.visible = false;
    this._active.clear();
  }
}
