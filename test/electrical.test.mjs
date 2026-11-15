// Electrical: checked against hand calculations, datasheet relationships and conservation. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, calendar as C, DAY, HOUR, ITEMS, FIXTURES_ELECTRICAL as CAT, powerAvailableAt, electricalOverlay } from '../src/sim/index.js';
import { planeOfArray, ocvAt } from '../src/sim/electrical.js';
import { fixture, link, setSite, house } from './helpers/pieces.mjs';

const wire = (a, ap, b, bp, gauge, lengthM) => link('wire', a, ap, b, bp, { gauge, lengthM });
const E = (sim) => sim.state.sys.electrical;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' +- ' + tol + ', got ' + a);
// run world time forward with nothing built (weather only) to a day of the year at a given hour
function goTo(sim, doy, hour) {
  const target = (doy - C.START_DAY_OF_YEAR) * DAY + hour * HOUR;
  sim.runTicks(Math.max(0, Math.round((target - sim.state.t) / 60)));
}
const books = (y) => ({ inW: y.generatedWh + y.dischargedWh + y.generatorWh, outW: y.usedWh + y.chargedWh + y.wireLossWh + y.inverterLossWh + y.wastedWh });

// A whole homestead: 8 x 400 W in two strings of two series pairs, 15 kWh of 48 V lithium, a split-phase
// inverter, an auto-start generator and seventeen loads behind breakers. 40 fixtures, 39 wires.
function homestead() {
  const P = [], W = [];
  const f = (id, o) => { const x = fixture(id, o); P.push(x); return x; };
  const w = (...a) => W.push(wire(...a));
  const bus = f('busbar_dc');
  for (let k = 0; k < 2; k++) {
    const cc = f('cc_mppt_60a', { settings: { seriesPanels: 2 } });
    for (let i = 0; i < 4; i++) w(f('panel_400w', { settings: { tiltDeg: 40, azimuthDeg: 175 } }), 'pv', cc, 'pv', 10, 12);
    w(cc, 'bat', bus, 'p' + (k + 1), 6, 2);
  }
  for (let i = 0; i < 3; i++) w(f('bat_lfp_48v_5kwh'), 'dc', bus, 'main', 2, 1);
  const inv = f('inv_48v_6000w'); w(bus, 'p4', inv, 'dc', '2/0', 1.5);
  const gen = f('gen_petrol_5500w', { settings: { autoStart: true } });
  const pnl = f('panel_ac_100a'); w(inv, 'ac', pnl, 'main', 4, 2); w(gen, 'ac', pnl, 'b20', 6, 10);
  const loads = [['light_led_9w', 10, { hours: [[17, 23]] }], ['well_pump', 1, { dutyFraction: 0.05 }], ['circ_pump', 1], ['space_heater', 1, { dutyFraction: 0.3 }],
    ['tool_circular_saw', 1, { hours: [[9, 12]], dutyFraction: 0.2 }], ['outlet_120v', 3, { ratedW: 60 }]];
  let slot = 1;
  for (const [id, n, settings] of loads) {
    const br = f(id === 'well_pump' ? 'breaker_20a' : 'breaker_15a'); w(pnl, 'b' + slot++, br, 'line', 14, 0.2);
    for (let i = 0; i < n; i++) w(br, 'load', f(id, { settings }), 'power', 12, 8 + i);
  }
  return [...P, ...W];
}

