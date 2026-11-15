// Garden: soil water, growth and the twelve crops, against known figures. Runs headless at the real 365-day
// year unless a test says otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, createGameSim, weather, stockSystem, garden, CROPS, CROP_IDS, DAY, calendar, cellInfo, plantInfo, bedSummary, almanac,
  frostDates, nitrogenTotal, storedWaterL, sowAdvice } from '../src/sim/index.js';
import { makeField, addGroup, resolve, brush, snapRect } from '../src/sim/core/cellfield.js';
import { bucket, stepCell, infiltrate, priestleyTaylorMm } from '../src/sim/core/soilwater.js';
import { advance, newPlant, thermalRate, stageIndex } from '../src/sim/core/growth.js';
import { SOILS } from '../src/sim/content/soils.js';

// ------------------------------------------------------------------ helpers
const G = (sim) => sim.state.sys.garden;
const at = (m, d, year = 0) => (calendar.MONTH_START[m] + d - 1 - calendar.START_DAY_OF_YEAR + 365 * year) * DAY;
const runTo = (sim, t) => { while (sim.state.t < t) sim.runTicks(60); };
// A weather stand-in following the weather system's fields: a daily sine of temperature, clear-sky sun, set rain.
function stubWeather({ meanC = 15, rangeC = 10, cloud = 0.2, rainMmDay = 0, rainEvery = 0, humidity = 0.6 } = {}) {
  return {
    name: 'weather', every: 10,
    init: (ctx) => ({ site: { climate: 'temperate', latitudeDeg: 45 }, tempC: meanC, cloud, windMs: 2, humidity, dewPointC: meanC - 8, rainMmH: 0, snowMmH: 0, snowDepthM: 0,
      solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 }, groundTempC: meanC, totals: { precipMm: 0, snowfallMm: 0, meltMm: 0 } }),
    step(ctx) {
      const s = ctx.s, t = ctx.t, h = ((t % DAY) / 3600);
      const m = typeof meanC === 'function' ? meanC(t) : meanC;
      s.tempC = m + (rangeC / 2) * Math.sin(((h - 9) / 24) * 2 * Math.PI);
      s.dewPointC = m - 8;
      const g = calendar.clearSkyIrradiance(t, s.site).globalHorizontalWm2 * (1 - 0.75 * cloud ** 3.4);
      s.solar = { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: g };
      const day = Math.floor(t / DAY);
      s.rainMmH = rainEvery && day % rainEvery === 0 && h >= 2 && h < 6 ? rainMmDay / 4 : 0;
      s.totals.precipMm += (s.rainMmH * ctx.dt) / 3600;
    },
  };
}
function makeSim({ seed = 1, w = null, yearDays } = {}) {
  const sim = createSim({ seed, systems: [w || weather, stockSystem(), garden] });
  if (yearDays) sim.setYearDays(yearDays);
  const st = sim.state.sys.stock;
  st.tools.push('spade', 'watering_can', 'hoe');
  st.money = 1e6;
  return sim;
}
const give = (sim, id, qty) => { const it = sim.state.sys.stock.items; it[id] = (it[id] || 0) + qty; };
const cmd = (sim, name, p) => sim.commandNow(name, p);
function bedWith(sim, crop, { n = 4, soil, compost = 20, x0 = 0, spacingM } = {}) {
  const c = CROPS[crop], span = c.spacingM > 0.31 ? Math.round(c.spacingM / 0.3) : 1, N = span * n;
  const r = cmd(sim, 'garden.makeBed', { x0, z0: 0, nx: N, nz: N, soil });
  assert.ok(r.ok, r.reason);
  if (compost) { give(sim, 'compost', N * N * 0.09 * compost); cmd(sim, 'garden.amend', { kind: 'compost', bed: r.id, litres: N * N * 0.09 * compost }); }
  give(sim, c.seedItem, 50);
  const s = cmd(sim, 'garden.sow', { crop, bed: r.id, spacingM });
  assert.ok(s.ok, s.reason);
  return { id: r.id, areaM2: N * N * 0.09 };
}
// The well-tended routine: water whatever is drying, hoe every week.
function tend(sim, bed, day, { waterIt = true, hoeIt = true } = {}) {
  const b = G(sim).field.groups[bed];
  if (waterIt) {
    const dry = b.cells.map((_, i) => i).filter((i) => { const ci = cellInfo(sim.state, bed, i), p = b.cells[i].pl && G(sim).plants[b.cells[i].pl]; return ci.water < 0.55 || (p && !p.emerged && ci.seed < 0.6); });
    if (dry.length) cmd(sim, 'garden.water', { bed, cells: dry, litres: dry.length * 0.09 * 15, carriedL: 1e9 });
  }
  if (hoeIt && day % 7 === 0) cmd(sim, 'garden.hoe', { bed });
}
const plantsOf = (sim, bed) => Object.values(G(sim).plants).filter((p) => p.bed === bed);
// Grow one crop from sowing to the end of its harvest; returns days to first harvest and the fresh yield per m2.
function grow(sim, bed, crop, opts = {}) {
  const c = CROPS[crop], t0 = sim.state.t;
  let ready = null, kg = 0;
  for (let day = 0; day < (opts.maxDays || 420); day++) {
    sim.runDays(1);
    tend(sim, bed.id, day, opts);
    const ps = plantsOf(sim, bed.id);
    if (!ps.length) break;
    if (ready == null && ps.some((p) => p.readyT != null)) ready = (ps.find((p) => p.readyT != null).readyT - t0) / DAY;
    if (ready != null && c.harvest === 'repeat' && day % 3 === 0) { const h = cmd(sim, 'garden.harvest', { bed: bed.id }); if (h.ok) kg += h.kg[crop]; }
    if (ready != null && c.harvest === 'once' && (sim.state.t - t0) / DAY >= ready + (opts.waitDays || 0)) { const h = cmd(sim, 'garden.harvest', { bed: bed.id }); if (h.ok) kg += h.kg[crop]; break; }
    if (ps.every((p) => p.dead)) break;
    if (ready != null && c.harvest === 'repeat' && (sim.state.t - t0) / DAY > ready + (opts.pickDays ?? (crop === 'kale' ? 150 : crop === 'tomato' ? 120 : 30))) break;
  }
  return { ready, kgM2: kg / bed.areaM2, dead: plantsOf(sim, bed.id).some((p) => p.dead) };
}
// Sensible sowing dates in the temperate climate (last frost about 6 May there).
const SOW = { radish: [4, 1], lettuce: [3, 25], peas: [3, 20], potato: [4, 1], tomato: [4, 25], bean: [5, 1], carrot: [4, 10], squash: [5, 1],
  kale: [4, 1], garlic: [9, 20], corn: [4, 25], wheat: [3, 20] };

