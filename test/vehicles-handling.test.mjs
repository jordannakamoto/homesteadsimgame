// ATV handling as the owner rides it: A/D the right way round, steering that still turns at speed, and hills.
// Numbers in docs/PLAYTEST.md (ATV handling); keys through carControl, the body through the drive model, all headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_KINDS, VEHICLE_SURFACES, vehicleCore } from '../src/sim/index.js';

const { createBody, stepBody, carControl, headingControl, hitchPose, wrap, SUB } = vehicleCore;
const ATV = VEHICLE_KINDS.atv, TR = VEHICLE_KINDS.trailer_small;
const env = (surf, ground = () => 0) => ({ ground, surface: () => VEHICLE_SURFACES[surf] });
const ridden = (e) => { const b = createBody(ATV, { fuelL: 10 }, e); b.cargoKg = ATV.riderKg; return b; };
const slope = (deg) => (x, z) => z * Math.tan((deg * Math.PI) / 180);       // uphill toward +z
// the rider's right as the chase camera shows it: the camera sits behind at yaw + pi and control.js reads D as the
// camera's right, (cos camYaw, -sin camYaw)
const riderRight = (yaw) => { const c = yaw + Math.PI; return [Math.cos(c), -Math.sin(c)]; };
// hold a speed with W (a rider's steady throttle), turn with A/D after `at` seconds
const hold = (b, st, e, v, turn, secs, { at = 0, tr = null, each } = {}) => {
  for (let t = 0; t < secs; t += SUB) {
    const fwd = v < 0 ? -1 : Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8));
    stepBody(b, ATV, carControl(b, ATV, st, { fwd, turn: t >= at ? turn : 0 }, SUB), e, SUB, tr);
    if (each && t >= at) each(b);
  }
  return b;
};

test('D turns the ATV toward the rider\'s right and A to the left, at any heading; the wheels and bars point that way', () => {
  for (const yaw of [0, 0.9, -2.2, 3]) {
    for (const turn of [1, -1]) {
      const e = env('grass'), b = ridden(e); b.yaw = yaw; const st = {};
      hold(b, st, e, 5, 0, 3);
      const x0 = b.x, z0 = b.z, y0 = b.yaw, R0 = riderRight(b.yaw), F0 = [Math.sin(y0), Math.cos(y0)];
      hold(b, st, e, 5, turn, 1.2);
      const dx = b.x - x0, dz = b.z - z0, side = dx * R0[0] + dz * R0[1], ahead = dx * F0[0] + dz * F0[1];
      assert.ok(ahead > 2 && Math.sign(side) === turn && Math.abs(side) > 0.5, `yaw ${yaw}, turn ${turn}: ${side.toFixed(2)} m to the right, ${ahead.toFixed(2)} ahead`);
      // the nose followed: the new heading leans toward the same side
      const Fn = [Math.sin(b.yaw), Math.cos(b.yaw)];
      assert.ok(Math.sign(Fn[0] * R0[0] + Fn[1] * R0[1]) === turn, 'the nose turned that way');
      // the front wheels (drawn rotated by +steer about y: local +z toward local +x = R) point to the same side
      const wheel = [Math.sin(b.yaw + b.steer), Math.cos(b.yaw + b.steer)];
      assert.ok(Math.sign((wheel[0] - Fn[0]) * R0[0] + (wheel[1] - Fn[1]) * R0[1]) === turn, 'the wheels point that way');
      assert.ok(Math.abs(wrap(b.yaw - y0)) > 0.3, 'it turned');
    }
  }
});

test('reversing with D: the front wheels still point right, so the tail swings right and the nose left, as in a car', () => {
  const e = env('grass'), b = ridden(e); const st = {};
  hold(b, st, e, -1, 0, 4);
  assert.ok(b.u < -1, 'backing: ' + b.u);
  const x0 = b.x, z0 = b.z, R0 = riderRight(b.yaw), F0 = [Math.sin(b.yaw), Math.cos(b.yaw)];
  hold(b, st, e, -1, 1, 1.5);
  const dx = b.x - x0, dz = b.z - z0, side = dx * R0[0] + dz * R0[1], back = -(dx * F0[0] + dz * F0[1]);
  assert.ok(back > 1 && side > 0.15, `the tail went back ${back.toFixed(2)} m and right ${side.toFixed(2)} m`);
  const Fn = [Math.sin(b.yaw), Math.cos(b.yaw)];
  assert.ok(Fn[0] * R0[0] + Fn[1] * R0[1] < -0.05, 'the nose swung left');
  assert.ok(b.steer < 0, 'wheels to the rider\'s right (negative steer): ' + b.steer);
});

