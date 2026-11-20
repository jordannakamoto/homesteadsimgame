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
