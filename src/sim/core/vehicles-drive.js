// The drive model: how a wheeled, tracked or towed body moves over a ground that exists only as a function you sample.
// Generic and pure (no DOM, no three.js, no game words): a vehicle record in, behaviour out. The page steps it at a fixed
// 1/120 s of real time (stepBody); the simulation never integrates it, it only receives the pose by command
// (src/sim/core/vehicles.js). Every feel parameter is a record field (docs: the kind record in ARCHITECTURE.md).
//
// Frame: a body at yaw faces F = (sin yaw, cos yaw) in (x, z), the engine's convention (facing = atan2(dx, dz)).
// R = (cos yaw, -sin yaw) is the body's local +x: a positive yaw rate turns the nose toward R, positive steer turns that
// way. "Right" and "left" in this file (wheel names, roll) are along R, but in the engine's y-up world R is the RIDER'S
// LEFT (a rider facing +z has -x at the right hand; the chase camera sees -R on the right of the screen), so a key for
// the rider's right asks for negative steer (carControl). The physics is mirror-symmetric, so only that mapping cares.
// A rider record (kind.lean = { inM, fwdM, g, climbM, climbRad, s }) shifts the rider's weight into a turn and forward
// up a climb (b.lean, b.leanC); gripSteer(kind, u, mu) is the wheel angle a rider uses at speed; b.towKg the towed mass.
// pitch > 0 is nose up; roll > 0 is the right side up. Local points are [x (along R), y, z (along F)] from the origin,
// which is the middle between the axles at ground height (towed: the middle of its axle).
//
// env = {
//   ground(x, z, yHint) -> height,             required: the one ground read (terrain, shaped ground, built floors)
//   surface?(x, z) -> { mu, slide?, roll, scrub? }, multipliers on peak grip, rolling resistance and (tracks) the
//                                              sideways scrub; slide: grip while spinning or sliding as a fraction of
//                                              the peak (default grip.slide). Read at each wheel (each track side).
//   water?(x, z) -> depth in metres,           slows, stalls past the axle, a wall when deeper than the body
//   collide?(o, rad),                          moves the circle o = { x, z } out of obstacles (the engine's pushOut)
// }
// input = { throttle: -1..1, steer: -1..1, brake: 0..1, handbrake: bool, tracks?: [left, right] each -1..1 }
//
// Optional powertrain (a kind with `engine` and `gears`; without them, force is simply powerW / speed):
//   engine = { idleRpm, launchRpm, redRpm, torqueNm, curve: [[rpm, k], ...], brakeK, creepMps, creepG }
//   gears  = { ratios: [overall ratio per forward gear], reverse, eff, shiftS, upRpm: [part, full], downRpm }
// An automatic: the clutch slips below launchRpm (so it pulls from rest and creeps at idle), it shifts up by engine speed
// and throttle and down as it slows, the torque dips while it shifts, and lifting off brakes through the engine, harder
// in the low gears. topMps is the speed limiter; reverseMps the reverse limiter. dragK: aerodynamic N per (m/s)^2.
//
// Mass: the empty unit's centre of mass is at local z = cgZ (default 0; a towed unit without cgZ takes hitch.tongueK of
// the tongue length), cgH up. Load (body.cargoKg) sits at body.cargoZ if set, else cargo.loadZ, else the bed's middle,
// else the first seat (a rider). izz: yaw inertia of the empty unit (default a box of dims). These give the static
// weight on each axle and on a towed unit's ball (its tongue weight), and the yaw inertia the tyres must turn.
//
// Wheel loads (b.load: front left, front right, rear left, rear right, newtons): the static share by the centre of mass,
// the tongue weight on the ball, longitudinal transfer (acceleration and the slope, cgH / wheelbase, plus the hitch's
// pull at ball height) and lateral transfer (cornering and the cross-slope, cgH / track, the hitch's side force on the
// rear axle). A wheel never pulls: past zero load it lifts. b.tip is the lateral transfer as a fraction of what would
// lift the uphill or inside wheels (past 1 it would roll over).
// Tyres: each wheel's peak grip is mu x load, less as the load rises above nominal (grip.loadSens per unit of relative
// load, default 0.1: grip grows more slowly than load, so transfer costs an axle grip; grip.loadN the nominal load).
// Past the peak the wheel spins or locks and gives grip.slide of it. Each wheel has one friction circle shared by
// driving or braking and cornering. Axles: diff 'open' (an open differential: both wheels get the same force, so the
// lighter one sets the axle's limit) or 'locked' (default; a solid axle). Brakes act on every wheel in proportion to its
// load; the handbrake on the rear axle. Cornering: a tyre's side force grows with its slip angle (grip.lateral, newtons
// per newton of load per radian of slip, the cornering stiffness) up to what its circle leaves; the steered front and
// the rear each carry their share, so the front running out washes the nose wide (understeer) and the rear running out
// (power on, the handbrake, a pushing trailer) swings the tail (oversteer). Velocities and yaw rate are solved together
// with the hitch (a few Gauss-Seidel passes over the tyre, ball and stop constraints, implicit tyre damping, so it is
// stable at any speed and exact at a crawl).
// Tracks (drive 'tracked'): each side is a hydrostatic drive holding its belt at a commanded speed (throttle and steer,
// or input.tracks for two levers); the ground takes the belt's pull through shear (trackK, the shear deformation
// modulus in metres, default 0.025: slip grows with pull) up to mu x the side's load, and the drive's own limit
// (powerW split between the sides, trackForceN). Turning drags the tracks sideways: a lateral resistance moment of
// scrub x weight x contactL / 4 (grip.scrub, default 0.5, times the surface's scrub) that the outer track must out-pull,
// so pivots and tight turns cost power, slip the tracks and turn wider on high-scrub ground. b.belt, b.tslip per side.
// Towed units (trailer = { body, kind }): a rigid body on the ball (a point joint) with its own axle (cornering and
// rolling resistance) and inertia; the hitch force goes both ways (b.hitch = [along F, along R] newtons on the tow unit),
// so a loaded unbraked trailer pushes on a downhill stop and shoves the tail out in a turn, a trailer with little tongue
// weight or its load behind the axle sways above a speed, and the 75 degree stop is a hard joint limit (b.jack).
// Rider assists (kind.assist, optional, wheeled only; feel over the textbook, kept inside the tyres' grip):
//   yaw: 1/s, how fast the yaw rate is pulled toward the arc the front wheels point along (u tan(steer) / wheelbase),
//        never past yawG (default 1) of what the side grip the tyres have left (after driving or braking) turns at this
//        speed (side grip / mass / u), so it never turns the nose faster than the path can follow; a moment the solver
//        balances with the tyres and the hitch, so it turns in at once and holds the steered circle instead of the
//        solid axle's push and the tyres' lag. Off in the air and while the front wheels are locked. It comes in from
//        fromMps to full at fullMps (default from rest), so at a walk the tyres alone turn the machine's real circle.
//        Towing, the arc it asks for is held to the grip x M / (M + towK x towed mass) (towK default 1); its moment to
//        yawM (default 0.3) x grip x weight x wheelbase, so a hard shove (a heavy trailer pushing downhill) still wins.
//   abs: true, the brakes are held at each wheel's peak instead of locking it, so the front still steers while braking
//        and it stops at the peak grip rather than the sliding grip.
// Exposed for the page: rpm, gear, spin (0..1, wheels spinning or locked), slip (m/s, the rear tyres sliding sideways:
// a drift), plow (the front tyres), tip, load, hitch, belt, tslip, bump, land.

export const SUB = 1 / 120;                     // the fixed substep, seconds of real time
export const GRAV = 9.81;
export const ARTIC_MAX = (75 * Math.PI) / 180;  // a towed unit's stop against its tow unit
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ABS_K = 0.95;                              // an anti-lock brake holds a wheel at this share of its peak
const ITER = 8;                                  // solver passes per substep
const U0 = 0.3;                                  // m/s: below this a tyre's slip angle is taken against this speed (a floor
                                                 // for the solver only: at 1 m/s it softened the tyres at a crawl, so a
                                                 // solid axle's scrub pushed the turn wider the slower it went)

