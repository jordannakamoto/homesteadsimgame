// Landscaping: the earthwork heightfield (cut, fill, settling to the angle of repose, rake), the shovel and the
// barrow, surfaces and how they are installed (fabric, tamping, weeds, settling stones), garden boxes, nursery
// plants, ponds, and what the shape of the ground does in the garden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stockSystem, garden, landscape, landscapeRead, SCOOP_M3 } from '../src/sim/index.js';
import { makeGrid, cut, fill, relax, netVolume, reliefAt, hAt, REPOSE } from '../src/sim/core/earthwork.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, a + ' is not ' + b);
const W = () => ({ name: 'weather', every: 60, init: () => ({ tempC: 15, totals: { precipMm: 0, snowfallMm: 0, meltMm: 0 } }), step() {} });
function makeSim() {
  const sim = createSim({ seed: 3, systems: [W(), stockSystem(), landscape, garden] });
  const st = sim.state.sys.stock;
  st.tools.push('rake', 'trowel', 'hoe', 'tamper', 'wheelbarrow', 'garden_hose', 'watering_can');
  st.money = 1e6;
  return sim;
}
const L = (sim) => sim.state.sys.landscape;
const c = (sim, name, p) => sim.commandNow(name, p);
const maxSlope = (g, x0, z0, x1, z1) => {
  let m = 0;
  for (let j = Math.round(z0 / 0.1); j < Math.round(z1 / 0.1); j++) for (let i = Math.round(x0 / 0.1); i < Math.round(x1 / 0.1); i++) m = Math.max(m, Math.abs(hAt(g, i + 1, j) - hAt(g, i, j)) / 0.1, Math.abs(hAt(g, i, j + 1) - hAt(g, i, j)) / 0.1);
  return m;
};

test('earthwork: a bite makes a round bowl, a load makes a heap that settles to its angle of repose, all conserved', () => {
  const g = makeGrid();
  const got = cut(g, 0, 0, 0.014, { r: 0.16 }).m3;
  near(got, 0.014, 2e-4);
  near(netVolume(g), -0.014, 2e-4);
  assert.ok(reliefAt(g, 0, 0) < -0.1, 'deepest in the middle: ' + reliefAt(g, 0, 0));
  assert.ok(reliefAt(g, 0.1, 0) > reliefAt(g, 0, 0) && reliefAt(g, 0.2, 0) > -0.01, 'a bowl, closing at the rim');
  fill(g, 3, 3, 0.08, { r: 0.2 });
  near(netVolume(g), 0.08 - 0.014, 5e-4);
  assert.ok(maxSlope(g, 2, 2, 4, 4) <= REPOSE + 0.05, 'slope ' + maxSlope(g, 2, 2, 4, 4));
  assert.ok(reliefAt(g, 3, 3) > 0.15, 'still a heap: ' + reliefAt(g, 3, 3));
  const v0 = netVolume(g);
  for (let i = 0; i < 20; i++) relax(g, 3, 3, 0.5, 0.8);
  near(netVolume(g), v0, 1e-3);
  assert.ok(reliefAt(g, 3, 3) < 0.2);
});

test('shovel: dig a scoop, throw it; skim turf, lay gravel, dig the gravel back up', () => {
  const sim = makeSim();
  const a = c(sim, 'landscape.dig', { x: 0, z: 0 });
  assert.ok(a.ok && a.turf, a.reason);
  near(a.m3, SCOOP_M3 * 4, 2e-4);                                   // four shovelfuls a scoop by default
  assert.equal(c(sim, 'landscape.dig', { x: 0.5, z: 0 }).ok, false, 'one load at a time');
  assert.ok(c(sim, 'landscape.dump', { x: 3, z: 3 }).ok);
  near(netVolume(L(sim).grid), 0, 2e-4);
  assert.equal(c(sim, 'landscape.spread', { surface: 'gravel', x: 6, z: 0, r: 0.3 }).ok, false, 'not on turf');
  c(sim, 'landscape.skim', { points: [[5.6, 0], [6, 0], [6.4, 0]] });
  sim.state.sys.stock.items.gravel = 1;
  assert.ok(c(sim, 'landscape.spread', { surface: 'gravel', x: 6, z: 0, r: 0.4, m3: 0.01 }).ok);
  assert.equal(landscapeRead.groundAt(sim.state, 6, 0).s, 'gravel');
  assert.equal(c(sim, 'landscape.dig', { x: 6, z: 0 }).s, 'gravel');
});

