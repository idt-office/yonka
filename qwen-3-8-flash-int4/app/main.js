import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRoute, posAt, headingAt } from './route.js';
import { buildCity, LAND_H } from './city.js';
import { Mech, HIP_STAND, smoothstep } from './mech.js';
import { FX } from './fx.js';
import { AudioKit } from './audio.js';
import { reseed } from './rng.js';

const WALK_START = 13.4; // mech-clock second when stomping begins
const ROAR_T = 11.2;

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = 0xb2693f;
scene.fog = new THREE.FogExp2(HORIZON, 1.35e-5);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 2, 90000);
scene.add(camera);

// ---- environment lighting: dusk over the atlantic
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sun = new THREE.DirectionalLight(0xffb171, 2.7);
sun.position.set(-1, 0.24, -0.6).multiplyScalar(20000);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x5a7093, 0x3a3122, 0.65));

// sky dome
{
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color('#0a0e18') },
      horizonColor: { value: new THREE.Color('#e2854a') },
      sunDir: { value: sun.position.clone().normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor, horizonColor, sunDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.55, 0.25) * pow(s, 40.0) * 0.55;
        col += vec3(1.0, 0.85, 0.65) * pow(s, 1500.0) * 3.0;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70000, 24, 16), mat);
  scene.add(sky);
}

// ocean
{
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { time: { value: 0 }, horizonColor: { value: new THREE.Color(HORIZON) } },
    ]),
    vertexShader: `
      varying vec3 vWorld; varying float vDepth;
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        vDepth = -mvPosition.z;
        #include <fog_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `
      varying vec3 vWorld; varying float vDepth;
      uniform float time; uniform vec3 horizonColor;
      #include <fog_pars_fragment>
      void main(){
        vec3 deep = vec3(0.045, 0.085, 0.13);
        vec2 p = vWorld.xz;
        float w = sin(p.x*0.004 + time*0.7) * sin(p.y*0.006 - time*0.5);
        w += 0.5 * sin((p.x+p.y)*0.02 + time*1.7);
        vec3 col = deep + vec3(0.03, 0.025, 0.02) * w;
        col = mix(col, horizonColor, smoothstep(6000.0, 40000.0, vDepth) * 0.9);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), mat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.5;
  scene.add(ocean);
  scene.userData.oceanMat = mat;
}

// ---- state
const state = {
  simT: 0,
  speed: params.get('speed') ? Number(params.get('speed')) : 1,
  paused: false,
  trauma: 0,
  roared: false,
  victory: false,
  camMode: 'rise',
  camPos: new THREE.Vector3(),
  camLook: new THREE.Vector3(),
  shakeOff: new THREE.Vector3(),
  ready: false,
};

const audio = new AudioKit();
const keys = { init() { audio.init(); } };
addEventListener('pointerdown', keys.init, { once: true });
addEventListener('keydown', keys.init, { once: true });

// captions and cut flash
const captions = [
  { at: 0.5, text: 'MECH PROTOCOL // YONKERS-CLASS · FIVE SEGMENT CHASSIS · OSM TERRAIN LINK OK', dur: 6 },
  { at: 2.7, text: 'HYDRAULICS PRESSURISED · SERVO STACK ONLINE', dur: 4.5 },
  { at: 6.5, text: 'STAGE TWO · FEMUR ACTUATORS · GROUND LOAD 40.000 t', dur: 4.5 },
  { at: 9.7, text: 'FULL STAND · VENT PLATES DEPLOYED', dur: 3.5 },
  { at: 11.3, text: 'OBJECTIVE: STOMP MANHATTAN · BROOKLYN · QUEENS', dur: 5 },
];
let capEl, capText = '', tEnd = 0;
function caption(text, dur = 4.5) {
  capText = text;
  tEnd = state.simT + dur;
  if (capEl) {
    capEl.textContent = text;
    capEl.classList.add('show');
  }
}
function flash() {
  const f = el('flash');
  f.style.opacity = '1';
  requestAnimationFrame(() => { f.style.opacity = '0'; });
}

// ---- boot: load city data
let route = null;
let city = null;
let mech = null;
let fx = null;

const DATA_URL = params.get('data') || 'data/city.json';

