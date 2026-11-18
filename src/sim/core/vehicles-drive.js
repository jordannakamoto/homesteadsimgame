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
//   surface?(x, z) -> { mu, roll },            multipliers on grip and rolling resistance (grass, wet grass, dirt...)
//   water?(x, z) -> depth in metres,           slows, stalls past the axle, a wall when deeper than the body
//   collide?(o, rad),                          moves the circle o = { x, z } out of obstacles (the engine's pushOut)
// }
// input = { throttle: -1..1, steer: -1..1, brake: 0..1, handbrake: bool }

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
    d = Math.max(0.05, ((kind.powerW || 0) / top - (kind.grip.rolling || 0) * kind.massKg * GRAV) / (top * top));
    DRAG.set(kind, d);
  }
  return d;
}
const susp = (kind) => kind.susp || { travel: 0.15, hz: 2, damp: 0.4 };

// ---------------------------------------------------------------- the body
export function createBody(kind, { x = 0, z = 0, yaw = 0, fuelL = Infinity, cargoKg = 0 } = {}, env = null) {
  const b = {
    x, z, yaw, u: 0, w: 0, r: 0,
    y: 0, vy: 0, gy: 0, pitch: 0, vp: 0, roll: 0, vr: 0,
    steer: 0, air: false, contact: [0, 0, 0, 0],
    ax: 0, ay: 0, slip: 0, bump: 0, land: 0, stalled: null, rev: false, artic: 0,
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
  } else if (th !== 0) {
    const sF = clamp(0.5 - (b.ax / GRAV) * kind.cgH / kind.wheelbase, 0.1, 0.9);
    let share = 0;
    const axles = kind.axles || [];
    const zMax = Math.max(...axles.map((a) => a.z));
    for (const a of axles) if (a.driven) share += a.z === zMax ? sF : 1 - sF;
    if (axles.length === 1 && axles[0].driven) share = 1;
    const cap = Math.min(powerCap, mu * N * share);
    if (th > 0) Fdrive = cap;
    else Fdrive = -cap * clamp((kind.reverseMps - Math.max(0, -b.u)) / 0.4, 0, 1);
  }
  const Fdrag = tracked ? 0 : -dragOf(kind) * b.u * Math.abs(b.u);
  const Fwater = -4 * Math.min(depth, kind.dims.h) * b.u * M;
  const Fother = Fdrive + Fdrag + Fgrav + Fwater;
  const brakeRes = Math.min(kind.brakeG * GRAV * Mo * Math.max(brake, hand ? 0.6 : 0), mu * N);
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
    const tgt = clamp(input.steer || 0, -1, 1) * lim, ds = kind.steerRate * dt;
    b.steer = clamp(b.steer + clamp(tgt - b.steer, -ds, ds), -lim, lim);
    if (kc > 0) {
      let r = (b.u * Math.tan(b.steer)) / kind.wheelbase;
      const rCap = (mu * GRAV * kc * 1.05) / Math.max(Math.abs(b.u), 0.1);   // the front washes out: understeer
      r = clamp(r, -rCap, rCap);
      b.r = hand ? r * 1.25 : r;
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
  const dw = b.w * (1 - Math.exp(-lat * dt)), maxDw = mu * GRAV * kc * dt * (tracked ? 1.5 : 1);
  b.w -= Math.sign(dw) * Math.min(Math.abs(dw), maxDw);
  b.slip = Math.abs(b.w);
  b.ay = b.u * b.r;

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
  if (mag < 0.05) { b.rev = false; return { throttle: 0, steer: 0, brake: Math.abs(b.u) < 0.4 ? 1 : 0.15, handbrake: false }; }
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
