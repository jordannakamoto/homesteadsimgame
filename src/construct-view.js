// Construction view: the Build panel, deliveries as stacks, carrying, and raising a building by hand, stage by stage.
// The truth is the simulation's construction system (src/sim/construction.js); the wording and rates are its
// content (src/sim/content/construction.js); stacks and the load in the arms are drawn by src/engine/carry.js,
// the pieces going in by src/engine/assembly.js. Build mode owns the building's shape and draws what is finished.
// Keys: L the Build panel, click or E: pick up, set a piece, nail it. Build mode keeps its own keys while it is open.
(() => {
  const G = window.__game, B = window.__build;
  if (!G || !B || !B.structs || !window.__carry || !window.__assembly || !G.stepHooks) return;
  const $ = (id) => document.getElementById(id),
    panel = $('cv'), body = $('cvbody'), nextEl = $('cvnext'), promptEl = $('cvprompt'), banner = $('cvbanner'), canvas = $('view');
  if (!panel || !canvas) return;
  const T = G.THREE;
  const sys = () => G.sim.systems.find((s) => s.name === 'construction');
  if (!sys()) return;
  const api = sys().api, C = api.content, CAT = api.catalog;
  const S = () => G.sim.state.sys.construction;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const num = (v) => (v >= 100 ? String(Math.round(v)) : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  const UNIT = { each: '', m: ' m', m2: ' m²', m3: ' m³', kg: ' kg', L: ' L' };
  const plain = (label) => label.replace(/\s*\(.*\)/, '');
  const low = (t) => t.charAt(0).toLowerCase() + t.slice(1);

  const look = B.memberLook();
  const MARK = [0.09, 0.08, 0.09], CHALK = [0.8, 0.9, 1.0];       // pencil, and a snapped chalk line (pale blue)
  const asm = window.__assembly.create(G, { geo: look.geo, mat: look.mat, alt: look.alt, colorOf: (m) => (m.col === 'mark' ? MARK : m.col === 'chalk' ? CHALK : look.colors[m.col || 'timber'] || look.colors.timber) });
  const sounds = window.__assembly.createSounds();
  const carry = window.__carry.create(G);
  const reach = window.__carry.createReach(G, { reach: C.WORK.reachM });
  const CS = window.__cutStation ? window.__cutStation.create(G) : null;     // the sawhorses, and the saw going through each stick
  const SC = window.__scaffold ? window.__scaffold.create(G) : null;         // a rented scaffold bay along a wall
  const RW = window.__roofwalk && window.__framing ? window.__roofwalk.create(G) : null;   // standing on a decked roof, clipped in at the ridge
  const FR = window.__framing, RWC = C.ROOFWALK || { slideK: 0.5, slideMps: 0.55, ropeM: 14, anchorReachM: 1.3, edgeM: 0.22, says: '' };
  const REACH = C.WORK.reachM;
  const OFF = { build: 1, garden: 1, hands: 1 };       // other tools own the pointer while they are out
  const V = {
    sim: null, rev: 1, bv: -1, sel: null, structs: new Map(), geom: new Map(), plans: new Map(), planVer: new Map(), fresh: new Map(), flushing: [],
    working: null, auto: null, raise: null, ctx: null, fWas: false, idleT: 0, placing: null, pendingPlan: null, book: false, expand: null, quotes: {},
    blows: {}, named: {}, cool: 0, sawing: new Set(), swingIn: null, flights: new Map(), blow: null, handT: 9, mDown: false, poseT: 0, poseKind: '',
    uiSig: '', nextSig: '', promptSig: '', glowSig: '', stackSig: '', loadSig: '', braceSig: '', cardStage: null, sayT: 0, bannerT: 0, target: null, lastLand: 0, hint: null, hintT: 0, pct: -1,
  };
  const cmd = (name, payload) => { const r = G.sim.commandNow('construction.' + name, payload || {}); V.rev++; G.markStockDirty && G.markStockDirty(); return r; };
  const freshOf = (id) => { let f = V.fresh.get(id); if (!f) V.fresh.set(id, (f = new Set())); return f; };

  // ------------------------------------------------------------------ what is being built, read once per change
  const KR = { site: 0, pier: 1, footing: 1, post: 2, beam: 3, skid: 3, stemwall: 3, slab: 4, joist: 5, plate: 6, stud: 7, header: 8, rafter: 9, sheathing: 10, drip: 10.5, membrane: 11, rake: 11.5, roofing: 12, ridgecap: 12.6, cladding: 13, gutter: 13.4, downspout: 13.6, window: 14, door: 15, insulation: 16, lining: 17 };
  const TR = { rim: -0.5, end: 0, bottom: -0.2, top: -0.1, jack: 0.5, sill: 2.5, cripple: 2.7, gable: 2.6, underlayment: -1, 'ice-water': -1, starter: -0.3 };
  function geom(id) {
    const st = V.structs.get(id);
    if (!st) return null;
    let g = V.geom.get(id);
    if (g && g.ver === st.ver) return g;
    const mw = B.membersOf(id);
    if (!mw) return null;
    g = { ver: st.ver, byId: new Map(), matrix: mw.matrix.clone(), rank: new Map(), walls: new Map(), cx: 0, cz: 0 };
    for (const m of mw.list) { g.byId.set(m.id, m); if ((m.kind === 'membrane' && m.type === 'housewrap') || m.roll) (V.sheetMids || (V.sheetMids = new Set())).add(m.id); }
    // the roof planes in their own frames: for standing on them, and for the chalk line of the next course
    g.frames = new Map(); g.roofOf = new Map();
    for (const R of mw.roofs || []) for (const pl of R.planes) { g.frames.set(pl.id, FR.planeFrame(pl)); g.roofOf.set(pl.id, R); }
    // doors and windows are pieces of their own: stand a box in for each so that it can glow and be set
    const inv = g.matrix.clone().invert(), v = new T.Vector3();
    for (const p of B.pieces()) {
      if (p.struct !== id || !p.parent || (p.kind !== 'door' && p.kind !== 'window')) continue;
      const a = v.set(p.a.x, p.y0, p.a.z).applyMatrix4(inv).toArray(), b = v.set(p.b.x, p.y0, p.b.z).applyMatrix4(inv).toArray(), top = v.set(p.a.x, p.y1, p.a.z).applyMatrix4(inv).y;
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
      g.byId.set(p.id, { id: p.id, kind: p.kind, type: p.type, stage: 'openings', parent: p.parent, a: [mx, a[1], mz], b: [mx, top, mz], n: [(b[0] - a[0]) / L, 0, (b[2] - a[2]) / L], section: { b: 0.05, d: L }, col: p.kind === 'door' ? 'timber' : 'wrap' });
    }
    let n = 0;
    for (const m of g.byId.values()) if (m.kind === 'plate') { g.cx += (m.a[0] + m.b[0]) / 2; g.cz += (m.a[2] + m.b[2]) / 2; n++; }
    if (n) { g.cx /= n; g.cz /= n; }
    g.reach = 1;
    for (const m of g.byId.values()) if (m.kind === 'plate' || m.kind === 'joist' || m.kind === 'pier') g.reach = Math.max(g.reach, Math.hypot(m.a[0] - g.cx, m.a[2] - g.cz), Math.hypot(m.b[0] - g.cx, m.b[2] - g.cz));
    // the order pieces go in: by stage, then by kind, then along the building
    for (const m of g.byId.values()) {
      const mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[2] + m.b[2]) / 2, my = (m.a[1] + m.b[1]) / 2;
      g.rank.set(m.id, C.STAGE_ORDER.indexOf(m.stage) * 1e6 + ((KR[m.kind] || 0) + (TR[m.type] || 0) + 2) * 1e4 + (m.kind === 'sheathing' || m.course || m.kind === 'cladding' && m.type !== 'vboards' && m.type !== 'batten' || m.kind === 'stud' && m.type === 'cripple' ? my * 300 : 0) + (mx - g.cx) + 0.37 * (mz - g.cz) + 50);
    }
    // each framed wall: the line it swings up about (the inner edge of its bottom plate)
    for (const m of g.byId.values()) {
      if (m.kind !== 'plate' || m.type !== 'top' || m.stage !== 'wall-frame') continue;
      let ylow = 1e9, ytop = -1e9;
      for (const q of g.byId.values()) if (q.parent === m.parent && q.stage === 'wall-frame') { ylow = Math.min(ylow, q.a[1], q.b[1]); ytop = Math.max(ytop, q.a[1], q.b[1]); }
      const L = Math.hypot(m.b[0] - m.a[0], m.b[2] - m.a[2]) || 1, ux = (m.b[0] - m.a[0]) / L, uz = (m.b[2] - m.a[2]) / L,
        mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[2] + m.b[2]) / 2;
      let ix = -uz, iz = ux;
      if (ix * (g.cx - mx) + iz * (g.cz - mz) < 0) { ix = -ix; iz = -iz; }
      const sign = -uz * ix + ux * iz > 0 ? 1 : -1;
      g.walls.set(m.parent, { pivot: [m.a[0] + ix * 0.045, ylow - 0.019, m.a[2] + iz * 0.045], axis: [ux, 0, uz], flat: sign * Math.PI / 2, mid: [mx, mz], inward: [ix, iz], top: ytop, low: ylow - 0.019, u: [ux, uz], len: L });
    }
    V.geom.set(id, g);
    return g;
  }
  // per building, per change: what can go in now (in order), which frame waits to be raised, and the panel's view of it
  function plan(id) {
    let p = V.plans.get(id);
    if (p && p.rev === V.rev) return p;
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g) return null;
    const inst = api.installable(pr).filter((m) => g.byId.has(m) || pr.members[m].kind === 'site').sort((a, b) => (g.rank.get(a) || 0) - (g.rank.get(b) || 0));
    let raise = null;
    for (const st of C.STAGES) if (st.flat && api.stageOpen(pr, st.id)) { const cur = api.flatCurrent(pr, st.id); if (cur && api.frameReady(pr, st.id, cur)) raise = cur; }
    p = { rev: V.rev, inst, raise, view: api.buildingView(S(), id) };
    V.plans.set(id, p);
    return p;
  }
  const inProgress = () => Object.values(S().progress).filter((pr) => !pr.done && V.structs.has(pr.id));
  function current() {
    const s = S();
    if (V.sel !== null && s.progress[V.sel] && V.structs.has(V.sel)) return s.progress[V.sel];
    const list = inProgress();
    return list.length ? list[list.length - 1] : null;
  }
  const lineOf = (pr, memberId) => { const m = pr.members[memberId]; return m && m.line ? pr.lines[m.line] : null; };
  // the item this member takes from the arms: its line's, the cut piece once it is cut at the sawhorses, or null until then
  const wantOf = (pr, id) => api.wantItem(pr, id);
  const holds = (c, pr, id) => !!c && c.itemId === wantOf(pr, id);
  const usable = (pr, pl, c) => pl.inst.filter((id) => { const ln = lineOf(pr, id); return !ln || pr.members[id].need - pr.members[id].got < 1e-6 || holds(c, pr, id) || (!pr.members[id].site && !api.needsStock(S(), pr, id)); });

  // ------------------------------------------------------------------ keeping build mode and the simulation in step
  function attach() {
    B.setSupportKinds && B.setSupportKinds(C.SUPPORT);
    B.setOnClimbOut && B.setOnClimbOut((e) => { flash('No door in this room: you climb out over the wall'); sounds.play('thunk'); G.burst(e.x, G.heightAt(e.x, e.z) + 0.2, e.z, 6, 0xb9a88a, 1.2, 1.4, 0.08, 0.5); });
    V.sim = G.sim; V.rev++; V.bv = -1; V.sel = null;
    for (const k of asm.keys()) asm.remove(k);
    V.structs.clear(); V.geom.clear(); V.plans.clear(); V.planVer.clear(); V.fresh.clear(); V.flushing = []; V.working = null; V.auto = null; V.raise = null; V.placing && endPlacing();
    SC && SC.release(); V.scafHeld = false; V.horsesHeld = false; V.sawing.clear();
    carry.forget(); V.stackSig = V.loadSig = V.uiSig = V.nextSig = V.glowSig = V.braceSig = '';
    G.sim.listen((type, data) => {
      if (!type.startsWith('construction.')) return;
      V.rev++;
      if (type === 'construction.delivered') { say('Your delivery has arrived.', 'good'); note('Delivery', 'Your materials are at the delivery spot.'); }
    });
  }
  function syncPlans() {
    const s = S(), pieces = B.pieces();
    V.structs.clear();
    for (const st of B.structs()) V.structs.set(st.id, st);
    for (const st of V.structs.values()) {
      const pr = s.progress[st.id];
      if (!pr && !st.planned) continue;
      if (pr && V.planVer.get(st.id) === st.ver) continue;
      const pend = V.pendingPlan && V.pendingPlan.struct === st.id ? V.pendingPlan : null;
      const extra = { x: st.x, z: st.z, r: st.r };
      if (!pr) Object.assign(extra, pend ? { name: pend.name, planId: pend.planId, tutorial: pend.planId === 'shed' } : { name: 'Your plan ' + st.id, planId: null });
      cmd('setPlan', api.planFromPieces(st.id, pieces, B.materialsList(st.id), extra));
      if (pend) V.pendingPlan = null;
      V.planVer.set(st.id, st.ver);
      settleStrays(st.id);
      reconcile(st.id);
    }
    for (const id of Object.keys(s.progress)) if (!V.structs.has(+id)) { cmd('forget', { structId: +id }); asm.remove(+id); V.fresh.delete(+id); }
  }
  // the simulation says what is built; build mode draws it (all but a frame still lying on the deck, and pieces just put in)
  // an unbuilt place with no geometry to aim at can never be set by hand: finish it with its stage
  function settleStrays(id) {
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g) return;
    const lost = Object.keys(pr.members).filter((k) => { const m = pr.members[k]; return !m.built && m.kind !== 'site' && !g.byId.has(k); });
    if (lost.length) cmd('settle', { structId: id, memberIds: lost });
  }
  function reconcile(id) {
    const pr = S().progress[id], mw = B.membersOf(id);
    if (!pr || !mw) return;
    const on = [], off = [], fresh = freshOf(id);
    for (const mid in pr.members) {
      const m = pr.members[mid], lying = C.STAGE[m.stage].flat && !pr.raised[m.parent];
      if (m.built && !lying && !fresh.has(mid) && mw.planned.has(mid)) on.push(mid);
      else if ((!m.built || lying) && !mw.planned.has(mid)) off.push(mid);
    }
    if (on.length) B.setBuilt(on, true);
    if (off.length) B.setBuilt(off, false);
    if (on.length || off.length) keepVer(id);
    redraw(id);
  }
  // build mode's version moves when we hand pieces back; that is not a change of plan
  function keepVer(id) {
    const st = B.structs().find((q) => q.id === id);
    if (st) { V.structs.set(id, st); V.planVer.set(id, st.ver); }
    V.bv = B.version; V.rev++;
  }
  function flush(id) {
    const fresh = freshOf(id);
    if (!fresh.size) return;
    const ids = [...fresh];
    B.setBuilt(ids, true); keepVer(id);
    V.flushing.push({ id, ids, layer: null });       // drawn by us for one more frame, until build mode has drawn them
  }

  // ------------------------------------------------------------------ drawing: pieces just put in, frames lying flat, what can go in next
  function redraw(id) {
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g) return;
    asm.setFrame(id, g.matrix);
    const w = V.working && V.working.id === id && !V.working.partial ? V.working : null;
    const main = [], loose = [];
    for (const mid of freshOf(id)) { const m = g.byId.get(mid); m && m.draw !== 0 && main.push(m); }
    if (w && w.layer === 'main' && w.m.draw !== 0) main.push(w.m);
    for (const c of chalkLines(pr, g)) main.push(c);
    // something too big for one load (siding, roofing) grows as the loads arrive
    for (const mid in pr.members) {
      const pm = pr.members[mid];
      if (pm.built || !(pm.got > 1e-6) || !(pm.need > 0) || V.sawing.has(mid)) continue;
      const m = g.byId.get(mid);
      if (!m || m.draw === 0) continue;
      const f = Math.min(1, pm.got / pm.need), sg = m.n[1] < -0.3 ? -1 : 1, sh = (-sg * m.section.d * (1 - f)) / 2;
      if (f >= 1 - 1e-6) { if (!(C.STAGE[pm.stage].flat && g.walls.has(pm.parent))) { main.push(m); loose.push(['main', mid]); } continue; }      // set, not yet fastened
      main.push({ id: mid + ':part', col: m.col, a: [m.a[0] + m.n[0] * sh, m.a[1] + m.n[1] * sh, m.a[2] + m.n[2] * sh], b: [m.b[0] + m.n[0] * sh, m.b[1] + m.n[1] * sh, m.b[2] + m.n[2] * sh], n: m.n, section: { b: m.section.b, d: m.section.d * f } });
    }
    asm.setSolid(id, 'main', main, 96);
    for (const st of C.STAGES) {
      if (!st.flat) continue;
      const cur = api.flatCurrent(pr, st.id), hw = cur && g.walls.get(cur);
      if (!hw || !api.stageOpen(pr, st.id)) continue;
      const list = [];
      for (const mid in pr.members) { const m = pr.members[mid]; if (m.stage === st.id && m.parent === cur && g.byId.has(mid)) { if (m.built) list.push(g.byId.get(mid)); else if (m.need > 0 && m.got >= m.need - 1e-6 && !V.sawing.has(mid)) { list.push(g.byId.get(mid)); loose.push([cur, mid]); } } }
      marks(pr, g, cur, list);
      if (w && w.layer === cur) list.push(w.m);
      asm.hinge(id, cur, hw.pivot, hw.axis, V.raise && V.raise.parent === cur ? V.raise.angle : hw.flat, 48);
      asm.setSolid(id, cur, list, 48);
    }
    for (const [layer, mid] of loose) liftTo(id, layer, mid, proud(mid));
    if (V.flights.size) tickFlights(0);       // a piece in the air stays in the air
    dotsFor(id);
    V.glowSig = '';
    B.setShell(id, !Object.values(pr.tally).some((t) => t[0] > 0));
    braces(id);
  }
  // the next course on each roof plane: a blue chalk line snapped along where its top edge goes (underlayment and roofing alike)
  function chalkLines(pr, g) {
    const out = [], pl = plan(pr.id), rows = new Map();
    if (!pl || !g.frames || !g.frames.size) return out;
    for (const mid of pl.inst) {
      const pm = pr.members[mid], m = g.byId.get(mid);
      if (!m || !m.course || !m.rs || !g.frames.has(pm.parent) || pm.need - pm.got < 1e-6) continue;
      const k = pm.parent + pm.kind, r = rows.get(k);
      if (!r || m.row < r.row) rows.set(k, { row: m.row, plane: pm.parent, s0: m.rs[0], s1: m.rs[1], t: m.rs[3] });
      else if (m.row === r.row) { r.s0 = Math.min(r.s0, m.rs[0]); r.s1 = Math.max(r.s1, m.rs[1]); r.t = Math.max(r.t, m.rs[3]); }
    }
    for (const r of rows.values()) {
      const F = g.frames.get(r.plane), t = Math.min(r.t, F.top - 0.02);
      if (t <= 0.05) continue;
      out.push({ id: 'chalk:' + r.plane, col: 'chalk', a: F.on(r.s0 + 0.02, t, 0.05), b: F.on(r.s1 - 0.02, t, 0.05), n: [F.up[0] * F.cs, F.k * F.cs, F.up[1] * F.cs], section: { b: 0.004, d: 0.026 } });
    }
    return out;
  }
  // a raised wall is held by a temporary brace until the sheathing is on
  function braces(id) {
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g) return;
    const list = [];
    if (!api.stageComplete(pr, 'sheathing')) for (const par in pr.raised) {
      const hw = g.walls.get(par);
      if (!hw) continue;
      const bx = hw.mid[0] + hw.u[0] * hw.len * 0.22, bz = hw.mid[1] + hw.u[1] * hw.len * 0.22;
      list.push({ id: 'brace:' + par, a: [bx + hw.inward[0] * 0.06, hw.top - 0.5, bz + hw.inward[1] * 0.06], b: [bx + hw.inward[0] * 1.25, hw.low + 0.03, bz + hw.inward[1] * 1.25], n: [hw.u[0], 0, hw.u[1]], section: { b: 0.038, d: 0.089 } });
    }
    const sig = id + ':' + list.map((m) => m.id).join();
    asm.setSolid(id, 'braces', list, 16);
    return sig;
  }
  function glow(ctx) {
    const sig = ctx && (ctx.kind === 'work' || ctx.kind === 'auto' || ctx.kind === 'piece' || ctx.kind === 'hands') ? ctx.id + ':' + ctx.q.length + ':' + ctx.q[0] + ':' + V.rev + (V.working ? V.working.memberId : '') : '';
    if (sig === V.glowSig) return;
    for (const id of asm.keys()) { asm.setGlow(id, 'main', []); const pr = S().progress[id]; if (pr) for (const par of api.flatParents(pr, 'wall-frame')) if (!pr.raised[par]) asm.setGlow(id, par, []); }
    V.glowSig = sig;
    if (!sig) return;
    const pr = S().progress[ctx.id], g = geom(ctx.id), by = new Map();
    for (const mid of ctx.q.slice(0, 60)) {
      const m = g.byId.get(mid), pm = pr.members[mid];
      if (!m || m.draw === 0 || (V.working && V.working.memberId === mid) || (ctx.kind === 'hands' && pm.need > 0 && pm.got >= pm.need - 1e-6)) continue;
      const layer = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) ? pm.parent : 'main';
      by.has(layer) ? by.get(layer).push(m) : by.set(layer, [m]);
    }
    for (const [layer, list] of by) {
      if (layer !== 'main') { const hw = g.walls.get(layer); asm.hinge(ctx.id, layer, hw.pivot, hw.axis, V.raise && V.raise.parent === layer ? V.raise.angle : hw.flat, 48); }
      asm.setGlow(ctx.id, layer, list);
    }
  }

  // the building reads from anywhere: every piece that can go in now breathes faintly, pale where you can reach it
  // from where you stand, amber where it is above you (a ladder, scaffold or the roof first)
  const FAR_OK = [0.78, 0.94, 1], FAR_HIGH = [1, 0.7, 0.28], farLayers = new Map();
  function farGlow() {
    const s = S(), P = G.player, on = !s.options.sandbox && !V.placing && !OFF[P.tool];
    let sig = on ? V.rev + ':' + Math.round(P.y * 2) + ':' + (V.raise ? V.raise.parent + Math.round(V.raise.angle * 8) : '') : '';
    const near = on ? inProgress().filter((pr) => { const st = V.structs.get(pr.id); return st && Math.hypot(P.x - st.x, P.z - st.z) < 45; }) : [];
    sig += ':' + near.map((pr) => pr.id).join();
    if (sig === V.farSig) return;
    V.farSig = sig;
    const want = new Map();
    for (const pr of near) {
      const pl = plan(pr.id), g = geom(pr.id);
      if (!pl || !g) continue;
      const by = new Map();
      let n = 0;
      for (const mid of pl.inst) {
        const m = g.byId.get(mid), pm = pr.members[mid];
        if (!m || m.draw === 0 || !pm || pm.kind === 'site' || (pm.need > 0 && pm.got >= pm.need - 1e-6)) continue;
        if (++n > 320) break;
        const flat = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) && !pr.raised[pm.parent], hw = flat ? g.walls.get(pm.parent) : null, layer = flat ? pm.parent : 'main';
        worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB);
        const high = (wA.y + wB.y) / 2 - P.y > LAD.reachUpM;
        let e = by.get(layer);
        if (!e) by.set(layer, (e = { list: [], cols: [] }));
        e.list.push(m); e.cols.push(high ? FAR_HIGH : FAR_OK);
      }
      want.set(pr.id, by);
    }
    const live = new Set(asm.keys());
    for (const [id, old] of farLayers) { const by = want.get(id); if (live.has(id)) for (const layer of old) if (!by || !by.has(layer)) asm.setFar(id, layer, [], []); }
    farLayers.clear();
    for (const [id, by] of want) {
      const g = geom(id);
      for (const [layer, e] of by) {
        if (layer !== 'main') { const hw = g.walls.get(layer); asm.hinge(id, layer, hw.pivot, hw.axis, V.raise && V.raise.parent === layer ? V.raise.angle : hw.flat, 48); }
        asm.setFar(id, layer, e.list, e.cols);
      }
      farLayers.set(id, new Set(by.keys()));
    }
  }

  // ------------------------------------------------------------------ stacks and the load in the arms
  const COLORS = { lumber: 0xdcbc8c, boards: 0xd6b27c, osb: 0xc9a468, block: 0xb5b2aa, box: 0x8a6f4a, wrap: 0xe8ecea, felt: 0x3a3d43, shingle: 0x50555e, batt: 0xf1bcc8, door: 0x8a6240, pane: 0xa9c6d6, bag: 0xb9b4a6 };
  function describe(itemId, qty) {
    const it = CAT[itemId], f = C.itemForm(itemId), d = (it && it.dims) || {};
    const n = (per) => Math.max(1, Math.min(140, Math.ceil(qty / per - 0.02)));
    if (itemId === 'ladder') return { form: 'ladder', w: 0.46, h: 0.06, l: 3.6, n: 9, color: 0xe3912f };
    if (f === 'lumber') { const l = itemId === 'lumber_2x4' ? 3.0 : 3.6; return { form: 'lumber', w: Math.max(d.depthM, d.widthM), h: Math.min(d.depthM, d.widthM), l, n: n(l), color: COLORS.lumber }; }
    if (f === 'boards') return { form: 'lumber', w: 0.14, h: 0.019, l: 3, n: n(3 * 4), color: COLORS.boards, scaleH: 4 };
    if (f === 'sheet') return { form: 'sheet', w: 1.22, l: 2.44, h: Math.max(0.011, d.thicknessM || 0.011), n: n(1), color: /gypsum/.test(itemId) ? 0xd8d6cf : COLORS.osb };
    if (f === 'block') return { form: 'block', w: 0.3, l: 0.3, h: 0.2, n: n(1), color: COLORS.block };
    if (f === 'roll') return { form: 'roll', w: 0.17, l: 1.0, h: 0.17, n: n(30), color: itemId === 'housewrap' ? COLORS.wrap : COLORS.felt };
    if (f === 'bundle') return { form: 'heap', w: 0.9, l: 0.33, h: 0.09, n: n(3), color: COLORS.shingle };
    if (f === 'trim') return { form: 'lumber', w: 0.12, h: 0.05, l: 3.05, n: n(3.05), color: /gutter|downspout/.test(itemId) ? 0xe4e3de : 0xb9bec2 };
    if (f === 'bale') return { form: 'heap', w: 1.15, l: 0.4, h: 0.28, n: n(5), color: COLORS.batt };
    if (f === 'door') return { form: 'lean', w: 0.92, l: 2.03, h: 0.05, n: n(1), color: COLORS.door };
    if (f === 'pane') return { form: 'lean', w: 0.6, l: 0.9, h: 0.07, n: n(1), color: COLORS.pane };
    if (f === 'bag') return { form: 'heap', w: 0.45, l: 0.3, h: 0.12, n: n(25), color: COLORS.bag };
    return { form: 'heap', w: 0.3, l: 0.22, h: 0.15, n: n(2.5), color: COLORS.box };
  }
  // what a stack is to the player: the name the open work knows it by ("studs"), else what it is sold as
  function stackName(itemId) {
    let best = null;
    for (const pr of Object.values(S().progress)) for (const k in pr.lines) { const ln = pr.lines[k]; if (ln.itemId === itemId && !api.stageComplete(pr, ln.stage)) { if (api.stageOpen(pr, ln.stage)) return low(plain(ln.label)); best = best || low(plain(ln.label)); } }
    return best || low(CAT[itemId] ? CAT[itemId].name : itemId);
  }
  function drawStacks() {
    const s = S();
    let sig = '';
    for (const k of s.stacks) if (!k.barrow) sig += k.id + ':' + describe(k.itemId, k.qty).n + ',';
    sig += V.terrainV || 0;
    if (sig !== V.stackSig) {
      V.stackSig = sig;
      carry.setStacks(s.stacks.filter((k) => !k.barrow).map((k) => { const d = describe(k.itemId, k.qty); if (d.scaleH) d.h *= d.scaleH; return { id: k.id, x: k.x, z: k.z, itemId: k.itemId, ...d }; }), (d) => {
        if (performance.now() - V.lastLand > 140) { sounds.play('thud'); V.lastLand = performance.now(); G.cam.shake = Math.min(G.cam.shake + 0.03, 0.3); }
        G.burst(d.x, G.heightAt(d.x, d.z) + 0.1, d.z, 5, 0xb9a88a, 1.4, 0.8, 0.09, 0.5);
      });
    }
    const c = s.carried, ls = c ? c.itemId + ':' + describe(c.itemId, c.qty).n : '';
    if (ls !== V.loadSig) {
      V.loadSig = ls;
      if (c) { const d = describe(c.itemId, c.qty); if (d.scaleH) d.h *= d.scaleH; carry.setLoad(d); } else carry.setLoad(null);
      G.player.carryK = c ? C.CARRY.slow : 0;
    }
  }

  // ------------------------------------------------------------------ by hand: aim within reach, set a piece, fasten it
  // how far a set piece still stands proud of its seat: it goes in a little with every blow
  // hold a piece clear of its seat: up for most things, out from the wall for siding
  function liftTo(id, layer, mid, h) {
    const m = geom(id) && geom(id).byId.get(mid);
    if (m && m.kind === 'cladding' && m.out) asm.lift(id, layer, mid, h * 0.5, m.out); else asm.lift(id, layer, mid, h);
  }
  const PROUD = 0.085;     // how far a set piece stands proud before its first blow: enough to read at play distance
  const proud = (mid) => { if (V.sheetMids && V.sheetMids.has(mid)) return 0; const sw = V.swingIn; if (sw && sw.mid === mid) return PROUD + 0.55 * (1 - Math.min(1, sw.t / 0.2)) ** 2; const b = V.blows[mid]; return PROUD * (1 - (b ? b.n / b.of : 0)); };
  const qTmp = new T.Quaternion(), aTmp = new T.Vector3(), wA = new T.Vector3(), wB = new T.Vector3(), wM = new T.Vector3();
  // a point of a member in the world, wherever its frame lies just now
  function worldPt(g, hw, p, out) {
    out.set(p[0], p[1], p[2]);
    if (hw) { const ang = V.raise && V.raise.hw === hw ? V.raise.angle : hw.flat; out.x -= hw.pivot[0]; out.y -= hw.pivot[1]; out.z -= hw.pivot[2]; out.applyQuaternion(qTmp.setFromAxisAngle(aTmp.set(hw.axis[0], 0, hw.axis[2]), ang)); out.x += hw.pivot[0]; out.y += hw.pivot[1]; out.z += hw.pivot[2]; }
    return out.applyMatrix4(g.matrix);
  }
  const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L > 1e-9 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L)) : 0; return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t); };

  // ---- nail points: where a builder really nails. A stick takes a nail at each end; a sheet takes a few along its edges.
  const STICKS = new Set(['post', 'beam', 'skid', 'joist', 'plate', 'stud', 'header', 'rafter', 'drip', 'rake', 'ridgecap', 'gutter', 'downspout']);
  const SHEETS = new Set(['sheathing', 'membrane', 'roofing', 'lining', 'insulation', 'cladding']);
  // the layer that hides a stage's nail heads once it is complete
  const COVER = { 'floor-frame': 'subfloor', subfloor: 'lining', 'wall-frame': 'lining', 'top-plates': 'lining', 'roof-frame': 'roof-deck', 'roof-deck': 'dry-in', 'dry-in': 'roofing', sheathing: 'wrap', wrap: 'cladding' };
  // a member's nail points in its own frame, or null when it is fastened with plain blows (piers, the site, doors)
  function nailLocal(g, mid) {
    const nm = g.nails || (g.nails = new Map());
    if (nm.has(mid)) return nm.get(mid);
    const m = g.byId.get(mid);
    let out = null;
    if (m && (m.kind === 'door' || m.kind === 'window')) {      // a unit in its opening: nails down both jambs (a door) or all round the flange (a window)
      const u = m.n, wx = -u[2], wz = u[0], mx = (m.a[0] + m.b[0]) / 2, mz = (m.a[2] + m.b[2]) / 2, sg = wx * (mx - g.cx) + wz * (mz - g.cz) >= 0 ? 1 : -1, off = sg * 0.06;
      const W = m.section.d, y0 = m.a[1], y1 = m.b[1], hx = W / 2 - 0.03, at = (v, y) => [mx + u[0] * v + wx * off, y, mz + u[2] * v + wz * off];
      out = [];
      if (m.kind === 'door') for (const side of [-1, 1]) for (const f of [0.12, 0.5, 0.88]) out.push(at(side * hx, y0 + (y1 - y0) * f));
      else { for (const side of [-1, 1]) for (const f of [0.1, 0.5, 0.9]) out.push(at(side * hx, y0 + (y1 - y0) * f)); out.push(at(0, y0 + 0.03), at(0, y1 - 0.03)); }
    } else if (m && m.draw !== 0 && m.section && (STICKS.has(m.kind) || SHEETS.has(m.kind))) {
      const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], L = Math.hypot(ax, ay, az);
      if (L > 0.05) {
        const u = [ax / L, ay / L, az / L], n = m.n, cr = [(ay * n[2] - az * n[1]) / L, (az * n[0] - ax * n[2]) / L, (ax * n[1] - ay * n[0]) / L];
        const d = m.section.d, b = m.section.b, thinN = d <= b, t = thinN ? n : cr, w = thinN ? cr : n, thick = Math.min(d, b), wide = Math.max(d, b);
        const mx = (m.a[0] + m.b[0]) / 2, my = (m.a[1] + m.b[1]) / 2, mz = (m.a[2] + m.b[2]) / 2;
        // the face that shows: up, else away from the middle of the building (the inside for a lining)
        let sg = Math.abs(t[1]) > 0.3 ? Math.sign(t[1]) : (t[0] * (mx - g.cx) + t[2] * (mz - g.cz) >= 0 ? 1 : -1);
        if (m.kind === 'lining') sg = -sg;
        const off = sg * (thick / 2 + 0.012);
        const at = (ut, v) => [mx + u[0] * ut + w[0] * v + t[0] * off, my + u[1] * ut + w[1] * v + t[1] * off, mz + u[2] * ut + w[2] * v + t[2] * off];
        out = [];
        if (STICKS.has(m.kind) || m.kind === 'insulation' || L < 0.4) { out.push(at(-L / 2 + 0.035, 0), at(L / 2 - 0.035, 0)); }
        else {
          const per = L > 1.8 && wide > 0.5 ? 3 : 2, rows = wide > 0.25 ? [-1, 1] : [0];
          for (const r of rows) for (let k = 0; k < per; k++) out.push(at(-L / 2 + 0.12 + ((L - 0.24) * k) / (per - 1), r * Math.max(0, wide / 2 - 0.07)));
        }
      }
    }
    nm.set(mid, out);
    return out;
  }
  const nailCount = (g, pm, mid) => { const p = nailLocal(g, mid); return p ? p.length : C.memberNails(pm.kind); };
  const blowsOf = (g, pm, mid) => V.blows[mid] || (V.blows[mid] = { n: 0, of: nailCount(g, pm, mid), d: [] });
  // the dots on every set piece, and the dark heads of the nails in, until a later layer covers them
  const dotLayers = new Map();
  function dotsFor(id) {
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g) return;
    const by = new Map();
    for (const mid in pr.members) {
      const pm = pr.members[mid];
      if ((!pm.built && !(pm.need > 0 && pm.got >= pm.need - 1e-6)) || V.sawing.has(mid) || V.flights.has(mid)) continue;
      if (pm.built && pm.kind === 'cladding') continue;          // siding is blind-nailed: the next course covers the nails
      const pts = nailLocal(g, mid);
      if (!pts) continue;
      const cv = COVER[pm.stage];
      if (pm.built && cv && pr.tally[cv] && api.stageComplete(pr, cv)) continue;
      if (pm.built && pm.kind === 'roofing') continue;      // a course's nails are under the course above
      const b = V.blows[mid], flat = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) && !pr.raised[pm.parent], layer = flat ? pm.parent : 'main', h = pm.built ? 0 : PROUD * (1 - (b ? b.n / b.of : 0));
      let list = by.get(layer);
      if (!list) by.set(layer, (list = []));
      pts.forEach((p, i) => list.push({ p, h, k: pm.built || (b && b.d[i]) ? 1 : 0 }));
    }
    const old = dotLayers.get(id) || new Set();
    for (const layer of new Set([...old, ...by.keys()])) {
      if (layer !== 'main') { const hw = g.walls.get(layer); if (!hw) continue; asm.hinge(id, layer, hw.pivot, hw.axis, V.raise && V.raise.parent === layer ? V.raise.angle : hw.flat, 48); }
      asm.setDots(id, layer, by.get(layer) || []);
    }
    dotLayers.set(id, new Set(by.keys()));
  }

  // ---- the ladder: a few boxes, leaned by hand on a wall, climbed by walking onto it
  const LAD = C.LADDER;
  const ladMat = new T.MeshLambertMaterial({ color: 0xc9a468 }), ladGeo = new T.BoxGeometry(1, 1, 1), ladG = new T.Group(), ladParts = [];
  for (let i = 0; i < 2 + 7; i++) { const b = new T.Mesh(ladGeo, ladMat); b.castShadow = true; ladG.add(b); ladParts.push(b); }
  ladG.visible = false; G.scene.add(ladG);
  const ladD = LAD.footOutM + 0.1;
  const ladPts = (L) => { const fy = G.heightAt(L.x, L.z), cx = L.x + Math.sin(L.yaw) * ladD, cz = L.z + Math.cos(L.yaw) * ladD; return { fx: L.x, fy, fz: L.z, cx, cy: L.topY, cz, len: Math.hypot(ladD, L.topY - fy) }; };
  function drawLadder() {
    const L = S().ladder, sig = L ? [L.x, L.z, L.yaw, L.topY].join() : '';
    if (sig === V.ladSig) return;
    V.ladSig = sig; ladG.visible = !!L;
    if (!L) return;
    const q = ladPts(L);
    ladG.position.set(q.fx, q.fy, q.fz); ladG.lookAt(q.cx, q.cy, q.cz);
    for (let i = 0; i < 2; i++) { ladParts[i].scale.set(0.05, 0.05, q.len); ladParts[i].position.set(i ? 0.2 : -0.2, 0, q.len / 2); }
    for (let i = 0; i < 7; i++) { ladParts[2 + i].scale.set(0.4, 0.03, 0.04); ladParts[2 + i].position.set(0, 0, ((i + 0.6) / 7.2) * q.len); }
  }
  // where a ladder would lean if the pointer says so: the raised wall nearest it, the foot a step out
  function ladderSpot(pr, px = reach.x, pz = reach.z) {
    const g = geom(pr.id);
    if (!g) return null;
    const inv = g.matrix.clone().invert(), lp = new T.Vector3(px, 0, pz).applyMatrix4(inv);
    let best = null, bd = 3.2;
    for (const [par, hw] of g.walls) {
      if (!pr.raised[par]) continue;
      const t = Math.max(-hw.len / 2, Math.min(hw.len / 2, (lp.x - hw.mid[0]) * hw.u[0] + (lp.z - hw.mid[1]) * hw.u[1])), qx = hw.mid[0] + hw.u[0] * t, qz = hw.mid[1] + hw.u[1] * t, d = Math.hypot(lp.x - qx, lp.z - qz);
      if (d < bd) { bd = d; best = { hw, qx, qz }; }
    }
    if (!best) return null;
    const { hw, qx, qz } = best, ix = hw.inward[0], iz = hw.inward[1];
    const foot = new T.Vector3(qx - ix * ladD, 0, qz - iz * ladD).applyMatrix4(g.matrix), top = new T.Vector3(qx - ix * 0.1, hw.top, qz - iz * 0.1).applyMatrix4(g.matrix);
    return { x: foot.x, z: foot.z, yaw: Math.atan2(top.x - foot.x, top.z - foot.z), topY: top.y, structId: pr.id };
  }
  // ---- scaffolding: where a bay would stand if set up along the raised wall nearest the pointer, a step out from it
  const SCF = C.SCAFFOLD;
  function scaffoldSpot(pr, px = reach.x, pz = reach.z) {
    const g = geom(pr.id);
    if (!g) return null;
    const inv = g.matrix.clone().invert(), lp = new T.Vector3(px, 0, pz).applyMatrix4(inv);
    let best = null, bd = 3.2;
    for (const [par, hw] of g.walls) {
      if (!pr.raised[par]) continue;
      const t = (lp.x - hw.mid[0]) * hw.u[0] + (lp.z - hw.mid[1]) * hw.u[1], tt = Math.max(-hw.len / 2, Math.min(hw.len / 2, t)), d = Math.hypot(lp.x - hw.mid[0] - hw.u[0] * tt, lp.z - hw.mid[1] - hw.u[1] * tt);
      if (d < bd) { bd = d; best = { hw, t }; }
    }
    if (!best) return null;
    // pointing inside the walls, well clear of them: a tower on the floor, under the roof frame, its deck 0.6 m under the
    // top of the walls so the ridge and the far rafters are in reach (a bay along a wall never reaches the middle)
    { const { hw } = best, inn = (lp.x - hw.mid[0]) * hw.inward[0] + (lp.z - hw.mid[1]) * hw.inward[1];
      if (inn > 0.7) {
        const P = G.player, top = new T.Vector3(0, hw.top, 0).applyMatrix4(g.matrix).y, floor = new T.Vector3(0, hw.low, 0).applyMatrix4(g.matrix).y,
          o = new T.Vector3(0, 0, 0).applyMatrix4(g.matrix), w = new T.Vector3(hw.u[0], 0, hw.u[1]).applyMatrix4(g.matrix).sub(o).normalize(),
          baseY = Math.max(G.heightAt(px, pz), Math.abs(P.y - floor) < 0.6 ? P.y : floor);
        return { x: px, z: pz, yaw: Math.atan2(w.x, w.z), len: SCF.towerM, deckY: Math.max(baseY + SCF.minDeckM, top - SCF.towerBelowTopM), baseY, free: true, structId: pr.id };
      } }
    const { hw } = best, len = Math.min(SCF.bayM, hw.len + 0.3), t = Math.max(-(hw.len - len) / 2 - 0.15, Math.min((hw.len - len) / 2 + 0.15, best.t)), out = 0.12 + SCF.standOffM + SCF.widthM / 2;
    const c = new T.Vector3(hw.mid[0] + hw.u[0] * t - hw.inward[0] * out, 0, hw.mid[1] + hw.u[1] * t - hw.inward[1] * out).applyMatrix4(g.matrix);
    const o = new T.Vector3(0, 0, 0).applyMatrix4(g.matrix), w = new T.Vector3(hw.inward[0], 0, hw.inward[1]).applyMatrix4(g.matrix).sub(o).normalize(), top = new T.Vector3(0, hw.top, 0).applyMatrix4(g.matrix).y;
    return { x: c.x, z: c.z, yaw: Math.atan2(-w.z, w.x), len, deckY: Math.max(G.heightAt(c.x, c.z) + SCF.minDeckM, top - SCF.belowTopM), structId: pr.id };
  }
  function scaffoldCtx(pr) {
    const s = S(), sc = s.scaffold, P = G.player;
    if (!SC || !sc || s.carried || (s.barrow && s.barrow.held)) return null;
    if (V.scafHeld) { const spot = pr && scaffoldSpot(pr); return spot ? { kind: 'sset', spot } : { kind: 'sdrop' }; }
    if (!sc.set) return Math.hypot(sc.x - P.x, sc.z - P.z) < 2.4 && Math.hypot(sc.x - reach.x, sc.z - reach.z) < 1.2 ? { kind: 'sgrab' } : null;
    const f = SC.foot();
    return f && !SC.on() && Math.hypot(reach.x - f.x, reach.z - f.z) < 0.8 && Math.hypot(P.x - f.x, P.z - f.z) > 1.0 && Math.hypot(P.x - f.x, P.z - f.z) < 3.5 ? { kind: 'sstrike' } : null;
  }
  function tickScaffold(dt) {
    if (!SC) return;
    const s = S(), sc = s.scaffold, P = G.player, hide = s.options.sandbox;
    if (V.scafHeld && (!sc || sc.set || s.carried || OFF[P.tool])) V.scafHeld = false;
    SC.set(sc && sc.set && !hide ? { ...sc.set, w: SCF.widthM } : null);
    SC.setBundle(!sc || sc.set || hide ? null : V.scafHeld ? { x: P.x + Math.sin(P.face) * 1.1, z: P.z + Math.cos(P.face) * 1.1 } : { x: sc.x, z: sc.z });
    if (V.scafHeld) P.carryK = Math.max(P.carryK || 0, 0.75);
    if (V.climb || V.hop || (RW && RW.on())) return;
    // on the plank, push on toward the roof and you step up onto the deck
    if (RW && SC.onPlank && SC.onPlank() && !(sc && sc.set && sc.set.free)) {
      const mv = Math.hypot(P.mvx || 0, P.mvz || 0);
      if (mv > 0.3) { V.scPush = (V.scPush || 0) + dt; if (V.scPush > 0.12 && tryHop(P.mvx / mv, P.mvz / mv)) { SC.release(); V.scPush = 0; V.rev++; return; } if (V.scPush > 0.12) V.scPush = -0.15; } else V.scPush = 0;
    }
    const r = SC.update(dt, { climbMps: feel().climbMps * 1.25 });
    if (r === 'up') { sounds.play('thunk'); V.rev++; if (!V.named.scaf) { V.named.scaf = 1; flash('On the scaffold: walk the plank; walk back off the ladder end to climb down'); } }
    else if (r === 'down') V.rev++;
  }
  function ladderCtx(strong) {
    const L = S().ladder, P = G.player;
    if (!L || V.climb) return null;
    const hold = !!S().carried, ft = Math.hypot(P.x - L.x, P.z - L.z), rp = Math.hypot(reach.x - L.x, reach.z - L.z);
    if (strong) return rp < 0.9 && ft < 4 && ft >= 1.3 && !hold ? { kind: 'ladder', act: 'take' } : null;
    return null;
  }
  // a pulsing marker over the ladder in the yard while something is too high to reach and no ladder is up
  const ladMark = new T.Mesh(new T.SphereGeometry(0.32, 12, 8), new T.MeshBasicMaterial({ color: 0xffd34a, transparent: true, opacity: 0.8, depthTest: false }));
  ladMark.visible = false; ladMark.renderOrder = 9; G.scene.add(ladMark);
  function tickMark(dt) {
    const s = S(), st = !s.ladder && !s.carried && V.needLadder > 0 ? s.stacks.find((k) => k.itemId === LAD.itemId) : null;
    V.needLadder = Math.max(0, (V.needLadder || 0) - dt);
    ladMark.visible = !!st;
    if (st) { const k = performance.now() / 1000; ladMark.position.set(st.x, G.heightAt(st.x, st.z) + 1.6 + 0.2 * Math.sin(k * 5), st.z); ladMark.scale.setScalar(1 + 0.25 * Math.sin(k * 5)); }
  }
  function tickLadder(dt) {
    const cl = V.climb, P = G.player, L = S().ladder;
    // walking into the foot of a leaned ladder, heading for the wall, mounts it; walking past does not
    const px = V.lpx === undefined ? P.x : V.lpx, pz = V.lpz === undefined ? P.z : V.lpz; V.lpx = P.x; V.lpz = P.z;
    V.ladCool = Math.max(0, (V.ladCool || 0) - dt);
    if (V.hop) { tickHop(dt); return; }
    if (!cl) {
      if (P.climbY != null) P.climbY = null;
      if (L && !V.ladCool && !V.placing && !V.raise && dt > 0) {
        const dx = P.x - px, dz = P.z - pz, sp = Math.hypot(dx, dz), ux = Math.sin(L.yaw), uz = Math.cos(L.yaw), rx = P.x - L.x, rz = P.z - L.z;
        if (sp > 0.004 && Math.hypot(rx, rz) < 0.5 && (dx * ux + dz * uz) / sp > 0.87 && rx * ux + rz * uz < 0.3) { V.climb = { t: 0, dir: 0, age: 0 }; V.rev++; sounds.play('thunk'); flash('On the ladder: forward climbs, back comes down'); }
      }
      if (!V.climb) return;
    }
    const cl2 = V.climb;
    if (!L) { V.climb = null; P.climbY = null; return; }
    const q = ladPts(L), top = Math.max(q.fy, q.cy - LAD.topBelowM);
    {
      const K = G.keys, fwd = K.KeyW || K.ArrowUp, back = K.KeyS || K.ArrowDown, side = K.KeyA || K.KeyD || K.ArrowLeft || K.ArrowRight || K.Space;
      cl2.age = (cl2.age || 0) + dt;
      cl2.dir = fwd ? 1 : back || cl2.e ? -1 : 0;
      // come onto the ladder off the roof: the key you walked off with carries you down, until you let go of it
      if (cl2.fromRoof) { if (fwd || back || side) cl2.dir = -1; else cl2.fromRoof = false; }
      // at the top, keep pushing on and you step off onto a decked roof
      if (cl2.top && fwd && !cl2.fromRoof) { cl2.push = (cl2.push || 0) + dt; cl2.tryT = (cl2.tryT || 0) - dt; if (cl2.push > 0.06 && cl2.tryT <= 0) { cl2.tryT = 0.25; if (tryHop(Math.sin(L.yaw), Math.cos(L.yaw))) { V.climb = null; V.rev++; return; } } } else cl2.push = cl2.tryT = 0;
      if (side && !fwd && cl2.t < 0.2 && cl2.age > 0.15) { cl2.dir = -1; cl2.t = 0; }       // stepping off the bottom
    }
    const ease = 0.4 + 0.6 * Math.min(1, Math.min(cl2.t, 1 - cl2.t) / 0.15);      // slight ease at both ends
    cl2.t = Math.max(0, Math.min(1, cl2.t + (cl2.dir * dt * feel().climbMps * ease) / Math.max(1, q.len)));
    if (cl2.t >= 1 && !cl2.top) { cl2.top = true; V.rev++; } else if (cl2.t < 1) cl2.top = false;
    if (cl2.t <= 0 && cl2.dir < 0 && cl2.age > 0.15) { V.climb = null; P.climbY = null; V.ladCool = 0.9; V.rev++; return; }
    const reachOut = Math.max(0, ladD - 0.38) * cl2.t;
    P.x = q.fx + Math.sin(L.yaw) * reachOut; P.z = q.fz + Math.cos(L.yaw) * reachOut;
    P.climbY = q.fy + (top - q.fy) * cl2.t;
    P.faceTarget = L.yaw;
  }
  // ---- on the roof: stepping from the ladder top or the scaffold plank onto a decked plane, walking it, the anchor and the rope
  const ladderTop = (L) => { const q = ladPts(L), r = Math.max(0, ladD - 0.38); return { x: q.fx + Math.sin(L.yaw) * r, z: q.fz + Math.cos(L.yaw) * r, y: Math.max(q.fy, q.cy - LAD.topBelowM) }; };
  // the decked planes of the buildings near you that will bear a person
  function syncRoof(force) {
    if (!RW) return;
    const P = G.player;
    if (!force && V.roofRev === V.rev && Math.hypot(P.x - V.roofX, P.z - V.roofZ) < 4) return;
    V.roofRev = V.rev; V.roofX = P.x; V.roofZ = P.z;
    const list = [];
    for (const st of V.structs.values()) {
      if (Math.hypot(st.x - P.x, st.z - P.z) > st.r + 10) continue;
      const g = geom(st.id);
      if (!g || !g.frames || !g.frames.size) continue;
      const mw = B.membersOf(st.id), pr = S().progress[st.id], pads = new Map();
      for (const m of g.byId.values()) {
        if (m.type !== 'roof-deck' || !m.rs) continue;
        const pm = pr && pr.members[m.id];
        if (pm ? pm.built : !mw.planned.has(m.id)) (pads.get(m.parent) || pads.set(m.parent, []).get(m.parent)).push(m.rs);
      }
      for (const [pid, F] of g.frames) {
        const p = pads.get(pid);
        if (!p || !p.length) continue;
        const R = g.roofOf.get(pid), done = !pr || api.stageComplete(pr, 'roofing');
        list.push({ key: st.id + ':' + pid, matrix: g.matrix, F, pads: p, lift: done ? 0.02 + FR.coveringOf(R.mat).t : 0.03, info: { structId: st.id, plane: pid } });
      }
    }
    RW.setSurfaces(list);
  }
  // look ahead along (ux, uz) for a decked plane within a step up (or a little down), and hop onto it, clear of its edge
  function tryHop(ux, uz, maxUp = 2.05) {
    if (!RW) return false;
    syncRoof(true);
    const P = G.player, y0 = P.climbY != null ? P.climbY : P.y;
    for (let d = 0.2; d <= 1.8; d += 0.1) {
      const x = P.x + ux * d, z = P.z + uz * d, h = RW.hit(x, z, y0, maxUp, 0.4);
      if (!h) continue;
      for (let e = 0.2; e <= 1.2; e += 0.1) {
        const tx = x + ux * e, tz = z + uz * e, h2 = RW.hit(tx, tz, h.y, 0.9, 0.9);
        if (h2 && RW.safe(tx, tz, h2.y, RWC.edgeM + 0.06)) { V.hop = { t: 0, x0: P.x, y0, z0: P.z, x1: tx, y1: h2.y, z1: tz }; sounds.play('thunk'); return true; }
      }
      return false;
    }
    return false;
  }
  function tickHop(dt) {
    const H = V.hop, P = G.player, sm = (x) => x * x * (3 - 2 * x);
    H.t += dt / 0.3;
    const k = Math.min(1, H.t), up = sm(Math.min(1, k / 0.55)), along = sm(Math.max(0, (k - 0.3) / 0.7));
    P.climbY = H.y0 + (H.y1 - H.y0) * up + 0.12 * Math.sin(Math.PI * k);
    P.x = H.x0 + (H.x1 - H.x0) * along; P.z = H.z0 + (H.z1 - H.z0) * along;
    P.faceTarget = Math.atan2(H.x1 - H.x0, H.z1 - H.z0);
    if (k < 1) return;
    V.hop = null; P.climbY = null;
    if (RW.mount(H.x1, H.z1, H.y1)) {
      V.rev++;
      if (!V.named.roof) { V.named.roof = 1; note('On the roof', 'The steeper the roof, the slower you go. Walk up to the ridge and press E to fix an anchor and clip in. Walk off the eave by the ladder to climb down.'); }
    }
  }
  function roofHint(text) { if ((V.roofHintT || 0) > 0) return; V.roofHintT = 3.5; flash(text); }
  function leaveRoof(x, z, lt) {
    const P = G.player;
    V.clip = null; RW.release(); V.rev++;
    if (lt && Math.hypot(x - lt.x, z - lt.z) < 1.1 && P.y - lt.y < 2.6) { V.climb = { t: 1, dir: 0, age: 1, top: true, fromRoof: true }; sounds.play('thunk'); flash('Onto the ladder: keep going to climb down'); return; }
    if (SC) { const y = SC.over(x, z); if (y !== null && P.y - y > -0.3 && P.y - y < 2.6) { SC.board(x, z); sounds.play('thunk'); flash('Down onto the scaffold plank'); return; } }
    RW.drop(); flash('Over the edge: you drop down, no harm done');
  }
  function tickRoof(dt) {
    if (!RW) return;
    const s = S(), P = G.player;
    V.roofHintT = Math.max(0, (V.roofHintT || 0) - dt);
    { // the anchor brackets of the buildings still going up
      const an = [];
      for (const k in s.anchors || {}) { const pr = s.progress[k]; if (pr && !pr.done) an.push(s.anchors[k]); }
      const sig = an.map((a) => a.x + ',' + a.z).join(';');
      if (sig !== V.anSig) { V.anSig = sig; RW.anchors(an); }
    }
    if (!RW.on()) { V.clip = null; return; }
    syncRoof(false);
    const at = RW.at(), anchor = (V.clip != null && s.anchors && s.anchors[V.clip]) || null, L = s.ladder, lt = L ? ladderTop(L) : null;
    const r = RW.update(dt, { clipped: !!anchor, anchor, ropeM: RWC.ropeM, slideK: RWC.slideK, slideMps: RWC.slideMps, edgeM: RWC.edgeM, exitOk: (x, z) => !!lt && Math.hypot(x - lt.x, z - lt.z) < 1.0 });
    if (r && r.leave) { leaveRoof(r.x, r.z, lt); return; }
    if (r === 'edge' && anchor) roofHint('Clipped in: the rope holds you back from the edge. Unclip at the anchor, or walk off by the ladder');
    else if ((r === 'slide' || r === 'edge') && at && at.k > RWC.slideK) roofHint(RWC.says || 'Clip in at the ridge anchor before working on a steep roof');
    RW.rope(anchor);
    if (Math.hypot(P.x - (V.rpx || 0), P.z - (V.rpz || 0)) > 0.12) { V.rpx = P.x; V.rpz = P.z; }
  }
  function roofCtx() {
    const s = S(), P = G.player, at = RW.at();
    if (!at) return null;
    const sid = at.info.structId, an = s.anchors && s.anchors[sid], pr = s.progress[sid];
    const near = !!an && Math.hypot(P.x - an.x, P.z - an.z) < RWC.anchorReachM && Math.abs(P.y - an.y) < 1.6;
    if (pr && !pr.done && !an && at.k > 0.05 && at.t > at.F.top - 0.75) return { kind: 'anchor', id: sid };
    if (near && V.clip !== sid) return { kind: 'clip', id: sid };
    const pc = pr && !pr.done ? pr : nearBuilding(P.x, P.z), pl = pc && !pc.done ? plan(pc.id) : null;
    const h = pl && !pl.raise ? aimHands(pc) : null;
    if (h && h.kind === 'hands') return h;
    if (near && V.clip === sid) return { kind: 'unclip', id: sid };
    if (V.clip == null && at.k > RWC.slideK) return { kind: 'hint', text: an ? 'Steep roof: walk to the anchor and press E to clip in' : 'Steep roof: walk up to the ridge and press E to fix a roof anchor', id: sid };
    if (h && /Too high/.test(h.text || '')) return { kind: 'hint', text: 'On the roof: walk off the eave by the ladder to climb down', id: sid };
    return h || { kind: 'hint', text: V.clip != null ? 'Clipped in. Walk back to the anchor to unclip, or off the eave by the ladder' : 'On the roof: walk off the eave by the ladder to climb down', id: sid };
  }
  // a kind that is learned is set and nailed as you sweep along its run; the big moments stay manual (the ridge, the first rafter)
  function sweepable(pr, mid, g) {
    const pm = pr.members[mid];
    if (!pm || !api.knows(S(), pm.kind)) return false;
    const m = g.byId.get(mid);
    if (!m || m.type === 'ridge' || !nailLocal(g, mid)) return false;
    if (pm.kind === 'rafter' && !Object.values(pr.members).some((q) => q.kind === 'rafter' && q.built)) return false;
    return true;
  }
  const feel = () => C.feelOf(S()), gesture = () => feel().armful;
  // within about 4 m of the stack for the stage, pieces come off it without a trip
  const takeM = () => feel().takeM;
  function stackWithin(itemId, r) {
    if (C.SITE_SUPPLY.includes(itemId)) return null;
    const P = G.player; let best = null, bd = r;
    for (const k of S().stacks) if (k.itemId === itemId && k.qty > 1e-6) { const d = Math.hypot(k.x - P.x, k.z - P.z); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  // the next two open places of the same kind along the run from a piece just set
  function nextPlaces(pr, g, ctx, n) {
    const pm0 = pr.members[ctx.mid], m0 = g.byId.get(ctx.mid), ln0 = lineOf(pr, ctx.mid);
    if (!m0 || !ln0 || m0.type === 'ridge' || pm0.kind === 'door' || pm0.kind === 'window' || pm0.kind === 'site') return [];
    if (pm0.kind === 'rafter' && !Object.values(pr.members).some((q) => q.kind === 'rafter' && q.built)) return [];
    const mx = (m0.a[0] + m0.b[0]) / 2, mz = (m0.a[2] + m0.b[2]) / 2, out = [];
    if (m0.course) {       // a roof course: the rest of this course along the eave, then the course above it, as many pieces as a click sets
      const rows = [];
      for (const mid of plan(pr.id).inst) { const pm = pr.members[mid], m = g.byId.get(mid); if (mid !== ctx.mid && pm && m && m.course && pm.kind === pm0.kind && pm.parent === pm0.parent && pm.need - pm.got > 1e-6 && m.row >= m0.row && m.row <= m0.row + 1) rows.push({ mid, k: (m.row - m0.row) * 1000 + Math.hypot((m.a[0] + m.b[0]) / 2 - mx, (m.a[2] + m.b[2]) / 2 - mz) }); }
      return rows.sort((a, b) => a.k - b.k).slice(0, n).map((o) => o.mid);
    }
    if (pm0.kind === 'cladding' || V.sheetMids && V.sheetMids.has(ctx.mid)) {       // one gesture lays the whole course (the rest of it, past an opening), and as many courses above as the multiplier says
      const rows = [];
      for (const mid of ctx.q || []) { const pm = pr.members[mid], m = g.byId.get(mid); if (mid !== ctx.mid && pm && m && pm.kind === pm0.kind && pm.parent === pm0.parent && pm.type === pm0.type && pm.need - pm.got > 1e-6 && m.row >= m0.row && m.row <= m0.row + n) rows.push({ mid, k: m.row * 100 + Math.abs((m.a[0] + m.b[0]) / 2 - mx) + Math.abs((m.a[2] + m.b[2]) / 2 - mz) }); }
      return rows.sort((a, b) => a.k - b.k).map((o) => o.mid);
    }
    for (const mid of ctx.q || []) {
      if (mid === ctx.mid) continue;
      const pm = pr.members[mid], m = g.byId.get(mid);
      if (!pm || !m || m.type === 'ridge' || pm.kind !== pm0.kind || pm.parent !== pm0.parent || pm.line !== pm0.line || pm.need - pm.got < 1e-6) continue;
      out.push({ mid, d: Math.hypot((m.a[0] + m.b[0]) / 2 - mx, (m.a[2] + m.b[2]) / 2 - mz) });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, n).map((o) => o.mid);
  }
  const courseOf = (pm, m) => pm.kind === 'cladding' && m.type === 'boards' || pm.kind === 'membrane' && m.type === 'housewrap' || !!m.course;
  // what the hands can do from here: every open piece within reach, and the one the pointer is on
  function aimHands(pr) {
    const pl = plan(pr.id), g = geom(pr.id), P = G.player, c = S().carried, st = V.structs.get(pr.id);
    let best = null, bs = 1e9, want = null, ws = 1e9, high = false, tocut = null;
    const set0 = (pm, ln) => !ln || pm.need - pm.got < 1e-6;
    const q = [], low0 = new Map();     // siding goes on from the bottom course up: the lowest course not yet set, per wall
    for (const mid of pl.inst) { const pm = pr.members[mid], m = g.byId.get(mid); if (m && courseOf(pm, m) && pm.need - pm.got > 1e-6) low0.set(pm.parent + pm.kind, Math.min(low0.has(pm.parent + pm.kind) ? low0.get(pm.parent + pm.kind) : 1e9, m.row)); }
    for (const mid of pl.inst) {
      if (V.sawing.has(mid)) continue;
      const pm = pr.members[mid], ln = lineOf(pr, mid), m = g.byId.get(mid);
      if (m && courseOf(pm, m) && pm.need - pm.got > 1e-6 && m.row > low0.get(pm.parent + pm.kind)) continue;
      const wi = !set0(pm, ln) && wantOf(pr, mid), set = set0(pm, ln), act = pm.kind === 'site' ? 'dig' : set ? 'nail' : pm.site && !pm.prep ? 'tocut' : holds(c, pr, mid) || (!pm.site && !api.needsStock(S(), pr, mid)) || (wi && stackWithin(wi, takeM())) ? 'set' : 'want';
      if (act === 'tocut') { if (!tocut) tocut = mid; continue; }
      let score;
      if (!m) { if (Math.hypot(P.x - st.x, P.z - st.z) > g.reach + 0.5) continue; score = 0; }
      else {
        const hw = C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null;
        worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB);
        if (segDist(P.x, P.z, wA, wB) > REACH) continue;
        const dy = (wA.y + wB.y) / 2 - P.y;
        if (dy > LAD.reachUpM) { high = true; continue; }        // out of reach from here: it is worked from a ladder
        if (dy < -3.2) continue;
        if (reach.free) { score = 1e9; for (const t of [0.5, 0.15, 0.85]) { wM.lerpVectors(wA, wB, t).project(G.camera); score = Math.min(score, Math.hypot((wM.x * 0.5 + 0.5) * reach.w - reach.px, (-wM.y * 0.5 + 0.5) * reach.h - reach.py)); } }
        else score = segDist(reach.x, reach.z, wA, wB) * 100;
      }
      V.aimed.add(mid);
      if (act === 'want') { if (score < ws) { ws = score; want = mid; } continue; }
      q.push(mid);
      // a piece already set comes first when the pointer is about as near to both: finish what is started
      if (score - (act === 'nail' ? 14 : 0) < bs) { bs = score - (act === 'nail' ? 14 : 0); best = { mid, act }; }
    }
    const sk = V.stick;
    if (sk && sk.id === pr.id) { const pm = pr.members[sk.mid]; if (pm && !pm.built && pm.need > 0 && pm.got >= pm.need - 1e-6 && q.includes(sk.mid)) best = { mid: sk.mid, act: 'nail' }; else V.stick = null; }
    if (best) return { kind: 'hands', id: pr.id, act: best.act, mid: best.mid, q };
    if (want) return { kind: 'hint', text: 'Needs ' + low(plain(lineOf(pr, want).label)), id: pr.id };
    if (tocut) return { kind: 'hint', text: cutLabel(pr, tocut) + ': cut at the sawhorses first', id: pr.id };
    if (high && RW && !RW.on() && ['dry-in', 'roofing'].includes(pr.stage)) { V.needLadder = 0.5; return { kind: 'hint', text: S().ladder ? 'Roofing is done from on the roof: climb the ladder and keep going onto the deck' : 'Roofing is done from on the roof: lean the ladder at the eave, climb it and step onto the deck', id: pr.id }; }
    if (high) { V.needLadder = 0.5; return { kind: 'hint', text: S().scaffold && !S().scaffold.set ? 'Too high: carry the scaffold inside the frame and set it up as a tower under this' : S().scaffold && S().scaffold.set ? 'Too high: walk into the scaffold ladder, or lean the ladder here' : S().ladder || (S().carried && S().carried.itemId === LAD.itemId) ? 'Too high: lean the ladder on a wall, then walk onto it' : S().stacks.some((k) => k.itemId === LAD.itemId) ? 'Too high: the ladder is in the yard by the stacks (glowing marker)' : 'Too high: bring the ladder', id: pr.id }; }
    return null;
  }
  function finishInstall(id, mid, layer, kind, r) {
    V.idleT = 0;
    const pr = S().progress[id];
    if (r.installed.length) {
      if (layer === 'main') freshOf(id).add(mid);
      if (kind === 'site' || kind === 'door' || kind === 'window' || freshOf(id).size >= 40) { flush(id); if (kind === 'site') V.terrainV = (V.terrainV || 0) + 1; }
      moments(pr, { kind }, r);
    }
    redraw(id);
  }
  // siding: a board slides in along its wall and drops the last few centimetres (0.15 s)
  const SLIDE_S = 0.15;
  function slideIn(id, layer, mid) {
    const m = geom(id).byId.get(mid);
    if (!m) return;
    const L = Math.hypot(m.b[0] - m.a[0], m.b[2] - m.a[2]) || 1;
    const up = Math.hypot(m.b[0] - m.a[0], m.b[2] - m.a[2]) < 0.05;      // a board stood on end slides in from the left along the wall
    (V.slides || (V.slides = [])).push({ id, layer, mid, t: 0, u: up ? [m.n[0], 0, m.n[2]] : [(m.b[0] - m.a[0]) / L, 0, (m.b[2] - m.a[2]) / L], len: up ? 0.5 : Math.min(1.2, L) });
  }
  function tickSlides(dt) {
    if (!V.slides || !V.slides.length) return;
    for (const w of V.slides) {
      w.t += dt;
      const p = Math.min(1, w.t / SLIDE_S), along = p < 0.7 ? (1 - p / 0.7) ** 2 * w.len : 0, up = p < 0.7 ? 0.04 : 0.04 * (1 - (p - 0.7) / 0.3);
      asm.lift(w.id, w.layer, w.mid, 1, [-w.u[0] * along, up, -w.u[2] * along]);
    }
    for (const w of V.slides) if (w.t >= SLIDE_S) { const pm = S().progress[w.id] && S().progress[w.id].members[w.mid]; liftTo(w.id, w.layer, w.mid, pm && !pm.built ? proud(w.mid) : 0); }
    V.slides = V.slides.filter((w) => w.t < SLIDE_S);
  }
  // house wrap: a white roll runs along the course (an axis stood on end), the sheet unfurling behind it and settling flat
  const ROLL_R = 0.075, rollMat = new T.MeshLambertMaterial({ color: 0xf6f8f7 }), rollPool = [], rv = new T.Vector3(), Y_UP = new T.Vector3(0, 1, 0);
  const rollGeo = new T.CylinderGeometry(ROLL_R, ROLL_R, 1, 14);
  function wrapRoll(id, layer, mid) {
    const m = geom(id).byId.get(mid);
    if (!m) return;
    let mesh = rollPool.find((q) => !q.visible);
    if (!mesh) { mesh = new T.Mesh(rollGeo, rollMat.clone()); mesh.castShadow = true; mesh.frustumCulled = false; G.scene.add(mesh); rollPool.push(mesh); }
    mesh.visible = true;
    { const c = m.roll && look.colors[m.col]; if (c) mesh.material.color.setRGB(c[0], c[1], c[2]); else mesh.material.color.setHex(0xf6f8f7); }
    (V.rolls || (V.rolls = [])).push({ id, layer, mid, t: 0, dur: 0.16 + 0.45 * Math.min(1, m.section.d / 2.7), mesh, last: -1 });
    asm.unfurl(id, layer, mid, 0.001, 0.03, m.out);
  }
  const smooth = (x) => x * x * (3 - 2 * x);
  function tickRolls(dt) {
    if (!V.rolls || !V.rolls.length) return;
    for (const w of V.rolls) {
      const g = geom(w.id), m = g && g.byId.get(w.mid);
      w.t += dt;
      const p = Math.min(1, w.t / w.dur), f = smooth(Math.min(1, p / 0.85)), settle = p < 0.85 ? 1 : 1 - smooth((p - 0.85) / 0.15);
      if (!m) { w.t = 1e9; continue; }
      asm.unfurl(w.id, w.layer, w.mid, Math.max(0.001, f), 0.03 * settle, m.out);
      const d = m.section.d, hgt = m.roll ? Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]) : Math.abs(m.b[1] - m.a[1]);
      rv.set((m.a[0] + m.b[0]) / 2 + m.n[0] * (-d / 2 + f * d) + m.out[0] * (ROLL_R + 0.004), (m.a[1] + m.b[1]) / 2 + m.n[1] * (-d / 2 + f * d) + m.out[1] * (ROLL_R + 0.004), (m.a[2] + m.b[2]) / 2 + m.n[2] * (-d / 2 + f * d) + m.out[2] * (ROLL_R + 0.004)).applyMatrix4(g.matrix);
      w.mesh.position.copy(rv); w.mesh.scale.set(1, hgt, 1);
      w.spin = (w.spin || 0) + dt * 9 * (1 - p);
      if (m.roll) {       // a roll on the roof lies along the slope: its axis runs from the strip's lower edge to its upper
        wA.set(m.a[0], m.a[1], m.a[2]).applyMatrix4(g.matrix); wB.set(m.b[0], m.b[1], m.b[2]).applyMatrix4(g.matrix);
        w.mesh.quaternion.setFromUnitVectors(Y_UP, wB.sub(wA).normalize()); w.mesh.rotateY(w.spin);
      } else w.mesh.rotation.set(0, w.spin, 0);
      const step = Math.floor(f * d / 0.4);
      if (p < 0.9 && step !== w.last) { w.last = step; G.burst(rv.x, m.roll ? rv.y : rv.y - hgt * 0.5 + 0.9 * Math.min(1, hgt), rv.z, 1, 0xf0f0f0, 0.15, 0.1, 0.02, 0.15); }
    }
    for (const w of V.rolls) if (w.t >= w.dur) { w.mesh.visible = false; const pm = S().progress[w.id] && S().progress[w.id].members[w.mid]; liftTo(w.id, w.layer, w.mid, pm && !pm.built ? proud(w.mid) : 0); }
    V.rolls = V.rolls.filter((w) => w.t < w.dur);
  }
  // a world point in a member's own frame (the inverse of worldPt)
  function toLocal(g, hw, out) {
    out.applyMatrix4(g.inv || (g.inv = g.matrix.clone().invert()));
    if (hw) { const ang = V.raise && V.raise.hw === hw ? V.raise.angle : hw.flat; out.x -= hw.pivot[0]; out.y -= hw.pivot[1]; out.z -= hw.pivot[2]; out.applyQuaternion(qTmp.setFromAxisAngle(aTmp.set(hw.axis[0], 0, hw.axis[2]), -ang)); out.x += hw.pivot[0]; out.y += hw.pivot[1]; out.z += hw.pivot[2]; }
    return out;
  }
  // a piece set from the arms leaves the shoulder, arcs over and drops onto its seat, then rocks to rest (tickFlights)
  const FLY_S = 0.26;
  function flyIn(id, layer, mid) {
    const g = geom(id), m = g && g.byId.get(mid), P = G.player;
    if (!m) return;
    const hw = layer !== 'main' ? g.walls.get(layer) : null, f = P.face;
    const sx = P.x + Math.cos(f) * 0.27 + Math.sin(f) * 0.15, sy = P.y + 1.34, sz = P.z - Math.sin(f) * 0.27 + Math.cos(f) * 0.15;
    toLocal(g, hw, wA.set(sx, sy, sz)); toLocal(g, hw, wB.set(sx, sy + 1, sz));
    const mx = (m.a[0] + m.b[0]) / 2, my = (m.a[1] + m.b[1]) / 2, mz = (m.a[2] + m.b[2]) / 2;
    V.flights.set(mid, { id, layer, mid, t: 0, D: [wA.x - mx, wA.y - my, wA.z - mz], U: [wB.x - wA.x, wB.y - wA.y, wB.z - wA.z], dist: Math.hypot(wA.x - mx, wA.y - my, wA.z - mz) });
    asm.lift(id, layer, mid, 1, V.flights.get(mid).D);
  }
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  function tickFlights(dt) {
    for (const [mid, w] of V.flights) {
      w.t += dt;
      const p = Math.min(1, w.t / FLY_S), e = ease(p), arc = Math.min(0.6, 0.25 + w.dist * 0.12) * 4 * p * (1 - p), k = 1 - e;
      const pr = S().progress[w.id];
      if (!pr || !pr.members[mid] || pr.members[mid].built) { V.flights.delete(mid); continue; }
      // in its own frame: back toward the shoulder by k, up by the arc, and proud of its seat at the end
      const off = [w.D[0] * k + w.U[0] * (arc + PROUD * e), w.D[1] * k + w.U[1] * (arc + PROUD * e), w.D[2] * k + w.U[2] * (arc + PROUD * e)];
      asm.lift(w.id, w.layer, mid, 1, off);
      if (p >= 1) {
        V.flights.delete(mid);
        V.jolt = { id: w.id, layer: w.layer, mid, t: 0, built: false };
        G.cam.shake = Math.min(G.cam.shake + 0.03 * feel().shake, 0.3);
        const g = geom(w.id), m = g && g.byId.get(mid);
        if (m) { const hw = w.layer !== 'main' ? g.walls.get(w.layer) : null; worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); G.burst(wM.x, wM.y, wM.z, 4, 0xe8d9b0, 0.7, 0.6, 0.05, 0.35); }
        dotsFor(w.id);
      }
    }
  }
  // set one piece in place with its small moment; returns the install result, or null when it did not work
  function setPiece(id, mid, pm, layer, m, at, swp, quiet) {
    const pr = S().progress[id], r = cmd('install', { structId: id, memberIds: [mid], hold: true });
    if (!r.ok) { if (!quiet) flash(reason(r, pm.kind)); return null; }
    const sawn = r.cuts && r.cuts.find((q) => q.stick && q.sawn);
    if (sawn) { sawPiece(id, mid, layer, sawn, at, quiet); if (!quiet) flash(cutWords(sawn)); }
    else if (r.cuts && r.cuts.length && !r.cuts[0].stick && !quiet) flash(r.cuts[0].how === 'offcut' ? 'Cut from an offcut' : 'Cut to fit; offcut kept');
    if (r.set.length) { if (swp) V.stick = { id, mid }; if (sawn) { /* it swings in when the saw is through */ } else if (pm.kind === 'cladding') slideIn(id, layer, mid); else if (V.sheetMids && V.sheetMids.has(mid)) wrapRoll(id, layer, mid); else flyIn(id, layer, mid); sounds.play(C.WORK.sound[pm.kind] === 'scrape' ? 'scrape' : 'thunk'); if (!quiet) { V.poseT = 0.25; V.poseKind = 'lift'; } G.cam.shake = Math.min(G.cam.shake + 0.025, 0.3); G.burst(at.x, at.y, at.z, 3, 0xe8d9b0, 0.5, 0.5, 0.05, 0.3); }
    else if (!quiet) { const q = r.partial[0]; sounds.play('rustle'); flash(plain(lineOf(pr, mid).label) + ': ' + Math.round((100 * q.got) / q.need) + '% there. Fetch more.'); }
    return r;
  }
  // ---- the saw: every stick piece is sawn to length from stock or an offcut before it goes in. At the sawhorses (within
  // 4.5 m) the cut is quick; anywhere else it is done kneeling on the deck, slower. The piece stays out of sight until the
  // saw is through, then arcs from the cut to its place and swings in.
  const ftOf = (L) => (C.STICK.ft[L] ? C.STICK.ft[L] + ' ft' : (Math.round(L / 0.3048)) + ' ft');
  const mm = (L) => (L >= 1 ? L.toFixed(2) + ' m' : Math.round(L * 1000) + ' mm');
  function cutWords(c) {
    const p = c.pieces[0], n = c.pieces.length, more = n > 1 ? ' (x' + n + ')' : '';
    if (!c.sawn) return 'A whole ' + ftOf(p.stockM) + ' stick, no cut' + more;
    return 'Sawn ' + mm(p.lenM) + more + ' from ' + (p.how === 'offcut' ? 'an offcut' : 'a ' + ftOf(p.stockM) + ' stick') + (p.keptM > 0 ? '; ' + mm(p.keptM) + ' offcut kept' : p.stockM - p.lenM > 0.01 ? '; the end is scrap' : '');
  }
  function sawPiece(id, mid, layer, c, at, quiet) {
    if (!CS) return;
    const P = G.player, onH = CS.near(P.x, P.z, 4.5), tools = G.sim.state.sys.stock.tools, power = tools.includes('circular_saw') && !!(G.powerAvailable && G.powerAvailable());
    if (!V.named['saw:' + onH]) { V.named['saw:' + onH] = 1; note(onH ? 'The cut station' : 'Cutting on the deck', onH ? 'Every piece is sawn to length from a stock stick. Short pieces come out of the offcuts by the sawhorses.' : 'Kneeling cuts are slow. Work near the sawhorses, or carry them over (point at them and press E).'); }
    V.sawing.add(mid);
    const fx = P.x + Math.sin(P.face) * 0.75, fz = P.z + Math.cos(P.face) * 0.75;
    c.pieces.forEach((pc, i) => CS.cut({ stockM: pc.stockM, lenM: pc.lenM, sawn: pc.sawn, keptM: pc.keptM, onHorses: onH, x: fx, z: fz, y: P.y, yaw: P.face + Math.PI / 2, to: { x: at.x, y: at.y, z: at.z }, power, slow: quiet ? 0.7 : 1 },
      i === c.pieces.length - 1 ? () => { V.sawing.delete(mid); V.rev++; if (S().progress[id]) { redraw(id); if (!quiet) V.swingIn = { mid, id, layer, t: 0 }; } } : null));
  }
  // layout: before the studs go in, the plates of a frame lying on the deck are marked where each stud, king and jack will
  // stand: a pencil line each side of it and a cross, on the edge that faces up
  function marks(pr, g, par, list) {
    const pls = [];
    for (const mid in pr.members) { const pm = pr.members[mid]; if (pm.parent === par && pm.kind === 'plate' && pm.stage === 'wall-frame' && (pm.type === 'bottom' || pm.type === 'top') && pm.built) pls.push(g.byId.get(mid)); }
    const hw = g.walls.get(par);
    if (!pls.length || !hw) return;
    const ox = -hw.inward[0], oz = -hw.inward[1];
    for (const mid in pr.members) {
      const pm = pr.members[mid], m = g.byId.get(mid);
      if (pm.parent !== par || pm.kind !== 'stud' || pm.stage !== 'wall-frame' || !m) continue;
      const sx = m.a[0], sz = m.a[2];
      for (const pl of pls) {
        const L = Math.hypot(pl.b[0] - pl.a[0], pl.b[2] - pl.a[2]) || 1, ux = (pl.b[0] - pl.a[0]) / L, uz = (pl.b[2] - pl.a[2]) / L, t = (sx - pl.a[0]) * ux + (sz - pl.a[2]) * uz;
        if (t < -0.01 || t > L + 0.01) continue;
        if ((pm.type === 'cripple' || pm.type === 'jack') && pl.type === 'top' && Math.max(m.a[1], m.b[1]) < pl.a[1] - 0.3) continue;   // jacks and cripples under a sill stand on the bottom plate only
        if (pm.type === 'cripple' && pl.type === 'bottom' && Math.min(m.a[1], m.b[1]) > pl.a[1] + 0.3) continue;   // cripples over a header hang from the top plate
        const half = pl.section.d / 2 + 0.0015, cx = pl.a[0] + ux * t + ox * half, cz = pl.a[2] + uz * t + oz * half, y = pl.a[1], hb = pl.section.b / 2 - 0.003;
        for (const e of [-0.019, 0.019]) list.push({ id: 'mk:' + mid + pl.id + e, col: 'mark', a: [cx + ux * e, y - hb, cz + uz * e], b: [cx + ux * e, y + hb, cz + uz * e], n: [ux, 0, uz], section: { b: 0.002, d: 0.004 } });
        list.push({ id: 'mx:' + mid + pl.id, col: 'mark', a: [cx - ux * 0.012, y - hb * 0.7, cz - uz * 0.012], b: [cx + ux * 0.012, y + hb * 0.7, cz + uz * 0.012], n: [ox, 0, oz], section: { b: 0.003, d: 0.002 } });
        list.push({ id: 'my:' + mid + pl.id, col: 'mark', a: [cx + ux * 0.012, y - hb * 0.7, cz + uz * 0.012], b: [cx - ux * 0.012, y + hb * 0.7, cz - uz * 0.012], n: [ox, 0, oz], section: { b: 0.003, d: 0.002 } });
      }
    }
  }
  // one press with the hands: set the piece aimed at, or strike it once
  function handAct(ctx) {
    const pr = S().progress[ctx.id], g = geom(ctx.id), pm = pr.members[ctx.mid], m = g.byId.get(ctx.mid), P = G.player;
    const hw = m && C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null, layer = hw ? pm.parent : 'main';
    if (m) { worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); P.faceTarget = Math.atan2(wM.x - P.x, wM.z - P.z); } else wM.set(reach.x, P.y, reach.z);
    const swp = ctx.act !== 'dig' && sweepable(pr, ctx.mid, g);
    V.cool = 1 / (feel().strikesPerSec * (swp ? Math.max(0.25, feel().sweepSpeed) : 1));
    if (ctx.act === 'set') {
      const ln0 = lineOf(pr, ctx.mid), c0 = S().carried, need0 = api.stockNeed(S(), pr, ctx.mid);
      if (ln0 && need0 > 1e-6 && !(c0 && c0.itemId === ln0.itemId && c0.qty + 1e-6 >= need0)) {   // close to the stack: take from it, no trip
        const st = stackWithin(ln0.itemId, takeM());
        if (st) { if (c0 && c0.itemId !== ln0.itemId) putDown(); if (pickUp(st).ok) flash('Taking from the stack'); }
      }
      const r = setPiece(ctx.id, ctx.mid, pm, layer, m, wM, swp);
      if (!r) return;
      if (r.set.length) {
        joinSmall(ctx.id, ctx.mid);
        const more = nextPlaces(pr, g, ctx, feel().setCount - 1);
        more.forEach((mid, i) => setTimeout(() => {
          const p2 = S().progress[ctx.id], pm2 = p2 && p2.members[mid];
          if (!pm2 || pm2.built || pm2.need - pm2.got < 1e-6) return;
          const l2 = lineOf(p2, mid), c2 = S().carried, n2 = api.stockNeed(S(), p2, mid);
          if (l2 && n2 > 1e-6 && !(c2 && c2.itemId === l2.itemId && c2.qty + 1e-6 >= n2)) { const st = stackWithin(l2.itemId, takeM()); if (!st || (c2 && c2.itemId !== l2.itemId) || !pickUp(st).ok) return; }
          const m2 = g.byId.get(mid), hw2 = m2 && C.STAGE[pm2.stage].flat ? g.walls.get(pm2.parent) : null;
          worldPt(g, hw2, m2.a, wA); worldPt(g, hw2, m2.b, wB); const pt = new T.Vector3().lerpVectors(wA, wB, 0.5);
          setPiece(ctx.id, mid, pm2, hw2 ? pm2.parent : 'main', m2, pt, false, true);
          redraw(ctx.id);
        }, feel().dropDelayMs * (i + 1)));
      }
      redraw(ctx.id);
      return;
    }
    // a blow: one nail at the dot nearest the pointer (a stamp on a pier block, a stroke of the shovel on the site)
    const pts = m ? nailLocal(g, ctx.mid) : null, b = blowsOf(g, pm, ctx.mid), of = b.of;
    let ni = -1, nbest = 1e18;
    if (pts) for (let i = 0; i < pts.length; i++) {
      if (b.d[i]) continue;
      worldPt(g, hw, pts[i], wA);
      let sc;
      if (reach.free) { wB.copy(wA).project(G.camera); sc = Math.hypot((wB.x * 0.5 + 0.5) * reach.w - reach.px, (-wB.y * 0.5 + 0.5) * reach.h - reach.py); }
      else sc = Math.hypot(wA.x - reach.x, wA.z - reach.z) * 100;
      if (sc < nbest) { nbest = sc; ni = i; }
    }
    if (ni >= 0 && ctx.repeat && !swp && nbest > 150) { V.cool = 0.03; return; }     // holding only drives the nails the pointer passes over
    V.handT = 0;
    if (pm.kind === 'site' || !m) { strikeNow(ctx, ni); return; }      // a shovel stroke lands at once
    // the hammer winds up and comes down; the blow lands at contact (tickBlow). One still in the air lands first.
    if (V.blow && !V.blow.hit) strikeNow(V.blow.ctx, V.blow.ni);
    V.blow = { ctx, ni, t: 0, hit: false };
  }
  const CONTACT_S = 0.1, BLOW_S = 0.26;
  function tickBlow(dt) {
    const bl = V.blow;
    if (!bl) return;
    bl.t += dt;
    if (!bl.hit && bl.t >= CONTACT_S) { bl.hit = true; strikeNow(bl.ctx, bl.ni); }
    if (bl.t >= BLOW_S) V.blow = null;
  }
  // the arm through a blow: k 1 is the hammer down. A wind-up behind the head, a snap down, a short recoil
  function blowK(t) {
    if (t < 0.07) return 0.35 - 0.6 * ease(t / 0.07);
    if (t < CONTACT_S) return -0.25 + 1.35 * ((t - 0.07) / (CONTACT_S - 0.07));
    return 1.1 - 0.45 * ease(Math.min(1, (t - CONTACT_S) / (BLOW_S - CONTACT_S)));
  }
  function strikeNow(ctx, ni) {
    const pr = S().progress[ctx.id];
    if (!pr) return;
    const g = geom(ctx.id), pm = pr.members[ctx.mid];
    if (!g || !pm || pm.built) return;
    const m = g.byId.get(ctx.mid), hw = m && C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null, layer = hw ? pm.parent : 'main', P = G.player;
    const swp = sweepable(pr, ctx.mid, g), pts = m ? nailLocal(g, ctx.mid) : null, b = blowsOf(g, pm, ctx.mid), of = b.of;
    if (pts && ni >= 0 && b.d[ni]) ni = pts.findIndex((_, i) => !b.d[i]);     // another blow drove it meanwhile: the next one
    if (m) { worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); } else wM.set(reach.x, P.y, reach.z);
    if (ni >= 0) { worldPt(g, hw, pts[ni], wM); b.d[ni] = 1; }
    if (pm.kind !== 'site' && feel().nails !== 1) {   // nails per strike: 2 drives the next one too, 0 drives them all
      let extra = feel().nails === 0 ? 1e9 : feel().nails - 1;
      if (pts) { for (let i = 0; i < pts.length && extra > 0; i++) if (!b.d[i]) { b.d[i] = 1; extra--; b.n++; worldPt(g, hw, pts[i], wA); G.burst(wA.x, wA.y, wA.z, 1, 0xe8d9b0, 0.6, 0.7, 0.05, 0.3); } }
      else b.n = Math.min(of - 1, b.n + extra);
      b.n = Math.min(of - 1, b.n);
    }
    b.n++;
    const snd = pm.kind === 'pier' ? 'thud' : C.WORK.sound[pm.kind] === 'dig' ? 'dig' : 'knock', last = b.n >= of;
    sounds.play(last && snd === 'knock' ? 'seat' : snd, 0.94 + 0.12 * Math.random());
    if (pm.kind === 'site') G.burst(reach.x, G.heightAt(reach.x, reach.z) + 0.15, reach.z, 5, 0x6b4f35, 1.4, 2.2, 0.11, 0.6);
    else G.burst(wM.x, wM.y, wM.z, last ? 4 : 2, 0xe8d9b0, 0.6, 0.7, 0.05, 0.3);
    G.cam.shake = Math.min(G.cam.shake + (last ? 0.07 : 0.035) * feel().shake, 0.3);
    if (G.juice) G.juice.hitStop = (last ? 0.07 : 0.035) * feel().hitStop;
    V.jolt = m ? { id: ctx.id, layer, mid: ctx.mid, t: 0, built: last } : null;
    if (last && m) { G.burst(wM.x, wM.y + 0.04, wM.z, 6, 0xfff1c4, 1.1, 1.4, 0.035, 0.25); G.burst(wM.x, wM.y, wM.z, 5, 0xd9c49a, 0.9, 0.5, 0.06, 0.5); }
    if (!last) { if (m) liftTo(ctx.id, layer, ctx.mid, proud(ctx.mid)); if (pts) dotsFor(ctx.id); return; }
    delete V.blows[ctx.mid];
    if (V.stick && V.stick.mid === ctx.mid) V.stick = null;
    const r = cmd('install', { structId: ctx.id, memberIds: [ctx.mid], hand: !swp });
    if (!r.ok) { flash(reason(r)); redraw(ctx.id); return; }
    if (r.learned && r.learned.length) showBanner('Learned', 'You know how to ' + C.LEARN.says[r.learned[0]] + ' now', true, 5);
    finishInstall(ctx.id, ctx.mid, layer, pm.kind, r);
  }


  // ------------------------------------------------------------------ small places and beacons: nothing is left to hunt for
  // A place under about 0.35 m2 (sheets, siding) or 0.6 m (sticks) is set and fastened with the larger piece beside it.
  const SMALL_M2 = 0.35, SMALL_M = 0.6;
  function isSmall(pr, g, mid) {
    const pm = pr.members[mid], m = g.byId.get(mid);
    if (!pm || !m || pm.kind === 'site' || pm.kind === 'door' || pm.kind === 'window' || pm.kind === 'pier') return false;
    if (SHEETS.has(pm.kind)) return (pm.area || m.area || 1e9) < SMALL_M2;
    if (STICKS.has(pm.kind)) return Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]) < SMALL_M;
    return false;
  }
  function joinSmall(id, mid) {
    const pr = S().progress[id], g = geom(id);
    if (!pr || !g || isSmall(pr, g, mid)) return;
    const pm0 = pr.members[mid], m0 = g.byId.get(mid), pl = plan(id);
    if (!pm0 || !m0 || !pl) return;
    const mx = (m0.a[0] + m0.b[0]) / 2, my = (m0.a[1] + m0.b[1]) / 2, mz = (m0.a[2] + m0.b[2]) / 2;
    let n = 0;
    for (const sid of pl.inst) {
      const pm = pr.members[sid], m = g.byId.get(sid);
      if (sid === mid || !pm || !m || pm.built || pm.stage !== pm0.stage || pm.parent !== pm0.parent || pm.need - pm.got < 1e-6 || !isSmall(pr, g, sid)) continue;
      if (Math.hypot((m.a[0] + m.b[0]) / 2 - mx, (m.a[1] + m.b[1]) / 2 - my, (m.a[2] + m.b[2]) / 2 - mz) > 1.6 || n >= 6) continue;
      const lay = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) ? pm.parent : 'main';
      let r = cmd('install', { structId: id, memberIds: [sid], hold: true });
      if (!r.ok && (r.reason === 'no material' || r.reason === 'wrong material')) r = cmd('install', { structId: id, memberIds: [sid], hold: true, from: 'stacks' });
      if (!r.ok) continue;
      const r2 = cmd('install', { structId: id, memberIds: [sid] });
      if (r2.ok && r2.installed.length) { n++; finishInstall(id, sid, lay, pm.kind, r2); if (pm.kind === 'cladding') slideIn(id, lay, sid); else if (V.sheetMids && V.sheetMids.has(sid)) wrapRoll(id, lay, sid); }
    }
    if (n) redraw(id);
  }
  // Beacons: with 5 or fewer places left in a stage, each gets a tall thin pulsing marker, and the hint line says where.
  // one small calm arrow, bobbing 0.5 m above each open place of the current stage (at most five), gone the moment the place is built
  const beaconMat = new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
    beaconMesh = new T.InstancedMesh(new T.ConeGeometry(0.11, 0.26, 10).rotateX(Math.PI), beaconMat, 6),
    bm4 = new T.Matrix4(), bq = new T.Quaternion(), bs = new T.Vector3(1, 1, 1), bp = new T.Vector3();
  beaconMesh.frustumCulled = false; beaconMesh.visible = false; beaconMesh.renderOrder = 6; beaconMesh.count = 0;
  G.scene.add(beaconMesh);
  V.aimed = new Set(); V.beacons = []; V.beaconT = 0;
  const STAGE_PART = { 'roof-frame': 'roof', 'roof-deck': 'roof', 'dry-in': 'roof', roofing: 'roof', gutters: 'roof', foundation: 'floor', 'floor-frame': 'floor', subfloor: 'floor' };
  function yRange(g) {
    if (g.yr) return g.yr;
    let lo = 1e9, hi = -1e9;
    for (const m of g.byId.values()) { lo = Math.min(lo, m.a[1], m.b[1]); hi = Math.max(hi, m.a[1], m.b[1]); }
    return (g.yr = [lo + g.matrix.elements[13], hi + g.matrix.elements[13]]);
  }
  // the places left in the next stage when there are few: { stage, list: [{ mid, x, y, z, where, high }], text } or null
  function leftInStage(pr) {
    const g = geom(pr.id), pl = plan(pr.id);
    if (!g || !pl || !pl.view.next) return null;
    const ids = Object.keys(pr.members).filter((k) => { const pm = pr.members[k]; return pm.stage === pl.view.next && !pm.built && pm.kind !== 'site' && g.byId.has(k); });
    if (!ids.length || ids.length > 5) return null;
    const [ylo, yhi] = yRange(g), P = G.player, c = wB.set(g.cx, 0, g.cz).applyMatrix4(g.matrix), cx = c.x, cz = c.z, list = [], seen = [];
    let high = false;
    for (const mid of ids) {
      const pm = pr.members[mid], m = g.byId.get(mid), hw = C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null;
      worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wM); wM.add(wA).multiplyScalar(0.5);
      const dx = wM.x - cx, dz = wM.z - cz, dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north'), f = (wM.y - ylo) / Math.max(0.5, yhi - ylo), part = STAGE_PART[pm.stage];
      const where = pm.kind === 'door' || pm.kind === 'window' ? 'the ' + pm.kind + ' in the ' + dir + ' wall' : part === 'roof' ? 'the ' + dir + ' side of the roof' : part === 'floor' ? 'the ' + dir + ' side of the floor' : (f > 0.66 ? 'top' : f < 0.33 ? 'bottom' : 'middle') + ' of the ' + dir + ' wall';
      if (wM.y - P.y > LAD.reachUpM && !V.climb) high = true;
      list.push({ mid, x: wM.x, y: wM.y, z: wM.z, where, top: yhi });
      seen.includes(where) || seen.push(where);
    }
    return { stage: pl.view.next, list, high, text: list.length + ' left: ' + seen.slice(0, 3).join(' and ') + (high ? ' · bring the ladder' : '') };
  }
  // ------------------------------------------------------------------ the wheelbarrow: a few boxes and a cylinder wheel
  const barrow = new T.Group(), bWood = new T.MeshLambertMaterial({ color: 0x9a7448 }), bTray = new T.MeshLambertMaterial({ color: 0x4d7f68 }), bIron = new T.MeshLambertMaterial({ color: 0x45484d }),
    bPart = (geo, mat, x, y, z, rx = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; barrow.add(m); return m; },
    bBox = new T.BoxGeometry(1, 1, 1), bBits = [];
  bPart(new T.BoxGeometry(0.66, 0.06, 0.9), bTray, 0, 0.5, 0.1); bPart(new T.BoxGeometry(0.06, 0.26, 0.9), bTray, -0.33, 0.62, 0.1); bPart(new T.BoxGeometry(0.06, 0.26, 0.9), bTray, 0.33, 0.62, 0.1);
  bPart(new T.BoxGeometry(0.66, 0.26, 0.06), bTray, 0, 0.62, 0.55); bPart(new T.BoxGeometry(0.66, 0.2, 0.06), bTray, 0, 0.6, -0.35);
  bPart(new T.CylinderGeometry(0.22, 0.22, 0.09, 18).rotateZ(Math.PI / 2), bIron, 0, 0.22, 0.62);
  for (const x of [-0.3, 0.3]) { bPart(new T.BoxGeometry(0.05, 0.05, 1.5), bWood, x, 0.45, -0.55); bPart(new T.BoxGeometry(0.05, 0.4, 0.05), bWood, x, 0.2, -0.95); }
  for (let i = 0; i < 8; i++) { const m = new T.Mesh(bBox, new T.MeshLambertMaterial({ color: 0xdcbc8c })); m.castShadow = true; m.visible = false; barrow.add(m); bBits.push(m); }
  barrow.visible = false; G.scene.add(barrow);
  V.bYaw = 0; V.bSend = 0;
  function drawBarrow(dt) {
    const s = S(), b = s.barrow, P = G.player;
    barrow.visible = !!b && !s.options.sandbox;
    if (!barrow.visible) return;
    if (b.held) {
      let d = P.face - V.bYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      V.bYaw += Math.max(-1, Math.min(1, d)) * Math.min(1, dt * 2.2) * (Math.abs(d) > 0.02 ? 1 : 0);   // it turns slower than you do
      b.x = P.x + Math.sin(V.bYaw) * C.BARROW.offsetM; b.z = P.z + Math.cos(V.bYaw) * C.BARROW.offsetM; b.yaw = V.bYaw;
      V.bSend -= dt;
      if (V.bSend <= 0) { V.bSend = 0.2; G.sim.commandNow('construction.barrowMove', { x: b.x, z: b.z, yaw: b.yaw }); }
      P.carryK = Math.max(P.carryK || 0, 0.7);
    }
    barrow.position.set(b.x, G.heightAt(b.x, b.z), b.z); barrow.rotation.y = b.yaw;
    const k = s.stacks.find((q) => q.barrow), sig = k ? k.itemId + ':' + Math.round(k.qty * 20) + ':' + feel().armful : '';
    if (sig === V.bLoadSig) return;
    V.bLoadSig = sig;
    for (const m of bBits) m.visible = false;
    if (!k) return;
    // the load, drawn as a few sticks, sheets or boxes lying in the tray: more of them the fuller it is
    const d = describe(k.itemId, k.qty), f = Math.min(1, k.qty * CAT[k.itemId].massKgPerUnit / (C.BARROW.capKg * feel().armful)), cnt = Math.max(1, Math.min(8, d.n, Math.ceil(f * 8)));
    const sh = d.form === 'lumber' ? { s: [0.09, 0.06, 0.85], cols: 4, rows: 1, dx: 0.13, dz: 0 } : d.form === 'sheet' || d.form === 'lean' ? { s: [0.55, 0.035, 0.85], cols: 1, rows: 1, dx: 0, dz: 0 } : { s: [0.22, 0.17, 0.26], cols: 2, rows: 3, dx: 0.26, dz: 0.3 };
    for (let i = 0; i < cnt; i++) {
      const m = bBits[i], col = i % sh.cols, rest = Math.floor(i / sh.cols), row = rest % sh.rows, layer = Math.floor(rest / sh.rows);
      m.visible = true; m.scale.set(sh.s[0], sh.s[1], sh.s[2]);
      m.position.set((col - (sh.cols - 1) / 2) * sh.dx, 0.53 + sh.s[1] / 2 + layer * sh.s[1], 0.1 + (row - (sh.rows - 1) / 2) * sh.dz);
      m.material.color.setHex(d.color);
    }
  }
  // the sawhorses: where the sim says, or in front of you while you carry them; the offcuts kept lie in a heap beside them
  function tickStation(dt) {
    if (!CS) return;
    const s = S(), P = G.player;
    if (V.horsesHeld && (s.carried || OFF[P.tool] || s.options.sandbox)) V.horsesHeld = false;
    if (V.horsesHeld) { CS.setHorses({ x: P.x + Math.sin(P.face) * 1.3, z: P.z + Math.cos(P.face) * 1.3, yaw: P.face + Math.PI / 2 }); P.carryK = Math.max(P.carryK || 0, 0.85); }
    else CS.setHorses(s.options.sandbox || !V.anyOpen ? null : s.horses);
    if (V.pileRev !== V.rev) {
      V.pileRev = V.rev;
      let n = 0;
      for (const pr of Object.values(s.progress)) if (!pr.done) for (const k in pr.lines) { const ln = pr.lines[k]; if (ln.stick && ln.cut) for (const st of ln.cut.sticks) if (st.open && st.left > 0) n++; }
      CS.setPile(n);
    }
    V.cutNow = CS.update(dt);
  }
  function drawBeacons(dt) {
    const pr = current(), P = G.player;
    V.beaconT -= dt;
    if (V.beaconT <= 0) {
      V.beaconT = 0.3;
      const L = pr && !pr.done && !S().options.sandbox && !OFF[P.tool] && !V.placing ? leftInStage(pr) : null;
      V.beacons = L ? L.list.map((b) => ({ ...b, id: pr.id })) : [];
      V.left = L;
    }
    // a place that is done loses its arrow at once, not at the next refresh
    let n = 0;
    const t = performance.now() / 1000;
    for (const b of V.beacons) {
      const pm = S().progress[b.id] && S().progress[b.id].members[b.mid];
      if (!pm || pm.built) continue;
      bp.set(b.x, b.y + 0.5 + 0.07 * Math.sin(t * 3 + n), b.z);
      beaconMesh.setMatrixAt(n++, bm4.compose(bp, bq, bs));
    }
    beaconMesh.count = n; beaconMesh.visible = n > 0;
    if (n) beaconMesh.instanceMatrix.needsUpdate = true;
  }
  // clicking a beacon finishes a place that never had a valid aim: a stage never waits on what cannot be reached or seen
  function beaconAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    let best = null, bd = 30;
    for (const b of V.beacons) {
      if (V.aimed.has(b.mid)) continue;
      const a = wA.set(b.x, b.y, b.z).project(G.camera), t = wB.set(b.x, b.y + 0.5, b.z).project(G.camera);
      if (a.z > 1 || t.z > 1) continue;
      const ax = (a.x * 0.5 + 0.5) * r.width + r.left, ay = (-a.y * 0.5 + 0.5) * r.height + r.top, tx = (t.x * 0.5 + 0.5) * r.width + r.left, ty = (-t.y * 0.5 + 0.5) * r.height + r.top;
      const dx = tx - ax, dy = ty - ay, L2 = dx * dx + dy * dy, k = L2 > 1 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L2)) : 0, d = Math.hypot(cx - ax - dx * k, cy - ay - dy * k);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function finishPlace(b) {
    const pr = S().progress[b.id], pm = pr && pr.members[b.mid], g = geom(b.id);
    if (!pm || pm.built || !g) return;
    const lay = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) ? pm.parent : 'main';
    if (pm.need - pm.got > 1e-6) { const r = cmd('install', { structId: b.id, memberIds: [b.mid], hold: true, from: 'stacks' }); if (!r.ok) { flash(reason(r, pm.kind)); return; } }
    const r2 = cmd('install', { structId: b.id, memberIds: [b.mid], from: 'stacks' });
    if (!r2.ok) { flash(reason(r2, pm.kind)); redraw(b.id); return; }
    sounds.play('seat'); flash('Finished: ' + b.where);
    finishInstall(b.id, b.mid, lay, pm.kind, r2);
    V.beaconT = 0;
  }

  // ------------------------------------------------------------------ what F does here and now
  function nearBuilding(x, z) {
    let best = null, bd = 1e9;
    for (const pr of inProgress()) { const st = V.structs.get(pr.id), g = geom(pr.id), d = Math.hypot(st.x - x, st.z - z) - (g ? g.reach : st.r); if (d < REACH + 0.6 && d < bd) { bd = d; best = pr; } }
    return best;
  }
  const wantedStack = (d) => d.itemId === V.wantItem;
  const wantsHere = (pr, pl, c) => pl.inst.some((id) => holds(c, pr, id) && pr.members[id].need - pr.members[id].got > 1e-6);
  const pickable = (d) => !C.SITE_SUPPLY.includes(d.itemId);
  // whatever is in the arms can always be put down: a hint with nothing to press gets that
  // ---- cutting at the sawhorses: pointing at them with a piece to cut makes the next cut. Blocking, cripples and rafters
  // are cut here, one press each; the piece goes into the arms (an armful) or onto the horses
  const cutLabel = (pr, mid) => { const pm = pr.members[mid], k = pm.kind === 'stud' || pm.kind === 'jack' ? 'cripple' : pm.kind === 'block' ? 'blocking' : pm.kind; return k.charAt(0).toUpperCase() + k.slice(1); };
  function cutCtx() {
    const P = G.player, s = S(), h = s.horses, c = s.carried;
    if (!CS || !h || V.horsesHeld || (s.barrow && s.barrow.held)) return null;
    if (Math.hypot(h.x - P.x, h.z - P.z) > 2.6 || Math.hypot(h.x - reach.x, h.z - reach.z) > 1.3) return null;
    let pr = null, mid = null;
    for (const q of inProgress()) { const m = api.nextCut(q); if (m) { pr = q; mid = m; break; } }
    if (!mid) return null;
    const ln = lineOf(pr, mid), cid = C.cutItemOf(ln.itemId);
    if (c && c.itemId !== cid && c.itemId !== ln.itemId) return { kind: 'hint', text: 'Put down what you carry to cut at the sawhorses', drop: true };
    const left = Object.values(pr.members).filter((m) => m.site && !m.prep && !m.built && api.stageOpen(pr, m.stage)).length;
    return { kind: 'cut', id: pr.id, mid, left, full: !!c && c.itemId === cid && c.qty >= C.SITE_CUT.armful };
  }
  function cutNext(ctx) {
    if (V.cutBusy > 0) return;
    const pr = S().progress[ctx.id], what = cutLabel(pr, ctx.mid), r = cmd('cut', { structId: ctx.id, memberId: ctx.mid });
    if (!r.ok) { flash(reason(r)); return; }
    const h = S().horses, P = G.player, tools = G.sim.state.sys.stock.tools, power = tools.includes('circular_saw') && !!(G.powerAvailable && G.powerAvailable());
    const to = r.toArms ? { x: P.x, y: P.y + 1.3, z: P.z } : { x: h.x, y: G.heightAt(h.x, h.z) + 0.75, z: h.z };
    V.cutBusy = 0.25; P.face = Math.atan2(h.x - P.x, h.z - P.z);
    r.cut.pieces.forEach((pc, i) => CS.cut({ stockM: pc.stockM, lenM: pc.lenM, sawn: pc.sawn, keptM: pc.keptM, onHorses: true, x: h.x, z: h.z, yaw: h.yaw, to, power, slow: 1.5 }, i === r.cut.pieces.length - 1 ? () => { V.rev++; } : null));
    const p = r.cut.pieces[0];
    flash(what + ' ' + mm(p.lenM) + (p.how === 'offcut' ? ' from an offcut' : ' from a ' + ftOf(p.stockM) + ' stick') + (r.toArms ? '' : '; it waits on the horses'));
    V.rev++;
  }
  function context() { const x = contextRaw(); if (x && x.kind === 'hint' && !x.drop && S().carried && !(RW && RW.on())) return { ...x, drop: true }; return x; }
  function contextRaw() {
    const P = G.player, s = S(), c = s.carried;
    if (OFF[P.tool] || V.placing || s.options.sandbox) return null;
    if (V.auto) return { kind: 'stop', id: V.auto.id };
    if (V.hop) return null;
    if (RW && RW.on()) return roofCtx();
    if (V.climb) { const pc = nearBuilding(P.x, P.z), h = pc && !pc.done && plan(pc.id) && !plan(pc.id).raise ? aimHands(pc) : null; return h && h.kind === 'hands' ? h : { kind: 'ladder', act: 'down' }; }
    if (SC && SC.on()) { const pc = nearBuilding(P.x, P.z), h = pc && !pc.done && plan(pc.id) && !plan(pc.id).raise ? aimHands(pc) : null; return h || { kind: 'hint', text: 'On the scaffold: walk back off the ladder end to climb down' }; }
    { const sx = scaffoldCtx(nearBuilding(P.x, P.z) || nearBuilding(reach.x, reach.z)); if (sx) return sx; }
    const strong = ladderCtx(true);
    if (strong) return strong;
    if (V.horsesHeld) return { kind: 'hset' };
    { const cx = cutCtx(); if (cx) return cx; }
    if (CS && s.horses && !c && !(s.barrow && s.barrow.held) && Math.hypot(s.horses.x - P.x, s.horses.z - P.z) < 2.4 && Math.hypot(s.horses.x - reach.x, s.horses.z - reach.z) < 1.1) return { kind: 'hgrab' };
    {
      const b = s.barrow;
      if (b && b.held) { const st = carry.nearest(reach.x, reach.z, 1.2, pickable) || carry.nearest(P.x, P.z, 2.0, pickable); return st ? { kind: 'bload', stack: st } : { kind: 'bdown' }; }
      const lk = s.stacks.find((q) => q.barrow && q.qty > 1e-6); if (b && (!c || (lk && lk.itemId === c.itemId)) && Math.hypot(b.x - P.x, b.z - P.z) < C.BARROW.reachM && Math.hypot(b.x - reach.x, b.z - reach.z) < 2.2) return lk ? { kind: 'bgrab', load: lk.id } : { kind: 'bgrab' };
    }
    const pr = nearBuilding(P.x, P.z), stack = carry.nearest(reach.x, reach.z, 1.0, pickable) || (V.wantItem && carry.nearest(P.x, P.z, 2.1, wantedStack)) || carry.nearest(P.x, P.z, 2.1, pickable) || carry.nearest(P.x, P.z, 1.3);
    if (c && c.itemId === LAD.itemId && !s.ladder) {
      if (pr) { const spot = ladderSpot(pr); if (spot) return { kind: 'lean', id: pr.id, spot }; return { kind: 'hint', text: 'Point at a wall: the ladder leans there', id: pr.id, drop: true }; }
    }
    if (pr) {
      const pl = plan(pr.id);
      if (pl) {
        if (pl.raise) return { kind: 'raise', id: pr.id, parent: pl.raise };
        const mine = usable(pr, pl, c);
        if (pr.level === 'guided' || s.options.auto) { if (pl.inst.length && !(stack && !c && pr.level !== 'guided' && !mine.length && false)) return { kind: 'auto', id: pr.id, q: pl.inst, stage: pr.members[pl.inst[0]].stage, guided: pr.level === 'guided' }; }
        else { const near = carry.nearest(reach.x, reach.z, 0.9, pickable), h = near && !(c && wantsHere(pr, pl, c)) ? null : aimHands(pr); if (h && (h.kind === 'hands' || !stack)) return h.kind === 'hands' ? h : ladderCtx(false) || h; }
      }
    }
    { const soft = ladderCtx(false); if (soft) return soft; }
    if (stack) {
      if (C.SITE_SUPPLY.includes(stack.itemId)) return { kind: 'hint', text: plain(CAT[stack.itemId].name) + ': used up as you build' };
      if (!c) return { kind: 'pick', stack };
      if (c.itemId === stack.itemId) { const it = CAT[c.itemId], a = api.armful(s, c.itemId, Math.max(it.unit === 'each' ? 1 : 0, C.carryLimitKg(G.sim.state.sys.stock.tools, gesture()) / it.massKgPerUnit)); return a !== Infinity && a > c.qty + 1e-4 ? { kind: 'pick', stack, more: true } : { kind: 'back', stack }; }
      return { kind: 'swap', stack };
    }
    if (c) return pr ? { kind: 'hint', text: (c.itemId === 'door_prehung' || c.itemId === 'window_shed') && !api.stageOpen(pr, 'openings') ? (c.itemId === 'door_prehung' ? 'Wrap the wall before the door goes in' : 'Wrap the wall before the window goes in') : (c.itemId === 'door_prehung' || c.itemId === 'window_shed') ? 'Walk to the opening: it glows' : 'Nothing here needs ' + stackName(c.itemId) + ' yet', drop: true } : { kind: 'drop' };
    return null;
  }
  function homeStack(itemId) { const P = G.player; let best = null, bd = 3; for (const k of S().stacks) if (k.itemId === itemId) { const d = Math.hypot(k.x - P.x, k.z - P.z); if (d < bd) { bd = d; best = k; } } return best; }
  function putDown() {
    const c = S().carried; if (!c) return;
    const h = homeStack(c.itemId), P = G.player;
    cmd('putDown', h ? { stackId: h.id } : { x: P.x + Math.sin(P.face) * 0.9, z: P.z + Math.cos(P.face) * 0.9 });
    sounds.play('thunk');
  }
  function pickUp(stack) {
    const r = cmd('pickUp', { stackId: stack.id });
    if (r.ok) { sounds.play('lift'); nameIt(stack.itemId); } else flash(r.reason === 'hands full' ? 'Your arms are full' : 'Cannot pick that up');
    return r;
  }
  // the first time each kind of piece is picked up, say what it is
  function nameIt(itemId) {
    for (const pr of inProgress()) for (const k in pr.lines) { const ln = pr.lines[k]; if (ln.itemId === itemId && api.stageOpen(pr, ln.stage) && !api.stageComplete(pr, ln.stage)) { if (V.named[k]) return; V.named[k] = 1; note(plain(ln.label).replace(/s$/, ''), ln.why); return; } }
  }
  function grabHandles() {
    const r = cmd('barrowGrab', { px: G.player.x, pz: G.player.z });
    if (r.ok) { V.bYaw = G.player.face; sounds.play('lift'); flash('Wheelbarrow: click a stack to load it, click again to set it down'); } else flash(r.reason === 'hands full' ? 'Put down what you are carrying first' : 'Too far from the wheelbarrow');
  }
  function tickBHold(dt) {
    const h = V.bHold;
    if (!h) return;
    const c = V.ctx;
    if (!c || c.kind !== 'bgrab' || !c.load) { V.bHold = null; return; }
    if (V.mDown) { h.t += dt; if (h.t >= 0.4) { V.bHold = null; V.mDown = false; grabHandles(); } return; }
    V.bHold = null;
    const lk = S().stacks.find((q) => q.id === c.load);
    if (lk) pickUp(lk);
  }
  function press(ctx) {
    if (!ctx) return;
    sounds.wake();
    if (ctx.kind === 'hands') { if (!(V.cool > 0.08)) handAct(ctx); }
    else if (ctx.kind === 'bgrab') {
      const lk = ctx.load && S().stacks.find((q) => q.id === ctx.load);
      if (lk && V.fSrc === 'click') { V.bHold = { t: 0 }; return; }       // a click takes an armful once the button is up; held, it takes the handles
      grabHandles();
    }
    else if (ctx.kind === 'bload') { const r = cmd('barrowLoad', { stackId: ctx.stack.id }); if (r.ok) { sounds.play('thunk'); nameIt(r.itemId); flash('Loaded ' + stackName(r.itemId)); } else flash(r.reason === 'full' ? 'The wheelbarrow is full' : r.reason === 'holds something else' ? 'It already holds something else' : 'Cannot load that'); }
    else if (ctx.kind === 'bdown') { const b = S().barrow; cmd('barrowSet', { x: b.x, z: b.z, yaw: b.yaw }); sounds.play('thunk'); }
    else if (ctx.kind === 'sgrab') { V.scafHeld = true; V.rev++; sounds.play('lift'); flash('Point at a wall for a bay along it, or inside the frame for a tower, and press again'); }
    else if (ctx.kind === 'sset') { const r = cmd('setScaffold', ctx.spot); V.scafHeld = false; if (r.ok) { sounds.play('thud'); G.cam.shake = Math.min(G.cam.shake + 0.05, 0.3); note('Scaffold up', ctx.spot.free ? 'Walk into the ladder at its end to climb. From the tower the ridge and the rafters overhead are in reach; take it down and set it up again to move it.' : 'Walk into the ladder at its end to climb. Up there the top of the wall and the roof edge are in reach.'); } else flash(r.reason); }
    else if (ctx.kind === 'sdrop') { const P = G.player; V.scafHeld = false; cmd('moveScaffold', { x: P.x + Math.sin(P.face) * 1.1, z: P.z + Math.cos(P.face) * 1.1 }); sounds.play('thunk'); }
    else if (ctx.kind === 'sstrike') { const P = G.player; const r = cmd('strikeScaffold', { x: P.x + Math.sin(P.face) * 1.1, z: P.z + Math.cos(P.face) * 1.1 }); if (r.ok) { sounds.play('thud'); flash('Scaffold down. Pick the bundle up to set it up along another wall'); } }
    else if (ctx.kind === 'cut') cutNext(ctx);
    else if (ctx.kind === 'hgrab') { V.horsesHeld = true; V.rev++; sounds.play('lift'); flash('Carry the sawhorses to the work; press again to set them down'); }
    else if (ctx.kind === 'hset') { const h = CS.horses; V.horsesHeld = false; if (h) cmd('moveHorses', { x: h.x, z: h.z, yaw: h.yaw }); sounds.play('thunk'); }
    else if (ctx.kind === 'pick') pickUp(ctx.stack);
    else if (ctx.kind === 'back' || ctx.kind === 'drop' || (ctx.kind === 'hint' && ctx.drop)) putDown();
    else if (ctx.kind === 'swap') { putDown(); pickUp(ctx.stack); }
    else if (ctx.kind === 'auto') startAuto(ctx.id, ctx.stage, ctx.guided);
    else if (ctx.kind === 'stop') stopAuto();
    else if (ctx.kind === 'anchor') {
      const at = RW.at(), g = geom(ctx.id);
      if (!at || !g) return;
      const p = new T.Vector3(...at.F.on(at.s, at.F.top - 0.06, 0.03)).applyMatrix4(g.matrix), r = cmd('fixAnchor', { structId: ctx.id, x: p.x, y: p.y, z: p.z });
      if (r.ok) { V.clip = ctx.id; sounds.play('knock'); sounds.play('seat'); G.burst(p.x, p.y + 0.05, p.z, 4, 0xe8d9b0, 0.6, 0.7, 0.05, 0.3); note('Anchor fixed, clipped in', 'Screwed through the deck into a rafter. The rope keeps you back from the edge; press E by the anchor to unclip.'); }
    }
    else if (ctx.kind === 'clip') { V.clip = ctx.id; V.rev++; sounds.play('seat'); flash('Clipped in: the rope keeps you back from the edge'); }
    else if (ctx.kind === 'unclip') { V.clip = null; V.rev++; sounds.play('thunk'); flash('Unclipped'); }
    else if (ctx.kind === 'lean') { const r = cmd('leanLadder', ctx.spot); if (r.ok) { sounds.play('thunk'); flash('Ladder up. Walk onto its foot to climb'); } else flash(r.reason); }
    else if (ctx.kind === 'ladder') {
      if (ctx.act === 'down' && V.climb) V.climb.e = true;
      else if (ctx.act === 'take') { const r = cmd('takeLadder'); if (r.ok) sounds.play('thunk'); else flash('Put down what you are carrying first'); }
    }
  }
  function startAuto(id, stage, guided) {
    const pr = S().progress[id];
    if (!pr) return;
    if (!stage) { const pl = plan(id); stage = pl && pl.inst.length ? pr.members[pl.inst[0]].stage : pl && pl.raise ? 'wall-frame' : null; }
    if (!stage) return;
    V.auto = { id, stage, guided: !!guided, wait: 0 };
    V.sel = id;
  }
  function stopAuto(why) { if (!V.auto) return; V.auto = null; W.job && W.cancel(); if (V.raise) V.raise.hold = false; if (why) flash(why); V.rev++; }

  // ------------------------------------------------------------------ the work itself
  const W = window.__assembly.createWorker({
    beatS: C.WORK.beatS,
    onBeat(j, n, last) {
      const snd = C.WORK.sound[j.kind] || 'knock';
      sounds.play(last && snd === 'knock' ? 'seat' : snd, 0.94 + 0.12 * Math.random());
      const p = asm.worldOf(j.id, j.layer, j.m, vTmp);
      if (j.kind === 'site') G.burst(p.x + (Math.random() - 0.5) * 2.4, G.heightAt(p.x, p.z) + 0.15, p.z + (Math.random() - 0.5) * 2.4, 4, 0x6b4f35, 1.6, 2.2, 0.11, 0.6);
      else if (last) G.burst(p.x, p.y, p.z, 3, 0xe8d9b0, 0.7, 0.7, 0.05, 0.35);
      G.player.faceTarget = Math.atan2(p.x - G.player.x, p.z - G.player.z);
    },
    onDone(j) {
      V.working = null;
      const r = cmd('install', { structId: j.id, memberIds: [j.memberId], from: j.from, auto: !!V.auto });
      if (!r.ok) { redraw(j.id); stopAuto(); flash(reason(r)); return; }
      const sawn = CS && r.cuts && r.cuts.find((q) => q.stick && q.sawn);
      if (sawn) { const P = G.player, onH = CS.near(P.x, P.z, 4.5); for (const pc of sawn.pieces) CS.cut({ stockM: pc.stockM, lenM: pc.lenM, sawn: pc.sawn, keptM: pc.keptM, onHorses: onH, x: P.x + Math.sin(P.face) * 0.75, z: P.z + Math.cos(P.face) * 0.75, y: P.y, yaw: P.face + Math.PI / 2, slow: 0.5 }, null); }
      V.idleT = 0;
      const pr = S().progress[j.id];
      if (r.installed.length) {
        if (j.layer === 'main') freshOf(j.id).add(j.memberId);
        if (j.kind === 'site' || j.kind === 'door' || j.kind === 'window' || freshOf(j.id).size >= 40) { flush(j.id); if (j.kind === 'site') V.terrainV = (V.terrainV || 0) + 1; }
        moments(pr, j, r);
      } else if (r.partial.length) { const q = r.partial[0]; flash(plain(lineOf(pr, j.memberId).label) + ': ' + Math.round((100 * q.got) / q.need) + '% there. Fetch more.'); }
      redraw(j.id);
    },
    onCancel(j) { V.working = null; redraw(j.id); },
  });
  const vTmp = new T.Vector3();
  const reason = (r, kind, mid) => r.reason === 'support missing' ? ((C.SUPPORT_SAYS[r.missing] || 'Set the supports') + ' first') : (kind === 'door' || kind === 'window') && (r.reason === 'stage not open' || r.reason === 'frame not finished') ? (r.reason === 'frame not finished' ? 'Frame the opening first' : 'Wrap the wall before the ' + kind + ' goes in') : ({ 'no material': 'You need ' + (r.itemId ? stackName(r.itemId) : 'material') + ' for that', 'wrong material': 'That needs ' + (r.itemId ? stackName(r.itemId) : 'something else'), 'no fasteners': 'Out of ' + (r.itemId ? low(CAT[r.itemId].name) : 'fasteners') + ': buy more in the Supplier (U)', 'stage not open': 'Not yet: an earlier stage comes first', 'cut first': 'Cut it at the sawhorses first', 'no sawhorses': 'The sawhorses come with the lumber', 'nothing to cut': 'Nothing left to cut' })[r.reason] || 'That cannot go in yet';
  function autoCan(s, pr, mid, ln, c) {
    const pm = pr.members[mid], sn = pm.prep ? 1 : api.stockNeed(s, pr, mid);
    if (holds(c, pr, mid) && (!ln.stick || c.qty + 1e-6 >= sn)) return true;
    if (pm.site && !pm.prep) return sn <= 1e-6 || (!!c && c.itemId === ln.itemId && c.qty + 1e-6 >= sn);
    return !pm.site && !api.needsStock(s, pr, mid);
  }
  function beginMember(id, memberId, from) {
    const pr = S().progress[id], g = geom(id), m = g.byId.get(memberId) || { id: memberId, kind: 'site', a: [g.cx, 0, g.cz], b: [g.cx, 0, g.cz], n: [0, 1, 0], section: { b: 0, d: 0 }, draw: 0 }, pm = pr.members[memberId], ln = lineOf(pr, memberId);
    const need = pm.need - pm.got, c = S().carried;
    const want = api.stockNeed(S(), pr, memberId), partial = from !== 'stacks' && ln && need > 1e-6 && want > 1e-6 && (!c || c.itemId !== ln.itemId || c.qty + 1e-6 < want);
    const layer = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) ? pm.parent : 'main';
    V.working = { id, memberId, layer, m, partial };
    W.begin({ id, memberId, layer, m, from, kind: pm.kind, beats: partial ? 2 : C.memberBeats(pm.kind) });
    redraw(id);
  }
  function moments(pr, j, r) {
    const done = (st) => r.stagesDone.includes(st);
    if (done('subfloor')) celebrate('deck');
    if (j.kind === 'rafter' && Object.values(pr.members).filter((m) => m.kind === 'rafter' && m.built).length === 1) celebrate('firstRafter');
    if (done('roofing')) { celebrate('driedIn'); const w = G.sim.state.sys.weather; if (w && w.rainMmH > 0.05) setTimeout(() => note('It is raining', 'And it is dry inside your ' + low(pr.name) + '.'), 4200); }
    if (j.kind === 'door') { celebrate('doorHung'); sounds.play('creak'); setTimeout(() => sounds.play('creak'), 450); }     // it swings once on its hinges
    for (const st of r.stagesDone) { flush(pr.id); if (!['subfloor', 'roofing'].includes(st) && !r.done) note(C.STAGE[st].name + ' done', nextLine(pr)); }
    if (r.done) { flush(pr.id); celebrate('finished', pr.planId === 'shed' ? 'You built this. New in the plan book: the small cabin, and drawing your own plans.' : null); }
  }
  function nextLine(pr) { const pl = plan(pr.id), v = pl && pl.view.stages.find((q) => q.id === pl.view.next); return v ? 'Next: ' + low(v.verb) + '.' : ''; }
  function tickRaise(dt, hold) {
    const R = V.raise;
    if (!R) return;
    const g = geom(R.id), hw = g && g.walls.get(R.parent);
    if (!hw) { V.raise = null; return; }
    if (R.landed) {                                   // a small rock as it settles plumb
      R.landed += dt;
      asm.swing(R.id, R.parent, -Math.sign(hw.flat) * 0.035 * Math.exp(-7 * R.landed) * Math.cos(R.landed * 19));
      if (R.landed > 0.7) { if (R.ids) { B.setBuilt(R.ids, true); keepVer(R.id); V.flushing.push({ id: R.id, ids: [], layer: R.parent }); R.ids = null; R.landed = 0.7; } else { asm.dropLayer(R.id, R.parent); V.raise = null; redraw(R.id); } }
      return;
    }
    // heavy at first, easier as it comes up past the balance; let go and it sinks back
    if (hold) R.p += (dt * (0.22 + 1.0 * R.p)) / 1.25 * (V.auto && V.auto.guided ? 2.2 : 1) + (R.push || 0);
    else R.p = Math.max(0, R.p - dt * 0.35);
    R.push = 0;
    if (hold) { R.creak -= dt; if (R.creak <= 0) { sounds.play('creak'); R.creak = 0.42; } }
    const k = Math.min(1, R.p), e = k * k * (3 - 2 * k);
    R.angle = hw.flat * (1 - e);
    asm.swing(R.id, R.parent, R.angle);
    if (R.p >= 1) {
      const r = cmd('raise', { structId: R.id, parent: R.parent });
      R.landed = 0.0001; R.angle = 0;
      sounds.play('thud'); G.cam.shake = Math.min(G.cam.shake + 0.1, 0.4);
      const st = V.structs.get(R.id), c = Math.cos(st.yaw), s2 = Math.sin(st.yaw);
      for (let i = 0; i < 5; i++) { const t = (i / 4 - 0.5) * hw.len, lx = hw.mid[0] + hw.u[0] * t, lz = hw.mid[1] + hw.u[1] * t; vTmp.set(lx, hw.low, lz).applyMatrix4(g.matrix); G.burst(vTmp.x, vTmp.y + 0.05, vTmp.z, 3, 0xe8d9b0, 1.2, 0.6, 0.07, 0.5); }
      if (r.ok) {
        const pr = S().progress[R.id], ids = Object.keys(pr.members).filter((id) => pr.members[id].parent === R.parent && pr.members[id].stage === 'wall-frame');
        R.ids = ids;
        const n = Object.keys(pr.raised).length;
        if (r.stagesDone.length) celebrate('framed'); else if (n === 1) celebrate('wallUp'); else note('Wall up', n + ' of ' + api.flatParents(pr, 'wall-frame').length + ' standing.');
        braces(R.id);
      }
    } else if (!hold && R.p <= 0) { V.raise = null; redraw(R.id); }
  }
  function tickWork(dt) {
    const ctx = V.ctx, held = !!G.keys.KeyE || V.mDown, s = S();
    V.cool -= dt * (C.workSpeed(G.sim.state.sys.stock.tools, G.powerAvailable && G.powerAvailable()));
    V.handT += dt; tickBlow(dt); tickFlights(dt); if (V.cutBusy > 0) V.cutBusy -= dt;
    if (V.jolt) { const j = V.jolt; j.t += dt; liftTo(j.id, j.layer, j.mid, Math.max(-0.025, (j.built ? 0 : proud(j.mid)) - 0.045 * Math.exp(-j.t * 16) * Math.cos(j.t * 46))); if (j.t > 0.28) { asm.lift(j.id, j.layer, j.mid, j.built ? 0 : proud(j.mid)); V.jolt = null; } }
    tickSlides(dt); tickRolls(dt);
    if (V.swingIn) { V.swingIn.t += dt; const w = V.swingIn; asm.lift(w.id, w.layer, w.mid, proud(w.mid)); if (w.t > 0.2) V.swingIn = null; }
    const speed = C.workSpeed(G.sim.state.sys.stock.tools, G.powerAvailable && G.powerAvailable());
    if (V.auto) {
      const A = V.auto, pr = s.progress[A.id], pl = pr && plan(A.id);
      if (!pr || !pl) { stopAuto(); return; }
      if (V.raise) tickRaise(dt, true);
      else if (pl.raise) { V.raise = { id: A.id, parent: pl.raise, p: 0, angle: geom(A.id).walls.get(pl.raise).flat, creak: 0 }; redraw(A.id); }
      else if (!W.job) {
        const q = pl.inst.filter((id) => pr.members[id].stage === A.stage);
        if (!q.length) { const was = A.stage; stopAuto(); if (!api.stageComplete(pr, was)) flash('Stopped: ' + C.STAGE[was].name + ' is waiting on something else'); return; }
        const ln = lineOf(pr, q[0]), pm = pr.members[q[0]], c = s.carried;
        if (A.guided || !ln || pm.need - pm.got < 1e-6) beginMember(A.id, q[0], A.guided ? 'stacks' : 'carried');
        // working until done cuts on-site pieces itself: from an offcut, or from the sticks in the arms
        else if (autoCan(s, pr, q[0], ln, c)) beginMember(A.id, q[0], 'carried');
        else {                                        // fetch the next armful: a short pause for the walk
          A.wait += dt;
          if (A.wait > 0.8) {
            A.wait = 0;
            if (c && c.itemId !== ln.itemId) putDown();       // the same thing in the arms: take more on top of it (a stick needs a whole stick's length)
            const st = s.stacks.filter((k) => k.itemId === ln.itemId && !k.barrow).sort((a, b) => b.qty - a.qty)[0];
            if (!st || !pickUp(st).ok) stopAuto('Out of ' + stackName(ln.itemId) + ': order the stage in the Build panel');
          }
        }
      }
      W.tick(dt, speed * (A.guided ? C.WORK.guidedSpeed : 1));
    } else {
      if (ctx && ctx.kind === 'raise') {
        if (held && !V.raise) { const hw = geom(ctx.id).walls.get(ctx.parent); V.raise = { id: ctx.id, parent: ctx.parent, p: 0, angle: hw.flat, creak: 0, hw }; redraw(ctx.id); }
      }
      if (V.raise) tickRaise(dt, held && ctx && (ctx.kind === 'raise' || V.raise.landed));
      // holding keeps the hands going at a steady rhythm: set, strike, strike, the next piece
      if (held && ctx && ctx.kind === 'hands' && !V.raise && V.cool <= 0) handAct({ ...ctx, repeat: true });
      if (W.job) W.cancel();
    }
    if (V.working && !V.working.partial && V.working.m.draw !== 0) liftTo(V.working.id, V.working.layer, V.working.memberId, 0.24 * (1 - W.progress()));
    // the character's arms: a blow for each beat, both up under a wall, one up under a load
    const P = G.player, pose = V.pose || (V.pose = { kind: '', k: 0 });
    if (V.cutNow) { pose.kind = 'saw'; pose.k = V.cutNow.k; P.faceTarget = Math.atan2(V.cutNow.x - P.x, V.cutNow.z - P.z); }
    else if (V.raise && !V.raise.landed) pose.kind = 'lift';
    else if (V.blow) { pose.kind = 'hammer'; pose.k = blowK(V.blow.t); }
    else if (W.job) { pose.kind = 'hammer'; const ph = Math.min(1, W.t / C.WORK.beatS); pose.k = ph < 0.2 ? 1.05 - 0.6 * ease(ph / 0.2) : ph < 0.8 ? 0.45 - 0.7 * ease((ph - 0.2) / 0.6) : -0.25 + 1.3 * ((ph - 0.8) / 0.2); }
    else if (V.poseT > 0) { V.poseT -= dt; pose.kind = V.poseKind; pose.k = Math.min(1, 1 - V.poseT / 0.24 + 0.35); }
    else pose.kind = s.carried ? 'carry' : '';
    P.work = pose.kind ? pose : null;
    // the hammer is in the hand while there is nailing to do here, the hatchet otherwise
    P.hammer = pose.kind === 'hammer' || (!!ctx && ctx.kind === 'hands' && (ctx.act === 'nail' || V.handT < 1.5));
    // hand finished pieces back to build mode once the hammer rests
    V.idleT = W.job ? 0 : V.idleT + dt;
    if (V.idleT > 0.45) for (const [id, f] of V.fresh) if (f.size && !V.flushing.some((q) => q.id === id)) flush(id);
  }

  // ------------------------------------------------------------------ words on screen
  function setPrompt(key, text, count, frac) {
    const sig = key + '|' + text + '|' + (count || '');
    if (sig !== V.promptSig) {
      V.promptSig = sig;
      promptEl.hidden = !text;
      if (text) { $('cvpk').hidden = !key; $('cvpk').textContent = key || ''; $('cvpt').textContent = text; $('cvpc').textContent = count || ''; }
      const act = $('cvact');
      if (act) { const touch = document.body.classList.contains('touch'); act.hidden = !(touch && key && text); if (!act.hidden) act.textContent = text.split(':')[0]; }
    }
    const pb = $('cvpb'), on = frac !== undefined && frac !== null;
    if (pb.hidden === on) pb.hidden = !on;
    if (on) { const pct = Math.round(frac * 50); if (pct !== V.pct) { V.pct = pct; pb.firstChild.style.width = pct * 2 + '%'; } }
  }
  function flash(text) { V.hint = text; V.hintT = 2.6; }
  function say(text, cls) { const el = $('cvsay'); el.textContent = text || ''; el.className = 'cvsay' + (cls ? ' ' + cls : ''); V.sayT = text ? 6 : 0; }
  function showBanner(t, l, small, secs) {
    banner.querySelector('.t').textContent = t; banner.querySelector('.l').textContent = l || '';
    banner.className = 'panel' + (small ? ' small' : ''); banner.hidden = false; V.bannerT = secs;
  }
  function note(t, l) { if (V.bannerT > 1.5 && !banner.classList.contains('small')) return; showBanner(t, l, true, 3.2); }
  function celebrate(key, line) { const m = C.MOMENTS[key]; showBanner(m.title, line || m.line, false, 5); sounds.play('chime'); }
  function workLabel(pr, memberId) {
    const ln = lineOf(pr, memberId), pm = pr.members[memberId];
    if (!ln) return { text: C.STAGE[pm.stage].verb, count: '' };
    let n = 0, t = 0;
    for (const id in pr.members) if (pr.members[id].line === pm.line) { t++; if (pr.members[id].built) n++; }
    return { text: plain(ln.label), count: t > 1 ? n + ' of ' + t : '' };
  }
  function updatePrompt(dt) {
    const ctx = V.ctx, s = S();
    if (V.hintT > 0) { V.hintT -= dt; setPrompt('', V.hint, '', null); return; }
    if (V.placing) { setPrompt('', V.placing.ok ? 'Click to set it down · wheel or Q / E turns it · Esc cancels' : V.placing.why, '', null); return; }
    if (!ctx) { setPrompt('', '', '', null); return; }
    const pr = ctx.id !== undefined ? s.progress[ctx.id] : null;
    if (ctx.kind === 'stop' && !V.auto) { setPrompt('', '', '', null); return; }
    if (ctx.kind === 'stop') {
      const A = V.auto, w = V.working && workLabel(pr, V.working.memberId), v = plan(A.id).view.stages.find((q) => q.id === A.stage);
      setPrompt('E', 'Stop · ' + (V.raise ? 'raising the wall' : w ? low(w.text) : A.wait > 0 ? 'fetching more' : low(C.STAGE[A.stage].name)), v ? v.built + ' of ' + v.total : '', V.raise ? Math.min(1, V.raise.p) : W.job ? W.progress() : null);
    } else if (ctx.kind === 'raise') setPrompt('E', 'Hold and push up to raise the wall', '', V.raise ? Math.min(1, V.raise.p) : 0);
    else if (ctx.kind === 'hands') { const w = workLabel(pr, ctx.mid), pm = pr.members[ctx.mid], b = V.blows[ctx.mid], of = b ? b.of : nailCount(geom(ctx.id), pm, ctx.mid); setPrompt('E', ctx.act === 'set' ? (api.knows(S(), pm.kind) && sweepable(pr, ctx.mid, geom(ctx.id)) ? 'Hold and drag along the run: ' + low(w.text).replace(/s$/, '') : 'Set the ' + low(w.text)) + (pm.line && pr.lines[pm.line].sheet && !api.needsStock(S(), pr, ctx.mid) ? ' (from an offcut)' : '') : ctx.act === 'dig' ? 'Dig and level' : pm.kind === 'pier' ? 'Stamp it level: ' + (b ? b.n : 0) + ' of ' + of : 'Nail them: ' + (b ? b.n : 0) + ' of ' + of, ctx.act === 'set' ? w.count : '', ctx.act === 'set' ? null : (b ? b.n : 0) / of); }
    else if (ctx.kind === 'lean') setPrompt('E', 'Lean the ladder here', '', null);
    else if (ctx.kind === 'anchor') setPrompt('E', 'Fix a roof anchor at the ridge and clip in', '', null);
    else if (ctx.kind === 'clip') setPrompt('E', 'Clip in to the roof anchor', '', null);
    else if (ctx.kind === 'unclip') setPrompt('E', 'Unclip from the anchor', '', null);
    else if (ctx.kind === 'ladder') setPrompt('E', ctx.act === 'climb' ? 'Climb the ladder' : ctx.act === 'take' ? 'Take the ladder down' : 'Climb down', '', null);
    else if (ctx.kind === 'work') { const w = workLabel(pr, V.working ? V.working.memberId : ctx.q[0]); setPrompt('E', 'Hold to build: ' + low(w.text), w.count, W.job ? W.progress() : 0); }
    else if (ctx.kind === 'piece') setPrompt('', 'Click a glowing piece to set it', ctx.q.length + ' ready', W.job ? W.progress() : null);
    else if (ctx.kind === 'auto') setPrompt('E', (ctx.guided ? 'Build: ' : 'Work until done: ') + low(C.STAGE[ctx.stage].name), '', null);
    else if (ctx.kind === 'bgrab') { const k = ctx.load && s.stacks.find((q) => q.id === ctx.load); if (k) setPrompt('', 'Click: take ' + low(stackName(k.itemId)) + ', ' + describe(k.itemId, k.qty).n + ' left · Hold: take the handles', 'E also takes the handles', V.bHold ? Math.min(1, V.bHold.t / 0.4) : null); else setPrompt('E', 'Take the wheelbarrow handles', 'empty', null); }
    else if (ctx.kind === 'bload') setPrompt('E', 'Load the wheelbarrow with ' + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'bdown') setPrompt('E', 'Set the wheelbarrow down', '', null);
    else if (ctx.kind === 'cut') setPrompt(ctx.full ? '' : 'E', ctx.full ? 'Your arms are full: carry these to the frame' : 'Cut ' + low(cutLabel(S().progress[ctx.id], ctx.mid)) + ' (' + mm(S().progress[ctx.id].members[ctx.mid].len) + ')', ctx.left + ' to cut', null);
    else if (ctx.kind === 'hgrab') setPrompt('E', 'Pick up the sawhorses', 'the cut station', null);
    else if (ctx.kind === 'sgrab') setPrompt('E', 'Take the scaffold bundle', '', null);
    else if (ctx.kind === 'sset') setPrompt('E', ctx.spot.free ? 'Set up a scaffold tower here, under the roof frame' : 'Set up the scaffold along this wall', '', null);
    else if (ctx.kind === 'sdrop') setPrompt('E', 'Put the scaffold down (point at a wall for a bay, or inside the frame for a tower)', '', null);
    else if (ctx.kind === 'sstrike') setPrompt('E', 'Take the scaffold down', '', null);
    else if (ctx.kind === 'hset') setPrompt('E', 'Set the sawhorses down here', '', null);
    else if (ctx.kind === 'pick') setPrompt('E', (ctx.more ? 'Take more ' : 'Pick up ') + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'back') setPrompt('E', 'Put back the ' + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'swap') setPrompt('E', 'Swap for ' + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'drop') setPrompt(s.carried ? 'E' : '', s.carried ? 'Put down the ' + stackName(s.carried.itemId) : '', '', null);
    else if (ctx.kind === 'hint') setPrompt(ctx.drop ? 'E' : '', ctx.text + (ctx.drop ? ' · put down' : ''), '', null);
  }

  // what to do next, for the note on the left and the arrow in the world
  function nextAction() {
    const s = S(), pr = current();
    if (s.options.sandbox) return null;
    if (V.placing) return { k: 'Placing', title: V.placing.kind === 'drop' ? 'Delivery spot' : V.placing.name, line: 'Click the ground to set it down. The wheel or Q / E turns it.' };
    if (!pr) {
      const card = G.sim.state.sys.stock.projects.find((p) => p.id === C.FIRST_SHED.projectId);
      if (card && card.status === 'open' && !s.tutorial.done) return { k: 'First project', title: C.FIRST_SHED.title, line: 'Press <kbd>L</kbd> and choose the tool shed.', btn: ['book', 'Open the plan book'] };
      return null;
    }
    const pl = plan(pr.id), st = V.structs.get(pr.id);
    if (!pl) return null;
    const v = pl.view.stages.find((q) => q.id === pl.view.next), at = { x: st.x, z: st.z, y: 3.4 };
    if (!v) return pr.done ? null : { k: pr.name, title: 'Waiting', line: 'Nothing can go in just now.' };
    const out = { k: pr.name + ' · ' + C.STAGE_ORDER.filter((q) => pl.view.stages.some((w) => w.id === q)).indexOf(v.id) + ' of ' + pl.view.stages.length + ' stages done', title: v.name, stage: v.id, what: v.what, why: v.why };
    out.k = pr.name + ' · stage ' + (pl.view.stages.indexOf(v) + 1) + ' of ' + pl.view.stages.length;
    if (Object.values(pr.lines).every((l) => l.ordered <= 1e-9) && pl.view.toOrderUsd > 0) return { ...out, line: 'Order the materials. While they are on their way, level the ground: stand on the plan and hold <kbd>E</kbd>.', btn: ['order:all', 'Order everything, ' + money(pl.view.toOrderUsd)], target: at };
    if (V.auto && V.auto.id === pr.id) return { ...out, line: (V.auto.guided ? 'Building. ' : 'Working until it is done. ') + '<kbd>E</kbd> stops.', target: at };
    if (pl.raise) return { ...out, line: 'The frame is ready. Stand by it and hold <kbd>E</kbd> to raise the wall.', target: at };
    const first = pl.inst.find((id) => pr.members[id].stage === v.id) || pl.inst[0], ln = first ? lineOf(pr, first) : null;
    const have = (itemId) => s.stacks.some((k) => k.itemId === itemId) || (s.carried && s.carried.itemId === itemId);
    if (ln && !have(ln.itemId)) {
      if (v.pending || s.deliveries.some((d) => d.lines.some((l) => l.itemId === ln.itemId))) { const d = s.deliveries[0], mins = Math.max(1, Math.ceil((d.dueT - G.sim.state.t) / 60)); return { ...out, line: 'Your delivery arrives in about ' + mins + ' min of game time.' + (G.speed === 0 ? ' Time is paused.' : ''), wait: true }; }
      return { ...out, line: 'Order the materials for this stage.', btn: ['order:' + v.id, 'Order this stage, ' + money(v.toOrderUsd || v.costUsd)], btn2: pl.view.toOrderUsd > (v.toOrderUsd || 0) + 1 ? ['order:all', 'Order everything, ' + money(pl.view.toOrderUsd)] : null };
    }
    const lf = pr.level !== 'guided' && !V.auto ? leftInStage(pr) : null;
    if (lf) return { ...out, line: lf.text, target: { x: lf.list[0].x, z: lf.list[0].z, y: lf.list[0].y + 1.5 } };
    if (pr.level === 'guided') return { ...out, line: 'Stand by the ' + low(pr.name) + ' and press <kbd>E</kbd>, or use the button.', btn: ['auto:' + v.id, v.verb], target: at };
    if (!ln) return { ...out, line: 'Stand on the plan and hold <kbd>E</kbd> (or the mouse button) to dig it level.', target: at };
    const looseOne = pl.inst.find((id) => pr.members[id].need > 0 && pr.members[id].got >= pr.members[id].need - 1e-6);
    if (looseOne) return { ...out, line: 'A piece is set but loose. ' + (pr.members[looseOne].kind === 'pier' ? 'Point at it and click to stamp it level.' : 'Strike it once to drive all its nails, or hold and drag across the pieces.'), target: at };
    if (['top-plates', 'roof-frame', 'roof-deck', 'dry-in', 'roofing', 'gutters'].includes(v.id) && !s.ladder && !V.climb && !s.options.auto && pr.level !== 'guided' && ((s.carried && s.carried.itemId === LAD.itemId) || s.stacks.some((k) => k.itemId === LAD.itemId))) return { ...out, line: 'This is out of reach from the ground. Carry the ladder to a wall and click to lean it. Walk onto the ladder to climb.', target: at };
    const c = s.carried;
    {   // only pieces cut on site are left in this stage: to the sawhorses, or in with the ones already cut
      const here = pl.inst.filter((id) => pr.members[id].stage === v.id && pr.members[id].need - pr.members[id].got > 1e-6);
      if (here.length && here.every((id) => pr.members[id].site) && s.horses && !s.options.auto) {
        if (c && C.isCutItem(c.itemId)) return { ...out, line: 'Carry the cut pieces in and point at a glowing place: each one goes where it was cut for.', target: at };
        if (here.some((id) => !pr.members[id].prep)) return { ...out, line: 'Posts, cripples, gable studs and rafters are cut on site, to fit. Go to the sawhorses, point at them and press <kbd>E</kbd> for each cut; the pieces go into your arms.', target: { x: s.horses.x, z: s.horses.z, y: G.heightAt(s.horses.x, s.horses.z) + 1.4 } };
        const pile = s.stacks.find((k) => C.isCutItem(k.itemId));
        if (pile) return { ...out, line: 'The cut pieces wait on the sawhorses: pick them up and carry them in.', target: { x: pile.x, z: pile.z, y: G.heightAt(pile.x, pile.z) + 1.2 } };
      }
    }
    if (['dry-in', 'roofing'].includes(v.id) && RW && c && c.itemId === ln.itemId && pr.level !== 'guided' && !s.options.auto) {
      if (!RW.on()) return { ...out, line: 'Roofers work on the roof: climb the ladder and keep walking, onto the deck. On a steep roof, fix an anchor at the ridge and clip in first.', target: at };
      return { ...out, line: 'From the eave up, each layer lapping the one below. The glowing strip is the next one; the blue chalk line marks its top edge.' + (V.clip == null && RW.at() && RW.at().k > RWC.slideK ? ' Steep: clip in at the ridge first.' : ''), target: at };
    }
    if (c && c.itemId === ln.itemId && first && api.knows(s, pr.members[first].kind)) return { ...out, line: 'You know this work: hold the button and drag along the glowing places. Each piece is set and nailed as you pass.', target: at };
    if (c && c.itemId === ln.itemId) return { ...out, line: 'Carry the ' + stackName(c.itemId) + ' to the ' + low(pr.name) + '. Point at a glowing place: one click sets three pieces, then one strike nails a piece. Hold to keep going.', target: at };
    const stack = homeStack(ln.itemId) || s.stacks.find((k) => k.itemId === ln.itemId);
    return { ...out, line: (s.options.auto ? 'Press <kbd>E</kbd> by the ' + low(pr.name) + ' to work until done, or pick' : 'Pick') + ' up ' + stackName(ln.itemId) + ' at the stacks: point at them and click, or <kbd>E</kbd>.', target: s.options.auto ? at : stack ? { x: stack.x, z: stack.z, y: 1.9 } : null, item: ln.itemId };
  }
  function drawNext() {
    const a = nextAction(), s = S();
    V.anyOpen = inProgress().length > 0;
    V.target = a && a.target ? a.target : null;
    V.wantItem = a && a.item ? a.item : null;
    // a card with the reason, once for each stage as it opens
    const card = a && a.stage && s.options.cards && !s.tutorial.seen[a.stage] ? a.stage : null;
    const sig = a ? [a.k, a.title, a.line, a.btn && a.btn.join(), a.btn2 && a.btn2.join(), card].join('|') : '';
    if (sig === V.nextSig) return;
    V.nextSig = sig;
    nextEl.hidden = !a || G.player.tool === 'build';
    if (!a) return;
    nextEl.innerHTML = `<div class="cvk">${esc(a.k)}</div><div class="cvt">${esc(a.title)}</div><div class="cvl">${a.line}</div>` +
      (card ? `<div class="cvwhy"><b>${esc(a.what)}</b><br>Why: ${esc(low(a.why))}</div>` : '') +
      (a.btn || card ? `<div class="cvrow">${a.btn ? `<button type="button" class="go" data-act="${a.btn[0]}">${esc(a.btn[1])}</button>` : ''}${a.btn2 ? `<button type="button" data-act="${a.btn2[0]}">${esc(a.btn2[1])}</button>` : ''}${card ? `<button type="button" data-act="seen:${card}">Got it</button><button type="button" data-act="cardsoff" title="Stop showing these">No more tips</button>` : ''}</div>` : '');
  }

  // ------------------------------------------------------------------ the Build panel
  const ICON = {
    shed: '<svg viewBox="0 0 120 74"><path d="M22 34 L98 22 L98 62 L22 62 Z" fill="#c9a468" stroke="#5a3b22" stroke-width="2"/><path d="M14 36 L106 21" stroke="#50555e" stroke-width="6" stroke-linecap="round"/><rect x="34" y="40" width="16" height="22" fill="#9a6b3f" stroke="#5a3b22" stroke-width="1.5"/><rect x="66" y="38" width="16" height="12" fill="#bcd6e4" stroke="#5a3b22" stroke-width="1.5"/><path d="M26 66 h10 M56 66 h10 M86 66 h10" stroke="#b5b2aa" stroke-width="5"/></svg>',
    cabin: '<svg viewBox="0 0 120 74"><path d="M18 36 L60 10 L102 36 L102 62 L18 62 Z" fill="#c9a468" stroke="#5a3b22" stroke-width="2"/><path d="M10 39 L60 8 L110 39" fill="none" stroke="#50555e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><rect x="52" y="40" width="15" height="22" fill="#9a6b3f" stroke="#5a3b22" stroke-width="1.5"/><rect x="27" y="40" width="15" height="12" fill="#bcd6e4" stroke="#5a3b22" stroke-width="1.5"/><rect x="78" y="40" width="15" height="12" fill="#bcd6e4" stroke="#5a3b22" stroke-width="1.5"/><path d="M22 66 h10 M55 66 h10 M88 66 h10" stroke="#b5b2aa" stroke-width="5"/></svg>',
  };
  // what a plan in the book costs: set it down far away for a moment, read its list, take it away again
  function planQuote(planId) {
    if (V.quotes[planId]) return V.quotes[planId];
    let q = { costUsd: 0, pieces: 0 };
    try {
      const was = B.constructionMode, undo = B.state.undo.length;
      B.setConstructionMode(true);
      const r = B.placePlan(planId, G.player.x + 4000, G.player.z + 4000, 0);
      for (const l of B.materialsList(r.struct)) {
        const map = C.LINE_ITEM[String(l.key).split('|')[1]], it = CAT[(map && map.itemId) || l.itemId];
        if (it) q.costUsd += Math.round(it.priceUsd * (map && map.each ? l.count : l.qty) * 100) / 100;
      }
      q.pieces = B.pieces().filter((p) => p.struct === r.struct && p.stage && p.parent).length;
      B.removeStruct(r.struct);
      B.state.undo.length = Math.min(B.state.undo.length, undo);
      B.setConstructionMode(was);
      V.bv = B.version;
    } catch (err) { console.error(err); }
    return (V.quotes[planId] = q);
  }
  function bookHtml() {
    const s = S();
    let h = '<div class="book">';
    for (const pl of B.plans()) {
      const bk = C.PLAN_BOOK[pl.id] || { blurb: pl.note, timeMin: 20, needs: null }, open = !bk.needs || s.unlocked.includes(bk.needs), q = open ? planQuote(pl.id) : null;
      h += `<div class="plan${open ? '' : ' locked'}">${ICON[pl.id] || ICON.shed}<div class="nm">${esc(pl.name)}</div><div class="sm">${esc(bk.blurb)}</div>` +
        (open ? `<div class="fig">${esc(pl.size)} · about ${money(Math.round(q.costUsd / 10) * 10)}<br>${q.pieces} pieces · about ${bk.timeMin} min by hand</div><button type="button" class="go" data-act="place:${pl.id}">Choose where it goes</button>` : `<div class="fig">${esc(pl.size)}</div><div class="sm">Finish your first shed to open this plan.</div>`) + '</div>';
    }
    h += '</div>';
    h += `<div class="cvopts" style="margin-top:4px">${s.unlocked.includes('plan:draw') ? 'You can also draw your own in Plan mode (<kbd>B</kbd>): it becomes a building to raise.' : 'Drawing your own plans opens when your first shed is finished.'}</div>`;
    return h;
  }
  const STATUS = { 'not-ordered': 'not ordered', ordered: 'on its way', delivered: 'delivered', ready: 'ready', done: 'done' };
  function panelHtml() {
    const s = S(), list = Object.values(s.progress).filter((pr) => V.structs.has(pr.id)), pr = current() || (V.sel !== null ? s.progress[V.sel] : null);
    let h = '';
    const opts = `<div class="cvopts"><label><input type="checkbox" data-opt="instant"${s.options.instant ? ' checked' : ''}>Instant deliveries</label><label><input type="checkbox" data-opt="cards"${s.options.cards ? ' checked' : ''}>Tips</label><label><input type="checkbox" data-opt="mute"${s.options.mute ? '' : ' checked'}>Sound</label><label title="Skip construction: whatever you draw or place is built at once"><input type="checkbox" data-opt="sandbox"${s.options.sandbox ? ' checked' : ''}>Sandbox</label></div>`;
    if (s.options.sandbox) return '<div class="cvstep">Sandbox is on: plans are built the moment they are drawn or placed. Turn it off to order materials and raise buildings by hand.</div>' + bookHtml() + opts;
    if (V.book || !pr) {
      h += `<h3>${list.length ? 'Start a new building' : 'The plan book'}</h3>` + bookHtml();
      if (list.length) h += '<div class="cvtop"><button type="button" data-act="back">Back to your buildings</button></div>';
      return h + opts;
    }
    if (list.length > 1) h += '<div class="tabs">' + list.map((q) => `<button type="button" data-act="sel:${q.id}" aria-pressed="${q.id === pr.id}">${esc(q.name)}${q.done ? ' ✓' : ''}</button>`).join('') + '</div>';
    const pl = plan(pr.id), v = pl.view, step = s.tutorial.shed === pr.id && !s.tutorial.done ? api.tutorialStep(s) : 0;
    if (step) { const sd = C.FIRST_SHED.steps[Math.min(13, step) - 1]; h += `<div class="cvstep"><b>Your first shed · step ${sd.n} of 13.</b> ${esc(sd.does)}. <span style="color:var(--ink-dim)">${esc(sd.teaches)}</span></div>`; }
    if (pr.done) h += `<div class="cvstep"><b>Finished.</b> ${v.total} pieces, put in by you.${roomLine(pr)}</div>`;
    const nx = v.stages.find((q) => q.id === v.next);
    // the one obvious next action
    h += '<div class="cvtop">';
    if (nx) {
      if (Object.values(pr.lines).every((l) => l.ordered <= 1e-9) && v.toOrderUsd > 0) h += `<button type="button" class="go" data-act="order:all">Order everything, ${money(v.toOrderUsd)}</button><button type="button" data-act="order:${(v.stages.find((q) => q.toOrderUsd > 0) || nx).id}">Only the first stage, ${money((v.stages.find((q) => q.toOrderUsd > 0) || nx).toOrderUsd)}</button>`;
      else if (nx.toOrderUsd > 0 && nx.status === 'not-ordered') h += `<button type="button" class="go" data-act="order:${nx.id}">Order this stage, ${money(nx.toOrderUsd)}</button>`;
      else if (nx.status === 'ordered') h += `<button type="button" disabled>Delivery on its way</button>`;
      else if (V.auto && V.auto.id === pr.id) h += `<button type="button" class="go" data-act="stop">Stop working</button>`;
      else if (pr.level === 'guided') h += `<button type="button" class="go" data-act="auto:${nx.id}">${esc(nx.verb)}</button>`;
      else h += `<button type="button" class="go" data-act="auto:${nx.id}" title="Your character keeps working this stage, fetching from the stacks. F stops.">Work until done: ${esc(low(nx.name))}</button>`;
      if (!Object.values(pr.lines).every((l) => l.ordered <= 1e-9) && v.toOrderUsd > (nx.status === 'not-ordered' ? nx.toOrderUsd : 0) + 1) h += `<button type="button" data-act="order:all">Order everything, ${money(v.toOrderUsd)}</button>`;
    }
    h += '</div>';
    { const F = feel(), cur = C.FEEL_SPEC.map((q) => F[q.key]).join();
      h += `<details class="cvfeel"${V.feelOpen ? ' open' : ''}><summary title="Every number the hands-on work is tuned by">Feel</summary><div class="cvseg">${Object.keys(C.FEEL_PRESETS).map((k) => `<button type="button" data-act="feelp:${k}" aria-pressed="${C.FEEL_SPEC.map((q) => C.FEEL_PRESETS[k][q.key]).join() === cur}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}<button type="button" data-act="feelr">Reset</button></div>`;
      for (const q of C.FEEL_SPEC) h += `<label class="cvopts" title="${esc(q.tip)}"><span>${esc(q.label)}</span><input type="range" data-feel="${q.key}" min="${q.min}" max="${q.max}" step="${q.step}" value="${F[q.key]}"><b data-fv="${q.key}">${q.words ? q.words[F[q.key]] : F[q.key]}</b></label>`;
      h += '</details>'; }
    h += `<div class="cvopts"><span>How hands-on:</span><div class="cvseg">${[['guided', 'Guided', 'One press builds a stage while you watch'], ['hands-on', 'Hands-on', 'Carry each piece, set it in place and nail it yourself']].map((q) => `<button type="button" data-act="level:${q[0]}" aria-pressed="${pr.level === q[0] || (q[0] === 'hands-on' && pr.level === 'piece')}" title="${q[2]}">${q[1]}</button>`).join('')}</div>${pr.level === 'hands-on' ? `<label title="Press F by the building once and it keeps going, fetching from the stacks"><input type="checkbox" data-opt="auto"${s.options.auto ? ' checked' : ''}>Work until done</label>` : ''}</div>`;
    h += '<ol>';
    v.stages.forEach((q, i) => {
      const isNext = q.id === v.next, cls = q.complete ? 'done' : isNext ? 'next' : q.open ? 'open' : 'locked', show = isNext || V.expand === q.id;
      const chip = q.complete ? 'done' : q.status === 'progress' ? q.built + ' of ' + q.total : STATUS[q.status] + (q.open ? '' : '');
      h += `<li class="st ${cls}" data-stage="${q.id}"><span class="n">${q.complete ? '✓' : i + 1}</span><span class="nm">${esc(q.name)}</span><span class="chip">${esc(chip)}${q.costUsd ? ' · ' + money(q.costUsd) : ''}</span><span class="wh">${esc(q.what)}</span>`;
      if (q.status === 'progress') h += `<span class="bar"><b style="width:${Math.round((100 * q.built) / q.total)}%"></b></span>`;
      if (show) {
        h += `<span class="why">Why${isNext ? ' it comes next' : ''}: ${esc(low(q.why))}</span>`;
        if (q.lines.length) h += '<span class="mats">' + q.lines.map((l) => `<span>${esc(plain(l.label))}${l.count > 1 ? ' × ' + l.count : ''}</span><i title="${l.sticks ? esc(num(l.qty) + ' m of lumber in stock lengths') : ''}">${l.sticks && l.sticks.length ? l.sticks.map((c) => c.pre ? c.n + ' × cut to ' + mm(c.lenM) : c.n + ' × ' + c.ft + ' ft').join(', ') : num(l.qty) + (UNIT[l.unit] || '')}</i><i>${money(l.costUsd)}</i><em>${esc(l.why)}</em>`).join('') + '</span>';
        let act = '';
        if (!q.complete && q.toOrderUsd > 0 && !isNext) act += `<button type="button" data-act="order:${q.id}">Order this stage, ${money(q.toOrderUsd)}</button>`;
        if ((q.built > 0 || q.complete) && !V.auto) act += `<button type="button" data-act="apart:${q.id}" title="The material goes back on the stacks">Take this stage apart</button>`;
        if (act) h += `<span class="act">${act}</span>`;
      }
      h += '</li>';
    });
    h += '</ol>';
    h += roomLine(pr) && !pr.done ? `<div class="cvopts">${roomLine(pr)}</div>` : '';
    { const sc = s.scaffold, high = C.LADDER.with.some((st) => st !== 'wall-frame' && pr.tally[st] && pr.tally[st][1] && !api.stageComplete(pr, st));
      if (sc) { const days = Math.max(0, (sc.until - G.sim.state.t) / 86400); h += `<div class="cvopts"><span>Scaffold: ${days < 1 ? Math.max(1, Math.round(days * 24)) + ' h' : days.toFixed(1) + ' days'} left${sc.set ? ', set up' : ', in its bundle'}</span><button type="button" data-act="rent:1" title="${esc(SCF.why)}">One more day, ${money(SCF.usdPerDay)}</button><button type="button" data-act="unrent">Send it back</button></div>`; }
      else if (high && !pr.done) h += `<div class="cvopts"><span title="${esc(SCF.why)}">Working up high?</span><button type="button" data-act="rent:${SCF.days}" title="${esc(SCF.why)}">Rent scaffolding, ${money(SCF.usdPerDay)} a day (${SCF.days} days)</button></div>`; }
    h += '<div class="cvtop"><button type="button" data-act="drop" title="Then click the ground near the building">Choose the delivery spot</button><button type="button" data-act="book">Start a new building</button></div>';
    return h + opts;
  }
  // once it is insulated, the room's temperature against outside (if the thermal system is there)
  function roomLine(pr) {
    try {
      const th = G.sim.state.sys.thermal, w = G.sim.state.sys.weather;
      if (!th || !th.rooms || !w || !api.stageSatisfied) return '';
      if (!(pr.tally.insulation && pr.tally.insulation[1] && api.stageComplete(pr, 'insulation')) && !pr.done) return '';
      const floor = B.pieces().find((p) => p.struct === pr.id && p.kind === 'floor'), room = floor && th.rooms['r:' + floor.id];
      return room && Number.isFinite(room.tempC) ? ` Inside ${room.tempC.toFixed(0)}°C, outside ${w.tempC.toFixed(0)}°C.` : '';
    } catch (err) { return ''; }
  }
  function drawPanel() {
    if (panel.hidden) return;
    const s = S(), pr = current(), pl = pr && plan(pr.id);
    const sig = [V.rev, V.book, V.expand, V.sel, Math.round(G.sim.state.sys.stock.money), s.deliveries.length, V.auto ? 1 : 0, s.unlocked.length, pl ? pl.view.built : 0].join('|');
    if (sig === V.uiSig) return;
    V.uiSig = sig;
    $('cvtitle').textContent = V.book || !pr ? 'Build' : pr.name;
    $('cvmoney').textContent = money(G.sim.state.sys.stock.money);
    const top = body.scrollTop;
    body.innerHTML = panelHtml();
    body.scrollTop = top;
  }
  function openPanel() { panel.hidden = false; $('cvb').setAttribute('aria-pressed', 'true'); if (document.pointerLockElement) document.exitPointerLock(); V.uiSig = ''; V.book = !current(); drawPanel(); }
  function closePanel() { panel.hidden = true; $('cvb').setAttribute('aria-pressed', 'false'); canvas.focus(); }
  function act(a) {
    const [k, arg] = a.split(':'), pr = current(), s = S();
    sounds.wake();
    if (k === 'book') { V.book = true; if (panel.hidden) openPanel(); V.book = true; }
    else if (k === 'back') V.book = false;
    else if (k === 'sel') { V.sel = +arg; V.book = false; }
    else if (k === 'place') startPlacing({ kind: 'plan', planId: arg, name: (B.plans().find((p) => p.id === arg) || {}).name || 'Building' });
    else if (k === 'drop') startPlacing({ kind: 'drop', name: 'Delivery spot' });
    else if (k === 'order' && pr) {
      const r = cmd('order', { structId: pr.id, stage: arg });
      if (r.ok) { say('Ordered for ' + money(r.costUsd) + '. ' + (s.options.instant ? 'It is at the delivery spot.' : 'It arrives in about an hour of game time.'), 'good'); sounds.play('seat'); }
      else say(r.reason === 'not enough money' ? 'Not enough money: that costs ' + money(r.costUsd) + '. Order one stage at a time, or sell something.' : 'Nothing to order there.', 'bad');
    } else if (k === 'auto' && pr) { startAuto(pr.id, arg, pr.level === 'guided'); closePanel(); }
    else if (k === 'rent' && pr) { const r = cmd('rentScaffold', { structId: pr.id, days: +arg }); if (r.ok) { say('Scaffolding rented for ' + money(r.costUsd) + '. The bundle is by your stacks: take it and point at a wall.', 'good'); sounds.play('seat'); } else say(r.reason === 'not enough money' ? 'Not enough money: that costs ' + money(r.costUsd) + '.' : 'Cannot rent that now.', 'bad'); }
    else if (k === 'unrent') { if (SC && SC.on()) SC.release(); cmd('returnScaffold'); say('The scaffolding goes back to the yard.', 'good'); }
    else if (k === 'stop') stopAuto();
    else if (k === 'level' && pr) { cmd('setLevel', { structId: pr.id, level: arg }); cmd('setLevel', { level: arg }); stopAuto(); }
    else if (k === 'feelp') { cmd('setFeel', { preset: arg }); }
    else if (k === 'feelr') { cmd('setFeel', { reset: true }); }
    else if (k === 'seen') cmd('seeCard', { stage: arg });
    else if (k === 'cardsoff') cmd('setOption', { key: 'cards', value: false });
    else if (k === 'apart' && pr) {
      stopAuto(); for (const [id] of V.fresh) flush(id);
      const ids = Object.keys(pr.members).filter((id) => pr.members[id].stage === arg && (pr.members[id].built || pr.members[id].got > 0));
      const r = cmd('dismantle', { structId: pr.id, memberIds: ids });
      if (r.ok) { V.fresh.get(pr.id) && V.fresh.get(pr.id).clear(); reconcile(pr.id); say('Taken apart. The material is back on the stacks.', 'good'); sounds.play('thunk'); }
      else say(r.reason === 'something stands on it' ? 'Something stands on that. Take the later stages apart first.' : 'Nothing to take apart there.', 'bad');
    }
    V.rev++; V.uiSig = ''; V.nextSig = '';
  }
  function setOpt(key, value) {
    if (key === 'mute') value = !value;
    cmd('setOption', { key, value });
    if (key === 'sandbox') { stopAuto(); B.setConstructionMode(!value); }
    V.uiSig = ''; V.nextSig = '';
  }

  // ------------------------------------------------------------------ setting a plan (or the delivery spot) down on the ground
  const ghost = new T.Group(), ghostMat = new T.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.32, depthWrite: false, fog: false }),
    ghostEdge = new T.LineBasicMaterial({ color: 0x9fe3ff, fog: false }), ray = new T.Raycaster(), ptr = { x: 0, y: 0, has: false };
  ghost.visible = false; G.scene.add(ghost);
  function startPlacing(p) {
    endPlacing();
    const pl = p.kind === 'plan' ? B.plans().find((q) => q.id === p.planId) : null, w = pl ? pl.widthM : 1.2, l = pl ? pl.lengthM : 1.2, h = pl ? 2.6 : 0.5;
    const box = new T.Mesh(new T.BoxGeometry(w, h, l), ghostMat), edges = new T.LineSegments(new T.EdgesGeometry(box.geometry), ghostEdge);
    box.position.y = edges.position.y = h / 2 + 0.3;
    ghost.add(box, edges);
    if (pl) { const door = new T.Mesh(new T.BoxGeometry(0.95, 2, 0.08), ghostEdge); door.position.set(0, 1.3, l / 2); ghost.add(door); }
    ghost.visible = true;
    V.placing = { ...p, w, l, yaw: 0, x: G.player.x, z: G.player.z, ok: false, why: '' };
    if (document.pointerLockElement) document.exitPointerLock();
    closePanel();
  }
  function endPlacing() {
    for (const c of [...ghost.children]) { ghost.remove(c); c.geometry.dispose(); }
    ghost.visible = false; V.placing = null; V.nextSig = '';
  }
  function tickPlacing() {
    const p = V.placing, P = G.player;
    if (G.keys.KeyQ && !p.qWas) p.yaw += Math.PI / 12;
    if (G.keys.KeyE && !p.eWas) p.yaw -= Math.PI / 12;
    p.qWas = !!G.keys.KeyQ; p.eWas = !!G.keys.KeyE;
    // the ground under the pointer (or a few steps ahead when the mouse is captured)
    if (ptr.has && !document.pointerLockElement) {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera({ x: ((ptr.x - r.left) / r.width) * 2 - 1, y: -((ptr.y - r.top) / r.height) * 2 + 1 }, G.camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      let t = 1, hit = false;
      for (; t < 260; t += 0.6) if (o.y + d.y * t < G.heightAt(o.x + d.x * t, o.z + d.z * t)) { hit = true; break; }
      if (hit) { let a = t - 0.6, b = t; for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (o.y + d.y * m < G.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } p.x = o.x + d.x * b; p.z = o.z + d.z * b; }
    } else { p.x = P.x + Math.sin(P.face) * 5; p.z = P.z + Math.cos(P.face) * 5; }
    let lo = 1e9, hi = -1e9;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const lx = (a * p.w) / 2, lz = (b * p.l) / 2, y = G.heightAt(p.x + lx * c + lz * s, p.z - lx * s + lz * c); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    p.why = '';
    if (lo < -0.4) p.why = 'Too wet here: choose dry ground';
    else if (p.kind === 'plan' && hi - lo > 0.75 * Math.max(p.w, p.l)) p.why = 'Too steep here: choose flatter ground';
    else if (Math.hypot(p.x - P.x, p.z - P.z) > 60) p.why = 'Too far away';
    else if (p.kind === 'plan') for (const st of V.structs.values()) if (Math.hypot(st.x - p.x, st.z - p.z) < st.r + Math.hypot(p.w, p.l) / 2 + 0.5) p.why = 'Too close to another building';
    p.ok = !p.why;
    ghost.position.set(p.x, G.heightAt(p.x, p.z), p.z); ghost.rotation.y = p.yaw;
    const col = p.ok ? 0x9fe3ff : 0xe0765f;
    if (ghostMat.color.getHex() !== col) { ghostMat.color.setHex(col); ghostEdge.color.setHex(col); }
  }
  function commitPlacing() {
    const p = V.placing;
    if (!p) return;
    if (!p.ok) { sounds.play('creak'); return; }
    if (p.kind === 'drop') { cmd('setDropPoint', { x: p.x, z: p.z }); endPlacing(); note('Delivery spot set', 'New deliveries will land here.'); return; }
    const r = B.placePlan(p.planId, p.x, p.z, p.yaw);
    endPlacing();
    if (!r) return;
    V.pendingPlan = { struct: r.struct, planId: p.planId, name: p.name };
    V.sel = r.struct; V.book = false;
    sounds.play('seat');
    V.bv = -1; sync();
    // deliveries land beside it, on the side nearest where you stand
    const st = V.structs.get(r.struct), P = G.player;
    if (st) { const side = P.x >= st.x ? 1 : -1, half = Math.max(p.w, p.l) / 2 + 1.7; cmd('setDropPoint', { x: st.x + side * half - (side < 0 ? 4.5 : 0), z: st.z - 0.4 }); }
    note(p.name + ' staked out', 'Open the Build panel (L) to order the materials.');
    openPanel();
  }

  // ------------------------------------------------------------------ small things in the world: the arrow, the delivery flag
  const arrow = new T.Mesh(new T.ConeGeometry(0.2, 0.5, 4), new T.MeshBasicMaterial({ color: 0xe2b65a, fog: false }));
  arrow.rotation.x = Math.PI; arrow.visible = false; G.scene.add(arrow);
  const flag = new T.Group();
  { const pole = new T.Mesh(new T.BoxGeometry(0.05, 1.5, 0.05), new T.MeshLambertMaterial({ color: 0x8a7350 })), cloth = new T.Mesh(new T.BoxGeometry(0.42, 0.26, 0.02), new T.MeshLambertMaterial({ color: 0xe2b65a }));
    pole.position.y = 0.75; cloth.position.set(0.23, 1.34, 0); flag.add(pole, cloth); flag.visible = false; G.scene.add(flag); }
  let bob = 0;
  function drawMarks(dt) {
    bob += dt;
    const t = V.target, P = G.player;
    arrow.visible = !!t && Math.hypot(t.x - P.x, t.z - P.z) > 2.2 && P.tool !== 'build';
    if (arrow.visible) { arrow.position.set(t.x, G.heightAt(t.x, t.z) + t.y + 0.14 * Math.sin(bob * 3.2), t.z); arrow.rotation.y = bob * 1.4; }
    const d = S().dropPoint, show = !!d && V.anyOpen && !S().options.sandbox;
    if (flag.visible !== show) flag.visible = show;
    if (show && (flag.position.x !== d.x - 0.9 || flag.position.z !== d.z - 3.3)) flag.position.set(d.x - 0.9, G.heightAt(d.x - 0.9, d.z - 3.3), d.z - 3.3);
  }

  // ------------------------------------------------------------------ every frame
  function sync() {
    if (G.sim !== V.sim) attach();
    const s = S();
    if (B.constructionMode !== !s.options.sandbox) B.setConstructionMode(!s.options.sandbox);
    if (sounds.muted !== s.options.mute) sounds.muted = s.options.mute;
    if (B.setShowLater) B.setShowLater(feel().showLater >= 0.5);
    if (B.version !== V.bv) { V.bv = B.version; if (!s.options.sandbox) syncPlans(); }
  }
  function update(dt) {
    sync();
    // pieces handed back last frame are build mode's now
    if (V.flushing.length) { for (const f of V.flushing) { const fr = freshOf(f.id); for (const id of f.ids) fr.delete(id); redraw(f.id); } V.flushing = []; }
    const s = S();
    drawStacks();
    if (V.placing) tickPlacing();
    {
      // what F would do is worked out again only when something changed or you have moved
      reach.update(!OFF[G.player.tool] && !V.placing && !s.options.sandbox && (!!s.carried || (!!V.ctx && V.ctx.kind !== 'stop')));
      const P = G.player, c = s.carried, sig = V.rev * 4 + (c ? 1 : 0) + (V.auto ? 2 : 0);
      if (sig !== V.ctxSig || Math.abs(reach.px - V.ctxPx) + Math.abs(reach.py - V.ctxPy) > 2 || Math.abs(reach.x - V.ctxRx) + Math.abs(reach.z - V.ctxRz) > 0.08 || Math.abs(P.x - V.ctxX) + Math.abs(P.z - V.ctxZ) > 0.12 || P.tool !== V.ctxTool || !!V.placing !== V.ctxPl) {
        V.ctxSig = sig; V.ctxPx = reach.px; V.ctxPy = reach.py; V.ctxRx = reach.x; V.ctxRz = reach.z; V.ctxX = P.x; V.ctxZ = P.z; V.ctxTool = P.tool; V.ctxPl = !!V.placing;
        V.ctx = context();
      }
    }
    if (V.fTap) { V.fTap = false; if (!OFF[G.player.tool]) { press(V.ctx); V.ctx = context(); V.ctxSig = -1; } }   // what the press changed is read at once: a stale 'put down' with empty arms threw
    tickBHold(dt); tickLadder(dt); tickScaffold(dt); tickRoof(dt); drawLadder(); tickMark(dt); drawBeacons(dt); drawBarrow(dt); tickStation(dt);
    if (!s.options.sandbox) tickWork(dt);
    glow(V.ctx); farGlow();
    {
      const pr = current(), flatNow = pr && !pr.done && C.STAGE[pr.stage] && C.STAGE[pr.stage].flat ? '-' : null;
      if (flatNow !== V.gstage) { V.gstage = flatNow; B.showStage(flatNow); }
      // come in closer while the hammer is going, and drift back out afterwards
      const cam = G.cam, hands = V.handT < 2.5 && !!V.ctx && V.ctx.kind === 'hands' && !(RW && RW.on()), busy = !!(W.job || V.raise || hands);
      if (V.camSet !== undefined && Math.abs(cam.dist - V.camSet) > 0.05) V.camHome = V.camSet = V.pitchHome = undefined;      // the player moved the camera: leave it be
      if (busy) { V.camIdle = 0; if (V.camHome === undefined && cam.dist > (hands ? 11.5 : 15.5)) V.camHome = cam.dist; }
      else V.camIdle = (V.camIdle || 0) + dt;
      if (V.camHome !== undefined) {
        const want = hands && !W.job && !V.raise ? 10.5 : busy || V.camIdle < 2.2 ? 15 : V.camHome;
        cam.dist += (want - cam.dist) * (1 - Math.exp(-(busy ? 2.2 : 1.4) * dt));
        V.camSet = cam.dist;
        // lower the view while a wall goes up, so that it is seen rising
        if ((V.raise && !V.raise.landed) || hands) { if (V.pitchHome === undefined && cam.pitch > 0.82) V.pitchHome = cam.pitch; }
        if (V.pitchHome !== undefined) {
          const wp = V.raise ? 0.62 : hands ? 0.78 : V.camIdle < 1.2 ? 0.62 : V.pitchHome;
          cam.pitch += (wp - cam.pitch) * (1 - Math.exp(-1.8 * dt));
          if (!V.raise && V.camIdle >= 1.2 && Math.abs(cam.pitch - V.pitchHome) < 0.01) { cam.pitch = V.pitchHome; V.pitchHome = undefined; }
        }
        if (!busy && V.camIdle >= 2.2 && Math.abs(cam.dist - V.camHome) < 0.08) { cam.dist = V.camHome; V.camHome = V.camSet = undefined; }
      }
    }
    asm.update(dt); carry.update(dt);
    updatePrompt(dt);
    V.nextT = (V.nextT || 0) + dt;
    if (V.nextRev !== V.rev || V.nextT > 0.5 || V.nextCtx !== V.ctx) { V.nextRev = V.rev; V.nextT = 0; V.nextCtx = V.ctx; drawNext(); }
    drawPanel(); drawMarks(dt);
    if (V.bannerT > 0) { V.bannerT -= dt; if (V.bannerT <= 0.5 && !banner.classList.contains('out')) banner.classList.add('out'); if (V.bannerT <= 0) banner.hidden = true; }
    if (V.sayT > 0) { V.sayT -= dt; if (V.sayT <= 0) say(''); }
    const sand = $('cvsand'), inPlan = G.player.tool === 'build';
    if (sand.hidden === inPlan) { sand.hidden = !inPlan; }
    if (inPlan) { const t = s.options.sandbox ? 'Sandbox: built at once' : 'Plans are raised by hand · Sandbox off'; if (sand.textContent !== t) sand.textContent = t; if (!nextEl.hidden) { nextEl.hidden = true; V.nextSig = ''; } }
  }
  G.stepHooks.push(update);

  // ------------------------------------------------------------------ input
  $('cvb').addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  $('cvclose').addEventListener('click', closePanel);
  $('cvsand').addEventListener('click', () => setOpt('sandbox', !S().options.sandbox));
  const onAct = (e) => { const b = e.target.closest('button[data-act]'); if (b) { act(b.dataset.act); return; } const li = e.target.closest('li.st'); if (li) { V.expand = V.expand === li.dataset.stage ? null : li.dataset.stage; V.uiSig = ''; } };
  body.addEventListener('click', onAct); nextEl.addEventListener('click', onAct);
  body.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('cvfeel')) V.feelOpen = e.target.open; }, true);
  body.addEventListener('input', (e) => { const i = e.target.closest('input[data-feel]'); if (!i) return; const r = G.sim.commandNow('construction.setFeel', { key: i.dataset.feel, value: Number(i.value) }), q = C.FEEL_SPEC.find((z) => z.key === i.dataset.feel), o = body.querySelector('[data-fv="' + i.dataset.feel + '"]'); if (o && r.ok) o.textContent = q.words ? q.words[r.feel[q.key]] : r.feel[q.key]; });
  body.addEventListener('change', (e) => { const i = e.target.closest('input[data-opt]'); if (i) setOpt(i.dataset.opt, i.checked); });
  window.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'Escape') { if (V.placing) { endPlacing(); e.stopImmediatePropagation(); } else if (!panel.hidden) closePanel(); return; }
    if (G.player.tool === 'build') return;
    if (e.code === 'KeyL') panel.hidden ? openPanel() : closePanel();
    else if (e.code === 'KeyE') { V.fTap = true; V.fSrc = 'key'; }
  }, true);
  canvas.addEventListener('pointermove', (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true; }, true);
  canvas.addEventListener('pointerdown', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true; sounds.wake();
    if (V.placing) { e.stopImmediatePropagation(); e.preventDefault(); if (e.button === 2) endPlacing(); else { tickPlacing(); commitPlacing(); } return; }
    if (e.button === 0 && V.beacons.length && !OFF[G.player.tool] && !V.auto) { const rc = canvas.getBoundingClientRect(), lk = !!document.pointerLockElement, hit = beaconAt(lk ? rc.left + rc.width / 2 : e.clientX, lk ? rc.top + rc.height / 2 : e.clientY); if (hit) { e.stopImmediatePropagation(); finishPlace(hit); return; } }
    // the left button is the hands: whatever F would do here
    if (e.button === 0 && !OFF[G.player.tool] && V.ctx && V.ctx.kind !== 'hint' && V.ctx.kind !== 'drop') { e.stopImmediatePropagation(); V.mDown = true; V.fTap = true; V.fSrc = 'click'; return; }
    const ctx = V.ctx;
    if (ctx && ctx.kind === 'piece' && !W.job && e.button === 0) {
      const r = canvas.getBoundingClientRect(), g = geom(ctx.id), pr = S().progress[ctx.id];
      const lockd = !!document.pointerLockElement, px = lockd ? r.width / 2 : e.clientX - r.left, py = lockd ? r.height / 2 : e.clientY - r.top;
      let best = null, bd = 46;
      for (const mid of ctx.q) {
        const m = g.byId.get(mid), pm = pr.members[mid];
        if (!m) continue;
        const layer = C.STAGE[pm.stage].flat && g.walls.has(pm.parent) ? pm.parent : 'main';
        asm.worldOf(ctx.id, layer, m, vTmp).project(G.camera);
        const d = Math.hypot((vTmp.x * 0.5 + 0.5) * r.width - px, (-vTmp.y * 0.5 + 0.5) * r.height - py);
        if (d < bd) { bd = d; best = mid; }
      }
      if (best) { e.stopImmediatePropagation(); beginMember(ctx.id, best, 'carried'); W.job.click = true; }
    }
  }, true);
  window.addEventListener('pointerup', () => { V.mDown = false; }, true);
  window.addEventListener('blur', () => { V.mDown = false; });
  canvas.addEventListener('pointermove', (e) => { if (V.raise && V.mDown && !V.raise.landed) V.raise.push = (V.raise.push || 0) + Math.max(0, -e.movementY) / 300; }, true);
  canvas.addEventListener('wheel', (e) => { if (!V.placing) return; e.stopImmediatePropagation(); e.preventDefault(); V.placing.yaw += (e.deltaY > 0 ? 1 : -1) * Math.PI / 12; }, { capture: true, passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (V.placing) e.preventDefault(); }, true);
  { const b = $('cvact'); const down = (e) => { e.preventDefault(); G.keys.KeyE = true; V.fTap = true; V.fSrc = 'key'; sounds.wake(); }, up = () => { G.keys.KeyE = false; };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); }

  // for tests and the console
  // for tests: the next piece the hands could work on, and where it is in the world
  function nextPiece() {
    const pr = current(); if (!pr) return null;
    const pl = plan(pr.id), g = geom(pr.id), c = S().carried;
    for (const mid of pl.inst) { const pm = pr.members[mid], ln = lineOf(pr, mid), m = g.byId.get(mid), set = !ln || pm.need - pm.got < 1e-6; if (!set && !holds(c, pr, mid)) continue; if (!m) return { mid, x: V.structs.get(pr.id).x, z: V.structs.get(pr.id).z, site: true }; const hw = C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null; worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); const w = { x: wM.x, y: wM.y, z: wM.z }; wM.project(G.camera); return { mid, ...w, sx: (wM.x * 0.5 + 0.5) * reach.w, sy: (-wM.y * 0.5 + 0.5) * reach.h, set }; }
    return null;
  }
  window.__construct = { redraw, asm, roof: RW, syncRoof, tryHop, ladderTop, ladderSpot, chalkLines: (id) => chalkLines(S().progress[id], geom(id)), scaffoldSpot, scaffold: SC, station: CS, press: (c) => press(c || V.ctx), beaconAt, finishPlace, nextPiece, reach, V, plan, geom, current, context: () => V.ctx, open: openPanel, close: closePanel, act, startPlacing, sounds, carry, asm, nextAction, flushAll: () => { for (const [id] of V.fresh) flush(id); } };
})();
