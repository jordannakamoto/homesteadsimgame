// Interior trim as a finish carpenter puts it up, headless: casing round every door and window on the room's side, stool and
// apron under windows (or a picture frame), baseboard round the walls stopping at the door casing, shoe and crown in the
// Colonial style, a caulk-and-paint pass per room; every piece a real item; and the trim stage put up in the trade's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/flooring.js';
import '../src/trim.js';
import '../src/framing.js';
import { ITEMS } from '../src/sim/items.js';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';

const F = globalThis.__framing, TR = globalThis.__trim;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
// a 4.8 x 3.6 m room, walls 2.4 m high: a 0.9 m door in the east wall, a 0.9 x 1.2 m window (sill 0.9 m) in the south wall
const WALLS = [
  { a: [0, 0], b: [4.8, 0], half: 0.1, h: 2.4, gaps: [], opens: [{ s0: 1.95, s1: 2.85, sill: 0.9, height: 1.2, kind: 'window' }] },
  { a: [4.8, 0], b: [4.8, 3.6], half: 0.1, h: 2.4, gaps: [{ s0: 1.2, s1: 2.1, door: true }], opens: [{ s0: 1.2, s1: 2.1, sill: 0, height: 2.03, kind: 'door' }] },
  { a: [4.8, 3.6], b: [0, 3.6], half: 0.1, h: 2.4, gaps: [], opens: [] },
  { a: [0, 3.6], b: [0, 0], half: 0.1, h: 2.4, gaps: [], opens: [] },
];
const room = (style, mat = 'planks', lining = 'gypsum') => F.generate({ found: 'pier-blocks', spec: { trim: style, lining }, floors: [{ id: 'f', outline: [[0, 0], [4.8, 0], [4.8, 3.6], [0, 3.6]], y0: 0, ground: true, mat }], walls: [], edges: WALLS }).filter((m) => m.stage === 'trim');
const of = (l, k) => l.filter((m) => m.kind === k);
const low = (m) => Math.min(m.a[1], m.b[1]), high = (m) => Math.max(m.a[1], m.b[1]);

test('no lining, no trim; trim "none" or unknown, no trim', () => {
  assert.equal(room('craftsman', 'planks', null).length, 0);
  assert.equal(room(null).length, 0);
  assert.equal(room('baroque').length, 0);
});

test('Craftsman: flat legs under a wider head with a cap, a stool and apron at the window, baseboard but no shoe or crown', () => {
  const l = room('craftsman'), cas = of(l, 'casing');
  const legs = cas.filter((m) => m.type === 'leg'), heads = cas.filter((m) => m.type === 'head'), caps = cas.filter((m) => m.type === 'cap');
  assert.equal(legs.length, 4); assert.equal(heads.length, 2); assert.equal(caps.length, 2);
  assert.equal(of(l, 'stool').length, 1); assert.equal(of(l, 'apron').length, 1);
  assert.equal(of(l, 'shoe').length, 0); assert.equal(of(l, 'crown').length, 0);
  // the door's head sits on its legs and runs past them by its ears
  const door = heads.find((m) => m.a[0] > 4);
  const dl = legs.filter((m) => m.a[0] > 4), span = Math.abs(door.a[2] - door.b[2]), outer = Math.abs(dl[0].a[2] - dl[1].a[2]) + 0.089;
  assert.ok(near(span, outer + 2 * 0.013, 1e-6), span + ' ' + outer);
  assert.ok(near(low(door) - door.section.d / 2, high(dl[0]), 1e-6));
  // on the room's side of the wall: in from the wall's face (0.1 off its line)
  assert.ok(legs.every((m) => (m.a[0] > 4 ? m.a[0] < 4.7 : m.a[2] > 0.1)));
});

test('Colonial: mitred frames, shoe along the baseboard on a hard floor (not on carpet), crown at the ceiling', () => {
  const l = room('colonial'), legs = of(l, 'casing').filter((m) => m.type === 'leg'), heads = of(l, 'casing').filter((m) => m.type === 'head');
  assert.equal(of(l, 'casing').filter((m) => m.type === 'cap').length, 0);
  // a mitred head is as wide as the legs and runs between them; the legs run up to its top
  for (const h of heads) assert.ok(near(h.section.d, 0.057) && legs.filter((g) => near(high(g), high(h) + h.section.d / 2, 1e-6)).length === 2, 'mitred head ' + h.id);
  assert.ok(of(l, 'shoe').length > 0 && of(l, 'crown').length > 0);
  assert.ok(of(l, 'crown').every((m) => near(high(m) + m.section.d / 2, 2.4 - 0.002, 1e-6)));
  assert.equal(of(room('colonial', 'carpet'), 'shoe').length, 0);
});

test('Modern: a picture frame round the window, no stool or apron', () => {
  const l = room('modern');
  assert.equal(of(l, 'stool').length + of(l, 'apron').length, 0);
  assert.equal(of(l, 'casing').filter((m) => m.type === 'sill').length, 1);
});