// ------------------------------------------------------------------ the generic mechanisms, with a non-garden fixture
test('generic mechanisms work with any records (a fungus on a cave floor)', () => {
  const f = makeField(0.5);
  const g = addGroup(f, { x0: 0.1, z0: 0, x1: 2.1, z1: 1 }, () => ({ spores: 0 }));
  assert.equal(g.nx, 4); assert.equal(g.nz, 2);
  assert.equal(addGroup(f, { x0: 1, z0: 0.5, x1: 3, z1: 2 }, () => ({})).error, 'overlaps');
  assert.equal(brush(f, { x: 0.4, z: 0.25, r: 0.2 }, (c) => { c.spores++; }), 1);
  assert.equal(resolve(f, { group: g.id }).length, 8);
  assert.deepEqual(snapRect(f, { x0: 0, z0: 0, x1: 0.2, z1: 2 }), null);
  const glowcap = { tb: 2, topt: 12, tceil: 20, germMinC: 3, readyGdd: 200, rue: 0.5, k: 0.5, laiMax: 1, frost: { damageC: -5, killC: -10 },
    stages: [{ id: 'spore', gdd: 0 }, { id: 'pin', gdd: 30 }, { id: 'cap', gdd: 200 }, { id: 'rot', gdd: 300 }], partition: { from: 0.2, to: 0.5, max: 0.8 } };
  assert.equal(thermalRate(12, glowcap), 10); assert.equal(thermalRate(25, glowcap), 0);
  const p = newPlant(glowcap, 0), env = { days: 1, temps: Array(24).fill(10), n: 24, soilC: 10, topWet: 1, minC: 5, rsMJ: 2, dayH: 0, water: 1, nutrient: 1, light: 1, competition: 1 };
  for (let d = 0; d < 30; d++) advance(p, glowcap, env);
  assert.equal(glowcap.stages[stageIndex(glowcap, p.gdd)].id, 'cap');
  assert.ok(p.yieldDM > 0 && p.bio > p.yieldDM);
  const sand = { fc: 0.1, wp: 0.03, bulkGcm3: 1.6, rewMm: 3, drainTauH: 2 }, b = bucket(sand), cell = { w: b.fc1, d: b.fc2, de: 0 };
  const out = {}; stepCell(cell, b, { et0: 0.3, kcb: 0, cover: 0, rootFrac: 0, p: 0.5 }, 1, out);
  assert.ok(out.evap > 0 && out.transp === 0);
});

