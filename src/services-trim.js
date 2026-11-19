/* Electrical trim-out by hand (window.__servicesTrim): what goes into the boxes and the panel once the walls are finished,
   done in the body, mouse-aimed within reach (Hands, F). Slice S9b of docs/design/services-roughin.md.
     Box     the cable ends hang out of a roughed-in box.  Click to strip them (copper shows), then drag from the box to land
             each one's wires on the device's screws (the outlet, switch or light comes off the stacks with the first),
             click to fold the device in and screw it, click again for the plate (a light: its shade). Before the first
             wire is on, the wheel changes what goes in (outlet, switch, wall light).
     Panel   click an empty slot (it pulses) to press a breaker onto the bus bar; the main goes off while you work. Drag the
             main's handle up to throw it: the lights come on one after another along each circuit. Click a breaker to
             switch it off or on. A tripped one sits mid-throw, says why on hover, and a click throws it back on.
     Tester  hold on the tester under the panel: a light hops box to box along every circuit, green where the cable is
             through, red where it is not; the red marks stay a while and name the cause on hover. A pass hangs a green
             tag on the panel.
     Switch  click a wall switch: the lights after it on the cable go off or on.
   The Build panel's per-gesture setting (1x to 4x) is how many ends one click strips or one drag lands, how many breakers
   one click presses in, and from 2x a fold click also puts the plate on.
   All of it goes through services.trim, .device, .main, .breaker, .flip and .check (src/sim/services.js): this file owns no
   truth. Content (it knows outlets and breakers); reaches the game through __reach, __game and __build.piece.
   Cost: hands off, a version compare and a look at the lamps a frame; meshes are a few instanced boxes rebuilt only when
   the routes, the services or a breaker change. Lamps glow by an emissive (unlit) lens; one pooled point light, always in
   the scene (so the light count never changes), sits at the nearest lit lamp. */
