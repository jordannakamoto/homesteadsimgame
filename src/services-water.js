/* Supply plumbing by hand (window.__servicesWater): the manifold, the pressure test and the fixtures, done in the body,
   mouse-aimed within reach (Hands, F). Slice S10 of docs/design/services-roughin.md; the water twin of services-trim.js.
     Stub-out  strapped to the stud and open (an orange ring): click to put a cap on it. Forget one and it sprays.
     Manifold  hold the test pump's handle: the gauge climbs to 690 kPa (100 psi) and holds fifteen minutes, or the needle
               stalls and every open end sprays (red marks, hover for why). A pass hangs a green tag on the manifold.
               Click a line's stop to shut that line. Drag the main's handle a quarter turn to open it: the pipes knock, the
               taps sputter, then run.
     Trim-out  a ready stub-out glows: click to set the fixture on it (the water main goes off while you work), click to
               screw an angle stop on each supply, click to connect each supply line. Then click the faucet (or the toilet's
               handle) to run it, and an angle stop to shut that fixture off.
   The Build panel's per-gesture setting (1x to 4x) is how many stops or lines one click does.
   All of it goes through services.cap, .trim, .check and .valve and water.setTap (src/sim/services.js, water.js): this file
   owns no truth. Cost: hands off, a version compare a frame; meshes are instanced boxes rebuilt only when routes, services
   or the water taps change; streams are a pooled few. */
