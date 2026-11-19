// Interior finishes, headless (docs/design/interior-finishes.md): primer and two coats of paint on the walls, a
// rectangle at a time, each coat dry before the next; no finish chosen means no paint stage at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';
import '../src/framing.js';
const F = globalThis.__framing;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const room = (deco, lining = 'gypsum') => ({ found: 'pier-blocks', spec: { ins: 'fibreglass_batt', lining, deco }, floors: [{ id: 'f', outline: [[0, 0], [3, 0], [3, 3], [0, 3]], y0: 0, ground: true }],
  walls: [{ id: 'w1', a: [0, 0], b: [3, 0], y0: 0, h: 2.6, out: -1, mat: 'timber', openings: [{ id: 'o', kind: 'window', offset: 1.1, width: 0.8, sill: 1, height: 0.8 }] }, { id: 'w2', a: [0, 1.5], b: [3, 1.5], y0: 0, h: 2.6, out: 0, mat: 'timber', openings: [] }], roofs: [] });
function start(deco, lining) {
  const mem = F.generate(room(deco, lining)).map((m) => ({ ...m, struct: 's1', built: m.stage !== 'decorate' }));
  const sim = createGameSim(5);
  sim.state.sys.stock.money = 5000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s1', mem, F.materialsList(mem), { name: 'Room', x: 40, z: 40, r: 2 })).ok);
  return { sim, mem, pr: sim.state.sys.construction.progress.s1 };
}

test('paint pieces cover each lined face less its openings, primer under paint, in rectangles a roller works', () => {
  const { mem } = start({ walls: 'sage_eggshell' });
  const paint = mem.filter((m) => m.kind === 'paint'), prime = mem.filter((m) => m.kind === 'prime');
  assert.equal(paint.length, prime.length);
  assert.ok(paint.every((m) => m.stage === 'decorate' && m.draw === 0 && m.fin === 'sage_eggshell' && m.length <= 1.2 + 1e-6));
  // three faces: the outside wall's inside, and both faces of the partition
  assert.deepEqual([...new Set(paint.map((m) => m.parent + m.face))].sort(), ['w1i', 'w2a', 'w2b']);
  const lin = mem.filter((m) => m.kind === 'lining' && m.parent === 'w1').reduce((t, m) => t + m.area, 0), pa = paint.filter((m) => m.parent === 'w1').reduce((t, m) => t + m.area, 0);
  assert.ok(near(lin, pa, 0.02), 'paint ' + pa + ' over lining ' + lin);
});

test('no finish chosen: no paint stage, and the building finishes as before', () => {
  const { mem, pr } = start(null);
  assert.ok(!mem.some((m) => m.stage === 'decorate') && K.stageComplete(pr, 'decorate') && pr.done);
  assert.equal(C.STAGE.decorate.needs.join(), 'cladding,lining,finish');
  assert.ok(C.STAGE['trim-out'].needs.includes('decorate'), 'devices go on painted walls');
});

test('primer, then two coats of colour, each on dry paint; litres from the tins; the room is done when every rectangle is', () => {
  const { sim, pr } = start({ walls: 'terracotta_matte' });
  assert.ok(sim.commandNow('construction.order', { structId: 's1', stage: 'decorate' }).ok);
  sim.commandNow('construction.deliverNow', {});
  const ids = Object.keys(pr.members), paint = ids.filter((id) => pr.members[id].kind === 'paint'), id = paint[0], pid = id.replace('.pt', '.pr');
  const pass = (m) => sim.commandNow('construction.install', { structId: 's1', memberIds: [m], from: 'stacks' });
  assert.equal(pass(id).refused[0].reason, 'prime first');
  let r = pass(pid);
  assert.ok(r.ok && r.installed.includes(pid) && pr.members[pid].built, 'one coat of primer and it is in');
  assert.equal(pass(id).refused[0].reason, 'wet', 'not on wet primer');
  sim.state.t += C.DECOR.prime.dryS + 1;
  r = pass(id);
  assert.ok(r.ok && pr.members[id].coat === 1 && !pr.members[id].built, 'first coat');
  assert.equal(pass(id).refused[0].reason, 'wet');
  sim.state.t += C.DECOR.paint.dryS + 1;
  r = pass(id);
  assert.ok(r.ok && r.installed.includes(id) && pr.members[id].built && pr.members[id].dryAt > sim.state.t, 'second coat: done, still wet');
  const ln = pr.lines[pr.members[id].line];
  assert.ok(ln.itemId === 'paint_terracotta_matte' && ln.used > 0);
  for (const p of ids.filter((q) => pr.members[q].kind === 'prime' && !pr.members[q].built)) assert.ok(pass(p).ok);
  sim.state.t += C.DECOR.prime.dryS + 1;
  for (const p of paint.slice(1)) for (let k = 0; k < 2; k++) { sim.state.t += C.DECOR.paint.dryS + 1; const q = pass(p); assert.ok(q.ok, p + ' ' + JSON.stringify(q.refused) + ' ' + JSON.stringify(pr.lines[pr.members[p].line])); }
  assert.ok(K.stageComplete(pr, 'decorate') && pr.done);
});

