// Vehicle acquisition and fuel (V9): the trailer is a Supplier item that is delivered as a unit, a pour conserves fuel
// between stock, tank and the books, deliveries top the tank up unless the setting is off, an empty tank cannot be poured
// into beyond its size, and an old save's trailer is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, makeSave, readSave, ITEMS, FUEL_ITEM, VEHICLE_KINDS } from '../src/sim/index.js';

const books = (sim) => sim.systems.find((q) => q.name === 'vehicles').api.fuelImbalance(sim.state.sys.vehicles);
const stock = (sim) => sim.state.sys.stock;

test('the trailer is a $450 Supplier item and the fuel can is a Supplier tool', () => {
  assert.equal(ITEMS.trailer_small.priceUsd, 450);
  assert.equal(ITEMS.trailer_small.category, 'vehicles');
  assert.ok(ITEMS.trailer_small.delivered);
  assert.equal(ITEMS.fuel_can.category, 'tools_hand');
  assert.ok(ITEMS.fuel_can.priceUsd > 0 && /20 L/.test(ITEMS.fuel_can.name));
  assert.equal(ITEMS[FUEL_ITEM].unit, 'L');
});

test('a bought trailer is delivered once: stock gives it up, a unit appears with no tank, nothing is delivered unbought', () => {
  const sim = createGameSim(3), st = stock(sim), money0 = st.money;
  assert.equal(sim.commandNow('vehicles.deliver', { kind: 'trailer_small', x: 4, z: 5 }).reason, 'not bought');
  assert.equal(sim.commandNow('stock.buy', { id: 'trailer_small', qty: 1 }).ok, true);
  assert.equal(st.money, money0 - 450);
  assert.equal(st.items.trailer_small, 1);
  const r = sim.commandNow('vehicles.deliver', { kind: 'trailer_small', x: 4, z: 5, yaw: 1 });
  assert.equal(r.ok, true);
  assert.equal(st.items.trailer_small, undefined, 'taken out of stock');
  const u = sim.state.sys.vehicles.units[r.id];
  assert.equal(u.kind, 'trailer_small');
  assert.equal(u.fuelL, 0);
  assert.equal(u.owner, 'own');
  assert.equal(sim.commandNow('vehicles.deliver', { kind: 'trailer_small', x: 4, z: 5 }).reason, 'not bought', 'one purchase, one trailer');
  assert.equal(sim.commandNow('vehicles.deliver', { kind: 'atv', x: 4, z: 5 }).reason, 'not bought', 'no free ATVs through this door');
  assert.equal(books(sim), 0);
});

test('a new world gives no trailer of its own; the starter ATV is still the only gift', () => {
  const sim = createGameSim(5);
  assert.deepEqual(sim.state.sys.vehicles.units, {});
  assert.equal(sim.commandNow('vehicles.add', { kind: 'atv', x: 0, z: 0, starter: true }).ok, true);
  assert.equal(Object.values(sim.state.sys.vehicles.units).filter((u) => u.kind === 'trailer_small').length, 0);
});

test('pouring from the can in small portions at the real rate: stock, tank and books move together to the litre', () => {
  const sim = createGameSim(7), s = sim.state.sys.vehicles, k = VEHICLE_KINDS.atv;
  const id = sim.commandNow('vehicles.add', { kind: 'atv', x: 0, z: 0, fuelL: 2 }).id;
  stock(sim).items[FUEL_ITEM] = 30;
  const rate = k.fuel.pourLps, dt = 0.1;
  assert.ok(rate > 0.2 && rate < 1, 'a can pours a fraction of a litre a second: ' + rate);
  let t = 0, acc = 0, got = 0;
  for (; t < 60; t += dt) {
    const room = k.fuel.tankL - s.units[id].fuelL;
    if (room <= 0.05) break;
    acc += rate * dt;
    const r = sim.commandNow('vehicles.refuel', { id, litres: Math.min(acc, room) });
    if (r.ok) { got += r.litres; acc -= r.litres; }
  }
  assert.ok(Math.abs(s.units[id].fuelL - k.fuel.tankL) < 0.1, 'full: ' + s.units[id].fuelL);
  assert.ok(Math.abs(t - (k.fuel.tankL - 2) / rate) < 1, 'filling takes the real time: ' + t.toFixed(1) + ' s');
  assert.ok(Math.abs(30 - stock(sim).items[FUEL_ITEM] - got) < 1e-6, 'stock gave exactly what the tank took');
  assert.equal(books(sim), 0);
  // a full tank takes nothing more; a dry stock pours nothing
  sim.commandNow('vehicles.refuel', { id, litres: 5 });
  assert.ok(s.units[id].fuelL <= k.fuel.tankL + 1e-9, 'never over the tank size');
  const dry = sim.commandNow('vehicles.add', { kind: 'atv', x: 3, z: 0, fuelL: 0 }).id;
  delete stock(sim).items[FUEL_ITEM];
  assert.equal(sim.commandNow('vehicles.refuel', { id: dry, litres: 3 }).reason, 'no fuel');
  assert.equal(s.units[dry].fuelL, 0);
  assert.equal(books(sim), 0);
});

