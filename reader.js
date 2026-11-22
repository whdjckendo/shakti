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

const FILL = 0.85;           // book covers 85% of the screen
const CAM_DUR = 1.1;
const FLIP_DUR = 0.8;
const SEGS = 32;             // flip leaf resolution (for the curl)
const BLANK = 0xf3efe6;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function initReader(opts) {
  const { scene, camera, renderer, bloomPass, bookObject, pagesDir, onExit } = opts;
  // surface: 'flat'  -> a flat open book replaces the model book.
  //          'model' -> pages are printed onto the model book's own curved paper
  //                     (material opts.paperMaterial), so its 3D shape stays.
  const MODEL = opts.surface === 'model';
  const baseBloom = bloomPass ? bloomPass.strength : 0;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  // ---- where the real book sits ----
  const box = new THREE.Box3().setFromObject(bookObject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  center.y = box.max.y + 0.003;
  // Spine runs along the longer-facing axis toward the reader; the room's desk
  // faces −X from the chair, so page "up" is −X and page "right" is −Z.
  // Each page keeps the PDF's proportion (A3 portrait, w/h = 0.707). The open
  // book is sized to sit inside the real book's footprint on the desk.
  const PAGE_ASPECT = 841.89 / 1190.55;
  let PAGE_H = Math.min(size.x, size.z / (2 * PAGE_ASPECT));

  // ---- model mode: collect the upward-facing paper triangles (world space) ----
  const paper = { L: [], R: [], box: new THREE.Box3() };
  if (MODEL) {
    bookObject.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const tris = [];
    bookObject.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position, idx = g.index;
      const mats = [].concat(o.material);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
      for (const gr of groups) {
        if (!mats[gr.materialIndex] || mats[gr.materialIndex].name !== opts.paperMaterial) continue;
        for (let i = gr.start; i < gr.start + gr.count; i += 3) {
          const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
          a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
          b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
          c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
          const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
          if (n.y < 0.5) continue;
          tris.push([a.clone(), b.clone(), c.clone()]);
          paper.box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
        }
      }
    });
    // The book may sit slightly turned on the desk: find its angle (the
    // tightest-fitting rectangle) and work in the book's own frame from here on.
    const pts = tris.flat();
    const c0 = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    let best = { area: Infinity, a: 0 };
    for (let deg = -45; deg <= 45; deg += 0.25) {
      const a = THREE.MathUtils.degToRad(deg), ca = Math.cos(a), sa = Math.sin(a);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) {
        const dx = p.x - c0.x, dz = p.z - c0.z;
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;     // Ry(-a)
        x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
      }
      const area = (x1 - x0) * (z1 - z0);
      if (area < best.area) best = { area, a };
    }
    paper.angle = best.a;
    paper.c0 = c0;
    const Y = new THREE.Vector3(0, 1, 0);
    paper.toLocal = (p) => p.clone().sub(c0).applyAxisAngle(Y, -best.a);
    paper.toWorld = (p) => p.clone().applyAxisAngle(Y, best.a).add(c0);
    paper.box = new THREE.Box3();
    for (const p of pts) paper.box.expandByPoint(paper.toLocal(p));
    const spineZ = (paper.box.min.z + paper.box.max.z) / 2;
    for (const t of tris) {
      const lz = (paper.toLocal(t[0]).z + paper.toLocal(t[1]).z + paper.toLocal(t[2]).z) / 3;
      (lz > spineZ ? paper.L : paper.R).push(t);
    }
    const ps = paper.box.getSize(new THREE.Vector3());
    PAGE_H = ps.x;
    center.copy(paper.toWorld(new THREE.Vector3((paper.box.min.x + paper.box.max.x) / 2, 0, spineZ)));
    center.y = c0.y + paper.box.max.y;
    paper.size = ps;
  }

  // ---- textures ----
  // pages.json lists the PDF pages; a 'spread' page is one double-page image
  // that is split down the middle across the left and right pages.
  const loader = new THREE.TextureLoader();
  const files = new Map();
  // Model mode: each image is fitted (not stretched) onto the book's spread,
  // with white space around it if the proportions differ.
  const paddedTex = (f, single, onLeft) => {
    const cv = document.createElement('canvas');
    const t = new THREE.CanvasTexture(cv);
    const spreadAspect = paper.size.z / paper.size.x;
    // fixed size up front: the GPU texture can't grow once it's been created
    const W = 2400, H = Math.round(W / spreadAspect);
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    const img = new Image();
    img.onload = () => {
      const boxW = single ? W / 2 : W, boxX = single ? (onLeft ? 0 : W / 2) : 0;
      const s = Math.min(boxW / img.width, H / img.height);
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, boxX + (boxW - w) / 2, (H - h) / 2, w, h);
      t.needsUpdate = true;
    };
    img.src = `./${pagesDir}/${f}`;
    return t;
  };
  const fileTex = (f, single, onLeft) => {
    const key = f + (MODEL && single && onLeft ? '#L' : '');
    if (!files.has(key)) {
      const t = MODEL ? paddedTex(f, single, onLeft) : loader.load(`./${pagesDir}/${f}`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      files.set(key, t);
    }
    return files.get(key);
  };
  // halves[i] = { file, side: 'full' | 'L' | 'R' } in reading order
  let halves = [];
  const halfCache = new Map();
  const load = (i) => {
    const h = halves[i];
    if (!h) return null;
    const key = h.file + h.side;
    if (halfCache.has(key)) return halfCache.get(key);
    const single = h.side === 'full';
    const onLeft = i % 2 === 0;          // even slots are left-hand pages
    let t = fileTex(h.file, single, onLeft);
    if (!single || MODEL) {
      t = t.clone();
      t.repeat.x = 0.5;
      t.offset.x = (h.side === 'R' || (single && !onLeft)) ? 0.5 : 0;
    }
    halfCache.set(key, t);
    return t;
  };
  // the whole-spread texture a half belongs to (model surfaces carry spread UVs)
  const spreadTexOf = (i) => (halves[i] ? fileTex(halves[i].file, halves[i].side === 'full', i % 2 === 0) : null);
  const mirrored = new Map();
  const mirror = (t) => {
    if (!t) return null;
    if (mirrored.has(t)) return mirrored.get(t);
    const m = t.clone();
    m.wrapS = THREE.RepeatWrapping;
    m.offset.x = t.offset.x + t.repeat.x;
    m.repeat.x = -t.repeat.x;
    m.needsUpdate = true;
    mirrored.set(t, m);
    return m;
  };
  const mat = (side) => new THREE.MeshBasicMaterial({ color: BLANK, side, toneMapped: false });
  // Pages ignore scene lights (so text stays crisp), so they're dimmed to the
  // room's level while lying on the desk and brought to full when reading.
  const IDLE_SHADE = 0.42;
  let shade = IDLE_SHADE;
  const tint = (m) => { if (m.map) m.color.setScalar(shade); else m.color.set(BLANK).multiplyScalar(shade); };
  const setTex = (m, t) => {
    if (m.map !== (t || null)) { m.map = t || null; m.needsUpdate = true; }
    tint(m);
  };
  const setShade = (k) => {
    shade = k;
    for (const m of [left, right, flipFront, flipBack, surfL, surfR]) tint(m.material);
    board.material.color.set(0x3a2a1e).multiplyScalar(k);
  };

  // ---- rig: local +X -> world −Z (page right), local +Y -> world −X (page up),
  //      local +Z -> world +Y (up off the desk) ----
  const rig = new THREE.Group();
  rig.rotation.order = 'YXZ';
  rig.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
  rig.position.copy(center);
  if (MODEL) rig.rotation.y += paper.angle;
  scene.add(rig);
  if (!MODEL) bookObject.visible = false;   // flat mode: the open book on the desk is this rig

  // model mode: two meshes hugging the real paper, UVs spanning the spread
  const surfMesh = (list) => {
    const g = new THREE.BufferGeometry();
    const pos = [], uv = [];
    const lift = 0.0004;
    for (const t of list) for (const p of t) {
      const l = paper.toLocal(p);
      pos.push(p.x, p.y + lift, p.z);
      uv.push((paper.box.max.z - l.z) / paper.size.z, (paper.box.max.x - l.x) / paper.size.x);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: BLANK, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    if (MODEL) scene.add(m);
    return m;
  };
  const surfL = surfMesh(paper.L);
  const surfR = surfMesh(paper.R);

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
  if (MODEL) rig.add(flipFront, flipBack);
  else rig.add(board, left, right, spine, flipFront, flipBack);
  // Draw the open book over anything nearby on the desk (a closed book was
  // poking over the top edge of the pages).
  const rigMeshes = MODEL ? [surfL, surfR, flipFront, flipBack] : [board, left, right, spine, flipFront, flipBack];
  rigMeshes.forEach((m, i) => { m.renderOrder = 100 + i; });
  const onTop = (on) => rigMeshes.forEach((m) => { m.material.depthTest = !on; });

  let PW = MODEL ? paper.size.z / 2 : PAGE_H * PAGE_ASPECT;
  function buildGeometry() {
    if (!MODEL) PW = PAGE_H * PAGE_ASPECT;
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
  // height of the real paper (relative to the spine top) along each page
  const profL = [], profR = [];
  if (MODEL) {
    const rc = new THREE.Raycaster();
    const tmp = [surfL, surfR];
    for (let i = 0; i <= SEGS; i++) {
      for (const [arr, sgn] of [[profR, -1], [profL, 1]]) {
        const off = new THREE.Vector3(0, 0.1, sgn * (i / SEGS) * PW * 0.999).applyAxisAngle(new THREE.Vector3(0, 1, 0), paper.angle);
        rc.set(center.clone().add(off), new THREE.Vector3(0, -1, 0));
        const h = rc.intersectObjects(tmp, false)[0];
        arr.push(h ? h.point.y - center.y : (arr.length ? arr[arr.length - 1] : 0));
      }
    }
  }
  function bendLeaf(e, dir = 1) {
    const p = flipGeo.getAttribute('position');
    if (!p) return;
    const settle = 1 - Math.pow(Math.sin(Math.PI * e), 0.5);
    const theta = Math.PI * e;
    const curl = Math.sin(Math.PI * e) * 0.9;
    const lift = Math.sin(Math.PI * e) * 0.002;
    let x = 0, z = 0.0008;
    const du = PW / SEGS;
    for (let i = 0; i <= SEGS; i++) {
      const u = i / SEGS;
      const dz = MODEL ? settle * ((1 - e) * profR[i] + e * profL[i]) : 0;
      for (let j = 0; j < 2; j++) p.setXYZ(i * 2 + j, x, (j - 0.5) * PAGE_H, z + lift * u + dz);
      let phi = theta - dir * curl * u;
      phi = Math.min(Math.PI - 0.003, Math.max(0.003, phi));
      x += Math.cos(phi) * du;
      z += Math.sin(phi) * du;
    }
    p.needsUpdate = true;
    flipGeo.computeBoundingSphere();
  }
  buildGeometry();
  setShade(IDLE_SHADE);

  // ---- spreads: halves in order; 0 = [blank | cover], s = [2s-1 | 2s] ----
  let maxSpread = 0;
  let spread = 1;
  let startSpread = 0;
  const leftOf = (s) => 2 * s;
  const rightOf = (s) => 2 * s + 1;
  function show(s) {
    setTex(left.material, load(leftOf(s)));
    setTex(right.material, load(rightOf(s)));
    setTex(surfL.material, spreadTexOf(leftOf(s)) || spreadTexOf(rightOf(s)));
    setTex(surfR.material, spreadTexOf(rightOf(s)) || spreadTexOf(leftOf(s)));
    [leftOf(s + 1), rightOf(s + 1), leftOf(s - 1), rightOf(s - 1)].forEach((n) => load(n));
    updateUi();
  }
  fetch(`./${pagesDir}/pages.json`).then((r) => r.json()).then((j) => {
    halves = [];
    // a single first page is a cover: it sits on the right with nothing opposite
    if (j.pages.length && !j.pages[0].spread) halves.push(null);
    for (const p of j.pages) {
      if (p.spread) halves.push({ file: p.file, side: 'L' }, { file: p.file, side: 'R' });
      else halves.push({ file: p.file, side: 'full' });
    }
    maxSpread = Math.ceil(halves.length / 2) - 1;
    startSpread = 0;   // always open on the first page (the cover, if there is one)
    spread = startSpread;
    show(spread);
  }).catch(() => {});

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
    counter.textContent = (halves[0] === null && spread === 0) ? 'cover'
      : `${spread + (halves[0] === null ? 0 : 1)} / ${maxSpread + (halves[0] === null ? 0 : 1)}`;
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
      setTex(surfR.material, spreadTexOf(rightOf(to)) || spreadTexOf(leftOf(to)));
    } else {
      // lifting the current left page back over to the right
      setTex(flipFront.material, load(rightOf(to)));
      setTex(flipBack.material, mirror(load(leftOf(spread))));
      setTex(left.material, load(leftOf(to)));
      setTex(surfL.material, spreadTexOf(leftOf(to)) || spreadTexOf(rightOf(to)));
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
    const bookW = MODEL ? paper.size.z * 1.08 : PW * 2 + 0.012, bookH = MODEL ? paper.size.x * 1.08 : PAGE_H + 0.012;
    const d = Math.max(bookH / (FILL * 2 * tanV), bookW / (FILL * 2 * tanV * camera.aspect));
    target.p.copy(center).add(new THREE.Vector3(0, d, 0));
    dummy.position.copy(target.p);
    dummy.up.set(-1, 0, 0);            // top of the page at the top of the screen
    if (MODEL) dummy.up.applyAxisAngle(new THREE.Vector3(0, 1, 0), paper.angle);
    dummy.lookAt(center);
    target.q.copy(dummy.quaternion);
    target.fov = fov;
  }

  function open() {
    if (mode !== 'off') return false;
    home.p.copy(camera.position); home.q.copy(camera.quaternion); home.fov = camera.fov;
    from.p.copy(home.p); from.q.copy(home.q); from.fov = home.fov;
    computeTarget();
    onTop(true);
    mode = 'in'; t = 0;
    document.body.classList.add('reading');
    return true;
  }
  function close() {
    if (mode !== 'read' || flip) return;
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
      setShade(mode === 'in' ? IDLE_SHADE + (1 - IDLE_SHADE) * e : 1 - (1 - IDLE_SHADE) * e);
      if (t >= 1) {
        if (mode === 'in') { mode = 'read'; ui.classList.add('show'); }
        else {
          mode = 'off';
          document.body.classList.remove('reading');
          onTop(false);
          spread = startSpread; show(spread);
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
