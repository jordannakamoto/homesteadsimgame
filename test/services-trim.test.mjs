// Electrical trim-out by hand (S9b): strip, land, fold and plate at each box, a breaker pressed into its slot, the main
// thrown; wall switches toggle the lights after them; the tester walks each circuit from the panel and names what is
// missing; a tripped breaker is reset by hand; "do it for me" draws the devices, plates and breakers from the stacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, supply as SUP } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import { fixture, link, setSite } from './helpers/pieces.mjs';

const E = (sim) => sim.state.sys.electrical, RT = (sim) => sim.state.sys.routes, cs = (sim) => sim.state.sys.construction;
const R = (sim) => (n, p) => { const r = sim.commandNow('routes.' + n, p); assert.notEqual(r && r.ok, false, n + ': ' + (r && r.reason)); return r; };
const finish = (c, id) => { c('work', { id, what: 'bore', n: 99 }); c('work', { id, what: 'pull', to: 1 }); c('work', { id, what: 'join', n: 2 }); };
const lineOf = (sim, f, itemId) => Object.values(cs(sim).progress[f].lines).find((l) => l.itemId === itemId && l.ext);
const lit = (sim, id) => { const L = E(sim).loads['sv:' + id]; return !!L && L.on && L.served > 0.5 && L.drawW > 0; };

// A generator feeding a 100 A panel; a building 9 under construction (so trim-out counts stock) with a slot on the panel,
// a switch box, a ceiling light after it, and an outlet off the switch box.
function house({ order = true, seed = 21 } = {}) {
  const sim = createGameSim(seed), c = R(sim);
  sim.state.sys.stock.money = 5000;
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.setPlan', { structId: 9, name: 'Box', x: 5, z: 5, r: 2, members: [{ id: 'rf', stage: 'roofing', kind: 'roofing', parent: 'r1', built: true }, { id: 'sh', stage: 'sheathing', kind: 'sheathing', parent: 'w1', built: true }], lines: [] }).ok);
  const gen = fixture('gen_petrol_5500w', { id: 'gen', x: 4, z: 4 }), pnl = fixture('panel_ac_100a', { id: 'pnl', x: 5, z: 5, y: 1.2 });
  setSite(sim, [gen, pnl, link('wire', gen, 'ac', pnl, 'main', { gauge: 10, lengthM: 3 })]);
  sim.runTicks(1);
  sim.commandNow('electrical.switch', { pieceId: 'gen', on: true });
  c('setFrames', { frames: { 9: { x: 5, y: 0, z: 5, yaw: 0 } } });
  const slot = c('addNode', { kind: 'slot', frame: '9', at: [0, 1.2, 0], ref: { piece: 'pnl', port: 'b1' } }).id;
  const sw = c('addNode', { kind: 'box', frame: '9', at: [1, 1.2, 0], set: { preset: 'switch' } }).id;
  const lamp = c('addNode', { kind: 'box_ceiling', frame: '9', at: [1.5, 2.4, 1.5] }).id;
  const out = c('addNode', { kind: 'box', frame: '9', at: [2, 0.4, 0] }).id;
  const r1 = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: slot, b: sw, path: [[0, 1.2, 0], [1, 1.2, 0]], bores: [{ at: [0.5, 1.2, 0], parent: 's1' }] }).id;
  const r2 = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: sw, b: lamp, path: [[1, 1.2, 0], [1, 2.4, 0], [1.5, 2.4, 1.5]] }).id;
  const r3 = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: sw, b: out, path: [[1, 1.2, 0], [1, 0.4, 0], [2, 0.4, 0]] }).id;
  sim.runTicks(1);
  if (order) assert.ok(sim.commandNow('construction.order', { structId: 9, stage: 'all' }).ok);
  return { sim, c, slot, sw, lamp, out, runs: [r1, r2, r3] };
}
const rough = ({ sim, c, sw, lamp, out, runs }) => { for (const r of runs) finish(c, r); for (const n of [sw, lamp, out]) c('setNode', { id: n, state: 'set' }); sim.runTicks(1); };

test('trim-out lines: a device and plate for each box, a breaker for each slot, by what each box was planned as', () => {
  const h = house();
  const { sim } = h;
  const v = K.buildingView(cs(sim), 9), tr = v.stages.find((q) => q.id === 'trim-out');
  assert.ok(tr && tr.total === 4, JSON.stringify(tr));
  assert.equal(lineOf(sim, '9', 'elec_switch').qty, 1, 'the box planned as a switch gets a switch');
  assert.equal(lineOf(sim, '9', 'elec_plate_switch').qty, 1);
  assert.equal(lineOf(sim, '9', 'elec_receptacle').qty, 1);
  assert.equal(lineOf(sim, '9', 'elec_plate_outlet').qty, 1);
  assert.equal(lineOf(sim, '9', 'elec_light_ceiling').qty, 1);
  assert.equal(lineOf(sim, '9', 'elec_breaker_15').qty, 1, '14/2 cable: a 15 A breaker');
  for (const it of ['elec_switch', 'elec_breaker_15']) assert.equal(lineOf(sim, '9', it).stage, 'trim-out');
  assert.ok(lineOf(sim, '9', 'elec_receptacle').supply, 'small boxed things stay by the stacks');
  assert.equal(SUP.stackQty(cs(sim), 'elec_light_ceiling'), 1, 'ordered with the rest');
});

