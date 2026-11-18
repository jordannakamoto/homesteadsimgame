/* Rough-in by hand (window.__servicesHands): the work that puts a planned cable or PEX run into a building's frame,
   done in the body, mouse-aimed within reach (Hands, F). Every hole, box and end is something you can see and aim at.
     Drill   hold the button on a yellow dot and sweep along the wall: every dot the pointer passes within reach is
             drilled, one after another (chips fly, the dot goes dark). The Build panel's per-gesture setting widens
             the sweep; with power near (a cord to a live outlet) the drill is quicker.
     Box     click a pale box (or stub-out) twice: hold it to the stud, then nail it.
     Pull    hold the cable end at the start of a run (the spool sits beside it) and drag along the run, or walk along
             it holding on: the cable follows through the holes. Let go anywhere; how far it got is kept (`pulled`).
             Staples tick in behind it and nail plates go on over holes near a stud face, by themselves.
     Crimp   hold on an end until the ring closes (PEX) or the cable is clamped in its box: a green flash.
     Open    a run inside a wall that is lined: hold on the marker to take the wall's lining (and the batts behind it) off,
             through services.openWall. The whole wall face comes off: lining is one piece per wall for now.
   All of it goes through routes.work and routes.setNode: this file owns no truth. Drains (fitted in lengths) are S11.
   Material: a box, the metres pulled with their staples and nail plates, and a crimp ring are drawn from the Build panel's
   rough-in lines (construction.use): from the arms when you carry that spool or coil, else the stacks. Short: the gesture
   stops and says what to order. Sandbox, or a building not under construction: free.
   Content: knows cable and pipe; reaches the game through __reach, __game (sim, powerAvailable, burst) and reads the
   routes and services systems. Console: __servicesHands.summary(), .targets(), .where(kind), .screen(x, y, z).
   Cost: hands off, a version compare a frame (staples and plates are a few instanced boxes, rebuilt only when the
   routes change). Hands on: one pass over the work items within reach per pointer move. */
