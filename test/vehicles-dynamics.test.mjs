// The drive model's wheel loads, tyres and towing (wave 2, G-3): per-wheel normal loads from the centre of mass, weight
// transfer and slope; each wheel's friction circle with load sensitivity; open and solid axles; understeer and
// oversteer; the trailer as a body on the ball (hitch force both ways, tongue weight from load placement, sway above a
// speed, a loaded trailer pushing the rig round on a downhill turn). Generic fixtures plus the homestead ATV and trailer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody, settle, hitchPose, headingControl, tyreGrip, SUB, GRAV, ARTIC_MAX } from '../src/sim/core/vehicles-drive.js';
import { VEHICLE_KINDS, VEHICLE_SURFACES } from '../src/sim/index.js';
import { hashState } from '../src/sim/index.js';

// a small front-heavy rear-drive car: 60 percent of its weight on the front axle
const CAR = Object.freeze({
  id: 'car', drive: 'wheeled', dims: { l: 3.8, w: 1.7, h: 1.4 }, massKg: 1000, cgH: 0.5, cgZ: 0.25,
  wheelbase: 2.5, track: 1.5, wheelR: 0.3,
  axles: [{ z: 1.25, steer: true, driven: false }, { z: -1.25, steer: false, driven: true, diff: 'open' }],
  powerW: 60000, topMps: 40, reverseMps: 4, brakeG: 0.9, steerMaxRad: 0.6, steerRate: 2, steerSpeedFalloff: 0.6,
  grip: { mu: 1.0, slide: 0.8, lateral: 12, rolling: 0.015 }, susp: { travel: 0.12, hz: 1.6, damp: 0.5 },
  seats: [], points: [], fuel: null,
});
const ATV = VEHICLE_KINDS.atv, TR = VEHICLE_KINDS.trailer_small;
const BARE = { ...ATV, assist: null };          // the tyres and the hitch alone, without the rider's yaw assist and ABS
const FLAT = { ground: () => 0 };
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const run = (b, k, input, env, secs, trailer = null, each = null) => {
  for (let i = 0; i < Math.round(secs / SUB); i++) { stepBody(b, k, typeof input === 'function' ? input(b, i * SUB) : input, env, SUB, trailer); if (each) each(b, i * SUB); }
  return b;
};
const rad = (d) => (d * Math.PI) / 180;

test('wheel loads: the static split follows the centre of mass; acceleration, a slope, a turn and a side slope move it', () => {
  const W = CAR.massKg * GRAV, hL = CAR.cgH / CAR.wheelbase;
  const s = run(createBody(CAR, {}, FLAT), CAR, { brake: 1 }, FLAT, 1);
  near(sum(s.load), W, W * 1e-3, 'they carry the weight');
  near((s.load[0] + s.load[1]) / W, 0.6, 0.005, 'front share');
  near(s.load[0], s.load[1], 1e-6, 'left and right alike');
  // uphill, held on the brakes: weight goes to the rear by tan(slope) x h / L
  const up = { ground: (x, z) => z * Math.tan(rad(10)) };
  const h = run(createBody(CAR, {}, up), CAR, { brake: 1 }, up, 2);
  near((h.load[0] + h.load[1]) / sum(h.load), 0.6 - Math.tan(rad(10)) * hL, 0.01, 'uphill front share');
  near(sum(h.load), W * Math.cos(rad(10)), W * 0.01, 'the slope carries less');
  // accelerating: the rear gains m a h / L
  let fs = 0, ax = 0;
  run(createBody(CAR, {}, FLAT), CAR, { throttle: 1 }, FLAT, 1.5, null, (q, t) => { if (t > 1) { fs = (q.load[0] + q.load[1]) / sum(q.load); ax = q.ax; } });
  assert.ok(ax > 3, 'it accelerates: ' + ax);
  near(fs, 0.6 - (ax / GRAV) * hL, 0.015, 'front share under power');
  // a steady right turn: the outer (left) wheels gain m ay h / track
  const c = createBody(CAR, {}, FLAT);
  run(c, CAR, (q) => ({ throttle: q.u < 10 ? 0.3 : 0.12, steer: 0.25 }), FLAT, 8);
  const dN = c.load[0] + c.load[2] - (c.load[1] + c.load[3]);
  assert.ok(c.ay > 3, 'turning: ' + c.ay);
  near(dN / 2, (CAR.massKg * c.ay * CAR.cgH) / CAR.track, 150, 'lateral transfer');
  near(c.tip, (c.ay / GRAV) / (CAR.track / (2 * CAR.cgH)), 0.03, 'tip is the transfer against the stability factor');
  // a side slope (right side up), held: the downhill (left) wheels carry more
  const side = { ground: (x) => x * Math.tan(rad(12)) };
  const d = run(createBody(CAR, {}, side), CAR, { brake: 1 }, side, 2);
  near((d.load[0] + d.load[2] - d.load[1] - d.load[3]) / 2, (sum(d.load) * Math.tan(rad(12)) * CAR.cgH) / CAR.track, 60, 'side slope');
});

