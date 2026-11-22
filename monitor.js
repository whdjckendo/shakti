import * as THREE from 'three';

/* ------------------------------------------------------------------
   The desk monitor plays media/monitor.mp4.

   - Until the visitor clicks the monitor, only the first 2 s loop.
   - Clicking it zooms the camera onto the screen and lets the video run.
   - Once the four buttons are on screen (from ~22 s) they're clickable:
       my work      -> back out, looking at the poster wall
       my heart     -> a "Key" password bar
       contact      -> a contact card (image)
       explore room -> back out to the desk view
   - The picture gets a screen look: scanlines, a slight curve, RGB
     fringing, flicker and a vignette.
------------------------------------------------------------------- */

const INTRO_LOOP = 2.0;        // seconds that loop before the click
const BUTTONS_FROM = 22.0;     // buttons are fully drawn by now
const VIDEO_ASPECT = 16 / 9;
// centres in the 1920 x 1080 video, hit radius in video pixels
const BUTTONS = [
  { id: 'work', x: 385, y: 468, r: 135 },
  { id: 'heart', x: 770, y: 615, r: 135 },
  { id: 'contact', x: 1140, y: 495, r: 135 },
  { id: 'explore', x: 1537, y: 518, r: 145 },
];
const KEY_PASSWORD = null;     // set the 'my heart' password here
const CAM_DUR = 1.1;
const camDur = () => (document.documentElement.classList.contains('reduce-motion') ? 0.05 : CAM_DUR);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function initMonitor(opts) {
  const { scene, camera, screenMesh, bloomPass, posterTarget, onExit } = opts;

  // ---- screen rectangle (flat, facing the chair) ----
  screenMesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(screenMesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const W = size.z, H = size.y;                       // screen faces +X
  const normal = new THREE.Vector3(1, 0, 0);

  // ---- video ----
  const video = document.createElement('video');
  video.src = './media/monitor.mp4';
  video.muted = true; video.playsInline = true; video.loop = false;
  video.preload = 'auto'; video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', '');
  const kick = () => video.play().catch(() => {});
  kick();
  addEventListener('pointerdown', kick, { once: true });
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  let started = false;

  // ---- screen material ----
  const mat = new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      uTex: { value: tex },
      uTime: { value: 0 },
      uCrop: { value: (W / H) / VIDEO_ASPECT },     // cover-fit: trim the sides a touch
      uHover: { value: new THREE.Vector3(0, 0, 0) },  // video-uv x, y, strength
      uBright: { value: 0.82 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; uniform float uTime; uniform float uCrop; uniform vec3 uHover; uniform float uBright;
      varying vec2 vUv;
      vec2 curve(vec2 uv) {             // gentle barrel bulge
        uv = uv * 2.0 - 1.0;
        vec2 off = abs(uv.yx) / vec2(9.0, 7.0);
        uv = uv + uv * off * off;
        return uv * 0.5 + 0.5;
      }
      void main() {
        vec2 uv = curve(vUv);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        vec2 tuv = vec2(0.5 + (uv.x - 0.5) * uCrop, uv.y);
        float ca = 0.0012;
        vec3 col;
        col.r = texture2D(uTex, tuv + vec2(ca, 0.0)).r;
        col.g = texture2D(uTex, tuv).g;
        col.b = texture2D(uTex, tuv - vec2(ca, 0.0)).b;
        // scanlines + fine aperture grille
        float scan = 0.88 + 0.12 * sin(uv.y * 900.0);
        float grille = 0.94 + 0.06 * sin(uv.x * 1600.0);
        col *= scan * grille;
        // rolling bar + flicker
        col *= 0.97 + 0.03 * sin(uv.y * 6.0 - uTime * 1.6);
        col *= 0.985 + 0.015 * sin(uTime * 53.0);
        // hover glow around a button
        if (uHover.z > 0.0) {
          vec2 d = (tuv - uHover.xy) * vec2(16.0 / 9.0, 1.0);
          float g = smoothstep(0.11, 0.0, length(d)) * uHover.z;
          col += vec3(0.25, 0.35, 0.9) * g * 0.35;
        }
        // vignette + slight blue cast of a backlit panel
        vec2 v = vUv * (1.0 - vUv);
        // max(): at the very edge v can dip a hair below 0, and pow() of a
        // negative is NaN, which the bloom pass smears into big black blocks
        col *= pow(max(v.x * v.y * 16.0, 0.0), 0.18);
        col = col * vec3(0.96, 0.98, 1.04) * uBright + vec3(0.006, 0.008, 0.014);
        gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
      }`,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  plane.rotation.y = Math.PI / 2;                     // face +X, local +x -> world -Z
  plane.position.copy(center).addScaledVector(normal, 0.0008);
  scene.add(plane);

  // world point on the screen -> video uv (0..1, y up)
  const toVideoUv = (p) => {
    const u = (center.z - p.z) / W + 0.5;               // screen right = world -Z
    const v = (p.y - center.y) / H + 0.5;
    // undo the cover crop
    return new THREE.Vector2(0.5 + (u - 0.5) * mat.uniforms.uCrop.value, v);
  };
  // Other screens (e.g. the music menu) can take over the monitor:
  // content = { texture, hit(px, py) -> id|null, hover(id), click(id) } in 1920x1080 px.
  let content = null;
  const buttonAt = (vuv) => {
    if (vuv && content) return content.hit(vuv.x * 1920, (1 - vuv.y) * 1080);
    if (!vuv || video.currentTime < BUTTONS_FROM) return null;
    const px = vuv.x * 1920, py = (1 - vuv.y) * 1080;
    return BUTTONS.find((b) => Math.hypot(px - b.x, py - b.y) < b.r) || null;
  };

  // ---- UI ----
  const ui = document.createElement('div');
  ui.id = 'monitor-ui';
  ui.innerHTML = `
    <button class="mx" aria-label="Back to the room">&times;</button>
    <div class="mcard key" role="dialog" aria-label="Key">
      <button class="cx" aria-label="Close">&times;</button>
      <label for="key-input">Key</label>
      <form><input id="key-input" type="password" autocomplete="off" placeholder="enter the key">
      <button type="submit">Enter</button></form>
      <p class="msg"></p>
    </div>
    <div class="mcard contact" role="dialog" aria-label="Contact">
      <button class="cx" aria-label="Close">&times;</button>
      <div class="cimg">
        <img src="./media/contact.jpg" alt="whdjckendo@gmail.com, link to my resume">
        <a class="hot-mail" href="mailto:whdjckendo@gmail.com" aria-label="Email whdjckendo@gmail.com"></a>
        <a class="hot-resume" href="./media/resume.pdf" target="_blank" rel="noopener" aria-label="Open my resume"></a>
      </div>
      <p class="soon">Contact details coming soon.</p>
    </div>`;
  document.body.appendChild(ui);
  const css = document.createElement('style');
  css.textContent = `
  #monitor-ui{position:fixed;inset:0;z-index:25;display:none}
  #monitor-ui.show{display:block}
  #monitor-ui.hot{cursor:pointer}
  #monitor-ui .mx{position:absolute;top:18px;right:18px;width:44px;height:44px;border:0;border-radius:50%;
    background:rgba(22,14,10,.45);color:#f6e6cc;font:300 24px/44px var(--ui-font);cursor:pointer;
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  #monitor-ui .mcard{position:absolute;left:50%;top:50%;transform:translate(-50%,-46%);opacity:0;pointer-events:none;
    width:min(420px,88vw);padding:26px 24px 22px;border-radius:20px;background:rgba(22,14,10,.78);
    border:1px solid rgba(255,214,176,.28);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
    color:#f6e6cc;font:300 14px/1.5 var(--ui-font);box-shadow:0 18px 50px rgba(0,0,0,.4);
    transition:opacity .3s ease,transform .35s cubic-bezier(.2,.8,.2,1)}
  #monitor-ui .mcard.open{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}
  #monitor-ui .mcard .cx{position:absolute;top:10px;right:10px;width:30px;height:30px;border:0;border-radius:50%;
    background:rgba(255,255,255,.08);color:#f6e6cc;font-size:18px;line-height:30px;cursor:pointer}
  #monitor-ui .key label{display:block;margin-bottom:12px;font:600 11px/1 var(--ui-font);letter-spacing:.16em;text-transform:uppercase;color:#ffd9b0}
  #monitor-ui .key form{display:flex;gap:8px}
  #monitor-ui .key input{flex:1;min-width:0;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,214,176,.3);
    background:rgba(0,0,0,.25);color:#fff;font:400 15px/1 var(--ui-font);letter-spacing:.1em;outline:none}
  #monitor-ui .key input:focus{border-color:#ffd9b0}
  #monitor-ui .key button[type=submit]{padding:0 16px;border:0;border-radius:12px;background:#002fa7;color:#fff;
    font:400 13px/1 var(--ui-font);cursor:pointer}
  #monitor-ui .key .msg{min-height:20px;margin:10px 0 0;font-size:13px;color:#ffb4a0}
  #monitor-ui .key.shake{animation:mshake .4s}
  @keyframes mshake{20%,60%{margin-left:-8px}40%,80%{margin-left:8px}}
  #monitor-ui .contact{padding:12px;width:min(520px,90vw)}
  #monitor-ui .contact .cimg{position:relative}
  #monitor-ui .contact .cimg a{position:absolute;border-radius:10px;transition:background .2s ease,box-shadow .2s ease}
  #monitor-ui .contact .cimg a:hover,#monitor-ui .contact .cimg a:focus-visible{background:rgba(0,47,167,.08);box-shadow:0 0 0 2px rgba(0,47,167,.35)}
  #monitor-ui .contact .hot-mail{left:5%;top:36%;width:62%;height:18%}
  #monitor-ui .contact .hot-resume{left:32%;top:58%;width:57%;height:19%}
  #monitor-ui .contact img{display:block;width:100%;border-radius:12px}
  #monitor-ui .contact .soon{display:none;margin:8px 10px}`;
  document.head.appendChild(css);
  const keyCard = ui.querySelector('.key'), contactCard = ui.querySelector('.contact');
  const keyInput = ui.querySelector('#key-input'), keyMsg = ui.querySelector('.key .msg');
  const contactImg = contactCard.querySelector('img');
  contactImg.addEventListener('error', () => { contactImg.style.display = 'none'; contactCard.querySelector('.soon').style.display = 'block'; });
  // links inside the card: let them work, don't let the click fall through
  contactCard.querySelectorAll('a').forEach((l) => l.addEventListener('click', (e) => e.stopPropagation()));
  const openCard = (c) => { c.classList.add('open'); if (c === keyCard) { keyMsg.textContent = ''; keyInput.value = ''; keyInput.focus(); requestAnimationFrame(() => keyInput.focus()); setTimeout(() => keyInput.focus(), 120); } };
  const closeCards = () => { keyCard.classList.remove('open'); contactCard.classList.remove('open'); };
  const cardOpen = () => keyCard.classList.contains('open') || contactCard.classList.contains('open');
  ui.querySelectorAll('.mcard').forEach((c) => c.addEventListener('click', (e) => e.stopPropagation()));
  ui.querySelectorAll('.mcard .cx').forEach((b) => b.addEventListener('click', closeCards));
  ui.querySelector('.key form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (KEY_PASSWORD && keyInput.value === KEY_PASSWORD) { keyMsg.style.color = '#b8f0c0'; keyMsg.textContent = 'Unlocked.'; return; }
    keyMsg.style.color = ''; keyMsg.textContent = "That's not the key.";
    keyCard.classList.remove('shake'); void keyCard.offsetWidth; keyCard.classList.add('shake');
  });
  ui.querySelector('.mx').addEventListener('click', (e) => { e.stopPropagation(); close(); });

  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rc.setFromCamera(ndc, camera);
    const h = rc.intersectObject(plane, false)[0];
    return h ? toVideoUv(h.point) : null;
  };
  let hover = null;
  ui.addEventListener('pointermove', (e) => {
    if (mode !== 'on' || cardOpen()) { hover = null; ui.classList.remove('hot'); window.__clickTip && window.__clickTip(null); return; }
    const vuv = pick(e);
    const b = buttonAt(vuv);
    const tip = window.__clickTip;
    if (content) {
      content.hover(b); ui.classList.toggle('hot', b != null);
      tip && tip(b == null ? null : (b === 'stop' ? 'Click to take them off' : 'Click to play'), e.clientX, e.clientY);
      return;
    }
    hover = b;
    ui.classList.toggle('hot', !!b);
    tip && tip(b ? ({ work: 'Click to see my work', heart: 'Click to enter the key', contact: 'Click for contact',
      explore: 'Click to explore the room' })[b.id] : null, e.clientX, e.clientY);
    if (b) mat.uniforms.uHover.value.set(b.x / 1920, 1 - b.y / 1080, mat.uniforms.uHover.value.z);
  });
  ui.addEventListener('click', (e) => {
    if (mode !== 'on') return;
    if (cardOpen()) { closeCards(); return; }
    const b = buttonAt(pick(e));
    if (b == null) return;
    if (content) { content.click(b, e); return; }
    if (b.id === 'work') close(posterTarget);
    else if (b.id === 'explore') close();
    else if (b.id === 'heart') openCard(keyCard);
    else if (b.id === 'contact') openCard(contactCard);
  });
  addEventListener('keydown', (e) => {
    if (mode !== 'on' || e.code !== 'Escape') return;
    if (cardOpen()) closeCards(); else close();
  });

  // ---- camera ----
  let mode = 'off', t = 0;
  const from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const target = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const home = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const dummy = new THREE.PerspectiveCamera();   // cameras look down -Z (plain objects look +Z)
  function computeTarget() {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d = Math.max((H / 0.9) / (2 * tanV), (W / 0.9) / (2 * tanV * camera.aspect));
    target.p.copy(center).addScaledVector(normal, d);
    dummy.position.copy(target.p); dummy.up.set(0, 1, 0); dummy.lookAt(center);
    target.q.copy(dummy.quaternion);
  }
  function open(withContent) {
    if (mode !== 'off') return false;
    content = withContent || null;
    mat.uniforms.uTex.value = content ? content.texture : tex;
    mat.uniforms.uHover.value.z = 0;
    if (!content) { started = true; kick(); }
    home.p.copy(camera.position); home.q.copy(camera.quaternion);
    from.p.copy(home.p); from.q.copy(home.q);
    computeTarget();
    mode = 'in'; t = 0;
    document.body.classList.add('reading');
    return true;
  }
  function close(lookAt) {
    if (mode !== 'on') return;
    closeCards();
    ui.classList.remove('show', 'hot');
    window.__clickTip && window.__clickTip(null);
    hover = null;
    if (lookAt) {               // come back out facing this point instead
      dummy.position.copy(home.p); dummy.up.set(0, 1, 0); dummy.lookAt(lookAt);
      home.q.copy(dummy.quaternion);
    }
    from.p.copy(camera.position); from.q.copy(camera.quaternion);
    mode = 'out'; t = 0;
  }
  addEventListener('resize', () => { if (mode === 'on') { computeTarget(); camera.position.copy(target.p); } });

  // is the centre reticle on the screen? (cheap: the screen plane only)
  function aimed() {
    if (mode !== 'off') return false;
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    const h = rc.intersectObject(plane, false)[0];
    return !!(h && h.distance < 3);
  }
  // clicked straight at the screen (the centre reticle)?
  function tryOpenFromView() {
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    const h = rc.intersectObject(plane, false)[0];
    if (!h || h.distance > 3) return false;
    const hits = rc.intersectObjects(scene.children, true).filter((x) => x.object.visible && x.object.isMesh);
    if (hits[0] && hits[0].object !== plane && hits[0].object !== screenMesh && hits[0].distance < h.distance - 0.01) return false;
    return open();
  }

  const baseBloom = bloomPass ? bloomPass.strength : 0;
  function update(dt) {
    mat.uniforms.uTime.value += dt;
    // the intro loops until the monitor is clicked
    if (!started && video.currentTime >= INTRO_LOOP) video.currentTime = 0;
    const hz = mat.uniforms.uHover.value;
    hz.z += ((hover ? 1 : 0) - hz.z) * Math.min(1, dt * 10);
    if (mode === 'in' || mode === 'out') {
      t = Math.min(1, t + dt / camDur());
      const e = ease(t);
      const b = mode === 'in' ? target : home;
      camera.position.lerpVectors(from.p, b.p, e);
      camera.quaternion.copy(from.q).slerp(b.q, e);
      if (bloomPass) bloomPass.strength = mode === 'in' ? baseBloom * (1 - 0.6 * e) : baseBloom * (0.4 + 0.6 * e);
      if (t >= 1) {
        if (mode === 'in') { mode = 'on'; ui.classList.add('show'); }
        else {
          mode = 'off';
          if (content) { content.hover(null); content.closed && content.closed(); content = null; mat.uniforms.uTex.value = tex; }
          document.body.classList.remove('reading');
          camera.rotation.setFromQuaternion(home.q, 'YXZ');
          onExit && onExit();
        }
      }
    }
  }

  return {
    open, close, update, tryOpenFromView, aimed,
    get active() { return mode !== 'off'; },
    plane, video,
  };
}