(() => {
  const G = window.__game, RCH = window.__reach;
  if (!G || !RCH || !G.sim || !G.sim.handlers.has('services.cap')) return;
  const T = G.THREE, P = G.player;
  const RS = () => G.sim.state.sys.routes, SS = () => G.sim.state.sys.services || {}, WS = () => G.sim.state.sys.water || {};
  const api = (n) => { const d = G.sim.systems.find((s) => s.name === n); return d ? d.api : null; };
  const cmd = (n, p) => { try { return G.sim.commandNow(n, p) || { ok: true }; } catch (e) { console.warn('services-water: ' + n + ' failed: ' + e.message); return { ok: false, reason: e.message }; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const gesture = () => { const c = G.sim.state.sys.construction, g = c && c.options && c.options.gesture; return Number.isFinite(g) && g > 0 ? Math.round(g) : 3; };
  const busy = () => !!((window.__servicesPlan && window.__servicesPlan.mode) || (window.__servicesHands && window.__servicesHands.busy) || (window.__servicesTrim && window.__servicesTrim.busy));
  const inReach = (w, extra = 0.3) => Math.hypot(w[0] - P.x, w[2] - P.z) <= RCH.R.reach + extra && w[1] - P.y < 3 + extra && w[1] > P.y - 0.6;
  const itemName = (id) => { const a = api('construction'), it = a && a.catalog && a.catalog[id]; return it ? it.name : id; };
  const why = (r) => (r.reason === 'no material' ? 'Out of ' + itemName(r.itemId).toLowerCase() + ': order the trim-out in the Build panel (L).' : r.reason || 'That did not work.');
  const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);
  const GREEN = 0x5fd06a, RED = 0xff5040, ORANGE = 0xf0a030, STEEL = 0xaab2b8, WHITE = 0xf2f0ea, BLUE = 0x3a7bd5, HOT = 0xd04030;
  const DEVNAME = { sink_kitchen: 'kitchen sink', sink_bath: 'bathroom sink', toilet_flush: 'toilet', shower_indoor: 'shower', tap_hose_bib: 'hose bib' };

  /* ================= what is there ================= */
  let C = null, cKey = '', simRef = null;
  function dirWorld(frame, d) { const f = frame != null ? RS().frames[frame] : null, yaw = f ? f.yaw || 0 : 0, c = Math.cos(yaw), s = Math.sin(yaw); return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c]; }
  // which way a node faces: out of its wall into the room (world), else toward the building's middle
  function facing(n) {
    let nl = null;
    try {
      const ch = G.routes && G.routes.channelsFor(n.frame), wall = ch && n.host && ch.walls.find((x) => x.id === n.host.parent);
      if (wall) { const d = (n.at[0] - wall.o[0]) * wall.n[0] + (n.at[2] - wall.o[1]) * wall.n[1]; const sg = Math.abs(d) > 0.004 ? Math.sign(d) : wall.out ? -wall.out : 1; nl = [wall.n[0] * sg, 0, wall.n[1] * sg]; }
    } catch (e) { /* no channels */ }
    if (!nl) { const l = Math.hypot(n.at[0], n.at[2]) || 1; nl = [-n.at[0] / l, 0, -n.at[2] / l]; if (l < 0.01) nl = [0, 0, 1]; }
    const F = V3(dirWorld(n.frame, nl)); F.y = 0; F.normalize();
    const U = new T.Vector3(0, 1, 0), Rt = new T.Vector3().crossVectors(U, F).normalize();
    return { F, U, Rt };
  }
  const at = (o, x, y, z) => [o.w[0] + o.Rt.x * x + o.U.x * y + o.F.x * z, o.w[1] + o.Rt.y * x + o.U.y * y + o.F.y * z, o.w[2] + o.Rt.z * x + o.U.z * y + o.F.z * z];
  const checkNow = () => { const c = SS().checks || {}; return Object.keys(c).map((f) => f + ':' + ((c[f].water || {}).t || '')).join(); };
  const tapSig = () => { const t = WS().taps || {}; return Object.keys(t).filter((k) => /^sv:/.test(k)).map((k) => k + (t[k].open ? 1 : 0)).join(); };
  function scan(force) {
    const R = RS(), S = SS(), A = api('routes'), SV = api('services');
    if (!R || !A || !SV) return null;
    const key = R.version + ':' + (S.version | 0) + ':' + JSON.stringify(S.valves || {}) + ':' + checkNow() + ':' + tapSig();
    if (!force && C && key === cKey && simRef === G.sim) return C;
    cKey = key; simRef = G.sim;
    const out = { manifolds: [], stubs: [], fixtures: [], leaks: [] }, mans = {};
    const wOf = (n) => A.worldOf(R, n.frame, n.at);
    for (const id of Object.keys(R.nodes).sort()) {
      const n = R.nodes[id];
      if (n.stray || n.state === 'planned') continue;
      if (n.kind === 'manifold') {
        const o = facing(n); o.w = wOf(n);
        const runs = Object.keys(R.runs).sort().map((k) => R.runs[k]).filter((r) => (r.a === id || r.b === id) && !r.stray);
        const lines = runs.filter((r) => (R.nodes[r.a] || {}).kind === 'manifold' && r.a === id).slice(0, 6);
        const ck = S.checks && S.checks[n.frame] && S.checks[n.frame].water;
        const m = { node: id, frame: n.frame, ...o, main: S.valves ? S.valves['n:' + id] !== false : true, tag: !!(ck && ck.pass), lines: lines.map((r, i) => ({ run: r.id, i, open: !(S.valves && S.valves['r:' + r.id] === false), hot: !!(SV.specs[r.spec] || {}).hot, x: -0.13 + i * 0.052 })) };
        m.pump = at(m, 0.17, -0.07, 0.05); m.mainW = at(m, -0.19, 0.02, 0.04);
        for (const l of m.lines) l.w = at(m, l.x, -0.05, 0.055);
        mans[id] = m; out.manifolds.push(m);
        continue;
      }
      if (n.kind !== 'stub_supply') continue;
      const ti = SV.waterTrimInfo(R, n, S.deferred);
      if (!ti) continue;
      const o = facing(n); o.w = wOf(n);
      const prim = ti.hotOf ? R.nodes[ti.hotOf] : null;
      const dev = prim ? (prim.set && prim.set.device) || ti.device : (n.set && n.set.device) || ti.device;
      const st = { node: id, frame: n.frame, ...o, ti, dev, capped: !!(n.set && n.set.capped === true), trimmed: n.state === 'trimmed', hot: !!prim, ports: ti.ports };
      out.stubs.push(st);
      if (!prim && (ti.done.fix > 0 || ti.trimmed)) {
        const sm = (SV.waterDevices[dev] || {}).ports || ['in'];
        const stubM = (SV.devices[dev] || {}).stubM || 0, base = { ...o, w: [o.w[0], o.w[1] - stubM, o.w[2]] };
        const mate = ti.mate ? R.nodes[ti.mate] : null;
        out.fixtures.push({ node: id, dev, base, stub: st, mate: mate ? { node: mate.id, w: wOf(mate) } : null, ports: sm, tap: 'sv:' + id, stops: ti.done.stop, lines: ti.done.line, trimmed: ti.trimmed,
          stopOpen: S.valves ? S.valves['n:' + id] !== false : true });
      }
    }
    // red marks from the last pressure test
    for (const [f, ck] of Object.entries(S.checks || {})) {
      const c = ck.water; if (!c || performance.now() - (markT[f] || 0) > 14000) continue;
      for (const q of [...c.leaks, ...c.faults]) if (q.w) out.leaks.push({ frame: f, why: q.why, w: q.w });
    }
    C = out; draw();
    return C;
  }
  const markT = {};

  /* ================= the scene bits ================= */
  const root = new T.Group(); root.name = 'services-water'; G.scene.add(root);
  const lam = (c) => new T.MeshLambertMaterial({ color: c });
  const unit = new T.BoxGeometry(1, 1, 1);
  const glowMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, blending: T.AdditiveBlending });
  const inst = (n, mat) => { const m = new T.InstancedMesh(unit, mat, n); m.count = 0; m.frustumCulled = false; m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3); root.add(m); return m; };
  const parts = inst(600, lam(0xffffff)), ghost = inst(24, glowMat.clone()), marks = new T.InstancedMesh(new T.SphereGeometry(0.035, 10, 8), glowMat.clone(), 32);
  ghost.renderOrder = 30; marks.count = 0; marks.frustumCulled = false; marks.material.color.set(RED); marks.renderOrder = 30; root.add(marks);
  const aim = new T.Mesh(new T.TorusGeometry(0.07, 0.011, 6, 24), glowMat.clone()); aim.renderOrder = 31; aim.visible = false; root.add(aim);
  const needle = new T.Mesh(unit, lam(0xd03020)); needle.visible = false; root.add(needle);
  const waterMat = new T.MeshBasicMaterial({ color: 0x8fcdf5, transparent: true, opacity: 0.75, fog: false });
  const streams = []; for (let i = 0; i < 8; i++) { const m = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 1, 6), waterMat); m.visible = false; root.add(m); streams.push(m); }
  const M4 = new T.Matrix4(), Q = new T.Quaternion(), S3 = new T.Vector3(), PV = new T.Vector3(), Cc = new T.Color(), X = new T.Vector3(), Y = new T.Vector3(), Z = new T.Vector3();
  let np = 0;
  function put(m, i, p, ax, ay, az, sx, sy, sz) { M4.makeBasis(ax, ay, az); Q.setFromRotationMatrix(M4); M4.compose(PV.set(p[0], p[1], p[2]), Q, S3.set(sx, sy, sz)); m.setMatrixAt(i, M4); }
  // a box in an object's own axes (x across, y up, z out of the wall), centred at (x, y, z), sized (w, h, d), coloured
  function bx(o, x, y, z, w, h, d, col) { if (np >= 600) return; put(parts, np, at(o, x, y, z), o.Rt, o.U, o.F, w, h, d); parts.setColorAt(np++, Cc.set(col)); }
  function seg(a, b, r, col) {                          // a thin box from a to b
    if (np >= 600) return;
    Z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const l = Z.length(); if (l < 1e-4) return;
    Z.divideScalar(l); X.set(0, 1, 0); if (Math.abs(Z.y) > 0.95) X.set(1, 0, 0);
    Y.crossVectors(Z, X).normalize(); X.crossVectors(Y, Z).normalize();
    put(parts, np, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], X, Y, Z, r, r, l); parts.setColorAt(np++, Cc.set(col));
  }
  // the shapes of the fixtures, in the fixture's axes from its base on the floor
  const SHAPES = {
    sink_kitchen: (o) => { bx(o, 0, 0.42, 0.29, 0.8, 0.84, 0.56, 0xc8b08a); bx(o, 0, 0.855, 0.29, 0.84, 0.03, 0.6, 0xb8bec2); bx(o, 0, 0.865, 0.3, 0.6, 0.02, 0.38, 0x6a7076); bx(o, 0, 0.95, 0.08, 0.025, 0.19, 0.025, STEEL); bx(o, 0, 1.03, 0.16, 0.02, 0.02, 0.18, STEEL); },
    sink_bath: (o) => { bx(o, 0, 0.4, 0.1, 0.12, 0.8, 0.1, WHITE); bx(o, 0, 0.82, 0.2, 0.5, 0.1, 0.4, WHITE); bx(o, 0, 0.9, 0.08, 0.02, 0.1, 0.02, STEEL); bx(o, 0, 0.95, 0.14, 0.02, 0.02, 0.12, STEEL); },
    toilet_flush: (o) => { bx(o, 0, 0.2, 0.3, 0.34, 0.4, 0.46, WHITE); bx(o, 0, 0.43, 0.3, 0.38, 0.04, 0.5, 0xe4e2dc); bx(o, 0, 0.6, 0.1, 0.38, 0.4, 0.18, WHITE); bx(o, 0.14, 0.78, 0.1, 0.03, 0.03, 0.03, STEEL); },
    shower_indoor: (o) => { bx(o, 0, 1.6, 0.03, 0.025, 0.8, 0.025, STEEL); bx(o, 0, 2.0, 0.17, 0.02, 0.02, 0.3, STEEL); bx(o, 0, 1.97, 0.3, 0.14, 0.03, 0.14, STEEL); bx(o, 0, 1.2, 0.05, 0.09, 0.09, 0.05, 0xd8dadc); },
    tap_hose_bib: (o) => { bx(o, 0, 0, 0.05, 0.05, 0.05, 0.1, 0xc9a13b); bx(o, 0, 0.04, 0.1, 0.06, 0.015, 0.015, 0xb02020); },
  };
  const outletOf = (f) => { const o = f.base, h = { sink_kitchen: [1.03, 0.25], sink_bath: [0.95, 0.2], shower_indoor: [2.0, 0.3], tap_hose_bib: [0.02, 0.12], toilet_flush: null }[f.dev]; return h ? at(o, 0, h[0] - 0.02, h[1]) : null; };
  const faucetW = (f) => outletOf(f) || at(f.base, 0.14, 0.8, 0.1);   // a toilet's handle sits on the tank

  function draw() {
    if (!C) return;
    np = 0;
    let ng = 0, nm = 0;
    for (const m of C.manifolds) {
      bx(m, 0, 0, 0.04, 0.34, 0.05, 0.07, 0xc9a13b);
      for (const l of m.lines) {
        bx(m, l.x, -0.035, 0.04, 0.012, 0.03, 0.012, 0xc9a13b);
        bx(m, l.x, -0.065, 0.055, l.open ? 0.012 : 0.04, 0.012, l.open ? 0.04 : 0.012, l.hot ? HOT : BLUE);
      }
      const mv = m.main;
      bx(m, -0.19, 0, 0.04, 0.05, 0.05, 0.05, 0xc9a13b);
      bx(m, -0.19, 0.04, 0.04, mv ? 0.012 : 0.08, 0.012, mv ? 0.08 : 0.012, mv ? GREEN : RED);   // a quarter turn: along the pipe is open
      bx(m, 0.17, -0.07, 0.05, 0.05, 0.05, 0.03, 0x30363a);                                      // the gauge's port
      if (m.tag) bx(m, 0.1, -0.1, 0.01, 0.04, 0.06, 0.004, 0x3fb04e);
    }
    for (const s of C.stubs) {
      if (s.trimmed && !s.hot) continue;
      if (s.hot && s.trimmed) continue;
      if (s.capped) bx(s, 0, 0, 0.04, 0.034, 0.034, 0.06, STEEL);
      else if (s.hot || !s.ti.done.fix) { bx(s, 0, 0, 0.04, 0.026, 0.026, 0.06, 0xd8d8d0); if (ng < 24) { put(ghost, ng, [s.w[0], s.w[1], s.w[2]], s.Rt, s.U, s.F, 0.07, 0.07, 0.07); ghost.setColorAt(ng++, Cc.set(ORANGE)); } }
    }
    for (const f of C.fixtures) {
      SHAPES[f.dev] && SHAPES[f.dev](f.base);
      const stubs = [f.stub, ...(f.mate ? [{ w: f.mate.w, ...f.stub, hot: true }] : [])];
      stubs.forEach((st, k) => {
        const w = k === 0 ? f.stub.w : f.mate.w, inlet = at(f.base, k === 0 ? -0.05 : 0.05, (f.stub.w[1] - f.base.w[1]) - 0.15, 0.2);
        if (f.stops > k) {
          const sp = [w[0] + f.stub.F.x * 0.05, w[1], w[2] + f.stub.F.z * 0.05];
          bx({ ...f.stub, w: sp }, 0, 0, 0, 0.04, 0.04, 0.05, STEEL);
          bx({ ...f.stub, w: sp }, 0, 0, 0.035, f.stopOpen ? 0.012 : 0.04, 0.012, f.stopOpen ? 0.04 : 0.012, f.stopOpen ? GREEN : RED);
          if (f.lines > k) seg(sp, inlet, 0.012, k === 1 ? HOT : 0x9aa6b0);
        }
      });
    }
    parts.count = np; parts.instanceMatrix.needsUpdate = true; parts.instanceColor.needsUpdate = true;
    ghost.count = ng; ghost.instanceMatrix.needsUpdate = true; ghost.instanceColor.needsUpdate = true;
    for (const f of C.leaks) if (nm < 32) { M4.makeTranslation(f.w[0], f.w[1], f.w[2]); marks.setMatrixAt(nm++, M4); }
    marks.count = nm; marks.instanceMatrix.needsUpdate = true;
  }

  /* ================= aiming ================= */
  let act = null, hovered = null, test = null, knockT = 0;
  const sputter = new Map();                                // fixture node -> seconds of sputter left
  const tol = (t, base) => base + t * 0.008;
  function findHit(R) {
    const c = scan(); if (!c) return null;
    let best = null, far = null;
    const consider = (sv, obj, w, base, any) => {
      const { d, t } = R.rayDist(w[0], w[1], w[2]);
      if (d > tol(t, base)) return;
      if (!any && !inReach(w)) { if (!far || d < far.d) far = { d, w }; return; }
      if (!best || d < best.score) best = { sv, obj, score: d, x: w[0], y: w[1], z: w[2], w };
    };
    for (const m of c.manifolds) {
      consider('main', m, m.mainW, 0.05); consider('pump', m, m.pump, 0.05);
      for (const l of m.lines) consider('line', { m, l }, l.w, 0.03);
    }
    for (const s of c.stubs) {
      if (s.trimmed) continue;
      if (!s.capped && (s.hot || (!s.ti.done.fix && s.ti.ready))) consider('cap', s, s.w, 0.07);
      if (!s.hot && s.ti.ready && (s.capped || s.ti.done.fix > 0)) consider('fix', s, s.w, 0.08);
    }
    for (const f of c.fixtures) if (f.trimmed) { consider('tap', f, faucetW(f), 0.09); consider('stop', f, f.stub.w, 0.05); }
    for (const f of c.leaks) consider('fault', f, f.w, 0.06, true);
    if (best) return best;
    if (far) return { sv: 'far', score: 0.45 + far.d, x: far.w[0], y: far.w[1], z: far.w[2], w: far.w };
    return null;
  }
  const nowFlow = (f) => { const t = (WS().taps || {})[f.tap]; return t ? t.flowLmin : 0; };
  function hintFor(h) {
    const g = gesture(), T_ = api('services').waterTrimText;
    if (h.sv === 'far') return 'Too far to reach: walk closer.';
    if (h.sv === 'cap') return 'This stub-out is open: it will spray when the water is on.  <b>Click</b> to cap it';
    if (h.sv === 'fix') {
      const s = h.obj, ti = s.ti, nm = DEVNAME[s.dev] || 'fixture', left = ti.units[ti.next] - ti.done[ti.next];
      if (ti.next === 'fix') return '<b>Click</b> to set the ' + esc(nm) + ' on its stub-out' + (s.ti.mate ? ' (cold and hot)' : '') + '  <i>the main goes off while you work</i>';
      if (ti.next === 'stop') return '<b>Click</b> to screw an angle stop onto the stub-out (' + left + ' to go, ' + Math.min(g, left) + ' a click)';
      if (ti.next === 'line') return '<b>Click</b> to connect a supply line from the stop to the ' + esc(nm) + ' (' + left + ' to go, ' + Math.min(g, left) + ' a click)';
    }
    if (h.sv === 'tap') { const f = h.obj, q = nowFlow(f), open = !!((WS().taps || {})[f.tap] || {}).open; return DEVNAME[f.dev] + ': <b>click</b> to turn it ' + (open ? 'off' : 'on') + (open && q <= 0 ? '  <i>no water yet: is the main open?</i>' : ''); }
    if (h.sv === 'stop') return 'Angle stop: ' + (h.obj.stopOpen ? 'open' : '<b>shut</b>') + '.  <b>Click</b> to turn it ' + (h.obj.stopOpen ? 'off' : 'on');
    if (h.sv === 'line') return 'Line ' + (h.obj.l.i + 1) + ' stop: ' + (h.obj.l.open ? 'open' : '<b>shut</b>') + '.  <b>Click</b> to turn it ' + (h.obj.l.open ? 'off' : 'on');
    if (h.sv === 'main') return 'The main: ' + (h.obj.main ? 'open' : '<b>shut</b>') + '.  <b>Drag</b> the handle a quarter turn to ' + (h.obj.main ? 'shut it' : 'open it');
    if (h.sv === 'pump') return '<b>Hold</b> to pump the test gauge up to 690 kPa (100 psi) and see whether it holds';
    if (h.sv === 'fault') return '<span style="color:#ff8a70">Pressure test:</span> ' + esc(h.obj.why);
    return '';
  }

  /* ================= gestures ================= */
  function doTrim(R, s, n) {
    const r = cmd('services.trim', { node: s.node, n });
    if (!r.ok) { R.say(why(r), 2.8); return; }
    G.markStockDirty && G.markStockDirty();
    const nm = DEVNAME[s.dev] || 'fixture';
    if (r.step === 'fix') { R.pose(-1.5, -1.5, 0.1, 0.2); G.cam.shake = Math.min(G.cam.shake + 0.05, 0.3); G.burst(s.w[0], s.w[1], s.w[2], 5, 0xe8e4d4, 0.5, 0.5, 0.02, 0.3); R.say('The ' + nm + ' is set on its stub-out.' + (r.mainClosed && r.mainClosed.length ? '  Main shut while you work.' : '') + '  Now the stops.', 2.8); }
    else if (r.step === 'stop') { R.pose(-1.3, -1.3, 0.06, 0.2); G.burst(s.w[0], s.w[1], s.w[2], 3, STEEL, 0.4, 0.4, 0.012, 0.25); R.say((r.did[0].n === 1 ? 'Stop' : r.did[0].n + ' stops') + ' on.' + (r.next ? '  Now the supply lines.' : ''), 1.8); }
    else if (r.step === 'line') { R.pose(-1.2, -1.2, 0.06, 0.2); G.burst(s.w[0], s.w[1], s.w[2], 3, 0xaab6c0, 0.4, 0.4, 0.012, 0.25); R.say('Supply line' + (r.did[0].n > 1 ? 's' : '') + ' connected.', 1.6); }
    if (r.trimmed) {
      G.burst(s.w[0], s.w[1], s.w[2], 7, GREEN, 0.6, 0.8, 0.02, 0.35);
      R.say('The ' + nm + ' is in.  Open the main at the manifold, then run it.', 3.2);
    }
    scan(true);
  }
  RCH.use({
    id: 'services-water',
    near(px, pz) {
      const c = scan(); if (!c) return false;
      const by = (w) => Math.hypot(w[0] - px, w[2] - pz) < 6;
      return c.manifolds.some((m) => by(m.w)) || c.stubs.some((s) => !s.trimmed && !s.hot && s.ti.ready && by(s.w)) || c.fixtures.some((f) => f.trimmed && by(f.stub.w));
    },
    hover(R) {
      if (R.held || busy()) { hovered = null; return null; }
      const h = findHit(R); hovered = h;
      if (h) h.hint = hintFor(h);
      return h;
    },
    press(hit, R) {
      if (hit.sv === 'far') { R.say('Too far to reach: walk closer.', 1.5); return; }
      if (hit.sv === 'fault') { R.say(hit.obj.why, 3); return; }
      if (hit.sv === 'cap') {
        const r = cmd('services.cap', { node: hit.obj.node });
        if (r.ok) { G.markStockDirty && G.markStockDirty(); R.pose(-1.5, -1.2, 0.08, 0.15); G.burst(hit.w[0], hit.w[1], hit.w[2], 3, STEEL, 0.4, 0.3, 0.012, 0.2); }
        R.say(r.ok ? 'Capped.' : why(r), r.ok ? 1.4 : 2.8); scan(true); return;
      }
      if (hit.sv === 'fix') { doTrim(R, hit.obj, gesture()); return; }
      if (hit.sv === 'tap') {
        const f = hit.obj, t = (WS().taps || {})[f.tap], open = !(t && t.open);
        cmd('water.setTap', { id: f.tap, open });
        R.pose(-1.3, -0.9, 0.05, 0.15);
        if (open) {
          sputter.set(f.node, 0.8);
          const w = faucetW(f); G.burst(w[0], w[1], w[2], 3, 0xdfe6ea, 0.5, 0.3, 0.03, 0.25);
          if (cmd('services.note', { key: 'water:first-tap' }).first) setTimeout(() => { if (nowFlow(f) > 0) R.beat('Running water!'); }, 900);
          R.say(DEVNAME[f.dev] + ' on.', 1.4);
        } else R.say(DEVNAME[f.dev] + ' off.', 1.2);
        scan(true); return;
      }
      if (hit.sv === 'stop' || hit.sv === 'line') {
        const r = hit.sv === 'stop' ? cmd('services.valve', { node: hit.obj.node }) : cmd('services.valve', { run: hit.obj.l.run });
        if (r.ok) { R.pose(-1.4, -0.9, 0.05, 0.15); G.burst(hit.w[0], hit.w[1], hit.w[2], 2, r.on ? GREEN : RED, 0.3, 0.2, 0.01, 0.15); }
        R.say(r.ok ? (r.on ? 'Open.' : 'Shut.') : why(r), 1.4); scan(true); return;
      }
      if (hit.sv === 'main') { act = { kind: 'main', hit, m: hit.obj, dx: 0, dy: 0 }; return; }
      if (hit.sv === 'pump') { act = { kind: 'pump', hit, m: hit.obj, t: 0 }; return; }
    },
    move(hit, R) { if (act) { act.dx = R.ptr.dx; act.dy = R.ptr.dy; } },
    release(hit, R, cancelled) {
      const a = act; act = null;
      if (!a || cancelled) return;
      if (a.kind === 'main') {
        if (Math.hypot(a.dx, a.dy) < 22) { R.say('Drag the handle round a quarter turn.', 1.6); return; }
        const r = cmd('services.valve', { node: a.m.node, on: !a.m.main });
        if (!r.ok) { R.say(why(r), 2.4); return; }
        R.pose(-2.0, -1.0, 0.1, 0.2); if (G.juice) G.juice.hitStop = 0.05;
        if (r.knock) knock(R, a.m, r.first);
        else R.say(r.on ? 'Main open.' : 'Main shut: nothing past it has water.', 2.2);
        scan(true);
      }
      if (a.kind === 'pump' && !test) R.say('Hold until the pump is working.', 1.4);
    },
    wheel() { return false; },
    secondary() { return false; },
    frame(dt, R) {
      const c = scan(); if (!c) return;
      if (act && act.kind === 'pump') {
        act.t += dt; R.pose(-1.2 - Math.sin(act.t * 14) * 0.5, -1.2, 0.08, 0.1); R.face(act.m.w[0], act.m.w[2]);
        if (act.hit) act.hit.hintDown = 'Pumping...  keep holding';
        if (act.t > 0.9 && !test) startTest(R, act.m);
      }
      if (test) tickTest(dt, R);
      if (knockT > 0) { knockT -= dt; if (knockT <= 0) G.cam.shake = Math.min(G.cam.shake + 0.1, 0.35); }
      tickStreams(dt);
      const h = !act && R.on && !busy() ? hovered : null;
      if (h && h.sv !== 'far') {
        aim.visible = true; aim.position.set(h.w[0], h.w[1], h.w[2]); aim.lookAt(G.camera.position);
        aim.scale.setScalar((h.sv === 'line' || h.sv === 'stop' ? 0.5 : 1) * (1 + Math.sin(performance.now() / 160) * 0.12));
        aim.material.color.set(h.sv === 'fault' ? RED : h.sv === 'cap' ? ORANGE : 0x8fc0ff);
      } else aim.visible = false;
      if (ghost.count) ghost.material.opacity = 0.35 + 0.3 * Math.sin(performance.now() / 200);
    },
    leave() { act = null; hovered = null; aim.visible = false; },
  });

  /* ================= the main opened: knock, sputter, run ================= */
  function knock(R, m, first) {
    knockT = 0.25;
    G.cam.shake = Math.min(G.cam.shake + 0.12, 0.35);
    for (const l of m.lines) G.burst(l.w[0], l.w[1], l.w[2], 2, 0xe8e4d4, 0.4, 0.3, 0.03, 0.25);   // the pipes knock as the water hits the air
    for (const f of C ? C.fixtures : []) sputter.set(f.node, 1.6);
    R.say('The pipes knock as the water comes in' + (first ? '.  Run a tap: it sputters until the air is out.' : '.'), 3.4);
    if (first) { cmd('services.note', { key: 'water:first-flow' }); R.beat('Water on!'); }
  }

  /* ================= the pressure test ================= */
  function startTest(R, m) {
    const r = cmd('services.check', { structId: m.frame, kind: 'water' });
    if (!r.ok) { R.say(why(r), 2.8); act = null; return; }
    markT[m.frame] = performance.now();
    test = { m, r, t: 0 };
    needle.visible = true;
    scan(true);
    R.say('Pumping the gauge up...', 1.5);
  }
  function tickTest(dt, R) {
    const m = test.m, r = test.r, peak = r.peakKPa, k = clamp(test.t / 2.4, 0, 1);
    test.t += dt;
    const kPa = peak * (1 - Math.pow(1 - k, 2)) * (r.pass ? 1 : 1) + (r.pass ? 0 : Math.sin(test.t * 5) * 2);
    const gp = at(m, 0.17, -0.07, 0.075), a = (kPa / r.testKPa) * Math.PI * 1.5 - Math.PI * 0.75;
    needle.position.set(gp[0], gp[1], gp[2]); needle.scale.set(0.006, 0.05, 0.006);
    needle.quaternion.setFromAxisAngle(m.F, -a);
    if (!r.pass && Math.floor(test.t * 8) !== Math.floor((test.t - dt) * 8)) for (const q of r.leaks) G.burst(q.w[0], q.w[1], q.w[2], 3, 0xbfe3fa, 0.9, 0.6, 0.04, 0.3);
    R.pose(-1.2 - Math.sin(test.t * 14) * 0.4, -1.2, 0.08, 0.1);
    if (test.t > 2.4 + (r.pass ? 1.4 : 1.8)) {
      if (r.pass) { R.say('690 kPa and the needle holds: fifteen minutes, no drop.  A green tag on the manifold.', 3.6); if (cmd('services.note', { key: 'water:tested' }).first) R.beat('Tested!'); }
      else R.say((r.leaks.length + r.faults.length) + ' fault' + (r.leaks.length + r.faults.length === 1 ? '' : 's') + ': the needle will not rise.  Hover the red marks for what is wrong.', 3.8);
      test = null; needle.visible = false; act = null; scan(true);
    }
  }

  /* ================= streams from running taps, sputtering at first ================= */
  function tickStreams(dt) {
    let i = 0;
    const c = C, W = WS(), t = performance.now() / 1000;
    if (c) for (const f of c.fixtures) {
      if (!f.trimmed || i >= streams.length) continue;
      const tp = (W.taps || {})[f.tap], q = tp && tp.open ? tp.flowLmin : 0;
      let sp = sputter.get(f.node) || 0;
      if (sp > 0) { sp -= dt; sputter.set(f.node, sp); }
      const o = outletOf(f); if (!o) continue;
      if (q > 0.05 && !(sp > 0.3 && Math.sin(t * 40) > 0)) {
        const s = streams[i++], len = Math.max(0.1, o[1] - (f.base.w[1] + (f.dev === 'shower_indoor' ? 0 : 0.9)) + 0.04);
        s.visible = true; s.position.set(o[0], o[1] - len / 2, o[2]); s.scale.set(clamp(0.01 + q * 0.003, 0.012, 0.04), len, clamp(0.01 + q * 0.003, 0.012, 0.04));
      }
    }
    for (; i < streams.length; i++) streams[i].visible = false;
    // spray from real leaks the water network reports (an open end the supply reaches)
    if (c && W.leaks && Math.floor(t * 6) !== lastSpray) {
      lastSpray = Math.floor(t * 6);
      for (const [id, lk] of Object.entries(W.leaks)) if (/^sv:leak:/.test(id) && lk.flowLmin > 0.01 && Math.hypot(lk.x - P.x, lk.z - P.z) < 18) G.burst(lk.x, lk.y, lk.z, 3, 0xbfe3fa, 0.9, 0.6, 0.04, 0.3);
    }
  }
  let lastSpray = 0;

  /* ================= console ================= */
  const _s = new T.Vector3();
  const screen = (x, y, z) => { _s.set(x, y, z).project(G.camera); const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + (_s.x * 0.5 + 0.5) * r.width, y: r.top + (-_s.y * 0.5 + 0.5) * r.height }; };
  function targets() {
    const c = scan(true); if (!c) return null;
    return {
      cap: c.stubs.filter((s) => !s.trimmed && !s.capped && (s.hot || (!s.ti.done.fix && s.ti.ready))).map((s) => ({ node: s.node, w: s.w })),
      fix: c.stubs.filter((s) => !s.trimmed && !s.hot && s.ti.ready && (s.capped || s.ti.done.fix > 0)).map((s) => ({ node: s.node, next: s.ti.next, w: s.w })),
      tap: c.fixtures.filter((f) => f.trimmed).map((f) => ({ node: f.node, dev: f.dev, w: faucetW(f) })),
      stop: c.fixtures.filter((f) => f.trimmed).map((f) => ({ node: f.node, open: f.stopOpen, w: f.stub.w })),
      main: c.manifolds.map((m) => ({ node: m.node, open: m.main, w: m.mainW })),
      line: c.manifolds.flatMap((m) => m.lines.map((l) => ({ run: l.run, open: l.open, w: l.w }))),
      pump: c.manifolds.map((m) => ({ node: m.node, tag: m.tag, w: m.pump })),
    };
  }
  window.__servicesWater = {
    targets, screen,
    where(kind, i = 0) { const t = targets(); const o = t && (t[kind] || [])[i]; return o ? { ...o, screen: screen(o.w[0], o.w[1], o.w[2]) } : null; },
    streams: () => streams.filter((s) => s.visible).length,
    get busy() { return act ? act.kind : test ? 'test' : null; },
  };
})();
