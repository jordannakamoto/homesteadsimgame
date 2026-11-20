// How the ATV turns and brakes on the keys, measured headless (docs/PLAYTEST.md, "ATV feel").
//   node bench/atv-feel.mjs [surface] [repo root]   surface: grass (default), dirt, snow, snow_packed, grass_wet
// Keys go through carControl exactly as src/engine/vehicles.js feeds it (Space: brake 1, throttle 0 over carControl's
// output); the body through the drive model at its 1/120 s substep. Given another checkout of the repo (an older
// commit, `git worktree add /tmp/old <commit>`), it measures that one; one from before car keys is driven with the
// raw inputs heading steer gave it for a push to the side (full steer, full brake).
const surf = process.argv[2] || 'grass';
const root = process.argv[3] ? 'file://' + process.argv[3].replace(/\/$/, '') + '/' : new URL('../', import.meta.url).href;
const { VEHICLE_KINDS, VEHICLE_SURFACES, vehicleCore } = await import(root + 'src/sim/index.js');
const { createBody, stepBody, SUB } = vehicleCore;
const carControl = vehicleCore.carControl || ((b, k, st, { fwd, turn, brake }) => ({ throttle: Math.max(0, fwd), steer: turn, brake: fwd < 0 || brake ? 1 : Math.abs(b.u) < 1.2 && !fwd ? 1 : 0 }));
const ATV = VEHICLE_KINDS.atv;
const steerLimit = vehicleCore.steerLimit || ((k, u) => k.steerMaxRad * (1 - (k.steerSpeedFalloff || 0) * Math.min(1, Math.abs(u) / k.topMps)));
const env = { ground: () => 0, surface: () => VEHICLE_SURFACES[surf] };
const deg = (r) => (r * 180) / Math.PI;
const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : String(v));

function rider() { const b = createBody(ATV, { fuelL: 10 }, env); b.cargoKg = ATV.riderKg; return { b, st: {} }; }
// one substep with keys: fwd (W +1, S -1), turn (D +1, A -1), space
function key(d, { fwd = 0, turn = 0, space = false } = {}) {
  const o = carControl(d.b, ATV, d.st, { fwd, turn, brake: false }, SUB);
  if (space) { o.brake = 1; o.throttle = 0; }
  stepBody(d.b, ATV, o, env, SUB);
  return o;
}
// a rider holding a speed with W
const holdFwd = (b, v) => Math.max(0, Math.min(1, 0.3 + (v - b.u) * 0.8));
function cruise(v, secs = 8) {
  const d = rider();
  for (let t = 0; t < secs; t += SUB) key(d, { fwd: holdFwd(d.b, v) });
  return d;
}

