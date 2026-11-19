// Vehicles, generic: the drive model (src/sim/core/vehicles-drive.js) with a go-kart, a tank and a cart on analytic
// terrain (flat, ramp, bowl), and the sim system (src/sim/core/vehicles.js) with the same fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody, settle, headingControl, hitchPose, SUB, GRAV, ARTIC_MAX, wrap } from '../src/sim/core/vehicles-drive.js';
import { createVehicleSystem } from '../src/sim/core/vehicles.js';
import { createSim, stockSystem, makeSave, readSave, hashState } from '../src/sim/index.js';

const KART = Object.freeze({
  id: 'kart', name: 'Go-kart', drive: 'wheeled', dims: { l: 1.8, w: 1.2, h: 0.6 }, massKg: 150, cgH: 0.3,
  wheelbase: 1.05, track: 0.95, wheelR: 0.14,
  axles: [{ z: 0.525, steer: true, driven: false }, { z: -0.525, steer: false, driven: true, diff: 'open' }],   // open: see the solid-axle test
  powerW: 6000, topMps: 12, reverseMps: 2, brakeG: 0.8,
  steerMaxRad: 0.5, steerRate: 3, steerSpeedFalloff: 0.5,
  grip: { mu: 1.0, lateral: 10, rolling: 0.02 }, susp: { travel: 0.05, hz: 3, damp: 0.6 },
  seats: [{ id: 'driver', at: [0, 0.3, -0.2], pose: 'sit', mount: [] }],
  points: [{ id: 'ball', type: 'ball', at: [0, 0.25, -0.95] }],
  hitch: null, cargo: null, fuel: { item: 'petrol', tankL: 8, burnLph: 3 }, look: 'box',
});
const TANK = Object.freeze({
  id: 'tank', name: 'Tracked machine', drive: 'tracked', dims: { l: 3.2, w: 1.8, h: 1.6 }, massKg: 3000, cgH: 0.6,
  wheelbase: 2.2, contactL: 2.2, track: 1.4, wheelR: 0.3, axles: [],
  powerW: 25000, topMps: 3, reverseMps: 2, brakeG: 0.6, pivotRadS: 0.8,
  grip: { mu: 0.9, lateral: 14, rolling: 0.05 }, susp: { travel: 0.05, hz: 2.5, damp: 0.7 },
  seats: [{ id: 'driver', at: [0, 1, 0], pose: 'sit', mount: [] }], points: [], hitch: null, cargo: null,
  fuel: { item: 'diesel', tankL: 40, burnLph: 4 }, look: 'box', rentUsdPerDay: 200,
});
const CART = Object.freeze({
  id: 'cart', name: 'Cart', drive: 'towed', dims: { l: 2, w: 1.1, h: 0.6 }, massKg: 60, cgH: 0.4,
  wheelbase: 0, track: 1.0, wheelR: 0.22, axles: [{ z: 0, steer: false, driven: false }],
  powerW: 0, topMps: 0, reverseMps: 0, brakeG: 0, grip: { mu: 0.9, lateral: 12, rolling: 0.02 },
  susp: { travel: 0.08, hz: 2.6, damp: 0.4 }, seats: [], points: [{ id: 'bed', type: 'bed', at: [0, 0.4, 0] }],
  hitch: { type: 'ball', at: [0, 0.3, 1.3] }, cargo: { capKg: 200, bed: { at: [0, 0.4, 0], l: 1.4, w: 1, h: 0.3 }, tips: true }, fuel: null, look: 'box',
});
const KINDS = { kart: KART, tank: TANK, cart: CART };

const FLAT = { ground: () => 0 };
const ramp = (deg) => ({ ground: (x, z) => z * Math.tan((deg * Math.PI) / 180) });
const BOWL = { ground: (x, z) => 0.02 * (x * x + z * z) };
const run = (b, k, input, env, secs, dt = SUB, trailer = null, each = null) => {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) { stepBody(b, k, typeof input === 'function' ? input(b, i * dt) : input, env, dt, trailer); if (each) each(b, i * dt); }
  return b;
};
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);

