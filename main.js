import * as THREE from 'three';
import { OBJLoader } from './vendor/three/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from './vendor/three/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/three/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from './vendor/three/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/jsm/postprocessing/OutputPass.js';
import { initBooks } from './books.js';
import { initReader } from './reader.js';

let bookApi = null;
const notebookMeshes = {};   // "Notebook1".. -> [Mesh], handed to initBooks

const canvas = document.getElementById('scene');
const loadingEl = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140e08);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 40);
camera.rotation.order = 'YXZ';

const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const msaaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
  type: THREE.HalfFloatType,
  samples: 8,
});
const composer = new EffectComposer(renderer, msaaTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.36, 0.85, 0.52);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

scene.add(new THREE.HemisphereLight(0xffc878, 0x2c1a0c, 0.16));
const key = new THREE.DirectionalLight(0xffe6c8, 0.055);
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffc090, 0.022);
scene.add(rim, rim.target);
const bounce = new THREE.PointLight(0xffd9a8, 0.11, 10, 1.2);
scene.add(bounce);

// Frosted lamps: several dim lights around the shade so the source is a
// volume, not a hard point. Decay < 2 keeps the falloff soft.
const frostLights = (color, intensity, distance, n) => {
  const lights = [];
  for (let i = 0; i < n; i++) {
    const L = new THREE.PointLight(color, intensity / n, distance, 1.15);
    scene.add(L);
    lights.push(L);
  }
  return lights;
};
const placeFrost = (lights, origin, radius) => {
  const n = lights.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    lights[i].position.set(
      origin.x + Math.cos(a) * radius,
      origin.y + Math.sin(i * 1.7) * radius * 0.35,
      origin.z + Math.sin(a) * radius
    );
  }
};
const floorFrost = frostLights(0xffc878, 0.62, 8.8, 6);
const floorFrostHi = frostLights(0xffe2b0, 0.32, 7.5, 4);
const deskFrost = frostLights(0xffd8a0, 0.18, 3.4, 4);

/* ---------------- Texture mapping ----------------
   The .mtl points at texture paths from the original author's machine
   ("room/*.jpg"), which don't ship with the model. Instead each SketchUp
   material name is mapped by hand onto one of the reference photos in
   /textures, with PBR values chosen per surface type. */
const T = (n) => {
  const file = TEX[n] || `${n}.jpg`;
  return `./textures/${encodeURIComponent(file)}`;
};

// Filenames in /textures, including the new scans (spaces + .jpg.jpeg).
const TEX = {
  wall: 'wall white.jpg.jpeg',
  flooring: 'flooring.jpg.jpeg',
  woodtable: 'wood table texture.png',
  woodplank: 'wooden-plank-texture.jpg.jpeg',
  greyfabric: 'grey fabric.jpg.jpeg',
  greylaptop: 'grey laptop.jpg.jpeg',
  greenmat: 'green mat.jpg.jpeg',
  blackcloth: 'black cloth.jpg.jpeg',
  keyboard: 'keyboard.jpg.jpeg',
  lightshade: 'light shade.jpg.jpeg',
  screen: 'screen texture.jpg.jpeg',
  socket: 'socket.jpg',
  tablecloth: 'table cloth.jpg.jpeg',
  headphone: 'orange metal headphone.jpg.jpeg',
  cardboard: 'cardboard texture.png',
  pencil: 'pencil.png',
  draw1: 'draw1.png',
  draw2: 'draw2.png',
  draw3: 'draw3.png',
  draw4: 'draw4.png',
  poster: 'poster.jpg',
  'poster-left': 'poster-left.jpg',
  'poster-center': 'poster-center.jpg',
  'book-politics': 'POLITICS OF DESIGN.jpg.jpeg',
  'book-talk': 'how to talk to anyone.jpg.jpeg',
  'book-positive': 'power of positive management.jpg.jpeg',
  'book-fletcher': 'fletcher architecture.jpg.jpeg',
  'paper-research': 'RESEARCH PAPER pic.png',
  'paper-ocean': 'ocean research paper pic.png',
};

