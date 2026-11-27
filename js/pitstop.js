// Missing Link hero: a pit stop, in 3D.
// The story plays once on load, driven by one clock t (seconds):
//   0.0  to 2.4   night pit lane, the car waits on its jacks, front-left wheel missing, red light
//   2.4  to 3.6   the missing wheel (the missing link) flies in and locks onto the hub
//   3.6  to 4.5   the car hypercharges: energy sweeps its stripes, light turns green, jacks drop
//   4.5  onwards  the car launches; the camera follows it out of the box, then cranes up
//   T_DONE        from above, the circuit is the Missing Link mark, drawn by the car's light trail
// Everything except the sparks is a pure function of t, so replay just rewinds the clock.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

export function createPitScene(canvas, { reducedMotion = false, onBeat = () => {} } = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700; // phones: lighter render
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75));
  renderer.setClearColor(CLEAR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 16, 70);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.3, 700);

  // ---------- materials ----------
  const M = {
    body: new THREE.MeshPhysicalMaterial({ color: '#1a2262', metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.45 }),
    carbon: new THREE.MeshStandardMaterial({ color: '#0b0d18', metalness: 0.4, roughness: 0.45, envMapIntensity: 0.8 }),
    tyre: new THREE.MeshStandardMaterial({ color: '#0e0e12', roughness: 0.7, metalness: 0.05 }),
    rim: new THREE.MeshStandardMaterial({ color: '#2b3048', metalness: 0.9, roughness: 0.28 }),
    helmetDriver: new THREE.MeshPhysicalMaterial({ color: '#c43ad8', metalness: 0.3, roughness: 0.25, clearcoat: 1 }),
    crew: new THREE.MeshStandardMaterial({ color: '#141943', roughness: 0.62, metalness: 0.1 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: '#1f2766', metalness: 0.35, roughness: 0.22, clearcoat: 1 }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#04050b', metalness: 0.9, roughness: 0.06 }),
    wall: new THREE.MeshStandardMaterial({ color: '#171a30', roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: '#30344c', metalness: 0.8, roughness: 0.35 }),
    paint: new THREE.MeshBasicMaterial({ color: '#9fa4c6' }),
    lane: new THREE.MeshStandardMaterial({ color: '#1a1c31', roughness: 0.4, metalness: 0.5, envMapIntensity: 0.6 }),
    track: new THREE.MeshStandardMaterial({ color: '#16182d', roughness: 0.45, metalness: 0.45, envMapIntensity: 0.6, side: THREE.DoubleSide }),
  };
  const glowBasic = (hex, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: '#0c0e20', roughness: 0.45, metalness: 0.4, envMapIntensity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(480, 120, 0x1c2044, 0x171a38);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
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

  // pit lane surface, running from behind the box to where it joins the circuit
  const laneLen = 34; // from behind the box to just short of the circuit
  const lane = add(pit, new THREE.Mesh(new THREE.PlaneGeometry(laneLen, 7), M.lane), laneLen / 2 - 24, 0.006, -0.2);
  lane.rotation.x = -Math.PI / 2;
  lane.receiveShadow = true;
  // box markings and the lane edge
  const paintLine = (w, d, x, z) => { const m = add(pit, new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.paint), x, 0.012, z); m.rotation.x = -Math.PI / 2; };
  paintLine(6.6, 0.07, 0, -1.7); paintLine(6.6, 0.07, 0, 1.7); paintLine(0.07, 3.4, -3.3, 0); paintLine(0.07, 3.4, 3.3, 0);
  for (let x = -22; x < laneLen - 25; x += 3) paintLine(1.6, 0.06, x, -3.7);

  // garages, canopy and lights
  add(pit, box(32, 4.6, 0.5, M.wall), -6, 2.3, 4.4).receiveShadow = true;
  const doorMat = glowBasic('#26326f', 1.1);
  const doorDimMat = glowBasic('#1a2350', 0.9);
  [[-0.6, doorMat], [-8.4, doorDimMat], [-16.2, doorDimMat]].forEach(([x, mat]) => add(pit, new THREE.Mesh(new THREE.PlaneGeometry(6, 3.3), mat), x, 1.65, 4.14));
  add(pit, box(32, 0.06, 0.06, glowBasic('#3df0ff', 1.4)), -6, 4.35, 4.13);
  add(pit, box(32, 0.22, 3.6, M.wall), -6, 4.7, 2.6).castShadow = true;
  const barMat = glowBasic('#e6ebff', 3.2);
  for (let x = -14; x <= 4; x += 4.5) add(pit, box(2.6, 0.06, 0.22, barMat), x, 4.56, 1.2);
  // the release light hangs off the canopy over the nose
  add(pit, box(0.08, 0.6, 0.08, M.steel), 2.4, 4.25, 1.0);
  add(pit, box(0.42, 0.62, 0.32, M.carbon), 2.4, 3.7, 1.0);
  const lampRed = new THREE.Color('#ff2b3a'), lampGreen = new THREE.Color('#2bff8a');
  const relMat = new THREE.MeshBasicMaterial({ color: lampRed.clone().multiplyScalar(4), toneMapped: false });
  const relLamp = add(pit, new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), relMat), 2.4, 3.7, 0.83);
  const relLight = add(pit, new THREE.PointLight(0xff2b3a, 6, 9, 1.4), 2.4, 3.5, 0.4);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x6a73c8, 0x0b0c18, 0.35));
  const key = new THREE.SpotLight(0xdfe6ff, 70, 32, 0.7, 0.7, 1.3);
  pit.add(key);
  key.position.set(2.5, 8.5, -3.5);
  pit.add(key.target);
  key.target.position.set(0.3, 0, 0.2);
  key.castShadow = !small;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.camera.near = 2; key.shadow.camera.far = 20;
  add(pit, new THREE.PointLight(0x7f9bff, 8, 11, 1.4), -0.6, 2.6, 3.0);
  const rimLight = add(pit, new THREE.PointLight(0xb43ad2, 6, 14, 1.4), -5, 2.2, -4);

  // ---------- the car ----------
  const car = new THREE.Group();
  scene.add(car);
  const body = new THREE.Group();
  car.add(body);
  const part = (geo, mat, x, y, z) => add(body, new THREE.Mesh(geo, mat), x, y, z);
  const link = (a, b, r, mat) => { // a thin rod between two points (suspension)
    const va = new V3(...a), vb = new V3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 6), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), vb.clone().sub(va).normalize());
    body.add(m);
  };
  part(new THREE.BoxGeometry(3.9, 0.05, 1.35), M.carbon, -0.2, 0.1, 0);
  const nose = part(new THREE.CylinderGeometry(0.09, 0.27, 1.75, 22), M.body, 1.55, 0.3, 0);
  nose.rotation.z = -Math.PI / 2; nose.scale.x = 0.7;
  part(new RoundedBoxGeometry(1.5, 0.42, 0.78, 3, 0.14), M.body, 0.15, 0.36, 0);
  for (const z of [-0.57, 0.57]) part(new RoundedBoxGeometry(1.55, 0.36, 0.42, 3, 0.15), M.body, -0.35, 0.3, z);
  const engine = part(new THREE.CylinderGeometry(0.1, 0.3, 1.75, 20), M.body, -1.15, 0.42, 0);
  engine.rotation.z = Math.PI / 2; engine.scale.set(0.85, 1, 0.8);
  part(new RoundedBoxGeometry(0.42, 0.34, 0.3, 2, 0.08), M.body, -0.32, 0.72, 0);
  part(new THREE.BoxGeometry(1.1, 0.3, 0.02), M.body, -1.25, 0.7, 0);
  part(new THREE.SphereGeometry(0.14, 20, 16), M.helmetDriver, 0.12, 0.66, 0);
  const halo = new THREE.Group();
  halo.position.set(0.12, 0.8, 0); halo.rotation.y = -Math.PI / 2;
  const haloArc = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 8, 24, Math.PI), M.carbon);
  haloArc.rotation.x = -Math.PI / 2;
  halo.add(haloArc); body.add(halo);
  link([0.42, 0.8, 0], [0.55, 0.5, 0], 0.03, M.carbon);
  part(new THREE.BoxGeometry(0.32, 0.035, 1.95), M.carbon, 2.38, 0.1, 0);
  const flap = part(new THREE.BoxGeometry(0.22, 0.03, 1.8), M.body, 2.22, 0.17, 0); flap.rotation.z = 0.25;
  for (const z of [-0.98, 0.98]) part(new THREE.BoxGeometry(0.45, 0.2, 0.025), M.carbon, 2.3, 0.17, z);
  part(new THREE.BoxGeometry(0.36, 0.04, 1.35), M.carbon, -2.15, 0.92, 0);
  const rflap = part(new THREE.BoxGeometry(0.24, 0.035, 1.35), M.body, -2.05, 1.03, 0); rflap.rotation.z = 0.35;
  for (const z of [-0.69, 0.69]) part(new THREE.BoxGeometry(0.62, 0.62, 0.025), M.body, -2.12, 0.78, z);
  part(new THREE.BoxGeometry(0.1, 0.5, 0.04), M.carbon, -2.05, 0.6, 0);
  part(new THREE.BoxGeometry(0.5, 0.18, 1.1), M.carbon, -1.98, 0.17, 0);
  for (const z of [-0.45, 0.45]) part(new THREE.BoxGeometry(0.08, 0.05, 0.12), M.carbon, 0.6, 0.6, z);
  for (const s of [-1, 1]) {
    link([1.4, 0.3, 0.12 * s], [1.55, 0.3, 0.66 * s], 0.018, M.carbon);
    link([1.25, 0.44, 0.18 * s], [1.55, 0.42, 0.66 * s], 0.018, M.carbon);
    link([-1.1, 0.3, 0.42 * s], [-1.35, 0.32, 0.6 * s], 0.02, M.carbon);
    link([-1.0, 0.5, 0.3 * s], [-1.35, 0.46, 0.6 * s], 0.02, M.carbon);
  }
  const rearLightMat = glowBasic('#ff2b3a', 3);
  part(new THREE.BoxGeometry(0.05, 0.08, 0.16), rearLightMat, -2.27, 0.36, 0);

  // neon stripes in the logo gradient; an energy band sweeps through them when the wheel locks
  const stripeU = { uInt: { value: 0.2 }, uSweep: { value: -1 }, uBand: { value: 0 } };
  const stripeMat = new THREE.ShaderMaterial({
    uniforms: stripeU, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uInt, uSweep, uBand; varying vec2 vUv; ${GRAD_GLSL}
      void main() { float band = exp(-pow((vUv.x - uSweep) * 5.0, 2.0)); gl_FragColor = vec4(brand(1.0 - vUv.x) * (uInt + band * uBand), 1.0); }`,
  });
  const stripe = (len, h, x, y, z, ry = 0) => { const m = part(new THREE.PlaneGeometry(len, h), stripeMat, x, y, z); m.rotation.y = ry; };
  for (const s of [-1, 1]) {
    stripe(3.7, 0.045, -0.2, 0.135, 0.68 * s);
    stripe(1.5, 0.04, -0.35, 0.43, 0.785 * s);
    stripe(1.55, 0.035, 1.5, 0.32, 0.17 * s, -0.11 * s);
    stripe(1.5, 0.035, -1.1, 0.5, 0.2 * s, 0.11 * s);
  }
  stripe(1.95, 0.03, 2.55, 0.12, 0, Math.PI / 2);
  stripe(1.35, 0.03, -1.96, 1.08, 0, Math.PI / 2);

  // wheels: a ring in the logo gradient on every rim; the missing wheel's ring burns from the start
  function ringMaterial(k) { return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(k, k, k) }); }
  function paintRing(geo) {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const c = new THREE.Color('#14F1F2'), b = new THREE.Color('#0A63FF'), m = new THREE.Color('#FF3FE0'), tmpC = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const a = (Math.atan2(p.getY(i), p.getX(i)) / Math.PI + 1) / 2; // 0..1 around
      const t = a < 0.5 ? a * 2 : (1 - a) * 2;
      if (t < 0.5) tmpC.copy(c).lerp(b, t * 2); else tmpC.copy(b).lerp(m, (t - 0.5) * 2);
      col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  const ringAll = ringMaterial(0.06), ringKey = ringMaterial(2.6);
  function makeWheel(r, w, ringMat, outward) {
    const g = new THREE.Group(), spin = new THREE.Group();
    g.add(spin);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 40), M.tyre); tyre.rotation.x = Math.PI / 2; spin.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w * 1.02, 32), M.rim); rim.rotation.x = Math.PI / 2; spin.add(rim);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 1.25, 0.03, 0.02), M.carbon);
      sp.rotation.z = (k / 5) * Math.PI; sp.position.z = (w / 2 + 0.006) * outward; spin.add(sp);
    }
    const ring = new THREE.Mesh(paintRing(new THREE.TorusGeometry(r * 0.72, 0.024, 8, 64)), ringMat);
    ring.position.z = (w / 2 + 0.01) * outward; spin.add(ring);
    return { g, spin, r };
  }
  const HUB_FL = new V3(1.55, 0.34, -0.82);
  const wheels = [];
  for (const [x, y, z, r, w] of [[1.55, 0.34, 0.82, 0.34, 0.34], [-1.35, 0.36, -0.8, 0.36, 0.44], [-1.35, 0.36, 0.8, 0.36, 0.44]]) {
    const wh = makeWheel(r, w, ringAll, Math.sign(z));
    wh.g.position.set(x, y, z);
    body.add(wh.g);
    wheels.push(wh);
  }
  const keyWheel = makeWheel(0.34, 0.34, ringKey, -1);
  body.add(keyWheel.g);
  wheels.push(keyWheel);
  // what marks the empty corner: a glowing brake disc and the ghost of the wheel that should be there
  const disc = part(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 24), glowBasic('#ff5a1e', 1), HUB_FL.x, HUB_FL.y, HUB_FL.z + 0.02);
  disc.rotation.x = Math.PI / 2;
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#d98bea', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ghost = new THREE.Group();
  ghost.position.copy(HUB_FL).add(new V3(0, 0, -0.2));
  ghost.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 6, 64), ghostMat), new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.01, 6, 48), ghostMat));
  body.add(ghost);

  // underglow, speed streaks and the light that follows the car
  const under = add(car, new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(90,120,255,0.9)'], [0.45, 'rgba(220,70,230,0.35)'], [1, 'rgba(0,0,0,0)']]),
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })), -0.1, 0.02, 0);
  under.rotation.x = -Math.PI / 2;
  const streakTex = fadeTexture();
  const streakGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
  const streaks = [];
  for (const [z, w, hex] of [[-0.8, 0.3, '#14F1F2'], [0.8, 0.3, '#FF55E6'], [0, 0.16, '#ff2b3a']]) {
    const sm = new THREE.MeshBasicMaterial({ map: streakTex, color: new THREE.Color(hex).multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const st = add(car, new THREE.Mesh(streakGeo, sm), -2.0, z ? 0.05 : 0.36, z);
    st.rotation.x = -Math.PI / 2;
    st.scale.set(1, w, 1);
    streaks.push(st);
  }
  const carLight = add(car, new THREE.PointLight(0x6a7bff, 0, 9, 1.5), 0, 1.2, 0);
  const lockLight = add(body, new THREE.PointLight(0xd36be8, 0, 7, 1.5), HUB_FL.x, HUB_FL.y, HUB_FL.z - 0.8);

  car.traverse((o) => { if (o.isMesh && o.material !== stripeMat && !o.material.blending) o.castShadow = true; });

  // ---------- jacks and crew ----------
  const jackF = new THREE.Group(), jackR = new THREE.Group();
  [jackF, jackR].forEach((j, i) => {
    const dir = i ? -1 : 1;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.08), M.steel); bar.position.set(0.75 * dir, 0.12, 0); j.add(bar);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), M.steel);
    handle.position.set(1.55 * dir, 0.55, 0); handle.rotation.z = 0.45 * dir; j.add(handle);
    j.position.set(i ? -2.2 : 2.45, 0, 0);
    pit.add(j);
  });
  function crewMember() {
    const g = new THREE.Group();
    const torso = add(g, new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.44, 4, 10), M.crew), 0, 1.1, 0); torso.scale.z = 0.75;
    add(g, new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), M.helmet), 0, 1.6, 0);
    add(g, new THREE.Mesh(new THREE.SphereGeometry(0.151, 20, 10, Math.PI - 0.95, 1.9, 1.15, 0.6), M.visor), 0, 1.6, 0);
    for (const z of [-0.11, 0.11]) add(g, new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.56, 4, 8), M.crew), 0, 0.42, z);
    const arms = [-0.27, 0.27].map((z) => {
      const pivot = add(g, new THREE.Group(), 0, 1.36, z * 0.85);
      add(pivot, new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.46, 4, 8), M.crew), 0, -0.3, 0);
      return pivot;
    });
    add(g, box(0.02, 0.05, 0.3, glowBasic('#3df0ff', 1.2)), 0.19, 1.02, 0);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { g, arms };
  }
  // [x, z, facing, step-away x, step-away z, pose]
  const CREW = [
    [0.75, -1.85, Math.PI / 2 - 0.5, -0.3, -0.8, 'gun'],  // waits at the empty corner
    [1.55, 1.75, -Math.PI / 2, 0, 0.8, 'gun'],
    [-1.35, 1.75, -Math.PI / 2, 0, 0.8, 'gun'],
    [3.6, 0, Math.PI, 0.3, 2.6, 'jack'],         // front jack: has to clear the way
    [-3.3, 0, 0, -0.4, 0, 'jack'],
  ].map(([x, z, ry, ax, az, pose], i) => {
    const c = crewMember();
    c.g.position.set(x, 0, z);
    c.g.rotation.y = ry;
    c.g.scale.setScalar(0.92);
    pit.add(c.g);
    return { ...c, x, z, ax, az, pose, phase: i * 1.7 };
  });

  // ---------- particles ----------
  const dot = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  const DUST = small ? 260 : 480;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dustPos.set([(Math.random() - 0.5) * 30, Math.random() * 6, (Math.random() - 0.5) * 16], i * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.05, map: dot, color: 0x9aa0d0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  pit.add(dust);

  const SPARKS = small ? 220 : 380;
  const sp = { pos: new Float32Array(SPARKS * 3).fill(-999), vel: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), next: 0 };
  const spCol = new Float32Array(SPARKS * 3);
  const palette = ['#14F1F2', '#4A6BFF', '#FF55E6', '#ffffff'].map((h) => new THREE.Color(h));
  for (let i = 0; i < SPARKS; i++) { const c = palette[i % 4]; spCol.set([c.r, c.g, c.b], i * 3); }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.075, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
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
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.4, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- framing ----------
  let aspect = 1, aerialH = 60, aerialLook = new V3(), pitScale = 1, pitDrop = 0;
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

  // ---------- state ----------
  const state = { mouseX: 0, mouseY: 0 };
  let t = reducedMotion ? T_END : 0;
  let playing = !reducedMotion;
  let active = true;
  let mx = 0, my = 0;
  const beats = [['title', 0.3], ['header', 0.7], ['lead', 1.3], ['lock', T_LOCK], ['go', T_GO], ['logo', T_DONE], ['end', T_END]]
    .map(([name, at]) => ({ name, at, fired: false }));
  let burstDone = false, finishDone = false;
  const clock = new THREE.Clock();

  const tmp = new V3(), tmp2 = new V3(), carPos = new V3(), heading = new V3(), hubWorld = new V3();
  const pitCamPos = new V3(), pitLook = new V3(), camPos = new V3(), camLook = new V3(), aerialPos = new V3();
  const flyFrom = new V3(0.6, 2.4, -3.6), flyMid = new V3(1.2, 1.4, -2.3);

  function update(dt, time) {
    if (playing) t = Math.min(T_END, t + dt);
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
    body.rotation.z = launch * 0.035;
    body.position.y = 0.12 * (1 - smooth(T_GREEN, T_GREEN + 0.25, t)) + (t > T_GO ? Math.sin(time * 40) * 0.004 * (v / VMAX) : 0);
    const gone = smooth(T_DONE, T_DONE + 0.35, t);
    car.scale.setScalar(Math.max(0.001, 1 - gone));
    car.visible = gone < 1;
    wheels.forEach((w) => { if (w !== keyWheel || t >= T_LOCK) w.spin.rotation.z = -d / w.r; });

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
      keyWheel.g.scale.setScalar(Math.min(1, 0.3 + smooth(T_FLY - 0.05, T_FLY + 0.3, t) * 0.7));
      if (playing && t > T_FLY && Math.random() < 0.7) { keyWheel.g.getWorldPosition(tmp); emit(tmp, 2, 0.8, 0.4); }
    } else {
      keyWheel.g.position.copy(HUB_FL);
      keyWheel.g.rotation.set(0, 0, 0);
      keyWheel.g.scale.setScalar(1);
    }
    const lock = smooth(T_LOCK, T_LOCK + 0.6, t);
    const flash = bump(T_LOCK - 0.05, T_LOCK + 0.7, t);
    if (playing && !burstDone && t >= T_LOCK) {
      burstDone = true;
      body.localToWorld(hubWorld.copy(HUB_FL).add(tmp.set(0, 0, -0.25)));
      emit(hubWorld, small ? 120 : 200, 5.5, 1.2);
    }
    const waiting = 1 - smooth(T_FLY + 0.6, T_LOCK, t);
    ghostMat.opacity = waiting * smooth(0.6, 1.4, t) * (0.45 + 0.4 * Math.sin(time * 4));
    ghost.scale.setScalar(1 + Math.sin(time * 4) * 0.03);
    disc.material.color.setRGB(1, 0.35, 0.12).multiplyScalar(0.5 + 0.35 * Math.sin(time * 4) * waiting + flash * 1.5);
    lockLight.intensity = waiting * smooth(0.6, 1.4, t) * (2 + 1.5 * Math.sin(time * 4)) + flash * 12;

    // --- hypercharge ---
    stripeU.uSweep.value = lerp(-0.3, 1.3, smooth(T_LOCK, T_LOCK + 0.7, t));
    stripeU.uBand.value = 5 * bump(T_LOCK, T_LOCK + 0.75, t);
    stripeU.uInt.value = 0.2 + lock * 1.4 + flash * 0.6;
    ringAll.color.setScalar(0.06 + lock * 2.2);
    under.material.opacity = lock * 0.85;
    carLight.intensity = lock * 14;
    const green = smooth(T_GREEN - 0.05, T_GREEN + 0.05, t);
    relMat.color.copy(lampRed).lerp(lampGreen, green).multiplyScalar(4);
    relLight.color.copy(lampRed).lerp(lampGreen, green);
    rearLightMat.color.setRGB(1, 0.04, 0.06).multiplyScalar(t < T_GO ? 1.5 + Math.max(0, Math.sin(time * 9)) * 2.5 : 3);
    streaks.forEach((s, i) => {
      s.scale.x = 0.5 + v * (i === 2 ? 0.18 : 0.3);
      s.material.opacity = (v / VMAX) * (1 - gone);
    });
    if (playing && v > 4 && t < T_DONE && Math.random() < 0.8) { car.localToWorld(tmp.set(-2.1, 0.1, (Math.random() - 0.5) * 1.6)); emit(tmp, 2, 1.6, 0.6); }

    // --- crew and jacks ---
    const release = smooth(T_GREEN, T_GREEN + 0.45, t);
    CREW.forEach((c) => {
      c.g.position.set(c.x + c.ax * release, 0, c.z + c.az * release);
      const idle = reducedMotion ? 0 : Math.sin(time * 1.3 + c.phase) * 0.04;
      const ready = c.pose === 'gun' ? 0.45 : 0.3;
      const up = 2.75 * smooth(T_GREEN + 0.2, T_GREEN + 0.7, t);
      c.arms.forEach((a, k) => { a.rotation.z = Math.max(ready + idle, up); a.rotation.x = up > 1 ? (k ? -0.25 : 0.25) : 0; });
    });
    jackF.position.set(2.45 + 0.3 * release, 0, 2.6 * release);
    jackF.rotation.y = -release * 0.9;
    jackR.position.x = -2.2 - 0.6 * release;

    // --- the logo appears under the car ---
    glowU.uProg.value = t >= T_DONE ? route.len + 10 : d - 0.6;
    const finish = bump(T_DONE - 0.1, T_DONE + 1.3, t);
    glowU.uGlow.value = 0.95 + finish * 1.4 + (t >= T_END ? Math.sin(time * 1.2) * 0.08 : 0);
    glowU.uHead.value = t >= T_DONE ? 0 : 3.5;
    if (playing && !finishDone && t >= T_DONE) { finishDone = true; emit(tmp.copy(carPos).setY(0.4), 90, 6, 1); }

    // --- camera: pit shot, follow the car out of the box, crane up to the aerial ---
    const intro = easeOutCubic(smooth(0, 2.4, t));
    const push = smooth(2.4, T_GO, t);
    pitCamPos.set(lerp(9.5, 6.4, intro) - push * 0.5, lerp(2.6, 1.15, intro) - push * 0.1, lerp(-11.5, -7.6, intro) + push * 0.6);
    pitLook.set(lerp(0.0, 0.3, intro), 0.4 - pitDrop * 1.1, 0.1);
    pitCamPos.sub(pitLook).multiplyScalar(pitScale * 0.82).add(pitLook);
    pit.localToWorld(pitCamPos);
    pit.localToWorld(pitLook);
    const follow = easeInOutCubic(smooth(T_GO, T_GO + 0.9, t));
    camLook.copy(pitLook).lerp(tmp.copy(carPos).setY(0.4), follow);
    const crane = easeInOutCubic(smooth(T_GO + 0.8, T_DONE + 0.7, t));
    aerialPos.set(aerialLook.x, aerialH, aerialLook.z + aerialH * 0.14);
    camPos.copy(pitCamPos).lerp(aerialPos, crane);
    camPos.y += Math.sin(crane * Math.PI) * aerialH * 0.12; // rise a little faster than we travel
    camLook.lerp(aerialLook, easeInOutCubic(smooth(T_GO + 1.3, T_DONE + 0.7, t)));
    const settled = smooth(T_DONE, T_END, t);
    camPos.x += mx * lerp(0.35, aerialH * 0.025, settled) + (reducedMotion ? 0 : Math.sin(time * 0.17) * aerialH * 0.008 * settled);
    camPos.z += -my * lerp(0.2, aerialH * 0.02, settled);
    camPos.y += my * 0.15 * (1 - settled);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fogK = crane;
    scene.fog.near = lerp(16, aerialH * 1.25, fogK);
    scene.fog.far = lerp(70, aerialH * 3.2, fogK);

    bloom.strength = 0.45 + flash * 0.35 + finish * 0.5;
    rimLight.intensity = 6 + flash * 14;
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
    duration: T_END,
    setActive(on) { active = on; },
    replay() {
      t = 0; playing = true; burstDone = false; finishDone = false;
      clearSparks();
      beats.forEach((b) => { b.fired = ['title', 'header', 'lead'].includes(b.name); });
    },
    skip() { t = T_END; },
    seek(v, hold = true) { t = v; playing = !hold; }, // for checking a frame of the story
  };
}
