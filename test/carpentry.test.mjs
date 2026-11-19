// Finish carpentry, headless (docs/design/carpentry.md): casings and baseboard cut from stock lengths at the sawhorses,
// with the right cut at each end, nailed up after the taping and before the paint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';
import '../src/framing.js';
const F = globalThis.__framing;
const room = (spec = {}) => ({ found: 'pier-blocks', spec: { ins: 'fibreglass_batt', lining: 'gypsum', ...spec }, floors: [{ id: 'f', outline: [[0, 0], [3, 0], [3, 3], [0, 3]], y0: 0, ground: true }],
  walls: [{ id: 'w1', a: [0, 0], b: [3, 0], y0: 0, h: 2.6, out: -1, mat: 'timber', openings: [{ id: 'o', kind: 'window', offset: 1.1, width: 0.8, sill: 1, height: 0.8 }] },
    { id: 'w2', a: [0, 1.5], b: [8, 1.5], y0: 0, h: 2.6, out: 0, mat: 'timber', openings: [{ id: 'd', kind: 'door', offset: 1, width: 0.9, sill: 0, height: 2.05 }] }], roofs: [] });
const cs = (sim) => sim.state.sys.construction;

test('casings frame every opening on each lined face: a window in four mitered pieces, a door in three, legs to the floor', () => {
  const mem = F.generate(room()), cas = mem.filter((m) => m.kind === 'casing');
  const of = (q, fc) => cas.filter((m) => m.opening === q && m.face === fc);
  assert.equal(of('o', 'i').length, 4, 'a stool and apron: two legs, a head, the apron');
  assert.deepEqual(of('o', 'i').map((m) => m.type + ':' + m.ends.join()).sort(), ['apron:sq,sq', 'colonial:m45,m45', 'colonial:sq,m45', 'colonial:sq,m45']);
  assert.equal(mem.filter((m) => m.kind === 'stool' && m.opening === 'o').length, 1);
  const pf = F.generate(room({ winTrim: 'frame' })).filter((m) => m.kind === 'casing' && m.opening === 'o');
  assert.ok(pf.length === 4 && pf.every((m) => m.ends.join() === 'm45,m45'), 'or a picture frame, mitered all round');
  for (const fc of ['a', 'b']) {
    const d = of('d', fc), legs = d.filter((m) => m.ends[0] === 'sq');
    assert.equal(d.length, 3);
    assert.equal(legs.length, 2, 'two legs, square at the floor');
    assert.ok(legs.every((m) => Math.abs(Math.min(m.a[1], m.b[1]) - F.FLOOR_T) < 0.002 || Math.min(m.a[1], m.b[1]) < 0.06), 'down to the floor');
  }
  assert.ok(cas.every((m) => m.stage === 'carpentry' && C.isSiteCut(m.kind, m.length)), 'every piece of trim is cut to fit on site');
});

test('baseboard runs corner to corner, stops at the door casings, copes into a corner and splits a long run with a scarf', () => {
  const mem = F.generate(room()), base = mem.filter((m) => m.kind === 'base');
  const w1 = base.filter((m) => m.parent === 'w1');
  assert.equal(w1.length, 1, 'a window does not stop the base');
  assert.deepEqual(w1[0].ends, ['cope', 'sq']);
  const a = base.filter((m) => m.parent === 'w2' && m.face === 'a');
  assert.ok(a.length >= 3, 'both sides of the door, the long side split: ' + a.map((m) => m.length).join());
  assert.ok(a.some((m) => m.ends.includes('scarf')) && a.every((m) => m.length <= 4.8 + 1e-6));
  const door = mem.filter((m) => m.kind === 'casing' && m.opening === 'd' && m.face === 'a' && m.ends[0] === 'sq');
  const xs = door.map((m) => m.a[0]).sort((p, q) => p - q), CW = 0.057;
  assert.ok(a.some((m) => Math.abs(Math.max(m.a[0], m.b[0]) - (xs[0] - CW / 2)) < 0.002), 'butts the left leg');
  assert.ok(a.some((m) => Math.abs(Math.min(m.a[0], m.b[0]) - (xs[1] + CW / 2)) < 0.002), 'and the right');
});

test('the order: casing and base in stock lengths, finish nails; no lining, no trim', () => {
  const ml = F.materialsList(F.generate(room()).map((m) => ({ ...m, struct: 1 }))).filter((l) => l.stage === 'carpentry');
  assert.deepEqual(ml.map((l) => l.itemId).sort(), ['caulk_acrylic', 'nails_finish', 'trim_base', 'trim_casing', 'trim_stool']);
  assert.ok(ml.every((l) => l.qty > 0));
  assert.ok(!F.generate(room({ lining: null })).some((m) => m.stage === 'carpentry'));
  assert.ok(!F.generate(room({ trimIn: false })).some((m) => m.stage === 'carpentry'));
});