// ---------------------------------------------------------------- geometry
// local [lx, lz] -> world, written into out
export function toWorld(p, lx, lz, out = {}) {
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  out.x = p.x + lx * c + lz * s;
  out.z = p.z - lx * s + lz * c;
  return out;
}
const pointOf = (kind, type) => (kind.points || []).find((q) => q.type === type) || null;
// where a tow unit's point of this type is in the world (the ball a trailer hangs on)
export function towPoint(pose, kind, type, out = {}) {
  const pt = pointOf(kind, type);
  if (!pt) return null;
  return toWorld(pose, pt.at[0], pt.at[2], out);
}
// the pose of a towed unit hanging on a tow unit at this articulation angle (artic = towed yaw - tow yaw)
export function hitchPose(towPose, towKind, towedKind, artic = 0) {
  const ball = towPoint(towPose, towKind, towedKind.hitch.type);
  if (!ball) return null;
  const yaw = wrap(towPose.yaw + clamp(artic, -ARTIC_MAX, ARTIC_MAX)), Lh = towedKind.hitch.at[2];
  return { x: ball.x - Math.sin(yaw) * Lh, z: ball.z - Math.cos(yaw) * Lh, yaw };
}

// What a kind is, worked out once: the four ground probes, [lx, lz] front left, front right, rear left, rear right
// (wheeled: the wheels; tracked: the corners of the contact patch, contactL long, or the wheelbase), the axles front
// and rear, the empty unit's mass properties and the nominal tyre load.
const DER = new WeakMap();
function derOf(kind) {
  let d = DER.get(kind);
  if (d) return d;
  const hw = kind.track / 2, tracked = kind.drive === 'tracked', towed = kind.drive === 'towed';
  let zf, zr;
  if (tracked) { const l = kind.contactL || kind.wheelbase; zf = l / 2; zr = -l / 2; }
  else { const zs = (kind.axles || [{ z: kind.wheelbase / 2 }, { z: -kind.wheelbase / 2 }]).map((a) => a.z); zf = Math.max(...zs); zr = Math.min(...zs); }
  if (zf - zr < 0.2) { zf += 0.15; zr -= 0.15; }
  const axles = kind.axles || [];
  const fa = axles.find((a) => a.z === Math.max(...axles.map((q) => q.z))) || { steer: true, driven: true };
  const ra = axles.find((a) => a.z === Math.min(...axles.map((q) => q.z))) || { steer: false, driven: true };
  const Lh = towed && kind.hitch ? kind.hitch.at[2] : 0;
  const cgZ = kind.cgZ != null ? kind.cgZ : towed ? ((kind.hitch && kind.hitch.tongueK) || 0) * Lh : 0;
  const c = kind.cargo, seat = (kind.seats || [])[0];
  const loadAt = c ? [c.loadZ != null ? c.loadZ : c.bed.at[2], c.bed.at[1] + c.bed.h / 2] : seat ? [seat.at[2], seat.at[1]] : [cgZ, kind.cgH];
  const sl = c ? c.bed.l : 0, sw = c ? c.bed.w : 0;
  d = {
    pts: [[-hw, zf], [hw, zf], [-hw, zr], [hw, zr]], len: zf - zr, track: kind.track, zf, zr,
    steerF: !!fa.steer, steerR: !!ra.steer && axles.length > 1, drvF: tracked || !!fa.driven, drvR: tracked || !!ra.driven,
    openF: fa.diff === 'open', openR: ra.diff === 'open', single: axles.length === 1,
    cgZ, loadAt, loadI: (sl * sl + sw * sw) / 12, Lh,
    izz: kind.izz != null ? kind.izz : (kind.massKg * ((c ? Math.max(sl, kind.dims.l - Lh) : kind.dims.l) ** 2 + kind.dims.w ** 2)) / 12,
    N0: (kind.grip.loadN || ((kind.massKg + (kind.riderKg || 0)) * GRAV) / (axles.length === 1 ? 2 : 4)),
    ls: kind.grip.loadSens != null ? kind.grip.loadSens : 0.1,
    lean: kind.lean && !c && seat && !tracked && !towed ? kind.lean : null,   // a rider on the seat who shifts in a turn
  };
  DER.set(kind, d);
  return d;
}
// the unit with its load: mass, where its centre of mass is (z, height) and its yaw inertia about it
function massOf(kind, b, D, out) {
  const m = kind.massKg, c = b.cargoKg > 0 ? b.cargoKg : 0, M = m + c;
  const cz = (b.cargoZ != null ? b.cargoZ : D.loadAt[0]) + (D.lean ? Math.max(D.lean.fwdM * Math.abs(b.lean || 0), (D.lean.climbM || 0) * (b.leanC || 0)) : 0);
  const z = (m * D.cgZ + c * cz) / M, y = (m * kind.cgH + c * D.loadAt[1]) / M;
  out.M = M; out.z = z; out.y = y;
  out.I = D.izz + m * (D.cgZ - z) ** 2 + c * (D.loadI + (cz - z) ** 2);
  return out;
}
// A tyre's peak grip at this load: mu x load, the coefficient falling as the load rises past nominal (load
// sensitivity; published tyre data: doubling the load cuts the peak coefficient by about a tenth).
export function tyreGrip(mu, N, N0, ls = 0.1) {
  return N > 0 ? mu * N * clamp(1 - ls * (N / N0 - 1), 0.4, 1 + ls) : 0;
}
// Quadratic drag that makes full power balance rolling resistance and drag exactly at topMps on the flat.
const DRAG = new WeakMap();
function dragOf(kind) {
  let d = DRAG.get(kind);
  if (d === undefined) {
    const top = kind.topMps || 1;
    d = kind.dragK != null ? kind.dragK : Math.max(0.05, ((kind.powerW || 0) / top - (kind.grip.rolling || 0) * kind.massKg * GRAV) / (top * top));
    DRAG.set(kind, d);
  }
  return d;
}
// How far the front wheels may turn at this speed. Moving, the lock falls from steerMaxRad at rest toward
// steerMaxRad x (1 - steerSpeedFalloff) at topMps (what a rider uses at speed). steerLockRad, if set, is the steering's
// mechanical stop, reached at a crawl (below steerLockMps, default 2 m/s; blended into the moving line by twice that):
// parking and tight turns at a walk use all of it.
export function steerLimit(kind, u) {
  const a = Math.abs(u), line = kind.steerMaxRad * (1 - (kind.steerSpeedFalloff || 0) * Math.min(1, a / kind.topMps));
  const lock = kind.steerLockRad;
  if (!(lock > line)) return line;
  const v0 = kind.steerLockMps || 2, w = clamp((a - v0) / v0, 0, 1);
  return lock + (line - lock) * w * w * (3 - 2 * w);
}
// The front wheel angle that asks the tyres for about all their grip at this speed, on ground of grip mu (b.mu): the
// kinematic angle of the tightest circle the grip holds (wheelbase x 0.9 mu g / u^2) plus the slip angle the tyres run
// at near their peak (half of mu over the cornering stiffness: the front's less the rear's). More lock than this at
// speed only slides the front tyres (the front plows and the circle grows); a rider at speed steers about this much.
// Measured on the ATV (dry grass, speed held): the tightest steady circle comes at 16, 9, 5-6 and 4 degrees at 5, 8,
// 12 and 15 m/s; this gives 19, 9.6, 5.3 and 4.2.
export function gripSteer(kind, u, mu = kind.grip.mu) {
  const L = kind.wheelbase || 1, u2 = Math.max(u * u, 1e-6);
  return Math.atan((L * 0.9 * mu * GRAV) / u2) + (0.5 * mu) / (kind.grip.lateral || 8);
}
const susp = (kind) => kind.susp || { travel: 0.15, hz: 2, damp: 0.4 };
const RPM = 60 / (2 * Math.PI);
function curveAt(c, rpm) {                       // piecewise-linear torque curve, fraction of torqueNm
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (rpm <= c[i][0]) { const a = c[i - 1], b = c[i]; return a[1] + ((b[1] - a[1]) * (rpm - a[0])) / (b[0] - a[0]); }
  return c[c.length - 1][1];
}
// The automatic powertrain: the wheel force from the engine (drive, engine braking, creep) before the tyres limit it.
function engineForce(b, kind, th, brake, M, dt) {
  const e = kind.engine, g = kind.gears, r = kind.wheelR, a = Math.abs(th);
  const want = th > 0.02 ? 1 : th < -0.02 ? -1 : 0;
  if (!b.gear) b.gear = 1;
  if (want && Math.sign(b.gear) !== want) {          // into reverse or back to drive only when nearly stopped
    if (Math.abs(b.u) > 0.6) { b.rpm = e.idleRpm; return 0; }
    b.gear = want; b.shiftT = g.shiftS;
  }
  const dir = Math.sign(b.gear), ratio = dir > 0 ? g.ratios[b.gear - 1] : g.reverse;
  const wheelRpm = (Math.max(0, b.u * dir) / r) * ratio * RPM;
  const pulling = want === dir;
  const rpm = Math.max(wheelRpm, e.idleRpm + (e.launchRpm - e.idleRpm) * (pulling ? a : 0));
  b.rpm += (rpm - b.rpm) * Math.min(1, 12 * dt);
  let T = pulling ? e.torqueNm * curveAt(e.curve, rpm) * a : 0;
  if (rpm > e.redRpm) T *= Math.max(0, 1 - (rpm - e.redRpm) / 150);          // the rev limiter
  const lim = dir > 0 ? kind.topMps : kind.reverseMps, v = b.u * dir;
  if (v > lim - 0.5) T *= clamp((lim - v) / 0.5, 0, 1);                        // the speed limiter
  if (b.shiftT > 0) { b.shiftT -= dt; T *= 0.25; }
  let F = (dir * T * ratio * g.eff) / r;
  if (wheelRpm > e.idleRpm && a < 0.05) {            // lifted off with the clutch in: the engine holds it back
    const x = Math.min(1, (wheelRpm - e.idleRpm) / (e.redRpm - e.idleRpm));
    F -= (dir * e.torqueNm * e.brakeK * (0.3 + 0.7 * x) * ratio) / r;
  }
  if (a < 0.05 && !(brake > 0) && e.creepMps && wheelRpm < e.idleRpm * 1.05) F += dir * (e.creepG || 0.05) * M * GRAV * clamp(1 - v / e.creepMps, 0, 1);
  if (dir > 0 && b.shiftT <= 0) {                    // the automatic: up by engine speed and throttle, down as it slows
    const n = g.ratios.length, up = g.upRpm[0] + (g.upRpm[1] - g.upRpm[0]) * a;
    const lower = b.gear > 1 ? (wheelRpm * g.ratios[b.gear - 2]) / ratio : Infinity;
    if (wheelRpm > up && b.gear < n) { b.gear++; b.shiftT = g.shiftS; }
    else if (b.gear > 1 && (wheelRpm < g.downRpm || (a > 0.8 && lower < up * 0.8))) { b.gear--; b.shiftT = g.shiftS * 0.6; }
  }
  return F;
}

