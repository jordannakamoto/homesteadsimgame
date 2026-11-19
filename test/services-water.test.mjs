// Supply plumbing (S10): a manifold fed from a tank, PEX lines to stub-outs, the pressure test, fixtures set on the stubs
// by hand with stops and supply lines, the main opened, taps running indoors; stock drawn through the Build panel's
// lines; saves from before this slice still load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, supply as SUP, freshStoredL } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import { fixture, setSite } from './helpers/pieces.mjs';

const W = (sim) => sim.state.sys.water, RT = (sim) => sim.state.sys.routes, SV = (sim) => sim.state.sys.services, cs = (sim) => sim.state.sys.construction;
const R = (sim) => (n, p) => { const r = sim.commandNow('routes.' + n, p); assert.notEqual(r && r.ok, false, n + ': ' + (r && r.reason)); return r; };
const finish = (c, id) => { c('work', { id, what: 'bore', n: 99 }); c('work', { id, what: 'pull', to: 1 }); c('work', { id, what: 'join', n: 2 }); };
const lineOf = (sim, f, itemId) => Object.values(cs(sim).progress[f].lines).find((l) => l.itemId === itemId && l.ext);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);
const ledger = (sim) => freshStoredL(W(sim)) + W(sim).totals.usedL + W(sim).totals.leakedL;

// An IBC tote on a 1.5 m stand beside building 9 (under construction, so stock is counted); a 3/4 in main into a manifold
// on the wall; a 1/2 in line from it to a kitchen-sink stub; a second line to a toilet stub. Nothing roughed yet unless asked.
function plumbed({ order = true, rough = true, seed = 33 } = {}) {
  const sim = createGameSim(seed), c = R(sim);
  sim.state.sys.stock.money = 5000;
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.setPlan', { structId: 9, name: 'Box', x: 5, z: 5, r: 2, members: [{ id: 'rf', stage: 'roofing', kind: 'roofing', parent: 'r1', built: true }, { id: 'sh', stage: 'sheathing', kind: 'sheathing', parent: 'w1', built: true }], lines: [] }).ok);
  setSite(sim, [fixture('ibc_1000', { id: 'tank', x: 3, z: 5, y: 1.5 })]);
  sim.commandNow('water.fillTank', { id: 'tank', litres: 800 });
  c('setFrames', { frames: { 9: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const src = c('addNode', { kind: 'port', frame: null, at: [3, 1.5, 5], ref: { piece: 'tank', port: 'out' } }).id;
  const man = c('addNode', { kind: 'manifold', frame: '9', at: [0, 1.2, 0] }).id;
  const sink = c('addNode', { kind: 'stub_supply', frame: '9', at: [2, 0.5, 0], set: { preset: 'sink' } }).id;
  const loo = c('addNode', { kind: 'stub_supply', frame: '9', at: [3, 0.2, 1.5], set: { preset: 'toilet' } }).id;
  const main = c('addRun', { cls: 'supply', spec: 'pex_34', frame: '9', a: src, b: man, path: [[-2, 1.5, 0], [-2, 1.2, 0], [0, 1.2, 0]], bores: [{ at: [-1, 1.2, 0], parent: 'w1' }] }).id;
  const l1 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: '9', a: man, b: sink, path: [[0, 1.2, 0], [0, 0.5, 0], [2, 0.5, 0]], bores: [{ at: [1, 0.5, 0], parent: 'w1' }] }).id;
  const l2 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: '9', a: man, b: loo, path: [[0, 1.2, 0], [0, 0.2, 0], [3, 0.2, 1.5]], bores: [{ at: [1.5, 0.2, 0.7], parent: 'w1' }] }).id;
  sim.runTicks(1);
  if (order) assert.ok(sim.commandNow('construction.order', { structId: 9, stage: 'all' }).ok);
  const h = { sim, c, src, man, sink, loo, runs: [main, l1, l2] };
  if (rough) roughIn(h);
  return h;
}
function roughIn({ sim, c, man, sink, loo, runs }) { for (const r of runs) finish(c, r); for (const n of [man, sink, loo]) c('setNode', { id: n, state: 'set' }); sim.runTicks(1); }

