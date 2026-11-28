// Missing Link hero: a pit stop, in 3D.
// The story plays once on load, driven by one clock t (seconds):
//   0.0  to 2.4   night pit lane, the car waits on its jacks, front-left wheel missing, red light
//   2.4  to 3.6   the missing wheel (the missing link) flies in and locks onto the hub
//   3.6  to 4.5   the car hypercharges: energy sweeps its stripes, light turns green, jacks drop
//   4.5  onwards  the car launches; the camera follows it out of the box, then cranes up
//   T_DONE        from above, the circuit is the Missing Link mark, drawn by the car's light trail
// Everything except the sparks is a pure function of t, so replay just rewinds the clock.
// The car and crew are generated 3D models (assets/3d, made smaller by tools/optimize_glb.py). The car
// model has no wheels: the scene fits its own, so one can be missing and the rest can spin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The composer encodes the clear colour twice and ACES darkens it; calibrated to read as night #13142B.
const CLEAR = new THREE.Color().setRGB(0.001636, 0.001623, 0.004000);
const FOG = new THREE.Color().setRGB(0.0211, 0.0210, 0.0508);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const bump = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return Math.sin(t * Math.PI); };
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = THREE.Vector3;

// ---------- timeline ----------
const T_FLY = 2.4;   // missing wheel starts its flight
const T_LOCK = 3.6;  // ...and locks on
const T_GREEN = 4.0; // light goes green, jacks drop
const T_GO = 4.5;    // launch
const ACC = 26;      // world units / s²
const VMAX = 32;     // world units / s

// ---------- the logo, as a circuit ----------
// Same paths as the #ml-mark sprite (viewBox 0 0 100 50). The car drives:
// pit lane -> left bracket -> across the stitches -> right bracket.
const S = 0.4; // world units per logo unit
const LEFT = 'M36.5 15.5 L29 8 Q25 4 21 8 L8 21 Q4 25 8 29 L21 42 Q25 46 29 42 L36.5 34.5';
const RIGHT = 'M63.5 34.5 L71 42 Q75 46 79 42 L92 29 Q96 25 92 21 L79 8 Q75 4 71 8 L63.5 15.5';
const STITCHES = [[38.25, 30.35, 43.35, 36.05], [41.93, 27.07, 47.03, 32.77], [45.61, 23.79, 50.71, 29.49],
  [49.29, 20.51, 54.39, 26.21], [52.97, 17.23, 58.07, 22.93], [56.65, 13.95, 61.75, 19.65]];
const STROKE = 9.5;
const PIT_LEN = 115; // logo units from the pit box to where the pit lane meets the circuit
const PIT = [36.5 + PIT_LEN * Math.SQRT1_2, 15.5 + PIT_LEN * Math.SQRT1_2];

const toWorld = ([x, y], h = 0) => new V3((x - 50) * S, h, (y - 25) * S);

function line(a, b, step = 1.5) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]);
  return out;
}
function samplePath(d) {
  const tok = d.match(/[MLQ]|-?\d*\.?\d+/g);
  const out = [];
  let i = 0, cmd = '', cur = null;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[MLQ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { cur = [num(), num()]; out.push(cur); }
    else if (cmd === 'L') { const e = [num(), num()]; out.push(...line(cur, e).slice(1)); cur = e; }
    else if (cmd === 'Q') {
      const c = [num(), num()], e = [num(), num()];
      for (let k = 1; k <= 14; k++) {
        const t = k / 14, u = 1 - t;
        out.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * e[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * e[1]]);
      }
      cur = e;
    }
  }
  return out;
}
// the three logo gradients, in logo space, as in the sprite
function gradient(a, b, stops) {
  const cols = stops.map(([t, hex]) => [t, new THREE.Color(hex)]);
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  return ([x, y]) => {
    const t = clamp01(((x - a[0]) * dx + (y - a[1]) * dy) / l2);
    for (let k = 1; k < cols.length; k++) {
      if (t <= cols[k][0]) {
        const [t0, c0] = cols[k - 1], [t1, c1] = cols[k];
        return c0.clone().lerp(c1, (t - t0) / (t1 - t0));
      }
    }
    return cols[cols.length - 1][1].clone();
  };
}
// the deepest stops are lifted a little so they still glow on the night ground
const gradL = gradient([10, 6], [34, 44], [[0, '#14F1F2'], [0.55, '#0A63FF'], [1, '#2450E6']]);
const gradR = gradient([90, 6], [66, 44], [[0, '#FF55E6'], [0.5, '#9A14E6'], [1, '#6A2BE6']]);
const gradS = gradient([38, 14], [62, 36], [[0, '#14F1F2'], [0.5, '#3A2BFF'], [1, '#FF3FE0']]);

// route through logo space, with cumulative distance in world units
const route = (() => {
  const lead = line(PIT, [36.5, 15.5]);
  const left = samplePath(LEFT);
  const diag = line([36.5, 34.5], [63.5, 15.5]);
  const right = samplePath(RIGHT).reverse();
  const pts = [...lead];
  const mark = {};
  mark.left0 = pts.length - 1;
  pts.push(...left.slice(1)); mark.left1 = pts.length - 1;
  pts.push(...diag.slice(1)); mark.diag1 = pts.length - 1;
  pts.push(...right.slice(1)); mark.end = pts.length - 1;
  const world = pts.map((p) => toWorld(p));
  const dist = [0];
  for (let i = 1; i < world.length; i++) dist.push(dist[i - 1] + world[i].distanceTo(world[i - 1]));
  return { pts, world, dist, mark, len: dist[dist.length - 1] };
})();
const T_DONE = (() => {
  const tAcc = VMAX / ACC, dAcc = 0.5 * ACC * tAcc * tAcc;
  return T_GO + tAcc + (route.len - dAcc) / VMAX;
})();
const T_END = T_DONE + 1.6;

function carDistance(t) {
  const tt = t - T_GO;
  if (tt <= 0) return 0;
  const tAcc = VMAX / ACC;
  const d = tt < tAcc ? 0.5 * ACC * tt * tt : 0.5 * ACC * tAcc * tAcc + VMAX * (tt - tAcc);
  return Math.min(d, route.len);
}
function carSpeed(t) {
  const tt = t - T_GO;
  if (tt <= 0 || t >= T_DONE) return 0;
  return Math.min(VMAX, ACC * tt);
}
function pointAt(d, out) {
  d = Math.min(Math.max(d, 0), route.len);
  let lo = 0, hi = route.dist.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (route.dist[m] <= d) lo = m; else hi = m; }
  const seg = route.dist[hi] - route.dist[lo] || 1;
  return out.copy(route.world[lo]).lerp(route.world[hi], (d - route.dist[lo]) / seg);
}