test('tyres: grip grows more slowly than load, so moving load across an axle costs it grip', () => {
  const N0 = 2500;
  near(tyreGrip(1, 2 * N0, N0) / (2 * N0), 0.9, 1e-9, 'twice the load, a tenth less coefficient');
  assert.ok(tyreGrip(1, 1.5 * N0, N0) > tyreGrip(1, N0, N0), 'more load still grips more');
  assert.ok(tyreGrip(1, 1.5 * N0, N0) + tyreGrip(1, 0.5 * N0, N0) < 2 * tyreGrip(1, N0, N0), 'transfer costs the axle');
  assert.equal(tyreGrip(1, 0, N0), 0, 'a lifted wheel has none');
});

test('an open differential is held to its lighter wheel: one rear wheel on ice and it barely pulls; a solid axle pulls', () => {
  const ice = { ground: () => 0, surface: (x) => (x < 0 ? { mu: 0.12, roll: 1 } : { mu: 1, roll: 1 }) };
  const SOLID = { ...CAR, axles: [CAR.axles[0], { ...CAR.axles[1], diff: 'locked' }] };
  const o = run(createBody(CAR, {}, ice), CAR, { throttle: 1 }, ice, 2);
  const l = run(createBody(SOLID, {}, ice), SOLID, { throttle: 1 }, ice, 2);
  assert.ok(o.u < l.u * 0.5, `open ${o.u} vs locked ${l.u}`);
  assert.ok(o.u > 0.2, 'still creeps on the ice wheel: ' + o.u);
});

test('a solid driven axle pushes: at a crawl it turns wider than one with a differential', () => {
  const SOLID = { ...CAR, axles: [CAR.axles[0], { ...CAR.axles[1], diff: 'locked' }] };
  const radius = (k) => {
    const b = createBody(k, {}, FLAT), pts = [];
    run(b, k, (q) => ({ throttle: q.u < 2 ? 0.2 : 0, steer: 1 }), FLAT, 10);
    run(b, k, (q) => ({ throttle: q.u < 2 ? 0.2 : 0, steer: 1 }), FLAT, 30, null, (q) => pts.push([q.x, q.z]));   // whole laps
    const cx = sum(pts.map((p) => p[0])) / pts.length, cz = sum(pts.map((p) => p[1])) / pts.length;
    return sum(pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) / pts.length;
  };
  const open = radius(CAR), solid = radius(SOLID), kin = Math.hypot(CAR.wheelbase / Math.tan(CAR.steerMaxRad * (1 - CAR.steerSpeedFalloff * 2 / 40)), CAR.wheelbase / 2);
  assert.ok(Math.abs(open - kin) / kin < 0.05, `open ${open} vs ${kin}`);
  assert.ok(solid > open * 1.05, `solid ${solid} vs open ${open}`);
});

