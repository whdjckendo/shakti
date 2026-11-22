import * as THREE from 'three';

/* ------------------------------------------------------------------
   Light switches for the room's fixtures. Each fixture can be turned off
   and on: its glowing parts fade, its lights dim, its dust settles.

   fixtures: [{ key, node, on, glow?, light?: {offset, color, intensity, distance},
                adopt?: true (take nearby existing point lights) }]
------------------------------------------------------------------- */

export function initFixtures(scene, list) {
  const pointLights = [];
  scene.traverse((o) => { if (o.isPointLight) pointLights.push(o); });

  const fx = {};
  for (const f of list) {
    const nodes = [].concat(f.node).filter(Boolean);
    if (!nodes.length) continue;
    const box = new THREE.Box3();
    nodes.forEach((n) => box.expandByObject(n));
    const mats = [];
    nodes.forEach((n) => n.traverse((o) => {
      if (!o.isMesh) return;
      o.material = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.userData.fxEi = c.emissiveIntensity ?? 1;
        c.userData.fxEm = c.emissive ? c.emissive.clone() : null;
        mats.push(c);
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    }));
    // a fixture that is off by default but should glow when on (tube light)
    if (f.glow) for (const m of mats) {
      if (!m.emissive) continue;
      m.userData.fxEm = new THREE.Color(f.glow.color);
      m.userData.fxEi = f.glow.intensity;
    }
    const lights = [];
    if (f.adopt) {
      const near = box.clone().expandByScalar(0.3);
      for (const L of pointLights) if (L.intensity > 0 && near.containsPoint(L.getWorldPosition(new THREE.Vector3()))) {
        L.userData.baseI = L.intensity; lights.push(L);
      }
    }
    if (f.light) {
      const L = new THREE.PointLight(f.light.color, f.light.intensity, f.light.distance, 2);
      L.position.copy(box.getCenter(new THREE.Vector3())).add(f.light.offset || new THREE.Vector3());
      L.userData.baseI = f.light.intensity;
      scene.add(L); lights.push(L);
    }
    fx[f.key] = { on: f.on !== false, level: f.on !== false ? 1 : 0, mats, lights, box };
  }

  function apply(f) {
    for (const m of f.mats) {
      if (!m.emissive || !m.userData.fxEm) continue;
      m.emissive.copy(m.userData.fxEm);
      m.emissiveIntensity = m.userData.fxEi * f.level;
    }
    for (const L of f.lights) L.intensity = L.userData.baseI * f.level;
  }
  Object.values(fx).forEach(apply);

  return {
    has: (k) => !!fx[k],
    isOn: (k) => !!(fx[k] && fx[k].on),
    level: (k) => (fx[k] ? fx[k].level : 1),
    toggle(k) { if (fx[k]) fx[k].on = !fx[k].on; return fx[k] && fx[k].on; },
    update(dt) {
      for (const f of Object.values(fx)) {
        const to = f.on ? 1 : 0;
        if (f.level !== to) f.level += Math.sign(to - f.level) * Math.min(Math.abs(to - f.level), dt / 0.35);
        // re-applied every frame: the hover highlight restores materials
        // to how they looked at load, which would switch a lamp back on
        apply(f);
      }
    },
  };
}
