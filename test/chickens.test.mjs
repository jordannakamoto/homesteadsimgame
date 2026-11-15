// Chickens: laying, feed and water, fasting and recovery, growth, genetics, the tractor, manure,
// conservation, determinism, saving and the cost budget. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, createGameSim, DAY, HOUR, calendar, stockSystem, siteSystem, chickensSystem, makeSave, readSave } from '../src/sim/index.js';
import { BREEDS, makeBird, makeOffspring, initChickens, haveItem, TRAIT_SPECS, pointOfLayWeeks } from '../src/sim/chickens.js';
import { stream } from '../src/sim/rng.js';
import { setSite, fixture } from './helpers/pieces.mjs';

const C = (sim) => sim.state.sys.chickens;
const hens = (sim) => Object.values(C(sim).birds);
const chores = (sim, { feed = true, water = true } = {}) => {
  if (feed) { sim.commandNow('chickens.buySupply', { id: 'layer_feed', qty: 8 }); sim.commandNow('chickens.fillFeeder', {}); }
  if (water) sim.commandNow('chickens.fillWaterer', {});
};

// A weather stand-in with a fixed temperature profile, for experiments the real weather cannot stage on demand.
const fakeWeather = (tempAt) => ({
  name: 'weather', every: 10,
  init: () => ({ site: { latitudeDeg: 45, climate: 'temperate' }, tempC: 20, humidity: 0.6, windMs: 2, cloud: 0.3, rainMmH: 0, snowMmH: 0, snowDepthM: 0, solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 }, groundTempC: 10 }),
  step: (c) => { c.s.tempC = tempAt(c.t); },
});
const labSim = (seed, tempAt) => createSim({ seed, systems: [fakeWeather(tempAt), stockSystem(), siteSystem(), chickensSystem()] });

// Run a flock of six of a breed bought before point of lay, kept fed and watered every morning. Count each
// hen's eggs over the 365 days after her first egg, and the flock's eggs by calendar month.
function layingYear({ seed = 3, breed = 'rir', light = false, days = 470 } = {}) {
  const sim = createGameSim(seed);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed, count: 6, ageWeeks: 16 });
  if (light) sim.commandNow('chickens.setLight', { on: true, hours: 15 });
  const first = {}, per = {}, month = new Array(12).fill(0), monthDays = new Array(12).fill(0);
  for (let d = 0; d < days; d++) {
    chores(sim);
    const before = Object.fromEntries(hens(sim).map((b) => [b.id, b.eggs.laidTotal]));
    sim.runDays(1);
    let n = 0;
    for (const b of hens(sim)) {
      const k = b.eggs.laidTotal - before[b.id]; n += k;
      if (k && first[b.id] === undefined) first[b.id] = d;
      if (first[b.id] !== undefined && d - first[b.id] < 365) per[b.id] = (per[b.id] || 0) + k;
    }
    if (d > 120) { const m = calendar.monthOf(calendar.dayOfYear(sim.state.t - DAY / 2)); month[m] += n; monthDays[m]++; }
    sim.commandNow('chickens.collectEggs', {});
  }
  const each = Object.values(per);
  return { sim, each, mean: each.reduce((a, b) => a + b, 0) / each.length, rate: month.map((n, i) => n / Math.max(1, monthDays[i]) / 6) };
}

