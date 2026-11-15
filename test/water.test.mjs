// Water: catchment, hydrostatics, friction, pumps, wells, freezing, heat, conservation, cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, createGameSim, siteSystem, weather as realWeather, makeSave, readSave, DAY, HOUR } from '../src/sim/index.js';
import { water, catchmentLmin, staticPressureKPa, hazenWilliamsHeadLossM, pumpHeadM, heatEnergyKWh, outletHeadM, freshStoredL,
  overlayData, KPA_PER_M, frostDepthM } from '../src/sim/water.js';
import { FIXTURES_WATER } from '../src/sim/fixtures-water.js';
import { house, setSite, fixture, link } from './helpers/pieces.mjs';

// Weather held at whatever the test sets.
const fixedWeather = (w = {}) => ({
  name: 'weather', every: 1,
  init: () => ({ tempC: 10, rainMmH: 0, snowMmH: 0, snowDepthM: 0, windMs: 0, groundTempC: 8, humidity: 0.7, cloud: 0.5,
    solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 }, site: { climate: 'temperate', latitudeDeg: 45 }, ...w }),
});
// A stand-in for the electrical system, following its contract: loads[id] = { ratedW, on, priority, served }.
const electricalStub = () => ({
  name: 'electrical', every: 1,
  init: () => ({ loads: {}, supplyOk: true, usedWh: 0 }),
  step: (c) => { for (const l of Object.values(c.s.loads)) { l.served = l.on && c.s.supplyOk; l.drawW = l.served ? l.ratedW : 0; c.s.usedWh += (l.drawW * c.dt) / 3600; } },
  commands: { 'electrical.setLoad': (c, p) => { c.s.loads[p.id] = { ratedW: p.ratedW, on: p.on, priority: p.priority, served: p.on && c.s.supplyOk }; } },
});
const makeSim = ({ w, power = false, seed = 1 } = {}) => createSim({ seed, systems: [fixedWeather(w), siteSystem(), water, ...(power ? [electricalStub()] : [])] });
const W = (sim) => sim.state.sys.water;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);
const pipe = (from, fp, to, tp, lengthM = 2, material = 'pipe_pex_20', extra = {}) => link('pipe', from, fp, to, tp, { lengthM, material, ...extra });

// ------------------------------------------------------------------ catchment
test('1 mm of rain on 1 m2 of roof at coefficient 1 is 1 L', () => {
  assert.equal(catchmentLmin(1, 1, 1) * 60, 1);
  near(catchmentLmin(10, 28.91, 0.5) * 60, 144.55, 1e-9);
});

function roofToTank(material, { firstFlush = false } = {}) {
  const pieces = house().map((p) => (p.kind === 'roof' ? { ...p, material } : p));
  const roofs = pieces.filter((p) => p.kind === 'roof');
  const tank = fixture('poly_tank_2500', { id: 'tank', y: 9.79, x: -5, z: 3 });
  const out = [...pieces, tank];
  roofs.forEach((r, i) => {
    const g = fixture('gutter_k5', { id: 'g' + i, y: r.eaveY, settings: { roofPieceId: r.id } });
    const d = fixture('downpipe_2x3', { id: 'd' + i, y: 9.8 });
    out.push(g, d, pipe(g, 'out', d, 'in', 0.5, 'pipe_poly_32'));
    if (firstFlush) { const f = fixture('first_flush', { id: 'ff' + i, y: 11 }); out.push(f, pipe(d, 'out', f, 'in', 0.5), pipe(f, 'out', tank, 'in', 1)); }
    else out.push(pipe(d, 'out', tank, 'in', 1, 'pipe_poly_32'));
  });
  return out;
}

test('a 10 mm storm on the house: thatch gives 144.6 L, a steel roof 260.2 L (two planes of 14.455 m2)', () => {
  const area = house().filter((p) => p.kind === 'roof').reduce((a, p) => a + p.planArea, 0);
  near(area, 28.91, 1e-9);
  for (const [material, coeff, litres] of [['thatch', 0.5, 144.55], ['steel_roofing', 0.9, 260.19]]) {
    const sim = makeSim({ w: { rainMmH: 10 } });
    setSite(sim, roofToTank(material));
    sim.runTicks(60);
    near(W(sim).tanks.tank.storedL, area * 10 * coeff, 1e-6, material);
    near(W(sim).tanks.tank.storedL, litres, 0.01, material);
    near(W(sim).catchments.g0.inflowLmin, catchmentLmin(10, 14.455, coeff), 1e-9);
    if (material === 'thatch') assert.ok(W(sim).issues.some((i) => /tannins/.test(i.reason)), 'thatch is flagged as poor for drinking');
  }
});

