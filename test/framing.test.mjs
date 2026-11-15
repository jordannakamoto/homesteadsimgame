// The construction generator, headless: real members with real sizes, spacings, stages and a shopping list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import { ITEMS } from '../src/sim/items.js';
const F = globalThis.__framing;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('a 5 m stick-framed wall with a window: plates, studs at 0.4 m, kings, jacks, a header and a sill', () => {
  const out = [];
  F.wallMembers(out, { id: 'w', a: [0, 0], b: [5, 0], y0: 0, h: 2.84, out: 1, mat: 'timber', openings: [{ id: 'o', kind: 'window', offset: 2.1, width: 0.8, sill: 1.11, height: 0.78 }] }, { studs: 0.4, ins: 'fibreglass_batt', lining: 'boards' });
  const of = (k, t) => out.filter((m) => m.kind === k && (!t || m.type === t));
  assert.equal(of('plate', 'bottom').length, 1); assert.equal(of('plate', 'top').length, 1); assert.equal(of('plate', 'cap').length, 1); assert.equal(of('plate', 'sill').length, 1);
  assert.ok(of('plate').every((m) => near(m.section.b, 0.038) && near(m.section.d, 0.089)));
  assert.ok(near(of('plate', 'top')[0].length, 5) && of('plate', 'cap')[0].stage === 'top-plates');
  // common studs every 0.4 m from the start, except where the window is: 0.4 .. 4.8 is 12 places, 2.0, 2.4 and 2.8 fall in the opening
  const xs = of('stud', 'stud').map((m) => m.a[0]).sort((a, b) => a - b);
  assert.deepEqual(xs.map((x) => Math.round(x * 10) / 10), [0.4, 0.8, 1.2, 1.6, 3.2, 3.6, 4.0, 4.4, 4.8]);
  assert.ok(of('stud').every((m) => near(m.section.b, 0.038) && near(m.section.d, 0.089) && m.stage === 'wall-frame' && m.parent === 'w'));
  assert.ok(near(of('stud', 'stud')[0].length, 2.84 - 0.12 - 3 * 0.038));
  assert.equal(of('stud', 'end').length, 2); assert.equal(of('stud', 'corner').length, 2);
  assert.equal(of('stud', 'king').length, 2); assert.equal(of('stud', 'jack').length, 2);
  assert.equal(of('stud', 'cripple').length, 4);      // 2.4 and 2.8 m, above the header and under the sill
  const hd = of('header')[0];
  assert.ok(hd && hd.size === '2x6' && near(hd.section.d, 0.14) && near(hd.section.b, 0.076) && near(hd.length, 0.8 + 0.076));
  assert.ok(near(of('stud', 'jack')[0].b[1], 1.89));     // jacks stop under the header
  // sheets, wrap and boards outside; batts in every bay; boards inside
  const sh = of('sheathing');
  assert.ok(sh.length >= 5 && sh.every((m) => m.stage === 'sheathing' && near(m.section.b, 0.011)));
  assert.equal(of('membrane').length, 1); assert.equal(of('cladding').length, 1); assert.equal(of('lining').length, 1);
  const batts = of('insulation');
  assert.ok(batts.length >= 10 && batts.every((m) => m.material === 'fibreglass_batt' && near(m.thickness, 0.089) && m.area > 0));
  assert.ok(batts.every((m) => m.section.d <= 0.45));
  assert.equal(new Set(out.map((m) => m.id)).size, out.length);
  assert.ok(out.every((m) => F.STAGES.includes(m.stage)));
});