test('the catalog has the contract shape, real ratings, and tools draw what items.js says', () => {
  for (const e of Object.values(CAT)) {
    assert.equal(e.system, 'electrical'); assert.ok(e.id && e.name && e.category, e.id);
    assert.ok(Array.isArray(e.ports) && e.priceUsd > 0 && e.massKg > 0 && e.dims && e.dims.w > 0, e.id);
  }
  for (const id of ['circular_saw', 'power_drill', 'chainsaw', 'table_saw']) assert.equal(CAT['tool_' + id].ratedW, ITEMS[id].powerW);
  // wire resistance against NEC Chapter 9 Table 8 (stranded copper at 75 C, ohm per 1000 ft); ours is computed, solid
  const nec = { 14: 3.14, 12: 1.98, 10: 1.24, 8: 0.778, 6: 0.491, 4: 0.308, 2: 0.194 };
  for (const [g, r] of Object.entries(nec)) near(CAT['wire_awg' + g].ohmPerM, r / 304.8, (0.04 * r) / 304.8, g + ' AWG');
  assert.deepEqual(['14', '12', '10', '8', '6', '4', '2'].map((g) => CAT['wire_awg' + g].ampacityA), [15, 20, 30, 50, 65, 85, 115]);
  // round trips: lead-acid about 80-85 %, lithium about 95 %
  const rt = (id) => CAT[id].chargeEff * CAT[id].dischargeEff;
  assert.ok(rt('bat_agm_12v_100ah') > 0.8 && rt('bat_agm_12v_100ah') < 0.85);
  near(rt('bat_lfp_12v_100ah'), 0.95, 0.005);
  // inverter loss model reproduces its datasheet points
  for (const id of ['inv_12v_1000w', 'inv_48v_3000w', 'inv_48v_6000w']) {
    const d = CAT[id], eff = (P) => P / (P + d.idleW + d.lossK1 * P + d.lossK2 * P * P);
    near(eff(d.ratedW / 2), d.eff50, 1e-9); near(eff(d.ratedW), d.eff100, 1e-9);
  }
  // OCV rises with charge; 12.8 V lithium sits near 13.1-13.3 V mid-range
  const lfp = CAT.bat_lfp_12v_100ah; assert.ok(ocvAt(lfp, 0.5) > 13.0 && ocvAt(lfp, 0.5) < 13.3 && ocvAt(lfp, 0.9) > ocvAt(lfp, 0.2));
});

test('geometry: noon at midsummer on a well-tilted south panel gets 850-1050 W/m2 under a clear sky', () => {
  const site = { latitudeDeg: 45 };
  let best = 0;
  for (let m = 660; m <= 780; m += 2) {
    const t = (171 - C.START_DAY_OF_YEAR) * DAY + m * 60;
    const poa = planeOfArray(C.clearSkyIrradiance(t, site), C.sunPosition(t, site), 30 * Math.PI / 180, Math.PI).poaWm2;
    best = Math.max(best, poa);
  }
  assert.ok(best > 850 && best < 1050, String(best));
  // a panel facing away from the sun only sees the sky
  const t = (171 - C.START_DAY_OF_YEAR) * DAY + 12 * HOUR, sky = C.clearSkyIrradiance(t, site);
  const north = planeOfArray(sky, C.sunPosition(t, site), Math.PI / 2, 0);
  assert.equal(north.beamWm2, 0); assert.ok(north.poaWm2 < 200);
});

test('geometry: over a year, south at latitude beats flat beats north, and 1 kW yields a realistic 1100-1500 kWh', () => {
  const sim = createGameSim(1);
  const mk = (tilt, az) => { const p = fixture('panel_400w', { settings: { tiltDeg: tilt, azimuthDeg: az } }), c = fixture('cc_mppt_60a'); return [p, c, wire(p, 'pv', c, 'pv', 10, 2)]; };
  const S = mk(45, 180), F = mk(0, 180), N = mk(45, 0);
  setSite(sim, [...S, ...F, ...N]);
  sim.runDays(365);
  const y = (set) => E(sim).sources[set[0].id].energyWh / 400;   // kWh of DC array output per kW of panel
  console.log('annual DC yield, kWh/kW: south 45', y(S).toFixed(0), 'flat', y(F).toFixed(0), 'north 45', y(N).toFixed(0));
  assert.ok(y(S) > y(F) && y(F) > y(N));
  assert.ok(y(S) > 1100 && y(S) < 1500, String(y(S)));
});

