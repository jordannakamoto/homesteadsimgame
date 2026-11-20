// Pressers: what presses the snow, and where. The player's feet print once a stride (about 0.7 m at a walk, a metre at
// a run, by distance travelled), alternating either side of the line of travel, heel to toe;
// in snow deep enough to sink past the knee (over 0.25 m) the legs plough a trench as wide as the body; a landing
// from a jump stamps both feet wide. Each vehicle and trailer wheel stamps a capsule from where it was to where it is,
// so ruts are continuous at any speed; a spinning wheel digs and throws rough snow. Every presser is also sent to
// the simulation (snow.tread, batched twice a second) so the path it packs stays when the footprints are gone; the
// snowpack's focus follows the player (snow.focus every 8 m).
// stamp(s) draws into the live texture when there is one; the sim batch is kept on every tier.
// Walking slows with the boot's sink (player.groundPace, which the engine multiplies into the walk): full speed on a
// packed path or bare ground, about 55 % at 0.4 m, never below 45 %. Loose snow deeper than 5 cm puffs up at each
// step and behind fast or spinning wheels (the engine's pooled particles, __game.burst).

const BOOT = { r: 0.065, half: 0.1, side: 0.12 };   // a boot print: half-width, half-length heel to toe, feet apart
const BATCH_S = 0.5, FOCUS_M = 8;

export function createActors(G, { stamp, bearing, sample }) {
  const P = G.player;
  let pts = [], batchT = 0, focus = null, wasAir = false, prevX = null, prevZ = null, travel = 0, side = 1, kickT = 0;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wheels = new Map();                          // unit id -> [[x, z], ...] where each wheel was
  const has = (name) => !!(G.sim.handlers && G.sim.handlers.has && G.sim.handlers.has(name));
  // into the sim batch: one point every 0.35 m of a capsule, so a long rut packs its whole length
  function tread(x0, z0, x1, z1, r, k) {
    if (k <= 0.01 || pts.length > 480) return;
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.35));
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); pts.push([+(x0 + (x1 - x0) * t).toFixed(3), +(z0 + (z1 - z0) * t).toFixed(3), Math.min(5, Math.max(0.12, r)), Math.min(1, k)]); }
  }
  function press(s) { stamp(s); tread(s.x0, s.z0, s.x1 != null ? s.x1 : s.x0, s.z1 != null ? s.z1 : s.z0, s.r * 1.4, s.k); }

  // the stride: about 0.7 m at a walk, a metre at a run, shorter when slowed (by the snow itself, a load)
  const strideAt = (sp) => clamp(0.7 + 0.3 * (sp - 5.4) / 2.8, 0.55, 1.0);
  function feet(snow, dt) {
    const fx = Math.sin(P.face), fz = Math.cos(P.face), rx = Math.cos(P.face), rz = -Math.sin(P.face);
    const kBoot = bearing(snow.rho, 330);
    const deep = snow.sinkM > 0.25;
    // landing from a jump: both feet, wide
    if (wasAir && !P.air) { press({ x0: P.x - rx * 0.15, z0: P.z - rz * 0.15, x1: P.x + rx * 0.15, z1: P.z + rz * 0.15, r: 0.16, k: kBoot, rim: 1, rough: 0.6 }); puff(P.x, P.z, snow, 6); }
    wasAir = P.air;
    if (P.air || P.climbY != null || P.standY != null) { prevX = P.x; prevZ = P.z; return; }
    const moved = prevX === null ? 0 : Math.hypot(P.x - prevX, P.z - prevZ);
    if (moved > 1.5) { prevX = P.x; prevZ = P.z; travel = 0; return; }   // a jump in place (teleport, respawn): no prints across it
    if (deep && moved > 0.05) {
      // wading: the legs plough one trench
      press({ x0: prevX, z0: prevZ, x1: P.x, z1: P.z, r: 0.26, k: kBoot, rim: 1, rough: 0.5, tread: 0 });
    }
    prevX = P.x; prevZ = P.z;
    travel += moved;
    const L = strideAt(P.speed);
    if (travel < L || P.speed < 0.3) { if (P.speed < 0.3) travel = Math.min(travel, L * 0.5); return; }
    travel -= L; if (travel > L) travel = 0;
    side = -side;
    if (deep) { puff(P.x, P.z, snow, 3); return; }
    // the foot lands under the body, a hand's width either side of the line of travel
    const cx = P.x + rx * BOOT.side * side, cz = P.z + rz * BOOT.side * side;
    press({ x0: cx - fx * BOOT.half, z0: cz - fz * BOOT.half, x1: cx + fx * BOOT.half, z1: cz + fz * BOOT.half, r: BOOT.r, k: kBoot, rim: 1, rough: 0.25 * Math.min(1, P.speed / 6), tread: 1 });
    puff(cx + fx * 0.1, cz + fz * 0.1, snow, 2);
  }
  // powder kicked up where loose snow is deeper than 5 cm: a few soft grains from the engine's particles (pooled there)
  function puff(x, z, snow, n) {
    if (!G.burst || snow.depthM < 0.05 || snow.packed > 0.5) return;
    const k = Math.min(1, (snow.depthM - 0.05) / 0.2);
    G.burst(x, G.heightAt(x, z) + snow.depthM * 0.85, z, Math.max(1, Math.round(n * (0.5 + k))), 0xf2f5fa, 0.7 + 0.6 * k, 1.1 + 0.8 * k, 0.045, 0.45);
  }
  // walking slows with the boot's sink: full speed on packed snow or bare ground, 56 % at 0.4 m, never below 45 %
  let pace = 1;
  function walkPace(snow, dt) {
    const want = snow ? 1 - 0.55 * (1 - Math.exp(-Math.max(0, snow.sinkM) / 0.25)) : 1;
    pace += (want - pace) * (1 - Math.exp(-dt * 6));
    if (Math.abs(pace - want) < 0.002) pace = want;
    P.groundPace = pace >= 0.999 ? 1 : pace;
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
        const kick = kickT <= 0;
        let moved = false;
        for (let i = 0; i < now.length; i++) {
          const d = Math.hypot(now[i][0] - was[i][0], now[i][1] - was[i][1]);
          if (d < 0.04) continue;
          if (d > 3) { was[i] = now[i]; continue; }            // a jump (spawned, reset): no rut across it
          press({ x0: was[i][0], z0: was[i][1], x1: now[i][0], z1: now[i][1], r, k: kT, rim: 1, rough: 0.2 + 0.8 * spin, tread: 2 });
          // a fast or spinning wheel throws loose snow up behind it
          if (kick && (spin > 0.25 || Math.abs(b.speed || 0) > 3) && (i >= 2 || now.length === 2)) {
            const ex = now[i][0] - was[i][0], ez = now[i][1] - was[i][1], el = Math.hypot(ex, ez) || 1;
            puff(now[i][0] - (ex / el) * 0.35, now[i][1] - (ez / el) * 0.35, snow, Math.round(2 + 4 * spin));
          }
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
      kickT -= dt;
      walkPace(snow.depth0M > 0.01 ? snow : null, dt);   // first: sample() hands back one shared object
      if (snow.depth0M > 0.01) { feet(snow, dt); vehicles(); }
      else { prevX = P.x; prevZ = P.z; travel = 0; wasAir = P.air; }
      if (kickT <= 0) kickT = 0.08;
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
    get pace() { return pace; },
    // the snow has gone: walking is full speed again
    release() { pace = 1; P.groundPace = 1; },
    // send the batch now (tests)
    flush() { batchT = BATCH_S; },
  };
}