// ---------------------------------------------------------------- the body
export function createBody(kind, { x = 0, z = 0, yaw = 0, fuelL = Infinity, cargoKg = 0 } = {}, env = null) {
  const b = {
    x, z, yaw, u: 0, w: 0, r: 0,
    y: 0, vy: 0, gy: 0, pitch: 0, vp: 0, roll: 0, vr: 0,
    steer: 0, air: false, contact: [0, 0, 0, 0], sF0: 0.5, jack: false, lean: 0, leanC: 0, towKg: 0,
    ax: 0, ay: 0, slip: 0, plow: 0, mu: kind.grip.mu, bump: 0, land: 0, stalled: null, rev: false, artic: 0, ra: 0,
    gear: 1, rpm: kind.engine ? kind.engine.idleRpm : 0, shiftT: 0, spin: 0, spinning: false, tip: 0,
    load: [0, 0, 0, 0], fy: [0, 0], hitch: [0, 0], tongue: 0, belt: [0, 0], tslip: [0, 0], cargoZ: null, jackHold: false,
    fuelL, cargoKg, burnedL: 0, distM: 0, engineS: 0,
  };
  if (env) settle(b, kind, env);
  return b;
}

// Put a body at rest on the ground under it (on spawn, on load, after it was moved by hand).
export function settle(b, kind, env) {
  const t = targets(b, kind, env);
  b.y = b.gy = t.y; b.vy = 0; b.pitch = t.pitch; b.vp = 0; b.roll = t.roll; b.vr = 0; b.air = false;
  return b;
}

const _o = { x: 0, z: 0 };
const _t = { y: 0, pitch: 0, roll: 0, sinLong: 0, sinLat: 0 };
function targets(b, kind, env) {
  const P = derOf(kind), h = b.contact;
  for (let i = 0; i < 4; i++) {
    toWorld(b, P.pts[i][0], P.pts[i][1], _o);
    h[i] = env.ground(_o.x, _o.z, b.y + 0.6);
  }
  const hF = (h[0] + h[1]) / 2, hR = (h[2] + h[3]) / 2, hL = (h[0] + h[2]) / 2, hRt = (h[1] + h[3]) / 2;
  _t.y = (hF + hR) / 2; _t.pitch = Math.atan((hF - hR) / P.len); _t.roll = Math.atan((hRt - hL) / P.track);
  _t.sinLong = (hF - hR) / Math.hypot(P.len, hF - hR); _t.sinLat = (hRt - hL) / Math.hypot(P.track, hRt - hL);
  return _t;
}

// Damped heave spring toward the ground. Tyres push, never pull: the support force is never negative, and past the
// static sag the wheels droop and the body falls freely. Returns kc, how much the wheels touch (0..1), for traction.
function heave(b, s, tgtY, dt) {
  const om = 2 * Math.PI * s.hz, c0 = GRAV / (om * om);
  const tgtV = (tgtY - b.gy) / dt;
  b.gy = tgtY;
  const d = b.y - tgtY;
  const support = d < c0 ? Math.max(0, om * om * (c0 - d) - 2 * s.damp * om * (b.vy - tgtV)) : 0;
  const wasAir = b.air;
  b.vy += (support - GRAV) * dt;
  b.y += b.vy * dt;
  let d2 = b.y - tgtY;
  if (d2 < -s.travel) {                                  // bottomed out: the stop takes it
    const hit = tgtV - b.vy;
    b.y = tgtY - s.travel; b.vy = Math.max(b.vy, tgtV); d2 = -s.travel;
    if (hit > 1.5) b.land = Math.max(b.land, hit);
  }
  b.air = d2 > c0 + s.travel;
  if (wasAir && !b.air) b.land = Math.max(b.land, Math.max(0, tgtV - b.vy) + 0.5);
  return d2 <= c0 ? 1 : clamp(1 - (d2 - c0) / s.travel, 0, 1);
}
function angSpring(v, vv, tgt, s, kc, dt) {
  const om = 2 * Math.PI * s.hz;
  if (kc <= 0) return [v + vv * dt, vv * Math.exp(-0.5 * dt)];
  vv += (om * om * (tgt - v) - 2 * s.damp * om * vv) * kc * dt;
  return [v + vv * dt, vv];
}