test('touch (heading steer) still turns toward the push: a push to the rider\'s right turns it right', () => {
  const e = env('grass'), b = ridden(e);
  for (let t = 0; t < 2; t += SUB) stepBody(b, ATV, headingControl(b, ATV, Math.sin(b.yaw), Math.cos(b.yaw)), e);
  const R0 = riderRight(b.yaw), F0 = [Math.sin(b.yaw), Math.cos(b.yaw)];
  const push = [(F0[0] + R0[0]) / Math.SQRT2, (F0[1] + R0[1]) / Math.SQRT2];
  for (let t = 0; t < 1; t += SUB) stepBody(b, ATV, headingControl(b, ATV, push[0], push[1]), e);
  const Fn = [Math.sin(b.yaw), Math.cos(b.yaw)];
  assert.ok(Fn[0] * R0[0] + Fn[1] * R0[1] > 0.3, 'turned right toward the push');
});

// Steady circles with D held and the speed held by W, dry grass and packed dirt. Before this change (bars to the
// speed-reduced lock, front plowing past its peak): 16.8, 32.1 and 47.3 m on grass at 8, 12 and 15 m/s.
const circle = (surf, v, kg = null) => {
  const e = env(surf), b = ridden(e), st = {};
  let tr = null;
  if (kg != null) { const t = createBody(TR, hitchPose(b, ATV, TR, 0), e); t.cargoKg = kg; tr = { body: t, kind: TR }; }
  let n = 0, R = 0, slip = 0, tip = 0, jack = false, ay = 0;
  hold(b, st, e, v, 1, 10, { at: 4, tr, each: (q) => { slip = Math.max(slip, q.slip); tip = Math.max(tip, q.tip); jack = jack || q.jack; } });
  hold(b, st, e, v, 1, 2, { tr, each: (q) => { R += Math.abs(q.u / q.r); ay += Math.abs(q.u * q.r); n++; } });
  return { R: R / n, ay: ay / n / 9.81, slip, tip, jack, u: b.u };
};

test('steering at speed: D held carves a circle near the grip limit, with no spin and no tip', () => {
  const want = { grass: { 5: 6, 8: 13.5, 12: 27, 15: 41 }, dirt: { 5: 5.5, 8: 12, 12: 25, 15: 37 } };
  for (const surf of ['grass', 'dirt']) {
    for (const v of [5, 8, 12, 15]) {
      const c = circle(surf, v);
      assert.ok(c.R < want[surf][v], `${surf} at ${v} m/s: radius ${c.R.toFixed(1)} m (want under ${want[surf][v]})`);
      assert.ok(c.ay < ATV.grip.mu * VEHICLE_SURFACES[surf].mu * 1.05, `${surf} at ${v}: ${c.ay.toFixed(2)} g is inside the grip`);
      assert.ok(c.slip < 2 && c.tip < 0.85, `${surf} at ${v}: slip ${c.slip.toFixed(2)}, tip ${c.tip.toFixed(2)}`);
    }
  }
});

test('towing 300 kg: D held or W let go mid-turn at 4-12 m/s neither jackknifes nor spins the rig', () => {
  for (const surf of ['grass', 'dirt']) {
    for (const v of [4, 6, 8, 10, 12]) {
      for (const lift of [false, true]) {
        const e = env(surf), b = ridden(e), st = {};
        const t0 = createBody(TR, hitchPose(b, ATV, TR, 0), e); t0.cargoKg = 300; const tr = { body: t0, kind: TR };
        let slip = 0, jack = false;
        for (let t = 0; t < 12; t += SUB) {
          const fwd = t > 6 && lift ? 0 : Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8));
          stepBody(b, ATV, carControl(b, ATV, st, { fwd, turn: t > 6 ? 1 : 0 }, SUB), e, SUB, tr);
          if (t > 6) { slip = Math.max(slip, b.slip); jack = jack || b.jack; }
        }
        assert.ok(!jack && slip < 1, `${surf} ${v} m/s ${lift ? 'lifting off' : 'holding'}: slip ${slip.toFixed(2)}, jack ${jack}`);
      }
    }
  }
});