// ---------------------------------------------------------------- drive model
test('drive: full throttle on the flat converges to the record top speed, reverse to its reverse speed', () => {
  const b = run(createBody(KART, {}, FLAT), KART, { throttle: 1 }, FLAT, 30);
  near(b.u, KART.topMps, 0.15, 'top speed');
  near(b.x, 0, 1e-6, 'straight ahead stays on its line');
  const r = run(createBody(KART, {}, FLAT), KART, { throttle: -1 }, FLAT, 10);
  near(r.u, -KART.reverseMps, 0.15, 'reverse speed');
  const t = run(createBody(TANK, {}, FLAT), TANK, { throttle: 1 }, FLAT, 10);
  near(t.u, TANK.topMps, 0.05, 'tracked top speed');
});

test('drive: a steady turn has radius wheelbase / tan(steer)', () => {
  const b = createBody(KART, {}, FLAT);
  run(b, KART, { throttle: 0.05, steer: 0.6 }, FLAT, 8);      // settle into the circle
  const pts = [];
  run(b, KART, { throttle: 0.05, steer: 0.6 }, FLAT, 10, SUB, null, (q) => pts.push([q.x, q.z]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rad = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
  const want = KART.wheelbase / Math.tan(b.steer);
  assert.ok(b.u > 1 && b.u < 6, 'a slow steady speed: ' + b.u);
  assert.ok(Math.abs(rad - want) / want < 0.04, `radius ${rad} vs ${want}`);
  assert.ok(b.slip < 0.3, 'grips: ' + b.slip);
});

test('drive: braking from speed stops within the braking distance', () => {
  for (const v of [6, 10]) {
    const b = createBody(KART, {}, FLAT);
    run(b, KART, (q) => ({ throttle: q.u < v ? 1 : 0 }), FLAT, 6);
    const v0 = b.u, z0 = b.z;
    run(b, KART, { brake: 1 }, FLAT, 4);
    const d = b.z - z0, dMax = (v0 * v0) / (2 * Math.min(KART.brakeG, KART.grip.mu) * GRAV);
    assert.equal(b.u, 0, 'stopped');
    assert.ok(d <= dMax * 1.02 && d > dMax * 0.6, `stopped in ${d} m from ${v0} m/s, limit ${dMax}`);
  }
});

test('drive: it holds on a slope with the brake and rolls back without it', () => {
  const env = ramp(15);
  const b = run(createBody(KART, {}, env), KART, { brake: 1 }, env, 10);
  assert.ok(Math.hypot(b.x, b.z) < 0.02, 'held: ' + b.z);
  near(b.pitch, (15 * Math.PI) / 180, 0.02, 'sits on the slope');
  const f = run(createBody(KART, {}, env), KART, {}, env, 3);
  assert.ok(f.z < -1 && f.u < 0, 'rolls back downhill: ' + f.z);
  const up = run(createBody(KART, {}, env), KART, { throttle: 1 }, env, 3);
  assert.ok(up.z > 2, 'drives up it: ' + up.z);
  near(up.y, env.ground(up.x, up.z), 0.08, 'stays on the ground');
});

test('drive: on a bowl it rolls to the bottom and settles there', () => {
  const b = run(createBody(KART, { x: 6, z: 0.5, yaw: -Math.PI / 2 }, BOWL), KART, {}, BOWL, 40);
  assert.ok(Math.hypot(b.x, b.z) < 0.6, 'near the bottom: ' + b.x + ', ' + b.z);
  assert.ok(Math.abs(b.u) < 0.3);
});

test('drive: a tank pivots on the spot', () => {
  const b = run(createBody(TANK, { yaw: 0 }, FLAT), TANK, { steer: 1 }, FLAT, 2);
  assert.ok(Math.hypot(b.x, b.z) < 0.05, 'stays put: ' + Math.hypot(b.x, b.z));
  assert.ok(b.yaw > 1.2 && b.yaw < 1.7, 'turned: ' + b.yaw);
  near(b.r, TANK.pivotRadS, 0.02, 'yaw rate');
  const l = run(createBody(TANK, {}, FLAT), TANK, { steer: -1 }, FLAT, 1);
  assert.ok(l.yaw < -0.5, 'the other way too');
});

test('drive: a towed cart converges behind and the jackknife clamps at its stop', () => {
  const k = createBody(KART, {}, FLAT);
  const p = hitchPose(k, KART, CART, 0.6);
  const c = createBody(CART, p, FLAT);
  c.artic = 0.6;
  const tr = { body: c, kind: CART };
  run(k, KART, { throttle: 0.5 }, FLAT, 6, SUB, tr);
  assert.ok(Math.abs(c.artic) < 0.03, 'straightened: ' + c.artic);
  near(wrap(c.yaw - k.yaw), c.artic, 1e-9);
  const ball = { x: k.x + Math.sin(k.yaw) * -0.95, z: k.z + Math.cos(k.yaw) * -0.95 };
  const tongue = { x: c.x + Math.sin(c.yaw) * 1.3, z: c.z + Math.cos(c.yaw) * 1.3 };
  assert.ok(Math.hypot(ball.x - tongue.x, ball.z - tongue.z) < 1e-6, 'stays on the ball');
  // reverse with the wheel held over: the cart folds until its stop and no further
  let maxA = 0;
  run(k, KART, { throttle: -0.6, steer: 1 }, FLAT, 12, SUB, tr, () => { maxA = Math.max(maxA, Math.abs(c.artic)); });
  assert.ok(maxA <= ARTIC_MAX + 1e-9, 'never past the stop: ' + maxA);
  assert.ok(Math.abs(c.artic) > ARTIC_MAX - 0.02, 'reached the stop: ' + c.artic);
  // and driving forward pulls it straight again
  run(k, KART, { throttle: 0.5 }, FLAT, 10, SUB, tr);
  assert.ok(Math.abs(c.artic) < 0.05, 'pulled straight: ' + c.artic);
});

test('drive: towing makes the tow unit slower to speed up and longer to stop', () => {
  const solo = run(createBody(KART, {}, FLAT), KART, { throttle: 1 }, FLAT, 1.5);
  const k = createBody(KART, {}, FLAT), c = createBody(CART, hitchPose(k, KART, CART, 0), FLAT);
  c.cargoKg = 150;
  run(k, KART, { throttle: 1 }, FLAT, 1.5, SUB, { body: c, kind: CART });
  assert.ok(k.u < solo.u * 0.8, `loaded ${k.u} vs solo ${solo.u}`);
});

// Updated for the per-wheel tyre model (wave 2, G-3): the old inputs (0.8 throttle, 0.7 steer on the bowl's walls) now
// spin the rear-driven kart round, as power past the rear tyres' grip does; a slide at the limit is chaotic, so the
// convergence check drives within grip and the sliding run only checks determinism.
test('drive: same inputs give the same state; halving the substep changes the end pose by under 2 percent', () => {
  const drive = (dt, thr = 0.4, amp = 0.35) => {
    const b = createBody(KART, { x: -8, z: -3 }, BOWL);
    run(b, KART, (q, t) => ({ throttle: t < 4 ? thr : 0.3, steer: Math.sin(t * 0.9) * amp, brake: t > 7 ? 0.5 : 0 }), BOWL, 9, dt);
    return b;
  };
  assert.equal(hashState(drive(SUB, 0.8, 0.7)), hashState(drive(SUB, 0.8, 0.7)), 'sliding: deterministic');
  const a = drive(SUB), b = drive(SUB);
  assert.equal(hashState(a), hashState(b));
  const h = drive(SUB / 2);
  const path = a.distM;
  assert.ok(path > 20, 'went somewhere: ' + path);
  const d = Math.hypot(a.x - h.x, a.z - h.z);
  assert.ok(d / path < 0.02, `end pose differs by ${d} m over ${path} m`);
  assert.ok(Math.abs(wrap(a.yaw - h.yaw)) < 0.05, 'heading ' + a.yaw + ' vs ' + h.yaw);
});

test('drive: obstacles push it out and take the speed into them; deep water is a wall; fuel runs out', () => {
  // a wall at z = 10
  const wall = { ground: () => 0, collide: (o, rad) => { if (o.z + rad > 10) o.z = 10 - rad; } };
  const b = run(createBody(KART, {}, wall), KART, { throttle: 1 }, wall, 6);
  assert.ok(b.z + KART.dims.l / 2 <= 10 + 0.02, 'stopped at the wall: ' + b.z);
  assert.ok(Math.abs(b.u) < 0.5, 'no speed into it');
  // water: shallow slows, deep is a wall
  const sea = { ground: () => 0, water: (x, z) => (z > 10 ? 2 : z > 5 ? 0.1 : 0) };
  const s = run(createBody(KART, {}, sea), KART, { throttle: 1 }, sea, 8);
  assert.ok(s.z < 10.1, 'kept out of deep water: ' + s.z);
  // fuel: a nearly empty tank runs dry and it coasts to a stop
  const f = createBody(KART, { fuelL: 0.002 }, FLAT);
  run(f, KART, { throttle: 1 }, FLAT, 20);
  assert.equal(f.fuelL, 0); near(f.burnedL, 0.002, 1e-12);
  assert.equal(f.stalled, 'fuel');
  assert.ok(f.u < 6, 'slowed after running dry: ' + f.u);
});

test('drive: off a kicker it leaves the ground and lands', () => {
  const kick = { ground: (x, z) => (z < 10 ? Math.max(0, (z - 8) * 0.35) : -0.5) };
  const b = createBody(KART, {}, kick);
  let air = false, land = 0;
  run(b, KART, { throttle: 1 }, kick, 4, SUB, null, (q) => { air = air || q.air; land = Math.max(land, q.land); });
  assert.ok(air, 'flew');
  assert.ok(land > 0, 'landed');
  assert.equal(b.air, false);
  near(b.y, -0.5, 0.06);
});

test('drive: heading steer turns toward the push, reverses when the push is behind, same for tracks', () => {
  const b = createBody(KART, {}, FLAT);
  run(b, KART, (q) => headingControl(q, KART, 1, 0), FLAT, 4);       // push toward +x from facing +z
  assert.ok(Math.abs(wrap(b.yaw - Math.PI / 2)) < 0.25 && b.u > 1, 'heads where pushed: ' + b.yaw);
  const r = createBody(KART, {}, FLAT);
  run(r, KART, (q) => headingControl(q, KART, 0, -1), FLAT, 2);     // push straight behind
  assert.ok(r.u < -0.5 && r.z < -0.5, 'reverses: ' + r.u);
  const t = createBody(TANK, {}, FLAT);
  run(t, TANK, (q) => headingControl(q, TANK, -1, 0), FLAT, 3);
  assert.ok(Math.abs(wrap(t.yaw + Math.PI / 2)) < 0.25, 'tank turns to the push: ' + t.yaw);
  const idle = headingControl(createBody(KART, {}, FLAT), KART, 0, 0);
  assert.equal(idle.brake, 1, 'no push holds it');
});

// ---------------------------------------------------------------- the sim system
function makeSim() {
  const hooks = {
    takeFuel: (ctx, l) => { const st = ctx.get('stock'); const got = Math.min(l, st.items.petrol || 0); st.items.petrol = (st.items.petrol || 0) - got; return got; },
    pay: (ctx, usd) => { const st = ctx.get('stock'); if (st.money < usd) return false; st.money -= usd; return true; },
  };
  const sim = createSim({ seed: 5, systems: [stockSystem(), createVehicleSystem({ name: 'vehicles', kinds: KINDS, hooks })] });
  return sim;
}
const V = (sim) => sim.state.sys.vehicles;
const c = (sim, name, p) => sim.commandNow(name, p);

test('vehicles: fuel is conserved through adding, driving, refuelling, removing and rentals', () => {
  const sim = makeSim(), s = V(sim);
  const a = c(sim, 'vehicles.add', { kind: 'kart', x: 0, z: 0 }).id;
  assert.equal(s.units[a].fuelL, KART.fuel.tankL, 'comes full');
  const b = c(sim, 'vehicles.add', { kind: 'kart', x: 5, z: 0, fuelL: 3 }).id;
  c(sim, 'vehicles.sit', { id: a });
  assert.equal(c(sim, 'vehicles.sync', { id: a, x: 30, z: 4, yaw: 1, burnedL: 2.5, distM: 31 }).ok, true);
  assert.equal(c(sim, 'vehicles.sync', { id: a, burnedL: 99 }).burnedL, 5.5, 'burn clamped to the tank');
  assert.equal(s.units[a].fuelL, 0);
  assert.equal(c(sim, 'vehicles.sync', { id: b, x: 9, z: 9, burnedL: 1 }).ok, false, 'nobody drives b');
  assert.equal(c(sim, 'vehicles.refuel', { id: a, litres: 4 }).ok, false, 'no fuel in stock');
  sim.state.sys.stock.items.petrol = 6;
  assert.equal(c(sim, 'vehicles.refuel', { id: a, litres: 4 }).litres, 4);
  assert.equal(c(sim, 'vehicles.refuel', { id: b }).litres, 2, 'only what is left in stock');
  assert.equal(c(sim, 'vehicles.refuel', { id: b }).ok, false);
  assert.equal(c(sim, 'vehicles.remove', { id: a }).reason, 'occupied');
  c(sim, 'vehicles.leave', { id: a });
  assert.equal(c(sim, 'vehicles.remove', { id: a }).ok, true);
  sim.state.sys.stock.money = 1000;
  c(sim, 'vehicles.rent', { kind: 'tank', days: 1, x: 0, z: 9 });
  sim.runDays(1.1);
  assert.equal(Object.keys(s.units).length, 1, 'the rental went back');
  assert.equal(c(sim, 'vehicles.refuel', { id: 'v9' }).ok, false);
  near(s.totals.distM, 31, 1e-9);
  assert.equal(s.totals.fuelBurnedL, 8);
  assert.ok(s.totals.fuelGoneL > 40, 'what left with the units is counted');
  assert.equal(createVehicleSystem({ kinds: KINDS }).api.fuelImbalance(s), 0);
});

test('vehicles: sit and leave rules', () => {
  const sim = makeSim(), s = V(sim);
  const a = c(sim, 'vehicles.add', { kind: 'kart', x: 0, z: 0 }).id, b = c(sim, 'vehicles.add', { kind: 'kart', x: 4, z: 0 }).id;
  const cart = c(sim, 'vehicles.add', { kind: 'cart', x: 0, z: 9 }).id;
  assert.equal(c(sim, 'vehicles.add', { kind: 'boat', x: 0, z: 0 }).reason, 'unknown kind');
  assert.equal(c(sim, 'vehicles.leave', { id: a }).reason, 'seat empty');
  assert.equal(c(sim, 'vehicles.sit', { id: cart }).reason, 'no seat');
  assert.equal(c(sim, 'vehicles.sit', { id: a, seat: 'roof' }).reason, 'no such seat');
  assert.deepEqual(c(sim, 'vehicles.sit', { id: a }), { ok: true, seat: 'driver' });
  assert.equal(c(sim, 'vehicles.sit', { id: a, actor: 'friend' }).reason, 'seat taken');
  assert.equal(c(sim, 'vehicles.sit', { id: b }).reason, 'already seated', 'one seat at a time');
  assert.equal(c(sim, 'vehicles.sit', { id: b, actor: 'friend' }).ok, true, 'someone else can');
  assert.equal(s.units[a].seats.driver, 'player');
  assert.equal(c(sim, 'vehicles.leave', { id: a }).ok, true);
  assert.equal(c(sim, 'vehicles.sit', { id: b }).reason, 'seat taken');
  assert.equal(c(sim, 'vehicles.sit', { id: a }).ok, true);
});

test('vehicles: hitch rules, and a hitched pair parks together', () => {
  const sim = makeSim(), s = V(sim);
  const k = c(sim, 'vehicles.add', { kind: 'kart', x: 0, z: 0, yaw: 0 }).id;
  const t = c(sim, 'vehicles.add', { kind: 'tank', x: 10, z: 0 }).id;
  const far = c(sim, 'vehicles.add', { kind: 'cart', x: 0, z: -8 }).id;
  const p = hitchPose(s.units[k], KART, CART, 0.3);
  const cart = c(sim, 'vehicles.add', { kind: 'cart', x: p.x + 0.2, z: p.z, yaw: p.yaw }).id;
  assert.equal(c(sim, 'vehicles.hitch', { id: k, to: k }).reason, 'same unit');
  assert.equal(c(sim, 'vehicles.hitch', { id: k, to: t }).reason, 'nothing to hitch');
  assert.equal(c(sim, 'vehicles.hitch', { id: t, to: cart }).reason, 'no ball to hitch to');
  assert.equal(c(sim, 'vehicles.hitch', { id: k, to: far }).reason, 'too far');
  assert.equal(c(sim, 'vehicles.unhitch', { id: k }).reason, 'not hitched');
  const r = c(sim, 'vehicles.hitch', { id: cart, to: k });                    // either order
  assert.deepEqual(r, { ok: true, tow: k, towed: cart });
  near(s.units[cart].artic, 0.3, 1e-5);
  assert.ok(Math.abs(s.units[cart].x - p.x) < 1e-5, 'snapped onto the ball');
  assert.equal(c(sim, 'vehicles.hitch', { id: k, to: cart }).reason, 'already towing');
  // drive the pair: the cart follows the reported articulation
  c(sim, 'vehicles.sit', { id: k });
  c(sim, 'vehicles.sync', { id: k, x: 20, z: 5, yaw: 1.2, artic: -2 });
  const want = hitchPose(s.units[k], KART, CART, -ARTIC_MAX);
  near(s.units[cart].artic, -ARTIC_MAX, 1e-5, 'clamped at the stop');
  near(s.units[cart].x, want.x, 1e-5); near(s.units[cart].z, want.z, 1e-5);
  assert.equal(c(sim, 'vehicles.unhitch', { id: cart }).ok, true);
  assert.equal(s.units[k].towing, null); assert.equal(s.units[cart].towedBy, null);
  c(sim, 'vehicles.leave', { id: k });
  assert.equal(c(sim, 'vehicles.remove', { id: cart }).ok, true);
});

test('vehicles: rentals are paid, extended, and collected when the time is up but not from under the driver', () => {
  const sim = makeSim(), s = V(sim), st = sim.state.sys.stock;
  st.money = 300;
  assert.equal(c(sim, 'vehicles.rent', { kind: 'kart', days: 1, x: 0, z: 0 }).reason, 'not for rent');
  const r = c(sim, 'vehicles.rent', { kind: 'tank', days: 1, x: 0, z: 0 });
  assert.equal(r.ok, true); assert.equal(st.money, 100); assert.equal(s.units[r.id].owner, 'rent');
  assert.equal(c(sim, 'vehicles.rent', { kind: 'tank', days: 1, x: 0, z: 0 }).reason, 'not enough money');
  st.money = 200;
  const ext = c(sim, 'vehicles.rent', { id: r.id, days: 1 });
  assert.equal(ext.until, r.until + 86400);
  sim.runDays(1.5);
  assert.ok(s.units[r.id], 'still rented');
  c(sim, 'vehicles.sit', { id: r.id });
  sim.runDays(1);
  assert.ok(s.units[r.id], 'not taken from under the driver');
  c(sim, 'vehicles.leave', { id: r.id });
  assert.equal(c(sim, 'vehicles.sit', { id: r.id }).reason, 'rental over');
  sim.runTicks(61);
  assert.equal(s.units[r.id], undefined, 'collected');
});

test('vehicles: implements attach to a point of their type and keep joint values in range', () => {
  const IMPL = { blade: { id: 'blade', mounts: 'ball', joints: [{ id: 'lift', min: -0.2, max: 0.5 }] } };
  const sim = createSim({ seed: 1, systems: [createVehicleSystem({ kinds: KINDS, implementKinds: IMPL })] });
  const k = c(sim, 'vehicles.add', { kind: 'kart', x: 0, z: 0 }).id;
  assert.equal(c(sim, 'vehicles.attach', { id: k, point: 'front', kind: 'blade' }).reason, 'no such point');
  assert.equal(c(sim, 'vehicles.attach', { id: k, point: 'ball', kind: 'mower' }).reason, 'unknown implement');
  assert.equal(c(sim, 'vehicles.attach', { id: k, point: 'ball', kind: 'blade' }).ok, true);
  assert.equal(c(sim, 'vehicles.attach', { id: k, point: 'ball', kind: 'blade' }).reason, 'point taken');
  assert.deepEqual(c(sim, 'vehicles.setJoints', { id: k, point: 'ball', q: [3] }).q, [0.5]);
  assert.equal(c(sim, 'vehicles.setJoints', { id: k, point: 'ball', q: [1, 2] }).reason, 'bad joints');
  assert.equal(c(sim, 'vehicles.detach', { id: k, point: 'ball' }).ok, true);
});

test('vehicles: the state survives a save round trip', () => {
  const sim = makeSim();
  const k = c(sim, 'vehicles.add', { kind: 'kart', x: 1.5, z: -2, yaw: 0.7, fuelL: 5 }).id;
  c(sim, 'vehicles.sit', { id: k });
  c(sim, 'vehicles.sync', { id: k, x: 3.25, z: 4.5, yaw: 0.9, burnedL: 0.125, distM: 6 });
  const saved = JSON.stringify(makeSave(sim.serialize(), {}));
  const back = makeSim();
  back.load(readSave(saved).sim);
  assert.equal(back.hash(), sim.hash());
  assert.deepEqual(V(back), V(sim));
  assert.equal(V(back).units[k].seats.driver, 'player', 'still seated after a reload');
  assert.equal(c(back, 'vehicles.add', { kind: 'kart', x: 0, z: 0 }).id, 'v2', 'ids carry on');
});
