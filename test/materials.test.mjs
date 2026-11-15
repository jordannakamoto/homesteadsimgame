// Materials, items and stock: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FOOD_STARTER, foodId } from '../src/sim/food-catalog.js';
import {
  MATERIALS, material, MATERIAL_CLASSES, APPEARANCE_MATERIAL, APPEARANCE_BY_KIND, rValue,
  ITEMS, ITEM_CATEGORIES, unitVolumeM3,
  createGameSim, makeSave, readSave, stockMassKg, canAfford, toolAvailable, START_MONEY_USD, STARTER_TOOLS,
  stockAdd, stockRemove, stockBuy, setCounter, runStockCommand,
} from '../src/sim/index.js';

const mats = Object.values(MATERIALS);
const within = (v, a, b, msg) => assert.ok(v >= a && v <= b, `${msg}: ${v} not in [${a}, ${b}]`);
const near = (v, ref, tolFrac, msg) => assert.ok(Math.abs(v - ref) <= Math.abs(ref) * tolFrac, `${msg}: ${v} vs ${ref} (+-${tolFrac * 100}%)`);

test('there are at least 35 materials, each with every required field', () => {
  assert.ok(mats.length >= 35, 'count ' + mats.length);
  for (const m of mats) {
    assert.equal(MATERIALS[m.id], m);
    assert.equal(material(m.id), m);
    assert.ok(typeof m.name === 'string' && m.name, m.id + ' name');
    assert.ok(MATERIAL_CLASSES.includes(m.class), m.id + ' class ' + m.class);
    for (const f of ['densityKgM3', 'conductivityWmK', 'specificHeatJkgK']) assert.ok(Number.isFinite(m[f]) && m[f] > 0, m.id + ' ' + f);
    for (const f of ['bendingStrengthMPa', 'compressiveStrengthMPa', 'elasticModulusGPa']) if (f in m) assert.ok(Number.isFinite(m[f]) && m[f] > 0, m.id + ' ' + f);
    assert.ok(m.source, m.id + ' names its source');
    assert.ok(Object.isFrozen(m));
  }
  assert.ok(Object.isFrozen(MATERIALS));
  for (const id of ['spf_seasoned', 'douglas_fir', 'western_redcedar', 'pine_seasoned', 'oak_seasoned', 'plywood', 'osb', 'glulam', 'concrete', 'brick_clay', 'granite', 'mortar',
    'cob', 'adobe', 'rammed_earth', 'steel', 'aluminium', 'copper', 'mineral_wool', 'fibreglass_batt', 'cellulose', 'eps', 'xps', 'polyiso', 'sheep_wool', 'straw_bale', 'float_glass', 'dgu',
    'polycarbonate', 'asphalt_shingle', 'steel_roofing', 'cedar_shake', 'thatch', 'slate', 'epdm', 'gypsum_board', 'lime_plaster', 'housewrap', 'poly_vapour_barrier', 'canvas',
    'water', 'soil_dry', 'soil_moist', 'gravel', 'air']) assert.ok(MATERIALS[id], 'missing ' + id);
});

