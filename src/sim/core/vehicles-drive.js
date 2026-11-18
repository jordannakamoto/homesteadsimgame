// The drive model: how a wheeled, tracked or towed body moves over a ground that exists only as a function you sample.
// Generic and pure (no DOM, no three.js, no game words): a vehicle record in, behaviour out. The page steps it at a fixed
// 1/120 s of real time (stepBody); the simulation never integrates it, it only receives the pose by command
// (src/sim/core/vehicles.js). Every feel parameter is a record field (docs: the kind record in ARCHITECTURE.md).
//
// Frame: a body at yaw faces F = (sin yaw, cos yaw) in (x, z), the engine's convention (facing = atan2(dx, dz)).
// Its right is R = (cos yaw, -sin yaw): a positive yaw rate turns the nose toward R, positive steer turns that way.
// pitch > 0 is nose up; roll > 0 is the right side up. Local points are [x (along R), y, z (along F)] from the origin,
// which is the middle between the axles at ground height (towed: the middle of its axle).
//
// env = {
//   ground(x, z, yHint) -> height,             required: the one ground read (terrain, shaped ground, built floors)
//   surface?(x, z) -> { mu, slide?, roll },    multipliers on peak grip and rolling resistance (grass, wet grass, dirt...);
//                                              slide: grip while spinning or sliding as a fraction of the peak (default grip.slide)
//   water?(x, z) -> depth in metres,           slows, stalls past the axle, a wall when deeper than the body
//   collide?(o, rad),                          moves the circle o = { x, z } out of obstacles (the engine's pushOut)
// }
// input = { throttle: -1..1, steer: -1..1, brake: 0..1, handbrake: bool }
//
// Optional powertrain (a kind with `engine` and `gears`; without them, force is simply powerW / speed):
//   engine = { idleRpm, launchRpm, redRpm, torqueNm, curve: [[rpm, k], ...], brakeK, creepMps, creepG }
//   gears  = { ratios: [overall ratio per forward gear], reverse, eff, shiftS, upRpm: [part, full], downRpm }
// An automatic: the clutch slips below launchRpm (so it pulls from rest and creeps at idle), it shifts up by engine speed
// and throttle and down as it slows, the torque dips while it shifts, and lifting off brakes through the engine, harder
// in the low gears. topMps is the speed limiter; reverseMps the reverse limiter. dragK: aerodynamic N per (m/s)^2.
// Tyres: grip.mu is the peak; past it the wheels spin (or lock) and give grip.slide of it, and while they spin or the
// body slides sideways the lateral grip falls the same way. Longitudinal and lateral share one friction circle, and
// the steering's grip follows the load on the front axle (it washes out under power, bites under braking).
// Exposed for the page: rpm, gear, spin (0..1, wheels spinning or locked), slip (m/s sideways), tip (side-slope and
// cornering load against the static stability factor; past 1 it would roll over), bump, land.

export const SUB = 1 / 120;                     // the fixed substep, seconds of real time
export const GRAV = 9.81;
export const ARTIC_MAX = (75 * Math.PI) / 180;  // a towed unit's stop against its tow unit
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

