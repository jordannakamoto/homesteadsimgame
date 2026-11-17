// Landscaping: the earthwork grid (cut, fill, slump, rake), the shovel's loads, surfaces, stones, nursery plants, sown
// lawns, and what the shape of the ground does in the garden (sowing openings, hills, basins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stockSystem, garden, landscape, landscapeRead, DAY, SCOOP_M3 } from '../src/sim/index.js';
import { makeGrid, cut, fill, relax, netVolume, reliefAt, heightOf, keyOf } from '../src/sim/core/earthwork.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, a + ' is not ' + b);
const W = () => ({ name: 'weather', every: 60, init: () => ({ tempC: 15, totals: { precipMm: 0, snowfallMm: 0, meltMm: 0 } }), step() {} });
function makeSim() {
  const sim = createSim({ seed: 3, systems: [W(), stockSystem(), landscape, garden] });
  const st = sim.state.sys.stock;
  st.tools.push('rake', 'trowel', 'hoe');
  st.money = 1e6;
  return sim;
}
const L = (sim) => sim.state.sys.landscape;
const c = (sim, name, p) => sim.commandNow(name, p);

test('earthwork: what is cut and filled balances, and loose soil runs down to its angle of repose', () => {
  const g = makeGrid(0.3);
  const got = cut(g, 0, 0, 0.007).m3;
  near(got, 0.007, 1e-4);
  near(netVolume(g), -0.007, 1e-4);
  // a big heap on one square spreads over the turf around it, conserving the volume
  fill(g, 5, 5, 0.06);
  near(netVolume(g), 0.06 - 0.007, 1e-3);
  for (const k in g.sq) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const a = g.sq[k], b = g.sq[keyOf(x + dx, z + dz)];
      if (a[1] && b && b[1]) assert.ok(Math.abs(a[0] - b[0]) <= 0.2 + 1e-3, 'step too steep at ' + k);
    }
  }
  assert.ok(heightOf(g, 5, 5) > 0.15 && heightOf(g, 5, 5) < 0.5, 'a heap, not a spike: ' + heightOf(g, 5, 5));
  // the shape closes against untouched ground: zero on the edge of a single dug square, its own depth at the centre
  const g2 = makeGrid(0.3);
  cut(g2, 0, 0, 0.009);
  near(reliefAt(g2, 0.15, 0.15), -0.1, 1e-3);
  near(reliefAt(g2, 0, 0.15), 0, 1e-9);
  // raking smooths without making or losing soil
  const v0 = netVolume(g);
  for (let i = 0; i < 6; i++) relax(g, 1.65, 1.65, 0.6, 0.8);
  near(netVolume(g), v0, 1e-3);
});

test('shovel: dig a scoop, carry it, toss it; a gravel path is dug out, laid and dug back up', () => {
  const sim = makeSim();
  const a = c(sim, 'landscape.dig', { x: 0.1, z: 0.1 });
  assert.ok(a.ok && a.turf, a.reason);
  near(a.m3, SCOOP_M3 * 2, 1e-4);                                 // the default is two shovelfuls a scoop
  assert.equal(c(sim, 'landscape.dig', { x: 0.4, z: 0.1 }).ok, false, 'one load at a time');
  const d = c(sim, 'landscape.dump', { x: 3, z: 3 });
  assert.ok(d.ok && d.h > 0);
  near(netVolume(L(sim).grid), 0, 1e-4);
  // gravel needs the turf off first
  assert.equal(c(sim, 'landscape.spread', { surface: 'gravel', x: 1.5, z: 0.15, r: 0.3 }).ok, false);
  c(sim, 'landscape.skim', { cells: [[4, 0], [5, 0], [6, 0]] });
  sim.state.sys.stock.items.gravel = 1;
  const s = c(sim, 'landscape.spread', { surface: 'gravel', x: 1.65, z: 0.15, r: 0.3, m3: 0.006 });
  assert.ok(s.ok, s.reason);
  const q = landscapeRead.squareAt(sim.state, 5, 0);
  assert.equal(q[1], 'gravel');
  // digging it up gives the gravel back on the shovel first
  const g = c(sim, 'landscape.dig', { x: 1.65, z: 0.15 });
  assert.equal(g.s, 'gravel');
});