test('Priestley-Taylor gives a realistic summer day: about 4 to 6 mm', () => {
  // 25 MJ/m2 on a clear July day at 22 C mean, spread over the daylight hours
  let et = 0;
  for (let h = 0; h < 24; h++) { const rs = h >= 5 && h < 20 ? 25 * Math.sin(((h - 5 + 0.5) / 15) * Math.PI) * (Math.PI / 30) : 0; et += priestleyTaylorMm(22 + 5 * Math.sin(((h - 9) / 24) * 6.28), rs, 1, 1.6, 1); }
  assert.ok(et > 4 && et < 6.5, et.toFixed(2));
});

// ------------------------------------------------------------------ days to maturity and yields
const FIG = {};
for (const crop of CROP_IDS) {
  test(crop + ': first harvest within 25% of the seed-packet days, yield in the expected range', () => {
    const c = CROPS[crop], runs = [];
    for (const seed of [1, 2]) {
      const sim = makeSim({ seed });
      runTo(sim, at(...SOW[crop]));
      runs.push(grow(sim, bedWith(sim, crop), crop));
    }
    const days = runs.reduce((a, r) => a + r.ready, 0) / runs.length, y = runs.reduce((a, r) => a + r.kgM2, 0) / runs.length;
    FIG[crop] = { packet: c.daysToMaturity, days: Math.round(days), kgM2: +y.toFixed(2), expect: c.yieldKgM2 };
    assert.ok(runs.every((r) => r.ready != null), 'reached harvest');
    assert.ok(Math.abs(days - c.daysToMaturity) <= 0.25 * c.daysToMaturity, `${crop}: ${days} days vs packet ${c.daysToMaturity}`);
    assert.ok(y >= c.yieldKgM2[0] * 0.8 && y <= c.yieldKgM2[1] * 1.2, `${crop}: ${y.toFixed(2)} kg/m2 vs ${c.yieldKgM2}`);
  });
}
test('figures', () => { console.log('# days to first harvest and yield, temperate, well tended:', JSON.stringify(FIG)); });

// ------------------------------------------------------------------ warmth, frost, heat
test('a cool spring is slower than a warm one', () => {
  const days = (meanC) => { const sim = makeSim({ w: stubWeather({ meanC, rainMmDay: 6, rainEvery: 3 }) }); runTo(sim, at(4, 1)); return grow(sim, bedWith(sim, 'radish'), 'radish').ready; };
  const cool = days(11), warm = days(17);
  assert.ok(cool > warm * 1.3, `cool ${cool} warm ${warm}`);
});

