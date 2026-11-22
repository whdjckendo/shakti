import * as THREE from 'three';

/* ------------------------------------------------------------------
   A simple "look closer" view: the camera glides to face an area of a
   wall (e.g. the calendar and the photos under it, the "Wall of Always")
   and fills the screen with it. × / Esc / a click takes you back.
------------------------------------------------------------------- */

const CAM_DUR = 1.1;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const camDur = () => (document.documentElement.classList.contains('reduce-motion') ? 0.05 : CAM_DUR);

export function initFocus({ camera, box, normal, fill = 0.82, label = 'Back to the room', clear = 0.15, onExit }) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // the wall-plane extent: width across the wall, height up it
  // extent of the area across the view direction (works for angled views too)
  const n = normal.clone().normalize();
  const r = new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const W = Math.abs(size.x * r.x) + Math.abs(size.z * r.z) + Math.abs(size.y * r.y);
  const H = size.y;

  const ui = document.createElement('div');
  ui.className = 'focus-ui';
  ui.innerHTML = `<button class="fx-x" aria-label="${label}">&times;</button>`;
  document.body.appendChild(ui);
  if (!document.getElementById('focus-css')) {
    const css = document.createElement('style');
    css.id = 'focus-css';
    css.textContent = `
    .focus-ui{position:fixed;inset:0;z-index:25;display:none}
    .focus-ui.show{display:block}
    .focus-ui .fx-x{position:absolute;top:18px;right:18px;width:44px;height:44px;border:0;border-radius:50%;
      background:rgba(22,14,10,.45);color:#f6e6cc;font:300 24px/44px var(--ui-font);
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}`;
    document.head.appendChild(css);
  }
  ui.addEventListener('click', () => close());
  addEventListener('keydown', (e) => { if (mode === 'on' && e.code === 'Escape') close(); });

  let mode = 'off', t = 0;
  // Things standing between the camera and the wall (the floor lamp, the door)
  // would block the view: while looking closely, clip anything more than
  // `clear` metres in front of the wall.
  const NEAR0 = camera.near;
  let baseNear = NEAR0, dist = 1;
  const setNear = (n) => { camera.near = n; camera.updateProjectionMatrix(); }
  const from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const target = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const home = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const dummy = new THREE.PerspectiveCamera();
  function computeTarget() {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d = Math.max(H / (fill * 2 * tanV), W / (fill * 2 * tanV * camera.aspect));
    dist = d;
    target.p.copy(center).addScaledVector(n, d);
    dummy.position.copy(target.p); dummy.up.set(0, 1, 0); dummy.lookAt(center);
    target.q.copy(dummy.quaternion);
  }
  function open() {
    if (mode !== 'off') return false;
    home.p.copy(camera.position); home.q.copy(camera.quaternion);
    from.p.copy(home.p); from.q.copy(home.q);
    computeTarget();
    mode = 'in'; t = 0;
    document.body.classList.add('reading');
    return true;
  }
  function close() {
    if (mode !== 'on') return;
    ui.classList.remove('show');
    from.p.copy(camera.position); from.q.copy(camera.quaternion);
    setNear(NEAR0);
    mode = 'out'; t = 0;
  }
  addEventListener('resize', () => { if (mode === 'on') { computeTarget(); camera.position.copy(target.p); camera.quaternion.copy(target.q); setNear(Math.max(baseNear, dist - clear)); } });
  function update(dt) {
    // fail-safe: outside the close-up the camera always sees everything
    if ((mode !== 'on' || !clear) && camera.near !== NEAR0) setNear(NEAR0);
    if (mode !== 'in' && mode !== 'out') return;
    t = Math.min(1, t + dt / camDur());
    const e = ease(t);
    const b = mode === 'in' ? target : home;
    camera.position.lerpVectors(from.p, b.p, e);
    camera.quaternion.copy(from.q).slerp(b.q, e);
    if (t >= 1) {
      if (mode === 'in') { mode = 'on'; ui.classList.add('show'); baseNear = NEAR0; if (clear) setNear(Math.max(NEAR0, dist - clear)); }
      else {
        mode = 'off';
        document.body.classList.remove('reading');
        camera.rotation.setFromQuaternion(home.q, 'YXZ');
        onExit && onExit();
      }
    }
  }
  return { open, close, update, get active() { return mode !== 'off'; } };
}
