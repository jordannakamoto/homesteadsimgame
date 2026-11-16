// Hand-fitted plumbing: the fitted parts compile into the water network; valve, tee, open-end leak,
// pumping by hand, and conservation of water through all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, siteSystem, createPartsSystem, plumbingSystem, PLUMBING_KINDS as K, PLUMBING_MATES as M, PLUMBING_STEP_M as STEP, PLUMBING_PIPE, PART_ROTATIONS as ROT, CAN_L } from '../src/sim/index.js';
import { graph, placements, rotate } from '../src/sim/core/parts.js';
import { water, freshStoredL } from '../src/sim/water.js';
import { garden } from '../src/sim/garden.js';
import { setSite, fixture } from './helpers/pieces.mjs';

const sys = { kinds: K, mates: M };
const weather = { name: 'weather', every: 1, init: () => ({ tempC: 12, rainMmH: 0, snowMmH: 0, snowDepthM: 0, windMs: 0, groundTempC: 8, humidity: 0.6, cloud: 0.3, solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 }, site: { climate: 'temperate', latitudeDeg: 45 } }) };
const make = () => createSim({ seed: 5, systems: [weather, siteSystem(), createPartsSystem({ name: 'parts', stepM: STEP, kinds: K, mates: M }), plumbingSystem({ kinds: K, mates: M, stepM: STEP, material: PLUMBING_PIPE }), water, garden] });
const W = (sim) => sim.state.sys.water, P = (sim) => sim.state.sys.parts;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);
const rotFor = (to) => ROT.findIndex((_, r) => rotate(r, [1, 0, 0]).join() === to.join());

// A barrel on a 1.5 m stand with its outlet facing +x at lattice (0,6,0); a tap whose inlet faces down at (8,3,0);
// a second tap at (4,3,4), inlet down; a dug well and a manual hand pump piped up into the barrel.
function yard(sim) {
  const well = fixture('well_dug', { id: 'well', y: 0 }), pump = fixture('hand_pump', { id: 'pump', y: 0.6, settings: { manual: true } });
  const barrel = fixture('rain_barrel_200', { id: 'barrel', y: 1.5 }), tap = fixture('tap_hose_bib', { id: 'tap', y: 0.75 }), tap2 = fixture('tap_hose_bib', { id: 'tap2', y: 0.75 });
  setSite(sim, [well, pump, barrel, tap, tap2,
    { id: 'suck', kind: 'pipe', from: { piece: 'well', port: 'out' }, to: { piece: 'pump', port: 'in' }, lengthM: 3, material: PLUMBING_PIPE },
    { id: 'rise', kind: 'pipe', from: { piece: 'pump', port: 'out' }, to: { piece: 'barrel', port: 'in' }, lengthM: 2.5, material: PLUMBING_PIPE }]);
  const A = (id, at, dir, ref) => sim.commandNow('parts.anchor', { id, kind: 'port', at, rot: rotFor(dir), ref });
  A('a:out', [0, 6, 0], [1, 0, 0], { piece: 'barrel', port: 'out' });
  A('a:tap', [8, 3, 0], [0, -1, 0], { piece: 'tap', port: 'in' });
  A('a:tap2', [4, 3, 4], [0, -1, 0], { piece: 'tap2', port: 'in' });
  sim.runTicks(1);
}
// fit `kind` on the open end of part `on`, leaving toward `leave` (a lattice direction) when the part has a choice
function put(sim, kind, on, leave, len) {
  const id = sim.commandNow('parts.spawn', { kind, len, pose: { x: 0, y: 0, z: 0 } }).id;
  const g = graph(sys, P(sim)), end = g.open.find((e) => e.part === on);
  assert.ok(end, 'no open end on ' + on);
  const ways = placements(sys, P(sim), kind, len, end);
  const pick = ways.find((w) => !leave || K[kind].ends.some((e) => rotate(w.rot, e.dir).join() === leave.join() && e.id !== w.end)) || ways[0];
  assert.ok(pick, 'no way to fit ' + kind + ' on ' + on);
  if (pick.len && pick.len !== P(sim).parts[id].len) sim.commandNow('parts.cut', { id, len: pick.len });
  const r = sim.commandNow('parts.fit', { id, at: pick.at, rot: pick.rot });
  assert.equal(r.ok, true, r.reason);
  return id;
}
// barrel -> valve -> stub -> elbow down -> 3 steps -> elbow -> along +x -> elbow up ... -> tap inlet
function runToTap(sim) {
  const v = put(sim, 'valve', 'a:out');
  const s1 = put(sim, 'pipe', v, null, 1);
  const e1 = put(sim, 'elbow', s1, [0, -1, 0]);
  const d = put(sim, 'pipe', e1, null, 4);              // down from y 6 to y 2
  const e2 = put(sim, 'elbow', d, [1, 0, 0]);
  const h = put(sim, 'pipe', e2, null, 6);              // x 1 -> 7
  const c = put(sim, 'coupling', h);
  const h2 = put(sim, 'pipe', c, null, 1);              // x 7 -> 8
  const e3 = put(sim, 'elbow', h2, [0, 1, 0]);
  const up = put(sim, 'pipe', e3, null, 1);             // y 2 -> 3: meets the tap inlet
  return { v, s1, e1, d, e2, h, c, h2, e3, up };
}