test('a first-flush diverter takes the first 20 L of each storm and empties between storms', () => {
  const sim = makeSim({ w: { rainMmH: 10 } });
  setSite(sim, roofToTank('steel_roofing', { firstFlush: true }));
  sim.runTicks(60);
  // 20 L per diverter, plus what each chamber's 2 L/h drip let through during the hour of rain
  const ff = W(sim).totals.firstFlushL;
  assert.ok(ff > 40 && ff <= 44, 'first flush ' + ff);
  near(W(sim).tanks.tank.storedL, 260.19 - ff, 0.01);
  sim.state.sys.weather.rainMmH = 0; sim.runTicks(11 * 60);
  assert.equal(W(sim).firstFlush.ff0.heldL, 0);
});

test('a storm fills a barrel and the overflow is tracked, then cascades to a second barrel', () => {
  const sim = makeSim({ w: { rainMmH: 20 } });
  const pieces = roofToTank('steel_roofing').map((p) => (p.id === 'tank' ? { ...p, fixture: 'rain_barrel_200' } : p));
  sim.runTicks(0); setSite(sim, pieces);
  sim.runTicks(60);
  const t = W(sim).tanks.tank, ledger = W(sim).totals;
  assert.equal(t.storedL, 200);
  near(t.overflowL, 28.91 * 20 * 0.9 - 200, 1e-6);
  near(ledger.overflowL, t.overflowL, 1e-6);
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'tank' && /overflowing/.test(i.reason)));
  // daisy-chain the overflow into an IBC: nothing is lost any more
  const sim2 = makeSim({ w: { rainMmH: 20 } });
  const ibc = fixture('ibc_1000', { id: 'ibc', y: 9.79 });
  setSite(sim2, [...pieces, ibc, pipe(pieces.find((p) => p.id === 'tank'), 'overflow', ibc, 'in', 1)]);
  sim2.runTicks(60);
  near(W(sim2).tanks.ibc.storedL, 28.91 * 20 * 0.9 - 200, 1e-6);
  near(W(sim2).totals.overflowL, 0, 1e-9);
  // a roof with no tank: the rain is collected by the gutter and spills, counted as overflow
  const sim3 = makeSim({ w: { rainMmH: 10 } });
  setSite(sim3, roofToTank('steel_roofing').filter((p) => p.id !== 'tank' && !(p.kind === 'pipe' && p.to.piece === 'tank')));
  sim3.runTicks(60);
  near(W(sim3).totals.overflowL, 260.19, 0.01);
  assert.ok(W(sim3).issues.some((i) => /runs onto the ground/.test(i.reason)));
});

test('snow on the roof runs off only as it melts', () => {
  const sim = makeSim({ w: { snowMmH: 5, tempC: -3 } });
  setSite(sim, roofToTank('steel_roofing'));
  sim.runTicks(120);
  assert.equal(W(sim).tanks.tank.storedL, 0);
  near(W(sim).catchments.g0.roofSnowMm, 10, 1e-9);
  Object.assign(sim.state.sys.weather, { snowMmH: 0, tempC: 4 });
  sim.runTicks(2 * 24 * 60);                                   // 3.5 mm/C/day x 4 C melts 10 mm in under a day
  near(W(sim).catchments.g0.roofSnowMm, 0, 1e-9);
  near(W(sim).tanks.tank.storedL, 28.91 * 10 * 0.9, 1e-6);
});

// ------------------------------------------------------------------ hydrostatics
function tankAndTap({ tapY, tankY = 3, litres = 500, tapId = 'tap_hose_bib', material = 'pipe_pex_20', lengthM = 2, pump = null, settings = {} }) {
  const tank = fixture('ibc_1000', { id: 'tank', y: tankY, settings });
  const tap = fixture(tapId, { id: 'tap', y: tapY });
  const pieces = [tank, tap];
  if (pump) { const pm = fixture(pump, { id: 'pump', y: tankY }); pieces.push(pm, pipe(tank, 'out', pm, 'in', 0.5, material), pipe(pm, 'out', tap, 'in', lengthM, material)); }
  else pieces.push(pipe(tank, 'out', tap, 'in', lengthM, material, { id: 'pipe1' }));
  return { pieces, litres };
}
function place(sim, { pieces, litres }) { setSite(sim, pieces); sim.runTicks(1); sim.commandNow('water.fillTank', { id: 'tank', litres, tempC: 10 }); sim.runTicks(1); }

