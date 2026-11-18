// Cementitious cure (src/sim/core/cure.js), headless and generic: published maturity and strength-gain behaviour.
// Strength gain: ACI 209R-92, moist-cured ordinary (Type I) cement, f(t) = t / (4 + 0.85 t) of the 28-day strength.
// Maturity: Nurse-Saul (ASTM C1074) with a datum of -10 C and a 20 C reference.
// Evaporation: ACI 305R's formula for the Menzel nomograph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CU from '../src/sim/core/cure.js';

const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, `${a} not within ${e} of ${b}`);
const NOHEAT = { ...CU.DEFAULTS, heatC: 0, blanketC: 0 };
// run a record at constant weather for some clock hours, one-hour steps, maturity on the same clock
function run(c, hours, env, k = NOHEAT, dt = 1) { for (let h = 0; h < hours; h += dt) CU.stepCure(c, dt, dt, env, k); return c; }

test('strength gain follows ACI 209: about 21% at 1 day, 46% at 3, 70% at 7, 100% at 28', () => {
  near(CU.strengthAt(1), 0.206, 0.005);
  near(CU.strengthAt(3), 0.458, 0.005);
  near(CU.strengthAt(7), 0.704, 0.005);
  near(CU.strengthAt(28), 1.0, 0.01);
  assert.ok(CU.strengthAt(90) > CU.strengthAt(28) && CU.strengthAt(90) < 1 / 0.85);   // slow gain after, toward 1/b
  assert.equal(CU.strengthAt(0), 0);
});

test('maturity: Nurse-Saul with a -10 C datum; at 20 C a day is a day, at 5 C it takes two', () => {
  near(CU.maturityRate(20), 1, 1e-12);
  near(CU.maturityRate(5), 0.5, 1e-12);
  assert.equal(CU.maturityRate(-10), 0);
  assert.equal(CU.maturityRate(-20), 0);
  const warm = run(CU.newCure(0), 7 * 24, { airC: 20, rh: 0.9 });
  near(warm.eqH, 7 * 24, 1e-9);
  near(warm.strength, CU.strengthAt(7), 1e-9);
  const cool = run(CU.newCure(0), 14 * 24, { airC: 5, rh: 0.9 });
  near(cool.strength, warm.strength, 1e-9);
  // monotone and capped by nothing but damage
  const c = CU.newCure(0); let last = 0;
  for (let h = 0; h < 40 * 24; h++) { CU.stepCure(c, 1, 1, { airC: 15, rh: 0.8 }, NOHEAT); assert.ok(c.strength >= last); last = c.strength; }
});

test('hydration warmth and a blanket speed the young cure; the seasonal clock scales maturity only', () => {
  const bare = run(CU.newCure(0), 24, { airC: 10, rh: 0.9 }, CU.DEFAULTS);
  const none = run(CU.newCure(0), 24, { airC: 10, rh: 0.9 });
  const blanket = CU.newCure(0); blanket.covered = 'blanket'; run(blanket, 24, { airC: 10, rh: 0.9 }, CU.DEFAULTS);
  assert.ok(bare.eqH > none.eqH && blanket.eqH > bare.eqH);
  near(bare.eqH, 24 * (15 + 10) / 30, 1e-9);
  // a short year: one clock hour ages as 18.25 hours, but setting stays on the clock
  const fast = CU.newCure(0, { setH20: 2.5 });
  CU.stepCure(fast, 1, 18.25, { airC: 20 }, NOHEAT);
  near(fast.eqH, 18.25, 1e-9);
  near(fast.setP, 1 / 2.5, 1e-9);
});

test('initial set: 2.5 h at 20 C, twice as long at 10 C, half at 30 C; workability falls to zero', () => {
  near(CU.setHoursAt(2.5, 20), 2.5, 1e-12);
  near(CU.setHoursAt(2.5, 10), 5, 1e-12);
  near(CU.setHoursAt(2.5, 30), 1.25, 1e-12);
  const c = CU.newCure(0, { setH20: 2.5 });
  assert.equal(CU.workability(c), 1);
  run(c, 2, { airC: 20 }, NOHEAT, 0.25);
  near(CU.workability(c), 0.2, 1e-9);
  assert.equal(c.set, false);
  run(c, 0.5, { airC: 20 }, NOHEAT, 0.25);
  assert.equal(c.set, true); assert.equal(CU.workability(c), 0);
});

test('frost while weak costs strength; under a blanket, or once past 3.5 MPa, it does not', () => {
  const k = { ...CU.DEFAULTS, frostSafe: 3.5 / 25 };
  const frozen = run(CU.newCure(0), 24, { airC: -12, rh: 0.8 }, k);
  assert.ok(frozen.frost > 0.9, 'a night of hard frost on fresh concrete');
  near(frozen.cap, 0.5, 0.05);
  run(frozen, 60 * 24, { airC: 20, rh: 0.9 }, k);
  assert.ok(frozen.strength < 0.6, 'it never recovers its design strength');
  const covered = CU.newCure(0); covered.covered = 'blanket';
  run(covered, 24, { airC: -6, rh: 0.8 }, k);
  assert.equal(covered.frost, 0);
  const strong = run(CU.newCure(0), 48, { airC: 20, rh: 0.9 }, k);    // 2 days at 20 C (+5 C the first day): about 40%
  assert.ok(strong.strength > k.frostSafe);
  run(strong, 24, { airC: -12 }, k);
  assert.equal(strong.frost, 0);
});

test('drying: the ACI 305 evaporation rate; hot wind on a bare young slab crazes it, a cover or misting prevents it', () => {
  // the nomograph's worked case: air 28 C, 50% humidity, concrete 32 C, wind 16 km/h: about 1 kg/m2/h
  near(CU.evaporation(32, 28, 0.5, 16 / 3.6), 1.0, 0.15);
  near(CU.evaporation(20, 20, 1, 0), 0, 1e-12);
  assert.ok(CU.evaporation(20, 20, 0.5, 10) > CU.evaporation(20, 20, 0.5, 2));
  const hot = { airC: 33, rh: 0.15, windMs: 9 };
  const bare = run(CU.newCure(0), 30, hot, CU.DEFAULTS);
  assert.ok(bare.dry > 0.5);
  assert.ok(bare.cap >= 0.9 - 1e-9 && bare.cap < 1, 'drying costs at most 10%');
  const plastic = CU.newCure(0); plastic.covered = 'plastic'; run(plastic, 30, hot, CU.DEFAULTS);
  const misted = run(CU.newCure(0), 30, { ...hot, wet: true }, CU.DEFAULTS);
  assert.equal(plastic.dry, 0); assert.equal(misted.dry, 0);
  // only the first day counts
  const old = run(CU.newCure(0), 30, { airC: 20, rh: 0.9 }, CU.DEFAULTS);
  run(old, 24, hot, CU.DEFAULTS);
  assert.equal(old.dry, 0);
});

test('rain before set pits the surface unless covered; records are plain JSON', () => {
  const c = run(CU.newCure(0), 2, { airC: 15, rainMmH: 4 }, NOHEAT);
  assert.ok(c.pit > 0);
  const d = CU.newCure(0); d.covered = 'plastic'; run(d, 2, { airC: 15, rainMmH: 4 }, NOHEAT);
  assert.equal(d.pit, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
});