(() => {
  const G = window.__game, RCH = window.__reach;
  if (!G || !RCH || !G.sim || !G.sim.handlers.has('services.trim')) return;
  const T = G.THREE, P = G.player;
  const RS = () => G.sim.state.sys.routes, SS = () => G.sim.state.sys.services || {}, ES = () => G.sim.state.sys.electrical || {};
  const api = (n) => { const d = G.sim.systems.find((s) => s.name === n); return d ? d.api : null; };
  const cmd = (n, p) => { try { return G.sim.commandNow(n, p) || { ok: true }; } catch (e) { console.warn('services-trim: ' + n + ' failed: ' + e.message); return { ok: false, reason: e.message }; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const gesture = () => { const c = G.sim.state.sys.construction, g = c && c.options && c.options.gesture; return Number.isFinite(g) && g > 0 ? Math.round(g) : 3; };
  const planBusy = () => !!(window.__servicesPlan && window.__servicesPlan.mode);
  const handsBusy = () => !!(window.__servicesHands && window.__servicesHands.busy);
  const inReach = (w, extra = 0.3) => Math.hypot(w[0] - P.x, w[2] - P.z) <= RCH.R.reach + extra && w[1] - P.y < 3 + extra && w[1] > P.y - 0.6;
  const itemName = (itemId) => { const a = api('construction'), it = a && a.catalog && a.catalog[itemId]; return it ? it.name : itemId; };
  const why = (r) => (r.reason === 'no material' ? 'Out of ' + itemName(r.itemId).toLowerCase() + ': order the trim-out in the Build panel (L).' : r.reason || 'That did not work.');
  const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);
  const GREEN = 0x5fd06a, RED = 0xff5040, COPPER = 0xd0844a, IVORY = 0xefe9dc;

  /* ================= what is there: read from the routes, services and electrical, rebuilt when they change ================= */
  let C = null, cKey = '', simRef = null, tripT = 0, tripSig = '';
  const DEVNAME = (d) => ((api('services').devices[d] || {}).name || 'device').toLowerCase();
  function dirWorld(frame, d) {                              // a direction in a frame, turned into the world
    const f = frame != null ? RS().frames[frame] : null, yaw = f ? f.yaw || 0 : 0, c = Math.cos(yaw), s = Math.sin(yaw);
    return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
  }
  // a box's face: centre, and its axes (F out of the wall or down from the ceiling, U up the face, Rt across it)
  function faceOf(n, A) {
    const w = A.worldOf(RS(), n.frame, n.at);
    if (n.kind === 'box_ceiling') return { w: [w[0], w[1] - 0.05, w[2]], F: V3([0, -1, 0]), U: V3(dirWorld(n.frame, [1, 0, 0])), Rt: null };
    let nl = null;
    try {
      const ch = G.routes && G.routes.channelsFor(n.frame), wall = ch && n.host && ch.walls.find((x) => x.id === n.host.parent);
      if (wall) { const d = (n.at[0] - wall.o[0]) * wall.n[0] + (n.at[2] - wall.o[1]) * wall.n[1]; const sg = Math.abs(d) > 0.004 ? Math.sign(d) : wall.out ? -wall.out : 1; nl = [wall.n[0] * sg, 0, wall.n[1] * sg]; }
    } catch (e) { /* no channels: face the player */ }
    const F = nl ? V3(dirWorld(n.frame, nl)) : new T.Vector3(P.x - w[0], 0, P.z - w[2]);
    F.y = 0; F.normalize();
    return { w: [w[0] + F.x * 0.045, w[1], w[2] + F.z * 0.045], F, U: new T.Vector3(0, 1, 0), Rt: null };
  }
  const axes = (o) => { if (!o.Rt) o.Rt = new T.Vector3().crossVectors(o.U, o.F).normalize(); return o; };
  const at = (o, x, y, z) => [o.w[0] + o.Rt.x * x + o.U.x * y + o.F.x * z, o.w[1] + o.Rt.y * x + o.U.y * y + o.F.y * z, o.w[2] + o.Rt.z * x + o.U.z * y + o.F.z * z];
  // the panel a slot is on: the equipment piece's face, or the slot itself for one bound to nothing
  function panelOf(n, A) {
    const SV = api('services'), key = SV.panelKey(n), pc = n.ref && window.__build && window.__build.piece ? window.__build.piece(n.ref.piece) : null;
    if (pc) {
      const yaw = pc.yawRad || 0, F = V3([Math.sin(yaw), 0, Math.cos(yaw)]), h = pc.height || 0.6, d = pc.depth || 0.1;
      return axes({ key, piece: pc.id, w: [pc.a.x + F.x * d / 2, pc.y0 + h / 2, pc.a.z + F.z * d / 2], F, U: V3([0, 1, 0]), h, wd: pc.width || 0.36, frame: n.frame, slots: [] });
    }
    const w = A.worldOf(RS(), n.frame, n.at), F = new T.Vector3(P.x - w[0], 0, P.z - w[2]).normalize();
    return axes({ key, piece: null, w, F, U: V3([0, 1, 0]), h: 0.6, wd: 0.36, frame: n.frame, slots: [] });
  }
  function tripsNow() { const B = ES().breakers || {}; return Object.keys(B).filter((k) => B[k].tripped).sort().join(','); }
  function scan(force) {
    const R = RS(), S = SS(), A = api('routes'), SV = api('services');
    if (!R || !A || !SV) return null;
    const key = R.version + ':' + (S.version | 0) + ':' + JSON.stringify(S.mains || {}) + ':' + tripSig + ':' + Object.keys(S.checks || {}).map((f) => f + (S.checks[f].power ? S.checks[f].power.t : '')).join();
    if (!force && C && key === cKey && simRef === G.sim) return C;
    cKey = key; simRef = G.sim;
    const out = { boxes: [], panels: [], lamps: [], depth: {}, faults: [] };
    const pan = new Map();
    for (const id of Object.keys(R.nodes).sort()) {
      const n = R.nodes[id];
      if (n.stray || (n.kind !== 'slot' && n.kind !== 'box' && n.kind !== 'box_ceiling')) continue;
      const ti = SV.trimInfo(R, n, S.deferred);
      if (!ti || !ti.ends.length) continue;
      if (n.kind === 'slot') {
        const k = SV.panelKey(n);
        if (!pan.has(k)) pan.set(k, panelOf(n, A));
        const p = pan.get(k), port = n.ref ? n.ref.port : 'b' + (p.slots.length + 1), idx = Math.max(0, (parseInt(String(port).replace(/\D/g, ''), 10) || p.slots.length + 1) - 1);
        const x = (idx % 2 ? 1 : -1) * 0.058, y = p.h / 2 - 0.15 - Math.floor(idx / 2) * 0.034;
        const br = (ES().breakers || {})['sv:br:' + id];
        p.slots.push({ node: id, x, y, w: at(p, x, y, 0.014), ti, trimmed: ti.trimmed, on: !(n.set && n.set.on === false), tripped: !!(br && br.tripped), tripA: br ? br.tripA : 0, ratingA: br ? br.ratingA : 0, frame: n.frame });
        continue;
      }
      if (n.state === 'planned' || (!ti.ready && !ti.trimmed && !(ti.done.land > 0))) continue;   // rough-in still owns it
      const o = axes(faceOf(n, A));
      const E = ti.ends.length, ends = ti.ends.map((e, i) => {
        const x = (i - (E - 1) / 2) * 0.022, base = at(o, x, n.kind === 'box_ceiling' ? 0.03 : 0.035, 0), sp = SV.specs[(R.runs[e.run] || {}).spec] || {};
        return { ...e, base, tip: at(o, x * 1.3, n.kind === 'box_ceiling' ? 0.02 : 0.015, 0.075), colour: parseInt(String(sp.colour || '#f0f0e8').slice(1), 16), stripped: i < ti.done.strip, landed: i < ti.done.land };
      });
      const dev = ti.device, light = SV.isLight(dev);
      out.boxes.push({ node: id, kind: n.kind, frame: n.frame, ...o, ti, dev, light, ends, on: !(n.set && n.set.on === false), ready: ti.ready });
      if (light && ti.trimmed) out.lamps.push({ node: id, w: at(o, 0, 0, 0.05), F: o.F });
    }
    out.panels = [...pan.values()];
    for (const p of out.panels) {
      p.main = at(p, 0, p.h / 2 - 0.075, 0.018);
      p.tester = at(p, p.wd * 0.32, -p.h / 2 + 0.05, 0.03);
      p.on = !(S.mains && S.mains[p.key] === false);
      const ck = S.checks && S.checks[p.frame] && S.checks[p.frame].power;
      p.tag = !!(ck && ck.pass);
      for (const s of p.slots) for (const h of SV.circuitWalk(R, s.node)) if (out.depth[h.node] === undefined) out.depth[h.node] = h.depth;
    }
    // the tester's red marks: shown for a while after a test
    for (const [f, ck] of Object.entries(S.checks || {})) {
      const c = ck.power; if (!c || !c.faults || G.sim.state.t - c.t > 600) continue;
      for (const q of c.faults) { const n = R.nodes[q.node]; if (n) out.faults.push({ node: q.node, frame: f, why: q.why, w: A.worldOf(R, n.frame, n.at) }); }
    }
    C = out;
    draw();
    return C;
  }

  /* ================= the scene bits ================= */
  const root = new T.Group(); root.name = 'services-trim'; G.scene.add(root);
  const lam = (c) => new T.MeshLambertMaterial({ color: c });
  const unit = new T.BoxGeometry(1, 1, 1), disc = new T.CylinderGeometry(1, 1, 1, 18);
  const glowMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, blending: T.AdditiveBlending });
  const inst = (geo, mat, n, colours) => { const m = new T.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; if (colours) m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3); root.add(m); return m; };
  const NW = 240, NB = 96, NL = 48, NP = 80;
  const sheath = inst(unit, lam(0xffffff), NW, true), copper = inst(unit, lam(COPPER), NW);
  const body = inst(unit, lam(IVORY), NB), plate = inst(unit, lam(0xf6f4ee), NB), dark = inst(unit, lam(0x3a3834), NB * 2);
  const lbase = inst(disc, lam(0xe8e6e0), NL), lensDim = inst(disc, lam(0xd8d4c8), NL), lensGlow = inst(disc, new T.MeshBasicMaterial({ color: 0xffffff, fog: false }), NL, true);
  const brk = inst(unit, lam(0x2a2c30), NP), handle = inst(unit, lam(0xffffff), NP, true), ghost = inst(unit, glowMat.clone(), 24);
  ghost.material.color.set(0xffd23a); ghost.renderOrder = 30;
  const tags = inst(unit, lam(0x3fb04e), 8), marks = inst(new T.SphereGeometry(0.035, 10, 8), glowMat.clone(), 32);
  marks.material.color.set(RED); marks.renderOrder = 30;
  const aim = new T.Mesh(new T.TorusGeometry(0.07, 0.011, 6, 24), glowMat.clone()); aim.renderOrder = 31; aim.visible = false; root.add(aim);
  const hop = new T.Mesh(new T.SphereGeometry(0.05, 12, 8), glowMat.clone()); hop.renderOrder = 32; hop.visible = false; root.add(hop);
  const dragWire = new T.Mesh(unit, lam(COPPER)); dragWire.visible = false; root.add(dragWire);
  // the tester: a yellow body on two leads, clipped under the panel while it works
  const tester = new T.Group();
  { const b = new T.Mesh(unit, lam(0xf0c020)); b.scale.set(0.06, 0.11, 0.03); tester.add(b); const s = new T.Mesh(unit, lam(0x202020)); s.scale.set(0.045, 0.03, 0.005); s.position.set(0, 0.025, 0.016); tester.add(s);
    for (const [c, x] of [[0xc02020, -0.02], [0x202020, 0.02]]) { const l = new T.Mesh(unit, lam(c)); l.scale.set(0.006, 0.12, 0.006); l.position.set(x, 0.11, 0); tester.add(l); } }
  tester.visible = false; root.add(tester);
  // the one pooled lamp light: in the scene from the start, at intensity 0, so lighting never recompiles
  const lampLight = new T.PointLight(0xffe2b8, 0, 7, 1.6); lampLight.castShadow = false; G.scene.add(lampLight);

  const M4 = new T.Matrix4(), Q = new T.Quaternion(), S3 = new T.Vector3(), PV = new T.Vector3(), Cc = new T.Color(), X = new T.Vector3(), Y = new T.Vector3(), Z = new T.Vector3();
  // a part at p with its x, y, z along the given axes (right-handed), sized sx, sy, sz
  function put(m, i, p, ax, ay, az, sx, sy, sz) {
    M4.makeBasis(ax, ay, az); Q.setFromRotationMatrix(M4);
    M4.compose(PV.set(p[0], p[1], p[2]), Q, S3.set(sx, sy, sz)); m.setMatrixAt(i, M4);
  }
  function seg(m, i, a, b, r) {                         // a thin box from a to b
    Z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const l = Z.length(); if (l < 1e-4) return false;
    Z.divideScalar(l); X.set(0, 1, 0); if (Math.abs(Z.y) > 0.95) X.set(1, 0, 0);
    Y.crossVectors(Z, X).normalize(); X.crossVectors(Y, Z).normalize();
    put(m, i, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], X, Y, Z, r, r, l); return true;
  }
  const done = (m, n) => { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
  const anim = new Map();                                 // node -> { t0, kind }: a device folding in, a plate going on
  const FOLD_MS = 220;

  function draw() {
    if (!C) return;
    const now = performance.now();
    let nw = 0, nc = 0, nb = 0, np = 0, nd = 0, nl = 0, nk = 0, nh = 0, ng = 0, nt = 0, nm = 0;
    const dragging = act && act.kind === 'land' ? act.box.node : null;
    for (const b of C.boxes) {
      const ti = b.ti, folded = ti.done.fold >= 1, plated = ti.done.plate >= 1, a = anim.get(b.node), k = a ? clamp((now - a.t0) / FOLD_MS, 0, 1) : 1;
      const showDev = ti.done.land > 0 || ti.trimmed || (dragging === b.node);
      // cable ends: sheathed white (or the cable's colour), copper once stripped; landed ones run to the device while it hangs out
      if (!folded) for (const e of b.ends) {
        if (nw >= NW) break;
        if (e.landed) { if (seg(sheath, nw, e.base, at(b, 0, 0, 0.1), 0.006)) { sheath.setColorAt(nw, Cc.set(e.colour)); nw++; } continue; }
        if (seg(sheath, nw, e.base, e.tip, 0.009)) { sheath.setColorAt(nw, Cc.set(e.colour)); nw++; }
        if (e.stripped && nc < NW) { const q = [e.tip[0] + b.F.x * 0.02, e.tip[1] + b.F.y * 0.02 - 0.004, e.tip[2] + b.F.z * 0.02]; if (seg(copper, nc, e.tip, q, 0.004)) nc++; }
      }
      if (!showDev) continue;
      // the device: hanging out on its wires, then folded in flush (sliding in over a moment)
      const out = folded ? (a && a.kind === 'fold' ? 1 - k : 0) : 1, z = 0.012 + out * 0.09, tilt = out * 0.35;
      if (b.light) {
        if (nl < NL) { Y.copy(b.F); X.copy(b.U).applyAxisAngle(b.Rt, tilt); Y.copy(b.F).applyAxisAngle(b.Rt, tilt); Z.crossVectors(X, Y); put(lbase, nl++, at(b, 0, -out * 0.05, z), X, Y, Z, b.kind === 'box_ceiling' ? 0.14 : 0.1, 0.03, b.kind === 'box_ceiling' ? 0.14 : 0.1); }
        continue;                                          // the shade is drawn with the lamps (it glows)
      }
      if (nb < NB) { X.copy(b.Rt); Y.copy(b.U).applyAxisAngle(b.Rt, tilt); Z.copy(b.F).applyAxisAngle(b.Rt, tilt); put(body, nb++, at(b, 0, -out * 0.03, z - 0.008), X, Y, Z, 0.045, 0.1, 0.022); }
      if (folded && b.dev === 'switch_single' && nd < NB * 2) put(dark, nd++, at(b, 0, b.on ? 0.007 : -0.007, 0.018), b.Rt, b.U, b.F, 0.012, 0.02, 0.012);
      if (folded && b.dev === 'outlet_120v') for (const y of [0.022, -0.022]) if (nd < NB * 2) put(dark, nd++, at(b, 0, y, 0.0045), b.Rt, b.U, b.F, 0.028, 0.03, 0.003);
      if (plated && np < NB) { const pk = a && a.kind === 'plate' ? k : 1; put(plate, np++, at(b, 0, 0, 0.003 + (1 - pk) * 0.06), b.Rt, b.U, b.F, 0.075, 0.12, 0.005); }
    }
    for (const p of C.panels) {
      // the main at the top: handle up is on
      const mainDy = act && act.kind === 'main' && act.p === p ? clamp(-act.dy / 400, -0.012, 0.012) : p.on ? 0.012 : -0.012;
      if (nk < NP) put(brk, nk++, at(p, 0, p.h / 2 - 0.075, 0.009), p.Rt, p.U, p.F, 0.11, 0.05, 0.018);
      if (nh < NP) { put(handle, nh, at(p, 0, p.h / 2 - 0.075 + mainDy, 0.024), p.Rt, p.U, p.F, 0.075, 0.014, 0.014); handle.setColorAt(nh++, Cc.set(0x9aa0a6)); }
      for (const s of p.slots) {
        if (!s.trimmed) { if (s.ti.ready && ng < 24) put(ghost, ng++, s.w, p.Rt, p.U, p.F, 0.05, 0.028, 0.025); continue; }
        if (nk < NP) put(brk, nk++, at(p, s.x, s.y, 0.0125), p.Rt, p.U, p.F, 0.05, 0.028, 0.025);
        // handle toward the middle of the panel is on, outward is off, in the middle is tripped
        const hx = s.tripped ? 0 : (s.on ? -1 : 1) * Math.sign(s.x) * 0.009;
        if (nh < NP) { put(handle, nh, at(p, s.x + hx, s.y, 0.028), p.Rt, p.U, p.F, 0.012, 0.012, 0.012); handle.setColorAt(nh++, Cc.set(s.tripped ? 0xe07030 : 0xd8dadc)); }
      }
      if (p.tag && nt < 8) put(tags, nt++, at(p, -p.wd * 0.32, -p.h / 2 + 0.06, 0.004), p.Rt, p.U, p.F, 0.04, 0.06, 0.004);
    }
    for (const f of C.faults) if (nm < 32) { M4.makeTranslation(f.w[0], f.w[1], f.w[2]); marks.setMatrixAt(nm++, M4); }
    done(sheath, nw); done(copper, nc); done(body, nb); done(plate, np); done(dark, nd); done(lbase, nl);
    done(brk, nk); done(handle, nh); done(ghost, ng); done(tags, nt); done(marks, nm);
    lampsDirty = true;
  }

  /* ================= lamps: glow when their load is served, in order along the circuit ================= */
  const lampState = new Map();                            // node -> { on, at, g }
  let lampsDirty = true;
  function tickLamps() {
    if (!C) return;
    const now = performance.now(), E = ES(), loads = E.loads || {}, fresh = [];
    let changed = lampsDirty;
    for (const l of C.lamps) {
      const L = loads['sv:' + l.node], want = !!L && L.on && L.served > 0.5 && L.drawW > 0;
      let st = lampState.get(l.node);
      if (!st) { st = { on: want, at: 0, g: want ? 1 : 0 }; lampState.set(l.node, st); changed = true; continue; }
      if (want && !st.on) { st.on = true; fresh.push(l); }
      else if (!want && st.on) { st.on = false; st.g = 0; changed = true; }
    }
    if (fresh.length) {                                    // a batch coming on: the nearest the panel first
      const d0 = Math.min(...fresh.map((l) => C.depth[l.node] || 0));
      for (const l of fresh) { const st = lampState.get(l.node); st.at = now + ((C.depth[l.node] || 0) - d0) * 260; st.g = 0; }
      if (fresh.length && cmd('services.note', { key: 'power:first-light' }).first) RCH.R.beat('Lights!');
    }
    let best = null, bd = 14;
    for (const l of C.lamps) {
      const st = lampState.get(l.node); if (!st) continue;
      if (st.on && st.g < 1) {
        const g = clamp((now - st.at) / 160, 0, 1);
        if (g > 0 && st.g === 0) G.burst(l.w[0], l.w[1], l.w[2], 4, 0xfff0c8, 0.5, 0.4, 0.025, 0.3);
        if (g !== st.g) { st.g = g; changed = true; }
      }
      const d = st.g > 0 ? Math.hypot(l.w[0] - P.x, l.w[2] - P.z) : Infinity;
      if (d < bd) { bd = d; best = l; }
    }
    if (best) {
      const g = lampState.get(best.node).g;
      lampLight.position.set(best.w[0] + best.F.x * 0.25, best.w[1] + best.F.y * 0.25, best.w[2] + best.F.z * 0.25);
      lampLight.intensity = g * (1.2 + 9 * (G.nightF || 0));
    } else lampLight.intensity = 0;
    if (!changed) return;
    lampsDirty = false;
    let nd = 0, ng = 0;
    for (const l of C.lamps) {
      const st = lampState.get(l.node), g = st ? st.g : 0, b = C.boxes.find((q) => q.node === l.node);
      if (!b) continue;
      const big = b.kind === 'box_ceiling' ? 0.115 : 0.08;
      X.copy(b.U); Y.copy(b.F); Z.crossVectors(X, Y);
      if (g > 0) { put(lensGlow, ng, at(b, 0, 0, 0.042), X, Y, Z, big, 0.03, big); lensGlow.setColorAt(ng++, Cc.set(0x7a7264).lerp(new T.Color(0xfff4dc), g)); }
      else put(lensDim, nd++, at(b, 0, 0, 0.042), X, Y, Z, big, 0.03, big);
    }
    done(lensDim, nd); done(lensGlow, ng);
  }

  /* ================= aiming ================= */
  let act = null, hovered = null, test = null;
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
    for (const b of c.boxes) {
      if (!b.ti.trimmed && b.ready) consider('box', b, b.w, 0.08);
      else if (b.ti.trimmed && b.dev === 'switch_single') consider('switch', b, b.w, 0.06);
    }
    for (const p of c.panels) {
      consider('main', p, p.main, 0.04);
      consider('tester', p, p.tester, 0.05);
      for (const s of p.slots) if (s.trimmed || s.ti.ready) consider(s.trimmed ? 'breaker' : 'slot', { p, s }, s.w, 0.025);
    }
    for (const f of c.faults) consider('fault', f, f.w, 0.06, true);
    if (best) return best;
    if (far) return { sv: 'far', score: 0.45 + far.d, x: far.w[0], y: far.w[1], z: far.w[2], w: far.w };
    return null;
  }
  function hintFor(h) {
    const g = gesture(), T_ = api('services').trimText;
    if (h.sv === 'far') return 'Too far to reach: walk closer.';
    if (h.sv === 'box') {
      const b = h.obj, ti = b.ti, dn = DEVNAME(b.dev), left = ti.units[ti.next] - ti.done[ti.next];
      const wheel = !(ti.done.land > 0) && b.kind === 'box' ? '  <b>Wheel</b>: outlet, switch or wall light' : '';
      if (ti.next === 'strip') return '<b>Click</b> to strip the cable ends (' + left + ' to strip, ' + Math.min(g, left) + ' a click)  <i>for the ' + esc(dn) + '</i>' + wheel;
      if (ti.next === 'land') return '<b>Drag</b> from the box to land the wires on the ' + esc(dn) + '’s screws (' + left + ' to land, ' + Math.min(g, left) + ' a drag)' + wheel;
      if (ti.next === 'fold') return '<b>Click</b> to fold the ' + esc(dn) + ' into the box and screw it' + (g >= 2 ? ', and put its ' + (b.light ? 'shade' : 'plate') + ' on' : '');
      if (ti.next === 'plate') return '<b>Click</b> to ' + (b.light ? T_.lightPlate : T_.steps.plate);
    }
    if (h.sv === 'switch') return '<b>Click</b> the switch: ' + (h.obj.on ? 'off' : 'on');
    if (h.sv === 'slot') { const n = h.obj.p.slots.filter((s) => !s.trimmed && s.ti.ready).length; return '<b>Click</b> to press a ' + esc(h.obj.s.ti.breaker.replace('breaker_', '').replace('a', ' A')) + ' breaker into the panel (' + n + ' empty, ' + Math.min(g, n) + ' a click)'; }
    if (h.sv === 'breaker') {
      const s = h.obj.s;
      if (s.tripped) return '<b>Tripped</b>: the circuit drew ' + Math.round(s.tripA || 0) + ' A on a ' + s.ratingA + ' A breaker. Switch something off on it, then <b>click</b> to throw it back on';
      return 'Breaker ' + (s.on ? 'on' : 'off') + '.  <b>Click</b> to switch it ' + (s.on ? 'off' : 'on');
    }
    if (h.sv === 'main') return 'The main: ' + (h.obj.on ? 'on' : '<b>off</b>') + '.  <b>Drag</b> the handle ' + (h.obj.on ? 'down to switch the house off' : 'up to switch the house on');
    if (h.sv === 'tester') return '<b>Hold</b> to clip the tester on and test every circuit from this panel';
    if (h.sv === 'fault') return '<span style="color:#ff8a70">Tester:</span> ' + esc(h.obj.why);
    return '';
  }

  /* ================= gestures ================= */
  function say(R, r, good, secs = 2.2) { R.say(r.ok ? good : why(r), r.ok ? secs : 2.8); }
  function doTrim(R, b, step, n) {
    const r = cmd('services.trim', { node: b.node, step, n });
    if (!r.ok) { R.say(why(r), 2.8); return r; }
    G.markStockDirty && G.markStockDirty();
    const dn = DEVNAME(b.dev);
    for (const d of r.did || []) {
      if (d.step === 'strip') { R.pose(-1.4, -1.4, 0.08, 0.2); G.burst(b.w[0], b.w[1], b.w[2], 4, 0xf4f0e6, 0.6, 0.5, 0.012, 0.3); R.say(d.n === 1 ? 'Stripped.' : d.n + ' ends stripped.', 1.4); }
      if (d.step === 'land') { G.burst(b.w[0] + b.F.x * 0.1, b.w[1], b.w[2] + b.F.z * 0.1, 5, 0xffe0a0, 0.5, 0.4, 0.012, 0.25); R.say((d.n === 1 ? 'Landed' : d.n + ' landed') + ' on the ' + dn + '.' + (r.next === 'fold' ? '  Now fold it in.' : ''), 1.8); }
      if (d.step === 'fold') { anim.set(b.node, { t0: performance.now(), kind: 'fold' }); R.pose(-1.2, -1.6, 0.1, 0.3); if (G.juice) G.juice.hitStop = 0.03; }
      if (d.step === 'plate') { anim.set(b.node, { t0: performance.now() + (r.did.length > 1 ? FOLD_MS : 0), kind: 'plate' }); }
    }
    if (r.trimmed) {
      setTimeout(() => G.burst(b.w[0], b.w[1], b.w[2], 7, GREEN, 0.6, 0.8, 0.02, 0.35), r.did.length > 1 ? FOLD_MS : 60);
      R.say('The ' + dn + ' is in.' + (b.dev === 'switch_single' ? '  Click it to switch the lights after it.' : ''), 2.4);
    } else if (r.did && r.did[0] && r.did[0].step === 'fold') R.say('Screwed in.  Now the ' + (b.light ? 'shade' : 'plate') + '.', 1.8);
    scan(true);
    return r;
  }
  RCH.use({
    id: 'services-trim',
    near(px, pz) {
      const c = scan(); if (!c) return false;
      const by = (w) => Math.hypot(w[0] - px, w[2] - pz) < 6;
      return c.boxes.some((b) => !b.ti.trimmed && b.ready && by(b.w)) || c.panels.some((p) => by(p.w) && p.slots.some((s) => !s.trimmed && s.ti.ready));
    },
    hover(R) {
      if (R.held || planBusy() || handsBusy()) { hovered = null; return null; }
      const h = findHit(R); hovered = h;
      if (h) h.hint = hintFor(h);
      return h;
    },
    press(hit, R) {
      if (hit.sv === 'far') { R.say('Too far to reach: walk closer.', 1.5); return; }
      if (hit.sv === 'fault') { R.say(hit.obj.why, 3); return; }
      const g = gesture();
      if (hit.sv === 'box') {
        const b = hit.obj;
        if (b.ti.next === 'land') { act = { kind: 'land', hit, box: b, dy: 0, dx: 0 }; return; }
        doTrim(R, b, b.ti.next, g);
        return;
      }
      if (hit.sv === 'switch') {
        const r = cmd('services.flip', { node: hit.obj.node });
        if (r.ok) { R.pose(-1.3, -0.9, 0.04, 0.15); G.burst(hit.w[0], hit.w[1], hit.w[2], 2, 0xffffff, 0.3, 0.2, 0.01, 0.15); }
        say(R, r, 'Click.  ' + (r.controls && r.controls.length ? (r.on ? 'On.' : 'Off.') : 'Nothing after it on the cable to switch.'), 1.4);
        scan(true); return;
      }
      if (hit.sv === 'slot') {
        const { s } = hit.obj, r = cmd('services.trim', { node: s.node, step: 'press', n: g });
        if (r.ok) {
          G.markStockDirty && G.markStockDirty();
          R.pose(-1.6, -1.6, 0.12, 0.12); G.cam.shake = Math.min(G.cam.shake + 0.05, 0.3); if (G.juice) G.juice.hitStop = 0.04;
          G.burst(s.w[0], s.w[1], s.w[2], 5, 0xd8dadc, 0.5, 0.5, 0.015, 0.3);
          const main = SS().mains && SS().mains[hit.obj.p.key] === false;
          R.say((r.pressed.length > 1 ? r.pressed.length + ' breakers' : 'Breaker') + ' snapped onto the bus bar.' + (main ? '  The main is off: drag it up when you are ready.' : ''), 2.6);
        } else R.say(why(r), 2.8);
        scan(true); return;
      }
      if (hit.sv === 'breaker') {
        const { s } = hit.obj, r = cmd('services.breaker', { node: s.node });
        if (r.ok) { R.pose(-1.5, -1.0, 0.06, 0.15); G.burst(s.w[0], s.w[1], s.w[2], r.reset ? 6 : 2, r.reset ? 0xffd08a : 0xd8dadc, 0.4, 0.4, 0.012, 0.25); }
        say(R, r, r.reset ? 'Reset: pushed through off and back on.' : 'Breaker ' + (r.on ? 'on.' : 'off.'), 1.8);
        tripSig = tripsNow(); scan(true); return;
      }
      if (hit.sv === 'main') { act = { kind: 'main', hit, p: hit.obj, dy: 0 }; return; }
      if (hit.sv === 'tester') { act = { kind: 'clip', hit, p: hit.obj, t: 0 }; return; }
    },
    move(hit, R) { if (act) { act.dx = R.ptr.dx; act.dy = R.ptr.dy; if (act.kind === 'main') draw(); } },
    release(hit, R, cancelled) {
      const a = act; act = null; dragWire.visible = false;
      if (!a || cancelled) { draw(); return; }
      if (a.kind === 'land') {
        if (Math.hypot(a.dx, a.dy) < 22) { R.say('Drag the wire from the box onto the device’s screw.', 1.8); draw(); return; }
        doTrim(R, a.box, 'land', gesture());
        return;
      }
      if (a.kind === 'main') {
        const on = Math.abs(a.dy) > 10 ? a.dy < 0 : !a.p.on;
        if (on === a.p.on && Math.abs(a.dy) > 10) { R.say('The main is already ' + (on ? 'on' : 'off') + '.', 1.4); draw(); return; }
        const r = cmd('services.main', { panel: a.p.key, on });
        if (r.ok) { R.pose(-2.2, -1.0, 0.1, 0.2); G.cam.shake = Math.min(G.cam.shake + 0.08, 0.3); if (G.juice) G.juice.hitStop = 0.05; G.burst(a.p.main[0], a.p.main[1], a.p.main[2], 6, on ? 0xffe9a0 : 0x9aa0a6, 0.6, 0.6, 0.015, 0.3); }
        say(R, r, on ? 'Main on.' : 'Main off: nothing after this panel has power.', 2.4);
        scan(true); return;
      }
      if (a.kind === 'clip' && !test) R.say('Hold until the tester clips on.', 1.4);
    },
    wheel(dy, R) {
      const h = hovered;
      if (!h || h.sv !== 'box' || h.obj.kind !== 'box' || h.obj.ti.done.land > 0 || act) return false;
      const list = ['outlet_120v', 'switch_single', 'light_wall'], i = list.indexOf(h.obj.dev), next = list[(i + (dy > 0 ? 1 : list.length - 1)) % list.length];
      const r = cmd('services.device', { node: h.obj.node, device: next });
      R.say(r.ok ? 'This box gets a ' + DEVNAME(next) + '.' : why(r), 1.4);
      scan(true);
      return true;
    },
    secondary() { return false; },
    frame(dt, R) {
      if ((tripT += dt) > 0.25) { tripT = 0; const t = tripsNow(); if (t !== tripSig) tripSig = t; }
      const c = scan();
      if (!c) return;
      if (anim.size) { const now = performance.now(); for (const [k, a] of anim) if (now - a.t0 > FOLD_MS + 50) anim.delete(k); draw(); }
      tickLamps();
      if (act && act.kind === 'land') {                   // the wire follows the pointer out of the box
        const b = act.box, e = b.ends.find((q) => q.stripped && !q.landed) || b.ends[0], o = R.ray.origin, d = R.ray.direction;
        const t = Math.max(0.2, (b.w[0] - o.x) * d.x + (b.w[1] - o.y) * d.y + (b.w[2] - o.z) * d.z), q = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
        { Z.set(q[0] - e.tip[0], q[1] - e.tip[1], q[2] - e.tip[2]); const l = Z.length(); dragWire.position.set((q[0] + e.tip[0]) / 2, (q[1] + e.tip[1]) / 2, (q[2] + e.tip[2]) / 2); dragWire.scale.set(0.005, 0.005, Math.max(0.01, l)); dragWire.lookAt(q[0], q[1], q[2]); dragWire.visible = true; }
        R.face(b.w[0], b.w[2]);
        if (act.hit) act.hit.hintDown = 'Onto the ' + DEVNAME(b.dev) + '’s screw...  let go to land it';
      }
      if (act && act.kind === 'clip') {
        act.t += dt; R.pose(-1.3, -1.3, 0.08, 0.1);
        const p = act.p; tester.visible = true; tester.position.set(p.tester[0], p.tester[1] - 0.06, p.tester[2]); tester.lookAt(p.tester[0] + p.F.x, p.tester[1] - 0.06, p.tester[2] + p.F.z);
        if (act.hit) act.hit.hintDown = 'Clipping the tester on...';
        if (act.t > 0.5 && !test) startTest(R, p);
      }
      if (test) tickTest(dt, R);
      else if (!(act && act.kind === 'clip')) tester.visible = false;
      // the aim ring on what is hovered
      const h = !act && R.on && !planBusy() ? hovered : null;
      if (h && h.sv !== 'far') {
        aim.visible = true; aim.position.set(h.w[0], h.w[1], h.w[2]); aim.lookAt(G.camera.position);
        aim.scale.setScalar((h.sv === 'slot' || h.sv === 'breaker' ? 0.5 : 1) * (1 + Math.sin(performance.now() / 160) * 0.12));
        aim.material.color.set(h.sv === 'fault' ? RED : h.sv === 'main' || h.sv === 'tester' ? 0xffd23a : 0x8fc0ff);
      } else aim.visible = false;
      if (ghost.count) ghost.material.opacity = 0.35 + 0.3 * Math.sin(performance.now() / 200);
    },
    leave() { act = null; hovered = null; aim.visible = false; dragWire.visible = false; if (!test) tester.visible = false; },
  });

  /* ================= the tester beat ================= */
  function startTest(R, p) {
    const r = cmd('services.check', { structId: p.frame, kind: 'power' });
    if (!r.ok) { R.say(r.reason, 2.8); act = null; return; }
    const A = api('routes'), Rr = RS(), wOf = (id) => { const n = Rr.nodes[id]; return n ? A.worldOf(Rr, n.frame, n.at) : null; };
    const steps = [];
    for (const c of r.circuits) {
      const slot = p.slots.find((s) => s.node === c.slot), start = slot ? slot.w : p.w;
      for (const h of c.hops) { const a = h.from === c.slot ? start : wOf(h.from), b = wOf(h.node); if (a && b) steps.push({ a, b, ok: h.ok, why: h.why }); }
    }
    for (const f of r.faults) if (!f.slot) { const b = wOf(f.node); if (b) steps.push({ a: p.w, b, ok: false, why: f.why }); }
    test = { p, steps, i: 0, t: 0, pass: r.pass, faults: r.faults.length };
    R.say('Testing...', 1.2);
  }
  function tickTest(dt, R) {
    const p = test.p, s = test.steps[test.i];
    tester.visible = true; tester.position.set(p.tester[0], p.tester[1] - 0.06, p.tester[2]); tester.lookAt(p.tester[0] + p.F.x, p.tester[1] - 0.06, p.tester[2] + p.F.z);
    if (!s) {
      hop.visible = false; test.t += dt;
      if (test.t > 0.6) {
        if (test.pass) { R.say('Every circuit tests good: a green tag on the panel.', 3); if (cmd('services.note', { key: 'power:tested' }).first) R.beat('Tested!'); }
        else R.say(test.faults + (test.faults === 1 ? ' fault' : ' faults') + ': hover the red marks for what is missing.', 3.2);
        test = null; scan(true);
      }
      return;
    }
    test.t += dt;
    const k = clamp(test.t / 0.32, 0, 1);
    hop.visible = true; hop.material.color.set(s.ok ? GREEN : RED);
    hop.position.set(s.a[0] + (s.b[0] - s.a[0]) * k, s.a[1] + (s.b[1] - s.a[1]) * k + Math.sin(k * Math.PI) * 0.15, s.a[2] + (s.b[2] - s.a[2]) * k);
    if (k >= 1) { G.burst(s.b[0], s.b[1], s.b[2], s.ok ? 4 : 8, s.ok ? GREEN : RED, 0.5, 0.6, 0.02, 0.3); if (!s.ok) R.say(s.why, 1.6); test.i++; test.t = 0; }
  }

  /* ================= console ================= */
  const _s = new T.Vector3();
  const screen = (x, y, z) => { _s.set(x, y, z).project(G.camera); const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + (_s.x * 0.5 + 0.5) * r.width, y: r.top + (-_s.y * 0.5 + 0.5) * r.height }; };
  function targets() {
    const c = scan(true); if (!c) return null;
    const P_ = c.panels;
    return {
      trim: c.boxes.filter((b) => !b.ti.trimmed && b.ready).map((b) => ({ node: b.node, next: b.ti.next, w: b.w, device: b.dev, reach: inReach(b.w) })),
      switch: c.boxes.filter((b) => b.ti.trimmed && b.dev === 'switch_single').map((b) => ({ node: b.node, on: b.on, w: b.w })),
      slot: P_.flatMap((p) => p.slots.filter((s) => !s.trimmed && s.ti.ready).map((s) => ({ node: s.node, w: s.w }))),
      breaker: P_.flatMap((p) => p.slots.filter((s) => s.trimmed).map((s) => ({ node: s.node, on: s.on, tripped: s.tripped, w: s.w }))),
      main: P_.map((p) => ({ panel: p.key, on: p.on, w: p.main })),
      tester: P_.map((p) => ({ panel: p.key, w: p.tester, tag: p.tag })),
      fault: c.faults.map((f) => ({ node: f.node, why: f.why, w: f.w })),
    };
  }
  window.__servicesTrim = {
    targets, screen,
    where(kind, i = 0) { const t = targets(); const o = t && (t[kind] || [])[i]; return o ? { ...o, screen: screen(o.w[0], o.w[1], o.w[2]) } : null; },
    lamps: () => (C ? C.lamps.map((l) => ({ node: l.node, glow: (lampState.get(l.node) || {}).g || 0, depth: C.depth[l.node] || 0 })) : []),
    light: () => ({ intensity: lampLight.intensity, x: lampLight.position.x, y: lampLight.position.y, z: lampLight.position.z }),
    get busy() { return act ? act.kind : test ? 'test' : null; },
  };
})();