test('understeer and oversteer: too much lock at speed pushes the nose wide; power or the handbrake swings the tail', () => {
  const up = (b) => run(b, CAR, (q) => ({ throttle: q.u < 15 ? 1 : 0.15 }), FLAT, 6);
  // full lock at 15 m/s: the front slides (plow) more than the rear, and the turn is held to about mu g
  const u = up(createBody(CAR, {}, FLAT));
  let plow = 0, slip = 0, ay = 0;
  run(u, CAR, { throttle: 0.15, steer: 1 }, FLAT, 1.5, null, (q) => { plow = Math.max(plow, q.plow); slip = Math.max(slip, q.slip); ay = Math.max(ay, Math.abs(q.ay)); });
  assert.ok(plow > 1 && plow > slip * 2, `the front washes out: plow ${plow}, slip ${slip}`);
  assert.ok(ay < CAR.grip.mu * GRAV * 1.1, 'held to the grip: ' + ay);
  // a steady turn at 8 m/s and 0.4 g, then full power: with a solid rear axle the rear tyres break loose and the tail
  // steps out (power oversteer); holding the throttle steady it stays gripped. (With the open differential the light
  // inside wheel spins first and the car just does not pull: the next test's ice case.)
  const SOLID = { ...CAR, axles: [CAR.axles[0], { ...CAR.axles[1], diff: 'locked' }] };
  const turn = (thr) => {
    const b = run(createBody(SOLID, {}, FLAT), SOLID, (q) => ({ throttle: q.u < 8 ? 1 : 0.05 }), FLAT, 4);
    run(b, SOLID, { throttle: 0.05, steer: 0.33 }, FLAT, 2);
    let s = 0;
    run(b, SOLID, { throttle: thr, steer: 0.33 }, FLAT, 1.5, null, (q) => { s = Math.max(s, q.slip); });
    return s;
  };
  const off = turn(0.05), on = turn(1);
  assert.ok(off < 0.5 && on > 1.5, `tail: steady ${off}, floored ${on}`);
  // the handbrake mid-turn locks the rear and the tail comes round
  const hb = up(createBody(CAR, {}, FLAT));
  run(hb, CAR, { throttle: 0.15, steer: 0.3 }, FLAT, 1);
  const yaw0 = hb.yaw;
  let hs = 0;
  run(hb, CAR, { steer: 0.3, handbrake: true }, FLAT, 1.2, null, (q) => { hs = Math.max(hs, q.slip); });
  assert.ok(hs > 2 && hb.spin > 0.5, 'handbrake slide: ' + hs);
  assert.ok(Math.abs(hb.yaw - yaw0) > 1, 'it swings round: ' + (hb.yaw - yaw0));
  // all four locked (brakes stronger than the tyres): no steering at all, it slides straight on; rolling, the same
  // steering turns it
  const HARD = { ...CAR, brakeG: 1.4 };
  const lock = (brake) => { const q = run(createBody(HARD, {}, FLAT), HARD, (z) => ({ throttle: z.u < 15 ? 1 : 0.15 }), FLAT, 6), y1 = q.yaw; run(q, HARD, { brake, steer: 1 }, FLAT, 0.6); return { d: Math.abs(q.yaw - y1), spin: q.spin }; };
  const lk = lock(1), rl = lock(0);
  assert.ok(lk.d < 0.05 && lk.spin > 0.5 && rl.d > 0.2, `locked wheels do not steer: ${lk.d} vs rolling ${rl.d}`);
});

// ---------------------------------------------------------------- the trailer
const rig = (env, loadKg, { cargoZ = null, artic = 0 } = {}) => {
  const b = createBody(ATV, { fuelL: 10 }, env); b.cargoKg = ATV.riderKg;
  const t = { body: createBody(TR, hitchPose(b, ATV, TR, artic), env), kind: TR };
  t.body.cargoKg = loadKg; t.body.cargoZ = cargoZ; t.body.artic = artic;
  return { b, t };
};

