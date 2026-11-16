import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_TYPES, OPENING_BY_ID, LEGACY_OPEN, mapLegacy, roughOpening, headerSpec, openingItems, OPERATION } from '../src/sim/content/openings.js';

test('the catalog has every window and door type, with sizes, operation and prices', () => {
  const ids = OPENING_TYPES.map((t) => t.id);
  for (const id of ['picture', 'double_hung', 'slider', 'casement', 'awning', 'transom', 'arched', 'clerestory', 'door_single', 'door_french', 'door_patio', 'door_dutch', 'door_barn', 'door_pocket', 'door_bifold', 'door_garage']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of OPENING_TYPES) {
    assert.ok(t.w.length >= 1 && t.w.length <= 4 && t.h.length >= 1 && t.h.length <= 4, t.id);
    assert.ok(OPERATION[t.op] && t.price > 0 && t.mass > 0 && t.store, t.id);
    assert.ok(t.kind === 'door' ? t.sill === 0 : t.sill > 0.3, t.id);
  }
  assert.equal(OPENING_BY_ID.door_pocket.frame, 'pocket');
  assert.equal(OPENING_BY_ID.door_garage.frame, 'beam');
  assert.ok(OPENING_BY_ID.door_barn.surface);
});

test('old module shapes map to catalog types', () => {
  for (const k in LEGACY_OPEN) assert.ok(OPENING_BY_ID[mapLegacy(k).type], k);
  assert.equal(mapLegacy('nope'), null);
});

test('header table: sized by span, engineered beyond 3 m with doubled jacks', () => {
  assert.deepEqual([0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.8, 3.0].map((s) => headerSpec(s).size), ['2x6', '2x6', '2x8', '2x8', '2x10', '2x10', '2x12', '2x12']);
  const b = headerSpec(3.2);
  assert.ok(b.engineered && b.jacks === 2);
});

test('rough opening is the unit plus a gap; doors sit on the floor', () => {
  const r = roughOpening('door_patio', 2.44, 2.03);
  assert.ok(Math.abs(r.width - 2.464) < 1e-9 && r.sill < 0.05 && r.height > 2.05);
  assert.ok(roughOpening('casement', 0.9, 1.2, 0.9).sill < 0.9);
});

test('every size is a store item', () => {
  const items = openingItems();
  assert.ok(items.op_door_patio_2440x2030.priceUsd > 700);
  assert.ok(Object.keys(items).length > 60);
});

import '../src/framing.js';
import { HEADER_TABLE } from '../src/sim/content/openings.js';
const F = globalThis.__framing;
const frame = (op) => { const out = []; F.wallMembers(out, { id: 'w', a: [0, 0], b: [6, 0], y0: 0, h: 2.84, out: 0, mat: 'timber', openings: [op] }, { studs: 0.4 }); return out; };
const of = (out, k, t) => out.filter((m) => m.kind === k && (!t || m.type === t));

test('framing agrees with the catalog header table', () => {
  for (const r of HEADER_TABLE) { const out = frame({ id: 'o', kind: 'window', offset: 2, width: r.upTo - 0.02, sill: 0.9, height: 1 }); assert.equal(of(out, 'header')[0].size, r.size); }
});

test('a 2.4 m patio door: kings, jacks to the head, a 2x12 header, no plate in the doorway', () => {
  const out = frame({ id: 'o', kind: 'door', offset: 1.5, width: 2.464, sill: 0.02, height: 2.06 });
  const hd = of(out, 'header')[0];
  assert.equal(hd.size, '2x12'); assert.equal(hd.plies, 2);
  assert.equal(of(out, 'stud', 'king').length, 2); assert.equal(of(out, 'stud', 'jack').length, 2);
  assert.ok(of(out, 'stud', 'jack').every((m) => Math.abs(m.b[1] - hd.a[1] + hd.section.d / 2) < 1e-6));
  assert.ok(of(out, 'stud', 'cripple').every((m) => m.a[1] > hd.a[1]));
  assert.equal(of(out, 'plate', 'sill').length, 0);
  assert.ok(of(out, 'plate', 'bottom').every((m) => Math.max(m.a[0], m.b[0]) <= 1.5 + 1e-6 || Math.min(m.a[0], m.b[0]) >= 3.964 - 1e-6));
});

test('a window with sill and cripples; a garage door gets the engineered beam and doubled jacks', () => {
  const w = frame({ id: 'o', kind: 'window', offset: 2, width: 1.2, sill: 0.9, height: 1.2 });
  assert.equal(of(w, 'plate', 'sill').length, 1);
  assert.ok(of(w, 'stud', 'cripple').some((m) => m.b[1] <= 0.9) && of(w, 'stud', 'cripple').some((m) => m.a[1] >= 2.1));
  const g = frame({ id: 'o', kind: 'door', offset: 1.5, width: 2.46, sill: 0.02, height: 2.1, frame: 'beam' });
  assert.equal(of(g, 'header')[0].size, 'glulam'); assert.equal(of(g, 'stud', 'jack').length, 4);
});

test('a pocket door frames a pocket beside it', () => {
  const p = frame({ id: 'o', kind: 'door', offset: 1, width: 0.84, sill: 0.02, height: 2.06, frame: 'pocket' });
  const hd = of(p, 'header')[0];
  assert.ok(hd.span > 1.6);
  assert.ok(of(p, 'stud', 'pocket').length >= 1);
});

// ---- free openings (docs/FRAMING.md phase 1 step 2)
import '../src/framing.js';
import { freeSpec, freeToFraming, snapFree, openingSizes } from '../src/sim/content/openings.js';