test('a run fitted by hand compiles to one pipe from the barrel to the tap, with its real length', () => {
  const sim = make(); yard(sim);
  const r = runToTap(sim);
  sim.commandNow('plumbing.sync');
  const pl = sim.state.sys.plumbing, run = pl.pieces.find((p) => p.kind === 'pipe');
  assert.ok(run, JSON.stringify(pl.pieces));
  assert.deepEqual([run.from, run.to], [{ piece: 'barrel', port: 'out' }, { piece: 'tap', port: 'in' }]);
  near(run.lengthM, (1 + 4 + 6 + 1 + 1) * STEP, 1e-9);
  assert.ok(run.equivM > 1.5 && run.equivM < 2.5, 'three elbows, a valve and a coupling add friction: ' + run.equivM);
  assert.equal(run.shut, true, 'the kit valve starts closed');
  assert.deepEqual(run.valves, [r.v]);
  assert.equal(pl.pieces.filter((p) => p.kind === 'leak').length, 0);
});

test('valve shut: no water and the reason says so; valve open: gravity brings it; empty barrel: says empty', () => {
  const sim = make(); yard(sim);
  const r = runToTap(sim);
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 100 });
  sim.commandNow('water.setTap', { id: 'tap', open: true });
  sim.runTicks(3);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.equal(W(sim).taps.tap.why, 'valve');
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'tap' && /valve/.test(i.reason)));
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: true });
  sim.runTicks(2);
  const q = W(sim).taps.tap.flowLmin;
  assert.ok(q > 1 && q < 19, 'a gravity tap runs, gently: ' + q + ' L/min');
  assert.equal(W(sim).taps.tap.why, null);
  near(freshStoredL(W(sim)) + W(sim).totals.usedL, 100, 1e-6, 'conserved');
  sim.runTicks(200);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.equal(W(sim).taps.tap.why, 'empty');
  near(W(sim).totals.usedL, 100, 1e-6);
});

test('a tap above the water level gives nothing, and says why', () => {
  const sim = make(); yard(sim);
  // lift the tap fixture above the barrel: same parts, taller post
  const site = sim.state.sys.site.pieces.map((p) => (p.id === 'tap' ? { ...p, y0: 3.5, y1: 3.5 } : p));
  setSite(sim, site);
  const r = runToTap(sim);
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: true });
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 100 });
  sim.commandNow('water.setTap', { id: 'tap', open: true });
  sim.runTicks(3);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.equal(W(sim).taps.tap.why, 'above');
});