test('wheelbarrow: filled scoop by scoop, tipped out in one heap', () => {
  const sim = makeSim();
  let n = 0;
  while (!c(sim, 'landscape.load', { x: (n % 4) * 0.4, z: 0 }).full && n < 20) n++;
  assert.ok(n >= 3 && n <= 5, n + ' scoops');
  const t = c(sim, 'landscape.tip', { x: 5, z: 5 });
  assert.ok(t.ok && t.m3 > 0.09);
  near(netVolume(L(sim).grid), 0, 5e-4);
  assert.ok(reliefAt(L(sim).grid, 5, 5) > 0.1);
});

test('installation: stones on untamped ground sink; on tamped ground they stay; fabric keeps weeds out', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.flagstone_40 = 1; st.items.gravel = 1; st.items.landscape_fabric = 10;
  c(sim, 'landscape.skim', { points: [[0, 0]] }); c(sim, 'landscape.skim', { points: [[3, 0]] });
  for (let i = 0; i < 2; i++) assert.ok(c(sim, 'landscape.tamp', { x: 3, z: 0 }).ok);
  assert.equal(landscapeRead.groundAt(sim.state, 3, 0).tamped, 2);
  const a = c(sim, 'landscape.place', { kind: 'flagstone', x: 0, z: 0 }), b = c(sim, 'landscape.place', { kind: 'flagstone', x: 3, z: 0 });
  assert.ok(a.ok && b.ok && !a.firm && b.firm);
  const ya = L(sim).things[a.id].y, yb = L(sim).things[b.id].y;
  c(sim, 'landscape.skim', { points: [[0, 3], [0.3, 3]] }); c(sim, 'landscape.skim', { points: [[3, 3], [3.3, 3]] });
  assert.ok(c(sim, 'landscape.fabric', { x: 3.15, z: 3, r: 0.35 }).ok);
  c(sim, 'landscape.spread', { surface: 'gravel', x: 0.15, z: 3, r: 0.3, m3: 0.004 });
  c(sim, 'landscape.spread', { surface: 'gravel', x: 3.15, z: 3, r: 0.3, m3: 0.004 });
  sim.runDays(50);
  assert.ok(L(sim).things[a.id].y < ya - 0.02, 'the untamped one sank');
  near(L(sim).things[b.id].y, yb, 1e-6);
  const wa = landscapeRead.groundAt(sim.state, 0.15, 3).weeds, wb = landscapeRead.groundAt(sim.state, 3.15, 3).weeds;
  assert.ok(wa >= 2 && wb === 0, 'weeds without fabric ' + wa + ', with ' + wb);
  assert.ok(c(sim, 'landscape.weed', { x: 0.15, z: 3 }).ok);
  assert.equal(landscapeRead.groundAt(sim.state, 0.15, 3).weeds, 0);
});

test('a dry-stone wall goes up course by course; the top stone comes off first', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.stone = 10;
  const a = c(sim, 'landscape.place', { kind: 'wallstone', x: 2, z: 2 }), b = c(sim, 'landscape.place', { kind: 'wallstone', x: 2.03, z: 2 });
  assert.ok(b.stacked && b.course === 2);
  near(L(sim).things[b.id].y - L(sim).things[a.id].y, 0.2, 1e-6);
  assert.equal(c(sim, 'landscape.take', { id: a.id }).ok, false);
  assert.ok(c(sim, 'landscape.take', { id: b.id }).ok);
});

test('a garden box holds the earth put in it: no running out at the sides', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.garden_box_kit = 1; sim.state.sys.stock.items.raised_bed_mix = 2000;
  assert.ok(c(sim, 'landscape.place', { kind: 'gardenbox', x: 0, z: 0, yaw: 0 }).ok);
  for (let i = 0; i < 12; i++) c(sim, 'landscape.spread', { surface: 'bedmix', x: (i % 4) * 0.5 - 0.75, z: (i < 4 ? -0.3 : i < 8 ? 0 : 0.3), r: 0.4, m3: 0.07 });
  const g = L(sim).grid;
  assert.ok(reliefAt(g, 0, 0) > 0.15, 'filled: ' + reliefAt(g, 0, 0));
  assert.ok(Math.abs(reliefAt(g, 0, 0.9)) < 0.02, 'nothing outside: ' + reliefAt(g, 0, 0.9));
});