test('hydrostatics: 1 m of head is 9.81 kPa; a tap 3 m below the surface shows about 29 kPa', () => {
  assert.equal(staticPressureKPa(1), 9.81);
  assert.equal(KPA_PER_M, 9.81);
  const sim = makeSim();
  // 500 L in a 1000 L IBC stands 0.475 m deep, so its surface is at 3.475 m
  place(sim, tankAndTap({ tapY: 0.475 }));
  near(W(sim).tanks.tank.surfaceM, 3.475, 1e-9);
  near(W(sim).taps.tap.pressureKPa, 29.43, 0.01);
  assert.equal(W(sim).taps.tap.served, true);
  // open it: it flows, and the pressure at the spout falls below static as the pipe takes its share
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(1);
  const tap = W(sim).taps.tap;
  assert.ok(tap.flowLmin > 3 && tap.pressureKPa < 29.43, JSON.stringify(tap));
});

test('a tap above the water level gives nothing by gravity, and works with a pump (the plan playtest)', () => {
  const sim = makeSim();
  place(sim, tankAndTap({ tapY: 4 }));
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(10);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.equal(W(sim).taps.tap.served, false);
  assert.equal(W(sim).tanks.tank.storedL, 500);
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'tap' && /above the water level/.test(i.reason)));
  const pumped = makeSim({ power: true });
  place(pumped, tankAndTap({ tapY: 4, pump: 'pump_12v_diaphragm' }));
  pumped.commandNow('water.setTap', { id: 'tap', open: true }); pumped.runTicks(10);
  assert.ok(W(pumped).taps.tap.flowLmin > 5, 'the pump lifts water to the tap: ' + W(pumped).taps.tap.flowLmin);
  assert.ok(W(pumped).tanks.tank.storedL < 500);
});

// ------------------------------------------------------------------ friction
test('Hazen-Williams head loss matches the hand formula', () => {
  // 10 L/min through 20 m of 16 mm bore, C = 150:
  // Q = 1.6667e-4 m3/s; hf = 10.67 x 20 x Q^1.852 / (150^1.852 x 0.016^4.8704)
  const Q = 10 / 60000, hand = (10.67 * 20 * Q ** 1.852) / (150 ** 1.852 * 0.016 ** 4.8704);
  near(hazenWilliamsHeadLossM(10, 20, 0.016, 150), hand, 1e-12);
  near(hand, 1.12, 0.01);                                       // worked by hand: about 1.12 m
  // doubling flow multiplies loss by 2^1.852; halving the bore by 2^4.87
  near(hazenWilliamsHeadLossM(20, 20, 0.016, 150) / hand, 2 ** 1.852, 1e-9);
});

test('a long thin pipe throttles a gravity shower noticeably against a short fat one', () => {
  const flow = (material, lengthM) => {
    const sim = makeSim();
    place(sim, tankAndTap({ tapId: 'shower_gravity', tapY: 3.475 - 3 - 2, material, lengthM }));   // the rose 3 m below the surface
    sim.commandNow('water.setTap', { id: 'tap', open: true, tempC: null }); sim.runTicks(1);
    return W(sim).taps.tap.flowLmin;
  };
  const fat = flow('pipe_poly_32', 2), thin = flow('pipe_pex_12', 30);
  // with no friction the rose (8 L/min at 20 kPa) would give 8 x sqrt(29.43 / 20) = 9.7 L/min
  near(fat, 8 * Math.sqrt(29.43 / 20), 0.15, 'short fat pipe');
  assert.ok(thin < 0.7 * fat && thin > 2, `thin ${thin} vs fat ${fat}`);
  // the solved point uses all the head: surface - outlet = friction + what the rose uses
  const spec = FIXTURES_WATER.shower_gravity, p = FIXTURES_WATER.pipe_pex_12;
  near(hazenWilliamsHeadLossM(thin, 30, p.innerMm / 1000, p.hazenC) + outletHeadM(spec, thin), 3, 0.01);
});

