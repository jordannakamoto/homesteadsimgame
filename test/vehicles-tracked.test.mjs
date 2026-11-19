// The drive model's tracks (wave 2, G-3), proven on a non-homestead fixture: a small tank sized like a compact track
// loader (Cat 259D class: 4013 kg operating, 55 kW, 14 km/h, 1.50 m of track on the ground, 320 mm tracks, 1.68 m
// wide so a 1.36 m gauge, about 6 psi on the ground). Skid steer: two hydrostatic belts, pivot turns, sideways scrub by
// surface, track slip. The future skid steer, excavator and bulldozer run on this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBody, stepBody, headingControl, SUB, GRAV, wrap } from '../src/sim/core/vehicles-drive.js';
import { hashState } from '../src/sim/index.js';

const TANK = Object.freeze({
  id: 'small_tank', name: 'Small tank', drive: 'tracked', dims: { l: 2.9, w: 1.68, h: 2.1 }, massKg: 4013, cgH: 0.7,
  wheelbase: 1.5, contactL: 1.5, track: 1.36, trackW: 0.32, wheelR: 0.3, axles: [],
  powerW: 55000, topMps: 3.9, reverseMps: 3.9, brakeG: 0.6, pivotRadS: 1.5, trackAccel: 2.5,
  grip: { mu: 0.9, scrub: 0.5, rolling: 0.08 }, susp: { travel: 0.04, hz: 2.5, damp: 0.7 },
  seats: [{ id: 'driver', at: [0, 1.2, -0.2], pose: 'sit', mount: [] }], points: [], hitch: null, cargo: null, fuel: null, look: 'box',
});
// track figures: traction (mu) and sideways scrub (scrub) multipliers, rolling resistance
const SURF = {
  dirt: { mu: 1.1, roll: 0.75, scrub: 1 },
  concrete: { mu: 1.1, roll: 0.5, scrub: 1.8 },     // rubber on concrete: grips, and scrubs hard when turning
  sand: { mu: 0.9, roll: 1.6, scrub: 0.6 },
  mud: { mu: 0.45, roll: 2.6, scrub: 0.8 },
};
const on = (s, ground = () => 0) => ({ ground, surface: typeof s === 'function' ? s : () => SURF[s] });
const FLAT = on('dirt');
const run = (b, input, env, secs, each) => {
  for (let i = 0; i < Math.round(secs / SUB); i++) { stepBody(b, TANK, typeof input === 'function' ? input(b, i * SUB) : input, env); if (each) each(b, i * SUB); }
  return b;
};
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const rad = (d) => (d * Math.PI) / 180;
const circle = (pts) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
};

test('tracks: the fixture matches its published ground pressure; it runs at its belt speed both ways with little slip', () => {
  const kPa = (TANK.massKg * GRAV) / (2 * TANK.trackW * TANK.contactL) / 1000;
  near(kPa, 41.4, 1.5, 'about 6 psi');
  const b = run(createBody(TANK, {}, FLAT), { throttle: 1 }, FLAT, 5);
  near(b.u, TANK.topMps, 0.05, 'forward');
  assert.ok(Math.abs(b.tslip[0]) < 0.03 && Math.abs(b.tslip[1]) < 0.03, 'slip ' + b.tslip);
  near(b.load.reduce((s, v) => s + v, 0), TANK.massKg * GRAV, 1, 'its weight on the tracks');
  const r = run(createBody(TANK, {}, FLAT), { throttle: -1 }, FLAT, 5);
  near(r.u, -TANK.reverseMps, 0.05, 'reverse');
  const l = run(createBody(TANK, {}, FLAT), { tracks: [0.5, 0.5] }, FLAT, 4);
  near(l.u, TANK.topMps / 2, 0.05, 'two levers at half');
});

test('tracks: counter-rotating pivots on the spot; high-scrub ground costs power and turns slower, mud slips the tracks', () => {
  const pivot = (s) => { const b = createBody(TANK, {}, on(s)); run(b, { tracks: [1, -1] }, on(s), 3); return b; };
  const dirt = pivot('dirt'), conc = pivot('concrete'), mud = pivot('mud');
  const kin = (2 * TANK.topMps) / TANK.track;
  assert.ok(Math.hypot(dirt.x, dirt.z) < 0.02, 'stays on the spot: ' + Math.hypot(dirt.x, dirt.z));
  assert.ok(dirt.r > kin * 0.85 && dirt.r < kin, `dirt: ${dirt.r} of ${kin} rad/s`);
  assert.ok(conc.r < dirt.r * 0.8 && Math.abs(conc.belt[0]) < TANK.topMps * 0.8, `concrete: ${conc.r}, belts held back to ${conc.belt[0]}`);
  assert.ok(Math.abs(conc.tslip[0]) < 0.2, 'concrete grips, the drive is what gives: ' + conc.tslip);
  assert.ok(Math.abs(mud.tslip[0]) > 0.5 && mud.r < dirt.r * 0.85, `mud slips: ${mud.tslip} at ${mud.r}`);
  // the steer input pivots it the same way at the record's pivot rate
  const s = run(createBody(TANK, {}, FLAT), { steer: 1 }, FLAT, 2);
  near(s.r, TANK.pivotRadS, 0.1, 'steer 1 pivots at pivotRadS');
  assert.ok(Math.hypot(s.x, s.z) < 0.02);
});

