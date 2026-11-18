// Finished floors as installers lay them, headless: what goes under, rows from the start wall with staggered joints and a
// ripped last row, tile set out from the middle, carpet on pad inside tack strip, baseboard and thresholds; every piece
// bought as a real item; and a whole floor laid through the simulation in the order the trade does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/flooring.js';
import '../src/framing.js';
import { ITEMS } from '../src/sim/items.js';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';

const FL = globalThis.__flooring, F = globalThis.__framing;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
// a 4.8 x 3.6 m room on joists, walls all round (drawn 0.2 m thick), a 0.9 m door in the east wall
const WALLS = [
  { a: [0, 0], b: [4.8, 0], half: 0.1, gaps: [] },
  { a: [4.8, 0], b: [4.8, 3.6], half: 0.1, gaps: [{ s0: 1.2, s1: 2.1, door: true }] },
  { a: [4.8, 3.6], b: [0, 3.6], half: 0.1, gaps: [] },
  { a: [0, 3.6], b: [0, 0], half: 0.1, gaps: [] },
];
function room(mat, found = 'pier-blocks') {
  return F.generate({ found, spec: {}, floors: [{ id: 'f', outline: [[0, 0], [4.8, 0], [4.8, 3.6], [0, 3.6]], y0: 0, ground: true, mat }], walls: [], edges: WALLS })
    .filter((m) => m.stage === 'flooring');
}
const of = (list, kind) => list.filter((m) => m.kind === kind);
const ext = (m, i) => [Math.min(m.a[i], m.b[i]), Math.max(m.a[i], m.b[i])];

test('the room stops at the faces of its walls', () => {
  const { room: R, edges } = FL.roomOf([[0, 0], [4.8, 0], [4.8, 3.6], [0, 3.6]], WALLS);
  const xs = R.map((p) => p[0]), zs = R.map((p) => p[1]);
  assert.ok(near(Math.min(...xs), 0.1) && near(Math.max(...xs), 4.7) && near(Math.min(...zs), 0.1) && near(Math.max(...zs), 3.5), JSON.stringify(R));
  assert.ok(edges.every((e) => e.walled));
  const east = edges.find((e) => near(e.p[0], 4.7) && near(e.q[0], 4.7));
  assert.equal(east.gaps.length, 1);
  assert.ok(near(east.gaps[0].s1 - east.gaps[0].s0, 0.9) && east.gaps[0].door);
  // an open side (a porch edge) is not drawn in
  const open = FL.roomOf([[0, 0], [2, 0], [2, 2], [0, 2]], WALLS.slice(0, 1));
  assert.ok(near(Math.min(...open.room.map((p) => p[1])), 0.1) && near(Math.max(...open.room.map((p) => p[1])), 2));
});

