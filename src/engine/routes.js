/* Runs view (window.__routes): draws the runs and nodes of a routes system (src/sim/core/routes.js) where they
   ride on their frames. Generic: it knows nothing about what a run carries; content gives the looks.

   INTERFACE
     const view = __routes.attach({
       system = 'routes',                 // name of the routes system in the simulation
       looks: {
         run(run) -> { colour, radiusM }  // a run's colour (hex) and half-width; drawn as a four-sided prism
         node?(node) -> { colour, sizeM } | null     // null: not drawn
         bore?: { todo: hex, done: hex }  // dots where a hole is still to drill, and holes drilled
         ghost?: hex                      // the dashed preview line
       },
       frameMatrix?(frameId) -> THREE.Matrix4 | null   // default: the frame's { x, y, z, yaw } in the routes state
     })
     view.refresh()                       // rebuild now (it also rebuilds by itself when the routes version changes)
     view.pick(R | ray) -> { type: 'run' | 'node' | 'bore', id, index?, point, dist } | null   (nearest along the ray)
     view.ghost(path | null, frameId?)    // a dashed line through frame-local points (world when frameId is null)
     view.xray(on)                        // drawn through walls (depth test off), in the same colours
     view.tint(fn | null)                 // fn(run) -> hex | null: recolour runs (an overlay); null restores the looks
     view.stats() -> { frames, runs, nodes, verts }, view.detach()
   Drawing: one merged mesh per frame (vertex colours), rebuilt only when the routes version changes; a run is drawn
   in full colour as far as it has been pulled (or its lengths fitted) and pale beyond, as a plan line.
   Cost: one version compare per animation frame while attached; nothing else when idle. */