test('a valve between the barrel and a pipe is in the way whatever order the parts were made in', () => {
  const sim = make(); yard(sim);
  const pipe = sim.commandNow('parts.spawn', { kind: 'pipe', len: 2, pose: {} }).id;      // the pipe exists first
  const v = put(sim, 'valve', 'a:out');
  const w = placements(sys, P(sim), 'pipe', 2, graph(sys, P(sim)).open.find((e) => e.part === v))[0];
  assert.equal(sim.commandNow('parts.fit', { id: pipe, at: w.at, rot: w.rot }).ok, true);
  const g = graph(sys, P(sim));
  assert.deepEqual(g.adj.get('a:out').map((l) => l.other), [v], 'the barrel joins the valve, not the pipe behind it');
  assert.deepEqual(g.adj.get(pipe).map((l) => l.other), [v]);
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 50 }); sim.runTicks(3);
  assert.equal(W(sim).totals.leakedL, 0, 'shut valve: the open pipe end stays dry');
  sim.commandNow('parts.set', { id: v, key: 'open', value: true }); sim.runTicks(2);
  assert.ok(W(sim).totals.leakedL > 0, 'open valve: it pours out of the open end');
});

test('a tee feeds two taps', () => {
  const sim = make(); yard(sim);
  const v = put(sim, 'valve', 'a:out');
  const s1 = put(sim, 'pipe', v, null, 1);
  const e1 = put(sim, 'elbow', s1, [0, -1, 0]);
  const d = put(sim, 'pipe', e1, null, 4);
  const e2 = put(sim, 'elbow', d, [1, 0, 0]);
  const h = put(sim, 'pipe', e2, null, 3);              // x 1 -> 4 at y 2
  // the tee: through along x, branch toward +z
  const id = sim.commandNow('parts.spawn', { kind: 'tee', pose: {} }).id;
  const end = graph(sys, P(sim)).open.find((e) => e.part === h);
  const way = placements(sys, P(sim), 'tee', 0, end).find((w) => { const dirs = K.tee.ends.map((e) => rotate(w.rot, e.dir).join()); return dirs.includes('1,0,0') && dirs.includes('0,0,1'); });
  assert.equal(sim.commandNow('parts.fit', { id, at: way.at, rot: way.rot }).ok, true);
  const open = () => graph(sys, P(sim)).open.filter((e) => e.part === id);
  // branch one: on along x to the first tap
  const fitOn = (kind, e, len, leave) => {
    const pid = sim.commandNow('parts.spawn', { kind, len, pose: {} }).id;
    const w = placements(sys, P(sim), kind, len, e).find((x) => !leave || K[kind].ends.some((q) => rotate(x.rot, q.dir).join() === leave.join() && q.id !== x.end));
    assert.equal(sim.commandNow('parts.fit', { id: pid, at: w.at, rot: w.rot }).ok, true);
    return pid;
  };
  const hx = fitOn('pipe', open().find((e) => e.d.join() === '1,0,0'), 4);
  const e3 = put(sim, 'elbow', hx, [0, 1, 0]); put(sim, 'pipe', e3, null, 1);
  const hz = fitOn('pipe', open().find((e) => e.d.join() === '0,0,1'), 4);
  const e4 = put(sim, 'elbow', hz, [0, 1, 0]); put(sim, 'pipe', e4, null, 1);
  sim.commandNow('parts.set', { id: v, key: 'open', value: true });
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 150 });
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.commandNow('water.setTap', { id: 'tap2', open: true });
  sim.runTicks(3);
  assert.ok(W(sim).taps.tap.flowLmin > 1 && W(sim).taps.tap2.flowLmin > 1, 'both taps run');
  assert.equal(sim.state.sys.plumbing.pieces.filter((p) => p.kind === 'leak').length, 0);
  near(freshStoredL(W(sim)) + W(sim).totals.usedL, 150, 1e-6);
});