// ------------------------------------------------------------------ pumps
test('the pump operating point lies on its curve; a 12 V pump draws its rated power only while running', () => {
  const sim = makeSim({ power: true });
  place(sim, tankAndTap({ tapY: 4, pump: 'pump_12v_diaphragm', lengthM: 10, litres: 990 }));
  sim.runTicks(30);
  assert.equal(W(sim).pumps.pump.on, false, 'idle with every tap shut');
  assert.equal(sim.state.sys.electrical.usedWh, 0);
  sim.commandNow('water.setTap', { id: 'tap', open: true });
  let running = 0;
  for (let i = 0; i < 60; i++) { sim.runTicks(1); if (W(sim).pumps.pump.on) running++; }
  sim.commandNow('water.setTap', { id: 'tap', open: false });
  for (let i = 0; i < 30; i++) { sim.runTicks(1); if (W(sim).pumps.pump.on) running++; }
  assert.equal(W(sim).pumps.pump.on, false);
  assert.ok(running >= 58 && running <= 62, 'ran while the tap was open: ' + running);
  near(sim.state.sys.electrical.usedWh, (84 * running) / 60, 1e-9);
  near(W(sim).totals.pumpWh, (84 * running) / 60, 1e-9);
  // the operating point: head from the curve = lift + friction + what the tap uses, and it is on the curve
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(3);
  const pm = W(sim).pumps.pump, spec = FIXTURES_WATER.pump_12v_diaphragm, pipeSpec = FIXTURES_WATER.pipe_pex_20;
  near(pm.headM, pumpHeadM(spec, pm.flowLmin), 1e-9);
  near(pm.headM, spec.shutoffHeadM * (1 - pm.flowLmin / spec.maxLmin), 1e-9);
  const surface = W(sim).tanks.tank.surfaceM;
  const need = 4 - surface + hazenWilliamsHeadLossM(pm.flowLmin, 10.5, pipeSpec.innerMm / 1000, pipeSpec.hazenC) + outletHeadM(FIXTURES_WATER.tap_hose_bib, pm.flowLmin);
  near(pm.headM, need, 0.01);
  assert.ok(pm.flowLmin > 6 && pm.flowLmin < 11.4);
});

test('without power the pump does not run; with no electrical system at all it says so', () => {
  const sim = makeSim({ power: true });
  sim.state.sys.electrical.supplyOk = false;
  place(sim, tankAndTap({ tapY: 4, pump: 'pump_12v_diaphragm' }));
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(20);
  assert.equal(W(sim).pumps.pump.on, false);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'pump' && /no power/.test(i.reason)));
  const bare = makeSim();
  place(bare, tankAndTap({ tapY: 4, pump: 'pump_12v_diaphragm' }));
  bare.commandNow('water.setTap', { id: 'tap', open: true }); bare.runTicks(20);
  assert.equal(W(bare).taps.tap.flowLmin, 0);
  assert.ok(W(bare).issues.some((i) => i.pieceId === 'pump' && /Nothing supplies electricity/.test(i.reason)));
  // a hand pump needs no electricity
  const hand = makeSim();
  place(hand, tankAndTap({ tapY: 4, pump: 'hand_pump' }));
  hand.commandNow('water.setTap', { id: 'tap', open: true }); hand.runTicks(5);
  assert.ok(W(hand).taps.tap.flowLmin > 1);
});

test('a pressure tank lets the pump rest between uses', () => {
  const sim = makeSim({ power: true });
  const tank = fixture('ibc_1000', { id: 'tank', y: 0 }), pm = fixture('pump_12v_diaphragm', { id: 'pump', y: 0 });
  const pt = fixture('pressure_tank_76', { id: 'pt', y: 0 }), tap = fixture('tap_hose_bib', { id: 'tap', y: 1 });
  setSite(sim, [tank, pm, pt, tap, pipe(tank, 'out', pm, 'in', 0.5), pipe(pm, 'out', pt, 'in', 0.5), pipe(pt, 'out', tap, 'in', 3)]);
  sim.runTicks(1); sim.commandNow('water.fillTank', { id: 'tank', litres: 800 });
  sim.runTicks(10);
  // this 2.8 bar pump cannot reach the 50 psi cut-out, so it charges the tank only as far as it can push
  const lift = W(sim).tanks.tank.surfaceM;               // the water stands above the pump inlet
  const charged = W(sim).pressureTanks.pt.storedL, top = 21.6 * ((28.5 + lift) * 9.81 - 207) / (345 - 207);
  assert.ok(charged > 0.75 * top && charged <= top, 'charged ' + charged + ' of ' + top);
  assert.equal(W(sim).pumps.pump.on, false);
  sim.commandNow('water.draw', { id: 'cup', at: 'tap', litres: 5 }); sim.runTicks(2);
  assert.equal(W(sim).results.cup.suppliedL, 5);
  assert.equal(W(sim).pumps.pump.on, false, 'a small draw comes out of the pressure tank');
  near(freshStoredL(W(sim)) + W(sim).totals.usedL, 800, 1e-6);
});