(() => {
  const G = window.__game;
  if (!G || !G.THREE || window.__routes) return;
  const T = G.THREE;
  const views = [];

  function attach(opts = {}) {
    const N = opts.system || 'routes', looks = opts.looks || {};
    const S = () => (G.sim ? G.sim.state.sys[N] : null);
    const api = () => { const d = G.sim && G.sim.systems.find((s) => s.name === N); return d ? d.api : null; };
    if (!S()) return null;
    const mat = new T.MeshLambertMaterial({ vertexColors: true });
    const xmat = new T.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92, fog: false });
    const ghostMat = new T.LineDashedMaterial({ color: looks.ghost || 0xfff1b0, dashSize: 0.12, gapSize: 0.08, depthTest: false, transparent: true, fog: false });
    const root = new T.Group(); root.name = 'routes:' + N;
    G.scene.add(root);
    let meshes = [], drawn = null, simRef = null, xr = false, tintFn = null, ghostLine = null, counts = { frames: 0, runs: 0, nodes: 0, verts: 0 };
    const tmpC = new T.Color(), white = new T.Color(0xffffff);

    const frameMatrix = opts.frameMatrix || ((fid) => {
      const s = S(), f = fid != null && s && s.frames ? s.frames[fid] : null;
      if (fid == null) return new T.Matrix4();
      if (!f) return null;
      return new T.Matrix4().makeRotationY(f.yaw || 0).setPosition(f.x, f.y, f.z);
    });
    const fractionOf = (run) => {
      if (run.legacy || run.state !== 'planned') return 1;
      const cls = (api() && api().classes[run.cls]) || {}, steps = cls.steps || [];
      if (steps.includes('pull')) return Math.max(0, Math.min(1, run.pulled || 0));
      if (steps.includes('seg')) return run.segs ? (run.segsDone | 0) / run.segs : 0;
      return 0;
    };

    // ---------------------------------------------------------------- geometry
    function builder() {
      const pos = [], nor = [], col = [];
      const v = (p, n, c) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); };
      const quad = (a, b, c, d, n, colr) => { v(a, n, colr); v(b, n, colr); v(c, n, colr); v(a, n, colr); v(c, n, colr); v(d, n, colr); };
      const A = new T.Vector3(), B = new T.Vector3(), D = new T.Vector3(), U = new T.Vector3(), W = new T.Vector3(), up = new T.Vector3(0, 1, 0), ax = new T.Vector3(1, 0, 0);
      const corner = [0, 1, 2, 3].map(() => new T.Vector3()), P = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new T.Vector3()), n = new T.Vector3();
      // a square tube from p to q, r across, slightly past both ends so bends close
      function prism(p, q, r, colr) {
        A.set(p[0], p[1], p[2]); B.set(q[0], q[1], q[2]); D.subVectors(B, A);
        const L = D.length(); if (L < 1e-6) return;
        D.divideScalar(L);
        U.crossVectors(D, Math.abs(D.y) < 0.9 ? up : ax).normalize(); W.crossVectors(D, U);
        A.addScaledVector(D, -r * 0.7); B.addScaledVector(D, r * 0.7);
        corner[0].copy(U).multiplyScalar(r); corner[1].copy(W).multiplyScalar(r); corner[2].copy(U).multiplyScalar(-r); corner[3].copy(W).multiplyScalar(-r);
        for (let i = 0; i < 4; i++) {
          const c0 = corner[i], c1 = corner[(i + 1) & 3];
          n.addVectors(c0, c1).normalize();
          P[0].addVectors(A, c0); P[1].addVectors(B, c0); P[2].addVectors(B, c1); P[3].addVectors(A, c1);
          quad(P[0], P[1], P[2], P[3], n, colr);
        }
      }
      const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
      function box(p, s, colr) {
        const h = s / 2;
        for (const [nn, a, b] of F) {
          n.set(nn[0], nn[1], nn[2]);
          const c = [p[0] + nn[0] * h, p[1] + nn[1] * h, p[2] + nn[2] * h], a3 = new T.Vector3(a[0] * h, a[1] * h, a[2] * h), b3 = new T.Vector3(b[0] * h, b[1] * h, b[2] * h);
          A.set(c[0], c[1], c[2]);
          P[0].copy(A).sub(a3).sub(b3); P[1].copy(A).add(a3).sub(b3); P[2].copy(A).add(a3).add(b3); P[3].copy(A).sub(a3).add(b3);
          quad(P[0], P[1], P[2], P[3], n, colr);
        }
      }
      return { pos, nor, col, prism, box, count: () => pos.length / 3 };
    }

    function pathOf(s, run) {
      if (run.path && run.path.length >= 2) return run.path;
      const a = s.nodes[run.a], b = s.nodes[run.b];
      return a && b ? [a.at, b.at] : [];
    }
    // split a path at a fraction of its length: [done part, rest]
    function split(path, f) {
      if (f >= 1) return [path, []];
      if (f <= 0) return [[], path];
      let L = 0; const seg = [];
      for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]); seg.push(d); L += d; }
      let want = L * f;
      for (let i = 0; i < seg.length; i++) {
        if (want <= seg[i]) {
          const k = seg[i] > 0 ? want / seg[i] : 0, a = path[i], b = path[i + 1], m = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          return [[...path.slice(0, i + 1), m], [m, ...path.slice(i + 1)]];
        }
        want -= seg[i];
      }
      return [path, []];
    }

    function clear() {
      for (const m of meshes) { root.remove(m.mesh); m.mesh.geometry.dispose(); }
      meshes = [];
    }
    function rebuild() {
      clear();
      const s = S(); if (!s) { drawn = null; return; }
      simRef = G.sim; drawn = s.version;
      const byFrame = new Map();
      const slot = (fid) => { const k = fid == null ? '' : String(fid); if (!byFrame.has(k)) byFrame.set(k, { fid: fid == null ? null : fid, runs: [], nodes: [] }); return byFrame.get(k); };
      for (const id of Object.keys(s.runs).sort()) slot(s.runs[id].frame).runs.push(s.runs[id]);
      for (const id of Object.keys(s.nodes).sort()) slot(s.nodes[id].frame).nodes.push(s.nodes[id]);
      counts = { frames: 0, runs: 0, nodes: 0, verts: 0 };
      const bl = looks.bore || {};
      const boreTodo = new T.Color(bl.todo ?? 0xffd23a), boreDone = new T.Color(bl.done ?? 0x2a2018);
      for (const F of byFrame.values()) {
        const M = frameMatrix(F.fid);
        if (!M) continue;                                                 // a frame that is gone: its runs are stray
        const g = builder(), ranges = [];
        for (const run of F.runs) {
          const lk = (looks.run && looks.run(run)) || {}, r = lk.radiusM || 0.01, base = new T.Color(lk.colour ?? 0xcccccc), pale = base.clone().lerp(white, 0.55);
          const start = g.count(), [done, rest] = split(pathOf(s, run), fractionOf(run));
          for (let i = 1; i < done.length; i++) g.prism(done[i - 1], done[i], r, base);
          for (let i = 1; i < rest.length; i++) g.prism(rest[i - 1], rest[i], r * 0.6, pale);
          ranges.push({ type: 'run', id: run.id, start, count: g.count() - start, base, run });
          for (let i = 0; i < (run.bores || []).length; i++) {
            const b = run.bores[i], st = g.count();
            g.box(b.at, b.done ? 0.022 : 0.04, b.done ? boreDone : boreTodo);
            ranges.push({ type: 'bore', id: run.id, index: i, start: st, count: g.count() - st, at: b.at, r: 0.06 });
          }
          counts.runs++;
        }
        for (const n of F.nodes) {
          const lk = looks.node ? looks.node(n) : { colour: 0x9a9a9a, sizeM: 0.08 };
          if (!lk) continue;
          const st = g.count();
          g.box(n.at, lk.sizeM || 0.08, new T.Color(lk.colour ?? 0x9a9a9a));
          ranges.push({ type: 'node', id: n.id, start: st, count: g.count() - st, at: n.at, r: Math.max(0.08, (lk.sizeM || 0.08) * 0.8) });
          counts.nodes++;
        }
        if (!g.count()) continue;
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(g.pos, 3));
        geo.setAttribute('normal', new T.Float32BufferAttribute(g.nor, 3));
        geo.setAttribute('color', new T.Float32BufferAttribute(g.col, 3));
        geo.computeBoundingSphere();
        const mesh = new T.Mesh(geo, xr ? xmat : mat);
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(M); mesh.matrixWorldNeedsUpdate = true;
        mesh.renderOrder = xr ? 20 : 0; mesh.frustumCulled = true;
        mesh.userData.routes = N;
        root.add(mesh);
        meshes.push({ mesh, fid: F.fid, ranges, base: Float32Array.from(g.col), M, inv: M.clone().invert() });
        counts.frames++; counts.verts += g.count();
      }
      if (tintFn) applyTint();
    }

    function applyTint() {
      for (const m of meshes) {
        const attr = m.mesh.geometry.attributes.color, a = attr.array;
        a.set(m.base);
        if (tintFn) for (const rg of m.ranges) {
          if (rg.type !== 'run') continue;
          const hex = tintFn(rg.run);
          if (hex == null) continue;
          tmpC.set(hex);
          for (let i = rg.start; i < rg.start + rg.count; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b; }
        }
        attr.needsUpdate = true;
      }
    }

    // ---------------------------------------------------------------- picking
    const lr = new T.Ray(), sa = new T.Vector3(), sb = new T.Vector3(), onRay = new T.Vector3(), onSeg = new T.Vector3(), pt = new T.Vector3();
    function pick(R) {
      const ray = R && R.ray ? (R.ray.ray || R.ray) : R;
      if (!ray || !ray.origin) return null;
      const s = S(); if (!s) return null;
      let best = null;
      const take = (type, id, index, local, m, slack) => {
        const world = local.clone().applyMatrix4(m.M), dist = world.distanceTo(ray.origin);
        if (!best || dist - slack < best.dist) best = { type, id, index, point: world, dist };
      };
      for (const m of meshes) {
        lr.copy(ray).applyMatrix4(m.inv);
        for (const rg of m.ranges) {
          if (rg.type === 'run') {
            const lk = (looks.run && looks.run(rg.run)) || {}, tol = (lk.radiusM || 0.01) + 0.05, path = pathOf(s, rg.run);
            for (let i = 1; i < path.length; i++) {
              sa.fromArray(path[i - 1]); sb.fromArray(path[i]);
              const d2 = lr.distanceSqToSegment(sa, sb, onRay, onSeg);
              if (d2 <= tol * tol) take('run', rg.id, undefined, onSeg.clone(), m, 0);
            }
          } else {
            pt.fromArray(rg.at);
            if (lr.distanceSqToPoint(pt) <= rg.r * rg.r) take(rg.type, rg.id, rg.index, pt.clone(), m, 0.15);   // small things win near a run
          }
        }
      }
      return best;
    }

    // ---------------------------------------------------------------- ghost, x-ray
    function ghost(path, fid = null) {
      if (ghostLine) { root.remove(ghostLine); ghostLine.geometry.dispose(); ghostLine = null; }
      if (!path || path.length < 2) return;
      const M = frameMatrix(fid); if (!M) return;
      const geo = new T.BufferGeometry().setFromPoints(path.map((p) => new T.Vector3(p[0], p[1], p[2])));
      ghostLine = new T.Line(geo, ghostMat);
      ghostLine.computeLineDistances();
      ghostLine.matrixAutoUpdate = false; ghostLine.matrix.copy(M); ghostLine.renderOrder = 21;
      root.add(ghostLine);
    }
    function xray(on) {
      xr = !!on;
      for (const m of meshes) { m.mesh.material = xr ? xmat : mat; m.mesh.renderOrder = xr ? 20 : 0; }
    }

    // ---------------------------------------------------------------- watch
    let alive = true;
    (function watch() {
      if (!alive) return;
      const s = S();
      if (G.sim !== simRef || (s ? s.version : null) !== drawn) rebuild();
      requestAnimationFrame(watch);
    })();

    const view = {
      refresh: rebuild, pick, ghost, xray, get xrayOn() { return xr; },
      tint(fn) { tintFn = typeof fn === 'function' ? fn : null; applyTint(); },
      stats: () => ({ ...counts }),
      group: root,
      detach() { alive = false; clear(); ghost(null); G.scene.remove(root); const i = views.indexOf(view); if (i >= 0) views.splice(i, 1); },
    };
    views.push(view);
    return view;
  }

  window.__routes = { attach, views: () => views.slice() };
})();