// A flat strip along a polyline in the ground plane. Every vertex carries its distance along the route,
// so a shader can reveal the strip as the car passes. Strips that fold on tight inner corners are drawn
// opaque, so the overlap does not show.
function strip(points, { width, dists = null, colors = null, dist = null }) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), dd = new Float32Array(n * 2);
  const nor = new Float32Array(n * 2 * 3);
  const tan = new V3(), nrm = new V3();
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    tan.subVectors(b, a).normalize();
    nrm.set(-tan.z, 0, tan.x).multiplyScalar(width / 2);
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s, sign = s ? 1 : -1;
      pos[k * 3] = points[i].x + nrm.x * sign;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = points[i].z + nrm.z * sign;
      nor[k * 3 + 1] = 1;
      if (colors) { col[k * 3] = colors[i].r; col[k * 3 + 1] = colors[i].g; col[k * 3 + 2] = colors[i].b; }
      dd[k] = dist !== null ? dist : dists ? dists[i] : 0;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aDist', new THREE.BufferAttribute(dd, 1));
  g.setIndex(idx);
  return g;
}
function merge(geos) {
  let total = 0, totalIdx = 0;
  geos.forEach((g) => { total += g.attributes.position.count; totalIdx += g.index.count; });
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'aColor', 'aDist'];
  names.forEach((nm) => {
    const size = geos[0].attributes[nm].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    geos.forEach((g) => { arr.set(g.attributes[nm].array, o); o += g.attributes[nm].array.length; });
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  });
  const idx = new Uint32Array(totalIdx);
  let o = 0, base = 0;
  geos.forEach((g) => { for (let i = 0; i < g.index.count; i++) idx[o++] = g.index.array[i] + base; base += g.attributes.position.count; });
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function fadeTexture() { // bright at the left, gone at the right: speed streaks
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 8);
  return new THREE.CanvasTexture(c);
}

// the logo's cyan, blue and magenta, in linear light, for shaders
const GRAD_GLSL = `
  vec3 brand(float t) {
    vec3 c = vec3(0.0070, 0.879, 0.888), b = vec3(0.0030, 0.125, 1.0), m = vec3(1.0, 0.050, 0.745);
    return t < 0.5 ? mix(c, b, t * 2.0) : mix(b, m, (t - 0.5) * 2.0);
  }`;

// ---------- car and crew geometry, in the car's frame: +X forward, +Y up, +Z the driver's right ----------
const CAR_SCALE = 1.35;          // the model is 3.77 long; this makes it about 5.1, close to the real thing
const CAR_GROUND = 0.477;        // the model's lowest point (the tyres it was made with) sits this far below its origin
const TYRE_R = 0.351;
const WHEEL_SPOTS = [            // x, z, tyre width; the first is the missing front-left
  [1.377, -0.95, 0.405], [1.377, 0.95, 0.405], [-1.6875, -0.9, 0.486], [-1.6875, 0.9, 0.486],
];
const HUB_FL = new V3(1.377, TYRE_R, -0.95);
const CREW_SCALE = 1.9;          // the crew model is 0.95 tall

// a rubber tyre: a lathed cross-section with rounded shoulders, axis along Z
function tyreGeometry(R, W) {
  const rIn = R * 0.64, sh = Math.min(0.075, W * 0.2), half = W / 2;
  const pts = [new THREE.Vector2(rIn, -half * 0.86), new THREE.Vector2(R * 0.82, -half)];
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.sin(a) * sh, -half + sh - Math.cos(a) * sh)); }
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, half - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(R * 0.82, half), new THREE.Vector2(rIn, half * 0.86));
  const g = new THREE.LatheGeometry(pts, 72);
  g.rotateX(Math.PI / 2);
  return g;
}
function paintRing(geo) { // the logo gradient around a ring
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  const c = new THREE.Color('#14F1F2'), b = new THREE.Color('#0A63FF'), m = new THREE.Color('#FF3FE0'), tmpC = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const a = (Math.atan2(p.getY(i), p.getX(i)) / Math.PI + 1) / 2;
    const t = a < 0.5 ? a * 2 : (1 - a) * 2;
    if (t < 0.5) tmpC.copy(c).lerp(b, t * 2); else tmpC.copy(b).lerp(m, (t - 0.5) * 2);
    col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function noiseCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}

// An HDR room for reflections: long pit-lane light bars overhead, a cool garage glow behind,
// and a cyan and a magenta panel so the paint picks up the brand colours.
function pitEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(60, 20, 60), new THREE.MeshBasicMaterial({ color: 0x080a16, side: THREE.BackSide })));
  const panel = (w, h, hex, k, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m);
  };
  for (let i = -2; i <= 2; i++) panel(22, 0.7, 0xeef2ff, 9, 0, 9, i * 5, Math.PI / 2);
  panel(16, 6, 0x5f78ff, 1.6, 0, 4, 29, 0, Math.PI);
  panel(8, 5, 0xff4fe0, 2.2, -29, 4, -6, 0, Math.PI / 2);
  panel(8, 5, 0x2ef0ff, 2.2, 29, 4, 6, 0, -Math.PI / 2);
  panel(60, 60, 0x0d0f1e, 1, 0, -9.9, 0, -Math.PI / 2);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  return tex;
}