test('trim goes up after the taping and before the paint, cut at the sawhorses piece by piece, and takes the trim colour', () => {
  const mem = F.generate(room({ deco: { walls: 'sage_eggshell', trim: 'charcoal_semigloss' } })).map((m) => ({ ...m, struct: 's1', built: C.STAGE_ORDER.indexOf(m.stage) < C.STAGE_ORDER.indexOf('carpentry') }));
  assert.ok(mem.filter((m) => m.kind === 'paint' && (m.of || '').includes('.cs')).every((m) => m.fin === 'charcoal_semigloss') && mem.some((m) => m.kind === 'paint' && (m.of || '').includes('.bs')));
  assert.deepEqual(C.STAGE.carpentry.needs, ['lining', 'finish']);
  assert.ok(C.STAGE.decorate.needs.includes('carpentry'));
  const sim = createGameSim(3);
  sim.state.sys.stock.money = 5000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s1', mem, F.materialsList(mem), { name: 'Room', x: 40, z: 40, r: 2 })).ok);
  const pr = cs(sim).progress.s1;
  assert.ok(K.stageOpen(pr, 'carpentry') && !K.stageOpen(pr, 'decorate'));
  assert.ok(sim.commandNow('construction.order', { structId: 's1', stage: 'carpentry' }).ok);
  sim.commandNow('construction.deliverNow', {});
  const all = Object.keys(pr.members).filter((id) => pr.members[id].stage === 'carpentry'), ids = all.filter((id) => pr.members[id].kind !== 'caulk'), beads = all.filter((id) => pr.members[id].kind === 'caulk');
  assert.ok(beads.length >= ids.length - 4, 'a bead of caulk along most pieces');
  assert.equal(sim.commandNow('construction.install', { structId: 's1', memberIds: [beads[0]], from: 'stacks' }).refused[0].reason, 'set the trim first');
  for (const id of ids) {
    const m = pr.members[id];
    assert.ok(m.site, id + ' is cut on site');
    const c = sim.commandNow('construction.cut', { structId: 's1', memberId: id });
    assert.ok(c.ok && pr.members[id].prep, id + ' cut: ' + c.reason);
    let r = sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'carried' });
    for (let k = 0; k < 20 && r.ok && !pr.members[id].built; k++) r = sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'carried' });
    assert.ok(pr.members[id].built, id + ': ' + JSON.stringify(r.refused || r.reason));
  }
  assert.ok(!K.stageComplete(pr, 'carpentry'), 'not before the caulk');
  for (const id of beads) assert.ok(sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'stacks' }).ok && pr.members[id].built, id);
  assert.ok(K.stageComplete(pr, 'carpentry') && K.stageOpen(pr, 'decorate'));
  const used = (it) => Object.values(pr.lines).filter((l) => l.itemId === it).reduce((t, l) => t + l.used, 0);
  assert.ok(used('trim_casing') > 0 && used('trim_base') > 0);
});

test('the sawhorses come with the lumber to a new site, and stay put when they are already by it', () => {
  const sim = createGameSim(4);
  sim.state.sys.stock.money = 1e5;
  const plan = (id, x) => { const mem = F.generate(room()).map((m) => ({ ...m, struct: id, built: false })); return sim.commandNow('construction.setPlan', K.planFromPieces(id, mem, F.materialsList(mem), { name: id, x, z: 40, r: 3 })); };
  assert.ok(plan('a', 40).ok && plan('b', 120).ok);
  const order = (id) => { for (const st of C.STAGE_ORDER) sim.commandNow('construction.order', { structId: id, stage: st }); sim.commandNow('construction.deliverNow', {}); };
  order('a');
  const h1 = { ...cs(sim).horses };
  assert.ok(Math.hypot(h1.x - 40, h1.z - 40) < 8, 'by the first site');
  order('b');
  assert.ok(Math.hypot(cs(sim).horses.x - 120, cs(sim).horses.z - 40) < 8, 'moved to the second');
  sim.commandNow('construction.moveHorses', { x: 118, z: 45, yaw: 0 });
  assert.ok(plan('c', 125).ok);
  order('c');
  assert.deepEqual([cs(sim).horses.x, cs(sim).horses.z], [118, 45], 'already close: left where you put them');
});
