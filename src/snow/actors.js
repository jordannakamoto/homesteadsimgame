// Pressers: what presses the snow, and where. The player's feet print on the walk cycle, alternating, heel to toe;
// in snow deep enough to sink past the knee (over 0.25 m) the legs plough a trench as wide as the body; a landing
// from a jump stamps both feet wide. Each vehicle and trailer wheel stamps a capsule from where it was to where it is,
// so ruts are continuous at any speed; a spinning wheel digs and throws rough snow. Every presser is also sent to
// the simulation (snow.tread, batched twice a second) so the path it packs stays when the footprints are gone; the
// snowpack's focus follows the player (snow.focus every 8 m).
// stamp(s) draws into the live texture when there is one; the sim batch is kept on every tier.

const BOOT = { r: 0.065, half: 0.1, side: 0.12 };   // a boot print: half-width, half-length heel to toe, feet apart
const BATCH_S = 0.5, FOCUS_M = 8;

export function createActors(G, { stamp, bearing, sample }) {
  const P = G.player;
  let pts = [], batchT = 0, focus = null, lastStep = null, wasAir = false, prevX = null, prevZ = null;
  const wheels = new Map();                          // unit id -> [[x, z], ...] where each wheel was
  const has = (name) => !!(G.sim.handlers && G.sim.handlers.has && G.sim.handlers.has(name));
  // into the sim batch: one point every 0.35 m of a capsule, so a long rut packs its whole length
  function tread(x0, z0, x1, z1, r, k) {
    if (k <= 0.01 || pts.length > 480) return;
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.35));
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); pts.push([+(x0 + (x1 - x0) * t).toFixed(3), +(z0 + (z1 - z0) * t).toFixed(3), Math.min(5, Math.max(0.12, r)), Math.min(1, k)]); }
  }
  function press(s) { stamp(s); tread(s.x0, s.z0, s.x1 != null ? s.x1 : s.x0, s.z1 != null ? s.z1 : s.z0, s.r * 1.4, s.k); }

  function feet(snow) {
    const fx = Math.sin(P.face), fz = Math.cos(P.face), rx = Math.cos(P.face), rz = -Math.sin(P.face);
    const kBoot = bearing(snow.rho, 330);
    const deep = snow.sinkM > 0.25;
    // landing from a jump: both feet, wide
    if (wasAir && !P.air) press({ x0: P.x - rx * 0.15, z0: P.z - rz * 0.15, x1: P.x + rx * 0.15, z1: P.z + rz * 0.15, r: 0.16, k: kBoot, rim: 1, rough: 0.6 });
    wasAir = P.air;
    if (P.air || P.climbY != null || P.standY != null) { prevX = P.x; prevZ = P.z; return; }
    if (deep && prevX !== null && Math.hypot(P.x - prevX, P.z - prevZ) > 0.05) {
      // wading: the legs plough one trench
      press({ x0: prevX, z0: prevZ, x1: P.x, z1: P.z, r: 0.26, k: kBoot, rim: 1, rough: 0.5, tread: 0 });
    }
    prevX = P.x; prevZ = P.z;
    const s = Math.floor(P.walk / Math.PI);           // a foot is planted every half stride
    if (lastStep === null) { lastStep = s; return; }
    if (s === lastStep || P.speed < 0.3) { lastStep = s; return; }
    lastStep = s;
    if (deep) return;
    const side = s & 1 ? 1 : -1, cx = P.x + rx * BOOT.side * side + fx * 0.12, cz = P.z + rz * BOOT.side * side + fz * 0.12;
    press({ x0: cx - fx * BOOT.half, z0: cz - fz * BOOT.half, x1: cx + fx * BOOT.half, z1: cz + fz * BOOT.half, r: BOOT.r, k: kBoot, rim: 1, rough: 0.25 * Math.min(1, P.speed / 6), tread: 1 });
  }

  function vehicles() {
    const V = window.__vehicles;
    if (!V || !V.units) return;
    const kinds = V.kinds ? V.kinds() : {}, units = V.units(), seen = new Set();
    for (const id in units) {
      const b = V.body(id), k = kinds[units[id].kind];
      if (!b || !k || !k.track) continue;
      seen.add(id);
      const hw = k.track / 2, zs = (k.axles || []).map((a) => a.z);
      const zf = zs.length ? Math.max(...zs) : (k.wheelbase || 0) / 2, zr = zs.length ? Math.min(...zs) : -(k.wheelbase || 0) / 2;
      const loc = zf === zr ? [[-hw, zf], [hw, zf]] : [[-hw, zf], [hw, zf], [-hw, zr], [hw, zr]];
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const now = loc.map(([lx, lz]) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c]);
      const was = wheels.get(id);
      if (was && was.length === now.length) {
        const snow = sample(b.x, b.z), kT = bearing(snow.rho, 400);
        const r = Math.max(0.08, (k.wheelR || 0.3) * 0.38), spin = Math.min(1, Math.max(0, b.spin || 0));
        let moved = false;
        for (let i = 0; i < now.length; i++) {
          const d = Math.hypot(now[i][0] - was[i][0], now[i][1] - was[i][1]);
          if (d < 0.04) continue;
          if (d > 3) { was[i] = now[i]; continue; }            // a jump (spawned, reset): no rut across it
          press({ x0: was[i][0], z0: was[i][1], x1: now[i][0], z1: now[i][1], r, k: kT, rim: 1, rough: 0.2 + 0.8 * spin, tread: 2 });
          was[i] = now[i]; moved = true;
        }
        if (moved) wheels.set(id, was);
      } else wheels.set(id, now);
    }
    for (const id of wheels.keys()) if (!seen.has(id)) wheels.delete(id);
  }

  return {
    update(dt) {
      const snow = sample(P.x, P.z);
      if (snow.depth0M > 0.01) { feet(snow); vehicles(); }
      else { prevX = P.x; prevZ = P.z; lastStep = Math.floor(P.walk / Math.PI); wasAir = P.air; }
      batchT += dt;
      if (batchT >= BATCH_S) {
        batchT = 0;
        if (pts.length && has('snow.tread')) { try { G.sim.command('snow.tread', { pts }); } catch (e) { /* the sim refused: drop it */ } }
        pts = [];
        if (has('snow.focus') && (!focus || Math.hypot(P.x - focus[0], P.z - focus[1]) > FOCUS_M)) {
          focus = [P.x, P.z];
          try { G.sim.command('snow.focus', { x: +P.x.toFixed(2), z: +P.z.toFixed(2) }); } catch (e) { /* ignore */ }
        }
      }
    },
    pending: () => pts.length,
    // send the batch now (tests)
    flush() { batchT = BATCH_S; },
  };
}