async function boot() {
  const bar = el('bar');
  const pct = (v, label) => {
    bar.style.width = `${Math.round(v * 100)}%`;
    el('loadtext').textContent = label;
  };
  pct(0.02, 'downloading OpenStreetMap city data ...');
  const resp = await fetch(DATA_URL);
  const len = Number(resp.headers.get('content-length') || 0);
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (len) pct(0.02 + 0.55 * (got / len), 'downloading OSM data ...');
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  pct(0.6, 'parsing geometry ...');
  await frame();
  const data = JSON.parse(new TextDecoder().decode(buf));

  const landNames = data.boroughs.map((b) => b.name);
  route = buildRoute(landNames);
  pct(0.66, 'extruding ' + data.buildings.length.toLocaleString('en') + ' OSM footprints ...');
  await frame();
  city = await buildCity(data, scene, route, (v) => pct(0.66 + 0.32 * v, 'extruding buildings ...'));
  el('stats').textContent =
    `${city.stats.buildings.toLocaleString('en')} buildings · ${city.stats.dynamic} destructible · ` +
    `map data © OpenStreetMap contributors`;

  fx = new FX(scene);
  mech = new Mech(scene, route.start, WALK_START);
  mech.targetYaw = headingAt(route, 0);
  mech.onCut = (cut) => {
    flash();
    caption(cut.cap, 3.5);
    state.trauma = 1.1;
    const p = route._posAt(mech.progress);
    fx.impact(p.x, p.z, 1.3);
    city.toppleNear(p.x, p.z, 170, state.simT);
    audio.impact(1.4);
    for (let i = 0; i < 3; i++) audio.crack();
    state.camMode = 'chase';
    snapCamera();
  };
  pct(1, 'ready');
  state.ready = true;
  el('loading').style.display = 'none';
  if (params.get('t')) seek(Number(params.get('t')));
  else caption(captions[0].text, captions[0].dur);
}

function frame() {
  return new Promise((r) => requestAnimationFrame(r));
}

function seek(t) {
  if (!route || !mech) return; // boot not finished yet
  state.simT = 0;
  state.roared = false;
  state.victory = false;
  state.victoryAt = 0;
  state.trauma = 0;
  reseed();
  route.cuts.forEach((c) => { c.done = false; });
  for (const c of captions) c.shown = false;
  if (fx) fx.reset();
  if (city) city.reset();
  if (mech) {
    mech.reset();
    mech.targetYaw = headingAt(route, 0);
  }
  camInit = false;
  state.camMode = 'rise';
  let guard = 0;
  while (state.simT < t && guard++ < 40000) step(1 / 60);
}

// ---- simulation step
function step(dt) {
  state.simT += dt;
  const t = state.simT;

  if (!mech) return;
  mech.update(dt, route);
  mech.postUpdate();

  for (const ff of mech.footfalls) {
    const power = ff.first ? 1.25 : 1;
    fx.impact(ff.x, ff.z, power);
    city.toppleNear(ff.x, ff.z, 145 + 30 * power, t);
    audio.impact(power);
    audio.crack();
    state.trauma = Math.min(1.6, state.trauma + 0.55 * power);
  }

  if (!state.roared && mech.T >= ROAR_T) {
    state.roared = true;
    audio.roar();
    state.trauma = 1.3;
    const p = mech.root.position;
    fx.impact(p.x, p.z, 1.4);
    fx.dust(p.x, p.z, 200, 120);
  }

  if (mech.state === 'arrive' && !state.victory) {
    if (!state.victoryAt) state.victoryAt = t;
    if (t - state.victoryAt > 1.6) {
      state.victory = true;
      state.victoryAt = t;
      mech.beginVictory(mech.root.rotation.y + 0.6 + state.simT * 0.1);
      caption('MANHATTAN. BROOKLYN. QUEENS. YONKERS STANDS.', 9);
      audio.impact(1.5);
      state.trauma = 1.2;
    }
  }

  city.update(t, dt);
  fx.update(dt);

  // captions on the rise timeline
  for (const c of captions) {
    if (!c.shown && mech.T >= c.at) {
      c.shown = true;
      caption(c.text, c.dur);
    }
  }
  if (capEl && t > tEnd) capEl.classList.remove('show');

  // audio bed follows the action
  if (mech.state === 'rise') audio.setRumble(0.1 + smoothstep(2.6, 9, mech.T) * 0.35);
  else if (mech.state === 'walk') audio.setRumble(0.5 + 0.15 * Math.sin(mech.stepPhase * Math.PI * 2));
  else audio.setRumble(0.22);

  updateCamera(dt);
  state.trauma *= Math.exp(-dt * 1.8);
}

// ---- camera director
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();