// ---------------------------------------------------------------- the constraint solver
// Two planar rigid bodies at most (0: the driven unit, 1: what it tows), velocities in the world at the centre of mass.
// A point's velocity is v + r perp(arm), perp(x, z) = (z, -x) (it turns F into R); an impulse J at an arm adds J / M to
// v and perp(arm) . J / I to r. A row holds one direction at one point toward a target velocity, with compliance c
// (an implicit damper: the impulse it gives is -(velocity after) / c, so a tyre's side force is -k v with
// k = cornering stiffness x load / speed) and its accumulated impulse clamped to [lo, hi] (a Coulomb limit).
const RB = [{ vx: 0, vz: 0, r: 0, im: 0, ii: 0 }, { vx: 0, vz: 0, r: 0, im: 0, ii: 0 }];
const ROWS = [];
for (let i = 0; i < 12; i++) ROWS.push({ b: 0, ax: 0, az: 0, nx: 0, nz: 0, pn: 0, ang: false, tgt: 0, c: 0, k: 0, lo: 0, hi: 0, acc: 0, grip: 0, drive: 0 });
let nRows = 0;
function row(bi, ax, az, nx, nz, tgt, c, lo, hi) {
  const q = ROWS[nRows++], B = RB[bi];
  q.b = bi; q.ax = ax; q.az = az; q.nx = nx; q.nz = nz; q.ang = false; q.tgt = tgt; q.c = c; q.lo = lo; q.hi = hi; q.acc = 0;
  q.pn = az * nx - ax * nz;
  q.k = 1 / (B.im + B.ii * q.pn * q.pn + c);
  return q;
}
function angRow(bi, tgt, lo, hi, c = 0) {               // a moment toward a yaw rate (tracks' turning resistance, a solid axle)
  const q = ROWS[nRows++], B = RB[bi];
  q.b = bi; q.ang = true; q.tgt = tgt; q.c = c; q.lo = lo; q.hi = hi; q.acc = 0; q.k = 1 / (B.ii + c);
  return q;
}
function solveRow(q) {
  const B = RB[q.b];
  const v = q.ang ? B.r : B.vx * q.nx + B.vz * q.nz + B.r * q.pn;
  let d = -(v - q.tgt + q.c * q.acc) * q.k;
  const a0 = q.acc;
  q.acc = clamp(a0 + d, q.lo, q.hi); d = q.acc - a0;
  if (q.ang) { B.r += d * B.ii; return; }
  B.vx += d * q.nx * B.im; B.vz += d * q.nz * B.im; B.r += d * q.pn * B.ii;
}
// the ball: tow arm (a1x, a1z), towed arm (a2x, a2z); K = (im1 + im2) I + ii1 p1 p1' + ii2 p2 p2', p = perp(arm)
const BALL = { on: false, p1x: 0, p1z: 0, p2x: 0, p2z: 0, k00: 0, k01: 0, k11: 0, jx: 0, jz: 0, lim: 0, lacc: 0, lk: 0 };
function ballSetup(a1x, a1z, a2x, a2z) {
  const A = RB[0], C = RB[1], j = BALL;
  j.p1x = a1z; j.p1z = -a1x; j.p2x = a2z; j.p2z = -a2x;
  const m = A.im + C.im;
  const K00 = m + A.ii * j.p1x * j.p1x + C.ii * j.p2x * j.p2x, K01 = A.ii * j.p1x * j.p1z + C.ii * j.p2x * j.p2z, K11 = m + A.ii * j.p1z * j.p1z + C.ii * j.p2z * j.p2z;
  const det = K00 * K11 - K01 * K01;
  j.k00 = K11 / det; j.k01 = -K01 / det; j.k11 = K00 / det;
  j.jx = j.jz = 0; j.lacc = 0; j.lk = 1 / (A.ii + C.ii); j.on = true;
}
function ballSolve() {
  const A = RB[0], C = RB[1], j = BALL;
  const dx = A.vx + A.r * j.p1x - (C.vx + C.r * j.p2x), dz = A.vz + A.r * j.p1z - (C.vz + C.r * j.p2z);
  const px = -(j.k00 * dx + j.k01 * dz), pz = -(j.k01 * dx + j.k11 * dz);
  j.jx += px; j.jz += pz;
  A.vx += px * A.im; A.vz += pz * A.im; A.r += (j.p1x * px + j.p1z * pz) * A.ii;
  C.vx -= px * C.im; C.vz -= pz * C.im; C.r -= (j.p2x * px + j.p2z * pz) * C.ii;
  if (j.lim) {                                           // at the stop: no further folding (artic' = r1 - r0)
    const rel = C.r - A.r;
    const a0 = j.lacc;
    j.lacc = j.lim > 0 ? Math.min(0, a0 - rel * j.lk) : Math.max(0, a0 - rel * j.lk);
    const d = j.lacc - a0;
    C.r += d * C.ii; A.r -= d * A.ii;
  }
}

// ---------------------------------------------------------------- one substep
const _m = { M: 0, z: 0, y: 0, I: 0 }, _mt = { M: 0, z: 0, y: 0, I: 0 };
const _s = [null, null, null, null];
const _y = [0, 0, 0, 0], _xu = [0, 0, 0, 0], _cap = [0, 0, 0, 0], _lk = [false, false, false, false];
const NOSURF = { mu: 1, roll: 1 };
// what wheel i can give along its rolling direction for a demand X with its side demand _y[i] (proportional past the circle)
const ach = (i, X) => { const h = Math.hypot(X, _y[i]); return h > _cap[i] ? (_cap[i] * X) / h : X; };
// an axle's pull with nothing asked sideways: an open differential is held to twice its lighter wheel
const pureA = (i, open) => (open ? 2 * Math.min(_cap[i], _cap[i + 1]) : _cap[i] + _cap[i + 1]);
const _b = { x: 0, z: 0 }, _c = { x: 0, z: 0 };