test('energy is conserved over 30 days of a whole homestead, in the books and inside the batteries', () => {
  const sim = createGameSim(5), pieces = homestead();
  setSite(sim, pieces);
  sim.runTicks(1);
  const s0 = Object.values(E(sim).batteries).reduce((a, b) => a + b.storedWh, 0), t0 = { ...E(sim).totals };
  sim.runDays(30);
  const e = E(sim), y = {};
  for (const k of Object.keys(t0)) if (typeof t0[k] === 'number') y[k] = e.totals[k] - t0[k];
  const { inW, outW } = books(y);
  assert.ok(Math.abs(inW - outW) <= 0.005 * inW, inW + ' vs ' + outW);
  near(inW - outW, 0, 1e-3, 'books balance to the milliwatt-hour');
  // inside: stored change = charged x eff - discharged / eff - self-discharge (one chemistry, so one pair of efficiencies)
  const d = CAT.bat_lfp_48v_5kwh, s1 = Object.values(e.batteries).reduce((a, b) => a + b.storedWh, 0);
  near(s1 - s0, y.chargedWh * d.chargeEff - y.dischargedWh / d.dischargeEff - y.selfDischargeWh, 1e-3);
  // upstream of the controllers
  near(y.arrayWh, y.generatedWh + y.controllerLossWh + y.pvWireLossWh, 1e-3);
  assert.ok(y.generatedWh > 0 && y.usedWh > 0 && y.dischargedWh > 0 && y.inverterLossWh > 0 && y.wireLossWh > 0);
});

// 12 V lithium, one 200 W panel, a DC load
function smallDc(sim, { batteryId = 'bat_lfp_12v_100ah', socStart = 0.5, loadW = 100, loadOn = true } = {}) {
  const pan = fixture('panel_200w_12v', { settings: { tiltDeg: 40 } }), cc = fixture('cc_mppt_30a'), bat = fixture(batteryId, { settings: { socStart } });
  const load = fixture('outlet_12v', { settings: { ratedW: loadW, on: loadOn } });
  setSite(sim, [pan, cc, bat, load, wire(pan, 'pv', cc, 'pv', 10, 3), wire(cc, 'bat', bat, 'dc', 8, 1), wire(bat, 'dc', load, 'power', 8, 2)]);
  return { pan, cc, bat, load };
}

test('battery: a charge and discharge cycle returns its round-trip efficiency', () => {
  const sim = createGameSim(2);
  goTo(sim, 160, 4);
  const { bat, load } = smallDc(sim, { socStart: 0.4, loadW: 60, loadOn: false });
  E(sim).weatherOverride = { cloud: 0, tempC: 20 };
  sim.runTicks(1);
  const start = E(sim).batteries[bat.id].storedWh, t0 = { ...E(sim).totals };
  sim.runTicks(14 * 60);                                    // a sunny day of charging, nothing on
  sim.commandNow('electrical.switch', { pieceId: load.id, on: true });
  E(sim).weatherOverride = { cloud: 1, tempC: 20 };
  let n = 0; while (E(sim).batteries[bat.id].storedWh > start && n++ < 3000) sim.runTicks(1);
  const t = E(sim).totals, ch = t.chargedWh - t0.chargedWh, dis = t.dischargedWh - t0.dischargedWh, sd = t.selfDischargeWh - t0.selfDischargeWh;
  const back = E(sim).batteries[bat.id].storedWh - start;   // a little below start: the last minute overshoots
  const d = CAT.bat_lfp_12v_100ah;
  // energy out / energy in once stored is back where it began (correct for the last minute and self-discharge)
  const rt = (dis + (back + sd) * d.dischargeEff) / ch;
  assert.ok(ch > 300, String(ch));
  near(rt, d.chargeEff * d.dischargeEff, 0.002);
});