const MAT = {
  // shell
  Color_D01:                    { t: 'wall',      r: [3, 3],   ro: 0.92, me: 0, tint: 0xf3e2c4, side: 'front' },
  FrontColor:                   { c: 0xd8d4cb,                 ro: 0.95, me: 0, offset: 2, side: 'front' },
  Translucent_Glass_Gray:       { c: 0x3a322c,                 ro: 0.12, me: 0.08, glass: true, opacity: 0.38 },
  _Translucent_Glass_Gray_1:   { c: 0x3a322c,                 ro: 0.12, me: 0.08, glass: true, opacity: 0.38 },
  Translucent_Glass_Corrugated:{ c: 0x3a322c,                 ro: 0.2, me: 0.05, glass: true, opacity: 0.45 },
  Concrete_Aggregate_Smoke:     { t: 'flooring',  r: [4, 4],   ro: 0.55, me: 0.02, env: 0.35 },

  // desk + wood
  _95:                          { t: 'woodtable', r: [4, 1],   ro: 0.5,  me: 0, env: 0.25 },
  b113_BS1:                     { t: 'woodtable', r: [2, 2],   ro: 0.55, me: 0 },
  M_12_s1:                      { t: 'greyfabric', r: [2, 2],  ro: 0.95, me: 0 },
  M_3D_Maple___Unfinished:      { t: 'woodtable', r: [1, 1],   ro: 0.6,  me: 0 },
  Wood_OSB:                     { t: 'woodplank', r: [1, 3],   ro: 0.7,  me: 0 },
  Groundcover_Wood_Mix:         { t: 'woodplank', r: [1, 1],   ro: 0.95, me: 0 },

  // seating / soft goods
  Color_A05:                    { t: 'greyfabric', r: [2, 2],  ro: 0.85, me: 0 },
  _White_:                      { t: 'tablecloth', r: [2, 2],  ro: 0.88, me: 0 },
  _3:                           { t: 'greyfabric', r: [1, 1],  ro: 0.9,  me: 0 },
  Color_F08:                    { t: 'greenmat',   r: [1, 1],  ro: 0.85, me: 0 },
  Suede_Green:                  { t: 'greenmat',   r: [2, 2],  ro: 0.9,  me: 0 },
  Metal_Brushed:                { t: 'blackcloth', r: [1, 1],  ro: 0.85, me: 0 },
  Metal_Brushed1:               { t: 'blackcloth', r: [1, 1],  ro: 0.85, me: 0 },

  // person
  cb73cca4_2c09_4f67_9e7b_7582f651510c_fdc44bb2_9e4bbdcc:
                                { c: 0xc49a72,                 ro: 0.75, me: 0 },

  // computer
  macbook_aluminium:            { t: 'greylaptop', r: [1, 1],  ro: 0.34, me: 0.75, env: 0.85 },
  PDM_2019_MacBook_Pro_15_In_With_TouchBar_Material_04: { t: 'greylaptop', r: [1, 1], ro: 0.35, me: 0.7, env: 0.8 },
  PDM_2019_MacBook_Pro_15_In_With_TouchBar_Material_05: { t: 'greylaptop', r: [1, 1], ro: 0.35, me: 0.7, env: 0.8 },
  PDM_2019_MacBook_Pro_15_In_With_TouchBar_Material_03: { t: 'screen',     r: [1, 1], ro: 0.18, me: 0.1, env: 0.5, emissive: 0x223044, ei: 0.035 },
  PDM_2019_MacBook_Pro_15_In_With_TouchBar_Material_01: { t: 'keyboard',   r: [1, 1], ro: 0.6,  me: 0.15 },
  Color_006:                    { t: 'keyboard',   r: [1, 1],  ro: 0.6,  me: 0.15 },
  blackmouse2:                  { t: 'blackcloth', r: [1, 1],  ro: 0.4,  me: 0.15 },

  // dark plastics / monitor body
  PLASTICO_NEGRO:               { t: 'blackcloth', r: [1, 1],  ro: 0.5,  me: 0.1 },
  M_0136_Charcoal:              { t: 'blackcloth', r: [1, 1],  ro: 0.5,  me: 0.15 },
  M_0135_DarkGray:              { t: 'blackcloth', r: [1, 1],  ro: 0.5,  me: 0.15 },
  M_0137_Black:                 { t: 'screen',     r: [1, 1],  ro: 0.15, me: 0.1, env: 0.6, emissive: 0x1a2433, ei: 0.03 },
  Color_1:                      { c: 0x3a3a3a,                 ro: 0.5,  me: 0.2 },

  // lamp / warm shades
  _Beige_1:                     { t: 'lightshade', r: [1, 1],  ro: 0.8,  me: 0 },
  _0030_OldLace_:               { t: 'lightshade', r: [1, 1],  ro: 0.8,  me: 0 },
  Steel_Brushed_Stainless:      { c: 0x9aa0a6,                 ro: 0.32, me: 0.85, env: 0.9 },

  // fairy-light bulbs and glass
  Color_M09:                    { c: 0xffe0a0,                 ro: 1, me: 0, emissive: 0xffc060, ei: 1.1 },
  _30:                          { c: 0xffe8b8,                 ro: 1, me: 0, emissive: 0xffc878, ei: 0.85 },
  _26:                          { c: 0xfff0cc,                 ro: 1, me: 0, emissive: 0xffd090, ei: 0.7 },
  _Translucent_Glass_Gray_2:    { c: 0xffe8c0,                 ro: 0.55, me: 0, emissive: 0xffd080, ei: 0.45 },
  Color_008:                    { c: 0x1c1c1c,                 ro: 0.7, me: 0.2 },
  Color_007:                    { c: 0x3a3a3a,                 ro: 0.6, me: 0.15 },
  Color_D25:                    { c: 0x322e28,                 ro: 0.75, me: 0.05 },

  // small desk gadget
  Color_000:                    { t: 'socket',     r: [1, 1],  ro: 0.6,  me: 0.1 },
  Color_002:                    { t: 'socket',     r: [1, 1],  ro: 0.6,  me: 0.1 },
  Color_E05:                    { t: 'socket',     r: [1, 1],  ro: 0.6,  me: 0.1 },
  _Metal_Seamed_1:              { c: 0x76786f,                 ro: 0.35, me: 0.8, env: 0.9 },
  M_0046_Gold:                  { c: 0x9a4d23,                 ro: 0.3,  me: 0.9, env: 1.0 },

  // Wall drawings: transparent layers sitting on the painted wall, so they
  // need their alpha kept (as JPGs the cut-out areas turned solid black).
  Picture1: { t: 'draw1', r: [1, 1], ro: 0.75, me: 0, cut: true, offset: -1 },
  Picture2: { t: 'draw2', r: [1, 1], ro: 0.75, me: 0, cut: true, offset: -2 },
  Picture3: { t: 'draw3', r: [1, 1], ro: 0.75, me: 0, cut: true, offset: -3 },
  Picture4: { t: 'draw4', r: [1, 1], ro: 0.75, me: 0, cut: true, offset: -4 },
  // Excel "portfolio textures": Paper on poster -> "Ocean research paper pic".
  Screenshot_2026_08_29_022137: { t: 'paper-ocean', r: [1, 1], ro: 0.7, me: 0, offset: -1 },
  _13:                          { t: 'book-politics', r: [1, 1], ro: 0.62, me: 0 },
  _14:                          { t: 'cardboard', r: [1, 1], ro: 0.7, me: 0 },

  // The three poster planes above the desk (SketchUp Component_1_1..3).
  // Left and centre get unique maps; M_6 remains the rightmost fallback.
  M_6:           { t: 'poster',        r: [1, 1], ro: 0.55, me: 0, offset: -1 },
  poster_left:   { t: 'poster-left',   r: [1, 1], ro: 0.55, me: 0, offset: -1 },
  poster_center: { t: 'poster-center', r: [1, 1], ro: 0.55, me: 0, offset: -1 },

  Carpet_Loop_Pattern:          { t: 'greyfabric', r: [3, 3], ro: 0.92, me: 0 },
  Guitar_top:                   { t: 'woodtable',  r: [1, 2], ro: 0.48, me: 0.04 },
  Guitar_top_veritical_1:       { t: 'woodtable',  r: [1, 2], ro: 0.48, me: 0.04 },
  Wood_Board_Cork:              { t: 'woodplank',  r: [2, 2], ro: 0.7,  me: 0 },
  Formica_Blue:                 { t: 'blackcloth', r: [1, 1], ro: 0.55, me: 0.08 },
  Speaker__Silver_:             { t: 'headphone',  r: [1, 1], ro: 0.4, me: 0.55, env: 0.4 },
  _Khaki_1:                     { t: 'pencil',     r: [1, 1], ro: 0.7, me: 0 },
  Vegetation_Blur_01:           { c: 0x5f8757,                 ro: 0.9,  me: 0 },
  Color_G18:                    { c: 0x366639,                 ro: 0.88, me: 0 },
  Color_G21:                    { c: 0x1a4a1a,                 ro: 0.88, me: 0 },
  Color_A1:                     { c: 0x991e1e,                 ro: 0.78, me: 0 },
  Formica_Laminate_Light:       { c: 0xee9d33,                 ro: 0.45, me: 0.08 },
};

// Diffuse colours from room.mtl, used when a SketchUp material has no
// hand-mapped entry above. OBJLoader is not given the .mtl, so without
// this every new material would come out white.
const mtlColors = new Map();

const texLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = {};
function getTex(name, rx, ry) {
  const cacheKey = `${name}|${rx}|${ry}`;
  if (texCache[cacheKey]) return texCache[cacheKey];
  const tex = texLoader.load(T(name));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  if (maxAniso) tex.anisotropy = maxAniso;
  texCache[cacheKey] = tex;
  return tex;
}

// OBJLoader hands back MeshPhongMaterial, which ignores roughness/metalness
// and scene.environment. Rebuild each as MeshStandardMaterial so real PBR
// shading applies.
const builtMats = new Map();
function buildMaterial(srcMat) {
  const name = srcMat.name || '';
  if (builtMats.has(name)) return builtMats.get(name);
  const spec = MAT[name];
  const std = new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    side: spec?.side === 'front' ? THREE.FrontSide : THREE.DoubleSide,
    roughness: spec?.ro ?? 0.85,
    metalness: spec?.me ?? 0.05,
    envMapIntensity: (spec?.env ?? 0.06) * 0.35,
  });
  if (spec?.t) {
    std.map = getTex(spec.t, spec.r[0], spec.r[1]);
    if (spec.tint !== undefined) std.color.set(spec.tint);
  } else if (spec?.c !== undefined) {
    std.color.set(spec.c);
  } else if (mtlColors.has(name)) {
    std.color.copy(mtlColors.get(name));
  } else if (srcMat.color) {
    std.color.copy(srcMat.color);
  }
  if (spec?.glass) {
    std.transparent = true;
    std.opacity = spec.opacity ?? 0.4;
    std.depthWrite = false;
    std.side = THREE.FrontSide;
    std.polygonOffset = true;
    std.polygonOffsetFactor = -2;
    std.polygonOffsetUnits = -2;
  }
  if (spec?.cut) {
    // Alpha is ~97% fully-on or fully-off, so a cutout beats blending: it
    // keeps correct depth writes and avoids transparency sort popping.
    std.transparent = true;
    std.alphaTest = 0.45;
    std.side = THREE.FrontSide;
  }
  if (spec?.offset) {
    // Wall art is modelled only millimetres off the plaster; a per-layer
    // offset makes the stacking order explicit instead of a depth tie.
    std.polygonOffset = true;
    std.polygonOffsetFactor = spec.offset;
    std.polygonOffsetUnits = spec.offset * 2;
  }
  if (spec?.emissive !== undefined) {
    std.emissive = new THREE.Color(spec.emissive);
    std.emissiveIntensity = spec.ei ?? 0.3;
  }
  if (spec?.lit && std.map) {
    // Wall art reads flat and dark under raking light; a touch of self-lit
    // emission keeps the artwork legible without washing the wall out.
    std.emissiveMap = std.map;
    std.emissive = new THREE.Color(0xffffff);
    std.emissiveIntensity = 0.022;
  }
  builtMats.set(name, std);
  return std;
}

/* ---------------- Player state ---------------- */
// New Blender model (models/room.glb) is the default; add ?obj to the URL for
// the old SketchUp OBJ. The GLB is ~10x metres as exported, so it scales by 0.1.
const USE_OBJ = /[?&]obj\b/.test(location.search);
const isGlb = !USE_OBJ;
const SCALE = USE_OBJ ? 0.001 : 0.1;   // OBJ is authored in millimetres
const PLAYER_RADIUS = 0.26;
const STAND_EYE = 1.52;
const CROUCH_EYE = 0.95;
const WALK = 2.6, RUN = 4.8, DAMP = 9;
// SketchUp OBJ names are space-separated tokens ("Group11" vs "Group110").
const hasToken = (name, token) =>
  new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(name || '');

