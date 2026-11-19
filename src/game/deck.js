/* Decks (slice B-2, DECK1): a deck drawn in build mode, framed and decked by hand in construction.
   - The Deck tool (build mode's bar): click one corner, then the opposite one. Drawn against an outside wall of a building
     with a framed floor, it bolts to that house (a ledger through the sheathing into the rim); anywhere else it stands on
     its own posts as a structure of its own. The rectangle glows green when it passes the structure check, amber when it
     passes with a warning (springy joists, high enough to need a rail), red when it is refused; the options strip says why.
     Height, joist size (auto picks the smallest that spans it) and boards (treated pine or cedar) are on the strip.
   - Select picks a deck (click it): the strip becomes its inspector (the same settings, and Delete). Delete key works too.
   - Members (src/sim/content/deck.js deckMembers, registered with window.__framing as kind 'deck'): footings, poured piers,
     6x6 posts and a doubled beam in the foundation stage (so the foundation system makes the pier job itself: holes,
     tubes, brackets), the ledger, joists every 400 mm in hangers and the rim in 'deck-frame', boards in 'decking', each a
     course (row) laid from the house out; a click or sweep lays as many rows as the gesture setting says.
   - The deck is a piece { kind: 'floor', type: 'deck', outline } (rooms ignore it), walkable row by row as its boards go on.
   Data: S.ext.deck = [{ id, poly, dir, height, attach, joist, board }] (see the content file). Owns no truth. */
import * as D from '../sim/content/deck.js';