test('values sit inside sane physical ranges for their class', () => {
  const R = {
    wood: { rho: [350, 1100], k: [0.09, 0.25], cp: [1400, 2600] },
    masonry: { rho: [600, 3000], k: [0.15, 4], cp: [700, 1100] },
    metal: { rho: [2600, 9000], k: [30, 450], cp: [350, 950] },
    insulation: { rho: [8, 120], k: [0.02, 0.07], cp: [800, 2100] },
    glass: { rho: [500, 2600], k: [0.02, 1.1], cp: [700, 1300] },
    roofing: { rho: [100, 8000], k: [0.05, 55], cp: [400, 2000] },
    earth: { rho: [1200, 2100], k: [0.25, 1.6], cp: [700, 1500] },
    membrane: { rho: [800, 1000], k: [0.2, 0.6], cp: [1500, 2500] },
    fabric: { rho: [100, 800], k: [0.03, 0.15], cp: [1000, 1600] },
    fluid: { rho: [1, 1100], k: [0.02, 0.7], cp: [1000, 4300] },
  };
  for (const m of mats) {
    const r = R[m.class];
    within(m.densityKgM3, ...r.rho, m.id + ' density');
    within(m.conductivityWmK, ...r.k, m.id + ' conductivity');
    within(m.specificHeatJkgK, ...r.cp, m.id + ' specific heat');
    if (m.compressiveStrengthMPa && m.bendingStrengthMPa && m.class === 'wood') assert.ok(m.compressiveStrengthMPa <= m.bendingStrengthMPa * 1.3, m.id);
  }
  // seasoned softwoods 350-600, hardwoods 600-900, green logs heavier than their seasoned wood
  for (const id of ['spf_seasoned', 'douglas_fir', 'western_redcedar', 'pine_seasoned']) within(MATERIALS[id].densityKgM3, 350, 600, id);
  for (const id of ['oak_seasoned', 'birch_seasoned']) within(MATERIALS[id].densityKgM3, 600, 900, id);
  for (const id of ['pine', 'birch', 'oak']) assert.ok(MATERIALS['log_' + id + '_green'].densityKgM3 > MATERIALS[id + '_seasoned'].densityKgM3 * 1.3, id + ' green vs seasoned');
  // stiffer and stronger things are ordered as in life
  assert.ok(MATERIALS.steel.elasticModulusGPa > MATERIALS.aluminium.elasticModulusGPa);
  assert.ok(MATERIALS.aluminium.elasticModulusGPa > MATERIALS.oak_seasoned.elasticModulusGPa);
  assert.ok(MATERIALS.concrete.compressiveStrengthMPa > MATERIALS.rammed_earth.compressiveStrengthMPa);
  assert.ok(MATERIALS.dgu.uValueWm2K > MATERIALS.dgu_lowe.uValueWm2K);
  for (const id of ['dgu', 'dgu_lowe']) {
    const m = MATERIALS[id];
    near(m.conductivityWmK, m.uValueWm2K * m.thicknessM, 0.01, id + ' effective conductivity = U x thickness');
    near(rValue(id, m.thicknessM), 1 / m.uValueWm2K, 1e-9, id + ' R');
  }
});

test('spot checks against handbook values', () => {
  near(MATERIALS.steel.densityKgM3, 7850, 0.01, 'steel density');
  near(MATERIALS.steel.elasticModulusGPa, 210, 0.01, 'steel E');
  near(MATERIALS.water.specificHeatJkgK, 4186, 0.001, 'water cp');
  near(MATERIALS.water.conductivityWmK, 0.6, 0.03, 'water k');
  near(MATERIALS.water.densityKgM3, 1000, 0.01, 'water density');
  near(MATERIALS.air.densityKgM3, 1.2, 0.02, 'air density');
  near(MATERIALS.air.conductivityWmK, 0.026, 0.03, 'air k');
  near(MATERIALS.air.specificHeatJkgK, 1006, 0.01, 'air cp');
  near(MATERIALS.aluminium.densityKgM3, 2700, 0.02, 'aluminium density');
  near(MATERIALS.copper.conductivityWmK, 390, 0.06, 'copper k');
  near(MATERIALS.copper.densityKgM3, 8960, 0.02, 'copper density');
  near(MATERIALS.concrete.densityKgM3, 2400, 0.05, 'concrete density');
  near(MATERIALS.float_glass.densityKgM3, 2500, 0.02, 'glass density');
  near(MATERIALS.float_glass.elasticModulusGPa, 70, 0.03, 'glass E');
  near(MATERIALS.float_glass.conductivityWmK, 1.0, 0.1, 'glass k');
  near(MATERIALS.dgu.uValueWm2K, 2.8, 0.05, 'clear DGU U');
  near(MATERIALS.spf_seasoned.densityKgM3, 420, 0.1, 'SPF density (EN 338 C24)');
  near(MATERIALS.spf_seasoned.elasticModulusGPa, 11, 0.05, 'SPF E (C24)');
  near(MATERIALS.douglas_fir.densityKgM3, 530, 0.05, 'Douglas fir density');
  near(MATERIALS.douglas_fir.elasticModulusGPa, 13.4, 0.03, 'Douglas fir E');
  near(MATERIALS.glulam.elasticModulusGPa, 11.5, 0.03, 'GL24h E');
  near(MATERIALS.oak_seasoned.densityKgM3, 760, 0.05, 'white oak density');
  near(MATERIALS.eps.conductivityWmK, 0.038, 0.1, 'EPS k');
  near(MATERIALS.polyiso.conductivityWmK, 0.024, 0.1, 'polyiso k');
  near(MATERIALS.fibreglass_batt.conductivityWmK, 0.04, 0.05, 'fibreglass k');
  near(MATERIALS.slate.densityKgM3, 2800, 0.02, 'slate density');
  near(MATERIALS.granite.conductivityWmK, 2.8, 0.05, 'granite k');
  near(MATERIALS.epdm.densityKgM3, 1150, 0.02, 'EPDM density');
  // wood heat capacity follows the moisture mixture rule: wetter wood stores more heat per kg
  assert.ok(MATERIALS.log_oak_green.specificHeatJkgK > 2000 && MATERIALS.oak_seasoned.specificHeatJkgK < 1700);
  // R per 100 mm: fibreglass about RSI 2.5 (R-3.5/in x 3.94 in = 13.8 -> 2.4 SI)
  near(rValue('fibreglass_batt', 0.1), 2.5, 0.05, 'R per 100 mm fibreglass');
});