test('stones: a wall goes up course by course; the top stone comes off first', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.stone = 10;
  const a = c(sim, 'landscape.place', { kind: 'wallstone', x: 2, z: 2, yaw: 0 });
  const b = c(sim, 'landscape.place', { kind: 'wallstone', x: 2.03, z: 2, yaw: 0 });
  assert.ok(a.ok && b.ok && b.stacked && b.course === 2);
  near(L(sim).things[b.id].y - L(sim).things[a.id].y, 0.2, 1e-6);
  assert.equal(c(sim, 'landscape.take', { id: a.id }).ok, false);
  assert.ok(c(sim, 'landscape.take', { id: b.id }).ok);
  assert.equal(sim.state.sys.stock.items.stone, 9);
});

test('nursery plants go in a hole as deep as the root ball, and grow over the years', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.plant_hydrangea = 1;
  const no = c(sim, 'landscape.plant', { kind: 'hydrangea', x: 1, z: 1 });
  assert.equal(no.ok, false);
  c(sim, 'landscape.setScale', { scale: 1 });
  for (let i = 0; i < 3; i++) { c(sim, 'landscape.dig', { x: 1.05, z: 1.05 }); c(sim, 'landscape.dump', { x: 4, z: 4 }); }
  const yes = c(sim, 'landscape.plant', { kind: 'hydrangea', x: 1, z: 1 });
  assert.ok(yes.ok, yes.reason);
  near(heightOf(L(sim).grid, 3, 3), 0, 1e-3);                     // filled back to the ground around it
  const s0 = landscapeRead.plantSize(sim.state, yes.id, sim.state.lifeT);
  const s3 = landscapeRead.plantSize(sim.state, yes.id, sim.state.lifeT + 3 * 365 * DAY);
  assert.ok(s3.h > s0.h * 2 && s3.k > 0.85);
});

test('a sown lawn knits back into turf after three warm weeks', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.grass_seed = 1;
  c(sim, 'landscape.skim', { cells: [[0, 0], [1, 0]] });
  const r = c(sim, 'landscape.seedLawn', { x: 0.3, z: 0.15, r: 0.3 });
  assert.ok(r.ok && r.cells === 2, r.reason);
  sim.runDays(10);
  assert.equal(landscapeRead.squareAt(sim.state, 0, 0)[1], 'lawn_sown');
  sim.runDays(12);
  const q = landscapeRead.squareAt(sim.state, 0, 0);
  assert.ok(!q || q[1] === '', 'turf again');
});

test('garden: seed by hand goes into a drill or a hole, deep crops only into a hole', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.seed_radish = 2; st.items.seed_potato = 1;
  const cells = []; for (let x = 0; x < 4; x++) cells.push([x, 0]);
  for (let i = 0; i < 2; i++) c(sim, 'garden.till', { cells });
  const bed = Object.values(sim.state.sys.garden.field.groups)[0];
  assert.equal(c(sim, 'garden.sow', { crop: 'radish', bed: bed.id, cells: [0], inOpening: true }).ok, false);
  c(sim, 'garden.open', { cells: [[0, 0], [1, 0]], kind: 'drill', axis: 'x' });
  assert.ok(c(sim, 'garden.sow', { crop: 'radish', bed: bed.id, cells: [0], inOpening: true }).ok);
  assert.equal(bed.cells[0].open, undefined, 'the drill is covered over the seed');
  assert.equal(c(sim, 'garden.sow', { crop: 'potato', bed: bed.id, cells: [1], inOpening: true }).ok, false, 'a potato wants a hole');
  c(sim, 'garden.open', { cells: [[2, 0]], kind: 'hole' });
  assert.ok(c(sim, 'garden.sow', { crop: 'potato', bed: bed.id, cells: [2], inOpening: true }).ok);
});

test('garden: a basin catches the rain that runs off the hill beside it, and the bed gets all of it', () => {
  const sim = makeSim();
  const cells = []; for (let x = 0; x < 5; x++) cells.push([x, 0]);
  for (let i = 0; i < 2; i++) c(sim, 'garden.till', { cells });
  c(sim, 'landscape.setScale', { scale: 1 });
  c(sim, 'landscape.dig', { x: 0.15, z: 0.15 }); c(sim, 'landscape.dump', { x: 1.35, z: 0.15 });
  const bed = Object.values(sim.state.sys.garden.field.groups)[0];
  const before = bed.cells.map((q) => q.w + q.d);
  const w = sim.state.sys.weather;
  w.totals.precipMm = 0; sim.state.sys.garden.last = { rain: 0, melt: 0 };
  w.totals.precipMm = 10;
  sim.runTicks(60);
  const got = bed.cells.map((q, i) => q.w + q.d - before[i]);
  assert.ok(got[0] > got[2] && got[4] < got[2], 'basin ' + got[0].toFixed(2) + ', flat ' + got[2].toFixed(2) + ', hill ' + got[4].toFixed(2));
});