(() => {
  const G = window.__game, RCH = window.__reach;
  if (!G || !RCH || !G.sim || !G.sim.handlers.has('routes.work') || !G.sim.handlers.has('services.sync')) return;
  const T = G.THREE, P = G.player;
  const RS = () => G.sim.state.sys.routes, SS = () => G.sim.state.sys.services || {};
  const sysApi = (n) => { const d = G.sim.systems.find((s) => s.name === n); return d ? d.api : null; };
  const SV0 = () => sysApi('services');
  const cmd = (n, p) => { try { return G.sim.commandNow(n, p) || { ok: true }; } catch (e) { console.warn('services-hands: ' + n + ' failed: ' + e.message); return { ok: false, reason: e.message }; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hex = (c) => parseInt(String(c).slice(1), 16);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const gesture = () => { const c = G.sim.state.sys.construction, g = c && c.options && c.options.gesture; return Number.isFinite(g) && g > 0 ? g : 3; };
  const powered = () => { try { return !!(G.powerAvailable && G.powerAvailable()); } catch (e) { return false; } };
  const planBusy = () => !!(window.__servicesPlan && window.__servicesPlan.mode);
  // material for a piece of work, { itemId: qty }, from the building's rough-in lines. short(frame, need) -> null when there
  // is enough (or nothing is counted), else what is missing; take(frame, need) draws it.
  const CN = () => G.sim.state.sys.construction;
  const counts = () => G.sim.handlers.has('construction.use');
  const fromFor = (itemId, qty) => { const c = CN() && CN().carried; return c && c.itemId === itemId && c.qty + 1e-6 >= qty ? 'carried' : 'stacks'; };
  function short(frame, need) {
    if (!counts() || frame == null || !Object.keys(need).length) return null;
    cmd('services.sync');                                    // the lines reach the Build panel before anything is drawn on them
    for (const [itemId, qty] of Object.entries(need)) {
      const r = cmd('construction.use', { structId: frame, itemId, qty, from: fromFor(itemId, qty), check: true });
      if (!r.ok && r.reason !== 'not in the plan') return { itemId, qty, have: r.have || 0 };
    }
    return null;
  }
  function take(frame, need) { if (counts() && frame != null) for (const [itemId, qty] of Object.entries(need)) cmd('construction.use', { structId: frame, itemId, qty, from: fromFor(itemId, qty) }); G.markStockDirty && G.markStockDirty(); }
  const itemName = (itemId) => { const a = sysApi('construction'), it = a && a.catalog && a.catalog[itemId]; return it ? it.name.replace(/ with ground$/, '') : itemId; };
  const shortWords = (m) => 'Out of ' + itemName(m.itemId).toLowerCase() + ': order the rough-in in the Build panel (L).';

  // feel: seconds per hole (corded with power near, on the battery without), sweep half-width by the gesture setting,
  // how fast cable comes off the spool, how long a crimp is held
  const HOLE_S = { power: 0.2, battery: 0.5 };
  const sweepM = () => 0.05 + 0.03 * gesture();
  const PULL_MPS = 3, COMMIT_M = 0.5, CRIMP_S = 0.7, UP_M = 3.0;
  // fastening: NEC 334.30 (NM cable stapled within 12 in of a box and every 4-1/2 ft), IRC table P2605.1 (PEX
  // supported every 32 in run horizontally). A hole through a stud holds the run, so no staple right beside one.
  const STAPLE_M = { cable: 1.2, supply: 0.8 }, STAPLE_END_M = 0.2;
  const SAWDUST = 0xe2cc98, GREEN = 0x5fd06a;
  const WORDS = {
    cable: { thing: 'cable', join: 'clamp the cable in its box', joining: 'Clamping', joined: 'Clamped' },
    supply: { thing: 'PEX', join: 'crimp the ring', joining: 'Crimping', joined: 'Crimped' },
  };
  const BOX_KINDS = { box: 'box', box_ceiling: 'ceiling box', stub_supply: 'stub-out' };

  /* ================= what there is to do: read from the routes, rebuilt when they change ================= */
  let C = null, cKey = '', simRef = null, popOK = false;
  const inReach = (w, extra = 0.3) => Math.hypot(w[0] - P.x, w[2] - P.z) <= RCH.R.reach + extra && w[1] - P.y < UP_M + extra && w[1] > P.y - 0.6;
  function polyAt(wp, cum, s) {                          // point and direction s metres along a world polyline
    const L = cum[cum.length - 1]; s = clamp(s, 0, L);
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = wp[i - 1], b = wp[i], seg = cum[i] - cum[i - 1] || 1, k = (s - cum[i - 1]) / seg;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { p: [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k], d: [d[0] / l, d[1] / l, d[2] / l] };
  }
  function sOnPoly(wp, cum, q) {                         // how far along a polyline the point nearest q is
    let best = 0, bd = Infinity;
    for (let i = 1; i < wp.length; i++) {
      const a = wp[i - 1], b = wp[i], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
      const k = clamp(((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1] + (q[2] - a[2]) * d[2]) / L2, 0, 1);
      const e = Math.hypot(a[0] + d[0] * k - q[0], a[1] + d[1] * k - q[1], a[2] + d[2] * k - q[2]);
      if (e < bd) { bd = e; best = cum[i - 1] + k * Math.sqrt(L2); }
    }
    return best;
  }
  function scan() {
    const R = RS(), S = SS(), cov = S.covered || {};
    if (!R) return null;
    const key = R.version + ':' + Object.keys(cov).length;
    if (C && key === cKey && simRef === G.sim) return C;
    const A = sysApi('routes'), SV = sysApi('services');
    if (!A || !SV) return null;
    const fresh = simRef !== G.sim;
    cKey = key; simRef = G.sim;
    const W = (frame, p) => A.worldOf(R, frame, p);
    const out = { bores: [], boxes: [], pulls: [], ends: [], opens: [], staples: [], plates: [], rings: [], runs: {} };
    const openBy = {};
    const endsBy = {};
    for (const id of Object.keys(R.runs).sort()) {
      const run = R.runs[id], cls = SV.classes[run.cls];
      if (!cls || run.stray || run.legacy || !(cls.steps || []).includes('pull')) continue;    // drains are fitted in lengths (S11)
      const raw = run.path && run.path.length >= 2 ? run.path : [R.nodes[run.a] && R.nodes[run.a].at, R.nodes[run.b] && R.nodes[run.b].at];
      if (raw.some((p) => !p)) continue;
      const wp = raw.map((p) => W(run.frame, p)), cum = [0];
      for (let i = 1; i < wp.length; i++) cum.push(cum[i - 1] + Math.hypot(wp[i][0] - wp[i - 1][0], wp[i][1] - wp[i - 1][1], wp[i][2] - wp[i - 1][2]));
      const L = cum[cum.length - 1], sp = SV.specs[run.spec] || {};
      const info = { run: id, cls: run.cls, spec: run.spec, name: sp.name || cls.name, colour: hex(sp.colour || cls.colour || '#cccccc'), r: sp.radiusM || 0.008, wp, cum, L, frame: run.frame,
        boreS: run.bores.map((b) => sOnPoly(wp, cum, W(run.frame, b.at))) };
      out.runs[id] = info;
      const rs = A.runState(run, R.nodes), covered = !!cov[id];
      if (!covered) {
        if (rs.next === 'bore') run.bores.forEach((b, i) => { if (!b.done) out.bores.push({ run: id, index: i, w: W(run.frame, b.at), plate: !!b.plate, info }); });
        if (rs.next === 'pull') out.pulls.push({ run: id, pulled: run.pulled, info, w: polyAt(wp, cum, run.pulled * L).p });
        if (rs.next === 'join') for (const e of ['a', 'b']) {
          if (run.joined[e]) continue;
          const n = R.nodes[run[e]]; if (!n) continue;
          const t = endsBy[n.id] || (endsBy[n.id] = { node: n.id, kind: n.kind, w: W(n.frame, n.at), items: [], cls: run.cls });
          t.items.push({ run: id, end: e });
        }
      } else if (rs.next && SV.coveredHosts) {           // work left inside a closed wall: a place to open it
        const hosts = SV.coveredHosts(G.sim.state, id);
        for (const h of hosts) if (!openBy[run.frame + '|' + h]) openBy[run.frame + '|' + h] = { frame: run.frame, host: h, run: id, w: polyAt(wp, cum, L / 2).p };
      }
      // what is fixed along the part pulled so far
      const upTo = run.pulled * L, every = STAPLE_M[run.cls] || 1;
      if (upTo > 0.01) {
        const marks = [];
        if (L > 2 * STAPLE_END_M) { marks.push(STAPLE_END_M); for (let s = STAPLE_END_M + every; s < L - STAPLE_END_M - 0.3; s += every) marks.push(s); marks.push(L - STAPLE_END_M); }
        for (const s of marks) {
          if (s > upTo || info.boreS.some((bs) => Math.abs(bs - s) < 0.12)) continue;
          const q = polyAt(wp, cum, s);
          out.staples.push({ key: id + '@' + s.toFixed(2), p: q.p, d: q.d, r: info.r });
        }
        run.bores.forEach((b, i) => {
          if (!b.plate || !b.done || info.boreS[i] > upTo + 1e-3) return;
          const q = polyAt(wp, cum, info.boreS[i]), n = [-q.d[2], 0, q.d[0]], nl = Math.hypot(n[0], n[2]) || 1;
          for (const side of [1, -1]) out.plates.push({ key: id + '#' + i + side, p: [q.p[0] + n[0] / nl * 0.046 * side, q.p[1], q.p[2] + n[2] / nl * 0.046 * side], d: q.d });
        });
      }
      if (run.pulled >= 1) for (const e of ['a', 'b']) {
        const q = polyAt(wp, cum, e === 'a' ? 0.05 : L - 0.05);
        out.rings.push({ key: id + e, p: q.p, d: q.d, r: info.r, cls: run.cls, joined: !!run.joined[e], run: id, end: e });
      }
    }
    out.ends = Object.values(endsBy);
    out.opens = Object.values(openBy);
    for (const n of Object.values(R.nodes)) {
      if (n.state !== 'planned' || n.stray || !BOX_KINDS[n.kind]) continue;
      out.boxes.push({ node: n.id, kind: n.kind, w: W(n.frame, n.at), frame: n.frame });
    }
    const was = C; C = out;
    drawFixings(was, fresh);
    return C;
  }

  /* ================= the scene bits ================= */
  const root = new T.Group(); root.name = 'services-hands'; G.scene.add(root);
  const lam = (c) => new T.MeshLambertMaterial({ color: c });
  const glowMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false, blending: T.AdditiveBlending });
  const unit = new T.BoxGeometry(1, 1, 1);
  const inst = (geo, mat, n, order = 0) => { const m = new T.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.renderOrder = order; root.add(m); return m; };
  const NS = 600, NP = 240, NR = 160, NQ = 64, NL = 16;
  const staples = inst(unit, lam(0xc4c8cc), NS), plates = inst(unit, lam(0xd8dde2), NP);
  const rings = inst(new T.CylinderGeometry(1, 1, 1, 10), lam(0xffffff), NR);
  rings.instanceColor = new T.InstancedBufferAttribute(new Float32Array(NR * 3), 3);
  const queued = inst(new T.SphereGeometry(0.03, 10, 8), glowMat, NQ, 30);
  const liveMat = lam(0xffffff), live = inst(unit, liveMat, NL);
  const aim = new T.Mesh(new T.TorusGeometry(0.075, 0.012, 6, 24), glowMat.clone()); aim.renderOrder = 31; aim.visible = false; root.add(aim);
  const heldBox = new T.Mesh(unit, lam(0x2d6fb8)); heldBox.visible = false; root.add(heldBox);
  const flashes = [0, 1, 2, 3].map(() => { const m = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, blending: T.AdditiveBlending })); m.visible = false; m.renderOrder = 32; m.userData.t = 1; root.add(m); return m; });
  // the drill: body, grip, battery, chuck and a spade bit that spins. +Z is the nose; the bit's tip is 0.19 m out
  const drill = new T.Group(), bit = new T.Group();
  const part = (g, w, h, d, c, x, y, z) => { const m = new T.Mesh(unit, lam(c)); m.scale.set(w, h, d); m.position.set(x, y, z); g.add(m); return m; };
  part(drill, 0.06, 0.075, 0.17, 0xe0a020, 0, 0, -0.02); part(drill, 0.064, 0.08, 0.04, 0x2a2a2a, 0, 0, -0.12);
  part(drill, 0.045, 0.13, 0.05, 0x2a2a2a, 0, -0.09, -0.06); part(drill, 0.07, 0.04, 0.095, 0x2a2a2a, 0, -0.17, -0.06);
  const chuck = new T.Mesh(new T.CylinderGeometry(0.018, 0.02, 0.04, 10), lam(0x8a9096)); chuck.rotation.x = Math.PI / 2; chuck.position.z = 0.085; drill.add(chuck);
  part(bit, 0.007, 0.007, 0.06, 0xb8bec4, 0, 0, 0.12); part(bit, 0.022, 0.003, 0.05, 0xc8ced4, 0, 0, 0.165);
  drill.add(bit); drill.visible = false; root.add(drill);
  // the spool (a coil for PEX) that pays out while pulling
  const spool = new T.Group(), spin = new T.Group();
  const coreMat = lam(0xffffff);
  const core = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.09, 14), coreMat); spin.add(core);
  for (const y of [-0.05, 0.05]) { const f = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.012, 14), lam(0xc9b48a)); f.position.y = y; spin.add(f); }
  part(spin, 0.02, 0.1, 0.2, 0x8a7656, 0, 0, 0);          // a mark on the side, to see it turn
  spin.rotation.z = Math.PI / 2; spool.add(spin); spool.visible = false; root.add(spool);

  const M4 = new T.Matrix4(), V = new T.Vector3(), V2 = new T.Vector3(), Q = new T.Quaternion(), S3 = new T.Vector3(), X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), Cc = new T.Color();
  const born = new Map();                                   // staple and plate keys -> when they ticked in (for the pop)
  let popping = 0;
  function placeAlong(m, i, p, d, sx, sy, sz, up) {
    V.set(d[0], d[1], d[2]); Q.setFromUnitVectors(up ? Y : X, V);
    M4.compose(V2.set(p[0], p[1], p[2]), Q, S3.set(sx, sy, sz)); m.setMatrixAt(i, M4);
  }
  function drawFixings(was, fresh) {
    const now = performance.now(), seen = new Set();
    const pop = (key, p, colour) => {
      seen.add(key);
      if (born.has(key)) return born.get(key);
      const t = popOK && !fresh && was ? now : 0; born.set(key, t);
      if (t) { G.burst(p[0], p[1], p[2], 1, colour, 0.4, 0.5, 0.02, 0.2); popping = now + 300; }
      return t;
    };
    let n = 0;
    for (const s of C.staples) { if (n >= NS) break; s.t = pop(s.key, s.p, 0xdfe3e6); n++; }
    n = 0;
    for (const s of C.plates) { if (n >= NP) break; s.t = pop(s.key, s.p, 0xf0f4f8); n++; }
    for (const k of [...born.keys()]) if (!seen.has(k)) born.delete(k);
    popOK = false;
    writeFixings(now);
    let i = 0;
    for (const r of C.rings) {
      if (i >= NR) break;
      const k = r.cls === 'supply' ? 2.7 : 2.2;
      placeAlong(rings, i, r.p, r.d, r.r * k, 0.02, r.r * k, true);
      rings.setColorAt(i, Cc.set(r.cls === 'supply' ? (r.joined ? 0x5a3a20 : 0xd08a3a) : (r.joined ? 0x50565c : 0xa8aeb4)));
      i++;
    }
    rings.count = i; rings.instanceMatrix.needsUpdate = true; if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  }
  function writeFixings(now) {
    const grow = (t) => (t ? clamp((now - t) / 220, 0, 1) : 1), k = (t) => { const g = grow(t); return g < 1 ? 1.6 - 0.6 * g : 1; };
    let n = 0;
    for (const s of C.staples) {
      if (n >= NS) break;
      const g = k(s.t), w = (s.r * 2 + 0.008) * g;
      placeAlong(staples, n++, s.p, s.d, 0.012 * g, w, w);
    }
    staples.count = n; staples.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const s of C.plates) {
      if (n >= NP) break;
      const g = k(s.t);
      placeAlong(plates, n++, s.p, s.d, 0.038 * g, 0.12 * g, 0.004);
    }
    plates.count = n; plates.instanceMatrix.needsUpdate = true;
  }
  function flash(p, size = 0.12, colour = GREEN) {
    const m = flashes.find((f) => f.userData.t >= 1) || flashes[0];
    m.position.set(p[0], p[1], p[2]); m.userData.t = 0; m.userData.size = size; m.material.color.set(colour); m.visible = true;
  }
  function tickFlashes(dt) {
    for (const m of flashes) {
      if (m.userData.t >= 1) { m.visible = false; continue; }
      m.userData.t = Math.min(1, m.userData.t + dt * 2.6);
      const t = m.userData.t, s = m.userData.size * (0.4 + t * 1.2);
      m.scale.set(s, s, s); m.material.opacity = 0.85 * (1 - t);
    }
  }

  /* ================= aiming ================= */
  let act = null, tap = null, hovered = null;
  const tol = (t, base) => base + t * 0.008;
  function findHit(R) {
    const c = scan(); if (!c) return null;
    let best = null, far = null;
    const consider = (sv, obj, w, base) => {
      const { d, t } = R.rayDist(w[0], w[1], w[2]);
      if (d > tol(t, base)) return;
      if (!inReach(w)) { if (!far || d < far.d) far = { d, w, sv }; return; }
      if (!best || d < best.score) best = { sv, obj, score: d, x: w[0], y: w[1], z: w[2], w };
    };
    for (const b of c.bores) consider('bore', b, b.w, 0.06);
    for (const b of c.boxes) consider('box', b, b.w, 0.08);
    for (const p of c.pulls) consider('pull', p, p.w, 0.1);
    for (const e of c.ends) consider('end', e, e.w, 0.08);
    for (const o of c.opens) consider('open', o, o.w, 0.14);
    if (best) return best;
    if (far) return { sv: 'far', score: 0.4 + far.d, x: far.w[0], y: far.w[1], z: far.w[2], w: far.w, what: far.sv };
    return null;
  }
  function hintFor(h) {
    const c = C;
    if (h.sv === 'far') return 'Too far to reach: walk closer.';
    if (h.sv === 'bore') {
      const n = c.bores.filter((b) => inReach(b.w)).length;
      return '<b>Hold</b> and sweep along the yellow dots to drill them  (' + n + (n === 1 ? ' hole' : ' holes') + ' in reach' + (powered() ? ', power on: quick' : ', on the battery: plug in near power to drill faster') + ')';
    }
    if (h.sv === 'box') {
      const what = BOX_KINDS[h.obj.kind];
      return tap && tap.node === h.obj.node ? '<b>Click</b> again: nail the ' + what + ' to the stud' : '<b>Click</b> twice to fix the ' + what + ': hold it to the stud, then nail it';
    }
    if (h.sv === 'pull') {
      const p = h.obj, w = WORDS[p.info.cls] || WORDS.cable;
      return (p.pulled > 0 ? '<b>' + esc(p.info.name) + '</b>: ' + (p.pulled * p.info.L).toFixed(1) + ' of ' + p.info.L.toFixed(1) + ' m pulled.  ' : '<b>' + esc(p.info.name) + '</b>, ' + p.info.L.toFixed(1) + ' m.  ') +
        '<b>Hold</b> the ' + w.thing + ' end and drag along the run, or walk along it: it follows through the holes';
    }
    if (h.sv === 'end') {
      const w = WORDS[h.obj.cls] || WORDS.cable, n = h.obj.items.length;
      return '<b>Hold</b> to ' + w.join + (n > 1 ? ' (' + n + ' ends here)' : '');
    }
    if (h.sv === 'open') return 'This run is inside a closed wall.  <b>Hold</b> to open the wall: its lining and batts come off (the whole face)';
    return '';
  }

  /* ================= gestures ================= */
  const _ro = new T.Vector3(), _rd = new T.Vector3(), _p = new T.Vector3();
  const rayDistTo = (o, d, w) => { const ax = w[0] - o.x, ay = w[1] - o.y, az = w[2] - o.z, t = Math.max(0, ax * d.x + ay * d.y + az * d.z); return Math.hypot(ax - d.x * t, ay - d.y * t, az - d.z * t); };
  function armTo(R, w, lean = 0.08, secs = 0.15) {
    const dy = w[1] - (P.y + 1.35), h = Math.max(0.2, Math.hypot(w[0] - P.x, w[2] - P.z));
    const a = clamp(-(Math.PI / 2 + Math.atan2(dy, h)), -3, -0.35);
    R.pose(a, a, lean, secs);
  }
  // drilling: sweep the pointer, queue every dot it passes within reach, drill them one at a time
  function sweep(R) {
    const o = R.ray.origin, d = R.ray.direction, sr = sweepM();
    for (const b of C.bores) {
      const key = b.run + '#' + b.index;
      if (act.seen.has(key) || !inReach(b.w)) continue;
      let dm = rayDistTo(o, d, b.w);
      if (act.prev && dm >= sr) for (const k of [0.25, 0.5, 0.75]) {          // a quick flick passes dots between frames
        _ro.lerpVectors(act.prev.o, o, k); _rd.lerpVectors(act.prev.d, d, k).normalize();
        dm = Math.min(dm, rayDistTo(_ro, _rd, b.w));
      }
      if (dm < sr) { act.seen.add(key); act.queue.push(b); }
    }
    act.prev = { o: o.clone(), d: d.clone() };
  }
  function tickDrill(dt, R) {
    if (!act.released) sweep(R);
    const Rr = RS();
    while (!act.cur && act.queue.length) {
      const b = act.queue.shift(), run = Rr.runs[b.run];
      if (run && run.bores[b.index] && !run.bores[b.index].done) { act.cur = b; act.t = 0; act.chip = 0; R.face(b.w[0], b.w[2]); }
    }
    if (act.cur) {
      const b = act.cur, holeS = act.power ? HOLE_S.power : HOLE_S.battery;
      act.t += dt; act.chip += dt;
      if (act.chip > 0.045) { act.chip = 0; G.burst(b.w[0], b.w[1], b.w[2], 2, SAWDUST, 0.9, 0.7, 0.022, 0.35); }
      G.cam.shake = Math.min(G.cam.shake + dt * 0.25, 0.06);
      armTo(R, b.w, 0.12);
      placeDrill(b.w, 0, dt);
      if (act.t >= holeS) {
        const r = cmd('routes.work', { id: b.run, what: 'bore', index: b.index });
        act.cur = null;
        if (r.ok && r.done) {
          act.done++;
          G.burst(b.w[0], b.w[1], b.w[2], 6, SAWDUST, 1.3, 1.1, 0.03, 0.5);
          G.burst(b.w[0], b.w[1], b.w[2], 2, 0x3a2a18, 0.3, 0.2, 0.02, 0.25);
          if (G.juice) G.juice.hitStop = 0.02;
          if (b.plate) R.say('Close to the face: a nail plate goes over that hole once the run is through.', 1.6);
        } else if (!r.ok) R.say(r.reason === 'Open this wall first' ? 'This wall is closed up: open it first.' : 'Cannot drill there: ' + r.reason, 2);
      }
    } else if (act.hit) placeDrill(act.hit.w, 0.1, dt);
    const left = C.bores.filter((b) => inReach(b.w) && !act.seen.has(b.run + '#' + b.index)).length;
    if (act.hit) act.hit.hintDown = 'Drilling: sweep along the dots  (' + act.done + ' drilled' + (act.queue.length + (act.cur ? 1 : 0) ? ', ' + (act.queue.length + (act.cur ? 1 : 0)) + ' to go' : '') + (left ? ', ' + left + ' more in reach' : '') + ')';
    drawQueued();
    if (act.released && !act.cur && !act.queue.length) {
      const all = C.bores.length;
      if (act.done) R.say(act.done + (act.done === 1 ? ' hole' : ' holes') + ' drilled.' + (all ? '  ' + all + ' still to drill.' : '  Holes done: now pull the run through.'), 2.4);
      act = null; queued.count = 0;
    }
  }
  function drawQueued() {
    let n = 0;
    const pulse = 1 + Math.sin(performance.now() / 90) * 0.2;
    for (const b of act.cur ? [act.cur, ...act.queue] : act.queue) {
      if (n >= NQ) break;
      M4.compose(V.set(b.w[0], b.w[1], b.w[2]), Q.identity(), S3.setScalar(b === act.cur ? 1.5 * pulse : 1)); queued.setMatrixAt(n++, M4);
    }
    queued.count = n; queued.instanceMatrix.needsUpdate = true;
  }
  let drillAt = null;
  function placeDrill(w, back, dt) {
    const sh = [P.x, P.y + 1.3, P.z], d = [w[0] - sh[0], w[1] - sh[1], w[2] - sh[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    const k = 0.19 + back, want = [w[0] - d[0] / l * k, w[1] - d[1] / l * k, w[2] - d[2] / l * k];
    if (!drillAt || !drill.visible) drillAt = want.slice();
    const f = Math.min(1, dt * 18);
    for (let i = 0; i < 3; i++) drillAt[i] += (want[i] - drillAt[i]) * f;
    drill.position.set(drillAt[0], drillAt[1], drillAt[2]);
    drill.lookAt(drillAt[0] + d[0], drillAt[1] + d[1], drillAt[2] + d[2]);
    drill.visible = true;
  }

  // pulling: the head of the run moves along its path toward the pointer (or the hand, walking), never backwards
  const _ray = new T.Ray(), _a = new T.Vector3(), _b = new T.Vector3(), _on = new T.Vector3();
  function tickPull(dt, R) {
    const I = act.info, win0 = act.head - 0.4, win1 = act.head + 2;
    _ray.copy(R.ray);
    let cand = -1, bd = 0.35;
    for (let i = 1; i < I.wp.length; i++) {
      if (I.cum[i] < win0 || I.cum[i - 1] > win1) continue;
      _a.fromArray(I.wp[i - 1]); _b.fromArray(I.wp[i]);
      const d = Math.sqrt(_ray.distanceSqToSegment(_a, _b, null, _on));
      if (d < bd) { bd = d; cand = clamp(I.cum[i - 1] + _on.distanceTo(_a), win0, win1); }
    }
    const hd = R.hand(), hs = sOnPoly(I.wp, I.cum, [hd.x, hd.y, hd.z]), hp = polyAt(I.wp, I.cum, hs).p;
    if (hs <= win1 && Math.hypot(hp[0] - hd.x, hp[2] - hd.z) < 1.0) cand = Math.max(cand, hs);
    act.far = false;
    if (cand > act.head + 1e-3) {
      let to = Math.min(cand, act.head + PULL_MPS * dt, I.L);
      if (!inReach(polyAt(I.wp, I.cum, to).p, 0.5)) { act.far = true; to = act.head; }
      const before = act.head; act.head = to;
      spin.rotation.x += (to - before) / 0.075;
      I.boreS.forEach((bs) => { if (bs > before && bs <= to) { const q = polyAt(I.wp, I.cum, bs).p; G.burst(q[0], q[1], q[2], 2, SAWDUST, 0.4, 0.4, 0.018, 0.25); } });
      const vtx = I.cum.some((c) => c > act.committed + 1e-3 && c <= to);
      if (to - act.committed >= COMMIT_M || vtx || to >= I.L - 1e-3) commitPull(R);
      if (!act) return;
    }
    const hp2 = polyAt(I.wp, I.cum, act.head).p;
    armTo(R, hp2, -0.06);
    drawLive(I, act.committed, act.head);
    if (act.hit && act.doneAll) act.hit.hintDown = 'Pulled through.  Let go, then hold on each end to ' + (WORDS[I.cls] || WORDS.cable).join;
    else if (act.hit) act.hit.hintDown = (act.far ? 'Walk along the run: the ' + (WORDS[I.cls] || WORDS.cable).thing + ' follows you.  ' : 'Pulling ') + act.head.toFixed(1) + ' of ' + I.L.toFixed(1) + ' m';
  }
  function commitPull(R) {
    const I = act.info, to = act.head >= I.L - 0.02 ? 1 : act.head / I.L;
    const run = RS().runs[act.run], need = run && SV0() && to > run.pulled ? SV0().workCost(run, 'pull', { from: run.pulled, to }) : {}, miss = short(I.frame, need);
    if (miss) { R.say(shortWords(miss), 2.8); act.head = act.committed; act = null; live.count = 0; spool.visible = false; return; }
    popOK = true;
    const r = cmd('routes.work', { id: act.run, what: 'pull', to });
    if (r.ok && r.done) take(I.frame, need);
    act.committed = act.head;
    if (!r.ok) { R.say('Cannot pull: ' + r.reason, 2); act = null; live.count = 0; spool.visible = false; return; }
    if (to >= 1) {
      const end = I.wp[I.wp.length - 1];
      flash(end, 0.1); G.burst(end[0], end[1], end[2], 8, GREEN, 0.8, 1, 0.03, 0.4);
      R.say('Pulled through: ' + I.name + ', ' + I.L.toFixed(1) + ' m.  Now hold on each end to ' + (WORDS[I.cls] || WORDS.cable).join + '.', 3.5);
      act.doneAll = true; act.head = I.L; live.count = 0;
    }
  }
  function drawLive(I, s0, s1) {
    let n = 0;
    liveMat.color.set(I.colour);
    const seg = (p, q) => {
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]);
      if (l < 1e-4 || n >= NL) return;
      placeAlong(live, n++, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [d[0] / l, d[1] / l, d[2] / l], l, I.r * 2, I.r * 2);
    };
    if (!act.doneAll) {
      let prev = polyAt(I.wp, I.cum, s0).p;
      for (let i = 1; i < I.cum.length; i++) if (I.cum[i] > s0 && I.cum[i] < s1) { seg(prev, I.wp[i]); prev = I.wp[i]; }
      const head = polyAt(I.wp, I.cum, s1).p; seg(prev, head);
      // the slack from the spool up to where the run starts
      const sp = spool.position; seg([sp.x, sp.y + 0.08, sp.z], I.wp[0]);
    }
    live.count = n; live.instanceMatrix.needsUpdate = true;
  }
  function placeSpool(I) {
    const s = I.wp[0], dx = P.x - s[0], dz = P.z - s[2], l = Math.hypot(dx, dz) || 1;
    let floorY = s[1] - 0.4;
    try { const f = RS().frames[I.frame], ch = f && G.routes && G.routes.channelsFor(I.frame); if (f && ch && ch.floor) floorY = f.y + ch.floor.top; } catch (e) { /* the run's own height will do */ }
    spool.position.set(s[0] + dx / l * 0.35, Math.min(s[1], floorY + 0.11), s[2] + dz / l * 0.35);
    spool.rotation.set(0, Math.atan2(dx, dz), 0);
    coreMat.color.set(I.colour);
    spool.visible = true;
  }

  function tickCrimp(dt, R) {
    const e = act.target, w = WORDS[e.cls] || WORDS.cable;
    act.t += dt;
    const k = Math.min(1, act.t / CRIMP_S);
    R.pose(-1.25 - Math.sin(act.t * 18) * 0.06, -1.25 + Math.sin(act.t * 18) * 0.06, 0.1, 0.12);
    aim.visible = true; aim.position.set(e.w[0], e.w[1], e.w[2]); aim.lookAt(G.camera.position);
    aim.scale.setScalar(1.3 - 0.5 * k); aim.material.color.set(e.cls === 'supply' ? 0xd08a3a : 0xc8ccd0).lerp(Cc.set(GREEN), k);
    if (act.hit) act.hit.hintDown = w.joining + '...  keep holding';
    if (k >= 1 && !act.doneAll) {
      act.doneAll = true;
      let n = 0;
      const Rr0 = RS(), costs = e.items.map((it) => (Rr0.runs[it.run] && SV0() ? SV0().workCost(Rr0.runs[it.run], 'join', { end: it.end }) : {})), need = {};
      for (const c of costs) for (const [k, q] of Object.entries(c)) need[k] = (need[k] || 0) + q;
      const fr = Rr0.runs[e.items[0].run] && Rr0.runs[e.items[0].run].frame, miss = short(fr, need);
      if (miss) { R.say(shortWords(miss), 2.6); act = null; aim.visible = false; return; }
      e.items.forEach((it, i) => { const r = cmd('routes.work', { id: it.run, what: 'join', end: it.end }); if (r.ok && r.done) { n++; take(fr, costs[i]); } });
      flash(e.w, 0.09); G.burst(e.w[0], e.w[1], e.w[2], 7, GREEN, 0.7, 0.9, 0.025, 0.35);
      if (G.juice) G.juice.hitStop = 0.04;
      G.cam.shake = Math.min(G.cam.shake + 0.05, 0.3);
      const Rr = RS(), A = sysApi('routes'), finished = e.items.filter((it) => Rr.runs[it.run] && A.runState(Rr.runs[it.run], Rr.nodes).complete);
      if (finished.length) {
        for (const it of finished) { const I = C && C.runs[it.run]; if (I) for (const q of [I.wp[0], I.wp[I.wp.length - 1]]) flash(q, 0.14); }
        if (cmd('services.note', { key: 'rough:first' }).first) { R.beat('Roughed in!'); R.say('Drilled, pulled and ' + w.joined.toLowerCase() + ': that run is in. Insulation and lining can cover it now.', 5); }
        else R.say(w.joined + '. ' + (finished.length === 1 ? 'That run is roughed in.' : finished.length + ' runs roughed in.'), 2.5);
      } else R.say(w.joined + (n > 1 ? ' (' + n + ' ends)' : '') + '. Now the other end.', 2);
    }
  }

  // opening a wall: pry the lining off; the whole face comes away (services.openWall: construction.dismantle on it)
  const OPEN_S = 0.9;
  function tickOpen(dt, R) {
    const o = act.target;
    act.t += dt;
    const k = Math.min(1, act.t / OPEN_S);
    R.pose(-1.4 - Math.sin(act.t * 11) * 0.12, -1.3, 0.12, 0.1);
    aim.visible = true; aim.position.set(o.w[0], o.w[1], o.w[2]); aim.lookAt(G.camera.position);
    aim.scale.setScalar(1.6 - 0.6 * k); aim.material.color.set(0xd8d0c0);
    if (act.chip = (act.chip || 0) + dt, act.chip > 0.12) { act.chip = 0; G.burst(o.w[0], o.w[1], o.w[2], 2, 0xe8e4dc, 0.6, 0.6, 0.03, 0.3); }
    if (act.hit) act.hit.hintDown = 'Opening the wall...  keep holding';
    if (k >= 1 && !act.doneAll) {
      act.doneAll = true;
      const r = cmd('services.openWall', { structId: o.frame, host: o.host });
      if (r.ok) {
        G.burst(o.w[0], o.w[1], o.w[2], 14, 0xe8e4dc, 1.4, 1.4, 0.05, 0.6);
        G.cam.shake = Math.min(G.cam.shake + 0.08, 0.3);
        G.markStockDirty && G.markStockDirty();
        R.say('Wall opened: the lining and batts are off. Finish the run, then insulate and line it again.', 3.5);
      } else R.say(r.reason === 'something stands on it' ? 'Take off what is fixed to this wall first.' : 'Cannot open it: ' + r.reason, 2.5);
    }
  }

  /* ================= the reach user ================= */
  RCH.use({
    id: 'services-hands',
    near(px, pz) {
      const c = scan(); if (!c) return false;
      const by = (w) => Math.hypot(w[0] - px, w[2] - pz) < 6;
      return c.bores.some((b) => by(b.w)) || c.boxes.some((b) => by(b.w)) || c.pulls.some((p) => by(p.w)) || c.ends.some((e) => by(e.w)) || c.opens.some((o) => by(o.w));
    },
    hover(R) {
      if (R.held || planBusy()) { hovered = null; return null; }
      const h = findHit(R);
      hovered = h;
      if (h) h.hint = hintFor(h);
      return h;
    },
    press(hit, R) {
      if (hit.sv === 'far') { R.say('Too far to reach: walk closer.', 1.5); return; }
      if (hit.sv === 'bore') {
        act = { kind: 'drill', hit, queue: [], seen: new Set(), cur: null, t: 0, done: 0, prev: null, power: powered(), released: false };
        act.seen.add(hit.obj.run + '#' + hit.obj.index); act.queue.push(hit.obj);
        return;
      }
      if (hit.sv === 'box') {
        const b = hit.obj, now = performance.now(), what = BOX_KINDS[b.kind];
        if (tap && tap.node === b.node && now - tap.t < 8000) {
          const node = RS().nodes[b.node], need = node && SV0() ? SV0().nodeCost(node) : {}, miss = short(b.frame, need);
          if (miss) { tap = null; heldBox.visible = false; R.say(shortWords(miss), 2.6); return; }
          const r = cmd('routes.setNode', { id: b.node, state: 'set' });
          if (r.ok) take(b.frame, need);
          tap = null; heldBox.visible = false;
          if (!r.ok) { R.say('Cannot fix it: ' + r.reason, 2); return; }
          R.pose(-2.5, -0.9, 0.14, 0.09);
          setTimeout(() => RCH.R.pose(-0.9, -0.9, 0.04, 0.18), 90);
          G.burst(b.w[0], b.w[1], b.w[2], 6, 0xd8d0c0, 0.9, 0.9, 0.035, 0.4);
          G.cam.shake = Math.min(G.cam.shake + 0.06, 0.3); if (G.juice) G.juice.hitStop = 0.05;
          const left = C ? C.boxes.length : 0;
          R.say((what === 'stub-out' ? 'Stub-out strapped to the stud.' : 'Box nailed to the stud.') + (left ? '  ' + left + ' more to fix.' : ''), 2);
        } else {
          tap = { node: b.node, t: now, kind: b.kind };
          heldBox.position.set(b.w[0], b.w[1], b.w[2]);
          const s = b.kind === 'stub_supply' ? 0.05 : b.kind === 'box_ceiling' ? 0.105 : 0.095;
          heldBox.scale.set(s, s, s); heldBox.material.color.set(b.kind === 'stub_supply' ? 0xd8d8d0 : 0x2d6fb8); heldBox.visible = true;
          R.pose(-1.55, -1.55, 0.06, 0.4);
          G.burst(b.w[0], b.w[1], b.w[2], 2, 0xd8d0c0, 0.4, 0.3, 0.02, 0.25);
        }
        return;
      }
      if (hit.sv === 'pull') {
        const p = hit.obj, I = p.info;
        act = { kind: 'pull', hit, run: p.run, info: I, head: p.pulled * I.L, committed: p.pulled * I.L, far: false, doneAll: false };
        placeSpool(I);
        return;
      }
      if (hit.sv === 'end') { act = { kind: 'crimp', hit, target: hit.obj, t: 0, doneAll: false }; return; }
      if (hit.sv === 'open') { act = { kind: 'open', hit, target: hit.obj, t: 0, doneAll: false }; return; }
    },
    move() {},
    release(hit, R, cancelled) {
      if (!act) return;
      if (act.kind === 'drill') { act.released = true; act.hit = null; if (cancelled) { act = null; queued.count = 0; } return; }
      if (act.kind === 'pull') {
        if (!act.doneAll && act.head > act.committed + 1e-3) commitPull(R);
        if (act && !act.doneAll && !cancelled) R.say(act.head.toFixed(1) + ' of ' + act.info.L.toFixed(1) + ' m pulled.  Grab the end again to carry on.', 2.2);
        act = null; live.count = 0; spool.visible = false; return;
      }
      if (act.kind === 'crimp') {
        if (!act.doneAll && !cancelled) R.say('Hold until it ' + (act.target.cls === 'supply' ? 'closes' : 'clamps') + '.', 1.4);
        act = null; aim.visible = false;
      }
      if (act && act.kind === 'open') { if (!act.doneAll && !cancelled) R.say('Hold until the lining comes off.', 1.4); act = null; aim.visible = false; }
    },
    secondary() { if (tap) { tap = null; heldBox.visible = false; return true; } return false; },
    frame(dt, R) {
      const c = scan();
      tickFlashes(dt);
      if (popping && C) { const now = performance.now(); writeFixings(now); if (now > popping) { popping = 0; writeFixings(now + 1e4); } }
      if (!c) return;
      if (act && act.kind !== 'crimp') aim.visible = false;
      if (act && act.kind === 'drill') tickDrill(dt, R);
      else if (act && act.kind === 'pull') tickPull(dt, R);
      else if (act && act.kind === 'crimp') tickCrimp(dt, R);
      else if (act && act.kind === 'open') tickOpen(dt, R);
      if (!act) {
        queued.count = 0;
        const h = R.on && !R.held && !planBusy() ? hovered : null;
        if (h && h.sv === 'bore') placeDrill(h.w, 0.12, dt); else drill.visible = false;
        if (h && h.sv !== 'far') {
          aim.visible = true; aim.position.set(h.w[0], h.w[1], h.w[2]); aim.lookAt(G.camera.position);
          aim.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.12);
          aim.material.color.set(h.sv === 'bore' ? 0xffd23a : h.sv === 'box' ? 0x8fc0ff : h.sv === 'pull' ? (h.obj.info.colour) : h.sv === 'open' ? 0xd8d0c0 : 0xd08a3a);
        } else aim.visible = false;
      } else if (act.kind !== 'drill') drill.visible = false;
      if (tap && (!R.on || performance.now() - tap.t > 8000)) { tap = null; heldBox.visible = false; }
    },
    leave() { if (act && act.kind === 'pull' && !act.doneAll && act.head > act.committed + 1e-3) commitPull(RCH.R); act = null; tap = null; hovered = null; drill.visible = false; aim.visible = false; heldBox.visible = false; spool.visible = false; live.count = 0; queued.count = 0; },
  });

  // one line of what is left to do near the player (services-plan shows it on the hint line)
  function summary(px = P.x, pz = P.z) {
    const c = scan(); if (!c) return { bores: 0, boxes: 0, pulls: 0, ends: 0 };
    const by = (w) => Math.hypot(w[0] - px, w[2] - pz) < 8;
    return { bores: c.bores.filter((b) => by(b.w)).length, boxes: c.boxes.filter((b) => by(b.w)).length, pulls: c.pulls.filter((p) => by(p.w)).length, ends: c.ends.reduce((n, e) => n + (by(e.w) ? e.items.length : 0), 0) };
  }
  function workLine() {
    const s = summary(), bits = [];
    const pl = (n, one, many) => '<b>' + n + '</b> ' + (n === 1 ? one : many);
    if (s.boxes) bits.push(pl(s.boxes, 'box to fix', 'boxes to fix'));
    if (s.bores) bits.push(pl(s.bores, 'hole to drill', 'holes to drill'));
    if (s.pulls) bits.push(pl(s.pulls, 'run to pull', 'runs to pull'));
    if (s.ends) bits.push(pl(s.ends, 'end to crimp', 'ends to crimp'));
    return bits.length ? 'Rough-in: ' + bits.join(', ') + '.\n' : '';
  }
  const _s = new T.Vector3();
  const screen = (x, y, z) => { _s.set(x, y, z).project(G.camera); const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + (_s.x * 0.5 + 0.5) * r.width, y: r.top + (-_s.y * 0.5 + 0.5) * r.height }; };
  window.__servicesHands = {
    summary, workLine, screen,
    targets: () => { const c = scan(); return c ? { bores: c.bores.map((b) => ({ run: b.run, index: b.index, w: b.w, reach: inReach(b.w) })), boxes: c.boxes.map((b) => ({ node: b.node, w: b.w })), pulls: c.pulls.map((p) => ({ run: p.run, pulled: p.pulled, w: p.w, L: p.info.L })), ends: c.ends.map((e) => ({ node: e.node, w: e.w, items: e.items })), opens: c.opens.map((o) => ({ frame: o.frame, host: o.host, run: o.run, w: o.w })) } : null; },
    // where a kind of work is, in the world and on the screen: 'bore' | 'box' | 'pull' | 'end' (the first in reach), or a path point of a run
    where(kind, i = 0) { const t = this.targets(); if (!t) return null; const list = { bore: t.bores, box: t.boxes, pull: t.pulls, end: t.ends, open: t.opens }[kind] || []; const o = list[i]; return o ? { ...o, screen: screen(o.w[0], o.w[1], o.w[2]) } : null; },
    pathOf: (runId) => { const I = scan() && C.runs[runId]; return I ? { wp: I.wp, L: I.L } : null; },
    fixings: () => ({ staples: staples.count, plates: plates.count, rings: rings.count }),
    get busy() { return act ? act.kind : null; },
  };
})();