test('battery: never below the usable floor or above full; lead-acid keeps half in reserve', () => {
  for (const id of ['bat_agm_12v_100ah', 'bat_lfp_12v_100ah']) {
    const sim = createGameSim(3);
    goTo(sim, 170, 8);
    const { bat, load } = smallDc(sim, { batteryId: id, socStart: 0.95, loadW: 150, loadOn: false });
    E(sim).weatherOverride = { cloud: 0, tempC: 20 };
    let maxS = 0, minS = Infinity;
    for (let i = 0; i < 2 * 1440; i++) { sim.runTicks(1); const b = E(sim).batteries[bat.id]; maxS = Math.max(maxS, b.storedWh); }
    sim.commandNow('electrical.switch', { pieceId: load.id, on: true });
    E(sim).weatherOverride = { cloud: 1, tempC: 20 };
    let shed = 0; const sd0 = E(sim).totals.selfDischargeWh;
    for (let i = 0; i < 3 * 1440; i++) { sim.runTicks(1); const b = E(sim).batteries[bat.id]; minS = Math.min(minS, b.storedWh); if (E(sim).loads[load.id].served < 1) shed++; }
    const b = E(sim).batteries[bat.id];
    assert.ok(maxS <= b.capacityWh + 1e-9, id + ' above full');
    assert.ok(maxS > 0.97 * b.capacityWh, id + ' should fill on sunny days: ' + maxS);
    // the system never draws below the floor; only self-discharge can take it lower while it sits there
    assert.ok(minS >= b.floorWh - (E(sim).totals.selfDischargeWh - sd0) - 1e-6, id + ' below floor: ' + minS + ' < ' + b.floorWh);
    assert.ok(minS < b.floorWh + 5, id + ' should reach its floor under a 150 W load');
    assert.ok(shed > 0);
    if (id.startsWith('bat_agm')) near(b.floorWh / b.capacityWh, 0.5, 1e-9);
  }
});

test('battery: lithium refuses to charge below 0 C, and says so; indoors it charges', () => {
  const sim = createGameSim(4);
  goTo(sim, 170, 9);
  const { bat } = smallDc(sim, { socStart: 0.3, loadOn: false });
  E(sim).weatherOverride = { cloud: 0, tempC: -5 };
  sim.runTicks(1); const t0 = { ...E(sim).totals }, s0 = E(sim).batteries[bat.id].storedWh;
  sim.runTicks(120);
  const e = E(sim);
  assert.equal(e.totals.chargedWh - t0.chargedWh, 0);
  assert.ok(e.totals.wastedWh - t0.wastedWh > 100);
  assert.ok(e.batteries[bat.id].storedWh <= s0);
  assert.ok(e.batteries[bat.id].chargeBlocked);
  assert.ok(e.issues.some((i) => i.pieceId === bat.id && /too cold to charge/.test(i.reason)));
  sim.commandNow('electrical.setLocationTemp', { pieceId: bat.id, tempC: 15 });
  sim.runTicks(60);
  assert.ok(E(sim).totals.chargedWh - t0.chargedWh > 50);
});

test("Ohm's law: current, voltage drop and I^2 R loss on a known run match the hand calculation", () => {
  const sim = createGameSim(6);
  const bat = fixture('bat_lfp_12v_100ah', { settings: { socStart: 0.6 } }), load = fixture('outlet_12v', { settings: { ratedW: 120 } });
  const w = wire(bat, 'dc', load, 'power', 10, 10);
  setSite(sim, [bat, load, w]);
  sim.runTicks(1);
  const e = E(sim), V = e.batteries[bat.id].voltageV, R = CAT.wire_awg10.ohmPerM;
  const I = 120 / V, drop = (2 * I * R * 10) / V * 100, loss = I * I * 2 * R * 10;
  near(R, 1.24 / 304.8, 0.0001, '10 AWG ohm/m');
  near(e.wires[w.id].currentA, I, 1e-3); near(e.wires[w.id].dropPct, drop, 1e-3); near(e.wires[w.id].lossW, loss, 1e-3);
  near(e.batteries[bat.id].chargeW, -(120 + loss), 1e-6);   // the battery supplies the load and the heat in the wire
  // about 9 A over 10 m of 10 AWG at 13 V is a 5.5 % drop: worth a warning at 12 V
  assert.ok(drop > 5 && drop < 6);
  assert.ok(e.issues.some((i) => i.pieceId === w.id && /loses .*% of the voltage at 12 V/.test(i.reason)), JSON.stringify(e.issues));
});