test('by hand: strip, land, fold, plate in order; each takes its gesture; stock is drawn as it goes in', () => {
  const h = house(), { sim, out, sw, lamp, slot } = h;
  const T = (p) => sim.commandNow('services.trim', p);
  assert.equal(T({ node: out }).reason, 'Nail the box to the stud first.');
  rough(h);
  // the outlet box has one cable end: strip, land, fold, plate
  assert.equal(T({ node: out, step: 'land' }).reason, 'First strip the cable ends.');
  let r = T({ node: out });
  assert.ok(r.ok && r.step === 'strip' && !r.trimmed && r.next === 'land', JSON.stringify(r));
  assert.equal(lineOf(sim, '9', 'elec_receptacle').used, 0, 'stripping takes nothing');
  r = T({ node: out });
  assert.ok(r.ok && r.step === 'land' && r.used.elec_receptacle === 1, JSON.stringify(r));
  assert.equal(lineOf(sim, '9', 'elec_receptacle').used, 1, 'the outlet came off the stacks as its wires went on');
  assert.equal(sim.commandNow('services.device', { node: out, device: 'switch_single' }).reason, 'the wires are already on it');
  r = T({ node: out });
  assert.ok(r.ok && r.step === 'fold' && r.next === 'plate');
  r = T({ node: out });
  assert.ok(r.ok && r.trimmed && r.used.elec_plate_outlet === 1, JSON.stringify(r));
  assert.equal(RT(sim).nodes[out].state, 'trimmed');
  assert.equal(RT(sim).nodes[out].set.device, 'outlet_120v');
  // the switch box has three cable ends: a gesture of 3 strips all three, the next lands all three; one click of 2 folds and plates
  r = T({ node: sw, n: 3 }); assert.deepEqual(r.did, [{ step: 'strip', n: 3 }]);
  r = T({ node: sw, n: 2 }); assert.deepEqual(r.did, [{ step: 'land', n: 2 }]);
  r = T({ node: sw, n: 2 }); assert.deepEqual(r.did, [{ step: 'land', n: 1 }], 'only what is left');
  r = T({ node: sw, n: 2 }); assert.ok(r.trimmed && r.did.length === 2, JSON.stringify(r));
  assert.equal(RT(sim).nodes[sw].set.device, 'switch_single');
  for (let i = 0; i < 4; i++) T({ node: lamp, n: 4 });
  assert.equal(RT(sim).nodes[lamp].state, 'trimmed');
  // the breaker: pressed in; the main goes off while you work, so nothing is live yet
  r = T({ node: slot });
  assert.ok(r.ok && r.trimmed && r.pressed[0] === slot && r.used.elec_breaker_15 === 1, JSON.stringify(r));
  assert.equal(sim.state.sys.services.mains.pnl, false);
  sim.runTicks(2);
  assert.ok(E(sim).breakers['sv:br:' + slot], 'the breaker is in the panel');
  assert.ok(!lit(sim, lamp), 'main off: dark');
  // throw the main: the light comes on
  assert.ok(sim.commandNow('services.main', { node: slot, on: true }).ok);
  sim.runTicks(2);
  assert.ok(lit(sim, lamp), JSON.stringify(E(sim).loads['sv:' + lamp]));
  assert.equal(K.stageComplete(cs(sim).progress[9], 'trim-out'), true);
  for (const it of ['elec_receptacle', 'elec_switch', 'elec_light_ceiling', 'elec_plate_outlet', 'elec_plate_switch', 'elec_breaker_15']) assert.equal(lineOf(sim, '9', it).used, lineOf(sim, '9', it).qty, it);
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
});

test('short of stock: the gesture is refused and nothing changes', () => {
  const h = house({ order: false }), { sim, out } = h;
  rough(h);
  sim.commandNow('services.trim', { node: out });
  const v0 = RT(sim).version, r = sim.commandNow('services.trim', { node: out });
  assert.equal(r.ok, false); assert.equal(r.reason, 'no material'); assert.equal(r.itemId, 'elec_receptacle');
  assert.equal(RT(sim).version, v0);
  const a = sim.commandNow('services.auto', { structId: 9, stage: 'trim-out' });
  assert.equal(a.reason, 'no material', JSON.stringify(a));
});