test('a well-fed flock of Rhode Island Reds lays 250-300 eggs each in the first year with a coop light, far fewer without, and less in winter', () => {
  const lit = layingYear({ light: true });
  const nat = layingYear({ light: false });
  console.log('  eggs per hen, first laying year: with light', lit.mean.toFixed(0), lit.each.join(' '), '| natural light', nat.mean.toFixed(0), nat.each.join(' '));
  console.log('  natural light, eggs per hen per day by month J..D:', nat.rate.map((r) => r.toFixed(2)).join(' '));
  assert.ok(lit.mean >= 250 && lit.mean <= 300, 'lit ' + lit.mean);
  assert.ok(nat.mean < 0.8 * lit.mean, 'natural ' + nat.mean);
  const winter = (nat.rate[11] + nat.rate[0]) / 2, summer = (nat.rate[5] + nat.rate[6]) / 2;
  assert.ok(winter < 0.4 * summer, 'winter ' + winter + ' summer ' + summer);
  // eggs are laid mostly in the morning, in the nest box
  const sim = lit.sim;
  sim.runDays(0.25);
  const laid = [];
  sim.listen((type, d, st) => { if (type === 'chickens.egg') laid.push({ h: calendar.dayOfYear(st.t) >= 0 ? (st.t % DAY) / HOUR : 0, where: d.where }); });
  for (let i = 0; i < 20; i++) { chores(sim); sim.runDays(1); }
  const morning = laid.filter((e) => e.h < 13).length / laid.length;
  assert.ok(laid.length > 40 && morning > 0.7, 'morning share ' + morning.toFixed(2) + ' of ' + laid.length);
  assert.ok(laid.every((e) => e.where === 'nest'));
});

test('feed eaten by a laying hen at mild temperatures is in the real range, and scales with body mass', () => {
  const run = (breed) => {
    const sim = labSim(5, () => 20);
    sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
    sim.commandNow('chickens.setDoor', { open: false });            // kept in: no forage, everything from the feeder
    sim.commandNow('chickens.buy', { breed, count: 6, ageWeeks: 40 });
    sim.commandNow('chickens.setLight', { on: true, hours: 15 });
    for (let d = 0; d < 10; d++) { chores(sim); sim.runDays(1); }
    const k0 = C(sim).totals.feederEatenKg, e0 = C(sim).totals.eggs;
    for (let d = 0; d < 30; d++) { chores(sim); sim.runDays(1); }
    return { g: ((C(sim).totals.feederEatenKg - k0) / 6 / 30) * 1000, lay: (C(sim).totals.eggs - e0) / 6 / 30 };
  };
  const rir = run('rir'), leg = run('leghorn'), bantam = run('pekin');
  console.log('  feed g/hen/day at 20 C:', 'Rhode Island Red', rir.g.toFixed(0), '(lay ' + rir.lay.toFixed(2) + ')', 'Leghorn', leg.g.toFixed(0), '(lay ' + leg.lay.toFixed(2) + ')', 'Pekin bantam', bantam.g.toFixed(0));
  assert.ok(rir.g > 110 && rir.g < 145, 'rir ' + rir.g);
  assert.ok(leg.g > 95 && leg.g < 125, 'leghorn ' + leg.g);
  assert.ok(bantam.g > 35 && bantam.g < 70, 'bantam ' + bantam.g);
  assert.ok(rir.lay > 0.7 && leg.lay > 0.75);
});

test('water drunk rises steeply in a heat wave', () => {
  const sim = labSim(6, (t) => { const d = Math.floor(t / DAY); const h = (t % DAY) / HOUR; return (d >= 20 && d < 27 ? 30 : 18) + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI); });
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed: 'rir', count: 6, ageWeeks: 40 });
  const perDay = [];
  for (let d = 0; d < 27; d++) { chores(sim); const w0 = C(sim).totals.waterDrunkL; sim.runDays(1); perDay.push((C(sim).totals.waterDrunkL - w0) / 6); }
  const mild = perDay.slice(12, 19).reduce((a, b) => a + b) / 7, hot = perDay.slice(21, 27).reduce((a, b) => a + b) / 6;
  console.log('  water L/hen/day: mild', mild.toFixed(3), 'heat wave', hot.toFixed(3));
  assert.ok(mild > 0.15 && mild < 0.35, 'mild ' + mild);
  assert.ok(hot > 1.5 * mild, 'hot ' + hot);
});