test('rough-in lines: 3/4 in main, rings by size, a manifold, a cap for each stub; trim lines: fixtures, stops, supply lines', () => {
  const { sim } = plumbed({ rough: false });
  const rough = K.buildingView(cs(sim), 9).stages.find((q) => q.id === 'rough-in'), trim = K.buildingView(cs(sim), 9).stages.find((q) => q.id === 'trim-out');
  assert.ok(rough && rough.total > 0 && trim && trim.total === 2, JSON.stringify([rough, trim]));
  assert.equal(lineOf(sim, '9', 'manifold_pex_6').qty, 1);
  assert.equal(lineOf(sim, '9', 'pex_cap_12').qty, 2, 'one cap for each stub-out');
  assert.ok(lineOf(sim, '9', 'pex_coil_34').qty > 2 && lineOf(sim, '9', 'pex_coil_12_blue').qty > 3);
  assert.equal(lineOf(sim, '9', 'crimp_ring_34').qty, 2, 'the main has a ring at each end');
  assert.equal(lineOf(sim, '9', 'crimp_ring_12').qty, 4);
  for (const it of ['fx_sink_kitchen', 'fx_toilet', 'stop_valve_12', 'supply_line_12']) assert.equal(lineOf(sim, '9', it).stage, 'trim-out', it);
  assert.equal(lineOf(sim, '9', 'stop_valve_12').qty, 2, 'a stop on each stub');
  assert.ok(lineOf(sim, '9', 'fx_toilet').supply, 'small boxed things stay by the stacks');
  assert.equal(SUP.stackQty(cs(sim), 'fx_toilet'), 1, 'ordered with the rest');
});

test('PEX sizes: a 3/4 in main feeds 1/2 in lines as one pipe of the narrow size with the wide part shortened', () => {
  const { sim, c, sink, loo } = plumbed();
  c('setNode', { id: sink, key: 'device', value: 'tap_hose_bib' }); c('setNode', { id: sink, state: 'trimmed' }); sim.runTicks(1);
  const p = SV(sim).waterPieces.find((q) => q.kind === 'pipe');
  assert.ok(p, JSON.stringify(SV(sim).waterPieces));
  assert.equal(p.material, 'pipe_pex_12', 'the pipe is as narrow as its narrowest part');
  assert.ok(p.equivM < 0, 'the 3/4 in length counts for less: ' + p.equivM);
  const main = RT(sim).runs[Object.keys(RT(sim).runs)[0]].lengthM;
  assert.ok(p.lengthM > main && p.lengthM + p.equivM > 0);
  assert.ok(loo);
});