test('tomatoes planted out before the last frost are killed; peas sown then are not', () => {
  let tomKilled = 0, peaKilled = 0;
  for (const seed of [1, 2, 3, 4]) {
    const sim = makeSim({ seed });
    runTo(sim, at(3, 12));
    const tom = bedWith(sim, 'tomato', { n: 1, x0: 0 }), pea = bedWith(sim, 'peas', { n: 2, x0: 5 });
    for (let d = 0; d < 50; d++) { sim.runDays(1); tend(sim, tom.id, d); tend(sim, pea.id, d); }
    if (plantsOf(sim, tom.id).some((p) => p.dead === 'frost')) tomKilled++;
    if (plantsOf(sim, pea.id).some((p) => p.dead)) peaKilled++;
    const p = plantsOf(sim, tom.id)[0];
    if (p.dead) assert.match(p.reason, /[Ff]rost/);
  }
  assert.ok(tomKilled >= 3, 'tomatoes killed in ' + tomKilled + ' of 4 springs');
  assert.equal(peaKilled, 0);
});

test('a row cover saves tender plants on a light frost', () => {
  const frosty = stubWeather({ meanC: (t) => (Math.floor(t / DAY) === 62 ? 3.5 : 18), rangeC: 9, cloud: 0, rainMmDay: 6, rainEvery: 3 });
  const one = (covered) => { const sim = makeSim({ w: frosty }); runTo(sim, at(4, 20)); const b = bedWith(sim, 'bean', { n: 2 }); if (covered) cmd(sim, 'garden.cover', { bed: b.id, on: true }); for (let d = 0; d < 50; d++) { sim.runDays(1); tend(sim, b.id, d); } return plantsOf(sim, b.id)[0]; };
  const bare = one(false), under = one(true);
  assert.ok(bare.dead === 'frost' || bare.frostBurn > 0.3, 'bare beans were frosted');
  assert.ok(!under.dead && under.frostBurn < bare.frostBurn + 1e-9);
});

test('lettuce bolts in a heat wave and not in a cool spell', () => {
  const run = (meanC) => { const sim = makeSim({ w: stubWeather({ meanC, rangeC: 12, rainMmDay: 8, rainEvery: 2 }) }); runTo(sim, at(5, 10)); const b = bedWith(sim, 'lettuce', { n: 2 }); for (let d = 0; d < 40; d++) { sim.runDays(1); tend(sim, b.id, d); } return plantsOf(sim, b.id)[0]; };
  const hot = run(29), mild = run(16);
  assert.ok(hot.bolted, 'bolted in the heat'); assert.equal(hot.status, 'Bolted');
  assert.ok(!mild.bolted);
});

// ------------------------------------------------------------------ water
test('a dry spell: the unwatered bed wilts and yields less; water is conserved', () => {
  const dry = stubWeather({ meanC: 20, rangeC: 12, cloud: 0.1, humidity: 0.45 });
  // both beds are watered until the seedlings are up; then one is left to the weather
  const establish = (sim, b) => { for (let d = 0; d < 40 && plantsOf(sim, b.id).some((p) => !p.emerged); d++) { sim.runDays(1); tend(sim, b.id, d); } };
  const run = (waterIt) => { const sim = makeSim({ w: dry }); runTo(sim, at(4, 15)); const b = bedWith(sim, 'lettuce'); establish(sim, b); const r = grow(sim, b, 'lettuce', { waterIt }); return { sim, r, b }; };
  const wet = run(true), parched = run(false);
  assert.ok(parched.r.kgM2 < 0.6 * wet.r.kgM2, `unwatered ${parched.r.kgM2.toFixed(2)} vs watered ${wet.r.kgM2.toFixed(2)} kg/m2`);
  // the parched bed showed it: wilting and the reason in words
  const sim = makeSim({ w: dry }); runTo(sim, at(4, 15)); const b = bedWith(sim, 'lettuce'); establish(sim, b);
  sim.runDays(20);
  const p = plantsOf(sim, b.id)[0];
  assert.ok(p.wilt > 0.3 && /dry/.test(p.reason), p.status + ': ' + p.reason);
  // conservation: water in = change in storage + evaporation + transpiration + drainage + runoff
  for (const { sim: s } of [wet, parched]) {
    const T = G(s).totals, cells = Object.values(G(s).field.groups)[0].cells.length;
    const start = cells * 0.09 * (() => { const sb = bucket(SOILS.loam); return (sb.wp1 + 0.7 * (sb.fc1 - sb.wp1)) + (sb.wp2 + 0.8 * (sb.fc2 - sb.wp2)); })();
    const lhs = T.rainL + T.irrigL, rhs = storedWaterL(G(s)) - start + T.evapL + T.transpL + T.drainL + T.runoffL;
    assert.ok(Math.abs(lhs - rhs) < 1e-6 * Math.max(1, lhs) + 1e-6, `in ${lhs} vs out ${rhs}`);
  }
});