// film finish: a soft vignette and fine grain, applied after tone mapping
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= mix(1.0, 0.62, smoothstep(0.25, 0.85, dot(d, d) * 2.2));
      c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export function createPitScene(canvas, { reducedMotion = false, onBeat = () => {} } = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700; // phones: lighter render
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.setClearColor(CLEAR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 18, 80);
  scene.environment = pitEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.3, 700);

  // ---------- materials ----------
  const M = {
    tyre: new THREE.MeshPhysicalMaterial({ color: '#141418', roughness: 0.82, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color('#3a3d4a'), envMapIntensity: 0.6 }),
    rim: new THREE.MeshStandardMaterial({ color: '#1d2030', metalness: 0.92, roughness: 0.3 }),
    disc: new THREE.MeshStandardMaterial({ color: '#2b2b30', metalness: 0.6, roughness: 0.55, emissive: new THREE.Color('#ff4a12'), emissiveIntensity: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: '#3a3e52', metalness: 0.85, roughness: 0.32 }),
    jackPaint: new THREE.MeshStandardMaterial({ color: '#1c2150', metalness: 0.4, roughness: 0.45 }),
    wall: new THREE.MeshStandardMaterial({ color: '#141629', roughness: 0.85 }),
    paint: new THREE.MeshStandardMaterial({ color: '#7d8199', roughness: 0.85, envMapIntensity: 0.3 }),
    blanket: new THREE.MeshStandardMaterial({ color: '#1a2056', roughness: 0.9 }),
    track: new THREE.MeshStandardMaterial({ color: '#16182d', roughness: 0.45, metalness: 0.45, envMapIntensity: 0.6, side: THREE.DoubleSide }),
  };
  const glowBasic = (hex, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });

  // asphalt: speckled albedo and a roughness map with wet patches
  const asphaltCanvas = noiseCanvas(512, (g, n) => {
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 26000; i++) { const v = 90 + Math.random() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * n, Math.random() * n, 1.5, 1.5); }
  });
  const wetCanvas = noiseCanvas(512, (g, n) => { // white = rough and dry, dark = wet and glossy
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * n, y = Math.random() * n, r = 20 + Math.random() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(20,20,20,0.9)'); grd.addColorStop(1, 'rgba(20,20,20,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  });
  const tex = (c, rep) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t; };
  const asphaltMap = tex(asphaltCanvas, 18); asphaltMap.colorSpace = THREE.SRGBColorSpace;
  const wetMap = tex(wetCanvas, 6);

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: '#0c0e20', roughness: 0.45, metalness: 0.4, envMapIntensity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(480, 120, 0x1c2044, 0x171a38);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);

  // ---------- the circuit: the logo as asphalt, and the light the car leaves on it ----------
  const { mark } = route;
  const seg = (a, b) => route.world.slice(a, b + 1);
  const segPts = (a, b) => route.pts.slice(a, b + 1);
  const segD = (a, b) => route.dist.slice(a, b + 1);
  const asphalt = new THREE.Mesh(merge([
    strip(seg(mark.left0, mark.left1), { width: STROKE * S * 1.16 }),
    strip(seg(mark.diag1, mark.end), { width: STROKE * S * 1.16 }),
  ]), M.track);
  asphalt.position.y = 0.02;
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  const glowU = { uProg: { value: 0 }, uGlow: { value: 1 }, uHead: { value: 3.5 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aColor; attribute float aDist;
      varying vec3 vColor; varying float vDist;
      void main() { vColor = aColor; vDist = aDist; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uProg, uGlow, uHead;
      varying vec3 vColor; varying float vDist;
      void main() {
        if (vDist > uProg) discard;
        float head = exp(-(uProg - vDist) * 0.3);
        gl_FragColor = vec4(vColor * (uGlow + uHead * head), 1.0);
      }`,
  });
  const leftPts = segPts(mark.left0, mark.left1), rightPts = segPts(mark.diag1, mark.end);
  const stitchGeos = STITCHES.map(([x1, y1, x2, y2]) => {
    // the stitch lights up when the car crosses it on the diagonal
    const a = [36.5, 34.5], u = [27, -19], ul = Math.hypot(...u);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const along = ((mx - a[0]) * u[0] + (my - a[1]) * u[1]) / ul;
    return strip([toWorld([x1, y1]), toWorld([x2, y2])], {
      width: 2.3 * S, colors: [gradS([x1, y1]), gradS([x2, y2])], dist: route.dist[mark.left1] + along * S,
    });
  });
  const glow = new THREE.Mesh(merge([
    strip(seg(mark.left0, mark.left1), { width: STROKE * S, dists: segD(mark.left0, mark.left1), colors: leftPts.map(gradL) }),
    strip(seg(mark.diag1, mark.end), { width: STROKE * S, dists: segD(mark.diag1, mark.end), colors: rightPts.map(gradR) }),
    ...stitchGeos,
  ]), glowMat);
  glow.position.y = 0.09;
  scene.add(glow);

  // floodlights around the circuit: a lamp and the pool of light it throws
  const poolTex = radialTexture([[0, 'rgba(205,214,255,0.28)'], [0.4, 'rgba(140,150,230,0.07)'], [1, 'rgba(0,0,0,0)']]);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampMat = glowBasic('#dfe5ff', 2.5);
  const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
  [[-18, -12], [50, -22], [118, -12], [-22, 52], [122, 50]].forEach(([x, y]) => {
    const p = toWorld([x, y]);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(p.x, 0.02, p.z);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(p.x, 0.4, p.z);
    scene.add(pool, lamp);
  });

  // ---------- the pit box ----------
  // Local frame: the car sits at the origin facing +X; +Z is the driver's right, where the garages are.
  const pit = new THREE.Group();
  pit.position.copy(toWorld(PIT));
  const leadDir = new V3().subVectors(route.world[mark.left0], route.world[0]).normalize();
  pit.rotation.y = Math.atan2(-leadDir.z, leadDir.x);
  scene.add(pit);
  const add = (parent, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  // wet pit lane: a mirror under a speckled asphalt layer; the wet patches let the reflection through
  const laneLen = 36, laneX = laneLen / 2 - 24;
  if (!small) {
    const mirror = add(pit, new Reflector(new THREE.PlaneGeometry(laneLen, 9), {
      textureWidth: 1024, textureHeight: 512, color: 0x5a5f78, clipBias: 0.003,
    }), laneX, 0.004, 0.4);
    mirror.rotation.x = -Math.PI / 2;
  }
  const lane = add(pit, new THREE.Mesh(new THREE.PlaneGeometry(laneLen, 9), new THREE.MeshStandardMaterial({
    color: '#3a3d52', map: asphaltMap, roughness: 1, roughnessMap: wetMap, metalness: 0.1, envMapIntensity: 0.8,
    transparent: !small, alphaMap: small ? null : wetMap,
  })), laneX, 0.008, 0.4);
  lane.rotation.x = -Math.PI / 2;
  lane.receiveShadow = true;
  const paintLine = (w, d, x, z) => { const m = add(pit, new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.paint), x, 0.014, z); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; };
  paintLine(7.6, 0.08, 0, -2.0); paintLine(7.6, 0.08, 0, 2.0); paintLine(0.08, 4.0, -3.8, 0); paintLine(0.08, 4.0, 3.8, 0);
  for (let x = -22; x < laneLen - 25; x += 3) paintLine(1.6, 0.07, x, -4.2);

  // garages, canopy and lights
  add(pit, box(32, 4.8, 0.5, M.wall), -6, 2.4, 4.9).receiveShadow = true;
  const doorTex = new THREE.CanvasTexture(noiseCanvas(64, (g, n) => {
    const grd = g.createLinearGradient(0, 0, 0, n);
    grd.addColorStop(0, '#5b6cc8'); grd.addColorStop(0.5, '#28306e'); grd.addColorStop(1, '#0e1130');
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
  }));
  doorTex.colorSpace = THREE.SRGBColorSpace;
  [[-0.6, 1.25], [-8.4, 0.8], [-16.2, 0.8]].forEach(([x, k]) => add(pit, new THREE.Mesh(new THREE.PlaneGeometry(6, 3.4),
    new THREE.MeshBasicMaterial({ map: doorTex, color: new THREE.Color(k, k, k), toneMapped: false })), x, 1.7, 4.64));
  add(pit, box(32, 0.06, 0.06, glowBasic('#3df0ff', 1.4)), -6, 4.55, 4.63);
  add(pit, box(32, 0.22, 3.8, M.wall), -6, 4.9, 3.1).castShadow = true;
  const barMat = glowBasic('#eef2ff', 3.4);
  for (let x = -14; x <= 4; x += 4.5) add(pit, box(2.6, 0.06, 0.22, barMat), x, 4.76, 1.5);
  // soft beams under the light bars
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vY; varying vec3 vN, vV; void main() { vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vY; varying vec3 vN, vV; void main() { float edge = pow(abs(dot(vN, vV)), 1.6); gl_FragColor = vec4(vec3(0.55, 0.6, 0.9) * 0.09 * vY * edge, 1.0); }',
  });
  for (const x of [-5, -0.5, 4]) { const beam = add(pit, new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.9, 4.6, 24, 1, true), beamMat), x, 2.4, 1.5); beam.renderOrder = 2; }
  // tyre stacks in blankets by the garage
  const stackGeo = new THREE.CylinderGeometry(0.36, 0.36, 1.45, 28);
  for (const [x, z] of [[-4.2, 3.9], [-5.0, 3.9], [3.1, 4.0]]) {
    const st = add(pit, new THREE.Mesh(stackGeo, M.blanket), x, 0.73, z);
    st.castShadow = st.receiveShadow = true;
  }
  // the release light hangs off the canopy over the nose
  add(pit, box(0.08, 0.6, 0.08, M.steel), 2.6, 4.45, 1.2);
  add(pit, box(0.42, 0.62, 0.32, M.wall), 2.6, 3.9, 1.2);
  const lampRed = new THREE.Color('#ff2b3a'), lampGreen = new THREE.Color('#2bff8a');
  const relMat = new THREE.MeshBasicMaterial({ color: lampRed.clone().multiplyScalar(4), toneMapped: false });
  add(pit, new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), relMat), 2.6, 3.9, 1.03);
  const relLight = add(pit, new THREE.PointLight(0xff2b3a, 6, 9, 1.4), 2.6, 3.7, 0.6);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x6a73c8, 0x0b0c18, 0.3));
  const key = new THREE.SpotLight(0xe6ecff, 90, 34, 0.72, 0.75, 1.3);
  pit.add(key);
  key.position.set(1.5, 9, -3.2);
  pit.add(key.target);
  key.target.position.set(0, 0, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  key.shadow.camera.near = 3; key.shadow.camera.far = 18;
  add(pit, new THREE.PointLight(0x7f9bff, 9, 12, 1.4), -0.6, 2.8, 3.6);
  const rimLight = add(pit, new THREE.PointLight(0xb43ad2, 7, 15, 1.4), -6, 2.4, -4.5);
  add(pit, new THREE.PointLight(0x2ee6f2, 3, 12, 1.5), 6, 1.6, -3.5);

  // ---------- the car ----------
  const car = new THREE.Group();
  scene.add(car);
  const body = new THREE.Group();
  car.add(body);

  // hypercharge: the model's own painted stripes light up, and an energy band sweeps nose to tail
  const carU = { uGlow: { value: 0 }, uSweep: { value: -1 }, uBand: { value: 0 } };
  function chargeable(mat) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, carU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vAlong;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = position.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow, uSweep, uBand; varying float vAlong;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 tc = diffuseColor.rgb;
          float hi = max(tc.r, max(tc.g, tc.b)), lo = min(tc.r, min(tc.g, tc.b));
          float stripe = smoothstep(0.28, 0.55, hi - lo);
          float band = exp(-pow((vAlong * 0.5 + 0.5 - uSweep) * 7.0, 2.0)) * uBand;
          totalEmissiveRadiance += tc * stripe * (uGlow + band * 3.0) / max(hi, 0.05) + vec3(0.06, 0.12, 0.5) * band * 0.25;`);
    };
    return mat;
  }

  // wheels: lathed tyre, spoked rim, brake disc; a ring in the logo gradient on every rim lip
  const ringAll = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(0.04, 0.04, 0.04) });
  const ringKey = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) });
  const spokeGeo = new THREE.BoxGeometry(TYRE_R * 0.56, 0.028, 0.035).translate(TYRE_R * 0.3, 0, 0);
  function makeWheel(W, ringMat, outward) {
    const g = new THREE.Group(), spin = new THREE.Group();
    g.add(spin);
    const tyre = new THREE.Mesh(tyreGeometry(TYRE_R, W), M.tyre);
    tyre.castShadow = tyre.receiveShadow = true;
    spin.add(tyre);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(TYRE_R * 0.63, TYRE_R * 0.63, W * 0.86, 40, 1, true), M.rim);
    barrel.rotation.x = Math.PI / 2; barrel.material.side = THREE.DoubleSide; spin.add(barrel);
    const face = (W / 2 - 0.03) * outward;
    for (let k = 0; k < 10; k++) { const s = new THREE.Mesh(spokeGeo, M.rim); s.rotation.z = (k / 10) * Math.PI * 2; s.position.z = face; spin.add(s); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 20), M.rim); hub.rotation.x = Math.PI / 2; hub.position.z = face + 0.02 * outward; spin.add(hub);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), glowBasic('#3df0ff', 0.6)); nut.rotation.x = Math.PI / 2; nut.position.z = face + 0.06 * outward; spin.add(nut);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(TYRE_R * 0.52, TYRE_R * 0.52, 0.035, 36), M.disc); disc.rotation.x = Math.PI / 2; disc.position.z = -0.04 * outward; g.add(disc);
    const ring = new THREE.Mesh(paintRing(new THREE.TorusGeometry(TYRE_R * 0.64, 0.016, 8, 72)), ringMat); ring.position.z = face + 0.012 * outward; spin.add(ring);
    return { g, spin };
  }
  const wheels = WHEEL_SPOTS.map(([x, z, w], i) => {
    const wh = makeWheel(w, i === 0 ? ringKey : ringAll, Math.sign(z));
    if (i > 0) { wh.g.position.set(x, TYRE_R, z); body.add(wh.g); }
    return wh;
  });
  const keyWheel = wheels[0];
  body.add(keyWheel.g);
  // the empty corner: a bare glowing brake disc and the ghost of the wheel that should be there
  const bareDiscMat = new THREE.MeshStandardMaterial({ color: '#2b2b30', metalness: 0.6, roughness: 0.5, emissive: new THREE.Color('#ff4a12'), emissiveIntensity: 1 });
  const bareDisc = add(body, new THREE.Mesh(new THREE.CylinderGeometry(TYRE_R * 0.52, TYRE_R * 0.52, 0.035, 36), bareDiscMat), HUB_FL.x, HUB_FL.y, HUB_FL.z + 0.04);
  bareDisc.rotation.x = Math.PI / 2;
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#d98bea', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ghost = new THREE.Group();
  ghost.position.copy(HUB_FL).add(new V3(0, 0, -0.22));
  ghost.add(new THREE.Mesh(new THREE.TorusGeometry(TYRE_R, 0.01, 6, 72), ghostMat), new THREE.Mesh(new THREE.TorusGeometry(TYRE_R * 0.64, 0.008, 6, 64), ghostMat));
  body.add(ghost);

  // contact shadow, underglow, speed streaks and the light that follows the car
  const contact = add(car, new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.9), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.55, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false })), -0.1, 0.012, 0);
  contact.rotation.x = -Math.PI / 2;
  const under = add(car, new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.4), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(90,120,255,0.9)'], [0.45, 'rgba(220,70,230,0.35)'], [1, 'rgba(0,0,0,0)']]),
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })), -0.1, 0.02, 0);
  under.rotation.x = -Math.PI / 2;
  const streakTex = fadeTexture();
  const streakGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
  const streaks = [];
  for (const [z, w, hex] of [[-0.9, 0.32, '#14F1F2'], [0.9, 0.32, '#FF55E6'], [0, 0.16, '#ff2b3a']]) {
    const sm = new THREE.MeshBasicMaterial({ map: streakTex, color: new THREE.Color(hex).multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const st = add(car, new THREE.Mesh(streakGeo, sm), -2.4, z ? 0.05 : 0.45, z);
    st.rotation.x = -Math.PI / 2;
    st.scale.set(1, w, 1);
    streaks.push(st);
  }
  const carLight = add(car, new THREE.PointLight(0x6a7bff, 0, 7, 1.6), 0, 2.6, 0);
  const lockLight = add(body, new THREE.PointLight(0xd36be8, 0, 7, 1.5), HUB_FL.x, HUB_FL.y, HUB_FL.z - 0.9);
  const rearLightMat = glowBasic('#ff2b3a', 3);
  add(body, box(0.05, 0.09, 0.16, rearLightMat), -2.5, 0.48, 0);

  // ---------- jacks ----------
  function makeJack(dir) {
    const j = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.09), M.jackPaint); bar.position.set(0.85 * dir, 0.14, 0); j.add(bar);
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.5), M.steel); cradle.position.set(0.02 * dir, 0.2, 0); j.add(cradle);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.15, 8), M.steel);
    handle.position.set(1.75 * dir, 0.55, 0); handle.rotation.z = 0.5 * dir; j.add(handle);
    const wheelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14);
    for (const z of [-0.12, 0.12]) { const w = new THREE.Mesh(wheelGeo, M.tyre); w.rotation.x = Math.PI / 2; w.position.set(1.6 * dir, 0.06, z); j.add(w); }
    j.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    pit.add(j);
    return j;
  }
  const jackF = makeJack(1), jackR = makeJack(-1);

  // ---------- particles ----------
  const dot = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  const DUST = small ? 260 : 480;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dustPos.set([(Math.random() - 0.5) * 30, Math.random() * 6, (Math.random() - 0.5) * 16], i * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.04, map: dot, color: 0x9aa0d0, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  pit.add(dust);

  const SPARKS = small ? 220 : 380;
  const sp = { pos: new Float32Array(SPARKS * 3).fill(-999), vel: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), next: 0 };
  const spCol = new Float32Array(SPARKS * 3);
  const palette = ['#14F1F2', '#4A6BFF', '#FF55E6', '#ffffff'].map((h) => new THREE.Color(h));
  for (let i = 0; i < SPARKS; i++) { const c = palette[i % 4]; spCol.set([c.r, c.g, c.b], i * 3); }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.06, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  function emit(at, n, speed, up = 1) {
    for (let k = 0; k < n; k++) {
      const i = sp.next; sp.next = (sp.next + 1) % SPARKS;
      sp.pos.set([at.x, at.y, at.z], i * 3);
      const v = new V3(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      sp.vel.set([v.x, v.y, v.z], i * 3);
      sp.life[i] = 0.5 + Math.random() * 0.7;
    }
  }
  function stepSparks(dt) {
    for (let i = 0; i < SPARKS; i++) {
      if (sp.life[i] <= 0) continue;
      sp.life[i] -= dt;
      if (sp.life[i] <= 0) { sp.pos[i * 3 + 1] = -999; continue; }
      sp.vel[i * 3 + 1] -= 7 * dt;
      sp.pos[i * 3] += sp.vel[i * 3] * dt;
      sp.pos[i * 3 + 1] = Math.max(0.02, sp.pos[i * 3 + 1] + sp.vel[i * 3 + 1] * dt);
      sp.pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }
  function clearSparks() { sp.life.fill(0); sp.pos.fill(-999); sparkGeo.attributes.position.needsUpdate = true; }

  // ---------- post ----------
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: small ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finishPass = new ShaderPass(FinishShader);
  composer.addPass(finishPass);

  // ---------- framing ----------
  let aspect = 1, aerialH = 60, pitScale = 1, pitDrop = 0;
  const aerialLook = new V3();
  let lastW = 0, lastH = 0;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === lastW && h === lastH) return; // phones resize as the address bar slides; skip reallocating
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // pit shot: phones pull back so the whole car fits, and the car sits high, clear of the headline
    pitScale = aspect < 1 ? Math.min(2.1, 0.95 / aspect) : 1;
    pitDrop = aspect < 0.75 ? 1.9 : aspect < 1.2 ? 1.2 : 0.75;
    // aerial: the logo fills a set share of the width and sits in the upper part of the frame
    const share = aspect < 0.75 ? 0.8 : aspect < 1.2 ? 0.6 : aspect < 1.5 ? 0.4 : 0.42;
    const tanH = Math.tan(THREE.MathUtils.degToRad(17.5)) * aspect;
    aerialH = (37 / share / 2) / tanH;
    const lift = aspect < 0.75 ? 0.24 : aspect < 1.2 ? 0.2 : aspect < 1.5 ? 0.25 : 0.19; // share of the frame height above centre
    aerialLook.set(0, 0, lift * 2 * aerialH * Math.tan(THREE.MathUtils.degToRad(17.5)));
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- models ----------
  const crew = [];
  const guns = [];
  let loaded = false;
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const base = new URL('../assets/3d/', import.meta.url);

  function setupCar(gltf) {
    const model = gltf.scene;
    model.rotation.y = Math.PI / 2; // the model's nose points along +Z
    model.scale.setScalar(CAR_SCALE);
    model.position.y = CAR_GROUND * CAR_SCALE;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      o.material = chargeable(new THREE.MeshPhysicalMaterial({
        map: old.map, roughness: 0.42, metalness: 0.18, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 1.1,
      }));
      old.dispose();
      o.castShadow = o.receiveShadow = true;
    });
    body.add(model);
  }

  // Crew poses are baked once from the T-pose: each limb is aimed along a direction in the model's own frame
  // (+X the way they face, +Y up, +Z their right arm side), then the bone rotations are blended at runtime.
  const LIMBS = {
    armR: ['tripo0_Left_Limb_2', 'tripo0_Left_Limb_3'], foreR: ['tripo0_Left_Limb_3', 'tripo0_Left_Limb_4'],
    armL: ['tripoSpine_0', 'bone_14'], foreL: ['bone_14', 'bone_15'],
    thighR: ['tripo0_Right_Limb_0', 'tripo0_Right_Limb_1'], shinR: ['tripo0_Right_Limb_1', 'tripo0_Right_Limb_2'],
    thighL: ['tripo1_Left_Limb_0', 'tripo1_Left_Limb_1'], shinL: ['tripo1_Left_Limb_1', 'tripo1_Left_Limb_2'],
    chest: ['tripo0_Left_Limb_0', 'tripoHead_0'],
  };
  const POSES = {
    stand: { armR: [0.12, -1, 0.2], foreR: [0.45, -1, 0.08], armL: [0.12, -1, -0.2], foreL: [0.45, -1, -0.08], chest: [0.04, 1, 0] },
    gun: { // braced, wheel gun held low in front
      armR: [0.35, -1, 0.12], foreR: [0.9, -0.35, -0.2], armL: [0.35, -1, -0.12], foreL: [0.9, -0.35, 0.2],
      thighR: [0.45, -1, 0.12], shinR: [-0.3, -1, 0.05], thighL: [0.45, -1, -0.12], shinL: [-0.3, -1, -0.05], chest: [0.35, 1, 0],
    },
    jack: { armR: [0.3, -1, 0.15], foreR: [0.7, -0.7, 0], armL: [0.3, -1, -0.15], foreL: [0.7, -0.7, 0], chest: [0.15, 1, 0] },
    cheer: { armR: [0.12, 1, 0.3], foreR: [0.05, 1, 0.08], armL: [0.12, 1, -0.3], foreL: [0.05, 1, -0.08], chest: [-0.05, 1, 0] },
  };
  const poseQ = {}; // pose name -> bone name -> quaternion
  let crewFootDrop = {};
  function bakePoses(template) {
    const bones = {};
    template.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    const rest = {};
    Object.values(bones).forEach((b) => { rest[b.name] = b.quaternion.clone(); });
    const a = new V3(), b = new V3(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(), qd = new THREE.Quaternion();
    const ankle = bones.tripo0_Right_Limb_2;
    template.updateMatrixWorld(true);
    const restAnkle = ankle.getWorldPosition(new V3()).y;
    for (const [name, pose] of Object.entries(POSES)) {
      Object.values(bones).forEach((bn) => bn.quaternion.copy(rest[bn.name]));
      for (const limb of ['chest', 'thighR', 'thighL', 'shinR', 'shinL', 'armR', 'armL', 'foreR', 'foreL']) {
        if (!pose[limb]) continue;
        const [bn, cn] = LIMBS[limb];
        const bone = bones[bn], child = bones[cn];
        template.updateMatrixWorld(true);
        bone.getWorldPosition(a); child.getWorldPosition(b);
        qd.setFromUnitVectors(b.sub(a).normalize(), new V3(...pose[limb]).normalize());
        bone.getWorldQuaternion(qw); bone.parent.getWorldQuaternion(qp);
        bone.quaternion.copy(qp.invert().multiply(qd).multiply(qw));
      }
      template.updateMatrixWorld(true);
      crewFootDrop[name] = restAnkle - ankle.getWorldPosition(new V3()).y; // keep the feet on the ground
      poseQ[name] = {};
      Object.values(bones).forEach((bn) => { poseQ[name][bn.name] = bn.quaternion.clone(); });
    }
  }
  // [x, z, facing x, facing z, step-away x, step-away z, working pose]. The camera side stays empty:
  // nobody there has the missing wheel, and the car stays in full view.
  const CREW_SPOTS = [
    [1.35, 2.05, 0, -1, 0, 0.9, 'gun'],
    [-1.7, 2.05, 0, -1, 0, 0.9, 'gun'],
    [3.95, 0.0, -1, 0, -0.6, 3.3, 'jack'],
    [-3.95, 0.0, 1, 0, -0.4, 0, 'jack'],
  ];
  function setupCrew(gltf) {
    const template = gltf.scene;
    template.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.7 });
        o.castShadow = true;
        o.frustumCulled = false; // skinned meshes move outside their bind-pose bounds
      }
    });
    bakePoses(template);
    const gunGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.42, 14).rotateZ(Math.PI / 2);
    const gunMat = new THREE.MeshStandardMaterial({ color: '#202436', metalness: 0.7, roughness: 0.35 });
    CREW_SPOTS.forEach(([x, z, fx, fz, ax, az, work], i) => {
      const c = SkeletonUtils.clone(template);
      c.scale.setScalar(CREW_SCALE);
      c.rotation.y = Math.atan2(-fz, fx);
      pit.add(c);
      const bones = {};
      c.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      crew.push({ g: c, bones, x, z, ax, az, work, phase: i * 1.7 });
      if (work === 'gun') {
        const gun = new THREE.Mesh(gunGeo, gunMat);
        gun.castShadow = true;
        pit.add(gun);
        guns.push({ gun, hand: bones.tripo0_Left_Limb_4, other: bones.bone_15, ry: c.rotation.y });
      }
    });
  }
  const ready = Promise.all([load(new URL('car.glb', base).href), load(new URL('crew.glb', base).href)])
    .then(([carG, crewG]) => { setupCar(carG); setupCrew(crewG); loaded = true; });

  // ---------- state ----------
  const state = { mouseX: 0, mouseY: 0 };
  let t = reducedMotion ? T_END : 0;
  let playing = !reducedMotion;
  let active = true;
  let mx = 0, my = 0;
  const beats = [['lock', T_LOCK], ['go', T_GO], ['logo', T_DONE], ['end', T_END]].map(([name, at]) => ({ name, at, fired: false }));
  let burstDone = false, finishDone = false;
  const clock = new THREE.Clock();

  const tmp = new V3(), tmp2 = new V3(), carPos = new V3(), heading = new V3(), hubWorld = new V3();
  const pitCamPos = new V3(), pitLook = new V3(), camPos = new V3(), camLook = new V3(), aerialPos = new V3();
  const flyFrom = new V3(0.4, 2.6, -4.0), flyMid = new V3(1.1, 1.5, -2.6);
  const qA = new THREE.Quaternion();

  function poseCrew(c, from, to, w, idle) {
    const A = poseQ[from], B = poseQ[to];
    for (const name in c.bones) qA.copy(A[name]).slerp(B[name], w), c.bones[name].quaternion.copy(qA);
    if (idle) c.bones.tripo0_Left_Limb_0.rotateZ(idle);
    return lerp(crewFootDrop[from], crewFootDrop[to], w);
  }

  function update(dt, time) {
    if (playing && loaded) t = Math.min(T_END, t + dt);
    beats.forEach((b) => { if (!b.fired && t >= b.at) { b.fired = true; onBeat(b.name); } });
    mx += (state.mouseX - mx) * 0.05;
    my += (state.mouseY - my) * 0.05;

    // --- the car on its route ---
    const d = carDistance(t);
    pointAt(d, carPos);
    pointAt(d + 0.9, tmp); pointAt(d - 0.9, tmp2);
    heading.subVectors(tmp, tmp2);
    if (d < 1) heading.copy(leadDir);
    heading.normalize();
    car.position.copy(carPos);
    car.rotation.y = Math.atan2(-heading.z, heading.x);
    const v = carSpeed(t);
    const launch = bump(T_GO, T_GO + 1.4, t);
    body.rotation.z = launch * 0.03;
    body.position.y = 0.1 * (1 - smooth(T_GREEN, T_GREEN + 0.25, t)) + (t > T_GO ? Math.sin(time * 40) * 0.004 * (v / VMAX) : 0);
    const gone = smooth(T_DONE, T_DONE + 0.35, t);
    car.scale.setScalar(Math.max(0.001, 1 - gone));
    car.visible = gone < 1 && loaded;
    wheels.forEach((w) => { if (w !== keyWheel || t >= T_LOCK) w.spin.rotation.z = -d / TYRE_R; });

    // --- the missing wheel flies in and locks ---
    const f = easeInOutCubic(smooth(T_FLY, T_LOCK, t));
    keyWheel.g.visible = t >= T_FLY - 0.05;
    if (t < T_LOCK) {
      const u = 1 - f;
      keyWheel.g.position.set(
        u * u * flyFrom.x + 2 * u * f * flyMid.x + f * f * HUB_FL.x,
        u * u * flyFrom.y + 2 * u * f * flyMid.y + f * f * HUB_FL.y,
        u * u * flyFrom.z + 2 * u * f * flyMid.z + f * f * HUB_FL.z);
      keyWheel.spin.rotation.z = u * 14;
      keyWheel.g.rotation.set(u * 0.9, u * 1.6, 0);
      if (playing && t > T_FLY && Math.random() < 0.7) { keyWheel.g.getWorldPosition(tmp); emit(tmp, 2, 0.8, 0.4); }
    } else {
      keyWheel.g.position.copy(HUB_FL);
      keyWheel.g.rotation.set(0, 0, 0);
    }
    const lock = smooth(T_LOCK, T_LOCK + 0.6, t);
    const flash = bump(T_LOCK - 0.05, T_LOCK + 0.7, t);
    if (playing && !burstDone && t >= T_LOCK) {
      burstDone = true;
      body.localToWorld(hubWorld.copy(HUB_FL).add(tmp.set(0, 0, -0.25)));
      emit(hubWorld, small ? 120 : 200, 5.5, 1.2);
    }
    const waiting = 1 - smooth(T_FLY + 0.6, T_LOCK, t);
    bareDisc.visible = t < T_LOCK;
    ghostMat.opacity = waiting * smooth(0.6, 1.4, t) * (0.45 + 0.4 * Math.sin(time * 4));
    ghost.scale.setScalar(1 + Math.sin(time * 4) * 0.03);
    bareDiscMat.emissiveIntensity = 0.6 + 0.4 * Math.sin(time * 4) * waiting;
    M.disc.emissiveIntensity = flash * 2 + lock * 0.35;
    lockLight.intensity = waiting * smooth(0.6, 1.4, t) * (2 + 1.5 * Math.sin(time * 4)) + flash * 12;

    // --- hypercharge ---
    carU.uSweep.value = lerp(1.3, -0.3, smooth(T_LOCK, T_LOCK + 0.8, t)); // nose to tail
    carU.uBand.value = bump(T_LOCK, T_LOCK + 0.85, t);
    carU.uGlow.value = 0.08 + lock * 1.1 + flash * 0.5;
    ringAll.color.setScalar(0.04 + lock * 2.2);
    under.material.opacity = lock * 0.8;
    carLight.intensity = lock * 3.5;
    const green = smooth(T_GREEN - 0.05, T_GREEN + 0.05, t);
    relMat.color.copy(lampRed).lerp(lampGreen, green).multiplyScalar(4);
    relLight.color.copy(lampRed).lerp(lampGreen, green);
    rearLightMat.color.setRGB(1, 0.04, 0.06).multiplyScalar(t < T_GO ? 1.5 + Math.max(0, Math.sin(time * 9)) * 2.5 : 3);
    streaks.forEach((s, i) => {
      s.scale.x = 0.5 + v * (i === 2 ? 0.18 : 0.3);
      s.material.opacity = (v / VMAX) * (1 - gone);
    });
    if (playing && v > 4 && t < T_DONE && Math.random() < 0.8) { car.localToWorld(tmp.set(-2.4, 0.1, (Math.random() - 0.5) * 1.8)); emit(tmp, 2, 1.6, 0.6); }

    // --- crew and jacks ---
    const release = smooth(T_GREEN, T_GREEN + 0.45, t);
    const cheer = smooth(T_GREEN + 0.25, T_GREEN + 0.8, t);
    const workIn = smooth(0.2, 1.4, t);
    crew.forEach((c) => {
      const idle = reducedMotion ? 0 : Math.sin(time * 1.3 + c.phase) * 0.03;
      const drop = cheer > 0 ? poseCrew(c, c.work, 'cheer', cheer, idle) : poseCrew(c, 'stand', c.work, workIn, idle);
      c.g.position.set(c.x + c.ax * release, -drop * CREW_SCALE, c.z + c.az * release);
    });
    guns.forEach(({ gun, hand, other, ry }) => { // the wheel gun sits between the two hands
      hand.getWorldPosition(tmp); other.getWorldPosition(tmp2);
      gun.position.copy(tmp).add(tmp2).multiplyScalar(0.5);
      pit.worldToLocal(gun.position);
      gun.rotation.set(0, ry, 0);
      gun.visible = cheer < 0.5;
    });
    jackF.position.set(2.75 - 0.3 * release, 0, 3.0 * release);
    jackF.rotation.y = -release * 0.9;
    jackR.position.set(-2.9 - 0.6 * release, 0, 0);

    // --- the logo appears under the car ---
    glowU.uProg.value = t >= T_DONE ? route.len + 10 : d - 0.6;
    const finish = bump(T_DONE - 0.1, T_DONE + 1.3, t);
    glowU.uGlow.value = 0.95 + finish * 1.4 + (t >= T_END ? Math.sin(time * 1.2) * 0.08 : 0);
    glowU.uHead.value = t >= T_DONE ? 0 : 3.5;
    if (playing && !finishDone && t >= T_DONE) { finishDone = true; emit(tmp.copy(carPos).setY(0.4), 90, 6, 1); }

    // --- camera: pit shot, follow the car out of the box, crane up to the aerial ---
    const intro = easeOutCubic(smooth(0, 2.4, t));
    const push = smooth(2.4, T_GO, t);
    pitCamPos.set(lerp(10.2, 6.9, intro) - push * 0.5, lerp(2.7, 1.2, intro) - push * 0.1, lerp(-12.4, -8.2, intro) + push * 0.6);
    pitLook.set(lerp(0.0, 0.3, intro), 0.45 - pitDrop * 1.1, 0.1);
    pitCamPos.sub(pitLook).multiplyScalar(pitScale * 0.7).add(pitLook);
    pit.localToWorld(pitCamPos);
    pit.localToWorld(pitLook);
    const follow = easeInOutCubic(smooth(T_GO, T_GO + 0.9, t));
    camLook.copy(pitLook).lerp(tmp.copy(carPos).setY(0.45), follow);
    const crane = easeInOutCubic(smooth(T_GO + 0.8, T_DONE + 0.7, t));
    aerialPos.set(aerialLook.x, aerialH, aerialLook.z + aerialH * 0.14);
    camPos.copy(pitCamPos).lerp(aerialPos, crane);
    camPos.y += Math.sin(crane * Math.PI) * aerialH * 0.12;
    camLook.lerp(aerialLook, easeInOutCubic(smooth(T_GO + 1.3, T_DONE + 0.7, t)));
    const settled = smooth(T_DONE, T_END, t);
    camPos.x += mx * lerp(0.35, aerialH * 0.025, settled) + (reducedMotion ? 0 : Math.sin(time * 0.17) * aerialH * 0.008 * settled);
    camPos.z += -my * lerp(0.2, aerialH * 0.02, settled);
    camPos.y += my * 0.15 * (1 - settled);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    scene.fog.near = lerp(18, aerialH * 1.25, crane);
    scene.fog.far = lerp(80, aerialH * 3.2, crane);

    bloom.strength = 0.4 + flash * 0.35 + finish * 0.5;
    rimLight.intensity = 7 + flash * 14;
    finishPass.uniforms.uTime.value = time % 10;
    dust.rotation.y = time * 0.01;
    stepSparks(dt);
    composer.render();
  }

  function loop() {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    if (active) update(dt, clock.elapsedTime);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    state,
    ready,
    duration: T_END,
    setActive(on) { active = on; },
    replay() {
      t = 0; playing = true; burstDone = false; finishDone = false;
      clearSparks();
      beats.forEach((b) => { b.fired = false; });
    },
    skip() { t = T_END; },
    seek(v, hold = true) { t = v; playing = !hold; }, // for checking a frame of the story
  };
}