test('a 1500 W heater on 14 AWG is flagged at 12 V and fine at 120 V', () => {
  const lo = createGameSim(7), b12 = fixture('bat_lfp_12v_100ah'), h12 = fixture('space_heater'), w12 = wire(b12, 'dc', h12, 'power', 14, 3);
  setSite(lo, [b12, h12, w12]); lo.runTicks(1);
  const flag = E(lo).issues.find((i) => i.pieceId === w12.id);
  assert.ok(flag && /too thin for 1\d\d A at 12 V/.test(flag.reason) && /AWG/.test(flag.fix), JSON.stringify(flag));
  assert.equal(flag.severity, 'danger');
  const hi = createGameSim(7), b48 = fixture('bat_lfp_48v_5kwh'), inv = fixture('inv_48v_3000w'), h = fixture('space_heater');
  const w = wire(inv, 'ac', h, 'power', 14, 10);
  setSite(hi, [b48, inv, h, wire(b48, 'dc', inv, 'dc', 4, 1), w]); hi.runTicks(1);
  const e = E(hi);
  assert.ok(!e.issues.some((i) => i.pieceId === w.id), JSON.stringify(e.issues));
  near(e.wires[w.id].currentA, 1500 / 120, 0.05);
  assert.ok(e.wires[w.id].ok && e.loads[h.id].served === 1);
  // the example sentence: a 1000 W inverter's battery cable
  const v = createGameSim(7), b = fixture('bat_lfp_12v_100ah'), i12 = fixture('inv_12v_1000w'), cw = wire(b, 'dc', i12, 'dc', 6, 1.5);
  setSite(v, [b, i12, cw]); v.runTicks(1);
  const msg = E(v).issues.find((x) => x.pieceId === cw.id);
  assert.match(msg.reason, /^The wire from the battery to the inverter is too thin for 96 A at 12 V\./);
  assert.match(msg.fix, /^Use \S+ AWG/);
});

test('when supply is short, loads are shed from the lowest priority; served values are right', () => {
  const sim = createGameSim(8);
  const bat = fixture('bat_lfp_12v_100ah', { settings: { socStart: 0.8 } });   // 100 A, about 1.3 kW at most
  const h1 = fixture('space_heater', { id: 'heaterA' }), h2 = fixture('space_heater', { id: 'heaterB', settings: { ratedW: 750 } });
  const light = fixture('light_led_9w'), fridge = fixture('fridge_12v', { settings: { dutyFraction: 1 } });
  const P = [bat, h1, h2, light, fridge].slice(1).map((x) => wire(bat, 'dc', x, 'power', 2, 1));
  setSite(sim, [bat, h1, h2, light, fridge, ...P]);
  sim.commandNow('electrical.setLocationTemp', { pieceId: fridge.id, tempC: 100 });   // keeps the compressor running for the test
  sim.runTicks(1);
  const L = E(sim).loads;
  assert.equal(L[light.id].served, 1); assert.equal(L[fridge.id].served, 1);
  assert.equal(L[h1.id].served, 0, 'the 1500 W heater cannot be carried');
  assert.equal(L[h2.id].served, 1, 'the 750 W heater still fits beside the light and fridge');
  near(E(sim).unservedW, 1500, 1e-9);
  // a command load of high priority pushes the smaller heater out
  sim.commandNow('electrical.setLoad', { id: 'pump', ratedW: 600, on: true, priority: 9, pieceId: bat.id });
  sim.runTicks(1);
  assert.equal(E(sim).loads.pump.served, 1); assert.equal(E(sim).loads[h2.id].served, 0); assert.equal(E(sim).loads[light.id].served, 1);
});