function addDoorAndWindows(floorY) {
  const wood = new THREE.MeshStandardMaterial({
    map: getTex('woodplank', 1, 2), roughness: 0.68, metalness: 0.04, envMapIntensity: 0.02,
  });
  const panel = new THREE.MeshStandardMaterial({
    map: getTex('woodtable', 1, 1), roughness: 0.62, metalness: 0.03, envMapIntensity: 0.02,
  });
  const plaster = new THREE.MeshStandardMaterial({
    map: getTex('wall', 2, 2), color: 0xcfcabf, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
  });
  const night = new THREE.MeshBasicMaterial({ color: 0x0b0806, side: THREE.DoubleSide });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb08a4a, roughness: 0.28, metalness: 0.85, envMapIntensity: 0.12,
  });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    scene.add(m);
  };

  // Hole in the +Z wall: 0.90 × 2.00 m. Door closes it; plaster fills the transom.
  const zD = 0.458, cx = 0.501, w = 0.88, h = 1.98;
  add(new THREE.BoxGeometry(w, h, 0.038), wood, cx, floorY + h / 2 + 0.01, zD);
  for (const [dx, dy] of [[-0.18, 0.52], [0.18, 0.52], [-0.18, 0.02], [0.18, 0.02], [-0.18, -0.48], [0.18, -0.48]]) {
    add(new THREE.BoxGeometry(0.32, 0.36, 0.012), panel, cx + dx, floorY + h / 2 + 0.01 + dy, zD - 0.022);
  }
  add(new THREE.BoxGeometry(0.07, 2.08, 0.08), wood, 0.051, floorY + 1.04, zD);
  add(new THREE.BoxGeometry(0.07, 2.08, 0.08), wood, 0.951, floorY + 1.04, zD);
  add(new THREE.BoxGeometry(0.97, 0.07, 0.08), wood, cx, floorY + 2.04, zD);
  add(new THREE.BoxGeometry(1.05, 0.52, 0.05), plaster, cx, floorY + 2.28, zD + 0.006);
  add(new THREE.SphereGeometry(0.024, 12, 10), brass, cx + 0.35, floorY + 0.94, zD - 0.028);

  const zW = -3.145, y0 = 0.796, y1 = 1.996, yc = (y0 + y1) / 2, t = 0.036;
  for (const [x0, x1] of [[1.707, 2.107], [2.107, 2.507], [2.507, 2.907]]) {
    const xc = (x0 + x1) / 2, ww = x1 - x0;
    add(new THREE.BoxGeometry(ww + t, t, t), wood, xc, y1, zW);
    add(new THREE.BoxGeometry(ww + t, t, t), wood, xc, y0, zW);
    add(new THREE.BoxGeometry(t, y1 - y0, t), wood, x0, yc, zW);
    add(new THREE.BoxGeometry(t, y1 - y0, t), wood, x1, yc, zW);
    add(new THREE.BoxGeometry(t * 0.65, y1 - y0 - 0.05, t), wood, xc, yc, zW);
    add(new THREE.BoxGeometry(ww - 0.05, t * 0.65, t), wood, xc, yc, zW);
    add(new THREE.PlaneGeometry(ww - 0.03, y1 - y0 - 0.03), night, xc, yc, zW - 0.025);
  }
  add(new THREE.BoxGeometry(1.28, 0.08, 0.07), wood, 2.307, y1 + 0.055, zW);
  add(new THREE.BoxGeometry(1.32, 0.07, 0.09), wood, 2.307, y0 - 0.045, zW);
}

let floorY = 0;
let walkArea = null;            // THREE.Box3 (xz extents the player may occupy)
let obstacles = [];             // THREE.Box3[] already inflated by PLAYER_RADIUS
let seatedEye = 1.00;
let seatPos = new THREE.Vector3();
let liePos = null;              // set if the model contains a bed
let lieEye = 0.6;
let lieYaw = 0;
let bedBox = null;

const posterMeshes = [];
const raycaster = new THREE.Raycaster();
const ndcCenter = new THREE.Vector2(0, 0);
let posterFocus = 0;
let hoverPoster = null;

/* ---------------- Object info (hover) ----------------
   Column three of "portfolio textures.xlsx": a short note about a handful of
   objects. When the centre reticle rests on one of them, a glassmorphic card
   in the bottom-left corner shows the note. Matched by SketchUp group name or
   material name so it survives the per-object material rebuilds above. */
const infoMeshes = [];
const infoProxies = [];
const infoHitTargets = [];   // infoMeshes + infoProxies, filled after load
const INFO = [
  { mat: 'Screenshot_2026_08_29_022137', title: 'Ocean research paper',
    body: 'Research experiement conducted on car preferences of OCEAN personalities with eye tracking. Submitted to HWWE 2026 conference. The paper will be published soon!' },
  { re: /Notebook4/, title: 'Book 1', body: 'Click to flip through it.' },
  { mat: '_White_', title: 'Table cloth',
    body: 'Gives a soft touch to my arms when I place them on this for too long.' },
  { re: /(^|\s)(Pencil_1_\d|Lapices_en_bote1)(\s|$)/, title: 'Pencils & stationery',
    body: 'Having a 10B, 2B and 2H pencil are a must.' },
  { re: /(^|\s)M_JLIGHET1(\s|$)/, proxy: true, title: 'Headphone stand',
    body: 'MÖJLIGHET Headset/tablet stand by IKEA. My professor Anand Belhe taught me that good product design always has character, and this product is a testament to that.' },
  { mat: 'Concrete_Aggregate_Smoke', title: 'Flooring',
    body: 'I have vivid spatial memories of the flat I grew up in. Maybe it was the budding space designer in me. Mosaic flooring was one of it.' },
  { reAll: [/(^|\s)Group11(\s|$)/, /(^|\s)Group15(\s|$)/], title: 'Floor lamp shade',
    body: 'A 48 hr project I had done in bachelors where I made a floor lamp from scrap material for the thin niche between my bed and dressing table.' },
  { mats: ['Color_F08', 'Suede_Green'], title: 'Green cutting mat',
    body: 'Always ready to cut, stick, mould or fold.' },
  { re: /(^|\s)Tabla_Set1(\s|$)/, not: /Mesh3041/, proxy: true, title: 'Tabla',
    body: 'I have been into percussion since my school when I used to tap rhythms to benches. With my first salary, I bought myself a tabla, and have been learning since.' },
  // Guitars lean diagonally, so an axis-aligned proxy box would be a big
  // empty volume; hover-test their real meshes instead.
  { re: /Guitare_classique1/, title: 'Acoustic guitar',
    body: 'To jam with my friends. Or myself.' },
  { re: /Guitare_classique2/, title: 'Electric guitar',
    body: 'To get those blues out of my system.' },
  { re: /(^|\s)keyboard__1_1(\s|$)/, title: 'Keyboard',
    body: 'The magical sound of piano keys melts my heart. I play melodies that I want to sing to. Later on, I learnt to compose synth compositions and have been exploring since.' },
  { re: /Vase_Flowers_32/, proxy: true, title: 'Paper roses',
    body: 'When I want to turn my brain off and make something, for the pure joy of creation. Although I have learnt origami is more mathematical than I thought.' },
];
function matchInfo(child) {
  let nm = child.name || '';
  // GLB meshes don't carry their group path in the name (OBJ ones did), so
  // join the ancestors the same way.
  if (isGlb) { for (let o = child.parent; o && o.name !== 'Model' && o.parent; o = o.parent) nm += ' ' + o.name; }
  const mats = (Array.isArray(child.material) ? child.material : [child.material])
    .map((m) => m && m.name).filter(Boolean);
  for (const e of INFO) {
    if (e.not && e.not.test(nm)) continue;
    if (e.re && e.re.test(nm)) return e;
    if (e.reAll && e.reAll.every((r) => r.test(nm))) return e;
    if (e.mat && mats.includes(e.mat)) return e;
    if (e.mats && e.mats.some((x) => mats.includes(x))) return e;
  }
  return null;
}

function cacheMatLook(mat) {
  if (mat.userData.baseCol) return;
  mat.userData.baseCol = mat.color.clone();
  mat.userData.baseEm = mat.emissive ? mat.emissive.clone() : null;
  mat.userData.baseEi = mat.emissiveIntensity ?? 0;
}

