import * as THREE from 'three';

/* ------------------------------------------------------------------
   Live details for the Blender room:
   - the wall calendar shows the visitor's own date
   - the alarm clock shows the visitor's own time
   - dust motes drift in the light around the lamps
------------------------------------------------------------------- */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function canvasTexture(w, h, renderer) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;                       // glTF UV convention
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { cv, g: cv.getContext('2d'), t };
}

// ---- calendar: "Today Is" tear-off pad ----
export function liveCalendar(mesh, renderer) {
  if (!mesh) return () => {};
  const W = 792, H = 1090;               // 2x the original 396 x 545 picture
  const { g, t } = canvasTexture(W, H, renderer);
  let drawnFor = '';
  function draw(now) {
    const key = now.toDateString();
    if (key === drawnFor) return;
    drawnFor = key;
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / 864e5);
    const leap = new Date(now.getFullYear(), 1, 29).getDate() === 29;
    const left = (leap ? 366 : 365) - dayOfYear;

    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    // hanging hole
    g.fillStyle = '#fff'; g.beginPath(); g.arc(W / 2, 30, 16, 0, Math.PI * 2); g.fill();
    // header
    g.fillStyle = '#fff';
    g.font = `bold 150px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('Today Is', W / 2, 228);
    // page
    g.fillStyle = '#fbfbf9'; g.fillRect(16, 304, W - 32, H - 320);
    // rivets
    for (const x of [116, 676]) {
      const gr = g.createRadialGradient(x - 6, 366, 4, x, 372, 26);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#a9a9a9');
      g.fillStyle = gr; g.beginPath(); g.arc(x, 372, 25, 0, Math.PI * 2); g.fill();
    }
    // big day number with grey offset shadow
    const day = String(now.getDate());
    g.font = `bold ${day.length > 1 ? 400 : 440}px ${SANS}`;
    g.fillStyle = '#d4d4d4'; g.fillText(day, W / 2 + 34, 776);
    g.fillStyle = '#0d0d0d'; g.fillText(day, W / 2, 750);
    // small counters + rule
    g.font = `400 26px ${SANS}`; g.fillStyle = '#222';
    g.textAlign = 'left'; g.fillText(String(dayOfYear).padStart(3, '0'), 40, 836);
    g.textAlign = 'right'; g.fillText(String(left).padStart(3, '0'), W - 40, 836);
    g.fillRect(40, 852, W - 80, 3);
    // weekday / month / year
    g.textAlign = 'left'; g.fillStyle = '#0d0d0d';
    g.font = `bold 86px ${SANS}`;
    g.fillText(WEEKDAYS[now.getDay()], 40, 950);
    g.fillText(MONTHS[now.getMonth()], 40, 1050);
    g.textAlign = 'right'; g.font = `bold 78px ${SANS}`;
    g.fillText(String(now.getFullYear()), W - 40, 1050);
    t.needsUpdate = true;
  }
  draw(new Date());
  const mats = [].concat(mesh.material);
  for (const m of mats) { m.map = t; m.needsUpdate = true; }
  let acc = 0;
  return (dt) => { acc += dt; if (acc > 5) { acc = 0; draw(new Date()); } };
}

// ---- alarm clock face ----
export function liveClock(mesh, renderer) {
  if (!mesh) return () => {};
  const S = 1024;
  const { g, t } = canvasTexture(S, S, renderer);
  const c = S / 2, R = S * 0.47;
  // the static face (dots + numbers) drawn once
  const face = document.createElement('canvas');
  face.width = face.height = S;
  const f = face.getContext('2d');
  f.fillStyle = '#ffffff'; f.fillRect(0, 0, S, S);
  f.fillStyle = '#111';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    f.beginPath(); f.arc(c + Math.sin(a) * R, c - Math.cos(a) * R, i % 5 ? 6 : 8, 0, Math.PI * 2); f.fill();
  }
  f.font = "130px 'Times New Roman', Georgia, serif";
  f.textAlign = 'center'; f.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    f.fillText(String(h), c + Math.sin(a) * R * 0.78, c - Math.cos(a) * R * 0.78 + 8);
  }
  const hand = (angle, len, tail, width, color) => {
    g.save(); g.translate(c, c); g.rotate(angle);
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, tail); g.lineTo(0, -len); g.stroke();
    g.restore();
  };
  let last = -1;
  function draw(now) {
    const s = now.getSeconds();
    if (s === last) return;
    last = s;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    g.drawImage(face, 0, 0);
    hand((h / 12) * Math.PI * 2, R * 0.48, R * 0.06, 26, '#0b0b0b');
    hand((m / 60) * Math.PI * 2, R * 0.74, R * 0.06, 16, '#0b0b0b');
    hand((s / 60) * Math.PI * 2, R * 0.86, R * 0.22, 6, '#e3201b');
    g.fillStyle = '#e3201b'; g.beginPath(); g.arc(c, c, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d6d6d6'; g.beginPath(); g.arc(c, c, 19, 0, Math.PI * 2); g.fill();
    t.needsUpdate = true;
  }
  draw(new Date());
  for (const mt of [].concat(mesh.material)) { mt.map = t; mt.needsUpdate = true; }
  return () => draw(new Date());
}

// ---- dust motes floating in the lamp light ----
// sources: [{ pos: Vector3, radius, weight, level?: () => 0..1 }]  (max 8)
export function liveDust(scene, sources, count = 900) {
  if (!sources.length) return () => {};
  const total = sources.reduce((s, x) => s + x.weight, 0);
  const pos = new Float32Array(count * 3);
  const ctr = new Float32Array(count * 4);
  const seed = new Float32Array(count * 3);
  const srcIdx = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total, src = sources[0], si = 0;
    for (let k = 0; k < sources.length; k++) { if ((r -= sources[k].weight) <= 0) { src = sources[k]; si = k; break; } }
    srcIdx[i] = si;
    // uniform inside a sphere
    const u = Math.random(), v = Math.random(), w = Math.pow(Math.random(), 0.8);   // more motes near the source
    const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
    const d = src.radius * w;
    pos[i * 3] = src.pos.x + d * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = src.pos.y + d * Math.cos(ph);
    pos[i * 3 + 2] = src.pos.z + d * Math.sin(ph) * Math.sin(th);
    ctr.set([src.pos.x, src.pos.y, src.pos.z, src.radius], i * 4);
    seed.set([Math.random() * 100, 0.4 + Math.random() * 0.9, Math.random()], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 4));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aSrc', new THREE.BufferAttribute(srcIdx, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: innerHeight / 2 }, uOn: { value: new Array(8).fill(1) } },
    vertexShader: /* glsl */`
      attribute vec4 aCenter; attribute vec3 aSeed; attribute float aSrc;
      uniform float uTime; uniform float uScale; uniform float uOn[8];
      varying float vA;
      void main() {
        float t = uTime * 0.06 * aSeed.y + aSeed.x;
        vec3 p = position + vec3(sin(t * 1.7) * 0.05, sin(t * 1.1 + 2.0) * 0.06 - 0.02 * fract(t * 0.25), cos(t * 1.3) * 0.05);
        float d = length(p - aCenter.xyz) / aCenter.w;
        float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.z * 1.6) + aSeed.x * 7.0);
        float on = uOn[int(aSrc + 0.5)];
        vA = pow(clamp(1.0 - d, 0.0, 1.0), 1.7) * twinkle * 1.4 * on;   // denser right at the light, gone quickly
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // minuscule: about a millimetre across, never below a pixel
        gl_PointSize = max(2.0, (0.0026 + aSeed.z * 0.003) * uScale * projectionMatrix[1][1] / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.74) * a * vA * 2.5, 1.0);   // bright enough to catch the eye
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  addEventListener('resize', () => { mat.uniforms.uScale.value = innerHeight / 2; });
  return (dt) => {
    pts.visible = !document.documentElement.classList.contains('reduce-motion');
    mat.uniforms.uTime.value += dt;
    sources.forEach((s, k) => { if (k < 8) mat.uniforms.uOn.value[k] = s.level ? s.level() : 1; });
  };
}

