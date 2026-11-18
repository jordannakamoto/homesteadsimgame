// Services: runs in a building's frame compile into the pieces electrical and water already solve.
// A panel, cable and a light; a tank, PEX and a tap; an uncapped stub and an uncrimped end that leak;
// energy and water conserved; and no recompile of the electrical network while nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, powerNear, freshStoredL, serviceRunInfo, servicesOverlay } from '../src/sim/index.js';
import { electricalStats } from '../src/sim/electrical.js';
import { fixture, link, setSite } from './helpers/pieces.mjs';

const E = (sim) => sim.state.sys.electrical, W = (sim) => sim.state.sys.water, SV = (sim) => sim.state.sys.services;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);
const R = (sim) => (n, p) => { const r = sim.commandNow('routes.' + n, p); assert.notEqual(r && r.ok, false, n + ': ' + (r && r.reason)); return r; };
const finish = (c, id) => { c('work', { id, what: 'bore', n: 99 }); c('work', { id, what: 'pull', to: 1 }); c('work', { id, what: 'join', n: 2 }); };

// A generator feeding a breaker panel on the yard; a cabin frame at (5, 0, 5) with a slot on the panel,
// a wall box and a ceiling box.
function wired() {
  const sim = createGameSim(7), c = R(sim);
  const gen = fixture('gen_petrol_2kw', { id: 'gen', x: 4, z: 4 }), pnl = fixture('panel_ac_100a', { id: 'pnl', x: 5, z: 5, y: 1.2 });
  setSite(sim, [gen, pnl, link('wire', gen, 'ac', pnl, 'main', { gauge: 10, lengthM: 3 })]);
  sim.runTicks(1);
  sim.commandNow('electrical.switch', { pieceId: 'gen', on: true });
  c('setFrames', { frames: { cabin: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const slot = c('addNode', { kind: 'slot', frame: 'cabin', at: [0, 1.2, 0], ref: { piece: 'pnl', port: 'b1' } }).id;
  const box = c('addNode', { kind: 'box', frame: 'cabin', at: [2, 0.4, 0] }).id;
  const lamp = c('addNode', { kind: 'box_ceiling', frame: 'cabin', at: [2, 2.4, 1.5] }).id;
  const r1 = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: slot, b: box, path: [[0, 1.2, 0], [0, 0.4, 0], [2, 0.4, 0]], bores: [{ at: [0.6, 0.4, 0], parent: 'w1' }, { at: [1.2, 0.4, 0], parent: 'w1' }] }).id;
  const r2 = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: box, b: lamp, path: [[2, 0.4, 0], [2, 2.4, 0], [2, 2.4, 1.5]], bores: [{ at: [2, 2.3, 0], parent: 'w1.tp' }] }).id;
  return { sim, c, slot, box, lamp, r1, r2 };
}

test('panel, cable and a light: rough-in powers nothing, trim-out lights it, through a breaker that maps back to the slot', () => {
  const { sim, c, slot, box, lamp, r1, r2 } = wired();
  sim.runTicks(2);
  assert.equal(SV(sim).powerPieces.length, 0, 'planned runs carry nothing');
  assert.match(serviceRunInfo(sim.state, r1).words, /14\/2 cable, 2\.8 m: planned\. Next: drill the holes \(0 of 2 done\)/);
  finish(c, r1); finish(c, r2);
  c('setNode', { id: box, state: 'set' }); c('setNode', { id: lamp, state: 'set' });
  sim.runTicks(2);
  assert.equal(E(sim).breakers['sv:br:' + slot], undefined, 'no breaker until trim-out');
  assert.ok(!Object.values(E(sim).loads).some((L) => L.source === 'fixture' && /^sv:/.test(L.pieceId || '')), 'roughed in: no devices, nothing draws');
  assert.equal(serviceRunInfo(sim.state, r1).state, 'roughed');
  // trim-out: a light in the ceiling box, a breaker in the slot
  c('setNode', { id: lamp, key: 'device', value: 'light_ceiling' }); c('setNode', { id: lamp, state: 'trimmed' });
  c('setNode', { id: slot, state: 'trimmed' }); c('setNode', { id: box, state: 'trimmed' });
  sim.runTicks(3);
  const L = E(sim).loads['sv:' + lamp];
  assert.ok(L, JSON.stringify(Object.keys(E(sim).loads)));
  assert.equal(L.served, 1);
  near(L.drawW, 9, 1e-9, 'the LED draws its 9 W');
  assert.equal(E(sim).breakers['sv:br:' + slot].ratingA, 15, '14/2 cable gets a 15 A breaker');
  near(E(sim).wires['sv:w:' + r1].lengthM, 2.8, 1e-9, 'the wire is as long as the run');
  assert.ok(E(sim).wires['sv:w:' + r2].currentA > 0);
  assert.ok(E(sim).points['sv:' + lamp].path.includes('sv:br:' + slot), 'the light is fed through its breaker');
  assert.ok(powerNear(sim.state, 7, 6.5, 2), 'a cord near the cabin finds power through the new circuit');
  const ov = servicesOverlay(sim.state);
  assert.ok(ov.runs.find((r) => r.id === r2).live && ov.runs.find((r) => r.id === r2).pieces.includes('sv:w:' + r2));
  // a tripped breaker darkens it; reset brings it back
  sim.commandNow('electrical.switch', { pieceId: 'sv:' + lamp, on: false }); sim.runTicks(1);
  assert.equal(E(sim).loads['sv:' + lamp].drawW, 0);
  sim.commandNow('electrical.switch', { pieceId: 'sv:' + lamp, on: true }); sim.runTicks(1);
  assert.equal(E(sim).loads['sv:' + lamp].served, 1);
});