test('trailer: the tongue weight comes from where the load sits, rests on the tow unit\'s rear wheels, and the ball pulls and pushes', () => {
  const tongue = (kg, cargoZ) => { const { b, t } = rig(FLAT, kg, { cargoZ }); run(b, ATV, { brake: 1 }, FLAT, 0.5, t); return { k: t.body.tongue / ((TR.massKg + kg) * GRAV), b, t }; };
  const empty = tongue(0), full = tongue(TR.cargo.capKg), back = tongue(TR.cargo.capKg, -0.25), mid = tongue(TR.cargo.capKg, 0);
  near(empty.k, 0.1, 0.005, 'empty: a tenth on the ball');
  assert.ok(full.k >= 0.1 && full.k <= 0.15, 'loaded as it lies: 10-15 percent: ' + full.k);
  assert.ok(mid.k < 0.05 && back.k < 0, `over the axle little, behind it the ball is lifted: ${mid.k} ${back.k}`);
  const Mo = ATV.massKg + ATV.riderKg;
  near(sum(full.b.load), (Mo * GRAV + full.t.body.tongue), 1, 'the ATV carries the tongue');
  // pulling away the ball pulls back about (trailer mass x acceleration + its rolling resistance); braking it pushes
  const { b, t } = rig(FLAT, 200);
  let pull = 0, a = 0;
  run(b, ATV, { throttle: 0.5 }, FLAT, 2, t, (q, s) => { if (s > 1.5) { pull = q.hitch[0]; a = q.ax; } });
  const want = -((TR.massKg + 200) * a + TR.grip.rolling * ((TR.massKg + 200) * GRAV - t.body.tongue));
  assert.ok(pull < 0, 'pulls: ' + pull);
  near(pull, want, Math.abs(want) * 0.15, 'the pull');
  let push = 0;
  run(b, ATV, { brake: 0.8 }, FLAT, 0.6, t, (q) => { push = Math.max(push, q.hitch[0]); });
  assert.ok(push > (TR.massKg + 200) * 3, 'an unbraked trailer pushes on the ball when the ATV brakes: ' + push);
});

// a short steering pulse at a steady speed, then straight: how the articulation's swings die away. ratio: the swing a
// whole cycle later against the first (under 1 it settles; over 1 it grows), lost: it swayed into the stop or spun.
function sway(v, loadKg, cargoZ, K = BARE) {
  const { b, t } = rig(FLAT, loadKg, { cargoZ });
  run(b, K, (q) => ({ throttle: q.u < v ? 1 : 0 }), FLAT, 14, t);
  const peaks = [];
  let last = 0, dir = 0, lost = false;
  run(b, K, (q, s) => ({ throttle: q.u < v ? 0.6 : 0, steer: s < 0.25 ? 0.35 : 0 }), FLAT, 8, t, (q, s) => {
    const a = t.body.artic, d = Math.sign(a - last);
    if (s > 0.3 && d && dir && d !== dir) peaks.push(Math.abs(last));
    if (d) dir = d;
    last = a;
    lost = lost || Math.abs(a) > 1;
  });
  return { ratio: peaks.length > 3 ? peaks[3] / peaks[1] : 0, lost, peaks };
}
test('trailer sway: well loaded it settles at speed; load over or behind the axle sways above a speed, sooner further back', () => {
  const settles = (r) => !r.lost && r.ratio < 0.3, sways = (r) => r.lost || r.ratio > 1;
  // as loaded (about 12 percent of its gross on the ball): settles at every speed up to the ATV's governed 18 m/s
  for (const v of [8, 14, 18]) { const r = sway(v, 350, null); assert.ok(settles(r), `as loaded, ${v} m/s: ${JSON.stringify(r)}`); }
  // over the axle (2 percent on the ball): settles slowly, the damping falls with speed, it sways at the top speed
  const o8 = sway(8, 350, 0), o14 = sway(14, 350, 0), o18 = sway(18, 350, 0);
  assert.ok(settles(o8) && o14.ratio > o8.ratio && !o14.lost, `over the axle, 8 and 14 m/s: ${o8.ratio} ${o14.ratio}`);
  assert.ok(sways(o18), 'over the axle at 18 m/s sways: ' + JSON.stringify(o18));
  // behind the axle (the ball lifted): settles at 6 m/s, sways already at 12
  const b6 = sway(6, 350, -0.2), b12 = sway(12, 350, -0.2);
  assert.ok(settles(b6), 'behind, 6 m/s: ' + JSON.stringify(b6));
  assert.ok(sways(b12), 'behind the axle at 12 m/s sways: ' + JSON.stringify(b12));
  // the rider's yaw assist (ATV.assist) holds the tow unit to its steered arc, which damps the sway it can feel: over the
  // axle it now settles at the top speed; far behind it still sways, only later
  const a18 = sway(18, 350, 0, ATV), ab12 = sway(12, 350, -0.2, ATV);
  assert.ok(settles(a18), 'with the assist, over the axle at 18 m/s settles: ' + JSON.stringify(a18));
  assert.ok(!ab12.lost && ab12.ratio < b12.ratio, 'with the assist, behind the axle at 12 m/s sways less: ' + JSON.stringify(ab12));
});

