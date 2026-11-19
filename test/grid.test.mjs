// Services S9a: a grid service entrance (meter and mast on an outside wall) is an AC source with rated amps, metered kWh
// billed to the player's money at midnight, no fuel. It feeds the 120/240 V breaker panel behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, DAY, FIXTURES_ELECTRICAL as CAT, PLACEABLE_FIXTURES, ITEMS, powerAvailableAt } from '../src/sim/index.js';
import { fixture, link, setSite } from './helpers/pieces.mjs';

const E = (sim) => sim.state.sys.electrical, money = (sim) => sim.state.sys.stock.money;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);
const toMidnight = (sim) => Math.ceil((DAY - (sim.state.t % DAY)) / 60);

// a meter on the outside of a wall, the panel 0.3 m behind it, a breaker and an outlet with a 600 W load and a light
function house({ service = 'service_entrance_100a', panelAt = 0.3, extra = [] } = {}) {
  const sim = createGameSim(3);
  const meter = fixture(service, { id: 'meter', x: 0, z: 0, y: 1.5 }), pnl = fixture('panel_ac_100a', { id: 'pnl', x: panelAt, z: 0, y: 1.2 });
  const br = fixture('breaker_15a', { id: 'br', x: panelAt, z: 0.1, y: 1.2 }), out = fixture('outlet_120v', { id: 'out', x: 3, z: 1, y: 0.4, settings: { ratedW: 600 } });
  const lamp = fixture('light_led_9w', { id: 'lamp', x: 3, z: 2, y: 2.4 });
  setSite(sim, [meter, pnl, br, out, lamp, link('wire', pnl, 'b1', br, 'line', { id: 'w1', gauge: 14, lengthM: 0.3 }), link('wire', br, 'load', out, 'power', { id: 'w2', gauge: 14, lengthM: 4 }),
    link('wire', out, 'power', lamp, 'power', { id: 'w3', gauge: 14, lengthM: 2 }), ...extra]);
  sim.runTicks(1);
  return sim;
}

test('the catalog has 100 A and 200 A services that Equip can place, and store items for them', () => {
  const d = CAT.service_entrance_100a;
  assert.equal(d.category, 'grid'); assert.equal(d.mainA, 100); assert.equal(d.ratedW, 24000); assert.equal(d.ports[0].bus, 'ac');
  assert.equal(CAT.service_entrance_200a.ratedW, 48000);
  assert.ok(PLACEABLE_FIXTURES.service_entrance_100a && PLACEABLE_FIXTURES.service_entrance_200a, 'Equip can set them on a wall');
  assert.ok(ITEMS.svc_entrance_100a && ITEMS.svc_entrance_200a);
});

test('the meter feeds the panel behind it: lights on at night with no fuel, the meter turns, the books balance', () => {
  const sim = house();
  const e = E(sim), g = e.sources.meter;
  assert.equal(g.kind, 'grid'); assert.equal(g.panel, 'pnl');
  assert.equal(e.loads.out.served, 1); near(e.loads.out.drawW, 600, 1e-9);
  assert.equal(e.loads.lamp.served, 1);
  assert.ok(e.wires.w2.currentA > 4.9, 'the outlet circuit carries ' + e.wires.w2.currentA + ' A');
  assert.ok(e.points.out.path.includes('br'), 'fed through the breaker');
  assert.ok(powerAvailableAt(sim.state, 'out') > 1000, 'a tool plugged in finds power');
  assert.ok(!e.issues.some((i) => i.severity === 'danger' || /no power|not wired/.test(i.reason)), JSON.stringify(e.issues));
  const t0 = { ...e.totals }, m0 = g.meterKWh;
  sim.runTicks(60);
  const y = {};
  for (const k of Object.keys(t0)) if (typeof t0[k] === 'number') y[k] = e.totals[k] - t0[k];
  near(g.meterKWh - m0, 0.609 + y.wireLossWh / 1000, 1e-6, 'an hour of 609 W plus the wire losses');
  near(y.gridWh / 1000, g.meterKWh - m0, 1e-9, 'the ledger matches the meter');
  assert.equal(y.generatorWh, 0); assert.equal(y.fuelL, 0);
  const inW = y.generatedWh + y.dischargedWh + y.generatorWh + y.gridWh, outW = y.usedWh + y.chargedWh + y.wireLossWh + y.inverterLossWh + y.wastedWh;
  near(inW - outW, 0, 1e-6, 'energy is conserved');
  near(y.gridUsd, (g.meterKWh - m0) * 0.18, 1e-9, 'billed at the tariff');
});