test('a new colour on a painted wall: two more coats over the primer, which stays; the same plan sent again changes nothing', () => {
  const { sim, mem, pr } = start({ walls: 'sage_matte' });
  sim.state.sys.construction.options.instant = true;
  sim.commandNow('construction.order', { structId: 's1', stage: 'decorate' });
  sim.commandNow('construction.deliverNow', {});
  const ids = Object.keys(pr.members).filter((id) => /\.p[rt]/.test(id)).sort((a, b) => (a.includes('.pr') ? 0 : 1) - (b.includes('.pr') ? 0 : 1));
  for (let k = 0; k < 2; k++) for (const id of ids) sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'stacks' });
  assert.ok(pr.done);
  const again = (deco) => { const m2 = F.generate(room(deco)).map((m) => ({ ...m, struct: 's1', built: m.stage !== 'decorate' })); return sim.commandNow('construction.setPlan', K.planFromPieces('s1', m2, F.materialsList(m2), { name: 'Room', x: 40, z: 40, r: 2 })); };
  const before = JSON.stringify(sim.state.sys.construction.progress.s1.members);
  assert.ok(again({ walls: 'sage_matte' }).ok);
  assert.equal(JSON.stringify(sim.state.sys.construction.progress.s1.members), before);
  assert.ok(again({ walls: 'ochre_satin' }).ok);
  const p2 = sim.state.sys.construction.progress.s1, pt = Object.keys(p2.members).filter((id) => p2.members[id].kind === 'paint');
  assert.ok(pt.every((id) => !p2.members[id].built && !p2.members[id].coat && p2.members[id].fin === 'ochre_satin'));
  assert.ok(Object.values(p2.members).filter((m) => m.kind === 'prime').every((m) => m.built), 'the primer stays');
  assert.ok(!p2.done && !K.stageComplete(p2, 'decorate'));
  void mem;
});

test('the trim takes its own colour: two coats on each board, no primer (it comes primed), after the siding', () => {
  const { sim, mem, pr } = start({ walls: 'sage_eggshell', trim: 'chalk_semigloss' });
  const trim = mem.filter((m) => m.kind === 'cladding' && m.type === 'trim'), tp = mem.filter((m) => m.kind === 'paint' && m.surface === 'trim');
  assert.ok(trim.length >= 4, 'corner boards and the window trim');
  assert.equal(tp.length, trim.length);
  assert.ok(tp.every((m) => m.fin === 'chalk_semigloss' && m.of && m.section.b > 0.02 && !mem.some((q) => q.id === m.id.replace('.pt', '.pr'))));
  assert.ok(mem.filter((m) => m.kind === 'paint' && m.surface === 'walls').every((m) => m.fin === 'sage_eggshell'), 'the walls keep theirs');
  // a different colour on one board: the items record names it
  const one = F.generate(room({ trim: 'chalk_semigloss', items: { [trim[0].id]: 'charcoal_semigloss' } })).filter((m) => m.kind === 'paint');
  assert.equal(one.find((m) => m.of === trim[0].id).fin, 'charcoal_semigloss');
  assert.ok(one.filter((m) => m.of !== trim[0].id).every((m) => m.fin === 'chalk_semigloss') && !one.some((m) => m.surface === 'walls'), 'no wall colour, no wall paint');
  sim.state.sys.construction.options.instant = true;
  assert.ok(sim.commandNow('construction.order', { structId: 's1', stage: 'decorate' }).ok);
  sim.commandNow('construction.deliverNow', {});
  const id = tp[0].id, pass = () => sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'stacks' });
  assert.ok(pass().ok && !pr.members[id].built && pass().ok && pr.members[id].built, 'two coats and it is done');
});
