// Roof walking: standing and walking on sloped planes the way a roofer does. Generic: it knows planes (a frame with an
// outline in its own s, t coordinates, the matrix that puts it in the world) and the pads on each that will bear a person
// (the deck sheets that are down), not what is being built. The body stays upright; the steeper the plane, the slower the
// walk. Clipped in to an anchor, a rope runs from the anchor to the harness and you cannot go past an edge (fall restraint);
// unclipped on a steep plane you slide slowly down to the eave and stop there. Leaving over an edge is the caller's call
// (onto a ladder, onto a plank, or a soft drop to the ground: nobody is hurt in this game).
//   window.__roofwalk.create(G) -> rw
//   rw.setSurfaces(list)        list: [{ key, matrix (local -> world), F (a plane frame: src/framing.js planeFrame), pads: [[s0, s1, t0, t1]] | null (all of it), lift, info }]
//   rw.hit(x, z, y, up?, down?) -> { i, key, info, s, t, y, k, F } | null: the plane under (x, z) whose top is within up above / down below y
//   rw.safe(x, z, y, m)         is (x, z) on a plane with m metres of it all round (any plane: across a ridge counts)
//   rw.mount(x, z, y) -> bool   start standing there
//   rw.update(dt, o) -> null | { leave: true, x, z } | 'slide' | 'edge'
//        o: { clipped, anchor: { x, y, z } | null, ropeM, slideK, slideMps, edgeM, exitOk(x, z) }
//   rw.on(), rw.at()            standing on a plane, and which (the last hit)
//   rw.release()                stop standing (the caller has put you somewhere else); rw.drop(): stop and fall
//   rw.rope(anchor | null)      draw the rope from an anchor to the harness; rw.anchors([{ x, y, z }]): the anchor brackets
(() => {
  function create(G) {
    const T = G.THREE,
      v = new T.Vector3();
    let list = [],
      st = null,
      last = null;
    function setSurfaces(src) {
      list = src.map((q) => {
        const inv = q.matrix.clone().invert(),
          F = q.F,
          o = new T.Vector3(F.e0[0], 0, F.e0[1]).applyMatrix4(q.matrix),
          d = new T.Vector3(F.e0[0] + F.up[0], 0, F.e0[1] + F.up[1]).applyMatrix4(q.matrix).sub(o).normalize();
        return { ...q, inv, ty: q.matrix.elements[13], down: [-d.x, -d.z] };
      });
    }
    const onPad = (q, s, t, m) => {
      if (!q.F.inside(s, t)) return false;
      if (!q.pads) return true;
      for (const p of q.pads) if (s >= p[0] - m && s <= p[1] + m && t >= p[2] - m && t <= p[3] + m) return true;
      return false;
    };
    function hit(x, z, y, up = 1.0, down = 1.0) {
      let best = null;
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        v.set(x, 0, z).applyMatrix4(q.inv);
        const [s, t] = q.F.local(v.x, v.z);
        if (!onPad(q, s, t, 0.02)) continue;
        const h = q.ty + q.F.eaveY + q.F.k * t + (q.lift || 0.03);
        if (y !== undefined && (h > y + up || h < y - down)) continue;
        if (!best || h > best.y) best = { i, key: q.key, info: q.info, s, t, y: h, k: q.F.k, F: q.F, down: q.down };
      }
      return best;
    }
    // on some plane with m metres of plane all round: four probes and the middle
    const safe = (x, z, y, m) => !!hit(x, z, y, 0.6, 0.6) && !!hit(x + m, z, y, 0.6, 0.8) && !!hit(x - m, z, y, 0.6, 0.8) && !!hit(x, z + m, y, 0.6, 0.8) && !!hit(x, z - m, y, 0.6, 0.8);
    // ---- the rope and the anchor brackets
    const ropeMat = new T.LineBasicMaterial({ color: 0xff8a2a }),
      ropeGeo = new T.BufferGeometry(),
      ROPE_N = 12,
      ropePos = new Float32Array(ROPE_N * 3);
    ropeGeo.setAttribute('position', new T.BufferAttribute(ropePos, 3));
    const rope = new T.Line(ropeGeo, ropeMat);
    rope.frustumCulled = false; rope.visible = false;
    G.scene.add(rope);
    const brMat = new T.MeshLambertMaterial({ color: 0x9aa3a8 }), brGeo = new T.BoxGeometry(0.16, 0.06, 0.22), ringGeo = new T.TorusGeometry(0.05, 0.012, 6, 12), brackets = [];
    const ringMat = new T.MeshLambertMaterial({ color: 0xffb24a });
    function anchors(pts) {
      while (brackets.length < pts.length) {
        const g = new T.Group(), b = new T.Mesh(brGeo, brMat), r = new T.Mesh(ringGeo, ringMat);
        r.position.y = 0.08; b.castShadow = true; g.add(b, r); G.scene.add(g); brackets.push(g);
      }
      brackets.forEach((g, i) => { g.visible = i < pts.length; if (g.visible) g.position.set(pts[i].x, pts[i].y, pts[i].z); });
    }
    function drawRope(a) {
      rope.visible = !!a && !!st;
      if (!rope.visible) return;
      const P = G.player, hx = P.x, hy = P.y + 1.0, hz = P.z, L = Math.hypot(hx - a.x, hy - a.y, hz - a.z), sag = Math.min(0.5, 0.06 * L);
      for (let i = 0; i < ROPE_N; i++) {
        const f = i / (ROPE_N - 1);
        ropePos[i * 3] = a.x + (hx - a.x) * f;
        ropePos[i * 3 + 1] = a.y + 0.08 + (hy - a.y - 0.08) * f - sag * 4 * f * (1 - f);
        ropePos[i * 3 + 2] = a.z + (hz - a.z) * f;
      }
      ropeGeo.attributes.position.needsUpdate = true;
    }
    function release() { const P = G.player; if (st) { P.standY = null; P.pace = 0; } st = null; rope.visible = false; }
    return {
      setSurfaces,
      hit,
      safe,
      anchors,
      rope: drawRope,
      on: () => !!st,
      at: () => last,
      release,
      drop() { const P = G.player; release(); P.air = true; P.vy = 0; },
      mount(x, z, y) {
        const h = hit(x, z, y, 2.2, 1.2);
        if (!h) return false;
        const P = G.player;
        P.x = x; P.z = z; P.y = P.standY = h.y;
        st = { x, z };
        last = h;
        return true;
      },
      update(dt, o = {}) {
        if (!st) return null;
        const P = G.player;
        let h = hit(P.x, P.z, P.y, 0.7, 0.7), out = null;
        // past an edge: held back by the rope, or off you go (the caller says where)
        const over = !h || (o.clipped && !safe(P.x, P.z, P.y, o.edgeM || 0.2));
        if (over) {
          if (!o.clipped || (o.exitOk && o.exitOk(P.x, P.z))) { if (!h) return { leave: true, x: P.x, z: P.z }; }
          else { P.x = st.x; P.z = st.z; h = hit(P.x, P.z, P.y, 0.7, 0.7); out = 'edge'; }
        }
        if (!h) return { leave: true, x: P.x, z: P.z };
        // the rope is only so long
        const a = o.anchor;
        if (o.clipped && a && Math.hypot(P.x - a.x, P.z - a.z) > (o.ropeM || 14)) { P.x = st.x; P.z = st.z; h = hit(P.x, P.z, P.y, 0.7, 0.7) || h; }
        // unclipped on a steep plane: a slow slide down the slope, that stops at the eave
        if (!o.clipped && h.k > (o.slideK || 0.5)) {
          const sp = (o.slideMps || 0.5) * dt, nx = P.x + h.down[0] * sp, nz = P.z + h.down[1] * sp, m = o.edgeM || 0.2;
          if (hit(nx + h.down[0] * m, nz + h.down[1] * m, h.y, 0.7, 0.9)) { P.x = nx; P.z = nz; out = 'slide'; }
          else out = 'edge';
          h = hit(P.x, P.z, P.y, 0.7, 0.9) || h;
        }
        P.y = P.standY = h.y;
        P.pace = Math.max(0.45, Math.min(1, 1.05 - 0.6 * h.k));
        st.x = P.x; st.z = P.z;
        last = h;
        return out;
      },
    };
  }
  window.__roofwalk = { create };
})();
