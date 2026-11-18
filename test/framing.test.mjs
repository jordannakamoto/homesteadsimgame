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
  // 5 m is longer than the longest 2x4 (4.8 m, 16 ft): each plate is two pieces butted over a stud, and the cap plate's
  // joint is 1.2 m from the top plate's, so the two lap
  assert.equal(of('plate', 'bottom').length, 2); assert.equal(of('plate', 'top').length, 2); assert.equal(of('plate', 'cap').length, 2); assert.equal(of('plate', 'sill').length, 1);
  assert.ok(of('plate').every((m) => near(m.section.b, 0.038) && near(m.section.d, 0.089) && m.length <= 4.8 + 1e-9));
  assert.ok(near(of('plate', 'top').reduce((n, m) => n + m.length, 0), 5) && of('plate', 'cap')[0].stage === 'top-plates');
  const joint = (t) => Math.min(...of('plate', t).map((m) => Math.max(m.a[0], m.b[0])));
  assert.ok(near((joint('top') / 0.4) % 1, 0, 1e-6) || near((joint('top') / 0.4) % 1, 1, 1e-6), 'the top plate joins over a stud at ' + joint('top'));
  assert.ok(Math.abs(joint('top') - joint('cap')) >= 1.2 - 1e-6, 'joints lap: ' + joint('top') + ' and ' + joint('cap'));
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
  const wr = of('membrane'), cl = of('cladding');
  assert.ok(wr.length >= 1 && cl.length > 10 && of('lining').length > 10 && of('lining').every((m) => m.type === 'boards' && m.face === 'i'));   // pine boards inside, a course at a time
  // every layer leaves the window open: no wrap or board piece crosses the opening (checked by its area against the wall's net area)
  const box = (m) => (m.type === 'boards' ? [m.a[0], m.b[0], m.a[1] - m.section.d / 2, m.a[1] + m.section.d / 2] : [m.a[0] - m.section.d / 2, m.a[0] + m.section.d / 2, m.a[1], m.b[1]]);
  for (const m of [...sh, ...wr, ...cl]) { const [x0, x1, y0, y1] = box(m); assert.ok(x1 <= 2.1 + 1e-6 || x0 >= 2.9 - 1e-6 || y1 <= 1.11 + 1e-6 || y0 >= 1.89 - 1e-6, m.id + ' covers the window opening'); }
  const wallNet = 5 * 2.84;
  assert.ok(wr.reduce((a, m) => a + m.area, 0) < wallNet + 0.5 && cl.filter((m) => m.type === 'boards').every((m) => m.row >= 0 && near(m.section.d, 0.18, 0.03)));
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
  // a 5.9 m ridge is two boards (no board is longer than 4.8 m) that join between rafters
  const ridge = out.filter((m) => m.kind === 'beam' && m.type === 'ridge');
  assert.equal(ridge.length, 2); assert.ok(near(ridge.reduce((n, m) => n + m.length, 0), 5.9, 1e-3) && ridge.every((m) => m.length <= 4.8 + 1e-9));
  assert.ok(out.some((m) => m.kind === 'membrane' && m.stage === 'dry-in') && out.some((m) => m.kind === 'roofing' && m.material === 'slate'));
  const deck = out.filter((m) => m.type === 'roof-deck').reduce((a, m) => a + m.area, 0), cover = out.filter((m) => m.kind === 'roofing' && m.type !== 'starter').reduce((a, m) => a + m.area, 0);
  assert.ok(near(deck, cover, 0.05), deck + ' ' + cover);   // each piece's area is rounded to the square millimetre
  // dried in from the eave up: drip edge along the eaves, ice-and-water shield at the eave, underlayment strips lapping up the slope, drip edge up the rakes
  const ul = out.filter((m) => m.kind === 'membrane' && m.parent === 'r.0').sort((a, b) => a.row - b.row);
  assert.equal(ul[0].type, 'ice-water'); assert.ok(ul.slice(1).every((m) => m.type === 'underlayment'));
  for (let k = 1; k < ul.length; k++) assert.ok(ul[k].rs[2] < ul[k - 1].rs[3] - 0.05, 'each strip laps the one below');
  assert.ok(out.some((m) => m.kind === 'drip' && m.stage === 'dry-in') && out.filter((m) => m.kind === 'rake').length >= 4);
  // the covering in courses from the eave up: a starter strip first, rows 0.3 to 0.6 m, and a ridge cap last
  const rc = out.filter((m) => m.kind === 'roofing' && m.parent === 'r.0');
  assert.equal(rc.find((m) => m.row === 0).type, 'starter');
  assert.ok(Math.max(...rc.map((m) => m.row)) >= 6 && rc.every((m) => m.rs[3] - m.rs[2] < 0.7));
  assert.ok(out.some((m) => m.kind === 'ridgecap' && m.stage === 'roofing'));
  // standing seam goes on in panels side by side, eave to ridge
  const seam = []; F.roofMembers(seam, { id: 'r', mat: 'seam', planes: [plane('r.0', -1)], ridges: [], ties: [] }, {});
  const pn = seam.filter((m) => m.kind === 'roofing');
  assert.ok(pn.length >= 10 && pn.every((m) => m.type === 'panel' && near(m.rs[3] - m.rs[2], run, 0.01)));
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

