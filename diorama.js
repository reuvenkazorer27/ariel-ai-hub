/* Data diorama: a procedural 3D bar field behind a dark hero.
   Techniques adapted from the Dioramas engine (github.com/blendi-remade/dioramas, MIT):
   HDR render target -> mip bloom -> AgX tone mapping, a PMREM "studio" environment
   built from softbox panels, damped pointer input, and one signature interaction
   (bars rise toward the cursor). No models are loaded; everything is generated.

   Usage: mountDiorama(canvas, { mode:'field' | 'plan', host })
     field : a live, drifting bar field (hub home).
     plan  : 6 pillar rows x 12 month columns, growing through the plan year;
             months already passed are lit, the current month glows, future months are ghosts.
   Fails quietly: no WebGL, or the CDN is unreachable, and the hero keeps its CSS gradient. */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* Soft studio light baked into an env map: dim gradient dome + bright softboxes (from the engine's studioEnvironment). */
function studioEnvironment(renderer, top, bottom) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.4, 0.8, vP.y)), 1.); }',
    }),
  ));
  for (const p of [
    { pos: [0, 7, 5], size: [9, 3], i: 5, c: 0xffffff },
    { pos: [-8, 3, -2], size: [3, 7], i: 3, c: 0xb9bdff },
    { pos: [8, 3, -3], size: [2, 7], i: 2.4, c: 0xd8c8ff },
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(...p.size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(p.c).multiplyScalar(p.i), side: THREE.DoubleSide }));
    m.position.set(...p.pos); m.lookAt(0, 0, 0); s.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.04).texture;
  pm.dispose();
  return tex;
}