test('sandy soil dries out faster than clay', () => {
  const dryDays = (soil) => {
    const sim = makeSim({ w: stubWeather({ meanC: 20, cloud: 0.1 }) }); runTo(sim, at(5, 1));
    const b = bedWith(sim, 'kale', { soil, compost: 0 });
    for (let d = 1; d < 80; d++) { sim.runDays(1); if (d === 20) cmd(sim, 'garden.water', { bed: b.id, litres: 1e4, carriedL: 1e9 }); if (d > 20 && plantsOf(sim, b.id)[0].ks < 0.65) return d - 20; }
    return 80;
  };
  const sand = dryDays('sand'), clay = dryDays('clay');
  assert.ok(sand < clay, `sand ${sand} days, clay ${clay} days`);
});

// FAO Irrigation and Drainage Paper 33 (Doorenbos and Kassam): a field tomato needs 400 to 800 mm a season,
// depending on climate and season length; a shorter northern season sits at the low end.
test('a tomato bed uses a realistic amount of water over the season (350 to 700 mm)', () => {
  const sim = makeSim({ seed: 1 }); runTo(sim, at(4, 25));
  const b = bedWith(sim, 'tomato', { n: 2 });
  const T0 = { ...G(sim).totals };
  const r = grow(sim, b, 'tomato', { pickDays: 200 });
  const T = G(sim).totals, mm = (T.evapL + T.transpL - T0.evapL - T0.transpL) / b.areaM2;
  FIG.tomatoWaterMm = Math.round(mm);
  console.log('# tomato bed evapotranspiration, planting out to frost:', Math.round(mm), 'mm, per plant', Math.round(mm * 0.36), 'L; first frost ended it:', r.dead);
  assert.ok(mm > 350 && mm < 700, mm.toFixed(0) + ' mm');
});

// ------------------------------------------------------------------ crowding, hunger, weeds, rotation, compost
test('yields fall when crowded, starved of nitrogen or weedy', () => {
  const run = (opts, growOpts = {}) => { const sim = makeSim({ seed: 3 }); runTo(sim, at(4, 10)); return grow(sim, bedWith(sim, 'carrot', opts), 'carrot', growOpts).kgM2; };
  const good = run({});
  const crowded = run({ spacingM: 0.0375 });
  const starved = run({ soil: 'sand', compost: 0 });
  const weedy = run({}, { hoeIt: false });
  console.log('# carrots kg/m2: well tended', good.toFixed(2), 'crowded', crowded.toFixed(2), 'starved', starved.toFixed(2), 'weedy', weedy.toFixed(2));
  assert.ok(crowded < 0.8 * good && starved < 0.8 * good && weedy < 0.8 * good);
});

