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

test('materials arrive as bags or a heap; a bag broken open spills where it lies, and laid on grass the weeds come fast', () => {
  const sim = makeSim();
  const st = sim.state.sys.stock;
  st.items.wood_chips = 3 * 56; st.items.gravel = 0.2;
  const d = c(sim, 'landscape.deliver', { item: 'wood_chips', qty: 3 * 56, x: 0, z: 0 });
  assert.ok(d.ok && d.bags === 3);
  const bag = L(sim).things[d.ids[0]];
  assert.ok(c(sim, 'landscape.moveThing', { id: bag.id, x: 4, z: 4 }).ok);
  const o = c(sim, 'landscape.open', { id: bag.id });
  assert.ok(o.ok && !L(sim).things[bag.id]);
  assert.equal(landscapeRead.groundAt(sim.state, 4, 4).s, 'woodchips');
  assert.ok(reliefAt(L(sim).grid, 4, 4) > 0.1, 'a heap');
  const g = c(sim, 'landscape.deliver', { item: 'gravel', qty: 0.2, x: 8, z: 0 });
  assert.ok(g.ok && reliefAt(L(sim).grid, 8, 0) > 0.15);
  // scoop chips off the heap and throw them: the shovel takes the layer, not the earth under it
  assert.equal(c(sim, 'landscape.dig', { x: 4, z: 4 }).s, 'woodchips');
  c(sim, 'landscape.dump', { x: 6, z: 6 });
  sim.runDays(14);
  assert.ok(landscapeRead.groundAt(sim.state, 6, 6).weeds >= 1, 'chips on grass: the grass comes through');
});

test('a dug hole keeps its walls; the thrown earth is loose and slumps to a cone', () => {
  const sim = makeSim();
  for (let k = 0; k < 6; k++) { assert.ok(c(sim, 'landscape.dig', { x: 2, z: 2 }).ok); assert.ok(c(sim, 'landscape.dump', { x: 3.2, z: 2 }).ok); }
  const g = L(sim).grid, hole = reliefAt(g, 2, 2), wall = reliefAt(g, 2.45, 2), heap = reliefAt(g, 3.2, 2);
  assert.ok(hole < -0.3, 'deep: ' + hole);
  assert.ok(wall > -0.06, 'the wall stands: ground 45 cm off the centre is near grade, ' + wall);
  assert.ok(heap > 0.12, 'a heap: ' + heap);
  // the heap is no steeper than loose earth stands
  let steep = 0;
  for (let i = 25; i < 40; i++) steep = Math.max(steep, Math.abs(reliefAt(g, (i + 1) / 10, 2) - reliefAt(g, i / 10, 2)) / 0.1);
  assert.ok(steep < 0.9, 'heap slope ' + steep.toFixed(2));
  // throw earth back in: it is loose and fills the hole
  const before = reliefAt(g, 2, 2);
  c(sim, 'landscape.dig', { x: 3.2, z: 2 }); c(sim, 'landscape.dump', { x: 2, z: 2 });
  assert.ok(reliefAt(g, 2, 2) > before + 0.05);
});

test('grains: a load poured into the air lands grain by grain; an over-steep heap sheds grains that roll down; nothing lost', () => {
  const sim = makeSim();
  const g = () => L(sim).grid;
  assert.ok(c(sim, 'landscape.dig', { x: 2, z: 2 }).ok);
  const m3 = L(sim).carry.m3;
  assert.ok(c(sim, 'landscape.pour', { x: 3, z: 2 }).ok && L(sim).carry.m3 === 0);
  // every grain lands on one spot: a steep spike
  const n = 40;
  c(sim, 'landscape.land', { pts: Array.from({ length: n }, () => [3, 2, m3 / n, 'soil']) });
  // grains lodge as they land: no slope steeper than loose earth stands
  let steep = 0; for (let i = 26; i < 40; i++) steep = Math.max(steep, Math.abs(reliefAt(g(), (i + 1) / 10, 2) - reliefAt(g(), i / 10, 2)) / 0.1);
  assert.ok(steep < 0.85, 'landed slope ' + steep.toFixed(2));
  // a loose spike (as if undercut) sheds grains that roll down until the slope holds
  fill(g(), 5, 5, 0.02, { r: 0.11, spread: false });
  const net0 = netVolume(g()), spike = reliefAt(g(), 5, 5);
  for (let k = 0; k < 200; k++) {
    const r = c(sim, 'landscape.shed', { x: 5, z: 5, r: 0.8 });
    if (!r.pts.length) break;
    c(sim, 'landscape.land', { pts: r.pts.map(([x, z, v, s, dx, dz]) => [x + dx * 0.15, z + dz * 0.15, v, s]) });
  }
  assert.ok(reliefAt(g(), 5, 5) < spike - 0.05, 'the spike slumped: ' + spike + ' -> ' + reliefAt(g(), 5, 5));
  const air = Object.values(L(sim).air || {}).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(netVolume(g()) + air - net0) < 1e-6, 'conserved: ' + netVolume(g()) + ' + ' + air);
  assert.ok(air < 1e-3, 'next to nothing left in the air: ' + air);
  // a bag spilt goes into the air, and lands where its grains come to rest
  L(sim).things.b1 = { id: 'b1', k: 'bag', x: 6, z: 6, yaw: 0, y: 0, ax: 6, az: 6, on: null, sag: 0, m: 'woodchips', L: 56 };
  const o = c(sim, 'landscape.open', { id: 'b1', spill: true });
  assert.ok(o.ok && L(sim).air.woodchips > 0.05);
  c(sim, 'landscape.land', { pts: [[6, 6, 0.056, 'woodchips']] });
  assert.equal(landscapeRead.groundAt(sim.state, 6, 6).s, 'woodchips');
});