test('nailed oak strip: rosin paper, then rows from the start wall with a gap at every wall, staggered joints, the last row ripped', () => {
  const list = room('hardwood'), boards = of(list, 'plank'), paper = of(list, 'underlay');
  assert.ok(paper.length >= 4 && paper.every((m) => m.type === 'rosin' && m.roll && m.course));
  assert.ok(boards.length > 100 && boards.every((m) => m.type === 'nail' && m.course && m.pts.length >= 1));
  // boards run along the long side (x, across the joists), 12 mm off every wall face
  const x0 = Math.min(...boards.map((m) => ext(m, 0)[0])), x1 = Math.max(...boards.map((m) => ext(m, 0)[1]));
  assert.ok(near(x0, 0.112, 1e-6) && near(x1, 4.688, 1e-6), x0 + ' ' + x1);
  const rows = new Map();
  for (const m of boards) (rows.get(m.row) || rows.set(m.row, []).get(m.row)).push(m);
  const n = rows.size, w0 = rows.get(0)[0].section.d, wl = rows.get(n - 1)[0].section.d;
  // 3.376 m across in 83 mm boards: 41 rows, the last ripped to what is left; never a sliver at either wall
  assert.equal(n, 41);
  assert.ok(wl >= 0.4 * 0.083 - 0.002 && w0 >= 0.4 * 0.083 - 0.002 && wl < 0.083 - 0.002, w0 + ' ' + wl);
  // a room that would leave a sliver shares it between the first and last rows
  const rs = FL.rowsOf(0, 0.083 * 10 + 0.01, 0.083);
  assert.ok(near(rs[0][1] - rs[0][0], rs[rs.length - 1][1] - rs[rs.length - 1][0]) && rs[0][1] - rs[0][0] > 0.04);
  // every row is whole along the room; no end piece under 20 cm; joints at least 15 cm from those of the row before
  let prev = null;
  for (let r = 0; r < n; r++) {
    const row = rows.get(r).sort((p, q) => p.a[0] - q.a[0]);
    assert.ok(near(row.reduce((s, m) => s + m.length, 0), 4.576, 1e-6), 'row ' + r);
    assert.ok(row.every((m) => m.length >= 0.2 - 1e-9), 'row ' + r + ' has a short end');
    const joints = row.slice(0, -1).map((m) => Math.max(m.a[0], m.b[0]));
    if (prev) for (const j of joints) assert.ok(prev.every((p) => Math.abs(p - j) >= 0.15 - 1e-6), 'row ' + r + ' joint at ' + j);
    prev = joints;
  }
  // a row's cut-off starts the next one
  assert.ok(boards.some((m) => m.from === 'offcut'));
  // the first row is face-nailed by the wall as well as through its tongue
  assert.ok(rows.get(0)[0].pts.length > rows.get(1)[0].pts.length);
});

test('floating floors: foam under laminate and engineered, nothing under vinyl with its own pad; boards tapped, not nailed', () => {
  for (const [mat, under] of [['laminate', 'foam'], ['engineered', 'foam'], ['lvp', null]]) {
    const list = room(mat);
    assert.equal(of(list, 'underlay').length > 0, !!under, mat);
    if (under) assert.ok(of(list, 'underlay').every((m) => m.type === under));
    assert.ok(of(list, 'plank').every((m) => m.type === 'click' && m.pts.length <= 2), mat);
  }
  // on a slab a nailed floor gets a vapour barrier, not rosin paper
  assert.ok(of(room('hardwood', 'slab'), 'underlay').every((m) => m.type === 'poly'));
});

test('tile: cement board on a wood subfloor (none on a slab), laid out from the middle so the cuts at both walls match, then grout', () => {
  const list = room('tile'), tiles = of(list, 'tile'), backer = of(list, 'backer'), grout = of(list, 'grout');
  assert.ok(backer.length >= 6 && backer.every((m) => near(m.section.b, 0.0127)));
  assert.equal(of(room('tile', 'slab'), 'backer').length, 0);
  // the cut tiles at the west and east walls are the same width, and so are those at north and south
  const xs = tiles.map((m) => ext(m, 0)), lo = Math.min(...xs.map((x) => x[0])), hi = Math.max(...xs.map((x) => x[1]));
  const west = xs.filter((x) => near(x[0], lo, 1e-6)).map((x) => x[1] - x[0]), east = xs.filter((x) => near(x[1], hi, 1e-6)).map((x) => x[1] - x[0]);
  assert.ok(near(west[0], east[0], 1e-6) && west[0] >= 0.3 / 4, west[0] + ' ' + east[0]);
  assert.ok(tiles.some((m) => m.cut) && tiles.some((m) => !m.cut));
  // 6 mm joints between neighbours in a row
  const row0 = tiles.filter((m) => m.row === 0).sort((p, q) => p.a[0] - q.a[0]);
  for (let i = 1; i < row0.length; i++) assert.ok(near(ext(row0[i], 0)[0] - ext(row0[i - 1], 0)[1], 0.006, 1e-6));
  // one grout strip per row, sitting just under the tile faces
  assert.equal(grout.length, new Set(tiles.map((m) => m.row)).size);
  const top = (m) => Math.max(m.a[1], m.b[1]) + m.section.b / 2;
  assert.ok(grout.every((g) => top(g) < top(tiles[0]) && top(g) > top(tiles[0]) - 0.003));
  // big porcelain: fewer, larger tiles and tighter joints
  assert.ok(of(room('porcelain'), 'tile').length < tiles.length / 3);
});