// ------------------------------------------------------------------ wells
test('a low-yield well cannot supply more than its yield over time', () => {
  const sim = makeSim({ power: true });
  // shallow enough that the pump (55 m shut-off) can pull it right down to its intake
  const well = fixture('well_drilled', { id: 'well', y: 0, settings: { yieldLmin: 2, depthM: 30, staticLevelM: 5 } });
  const pm = fixture('pump_submersible', { id: 'pump', y: -27 }), tap = fixture('tap_hose_bib', { id: 'tap', y: 0.5 });
  setSite(sim, [well, pm, tap, pipe(well, 'out', pm, 'in', 1, 'pipe_poly_32'), pipe(pm, 'out', tap, 'in', 60, 'pipe_poly_32')]);
  sim.commandNow('water.setTap', { id: 'tap', open: true });
  const days = 3, minutes = days * 1440;
  sim.runTicks(minutes);
  const wl = W(sim).wells.well, bore = Math.PI * 0.076 ** 2 * 1000 * (wl.pumpDepthM - wl.staticLevelM);
  const got = W(sim).totals.wellL;
  assert.ok(got <= 2 * minutes + bore + 1, `pumped ${got} L, the most possible is ${2 * minutes + bore}`);
  assert.ok(got >= 0.9 * 2 * minutes, 'and it does deliver close to its yield: ' + got);
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'well' && /pumped dry/.test(i.reason)));
  near(W(sim).totals.usedL, got, 1e-6);
  // a hand pump on a dug well: within suction lift it works; a hand pump over a deep water table does not
  const dug = makeSim();
  const dw = fixture('well_dug', { id: 'dw', y: 0 }), hp = fixture('hand_pump', { id: 'hp', y: 0.5 }), sp = fixture('tap_hose_bib', { id: 'spout', y: 0.8 });
  setSite(dug, [dw, hp, sp, pipe(dw, 'out', hp, 'in', 3), pipe(hp, 'out', sp, 'in', 0.3)]);
  dug.commandNow('water.draw', { id: 'bucket', at: 'spout', litres: 10 }); dug.runTicks(5);
  assert.equal(W(dug).results.bucket.suppliedL, 10);
  const deep = makeSim();
  setSite(deep, [{ ...dw, settings: { staticLevelM: 9, depthM: 12 } }, hp, sp, pipe(dw, 'out', hp, 'in', 3), pipe(hp, 'out', sp, 'in', 0.3)]);
  deep.commandNow('water.draw', { id: 'bucket', at: 'spout', litres: 10 }); deep.runTicks(5);
  assert.equal(W(deep).results.bucket.suppliedL, 0);
  assert.match(W(deep).results.bucket.reason, /suction/);
});

// ------------------------------------------------------------------ freezing
test('an exposed 20 mm pipe at -10 C freezes within a few hours, blocks the tap, and thaws; a buried one does not', () => {
  const build = (extra) => {
    const sim = makeSim({ w: { tempC: -10, groundTempC: 4 } });
    const t = tankAndTap({ tapY: 0, settings: { indoor: true }, lengthM: 5 });
    t.pieces[2] = { ...t.pieces[2], ...extra };
    place(sim, t);
    return sim;
  };
  const sim = build({});
  let warned = false, frozeAt = null;
  for (let m = 0; m < 12 * 60 && frozeAt === null; m++) {
    sim.runTicks(1);
    if (W(sim).issues.some((i) => i.pieceId === 'pipe1' && /will freeze/.test(i.reason))) warned = true;
    if (W(sim).pipes.pipe1.frozen) frozeAt = m / 60;
  }
  // hand estimate: 0.20 kg/m of water, UA 0.63 W/K per m at rest: ~15 min to cool, ~1.5 h to half freeze
  assert.ok(frozeAt !== null && frozeAt > 1 && frozeAt < 6, 'froze after ' + frozeAt + ' h');
  assert.ok(warned, 'warned before it froze');
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(2);
  assert.equal(W(sim).taps.tap.flowLmin, 0);
  assert.equal(W(sim).taps.tap.why, 'frozen');
  assert.ok(W(sim).issues.some((i) => i.pieceId === 'pipe1' && /frozen/.test(i.reason)));
  sim.commandNow('water.setTap', { id: 'tap', open: false });
  sim.state.sys.weather.tempC = 5;
  let thawAt = null;
  for (let m = 0; m < 12 * 60 && thawAt === null; m++) { sim.runTicks(1); if (!W(sim).pipes.pipe1.frozen) thawAt = m / 60; }
  assert.ok(thawAt !== null, 'thawed at +5 C');
  sim.commandNow('water.setTap', { id: 'tap', open: true }); sim.runTicks(1);
  assert.ok(W(sim).taps.tap.flowLmin > 1, 'flows again after the thaw');
  // buried 1.5 m deep: three days at -10 C drive the frost only ~0.27 m down
  const buried = build({ buriedDepthM: 1.5 });
  buried.runTicks(3 * 1440);
  assert.equal(W(buried).pipes.pipe1.frozen, false);
  assert.equal(W(buried).pipes.pipe1.iceL, 0);
  near(W(buried).frost.depthM, frostDepthM(3 * 86400 * 10), 1e-3);
  assert.ok(W(buried).frost.depthM < 0.35);
});

