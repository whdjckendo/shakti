import * as THREE from 'three';

/* ------------------------------------------------------------------
   Readable 3D books — three closed books on the desk, read top-down,
   centre-bound like a real book.

   Per book, in  books/bookN/ :
     cover.jpg          – front cover (falls back to the book's poster art)
     1.jpg, 2.jpg, …    – each image is ONE opening: page 1|2, page 3|4, …
                          split down the middle at the binding.
   (.jpeg / .png / .webp ok; plain numbers, no zero-padding.)

   Nothing is resized or cropped — each half-page quad is built to the
   left/right half of the image.

   Flow: reticle on a book (or its poster) + click → camera drops
   straight down, spread fills the frame. Click the right half of the
   screen (or ›) turns the right page left; the left half (or ‹) turns
   the left page right. × / Esc leaves.
------------------------------------------------------------------- */

const MAX_PAGES = 120;
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];

const BOOKS = [
  { dir: 'books/book1', title: 'Portfolio',   poster: 'textures/poster-left.jpg' },
  { dir: 'books/book2', title: 'Book Two',    poster: 'textures/poster-center.jpg' },
  { dir: 'books/book3', title: 'Book Three',  poster: 'textures/poster.jpg' },
];

// poster material name (planes above the desk) -> book index.
const POSTER_MAP = { poster_left: 0, poster_center: 1, M_6: 2 };

// Closed books on the desk (world metres, off room.obj). This is the clear
// pocket between the headphone stand (front) and the laptop (back), left of
// the paper — nothing sits on them or touches them.
const DESK_Y = 0.744;
// A5 proportions (148 × 210 mm). The page's long axis runs along world X so the
// short BOTTOM edge faces the chair (+X) and the short top edge faces the
// poster wall (−X); the 148 mm width runs along Z.
const A5_W = 0.148, A5_H = 0.210;
const CLOSED = { w: A5_H, h: 0.022, d: A5_W };   // X = page height, Z = page width
// Right where the four old open books sat — that strip clears once they're
// hidden, along with the research-paper sheet.
const BOOK_SPOTS = [
  { x: 0.62, z: -0.82 },
  { x: 0.62, z: -1.04 },
  { x: 0.62, z: -1.26 },
];
// Desk meshes to hide so the books sit in clear space (matched by material
// name or SketchUp group name).
const HIDE_MAT = new Set(['Screenshot_2026_08_29_022137']);   // the research paper
const HIDE_NAME = /\bMesh3967\b/;                             // its backing quad

const PAGE_H = A5_H;                 // reading page height = the real closed-book page height, so the book never appears to grow; width follows the image
const READ_FOV = 46, TOP_FILL = 0.92;
const CAM_DUR = 1.1, FLIP_DUR = 0.62;
// Pages are lit like any other surface — the only change while reading is that
// bloom is faded out, since a bright scan through UnrealBloom washes the type
// into an unreadable glow.
const PAGE_TINT = 0xffffff;
const BLANK = 0xd9d2c4;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const texLoader = new THREE.TextureLoader();
const tryLoad = (url) => new Promise((res) => {
  texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); },
    undefined, () => res(null));
});
async function probeBook(dir, posterUrl) {
  let cover = null;
  for (const ext of EXTS) { cover = await tryLoad(`./${dir}/cover.${ext}`); if (cover) break; }
  if (!cover && posterUrl) cover = await tryLoad(`./${posterUrl}`);
  const spreads = [];
  for (let n = 1; n <= MAX_PAGES; n++) {
    let hit = null;
    for (const ext of EXTS) { hit = await tryLoad(`./${dir}/${n}.${ext}`); if (hit) break; }
    if (!hit) break;
    spreads.push(hit);
  }
  return { cover, spreads };
}
const aspectOf = (tex) => {
  const im = tex && tex.image;
  const w = im && (im.naturalWidth || im.width);
  const h = im && (im.naturalHeight || im.height);
  return w && h ? w / h : 0.72;
};

// half-page textures (left / right of a spread image), cached
const halfCache = new Map();
function halfTex(src, side) {
  if (!src) return null;
  if (side === 'full') return src;
  const key = src.uuid + side;
  if (halfCache.has(key)) return halfCache.get(key);
  const t = src.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(0.5, 1);
  t.offset.set(side === 'R' ? 0.5 : 0, 0);
  halfCache.set(key, t);
  return t;
}
const pageMat = (tex) => new THREE.MeshBasicMaterial({
  map: tex || null, color: tex ? PAGE_TINT : BLANK, side: THREE.FrontSide,
});
const setMatTex = (mesh, tex) => { mesh.material.dispose(); mesh.material = pageMat(tex); };