test('baseboard runs round the walls, stops at the door casing, stands on the finished floor, and splices past 4.8 m', () => {
  for (const [style, cw] of [['craftsman', 0.089], ['colonial', 0.057], ['farmhouse', 0.14]]) {
    const base = of(room(style), 'baseboard'), run = base.reduce((s, m) => s + m.length, 0);
    assert.ok(near(run, 2 * (4.6 + 3.4) - (0.9 + 2 * (0.006 + cw)) - 0.016, 0.02), style + ' ' + run);
    // pine boards on rosin paper: the floor's top is 0.12 + 0.0008 + 0.003 + 0.019
    const foot = low(base[0]) - base[0].section.d / 2;
    assert.ok(near(foot, 0.12 + 0.0008 + 0.003 + 0.019, 1e-6), style + ' foot ' + foot);
  }
  // tile on cement board stands higher
  const t = of(room('colonial', 'tile'), 'baseboard')[0];
  assert.ok(near(low(t) - t.section.d / 2, 0.12 + 0.0127 + 0.004 + 0.012, 1e-6));
});

test('every piece is cut from stock on the mitre saw, nailed with no heads on show, and finished in one pass per room', () => {
  const l = room('colonial');
  for (const m of l.filter((q) => q.kind !== 'paint')) {
    assert.ok(m.cut >= m.cutTo && m.pts.length >= 1, m.id);
    assert.ok(m.col === 'trPrimed' && m.paintCol === 'trWhite');
  }
  const p = of(l, 'paint');
  assert.equal(p.length, 1);
  assert.ok(p[0].draw === 0 && p[0].pts.length >= 6 && p[0].pts.length <= 16);
});

test('the shopping list: real priced items in their own units, brad nails used up as you go, the finish by the litre', () => {
  for (const style of Object.keys(TR.TRIMS)) {
    const lines = F.materialsList(room(style));
    for (const ln of lines) {
      assert.equal(ln.stage, 'trim');
      assert.ok(ln.itemId && ITEMS[ln.itemId], style + ': ' + JSON.stringify(ln));
      assert.equal(ln.unit, ITEMS[ln.itemId].unit, style + ' ' + ln.itemId);
      assert.ok(ln.qty > 0 && ln.label && ln.why);
    }
    assert.ok(lines.find((l) => l.itemId === 'nails_brad'), style);
    assert.ok(lines.find((l) => l.itemId === 'trim_paint' && l.unit === 'L'), style);
  }
});

test('the trim stage follows the floor and goes up in the trade\'s order', () => {
  const sim = createGameSim(5), members = room('colonial');
  const pieces = members.map((m) => ({ id: m.id, struct: 1, stage: m.stage, parent: m.parent, kind: m.kind, length: m.length, area: m.area, built: false }));
  sim.state.sys.stock.money = 50000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(1, pieces, F.materialsList(members), { name: 'Room', x: 2.4, z: 1.8, r: 3 })).ok);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.order', { structId: 1, stage: 'all' }).ok);
  const P = sim.state.sys.construction.progress[1], ids = (k) => Object.keys(P.members).filter((id) => P.members[id].kind === k);
  const go = (list) => sim.commandNow('construction.install', { structId: 1, memberIds: list, from: 'stacks' });
  assert.deepEqual(C.STAGE.trim.needs, ['flooring']);
  assert.equal(go(ids('casing').slice(0, 1)).missing, 'stool');
  assert.equal(go(ids('baseboard').slice(0, 1)).missing, 'casing');
  assert.ok(!go(ids('paint')).ok);
  for (let g = 0; g < 30 && !K.stageComplete(P, 'trim'); g++) { const q = K.installable(P); assert.ok(q.length); assert.ok(go(q).ok); }
  assert.ok(K.stageComplete(P, 'trim') && P.done);
  assert.equal(C.LEARN.says.trimwork, 'fit trim');
});

test('priced from pieces as the page hands them over (only the fields build mode keeps), every line still has its item', () => {
  // build mode passes a member on as these fields only (structPieces, MEMBER_EXTRA in src/build.js)
  const KEEP = ['id', 'kind', 'type', 'material', 'stage', 'parent', 'section', 'length', 'area', 'thickness', 'volume', 'size', 'plies', 'roof', 'opening', 'height', 'kg'];
  const asPage = (list) => list.map((m) => Object.fromEntries(KEEP.filter((k) => m[k] !== undefined).map((k) => [k, m[k]])));
  for (const style of Object.keys(TR.TRIMS)) for (const ln of F.materialsList(asPage(room(style)))) assert.ok(ln.itemId && ITEMS[ln.itemId] && !ln.missing, style + ' ' + JSON.stringify(ln));
  for (const mat of Object.keys(globalThis.__flooring.FLOORINGS)) {
    const lines = F.materialsList(asPage(room(null, mat)).concat(asPage(F.generate({ found: 'pier-blocks', spec: {}, floors: [{ id: 'g', outline: [[0, 0], [4.8, 0], [4.8, 3.6], [0, 3.6]], y0: 0, ground: true, mat }], walls: [], edges: WALLS }).filter((m) => m.stage === 'flooring'))));
    for (const ln of lines) assert.ok(ln.itemId && ITEMS[ln.itemId] && !ln.missing, mat + ' ' + JSON.stringify(ln));
    const g = lines.find((l) => l.itemId === 'grout_sanded');
    if (g) assert.ok(g.qty > 2, 'grout by weight survives: ' + g.qty);
  }
});