test('the flat of the shovel: pushed across a heap it carries the earth on, fills a hollow and leaves the ground level', () => {
  const sim = makeSim();
  const g = () => L(sim).grid;
  // a heap at x = 3, a hollow at x = 5
  for (let k = 0; k < 3; k++) { c(sim, 'landscape.dig', { x: 5, z: 2 }); c(sim, 'landscape.dump', { x: 3, z: 2 }); }
  const net0 = netVolume(g()), heap0 = reliefAt(g(), 3, 2), hole0 = reliefAt(g(), 5, 2);
  assert.ok(heap0 > 0.15 && hole0 < -0.1);
  // push from x = 2 to x = 6 in short steps, the blade at grade (0)
  for (let x = 2; x < 6; x += 0.1) { const r = c(sim, 'landscape.push', { x0: x, z0: 2, x1: x + 0.1, z1: 2, level: 0 }); assert.ok(r.ok, r.reason); }
  assert.ok(reliefAt(g(), 3, 2) < 0.03, 'the heap is pushed away: ' + reliefAt(g(), 3, 2));
  assert.ok(reliefAt(g(), 5, 2) > hole0 + 0.08, 'the hollow filled: ' + hole0 + ' -> ' + reliefAt(g(), 5, 2));
  assert.ok(Math.abs(netVolume(g()) - net0) < 1e-6, 'conserved');
  // one push step is a short one
  assert.equal(c(sim, 'landscape.push', { x0: 0, z0: 0, x1: 0.6, z1: 0, level: 0 }).ok, false);
});

test('the blade pushed further in takes more; patted, loose earth goes smooth and firm; a fast push leaves no spires', () => {
  const sim = makeSim();
  const g = () => L(sim).grid;
  const a = c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.01 });
  assert.ok(a.ok && Math.abs(a.load - 0.01) < 1e-4);
  const b = c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.05, add: true });
  assert.ok(b.ok && Math.abs(b.load - b.cap) < 1e-4, 'filled to a full blade: ' + b.load);
  assert.equal(c(sim, 'landscape.dig', { x: 2, z: 2, add: true }).ok, false, 'no more than a full blade');
  c(sim, 'landscape.dump', { x: 4, z: 2 });
  // lumpy loose ground, patted: smoother, firm, same volume
  for (const [x, z] of [[6, 6], [6.15, 6.05], [5.9, 6.1]]) { c(sim, 'landscape.dig', { x: 8, z: 8 }); c(sim, 'landscape.land', {}); c(sim, 'landscape.pour', { x, z }); c(sim, 'landscape.land', { pts: [[x, z, L(sim).air.soil, 'soil']] }); }
  const rough = () => { let r = 0; for (let i = -2; i <= 2; i++) r += Math.abs(reliefAt(g(), 6 + i * 0.1, 6) * 2 - reliefAt(g(), 6 + (i - 1) * 0.1, 6) - reliefAt(g(), 6 + (i + 1) * 0.1, 6)); return r; };
  const r0 = rough(), v0 = netVolume(g());
  for (let k = 0; k < 3; k++) assert.ok(c(sim, 'landscape.pat', { x: 6, z: 6 }).ok);
  assert.ok(rough() < r0 * 0.6, 'smoother: ' + r0.toFixed(3) + ' -> ' + rough().toFixed(3));
  assert.ok(Math.abs(netVolume(g()) - v0) < 1e-6, 'conserved');
  assert.equal(landscapeRead.groundAt(sim.state, 6, 6).s, 'soil');
  // pushing a big heap fast (long steps) leaves nothing steeper than loose earth stands
  for (let k = 0; k < 6; k++) { c(sim, 'landscape.dig', { x: 12, z: 2 }); c(sim, 'landscape.dump', { x: 10, z: 2 }); }
  for (let x = 9.2; x < 11.6; x += 0.45) c(sim, 'landscape.push', { x0: x, z0: 2, x1: x + 0.45, z1: 2.1, level: 0 });
  c(sim, 'landscape.settle', { x: 11.65, z: 2.1, r: 0.9 });   // the blade lifted: its face no longer holds the ridge
  let steep = 0;
  for (let i = 88; i < 114; i++) for (let j = 15; j < 26; j++) { const h = reliefAt(g(), i / 10, j / 10), hx = reliefAt(g(), (i + 1) / 10, j / 10), hz = reliefAt(g(), i / 10, (j + 1) / 10); steep = Math.max(steep, Math.abs(hx - h) / 0.1, Math.abs(hz - h) / 0.1); }
  { let w = ''; for (let i = 88; i < 114; i++) for (let j = 15; j < 26; j++) { const h = reliefAt(g(), i / 10, j / 10), hx = reliefAt(g(), (i + 1) / 10, j / 10), hz = reliefAt(g(), i / 10, (j + 1) / 10); if (Math.max(Math.abs(hx - h), Math.abs(hz - h)) / 0.1 > 1) w += ' ' + i + ',' + j + ':' + h.toFixed(2) + '/' + hx.toFixed(2) + '/' + hz.toFixed(2); } assert.ok(steep < 1.0, 'no spires: steepest ' + steep.toFixed(2) + w); }
});

