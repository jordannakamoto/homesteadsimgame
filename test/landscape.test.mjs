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
  L(sim).plants[yes.id].g = 3;                                    // three years of growth
  const s3 = landscapeRead.plantSize(sim.state, yes.id, sim.state.lifeT);
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

test('stones settle: dig under a flagstone and it drops into the hollow', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.flagstone_40 = 1;
  const f = c(sim, 'landscape.place', { kind: 'flagstone', x: 0.15, z: 0.15 });
  const y0 = L(sim).things[f.id].y;
  assert.ok(c(sim, 'landscape.dig', { x: 0.15, z: 0.15 }).ok);
  assert.ok(L(sim).things[f.id].y < y0 - 0.05, 'it dropped');
});

test('wheelbarrow: fill it scoop by scoop, tip it all out in one heap', () => {
  const sim = makeSim();
  sim.state.sys.stock.tools.push('wheelbarrow');
  let n = 0;
  while (!c(sim, 'landscape.load', { x: 0.15 + (n % 3) * 0.3, z: 0.15 }).full && n < 20) n++;
  assert.ok(n >= 5 && n <= 8, n + ' scoops');
  assert.equal(c(sim, 'landscape.load', { x: 0.15, z: 0.15 }).ok, false, 'full');
  const t = c(sim, 'landscape.tip', { x: 5, z: 5 });
  assert.ok(t.ok && t.m3 > 0.09);
  near(netVolume(L(sim).grid), 0, 1e-3);
});

test('a new shrub dries out unless watered, roots in after three weeks, then copes on its own', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.plant_rose = 2; st.tools.push('watering_can');
  c(sim, 'landscape.setScale', { scale: 4 });
  for (const x of [1.05, 3.05]) { c(sim, 'landscape.dig', { x, z: 1.05 }); c(sim, 'landscape.dump', { x: x + 1, z: 3 }); }
  const a = c(sim, 'landscape.plant', { kind: 'rose', x: 1.05, z: 1.05 }), b = c(sim, 'landscape.plant', { kind: 'rose', x: 3.05, z: 1.05 });
  assert.ok(a.ok && b.ok, a.reason || b.reason);
  sim.state.sys.weather.tempC = 24;
  const g = sim.state.sys.garden;
  for (let d = 0; d < 24; d++) {
    g.can.litres = 9;
    c(sim, 'landscape.water', { x: 1.05, z: 1.05, litres: 6 });   // only the first is watered
    sim.runDays(1);
  }
  const pa = L(sim).plants[a.id], pb = L(sim).plants[b.id];
  assert.ok(pa.est >= 21 && pa.g > pb.g, 'watered one rooted and grew: est ' + pa.est + ', g ' + pa.g + ' vs ' + pb.g);
  assert.ok(pb.w < 0.2, 'the other is dry: ' + pb.w);
  assert.ok(landscapeRead.plantSize(sim.state, b.id, sim.state.lifeT).wilt);
});

test('a lined pond fills from the hose to its rim and no further, and loses a little to the sun', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.pond_liner = 10; st.tools.push('garden_hose');
  c(sim, 'landscape.setScale', { scale: 4 });
  // a 3 x 3 square hole, a scoop deep (about 30 cm)
  for (let gz = 0; gz < 3; gz++) for (let gx = 0; gx < 3; gx++) for (let i = 0; i < 1; i++) { c(sim, 'landscape.dig', { x: gx * 0.3 + 0.15, z: gz * 0.3 + 0.15 }); c(sim, 'landscape.dump', { x: 4 + gx * 0.3, z: 4 + gz * 0.3 }); }
  assert.equal(c(sim, 'landscape.hose', { x: 0.45, z: 0.45 }).ok, false, 'no liner yet');
  const ln = c(sim, 'landscape.line', { x: 0.45, z: 0.45, r: 0.5 });
  assert.ok(ln.ok && ln.cells === 9, ln.reason);
  assert.ok(c(sim, 'landscape.hose', { x: 0.45, z: 0.45, on: true }).ok);
  sim.runDays(1);
  const pd = landscapeRead.pondsOf(sim.state)[0];
  assert.ok(pd.m3 > pd.cap * 0.98 && pd.m3 <= pd.cap + 1e-9, pd.m3 + ' of ' + pd.cap);
  assert.equal(pd.hose, false, 'the hose shut off when full');
  assert.ok(pd.level <= pd.rim + 1e-6 && pd.level > -0.5);
  sim.state.sys.weather.tempC = 22;
  sim.runDays(3);
  const later = landscapeRead.pondsOf(sim.state)[0];
  assert.ok(later.m3 < pd.m3 && later.m3 > pd.m3 * 0.8, 'evaporation: ' + pd.m3 + ' -> ' + later.m3);
  // an iris on the shelf
  st.items.plant_iris = 1;
  assert.ok(c(sim, 'landscape.plant', { kind: 'iris', x: 0.15, z: 0.15 }).ok);
  // cutting into the liner lets the water out
  c(sim, 'landscape.dig', { x: 0.75, z: 0.75 });
  assert.equal(landscapeRead.pondsOf(sim.state).reduce((a, p) => a + p.m3, 0), 0);
});