// ---- incense (dhoop) smoke: a thin, calm stream that rises straight, then
// slowly curls and thins out. Brighter where the lamp light reaches it.
// light: () => 0..1 how lit it is right now
export function liveSmoke(scene, origin, light = () => 1, count = 260) {
  const LIFE = 7.0, HEIGHT = 0.34;
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) seed.set([i / count, Math.random(), Math.random()], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: innerHeight / 2 }, uOrigin: { value: origin.clone() },
      uLight: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute vec3 aSeed;
      uniform float uTime; uniform float uScale; uniform vec3 uOrigin;
      varying float vA;
      void main() {
        float age = fract(aSeed.x + uTime / ${LIFE.toFixed(1)});
        float h = age * ${HEIGHT.toFixed(2)};
        // laminar at the bottom, then a slow sway that widens as it rises
        float spread = 0.0015 + pow(max(age, 0.0), 1.6) * 0.055;
        float t = uTime * 0.35;
        vec3 p = uOrigin + vec3(
          sin(h * 22.0 - t * 2.0 + aSeed.y * 0.6) * spread + sin(h * 7.0 + t) * spread * 0.6,
          h,
          cos(h * 18.0 - t * 1.6 + aSeed.z * 0.6) * spread * 0.8);
        // stray wisps drift a little apart from the main stream higher up
        p.xz += (aSeed.yz - 0.5) * age * age * 0.05;
        vA = smoothstep(0.0, 0.06, age) * pow(max(1.0 - age, 0.0), 1.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, (0.006 + age * 0.03) * uScale * projectionMatrix[1][1] / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uLight;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        a *= a;
        vec3 col = mix(vec3(0.55, 0.53, 0.5), vec3(1.0, 0.9, 0.76), uLight);
        gl_FragColor = vec4(col, a * vA * (0.05 + 0.07 * uLight));
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  scene.add(pts);
  addEventListener('resize', () => { mat.uniforms.uScale.value = innerHeight / 2; });
  return (dt) => {
    pts.visible = !document.documentElement.classList.contains('reduce-motion');
    mat.uniforms.uTime.value += dt;
    mat.uniforms.uLight.value += (light() - mat.uniforms.uLight.value) * Math.min(1, dt * 3);
  };
}