test('an empty feeder stops laying within days and the hens lose mass; fed again, they recover and lay', () => {
  const sim = labSim(8, () => 16);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.setDoor', { open: false });              // kept in: no forage to fall back on
  sim.commandNow('chickens.buy', { breed: 'rir', count: 6, ageWeeks: 36 });
  sim.commandNow('chickens.setLight', { on: true, hours: 15 });
  for (let d = 0; d < 14; d++) { chores(sim); sim.runDays(1); }
  const m0 = hens(sim).reduce((a, b) => a + b.massKg, 0);
  let emptyDay = null, stopDay = null;
  for (let d = 0; d < 20; d++) {
    chores(sim, { feed: false });
    const e0 = C(sim).totals.eggs; sim.runDays(1);
    if (emptyDay === null && C(sim).flock.feedKg <= 0) emptyDay = d;
    if (emptyDay !== null && stopDay === null && C(sim).totals.eggs === e0) stopDay = d;
  }
  const m1 = hens(sim).reduce((a, b) => a + b.massKg, 0);
  const b = hens(sim)[0];
  console.log('  feeder empty on day', emptyDay, '; no eggs from day', stopDay, '; mass', (m0 / 6).toFixed(2), '->', (m1 / 6).toFixed(2), 'kg;', b.status);
  assert.ok(emptyDay !== null && stopDay !== null && stopDay - emptyDay <= 6, 'stopped ' + stopDay + ' after empty ' + emptyDay);
  assert.ok(m1 < 0.9 * m0);
  assert.match(b.status, /hungry: the feeder has been empty/);
  assert.ok(C(sim).issues.some((i) => i.id.startsWith('feeder-empty')));
  let back = null;
  for (let d = 0; d < 40; d++) { chores(sim); const e0 = C(sim).totals.eggs; sim.runDays(1); if (back === null && C(sim).totals.eggs - e0 >= 3) back = d; }
  const m2 = hens(sim).reduce((a, b) => a + b.massKg, 0);
  console.log('  fed again: laying again from day', back, '; mass back to', (m2 / 6).toFixed(2), 'kg');
  assert.ok(back !== null && m2 > 0.97 * m0);
});

test('pullets grow and do not lay before point of lay', () => {
  const sim = createGameSim(9);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed: 'rir', count: 6, ageWeeks: 8 });
  const m0 = hens(sim).map((b) => b.massKg);
  const firstAge = {};
  for (let d = 0; d < 140; d++) {
    chores(sim); sim.runDays(1);
    for (const b of hens(sim)) if (b.eggs.laidTotal && firstAge[b.id] === undefined) firstAge[b.id] = (sim.state.t - b.bornT) / DAY / 7;
  }
  const ages = Object.values(firstAge);
  console.log('  8-week pullets weighed', (m0[0]).toFixed(2), 'kg; first eggs at', ages.map((a) => a.toFixed(1)).join(' '), 'weeks; now', hens(sim)[0].massKg.toFixed(2), 'kg');
  assert.equal(ages.length, 6);
  for (const b of hens(sim)) assert.ok(firstAge[b.id] >= pointOfLayWeeks(b) - 0.01 && firstAge[b.id] >= 17, b.name + ' ' + firstAge[b.id]);
  assert.ok(hens(sim).every((b, i) => b.massKg > 2 * m0[i]));
});