test('energy is conserved with services on the circuit, and idle ticks never recompile the network', () => {
  const { sim, c, slot, box, lamp, r1, r2 } = wired();
  finish(c, r1); finish(c, r2);
  c('setNode', { id: box, key: 'device', value: 'outlet_120v' });
  for (const n of [slot, box, lamp]) c('setNode', { id: n, state: 'trimmed' });
  c('setNode', { id: lamp, key: 'device', value: 'light_ceiling' });
  sim.runTicks(2);
  const t0 = { ...E(sim).totals }, pieces = SV(sim).pieces, compiles = electricalStats.compiles;
  sim.runTicks(120);
  assert.equal(electricalStats.compiles, compiles, 'two idle hours: the topology is never rebuilt');
  assert.equal(SV(sim).pieces, pieces, 'services keeps the same array while the routes stand still');
  const e = E(sim), y = {};
  for (const k of Object.keys(t0)) if (typeof t0[k] === 'number') y[k] = e.totals[k] - t0[k];
  const inW = y.generatedWh + y.dischargedWh + y.generatorWh, outW = y.usedWh + y.chargedWh + y.wireLossWh + y.inverterLossWh + y.wastedWh;
  assert.ok(y.generatorWh > 0);
  near(inW - outW, 0, 1e-6, 'books balance');
  // a change does recompile, once
  c('work', { id: r1, what: 'join', end: 'a' }); sim.runTicks(5);
  assert.ok(electricalStats.compiles <= compiles + 1);
});