// One substep of a driven body, and of the unit it tows (trailer = { body, kind }) if any.
export function stepBody(b, kind, input, env, dt = SUB, trailer = null) {
  if (kind.drive === 'towed') return b;               // towed units move only through their tow unit
  const D = derOf(kind), s = susp(kind), tracked = kind.drive === 'tracked', g = kind.grip;
  b.bump = 0; b.land = 0;
  const x0 = b.x, z0 = b.z;
  // surfaces at each wheel (each track side: left at 0, right at 1)
  for (let i = 0; i < 4; i++) {
    if (!env.surface) { _s[i] = NOSURF; continue; }
    if (tracked && i > 1) { _s[i] = _s[i - 2]; continue; }
    toWorld(b, tracked ? (i ? D.track / 2 : -D.track / 2) : D.pts[i][0], tracked ? 0 : D.pts[i][1], _o);
    _s[i] = env.surface(_o.x, _o.z) || NOSURF;
  }
  const sRoll = ((_s[0].roll ?? 1) + (_s[1].roll ?? 1) + (_s[2].roll ?? 1) + (_s[3].roll ?? 1)) / 4;

  // 1-2. probes, heave, pitch and roll (the visible weight transfer)
  const t = targets(b, kind, env);
  const sinLong = t.sinLong, sinLat = t.sinLat, tRoll = t.roll, tPitch = t.pitch, tY = t.y;
  const kc = heave(b, s, tY, dt);
  const cosT = Math.sqrt(1 - sinLong * sinLong), cosL = Math.sqrt(1 - sinLat * sinLat);
  const transfer = 0.35;
  [b.pitch, b.vp] = angSpring(b.pitch, b.vp, tPitch + Math.atan((b.ax / GRAV) * kind.cgH / D.len) * transfer, s, kc, dt);
  [b.roll, b.vr] = angSpring(b.roll, b.vr, tRoll + Math.atan((b.ay / GRAV) * kind.cgH / kind.track) * transfer, s, kc, dt);
  b.roll = clamp(b.roll, -0.6, 0.6); b.pitch = clamp(b.pitch, -0.9, 0.9);

  // the rider shifts into the turn (kind.lean): toward the inside as the turn asks for sideways grip, and forward; and
  // forward up a climb (b.leanC 0..1, full at climbRad nose up), to keep weight on the front wheels
  if (D.lean) {
    const want = kc > 0 ? clamp((b.u * b.r) / ((D.lean.g || 0.5) * GRAV), -1, 1) : 0, k = Math.min(1, dt / (D.lean.s || 0.3));
    const wantC = b.u > -0.5 ? clamp(t.sinLong / Math.sin(D.lean.climbRad || 0.26), 0, 1) : 0;
    b.lean = (b.lean || 0) + (want - (b.lean || 0)) * k;
    b.leanC = (b.leanC || 0) + (wantC - (b.leanC || 0)) * k;
  }
  // mass, the trailer's tongue weight
  const m = massOf(kind, b, D, _m), Mo = m.M;
  const tk = trailer && trailer.kind, tb = trailer && trailer.body;
  const pt = tk ? pointOf(kind, tk.hitch.type) : null;
  let T = 0, mt = null, Dt = null;
  if (pt) {
    Dt = derOf(tk); mt = massOf(tk, tb, Dt, _mt);
    T = (mt.M * GRAV * Math.cos(tb.pitch) * mt.z) / Dt.Lh;          // the share of its weight its tongue puts on the ball
    tb.tongue = T;
  }
  b.tongue = T; b.towKg = mt ? mt.M : 0;
  const zb = pt ? pt.at[2] : 0, hb = pt ? pt.at[1] : 0;

  // 3. wheel loads: static share, tongue, longitudinal and lateral transfer, the hitch's pull and side force
  const L = D.len, W = Mo * GRAV * cosT * cosL * kc, Tn = T * kc;
  const pitchM = -Mo * (b.ax + GRAV * sinLong) * m.y * kc + b.hitch[0] * hb;
  let Nf = (W * (m.z - D.zr) + Tn * (zb - D.zr) + pitchM) / L;
  Nf = clamp(Nf, 0, W + Tn);
  const Nr = W + Tn - Nf, Nt = Nf + Nr;
  b.sF0 = clamp((Mo * (m.z - D.zr) + (T / GRAV) * (zb - D.zr)) / (L * (Mo + T / GRAV)), 0, 1);
  let latM = -Mo * (b.ay + GRAV * sinLat) * m.y * kc;                // moment onto the right wheels (minus: the left)
  if (D.lean && b.cargoKg > 0) latM += b.cargoKg * GRAV * cosT * D.lean.inM * b.lean * kc;   // the rider's weight moved inside
  const dNf = Nt > 0 ? (latM * Nf) / Nt / kind.track : 0, dNr = (Nt > 0 ? (latM * Nr) / Nt : 0) / kind.track + (b.hitch[1] * hb) / kind.track;
  const ld = b.load;
  ld[0] = Nf / 2 - dNf; ld[1] = Nf / 2 + dNf; ld[2] = Nr / 2 - dNr; ld[3] = Nr / 2 + dNr;
  if (ld[0] < 0) { ld[1] += ld[0]; ld[0] = 0; } else if (ld[1] < 0) { ld[0] += ld[1]; ld[1] = 0; }
  if (ld[2] < 0) { ld[3] += ld[2]; ld[2] = 0; } else if (ld[3] < 0) { ld[2] += ld[3]; ld[3] = 0; }
  b.tip = Nt > 0 ? Math.abs(dNf + dNr) / (Nt / 2) : 0;
  const slideOf = (i) => (_s[i].slide != null ? _s[i].slide : g.slide ?? 0.8);
  const slideK = (slideOf(0) + slideOf(1) + slideOf(2) + slideOf(3)) / 4;
  for (let i = 0; i < 4; i++) _cap[i] = tyreGrip(g.mu * (_s[i].mu ?? 1), ld[i], D.N0, D.ls);
  b.mu = Nt > 0 ? (_cap[0] + _cap[1] + _cap[2] + _cap[3]) / Nt : g.mu;                // the grip under it now (the rider reads it)

  // inputs, stalls
  let th = clamp(input.throttle || 0, -1, 1);
  const brake = clamp(input.brake || 0, 0, 1), hand = !!input.handbrake;
  const depth = env.water ? env.water(b.x, b.z) : 0;
  b.stalled = null;
  if (kind.fuel && !(b.fuelL > 0)) { th = 0; b.stalled = 'fuel'; }
  if (depth > kind.wheelR * 1.1) { th = 0; b.stalled = 'water'; }
  const rollRes = (g.rolling || 0) * sRoll * Nt;
  const Fgrav = -Mo * GRAV * sinLong * (kc > 0 || !b.air ? 1 : 0);
  const Fwater = -4 * Math.min(depth, kind.dims.h) * b.u * Mo;
  const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);       // F = (sy, cy), R = (cy, -sy)

  // the bodies for the solver: velocities at the centre of mass in the world
  const A = RB[0];
  {
    const vox = b.u * sy + b.w * cy, voz = b.u * cy - b.w * sy;          // at the origin
    A.vx = vox + b.r * m.z * cy; A.vz = voz - b.r * m.z * sy; A.r = b.r;   // + r perp(F z) = r z R
    A.im = 1 / Mo; A.ii = 1 / m.I;
  }
  const vx0 = A.vx, vz0 = A.vz;
  nRows = 0;
  let qF = null, qR = null, qL = null, qRt = null, qLat = null, qYaw = null, qLong = null;
  let Fdrive = 0, locked = false;
  const fyPrev = b.fy;

  if (tracked) {
    // 3t. two hydrostatic tracks. Belt commands from two levers or from throttle and steer.
    const B2 = kind.track / 2, top = kind.topMps, rev = kind.reverseMps || top;
    let cL, cR;
    if (input.tracks) { cL = clamp(input.tracks[0], -1, 1); cR = clamp(input.tracks[1], -1, 1); cL *= cL < 0 ? rev : top; cR *= cR < 0 ? rev : top; th = Math.max(Math.abs(input.tracks[0]), Math.abs(input.tracks[1])); }
    else {
      const vC = th >= 0 ? th * top : th * rev, dv = clamp(input.steer || 0, -1, 1) * (kind.pivotRadS || 1) * B2;
      cL = vC + dv; cR = vC - dv;
      const mx = Math.max(Math.abs(cL), Math.abs(cR));
      if (mx > top) { cL *= top / mx; cR *= top / mx; }
    }
    if (b.stalled) cL = cR = 0;
    const acc = (kind.trackAccel || 2.5) * dt, dec = Math.max(acc, kind.brakeG * GRAV * brake * dt);
    const ramp = (v, c) => { const d = c - v, lim = Math.abs(c) < Math.abs(v) || c * v < 0 ? dec : acc; return v + clamp(d, -lim, lim); };
    b.belt[0] = ramp(b.belt[0], cL); b.belt[1] = ramp(b.belt[1], cR);
    const Kt = kind.trackK || 0.025, lC = D.len, Pside = (kind.powerW || 0) * (kind.trackPowerK || 0.6);   // each side's pump: a share of the engine
    for (let side = 0; side < 2; side++) {
      const N = ld[side] + ld[side + 2], vb = b.belt[side];
      const grip = _cap[side] + _cap[side + 2], drive = Math.min(kind.trackForceN ? kind.trackForceN / 2 : Infinity, Pside / Math.max(Math.abs(vb), 0.4));
      const kd = N > 0 ? ((grip / Math.max(N, 1)) * N * lC) / (2 * Kt * Math.max(Math.abs(vb), 0.3)) : 0;   // shear: pull per m/s of slip
      const lx = side ? B2 : -B2, ax = lx * cy - m.z * sy, az = -lx * sy - m.z * cy;   // arm from the centre of mass
      const capF = Math.min(grip, drive) * dt;
      const q = row(0, ax, az, sy, cy, vb, kd > 0 ? 1 / (kd * dt) : 1e9, -capF, capF);
      q.grip = grip; q.drive = drive;
      if (side) qRt = q; else qL = q;
    }
    // sideways: the tracks resist sliding up to scrub x load, and resist turning with scrub x weight x length / 4
    const scrub = (g.scrub != null ? g.scrub : 0.5) * ((_s[0].scrub ?? _s[0].mu ?? 1) + (_s[1].scrub ?? _s[1].mu ?? 1)) / 2;
    A.vx += -GRAV * sinLat * kc * cy * dt; A.vz -= -GRAV * sinLat * kc * sy * dt;   // the cross-slope pulls it downhill
    const latCap = scrub * Nt * dt, yawCap = (scrub * Nt * lC) / 4 * dt;
    qLat = row(0, 0, 0, cy, -sy, 0, 0, -latCap, latCap);
    qYaw = angRow(0, 0, -yawCap, yawCap);
    qLong = row(0, 0, 0, sy, cy, 0, 0, -rollRes * dt, rollRes * dt);
    // explicit: gravity along the slope, water
    const F = (Fgrav + Fwater) * dt / Mo;
    A.vx += F * sy; A.vz += F * cy;
    b.steer = 0;
  } else {
    // 3w. driving and braking per wheel, each inside its own friction circle. The side force a wheel must give is what
    // it gave last substep or its share of what the turn needs now (mass x u x r), whichever is more. When driving or
    // braking and the turn together ask more than the circle holds, both get their proportional part (the force points
    // along the combined demand); past the peak along the wheel itself it spins or locks and slides, keeping about a
    // third of the sliding grip sideways.
    const need = Mo * Math.abs(b.u * b.r);
    for (let i = 0; i < 4; i++) {
      const Nax = i < 2 ? Nf : Nr, Yax = Math.max(fyPrev[i < 2 ? 0 : 1], Nt > 0 ? (need * Nax) / Nt : 0);
      _y[i] = Nax > 0 ? (Yax * ld[i]) / Nax : 0;
      _lk[i] = false; _xu[i] = 0;
    }
    const pF = D.drvF ? pureA(0, D.openF) : 0, pR = D.drvR ? pureA(2, D.openR) : 0, pure = pF + pR;
    let want = 0;
    if (kind.engine) want = b.stalled ? 0 : engineForce(b, kind, th, brake, Mo + (mt ? mt.M : 0), dt);
    else if (th !== 0) {
      const pw = (kind.powerW * Math.abs(th)) / Math.max(Math.abs(b.u), 1.5);
      want = th > 0 ? pw : -pw * clamp((kind.reverseMps - Math.max(0, -b.u)) / 0.4, 0, 1);
    }
    b.spinning = Math.abs(want) > pure || (b.spinning && Math.abs(want) > pure * slideK);
    if (b.spinning) {
      Fdrive = Math.sign(want) * pure * slideK;
      for (let i = 0; i < 4; i++) if (i < 2 ? D.drvF : D.drvR) _xu[i] = _cap[i] * slideOf(i) * 0.95;
    } else if (want !== 0 && pure > 0) {
      const Wd = Math.abs(want);
      let Fa = 0;
      for (let a = 0; a < 2; a++) {
        const pa = a ? pR : pF;
        if (!pa) continue;
        const i = a * 2, Wa = (Wd * pa) / pure;
        if (a ? D.openR : D.openF) { const x = Math.min(ach(i, Wa / 2), ach(i + 1, Wa / 2)); _xu[i] = _xu[i + 1] = x; Fa += 2 * x; }
        else { const s2 = _cap[i] + _cap[i + 1]; _xu[i] = ach(i, (Wa * _cap[i]) / s2); _xu[i + 1] = ach(i + 1, (Wa * _cap[i + 1]) / s2); Fa += _xu[i] + _xu[i + 1]; }
      }
      Fdrive = Math.sign(want) * Fa;
    }
    // brakes: by load on every wheel; the handbrake on the rear. Past a wheel's grip it locks and slides.
    const abs = !!(kind.assist && kind.assist.abs);
    const brakeWant = kind.brakeG * GRAV * Mo * brake, handWant = hand ? kind.brakeG * GRAV * Mo * 0.6 : 0;
    let brakeRes = 0;
    for (let i = 0; i < 4; i++) {
      const d = (Nt > 0 ? (brakeWant * ld[i]) / Nt : 0) + (i > 1 && Nr > 0 ? (handWant * ld[i]) / Nr : 0);
      if (d <= 0) continue;
      if (abs && _xu[i] + d > _cap[i] * ABS_K) { const x = ach(i, Math.max(_xu[i], _cap[i] * ABS_K)); brakeRes += Math.max(0, x - _xu[i]); _xu[i] = x; continue; }
      if (_xu[i] + d > _cap[i] && Math.abs(b.u) > 0.3) { _lk[i] = true; locked = true; brakeRes += _cap[i] * slideOf(i); _xu[i] = _cap[i] * slideOf(i) * 0.95; }
      else { const x = ach(i, _xu[i] + d); brakeRes += Math.max(0, x - _xu[i]); _xu[i] = x; }
    }
    b.spin += ((b.spinning || locked ? 1 : 0) - b.spin) * Math.min(1, 10 * dt);
    // side grip each axle has left: its wheels' circles less what drives or brakes them. A spinning wheel keeps about a
    // third of its sliding grip sideways; a locked wheel's friction follows its sliding velocity (sideways force
    // = sliding grip x sideways speed / speed: no steering, little hold at speed, so locked rear wheels let the tail go)
    let latF = 0, latR = 0, lkF = 0, lkR = 0;
    for (let i = 0; i < 4; i++) {
      if (_lk[i]) { const sc = _cap[i] * slideOf(i); if (i < 2) { latF += sc; lkF += sc; } else { latR += sc; lkR += sc; } continue; }
      const pk = b.spinning && (i < 2 ? D.drvF : D.drvR) ? _cap[i] * slideOf(i) : _cap[i];
      const left = Math.sqrt(Math.max(0, pk * pk - _xu[i] * _xu[i]));
      if (i < 2) latF += left; else latR += left;
    }
    // explicit forces along F: drive, drag, gravity, water
    const Fdrag = -dragOf(kind) * b.u * Math.abs(b.u);
    const F = (Fdrive + Fdrag + Fgrav + Fwater) * dt / Mo;
    A.vx += F * sy; A.vz += F * cy;
    A.vx += -GRAV * sinLat * kc * cy * dt; A.vz -= -GRAV * sinLat * kc * sy * dt;   // the cross-slope pulls it downhill
    // steering
    const lim = steerLimit(kind, b.u);
    const tgt = clamp(input.steer || 0, -1, 1) * lim, ds = kind.steerRate * (1 - 0.5 * Math.min(1, Math.abs(b.u) / kind.topMps)) * dt;
    b.steer = clamp(b.steer + clamp(tgt - b.steer, -ds, ds), -lim, lim);
    // the rows: rolling resistance and brakes (Coulomb, they hold a stopped body), then a side row per axle
    const res = (rollRes + brakeRes) * dt;
    qLong = row(0, 0, 0, sy, cy, 0, 0, -res, res);
    const Cs = g.lateral || 8, uAbs = Math.max(Math.abs(b.u), U0);
    // past the peak slip angle (about 1.5 mu / cornering stiffness) a sliding axle gives its sliding grip: a front past it
    // plows on (understeer stays put), a rear past it lets go (the tail comes round)
    const aPk = (1.5 * b.mu) / Cs;
    latF *= 1 - clamp((b.plow / uAbs - aPk) / aPk, 0, 1) * (1 - slideK);
    latR *= 1 - clamp((b.slip / uAbs - aPk) / aPk, 0, 1) * (1 - slideK);
    const axle = (zA, steerA, Nax, capA, lk, i) => {
      const both = _lk[i] && _lk[i + 1], dl = steerA && !both ? b.steer : 0, cd = Math.cos(dl), sd = Math.sin(dl);
      const nx = cy * cd - sy * sd, nz = -sy * cd - cy * sd;                     // the wheels' sideways: R cos - F sin
      const ax = (zA - m.z) * sy, az = (zA - m.z) * cy;
      const Nroll = (_lk[i] ? 0 : ld[i]) + (_lk[i + 1] ? 0 : ld[i + 1]);
      const kd = (Cs * Nroll + lk) / uAbs;
      return row(0, ax, az, nx, nz, 0, kd > 0 ? 1 / (kd * dt) : 1e9, -capA * dt, capA * dt);
    };
    qF = axle(D.zf, D.steerF, Nf, latF, lkF, 0);
    qR = axle(D.zr, D.steerR, Nr, latR, lkR, 2);
    // a solid driven axle turns both wheels at one speed, so in a turn the inner wheel pushes and the outer drags: a
    // moment against the yaw (longitudinal slip stiffness grip.longStiff per unit load, default 12) up to what the
    // lighter wheel can grip. The push of a quad's solid rear axle; a lifted inner wheel frees it. The engine drives the
    // axle with a torque, not at a set speed, so the axle's speed floats between its wheels' and their two slip
    // stiffnesses act in series (N1 N2 / (N1 + N2)): in a fast turn the weight goes to the outer wheel, the light inner
    // one can push little, and the axle lets the quad turn (equal loads: Cx N track^2 / 2u, as before).
    const Cx = g.longStiff || 12, tw = kind.track;
    for (let a = 0; a < 2; a++) {
      const i = a * 2;
      if (!(a ? D.drvR : D.drvF) || (a ? D.openR : D.openF)) continue;
      const nS = ld[i] + ld[i + 1] > 0 ? (ld[i] * ld[i + 1]) / (ld[i] + ld[i + 1]) : 0;
      const kdA = (Cx * nS * tw * tw) / uAbs, capM = Math.min(_cap[i], _cap[i + 1]) * tw * dt;
      if (kdA > 0 && capM > 0) angRow(0, 0, -capM, capM, 1 / (kdA * dt));
    }
    // the yaw assist (kind.assist.yaw): toward the steered arc, within the grip, as a damper of rate yaw on the yaw inertia
    const as = kind.assist;
    const asK = as && as.yaw > 0 ? clamp((Math.abs(b.u) - (as.fromMps || 0)) / Math.max((as.fullMps || 0) - (as.fromMps || 0), 1e-6), 0, 1) : 0;
    if (asK > 0 && kc > 0 && !(_lk[0] && _lk[1])) {
      const tow = mt ? Mo / (Mo + (as.towK ?? 1) * mt.M) : 1;
      const rCap = ((as.yawG || 1) * Math.min((latF + latR) / Mo, b.mu * GRAV * kc) * tow) / Math.max(Math.abs(b.u), 0.5);   // the side grip left
      const rK = clamp((b.u * Math.tan(b.steer)) / (kind.wheelbase || 1), -rCap, rCap);
      const capM = (as.yawM ?? 0.3) * b.mu * W * (kind.wheelbase || 1) * dt;
      angRow(0, rK, -capM, capM, 1 / (m.I * as.yaw * asK * kc * dt));
    }
  }

  // 8. the towed unit: a rigid body on the ball, its own axle and rolling resistance
  let Ct = null, qT = null, qTl = null;
  const tsy = tb ? Math.sin(tb.yaw) : 0, tcy = tb ? Math.cos(tb.yaw) : 0;
  if (pt) {
    Ct = RB[1];
    const vox = tb.u * tsy + tb.w * tcy, voz = tb.u * tcy - tb.w * tsy;
    Ct.vx = vox + tb.r * mt.z * tcy; Ct.vz = voz - tb.r * mt.z * tsy; Ct.r = tb.r;
    Ct.im = 1 / mt.M; Ct.ii = 1 / mt.I;
    // gravity along its slope and across it (from its pitch and roll on its wheels)
    const gl = -GRAV * Math.sin(tb.pitch), gx = -GRAV * Math.sin(tb.roll);
    Ct.vx += (gl * tsy + gx * tcy) * dt; Ct.vz += (gl * tcy - gx * tsy) * dt;
    const tsurf = env.surface ? env.surface(tb.x, tb.z) || NOSURF : NOSURF, tgp = tk.grip;
    const Na = Math.max(0, mt.M * GRAV * Math.cos(tb.pitch) - T) * (tb.air ? 0 : 1);
    const tcap = 2 * tyreGrip(tgp.mu * (tsurf.mu ?? 1), Na / 2, derOf(tk).N0 > 0 ? (tk.massKg * GRAV) / 2 : Na / 2, Dt.ls);
    const kd = ((tgp.lateral || 8) * Na) / Math.max(Math.abs(tb.u), U0);
    const ax = -mt.z * tsy, az = -mt.z * tcy;                                  // the axle, from its centre of mass
    qT = row(1, ax, az, tcy, -tsy, 0, kd > 0 ? 1 / (kd * dt) : 1e9, -tcap * dt, tcap * dt);
    const tres = (tgp.rolling || 0) * (tsurf.roll ?? 1) * Na * dt;
    qTl = row(1, ax, az, tsy, tcy, 0, 0, -tres, tres);
    // the ball: the tow unit's arm and the towed unit's (the tongue, Lh ahead of its axle)
    const a1x = pt.at[0] * cy + (pt.at[2] - m.z) * sy, a1z = -pt.at[0] * sy + (pt.at[2] - m.z) * cy;
    const a2x = (Dt.Lh - mt.z) * tsy, a2z = (Dt.Lh - mt.z) * tcy;
    ballSetup(a1x, a1z, a2x, a2z);
    const a = wrap(tb.yaw - b.yaw);
    BALL.lim = a >= ARTIC_MAX - 1e-3 ? 1 : a <= -ARTIC_MAX + 1e-3 ? -1 : 0;
  } else BALL.on = false;

  // solve
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < nRows; i++) solveRow(ROWS[i]);
    if (BALL.on) ballSolve();
  }

  // results back into the bodies
  if (tracked) {
    for (let side = 0; side < 2; side++) {
      const q = side ? qRt : qL, vg = A.vx * q.nx + A.vz * q.nz + A.r * q.pn;
      b.tslip[side] = b.belt[side] - vg;
      // pulling at the drive's limit (not the ground's), the belt slows with the ground instead of slipping
      if (q.drive < q.grip && Math.abs(q.acc) >= q.hi - 1e-9) { b.belt[side] = vg; b.tslip[side] = 0; }
    }
    b.slip = Math.abs(A.vx * cy - A.vz * sy); b.plow = 0;
    b.spin += ((Math.abs(b.tslip[0]) > 0.3 || Math.abs(b.tslip[1]) > 0.3 ? 1 : 0) - b.spin) * Math.min(1, 10 * dt);
  } else {
    b.fy[0] = Math.abs(qF.acc) / dt; b.fy[1] = Math.abs(qR.acc) / dt;
    b.plow = Math.abs(A.vx * qF.nx + A.vz * qF.nz + A.r * qF.pn);
    b.slip = Math.abs(A.vx * qR.nx + A.vz * qR.nz + A.r * qR.pn);
  }
  b.jack = false;
  if (pt) {
    // the force on the tow unit at the ball, in its frame
    const hx = BALL.jx / dt, hz = BALL.jz / dt;
    b.hitch[0] = hx * sy + hz * cy; b.hitch[1] = hx * cy - hz * sy;
    tb.hitch[0] = -b.hitch[0]; tb.hitch[1] = -b.hitch[1];
    tb.fy[0] = Math.abs(qT.acc) / dt;
    tb.slip = Math.abs(Ct.vx * qT.nx + Ct.vz * qT.nz + Ct.r * qT.pn);
    // bound at the stop and still folding it: backing up against it, or a trailer pushing the rig round (jackknife)
    if (BALL.lim && BALL.lacc !== 0 && Math.abs(b.u) > 0.05) { b.jack = true; if (b.u < -1) b.bump = Math.max(b.bump, -b.u * 2); }
  } else { b.hitch[0] = b.hitch[1] = 0; }

  // integrate the driven unit: position from the origin's velocity, then the velocity into the new frame
  // the centre of mass's acceleration in the body's frame (the world velocity's change already holds the centripetal
  // part); lightly smoothed, as the springs smooth how fast load moves between the wheels
  const kA = Math.min(1, 40 * dt);
  b.ax += (((A.vx - vx0) * sy + (A.vz - vz0) * cy) / dt - b.ax) * kA;
  b.ay += (((A.vx - vx0) * cy - (A.vz - vz0) * sy) / dt - b.ay) * kA;
  {
    const ox = A.vx - A.r * m.z * cy, oz = A.vz + A.r * m.z * sy;
    b.r = A.r;
    b.x += ox * dt; b.z += oz * dt;
    b.yaw = wrap(b.yaw + b.r * dt);
    const s2 = Math.sin(b.yaw), c2 = Math.cos(b.yaw);
    b.u = ox * s2 + oz * c2; b.w = ox * c2 - oz * s2;
  }

  // 9. deep water is a wall
  if (env.water && env.water(b.x, b.z) > kind.dims.h * 0.7) {
    b.bump = Math.hypot(b.u, b.w); b.x = x0; b.z = z0; b.u = b.w = 0;
  }
  // 7. collide: three circles along the body through the world's obstacles
  if (env.collide) collideBody(b, kind, env);

  // fuel, odometer
  const moved = Math.hypot(b.x - x0, b.z - z0);
  b.distM += moved;
  if (kind.fuel) {
    const burn = Math.min(b.fuelL, (kind.fuel.burnLph / 3600) * (0.1 + 0.9 * Math.abs(th)) * dt);
    if (burn > 0) { b.fuelL -= burn; b.burnedL += burn; }
  }
  b.engineS += dt;

  // the towed unit: integrate, put its tongue back on the ball (exactly), hold it at its stop, then its ride
  if (pt) {
    const ox = Ct.vx - Ct.r * mt.z * tcy, oz = Ct.vz + Ct.r * mt.z * tsy;
    const tx0 = tb.x, tz0 = tb.z;
    tb.r = Ct.r;
    tb.yaw = wrap(tb.yaw + tb.r * dt);
    hangOnBall(tb, tk, b, pt, env, Dt.Lh);
    const dx = tb.x - tx0, dz = tb.z - tz0, s2 = Math.sin(tb.yaw), c2 = Math.cos(tb.yaw);
    // its velocity: what the solver gave, kept consistent with where the ball took it
    tb.u = ox * s2 + oz * c2; tb.w = ox * c2 - oz * s2;
    const moveU = (dx * s2 + dz * c2) / dt;
    if (Math.abs(moveU - tb.u) > 0.5) tb.u = moveU;      // pushed out of an obstacle or held at the stop
    tb.distM += Math.hypot(dx, dz);
    tb.ra = tb.r - b.r;
    trailerRide(tb, tk, b, pt, env, dt, Dt.Lh);
  }
  return b;
}