// A Honda Rancher 420 4x4 (about 20 kW, low first gear, both axles driven) pulls up 25-30 degrees of dry ground. With
// the keys: W from a stop on the slope. Before this change a held W braked whenever it rolled back at all, so from
// 18-20 degrees up it sat braking against its own rollback and never climbed.
test('W from a stop climbs 15 and 25 degrees of dry grass without rolling back', () => {
  for (const [deg, minU] of [[15, 8], [25, 3]]) {
    const g = slope(deg), e = env('grass', g), b = ridden(e), st = {};
    let back = 0;
    for (let t = 0; t < 8; t += SUB) { stepBody(b, ATV, carControl(b, ATV, st, { fwd: 1 }, SUB), e); back = Math.min(back, b.z); }
    assert.ok(b.u > minU && b.z > 15, `${deg} degrees: ${b.u.toFixed(2)} m/s, ${b.z.toFixed(1)} m up`);
    assert.ok(back > -0.2, `${deg} degrees: rolled back ${back.toFixed(2)} m`);
  }
  // 35 degrees is past it: held on the brake, it stays put rather than sliding down
  const g = slope(35), e = env('grass', g), b = ridden(e), st = {};
  for (let t = 0; t < 6; t += SUB) stepBody(b, ATV, carControl(b, ATV, st, { fwd: 1 }, SUB), e);
  assert.ok(b.z < 3, '35 degrees: ' + b.z);
});

// Up a hill the front tyres carry less weight and share their grip with the drive (both axles pull): it turns wider
// than on the flat, but still turns. The rider leans forward up a climb (kind.lean.climbM).
test('steering up a 10 degree hill still turns: within about 1.4 times the flat radius', () => {
  const firstQuarter = (deg, v) => {
    const e = env('grass', slope(deg)), b = ridden(e), st = {};
    hold(b, st, e, v, 0, 5);
    const y0 = b.yaw; let d = 0;
    for (let t = 0; t < 10 && Math.abs(wrap(b.yaw - y0)) < Math.PI / 4; t += SUB) {
      const x0 = b.x, z0 = b.z;
      stepBody(b, ATV, carControl(b, ATV, st, { fwd: Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8)), turn: 1 }, SUB), e);
      d += Math.hypot(b.x - x0, b.z - z0);
    }
    return d / (Math.PI / 4);
  };
  for (const v of [3, 5]) {
    const flat = firstQuarter(0, v), up = firstQuarter(10, v);
    assert.ok(up < flat * 1.4 && up < 10, `at ${v} m/s: ${up.toFixed(1)} m up the hill vs ${flat.toFixed(1)} m on the flat`);
  }
});

// ---- feel: how quickly it answers the keys, and how it brakes (docs/PLAYTEST.md, "ATV feel"; bench/atv-feel.mjs prints
// the whole table). Floors, so the feel cannot drift back: a real utility quad reaches full lock in 0.2-0.4 s, turns
// 3-3.5 m at a walk, stops from 8 m/s in 5-6 m at 0.6-0.8 g, and its engine brakes noticeably when the throttle is let go.
const keysOn = (e, b, st, k) => { const o = carControl(b, ATV, st, k, SUB); if (k.space) { o.brake = 1; o.throttle = 0; } stepBody(b, ATV, o, e, SUB); return o; };
const cruiseAt = (e, v) => { const b = ridden(e), st = {}; for (let t = 0; t < 10; t += SUB) keysOn(e, b, st, { fwd: Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8)) }); return { b, st }; };

test('feel: A/D reach the lock in under 0.2 s and the nose answers within 0.22 s', () => {
  const e = env('grass');
  for (const v of [0, 3]) {
    const { b, st } = v ? cruiseAt(e, v) : { b: ridden(e), st: {} };
    const lock = vehicleCore.steerLimit(ATV, b.u);
    let t = 0;
    while (Math.abs(b.steer) < 0.9 * lock && t < 1) { keysOn(e, b, st, { fwd: v ? 0.4 : 0, turn: 1 }); t += SUB; }
    assert.ok(t < 0.2, `at ${v} m/s: ${t.toFixed(2)} s to 90% of the ${(lock * 57.3).toFixed(1)} degree lock`);
    let back = 0;
    while (Math.abs(b.steer) > 0.1 * lock && back < 1) { keysOn(e, b, st, { fwd: v ? 0.4 : 0 }); back += SUB; }
    assert.ok(back < 0.2, `at ${v} m/s: back to centre in ${back.toFixed(2)} s`);
  }
  const { b, st } = cruiseAt(e, 5), rs = [];
  for (let t = 0; t < 3; t += SUB) { keysOn(e, b, st, { fwd: Math.max(0, Math.min(1, 0.3 + (5 - b.u) * 0.8)), turn: 1 }); rs.push(Math.abs(b.r)); }
  const t63 = (rs.findIndex((r) => r >= 0.63 * rs[rs.length - 1]) + 1) * SUB;
  assert.ok(t63 < 0.22, `yaw rate at 5 m/s reaches 63% in ${t63.toFixed(2)} s`);
});

