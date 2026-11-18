/* Payout: a line that pays out behind the character between fixed points. Generic (no words of what the line is
   for): a mason's string between stakes now, a cable off a spool or a hose later.
   The line is a list of spans. A span between two fixed points is taut (it twangs when it is pulled tight); the
   free span from the last fixed point to the hand sags under its own weight. Drawn as thin round strands, one
   instanced mesh per line, so it reads at working distance where a one-pixel line would not.
     const L = window.__payout.create({ colour, radius, sagPerM })
     L.reset(p)        tie the line on at p ([x, y, z]); clears it
     L.tie(p)          start a new run at p, keeping the spans already drawn
     L.hand(p | null)  where the free end is held (null: no free end)
     L.pin(p)          the free end is fixed at p: the span to it pulls taut
     L.close()         pinned back at the first point
     L.setSpans([[a, b], ...])  static taut spans (a saved state), no free end
     L.flash(spans, colour, secs)  spans drawn briefly in another colour (a check: diagonals, a level)
     L.paidM           metres paid out (fixed spans plus the free span)
     L.update(dt)      per frame while shown; nothing to do when nothing moves
     L.visible, L.dispose()
   Cost: one draw call per line; a frame with nothing moving writes nothing. */
(() => {
  const G = window.__game;
  if (!G || !G.THREE) return;
  const T = G.THREE;
  const geo = new T.CylinderGeometry(1, 1, 1, 5, 1, true);
  geo.translate(0, 0.5, 0);
  const SUB = 10;                       // pieces a sagging or twanging span is drawn in
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _d = new T.Vector3(), _u = new T.Vector3(0, 1, 0), _c = new T.Color();
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

  function create({ colour = 0xff4fa3, radius = 0.007, sagPerM = 0.04, max = 512 } = {}) {
    const mat = new T.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new T.InstancedMesh(geo, mat, max);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 3;
    mesh.setColorAt(0, _c.setHex(colour));
    G.scene.add(mesh);
    const base = new T.Color(colour);
    let pts = [], spans = [], free = null, flashes = [], dirty = true, t = 0;
    const span = (a, b, twang) => ({ a: a.slice(), b: b.slice(), amp: twang ? Math.min(0.05, 0.012 * dist(a, b)) : 0, age: 0 });
    // a point along a span: straight, plus sag (free span) or a decaying vibration (just pulled taut)
    function along(S, k, sag, out) {
      const a = S.a, b = S.b, w = 4 * k * (1 - k);
      out[0] = a[0] + (b[0] - a[0]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
      out[1] = a[1] + (b[1] - a[1]) * k - sag * w - (S.amp ? S.amp * Math.exp(-S.age * 7) * Math.sin(S.age * 55) * w : 0);
      return out;
    }
    const A = [0, 0, 0], B = [0, 0, 0];
    function draw() {
      let n = 0;
      const put = (S, sag, col) => {
        const wavy = sag > 1e-4 || (S.amp && S.age < 0.8), m = wavy ? SUB : 1;
        for (let i = 0; i < m && n < max; i++) {
          along(S, i / m, sag, A); along(S, (i + 1) / m, sag, B);
          _d.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
          const L = _d.length(); if (L < 1e-5) continue;
          _q.setFromUnitVectors(_u, _d.multiplyScalar(1 / L));
          mesh.setMatrixAt(n, _m.compose(_p.set(A[0], A[1], A[2]), _q, _s.set(radius, L, radius)));
          mesh.setColorAt(n, col); n++;
        }
      };
      for (const S of spans) put(S, 0, base);
      if (free) put(free, Math.min(0.5, sagPerM * dist(free.a, free.b)), base);
      for (const f of flashes) { const k = Math.max(0, 1 - f.t / f.secs), c = _c.setHex(f.colour).lerp(base, 1 - k); for (const S of f.spans) put(S, 0, c); }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      dirty = false;
    }
    const L = {
      mesh,
      reset(p) { pts = p ? [p.slice()] : []; spans = []; free = null; dirty = true; },
      tie(p) { pts = [p.slice()]; free = null; dirty = true; },
      hand(p) {
        if (!p || !pts.length) { if (free) { free = null; dirty = true; } return; }
        const a = pts[pts.length - 1];
        if (!free) free = span(a, p, false);
        else if (Math.abs(free.b[0] - p[0]) + Math.abs(free.b[1] - p[1]) + Math.abs(free.b[2] - p[2]) < 1e-4 && free.a === a) return;
        free.a = a; free.b = p.slice(); dirty = true;
      },
      pin(p) {
        if (!pts.length) { L.reset(p); return; }
        spans.push(span(pts[pts.length - 1], p, true)); pts.push(p.slice()); dirty = true;
      },
      close() { if (pts.length > 2) { L.pin(pts[0]); free = null; } },
      setSpans(list) { spans = list.map(([a, b]) => span(a, b, false)); pts = []; free = null; dirty = true; },
      flash(list, colour = 0xffffff, secs = 1.2) { flashes.push({ spans: list.map(([a, b]) => span(a, b, false)), colour, secs, t: 0 }); dirty = true; },
      get paidM() { let m = 0; for (const S of spans) m += dist(S.a, S.b); if (free) m += dist(free.a, free.b); return m; },
      get points() { return pts.map((p) => p.slice()); },
      update(dt) {
        t += dt;
        for (const S of spans) if (S.amp && S.age < 0.8) { S.age += dt; dirty = true; }
        for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t += dt; dirty = true; if (flashes[i].t >= flashes[i].secs) flashes.splice(i, 1); }
        if (dirty && mesh.visible) draw();
      },
      get visible() { return mesh.visible; },
      set visible(v) { mesh.visible = !!v; if (v) dirty = true; },
      dispose() { G.scene.remove(mesh); mesh.dispose(); mat.dispose(); },
    };
    return L;
  }
  window.__payout = { create };
})();