function applyPosterFocus(amount, poster) {
  const dim = 1 - 0.7 * amount;
  const keep = new Set();
  if (poster) {
    const mats = Array.isArray(poster.material) ? poster.material : [poster.material];
    for (const m of mats) keep.add(m);
  }
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || !mat.color) continue;
      cacheMatLook(mat);
      if (keep.has(mat)) {
        mat.color.copy(mat.userData.baseCol);
        if (mat.emissive && mat.userData.baseEm) {
          mat.emissive.copy(mat.userData.baseEm);
          mat.emissiveIntensity = mat.userData.baseEi;
        }
        continue;
      }
      mat.color.copy(mat.userData.baseCol).multiplyScalar(dim);
      if (mat.emissive && mat.userData.baseEm) {
        mat.emissive.copy(mat.userData.baseEm).multiplyScalar(dim);
        mat.emissiveIntensity = mat.userData.baseEi * dim;
      }
    }
  });
}

// 'stand' is the only pose you can walk in; the others are places to settle.
let pose = 'sit';
let eyeHeight = seatedEye;
let ready = false;

const move = { f: false, b: false, l: false, r: false, run: false };
const velocity = new THREE.Vector3();
const clock = new THREE.Clock();

/* ---------------- Look controls ----------------
   Two modes, both live with no click required:
   • free  — pointer position maps to a bounded look direction (works instantly
             on page load, cursor stays visible)
   • lock  — click the page for pointer lock and unlimited 360° mouse-look */
// The reticle stays pinned to the centre of the screen and the pointer steers
// the view under it. The view is unlocked: a full sweep of the pointer turns
// the camera a full circle on yaw and almost straight up/down on pitch, so the
// character can look anywhere in the room, including behind the desk.
const HALF_YAW = Math.PI;                          // full 360° turn, no limit
const HALF_PITCH = THREE.MathUtils.degToRad(88);   // just shy of vertical
let baseYaw = 0;
let targetYaw = 0, targetPitch = 0;

let pointerX = window.innerWidth * 0.5;
let pointerY = window.innerHeight * 0.5;

window.addEventListener('mousemove', (e) => {
  pointerX = e.clientX;
  pointerY = e.clientY;
  const nx = e.clientX / window.innerWidth - 0.5;
  const ny = e.clientY / window.innerHeight - 0.5;
  targetYaw = baseYaw - THREE.MathUtils.clamp(nx * 2, -1, 1) * HALF_YAW;
  targetPitch = -THREE.MathUtils.clamp(ny * 2, -1, 1) * HALF_PITCH;
});

let touchId = null, touchLast = { x: 0, y: 0 };
window.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchId = t.identifier; touchLast = { x: t.clientX, y: t.clientY };
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchId) continue;
    targetYaw = THREE.MathUtils.clamp(
      targetYaw + (t.clientX - touchLast.x) * 0.005, baseYaw - HALF_YAW, baseYaw + HALF_YAW);
    targetPitch = THREE.MathUtils.clamp(
      targetPitch - (t.clientY - touchLast.y) * 0.005, -HALF_PITCH, HALF_PITCH);
    touchLast = { x: t.clientX, y: t.clientY };
  }
}, { passive: true });

const DEFAULT_FOV = 60;
let targetFov = DEFAULT_FOV;
window.addEventListener('wheel', (e) => {
  if (pdfOpen) return;
  if (bookApi && bookApi.active) return;
  targetFov = THREE.MathUtils.clamp(targetFov + e.deltaY * 0.02, 28, 78);
}, { passive: true });

const keyMap = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};
function setPose(next) {
  if (!ready) return;
  pose = next;
  velocity.set(0, 0, 0);
  if (next === 'sit') {
    camera.position.x = seatPos.x; camera.position.z = seatPos.z;
    targetYaw = baseYaw; targetPitch = 0;
  } else if (next === 'lie' && liePos) {
    camera.position.x = liePos.x; camera.position.z = liePos.z;
    targetYaw = lieYaw; targetPitch = 0.55;   // settle back looking upward
  }
  updateHud();
  showHudBriefly(4000);
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (pdfOpen) return;
  if (bookApi && bookApi.active) return;   // reading: books.js owns the keyboard
  if (keyMap[e.code]) {
    move[keyMap[e.code]] = true;
    // Any walk input gets you on your feet.
    if (pose !== 'stand' && pose !== 'crouch') setPose('stand');
  }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') move.run = true;
  if (e.code === 'KeyE') setPose('sit');
  if (e.code === 'KeyF' && liePos) setPose('lie');
  if (e.code === 'KeyC') setPose(pose === 'crouch' ? 'stand' : 'crouch');
  if (e.code === 'Space') { e.preventDefault(); setPose('stand'); }
  if (e.code === 'KeyH') toggleHud();
});
addEventListener('keyup', (e) => {
  if (keyMap[e.code]) move[keyMap[e.code]] = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') move.run = false;
});
addEventListener('blur', () => { move.f = move.b = move.l = move.r = move.run = false; });

addEventListener('click', () => {
  if (pdfOpen) return;
  if (bookApi && bookApi.active) return;
  // Blender room: the toilets poster or the open book itself opens Book 1.
  if (isGlb && bookApi && bookApi.open) {
    const onPoster = hoverPoster && posterFocus > 0.4 && hoverPoster.name === 'poster-left';
    const onBook = curInfo && curInfo.title === 'Book 1';
    if (onPoster || onBook) { posterCta?.classList.remove('show'); bookApi.open(); return; }
  }
  if (curInfo && curInfo.pdf) { openPdf(curInfo); return; }
  if (bookApi && bookApi.tryOpenFromView()) return;
  if (!hoverPoster || posterFocus < 0.4) return;
  posterCta?.classList.add('show');
});



/* ---------------- Full-screen PDF viewer ----------------
   Click a desk book -> a panel grows from the middle of the screen to fill the
   window and shows that book's PDF. Drop the files in books/pdf/book1.pdf ..
   book4.pdf. x / Esc / clicking the dark edge closes it. */
const pdfEl = document.getElementById('pdf-view');
const pdfFrame = pdfEl && pdfEl.querySelector('iframe');
const pdfTitle = pdfEl && pdfEl.querySelector('.pt');
const pdfMissing = pdfEl && pdfEl.querySelector('.pm');
const pdfLink = pdfEl && pdfEl.querySelector('.pl');
let pdfOpen = false;
async function openPdf(info) {
  if (!pdfEl || pdfOpen) return;
  pdfOpen = true;
  move.f = move.b = move.l = move.r = move.run = false;
  pdfTitle.textContent = info.title;
  pdfLink.href = info.pdf;
  pdfEl.classList.add('show');
  let ok = false;
  try { const r = await fetch(info.pdf, { method: 'HEAD' }); ok = r.ok && /pdf/i.test(r.headers.get('content-type') || ''); } catch (_) {}
  pdfMissing.style.display = ok ? 'none' : 'block';
  pdfFrame.style.display = ok ? 'block' : 'none';
  pdfLink.style.display = ok ? 'inline' : 'none';
  if (ok) pdfFrame.src = info.pdf + '#view=FitH';
}
function closePdf() {
  if (!pdfOpen) return;
  pdfOpen = false;
  pdfEl.classList.remove('show');
  setTimeout(() => { if (!pdfOpen) pdfFrame.removeAttribute('src'); }, 400);
}
if (pdfEl) {
  pdfEl.querySelector('.px').addEventListener('click', closePdf);
  pdfEl.addEventListener('click', (e) => { if (e.target === pdfEl) closePdf(); });
  addEventListener('keydown', (e) => { if (e.code === 'Escape') closePdf(); });
}

/* ---------------- Guide UI ----------------
   A key legend that shows itself on arrival and whenever the pose changes,
   then fades out so it never sits on top of the room. `H` pins/unpins it. */
const hudEl = document.getElementById('hud');
const poseEl = document.getElementById('pose');
const hintEl = document.getElementById('hint');
const posterCta = document.getElementById('poster-cta');
const objinfoEl = document.getElementById('objinfo');
const objinfoTitleEl = objinfoEl && objinfoEl.querySelector('.t');
const objinfoMsgEl = objinfoEl && objinfoEl.querySelector('.m');
let hudPinned = false;
let hudTimer = 0;