test('every build-mode appearance name maps to a registry material', () => {
  const src = fs.readFileSync(new URL('../src/build.js', import.meta.url), 'utf8');
  const table = (name) => {
    let i = src.indexOf('const ' + name + ' = {') + ('const ' + name + ' = ').length, depth = 0, j = i;
    do { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; } while (depth > 0);
    return [...src.slice(i, j).matchAll(/([a-z]+): \{ name:/g)].map((m) => m[1]);
  };
  for (const [kind, tableName] of [['wall', 'WALLS'], ['floor', 'FLOORS'], ['roof', 'ROOFS'], ['path', 'PATHS']]) {
    const names = table(tableName);
    assert.ok(names.length >= 4, tableName + ' parsed: ' + names);
    for (const n of names) {
      assert.ok(APPEARANCE_BY_KIND[kind][n], `${kind} "${n}" has no material`);
      assert.ok(MATERIALS[APPEARANCE_BY_KIND[kind][n]], `${kind} "${n}" -> unknown material`);
      assert.equal(APPEARANCE_MATERIAL[n], APPEARANCE_BY_KIND[kind][n], `flat map agrees for ${n}`);
    }
    assert.deepEqual(Object.keys(APPEARANCE_BY_KIND[kind]).sort(), [...names].sort(), kind + ' has no stale or missing names');
  }
  for (const id of Object.values(APPEARANCE_MATERIAL)) assert.ok(MATERIALS[id]);
});

test('items: every material exists and mass equals density x volume', () => {
  const items = Object.values(ITEMS);
  assert.ok(items.length >= 50);
  const cats = new Set(ITEM_CATEGORIES.map((c) => c.id));
  for (const it of items) {
    assert.ok(cats.has(it.category), it.id + ' category');
    assert.ok(['each', 'm', 'm2', 'm3', 'kg', 'L'].includes(it.unit), it.id + ' unit');
    assert.ok(it.priceUsd > 0 && it.massKgPerUnit > 0, it.id);
    if (it.material) {
      const m = MATERIALS[it.material];
      assert.ok(m, it.id + ' material ' + it.material);
      const expected = it.unit === 'kg' ? 1 : m.densityKgM3 * unitVolumeM3(it);
      near(it.massKgPerUnit, it.unit === 'L' ? m.densityKgM3 / 1000 : expected, 1e-9, it.id + ' mass');
    }
    if (it.dims) assert.ok(it.material, it.id + ' has dims, so it needs a material');
    if (it.category === 'tools_power') assert.ok(it.powerW > 0, it.id + ' powerW');
  }
  // real lumber sizes and weights
  assert.deepEqual(ITEMS.lumber_2x4.dims, { widthM: 0.038, depthM: 0.089 });
  near(ITEMS.lumber_2x4.massKgPerUnit, 420 * 0.038 * 0.089, 1e-9, '2x4 per metre');
  within(ITEMS.lumber_2x4.massKgPerUnit * 2.44, 2.5, 4, 'an 8 ft 2x4 weighs about 3 kg');
  within(ITEMS.plywood_12.massKgPerUnit, 14, 22, 'a 12 mm plywood sheet');
  within(ITEMS.gypsum_13.massKgPerUnit, 20, 30, 'a 12.7 mm drywall sheet');
  within(ITEMS.straw_bale.massKgPerUnit, 12, 25, 'a straw bale');
  within(ITEMS.glass_dgu.massKgPerUnit, 18, 22, 'double glazing kg/m2');
  for (const id of ['axe', 'hatchet', 'bow_saw', 'hand_saw', 'hammer', 'chisel_set', 'hand_drill', 'shovel', 'level', 'tape']) assert.equal(ITEMS[id].category, 'tools_hand');
  for (const id of ['circular_saw', 'power_drill', 'chainsaw', 'table_saw']) assert.ok(ITEMS[id].powerW >= 500);
  for (const id of ['2x4', '2x6', '2x8', '2x10', '4x4', '6x6']) assert.ok(ITEMS['lumber_' + id]);
});

const fresh = (seed = 1) => createGameSim(seed);
const money = (sim) => sim.state.sys.stock.money;
const totalSpent = (before, after) => Math.round((before - after) * 100) / 100;

test('a new world starts with money and a starter kit', () => {
  const s = fresh().state.sys.stock;
  assert.equal(s.money, START_MONEY_USD);
  assert.deepEqual(s.tools, [...STARTER_TOOLS]);
  assert.deepEqual(s.items, Object.fromEntries(Object.entries(FOOD_STARTER).map(([id, qty]) => [foodId(id), qty])));
  assert.ok(s.projects.length >= 3 && s.projects.every((p) => p.status === 'open' && p.title && p.blurb));
  assert.equal(toolAvailable(s, 'axe', false), true);
  assert.equal(toolAvailable(s, 'circular_saw', true), false, 'not owned');
});

test('buy, add and remove conserve money and mass', () => {
  const sim = fresh(), s = sim.state.sys.stock;
  const m0 = stockMassKg(sim.state), $0 = s.money;
  let r = runStockCommand(sim, 'stock.buy', { id: 'lumber_2x4', qty: 20 });
  assert.ok(r.ok);
  assert.equal(totalSpent($0, s.money), 39);
  near(stockMassKg(sim.state) - m0, 20 * ITEMS.lumber_2x4.massKgPerUnit, 1e-9, 'mass gained');
  r = runStockCommand(sim, 'stock.buy', { id: 'ins_mineral_89', qty: 7.5 });
  assert.ok(r.ok); assert.equal(s.items.ins_mineral_89, 7.5);
  r = runStockCommand(sim, 'stock.buy', { id: 'circular_saw', qty: 1 });
  assert.ok(r.ok && s.tools.includes('circular_saw'));
  assert.equal(toolAvailable(sim.state, 'circular_saw', false), false, 'no power yet');
  assert.equal(toolAvailable(sim.state, 'circular_saw', true), true);
  const spent = 39 + 7.5 * 10.5 + 110;
  near($0 - s.money, spent, 1e-9, 'money spent');
  const mBefore = stockMassKg(sim.state);
  r = runStockCommand(sim, 'stock.remove', { id: 'lumber_2x4', qty: 5 });
  assert.ok(r.ok); assert.equal(s.items.lumber_2x4, 15);
  near(mBefore - stockMassKg(sim.state), 5 * ITEMS.lumber_2x4.massKgPerUnit, 1e-9, 'mass removed');
  assert.equal(s.money, Math.round((START_MONEY_USD - spent) * 100) / 100, 'removing does not refund');
  runStockCommand(sim, 'stock.remove', { id: 'lumber_2x4', qty: 15 });
  assert.ok(!('lumber_2x4' in s.items), 'empty stacks are deleted');
  runStockCommand(sim, 'stock.add', { id: 'log_oak', qty: 0.4 });
  assert.equal(s.items.log_oak, 0.4);
});

test('unaffordable and invalid purchases leave state untouched and say why', () => {
  const sim = fresh();
  const events = [];
  sim.listen((type, data) => { if (type.startsWith('stock.')) events.push([type, data]); });
  const snap = JSON.stringify(sim.state.sys.stock);
  const bad = [
    { id: 'no_such_item', qty: 1 }, { id: 'lumber_2x4', qty: 0 }, { id: 'lumber_2x4', qty: -3 }, { id: 'lumber_2x4', qty: NaN },
    { id: 'lumber_2x4', qty: Infinity }, { id: 'lumber_2x4', qty: '5' }, { id: 'plywood_12', qty: 1.5 },
    { id: 'table_saw', qty: 2 }, { id: 'glass_dgu_lowe', qty: 1000 }, { id: 'axe', qty: 1 },
  ];
  for (const p of bad) {
    const r = runStockCommand(sim, 'stock.buy', p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.ok(r.reason, 'reason for ' + JSON.stringify(p));
    assert.equal(JSON.stringify(sim.state.sys.stock), snap, 'state changed by ' + JSON.stringify(p));
  }
  assert.equal(events.length, bad.length, 'an event is emitted either way');
  assert.ok(events.every(([t, d]) => t === 'stock.buy' && d.ok === false));
  assert.equal(runStockCommand(sim, 'stock.remove', { id: 'lumber_2x4', qty: 1 }).ok, false);
  assert.equal(runStockCommand(sim, 'stock.add', { id: 'lumber_2x4', qty: -1 }).ok, false);
  assert.equal(JSON.stringify(sim.state.sys.stock), snap);
  // exactly affordable works, one cent less does not
  const s = sim.state.sys.stock; s.money = 110;
  assert.equal(stockBuy(s, 'circular_saw', 1).ok, true); assert.equal(s.money, 0);
  s.money = 109.99; s.tools.pop();
  assert.equal(stockBuy(s, 'circular_saw', 1).ok, false); assert.equal(s.money, 109.99);
  assert.equal(canAfford(sim.state, 'circular_saw', 1), false);
  assert.equal(canAfford(sim.state, 'hand_saw', 1), true);
});

test('queued commands apply on the next tick and replay identically', () => {
  const a = createGameSim(3, { record: true }), b = createGameSim(3);
  a.command('stock.buy', { id: 'lumber_2x4', qty: 10 });
  a.command('stock.buy', { id: 'axe', qty: 1 });          // already owned: fails cleanly
  a.command('projects.done', { id: 'roof' });
  a.command('projects.dismiss', { id: 'level' });
  a.command('projects.add', { id: 'coop', title: 'Build a coop', blurb: 'Later.' });
  a.command('projects.add', { id: 'coop', title: 'duplicate' });
  a.runTicks(5);
  for (const c of a.recorded) b.command(c.name, c.payload);
  b.runTicks(5);
  assert.equal(a.hash(), b.hash());
  const p = a.state.sys.stock.projects;
  assert.equal(p.find((x) => x.id === 'roof').status, 'done');
  assert.equal(p.find((x) => x.id === 'level').status, 'dismissed');
  assert.equal(p.filter((x) => x.id === 'coop').length, 1);
  a.command('projects.reopen', { id: 'level' }); a.runTicks(1);
  assert.equal(a.state.sys.stock.projects.find((x) => x.id === 'level').status, 'open');
});

test('stock is deterministic and survives a save/load round trip', () => {
  const run = (sim) => { sim.command('stock.buy', { id: 'lumber_2x6', qty: 12 }); sim.command('stock.buy', { id: 'roof_steel', qty: 33.5 }); sim.runDays(2); };
  const a = fresh(9), b = fresh(9);
  run(a); run(b);
  assert.equal(a.hash(), b.hash());
  const file = JSON.stringify(makeSave(a.serialize(), { wood: 0 }));
  const c = fresh(123);
  c.load(readSave(file).sim);
  assert.deepEqual(c.state.sys.stock, a.state.sys.stock);
  a.runDays(3); c.runDays(3);
  assert.equal(a.hash(), c.hash());
});

test('an old save with no stock still loads, and its wood and stone are kept', () => {
  const old = fresh(5).serialize();
  delete old.sys.stock;
  const file = JSON.stringify(makeSave(old, { wood: 17, stone: 4 }));
  const save = readSave(file);
  const sim = fresh(5); sim.load(save.sim);
  const s = sim.state.sys.stock;
  assert.equal(s.money, START_MONEY_USD, 'a stock was made for the old world');
  setCounter(s, 'wood', save.world.wood); setCounter(s, 'stone', save.world.stone);   // what the engine's world.wood / world.stone setters do
  assert.equal(s.items.wood, 17); assert.equal(s.items.stone, 4);
  setCounter(s, 'wood', 0);
  assert.ok(!('wood' in s.items));
  assert.equal(stockRemove(s, 'stone', 1).ok, true);
  assert.equal(stockAdd(s, 'stone', 1).ok, true);
});

test('wood and stone are real items with real mass', () => {
  near(ITEMS.wood.massKgPerUnit, MATERIALS.pine_seasoned.densityKgM3 * 0.42 * 0.13 * 0.13, 1e-9, 'a billet of cut wood');
  within(ITEMS.wood.massKgPerUnit, 2, 6, 'billet kg');
  within(ITEMS.stone.massKgPerUnit, 15, 40, 'hand-sized stone kg');
});

test('stock code keeps to the simulation rules (no clocks, no Math.random)', () => {
  for (const f of ['stock.js', 'items.js', 'materials.js']) {
    const src = fs.readFileSync(new URL('../src/sim/' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(src), f);
  }
});