test('downhill turn: a loaded unbraked trailer pushes the ATV round (jackknife) where the ATV alone, or empty, holds its line', () => {
  const env = { ground: (x, z) => -z * Math.tan(rad(10)), surface: () => VEHICLE_SURFACES.grass };
  const go = (kg, K = BARE) => {
    let b, t = null;
    if (kg == null) { b = createBody(K, { fuelL: 10 }, env); b.cargoKg = K.riderKg; }
    else ({ b, t } = rig(env, kg));
    run(b, K, (q) => ({ throttle: q.u < 7 ? 1 : 0 }), env, 2, t);
    let slip = 0, artic = 0, jack = false;
    run(b, K, { brake: 0.1, steer: 0.3 }, env, 4, t, (q) => { slip = Math.max(slip, q.slip); artic = Math.max(artic, t ? Math.abs(t.body.artic) : 0); jack = jack || q.jack; });
    return { slip, artic, jack };
  };
  const solo = go(null), empty = go(0), full = go(350);
  assert.ok(solo.slip < 0.5 && empty.slip < 0.5 && empty.artic < 0.4, `solo ${solo.slip}, empty ${JSON.stringify(empty)}`);
  assert.ok(full.slip > 2 && full.artic > ARTIC_MAX - 0.01 && full.jack, 'loaded: ' + JSON.stringify(full));
  // with the rider's yaw assist the loaded rig holds that line (a game's trailer stability, not the physics above)
  const held = go(350, ATV);
  assert.ok(!held.jack && held.artic < 0.5, 'loaded, with the assist: ' + JSON.stringify(held));
});

test('the rig is deterministic and the rider (heading steer) keeps a loaded rig on its line in an ordinary turn', () => {
  const drive = () => {
    const { b, t } = rig({ ground: (x, z) => 0.1 * Math.sin(x * 0.3) + 0.08 * Math.cos(z * 0.2) }, 250);
    run(b, ATV, (q, s) => headingControl(q, ATV, Math.sin(s * 0.4), Math.cos(s * 0.4)), { ground: (x, z) => 0.1 * Math.sin(x * 0.3) + 0.08 * Math.cos(z * 0.2) }, 12, t);
    return { b, t };
  };
  const a = drive(), c = drive();
  assert.equal(hashState(a.b), hashState(c.b));
  assert.equal(hashState(a.t.body), hashState(c.t.body));
  assert.ok(a.b.distM > 30 && Math.abs(a.t.body.artic) < 1, 'went round: ' + a.b.distM + ' ' + a.t.body.artic);
  assert.ok(a.b.slip < 1 && a.t.body.slip < 1, 'no slide: ' + a.b.slip + ' ' + a.t.body.slip);
});