let curInfo = null;
function updateObjInfo(obj) {
  const info = (obj && obj.userData.info) || null;
  if (info === curInfo) return;
  curInfo = info;
  if (!objinfoEl) return;
  if (info) {
    objinfoTitleEl.textContent = info.title;
    objinfoMsgEl.textContent = info.body;
    objinfoEl.classList.add('show');
    hudEl && hudEl.classList.remove('show');   // don't stack in the same corner
  } else {
    objinfoEl.classList.remove('show');
  }
}

const POSE_LABEL = { stand: 'standing', crouch: 'crouching', sit: 'at the desk', lie: 'lying down' };

function updateHud() {
  if (poseEl) poseEl.textContent = POSE_LABEL[pose] || '';
  if (!hudEl) return;
  // Grey out actions that aren't available in this room / this pose.
  hudEl.querySelectorAll('[data-needs]').forEach((row) => {
    const need = row.dataset.needs;
    const ok = need === 'bed' ? !!liePos : true;
    row.style.opacity = ok ? '' : '.28';
  });
}

function showHudBriefly(ms = 9000) {
  if (!hudEl) return;
  hudEl.classList.add('show');
  clearTimeout(hudTimer);
  if (!hudPinned) hudTimer = setTimeout(() => hudEl.classList.remove('show'), ms);
}

function toggleHud() {
  hudPinned = !hudPinned;
  clearTimeout(hudTimer);
  if (hudEl) hudEl.classList.toggle('show', hudPinned);
  if (!hudPinned) showHudBriefly(2500);
}

/* ---------------- Load the room ----------------
   Fetched by hand rather than via OBJLoader.load() so the loading screen can
   report real byte progress and, crucially, repaint a "building" message
   before parsing — parsing ~80k faces blocks the main thread, so a spinner
   started after that point would never get a chance to render. */
const water = document.getElementById('water');
const ringStroke = document.getElementById('ring-stroke');
const loadText = document.getElementById('load-text');

// Fill the throbber: 0 = empty ring, 1 = solid circle.
const setProgress = (p) => {
  p = Math.max(0, Math.min(1, p));
  // The wave sits 11px below the top of the water, so start that far below
  // the circle; at p = 1 the waterline is above the rim and the circle is solid.
  if (water) water.style.transform = `translateY(${(48 + 11) * (1 - p)}px)`;
  if (ringStroke) ringStroke.style.opacity = String(1 - p);
};

// Errors / plain messages only (progress is shown by the ring).
const setStatus = (text) => {
  if (text === 'could not load the room' && loadText) loadText.className = 'err';
};

async function fetchRoomText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  // With Content-Encoding: gzip the browser streams decompressed bytes while
  // Content-Length describes the compressed payload, so prefer the real
  // uncompressed size the server advertises alongside it.
  const total = Number(
    res.headers.get('X-Uncompressed-Length') || res.headers.get('Content-Length') || 0
  );

  if (!res.body) return res.text();           // no streaming support — just wait

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    // Download is the bulk of the wait: 0 -> 85% of the ring.
    if (total) setProgress(0.85 * Math.min(1, loaded / total));
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(merged);
}

async function fetchRoomBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('Content-Length') || 0);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) setProgress(0.85 * Math.min(1, loaded / total));
  }
  const merged = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  return merged.buffer;
}

// Give the browser two frames to actually paint the latest status text before
// we hand it a long synchronous task.
const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