test('a 2.4 x 3.0 m shed floor on pier blocks: six blocks, two beams, joists at 0.4 m, subfloor', () => {
  const out = [];
  F.floorMembers(out, { id: 'f', outline: [[0, 0], [2.4, 0], [2.4, 3], [0, 3]], y0: 0, ground: true, mat: 'planks' }, 'pier-blocks', {});
  const of = (k, t) => out.filter((m) => m.kind === k && (!t || m.type === t));
  assert.equal(of('pier', 'block').length, 6);
  assert.equal(of('beam', 'girder').length, 2);
  assert.ok(of('beam').every((m) => near(m.length, 3) && near(m.section.b, 0.14)));
  const j = of('joist').filter((m) => m.type !== 'rim');
  assert.equal(of('joist', 'rim').length, 2); assert.equal(j.length, 9);
  assert.ok(j.every((m) => near(m.section.d, 0.184) && near(m.length, 2.4 - 0.076)));
  const zs = j.map((m) => m.a[2]).sort((a, b) => a - b);
  for (let k = 2; k < zs.length - 1; k++) assert.ok(near(zs[k] - zs[k - 1], 0.4, 1e-9));
  assert.ok(near(of('sheathing', 'subfloor').reduce((a, m) => a + m.area, 0), 7.2, 1e-3));
  assert.equal(of('site').length, 1);
  for (const t of ['skids', 'piers', 'stemwall', 'slab']) {
    const o = []; F.floorMembers(o, { id: 'f', outline: [[0, 0], [4, 0], [4, 5], [0, 5]], y0: 0, ground: true }, t, {});
    assert.ok(o.some((m) => m.stage === 'foundation'), t);
    assert.equal(o.some((m) => m.kind === 'joist'), t !== 'slab', t);
  }
});

test('a gable roof: a ridge, rafters in pairs at 0.6 m, a deck, underlayment and roofing', () => {
  const out = [], half = 2, rise = 1.7, ov = 0.45, run = half + ov, eave = 2.84 - (rise / half) * ov;
  const plane = (id, side) => ({ id, pts: [[-ov, 2 + side * run], [5 + ov, 2 + side * run], [5 + ov, 2], [-ov, 2]], eaveY: eave, ridgeY: 2.84 + rise, run, facing: [0, side] });
  F.roofMembers(out, { id: 'r', mat: 'slate', planes: [plane('r.0', -1), plane('r.1', 1)], ridges: [{ a: [-ov, 2], b: [5 + ov, 2], y: 2.84 + rise }], ties: [] }, {});
  const raf = out.filter((m) => m.kind === 'rafter');
  assert.equal(raf.length % 2, 0); assert.ok(raf.length >= 20);
  const common = raf.filter((m) => m.parent === 'r.0' && m.type === 'common').map((m) => m.a[0]).sort((a, b) => a - b);
  for (let k = 2; k < common.length - 1; k++) assert.ok(near(common[k] - common[k - 1], 0.6, 1e-9));
  assert.ok(raf.every((m) => near(m.section.b, 0.038) && near(m.section.d, 0.14) && near(m.length, Math.hypot(run, rise + (rise / half) * ov), 1e-3)));
  assert.equal(out.filter((m) => m.kind === 'beam' && m.type === 'ridge').length, 1);
  assert.ok(out.some((m) => m.kind === 'membrane' && m.stage === 'roofing') && out.some((m) => m.kind === 'roofing' && m.material === 'slate'));
  const deck = out.filter((m) => m.type === 'roof-deck').reduce((a, m) => a + m.area, 0), cover = out.filter((m) => m.kind === 'roofing').reduce((a, m) => a + m.area, 0);
  assert.ok(near(deck, cover, 0.01));
});

test('the shopping list: buyable units, real item ids, a plain reason on every line', () => {
  const m = F.generate({ found: 'pier-blocks', spec: { ins: 'fibreglass_batt', lining: 'boards' }, floors: [{ id: 'f', outline: [[0, 0], [2.4, 0], [2.4, 3], [0, 3]], y0: 0, ground: true }],
    walls: [{ id: 'w', a: [0, 0], b: [2.4, 0], y0: 0, h: 2.84, out: 1, openings: [] }] });
  const list = F.materialsList(m);
  assert.ok(list.length >= 8);
  for (const ln of list) {
    assert.ok(F.STAGES.includes(ln.stage) && ln.label && ln.why && ln.qty > 0 && ln.unit, JSON.stringify(ln));
    if (ln.itemId) assert.ok(ITEMS[ln.itemId], 'no such item: ' + ln.itemId); else assert.ok(ln.missing, 'a line with no item says what is missing');
    if (ln.itemId) assert.equal(ln.unit, ITEMS[ln.itemId].unit);
  }
  const studs = list.find((l) => l.label.startsWith('Studs'));
  assert.ok(studs && studs.itemId === 'lumber_2x4' && studs.unit === 'm');
  assert.equal(list.find((l) => l.label === 'Pier blocks').qty, 6);
  assert.deepEqual(list.map((l) => F.STAGES.indexOf(l.stage)), list.map((l) => F.STAGES.indexOf(l.stage)).sort((a, b) => a - b));
});