(() => {
  const FR = globalThis.__framing;
  if (!FR) return;
  FR.register('deck', (out, el, desc, h) => { D.deckMembers(out, el, h); });
  const W = globalThis.window, B = W && W.__build, XP = globalThis.__buildExt;
  const extend = B ? B.extend : XP && XP.extend;
  if (!extend) return;
  const G = W && W.__game, TOOL = 'deck-tool', FLOOR_T = FR.FLOOR_T;
  const decks = (h) => (Array.isArray(h.data) ? h.data.filter((d) => d && D.isRect(d.poly)) : []);
  const lite = new Map();     // per deck piece id: the plan's frame and where the boards start (cheap reads for ground and pick)
  const liteOf = (S, pid, d) => { let q = lite.get(pid); if (!q || q.v !== S.ver || q.d !== d) lite.set(pid, (q = { v: S.ver, d, f: D.frameOf(d), tL: d.attach ? D.DECK.sheathFace : 0 })); return q; };

  // ---- rows of boards that are down, per deck piece (read again whenever build mode's version moves)
  let rowsV = -1;
  const rowsDone = new Map();
  function rowsOf(S, pid) {
    if (!B) return null;
    if (rowsV !== B.version) (rowsDone.clear(), (rowsV = B.version));
    let r = rowsDone.get(pid);
    if (r) return r;
    const mw = B.membersOf(S.id), rows = new Map();
    for (const m of (mw && mw.list) || []) if (m.parent === pid && m.kind === 'decking') { const ok = !mw.planned.has(m.id); rows.set(m.row, rows.has(m.row) ? rows.get(m.row) && ok : ok); }
    rowsDone.set(pid, (r = rows));
    return r;
  }

  extend({
    id: 'deck',
    describe(S, desc, h) {
      for (const d of decks(h)) {
        const wall = d.attach ? (desc.walls || []).find((w) => w.id === d.attach && w.out) : null;
        desc.extras.push({ kind: 'deck', ...d, id: h.pid(d.id), attached: !!wall, found: desc.found, groundY: h.groundY || (() => 0) });
      }
    },
    pieces(S, out, h) {
      for (const d of decks(h)) {
        const f = D.frameOf(d), c = d.poly.map((p) => h.W2(p[0], p[1]));
        out.push({ ...h.head(h.pid(d.id), 'floor', 'deck', d.board === 'cedar' ? 'cedar' : 'pine'), name: 'Deck', a: c[0], b: c[2], y0: h.y0 + d.height - D.DECK.board.t, y1: h.y0 + d.height, outline: c, area: Math.round(f.W * f.D * 1000) / 1000, thickness: D.DECK.board.t, width: f.W, depth: f.D });
      }
    },
    bounds: (S, h) => decks(h).flatMap((d) => d.poly),
    // the boards are walked on row by row as they go down (everything at once outside construction)
    ground(S, lx, lz, y, h) {
      let g = null;
      for (const d of decks(h)) {
        const pid = h.pid(d.id), q = liteOf(S, pid, d), row = D.rowAt(d, { frame: q.f, tL: q.tL }, lx, lz);
        if (row < 0) continue;
        const rows = rowsOf(S, pid), ok = !rows || !rows.size || rows.get(Math.min(row, Math.max(...rows.keys())));
        if (ok && (g === null || d.height > g)) g = d.height;
      }
      return g;
    },
    pick(S, R, h) {
      let best = null;
      for (const d of decks(h)) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const p of d.poly) ((x0 = Math.min(x0, p[0])), (x1 = Math.max(x1, p[0])), (z0 = Math.min(z0, p[1])), (z1 = Math.max(z1, p[1])));
        const t = h.hitBox(R, x0, d.height - 0.35, z0, x1, d.height + 0.03, z1);
        if (t >= 0 && (!best || t < best.t)) best = { t, key: S.id + ':' + d.id, id: h.pid(d.id) };
      }
      return best;
    },
    remove(key) {
      const k = keyOf(key);
      if (!k) return false;
      const rest = (B.getExt(k.S.id, 'deck') || []).filter((d) => d.id !== k.d.id);
      B.setExt(k.S.id, 'deck', rest.length ? rest : null);
      toast('Deck removed', 'info');
      return true;
    },
    inspector(g, G_, key) {
      const k = keyOf(key);
      if (!k) return void g.push(G_.info('Deck', 'Gone'));
      const pl = planFor(k.S, k.d);
      g.push(G_.info('Deck', size(k.d) + ' · ' + verdict(pl)));
      controls(g, G_, 'sel-', k.d, k.S);
      g.push(G_.act('x:' + TOOL + ':sel-del', 'Delete', 'bin', 'Del', true));
    },
    tools: [{
      id: TOOL, name: 'Deck', title: 'Draw a deck: against an outside wall it bolts to the house, anywhere else it stands on posts',
      hint: 'Click a corner of the deck, then the opposite corner. Against an outside wall it bolts to the house.',
      icon: '<path d="M3 15h18M3 11h18M5 15v5M19 15v5M12 15v5"/><path d="M3 11l3-4h12l3 4"/>',
      options(g, G_) {
        g.push(G_.info('Deck', T.a ? T.readout || 'Click the opposite corner' : 'Click the first corner. Draw it against an outside wall to bolt it to the house; anywhere else it stands on its own posts.'));
        controls(g, G_, '', null, null);
      },
      choose,
      hover,
      down,
    }],
  });
  if (!B || !G || !W.document) return;

  // ---------------------------------------------------------------- the tool
  const T3 = G.THREE, T = { a: null, readout: '', cand: null, opt: { free: 0.6, drop: 0, joist: 'auto', board: 'pt' } };
  const JOISTS = ['auto', ...D.JOIST_SIZES];
  const toast = (text, tone) => W.__ui && W.__ui.toast ? W.__ui.toast(text, { tone, seconds: tone === 'bad' ? 5 : 3 }) : null;
  const structOf = (id) => B.state.structs.find((S) => S.id === id) || null;
  function keyOf(key) {
    const [sid, did] = String(key || '').split(':').map(Number), S = structOf(sid), d = S && (B.getExt(sid, 'deck') || []).find((q) => q.id === did);
    return d ? { S, d } : null;
  }
  const size = (d) => { const f = D.frameOf(d); return f.W.toFixed(1) + ' x ' + f.D.toFixed(1) + ' m'; };
  const groundIn = (F, y0) => (x, z) => { const [wx, wz] = B.toWorld(F, x, z); return G.heightAt(wx, wz) - y0; };
  const planFor = (S, d) => D.planDeck(d, { attached: !!d.attach && wallsOf(S).some((w) => w.id === d.attach), found: S.found, groundY: groundIn(S, S.y0) });
  function verdict(pl) {
    if (!pl.frame) return pl.errors[0] || '';
    const sp = pl.joist + ' joists span ' + pl.span.toFixed(2) + ' of ' + pl.maxSpan.toFixed(2) + ' m';
    return pl.errors.length ? pl.errors[0] : sp + (pl.attached ? ' · bolted to the house' : ' · on its own posts') + (pl.warns.length ? ' · ' + pl.warns[0] : '');
  }
  // height, joists and boards: for the next deck (pre '') or the selected one (pre 'sel-')
  function controls(g, G_, pre, d, S) {
    const id = (k) => 'x:' + TOOL + ':' + pre + k;
    const hTxt = d ? (d.height - ((S && Math.min(...d.poly.map(([x, z]) => groundIn(S, S.y0)(x, z)))) || 0)).toFixed(2) + ' m up' : (T.cand && T.cand.attach ? (T.opt.drop ? '-' + Math.round(T.opt.drop * 1000) + ' mm' : 'at the floor') : T.opt.free.toFixed(2) + ' m up');
    g.push(G_.step(id('height'), 'Height', hTxt));
    g.push(G_.chips(id('joist'), 'Joists', JOISTS.map((v) => ({ v, name: v === 'auto' ? 'Auto' : v })), d ? d.joist || 'auto' : T.opt.joist));
    g.push(G_.chips(id('board'), 'Boards', [{ v: 'pt', name: 'Treated' }, { v: 'cedar', name: 'Cedar' }], d ? d.board || 'pt' : T.opt.board));
  }
  function choose(key, v) {
    if (key.startsWith('sel-')) return chooseSel(key.slice(4), v);
    if (key === 'height') { if (T.cand && T.cand.attach) T.opt.drop = Math.max(0, Math.min(0.3, T.opt.drop - v * 0.025)); else T.opt.free = Math.max(0.3, Math.min(3, Math.round((T.opt.free + v * 0.05) * 100) / 100)); }
    else if (key === 'joist' && JOISTS.includes(v)) T.opt.joist = v;
    else if (key === 'board' && (v === 'pt' || v === 'cedar')) T.opt.board = v;
    T.last && hover(T.last);
    XP.touch();
  }
  function chooseSel(key, v) {
    const s = XP.selected(), k = s && keyOf(s.key);
    if (!k) return;
    if (key === 'del') return void (XP.remove());
    const d = { ...k.d };
    if (key === 'height') d.height = Math.round((d.height + v * (d.attach ? 0.025 : 0.05)) * 1000) / 1000;
    else if (key === 'joist' && JOISTS.includes(v)) d.joist = v;
    else if (key === 'board' && (v === 'pt' || v === 'cedar')) d.board = v;
    else return;
    if (d.attach && d.height > FLOOR_T - D.DECK.board.t + 1e-6) return void toast('A deck bolted to the house sits at or below its floor: water must not run in under the door.', 'warn');
    const pl = planFor(k.S, d);
    if (!pl.ok) return void toast(pl.errors[0], 'bad');
    B.setExt(k.S.id, 'deck', (B.getExt(k.S.id, 'deck') || []).map((q) => (q.id === d.id ? d : q)));
  }

  // the outside walls of a building, in its own metres: { id, a, b } (grid and angled walls alike)
  function wallsOf(S) {
    const out = [];
    for (const p of B.pieces()) if (p.struct === S.id && p.kind === 'wall' && p.type !== 'rail' && p.type !== 'gable' && !p.parent && p.a && p.b) out.push({ id: p.id, a: B.toLocal(S, p.a.x, p.a.z), b: B.toLocal(S, p.b.x, p.b.z) });
    return out;
  }
  const floorsOf = (S) => B.pieces().filter((p) => p.struct === S.id && p.kind === 'floor' && p.type !== 'deck' && Array.isArray(p.outline)).map((p) => p.outline.map((q) => B.toLocal(S, q.x, q.z)));
  const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] > z !== P[j][1] > z && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  const snap = (v) => Math.round(v * 10) / 10;
  // the deck the two corners make: in the first corner's frame (its building's grid, or the new grid there)
  function candidate(h) {
    const a = T.a, F = a.F, [wx, wz] = B.toWorld(h.F, h.lx, h.lz), [bx, bz] = B.toLocal(F, wx, wz);
    let x0 = Math.min(a.lx, snap(bx)), x1 = Math.max(a.lx, snap(bx)), z0 = Math.min(a.lz, snap(bz)), z1 = Math.max(a.lz, snap(bz));
    let attach = null, dir = x1 - x0 >= z1 - z0 ? 0 : 1, inside = false;
    const S = a.S;
    if (S) {
      const floors = floorsOf(S), on = (x, z) => floors.some((P) => pip(P, x, z));
      inside = on((x0 + x1) / 2, (z0 + z1) / 2);
      // an edge of the rectangle on an outside wall's line (within 35 cm, along at least half of it), the deck on its open side
      let bestD = 0.35;
      for (const w of wallsOf(S)) {
        const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-3, alongZ = Math.abs(w.a[0] - w.b[0]) < 1e-3;
        if (!alongX && !alongZ) continue;
        const line = alongX ? w.a[1] : w.a[0], lo = Math.min(alongX ? w.a[0] : w.a[1], alongX ? w.b[0] : w.b[1]), hi = Math.max(alongX ? w.a[0] : w.a[1], alongX ? w.b[0] : w.b[1]);
        const e0 = alongX ? x0 : z0, e1 = alongX ? x1 : z1, over = Math.min(hi, e1) - Math.max(lo, e0);
        if (over < 0.5 * (e1 - e0) - 1e-6) continue;
        for (const side of [0, 1]) {
          const ec = alongX ? (side ? z1 : z0) : side ? x1 : x0, dd = Math.abs(ec - line);
          if (dd >= bestD) continue;
          const mid = (Math.max(lo, e0) + Math.min(hi, e1)) / 2, out = side ? -0.3 : 0.3;   // the deck lies away from the edge on this side
          if (alongX ? on(mid, line + out) : on(line + out, mid)) continue;
          bestD = dd; attach = { id: w.id, alongX, side, line };
        }
      }
      if (attach) {
        if (attach.alongX) attach.side ? (z1 = attach.line) : (z0 = attach.line);
        else attach.side ? (x1 = attach.line) : (x0 = attach.line);
        dir = attach.alongX ? (attach.side ? 2 : 0) : attach.side ? 1 : 3;
      }
    }
    const poly = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map((p) => p.map((v) => Math.round(v * 1000) / 1000));
    const y0 = attach ? S.y0 : G.heightAt(...B.toWorld(F, (x0 + x1) / 2, (z0 + z1) / 2));
    const d = { id: 0, poly, dir, height: attach ? Math.round((FLOOR_T - D.DECK.board.t - T.opt.drop) * 1000) / 1000 : T.opt.free, attach: attach ? attach.id : null, joist: T.opt.joist, board: T.opt.board };
    const pl = D.planDeck(d, { attached: !!attach, found: S ? S.found : null, groundY: groundIn(F, y0) });
    if (inside && !attach) (pl.errors.unshift('That is inside the building: a deck goes outside the walls.'), (pl.ok = false));
    return { d, pl, F, y0, S, attach };
  }

  // ---- the glowing rectangle while drawing
  const prev = new T3.Group(), fillMat = new T3.MeshBasicMaterial({ color: 0x7fd18b, transparent: true, opacity: 0.28, depthWrite: false }), lineMat = new T3.LineBasicMaterial({ color: 0x7fd18b });
  const fill = new T3.Mesh(new T3.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fillMat), edge = new T3.LineLoop(new T3.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => new T3.Vector3(x, 0, z))), lineMat);
  prev.add(fill, edge);
  prev.visible = false;
  fill.renderOrder = edge.renderOrder = 18;
  G.scene.add(prev);
  function show(c) {
    const [x0, z0] = c.d.poly[0], [x1, z1] = c.d.poly[2], [wx, wz] = B.toWorld(c.F, (x0 + x1) / 2, (z0 + z1) / 2);
    prev.position.set(wx, c.y0 + c.d.height + 0.02, wz);
    prev.rotation.y = c.F.yaw || 0;
    prev.scale.set(Math.max(0.1, x1 - x0), 1, Math.max(0.1, z1 - z0));
    const hue = !c.pl.ok ? 0xe06666 : c.pl.warns.length ? 0xf2c14e : 0x7fd18b;
    fillMat.color.setHex(hue); lineMat.color.setHex(hue);
    prev.visible = true;
  }
  function hover(h) {
    T.last = h;
    if (!T.a) {
      // a small square where the first corner would go
      const F = h.F, x = snap(h.lx), z = snap(h.lz), [wx, wz] = B.toWorld(F, x, z);
      prev.position.set(wx, (F.isNew ? G.heightAt(wx, wz) : F.y0 + FLOOR_T) + 0.03, wz); prev.rotation.y = F.yaw || 0; prev.scale.set(0.3, 1, 0.3);
      fillMat.color.setHex(0xffffff); lineMat.color.setHex(0xffffff); prev.visible = true;
      return;
    }
    const c = (T.cand = candidate(h)), text = size(c.d) + ' · ' + verdict(c.pl);
    show(c);
    if (text !== T.readout) ((T.readout = text), XP.touch());
  }
  function down(h) {
    if (!T.a) {
      const F = h.F.isNew ? { ox: h.F.ox, oz: h.F.oz, yaw: h.F.yaw, y0: h.F.y0, isNew: true } : h.F;
      T.a = { F, S: h.F.isNew ? null : h.F, lx: snap(h.lx), lz: snap(h.lz) };
      T.readout = '';
      return hover(h);
    }
    const c = candidate(h);
    if (Math.hypot(c.d.poly[2][0] - c.d.poly[0][0], c.d.poly[2][1] - c.d.poly[0][1]) < 0.2) return void ((T.a = null), (T.readout = ''), XP.touch());   // the same corner again: start over
    if (!c.pl.ok) return void toast(c.pl.errors[0], 'bad');
    if (c.attach) {
      const list = B.getExt(c.S.id, 'deck') || [];
      c.d.id = list.reduce((m, q) => Math.max(m, q.id + 1), 1);
      B.setExt(c.S.id, 'deck', [...list, c.d]);
    } else {
      c.d.id = 1;
      B.extCreate({ ox: c.F.ox, oz: c.F.oz, yaw: c.F.yaw || 0, y0: c.y0 }, 'deck', [c.d]);
    }
    toast('Deck drawn: ' + size(c.d) + ', ' + c.pl.joist + ' joists ' + (c.attach ? 'on a ledger bolted to the house' : 'on posts and beams'), 'good');
    c.pl.warns.length && toast(c.pl.warns[0], 'warn');
    T.a = null; T.readout = ''; T.cand = null; prev.visible = false;
    XP.touch();
  }
  // the rectangle goes when the tool is put down (two reads a frame)
  G.stepHooks.push(() => { if (prev.visible && (B.state.tool !== TOOL || !B.state.on)) ((prev.visible = false), (T.a = null)); });
  W.__deck = { plan: D.planDeck, content: D, candidate: (h) => (T.a ? candidate(h) : null), state: T };
})();