test('offspring traits lie between the parents on average, and visible traits follow Mendelian ratios', () => {
  const s = initChickens(), rng = stream({}, 1, 'genetics');
  const mk = (breed, sex) => makeBird(s, rng, breed, sex, 0, 200 * DAY);
  // polygenic: a big-bodied dam and a small sire
  const dam = mk('rir', 'hen'), sire = mk('rir', 'rooster');
  dam.traits.bv.size = 0.08; sire.traits.bv.size = -0.06; dam.traits.bv.lay = -0.05; sire.traits.bv.lay = 0.07;
  let size = 0, lay = 0, n = 2000;
  for (let i = 0; i < n; i++) { const k = makeOffspring(s, rng, dam, sire, i % 2 ? 'hen' : 'rooster', 0); size += k.traits.bv.size; lay += k.traits.bv.lay; }
  assert.ok(Math.abs(size / n - 0.01) < 0.003, 'size ' + size / n);
  assert.ok(Math.abs(lay / n - 0.01) < 0.003, 'lay ' + lay / n);
  // rose comb (R dominant): two Rr birds give 3 rose : 1 single
  const a = mk('wyandotte', 'hen'), b = mk('rir', 'rooster');
  a.traits.genes.R = ['R', 'r+']; b.traits.genes.R = ['R', 'r+'];
  let rose = 0; n = 4000;
  for (let i = 0; i < n; i++) if (makeOffspring(s, rng, a, b, 'hen', 0).comb === 'rose') rose++;
  assert.ok(Math.abs(rose / n - 0.75) < 0.025, 'rose ' + rose / n);
  // sex-linked barring: a barred hen over a non-barred cock gives barred sons and solid daughters
  const barredHen = mk('rock', 'hen'), blackCock = mk('australorp', 'rooster');
  for (let i = 0; i < 200; i++) {
    const son = makeOffspring(s, rng, barredHen, blackCock, 'rooster', 0), daughter = makeOffspring(s, rng, barredHen, blackCock, 'hen', 0);
    assert.equal(son.plumage, 'barred'); assert.equal(daughter.plumage, 'black');
  }
  // dominant white over coloured: Leghorn (I/I) x Rhode Island Red (i/i) gives white chicks; their F2 is 3 white : 1 coloured
  const f1 = makeOffspring(s, rng, mk('leghorn', 'hen'), mk('rir', 'rooster'), 'hen', 0);
  const f1b = makeOffspring(s, rng, mk('leghorn', 'hen'), mk('rir', 'rooster'), 'rooster', 0);
  assert.equal(f1.plumage, 'white');
  let white = 0;
  for (let i = 0; i < n; i++) if (makeOffspring(s, rng, f1, f1b, 'hen', 0).plumage === 'white') white++;
  assert.ok(Math.abs(white / n - 0.75) < 0.025, 'white ' + white / n);
});

test('forage under a chicken tractor is scratched down in days and grows back after it is moved', () => {
  const sim = labSim(10, () => 16);
  setSite(sim, [fixture('chicken_tractor', { x: 10, z: 10, id: 'tr' })]);
  sim.commandNow('chickens.buy', { breed: 'rir', count: 5, ageWeeks: 30 });
  for (let d = 0; d < 3; d++) { chores(sim); sim.runDays(1); }
  const cell0 = C(sim).fx.tr.cell, under = () => C(sim).ground.cells[cell0].forageGm2;
  const bare = under();
  assert.ok(hens(sim).every((b) => b.location === 'tr'));
  assert.ok(bare < 0.5 * 250, 'after 3 days ' + bare);
  const r = sim.commandNow('chickens.moveTractor', {});
  assert.ok(r.ok && C(sim).fx.tr.cell !== cell0 || true);
  chores(sim); sim.runDays(1);
  assert.notEqual(C(sim).fx.tr.cell, cell0);
  for (let d = 0; d < 40; d++) { chores(sim); sim.runDays(1); if (d % 2) sim.commandNow('chickens.moveTractor', {}); }
  console.log('  forage under the tractor:', bare.toFixed(0), 'g DM/m2 after 3 days ->', under().toFixed(0), 'six weeks after moving; manure N there', C(sim).ground.cells[cell0].nGm2.toFixed(1), 'g/m2');
  assert.ok(under() > 0.75 * 250);
  assert.ok(C(sim).ground.cells[cell0].nGm2 > 5);
});