test('a wall switch toggles the light after it, not the outlet; a breaker handle and a trip reset by hand', () => {
  const h = house(), { sim, sw, lamp, out, slot } = h;
  rough(h);
  const a = sim.commandNow('services.auto', { structId: 9, stage: 'trim-out' });
  assert.ok(a.ok, JSON.stringify(a));
  sim.runTicks(2);
  assert.ok(lit(sim, lamp), '"do it for me" throws the main too');
  for (const it of ['elec_receptacle', 'elec_switch', 'elec_light_ceiling', 'elec_breaker_15']) assert.equal(lineOf(sim, '9', it).used, 1, it + ' drawn from the stacks');
  assert.deepEqual(sim.systems.find((q) => q.name === 'services').api.switchControls(RT(sim), sw), [lamp]);
  let f = sim.commandNow('services.flip', { node: sw });
  assert.ok(f.ok && f.on === false && f.controls[0] === lamp);
  sim.runTicks(1);
  assert.ok(!lit(sim, lamp), 'switched off');
  assert.ok(E(sim).points['sv:' + out], 'the outlet is still on the circuit');
  f = sim.commandNow('services.flip', { node: sw });
  sim.runTicks(1);
  assert.ok(f.on && lit(sim, lamp), 'and on again');
  assert.equal(sim.commandNow('services.flip', { node: out }).reason, 'no switch there');
  // the breaker's own handle
  sim.commandNow('services.breaker', { node: slot, on: false }); sim.runTicks(1);
  assert.ok(!lit(sim, lamp));
  sim.commandNow('services.breaker', { node: slot, on: true }); sim.runTicks(1);
  assert.ok(lit(sim, lamp));
  // overload the outlet: the breaker trips, sits tripped, and the issue names the cause; throwing it on resets it
  sim.commandNow('electrical.setLoad', { id: 'heater', pieceId: 'sv:' + out, ratedW: 4000, on: true });
  sim.runTicks(30);
  assert.ok(E(sim).breakers['sv:br:' + slot].tripped, JSON.stringify(E(sim).breakers['sv:br:' + slot]));
  assert.ok(E(sim).issues.some((i) => i.pieceId === 'sv:br:' + slot && /tripped/.test(i.reason)));
  assert.ok(!lit(sim, lamp));
  sim.commandNow('electrical.removeLoad', { id: 'heater' });
  const b = sim.commandNow('services.breaker', { node: slot });
  assert.ok(b.ok && b.reset && b.on, JSON.stringify(b));
  sim.runTicks(1);
  assert.ok(!E(sim).breakers['sv:br:' + slot].tripped && lit(sim, lamp));
});

test('the tester walks each circuit from the panel and names what is missing, box by box', () => {
  const h = house(), { sim, c, slot, sw, lamp, out, runs } = h;
  const chk = () => sim.commandNow('services.check', { structId: 9, kind: 'power' });
  finish(c, runs[0]); finish(c, runs[1]);
  c('work', { id: runs[2], what: 'bore', n: 9 });
  c('setNode', { id: sw, state: 'set' }); c('setNode', { id: lamp, state: 'set' });
  let r = chk();
  assert.ok(r.ok && !r.pass);
  const hops = r.circuits[0].hops;
  assert.deepEqual(hops.map((x) => x.node), [sw, lamp, out], 'box to box in the order the cable reaches them');
  assert.deepEqual(hops.map((x) => x.ok), [true, true, false]);
  assert.equal(hops[2].why, 'cable not pulled through to here');
  // a run planned elsewhere that does not join the panel
  const lone = c('addNode', { kind: 'box', frame: '9', at: [3, 0.4, 0], state: 'set' }).id, lone2 = c('addNode', { kind: 'box', frame: '9', at: [3.5, 0.4, 0], state: 'set' }).id;
  const lr = c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: lone, b: lone2, path: [[3, 0.4, 0], [3.5, 0.4, 0]] }).id;
  finish(c, lr);
  r = chk();
  assert.ok(r.faults.some((x) => x.run === lr && /not joined to the panel/.test(x.why)));
  c('removeRun', { id: lr });
  finish(c, runs[2]); c('setNode', { id: out, state: 'set' });
  r = chk();
  assert.ok(r.pass, JSON.stringify(r.faults));
  assert.equal(sim.state.sys.services.checks['9'].power.pass, true);
  assert.equal(slot, r.circuits[0].slot);
});

test('an older save: slots trimmed before trim-out took stock stay lit and ask for nothing', () => {
  const h = house({ order: false }), { sim, c, slot, sw, lamp, out } = h;
  rough(h);
  for (const n of [slot, sw, lamp, out]) c('setNode', { id: n, state: 'trimmed' });
  c('setNode', { id: lamp, key: 'device', value: 'light_ceiling' });
  sim.runTicks(2);
  assert.ok(lit(sim, lamp), 'no main state: on');
  assert.ok(!lineOf(sim, '9', 'elec_breaker_15') && !lineOf(sim, '9', 'elec_light_ceiling'), 'nothing to buy for what is already in');
});