test('corn after beans yields more than corn after corn', () => {
  const sim = makeSim({ seed: 5 }); runTo(sim, at(4, 25));
  const A = bedWith(sim, 'corn', { n: 3, compost: 0, x0: 0 }), B = bedWith(sim, 'bean', { n: 9, compost: 0, x0: 5 });
  grow(sim, A, 'corn', { maxDays: 120 }); grow(sim, B, 'bean', { maxDays: 120 });
  cmd(sim, 'garden.pull', { bed: A.id }); cmd(sim, 'garden.pull', { bed: B.id });
  runTo(sim, at(4, 25, 1));
  give(sim, 'seed_corn', 50);
  cmd(sim, 'garden.sow', { crop: 'corn', bed: A.id }); cmd(sim, 'garden.sow', { crop: 'corn', bed: B.id });
  const ya = grow(sim, A, 'corn').kgM2, yb = grow(sim, B, 'corn').kgM2;
  console.log('# second-year corn kg/m2: after corn', ya.toFixed(2), 'after beans', yb.toFixed(2));
  assert.ok(yb > ya * 1.1);
  assert.match(bedSummary(sim.state, B.id).rotation || '', /corn/i);
});

test('compost raises a depleted bed\'s yield over the following season', () => {
  const sim = makeSim({ seed: 2 }); runTo(sim, at(8, 15));
  const mk = (x0) => { const r = cmd(sim, 'garden.makeBed', { x0, z0: 0, nx: 4, nz: 4, soil: 'sandy_loam' }); for (const c of G(sim).field.groups[r.id].cells) { c.n = 0; c.sn *= 0.4; } return { id: r.id, areaM2: 16 * 0.09 }; };
  const plain = mk(0), fed = mk(5);
  give(sim, 'compost', 100); cmd(sim, 'garden.amend', { kind: 'compost', bed: fed.id, litres: 16 * 0.09 * 40 });
  runTo(sim, at(4, 25, 1));
  give(sim, 'seed_corn', 20);
  cmd(sim, 'garden.sow', { crop: 'corn', bed: plain.id }); cmd(sim, 'garden.sow', { crop: 'corn', bed: fed.id });
  const y0 = grow(sim, plain, 'corn').kgM2, y1 = grow(sim, fed, 'corn').kgM2;
  console.log('# corn on a depleted bed kg/m2: plain', y0.toFixed(2), 'composted', y1.toFixed(2));
  assert.ok(y1 > y0 * 1.25);
});

test('nitrogen is conserved: soil + plants + removed + leached = start + added + fixed', () => {
  const sim = makeSim({ seed: 4 }); runTo(sim, at(4, 20));
  const a = bedWith(sim, 'peas', { x0: 0 }), b = bedWith(sim, 'corn', { x0: 5, n: 3 });
  give(sim, 'mulch_straw', 500); cmd(sim, 'garden.mulch', { bed: b.id, litres: 50 });
  for (let d = 0; d < 200; d++) { sim.runDays(1); tend(sim, a.id, d); tend(sim, b.id, d); if (d % 5 === 0) { cmd(sim, 'garden.harvest', { bed: a.id }); } if (d === 90) cmd(sim, 'garden.harvest', { bed: b.id }); }
  cmd(sim, 'garden.pull', { bed: a.id, toCompost: true });
  const T = G(sim).totals, have = nitrogenTotal(G(sim)) + T.nRemoved + T.nLeached + T.nExported, put = T.nInit + T.nIn + T.nFixed;
  assert.ok(T.nFixed > 0 && T.nRemoved > 0);
  assert.ok(Math.abs(have - put) < 1e-6 * put, `${have} vs ${put}`);
});