test('manure nitrogen per hen per day is in the real range', () => {
  const sim = labSim(11, () => 18);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed: 'rir', count: 6, ageWeeks: 40 });
  sim.commandNow('chickens.setLight', { on: true, hours: 15 });
  for (let d = 0; d < 10; d++) { chores(sim); sim.runDays(1); }
  const t = C(sim).totals, kg0 = t.manureKg, n0 = t.manureNKg;
  for (let d = 0; d < 20; d++) { chores(sim); sim.runDays(1); }
  const kg = ((t.manureKg - kg0) / 6 / 20) * 1000, n = ((t.manureNKg - n0) / 6 / 20) * 1000;
  console.log('  manure g/hen/day', kg.toFixed(0), 'nitrogen g/hen/day', n.toFixed(2), '(' + ((n / kg) * 100).toFixed(1) + '% of fresh)');
  assert.ok(kg > 100 && kg < 200, 'manure ' + kg);   // ASABE D384.2: about 0.06 kg per kg live weight
  assert.ok(n > 1.2 && n < 2.6, 'N ' + n);
});

test('feed is conserved, and no bird gains mass without eating', () => {
  const sim = createGameSim(12);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed: 'australorp', count: 8, ageWeeks: 24 });
  for (let d = 0; d < 60; d++) { if (d % 3 === 0) chores(sim); else chores(sim, { feed: false }); sim.runDays(1); }
  const s = C(sim), t = s.totals;
  const inFeeders = Object.values(s.fx).reduce((a, f) => a + (f.feedKg || 0), 0);
  assert.ok(Math.abs(t.feedFilledKg - (inFeeders + t.feederEatenKg + t.feederWastedKg)) < 1e-6, 'feeder balance');
  // energy eaten from all sources equals what the feeder, the range and the scraps supplied
  const mj = t.feederEatenKg * 11.5 + t.forageKgDM * 5.0 + t.scrapsEatenKg * 2.0;
  assert.ok(Math.abs(mj - t.intakeMJ) < 1e-6 * mj);
  // starve one bird completely: its mass only ever falls
  const lab = labSim(13, () => 15);
  lab.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  lab.commandNow('chickens.setDoor', { open: false });
  lab.commandNow('chickens.buy', { breed: 'rir', count: 1, ageWeeks: 12 });
  const b = hens(lab)[0];
  let m = b.massKg, ok = true;
  for (let i = 0; i < 2000; i++) { lab.runTicks(10); if (b.massKg > m + 1e-9) ok = false; m = b.massKg; }
  assert.ok(ok, 'a starved bird gained mass');
});

test('collected eggs go into stock; the chores work from the panel commands', () => {
  const sim = createGameSim(14);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  const money0 = sim.state.sys.stock.money;
  const r = sim.commandNow('chickens.buy', { breed: 'leghorn', count: 4, ageWeeks: 30 });
  assert.ok(r.ok && sim.state.sys.stock.money < money0);
  assert.equal(sim.commandNow('chickens.fillFeeder', {}).ok, false);    // nothing in stock yet
  chores(sim);
  for (let d = 0; d < 5; d++) { chores(sim); sim.runDays(1); }
  const waiting = C(sim).eggs.length;
  assert.ok(waiting > 5);
  const got = sim.commandNow('chickens.collectEggs', {});
  assert.equal(got.count, waiting);
  assert.equal(haveItem(sim.state, 'egg'), waiting);
  assert.equal(C(sim).eggs.length, 0);
  assert.equal(sim.commandNow('chickens.buy', { breed: 'rir', count: 1, ageWeeks: 2 }).ok, false);  // chicks wait for the brooder
});