// A leaf hinged at x = 0 (the binding). holder always sits to the +x side;
// group.rotation.y sweeps it from the right (0) to the left (-PI).
function makeLeaf() {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pageMat(null));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pageMat(null));
  back.rotation.y = Math.PI;
  holder.add(front, back);
  group.add(holder);
  return { group, holder, front, back };
}
function leafGeom(b, pw) {
  for (const m of [b.front, b.back]) { m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(pw, PAGE_H); }
}
const halfW = (tex) => PAGE_H * aspectOf(tex) / 2;
const fullW = (tex) => PAGE_H * aspectOf(tex);

function makeClosedBook() {
  const edge = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.92, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1e16, roughness: 0.8, metalness: 0 });
  const cover = new THREE.MeshStandardMaterial({ color: 0x6b5030, roughness: 0.7, metalness: 0 });
  const mats = [edge, dark.clone(), cover, dark, edge.clone(), dark.clone()]; // +x -x +y -y +z -z
  return new THREE.Mesh(new THREE.BoxGeometry(CLOSED.w, CLOSED.h, CLOSED.d), mats);
}

export function initBooks(opts) {
  const { scene, camera, renderer, bloomPass, posterMeshes = [], notebookGroups = {}, onExit } = opts;
  const baseBloom = bloomPass ? bloomPass.strength : 0;
  // Page "up" on screen points away from the chair, so the book's bottom edge
  // is the one nearest the reader. Chair side is +X, so page-up is −X.
  const PAGE_UP = new THREE.Vector3(-1, 0, 0);

  const state = {
    mode: 'off', idx: -1, spread: 0, cover: null, spreads: [], N: 0, t: 0,
    camH: 0.5, center: new THREE.Vector3(), bloom: baseBloom,
    from: { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 },
    to:   { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: READ_FOV },
    ret:  { p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 60 },
  };
  const spreadTex = (s) => (s >= 1 && s <= state.N ? state.spreads[s - 1] : null);

  // ---- reading rig: flat, pages up, binding running chair-to-wall ----
  // −90° about X lays the pages flat; +90° about Y then turns the spread so
  // its bottom edge faces the chair. Local +X (page right) → world −Z,
  // local +Y (page up) → world −X.
  const rig = new THREE.Group();
  rig.visible = false;
  rig.rotation.order = 'YXZ';
  rig.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
  scene.add(rig);

  const leafL = makeLeaf();
  const leafR = makeLeaf();
  const flip = makeLeaf();
  rig.add(leafL.group, leafR.group, flip.group);
  flip.group.visible = false;
  let flipAnim = null;

  // ---- clear the desk: hide the old open books + the research paper ----
  for (const arr of Object.values(notebookGroups)) for (const m of arr) m.visible = false;
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (HIDE_NAME.test(o.name || '')) { o.visible = false; return; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m && HIDE_MAT.has(m.name))) o.visible = false;
  });

  const raycaster = new THREE.Raycaster();
  const centerNDC = window.__ptrNdc || (window.__ptrNdc = new THREE.Vector2(0, 0));   // the mouse pointer
  const dummy = new THREE.PerspectiveCamera();
  const proxies = [];
  const bookTargets = [];

  BOOKS.forEach((b, i) => {
    const spot = BOOK_SPOTS[i] || { x: 0.20, z: -0.85 - i * 0.17 };
    const mesh = makeClosedBook();
    mesh.position.set(spot.x, DESK_Y + CLOSED.h / 2 + 0.002, spot.z);
    mesh.userData.__bookIdx = i;
    scene.add(mesh);
    bookTargets.push(mesh);
    proxies.push({ mesh, cover: null, spreads: [] });
  });

  BOOKS.forEach((b, i) => probeBook(b.dir, b.poster).then((r) => {
    proxies[i].cover = r.cover;
    proxies[i].spreads = r.spreads;
    if (r.cover) {
      // The box's top face runs u along +X, but the book's long axis is X now,
      // so the cover needs a quarter turn to sit upright on the closed book.
      const top = r.cover.clone();
      top.needsUpdate = true;
      top.center.set(0.5, 0.5);
      top.rotation = Math.PI / 2;   // +90° (was −90°): the cover art was landing 180° out, i.e. upside down
      const m = proxies[i].mesh.material[2];
      m.map = top; m.color.set(0xffffff); m.needsUpdate = true;
    }
    if (state.mode !== 'off' && state.idx === i) {
      state.cover = r.cover; state.spreads = r.spreads; state.N = r.spreads.length;
      frameFor(i); renderSpread(state.spread);
    }
  }));

  // ---- DOM ----------------------------------------------------
  const ui = document.getElementById('book-ui');
  const cta = document.getElementById('book-cta');
  const pageLabel = document.getElementById('book-page');
  const prevBtn = document.getElementById('book-prev');
  const nextBtn = document.getElementById('book-next');
  document.getElementById('book-close')?.addEventListener('click', close);
  prevBtn?.addEventListener('click', (e) => { e.stopPropagation(); turn(-1); });
  nextBtn?.addEventListener('click', (e) => { e.stopPropagation(); turn(1); });
  addEventListener('keydown', (e) => {
    if (state.mode === 'off') return;
    if (e.code === 'Escape') close();
    else if (e.code === 'ArrowRight') turn(1);
    else if (e.code === 'ArrowLeft') turn(-1);
  });
  addEventListener('click', (e) => {
    if (state.mode !== 'read') return;
    if (e.target.closest && e.target.closest('#book-ui')) return;
    turn(e.clientX < innerWidth / 2 ? -1 : 1);
  }, true);

  // ---- spread rendering -------------------------------------
  // pos: 'left' | 'right' | 'center'. The hinge (group origin) is the binding
  // for left/right pages, and the page's own left edge for a centred cover.
  function placeLeaf(b, tex, uvSide, pos) {
    const pw = uvSide === 'full' ? fullW(tex) : halfW(tex);
    leafGeom(b, pw);
    setMatTex(b.front, uvSide === 'full' ? tex : halfTex(tex, uvSide));
    b.holder.position.x = pos === 'left' ? -pw / 2 : pw / 2;
    b.group.position.x = pos === 'center' ? -pw / 2 : 0;
    b.group.rotation.y = 0;
    b.group.visible = true;
  }
  function placeFlip(frontTex, frontSide, backTex, backSide, centered) {
    const pw = frontSide === 'full' ? fullW(frontTex) : halfW(frontTex);
    leafGeom(flip, pw);
    setMatTex(flip.front, frontSide === 'full' ? frontTex : halfTex(frontTex, frontSide));
    setMatTex(flip.back, halfTex(backTex, backSide));
    flip.holder.position.x = pw / 2;
    flip.group.position.x = centered ? -pw / 2 : 0;
    flip.group.visible = true;
  }

  function label() {
    if (!state.cover && !state.N) return 'no pages found';
    if (state.spread === 0) return 'cover';
    return `pages ${state.spread * 2 - 1}–${state.spread * 2} / ${state.N * 2}`;
  }
  function renderSpread(s) {
    flip.group.visible = false;
    flipAnim = null;
    if (s === 0) {
      leafL.group.visible = false;
      if (state.cover) placeLeaf(leafR, state.cover, 'full', 'center');
      else leafR.group.visible = false;
    } else {
      const img = spreadTex(s);
      placeLeaf(leafL, img, 'L', 'left');
      placeLeaf(leafR, img, 'R', 'right');
    }
    if (pageLabel) pageLabel.textContent = label();
    if (prevBtn) prevBtn.disabled = s <= 0;
    if (nextBtn) nextBtn.disabled = s >= state.N;
  }

  function turn(dir) {
    if (state.mode !== 'read' || flipAnim) return;
    const s = state.spread, N = state.N;
    if ((dir > 0 && s >= N) || (dir < 0 && s <= 0)) return;
    const dest = s + dir;

    if (dir > 0) {
      // right page (or cover) swings left onto the left page
      if (s === 0) placeLeaf(leafL, spreadTex(dest), 'L', 'left');
      else placeLeaf(leafL, spreadTex(s), 'L', 'left');
      placeLeaf(leafR, spreadTex(dest), 'R', 'right');
      if (s === 0) placeFlip(state.cover, 'full', spreadTex(dest), 'L', true);
      else placeFlip(spreadTex(s), 'R', spreadTex(dest), 'L');
      flip.group.rotation.y = 0;
    } else {
      // left page swings right onto the right page (dest = s-1)
      if (dest === 0) leafL.group.visible = false;
      else placeLeaf(leafL, spreadTex(dest), 'L', 'left');
      placeLeaf(leafR, spreadTex(s), 'R', 'right');
      if (dest === 0) placeFlip(state.cover, 'full', spreadTex(s), 'L', true);
      else placeFlip(spreadTex(dest), 'R', spreadTex(s), 'L');
      flip.group.rotation.y = -Math.PI;
    }
    flipAnim = { dir, t: 0 };
  }

  // ---- camera: straight down, fixed for the whole book ---------
  function frameFor(i) {
    const c = state.center;
    c.copy(proxies[i].mesh.position);
    // Open book sits on the desk where the closed one was. No backdrop — the
    // room stays fully visible around it, this is only a camera move.
    rig.position.set(c.x, DESK_Y + CLOSED.h + 0.02, c.z);

    const t = Math.tan((READ_FOV * Math.PI / 180) / 2);
    const A = camera.aspect || 1.777;
    let contentW = state.cover ? fullW(state.cover) : PAGE_H * 0.5;
    for (const img of state.spreads) contentW = Math.max(contentW, fullW(img));
    state.camH = Math.max(PAGE_H / (2 * TOP_FILL * t), contentW / (2 * TOP_FILL * t * A));

    dummy.position.set(c.x, rig.position.y + state.camH, c.z);
    dummy.up.copy(PAGE_UP);
    dummy.lookAt(c.x, rig.position.y, c.z);
    state.to.p.copy(dummy.position);
    state.to.q.copy(dummy.quaternion);
    state.to.fov = READ_FOV;
  }

  function open(i) {
    if (state.mode !== 'off' || i == null || i < 0 || !BOOKS[i]) return;
    state.idx = i;
    state.cover = proxies[i].cover;
    state.spreads = proxies[i].spreads || [];
    state.N = state.spreads.length;
    state.spread = 0;
    state.mode = 'in';
    state.t = 0;
    state.ret.p.copy(camera.position); state.ret.q.copy(camera.quaternion); state.ret.fov = camera.fov;
    state.from.p.copy(camera.position); state.from.q.copy(camera.quaternion); state.from.fov = camera.fov;
    state.bloom = bloomPass ? bloomPass.strength : 0;
    frameFor(i);
    renderSpread(0);
    rig.visible = true;
    if (ui) ui.hidden = false;
    document.body.classList.add('reading');
    cta?.classList.remove('show');
  }

  function close() {
    if (state.mode === 'off' || state.mode === 'out') return;
    state.mode = 'out';
    state.t = 0;
    state.from.p.copy(camera.position); state.from.q.copy(camera.quaternion); state.from.fov = camera.fov;
    state.bloom = bloomPass ? bloomPass.strength : 0;
    if (ui) ui.hidden = true;
    document.body.classList.remove('reading');
  }

  function pickBook() {
    raycaster.setFromCamera(centerNDC, camera);
    const h = raycaster.intersectObjects([...bookTargets, ...posterMeshes], false)[0];
    if (!h || h.distance > 7) return { i: -1, onBook: false };
    const bi = h.object.userData.__bookIdx;
    if (bi !== undefined) return { i: bi, onBook: true };
    const mat = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    const mi = POSTER_MAP[mat?.name];
    return { i: mi == null ? -1 : mi, onBook: false };
  }

  function tryOpenFromView() {
    if (state.mode !== 'off') return false;
    const { i } = pickBook();
    if (i < 0) return false;
    open(i);
    return true;
  }

  function update(dt) {
    if (state.mode === 'in' || state.mode === 'out') {
      state.t += dt / CAM_DUR;
      const e = easeInOut(Math.min(state.t, 1));
      const a = state.from;
      const b = state.mode === 'in' ? state.to : state.ret;
      camera.position.lerpVectors(a.p, b.p, e);
      camera.quaternion.copy(a.q).slerp(b.q, e);
      camera.fov = a.fov + (b.fov - a.fov) * e;
      camera.updateProjectionMatrix();
      // Bloom is what turns a bright page scan into an illegible glow, so it is
      // taken to 0 for reading — but only over the last third of the fly-in
      // (and back over the first third of the fly-out), so almost the whole
      // camera move shows the room with its normal glow, nothing else changing.
      if (bloomPass) {
        const k = state.mode === 'in'
          ? Math.min(1, Math.max(0, (e - 0.66) / 0.34))
          : Math.min(1, e / 0.34);
        const target = state.mode === 'in' ? 0 : baseBloom;
        bloomPass.strength = state.bloom + (target - state.bloom) * k;
      }
      if (state.t >= 1) {
        if (state.mode === 'in') { state.mode = 'read'; if (bloomPass) bloomPass.strength = 0; }
        else {
          state.mode = 'off';
          rig.visible = false;
          if (bloomPass) bloomPass.strength = baseBloom;
          camera.rotation.setFromQuaternion(state.ret.q, 'YXZ');
          onExit && onExit();
        }
      }
      return;
    }

    if (flipAnim) {
      flipAnim.t += dt / FLIP_DUR;
      const e = easeInOut(Math.min(flipAnim.t, 1));
      flip.group.rotation.y = flipAnim.dir > 0 ? -Math.PI * e : -Math.PI * (1 - e);
      if (flipAnim.t >= 1) { state.spread += flipAnim.dir; renderSpread(state.spread); }
      return;
    }

    if (state.mode === 'off' && cta) {
      const { i, onBook } = pickBook();
      if (onBook) { cta.textContent = `open “${BOOKS[i].title}”`; cta.classList.add('show'); }
      else cta.classList.remove('show');
    }
  }

  const api = { update, tryOpenFromView, get active() { return state.mode !== 'off'; } };
  if (typeof window !== 'undefined') window.__books = { state, rig, proxies, bookTargets, camera, open, close };
  return api;
}