// ------------------------------------------------------------------ the almanac
test('almanac: frost dates from the climate, what to sow, frost risk tonight', () => {
  const t = frostDates({ climate: 'temperate' }), m = frostDates({ climate: 'mediterranean-coast' });
  // Burlington, Vermont: median last frost about 8 May, first about 1 October (NOAA normals)
  assert.ok(t.lastDoy > 115 && t.lastDoy < 140 && t.firstDoy > 265 && t.firstDoy < 295, JSON.stringify(t));
  assert.ok(m.frostFree);
  const sim = createGameSim(1);
  const a = almanac(sim.state);
  assert.ok(a.sowNow.some((s) => s.crop === 'peas') && !a.sowNow.some((s) => s.crop === 'tomato'));
  assert.match(sowAdvice('tomato', { climate: 'temperate' }, 100).short, /Best sown from/);
  assert.ok(['none', 'possible', 'likely'].includes(a.frost.level));
  // simulated weather agrees with the almanac: in most years the last spring frost falls within three weeks of it
  let near = 0;
  for (const seed of [1, 2, 3]) {
    const s = createSim({ seed, systems: [weather] }); let last = null;
    while (calendar.dayOfYear(s.state.t) < 200) { s.runTicks(10); if (s.state.sys.weather.tempC < 0) last = calendar.dayOfYear(s.state.t); }
    if (last != null && Math.abs(last - t.lastDoy) <= 21) near++;
  }
  assert.ok(near >= 2, near + ' of 3 years');
});

// ------------------------------------------------------------------ the shorter year
test('in a 20-day year every crop completes in its season with the same yield per plant', () => {
  for (const crop of CROP_IDS) {
    const sim = makeSim({ seed: 1, yearDays: 20 });
    runTo(sim, 0);
    while (calendar.dayOfYear(sim.calendarT()) < calendar.MONTH_START[SOW[crop][0]] + SOW[crop][1] - 1 || calendar.dayOfYear(sim.calendarT()) > 330) sim.runTicks(60);
    const b = bedWith(sim, crop);
    const t0 = sim.state.t, r = grow(sim, b, crop, { maxDays: 40, pickDays: crop === 'kale' ? 8 : crop === 'tomato' ? 6 : 2 });
    const full = FIG[crop];
    assert.ok(r.ready != null, crop + ' reached harvest');
    const gameDays = r.ready, expect = CROPS[crop].daysToMaturity * 20 / 365;
    assert.ok(gameDays < expect * 1.5 + 1, `${crop}: ${gameDays.toFixed(1)} game days, expected about ${expect.toFixed(1)}`);
    if (full && CROPS[crop].harvest === 'once') assert.ok(r.kgM2 > full.kgM2 * 0.6 && r.kgM2 < full.kgM2 * 1.5, `${crop}: ${r.kgM2.toFixed(2)} vs ${full.kgM2} kg/m2 at 365 days`);
  }
});

test('in a 20-day year tomatoes planted out before the last frost are still killed', () => {
  let killed = 0;
  for (const seed of [1, 2, 3, 4]) {
    const sim = makeSim({ seed, yearDays: 20 });
    while (calendar.dayOfYear(sim.calendarT()) < calendar.MONTH_START[3] + 11) sim.runTicks(60);
    const b = bedWith(sim, 'tomato', { n: 1 });
    for (let d = 0; d < 4; d++) sim.runDays(1);
    if (plantsOf(sim, b.id).some((p) => p.dead === 'frost')) killed++;
  }
  assert.ok(killed >= 3, killed + ' of 4');
});