(async () => {
  let root;
  try {
    setProgress(0.02);
    await paint();
    if (isGlb) {
      const buf = await fetchRoomBinary('./models/room.glb');
      setProgress(0.9);
      await paint();
      const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, './models/', res, rej));
      root = gltf.scene;
    } else {
    const [text, mtlText] = await Promise.all([
      fetchRoomText('./room.obj'),
      fetch('./room.mtl').then((r) => r.ok ? r.text() : ''),
    ]);
    let curMtl = '';
    for (const raw of mtlText.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('newmtl ')) curMtl = line.slice(7).trim();
      else if (curMtl && line.startsWith('Kd ')) {
        const p = line.split(/\s+/);
        mtlColors.set(curMtl, new THREE.Color().setRGB(+p[1], +p[2], +p[3], THREE.SRGBColorSpace));
      }
    }
    setProgress(0.9);   // download done, parsing the model
    await paint();
    root = new OBJLoader().parse(text);
    }
  } catch (err) {
    console.error('Could not load room.obj — serve this folder over http (node server.js).', err);
    setStatus('could not load the room');
    return;
  }

  root.scale.setScalar(SCALE);
  root.updateMatrixWorld(true);

  // The seated figure is our body: its meshes sit under the "Group19" /
  // "Sitting_colored_man" SketchUp groups. Hide them (we're looking out
  // through this character's eyes) but keep the bounds to place the camera.
  const isBody = (n) => /Sitting_colored_man/i.test(n || '');
  const isLimb = (n) => /Group19/i.test(n || '') && !isBody(n);
  const charBox = new THREE.Box3();
  let charFound = false;
  const focusBox = new THREE.Box3();

  const floorBox = new THREE.Box3();
  const mattressBox = new THREE.Box3();
  const wallBox = new THREE.Box3();
  // The two lamps are SketchUp groups: Group11 is the floor lamp (stand +
  // shade), Group10 the desk lamp. Light is emitted from the top of each,
  // where the shade actually is — not from an arbitrary point in the room.
  const floorLampBox = new THREE.Box3();
  const deskLampBox = new THREE.Box3();
  const floorLampMeshes = [];
  const deskLampMeshes = [];
  const fairyBulbMeshes = [];
  const fairyFillBoxes = { FAIRY_LIGHT1: new THREE.Box3(), FAIRY_LIGHT2: new THREE.Box3() };
  const starBoxes = { FAIRY_LIGHT1: new THREE.Box3(), FAIRY_LIGHT2: new THREE.Box3() };
  const FAIRY_BULB_MATS = new Set(['_30', '_26', '_Translucent_Glass_Gray_2', 'Color_M09']);
  const pillowBox = new THREE.Box3();
  const chairBox = new THREE.Box3();
  const roomBox = new THREE.Box3();
  const candidates = [];
  const tmpCenter = new THREE.Vector3();

  root.traverse((child) => {
    if (!child.isMesh) return;

    // The GLB already carries its own textured materials from Blender.
    if (!isGlb) child.material = Array.isArray(child.material)
      ? child.material.map(buildMaterial)
      : buildMaterial(child.material);

    if (!isGlb && /Tabla_Set1/.test(child.name)) {
      const smallShell = /Mesh3041/.test(child.name);
      const paintTabla = (mt) => {
        const g = mt.clone();
        g.polygonOffset = false;
        g.side = THREE.DoubleSide;
        if (smallShell && mt.name === 'Color_D09') {
          g.map = null;
          g.color.set(0xf3e4c4);
          g.roughness = 0.9;
          g.metalness = 0;
        } else if (mt.name === 'FrontColor' || mt.name === 'Color_D09' || mt.name === 'Wood_Board_Cork') {
          g.map = getTex('woodtable', 1.4, 2);
          g.color.set(0xc48a48);
          g.roughness = 0.58;
          g.metalness = 0.04;
        }
        return g;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map(paintTabla) : paintTabla(child.material);
      if (smallShell && child.geometry) {
        child.geometry = child.geometry.clone();
        child.geometry.scale(-1, 1, 1);
        child.geometry.computeVertexNormals();
      }
    }
    if (isGlb) {
      // Blender exported the laptop body with a white emission, so the whole
      // MacBook glowed. Only screens should glow.
      for (const mt of [].concat(child.material)) {
        if (mt && mt.name === 'macbook_aluminium') { mt.emissive.set(0x000000); mt.emissiveMap = null; }
      }
    }
    child.castShadow = false;
    child.receiveShadow = false;

    const box = new THREE.Box3().setFromObject(child);
    box.getCenter(tmpCenter);
    // The new export leaves thousands of rose instances hundreds of metres
    // off-model. They inflate the world bounds and drag every light with them.
    if (tmpCenter.length() > 12) {
      child.visible = false;
      return;
    }

    if (isBody(child.name)) {
      // We look out through this character's eyes, so the body itself is
      // hidden — but its bounds tell us exactly where those eyes sit.
      charBox.union(box);
      charFound = true;
      child.visible = false;
      return;
    }
    if (isLimb(child.name)) {
      // Arms/hands belong to the same hidden figure; shown on their own they
      // read as a detached limb floating over the desk.
      child.visible = false;
      return;
    }

    const matName = Array.isArray(child.material)
      ? child.material[0]?.name : child.material?.name;
    if (matName === 'Concrete_Aggregate_Smoke') floorBox.union(box);
    if (matName === 'macbook_aluminium') focusBox.union(box);
    if (matName === 'Color_A05') chairBox.union(box);
    if (/Untitled1/.test(child.name) && !/Untitled_1_1/.test(child.name)) mattressBox.union(box);
    if (matName === 'Color_D01') wallBox.union(box);
    if (hasToken(child.name, 'Group11')) { floorLampBox.union(box); floorLampMeshes.push(child); }
    if (hasToken(child.name, 'M_JLIGHET1')) { deskLampBox.union(box); deskLampMeshes.push(child); }
    if (/FAIRY_LIGHT|Star_Lights/.test(child.name)) {
      if (hasToken(child.name, 'FAIRY_LIGHT1')) fairyFillBoxes.FAIRY_LIGHT1.union(box);
      if (hasToken(child.name, 'FAIRY_LIGHT2')) fairyFillBoxes.FAIRY_LIGHT2.union(box);
      if (/Star_Lights/.test(child.name)) {
        if (hasToken(child.name, 'FAIRY_LIGHT1')) starBoxes.FAIRY_LIGHT1.union(box);
        if (hasToken(child.name, 'FAIRY_LIGHT2')) starBoxes.FAIRY_LIGHT2.union(box);
      }
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      if (mats.some((m) => FAIRY_BULB_MATS.has(m?.name)) || /PointLightSource/.test(child.name)) {
        fairyBulbMeshes.push(child);
      }
    }
    if (isGlb && /^poster-(left|center)$/.test(child.name)) posterMeshes.push(child);
    if (!isGlb && /Component_1_1/.test(child.name)) child.material = buildMaterial({ name: 'poster_left' });
    if (!isGlb && /Component_1_2/.test(child.name)) child.material = buildMaterial({ name: 'poster_center' });
    if (!isGlb && (/Component_1_[123]/.test(child.name) || /Picture[1-4]/.test(child.name))) {
      posterMeshes.push(child);
    }
    if (/Pillow/i.test(child.name)) pillowBox.union(box);

    const bookKey = (child.name.match(/Notebook[1-4]/) || [])[0];
    if (bookKey && !isGlb) {
      (notebookMeshes[bookKey] = notebookMeshes[bookKey] || []).push(child);
      const covers = {
        Notebook1: 'book-politics',
        Notebook2: 'book-talk',
        Notebook3: 'book-positive',
        Notebook4: 'book-fletcher',
      };
      const paintCover = (mt) => {
        if (mt.name !== '_13' && mt.name !== '_14') return mt;
        const g = mt.clone();
        g.map = getTex(covers[bookKey], 1, 1);
        g.color.set(0xffffff);
        return g;
      };
      child.material = Array.isArray(child.material)
        ? child.material.map(paintCover) : paintCover(child.material);
    }
    if (!isGlb && /Headphones/.test(child.name)) {
      const coat = (mt) => {
        const g = mt.clone();
        g.map = getTex('headphone', 1, 1);
        g.color.set(0xffffff);
        g.metalness = 0.55;
        g.roughness = 0.4;
        g.envMapIntensity = 0.4;
        return g;
      };
      child.material = Array.isArray(child.material) ? child.material.map(coat) : coat(child.material);
    }
    if (!isGlb && /Pencil_1_/.test(child.name)) {
      const p = (mt) => {
        const g = mt.clone();
        g.map = getTex('pencil', 1, 1);
        g.color.set(0xffffff);
        return g;
      };
      child.material = Array.isArray(child.material) ? child.material.map(p) : p(child.material);
    }

    const inf = matchInfo(child);
    if (inf) {
      child.userData.info = inf;
      (inf.proxy ? (inf._m = inf._m || []) : infoMeshes).push(child);
    }

    roomBox.union(box);
    candidates.push(box);
  });

  scene.add(root);
  if (isGlb) {
    // In the Blender model the floor lamp is Group6 (shade = Group10). Without
    // this the lamp glow fell back to a corner and lit a bare patch of wall.
    const lamp = root.getObjectByName('Group6');
    if (lamp) floorLampBox.makeEmpty().setFromObject(lamp);
  }

  // Walkable area comes from the floor plane; fall back to the whole model.
  const area = floorBox.isEmpty() ? new THREE.Box3().setFromObject(root) : floorBox;
  floorY = area.min.y;
  walkArea = area.clone().expandByVector(new THREE.Vector3(-PLAYER_RADIUS, 0, -PLAYER_RADIUS));

  // Collide only against things that actually block a person: knee-height or
  // taller, and small enough in plan to be furniture rather than the shell.
  const span = new THREE.Vector3();
  obstacles = candidates.filter((b) => {
    b.getSize(span);
    return b.max.y > floorY + 0.25 && span.x < 2.5 && span.z < 2.5 && span.x * span.z > 0.02;
  }).map((b) => b.clone().expandByVector(new THREE.Vector3(PLAYER_RADIUS, 0, PLAYER_RADIUS)));

  // Camera starts at the seated eye line, facing the desk. The current
  // export no longer includes the figure, so the chair (Color_A05) is the
  // seat when the old body group is missing.
  if (charFound) {
    const c = new THREE.Vector3();
    charBox.getCenter(c);
    seatedEye = Math.max(0.6, charBox.max.y - floorY - 0.10);
    seatPos.set(c.x, floorY, c.z);
  } else if (!chairBox.isEmpty()) {
    const c = chairBox.getCenter(new THREE.Vector3());
    seatedEye = Math.max(0.95, (chairBox.max.y - floorY) + 0.36);
    seatPos.set(c.x, floorY, c.z);
  } else {
    area.getCenter(seatPos);
    seatPos.y = floorY;
  }
  if (isGlb) {
    // In the new model the desk runs along the x = 0 wall. The chair mesh
    // sits under the desk, so pull it out and face the wall/monitor.
    seatPos.set(1.0, floorY, -1.3);
    seatedEye = 1.1;
  }
  eyeHeight = seatedEye;
  camera.position.set(seatPos.x, floorY + seatedEye, seatPos.z);

  // The bed: lie with your head just off the pillow, eyes a little above the
  // mattress, facing down the length of the bed toward your feet.
  if (!mattressBox.isEmpty()) {
    bedBox = mattressBox.clone();
    const head = pillowBox.isEmpty() ? null : pillowBox.getCenter(new THREE.Vector3());
    const bedMid = mattressBox.getCenter(new THREE.Vector3());
    const x = head ? head.x : bedMid.x;
    // Feet point from the pillow toward the far end of the mattress.
    const towardFeet = head
      ? Math.sign((mattressBox.max.z + mattressBox.min.z) / 2 - head.z) || 1
      : 1;
    const z = (head ? head.z : mattressBox.min.z) + towardFeet * 0.30;
    liePos = new THREE.Vector3(x, 0, z);
    lieEye = (mattressBox.max.y - floorY) + 0.14;
    lieYaw = Math.atan2(0, -towardFeet);
  }

  // Movement is unlocked: the player may roam the whole floor plane. Furniture
  // still blocks via `obstacles`; only the room shell bounds the walk area.

  // A seated person faces their desk, so aim at the laptop rather than at
  // whichever direction happens to have the most clear floor.
  if (isGlb) {
    baseYaw = Math.PI / 2;   // facing -x, toward the desk wall
  } else if (!focusBox.isEmpty()) {
    const f = new THREE.Vector3();
    focusBox.getCenter(f);
    baseYaw = Math.atan2(-(f.x - camera.position.x), -(f.z - camera.position.z));
  } else {
    baseYaw = pickOpenFacing(camera.position);
  }
  targetYaw = baseYaw;
  camera.rotation.set(0, baseYaw, 0);

  const shell = roomBox.isEmpty() ? new THREE.Box3().setFromObject(root) : roomBox;
  const mid = new THREE.Vector3();
  shell.getCenter(mid);
  key.position.set(shell.max.x + 1.5, shell.max.y + 2.0, shell.min.z - 1.5);
  key.target.position.copy(mid);
  key.target.updateMatrixWorld();
  rim.position.set(shell.min.x - 1.5, shell.max.y + 1.0, shell.max.z + 1.5);
  rim.target.position.copy(mid);
  rim.target.updateMatrixWorld();

  // (In the Blender model the wall material is also used on the desk, which
  // dragged this cap down to desk height, so use the room's real top.)
  const capY = ((isGlb || wallBox.isEmpty()) ? shell.max.y : wallBox.max.y) - 0.005;
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(area.max.x - area.min.x, area.max.z - area.min.z),
    new THREE.MeshStandardMaterial({
      map: getTex('wall', 3, 3), color: 0xbdb8ad, roughness: 0.95, metalness: 0,
      envMapIntensity: 0.02, side: THREE.DoubleSide,
    })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((area.min.x + area.max.x) / 2, capY, (area.min.z + area.max.z) / 2);
  if (!isGlb) scene.add(ceiling);   // the Blender room has its own ceiling; this cap sat at desk height there

  if (!isGlb) addDoorAndWindows(floorY);   // old room only: the Blender model has its own door

  bounce.position.set(mid.x, floorY + 1.55, mid.z);

  if (!floorLampBox.isEmpty()) {
    const c = floorLampBox.getCenter(new THREE.Vector3());
    const toward = mid.clone().sub(c).setY(0);
    if (toward.lengthSq() > 1e-6) toward.normalize();
    else toward.set(0, 0, 1);
    const shade = new THREE.Vector3(c.x, floorLampBox.max.y - 0.04, c.z).addScaledVector(toward, 0.12);
    placeFrost(floorFrost, shade, 0.14);
    placeFrost(floorFrostHi, shade.clone().setY(shade.y + 0.08), 0.10);
  } else {
    const p = new THREE.Vector3(area.min.x + 0.6, floorY + 1.25, area.min.z + 0.6);
    placeFrost(floorFrost, p, 0.14);
    placeFrost(floorFrostHi, p.clone().setY(p.y + 0.1), 0.10);
  }
  if (!deskLampBox.isEmpty()) {
    const d = deskLampBox.getCenter(new THREE.Vector3());
    const toward = mid.clone().sub(d).setY(0);
    if (toward.lengthSq() > 1e-6) toward.normalize();
    const head = new THREE.Vector3(d.x, deskLampBox.max.y + 0.02, d.z).addScaledVector(toward, 0.06);
    placeFrost(deskFrost, head, 0.07);
  } else {
    placeFrost(deskFrost, new THREE.Vector3(seatPos.x - 0.5, floorY + 1.2, seatPos.z), 0.07);
  }
  // That 'desk lamp' is really the headphone stand; its glow made a bright
  // hotspot on the wall, so it stays dark in the new model.
  if (isGlb) for (const l of deskFrost) l.intensity = 0;

  // Fabric shade: warm, self-lit, paper-lantern. Clone so the shared
  // FrontColor used on walls never picks up the glow.
  const fabricShade = (mt) => {
    const g = mt.clone();
    g.map = getTex('lightshade', 1, 1);
    g.color.set(0xffe8c8);
    g.emissive = new THREE.Color(0xffd090);
    g.emissiveIntensity = 0.22;
    g.roughness = 0.98;
    g.metalness = 0;
    g.transparent = true;
    g.opacity = 0.82;
    g.side = THREE.DoubleSide;
    g.envMapIntensity = 0.04;
    return g;
  };
  for (const lm of floorLampMeshes) {
    if (hasToken(lm.name, 'Group15')) {
      lm.material = Array.isArray(lm.material) ? lm.material.map(fabricShade) : fabricShade(lm.material);
      continue;
    }
    const darkStand = (mt) => {
      const g = mt.clone();
      g.map = null;
      g.color.set(0x24160f);
      g.emissive = new THREE.Color(0x000000);
      g.emissiveIntensity = 0;
      g.roughness = 0.72;
      g.metalness = 0.25;
      g.envMapIntensity = 0.08;
      return g;
    };
    lm.material = Array.isArray(lm.material) ? lm.material.map(darkStand) : darkStand(lm.material);
  }

  // M_JLIGHET1 is the IKEA MÖJLIGHET headset/tablet stand (the headphones
  // rest on it), not a lamp. Excel "portfolio textures": headphone stand ->
  // "orange metal headphone". Coat it in that scan; no emissive fixture here.
  if (!deskLampBox.isEmpty()) {
    for (const dm of deskLampMeshes) {
      const coatStand = (mt) => {
        const g = mt.clone();
        g.map = getTex('headphone', 1, 1);
        g.color.set(0xffffff);
        g.emissive = new THREE.Color(0x000000);
        g.emissiveIntensity = 0;
        g.roughness = 0.42;
        g.metalness = 0.5;
        g.envMapIntensity = 0.4;
        return g;
      };
      dm.material = Array.isArray(dm.material) ? dm.material.map(coatStand) : coatStand(dm.material);
    }
  }

  // Fairy lights: bulb materials already emit from MAT (_26 / _30 / glass).
  // A pair of soft fills along each string wash the upper wall.
  const beadMat = new THREE.MeshStandardMaterial({
    color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0,
  });
  const beadGeo = new THREE.SphereGeometry(0.022, 10, 8);
  for (const keyName of Object.keys(starBoxes)) {
    const box = starBoxes[keyName];
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const alongZ = size.z >= size.x;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const bead = new THREE.Mesh(beadGeo, beadMat);
      bead.position.set(
        alongZ ? (box.min.x + box.max.x) / 2 : THREE.MathUtils.lerp(box.min.x, box.max.x, t),
        (box.min.y + box.max.y) / 2,
        alongZ ? THREE.MathUtils.lerp(box.min.z, box.max.z, t) : (box.min.z + box.max.z) / 2
      );
      bead.castShadow = false;
      scene.add(bead);
    }
  }
  for (const keyName of Object.keys(fairyFillBoxes)) {
    const box = fairyFillBoxes[keyName];
    if (box.isEmpty()) continue;
    const c = box.getCenter(new THREE.Vector3());
    const fill = new THREE.PointLight(0xffd090, 0.12, 6.0, 2);
    fill.position.set(c.x, Math.min(c.y, capY - 0.15), c.z);
    scene.add(fill);
  }

  // ---- Red fairy lights on the wall behind the desk ----
  // The poster wall the character faces carries warm fairy lights; the wall
  // at their back was unlit and read as solid black. Mirror the same swag of
  // bulbs there, in red, with point fills so the plaster actually catches it.
  if (!isGlb) {
    const start = new THREE.Vector3(seatPos.x, 0, seatPos.z);
    // rotation.y = baseYaw -> forward is (-sin, 0, -cos); the back wall is the
    // opposite way.
    const back = new THREE.Vector3(Math.sin(baseYaw), 0, Math.cos(baseYaw)).normalize();
    const tx = back.x > 1e-4 ? (shell.max.x - start.x) / back.x
             : back.x < -1e-4 ? (shell.min.x - start.x) / back.x : Infinity;
    const tz = back.z > 1e-4 ? (shell.max.z - start.z) / back.z
             : back.z < -1e-4 ? (shell.min.z - start.z) / back.z : Infinity;
    const wall = start.clone().addScaledVector(back, Math.max(0.1, Math.min(tx, tz)));
    const along = new THREE.Vector3(back.z, 0, -back.x);   // horizontal, in-plane
    const inward = back.clone().multiplyScalar(-1);

    // Run the strip the full length of the black wall: corner to corner,
    // from the door wall across to the window wall. Centre it on the wall
    // itself (not the seat) and keep it a single straight, continuous line.
    const alongX = Math.abs(along.x) >= Math.abs(along.z);
    const aMin = alongX ? shell.min.x : shell.min.z;
    const aMax = alongX ? shell.max.x : shell.max.z;
    const aMid = (aMin + aMax) / 2;
    const half = (aMax - aMin) / 2 - 0.03;   // hair inset from each corner
    const yTop = capY - 0.14;
    // Wall plane sits at wall.x / wall.z; nudge 2 cm off so the beads read
    // as surface-mounted on the plaster.
    const wx = (alongX ? aMid : wall.x) + inward.x * 0.02;
    const wz = (alongX ? wall.z : aMid) + inward.z * 0.02;

    const redBeadMat = new THREE.MeshStandardMaterial({
      color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 2.4,
      roughness: 0.4, metalness: 0,
    });
    redBeadMat.toneMapped = false;   // let the red push past the bloom threshold
    const redBeadGeo = new THREE.SphereGeometry(0.02, 10, 8);
    // ~1 bead every 6 cm so the run reads as an unbroken line of light.
    const N = Math.max(24, Math.round((half * 2) / 0.06));
    for (let i = 0; i < N; i++) {
      const off = (i / (N - 1) - 0.5) * 2 * half;
      const bead = new THREE.Mesh(redBeadGeo, redBeadMat);
      bead.position.set(wx + along.x * off, yTop, wz + along.z * off);
      bead.castShadow = false;
      scene.add(bead);
    }
    // Point fills spread across the whole span so the black plaster picks up
    // the red evenly from door wall to window wall.
    const fillN = 7;
    for (let i = 0; i < fillN; i++) {
      const off = (i / (fillN - 1) - 0.5) * 2 * half * 0.95;
      const L = new THREE.PointLight(0xff1512, 0.5, 3.6, 2);
      L.position.set(wx + inward.x * 0.25 + along.x * off, yTop - 0.22,
                     wz + inward.z * 0.25 + along.z * off);
      scene.add(L);
    }
    // Two broad, dim washes to lift the full wall out of pure black.
    for (let i = 0; i < 2; i++) {
      const off = (i - 0.5) * half;
      const wash = new THREE.PointLight(0xff2018, 0.34, 7.5, 2);
      wash.position.set(wx + inward.x * 0.6 + along.x * off, yTop - 0.7,
                        wz + inward.z * 0.6 + along.z * off);
      scene.add(wash);
    }
  }

  for (const n of ['_30', '_26', '_Translucent_Glass_Gray_2', 'Color_M09']) {
    const m = builtMats.get(n);
    if (!m) continue;
    m.toneMapped = false;
    m.emissiveIntensity = n === 'Color_M09' || n === '_30' ? 1.05 : n === '_26' ? 0.8 : 0.5;
  }

  // The four desk books now open as full-screen PDFs (see openPdf), so the old
  // flip-book rig that hid them is switched off.
  if (isGlb) {
    const nb = root.getObjectByName('Notebook4');
    if (nb) bookApi = initReader({
      scene, camera, renderer, bloomPass, bookObject: nb,
      pagesDir: 'books/book1',
      onExit: () => { targetYaw = camera.rotation.y; targetPitch = camera.rotation.x; },
    });
  }
  if (false) bookApi = initBooks({
    THREE, scene, camera, renderer, bloomPass,
    posterMeshes, notebookGroups: notebookMeshes,
    onExit: () => { targetYaw = camera.rotation.y; targetPitch = camera.rotation.x; },
  });

  // A rose stem, the headphone-stand rod, a hollow guitar body: thin geometry
  // is a poor target for a zero-width reticle ray. Entries flagged `proxy`
  // are hover-tested against one slightly inflated invisible box instead.
  for (const info of INFO) {
    if (!info.proxy || !info._m) continue;
    const box = new THREE.Box3();
    for (const m of info._m) box.expandByObject(m);
    if (box.isEmpty()) continue;
    box.expandByScalar(0.02);
    const s = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(s.x, s.y, s.z),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.info = info;
    scene.add(proxy);
    infoProxies.push(proxy);
    delete info._m;
  }
  infoHitTargets.push(...infoMeshes, ...infoProxies);

  ready = true;
  updateHud();
  showHudBriefly();

  // Hold the loading screen for one more painted frame so the first thing
  // revealed is the finished room, not a half-drawn one.
  await paint();
  // Fill the circle, say so, and give the message two seconds before opening.
  setProgress(1);
  if (loadText) loadText.className = 'goes';
  // Same 2 seconds as before: let the water finish filling, then melt the
  // circle away so it is gone before the room is revealed.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1300);
  const ringEl = document.getElementById('ring');
  if (ringEl) ringEl.classList.add('melt');
  await wait(700);
  if (loadingEl) {
    loadingEl.classList.add('done');
    await new Promise((r) => setTimeout(r, 300));
    loadingEl.remove();
  }
})();