test('an overloaded breaker trips, stays tripped, and resets on command', () => {
  const sim = createGameSim(9);
  const b = fixture('bat_lfp_48v_5kwh', { settings: { socStart: 0.9 } }), inv = fixture('inv_48v_6000w'), br = fixture('breaker_15a');
  const heater = fixture('space_heater'), saw = fixture('tool_circular_saw');
  setSite(sim, [b, inv, br, heater, saw, wire(b, 'dc', inv, 'dc', '2/0', 1), wire(inv, 'ac', br, 'line', 12, 1),
    wire(br, 'load', heater, 'power', 12, 5), wire(br, 'load', saw, 'power', 12, 5)]);
  sim.runTicks(1);
  near(E(sim).breakers[br.id].currentA, 25, 0.3);        // 3000 W at 120 V on a 15 A breaker
  let n = 0; while (!E(sim).breakers[br.id].tripped && n < 60) { sim.runTicks(1); n++; }
  assert.ok(E(sim).breakers[br.id].tripped, 'trips at 1.67 x within the hour');
  assert.ok(n > 2, 'a thermal trip takes minutes, not an instant: ' + n);
  sim.runTicks(30);
  assert.ok(E(sim).breakers[br.id].tripped);
  assert.equal(E(sim).loads[heater.id].served, 0);
  assert.equal(powerAvailableAt(sim.state, heater.id), 0);
  assert.ok(E(sim).issues.some((i) => i.pieceId === br.id && /has tripped/.test(i.reason)));
  sim.commandNow('electrical.switch', { pieceId: saw.id, on: false });
  sim.commandNow('electrical.resetBreaker', { id: br.id });
  sim.runTicks(20);
  assert.ok(!E(sim).breakers[br.id].tripped);
  assert.equal(E(sim).loads[heater.id].served, 1);
  assert.ok(powerAvailableAt(sim.state, saw.id) > 0 && powerAvailableAt(sim.state, saw.id) <= 15 * 120 - 1500 + 1);
});

test('playtest: lights and a heater on one panel; a cloudy week drains the battery and sheds the heater before the lights', () => {
  const sim = createGameSim(10);
  goTo(sim, 140, 6);
  const pan = fixture('panel_400w', { settings: { tiltDeg: 35 } }), cc = fixture('cc_mppt_30a'), bat = fixture('bat_lfp_12v_100ah', { settings: { socStart: 0.6 } });
  const inv = fixture('inv_12v_1000w'), heater = fixture('space_heater', { settings: { ratedW: 750, dutyFraction: 0.1 } });
  const lights = fixture('light_led_9w', { settings: { hours: [[6, 23]] } });
  setSite(sim, [pan, cc, bat, inv, heater, lights, wire(pan, 'pv', cc, 'pv', 10, 6), wire(cc, 'bat', bat, 'dc', 8, 1),
    wire(bat, 'dc', inv, 'dc', '1/0', 1), wire(inv, 'ac', heater, 'power', 14, 6), wire(inv, 'ac', lights, 'power', 14, 6)]);
  sim.commandNow('electrical.setLocationTemp', { pieceId: bat.id, tempC: 15 });
  E(sim).weatherOverride = { cloud: 0 };
  let sunny = 0;
  for (let i = 0; i < 2 * 1440; i++) { sim.runTicks(1); sunny = Math.max(sunny, E(sim).batteries[bat.id].soc); }
  assert.ok(sunny > 0.95, 'clear days fill it by noon: ' + sunny);
  E(sim).weatherOverride = { cloud: 0.95 };
  let heaterFirst = 0, wrongOrder = 0, minSoc = 1;
  for (let i = 0; i < 7 * 1440; i++) {
    sim.runTicks(1);
    const L = E(sim).loads, h = L[heater.id], l = L[lights.id];
    minSoc = Math.min(minSoc, E(sim).batteries[bat.id].soc);
    if (h.demandW > 0 && l.demandW > 0) { if (h.served < 1 && l.served === 1) heaterFirst++; if (l.served < h.served) wrongOrder++; }
  }
  assert.ok(minSoc < 0.12, 'the cloudy week drains it to its floor: ' + minSoc);
  assert.ok(heaterFirst > 0, 'the heater goes off while the lights stay on');
  assert.equal(wrongOrder, 0, 'the lights never go before the heater');
});

