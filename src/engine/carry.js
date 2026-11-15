// Carrying: piles of things on the ground and a load in the arms, drawn as plain boxes. Generic: it is told
// what each pile is made of (how many pieces, their size, colour and how they sit) and knows nothing more.
//   window.__carry.create(G) -> { setStacks(list), setLoad(desc | null), update(dt), nearest(x, z, r), pieceCount }
//   a stack: { id, x, z, form, n, l, w, h, color, yaw? }   forms: "lumber" (long pieces in layers), "sheet" (a flat pile),
//   "block" (a few to a layer), "roll" (standing), "lean" (leaning on a trestle), "heap" (anything else: neat rows)
(() => {
  function create(G) {
    const T = G.THREE,
      CAP = 1500,
      geo = new T.BoxGeometry(1, 1, 1),
      mat = new T.MeshLambertMaterial({ color: 0xffffff }),
      mesh = new T.InstancedMesh(geo, mat, CAP),
      load = new T.InstancedMesh(geo, mat, 64),
      loadRoot = new T.Group(),
      m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(), c = new T.Color();
    mesh.castShadow = mesh.receiveShadow = load.castShadow = true;
    mesh.frustumCulled = load.frustumCulled = false;
    mesh.count = load.count = 0;
    loadRoot.add(load); loadRoot.visible = false;
    G.scene.add(mesh, loadRoot);
    let stacks = [], dropping = new Map(), seen = new Set(), dirty = false, loadForm = null, first = true;
    const hashf = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

    // where piece k of a pile sits, in the pile's own metres: writes position p, size s, rotation e
    function place(d, k, held) {
      e.set(0, 0, 0);
      const f = d.form;
      if (f === 'lumber') {
        const per = Math.max(1, Math.floor((held ? 0.3 : 1.0) / (d.w + 0.012))), row = Math.floor(k / per), i = k % per;
        s.set(d.w, d.h, d.l * (0.94 + 0.06 * hashf(k, 3)));
        p.set((i - (per - 1) / 2) * (d.w + 0.012), (held ? 0 : 0.09) + d.h / 2 + row * (d.h + 0.004), (hashf(k, 7) - 0.5) * 0.08);
      } else if (f === 'sheet') {
        s.set(d.w, d.h, d.l); p.set((hashf(k, 1) - 0.5) * 0.03, (held ? 0 : 0.09) + d.h / 2 + k * (d.h + 0.002), (hashf(k, 2) - 0.5) * 0.03);
      } else if (f === 'roll') {
        s.set(d.w, d.l, d.w); p.set((k % 3) * (d.w + 0.05) - d.w, d.l / 2, Math.floor(k / 3) * (d.w + 0.05));
        if (held) { s.set(d.w, d.w, d.l); p.set(0, d.w / 2 + k * d.w, 0); }
      } else if (f === 'lean') {
        s.set(d.w, d.l, d.h); p.set(0, d.l / 2 * 0.97, 0.28 + k * (d.h + 0.02)); e.set(-0.22, 0, 0);
        if (held) { p.set(0, d.l / 2, k * (d.h + 0.02)); e.set(0, 0, 0); }
      } else {
        const per = f === 'block' ? 3 : Math.max(1, Math.round(1.1 / (d.w + 0.03))), perL = f === 'block' ? 6 : per * 2, lay = Math.floor(k / perL), r = k % perL;
        s.set(d.w, d.h, d.l);
        p.set(((r % per) - (Math.min(per, d.n) - 1) / 2) * (d.w + 0.03), d.h / 2 + lay * (d.h + 0.004), Math.floor(r / per) * (d.l + 0.03));
        if (held) p.set(0, d.h / 2 + k * (d.h + 0.004), 0);
      }
    }
    function rebuild() {
      let n = 0;
      for (const d of stacks) {
        const y0 = G.heightAt(d.x, d.z), drop = dropping.get(d.id) || 0, cy = Math.cos(d.yaw || 0), sy = Math.sin(d.yaw || 0);
        const put = (px, py, pz, sx, sy2, sz, ex, col, v) => {
          if (n >= CAP) return;
          e.set(ex, d.yaw || 0, 0, 'YXZ'); q.setFromEuler(e);
          p.set(d.x + px * cy + pz * sy, y0 + py + drop, d.z - px * sy + pz * cy); s.set(sx, sy2, sz);
          mesh.setMatrixAt(n, m4.compose(p, q, s));
          mesh.setColorAt(n, c.setHex(col).multiplyScalar(v)); n++;
        };
        if (d.form === 'lumber' || d.form === 'sheet') for (const z of [-d.l * 0.3, d.l * 0.3]) put(0, 0.045, z, d.form === 'sheet' ? d.w : 1.05, 0.09, 0.09, 0, 0x8a7350, 1);   // bearers keep it off the ground
        if (d.form === 'lean') { put(0, 0.5, 0.05, d.w * 0.9, 1.0, 0.06, 0.12, 0x8a7350, 1); put(0, 0.04, 0.3, d.w * 0.9, 0.08, 0.6, 0, 0x8a7350, 1); }
        for (let k = 0; k < d.n; k++) {
          place(d, k, false);
          const px = p.x, py = p.y, pz = p.z, sx = s.x, sy2 = s.y, sz = s.z, ex = e.x;
          put(px, py, pz, sx, sy2, sz, ex, d.color, 0.9 + 0.2 * hashf(k, d.n));
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return {
      // new piles come down with a bump; onLand(stack) is called once for each as it settles
      setStacks(list, onLand) {
        for (const d of list) if (!seen.has(d.id)) { seen.add(d.id); if (!first) dropping.set(d.id, 0.7); }
        first = false;
        stacks = list; dirty = true; this.onLand = onLand || this.onLand;
      },
      forget() { seen = new Set(); dropping.clear(); first = true; stacks = []; dirty = true; },
      setLoad(d) {
        loadRoot.visible = !!d;
        loadForm = d ? d.form : null;
        if (!d) return;
        const n = Math.min(d.n, 64);
        for (let k = 0; k < n; k++) { place(d, k, true); q.setFromEuler(e); load.setMatrixAt(k, m4.compose(p, q, s)); load.setColorAt(k, c.setHex(d.color).multiplyScalar(0.9 + 0.2 * hashf(k, d.n))); }
        load.count = n; load.instanceMatrix.needsUpdate = true; if (load.instanceColor) load.instanceColor.needsUpdate = true;
        // how it is held: long things on the shoulder, sheets flat overhead, tall things at the side, the rest in front
        const f = d.form;
        if (f === 'lumber') { load.position.set(0.27, 1.34, 0.1); load.rotation.set(-0.1, 0, 0); }
        else if (f === 'sheet') { load.position.set(0, 1.62, 0.05); load.rotation.set(-0.06, 0, 0); }
        else if (f === 'lean') { load.position.set(0.42, 0.25, 0.1); load.rotation.set(0, Math.PI / 2, 0); }
        else if (f === 'roll') { load.position.set(0.3, 1.3, 0); load.rotation.set(0, 0, 0); }
        else { load.position.set(0, 0.78, 0.36); load.rotation.set(0, 0, 0); }
      },
      update(dt) {
        if (dropping.size) {
          for (const [id, h] of dropping) {
            const nh = h - dt * (1.2 + (0.7 - h) * 6);
            if (nh <= 0) { dropping.delete(id); const d = stacks.find((k) => k.id === id); d && this.onLand && this.onLand(d); } else dropping.set(id, nh);
          }
          dirty = true;
        }
        if (dirty) { rebuild(); dirty = false; }
        if (loadRoot.visible) {
          const P = G.player;
          loadRoot.position.set(P.x, P.y + Math.abs(Math.sin(P.walk)) * 0.04 * Math.min(1, P.speed / 5), P.z);
          loadRoot.rotation.y = P.face;
        }
      },
      nearest(x, z, r) {
        let best = null, bd = r;
        for (const d of stacks) { const dd = Math.hypot(d.x - x, d.z + (d.form === 'lumber' || d.form === 'sheet' ? 0 : 0.2) - z); if (dd < bd) { bd = dd; best = d; } }
        return best;
      },
      get pieceCount() { return mesh.count; },
      get loadForm() { return loadForm; },
    };
  }
  window.__carry = { create };
})();