// ------------------------------------------------------------------ interface, determinism, saves, cost
test('commands: seeds come from stock, harvest goes to stock, the kitchen gets whole potatoes', () => {
  const sim = createGameSim(1);
  const st = sim.state.sys.stock;
  assert.ok(cmd(sim, 'stock.buy', { id: 'seed_radish', qty: 1 }).ok);
  const bed = cmd(sim, 'garden.makeBed', { x0: 0, z0: 0, x1: 1.2, z1: 0.6 });
  assert.ok(bed.ok); assert.equal(bed.nx * bed.nz, 8);
  const s = cmd(sim, 'garden.sow', { crop: 'radish', bed: bed.id });
  assert.equal(s.plants, 8); assert.equal(st.items.seed_radish || 0, 0, 'packet opened');
  assert.ok(G(sim).packets.radish > 0);
  assert.equal(cmd(sim, 'garden.water', { bed: bed.id, litres: 3 }).ok, false, 'no can yet');
  cmd(sim, 'stock.buy', { id: 'watering_can', qty: 1 }); cmd(sim, 'garden.refill', {});
  const w = cmd(sim, 'garden.water', { bed: bed.id, litres: 3 }); assert.equal(w.litres, 3); assert.equal(G(sim).can.litres, 6);
  assert.equal(cmd(sim, 'garden.harvest', { bed: bed.id }).ok, false);
  // potatoes arrive as the kitchen's ingredient, counted whole
  const pb = cmd(sim, 'garden.makeBed', { x0: 3, z0: 0, nx: 3, nz: 3 });
  cmd(sim, 'stock.buy', { id: 'seed_potato', qty: 1 });
  cmd(sim, 'garden.sow', { crop: 'potato', bed: pb.id });
  const before = st.items.food_potato || 0;
  for (const p of plantsOf(sim, pb.id)) { p.gdd = CROPS.potato.readyGdd; p.yieldDM = 600; }
  const h = cmd(sim, 'garden.harvest', { bed: pb.id });
  assert.ok(h.ok && st.items.food_potato > before && Number.isInteger(st.items.food_potato));
  const info = plantInfo(sim.state, plantsOf(sim, bed.id)[0].id);
  assert.equal(info.name, 'Radish'); assert.ok(info.reason.length > 0);
});

test('determinism, save round trip, and old saves without a garden', () => {
  const play = (sim) => { cmd(sim, 'garden.makeBed', { x0: 0, z0: 0, nx: 6, nz: 4 }); give(sim, 'seed_lettuce', 2); cmd(sim, 'garden.sow', { crop: 'lettuce', bed: 'b1' }); sim.runDays(10); };
  const a = makeSim({ seed: 9 }), b = makeSim({ seed: 9 });
  play(a); play(b);
  assert.equal(a.hash(), b.hash());
  const c = makeSim({ seed: 9 }); c.load(a.serialize());
  a.runDays(15); c.runDays(15);
  assert.equal(a.hash(), c.hash());
  const old = createGameSim(3).serialize(); delete old.sys.garden;
  const d = createGameSim(3); d.load(old);
  assert.ok(d.state.sys.garden && d.state.sys.garden.field);
  d.runDays(1);
});

test('cost: 400 planted cells under 0.3 ms per growth step and 0.1 ms per soil step; nothing with no beds', () => {
  const sim = makeSim({ seed: 1 }); runTo(sim, at(4, 20));
  for (let k = 0; k < 4; k++) { const r = cmd(sim, 'garden.makeBed', { x0: k * 4, z0: 0, nx: 10, nz: 10 }); give(sim, 'seed_carrot', 5); cmd(sim, 'garden.sow', { crop: 'carrot', bed: r.id }); }
  sim.runDays(30);
  const g = garden, s = G(sim);
  const ctx = (tick) => ({ s, t: sim.state.t, tick, dt: 3600, lifeScale: 1, ct: sim.state.t, get: (n) => sim.state.sys[n], emit: () => {}, sim });
  const time = (tick, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) g.step(ctx(tick)); return (performance.now() - t0) / n; };
  time(60, 50);
  const soil = time(60, 400), both = time(180, 400);
  console.log('# garden cost, 400 planted cells: soil step', soil.toFixed(4), 'ms, growth step', (both - soil).toFixed(4), 'ms');
  assert.ok(soil < 0.1, 'soil ' + soil); assert.ok(both - soil < 0.3, 'growth ' + (both - soil));
  const empty = makeSim(); const es = empty.state.sys.garden;
  const t0 = performance.now(); for (let i = 0; i < 10000; i++) garden.step({ s: es, tick: 180, get: () => null }); assert.ok((performance.now() - t0) / 10000 < 0.002);
});