// Sample a ring of directions and keep the one with the most clear floor
// ahead, so the opening view is into the room rather than at a nearby wall.
function pickOpenFacing(from) {
  let bestYaw = 0, bestScore = -Infinity;
  for (let i = 0; i < 32; i++) {
    const yaw = (i / 32) * Math.PI * 2;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    let d = 0;
    for (; d < 4; d += 0.15) {
      const p = new THREE.Vector3(from.x + dx * d, from.y, from.z + dz * d);
      if (!walkArea.containsPoint(new THREE.Vector3(p.x, walkArea.min.y, p.z))) break;
      if (obstacles.some((b) => b.min.x <= p.x && p.x <= b.max.x && b.min.z <= p.z && p.z <= b.max.z && b.max.y > from.y - 0.9)) break;
    }
    if (d > bestScore) { bestScore = d; bestYaw = yaw; }
  }
  return bestYaw;
}

/* ---------------- Movement ---------------- */
const inBox = (b, x, z) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z;

function blocked(x, z, y) {
  if (!walkArea.containsPoint(new THREE.Vector3(x, walkArea.min.y, z))) return true;
  for (const b of obstacles) {
    if (!inBox(b, x, z)) continue;
    if (b.max.y <= y - 0.85) continue;            // low enough to step over
    // Standing up out of a chair (or off the bed) puts us inside that piece
    // of furniture's box. Treating it as solid would pin us in place forever,
    // so anything we're already standing in is walk-out-able.
    if (inBox(b, camera.position.x, camera.position.z)) continue;
    return true;
  }
  return false;
}