test('the blade: holds only so much (the rest spills to the sides), and stops at the firm wall of a hole', () => {
  const sim = makeSim();
  const g = () => L(sim).grid;
  for (let k = 0; k < 8; k++) { c(sim, 'landscape.dig', { x: 12, z: 2 }); c(sim, 'landscape.dump', { x: 10, z: 2 }); }
  const net0 = netVolume(g());
  for (let x = 9.2; x < 11; x += 0.1) c(sim, 'landscape.push', { x0: x, z0: 2, x1: x + 0.1, z1: 2, level: 0 });
  assert.ok(reliefAt(g(), 10, 2.45) > 0.03, 'spilt to the side: ' + reliefAt(g(), 10, 2.45));
  assert.ok(Math.abs(netVolume(g()) - net0) < 1e-6, 'conserved');
  // inside the hole, at its floor: pushing toward the wall stops at the wall
  const floor = reliefAt(g(), 12, 2);
  let blocked = false;
  for (let x = 11.95; x < 12.6 && !blocked; x += 0.05) blocked = !!c(sim, 'landscape.push', { x0: x, z0: 2, x1: x + 0.05, z1: 2, level: floor - 0.04 }).blocked;
  assert.ok(blocked, 'the wall of the hole stops the blade');
});

test('the garden builds on shovel work: thrown earth hoes into a bed at once, and the hoe keeps its shape', () => {
  const sim = makeSim();
  for (let k = 0; k < 3; k++) { c(sim, 'landscape.dig', { x: 2, z: 2 }); c(sim, 'landscape.dump', { x: 4.05, z: 4.05 }); }
  const gx = Math.floor(4.05 / 0.3), gz = Math.floor(4.05 / 0.3);
  const r = c(sim, 'garden.till', { cells: [[gx, gz]] });
  assert.ok(r.ok && r.worked === 1, 'one stroke works loose thrown earth: ' + JSON.stringify(r));
  // so is the floor of a dug hole (firm earth, but no sod on it)
  const hx = Math.floor(2 / 0.3), hz = Math.floor(2 / 0.3);
  const rh = c(sim, 'garden.till', { cells: [[hx, hz]] });
  assert.ok(rh.ok && rh.worked === 1, 'one stroke works a dug hole: ' + JSON.stringify(rh));
  // grass needs more than one
  const r2 = c(sim, 'garden.till', { cells: [[gx + 20, gz + 20]] });
  assert.ok(r2.ok && r2.worked === 0);
  // the hoe's tilth smooths but keeps the heap a heap, and loose
  const h0 = reliefAt(L(sim).grid, 4.05, 4.05);
  assert.ok(c(sim, 'landscape.tilth', { x: 4.05, z: 4.05 }).ok);
  assert.ok(reliefAt(L(sim).grid, 4.05, 4.05) > h0 * 0.7, 'still a heap');
});

test('each stamp on the blade bites wider', () => {
  const sim = makeSim();
  c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.01, r: 0.34 });
  c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.008, add: true, r: 0.5 });
  assert.ok(reliefAt(L(sim).grid, 2.42, 2) < -0.001, 'the ground 42 cm out (beyond a first bite) was dug: ' + reliefAt(L(sim).grid, 2.42, 2));
});

test('a stamped blade bites wider: the hole opens out with each stamp', () => {
  const sim = makeSim(), g = () => L(sim).grid;
  c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.01 });
  for (const r of [0.42, 0.5, 0.58]) c(sim, 'landscape.dig', { x: 2, z: 2, m3: 0.006, add: true, r });
  c(sim, 'landscape.dump', { x: 5, z: 5 });
  c(sim, 'landscape.dig', { x: 8, z: 2, m3: 0.028 });       // the same earth in one narrow bite
  assert.ok(reliefAt(g(), 2.45, 2) < -0.002 && reliefAt(g(), 8.45, 2) > -0.001, 'wider: ' + reliefAt(g(), 2.45, 2) + ' vs ' + reliefAt(g(), 8.45, 2));
});