test('the shopping list buys sheets by cutting them to fit, by the same rule as the sim', async () => {
  const C = await import('../src/sim/content/construction.js');
  const A = F.SHEET.w * F.SHEET.l;
  assert.ok(near(A, C.SHEET.areaM2));
  for (const areas of [[1, 1, 0.9], [A, 0.4, 0.4, 0.4, 2.1, 1.5], [0.3, 0.3], [1.5, 1.5, 1.4], []]) assert.equal(F.packSheets(areas), C.packSheets(areas).sheets, areas.join());
  const list = F.materialsList([{ id: 'a', stage: 'subfloor', kind: 'sheathing', type: 'subfloor', material: 'osb', area: 1, length: 1 }, { id: 'b', stage: 'subfloor', kind: 'sheathing', type: 'subfloor', material: 'osb', area: 1, length: 1 }, { id: 'c', stage: 'subfloor', kind: 'sheathing', type: 'subfloor', material: 'osb', area: 0.9, length: 1 }]);
  const ln = list.find((l) => l.itemId === 'osb_18');
  assert.equal(ln.qty, 1);                          // three small pieces cut from one sheet and its offcuts
});

test('lumber is bought in stock lengths: the shopping list is whole sticks, short pieces come out of offcuts', () => {
  assert.equal(F.packSticks([2.606]), 3.0);                       // a stud for a 2.84 m wall is sawn from a 10 ft stick
  assert.equal(F.packSticks([2.4, 2.4]), 4.8);                    // exact lengths: no cut, no waste
  assert.equal(F.packSticks([1.2, 0.8, 0.3]), 2.4);          // three short pieces from one 8 ft stick
  assert.equal(F.packSticks([5.0]), 5.4);                         // a long one takes an 18 ft stick
  const lines = F.materialsList([{ id: 'a', kind: 'stud', type: 'stud', stage: 'wall-frame', section: { b: 0.038, d: 0.089 }, length: 2.606 }, { id: 'b', kind: 'stud', type: 'cripple', stage: 'wall-frame', section: { b: 0.038, d: 0.089 }, length: 0.35 }]);
  const studs = lines.find((l) => /Studs/.test(l.key));
  assert.equal(studs.qty, 3.0); assert.ok(near(studs.lengthM, 2.956, 1e-6));   // the cripple comes out of the stud's offcut
});

test('drywall hangs sheet by sheet: rows of 1.2 m, joints on studs and staggered, cut round the window, seams to tape; a partition is lined both sides', () => {
  const wall = (out, o) => F.wallMembers(out, { id: 'w', a: [0, 0], b: [5, 0], y0: 0, h: 2.84, out: o, mat: 'timber', openings: [{ id: 'o', kind: 'window', offset: 2.1, width: 0.8, sill: 1.11, height: 0.78 }] }, { studs: 0.4, ins: 'fibreglass_batt', lining: 'gypsum' });
  const out = [];
  wall(out, 1);
  const sheets = out.filter((m) => m.kind === 'lining'), joints = out.filter((m) => m.kind === 'joint');
  assert.ok(sheets.length >= 6 && sheets.every((m) => m.type === 'gypsum' && m.stage === 'lining' && m.length <= 2.4 + 1e-6 && m.section.d <= 1.2 + 1e-6), sheets.length + ' sheets');
  // the top row is hung first (row 0 at the top), the bottom row under it
  const top = sheets.filter((m) => m.row === 0), bottom = sheets.filter((m) => m.row === 1);
  assert.ok(top.length && bottom.length && Math.min(...top.map((m) => m.a[1])) > Math.max(...bottom.map((m) => m.a[1])));
  // end joints (not at an opening) land on the 0.4 m stud grid, and the two rows' joints do not line up
  const ends = (row) => sheets.filter((m) => m.row === row).flatMap((m) => [m.a[0], m.b[0]]).filter((x) => x > 0.05 && x < 4.95 && !(x > 2.05 && x < 2.95));
  for (const x of [...ends(0), ...ends(1)]) assert.ok(near((x / 0.4) % 1, 0, 1e-6) || near((x / 0.4) % 1, 1, 1e-6), 'a joint off the studs at ' + x);
  assert.ok(!ends(0).some((x) => ends(1).some((y) => near(x, y, 0.01))), 'joints staggered: ' + ends(0) + ' / ' + ends(1));
  // no sheet covers the window
  for (const m of sheets) { const x0 = Math.min(m.a[0], m.b[0]), x1 = Math.max(m.a[0], m.b[0]), y0 = m.a[1] - m.section.d / 2, y1 = m.a[1] + m.section.d / 2; assert.ok(x1 <= 2.1 + 1e-6 || x0 >= 2.9 - 1e-6 || y1 <= 1.11 + 1e-6 || y0 >= 1.89 - 1e-6, m.id + ' covers the window'); }
  // the sheets add up to the wall less the window
  assert.ok(near(sheets.reduce((t, m) => t + m.area, 0), 5 * (2.84 - 0.012 - 0.12) - 0.8 * 0.78, 0.3), 'sheet area ' + sheets.reduce((t, m) => t + m.area, 0));
  // seams to tape: the flat seam between rows, end joints, the corner; drawn by the view, not as boxes
  assert.ok(joints.some((m) => m.type === 'flat') && joints.some((m) => m.type === 'butt') && joints.some((m) => m.type === 'corner'));
  assert.ok(joints.every((m) => m.stage === 'finish' && m.draw === 0 && m.len > 0.08));
  // a partition (floor both sides) is lined on both faces
  const part = [];
  wall(part, 0);
  const faces = new Set(part.filter((m) => m.kind === 'lining').map((m) => m.face));
  assert.deepEqual([...faces].sort(), ['a', 'b']);
  assert.ok(part.filter((m) => m.kind === 'joint' && m.type === 'corner').length === 4, 'both ends, both faces');
});