test('pressure test: the gauge reaches 690 kPa and holds when every end is crimped and capped; an uncapped stub and an uncrimped end sag it and say where', () => {
  const { sim, c, sink, loo, runs } = plumbed();
  // the stubs are strapped to the studs and not capped; the main is not crimped at the manifold
  c('work', { id: runs[0], what: 'join', end: 'b' });   // already crimped by finish: undo by building a second scene below
  let r = sim.commandNow('services.check', { structId: 9, kind: 'water' });
  assert.ok(r.ok && !r.pass, JSON.stringify(r));
  assert.deepEqual(r.leaks.map((q) => q.node).sort(), [loo, sink].sort(), 'both uncapped stubs spray');
  assert.ok(r.leaks.every((q) => /not capped/.test(q.why)));
  assert.ok(r.peakKPa < 100, 'the needle will not rise: ' + r.peakKPa);
  near(r.leaks[0].w[1], r.leaks[0].node === sink ? 0.5 : 0.2, 1e-9);
  assert.equal(r.testKPa, 690); assert.equal(r.holdMin, 15);
  // capping takes caps off the stacks
  const k = sim.commandNow('services.cap', { node: sink }); assert.ok(k.ok && k.capped, JSON.stringify(k));
  assert.equal(lineOf(sim, '9', 'pex_cap_12').used, 1);
  r = sim.commandNow('services.check', { structId: 9, kind: 'water' });
  assert.deepEqual(r.leaks.map((q) => q.node), [loo]);
  assert.ok(sim.commandNow('services.cap', { node: loo }).ok);
  r = sim.commandNow('services.check', { structId: 9, kind: 'water' });
  assert.ok(r.pass && r.holds && r.peakKPa === 690 && r.at === 'n2' && r.lines === 3, JSON.stringify(r));
  assert.equal(SV(sim).checks[9].water.pass, true, 'the green tag is kept');
  // off and on again: the same cap, no second one used
  sim.commandNow('services.cap', { node: sink, on: false }); assert.equal(sim.commandNow('services.cap', { node: sink, on: true }).ok, true);
  assert.equal(lineOf(sim, '9', 'pex_cap_12').used, 2, 'two caps for two stubs');
});