test('a run with two free windows and a patio door frames kings, jacks and headers by span', () => {
  const F = globalThis.__framing;
  const free = [
    { id: 'a', typeId: 'double_hung', sizeIdx: 1, offset: 0.6, sill: 0.85 },
    { id: 'b', typeId: 'picture', sizeIdx: 3, offset: 2.4, sill: 0.75 },
    { id: 'c', typeId: 'door_patio', sizeIdx: 0, offset: 5.0 },
  ].map((f) => ({ f, sp: freeSpec(f) }));
  assert.equal(openingSizes('double_hung').length, 6);
  const out = [];
  F.wallMembers(out, { id: 'w', a: [0, 0], b: [8, 0], y0: 0, h: 2.84, out: 1, mat: 'timber', openings: free.map(({ f }) => freeToFraming(f, f.offset)) }, { studs: 0.4, ins: null, lining: 'boards' });
  const of = (k, t) => out.filter((m) => m.kind === k && (!t || m.type === t));
  assert.equal(of('stud', 'king').length, 6);
  assert.equal(of('stud', 'jack').length, 6);
  const heads = of('header').sort((p, q) => p.a[0] - q.a[0]);
  assert.equal(heads.length, 3);
  assert.deepEqual(heads.map((h) => h.size), ['2x6', '2x8', '2x10']);   // 0.924 m, 1.224 m and 1.854 m rough widths
  assert.ok(heads[2].length > 1.83);
  // the wall stays standing between: studs exist between the openings
  assert.ok(of('stud', 'stud').some((m) => m.a[0] > 1.6 && m.a[0] < 2.3));
});

test('snapping: wall centre, centre between neighbours, equal spacing, head line; red near an end or an overlap', () => {
  const w = 0.9, h = 1.2;
  let r = snapFree({ L: 6, at: 3.1, w, h, sill: 0.9 });
  assert.equal(r.snap, 'Wall centre'); assert.ok(Math.abs(r.centre - 3) < 1e-9 && r.ok);
  const o = (c, ww = 0.9) => ({ a: c - ww / 2 - 0.012, b: c + ww / 2 + 0.012, sill: 0.9, head: 2.1 });
  r = snapFree({ L: 10, at: 4.4, w, h, sill: 0.9, others: [o(2), o(7)] });
  assert.equal(r.snap, 'Centre between'); assert.ok(Math.abs(r.centre - 4.5) < 1e-9);
  r = snapFree({ L: 14, at: 6.1, w, h, sill: 0.9, others: [o(2), o(4)] });
  assert.equal(r.snap, 'Equal spacing'); assert.ok(Math.abs(r.centre - 6) < 1e-9);
  r = snapFree({ L: 12, at: 9, w, h: 1.1, sill: 0.95, others: [o(2)] });
  assert.ok(Math.abs(r.sill + 1.1 - 2.1) < 1e-9 && r.guides.some((g) => g.y === 2.1));
  r = snapFree({ L: 6, at: 0.3, w, h, sill: 0.9, snap: false });
  assert.ok(!r.ok && /end of the wall/.test(r.reason));
  r = snapFree({ L: 6, at: 2.5, w, h, sill: 0.9, others: [o(2)], snap: false });
  assert.ok(!r.ok && /Overlaps|beside/.test(r.reason));
});

test('free openings save and load as plain data', () => {
  const f = { id: 'p9', typeId: 'door_pocket', sizeIdx: 1, d: 0, line: 4, pos: 2.35, sill: 0, flip: true };
  const back = JSON.parse(JSON.stringify([f]))[0];
  assert.deepEqual(back, f);
  const sp = freeSpec(back);
  assert.equal(sp.type.frame, 'pocket');
  assert.equal(freeToFraming(back, 1).frame, 'pocket');
  assert.ok(Math.abs(freeToFraming(back, 1).width - (0.81 + 0.024)) < 1e-9);
});

// ---- item 2: the units are in the store, in the plan's orders, and operable in the sim
import { ITEMS, ITEM_CATEGORIES } from '../src/sim/items.js';
import { createGameSim } from '../src/sim/index.js';

test('units are Supplier items by category Doors and Windows, and plan orders list them', () => {
  assert.ok(ITEM_CATEGORIES.some((c) => c.id === 'doors') && ITEM_CATEGORIES.some((c) => c.id === 'windows'));
  assert.equal(ITEMS.op_door_patio_1830x2030.category, 'doors');
  assert.equal(ITEMS.op_double_hung_600x1500.category, 'windows');
  const F = globalThis.__framing, sp = freeSpec({ typeId: 'door_patio', sizeIdx: 0 });
  const lines = F.materialsList([{ id: 'x1', stage: 'openings', kind: 'door', unit: sp.itemId, unitName: 'Sliding patio door', built: false }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].itemId, 'op_door_patio_1830x2030'); assert.equal(lines[0].qty, 1); assert.equal(lines[0].unit, 'each');
});

test('the hands open and close a unit and the sim keeps it', () => {
  const sim = createGameSim(7);
  assert.equal(sim.commandNow('construction.operate', { id: 'p5' }).open, true);
  assert.equal(sim.state.sys.construction.open.p5, 1);
  assert.equal(sim.commandNow('construction.operate', { id: 'p5' }).open, false);
  sim.commandNow('construction.operate', { id: 'p6', open: true });
  assert.deepEqual(Object.keys(sim.state.sys.construction.open), ['p6']);
  assert.equal(sim.commandNow('construction.operate', {}).ok, false);
});
