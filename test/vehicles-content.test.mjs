// Vehicles, homestead content: the ATV and trailer records drive sensibly, the items are in the catalog, the game sim
// carries the vehicles system, and an old save without it loads and can receive the starter ATV once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, makeSave, readSave, ITEMS, ITEM_CATEGORIES, VEHICLE_KINDS, FUEL_ITEM, vehicleCore } from '../src/sim/index.js';

const { createBody, stepBody, hitchPose, SUB } = vehicleCore;
const FLAT = { ground: () => 0 };
const ATV = VEHICLE_KINDS.atv, TRAILER = VEHICLE_KINDS.trailer_small;

test('vehicle records: the ATV reaches 11 m/s, a full tank lasts about three hours flat out, the trailer tows', () => {
  const b = createBody(ATV, { fuelL: ATV.fuel.tankL }, FLAT);
  for (let i = 0; i < 20 / SUB; i++) stepBody(b, ATV, { throttle: 1 }, FLAT);
  assert.ok(Math.abs(b.u - 11) < 0.2, 'top speed ' + b.u);
  const hours = ATV.fuel.tankL / ATV.fuel.burnLph;
  assert.ok(hours > 2.5 && hours < 3.5, hours + ' h');
  const t = createBody(TRAILER, hitchPose(b, ATV, TRAILER, 0), FLAT);
  t.cargoKg = TRAILER.cargo.capKg;
  for (let i = 0; i < 5 / SUB; i++) stepBody(b, ATV, { throttle: 0.6, steer: 0.5 }, FLAT, SUB, { body: t, kind: TRAILER });
  assert.ok(Math.abs(t.artic) < vehicleCore.ARTIC_MAX && t.distM > 10, 'follows: ' + t.distM);
  for (const k of Object.values(VEHICLE_KINDS)) {
    assert.ok(k.massKg > 0 && k.dims.l > 0 && k.track > 0 && k.wheelR > 0, k.id);
    if (k.drive === 'towed') assert.ok(k.hitch && ATV.points.some((p) => p.type === k.hitch.type), k.id + ' hitches to the ATV');
  }
});

test('vehicle items are in the catalog under their own category', () => {
  for (const id of [FUEL_ITEM, 'fuel_can', 'trailer_small']) assert.ok(ITEMS[id], id);
  assert.ok(ITEM_CATEGORIES.some((c) => c.id === 'vehicles'));
  assert.equal(ITEMS[FUEL_ITEM].unit, 'L');
});

test('the game sim: refuelling takes gasoline from stock; the ATV is not for rent', () => {
  const sim = createGameSim(7), s = sim.state.sys.vehicles;
  const id = sim.commandNow('vehicles.add', { kind: 'atv', x: 0, z: 0, fuelL: 4 }).id;
  assert.equal(sim.commandNow('vehicles.refuel', { id }).reason, 'no fuel');
  sim.state.sys.stock.items[FUEL_ITEM] = 6;
  assert.equal(sim.commandNow('vehicles.refuel', { id }).litres, 6);
  assert.equal(sim.state.sys.stock.items[FUEL_ITEM], undefined, 'the stock is used up');
  assert.equal(s.units[id].fuelL, 10);
  assert.equal(sim.commandNow('vehicles.rent', { kind: 'atv', days: 1, x: 0, z: 0 }).reason, 'not for rent');
  assert.equal(sim.systems.find((q) => q.name === 'vehicles').api.fuelImbalance(s), 0);
});

test('an old save without vehicles loads, and receives the starter ATV once', () => {
  const old = createGameSim(11);
  old.runTicks(5);
  const state = old.serialize();
  delete state.sys.vehicles;
  const raw = JSON.stringify(makeSave(state, { player: { x: 3, z: 4 } }));
  const sim = createGameSim(11);
  sim.load(readSave(raw).sim);
  const s = sim.state.sys.vehicles;
  assert.deepEqual(s.units, {});
  assert.equal(s.starter, false);
  const r = sim.commandNow('vehicles.add', { kind: 'atv', x: 5, z: 4, starter: true });
  assert.equal(r.ok, true);
  assert.equal(s.units[r.id].fuelL, ATV.fuel.tankL, 'with a full tank');
  assert.equal(sim.commandNow('vehicles.add', { kind: 'atv', x: 5, z: 4, starter: true }).reason, 'already given');
  const again = createGameSim(11);
  again.load(readSave(JSON.stringify(makeSave(sim.serialize(), {}))).sim);
  assert.equal(again.state.sys.vehicles.starter, true);
  assert.equal(Object.keys(again.state.sys.vehicles.units).length, 1);
});