// An IBC tote on a 1.5 m stand by the cabin, a PEX run from its outlet into the cabin to a stub.
function piped({ capped = true } = {}) {
  const sim = createGameSim(9), c = R(sim);
  setSite(sim, [fixture('ibc_1000', { id: 'tank', x: 3, z: 5, y: 1.5 })]);
  sim.commandNow('water.fillTank', { id: 'tank', litres: 500 });
  c('setFrames', { frames: { cabin: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const src = c('addNode', { kind: 'port', frame: null, at: [3, 1.5, 5], ref: { piece: 'tank', port: 'out' } }).id;
  const tee = c('addNode', { kind: 'stub_supply', frame: 'cabin', at: [0, 0.3, 0], set: { capped: true } }).id;
  const stub = c('addNode', { kind: 'stub_supply', frame: 'cabin', at: [1.5, 0.5, 0], set: { capped } }).id;
  const r1 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: 'cabin', a: src, b: tee, path: [[-2, 1.5, 0], [-2, 0.3, 0], [0, 0.3, 0]] }).id;
  const r2 = c('addRun', { cls: 'supply', spec: 'pex_12_blue', frame: 'cabin', a: tee, b: stub, path: [[0, 0.3, 0], [1.5, 0.3, 0], [1.5, 0.5, 0]], bores: [{ at: [0.8, 0.3, 0], parent: 'w2' }] }).id;
  return { sim, c, src, tee, stub, r1, r2 };
}
const ledger = (sim) => freshStoredL(W(sim)) + W(sim).totals.usedL + W(sim).totals.leakedL;

test('tank, PEX and a tap set on the stub at trim-out: water runs indoors, and is conserved', () => {
  const { sim, c, stub, r1, r2 } = piped();
  finish(c, r1); finish(c, r2);
  sim.runTicks(2);
  assert.equal(SV(sim).waterPieces.length, 0, 'a capped stub with nothing on it: no pipe, no leak');
  c('setNode', { id: stub, key: 'device', value: 'tap_hose_bib' }); c('setNode', { id: stub, state: 'trimmed' });
  sim.runTicks(1);
  const pipe = SV(sim).waterPieces.find((p) => p.kind === 'pipe');
  assert.ok(pipe, JSON.stringify(SV(sim).waterPieces));
  assert.deepEqual([pipe.from, pipe.to], [{ piece: 'tank', port: 'out' }, { piece: 'sv:' + stub, port: 'in' }]);
  near(pipe.lengthM, 1.2 + 2 + 1.5 + 0.2, 1e-9, 'one pipe through the tee, as long as both runs');
  assert.equal(pipe.indoor, true); assert.equal(pipe.material, 'pipe_pex_12');
  sim.commandNow('water.setTap', { id: 'sv:' + stub, open: true });
  sim.runTicks(5);
  const q = W(sim).taps['sv:' + stub].flowLmin;
  assert.ok(q > 1 && q < 19, 'gravity from a 1.5 m stand: ' + q);
  assert.ok(W(sim).totals.usedL > 0);
  near(ledger(sim), 500, 1e-6, 'conserved');
  assert.ok(servicesOverlay(sim.state).runs.find((r) => r.id === r2).flowLmin > 0);
});

test('an uncapped stub sprays until it is capped; an uncrimped end leaks too', () => {
  const { sim, c, stub, r1, r2 } = piped({ capped: false });
  finish(c, r1); finish(c, r2);
  sim.runTicks(3);
  const leak = SV(sim).waterPieces.find((p) => p.kind === 'leak');
  assert.ok(leak, 'a leak at the open stub');
  assert.equal(leak.id, 'sv:leak:' + stub);
  near(leak.y, 0.5, 1e-9); near(leak.a.x, 6.5, 1e-9);
  assert.ok(W(sim).leaks[leak.id].flowLmin > 0);
  const leaked = W(sim).totals.leakedL;
  assert.ok(leaked > 0);
  near(ledger(sim), 500, 1e-6, 'every litre is somewhere');
  c('setNode', { id: stub, key: 'capped', value: true }); sim.runTicks(3);
  assert.equal(SV(sim).waterPieces.length, 0);
  near(W(sim).totals.leakedL, leaked, 1e-9, 'capped: no more water lost');

  // a run pulled and crimped at the tank but not at the far end
  const p2 = piped();
  finish(p2.c, p2.r1);
  p2.c('work', { id: p2.r2, what: 'bore', n: 9 }); p2.c('work', { id: p2.r2, what: 'pull', to: 1 }); p2.c('work', { id: p2.r2, what: 'join', end: 'a' });
  p2.sim.runTicks(3);
  const lk = SV(p2.sim).waterPieces.find((p) => p.kind === 'leak');
  assert.ok(lk && lk.at === p2.r2 + '|b', JSON.stringify(SV(p2.sim).waterPieces));
  near(lk.y, 0.5, 1e-9, 'at the end of the run');
  assert.ok(W(p2.sim).totals.leakedL > 0);
  near(ledger(p2.sim), 500, 1e-6);
});

test('a run on a building that went away is flagged, never dropped, and stops carrying', () => {
  const { sim, c, slot, box, lamp, r1, r2 } = wired();
  finish(c, r1); finish(c, r2);
  for (const n of [slot, box, lamp]) c('setNode', { id: n, state: 'trimmed' });
  c('setNode', { id: lamp, key: 'device', value: 'light_ceiling' });
  sim.runTicks(2);
  assert.equal(E(sim).loads['sv:' + lamp].served, 1);
  c('setFrames', { frames: {} });
  sim.runTicks(2);
  assert.ok(sim.state.sys.routes.runs[r1]);
  assert.ok(SV(sim).issues.some((i) => i.runId === r1));
  assert.equal(serviceRunInfo(sim.state, r1).reason, 'What it was fixed to is gone.');
  assert.equal(E(sim).loads['sv:' + lamp], undefined);
});