// The four ground probes, [lx, lz]: front left, front right, rear left, rear right. Wheeled: the wheels.
// Tracked: the corners of the contact patch (contactL long, or the wheelbase).
const PROBES = new WeakMap();
function probesOf(kind) {
  let p = PROBES.get(kind);
  if (p) return p;
  const hw = kind.track / 2;
  let zf, zr;
  if (kind.drive === 'tracked') { const l = kind.contactL || kind.wheelbase; zf = l / 2; zr = -l / 2; }
  else { const zs = (kind.axles || [{ z: kind.wheelbase / 2 }, { z: -kind.wheelbase / 2 }]).map((a) => a.z); zf = Math.max(...zs); zr = Math.min(...zs); }
  if (zf - zr < 0.2) { zf += 0.15; zr -= 0.15; }
  p = { pts: [[-hw, zf], [hw, zf], [-hw, zr], [hw, zr]], len: zf - zr, track: kind.track };
  PROBES.set(kind, p);
  return p;
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

// the share of the body's weight on driven wheels (weight moves rearward under acceleration)
function drivenShare(kind, b) {
  const axles = kind.axles || [];
  if (axles.length === 1) return axles[0].driven ? 1 : 0;
  const sF = clamp(0.5 - (b.ax / GRAV) * kind.cgH / kind.wheelbase, 0.1, 0.9), zMax = Math.max(...axles.map((a) => a.z));
  let share = 0;
  for (const a of axles) if (a.driven) share += a.z === zMax ? sF : 1 - sF;
  return share;
}

// ---------------------------------------------------------------- the body
export function createBody(kind, { x = 0, z = 0, yaw = 0, fuelL = Infinity, cargoKg = 0 } = {}, env = null) {
  const b = {
    x, z, yaw, u: 0, w: 0, r: 0,
    y: 0, vy: 0, gy: 0, pitch: 0, vp: 0, roll: 0, vr: 0,
    steer: 0, air: false, contact: [0, 0, 0, 0],
    ax: 0, ay: 0, slip: 0, bump: 0, land: 0, stalled: null, rev: false, artic: 0,
    gear: 1, rpm: kind.engine ? kind.engine.idleRpm : 0, shiftT: 0, spin: 0, spinning: false, tip: 0,
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
function targets(b, kind, env) {
  const P = probesOf(kind), h = b.contact;
  for (let i = 0; i < 4; i++) {
    toWorld(b, P.pts[i][0], P.pts[i][1], _o);
    h[i] = env.ground(_o.x, _o.z, b.y + 0.6);
  }
  const hF = (h[0] + h[1]) / 2, hR = (h[2] + h[3]) / 2, hL = (h[0] + h[2]) / 2, hRt = (h[1] + h[3]) / 2;
  return { y: (hF + hR) / 2, pitch: Math.atan((hF - hR) / P.len), roll: Math.atan((hRt - hL) / P.track), sinLong: (hF - hR) / Math.hypot(P.len, hF - hR), sinLat: (hRt - hL) / Math.hypot(P.track, hRt - hL) };
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

// One substep of a driven body, and of the unit it tows (trailer = { body, kind }) if any.
export function stepBody(b, kind, input, env, dt = SUB, trailer = null) {
  if (kind.drive === 'towed') return b;               // towed units move only through their tow unit
  const s = susp(kind), surf = env.surface ? env.surface(b.x, b.z) : null;
  const sMu = surf ? surf.mu ?? 1 : 1, sRoll = surf ? surf.roll ?? 1 : 1;
  const slideK = surf && surf.slide != null ? surf.slide : kind.grip.slide ?? 0.8;
  const mu = kind.grip.mu * sMu, tracked = kind.drive === 'tracked';
  b.bump = 0; b.land = 0;
  const x0 = b.x, z0 = b.z;

  // 1-2. probes, heave, pitch and roll with weight transfer
  const t = targets(b, kind, env);
  const kc = heave(b, s, t.y, dt);
  const cosT = Math.sqrt(1 - t.sinLong * t.sinLong);
  const transfer = 0.35;
  [b.pitch, b.vp] = angSpring(b.pitch, b.vp, t.pitch + Math.atan((b.ax / GRAV) * kind.cgH / kind.wheelbase) * transfer, s, kc, dt);
  [b.roll, b.vr] = angSpring(b.roll, b.vr, t.roll + Math.atan((b.ay / GRAV) * kind.cgH / kind.track) * transfer, s, kc, dt);
  b.roll = clamp(b.roll, -0.6, 0.6); b.pitch = clamp(b.pitch, -0.9, 0.9);

  // 3. longitudinal
  const towKg = trailer ? trailer.kind.massKg + (trailer.body.cargoKg || 0) : 0;
  const Mo = kind.massKg + (b.cargoKg || 0), M = Mo + towKg;
  const N = Mo * GRAV * cosT * kc;
  let th = clamp(input.throttle || 0, -1, 1);
  const brake = clamp(input.brake || 0, 0, 1), hand = !!input.handbrake;
  const depth = env.water ? env.water(b.x, b.z) : 0;
  b.stalled = null;
  if (kind.fuel && !(b.fuelL > 0)) { th = 0; b.stalled = 'fuel'; }
  if (depth > kind.wheelR * 1.1) { th = 0; b.stalled = 'water'; }
  let Fdrive = 0;
  const powerCap = (kind.powerW * Math.abs(th)) / Math.max(Math.abs(b.u), 1.5);
  const Fgrav = -M * GRAV * t.sinLong * (kc > 0 || !b.air ? 1 : 0);
  // Coulomb terms: rolling resistance and brakes take speed toward zero and hold a stopped body on a slope
  const rollRes = ((kind.grip.rolling || 0) * sRoll * Mo + (trailer ? (trailer.kind.grip.rolling || 0) * sRoll * towKg : 0)) * GRAV * cosT * kc;
  if (tracked) {                                        // hydrostatic: the tracks are driven at the commanded speed
    const uCmd = th >= 0 ? th * kind.topMps : th * kind.reverseMps;
    const cap = Math.min(kind.powerW / Math.max(Math.abs(b.u), 1.5), mu * N);
    const ff = (uCmd !== 0 ? Math.sign(uCmd) * rollRes : 0) - Fgrav;
    Fdrive = b.stalled ? 0 : clamp(M * (uCmd - b.u) * 4 + ff, -cap, cap);
  } else if (kind.engine) {
    const share = drivenShare(kind, b);
    const want = b.stalled ? 0 : engineForce(b, kind, th, brake, M, dt), cap = mu * N * share;
    // the tyres: up to the peak they grip; past it they spin and give the sliding grip until the demand falls back
    if (Math.abs(want) > cap || (b.spinning && Math.abs(want) > cap * slideK)) { b.spinning = true; Fdrive = Math.sign(want) * cap * slideK; }
    else { b.spinning = false; Fdrive = want; }
  } else if (th !== 0) {
    const cap = Math.min(powerCap, mu * N * drivenShare(kind, b));
    if (th > 0) Fdrive = cap;
    else Fdrive = -cap * clamp((kind.reverseMps - Math.max(0, -b.u)) / 0.4, 0, 1);
  }
  const Fdrag = tracked ? 0 : -dragOf(kind) * b.u * Math.abs(b.u);
  const Fwater = -4 * Math.min(depth, kind.dims.h) * b.u * M;
  const Fother = Fdrive + Fdrag + Fgrav + Fwater;
  const brakeWant = kind.brakeG * GRAV * Mo * Math.max(brake, hand ? 0.6 : 0);
  const locked = !tracked && brakeWant > mu * N && Math.abs(b.u) > 0.3;       // past the tyres' grip the wheels lock and skid
  const brakeRes = locked ? mu * N * slideK : brakeWant;
  if (!tracked && !kind.engine) b.spinning = false;
  b.spin += ((b.spinning || locked ? 1 : 0) - b.spin) * Math.min(1, 10 * dt);
  const u0 = b.u;
  let u = b.u + (Fother / M) * dt;
  const res = ((rollRes + brakeRes) / M) * dt;
  u = Math.abs(u) <= res ? 0 : u - Math.sign(u) * res;
  b.u = u;
  b.ax = (u - u0) / dt;

  // 5. yaw
  if (tracked) {
    const rCmd = clamp(input.steer || 0, -1, 1) * kind.pivotRadS * (b.stalled ? 0 : 1);
    if (kc > 0) b.r += (rCmd - b.r) * Math.min(1, 6 * kc * dt);
    b.steer = 0;
  } else {
    const lim = kind.steerMaxRad * (1 - (kind.steerSpeedFalloff || 0) * Math.min(1, Math.abs(b.u) / kind.topMps));
    const tgt = clamp(input.steer || 0, -1, 1) * lim, ds = kind.steerRate * (1 - 0.5 * Math.min(1, Math.abs(b.u) / kind.topMps)) * dt;
    b.steer = clamp(b.steer + clamp(tgt - b.steer, -ds, ds), -lim, lim);
    if (kc > 0) {
      let r = (b.u * Math.tan(b.steer)) / kind.wheelbase;
      // the front washes out (understeer): what grip the friction circle leaves after driving or braking, scaled by
      // the load on the front axle (less under power, more under braking); spinning or locked wheels give less still
      const used = clamp(Math.abs(Fdrive - Math.sign(b.u) * brakeRes) / Math.max(mu * N, 1e-6), 0, 1);
      const sF = clamp(0.5 - (b.ax / GRAV) * kind.cgH / kind.wheelbase, 0.1, 0.9);
      const front = Math.sqrt(sF / 0.5) * Math.sqrt(1 - used * used * 0.9) * (b.spin > 0.5 ? slideK : 1);
      const rCap = (mu * GRAV * kc * 1.05 * clamp(front, 0.2, 1.2)) / Math.max(Math.abs(b.u), 0.1);
      b.r = clamp(r, -rCap, rCap);
    } else b.r *= Math.exp(-0.3 * dt);
  }
  // the towed unit's stop: at full articulation the tow unit cannot turn further that way
  if (trailer) {
    const a = trailer.body.artic;
    if ((a >= ARTIC_MAX - 1e-3 && b.r < 0) || (a <= -ARTIC_MAX + 1e-3 && b.r > 0)) b.r = 0;
  }

  // 4. lateral: turning rotates the velocity's frame; grip takes the sideways part out, no faster than mu g allows
  const dYaw = b.r * dt, cs = Math.cos(dYaw), sn = Math.sin(dYaw);
  const u1 = b.u * cs + b.w * sn, w1 = b.w * cs - b.u * sn;
  b.u = u1; b.w = w1;
  b.yaw = wrap(b.yaw + dYaw);
  b.w -= GRAV * t.sinLat * kc * dt;                     // a cross-slope pulls it downhill
  const lat = (tracked ? Math.max(kind.grip.lateral, 14) : kind.grip.lateral) * sMu * (hand ? 0.3 : 1);
  const sliding = b.spin > 0.5 || Math.abs(b.w) > 1.2;                          // past the peak the tyres hold less
  const dw = b.w * (1 - Math.exp(-lat * dt)), maxDw = mu * GRAV * kc * dt * (tracked ? 1.5 : 1) * (sliding && !tracked ? slideK : 1);
  b.w -= Math.sign(dw) * Math.min(Math.abs(dw), maxDw);
  b.slip = Math.abs(b.w);
  b.ay = b.u * b.r;
  // how close to rolling over: the ground's cross-slope plus cornering load against the static stability factor
  b.tip = (Math.abs(Math.tan(t.roll) + (b.ay / GRAV) * kc)) / (kind.track / (2 * kind.cgH));

  // position
  const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
  b.x += (b.u * sy + b.w * cy) * dt;
  b.z += (b.u * cy - b.w * sy) * dt;

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

  // 8. the towed unit
  if (trailer) stepTowed(trailer.body, trailer.kind, b, kind, env, dt);
  return b;
}

const _c = { x: 0, z: 0 };
function collideBody(b, kind, env) {
  const rad = kind.dims.w / 2, off = Math.max(0, kind.dims.l / 2 - rad);
  let hit = 0;
  for (const lz of [off, 0, -off]) {
    toWorld(b, 0, lz, _c);
    const cx = _c.x, cz = _c.z;
    env.collide(_c, rad);
    const dx = _c.x - cx, dz = _c.z - cz, d = Math.hypot(dx, dz);
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

// A towed unit follows its tow point without sliding sideways at its axle (the tractrix): the articulation rate is
// artic' = -(u / L) sin(artic) - r, from the geometry rather than integrated. Clamped at ARTIC_MAX.
const _b = { x: 0, z: 0 };
export function stepTowed(tb, tk, tow, towKind, env, dt = SUB) {
  const pt = pointOf(towKind, tk.hitch.type);
  if (!pt) return tb;
  const x0 = tb.x, z0 = tb.z, Lh = tk.hitch.at[2];
  toWorld(tow, pt.at[0], pt.at[2], _b);
  let yaw = Math.atan2(_b.x - tb.x, _b.z - tb.z);
  let artic = wrap(yaw - tow.yaw);
  if (Math.abs(artic) > ARTIC_MAX) { artic = Math.sign(artic) * ARTIC_MAX; yaw = wrap(tow.yaw + artic); }
  tb.yaw = wrap(yaw); tb.artic = artic;
  tb.x = _b.x - Math.sin(tb.yaw) * Lh; tb.z = _b.z - Math.cos(tb.yaw) * Lh;
  if (env.collide) {                                   // one circle at the axle; a push swings it about the ball
    const cx = tb.x, cz = tb.z;
    _c.x = cx; _c.z = cz;
    env.collide(_c, tk.dims.w / 2);
    if (Math.hypot(_c.x - cx, _c.z - cz) > 1e-6) {
      let y2 = Math.atan2(_b.x - _c.x, _b.z - _c.z), a2 = wrap(y2 - tow.yaw);
      if (Math.abs(a2) > ARTIC_MAX) { a2 = Math.sign(a2) * ARTIC_MAX; y2 = tow.yaw + a2; }
      tb.yaw = wrap(y2); tb.artic = a2;
      tb.x = _b.x - Math.sin(tb.yaw) * Lh; tb.z = _b.z - Math.cos(tb.yaw) * Lh;
    }
  }
  const dx = tb.x - x0, dz = tb.z - z0, sy = Math.sin(tb.yaw), cy = Math.cos(tb.yaw);
  tb.u = (dx * sy + dz * cy) / dt; tb.w = (dx * cy - dz * sy) / dt;
  tb.distM += Math.hypot(dx, dz);
  // bob and roll on its own two wheels; the nose rests on the ball
  const s = susp(tk), hw = tk.track / 2;
  toWorld(tb, -hw, 0, _o); const hL = env.ground(_o.x, _o.z, tb.y + 0.6);
  toWorld(tb, hw, 0, _o); const hR = env.ground(_o.x, _o.z, tb.y + 0.6);
  tb.contact[0] = tb.contact[2] = hL; tb.contact[1] = tb.contact[3] = hR;
  const kc = heave(tb, s, (hL + hR) / 2, dt);
  [tb.roll, tb.vr] = angSpring(tb.roll, tb.vr, Math.atan((hR - hL) / tk.track), s, kc, dt);
  const ballY = tow.y + pt.at[1] + Math.sin(tow.pitch) * pt.at[2];
  tb.pitch = Math.atan2(ballY - (tb.y + tk.hitch.at[1]), Lh);
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
  const k = gentle ? 0.35 : 1;
  if (!b.rev && Math.abs(err) > REV_ON) return { throttle: 0, steer: 0, brake: mag, handbrake: false };
  if (b.rev) {
    if (b.u > 0.5) return { throttle: 0, steer: 0, brake: mag, handbrake: false };
    const errT = wrap(Math.atan2(mx, mz) - (b.yaw + Math.PI));         // bring the tail round to the heading
    const steer = tracked ? clamp(errT * 2, -1, 1) : clamp((-errT * 1.5) / Math.max(kind.steerMaxRad, 0.1), -1, 1);
    return { throttle: -mag * k * Math.max(0.3, Math.cos(errT)), steer, brake: 0, handbrake: false };
  }
  if (kind.engine && b.u < -0.6) return { throttle: 0, steer: 0, brake: mag, handbrake: false };   // still rolling back: stop first
  if (tracked) return { throttle: mag * k * Math.max(0, Math.cos(err)), steer: clamp(err * 2, -1, 1), brake: 0, handbrake: false };
  const lim = kind.steerMaxRad * (1 - (kind.steerSpeedFalloff || 0) * Math.min(1, Math.abs(b.u) / kind.topMps));
  return { throttle: mag * k * Math.max(0.25, Math.cos(err)), steer: clamp((err * 1.5) / Math.max(lim, 0.05), -1, 1), brake: 0, handbrake: false };
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