// place a towed unit with its tongue on the ball at its current yaw (clamped at the stop; pushed out of obstacles by
// swinging about the ball)
function hangOnBall(tb, tk, tow, pt, env, Lh) {
  toWorld(tow, pt.at[0], pt.at[2], _b);
  let a = wrap(tb.yaw - tow.yaw);
  if (Math.abs(a) > ARTIC_MAX) { a = Math.sign(a) * ARTIC_MAX; tb.yaw = wrap(tow.yaw + a); if (Math.sign(tb.r - tow.r) === Math.sign(a)) tb.r = tow.r; }
  tb.artic = a;
  tb.x = _b.x - Math.sin(tb.yaw) * Lh; tb.z = _b.z - Math.cos(tb.yaw) * Lh;
  if (env.collide) {                                   // one circle at the axle; a push swings it about the ball
    const cx = tb.x, cz = tb.z;
    _c.x = cx; _c.z = cz;
    env.collide(_c, tk.dims.w / 2);
    if (Math.hypot(_c.x - cx, _c.z - cz) > 1e-6) {
      let y2 = Math.atan2(_b.x - _c.x, _b.z - _c.z), a2 = wrap(y2 - tow.yaw);
      if (Math.abs(a2) > ARTIC_MAX) { a2 = Math.sign(a2) * ARTIC_MAX; y2 = tow.yaw + a2; }
      tb.yaw = wrap(y2); tb.artic = a2; tb.r = tow.r;
      tb.x = _b.x - Math.sin(tb.yaw) * Lh; tb.z = _b.z - Math.cos(tb.yaw) * Lh;
    }
  }
}
// bob and roll on its own two wheels; the nose rests on the ball
function trailerRide(tb, tk, tow, pt, env, dt, Lh) {
  const s = susp(tk), hw = tk.track / 2;
  toWorld(tb, -hw, 0, _o); const hL = env.ground(_o.x, _o.z, tb.y + 0.6);
  toWorld(tb, hw, 0, _o); const hR = env.ground(_o.x, _o.z, tb.y + 0.6);
  tb.contact[0] = tb.contact[2] = hL; tb.contact[1] = tb.contact[3] = hR;
  const kc = heave(tb, s, (hL + hR) / 2, dt);
  [tb.roll, tb.vr] = angSpring(tb.roll, tb.vr, Math.atan((hR - hL) / tk.track), s, kc, dt);
  const ballY = tow.y + pt.at[1] + Math.sin(tow.pitch) * pt.at[2];
  tb.pitch = Math.atan2(ballY - (tb.y + tk.hitch.at[1]), Lh);
  const N = Math.max(0, (tb.cargoKg + tk.massKg) * GRAV - tb.tongue) / 2;
  tb.load[0] = tb.load[2] = N; tb.load[1] = tb.load[3] = N;
}