test('nursery plants: a hole as deep as the root ball; watered ones root in and grow, dry ones wilt', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.plant_rose = 2;
  assert.equal(c(sim, 'landscape.plant', { kind: 'rose', x: 1, z: 1 }).ok, false);
  c(sim, 'landscape.setScale', { scale: 4 });
  for (const x of [1, 3]) for (let k = 0; k < 2; k++) { c(sim, 'landscape.dig', { x, z: 1 }); c(sim, 'landscape.dump', { x: x + 1.2, z: 3 }); }
  const a = c(sim, 'landscape.plant', { kind: 'rose', x: 1, z: 1 }), b = c(sim, 'landscape.plant', { kind: 'rose', x: 3, z: 1 });
  assert.ok(a.ok && b.ok, a.reason || b.reason);
  assert.ok(Math.abs(reliefAt(L(sim).grid, 1, 1)) < 0.05, 'filled back round the root ball');
  sim.state.sys.weather.tempC = 24;
  const g = sim.state.sys.garden;
  for (let d = 0; d < 24; d++) { g.can.litres = 9; c(sim, 'landscape.water', { x: 1, z: 1, litres: 6 }); sim.runDays(1); }
  const pa = L(sim).plants[a.id], pb = L(sim).plants[b.id];
  assert.ok(pa.est >= 21 && pa.g > pb.g);
  assert.ok(landscapeRead.plantSize(sim.state, b.id).wilt);
});

test('a lined pond fills from the hose to its rim and no further; cutting the liner lets it out', () => {
  const sim = makeSim();
  sim.state.sys.stock.items.pond_liner = 20;
  c(sim, 'landscape.setScale', { scale: 4 });
  for (let k = 0; k < 9; k++) { c(sim, 'landscape.dig', { x: (k % 3) * 0.25, z: Math.floor(k / 3) * 0.25 }); c(sim, 'landscape.dump', { x: 5, z: 5 }); }
  assert.equal(c(sim, 'landscape.hose', { x: 0.25, z: 0.25 }).ok, false, 'no liner yet');
  assert.ok(c(sim, 'landscape.line', { x: 0.25, z: 0.25 }).ok);
  const h = c(sim, 'landscape.hose', { x: 0.25, z: 0.25, on: true });
  assert.ok(h.ok, h.reason);
  sim.runDays(1);
  const pd = landscapeRead.pondsOf(sim.state)[0];
  assert.ok(pd.m3 > pd.cap * 0.97 && !pd.hose, pd.m3 + ' of ' + pd.cap);
  assert.ok(pd.level <= pd.rim + 1e-6);
  c(sim, 'landscape.dig', { x: 0.25, z: 0.25 });
  assert.equal(landscapeRead.pondsOf(sim.state).reduce((a, p) => a + p.m3, 0), 0);
});

test('garden: seed by hand goes into a drill or a hole; a basin catches the rain that runs off a hill', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.seed_radish = 2; st.items.seed_potato = 1;
  const cells = []; for (let x = 0; x < 5; x++) cells.push([x, 0]);
  for (let i = 0; i < 2; i++) c(sim, 'garden.till', { cells });
  const bed = Object.values(sim.state.sys.garden.field.groups)[0];
  assert.equal(c(sim, 'garden.sow', { crop: 'radish', bed: bed.id, cells: [0], inOpening: true }).ok, false);
  c(sim, 'garden.open', { cells: [[0, 0]], kind: 'drill', axis: 'x' });
  assert.ok(c(sim, 'garden.sow', { crop: 'radish', bed: bed.id, cells: [0], inOpening: true }).ok);
  assert.equal(c(sim, 'garden.sow', { crop: 'potato', bed: bed.id, cells: [1], inOpening: true }).ok, false);
  c(sim, 'landscape.setScale', { scale: 1 });
  c(sim, 'landscape.dig', { x: 0.75, z: 0.15 }); c(sim, 'landscape.dump', { x: 1.35, z: 0.15 });
  const before = bed.cells.map((q) => q.w + q.d);
  sim.state.sys.garden.last = { rain: 0, melt: 0 };
  sim.state.sys.weather.totals.precipMm = 10;
  sim.runTicks(60);
  const got = bed.cells.map((q, i) => q.w + q.d - before[i]);
  assert.ok(got[2] > got[3] && got[4] < got[3], 'basin ' + got[2].toFixed(2) + ', flat ' + got[3].toFixed(2) + ', hill ' + got[4].toFixed(2));
});