test('carpet: tack strip round the walls (not across the door), pad inside it, carpet kicked tight along the walls', () => {
  const list = room('carpet'), tack = of(list, 'tackstrip'), pad = of(list, 'pad'), cp = of(list, 'carpet');
  assert.ok(tack.length >= 8 && tack.every((m) => m.length <= 1.22 + 1e-6));
  const east = tack.filter((m) => near(m.a[0], m.b[0], 1e-6) && m.a[0] > 4);
  assert.ok(east.every((m) => { const [z0, z1] = ext(m, 2); return z1 <= 1.21 || z0 >= 2.09; }), 'no tack strip across the doorway');
  assert.ok(pad.length >= 2 && pad.every((m) => m.roll));
  // 3.4 m across: one width of a 12 ft roll covers it, no seam
  assert.equal(cp.length, 1);
  assert.ok(cp[0].roll && cp[0].kicks && cp[0].pts.length >= 8);
});

test('every floor gets a threshold under its door (the baseboard is trim: test/trim.test.mjs)', () => {
  for (const mat of ['planks', 'hardwood', 'lvp', 'tile', 'carpet']) {
    const list = room(mat);
    assert.equal(of(list, 'threshold').length, 1, mat);
    assert.equal(of(list, 'baseboard').length, 0, mat);
  }
  // a bare subfloor is the floor (the tool shed): nothing goes down
  assert.equal(room('subfloor').length, 0);
  // stone and turf stay one piece, now in the flooring stage
  const flags = room('flags');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, 'paving');
});

test('the shopping list: every flooring line is a real, priced item in its own unit, with a tenth extra for cuts', () => {
  for (const mat of Object.keys(FL.FLOORINGS)) {
    const list = room(mat), lines = F.materialsList(list);
    for (const ln of lines) {
      assert.equal(ln.stage, 'flooring');
      assert.ok(ln.itemId && ITEMS[ln.itemId], mat + ': ' + JSON.stringify(ln));
      assert.equal(ln.unit, ITEMS[ln.itemId].unit, mat + ' ' + ln.itemId);
      assert.ok(ln.qty > 0 && ln.label && ln.why);
    }
    const fin = lines.find((l) => /^flooring\|(fl|tile|carpet)/.test(l.key));
    const area = list.filter((m) => m.kind === 'plank' || m.kind === 'tile').reduce((s, m) => s + m.area, 0);
    if (fin && fin.unit === 'm2' && area) assert.ok(fin.qty >= area * 1.1 - 0.1, mat);
  }
  const tile = F.materialsList(room('tile'));
  assert.ok(tile.find((l) => l.itemId === 'thinset_mortar' && l.qty > 50));
  const backer = tile.find((l) => l.itemId === 'backer_board');
  assert.ok(backer && backer.unit === 'each' && backer.qty >= Math.ceil(4.6 * 3.4 / (0.915 * 1.525)));
  assert.ok(F.materialsList(room('hardwood')).find((l) => l.itemId === 'nails_floor'));
});

// ---- the whole floor through the simulation
function start(mat) {
  const sim = createGameSim(5), members = room(mat);
  const pieces = members.map((m) => ({ id: m.id, struct: 1, stage: m.stage, parent: m.parent, kind: m.kind, length: m.length, area: m.area, built: false }));
  sim.state.sys.stock.money = 50000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(1, pieces, F.materialsList(members), { name: 'Room', x: 2.4, z: 1.8, r: 3 })).ok);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.order', { structId: 1, stage: 'all' }).ok);
  return { sim, P: sim.state.sys.construction.progress[1], members };
}
const install = (sim, ids) => sim.commandNow('construction.install', { structId: 1, memberIds: ids, from: 'stacks' });
const ids = (P, kind) => Object.keys(P.members).filter((id) => P.members[id].kind === kind);