test('tracks: a moving turn follows the belt speeds on easy ground and runs wide on high-scrub ground', () => {
  const turn = (s) => {
    const b = createBody(TANK, {}, on(s)), pts = [];
    run(b, { tracks: [1, 0.5] }, on(s), 5);
    run(b, { tracks: [1, 0.5] }, on(s), 12, (q) => pts.push([q.x, q.z]));
    return { R: circle(pts), u: b.u };
  };
  const kin = ((TANK.track / 2) * (1 + 0.5)) / (1 - 0.5);
  const dirt = turn('dirt'), conc = turn('concrete');
  assert.ok(Math.abs(dirt.R - kin) / kin < 0.1, `dirt ${dirt.R} vs ${kin}`);
  assert.ok(conc.R > kin * 1.5 && conc.u < dirt.u, `concrete ${conc.R} at ${conc.u} m/s`);
});

test('tracks: climbs 30 degrees of dirt; mud spins the tracks and it gets nowhere; holds on a slope with the levers centred', () => {
  const climb = (deg, s) => { const g = (x, z) => Math.max(0, z - 1) * Math.tan(rad(deg)), b = createBody(TANK, {}, on(s, g)); run(b, { throttle: 1 }, on(s, g), 8); return b; };
  const d30 = climb(30, 'dirt'), m20 = climb(20, 'mud');
  assert.ok(d30.z > 15 && d30.u > 2, 'dirt 30: ' + d30.z + ' ' + d30.u);
  assert.ok(m20.z < 3 && m20.tslip[0] > 2, 'mud 20 spins: ' + m20.z + ' ' + m20.tslip);
  const g = (x, z) => z * Math.tan(rad(20)), h = run(createBody(TANK, {}, on('dirt', g)), {}, on('dirt', g), 4);
  assert.ok(Math.abs(h.z) < 0.03, 'held: ' + h.z);
});

test('tracks: a side slope within the scrub angle holds; past it the machine slides sideways downhill', () => {
  const side = (deg) => { const g = (x) => x * Math.tan(rad(deg)), b = createBody(TANK, {}, on('dirt', g)); run(b, {}, on('dirt', g), 3); return b; };
  const ok = side(15), steep = side(30);
  assert.ok(Math.abs(ok.x) < 0.01, '15 degrees holds: ' + ok.x);
  assert.ok(steep.x < -1, '30 degrees slides downhill: ' + steep.x);
  near(ok.tip, (Math.tan(rad(15)) * 2 * TANK.cgH) / TANK.track, 0.03, 'tip on the side slope');
});

test('tracks: one track in mud on a climb slips and the machine veers toward it', () => {
  const g = (x, z) => z * Math.tan(rad(15)), env = { ground: g, surface: (x) => (x < 0 ? SURF.mud : SURF.dirt) };
  const b = run(createBody(TANK, {}, env), { throttle: 1 }, env, 6);
  assert.ok(b.tslip[0] > b.tslip[1] + 0.3, 'left (mud) slips more: ' + b.tslip);
  assert.ok(wrap(b.yaw) < -0.01, 'turns left, toward the mud: ' + b.yaw);
});

test('tracks: heading steer slows to turn and gets there; same inputs give the same state', () => {
  const b = createBody(TANK, {}, FLAT);
  run(b, (q) => headingControl(q, TANK, 1, 0), FLAT, 4);
  assert.ok(Math.abs(wrap(b.yaw - Math.PI / 2)) < 0.15 && b.u > 1, 'heads where pushed: ' + b.yaw + ' ' + b.u);
  const drive = () => run(createBody(TANK, {}, FLAT), (q, t) => ({ tracks: [Math.sin(t), Math.cos(t * 0.7)] }), FLAT, 6);
  assert.equal(hashState(drive()), hashState(drive()));
});