test('an uncrimped ring leaks at its end; a run not pulled through fails the test with its reason', () => {
  const sim = createGameSim(5), c = R(sim);
  setSite(sim, [fixture('ibc_1000', { id: 'tank', x: 3, z: 5, y: 1.5 })]);
  sim.commandNow('water.fillTank', { id: 'tank', litres: 500 });
  c('setFrames', { frames: { 9: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const src = c('addNode', { kind: 'port', frame: null, at: [3, 1.5, 5], ref: { piece: 'tank', port: 'out' } }).id;
  const man = c('addNode', { kind: 'manifold', frame: '9', at: [0, 1.2, 0] }).id;
  const stub = c('addNode', { kind: 'stub_supply', frame: '9', at: [2, 0.5, 0], set: { capped: true } }).id;
  const main = c('addRun', { cls: 'supply', spec: 'pex_34', frame: '9', a: src, b: man, path: [[-2, 1.5, 0], [-2, 1.2, 0], [0, 1.2, 0]] }).id;
  const line = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: '9', a: man, b: stub, path: [[0, 1.2, 0], [0, 0.5, 0], [2, 0.5, 0]], bores: [{ at: [1, 0.5, 0], parent: 'w1' }] }).id;
  finish(c, main);
  c('work', { id: line, what: 'bore', n: 9 });
  let r = sim.commandNow('services.check', { structId: 9, kind: 'water' });
  assert.ok(!r.pass && r.faults.length === 1 && /not pulled/.test(r.faults[0].why), JSON.stringify(r));
  c('work', { id: line, what: 'pull', to: 1 }); c('work', { id: line, what: 'join', end: 'a' });   // crimped at the manifold, not at the stub
  sim.runTicks(3);
  const lk = SV(sim).waterPieces.find((p) => p.kind === 'leak');
  assert.ok(lk && lk.at === line + '|b', JSON.stringify(SV(sim).waterPieces));
  assert.ok(W(sim).leaks[lk.id].flowLmin > 0 && W(sim).totals.leakedL > 0, 'it sprays');
  near(ledger(sim), 500, 1e-6, 'every litre is somewhere');
  r = sim.commandNow('services.check', { structId: 9, kind: 'water' });
  assert.ok(!r.pass && r.leaks.length === 1 && r.leaks[0].run === line && r.leaks[0].end === 'b' && /not crimped/.test(r.leaks[0].why), JSON.stringify(r));
  c('work', { id: line, what: 'join', end: 'b' }); sim.runTicks(3);
  assert.ok(!SV(sim).waterPieces.some((p) => p.kind === 'leak'), 'crimped: no spray');
  assert.ok(sim.commandNow('services.check', { structId: 9, kind: 'water' }).pass);
});

test('an uncapped stub with the supply behind it sprays, visibly, until it is capped; a closed manifold line keeps it dry', () => {
  const { sim, c, sink, runs, man } = plumbed();
  sim.runTicks(4);
  const leak = SV(sim).waterPieces.find((p) => p.kind === 'leak' && p.at === sink);
  assert.ok(leak && W(sim).leaks[leak.id].flowLmin > 0, JSON.stringify(SV(sim).waterPieces.map((p) => p.id)));
  near(leak.y, 0.5, 1e-9);
  // the line's stop at the manifold shuts it
  assert.ok(sim.commandNow('services.valve', { run: runs[1], on: false }).ok);
  sim.runTicks(2);
  assert.ok(!SV(sim).waterPieces.some((p) => p.kind === 'leak' && p.at === sink), 'a stopped line is dry beyond');
  assert.ok(SV(sim).waterPieces.some((p) => p.kind === 'leak'), 'the toilet line still sprays');
  // the main shuts the lot
  assert.ok(sim.commandNow('services.valve', { node: man, on: false }).ok);
  sim.runTicks(2);
  assert.ok(!SV(sim).waterPieces.some((p) => p.kind === 'leak'));
  sim.commandNow('services.valve', { node: man, on: true }); sim.commandNow('services.valve', { run: runs[1], on: true });
  assert.ok(sim.commandNow('services.cap', { node: sink }).ok); assert.ok(sim.commandNow('services.cap', { node: loo(sim) }).ok);
  const leaked = W(sim).totals.leakedL; sim.runTicks(4);
  assert.equal(SV(sim).waterPieces.length, 0);
  near(W(sim).totals.leakedL, leaked, 1e-9, 'capped: no more water lost');
  assert.ok(c);
});
const loo = (sim) => Object.values(RT(sim).nodes).find((n) => n.set && n.set.preset === 'toilet').id;

test('trim-out by hand: the fixture, a stop, a supply line; the main shuts when the first fixture goes on; opening it runs the tap indoors; stock is used', () => {
  const { sim, c, sink, loo: lo, man } = plumbed();
  sim.commandNow('services.cap', { node: sink }); sim.commandNow('services.cap', { node: lo });
  const T = (p) => sim.commandNow('services.trim', p);
  assert.equal(T({ node: sink, step: 'stop' }).reason, 'First set the fixture on its stub-out.');
  let r = T({ node: sink });
  assert.ok(r.ok && r.step === 'fix' && !r.trimmed && r.next === 'stop' && r.used.fx_sink_kitchen === 1 && r.mainClosed.includes(man), JSON.stringify(r));
  assert.equal(lineOf(sim, '9', 'fx_sink_kitchen').used, 1);
  assert.equal(SV(sim).valves['n:' + man], false, 'you work with the water off');
  assert.equal(sim.commandNow('services.valve', { node: sink }).ok, false, 'no stop on it yet');
  r = T({ node: sink }); assert.ok(r.ok && r.step === 'stop' && r.used.stop_valve_12 === 1, JSON.stringify(r));
  r = T({ node: sink }); assert.ok(r.ok && r.trimmed && r.used.supply_line_12 === 1, JSON.stringify(r));
  assert.equal(RT(sim).nodes[sink].state, 'trimmed'); assert.equal(RT(sim).nodes[sink].set.device, 'sink_kitchen');
  // the toilet
  for (let i = 0; i < 3; i++) T({ node: lo });
  assert.equal(RT(sim).nodes[lo].state, 'trimmed');
  assert.equal(RT(sim).nodes[lo].set.device, 'toilet_flush');
  sim.runTicks(2);
  const sk = 'sv:' + sink, pipe = SV(sim).waterPieces.find((p) => p.kind === 'pipe' && p.to.piece === sk);
  assert.ok(pipe && pipe.shut, 'main closed: the pipe is shut ' + JSON.stringify(pipe));
  sim.commandNow('water.setTap', { id: sk, open: true }); sim.runTicks(3);
  assert.equal(W(sim).taps[sk].flowLmin, 0); assert.equal(W(sim).taps[sk].why, 'valve');
  // open the main: the knock, then it runs
  const v = sim.commandNow('services.valve', { node: man, on: true });
  assert.ok(v.ok && v.knock && v.first && v.what === 'main', JSON.stringify(v));
  sim.runTicks(4);
  const q = W(sim).taps[sk].flowLmin;
  assert.ok(q > 0.5 && q < 8.3, 'gravity from a 1.5 m stand through 1/2 in PEX: ' + q);
  assert.equal(W(sim).taps[sk].served, true);
  assert.ok(W(sim).totals.usedL > 0);
  assert.ok(sim.commandNow('services.valve', { node: man, on: true }).knock === false, 'already open: no knock');
  // the angle stop shuts the one fixture
  assert.ok(sim.commandNow('services.valve', { node: sink, on: false }).ok); sim.runTicks(2);
  assert.equal(W(sim).taps[sk].flowLmin, 0);
  sim.commandNow('services.valve', { node: sink, on: true }); sim.runTicks(3);
  assert.ok(W(sim).taps[sk].flowLmin > 0.5);
  near(ledger(sim), 800, 1e-6, 'conserved');
  assert.equal(K.stageComplete(cs(sim).progress[9], 'trim-out'), true);
  for (const it of ['fx_sink_kitchen', 'fx_toilet', 'stop_valve_12', 'supply_line_12', 'pex_cap_12']) assert.equal(lineOf(sim, '9', it).used, lineOf(sim, '9', it).qty, it);
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  assert.ok(c);
});

test('a sink takes cold and hot: the hot stub beside it is trimmed with it (two stops, two lines) and feeds the hot port', () => {
  const { sim, c, sink, man, runs } = plumbed();
  const hot = c('addNode', { kind: 'stub_supply', frame: '9', at: [2.2, 0.5, 0], state: 'set' }).id;
  const lh = c('addRun', { cls: 'supply', spec: 'pex_12_red', frame: '9', a: man, b: hot, path: [[0, 1.2, 0], [0, 0.55, 0], [2.2, 0.55, 0]], bores: [{ at: [1, 0.55, 0], parent: 'w1' }] }).id;
  finish(c, lh); sim.commandNow('construction.order', { structId: 9, stage: 'all' });
  const A = sim.systems.find((s) => s.name === 'services').api, info = A.waterTrimInfo(RT(sim), RT(sim).nodes[sink], {});
  assert.equal(info.mate, hot); assert.equal(info.units.stop, 2); assert.equal(info.units.line, 2);
  assert.equal(A.waterTrimInfo(RT(sim), RT(sim).nodes[hot], {}).reason, 'This is the hot side of a fixture: trim its cold stub.');
  sim.commandNow('services.cap', { node: sink }); sim.commandNow('services.cap', { node: hot });
  const T = (p) => sim.commandNow('services.trim', p);
  T({ node: sink }); const s2 = T({ node: sink, n: 2 }); assert.deepEqual(s2.did, [{ step: 'stop', n: 2 }]);
  const s3 = T({ node: sink, n: 2 }); assert.ok(s3.trimmed && s3.used.supply_line_12 === 2, JSON.stringify(s3));
  assert.equal(RT(sim).nodes[hot].state, 'trimmed', 'the hot stub goes with it');
  assert.equal(RT(sim).nodes[hot].set.of, sink);
  sim.runTicks(2);
  const ports = SV(sim).waterPieces.filter((p) => p.kind === 'pipe').map((p) => p.to.piece + ':' + p.to.port).sort();
  assert.ok(ports.includes('sv:' + sink + ':hot') && ports.includes('sv:' + sink + ':in'), ports.join());
  assert.ok(!SV(sim).waterPieces.some((p) => p.kind === 'leak' && p.at === hot), 'a hot stub with a fixture on it is not open');
});

test('do it for me: rough-in caps every stub from the stacks; trim-out sets the fixtures and opens the main', () => {
  const h = plumbed({ rough: false }), { sim, man } = h;
  let r = sim.commandNow('services.auto', { structId: 9, stage: 'rough-in' });
  assert.ok(r.ok && r.capped === 2 && r.used.pex_cap_12 === 2 && r.used.manifold_pex_6 === 1, JSON.stringify(r));
  assert.equal(RT(sim).nodes[h.sink].set.capped, true);
  sim.runTicks(3);
  assert.ok(!SV(sim).waterPieces.some((p) => p.kind === 'leak'), 'every stub capped: no spray');
  assert.ok(sim.commandNow('services.check', { structId: 9, kind: 'water' }).pass);
  r = sim.commandNow('services.auto', { structId: 9, stage: 'trim-out' });
  assert.ok(r.ok && r.nodes === 2 && r.used.fx_sink_kitchen === 1 && r.used.fx_toilet === 1 && r.used.stop_valve_12 === 2 && r.used.supply_line_12 === 2, JSON.stringify(r));
  assert.equal(SV(sim).valves['n:' + man], undefined, 'main open');
  sim.commandNow('water.setTap', { id: 'sv:' + h.sink, open: true }); sim.runTicks(4);
  assert.ok(W(sim).taps['sv:' + h.sink].flowLmin > 0.5);
  assert.equal(K.stageComplete(cs(sim).progress[9], 'rough-in'), true);
  assert.equal(K.stageComplete(cs(sim).progress[9], 'trim-out'), true);
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  // with nothing ordered, nothing is done
  const bare = plumbed({ order: false, rough: false });
  const f = bare.sim.commandNow('services.auto', { structId: 9, stage: 'rough-in' });
  assert.equal(f.ok, false); assert.equal(f.reason, 'no material');
});

test('old saves: no valves, stubs capped by an older plan, a stub trimmed with no fixture: nothing sprays and nothing asks for more', () => {
  const sim = createGameSim(8), c = R(sim);
  setSite(sim, [fixture('ibc_1000', { id: 'tank', x: 3, z: 5, y: 1.5 })]);
  sim.commandNow('water.fillTank', { id: 'tank', litres: 300 });
  c('setFrames', { frames: { cabin: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const src = c('addNode', { kind: 'port', frame: null, at: [3, 1.5, 5], ref: { piece: 'tank', port: 'out' } }).id;
  const a = c('addNode', { kind: 'stub_supply', frame: 'cabin', at: [1.5, 0.5, 0], set: { capped: true }, state: 'set' }).id;
  const b = c('addNode', { kind: 'stub_supply', frame: 'cabin', at: [1.5, 0.5, 1], set: { capped: true }, state: 'trimmed' }).id;
  const r1 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: 'cabin', a: src, b: a, path: [[-2, 1.5, 0], [-2, 0.3, 0], [1.5, 0.3, 0], [1.5, 0.5, 0]] }).id;
  const r2 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: 'cabin', a: a, b: b, path: [[1.5, 0.5, 0], [1.5, 0.5, 1]] }).id;
  finish(c, r1); finish(c, r2);
  const old = sim.serialize(); delete old.sys.services.valves;
  const sim2 = createGameSim(8); sim2.load(old); sim2.runTicks(5);
  assert.deepEqual(sim2.state.sys.services.valves, {}, 'the field is added on load');
  assert.ok(!sim2.state.sys.services.waterPieces.some((p) => p.kind === 'leak'), 'capped by an older plan: no spray');
  assert.equal(sim2.commandNow('services.valve', { node: a, on: false }).reason, 'No stop on this stub-out yet.');
  assert.equal(sim2.commandNow('services.cap', { node: b }).reason, 'A fixture is on it.');
  const again = createGameSim(8); again.load(sim2.serialize()); again.runTicks(2);
  assert.deepEqual(again.state.sys.services.valves, {});
});