test('laid in the trade\'s order: nothing goes down before what it lies on, and the stage finishes', () => {
  for (const mat of ['hardwood', 'tile', 'carpet']) {
    const { sim, P } = start(mat);
    assert.equal(C.STAGE.flooring.needs.join(), 'lining,openings');
    const first = { hardwood: 'plank', tile: 'tile', carpet: 'pad' }[mat], under = { hardwood: 'underlay', tile: 'backer', carpet: 'tackstrip' }[mat];
    const r = install(sim, ids(P, first).slice(0, 1));
    assert.ok(!r.ok && r.reason === 'support missing' && r.missing === under, mat + ' ' + JSON.stringify(r.refused));
    assert.ok(!install(sim, ids(P, 'baseboard').slice(0, 1)).ok, 'baseboard waits for the floor');
    // in the order the hands would: what is installable now, again and again
    for (let guard = 0; guard < 50 && !K.stageComplete(P, 'flooring'); guard++) {
      const q = K.installable(P);
      assert.ok(q.length, mat + ': stuck with ' + Object.keys(P.members).filter((id) => !P.members[id].built).length + ' left');
      const out = install(sim, q);
      assert.ok(out.ok, mat + ': ' + out.reason);
    }
    assert.ok(K.stageComplete(P, 'flooring') && P.done, mat);
    // what was bought is all accounted for: stacks, used, spent
    for (const [itemId, L] of Object.entries(sim.state.sys.construction.ledger)) assert.ok(L.bought + 1e-6 >= L.used, itemId);
  }
});

test('learning a floor: after a couple of boards by hand, the rest are laid as you sweep along the row', () => {
  const { sim, P } = start('laminate');
  install(sim, ids(P, 'underlay'));
  const b = ids(P, 'plank');
  for (const id of b.slice(0, 2)) {
    assert.ok(sim.commandNow('construction.install', { structId: 1, memberIds: [id], from: 'stacks', hold: true }).ok);
    assert.ok(sim.commandNow('construction.install', { structId: 1, memberIds: [id], from: 'stacks', hand: true }).ok);
  }
  assert.ok(sim.state.sys.construction.learn.known.floorboard);
  assert.equal(C.LEARN.says.floorboard, 'lay a floor');
});

test('changing a laid floor to another in the plan makes it a new floor to order and lay, what was spent ordered again', () => {
  const { sim, P } = start('hardwood');
  for (let g = 0; g < 50 && !K.stageComplete(P, 'flooring'); g++) install(sim, K.installable(P));
  assert.ok(K.stageComplete(P, 'flooring'));
  const lvp = room('lvp'), pieces = lvp.map((m) => ({ id: m.id, struct: 1, stage: m.stage, parent: m.parent, kind: m.kind, length: m.length, area: m.area, built: false }));
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(1, pieces, F.materialsList(lvp), { name: 'Room', x: 2.4, z: 1.8, r: 3 })).ok);
  const Q = sim.state.sys.construction.progress[1], q = K.quoteStage(Q, 'flooring');
  // the threshold line keeps its key from the oak floor: its oak was spent under the old floor, so it is ordered again
  assert.ok(q.ok && q.costUsd > 0 && q.keys.some((k) => /\|thresh$/.test(k)) && q.keys.some((k) => /floor_lvp|fllvp/.test(k)), JSON.stringify(q.keys));
  assert.ok(sim.commandNow('construction.order', { structId: 1, stage: 'flooring' }).ok);
  for (let g = 0; g < 50 && !K.stageComplete(Q, 'flooring'); g++) { const out = install(sim, K.installable(Q)); assert.ok(out.ok, out.reason + ' ' + (out.itemId || '')); }
  assert.ok(K.stageComplete(Q, 'flooring'));
});
