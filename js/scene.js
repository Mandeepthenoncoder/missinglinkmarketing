// Missing Link hero: a 3D chain with one link missing.
// Story progress s (0..1) drives the scene; the page maps scroll to s.
//   0.00 to 0.36  chains close in, a gap stays open
//   0.12 to 0.62  the gap glows, sparks gather around it
//   0.46 to 0.76  the magenta link flies in and locks into the gap
//   0.74 to 0.86  lock flash, the chain pulls taut, sparks burst
//   0.78 to 1.00  camera settles on a three quarter view
// Interaction: hover lifts a link, drag turns the chain, click the magenta link to pulse it.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The composer encodes the clear colour twice and ACES darkens it, so these linear values are
// calibrated to read as the brand's night #13142B on screen; the fog is the same colour after one encode.
const CLEAR = new THREE.Color().setRGB(0.001636, 0.001623, 0.004000);
const FOG = new THREE.Color().setRGB(0.0211, 0.0210, 0.0508);
const SPACING = 1.45; // distance between link centres, tuned so links interlock
const PER_SIDE = 6;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const bump = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return Math.sin(t * Math.PI); };
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;

// Stadium shaped centreline of a chain link, lying in the XY plane, long axis on X.
class StadiumCurve extends THREE.Curve {
  constructor(straight = 0.8, radius = 0.5) {
    super();
    this.s = straight;
    this.r = radius;
    this.total = 2 * straight + 2 * Math.PI * radius;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const { s, r } = this;
    let d = t * this.total;
    if (d < s) return target.set(-s / 2 + d, r, 0);
    d -= s;
    const arc = Math.PI * r;
    if (d < arc) { const a = Math.PI / 2 - d / r; return target.set(s / 2 + r * Math.cos(a), r * Math.sin(a), 0); }
    d -= arc;
    if (d < s) return target.set(s / 2 - d, -r, 0);
    d -= s;
    const a = -Math.PI / 2 - d / r;
    return target.set(-s / 2 + r * Math.cos(a), r * Math.sin(a), 0);
  }
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createChainScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const small = Math.min(window.innerWidth, window.innerHeight) < 700; // phones: lighter render
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  // EffectComposer + OutputPass encode the clear colour twice and ACES darkens it.
  // These linear values are calibrated so the canvas reads exactly #0B0E1A on screen.
  renderer.setClearColor(CLEAR, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 13, 30);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  // ---------- lights ----------
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9089d0, 1.5);
  rim.position.set(-6, 2, -6);
  scene.add(rim);
  const gapLight = new THREE.PointLight(0xb43ad2, 0, 9, 1.6);
  gapLight.position.set(0, 0, 1.6);
  scene.add(gapLight);

  // ---------- chain ----------
  const curve = new StadiumCurve(0.8, 0.5);
  const linkGeo = new THREE.TubeGeometry(curve, 180, 0.15, 24, true);
  const ghostGeo = new THREE.TubeGeometry(curve, 120, 0.028, 8, true);

  const root = new THREE.Group();
  scene.add(root);
  const left = new THREE.Group();
  const right = new THREE.Group();
  root.add(left, right);

  const cEdge = new THREE.Color('#C9CCE0');
  const cNear = new THREE.Color('#E3DDF2');
  const tint = (t) => cEdge.clone().lerp(cNear, 1 - Math.abs(t - 0.5) * 2);

  const links = [];
  for (let i = 1; i <= PER_SIDE; i++) {
    for (const side of [-1, 1]) {
      const x = side * i * SPACING;
      const t = (x + PER_SIDE * SPACING) / (2 * PER_SIDE * SPACING);
      const color = tint(t);
      const mat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color.clone(),
        emissiveIntensity: 0,
        metalness: 0.95,
        roughness: 0.3,
        clearcoat: 0.5,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.75,
      });
      const m = new THREE.Mesh(linkGeo, mat);
      m.position.x = i * SPACING * side;
      m.rotation.x = i % 2 ? Math.PI / 2 : 0;
      m.userData = { i, side, baseRotX: m.rotation.x, hover: 0, kick: 0 };
      (side < 0 ? left : right).add(m);
      links.push(m);
    }
  }

  // the missing link
  const keyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#D98BEA'),
    emissive: new THREE.Color('#B43AD2'),
    emissiveIntensity: 0.5,
    metalness: 0.55,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.4,
  });
  const keyLink = new THREE.Mesh(linkGeo, keyMat);
  keyLink.userData = { hover: 0 };
  root.add(keyLink);

  // glowing outline that marks the empty slot
  const ghostMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#D98BEA'),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const ghost = new THREE.Mesh(ghostGeo, ghostMat);
  root.add(ghost);

  // ---------- particles ----------
  const sprite = dotTexture();

  const DUST = small ? 380 : 700;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 34;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 18;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 3;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.06, map: sprite, color: 0x9a9ec4, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(dust);

  const SPARKS = small ? 140 : 220;
  const sparkDir = [];
  for (let i = 0; i < SPARKS; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    sparkDir.push({ v, speed: 0.6 + Math.random() * 0.9, phase: Math.random() * Math.PI * 2, orbit: 0.7 + Math.random() * 0.6 });
  }
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    size: 0.09, map: sprite, color: 0xd98bea, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  root.add(sparks);

  // ---------- post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.35, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- camera path ----------
  const camPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.2, 1.2, 15.5),
    new THREE.Vector3(0.2, 1.3, 14.6),
    new THREE.Vector3(-1.6, 1.6, 14),
  ]);

  // ---------- state ----------
  const state = {
    progress: reducedMotion ? 1 : 0, // target story progress
    intro: reducedMotion ? 1 : 0,    // 0..1 entrance, tweened from outside
    mouseX: 0, mouseY: 0,
  };
  let p = state.progress;
  let mx = 0, my = 0;
  let active = true;
  let distScale = 1;
  let yShift = 0;

  // ---------- interaction ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(9, 9);
  let pointerMoved = false;
  let hovered = null;
  let hoverKind = '';
  let impulse = 0;
  const drag = { on: false, x: 0, y: 0, rotY: 0, rotX: 0, vY: 0, vX: 0, moved: 0 };

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pointerMoved = true;
  }
  canvas.addEventListener('pointermove', (e) => {
    setNdc(e);
    if (!drag.on) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.vY = dx * 0.006; drag.vX = dy * 0.003;
    drag.rotY += drag.vY; drag.rotX += drag.vX;
  });
  let tap = null; // on touch screens a tap pulses a link; dragging keeps scrolling the page
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { tap = { x: e.clientX, y: e.clientY }; return; }
    setNdc(e);
    drag.on = true; drag.moved = 0; drag.x = e.clientX; drag.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
  });
  const endDrag = () => {
    if (!drag.on) return;
    drag.on = false;
    canvas.classList.remove('is-dragging');
    if (drag.moved < 6) { // a click, not a drag
      if (hovered === keyLink) impulse = 1;
      else if (hovered) hovered.userData.kick = 1;
    }
  };
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return endDrag();
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
      setNdc(e);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(pickables.filter((m) => m.visible), false)[0];
      if (hit) { if (hit.object === keyLink) impulse = 1; else hit.object.userData.kick = 1; }
      ndc.set(9, 9);
    }
    tap = null;
  });
  canvas.addEventListener('pointercancel', () => { tap = null; endDrag(); });
  canvas.addEventListener('pointerleave', () => { ndc.set(9, 9); pointerMoved = true; });

  function setHover(mesh) {
    if (mesh === hovered) return;
    hovered = mesh;
    const kind = !mesh ? '' : mesh === keyLink ? 'key' : 'link';
    if (kind !== hoverKind) {
      hoverKind = kind;
      canvas.dispatchEvent(new CustomEvent('chainhover', { detail: kind }));
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    distScale = camera.aspect < 1 ? Math.min(1.75, 0.78 / camera.aspect) : 1;
    // look below the chain so it sits in the upper part of the frame, clear of the headline
    yShift = camera.aspect < 0.75 ? -3.4 : camera.aspect < 1.2 ? -2.6 : -2.2;
    // phones: the finished chain sits lower, between the answer headline and the offer below it

    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const clock = new THREE.Clock();
  const pickables = [...links, keyLink];

  function update() {
    const time = clock.getElapsedTime();
    p += (state.progress - p) * (reducedMotion ? 1 : 0.09);
    mx += (state.mouseX - mx) * 0.05;
    my += (state.mouseY - my) * 0.05;
    const intro = state.intro;

    const introOff = (1 - easeOutCubic(intro)) * 15;
    const gapExtra = (1 - smooth(0.0, 0.36, p)) * 1.35;
    const lock = smooth(0.74, 0.8, p);
    const pulse = bump(0.75, 0.86, p);
    impulse *= 0.94;
    const tension = pulse * 0.16 + impulse * 0.12;
    left.position.x = -(gapExtra + introOff + tension);
    right.position.x = gapExtra + introOff + tension;

    const slack = (1 - smooth(0.72, 0.88, p)) * 0.07 + (1 - intro) * 0.25;
    left.rotation.z = slack;
    right.rotation.z = -slack;
    left.position.y = right.position.y = -slack * 0.6;

    // hover picking, only when the pointer moved
    if (pointerMoved && !drag.on) {
      pointerMoved = false;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(pickables.filter((m) => m.visible), false)[0];
      setHover(hit ? hit.object : null);
    }

    for (const m of links) {
      const u = m.userData;
      u.hover += ((hovered === m ? 1 : 0) - u.hover) * 0.15;
      u.kick *= 0.95;
      const sway = reducedMotion ? 0 : Math.sin(time * 1.1 + u.i * 0.7 + u.side) * 0.05 * (0.3 + slack * 8);
      m.rotation.x = u.baseRotX + sway + Math.sin(time * 18) * u.kick * 0.25;
      m.rotation.y = u.side * (1 - intro) * 0.6;
      m.material.emissiveIntensity = u.hover * 0.35 + u.kick * 0.6;
      m.scale.setScalar(1 + u.hover * 0.07);
    }

    const f = easeInOutCubic(smooth(0.46, 0.76, p));
    keyLink.visible = f > 0.001;
    keyLink.userData.hover += ((hovered === keyLink ? 1 : 0) - keyLink.userData.hover) * 0.15;
    keyLink.position.set(
      lerp(3.2, 0, f) + Math.sin(f * Math.PI) * 1.4,
      lerp(4.6, 0, easeOutCubic(f)) + left.position.y,
      lerp(5.5, 0, f)
    );
    keyLink.rotation.set((1 - f) * Math.PI * 3, (1 - f) * Math.PI * 2.2, (1 - f) * 1.3);
    keyLink.scale.setScalar(Math.min(1, 0.2 + f * 4) * (1 + pulse * 0.06 + impulse * 0.1 + keyLink.userData.hover * 0.05));
    keyMat.emissiveIntensity = 0.45 + pulse * 1.5 + lock * 0.3 + impulse * 1.6 + keyLink.userData.hover * 0.4;

    const ghostOn = smooth(0.12, 0.28, p) * (1 - smooth(0.62, 0.74, p));
    ghostMat.opacity = ghostOn * (0.55 + 0.45 * Math.sin(time * 3.2));
    ghost.position.y = left.position.y;
    ghost.scale.setScalar(1 + Math.sin(time * 3.2) * 0.02);

    gapLight.intensity = ghostOn * 6 + pulse * 14 + lock * 4 + impulse * 12;
    gapLight.position.y = left.position.y;
    bloom.strength = 0.32 + pulse * 0.55 + ghostOn * 0.2 + impulse * 0.5;

    const gather = smooth(0.15, 0.55, p);
    const burst = smooth(0.76, 0.98, p);
    sparkMat.opacity = smooth(0.12, 0.26, p) * (1 - smooth(0.84, 0.98, p)) * 0.95;
    for (let k = 0; k < SPARKS; k++) {
      const s = sparkDir[k];
      const r = lerp(7, s.orbit, gather) + burst * 7 * s.speed;
      const a = time * s.speed * 0.8 + s.phase;
      tmp.copy(s.v).multiplyScalar(r);
      tmp.x += Math.cos(a) * 0.15;
      tmp.y += Math.sin(a) * 0.15 + left.position.y;
      sparkPos[k * 3] = tmp.x;
      sparkPos[k * 3 + 1] = tmp.y;
      sparkPos[k * 3 + 2] = tmp.z;
    }
    sparkGeo.attributes.position.needsUpdate = true;

    dust.rotation.y = time * 0.01;
    dust.position.y = Math.sin(time * 0.2) * 0.2;

    // drag with inertia, springs back to rest
    if (!drag.on) {
      drag.rotY += drag.vY; drag.rotX += drag.vX;
      drag.vY *= 0.9; drag.vX *= 0.9;
      drag.rotY *= 0.965; drag.rotX *= 0.94;
    }
    drag.rotX = Math.max(-0.5, Math.min(0.5, drag.rotX));
    root.rotation.y = (reducedMotion ? 0 : Math.sin(time * 0.3) * 0.04) + drag.rotY;
    root.rotation.x = drag.rotX;
    if (!reducedMotion) root.position.y = Math.sin(time * 0.8) * 0.05;

    camPath.getPointAt(clamp01(p), tmp);
    camera.position.set(tmp.x + mx * 0.6, tmp.y + my * 0.4, tmp.z).multiplyScalar(distScale);
    look.set(0, yShift, 0);
    camera.lookAt(look);

    composer.render();
  }

  function loop() {
    if (active) update();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    state,
    setActive(v) { active = v; },
    resize,
  };
}