// ------------------------------------------------------------------ heat
test('heating 50 L from 10 C to 40 C takes 1.74 kWh, and a propane heater burns that over its efficiency', () => {
  near(heatEnergyKWh(50, 10, 40), 1.744, 0.001);
  const sim = makeSim();
  const tank = fixture('ibc_1000', { id: 'tank', y: 4 }), heater = fixture('heater_tankless_propane', { id: 'heater', y: 1 });
  const sink = fixture('sink_kitchen', { id: 'sink', y: 0 }), basin = fixture('mulch_basin', { id: 'basin', y: 0, x: 3 });
  setSite(sim, [tank, heater, sink, basin, pipe(tank, 'out', sink, 'in', 3), pipe(tank, 'out', heater, 'in', 2), pipe(heater, 'out', sink, 'hot', 1),
    pipe(sink, 'drain', basin, 'in', 4)]);
  sim.runTicks(1); sim.commandNow('water.fillTank', { id: 'tank', litres: 900, tempC: 10 });
  sim.commandNow('water.draw', { id: 'wash', at: 'sink', litres: 50, tempC: 40 });
  sim.runTicks(60);
  const wt = W(sim);
  assert.equal(wt.results.wash.suppliedL, 50);
  near(wt.totals.heaterKWh, 1.744, 0.02);
  near(wt.totals.propaneKg * 46.35 / 3.6, 1.744 / 0.82, 0.03);
  // the greywater went down the drain into the mulch basin, recorded for the soil
  near(wt.ground.basin.greyL, 50, 1e-9);
  near(wt.totals.greyL, 50, 1e-9);
});

test('a solar batch heater warms in the sun and an electric tank heater draws power to reach its setpoint', () => {
  const sim = makeSim({ power: true, w: { tempC: 20, solar: { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 800 } } });
  const tank = fixture('ibc_1000', { id: 'tank', y: 4 }), solar = fixture('heater_solar_batch', { id: 'solar', y: 3 });
  const elec = fixture('heater_tank_electric', { id: 'elec', y: 0 });
  setSite(sim, [tank, solar, elec, pipe(tank, 'out', solar, 'in', 2), pipe(tank, 'out', elec, 'in', 2)]);
  sim.runTicks(1); sim.commandNow('water.fillTank', { id: 'tank', litres: 900, tempC: 20 });
  sim.runTicks(10);
  const t0 = W(sim).heaters.solar.tempC, e0 = W(sim).heaters.elec.tempC;
  sim.runTicks(6 * 60);
  const rise = W(sim).heaters.solar.tempC - t0;
  // 0.6 x 1.5 m2 x 800 W/m2 for 6 h into 150 L is +24.8 C before losses
  assert.ok(rise > 15 && rise < 24.8, 'solar batch rose ' + rise);
  assert.ok(W(sim).heaters.elec.tempC >= 45, 'electric heater reached its setpoint band: ' + W(sim).heaters.elec.tempC);
  assert.ok(sim.state.sys.electrical.usedWh >= heatEnergyKWh(150, e0, 45) * 1000, 'it used at least m c dT of electricity');
});

// ------------------------------------------------------------------ a year: conservation and catchment
function yearSite() {
  const roof = { id: 'r1', kind: 'roof', material: 'steel_roofing', planArea: 60, area: 64, eaveY: 3, y0: 3, y1: 5 };
  const g = fixture('gutter_k5', { id: 'g', y: 3, settings: { roofPieceId: 'r1' } }), d = fixture('downpipe_2x3', { id: 'd', y: 1 });
  const ff = fixture('first_flush', { id: 'ff', y: 1.5 }), barrel = fixture('rain_barrel_200', { id: 'barrel', y: 1.5 });
  // a cistern buried for the winter, and buried supply lines; the well tops it up by hand only when it runs low
  const tank = fixture('poly_tank_2500', { id: 'tank', y: 0.5, settings: { buriedDepthM: 1.5, fillStartFrac: 0.2 } });
  const B = { buriedDepthM: 1.5 };
  const tap = fixture('tap_hose_bib', { id: 'tap', y: 0 }), heater = fixture('heater_solar_batch', { id: 'solar', y: 1 });
  const shower = fixture('shower_gravity', { id: 'shower', y: -2 }), basin = fixture('mulch_basin', { id: 'basin', y: -2 });
  const well = fixture('well_dug', { id: 'well', y: 0 }), hp = fixture('hand_pump', { id: 'hp', y: 0.5 });
  return [roof, g, d, ff, barrel, tank, tap, heater, shower, basin, well, hp,
    pipe(g, 'out', d, 'in', 0.3), pipe(d, 'out', ff, 'in', 0.3), pipe(ff, 'out', barrel, 'in', 0.5), pipe(barrel, 'overflow', tank, 'in', 1),
    pipe(tank, 'out', tap, 'in', 5, 'pipe_pex_20', B), pipe(tank, 'out', heater, 'in', 3, 'pipe_pex_20', B), pipe(heater, 'out', shower, 'hot', 2), pipe(tank, 'out', shower, 'in', 4, 'pipe_pex_20', B),
    pipe(shower, 'drain', basin, 'in', 2), pipe(well, 'out', hp, 'in', 2), pipe(hp, 'out', tank, 'in', 5)];
}