const _k = { x: 0, z: 0 };
function collideBody(b, kind, env) {
  const rad = kind.dims.w / 2, off = Math.max(0, kind.dims.l / 2 - rad);
  let hit = 0;
  for (const lz of [off, 0, -off]) {
    toWorld(b, 0, lz, _k);
    const cx = _k.x, cz = _k.z;
    env.collide(_k, rad);
    const dx = _k.x - cx, dz = _k.z - cz, d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    b.x += dx; b.z += dz;
    const nx = dx / d, nz = dz / d, sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
    let vx = b.u * sy + b.w * cy, vz = b.u * cy - b.w * sy;
    const vn = vx * nx + vz * nz;
    if (vn < 0) { vx -= vn * nx; vz -= vn * nz; hit = Math.max(hit, -vn); }
    const along = dx * cy - dz * sy;                    // the push along R
    b.yaw = wrap(b.yaw + clamp((lz * along) / (lz * lz + 1) * 0.6, -0.04, 0.04));
    const s2 = Math.sin(b.yaw), c2 = Math.cos(b.yaw);
    b.u = vx * s2 + vz * c2; b.w = vx * c2 - vz * s2;
  }
  if (hit > 2) b.bump = Math.max(b.bump, hit);
}

// Kinematic follow, no forces: a towed unit dragged along its tow point without sliding sideways at its axle (the
// tractrix, artic' = -(u / L) sin(artic) - r), clamped at ARTIC_MAX. For moving a rig by hand or by command; driving
// steps the towed unit as a body inside stepBody.
export function stepTowed(tb, tk, tow, towKind, env, dt = SUB) {
  const pt = pointOf(towKind, tk.hitch.type);
  if (!pt) return tb;
  const x0 = tb.x, z0 = tb.z, Lh = tk.hitch.at[2];
  toWorld(tow, pt.at[0], pt.at[2], _b);
  tb.yaw = wrap(Math.atan2(_b.x - tb.x, _b.z - tb.z));
  hangOnBall(tb, tk, tow, pt, env, Lh);
  const dx = tb.x - x0, dz = tb.z - z0, sy = Math.sin(tb.yaw), cy = Math.cos(tb.yaw);
  tb.u = (dx * sy + dz * cy) / dt; tb.w = (dx * cy - dz * sy) / dt; tb.r = tow.r;
  tb.distM += Math.hypot(dx, dz);
  trailerRide(tb, tk, tow, pt, env, dt, Lh);
  return tb;
}