test('feel: turning circles with D held: a walk within the published 3.5 m, 5 and 8 m/s near the grip', () => {
  const e = env('grass');
  const at = (v) => {
    const { b, st } = cruiseAt(e, v), pts = [];
    let R = 0, n = 0;
    for (let t = 0; t < (v < 3 ? 22 : 12); t += SUB) {                // past a whole lap
      keysOn(e, b, st, { fwd: Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8)), turn: 1 });
      if (t > 6) { R += Math.abs(b.u / b.r); n++; const o = vehicleCore.toWorld(b, ATV.track / 2, ATV.axles[0].z); pts.push([o.x, o.z]); }
    }
    const span = (i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]));
    return { R: R / n, outer: Math.max(span(0), span(1)) / 2 };
  };
  const walk = at(1.5), mid = at(5), fast = at(8);
  assert.ok(walk.outer < 3.51 * 1.1, `at a walk: ${walk.outer.toFixed(2)} m to the outer front tyre (published 3.51)`);
  assert.ok(mid.R < 4.7, `at 5 m/s: ${mid.R.toFixed(2)} m (it was 5.3)`);
  assert.ok(fast.R < 11.2, `at 8 m/s: ${fast.R.toFixed(2)} m (it was 12.7)`);
});

test('feel: S and Space stop from 8 m/s in about 5 m without locking, still steering, and S reverses only after a held stop', () => {
  const e = env('grass');
  for (const k of [{ fwd: -1 }, { space: true }]) {
    const { b, st } = cruiseAt(e, 8), x0 = b.x, z0 = b.z, u0 = b.u;
    let t = 0, lock = 0;
    while (b.u > 0.05 && t < 5) { keysOn(e, b, st, k); t += SUB; if (b.spin > 0.5) lock += SUB; }
    const d = Math.hypot(b.x - x0, b.z - z0), g = (u0 * u0) / (2 * d) / 9.81;
    assert.ok(d < 5.2 && t < 1.3 && g > 0.65, `${k.space ? 'Space' : 'S'} from ${u0.toFixed(1)} m/s: ${d.toFixed(2)} m, ${t.toFixed(2)} s, ${g.toFixed(2)} g`);
    assert.ok(lock === 0, 'the wheels never lock: ' + lock);
  }
  // braking and turning at once: the front still steers (it used to lock and slide straight, 2 degrees)
  {
    const { b, st } = cruiseAt(e, 8), y0 = b.yaw;
    while (b.u > 0.05) keysOn(e, b, st, { fwd: -1, turn: 1 });
    assert.ok(Math.abs(wrap(b.yaw - y0)) > 0.35, 'S and D turn the nose ' + (wrap(b.yaw - y0) * 57.3).toFixed(0) + ' degrees');
  }
  // at a standstill a tap of S only holds the brake; held, it backs up
  {
    const b = ridden(e), st = {};
    for (let t = 0; t < 0.2; t += SUB) keysOn(e, b, st, { fwd: -1 });
    for (let t = 0; t < 1; t += SUB) keysOn(e, b, st, {});
    assert.ok(Math.abs(b.u) < 0.05 && b.gear > 0, 'a tap of S stays put: ' + b.u);
    let t = 0, first = null;
    for (; t < 2; t += SUB) { keysOn(e, b, st, { fwd: -1 }); if (first == null && b.u < -0.05) first = t; }
    assert.ok(first > 0.25 && first < 1 && b.u < -1, `held S backs up after ${first && first.toFixed(2)} s: ${b.u.toFixed(2)} m/s`);
  }
});

test('feel: letting go of W brakes on the engine, about a fifth of a g at 8 m/s', () => {
  const e = env('grass'), { b, st } = cruiseAt(e, 8), u0 = b.u;
  for (let t = 0; t < 1; t += SUB) keysOn(e, b, st, {});
  const g = (u0 - b.u) / 9.81;
  assert.ok(g > 0.2 && g < 0.35, `${g.toFixed(3)} g in the first second`);
});