export function mountDiorama(canvas, { mode = 'field', host = canvas.parentElement, isActive = () => true } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch { return null; }
  if (!renderer.getContext()) return null;

  const css = getComputedStyle(document.documentElement);
  const tok = (n, f) => (css.getPropertyValue(n).trim() || f);
  const BG = new THREE.Color(tok('--ink-950', '#171543'));
  const ACCENT = new THREE.Color('#4F46E5');
  const VIOLET = new THREE.Color('#9F7AEA');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // tone mapping is applied by OutputPass, after bloom (HDR first, like the engine). Neutral keeps the indigo saturated
  // where AgX washed the glowing caps toward white.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  scene.background = BG;
  scene.fog = new THREE.Fog(BG, 14, 34);
  scene.environment = studioEnvironment(renderer, 0x2a2870, 0x07061a);
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  /* ---------- layout of the bars ---------- */
  const plan = mode === 'plan';
  const COLS = plan ? 12 : 26;
  const ROWS = plan ? 6 : 14;
  const GAP = plan ? 1.08 : 0.92;
  const W = 0.7;
  const N = COLS * ROWS;
  const x0 = -(COLS - 1) * GAP / 2, z0 = -(ROWS - 1) * GAP / 2;

  // plan year: Oct 2026 = month 0 ... Sep 2027 = month 11
  const now = new Date();
  const monthIdx = (now.getFullYear() - 2026) * 12 + now.getMonth() - 9;
  const monthFrac = now.getDate() / 31;

  const box = new THREE.BoxGeometry(W, 1, W);
  box.translate(0, 0.5, 0);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x2c2884, metalness: 0.45, roughness: 0.3 });
  const bars = new THREE.InstancedMesh(box, barMat, N);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bars);

  // glowing caps: HDR colours (>1) so only they feed the bloom
  const cap = new THREE.PlaneGeometry(W * 0.98, W * 0.98);
  cap.rotateX(-Math.PI / 2);
  const capMat = new THREE.MeshBasicMaterial({ toneMapped: true, transparent: true, opacity: 1 });
  const caps = new THREE.InstancedMesh(cap, capMat, N);
  caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(caps);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: BG.clone().multiplyScalar(0.55), metalness: 0.7, roughness: 0.38 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, Math.round(60 / GAP), 0x5b5bd6, 0x5b5bd6);
  grid.material.transparent = true; grid.material.opacity = 0.09; grid.position.y = 0.002;
  scene.add(grid);

  const key = new THREE.DirectionalLight(0xdfe0ff, 1.3);
  key.position.set(6, 10, 8);
  const rim = new THREE.DirectionalLight(0x9b8cff, 2.2);
  rim.position.set(-8, 4, -10);
  scene.add(key, rim, new THREE.HemisphereLight(0x8a8cff, 0x05041a, 0.35));

  /* ---------- post: HDR -> bloom -> AgX + sRGB ---------- */
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.05, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- pointer: damped hit point on the floor ---------- */
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const ptr = { x: 0, z: 0, tx: 0, tz: 0, on: 0, ton: 0, sx: 0, sy: 0, nx: 0, ny: 0 };
  host.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ptr.nx = ndc.x; ptr.ny = ndc.y;
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) { ptr.tx = hit.x; ptr.tz = hit.z; ptr.ton = 1; }
    wake();
  }, { passive: true });
  host.addEventListener('pointerleave', () => { ptr.ton = 0; ptr.nx = ptr.ny = 0; });

  /* ---------- per-bar state ---------- */
  const seed = new Float32Array(N);
  const hCur = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.sin(i * 12.9898) * 43758.5453 % 1;

  const target = (c, r, t) => {
    if (plan) {
      // each pillar grows through the year at its own pace, with a gentle breath
      const pace = 0.55 + 0.09 * r;
      const base = 0.35 + (c + 1) * 0.2 * pace + 0.18 * Math.abs(seed[r * COLS + c]);
      return base + 0.06 * Math.sin(t * 0.9 + c * 0.6 + r);
    }
    const x = c * 0.33, z = r * 0.41;
    const wave = 0.5 + 0.5 * Math.sin(x + t * 0.35) * Math.cos(z - t * 0.27);
    const ridge = 0.5 + 0.5 * Math.sin((x + z) * 0.55 - t * 0.22);
    return 0.15 + 2.7 * wave * Math.pow(ridge, 0.6) + 0.4 * Math.abs(seed[r * COLS + c]);
  };

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  function update(dt, t) {
    ptr.x = damp(ptr.x, ptr.tx, 6, dt);
    ptr.z = damp(ptr.z, ptr.tz, 6, dt);
    ptr.on = damp(ptr.on, ptr.ton, 3, dt);
    ptr.sx = damp(ptr.sx, ptr.nx, 2.5, dt);
    ptr.sy = damp(ptr.sy, ptr.ny, 2.5, dt);

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      // RTL: month 0 sits on the right
      const x = plan ? -(x0 + c * GAP) : x0 + c * GAP;
      const z = z0 + r * GAP;
      const d2 = (x - ptr.x) ** 2 + (z - ptr.z) ** 2;
      const lift = ptr.on * 1.7 * Math.exp(-d2 / (plan ? 2.2 : 1.6));
      let h = target(c, r, t) + lift;
      let glow, tint;
      if (plan) {
        const passed = c < monthIdx, cur = c === monthIdx;
        if (!passed && !cur) h *= 0.5;                 // ghosts of the months ahead
        if (cur) h *= 0.55 + 0.45 * monthFrac;
        glow = cur ? 9 : passed ? 2.4 : 0.45;
        tint = r / (ROWS - 1);
      } else {
        glow = 0.55 + Math.pow(clamp((h - 0.7) / 1.6), 2.4) * 9;
        tint = clamp((h - 0.4) / 2.2);
      }
      glow += lift * 6;
      hCur[i] = reduced ? h : damp(hCur[i] || h, h, 5, dt);
      const hh = Math.max(0.04, hCur[i]);

      pos.set(x, 0, z); scl.set(1, hh, 1);
      bars.setMatrixAt(i, m4.compose(pos, q, scl));
      pos.y = hh + 0.004; scl.set(1, 1, 1);
      caps.setMatrixAt(i, m4.compose(pos, q, scl));
      col.copy(ACCENT).lerp(VIOLET, tint).multiplyScalar(glow);
      caps.setColorAt(i, col);
    }
    bars.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    caps.instanceColor.needsUpdate = true;

    // slow orbit + pointer parallax
    const a = (plan ? 0.62 : 0.78) + (reduced ? 0 : Math.sin(t * 0.06) * 0.06) + ptr.sx * 0.08;
    const R = plan ? 16 : 15.5;
    camera.position.set(Math.sin(a) * R, (plan ? 7.6 : 6.4) + ptr.sy * 0.6, Math.cos(a) * R);
    camera.lookAt(0, plan ? 1.4 : 1.1, 0);
  }

  /* ---------- size: subject sits on the opposite side of the RTL text ---------- */
  function resize() {
    const w = canvas.clientWidth || host.clientWidth, h = canvas.clientHeight || host.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.6);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    const wide = w > 900;
    // shift the framing so the field fills the left side on desktop, centred behind the text on mobile
    if (wide) camera.setViewOffset(w, h, w * 0.2, -h * 0.06, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* ---------- loop: only while on screen, the tab is visible and the view is active ---------- */
  let visible = true, running = false, last = 0, t = 0, idleT = 0;
  const clock = () => performance.now() / 1000;
  function frame() {
    if (!running) return;
    const n = clock();
    const dt = Math.min(n - last, 1 / 20);
    last = n; t += dt; idleT += dt;
    update(dt, t);
    composer.render(dt);
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
    // reduced motion: settle for a moment after each interaction, then stop
    if (reduced && idleT > 1.2) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function wake() {
    idleT = 0;
    if (running || !visible || document.hidden || !isActive()) return;
    running = true; last = clock(); requestAnimationFrame(frame);
  }
  function sleep() { running = false; }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? wake() : sleep(); }, { threshold: 0 }).observe(host);
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  new ResizeObserver(() => { resize(); wake(); }).observe(host);
  resize();
  update(0, 0);
  wake();
  return { wake, sleep };
}
