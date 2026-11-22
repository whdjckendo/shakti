import * as THREE from 'three';

/* ------------------------------------------------------------------
   Open-book reader for the Blender room.

   Click the poster (or the book) -> the camera glides to a top view of the
   open book on the desk, which fills ~80% of the screen. Pages come from
   books/bookN/p1.jpg, p2.jpg, … (rendered from the PDF). Page 1 sits alone
   on the right like a real first page; then 2|3, 4|5, …

   Next: click the right half, → key, or ›.  Back: left half, ← key, or ‹.
   Leave: ×, Esc.
------------------------------------------------------------------- */

const FILL = 0.8;            // book covers 80% of the screen
const CAM_DUR = 1.1;
const FLIP_DUR = 0.8;
const SEGS = 32;             // flip leaf resolution (for the curl)
const BLANK = 0xf3efe6;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function initReader(opts) {
  const { scene, camera, renderer, bloomPass, bookObject, pagesDir, pageCount, onExit } = opts;
  const baseBloom = bloomPass ? bloomPass.strength : 0;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  // ---- where the real book sits ----
  const box = new THREE.Box3().setFromObject(bookObject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  center.y = box.max.y + 0.003;
  // Spine runs along the longer-facing axis toward the reader; the room's desk
  // faces −X from the chair, so page "up" is −X and page "right" is −Z.
  const PAGE_H = Math.min(size.x, size.z) * 1.0;

  // ---- textures ----
  const loader = new THREE.TextureLoader();
  const tex = [];
  let aspect = 0.707;
  const load = (n) => {
    if (n < 1 || n > pageCount) return null;
    if (!tex[n]) {
      tex[n] = loader.load(`./${pagesDir}/p${n}.jpg`, (t) => {
        const im = t.image;
        if (n === 1 && im.width) { aspect = im.width / im.height; buildGeometry(); }
      });
      tex[n].colorSpace = THREE.SRGBColorSpace;
      tex[n].anisotropy = aniso;
    }
    return tex[n];
  };
  const mirrored = new Map();
  const mirror = (t) => {
    if (!t) return null;
    if (mirrored.has(t)) return mirrored.get(t);
    const m = t.clone();
    m.wrapS = THREE.RepeatWrapping;
    m.repeat.x = -1; m.offset.x = 1;
    m.needsUpdate = true;
    mirrored.set(t, m);
    return m;
  };
  const mat = (side) => new THREE.MeshBasicMaterial({ color: BLANK, side, toneMapped: false });
  const setTex = (m, t) => {
    m.map = t || null;
    m.color.set(t ? 0xffffff : BLANK);
    m.needsUpdate = true;
  };

  // ---- rig: local +X -> world −Z (page right), local +Y -> world −X (page up),
  //      local +Z -> world +Y (up off the desk) ----
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  rig.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
  rig.position.copy(center);
  rig.visible = false;
  scene.add(rig);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3a2a1e, toneMapped: false }));
  board.position.z = -0.0015;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(THREE.FrontSide));
  const right = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(THREE.FrontSide));
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, toneMapped: false }));
  spine.position.z = 0.0004;
  const flipGeo = new THREE.BufferGeometry();
  const flipFront = new THREE.Mesh(flipGeo, mat(THREE.FrontSide));
  const flipBack = new THREE.Mesh(flipGeo, mat(THREE.BackSide));
  flipFront.visible = flipBack.visible = false;
  rig.add(board, left, right, spine, flipFront, flipBack);
  // Draw the open book over anything nearby on the desk (a closed book was
  // poking over the top edge of the pages).
  [board, left, right, spine, flipFront, flipBack].forEach((m, i) => {
    m.material.depthTest = false;
    m.renderOrder = 100 + i;
  });

  let PW = PAGE_H * aspect;
  function buildGeometry() {
    PW = PAGE_H * aspect;
    left.geometry.dispose(); left.geometry = new THREE.PlaneGeometry(PW, PAGE_H);
    left.position.x = -PW / 2;
    right.geometry.dispose(); right.geometry = new THREE.PlaneGeometry(PW, PAGE_H);
    right.position.x = PW / 2;
    board.geometry.dispose(); board.geometry = new THREE.PlaneGeometry(PW * 2 + 0.012, PAGE_H + 0.012);
    spine.geometry.dispose(); spine.geometry = new THREE.PlaneGeometry(0.006, PAGE_H);
    // flip leaf: (SEGS+1) x 2 grid, x from spine outward, bent every frame
    const pos = new Float32Array((SEGS + 1) * 2 * 3);
    const uv = new Float32Array((SEGS + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= SEGS; i++) {
      for (let j = 0; j < 2; j++) {
        const k = i * 2 + j;
        uv[k * 2] = i / SEGS; uv[k * 2 + 1] = j;
      }
      if (i < SEGS) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    flipGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flipGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    flipGeo.setIndex(idx);
    bendLeaf(0);
  }

  // e: 0 = lying flat on the right, 1 = flat on the left. The page lifts from
  // the spine and its free edge trails behind, so it curls as it turns.
  function bendLeaf(e, dir = 1) {
    const p = flipGeo.getAttribute('position');
    if (!p) return;
    const theta = Math.PI * e;
    const curl = Math.sin(Math.PI * e) * 0.9;
    const lift = Math.sin(Math.PI * e) * 0.002;
    let x = 0, z = 0.0008;
    const du = PW / SEGS;
    for (let i = 0; i <= SEGS; i++) {
      const u = i / SEGS;
      for (let j = 0; j < 2; j++) p.setXYZ(i * 2 + j, x, (j - 0.5) * PAGE_H, z + lift * u);
      let phi = theta - dir * curl * u;
      phi = Math.min(Math.PI - 0.003, Math.max(0.003, phi));
      x += Math.cos(phi) * du;
      z += Math.sin(phi) * du;
    }
    p.needsUpdate = true;
    flipGeo.computeBoundingSphere();
  }
  buildGeometry();

  // ---- spreads: 0 = [blank | 1], s = [2s | 2s+1] ----
  const maxSpread = Math.floor(pageCount / 2);
  let spread = 0;
  const leftOf = (s) => (s === 0 ? null : 2 * s);
  const rightOf = (s) => (2 * s + 1 <= pageCount ? 2 * s + 1 : null);
  function show(s) {
    setTex(left.material, load(leftOf(s)));
    setTex(right.material, load(rightOf(s)));
    // preload neighbours
    [leftOf(s + 1), rightOf(s + 1), leftOf(s - 1), rightOf(s - 1)].forEach((n) => n && load(n));
    updateUi();
  }

  // ---- UI overlay ----
  const ui = document.createElement('div');
  ui.id = 'reader-ui';
  ui.innerHTML = `<button class="rx" aria-label="Close">&times;</button>
    <button class="rp" aria-label="Previous page">&#8249;</button>
    <button class="rn" aria-label="Next page">&#8250;</button>
    <div class="rc"></div>`;
  document.body.appendChild(ui);
  const css = document.createElement('style');
  css.textContent = `
  #reader-ui{position:fixed;inset:0;z-index:25;display:none;cursor:pointer}
  #reader-ui.show{display:block}
  #reader-ui button{position:absolute;border:0;border-radius:50%;width:44px;height:44px;
    background:rgba(22,14,10,.45);color:#f6e6cc;font:300 28px/44px var(--ui-font,Lexend,sans-serif);
    cursor:pointer;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:.85}
  #reader-ui button:hover{opacity:1}
  #reader-ui button:disabled{opacity:.2;cursor:default}
  #reader-ui .rx{top:18px;right:18px;font-size:24px}
  #reader-ui .rp{left:18px;top:50%;transform:translateY(-50%)}
  #reader-ui .rn{right:18px;top:50%;transform:translateY(-50%)}
  #reader-ui .rc{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);
    color:#f6e6cc;font:400 12px/1 var(--ui-font,Lexend,sans-serif);letter-spacing:.08em;
    background:rgba(22,14,10,.45);padding:8px 14px;border-radius:14px}`;
  document.head.appendChild(css);
  const btnPrev = ui.querySelector('.rp');
  const btnNext = ui.querySelector('.rn');
  const counter = ui.querySelector('.rc');
  function updateUi() {
    btnPrev.disabled = spread <= 0;
    btnNext.disabled = spread >= maxSpread;
    const l = leftOf(spread), r = rightOf(spread);
    counter.textContent = `${[l, r].filter(Boolean).join('–')} / ${pageCount}`;
  }
  ui.querySelector('.rx').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  btnPrev.addEventListener('click', (e) => { e.stopPropagation(); turn(-1); });
  btnNext.addEventListener('click', (e) => { e.stopPropagation(); turn(1); });
  ui.addEventListener('click', (e) => { turn(e.clientX > innerWidth / 2 ? 1 : -1); });
  addEventListener('keydown', (e) => {
    if (mode === 'off') return;
    if (e.code === 'Escape') close();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Space') turn(1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') turn(-1);
  });

  // ---- page turn ----
  let flip = null;
  function turn(dir) {
    if (mode !== 'read' || flip) return;
    const to = spread + dir;
    if (to < 0 || to > maxSpread) return;
    if (dir > 0) {
      // lifting the current right page; underneath is the next right page
      setTex(flipFront.material, load(rightOf(spread)));
      setTex(flipBack.material, mirror(load(leftOf(to))));
      setTex(right.material, load(rightOf(to)));
    } else {
      // lifting the current left page back over to the right
      setTex(flipFront.material, load(rightOf(to)));
      setTex(flipBack.material, mirror(load(leftOf(spread))));
      setTex(left.material, load(leftOf(to)));
    }
    flipFront.visible = flipBack.visible = true;
    flip = { t: 0, dir, to };
    bendLeaf(dir > 0 ? 0 : 1, dir);
  }

  // ---- camera ----
  let mode = 'off', t = 0;
  const from = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 };
  const target = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 50 };
  const home = { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 };
  const dummy = new THREE.PerspectiveCamera();

  function computeTarget() {
    const fov = 50;
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const bookW = PW * 2 + 0.012, bookH = PAGE_H + 0.012;
    const d = Math.max(bookH / (FILL * 2 * tanV), bookW / (FILL * 2 * tanV * camera.aspect));
    target.p.copy(center).add(new THREE.Vector3(0, d, 0));
    dummy.position.copy(target.p);
    dummy.up.set(-1, 0, 0);            // top of the page at the top of the screen
    dummy.lookAt(center);
    target.q.copy(dummy.quaternion);
    target.fov = fov;
  }

  function open() {
    if (mode !== 'off') return false;
    home.p.copy(camera.position); home.q.copy(camera.quaternion); home.fov = camera.fov;
    from.p.copy(home.p); from.q.copy(home.q); from.fov = home.fov;
    computeTarget();
    spread = 0; show(0);
    rig.visible = true;
    bookObject.visible = false;
    mode = 'in'; t = 0;
    return true;
  }
  function close() {
    if (mode !== 'read') return;
    ui.classList.remove('show');
    from.p.copy(camera.position); from.q.copy(camera.quaternion); from.fov = camera.fov;
    mode = 'out'; t = 0;
  }
  addEventListener('resize', () => { if (mode === 'read') { computeTarget(); camera.position.copy(target.p); } });

  function update(dt) {
    if (mode === 'in' || mode === 'out') {
      t = Math.min(1, t + dt / CAM_DUR);
      const e = ease(t);
      const b = mode === 'in' ? target : home;
      camera.position.lerpVectors(from.p, b.p, e);
      camera.quaternion.copy(from.q).slerp(b.q, e);
      camera.fov = from.fov + (b.fov - from.fov) * e;
      camera.updateProjectionMatrix();
      if (bloomPass) bloomPass.strength = mode === 'in' ? baseBloom * (1 - e) : baseBloom * e;
      if (t >= 1) {
        if (mode === 'in') { mode = 'read'; ui.classList.add('show'); }
        else {
          mode = 'off';
          rig.visible = false;
          bookObject.visible = true;
          camera.rotation.setFromQuaternion(home.q, 'YXZ');
          onExit && onExit();
        }
      }
    }
    if (flip) {
      flip.t = Math.min(1, flip.t + dt / FLIP_DUR);
      const e = ease(flip.t);
      bendLeaf(flip.dir > 0 ? e : 1 - e, flip.dir);
      if (flip.t >= 1) {
        spread = flip.to;
        flip = null;
        flipFront.visible = flipBack.visible = false;
        show(spread);
      }
    }
  }

  return { open, update, tryOpenFromView: () => false, get active() { return mode !== 'off'; }, bookObject };
}
