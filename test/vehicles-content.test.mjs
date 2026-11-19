// Vehicles, homestead content: the ATV and trailer records drive sensibly, the items are in the catalog, the game sim
// carries the vehicles system, and an old save without it loads and can receive the starter ATV once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, makeSave, readSave, ITEMS, ITEM_CATEGORIES, VEHICLE_KINDS, VEHICLE_SURFACES, FUEL_ITEM, vehicleCore } from '../src/sim/index.js';

const { createBody, stepBody, hitchPose, SUB } = vehicleCore;
const FLAT = { ground: () => 0 };
const ATV = VEHICLE_KINDS.atv, TRAILER = VEHICLE_KINDS.trailer_small;

test('vehicle records: the ATV reaches its governed top speed, a full tank lasts about three hours flat out, the trailer tows', () => {
  const b = createBody(ATV, { fuelL: ATV.fuel.tankL }, FLAT);
  for (let i = 0; i < 20 / SUB; i++) stepBody(b, ATV, { throttle: 1 }, FLAT);
  assert.ok(Math.abs(b.u - ATV.topMps) < 0.5, 'top speed ' + b.u);
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

// ---- the ATV handles like the real machine it is modelled on (figures in docs/PLAYTEST.md)
const on = (surf, ground = () => 0) => ({ ground, surface: () => VEHICLE_SURFACES[surf] });
const ridden = (env) => { const b = createBody(ATV, { fuelL: 10 }, env); b.cargoKg = ATV.riderKg; return b; };
const drive = (b, input, env, secs, each) => { for (let i = 0; i < secs / SUB; i++) { stepBody(b, ATV, typeof input === 'function' ? input(b) : input, env); if (each) each(b); } return b; };

test('ATV: 0-50 km/h takes a few seconds through the gears; wet grass spins the wheels and is slower', () => {
  const t50 = (surf) => { const b = ridden(on(surf)); let t = 0, spun = 0, gears = new Set(); drive(b, { throttle: 1 }, on(surf), 12, (q) => { if (q.u < 50 / 3.6) t += SUB; if (q.spin > 0.5) spun += SUB; gears.add(q.gear); }); return { t, spun, gears: gears.size }; };
  const dry = t50('grass'), wet = t50('grass_wet');
  assert.ok(dry.t > 3 && dry.t < 6, '0-50 on dry grass ' + dry.t);
  // per-wheel loads (G-3): a full-throttle launch puts three quarters of the weight on the rear tyres, and load
  // sensitivity costs them a few percent, so at peak torque in first the tyres chirp briefly before the shift
  assert.ok(dry.spun < 0.6 && dry.gears >= 3, 'grips and shifts: ' + JSON.stringify(dry));
  assert.ok(wet.t > dry.t * 1.2 && wet.spun > dry.spun + 0.5, 'wet grass: ' + JSON.stringify(wet));
});

test('ATV: lifting off brakes through the engine; it creeps at idle; braking takes longer on wet grass', () => {
  const up = (b) => drive(b, (q) => ({ throttle: q.u < 14 ? 1 : 0 }), on('grass'), 8);
  const b = up(ridden(on('grass'))), u0 = b.u;
  drive(b, {}, on('grass'), 1);
  const decel = u0 - b.u;
  assert.ok(decel > 1.2 && decel < 3, 'engine braking about 0.15 g: ' + decel);
  const c = drive(ridden(on('floor')), {}, on('floor'), 8);
  assert.ok(c.u > 0.3 && c.u <= ATV.engine.creepMps + 0.05, 'creeps: ' + c.u);
  const stop = (surf) => { const q = ridden(on(surf)); drive(q, (z) => ({ throttle: z.u < 12 ? 1 : 0 }), on(surf), 8); const z0 = q.z; drive(q, { brake: 1 }, on(surf), 5); return q.z - z0; };
  const dry = stop('grass'), wet = stop('grass_wet');
  assert.ok(dry > 9 && dry < 16 && wet > dry * 1.3, `stops in ${dry} m dry, ${wet} m wet`);
});

test('ATV: it climbs 25 degrees of dry grass but spins out on wet grass; 35 degrees is too steep', () => {
  const climb = (deg, surf) => { const g = (x, z) => Math.max(0, z - 2) * Math.tan((deg * Math.PI) / 180), b = ridden({ ground: g }); let zMax = 0, uMin = 0; drive(b, { throttle: 1 }, on(surf, g), 10, (q) => { zMax = Math.max(zMax, q.z); uMin = Math.min(uMin, q.u); }); b.zMax = zMax; b.uMin = uMin; return b; };
  assert.ok(climb(25, 'grass').u > 3, 'dry 25');
  const wet = climb(25, 'grass_wet');
  assert.ok(wet.u < 0.5 && wet.spin > 0.5, 'wet 25 spins: ' + wet.u);
  // 35 degrees: the run-up carries it a few metres, then it spins and slides back down (G-3: it no longer sticks where it
  // stalled; with the weight on the rear tyres and their grip below tan 35 it cannot hold either)
  const steep = climb(35, 'grass');
  assert.ok(steep.zMax < 2 + 7 && steep.uMin < -1, 'dry 35: ' + steep.zMax + ' ' + steep.uMin);
});

test('ATV: hard cornering leans it and washes the front out before it tips; a side slope adds to the tip', () => {
  const b = ridden(on('grass'));
  drive(b, (q) => ({ throttle: q.u < 11 ? 1 : 0.3 }), on('grass'), 6);
  let tip = 0, roll = 0;
  drive(b, { throttle: 0.5, steer: 1 }, on('grass'), 4, (q) => { tip = Math.max(tip, q.tip); roll = Math.max(roll, q.roll); });
  assert.ok(roll > 0.06, 'leans out of the turn: ' + roll);
  assert.ok(tip > 0.5 && tip < 1, 'stays on its wheels on the flat: ' + tip);
  assert.ok(b.slip < 1.5, 'no drift: ' + b.slip);
  const side = (x) => x * Math.tan((22 * Math.PI) / 180), s = ridden({ ground: side });
  drive(s, {}, on('grass', side), 1);
  assert.ok(s.tip > 0.45, 'a 22 degree side slope: ' + s.tip);
});

test('ATV: heading steer backs up when pushed behind, then stops and drives off when pushed ahead; no push coasts then holds', () => {
  const { headingControl } = vehicleCore, env = on('grass'), b = ridden(env);
  drive(b, (q) => headingControl(q, ATV, 0, -1), env, 3);
  assert.ok(b.u < -1 && b.gear === -1, 'reversing: ' + b.u);
  drive(b, (q) => headingControl(q, ATV, 0, 1), env, 4);
  assert.ok(b.u > 3 && b.gear >= 1, 'forward again: ' + b.u);
  drive(b, (q) => headingControl(q, ATV, 0, 0), env, 12);
  assert.ok(b.u === 0, 'coasted down and held: ' + b.u);
});