function step(dx, dz) {
  const y = camera.position.y;
  // Resolve each axis separately so hitting a wall slides along it instead of
  // stopping dead.
  if (dx && !blocked(camera.position.x + dx, camera.position.z, y)) camera.position.x += dx;
  if (dz && !blocked(camera.position.x, camera.position.z + dz, y)) camera.position.z += dz;
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  msaaTarget.setSize(buf.x, buf.y);
});

/* ---------------- Frame loop ---------------- */
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
let bob = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const ease = 1 - Math.pow(0.0015, dt);

  const reading = !!(bookApi && bookApi.active);
  if (!reading) {
    camera.rotation.y += (targetYaw - camera.rotation.y) * ease;
    camera.rotation.x += (targetPitch - camera.rotation.x) * ease;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * ease;
      camera.updateProjectionMatrix();
    }
  }

  if (ready && !reading) {
    const speed = move.run ? RUN : WALK;
    velocity.x -= velocity.x * DAMP * dt;
    velocity.z -= velocity.z * DAMP * dt;
    const iz = Number(move.f) - Number(move.b);
    const ix = Number(move.r) - Number(move.l);
    if (iz) velocity.z -= iz * speed * dt * 10;
    if (ix) velocity.x -= ix * speed * dt * 10;

    camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();

    const dx = fwd.x * -velocity.z * dt + right.x * -velocity.x * dt;
    const dz = fwd.z * -velocity.z * dt + right.z * -velocity.x * dt;
    const canWalk = pose === 'stand' || pose === 'crouch';
    const moving = canWalk && Math.hypot(dx, dz) > 1e-5;
    if (moving) step(dx, dz);

    // Changing pose is a smooth rise or settle, never a jump cut.
    const wantEye = pose === 'stand' ? STAND_EYE
      : pose === 'crouch' ? CROUCH_EYE
      : pose === 'lie' ? lieEye
      : seatedEye;
    eyeHeight += (wantEye - eyeHeight) * (1 - Math.pow(0.01, dt));

    bob = moving ? bob + dt * (move.run ? 13 : 9) : bob * 0.9;
    camera.position.y = floorY + eyeHeight +
      (moving ? Math.sin(bob) * (move.run ? 0.045 : 0.028) : 0);

    raycaster.setFromCamera(ndcCenter, camera);
    const hit = raycaster.intersectObjects(posterMeshes, false)[0];
    hoverPoster = hit && hit.distance < 6.5 ? hit.object : null;
    const wantFocus = hoverPoster ? 1 : 0;
    if (wantFocus || posterFocus > 0) {
      posterFocus += (wantFocus - posterFocus) * (1 - Math.pow(0.0004, dt));
      if (!wantFocus && posterFocus < 0.02) posterFocus = 0;
      applyPosterFocus(posterFocus, hoverPoster);
    }
    if (posterCta) posterCta.classList.toggle('show', posterFocus > 0.35);

    // Reticle resting on a documented object -> bottom-left info card.
    const ihit = raycaster.intersectObjects(infoHitTargets, false)[0];
    updateObjInfo(ihit && ihit.distance < 7 ? ihit.object : null);
  } else if (curInfo) {
    updateObjInfo(null);
  }

  if (bookApi) bookApi.update(dt);

  composer.render();
}
animate();
