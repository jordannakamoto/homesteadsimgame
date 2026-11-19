// Driving keys: carControl turns W/S/A/D into throttle, brake and steer relative to the vehicle, for the unchanged drive model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_KINDS, VEHICLE_SURFACES, vehicleCore } from '../src/sim/index.js';

const { createBody, stepBody, carControl, wrap, SUB } = vehicleCore;
const ATV = VEHICLE_KINDS.atv, env = { ground: () => 0, surface: () => VEHICLE_SURFACES.dirt };
const rider = () => { const b = createBody(ATV, { fuelL: 10 }, env); b.cargoKg = ATV.riderKg; return { b, st: {} }; };
const run = (d, keys, secs, each) => {
  for (let i = 0; i < secs / SUB; i++) {
    const k = typeof keys === 'function' ? keys(d.b) : keys;
    stepBody(d.b, ATV, carControl(d.b, ATV, d.st, k, SUB), env, SUB); if (each) each(d.b);
  }
  return d;
};

test('W builds speed gradually (an analogue pedal), straight ahead', () => {
  const d = rider(); run(d, { fwd: 1 }, 0.2);
  assert.ok(d.st.thr > 0.1 && d.st.thr < 0.5, 'pedal still ramping at 0.2 s');
  run(d, { fwd: 1 }, 4);
  assert.ok(d.b.u > 5, 'accelerating'); assert.ok(Math.abs(d.b.yaw) < 1e-6 && Math.abs(d.b.x) < 1e-6);
});

test('Shift caps the pedal to a gentle share', () => {
  const d = rider(); run(d, { fwd: 1, gentle: true }, 2); assert.ok(d.st.thr <= 0.351);
});

test('S brakes while rolling forward, then reverses while still held; releasing stops it', () => {
  const d = rider(); run(d, { fwd: 1 }, 4); const u0 = d.b.u;
  let sawBrake = false; run(d, { fwd: -1 }, 1, () => { if (d.b.u > 0.5) sawBrake = true; });
  assert.ok(sawBrake && d.b.u < u0 - 3, 'S slowed it down');
  run(d, { fwd: -1 }, 6); assert.ok(d.b.u < -1, 'then it reverses: ' + d.b.u);
  run(d, { fwd: 0 }, 6); assert.ok(Math.abs(d.b.u) < 0.3, 'released, it settles');
});

test('S from a standstill reverses; W while rolling back brakes first', () => {
  const d = rider(); run(d, { fwd: -1 }, 3); assert.ok(d.b.u < -1);
  run(d, { fwd: 1 }, 6); assert.ok(d.b.u > 0.5, 'W brought it round to forward');
});

test('A and D steer relative to the body, whatever way it faces or the camera looks', () => {
  for (const yaw of [0, 1.1, -2.4]) {
    for (const [turn, sign] of [[1, 1], [-1, -1]]) {
      const d = rider(); d.b.yaw = yaw; run(d, { fwd: 1 }, 2.5); const y0 = d.b.yaw;
      run(d, { fwd: 0.4, turn }, 1.5);
      const dy = wrap(d.b.yaw - y0); assert.ok(Math.sign(dy) === sign && Math.abs(dy) > 0.15, `turn ${turn} at yaw ${yaw}: ${dy}`);
    }
  }
});

test('steering eases in at the steer rate and recentres when released', () => {
  const d = rider(); run(d, { fwd: 1 }, 3); let first = 0;
  run(d, { fwd: 0.3, turn: 1 }, 0.1, (b) => { first = b.steer; });
  assert.ok(first > 0 && first < ATV.steerMaxRad * 0.9, 'not instant: ' + first);
  run(d, { fwd: 0.3, turn: 1 }, 1.5); assert.ok(d.b.steer > ATV.steerMaxRad * 0.5);
  run(d, { fwd: 0.3, turn: 0 }, 2); assert.ok(Math.abs(d.b.steer) < 0.01, 'back to centre');
});

test('reversing: A and D turn the front wheels the same way, so the tail swings the other way', () => {
  const fwdD = rider(); run(fwdD, { fwd: 1 }, 3); run(fwdD, { fwd: 0.3, turn: 1 }, 1);
  const rev = rider(); run(rev, { fwd: -1 }, 4); const y0 = rev.b.yaw; run(rev, { fwd: -1, turn: 1 }, 1.5);
  assert.ok(fwdD.b.steer > 0 && rev.b.steer > 0, 'wheels turn right with D either way');
  assert.ok(wrap(rev.b.yaw - y0) < -0.05, 'backing with D, the nose swings left');
});

test('Space brakes and overrides W', () => {
  const d = rider(); run(d, { fwd: 1 }, 4); run(d, { fwd: 1, brake: true }, 5); assert.ok(Math.abs(d.b.u) < 0.3);
});
