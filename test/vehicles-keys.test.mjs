// Driving keys: carControl turns W/S/A/D into throttle, brake and steer relative to the vehicle, for the unchanged drive model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_KINDS, VEHICLE_SURFACES, vehicleCore } from '../src/sim/index.js';

const { createBody, stepBody, carControl, hitchPose, wrap, SUB } = vehicleCore;
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

// Ordinary keys on grass at a moderate speed: hold D, let go of W mid-turn, with and without a trailer. With the full
// engine braking of the automatic mid-turn the solid rear axle let the tail go and a trailer pushed the rig round; the
// rider's habits in carControl (a whisper of throttle through the turn, gentler bars at speed) keep it on its wheels.
test('letting go of W mid-turn on grass at moderate speed neither spins the ATV nor jackknifes a trailer', () => {
  const grass = { ground: () => 0, surface: () => VEHICLE_SURFACES.grass }, TR = VEHICLE_KINDS.trailer_small;
  for (const kg of [null, 0, 300]) {
    const b = createBody(ATV, { fuelL: 10 }, grass); b.cargoKg = ATV.riderKg;
    let tr = null;
    if (kg != null) { const t = createBody(TR, hitchPose(b, ATV, TR, 0), grass); t.cargoKg = kg; tr = { body: t, kind: TR }; }
    const st = {}; let slip = 0, yaw = 0, jack = false, held = 0;
    for (let i = 0, t = 0; t < 10; i++, t += SUB) {
      const k = t > 6 ? { fwd: 0, turn: 1 } : { fwd: b.u < 6 ? 1 : 0.2 };
      const o = carControl(b, ATV, st, k, SUB);
      if (t > 6.5 && b.u > 2) held = Math.max(held, o.throttle);
      stepBody(b, ATV, o, grass, SUB, tr);
      if (t > 6) { slip = Math.max(slip, b.slip); yaw = Math.max(yaw, Math.abs(b.r)); jack = jack || b.jack; }
    }
    assert.ok(held > 0 && held < 0.15, 'a light throttle through the turn: ' + held);
    assert.ok(slip < 1 && yaw < 1.6 && !jack, `trailer ${kg}: slip ${slip.toFixed(2)}, yaw rate ${yaw.toFixed(2)}, jack ${jack}`);
  }
});

test('the bars turn more slowly at speed', () => {
  const at = (u) => { const { b, st } = rider(); b.u = u; for (let i = 0; i < 0.3 / SUB; i++) carControl(b, ATV, st, { fwd: 0.2, turn: 1 }, SUB); return st.steer; };
  const walk = at(1.5), fast = at(15);
  assert.ok(walk > 0.85 && fast > 0.2 && fast < 0.4, `0.3 s of D: ${walk} at a walk, ${fast} at speed`);
});