test('the bill is paid at midnight from the player\'s money; unpaid, the service is cut off until it can be paid', () => {
  const sim = house();
  const m0 = money(sim);
  sim.runTicks(toMidnight(sim) + 1);
  const g = E(sim).sources.meter;
  assert.ok(g.lastBillUsd > 1, 'a day of 609 W is about 2.4 USD: ' + g.lastBillUsd);
  near(m0 - money(sim), g.lastBillUsd, 1e-9, 'money paid is the bill');
  near(g.lastBillUsd, Math.round((g.meterKWh * 0.18 + 0.5) * 100) / 100, 0.011, 'kWh at the tariff plus the daily charge');
  assert.equal(g.shutoff, false);
  // broke: the next bill cannot be paid
  sim.state.sys.stock.money = 0;
  sim.runDays(1);
  assert.equal(g.shutoff, true, 'cut off');
  assert.equal(E(sim).loads.out.drawW, 0, 'the outlet is dead');
  assert.ok(E(sim).issues.some((i) => i.pieceId === 'meter' && /cut the service off/.test(i.reason)));
  sim.commandNow('stock.grant', { usd: 100 });
  sim.runTicks(2);
  assert.equal(g.shutoff, false, 'paid and reconnected');
  assert.ok(money(sim) < 100);
  near(E(sim).loads.out.drawW, 600, 1e-9);
});

test('the rating limits it: a load past 100 A at 240 V is shed; the disconnect switches it off', () => {
  const big = fixture('space_heater', { id: 'heat', x: 0.5, z: 1, settings: { ratedW: 30000 } });
  const sim = house({ extra: [big, link('wire', { id: 'pnl' }, 'b2', big, 'power', { id: 'w4', gauge: 2, lengthM: 1 })] });
  assert.ok(E(sim).loads.heat.served < 1, 'a 30 kW load does not fit a 24 kW service');
  assert.equal(E(sim).loads.out.served, 1, 'the rest keeps running');
  sim.commandNow('electrical.switch', { pieceId: 'meter', on: false }); sim.runTicks(1);
  assert.equal(E(sim).loads.out.drawW, 0);
  sim.commandNow('electrical.switch', { pieceId: 'meter', on: true }); sim.runTicks(1);
  assert.equal(E(sim).loads.out.served, 1);
});

test('no panel within reach: a plain warning and nothing powered; a generator on a grid-fed panel is left out', () => {
  const far = house({ panelAt: 6 });
  assert.ok(E(far).issues.some((i) => i.pieceId === 'meter' && /no breaker panel to feed/.test(i.reason)));
  assert.equal(E(far).loads.out.served, 0);
  const gen = fixture('gen_petrol_2kw', { id: 'gen', x: -2, z: 0 });
  const sim = house({ extra: [gen, link('wire', gen, 'ac', { id: 'pnl' }, 'main', { id: 'w5', gauge: 10, lengthM: 3 })] });
  sim.commandNow('electrical.switch', { pieceId: 'gen', on: true }); sim.runTicks(2);
  assert.ok(E(sim).issues.some((i) => i.pieceId === 'gen' && i.severity === 'danger' && /transfer switch/.test(i.reason)));
  assert.equal(E(sim).sources.gen, undefined, 'the generator is not a source on this panel');
  assert.equal(E(sim).loads.out.served, 1, 'the grid still serves');
});
