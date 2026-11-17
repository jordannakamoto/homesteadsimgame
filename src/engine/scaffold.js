// Scaffold: a platform a bay long on two end frames, with braces, planks, a guard rail and a ladder at one end. Generic:
// it knows frames, planks and a person on them, not what is being built. Climbing is by movement, the way the owner wants
// ladders: walk into the ladder at the end and you go up, fast; walk the plank; walk back off the ladder end and you climb down.
//   window.__scaffold.create(G) -> scaffold
//   scaffold.set(bay | null)      bay: { x, z, yaw, len, deckY, w }  (x, z: the middle of the plank in plan; yaw: along it)
//   scaffold.setBundle(p | null)  p: { x, z }: frames and planks lying in a stack
//   scaffold.update(dt, { climbMps, keys }) -> 'up' | 'down' | null when the player mounts or leaves; holds the player while on it
//   scaffold.on()                 is the player on it (climbing or on the plank)
//   scaffold.foot()               { x, z } of the bottom of its ladder, or null
//   scaffold.onPlank()            standing on the plank (not on its ladder)
//   scaffold.over(x, z)           the plank's height if (x, z) is over the plank, else null; scaffold.board(x, z): stand on it there
(() => {
  function create(G) {
    const T = G.THREE,
      steel = new T.MeshLambertMaterial({ color: 0x9aa3a8 }),
      plank = new T.MeshLambertMaterial({ color: 0xc9a468 }),
      toe = new T.MeshLambertMaterial({ color: 0xd8b04a }),
      box = new T.BoxGeometry(1, 1, 1),
      root = new T.Group(),
      bundle = new T.Group();
    root.visible = bundle.visible = false;
    G.scene.add(root, bundle);
    const bar = (parent, mat, a, b, t) => {          // a box from a to b (local), t thick
      const m = new T.Mesh(box, mat), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
      m.scale.set(t, t, L); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      m.lookAt(m.position.x + dx, m.position.y + dy, m.position.z + dz);
      m.castShadow = true; parent.add(m); return m;
    };
    // the bundle: frames and planks lying in a heap
    for (let i = 0; i < 4; i++) { const m = new T.Mesh(box, i < 2 ? steel : plank); m.scale.set(i < 2 ? 1.0 : 0.23, 0.05, i < 2 ? 0.05 : 2.4); m.position.set(i < 2 ? 0 : (i - 2.5) * 0.25, 0.05 + i * 0.05, i < 2 ? (i - 0.5) * 0.8 : 0); m.castShadow = true; bundle.add(m); }
    let bay = null, sig = '', bsig = '', st = null, pushT = 0;
    function build(b) {
      for (const c of [...root.children]) root.remove(c);
      const gy = G.heightAt(b.x, b.z), H = b.deckY - gy, hl = b.len / 2, hw = b.w / 2;
      // in root's frame: z along the plank, x across it (+x toward the wall), y up from the ground under its middle
      for (const z of [-hl, hl]) for (const x of [-hw, hw]) {
        const g = G.heightAt(b.x + Math.cos(b.yaw) * x + Math.sin(b.yaw) * z, b.z - Math.sin(b.yaw) * x + Math.cos(b.yaw) * z) - gy;
        bar(root, steel, [x, g, z], [x, H + (x < 0 ? 1.05 : 0.15), z], 0.045);
      }
      for (const z of [-hl, hl]) { bar(root, steel, [-hw, H - 0.02, z], [hw, H - 0.02, z], 0.04); bar(root, steel, [-hw, H * 0.5, z], [hw, H * 0.5, z], 0.035); }
      bar(root, steel, [-hw, 0.15, -hl], [-hw, H - 0.05, hl], 0.03); bar(root, steel, [-hw, 0.15, hl], [-hw, H - 0.05, -hl], 0.03);   // cross braces on the outside
      bar(root, steel, [-hw, H + 1.0, -hl], [-hw, H + 1.0, hl], 0.04); bar(root, steel, [-hw, H + 0.5, -hl], [-hw, H + 0.5, hl], 0.035);   // guard rails
      for (let k = 0; k < 3; k++) { const x = -hw + 0.13 + k * ((b.w - 0.26) / 2); const m = new T.Mesh(box, plank); m.scale.set(0.23, 0.04, b.len + 0.2); m.position.set(x, H + 0.02, 0); m.castShadow = m.receiveShadow = true; root.add(m); }
      { const m = new T.Mesh(box, toe); m.scale.set(0.02, 0.12, b.len); m.position.set(-hw - 0.01, H + 0.08, 0); root.add(m); }
      // the ladder up the end frame, outside it
      for (let y = 0.3; y < H; y += 0.3) bar(root, steel, [-hw + 0.1, y, -hl - 0.06], [hw - 0.1, y, -hl - 0.06], 0.025);
      root.position.set(b.x, gy, b.z); root.rotation.y = b.yaw;
      root.visible = true;
    }
    // plan coordinates of the player in the bay's frame: along (z) and across (x, + toward the wall)
    const local = (b, x, z) => { const dx = x - b.x, dz = z - b.z, s = Math.sin(b.yaw), c = Math.cos(b.yaw); return { along: dx * s + dz * c, across: dx * c - dz * s }; };
    const world = (b, along, across) => ({ x: b.x + Math.sin(b.yaw) * along + Math.cos(b.yaw) * across, z: b.z + Math.cos(b.yaw) * along - Math.sin(b.yaw) * across });
    function release() { const P = G.player; if (st) { P.standY = null; if (st.climb) P.climbY = null; } st = null; }
    return {
      set(b) {
        const s2 = b ? [b.x, b.z, b.yaw, b.len, b.deckY].join() : '';
        if (s2 === sig) return;
        sig = s2; bay = b ? { w: 0.75, ...b } : null;
        if (!bay) { root.visible = false; release(); return; }
        build(bay);
      },
      setBundle(p) {
        const s2 = p ? p.x + ',' + p.z : '';
        if (s2 === bsig) return;
        bsig = s2; bundle.visible = !!p;
        if (p) bundle.position.set(p.x, G.heightAt(p.x, p.z), p.z);
      },
      on: () => !!st,
      onPlank: () => !!st && !st.climb,
      over(x, z) { if (!bay) return null; const L = local(bay, x, z); return Math.abs(L.along) < bay.len / 2 - 0.1 && Math.abs(L.across) < bay.w / 2 + 0.15 ? bay.deckY : null; },
      board(x, z) {
        if (!bay) return false;
        const L = local(bay, x, z), q = world(bay, Math.max(-bay.len / 2 + 0.2, Math.min(bay.len / 2 - 0.2, L.along)), Math.max(-bay.w / 2 + 0.15, Math.min(bay.w / 2 - 0.15, L.across))), P = G.player;
        P.x = q.x; P.z = q.z; P.climbY = null; P.standY = bay.deckY; st = { climb: false }; pushT = 0;
        return true;
      },
      foot: () => (bay ? world(bay, -bay.len / 2 - 0.45, 0) : null),
      release,
      update(dt, opt = {}) {
        const P = G.player, b = bay;
        if (!b) { if (st) release(); return null; }
        const sp = opt.climbMps || 4.5;
        const L = local(b, P.x, P.z), gy = G.heightAt(b.x, b.z), hl = b.len / 2, hw = b.w / 2;
        if (!st) {
          // walking into the foot of the ladder, heading along the bay, mounts it
          const mv = Math.hypot(P.mvx || 0, P.mvz || 0), dir = mv > 0.3 ? (P.mvx * Math.sin(b.yaw) + P.mvz * Math.cos(b.yaw)) / mv : 0;
          if (L.along < -hl - 0.15 && L.along > -hl - 0.85 && Math.abs(L.across) < hw && dir > 0.8 && P.y < b.deckY - 0.6 && Math.abs(P.y - G.heightAt(P.x, P.z)) < 0.8) { st = { climb: true, t: 0, dir: 1 }; return 'up'; }
          return null;
        }
        if (st.climb) {                                     // up or down the ladder at the end, quickly
          // which way you push decides: toward the bay climbs, away from it comes down (the keys alone would depend on the camera)
          const H = b.deckY - gy, mv = Math.hypot(P.mvx || 0, P.mvz || 0), push = mv > 0.3 ? (P.mvx * Math.sin(b.yaw) + P.mvz * Math.cos(b.yaw)) / mv : 0;
          if (push > 0.5) st.dir = 1; else if (push < -0.5) st.dir = -1;
          st.t = Math.max(0, Math.min(1, st.t + (st.dir * dt * sp) / Math.max(0.5, H)));
          const p = world(b, -hl - 0.42, 0);
          P.x = p.x; P.z = p.z; P.climbY = gy + H * st.t; P.faceTarget = b.yaw;
          if (st.t >= 1 && st.dir > 0) { const q = world(b, -hl + 0.35, 0); P.x = q.x; P.z = q.z; P.climbY = null; P.standY = b.deckY; st = { climb: false }; return null; }
          if (st.t <= 0 && st.dir < 0) { const q = world(b, -hl - 0.9, 0); P.x = q.x; P.z = q.z; release(); pushT = 0; return 'down'; }
          return null;
        }
        // on the plank: held on it by its ends and its rail; pushing back off the ladder end climbs down
        P.standY = b.deckY;
        const along = Math.max(-hl + 0.2, Math.min(hl - 0.2, L.along)), across = Math.max(-hw + 0.15, Math.min(hw - 0.15, L.across));
        const leaving = L.along < -hl + 0.22 && (P.mvx || P.mvz) && (P.mvx * Math.sin(b.yaw) + P.mvz * Math.cos(b.yaw)) < -0.5;
        pushT = leaving ? pushT + dt : 0;
        if (pushT > 0.18) { st = { climb: true, t: 1, dir: -1 }; P.standY = null; pushT = 0; return null; }
        if (along !== L.along || across !== L.across) { const q = world(b, along, across); P.x = q.x; P.z = q.z; }
        return null;
      },
    };
  }
  window.__scaffold = { create };
})();