// ---------------------------------------------------------------- heading steer
// "Push where you want to go": a camera-relative push (mx, mz in world space, length 0..1) becomes throttle and steer.
// Steer toward the pushed heading; throttle by how far you push and how well the nose lines up. Pushing more than
// 120 degrees from the nose while slower than 2 m/s reverses toward it; faster, it brakes first. Same for keys and sticks.
const REV_ON = (120 * Math.PI) / 180, REV_OFF = (80 * Math.PI) / 180;
export function headingControl(b, kind, mx, mz, { gentle = false } = {}) {
  const mag = Math.min(1, Math.hypot(mx, mz));
  // no push: an engine with engine braking coasts down on it and the rider holds the brake once nearly stopped
  if (mag < 0.05) { b.rev = false; return { throttle: 0, steer: 0, brake: Math.abs(b.u) < (kind.engine ? 1.2 : 0.4) ? 1 : kind.engine ? 0 : 0.15, handbrake: false }; }
  const err = wrap(Math.atan2(mx, mz) - b.yaw);
  const tracked = kind.drive === 'tracked';
  if (!b.rev && Math.abs(err) > REV_ON && b.u < 2) b.rev = true;
  else if (b.rev && Math.abs(err) < REV_OFF) b.rev = false;
  if (!b.rev) b.jackHold = false;
  const k = gentle ? 0.35 : 1;
  if (!b.rev && Math.abs(err) > REV_ON) return { throttle: 0, steer: 0, brake: mag, handbrake: false };
  if (b.rev) {
    if (b.u > 0.5) return { throttle: 0, steer: 0, brake: mag, handbrake: false };
    if (b.jack) b.jackHold = true;
    if (b.jackHold) return { throttle: 0, steer: 0, brake: 1, handbrake: false };      // jackknifed: the rider stops
    const errT = wrap(Math.atan2(mx, mz) - (b.yaw + Math.PI));         // bring the tail round to the heading
    const steer = tracked ? clamp(errT * 2, -1, 1) : clamp((-errT * 1.5) / Math.max(kind.steerMaxRad, 0.1), -1, 1);
    return { throttle: -mag * k * Math.max(0.3, Math.cos(errT)), steer, brake: 0, handbrake: false };
  }
  if (kind.engine && b.u < -0.6) return { throttle: 0, steer: 0, brake: mag, handbrake: false };   // still rolling back: stop first
  // tracks: slow down to turn (turning drags the tracks sideways and takes the power the straight run would)
  if (tracked) { const st = clamp(err * 2, -1, 1); return { throttle: mag * k * Math.max(0, Math.cos(err)) * (1 - 0.7 * Math.abs(st)), steer: st, brake: 0, handbrake: false }; }
  const lim = steerLimit(kind, b.u);
  // the rider: no more lock than the grip under it can turn (gripSteer), and eases the throttle when the tail steps out
  // or the wheels spin in a turn
  // towing, it asks the tyres for less: grip x mass / (mass + half the towed mass), as the keys' rider does
  const mo = kind.massKg + (b.cargoKg || 0), tow = b.towKg > 0 ? mo / (mo + 0.5 * b.towKg) : 1;
  const sMax = clamp(gripSteer(kind, b.u, (b.mu || kind.grip.mu) * tow) / Math.max(lim, 0.05), 0.15, 1);
  const ease = clamp(1.6 - b.slip, 0.35, 1) * (b.spin > 0.5 && Math.abs(err) > 0.3 ? 0.6 : 1);
  return { throttle: mag * k * Math.max(0.25, Math.cos(err)) * ease, steer: clamp((err * 1.5) / Math.max(lim, 0.05), -sMax, sMax), brake: 0, handbrake: false };
}

// ---------------------------------------------------------------- page helpers
// the drawn pose between the last two substeps (k = 0..1), for smooth motion at any frame rate
export function lerpPose(a, b, k, out = {}) {
  out.x = a.x + (b.x - a.x) * k; out.z = a.z + (b.z - a.z) * k; out.y = a.y + (b.y - a.y) * k;
  out.yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
  out.pitch = a.pitch + (b.pitch - a.pitch) * k; out.roll = a.roll + (b.roll - a.roll) * k;
  out.steer = a.steer + (b.steer - a.steer) * k;
  return out;
}
export function poseOf(b, out = {}) {
  out.x = b.x; out.z = b.z; out.y = b.y; out.yaw = b.yaw; out.pitch = b.pitch; out.roll = b.roll; out.steer = b.steer;
  return out;
}
