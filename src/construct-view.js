// Construction view: the Build panel, deliveries as stacks, carrying, and raising a building by hand, stage by stage.
// The truth is the simulation's construction system (src/sim/construction.js); the wording and rates are its
// content (src/sim/content/construction.js); stacks and the load in the arms are drawn by src/engine/carry.js,
// the pieces going in by src/engine/assembly.js. Build mode owns the building's shape and draws what is finished.
// Keys: L the Build panel, F pick up / put down / hold to work. Build mode keeps its own keys while it is open.
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
  const asm = window.__assembly.create(G, { geo: look.geo, mat: look.mat, colorOf: (m) => look.colors[m.col || 'timber'] || look.colors.timber });
  const sounds = window.__assembly.createSounds();
  const carry = window.__carry.create(G);
  const reach = window.__carry.createReach(G, { reach: C.WORK.reachM });
  const REACH = C.WORK.reachM;
  const V = {
    sim: null, rev: 1, bv: -1, sel: null, structs: new Map(), geom: new Map(), plans: new Map(), planVer: new Map(), fresh: new Map(), flushing: [],
    working: null, auto: null, raise: null, ctx: null, fWas: false, idleT: 0, placing: null, pendingPlan: null, book: false, expand: null, quotes: {},
    blows: {}, named: {}, cool: 0, swingIn: null, mDown: false, poseT: 0, poseKind: '',
    uiSig: '', nextSig: '', promptSig: '', glowSig: '', stackSig: '', loadSig: '', braceSig: '', cardStage: null, sayT: 0, bannerT: 0, target: null, lastLand: 0, hint: null, hintT: 0, pct: -1,
  };
  const cmd = (name, payload) => { const r = G.sim.commandNow('construction.' + name, payload || {}); V.rev++; G.markStockDirty && G.markStockDirty(); return r; };
  const freshOf = (id) => { let f = V.fresh.get(id); if (!f) V.fresh.set(id, (f = new Set())); return f; };

  // ------------------------------------------------------------------ what is being built, read once per change
  const KR = { site: 0, pier: 1, footing: 1, post: 2, beam: 3, skid: 3, stemwall: 3, slab: 4, joist: 5, plate: 6, stud: 7, header: 8, rafter: 9, sheathing: 10, membrane: 11, roofing: 12, cladding: 13, window: 14, door: 15, insulation: 16, lining: 17 };
  const TR = { rim: -0.5, end: 0, bottom: -0.2, top: -0.1, jack: 0.5, sill: 2.5, cripple: 2.7, gable: 2.6, underlayment: -1 };
  function geom(id) {
    const st = V.structs.get(id);
    if (!st) return null;
    let g = V.geom.get(id);
    if (g && g.ver === st.ver) return g;
    const mw = B.membersOf(id);
    if (!mw) return null;
    g = { ver: st.ver, byId: new Map(), matrix: mw.matrix.clone(), rank: new Map(), walls: new Map(), cx: 0, cz: 0 };
    for (const m of mw.list) g.byId.set(m.id, m);
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
      g.rank.set(m.id, C.STAGE_ORDER.indexOf(m.stage) * 1e6 + ((KR[m.kind] || 0) + (TR[m.type] || 0) + 2) * 1e4 + (m.kind === 'sheathing' || m.kind === 'stud' && m.type === 'cripple' ? my * 300 : 0) + (mx - g.cx) + 0.37 * (mz - g.cz) + 50);
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
  const usable = (pr, pl, c) => pl.inst.filter((id) => { const ln = lineOf(pr, id); return !ln || pr.members[id].need - pr.members[id].got < 1e-6 || (c && c.itemId === ln.itemId); });

  // ------------------------------------------------------------------ keeping build mode and the simulation in step
  function attach() {
    V.sim = G.sim; V.rev++; V.bv = -1; V.sel = null;
    for (const k of asm.keys()) asm.remove(k);
    V.structs.clear(); V.geom.clear(); V.plans.clear(); V.planVer.clear(); V.fresh.clear(); V.flushing = []; V.working = null; V.auto = null; V.raise = null; V.placing && endPlacing();
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
      reconcile(st.id);
    }
    for (const id of Object.keys(s.progress)) if (!V.structs.has(+id)) { cmd('forget', { structId: +id }); asm.remove(+id); V.fresh.delete(+id); }
  }
  // the simulation says what is built; build mode draws it (all but a frame still lying on the deck, and pieces just put in)
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
    // something too big for one load (siding, roofing) grows as the loads arrive
    for (const mid in pr.members) {
      const pm = pr.members[mid];
      if (pm.built || !(pm.got > 1e-6) || !(pm.need > 0)) continue;
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
      for (const mid in pr.members) { const m = pr.members[mid]; if (m.stage === st.id && m.parent === cur && g.byId.has(mid)) { if (m.built) list.push(g.byId.get(mid)); else if (m.need > 0 && m.got >= m.need - 1e-6) { list.push(g.byId.get(mid)); loose.push([cur, mid]); } } }
      if (w && w.layer === cur) list.push(w.m);
      asm.hinge(id, cur, hw.pivot, hw.axis, V.raise && V.raise.parent === cur ? V.raise.angle : hw.flat, 48);
      asm.setSolid(id, cur, list, 48);
    }
    for (const [layer, mid] of loose) asm.lift(id, layer, mid, proud(mid));
    V.glowSig = '';
    B.setShell(id, !Object.values(pr.tally).some((t) => t[0] > 0));
    braces(id);
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

  // ------------------------------------------------------------------ stacks and the load in the arms
  const COLORS = { lumber: 0xdcbc8c, boards: 0xd6b27c, osb: 0xc9a468, block: 0xb5b2aa, box: 0x8a6f4a, wrap: 0xe8ecea, felt: 0x3a3d43, shingle: 0x50555e, batt: 0xf1bcc8, door: 0x8a6240, pane: 0xa9c6d6, bag: 0xb9b4a6 };
  function describe(itemId, qty) {
    const it = CAT[itemId], f = C.itemForm(itemId), d = (it && it.dims) || {};
    const n = (per) => Math.max(1, Math.min(140, Math.ceil(qty / per - 0.02)));
    if (f === 'lumber') { const l = itemId === 'lumber_2x4' ? 2.6 : 3; return { form: 'lumber', w: Math.max(d.depthM, d.widthM), h: Math.min(d.depthM, d.widthM), l, n: n(l), color: COLORS.lumber }; }
    if (f === 'boards') return { form: 'lumber', w: 0.14, h: 0.019, l: 3, n: n(3 * 4), color: COLORS.boards, scaleH: 4 };
    if (f === 'sheet') return { form: 'sheet', w: 1.22, l: 2.44, h: Math.max(0.011, d.thicknessM || 0.011), n: n(1), color: /gypsum/.test(itemId) ? 0xd8d6cf : COLORS.osb };
    if (f === 'block') return { form: 'block', w: 0.3, l: 0.3, h: 0.2, n: n(1), color: COLORS.block };
    if (f === 'roll') return { form: 'roll', w: 0.17, l: 1.0, h: 0.17, n: n(30), color: itemId === 'housewrap' ? COLORS.wrap : COLORS.felt };
    if (f === 'bundle') return { form: 'heap', w: 0.9, l: 0.33, h: 0.09, n: n(3), color: COLORS.shingle };
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
    for (const k of s.stacks) sig += k.id + ':' + describe(k.itemId, k.qty).n + ',';
    sig += V.terrainV || 0;
    if (sig !== V.stackSig) {
      V.stackSig = sig;
      carry.setStacks(s.stacks.map((k) => { const d = describe(k.itemId, k.qty); if (d.scaleH) d.h *= d.scaleH; return { id: k.id, x: k.x, z: k.z, itemId: k.itemId, ...d }; }), (d) => {
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
  const proud = (mid) => { const sw = V.swingIn; if (sw && sw.mid === mid) return 0.045 + 0.55 * (1 - Math.min(1, sw.t / 0.2)) ** 2; const b = V.blows[mid]; return 0.045 * (1 - (b ? b.n / b.of : 0)); };
  const qTmp = new T.Quaternion(), aTmp = new T.Vector3(), wA = new T.Vector3(), wB = new T.Vector3(), wM = new T.Vector3();
  // a point of a member in the world, wherever its frame lies just now
  function worldPt(g, hw, p, out) {
    out.set(p[0], p[1], p[2]);
    if (hw) { const ang = V.raise && V.raise.hw === hw ? V.raise.angle : hw.flat; out.x -= hw.pivot[0]; out.y -= hw.pivot[1]; out.z -= hw.pivot[2]; out.applyQuaternion(qTmp.setFromAxisAngle(aTmp.set(hw.axis[0], 0, hw.axis[2]), ang)); out.x += hw.pivot[0]; out.y += hw.pivot[1]; out.z += hw.pivot[2]; }
    return out.applyMatrix4(g.matrix);
  }
  const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L > 1e-9 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L)) : 0; return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t); };
  // what the hands can do from here: every open piece within reach, and the one the pointer is on
  function aimHands(pr) {
    const pl = plan(pr.id), g = geom(pr.id), P = G.player, c = S().carried, st = V.structs.get(pr.id);
    let best = null, bs = 1e9, want = null, ws = 1e9;
    const q = [];
    for (const mid of pl.inst) {
      const pm = pr.members[mid], ln = lineOf(pr, mid), m = g.byId.get(mid);
      const set = !ln || pm.need - pm.got < 1e-6, act = pm.kind === 'site' ? 'dig' : set ? 'nail' : c && c.itemId === ln.itemId ? 'set' : 'want';
      let score;
      if (!m) { if (Math.hypot(P.x - st.x, P.z - st.z) > g.reach + 0.5) continue; score = 0; }
      else {
        const hw = C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null;
        worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB);
        if (segDist(P.x, P.z, wA, wB) > REACH) continue;
        if (reach.free) { score = 1e9; for (const t of [0.5, 0.15, 0.85]) { wM.lerpVectors(wA, wB, t).project(G.camera); score = Math.min(score, Math.hypot((wM.x * 0.5 + 0.5) * reach.w - reach.px, (-wM.y * 0.5 + 0.5) * reach.h - reach.py)); } }
        else score = segDist(reach.x, reach.z, wA, wB) * 100;
      }
      if (act === 'want') { if (score < ws) { ws = score; want = mid; } continue; }
      q.push(mid);
      // a piece already set comes first when the pointer is about as near to both: finish what is started
      if (score - (act === 'nail' ? 14 : 0) < bs) { bs = score - (act === 'nail' ? 14 : 0); best = { mid, act }; }
    }
    if (best) return { kind: 'hands', id: pr.id, act: best.act, mid: best.mid, q };
    if (want) return { kind: 'hint', text: 'Needs ' + low(plain(lineOf(pr, want).label)), id: pr.id };
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
  // one press with the hands: set the piece aimed at, or strike it once
  function handAct(ctx) {
    const pr = S().progress[ctx.id], g = geom(ctx.id), pm = pr.members[ctx.mid], m = g.byId.get(ctx.mid), P = G.player;
    const hw = m && C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null, layer = hw ? pm.parent : 'main';
    if (m) { worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); P.faceTarget = Math.atan2(wM.x - P.x, wM.z - P.z); } else wM.set(reach.x, P.y, reach.z);
    V.cool = C.WORK.swingS;
    if (ctx.act === 'set') {
      const r = cmd('install', { structId: ctx.id, memberIds: [ctx.mid], hold: true });
      if (!r.ok) { flash(reason(r)); return; }
      if (r.set.length) { V.swingIn = { mid: ctx.mid, id: ctx.id, layer, t: 0 }; sounds.play(C.WORK.sound[pm.kind] === 'scrape' ? 'scrape' : 'thunk'); V.poseT = 0.25; V.poseKind = 'lift'; G.cam.shake = Math.min(G.cam.shake + 0.025, 0.3); G.burst(wM.x, wM.y, wM.z, 3, 0xe8d9b0, 0.5, 0.5, 0.05, 0.3); }
      else { const q = r.partial[0]; sounds.play('rustle'); flash(plain(lineOf(pr, ctx.mid).label) + ': ' + Math.round((100 * q.got) / q.need) + '% there. Fetch more.'); }
      redraw(ctx.id);
      return;
    }
    // a blow (a stamp on a pier block, a stroke of the shovel on the site)
    const of = C.memberNails(pm.kind), b = V.blows[ctx.mid] || (V.blows[ctx.mid] = { n: 0, of });
    b.n++;
    V.poseT = 0.24; V.poseKind = 'hammer';
    const snd = pm.kind === 'pier' ? 'thud' : C.WORK.sound[pm.kind] === 'dig' ? 'dig' : 'knock', last = b.n >= of;
    sounds.play(last && snd === 'knock' ? 'seat' : snd, 0.94 + 0.12 * Math.random());
    if (pm.kind === 'site') G.burst(reach.x, G.heightAt(reach.x, reach.z) + 0.15, reach.z, 5, 0x6b4f35, 1.4, 2.2, 0.11, 0.6);
    else G.burst(wM.x, wM.y, wM.z, last ? 4 : 2, 0xe8d9b0, 0.6, 0.7, 0.05, 0.3);
    G.cam.shake = Math.min(G.cam.shake + (last ? 0.07 : 0.035), 0.3);
    if (G.juice) G.juice.hitStop = last ? 0.07 : 0.035;
    V.jolt = m ? { id: ctx.id, layer, mid: ctx.mid, t: 0, built: last } : null;
    if (!last) { if (m) asm.lift(ctx.id, layer, ctx.mid, proud(ctx.mid)); return; }
    delete V.blows[ctx.mid];
    const r = cmd('install', { structId: ctx.id, memberIds: [ctx.mid] });
    if (!r.ok) { flash(reason(r)); redraw(ctx.id); return; }
    finishInstall(ctx.id, ctx.mid, layer, pm.kind, r);
  }

  // ------------------------------------------------------------------ what F does here and now
  function nearBuilding(x, z) {
    let best = null, bd = 1e9;
    for (const pr of inProgress()) { const st = V.structs.get(pr.id), g = geom(pr.id), d = Math.hypot(st.x - x, st.z - z) - (g ? g.reach : st.r); if (d < REACH + 0.6 && d < bd) { bd = d; best = pr; } }
    return best;
  }
  const wantedStack = (d) => d.itemId === V.wantItem;
  const wantsHere = (pr, pl, c) => pl.inst.some((id) => { const ln = lineOf(pr, id); return ln && ln.itemId === c.itemId && pr.members[id].need - pr.members[id].got > 1e-6; });
  const pickable = (d) => !C.SITE_SUPPLY.includes(d.itemId);
  function context() {
    const P = G.player, s = S(), c = s.carried;
    if (P.tool === 'build' || P.tool === 'garden' || V.placing || s.options.sandbox) return null;
    if (V.auto) return { kind: 'stop', id: V.auto.id };
    const pr = nearBuilding(P.x, P.z), stack = carry.nearest(reach.x, reach.z, 1.0, pickable) || (V.wantItem && carry.nearest(P.x, P.z, 2.1, wantedStack)) || carry.nearest(P.x, P.z, 2.1, pickable) || carry.nearest(P.x, P.z, 1.3);
    if (pr) {
      const pl = plan(pr.id);
      if (pl) {
        if (pl.raise) return { kind: 'raise', id: pr.id, parent: pl.raise };
        const mine = usable(pr, pl, c);
        if (pr.level === 'guided' || s.options.auto) { if (pl.inst.length && !(stack && !c && pr.level !== 'guided' && !mine.length && false)) return { kind: 'auto', id: pr.id, q: pl.inst, stage: pr.members[pl.inst[0]].stage, guided: pr.level === 'guided' }; }
        else { const near = carry.nearest(reach.x, reach.z, 0.9, pickable), h = near && !(c && wantsHere(pr, pl, c)) ? null : aimHands(pr); if (h && (h.kind === 'hands' || !stack)) return h; }
      }
    }
    if (stack) {
      if (C.SITE_SUPPLY.includes(stack.itemId)) return { kind: 'hint', text: plain(CAT[stack.itemId].name) + ': used up as you build' };
      if (!c) return { kind: 'pick', stack };
      if (c.itemId === stack.itemId) { const it = CAT[c.itemId], a = api.armful(s, c.itemId, Math.max(it.unit === 'each' ? 1 : 0, C.carryLimitKg(G.sim.state.sys.stock.tools) / it.massKgPerUnit)); return a !== Infinity && a > c.qty + 1e-4 ? { kind: 'pick', stack, more: true } : { kind: 'back', stack }; }
      return { kind: 'swap', stack };
    }
    if (c) return pr ? { kind: 'hint', text: 'Nothing here needs ' + stackName(c.itemId) + ' yet', drop: true } : { kind: 'drop' };
    return null;
  }
  function homeStack(itemId) { const P = G.player; let best = null, bd = 14; for (const k of S().stacks) if (k.itemId === itemId) { const d = Math.hypot(k.x - P.x, k.z - P.z); if (d < bd) { bd = d; best = k; } } return best; }
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
  function press(ctx) {
    if (!ctx) return;
    sounds.wake();
    if (ctx.kind === 'hands') { if (!(V.cool > 0.08)) handAct(ctx); }
    else if (ctx.kind === 'pick') pickUp(ctx.stack);
    else if (ctx.kind === 'back' || ctx.kind === 'drop' || (ctx.kind === 'hint' && ctx.drop)) putDown();
    else if (ctx.kind === 'swap') { putDown(); pickUp(ctx.stack); }
    else if (ctx.kind === 'auto') startAuto(ctx.id, ctx.stage, ctx.guided);
    else if (ctx.kind === 'stop') stopAuto();
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
      const r = cmd('install', { structId: j.id, memberIds: [j.memberId], from: j.from });
      if (!r.ok) { redraw(j.id); stopAuto(); flash(reason(r)); return; }
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
  const reason = (r) => ({ 'no material': 'You need ' + (r.itemId ? stackName(r.itemId) : 'material') + ' for that', 'wrong material': 'That needs ' + (r.itemId ? stackName(r.itemId) : 'something else'), 'no fasteners': 'Out of ' + (r.itemId ? low(CAT[r.itemId].name) : 'fasteners') + ': order this stage', 'stage not open': 'Not yet: an earlier stage comes first' })[r.reason] || 'That cannot go in yet';
  function beginMember(id, memberId, from) {
    const pr = S().progress[id], g = geom(id), m = g.byId.get(memberId) || { id: memberId, kind: 'site', a: [g.cx, 0, g.cz], b: [g.cx, 0, g.cz], n: [0, 1, 0], section: { b: 0, d: 0 }, draw: 0 }, pm = pr.members[memberId], ln = lineOf(pr, memberId);
    const need = pm.need - pm.got, c = S().carried;
    const partial = from !== 'stacks' && ln && need > 1e-6 && (!c || c.qty + 1e-6 < need);
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
    if (j.kind === 'door') celebrate('doorHung');
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
    const ctx = V.ctx, held = !!G.keys.KeyF || V.mDown, s = S();
    V.cool -= dt * (C.workSpeed(G.sim.state.sys.stock.tools, G.powerAvailable && G.powerAvailable()));
    if (V.jolt) { const j = V.jolt; j.t += dt; asm.lift(j.id, j.layer, j.mid, Math.max(-0.02, (j.built ? 0 : proud(j.mid)) - 0.03 * Math.exp(-j.t * 16) * Math.cos(j.t * 46))); if (j.t > 0.28) { asm.lift(j.id, j.layer, j.mid, j.built ? 0 : proud(j.mid)); V.jolt = null; } }
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
        else if (c && c.itemId === ln.itemId) beginMember(A.id, q[0], 'carried');
        else {                                        // fetch the next armful: a short pause for the walk
          A.wait += dt;
          if (A.wait > 0.8) {
            A.wait = 0;
            if (c) putDown();
            const st = homeStack(ln.itemId) || s.stacks.find((k) => k.itemId === ln.itemId);
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
      if (held && ctx && ctx.kind === 'hands' && !V.raise && V.cool <= 0) handAct(ctx);
      if (W.job) W.cancel();
    }
    if (V.working && !V.working.partial && V.working.m.draw !== 0) asm.lift(V.working.id, V.working.layer, V.working.memberId, 0.24 * (1 - W.progress()));
    // the character's arms: a blow for each beat, both up under a wall, one up under a load
    const P = G.player, pose = V.pose || (V.pose = { kind: '', k: 0 });
    if (V.raise && !V.raise.landed) pose.kind = 'lift';
    else if (W.job) { pose.kind = 'hammer'; const ph = Math.min(1, W.t / C.WORK.beatS); pose.k = ph < 0.75 ? 0 : (ph - 0.75) * 4; }
    else if (V.poseT > 0) { V.poseT -= dt; pose.kind = V.poseKind; pose.k = Math.min(1, 1 - V.poseT / 0.24 + 0.35); }
    else pose.kind = s.carried ? 'carry' : '';
    P.work = pose.kind ? pose : null;
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
      setPrompt('F', 'Stop · ' + (V.raise ? 'raising the wall' : w ? low(w.text) : A.wait > 0 ? 'fetching more' : low(C.STAGE[A.stage].name)), v ? v.built + ' of ' + v.total : '', V.raise ? Math.min(1, V.raise.p) : W.job ? W.progress() : null);
    } else if (ctx.kind === 'raise') setPrompt('F', 'Hold and push up to raise the wall', '', V.raise ? Math.min(1, V.raise.p) : 0);
    else if (ctx.kind === 'hands') { const w = workLabel(pr, ctx.mid), b = V.blows[ctx.mid], pm = pr.members[ctx.mid], of = C.memberNails(pm.kind); setPrompt('F', ctx.act === 'set' ? 'Set it in place: ' + low(w.text).replace(/s$/, '') : ctx.act === 'dig' ? 'Dig and level' : pm.kind === 'pier' ? 'Stamp it level' : 'Nail it: ' + low(w.text).replace(/s$/, ''), ctx.act === 'set' ? w.count : (b ? b.n : 0) + ' of ' + of, ctx.act === 'set' ? null : (b ? b.n : 0) / of); }
    else if (ctx.kind === 'work') { const w = workLabel(pr, V.working ? V.working.memberId : ctx.q[0]); setPrompt('F', 'Hold to build: ' + low(w.text), w.count, W.job ? W.progress() : 0); }
    else if (ctx.kind === 'piece') setPrompt('', 'Click a glowing piece to set it', ctx.q.length + ' ready', W.job ? W.progress() : null);
    else if (ctx.kind === 'auto') setPrompt('F', (ctx.guided ? 'Build: ' : 'Work until done: ') + low(C.STAGE[ctx.stage].name), '', null);
    else if (ctx.kind === 'pick') setPrompt('F', (ctx.more ? 'Take more ' : 'Pick up ') + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'back') setPrompt('F', 'Put back the ' + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'swap') setPrompt('F', 'Swap for ' + stackName(ctx.stack.itemId), '', null);
    else if (ctx.kind === 'drop') setPrompt('F', 'Put down the ' + stackName(s.carried.itemId), '', null);
    else if (ctx.kind === 'hint') setPrompt(ctx.drop ? 'F' : '', ctx.text + (ctx.drop ? ' · put down' : ''), '', null);
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
    if (Object.values(pr.lines).every((l) => l.ordered <= 1e-9) && pl.view.toOrderUsd > 0) return { ...out, line: 'Order the materials. While they are on their way, level the ground: stand on the plan and hold <kbd>F</kbd>.', btn: ['order:all', 'Order everything, ' + money(pl.view.toOrderUsd)], target: at };
    if (V.auto && V.auto.id === pr.id) return { ...out, line: (V.auto.guided ? 'Building. ' : 'Working until it is done. ') + '<kbd>F</kbd> stops.', target: at };
    if (pl.raise) return { ...out, line: 'The frame is ready. Stand by it and hold <kbd>F</kbd> to raise the wall.', target: at };
    const first = pl.inst.find((id) => pr.members[id].stage === v.id) || pl.inst[0], ln = first ? lineOf(pr, first) : null;
    const have = (itemId) => s.stacks.some((k) => k.itemId === itemId) || (s.carried && s.carried.itemId === itemId);
    if (ln && !have(ln.itemId)) {
      if (v.pending || s.deliveries.some((d) => d.lines.some((l) => l.itemId === ln.itemId))) { const d = s.deliveries[0], mins = Math.max(1, Math.ceil((d.dueT - G.sim.state.t) / 60)); return { ...out, line: 'Your delivery arrives in about ' + mins + ' min of game time.' + (G.speed === 0 ? ' Time is paused.' : ''), wait: true }; }
      return { ...out, line: 'Order the materials for this stage.', btn: ['order:' + v.id, 'Order this stage, ' + money(v.toOrderUsd || v.costUsd)], btn2: pl.view.toOrderUsd > (v.toOrderUsd || 0) + 1 ? ['order:all', 'Order everything, ' + money(pl.view.toOrderUsd)] : null };
    }
    if (pr.level === 'guided') return { ...out, line: 'Stand by the ' + low(pr.name) + ' and press <kbd>F</kbd>, or use the button.', btn: ['auto:' + v.id, v.verb], target: at };
    if (!ln) return { ...out, line: 'Stand on the plan and hold <kbd>F</kbd> (or the mouse button) to dig it level.', target: at };
    const looseOne = pl.inst.find((id) => pr.members[id].need > 0 && pr.members[id].got >= pr.members[id].need - 1e-6);
    if (looseOne) return { ...out, line: 'A piece is set but loose. Point at it and press <kbd>F</kbd> or click to ' + (pr.members[looseOne].kind === 'pier' ? 'stamp it level' : 'nail it') + '.', target: at };
    const c = s.carried;
    if (c && c.itemId === ln.itemId) return { ...out, line: 'Carry the ' + stackName(c.itemId) + ' to the ' + low(pr.name) + '. Point at a glowing place: click sets a piece, click again nails it. Hold to keep going.', target: at };
    const stack = homeStack(ln.itemId) || s.stacks.find((k) => k.itemId === ln.itemId);
    return { ...out, line: (s.options.auto ? 'Press <kbd>F</kbd> by the ' + low(pr.name) + ' to work until done, or pick' : 'Pick') + ' up ' + stackName(ln.itemId) + ' at the stacks: point at them and click, or <kbd>F</kbd>.', target: s.options.auto ? at : stack ? { x: stack.x, z: stack.z, y: 1.9 } : null, item: ln.itemId };
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
    h += `<div class="cvopts"><span>How hands-on:</span><div class="cvseg">${[['guided', 'Guided', 'One press builds a stage while you watch'], ['hands-on', 'Hands-on', 'Carry each piece, set it in place and nail it yourself']].map((q) => `<button type="button" data-act="level:${q[0]}" aria-pressed="${pr.level === q[0] || (q[0] === 'hands-on' && pr.level === 'piece')}" title="${q[2]}">${q[1]}</button>`).join('')}</div>${pr.level === 'hands-on' ? `<label title="Press F by the building once and it keeps going, fetching from the stacks"><input type="checkbox" data-opt="auto"${s.options.auto ? ' checked' : ''}>Work until done</label>` : ''}</div>`;
    h += '<ol>';
    v.stages.forEach((q, i) => {
      const isNext = q.id === v.next, cls = q.complete ? 'done' : isNext ? 'next' : q.open ? 'open' : 'locked', show = isNext || V.expand === q.id;
      const chip = q.complete ? 'done' : q.status === 'progress' ? q.built + ' of ' + q.total : STATUS[q.status] + (q.open ? '' : '');
      h += `<li class="st ${cls}" data-stage="${q.id}"><span class="n">${q.complete ? '✓' : i + 1}</span><span class="nm">${esc(q.name)}</span><span class="chip">${esc(chip)}${q.costUsd ? ' · ' + money(q.costUsd) : ''}</span><span class="wh">${esc(q.what)}</span>`;
      if (q.status === 'progress') h += `<span class="bar"><b style="width:${Math.round((100 * q.built) / q.total)}%"></b></span>`;
      if (show) {
        h += `<span class="why">Why${isNext ? ' it comes next' : ''}: ${esc(low(q.why))}</span>`;
        if (q.lines.length) h += '<span class="mats">' + q.lines.map((l) => `<span>${esc(plain(l.label))}${l.count > 1 ? ' × ' + l.count : ''}</span><i>${num(l.qty)}${UNIT[l.unit] || ''}</i><i>${money(l.costUsd)}</i><em>${esc(l.why)}</em>`).join('') + '</span>';
        let act = '';
        if (!q.complete && q.toOrderUsd > 0 && !isNext) act += `<button type="button" data-act="order:${q.id}">Order this stage, ${money(q.toOrderUsd)}</button>`;
        if ((q.built > 0 || q.complete) && !V.auto) act += `<button type="button" data-act="apart:${q.id}" title="The material goes back on the stacks">Take this stage apart</button>`;
        if (act) h += `<span class="act">${act}</span>`;
      }
      h += '</li>';
    });
    h += '</ol>';
    h += roomLine(pr) && !pr.done ? `<div class="cvopts">${roomLine(pr)}</div>` : '';
    h += '<div class="cvtop"><button type="button" data-act="drop">Move the delivery spot</button><button type="button" data-act="book">Start a new building</button></div>';
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
    else if (k === 'stop') stopAuto();
    else if (k === 'level' && pr) { cmd('setLevel', { structId: pr.id, level: arg }); cmd('setLevel', { level: arg }); stopAuto(); }
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
      reach.update(G.player.tool !== 'build' && G.player.tool !== 'garden' && !V.placing && !s.options.sandbox && (!!s.carried || (!!V.ctx && V.ctx.kind !== 'stop')));
      const P = G.player, c = s.carried, sig = V.rev * 4 + (c ? 1 : 0) + (V.auto ? 2 : 0);
      if (sig !== V.ctxSig || Math.abs(reach.px - V.ctxPx) + Math.abs(reach.py - V.ctxPy) > 2 || Math.abs(reach.x - V.ctxRx) + Math.abs(reach.z - V.ctxRz) > 0.08 || Math.abs(P.x - V.ctxX) + Math.abs(P.z - V.ctxZ) > 0.12 || P.tool !== V.ctxTool || !!V.placing !== V.ctxPl) {
        V.ctxSig = sig; V.ctxPx = reach.px; V.ctxPy = reach.py; V.ctxRx = reach.x; V.ctxRz = reach.z; V.ctxX = P.x; V.ctxZ = P.z; V.ctxTool = P.tool; V.ctxPl = !!V.placing;
        V.ctx = context();
      }
    }
    if (V.fTap) { V.fTap = false; if (G.player.tool !== 'build') press(V.ctx); }
    if (!s.options.sandbox) tickWork(dt);
    glow(V.ctx);
    {
      const pr = current(), flatNow = pr && !pr.done && C.STAGE[pr.stage] && C.STAGE[pr.stage].flat ? '-' : null;
      if (flatNow !== V.gstage) { V.gstage = flatNow; B.showStage(flatNow); }
      // come in closer while the hammer is going, and drift back out afterwards
      const cam = G.cam, busy = !!(W.job || V.raise);
      if (V.camSet !== undefined && Math.abs(cam.dist - V.camSet) > 0.05) V.camHome = V.camSet = V.pitchHome = undefined;      // the player moved the camera: leave it be
      if (busy) { V.camIdle = 0; if (V.camHome === undefined && cam.dist > 15.5) V.camHome = cam.dist; }
      else V.camIdle = (V.camIdle || 0) + dt;
      if (V.camHome !== undefined) {
        const want = busy || V.camIdle < 2.2 ? 15 : V.camHome;
        cam.dist += (want - cam.dist) * (1 - Math.exp(-(busy ? 2.2 : 1.4) * dt));
        V.camSet = cam.dist;
        // lower the view while a wall goes up, so that it is seen rising
        if (V.raise && !V.raise.landed) { if (V.pitchHome === undefined && cam.pitch > 0.7) V.pitchHome = cam.pitch; }
        if (V.pitchHome !== undefined) {
          const wp = V.raise || V.camIdle < 1.2 ? 0.62 : V.pitchHome;
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
  body.addEventListener('change', (e) => { const i = e.target.closest('input[data-opt]'); if (i) setOpt(i.dataset.opt, i.checked); });
  window.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'Escape') { if (V.placing) { endPlacing(); e.stopImmediatePropagation(); } else if (!panel.hidden) closePanel(); return; }
    if (G.player.tool === 'build') return;
    if (e.code === 'KeyL') panel.hidden ? openPanel() : closePanel();
    else if (e.code === 'KeyF') V.fTap = true;
  }, true);
  canvas.addEventListener('pointermove', (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true; }, true);
  canvas.addEventListener('pointerdown', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true; sounds.wake();
    if (V.placing) { e.stopImmediatePropagation(); e.preventDefault(); if (e.button === 2) endPlacing(); else { tickPlacing(); commitPlacing(); } return; }
    // the left button is the hands: whatever F would do here
    if (e.button === 0 && G.player.tool !== 'build' && G.player.tool !== 'garden' && V.ctx && V.ctx.kind !== 'hint' && V.ctx.kind !== 'drop') { e.stopImmediatePropagation(); V.mDown = true; V.fTap = true; return; }
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
  { const b = $('cvact'); const down = (e) => { e.preventDefault(); G.keys.KeyF = true; V.fTap = true; sounds.wake(); }, up = () => { G.keys.KeyF = false; };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); }

  // for tests and the console
  // for tests: the next piece the hands could work on, and where it is in the world
  function nextPiece() {
    const pr = current(); if (!pr) return null;
    const pl = plan(pr.id), g = geom(pr.id), c = S().carried;
    for (const mid of pl.inst) { const pm = pr.members[mid], ln = lineOf(pr, mid), m = g.byId.get(mid), set = !ln || pm.need - pm.got < 1e-6; if (!set && !(c && c.itemId === ln.itemId)) continue; if (!m) return { mid, x: V.structs.get(pr.id).x, z: V.structs.get(pr.id).z, site: true }; const hw = C.STAGE[pm.stage].flat ? g.walls.get(pm.parent) : null; worldPt(g, hw, m.a, wA); worldPt(g, hw, m.b, wB); wM.lerpVectors(wA, wB, 0.5); const w = { x: wM.x, y: wM.y, z: wM.z }; wM.project(G.camera); return { mid, ...w, sx: (wM.x * 0.5 + 0.5) * reach.w, sy: (-wM.y * 0.5 + 0.5) * reach.h, set }; }
    return null;
  }
  window.__construct = { nextPiece, reach, V, plan, geom, current, context: () => V.ctx, open: openPanel, close: closePanel, act, startPlacing, sounds, carry, asm, nextAction, flushAll: () => { for (const [id] of V.fresh) flush(id); } };
})();