export function measure() {
  const out = { steer: [], radius: [], yaw: null, stop: [], sRev: null, coast: [] };
  // 1. time to full lock and the angle reached, D pressed at a held speed
  for (const v of [0, 3, 8, 12]) {
    const d = v ? cruise(v) : rider();
    const lim = steerLimit(ATV, d.b.u);
    const tr = [];
    for (let t = 0; t < 3; t += SUB) { key(d, { fwd: v ? holdFwd(d.b, v) : 0, turn: 1 }); tr.push([t + SUB, Math.abs(d.b.steer)]); }
    const fin = tr[tr.length - 1][1], t90 = (tr.find((q) => q[1] >= 0.9 * fin) || [NaN])[0];
    const t90lock = (tr.find((q) => q[1] >= 0.9 * lim) || [NaN])[0];
    // release: back to centre
    let tc = NaN;
    for (let t = 0; t < 3; t += SUB) { key(d, { fwd: v ? holdFwd(d.b, v) : 0 }); if (Math.abs(d.b.steer) < 0.1 * fin) { tc = t + SUB; break; } }
    out.steer.push({ v, lockDeg: deg(lim), heldDeg: deg(fin), t90, t90lock, centre: tc });
  }
  // 2. turning radius, D held with the speed held: rear axle (u / r) and the outer front tyre
  for (const v of [1.5, 5, 8]) {
    const d = cruise(v, 6);
    for (let t = 0; t < 6; t += SUB) key(d, { fwd: holdFwd(d.b, v), turn: 1 });
    let R = 0, n = 0, u = 0;
    const pts = [], side = Math.sign(d.b.steer) || 1;      // the outer front tyre is on the side the wheels point away from
    for (let t = 0; t < (v < 3 ? 16 : 8); t += SUB) {      // a whole lap or more
      key(d, { fwd: holdFwd(d.b, v), turn: 1 }); R += Math.abs(d.b.u / d.b.r); u += d.b.u; n++;
      const o = vehicleCore.toWorld(d.b, -side * ATV.track / 2, ATV.axles[0].z); pts.push([o.x, o.z]);
    }
    R /= n;
    const span = (i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]));
    const outer = Math.max(span(0), span(1)) / 2;          // the outer front tyre's centre, traced
    out.radius.push({ v, u: u / n, R, outer, g: ((u / n) ** 2 / R) / 9.81 });
  }
  // 3. yaw response: D pressed at 5 m/s, time to 63% and 90% of the steady yaw rate
  {
    const d = cruise(5, 8), rs = [];
    for (let t = 0; t < 4; t += SUB) { key(d, { fwd: holdFwd(d.b, 5), turn: 1 }); rs.push([t + SUB, Math.abs(d.b.r)]); }
    const fin = rs[rs.length - 1][1];
    out.yaw = { t63: rs.find((q) => q[1] >= 0.63 * fin)[0], t90: rs.find((q) => q[1] >= 0.9 * fin)[0], rate: deg(fin) };
  }
  // 4. stopping: S held, and Space held, from 5, 8, 12 m/s on the flat; the brake keys from the first substep
  for (const v of [5, 8, 12]) {
    for (const how of ['S', 'Space']) {
      const d = cruise(v, 10), u0 = d.b.u, x0 = d.b.x, z0 = d.b.z;
      let t = 0, lockT = 0, peak = 0;
      while (d.b.u > 0.05 && t < 15) {
        const u1 = d.b.u;
        key(d, how === 'S' ? { fwd: -1 } : { space: true });
        t += SUB; peak = Math.max(peak, (u1 - d.b.u) / SUB);
        if (d.b.spin > 0.5) lockT += SUB;
      }
      const dist = Math.hypot(d.b.x - x0, d.b.z - z0);
      out.stop.push({ v: u0, how, dist, t, g: (u0 * u0) / (2 * dist) / 9.81, peakG: peak / 9.81, lockT });
    }
  }
  // 5. S from 5 m/s held: when does it start to back up?
  {
    const d = cruise(5, 8); let t = 0, tStop = NaN, tRev = NaN;
    while (t < 8) {
      key(d, { fwd: -1 }); t += SUB;
      if (isNaN(tStop) && d.b.u < 0.05) tStop = t;
      if (isNaN(tRev) && d.b.u < -0.3) { tRev = t; break; }
    }
    out.sRev = { tStop, tRev, afterStop: tRev - tStop };
  }
  // 6. W let go at 5, 8 and 12 m/s: deceleration over the first second and the roll-out
  for (const v of [5, 8, 12]) {
    const d = cruise(v, 10), u0 = d.b.u, x0 = d.b.x, z0 = d.b.z;
    let t = 0, u1s = NaN;
    while (d.b.u > 0.05 && t < 40) { key(d, {}); t += SUB; if (isNaN(u1s) && t >= 1) u1s = d.b.u; }
    out.coast.push({ v: u0, g1: (u0 - u1s) / 9.81, dist: Math.hypot(d.b.x - x0, d.b.z - z0), t });
  }
  // 7. braking and steering at once: S and D held from 8 m/s, how far the nose turns before it stops
  {
    const d = cruise(8, 10), y0 = d.b.yaw; let t = 0;
    while (d.b.u > 0.05 && t < 15) { key(d, { fwd: -1, turn: 1 }); t += SUB; }
    out.brakeTurn = { deg: Math.abs(deg(vehicleCore.wrap(d.b.yaw - y0))), t };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = measure();
  console.log(`surface ${surf}`);
  console.log('steering, D pressed:  speed | lock | held | t to 90% of held | t to 90% lock | back to centre');
  for (const s of m.steer) console.log(`  ${s.v} m/s | ${f(s.lockDeg, 1)} deg | ${f(s.heldDeg, 1)} deg | ${f(s.t90)} s | ${f(s.t90lock)} s | ${f(s.centre)} s`);
  console.log('turning radius, D held:  speed | u / r at the middle | outer front tyre (traced) | lateral g');
  for (const r of m.radius) console.log(`  ${f(r.u, 1)} m/s | ${f(r.R)} m | ${f(r.outer)} m | ${f(r.g)} g`);
  console.log(`yaw at 5 m/s: 63% in ${f(m.yaw.t63)} s, 90% in ${f(m.yaw.t90)} s, steady ${f(m.yaw.rate, 1)} deg/s`);
  console.log('stopping:  from | key | distance | time | mean g | peak g | wheels locked');
  for (const s of m.stop) console.log(`  ${f(s.v, 1)} m/s | ${s.how} | ${f(s.dist)} m | ${f(s.t)} s | ${f(s.g)} | ${f(s.peakG)} | ${f(s.lockT)} s`);
  console.log(`S held from 5 m/s: stopped at ${f(m.sRev.tStop)} s, backing at ${f(m.sRev.tRev)} s (${f(m.sRev.afterStop)} s after the stop)`);
  console.log(`S and D held from 8 m/s: the nose turns ${f(m.brakeTurn.deg, 0)} deg before it stops (${f(m.brakeTurn.t)} s)`);
  console.log('W let go:  from | g in the first second | roll-out | time');
  for (const c of m.coast) console.log(`  ${f(c.v, 1)} m/s | ${f(c.g1, 3)} g | ${f(c.dist, 1)} m | ${f(c.t, 1)} s`);
}