function cameraTargets() {
  const p = mech.root.position;
  const yaw = mech.root.rotation.y;
  _dir.set(Math.sin(yaw), 0, Math.cos(yaw));
  const perp = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  if (mech.state === 'rise') {
    const T = mech.T;
    if (params.get('cam') === 'low') {
      // debug: eye level at the feet, for checking ground contact
      _v.set(p.x + 120, 6, p.z + 150);
      return { pos: _v, look: _look.set(p.x, 12, p.z), mode: 'rise', snap: false };
    }
    const r = T < 2.6 ? 330 : 330 + smoothstep(2.6, 10, T) * 150;
    const th = 0.55 + T * 0.16; // starts front-quarter (+z is the march facing), arcs to the side
    const h = 65 + smoothstep(2.6, 10.5, T) * 85;
    _v.set(p.x + Math.sin(th) * r, h, p.z + Math.cos(th) * r);
    return { pos: _v, look: _look.set(p.x, 20 + T * 7.5, p.z), mode: 'rise', snap: false };
  }
  if (mech.state === 'victory' || mech.state === 'arrive') {
    const base = mech.root.rotation.y;
    const th = base + 0.6 + state.simT * 0.1;
    _v.set(p.x + Math.sin(th) * 620, 300, p.z + Math.cos(th) * 620);
    return { pos: _v, look: _look.set(p.x, HIP_STAND + 30, p.z), mode: 'crane', snap: state.camMode !== 'crane' };
  }
  // walk: ground cam on every 7th step, otherwise chase
  const gstep = mech.stepCount % 7 === 3;
  const nearLand = mech.stepPhase > 1 - 0.9 / mech.stepDur || mech.stepPhase < 0.55;
  if (gstep && nearLand && mech.newPlant) {
    const tp = mech.newPlant;
    _v.set(tp.x - _dir.x * 60 + perp.x * 95, 26, tp.z - _dir.z * 60 + perp.z * 95);
    _look.set(tp.x, 90, tp.z);
    return { pos: _v, look: _look, mode: 'ground', snap: state.camMode !== 'ground' };
  }
  _v.set(p.x - _dir.x * 330 + perp.x * 130, 150, p.z - _dir.z * 330 + perp.z * 130);
  _look.set(p.x + _dir.x * 180, 70, p.z + _dir.z * 180);
  return { pos: _v, look: _look, mode: 'chase', snap: state.camMode === 'ground' || state.camMode === 'rise' };
}

let camInit = false;
function snapCamera() {
  const tgt = cameraTargets();
  camera.position.copy(tgt.pos);
  state.camLook.copy(tgt.look);
  camera.lookAt(state.camLook);
  state.camMode = tgt.mode;
  camInit = true;
}

function updateCamera(dt) {
  // undo last frame's trauma offset so it never leaks into the calm pose
  camera.position.sub(state.shakeOff);
  state.shakeOff.set(0, 0, 0);
  if (!camInit) {
    snapCamera();
    return;
  }
  const tgt = cameraTargets();
  if (tgt.mode !== state.camMode || tgt.snap) {
    camera.position.copy(tgt.pos);
    state.camLook.copy(tgt.look);
  } else {
    const lam = tgt.mode === 'ground' ? 9 : 2.3;
    const k = 1 - Math.exp(-lam * dt);
    camera.position.lerp(tgt.pos, k);
    state.camLook.lerp(tgt.look, k);
  }
  state.camMode = tgt.mode;
  camera.lookAt(state.camLook);
  // trauma shake
  const s = state.trauma * state.trauma;
  if (s > 0.001) {
    const t = state.simT;
    state.shakeOff.set(
      Math.sin(t * 93.7) * 9 * s,
      Math.sin(t * 71.3 + 2.1) * 7 * s,
      Math.sin(t * 81.7 + 4.2) * 9 * s
    );
    camera.position.add(state.shakeOff);
    camera.rotateZ(Math.sin(t * 63.1) * 0.016 * s);
  }
  camera.fov = 62 + s * 4;
  camera.updateProjectionMatrix();
}

// ---- HUD
addEventListener('DOMContentLoaded', () => {
  capEl = el('cap');
  el('mute').addEventListener('click', () => {
    const m = audio.toggleMute();
    el('mute').textContent = m ? 'unmute [M]' : 'mute [M]';
  });
});

addEventListener('keydown', (e) => {
  if (e.key === ' ') state.paused = !state.paused;
  else if (e.key === '1' || e.key === '2' || e.key === '4') state.speed = Number(e.key);
  else if (e.key.toLowerCase() === 'm') {
    const m = audio.toggleMute();
    el('mute').textContent = m ? 'unmute [M]' : 'mute [M]';
  } else if (e.key.toLowerCase() === 'r') location.reload();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- main loop
let last = performance.now();
let acc = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (state.ready && !state.paused) {
    acc += dt * state.speed;
    while (acc > 1 / 60) {
      step(1 / 60);
      acc -= 1 / 60;
    }
  }
  if (state.ready && city) {
    scene.userData.oceanMat.uniforms.time.value = state.simT;
  }
  renderer.render(scene, camera);
});

// expose for headless screenshots / deterministic seeking
window.YONKERS = { state, seek, step, camera, get mech() { return mech; }, get route() { return route; } };

boot().catch((err) => {
  el('loadtext').textContent = 'failed to load: ' + err.message + ' (run a local web server, see README)';
  console.error(err);
});