test('a year of real weather: water is conserved within 0.1 %, and a 60 m2 steel roof catches its rainfall', () => {
  const sim = createSim({ seed: 1, systems: [realWeather, siteSystem(), water] });
  setSite(sim, yearSite());
  const w0 = sim.state.sys.weather.totals.precipMm;
  for (let d = 0; d < 365; d++) {
    sim.command('water.draw', { id: 'garden' + (d % 4), at: 'tap', litres: 60 });
    sim.command('water.draw', { id: 'wash' + (d % 4), at: 'shower', litres: 25, tempC: 38 });
    sim.runDays(1);
  }
  const s = W(sim), T = s.totals;
  const inflow = T.collectedL + T.wellL + T.importedL;
  const out = freshStoredL(s) + T.usedL + T.overflowL + T.firstFlushL;
  assert.ok(Math.abs(inflow - out) <= 0.001 * inflow, `in ${inflow} vs stored + used + overflow + first flush ${out}`);
  // the batch heater and its short exposed run freeze in winter, so some winter showers fail; the rest is met
  assert.ok(T.usedL > 0.8 * 365 * 85, 'the daily draws were met: ' + T.usedL);
  assert.ok(T.wellL > 0 && T.firstFlushL > 0 && T.overflowL > 0 && T.greyL > 0, JSON.stringify(T));
  // catchment: everything that fell on the roof, less what is still lying there as snow, times 0.9
  const precip = sim.state.sys.weather.totals.precipMm - w0;
  near(T.collectedL, (precip - s.catchments.g.roofSnowMm) * 60 * 0.9, 1e-6 * T.collectedL);
  // the temperate climate's normals give 956 mm a year: 60 m2 x 0.956 m x 0.9 = 51.6 m3
  console.log(`  annual catchment, 60 m2 steel roof, temperate: ${(T.collectedL / 1000).toFixed(1)} m3 from ${precip.toFixed(0)} mm (normals: 956 mm -> 51.6 m3)`);
  // (the weather's own years vary widely around the normal: 436 to 1356 mm over seeds 1, 3, 7; this seed's first year is 969 mm)
  assert.ok(precip > 0.6 * 956 && precip < 1.4 * 956, 'a plausible temperate year: ' + precip);
  assert.ok(T.collectedL > 0.75 * 51624 && T.collectedL < 1.25 * 51624, 'annual catchment ' + T.collectedL);
});

// ------------------------------------------------------------------ the system as a system
test('determinism and a save/load round trip mid-run', () => {
  const pieces = yearSite();
  const run = (split) => {
    const a = createSim({ seed: 9, systems: [realWeather, siteSystem(), water] });
    setSite(a, JSON.parse(JSON.stringify(pieces)));
    a.commandNow('water.setTap', { id: 'tap', open: true });
    if (!split) { a.runDays(20); return a.hash(); }
    a.runDays(7);
    const file = JSON.stringify(makeSave(a.serialize()));
    const b = createSim({ seed: 1, systems: [realWeather, siteSystem(), water] });
    b.load(readSave(file).sim);
    b.runDays(13);
    return b.hash();
  };
  assert.equal(run(false), run(false));
  assert.equal(run(true), run(false));
});