function van(sim) {
  const mount = fixture('mount_van_flat'), pan = fixture('panel_200w_12v', { settings: { mount: mount.id } }), cc = fixture('cc_mppt_30a');
  const bat = fixture('bat_lfp_12v_100ah', { settings: { socStart: 0.9 } }), fridge = fixture('fridge_12v');
  const l1 = fixture('light_led_9w', { settings: { hours: [[17, 23]] } }), l2 = fixture('light_led_9w', { settings: { hours: [[6, 8], [17, 23]] } });
  const fuse = fixture('panel_dc_12'), socket = fixture('outlet_12v', { settings: { ratedW: 60, hours: [[19, 22]] } });   // laptop and phones
  setSite(sim, [mount, pan, cc, bat, fridge, l1, l2, fuse, socket, wire(pan, 'pv', cc, 'pv', 10, 4), wire(cc, 'bat', bat, 'dc', 8, 1),
    wire(bat, 'dc', fuse, 'main', 8, 1), wire(fuse, 'b1', fridge, 'power', 12, 3), wire(fuse, 'b2', l1, 'power', 14, 3), wire(fuse, 'b3', l2, 'power', 14, 4), wire(fuse, 'b4', socket, 'power', 12, 2)]);
  return { bat, fridge };
}
test('a 12 V van system stays up through a summer week and struggles in December', () => {
  const summer = createGameSim(11);
  goTo(summer, 182, 0);
  const vs = van(summer);
  summer.runTicks(1); const s0 = { ...E(summer).totals };
  let minS = 1; for (let d = 0; d < 7 * 24; d++) { summer.runTicks(60); minS = Math.min(minS, E(summer).batteries[vs.bat.id].soc); }
  const su = E(summer).totals, sUsed = su.usedWh - s0.usedWh, sUns = su.unservedWh - s0.unservedWh;
  const winter = createGameSim(11);
  goTo(winter, 335, 0);
  const vw = van(winter);
  for (const id of [vw.fridge.id, vw.bat.id]) winter.commandNow('electrical.setLocationTemp', { pieceId: id, tempC: 18 });   // a lived-in van
  winter.runTicks(1); const w0 = { ...E(winter).totals };
  let minW = 1; for (let d = 0; d < 7 * 24; d++) { winter.runTicks(60); minW = Math.min(minW, E(winter).batteries[vw.bat.id].soc); }
  const wu = E(winter).totals, wGen = wu.generatedWh - w0.generatedWh, wUns = wu.unservedWh - w0.unservedWh;
  console.log('van summer week: used', sUsed.toFixed(0), 'Wh, unserved', sUns.toFixed(0), 'Wh, min SoC', minS.toFixed(2),
    '| December week: solar', wGen.toFixed(0), 'Wh, unserved', wUns.toFixed(0), 'Wh, min SoC', minW.toFixed(2));
  assert.ok(sUsed > 1500 && sUns === 0 && minS > 0.3, 'summer');
  assert.ok(wUns > 0 || minW < 0.2, 'December');
  assert.ok(wGen < (su.generatedWh - s0.generatedWh) / 2, 'a flat panel in December makes a fraction of its summer output');
});

test('a generator burns fuel at its specific consumption and runs out', () => {
  const sim = createGameSim(12);
  const gen = fixture('gen_petrol_2kw'), out = fixture('outlet_120v', { settings: { ratedW: 900 } });
  setSite(sim, [gen, out, wire(gen, 'ac', out, 'power', 12, 2)]);
  sim.runTicks(1);
  assert.equal(E(sim).loads[out.id].served, 0, 'nothing until it is started');
  sim.commandNow('electrical.switch', { pieceId: gen.id, on: true });
  sim.runTicks(60);
  const g = E(sim).sources[gen.id], d = CAT.gen_petrol_2kw, kWh = E(sim).totals.generatorWh / 1000;
  near(kWh, 0.9, 0.01);
  near(g.fuelUsedL / kWh, d.idleLph / (g.outputW / 1000) + d.lPerKWh, 1e-6);
  near(g.fuelUsedL / kWh, d.sfcHalfLoadLPerKWh, 0.01);              // 900 W is half of 1800 W
  assert.ok(d.sfcHalfLoadLPerKWh > 0.6 && d.sfcHalfLoadLPerKWh < 0.9);   // Honda EU2200i run times
  sim.runTicks(8 * 60);
  assert.equal(E(sim).sources[gen.id].fuelL, 0); assert.ok(!E(sim).sources[gen.id].running);
  near(E(sim).sources[gen.id].fuelUsedL, d.tankL, 1e-9);
  sim.runTicks(10);
  assert.equal(E(sim).loads[out.id].served, 0);
  assert.ok(E(sim).issues.some((i) => i.pieceId === gen.id && /out of fuel/.test(i.reason)));
  assert.equal(sim.commandNow('electrical.refuel', { id: gen.id, litres: 10 }), d.tankL);
});