test('an open end leaks until the barrel is empty; a cap or a closed valve stops it; water is conserved', () => {
  const sim = make(); yard(sim);
  const r = runToTap(sim);
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: true });
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 120 });
  sim.runTicks(2);
  assert.equal(W(sim).totals.leakedL, 0, 'a closed run holds');
  // pull the last riser off: the end of the elbow is now open to the air
  sim.commandNow('parts.unfit', { id: r.up, pose: { x: 2, y: 0, z: 0 } });
  sim.runTicks(1);
  const leaks = sim.state.sys.plumbing.pieces.filter((p) => p.kind === 'leak');
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].part, r.e3);
  near(leaks[0].y, 2 * STEP, 1e-9);
  const lk = W(sim).leaks[leaks[0].id];
  assert.ok(lk.flowLmin > 20, 'an open 20 mm bore under a metre of head pours: ' + lk.flowLmin + ' L/min');
  const before = W(sim).tanks.barrel.storedL;
  assert.ok(before < 120);
  near(freshStoredL(W(sim)) + W(sim).totals.leakedL + W(sim).totals.usedL, 120, 1e-6, 'conserved');
  // close the valve: it stops
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: false });
  sim.runTicks(3);
  near(W(sim).tanks.barrel.storedL, before, 1e-9, 'held by the valve');
  assert.equal(sim.state.sys.plumbing.pieces.filter((p) => p.kind === 'leak').length, 0);
  // open again but cap the end (a cap goes on a pipe end, so the elbow comes off first)
  sim.commandNow('parts.unfit', { id: r.e3, pose: {} });
  put(sim, 'cap', r.h2);
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: true });
  sim.runTicks(3);
  near(W(sim).tanks.barrel.storedL, before, 1e-9, 'held by the cap');
  // take the cap off and let it run out
  const cap = Object.values(P(sim).parts).find((p) => p.kind === 'cap');
  sim.commandNow('parts.unfit', { id: cap.id, pose: {} });
  sim.runTicks(120);
  near(W(sim).tanks.barrel.storedL, 0, 1e-6);
  near(W(sim).totals.leakedL, 120, 1e-6);
});

test('pumping by hand: three strokes prime it, then each stroke lifts a litre, to the can or up to the barrel', () => {
  const sim = make(); yard(sim);
  const stroke = () => sim.commandNow('water.pumpStroke', { id: 'pump' });
  sim.runTicks(30);
  assert.equal(W(sim).tanks.barrel.storedL, 0, 'a manual pump moves nothing on its own');
  assert.deepEqual([stroke().priming, stroke().priming, stroke().priming], [true, true, undefined]);
  // the third stroke already delivered; at the spout by default
  let got = 1;
  for (let i = 0; i < 4; i++) { const r = stroke(); assert.equal(r.to, 'spout'); got += r.litres; }
  near(got, 5, 1e-9);
  near(W(sim).totals.wellL, 5, 1e-9); near(W(sim).totals.usedL, 5, 1e-9);
  assert.ok(W(sim).wells.well.levelM > 2, 'the well is drawn down a little');
  // into the can: it takes only what fits
  let can = 0;
  for (let i = 0; i < 12; i++) can += sim.commandNow('garden.fill', { litres: stroke().litres }).taken;
  near(can, CAN_L, 1e-9); near(sim.state.sys.garden.can.litres, CAN_L, 1e-9);
  // diverter to the barrel
  sim.commandNow('water.setPumpDivert', { id: 'pump', to: 'tank' });
  const before = W(sim).totals.wellL;
  for (let i = 0; i < 20; i++) assert.equal(stroke().to, 'tank');
  near(W(sim).tanks.barrel.storedL, 20, 1e-9);
  near(W(sim).totals.wellL - before, 20, 1e-9);
  // collected + well = stored + used + leaked
  near(W(sim).totals.wellL, freshStoredL(W(sim)) + W(sim).totals.usedL + W(sim).totals.leakedL + W(sim).totals.overflowL, 1e-6);
  // left for an hour it loses its prime
  sim.runTicks(60);
  assert.equal(stroke().priming, true);
});

test('the run survives save and load and keeps flowing', () => {
  const sim = make(); yard(sim);
  const r = runToTap(sim);
  sim.commandNow('parts.set', { id: r.v, key: 'open', value: true });
  sim.commandNow('water.fillTank', { id: 'barrel', litres: 80 });
  sim.commandNow('water.setTap', { id: 'tap', open: true });
  sim.runTicks(2);
  const again = make(); again.load(sim.serialize());
  again.runTicks(1); sim.runTicks(1);
  assert.equal(again.hash(), sim.hash());
  assert.ok(W(again).taps.tap.flowLmin > 1);
});