test('a delivery tops the tank up, free, for parked machines of your own; the setting turns it off; the books balance', () => {
  const sim = createGameSim(9), s = sim.state.sys.vehicles, k = VEHICLE_KINDS.atv;
  const a = sim.commandNow('vehicles.add', { kind: 'atv', x: 0, z: 0, fuelL: 3 }).id;
  const b = sim.commandNow('vehicles.add', { kind: 'atv', x: 9, z: 0, fuelL: 1 }).id;
  const tr = sim.commandNow('vehicles.add', { kind: 'trailer_small', x: 5, z: 5 }).id;
  sim.commandNow('vehicles.sit', { id: b });                          // being ridden: left alone
  const money = stock(sim).money;
  const r = sim.commandNow('vehicles.topUp', {});
  assert.ok(Math.abs(r.litres - (k.fuel.tankL - 3)) < 1e-6, 'only the parked one: ' + r.litres);
  assert.equal(s.units[a].fuelL, k.fuel.tankL);
  assert.equal(s.units[b].fuelL, 1);
  assert.equal(s.units[tr].fuelL, 0, 'a trailer has no tank');
  assert.equal(stock(sim).money, money, 'free');
  assert.equal(books(sim), 0);
  // the setting
  s.totals.fuelBurnedL += s.units[a].fuelL - 2; s.units[a].fuelL = 2;     // it burned some
  assert.equal(sim.commandNow('vehicles.setOption', { topUp: false }).ok, true);
  assert.equal(sim.commandNow('vehicles.topUp', {}).litres, 0);
  assert.equal(s.units[a].fuelL, 2, 'off means off');
  assert.equal(sim.commandNow('vehicles.setOption', { topUp: 'yes' }).ok, false);
  sim.commandNow('vehicles.setOption', { topUp: true });
  assert.ok(sim.commandNow('vehicles.topUp', {}).litres > 0);
  assert.equal(books(sim), 0);
  // the setting survives a save
  sim.commandNow('vehicles.setOption', { topUp: false });
  const again = createGameSim(9);
  again.load(readSave(JSON.stringify(makeSave(sim.serialize(), {}))).sim);
  assert.equal(again.state.sys.vehicles.options.topUp, false);
});

test('a save without the option reads as on, and a trailer already in an old save is kept', () => {
  const old = createGameSim(11);
  old.commandNow('vehicles.add', { kind: 'atv', x: 0, z: 0, starter: true });
  old.commandNow('vehicles.add', { kind: 'trailer_small', x: 5, z: 0, once: 'trailer' });
  const state = old.serialize();
  assert.equal(state.sys.vehicles.options, undefined);
  const sim = createGameSim(11);
  sim.load(readSave(JSON.stringify(makeSave(state, {}))).sim);
  const s = sim.state.sys.vehicles;
  assert.equal(Object.values(s.units).filter((u) => u.kind === 'trailer_small').length, 1, 'kept');
  const atv = Object.values(s.units).find((u) => u.kind === 'atv');
  atv.fuelL = 1;
  assert.ok(sim.commandNow('vehicles.topUp', {}).litres > 0, 'no option stored means on');
});

test('an empty tank cannot be driven: the drive model cuts the throttle and the machine rolls to a stop', async () => {
  const { vehicleCore } = await import('../src/sim/index.js');
  const { createBody, stepBody, SUB } = vehicleCore, k = VEHICLE_KINDS.atv, env = { ground: () => 0 };
  const b = createBody(k, { fuelL: 0.02 }, env);
  for (let i = 0; i < 30 / SUB; i++) stepBody(b, k, { throttle: 1 }, env);
  assert.equal(b.stalled, 'fuel');
  assert.equal(b.fuelL, 0);
  const u0 = b.u;
  for (let i = 0; i < 20 / SUB; i++) stepBody(b, k, { throttle: 1, brake: 1 }, env);
  assert.ok(b.u < 0.2 && u0 < k.topMps, 'stopped: ' + b.u);
});