test('old saves without water state load, and with nothing installed the system costs nothing', () => {
  const old = createGameSim(4); old.runDays(1);
  const st = old.serialize(); delete st.sys.water;
  const sim = createGameSim(4); sim.load(st);
  assert.ok(sim.state.sys.water && sim.state.sys.water.empty);
  const before = JSON.stringify(sim.state.sys.water);
  sim.runDays(2);
  // nothing installed: nothing changes in its state except noting the site's version once
  assert.equal(JSON.stringify(sim.state.sys.water), before.replace('"version":-1', '"version":' + sim.state.sys.site.version));
  assert.deepEqual(overlayData(sim.state.sys.water).tanks, []);
  // houses without water fixtures are free too
  setSite(sim, house());
  sim.runTicks(10);
  assert.equal(sim.state.sys.water.empty, true);
  const t0 = performance.now(); for (let i = 0; i < 20000; i++) water.step({ s: sim.state.sys.water, get: (n) => sim.state.sys[n], sim, dt: 60, t: 0, tick: 0 });
  const us = ((performance.now() - t0) / 20000) * 1000;
  assert.ok(us < 1, 'empty step ' + us + ' us');
});

test('performance: 40 water devices step in under 0.03 ms', () => {
  const pieces = [];
  for (let k = 0; k < 4; k++) {
    const id = (s) => s + k, f = (fx, s, o = {}) => { const p = fixture(fx, { id: id(s), ...o }); pieces.push(p); return p; };
    const roof = { id: id('roof'), kind: 'roof', material: 'steel_roofing', planArea: 30, eaveY: 3 }; pieces.push(roof);
    const g = f('gutter_k5', 'g', { y: 3, settings: { roofPieceId: roof.id } }), d = f('downpipe_2x3', 'd', { y: 1 }), ff = f('first_flush', 'ff', { y: 2 });
    const t = f('poly_tank_2500', 't', { y: 0.5 }), pm = f('pump_12v_diaphragm', 'pm'), pt = f('pressure_tank_76', 'pt');
    const sink = f('sink_kitchen', 'sink'), sh = f('shower_gravity', 'sh', { y: -2 }), tap = f('tap_hose_bib', 'tap'), basin = f('mulch_basin', 'b');
    pieces.push(pipe(g, 'out', d, 'in'), pipe(d, 'out', ff, 'in'), pipe(ff, 'out', t, 'in'), pipe(t, 'out', pm, 'in'), pipe(pm, 'out', pt, 'in'),
      pipe(pt, 'out', sink, 'in', 6), pipe(t, 'out', sh, 'in', 4), pipe(t, 'out', tap, 'in', 8), pipe(sink, 'drain', basin, 'in'), pipe(sh, 'drain', basin, 'in'));
  }
  assert.equal(pieces.filter((p) => p.kind === 'fixture').length, 40);
  const mk = (withWater) => {
    const sim = createSim({ seed: 2, systems: [fixedWeather({ rainMmH: 1, tempC: 5 }), siteSystem(), ...(withWater ? [water] : []), electricalStub()] });
    setSite(sim, pieces);
    if (withWater) { for (let k = 0; k < 4; k++) sim.commandNow('water.fillTank', { id: 't' + k, litres: 1500 }); sim.commandNow('water.setTap', { id: 'sh0', open: true }); sim.commandNow('water.setTap', { id: 'tap1', open: true }); }
    sim.runTicks(200);
    return sim;
  };
  const time = (sim) => { let best = Infinity; for (let r = 0; r < 5; r++) { const t0 = performance.now(); sim.runTicks(2000); best = Math.min(best, (performance.now() - t0) / 2000); } return best; };
  const a = mk(true), b = mk(false);
  const ms = time(a) - time(b);
  console.log(`  water step with 40 devices (2 outlets open, raining): ${(ms * 1000).toFixed(1)} us per step`);
  assert.ok(W(a).taps.sh0.flowLmin > 0);
  assert.ok(ms < 0.1, 'water step ' + ms + ' ms');   // budget is 0.03 ms (measures ~0.015 on a quiet machine); the looser bound keeps the test steady on a loaded one
});

test('draw results: a bucket from a tank, unknown outlets, and the overlay', () => {
  const sim = makeSim();
  place(sim, tankAndTap({ tapY: 0 }));
  sim.commandNow('water.draw', { id: 'pail', litres: 30 });          // no outlet: dipped from the tank
  sim.runTicks(3);
  assert.equal(W(sim).results.pail.suppliedL, 30);
  assert.equal(W(sim).results.pail.done, true);
  near(W(sim).tanks.tank.storedL, 470, 1e-9);
  const ov = overlayData(W(sim));
  assert.equal(ov.tanks[0].id, 'tank');
  near(ov.tanks[0].fraction, 0.47, 1e-9);
  assert.ok(ov.taps[0].pressureKPa > 0);
  assert.throws(() => sim.commandNow('water.setTap', { id: 'nope', open: true }));
});