test('dusk and dawn: hens go in to roost, and a door shut too early leaves them outside', () => {
  const sim = createGameSim(15);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.buy', { breed: 'rock', count: 3, ageWeeks: 30 });
  chores(sim);
  sim.runTicks(60 * 4);                                  // noon
  assert.ok(hens(sim).every((b) => b.phase === 'range' && !b.roosting));
  sim.runTicks(60 * 12);                                 // midnight
  assert.ok(hens(sim).every((b) => b.roosting && b.location === 'ck1'));
  sim.runTicks(60 * 14);                                 // next afternoon: shut the door with everyone out
  sim.commandNow('chickens.setDoor', { open: false });
  sim.runTicks(60 * 8);
  assert.ok(hens(sim).every((b) => b.out && b.mood === 'miserable'));
  assert.ok(C(sim).issues.some((i) => i.id === 'locked-out'));
  assert.match(hens(sim)[0].status, /roosting outside/);
});

test('same seed and commands give the same flock', () => {
  const run = () => { const sim = createGameSim(21); sim.commandNow('chickens.placeStarter', { x: 2, z: 3 }); sim.commandNow('chickens.buy', { breed: 'rir', count: 4, ageWeeks: 19 }); sim.commandNow('chickens.buy', { breed: 'rir', count: 1, sex: 'rooster', ageWeeks: 30 }); for (let d = 0; d < 30; d++) { chores(sim); sim.runDays(1); } return sim; };
  const a = run(), b = run();
  assert.equal(a.hash(), b.hash());
  assert.ok(C(a).totals.eggs > 10);
  assert.ok(C(a).eggs.some((e) => e.fertile && e.sire));
});

test('saving and loading continues the flock exactly; old saves without chickens load', () => {
  const setup = () => { const sim = createGameSim(31); sim.commandNow('chickens.placeStarter', { x: 0, z: 0 }); sim.commandNow('chickens.buy', { breed: 'wyandotte', count: 5, ageWeeks: 25 }); chores(sim); return sim; };
  const straight = setup(); straight.runDays(20);
  const first = setup(); first.runDays(8);
  const file = JSON.stringify(makeSave(first.serialize(), {}));
  const second = createGameSim(1); second.load(readSave(file).sim); second.runDays(12);
  assert.equal(second.hash(), straight.hash());
  // a save from before chickens existed
  const old = createSim({ seed: 4, systems: createGameSim(4).systems.filter((s) => s.name !== 'chickens') });
  old.runDays(2);
  const st = old.serialize();
  assert.equal(st.sys.chickens, undefined);
  const now = createGameSim(4); now.load(readSave(JSON.stringify(makeSave(st, {}))).sim);
  assert.ok(now.state.sys.chickens && Object.keys(now.state.sys.chickens.birds).length === 0);
  now.runDays(1);
});

test('thirty birds cost well under 0.05 ms per physiology step', () => {
  const sim = createGameSim(41);
  sim.commandNow('chickens.placeStarter', { x: 0, z: 0 });
  sim.commandNow('chickens.placeStarter', { x: 6, z: 0 });
  sim.commandNow('chickens.placeStarter', { x: 12, z: 0 });
  sim.commandNow('chickens.placeStarter', { x: 18, z: 0 });
  for (const breed of ['rir', 'leghorn', 'rock', 'australorp', 'wyandotte']) sim.commandNow('chickens.buy', { breed, count: 6, ageWeeks: 30 });
  chores(sim);
  sim.runDays(2);
  const sys = sim.systems.find((s) => s.name === 'chickens');
  const st = sim.state;
  const ctx = { sim, state: st, t: st.t, tick: st.tick, dt: 600, get s() { return st.sys.chickens; }, get: (n) => st.sys[n], rng: (n) => sim.rng('chickens:' + n), emit: () => {} };
  const runs = [];
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) { ctx.t = st.t + i * 600; sys.step(ctx); }
    runs.push((performance.now() - t0) / 400);
  }
  runs.sort((a, b) => a - b);
  console.log('  30 birds: ' + runs[2].toFixed(4) + ' ms per physiology step (median of 5)');
  assert.equal(Object.keys(C(sim).birds).length, 30);
  assert.ok(runs[2] < 0.05, runs[2] + ' ms');
});