test('the main circuit takes loads from other systems, and the overlay and power queries read the state', () => {
  const sim = createGameSim(13);
  goTo(sim, 172, 11);
  const pieces = homestead();
  setSite(sim, pieces);
  sim.commandNow('electrical.setLoad', { id: 'water.pump', ratedW: 400, on: true, priority: 7 });
  sim.runTicks(2);
  const e = E(sim);
  assert.equal(e.loads['water.pump'].served, 1);
  assert.ok(e.loads['water.pump'].drawW === 400);
  const outlet = pieces.find((p) => p.fixture === 'outlet_120v');
  const w = powerAvailableAt(sim.state, outlet.id);
  assert.ok(w > 0 && w <= 15 * 120, String(w));
  assert.equal(powerAvailableAt(sim.state, 'nope'), 0);
  const o = electricalOverlay(sim.state);
  assert.equal(o.wires.length, pieces.filter((p) => p.kind === 'wire').length);
  assert.ok(o.devices.some((d) => d.kind === 'battery' && d.soc > 0) && o.devices.some((d) => d.kind === 'solar' && d.outputW > 0));
  assert.ok(o.wires.some((x) => x.currentA > 0));
  sim.commandNow('electrical.removeLoad', { id: 'water.pump' });
  sim.runTicks(1);
  assert.equal(E(sim).loads['water.pump'], undefined);
});

test('deterministic, survives save and load mid-run, and old saves without electrical load', () => {
  const pieces = homestead();
  const run = () => { const s = createGameSim(21); setSite(s, pieces); return s; };
  const a = run(), b = run();
  a.runDays(3); b.runDays(3);
  assert.equal(a.hash(), b.hash());
  const straight = run(); straight.runDays(4);
  const first = run(); first.runDays(2);
  const file = JSON.parse(JSON.stringify(first.serialize()));
  const second = createGameSim(999); second.load(file); second.runDays(2);
  assert.equal(second.hash(), straight.hash());
  const old = first.serialize(); delete old.sys.electrical;
  const third = createGameSim(1); third.load(old);
  assert.equal(E(third).active, false);
  third.runTicks(5);
  assert.equal(E(third).active, true);
  assert.ok(Object.keys(E(third).batteries).length === 3);
  JSON.stringify(E(third));   // plain JSON
});

test('with nothing electrical built the system does nothing, and 40 devices cost under the budget', () => {
  const idle = createGameSim(31);
  setSite(idle, house());
  idle.runDays(1);
  assert.equal(E(idle).active, false);
  assert.deepEqual(E(idle).sources, {});
  const sys = idle.systems.find((x) => x.name === 'electrical');
  const before = JSON.stringify(E(idle));
  idle.runTicks(10);
  const after = JSON.parse(JSON.stringify(E(idle)));
  assert.deepEqual(after, JSON.parse(before));
  // cost by difference: the same 20 days with and without the homestead
  const time = (pieces) => { const s = createGameSim(5); if (pieces) setSite(s, pieces); s.runDays(1); const t = performance.now(); s.runDays(20); return (performance.now() - t) / (20 * 1440); };
  time(homestead());   // warm up
  let best = Infinity;
  for (let k = 0; k < 3; k++) best = Math.min(best, time(homestead()) - time(null));
  console.log('electrical cost with 40 devices:', (best * 1000).toFixed(1), 'us per step');
  assert.ok(best < 0.03, 'budget 0.03 ms per step, measured ' + best.toFixed(4));
  assert.ok(sys);
});

test('electrical code keeps to the simulation rules (no clocks, no Math.random)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['electrical.js', 'fixtures-electrical.js']) {
    const src = readFileSync(new URL('../src/sim/' + f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.|new Date|performance\.now/.test(src), f);
  }
});
