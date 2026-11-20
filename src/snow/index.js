/* Snow on screen: the snow lying on the ground, deep enough to walk through and leave tracks in. Draws the
   simulation's snowpack (__game.snow, src/sim/snow.js) and owns no truth of its own: footprints and ruts here are a
   picture, the packed path they make is sent to the sim and stays.
     field.js   the snowpack and the ground under it as two small textures round the player (CPU-filled)
     live.js    the 5 cm deformation texture: footprints, ruts, rims (drawn on the GPU, only when something presses)
     surface.js the nested-ring mesh of the snow surface; shade.js its material and the shared GLSL
     ground.js  the terrain whitened and the grass weighed down by the field; actors.js the feet and wheels
   Tiers: Low, a software renderer or no half-float targets: the whitened ground and grass only. Medium: a 25.6 m
   surface and a 512 texture. High and Ultra: 51.2 m and 1024.
   Summer costs nothing: no texture, no patched material, no mesh until snow first lies, and all of it is released
   again when the last of it has gone. Reaches the game only through window.__game; exposes window.__snow. */
import { gpuCaps } from './gpu.js';
import { createField } from './field.js';
import { createLive } from './live.js';
import { buildSurface, RINGS, SNAP } from './surface.js';
import { FIELD_GLSL, LIVE_GLSL, GROUND_GLSL, createSurfaceMaterial, VIEWS } from './shade.js';
import { createGroundPatches } from './ground.js';
import { createActors } from './actors.js';

(() => {
  const G = window.__game;
  if (!G || !G.sim || !G.THREE) return;
  const T = G.THREE, P = G.player;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W = () => G.sim.state.sys.weather;
  const SS = () => G.sim.state.sys.snow;
  const has = (name) => !!(G.sim.handlers && G.sim.handlers.has && G.sim.handlers.has(name));
  const RHO_PACKED = 450;

  // the uniforms every snow-showing material shares (__snow.uniforms)
  const U = {
    uSnowField: { value: null }, uSnowFieldWin: { value: new T.Vector4() },         // x0, z0 (m), size (m), on
    uSnowGround: { value: null }, uSnowGroundWin: { value: new T.Vector4() },       // first cell i, j, cells, on
    uSnowLive: { value: null }, uSnowLiveWin: { value: new T.Vector4() },           // centre x, z, size (m), on
    uSnowLiveTexel: { value: 0.05 },
    uSnowRef: { value: new T.Vector4(0, 1 / 6, 0, 0) },                             // reference depth (m), rho / 600, fresh, wet
    uSnowWind: { value: new T.Vector4(1, 0, 0, 0) },                                // toward x, z; m/s; wind-worked 0..1
    uSnowCenter: { value: new T.Vector3() },                                        // surface centre x, z, half-size (m)
    uSnowFlags: { value: new T.Vector4(1, 1, 1, 1) },                               // glints, scatter, rims, undulate
    uSnowFlags2: { value: new T.Vector4(1, 1, 0, 0) },                              // bury, surface
    uSnowView: { value: 0 },
  };

  // look switches, for comparing (kept in localStorage)
  const FLAG_KEY = 'snowFlags';
  const flags = { surface: true, glints: true, scatter: true, rims: true, bury: true, undulate: true };
  try { Object.assign(flags, JSON.parse(localStorage.getItem(FLAG_KEY) || '{}')); } catch (e) { /* none saved */ }
  function applyFlags() {
    const b = (v) => (v ? 1 : 0);
    U.uSnowFlags.value.set(b(flags.glints), b(flags.scatter), b(flags.rims), b(flags.undulate));
    U.uSnowFlags2.value.set(b(flags.bury), b(flags.surface), 0, 0);
  }
  applyFlags();

  const caps = gpuCaps(G.renderer, 'snowLive');   // localStorage.snowLive = 'force' runs the full path on a software renderer
  const ground = createGroundPatches(G, U);
  let active = false, tier = 'off', field = null, live = null, surf = null, mesh = null, mat = null;
  let checkT = 1, goneT = 0, tierT = 0, decayT = 0, lastFall = null, lastT = null;
  const stat = { stamps: 0, stampsSec: 0, secT: 0, secN: 0, ms: 0, msN: 0, msAvg: 0 };
  const onStamp = [];

  // the snowpack at a point: the sim's, or the reference pack when there is no snowpack system
  const _at = { sweMm: 0, depthM: 0, depth0M: 0, packed: 0, rho: 100, sinkM: 0 };
  const bearing = (rho, rb) => (G.snow && G.snow.bearing ? G.snow.bearing(rho, rb) : clamp((1 - rho / rb) / Math.max(1e-6, 1 - rho / RHO_PACKED), 0, 1));
  function sample(x, z) {
    if (G.snow && SS()) return G.snow.at(G.sim.state, x, z, _at);
    const w = W();
    _at.depth0M = _at.depthM = w ? w.snowDepthM : 0; _at.rho = w ? w.snowDensityKgM3 || 100 : 100; _at.packed = 0;
    _at.sweMm = w ? w.snowSweMm : 0; _at.sinkM = _at.depth0M * (1 - _at.rho / RHO_PACKED) * bearing(_at.rho, 330);
    return _at;
  }
  // does snow lie anywhere we keep: the reference pack, or any snowpack cell
  function lies() {
    const w = W();
    if (!w) return false;
    if (w.snowDepthM > 0.002) return true;
    if (G.snow && SS()) { if (G.snow.at(G.sim.state, P.x, P.z).depth0M > 0.002) return true; if (G.snow.total && G.snow.total(G.sim.state) > 0.5) return true; }
    return false;
  }

  function stamp(s) {
    stat.stamps++; stat.secN++;
    for (const f of onStamp) f(s);
    return live ? live.stamp(s) : false;
  }
  const actors = createActors(G, { stamp, bearing, sample });

  function wantTier() {
    if (!flags.surface || !caps.ok) return 'whiten';
    const pr = G.graphics ? G.graphics.preset : 'high';
    if (pr === 'low' || (G.quality && G.quality() === 'low')) return 'whiten';
    return pr === 'medium' ? 'medium' : 'high';
  }
  function dropSurface() {
    if (mesh) { G.scene.remove(mesh); surf.geo.dispose(); mat.dispose(); }
    if (live) live.dispose();
    if (field) field.groundOff();
    mesh = surf = mat = live = null;
  }
  function setTier(t) {
    if (t === tier) return;
    dropSurface();
    tier = t;
    if (t === 'medium' || t === 'high') {
      field.groundOn();
      live = createLive(G, U, t === 'high' ? { n: 1024, m: 51.2 } : { n: 512, m: 25.6 });
      surf = buildSurface(T, RINGS[t]);
      mat = createSurfaceMaterial(T, U);
      mesh = new T.Mesh(surf.geo, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false; mesh.name = 'snow-surface';
      G.scene.add(mesh);
    }
    ground.set(true, !!live);
  }
  function activate() {
    if (active) return;
    active = true; goneT = 0;
    field = createField(G, U);
    field.update(P.x, P.z, true);
    setTier(wantTier());
  }
  function release() {
    if (!active) return;
    dropSurface();
    field.dispose(); field = null;
    ground.set(false, false);
    active = false; tier = 'off';
  }

  function update(dt) {
    const w = W();
    if (!w) return;
    if (!active) { checkT += dt; if (checkT < 1) return; checkT = 0; if (lies()) activate(); else return; }
    const st = G.sim.state;
    // the reference pack and the weather, as the shaders want them
    const rho = w.snowDensityKgM3 || 100;
    const freshMm = G.snow && G.snow.freshMm && SS() ? G.snow.freshMm(st) : Math.max(0, 3 * (1 - (rho - 100) / 80));
    const windK = clamp((w.windMs - 4) / 8, 0, 1);
    U.uSnowRef.value.set(w.snowDepthM, rho / 600, w.tempC < 0 ? clamp(freshMm / 3, 0, 1) : 0, clamp((w.tempC + 0.5) / 2, 0, 1));
    U.uSnowWind.value.set(-Math.sin(w.windDirRad), Math.cos(w.windDirRad), w.windMs, windK);
    tierT += dt;
    if (tierT > 1) {
      tierT = 0;
      setTier(wantTier());
      // all gone for ten seconds: let everything go
      if (field.maxD < 0.002 && !lies()) { goneT += 1; if (goneT >= 10) { release(); return; } } else goneT = 0;
    }
    field.update(P.x, P.z);
    if (live) {
      const cx = Math.round(P.x / SNAP) * SNAP, cz = Math.round(P.z / SNAP) * SNAP;
      U.uSnowCenter.value.set(cx, cz, surf.half);
      field.groundUpdate(cx, cz);
      const c = live.centre;
      if (!c || c[0] !== cx || c[1] !== cz) live.follow(cx, cz);
    }
    actors.update(dt);
    // tracks fill in while it snows, rims slump in the wind and the thaw (world time, every 0.25 s)
    decayT += dt;
    if (decayT >= 0.25) {
      decayT = 0;
      const fall = w.totals.snowfallMm, t = st.t;
      if (lastFall !== null && live) {
        const dFall = Math.max(0, fall - lastFall), hours = Math.max(0, t - lastT) / 3600;
        const kp = Math.exp(-(dFall / 100) / 0.08);
        const kr = Math.exp(-hours * (Math.max(0, w.windMs - 6) * 0.3 + Math.max(0, w.tempC) * 0.25));
        if (kp < 0.999 || kr < 0.999) live.decay(kp, kr * kp, kr * kp, kp);
      }
      lastFall = fall; lastT = t;
    }
    if (live) live.flush();
  }
  G.stepHooks.push((dt) => {
    const t0 = performance.now();
    update(dt);
    const ms = performance.now() - t0;
    stat.ms += ms; stat.msN++;
    stat.secT += dt;
    if (stat.secT >= 1) { stat.stampsSec = stat.secN; stat.msAvg = stat.ms / Math.max(1, stat.msN); stat.secN = 0; stat.secT = 0; stat.ms = 0; stat.msN = 0; }
  });

  window.__snow = {
    uniforms: U,
    glsl: { field: FIELD_GLSL, live: LIVE_GLSL, ground: GROUND_GLSL },
    stamp, onStamp, flags,
    // the snowpack at a point (sim units: depth0M, depthM, packed, rho, sinkM)
    at: (x, z) => ({ ...sample(x, z) }),
    set(o = {}) {
      for (const k in o) if (k in flags) flags[k] = !!o[k];
      try { localStorage.setItem(FLAG_KEY, JSON.stringify(flags)); } catch (e) { /* no storage */ }
      applyFlags();
      if (active) setTier(wantTier());
      return { ...flags };
    },
    info: () => ({
      active, tier, caps: { ok: caps.ok, soft: caps.soft, half: caps.half },
      fieldBuilt: !!(field && field.built), fieldRev: field ? field.rev : 0, fieldMaxD: field ? +field.maxD.toFixed(3) : 0,
      groundSnow: clamp(((W() && W().snowDepthM) || 0) / 0.12, 0, 1), groundPatched: ground.patched && ground.on,
      stampsPerSec: stat.stampsSec, stamps: stat.stamps, stampsDrawn: live ? live.total : 0, liveDraws: live ? live.draws : 0,
      triangles: surf ? surf.triangles : 0, live: live ? live.n : 0, msPerFrame: +stat.msAvg.toFixed(3), pendingTreads: actors.pending(),
    }),
    debug: {
      // snow falls on the reference pack (cm of fresh powder, 100 kg/m3); the field and live texture are rebuilt now
      storm(cm = 30) {
        const mm = Math.max(0.1, +cm);
        if (has('snow.debugFall')) G.sim.commandNow('snow.debugFall', { mm });
        else { const w = W(); w.snowDensityKgM3 = (w.snowDensityKgM3 * w.snowSweMm + 100 * mm) / (w.snowSweMm + mm); w.snowSweMm += mm; w.totals.snowfallMm += mm; w.snowDepthM = w.snowSweMm / w.snowDensityKgM3; }
        // the snowpack's tiles take up the new fall on its next step: run that step now so the picture is current
        const sys = G.sim.systems && G.sim.systems.find((s) => s.name === 'snow');
        if (sys && has('snow.focus')) G.sim.commandNow('snow.focus', { x: P.x, z: P.z });
        activate();
        field.update(P.x, P.z, true);
        if (live) live.reseed();
        return W().snowDepthM;
      },
      // all the snow gone at once (sandbox only: clears the reference pack and the snowpack's cells)
      thaw() {
        const w = W(); w.snowSweMm = 0; w.snowDepthM = 0;
        const s = SS();
        if (s && s.grid && s.grid.tiles) { for (const k in s.grid.tiles) { const t = s.grid.tiles[k]; if (t.h) t.h.fill(0); if (t.l) t.l.fill(0); } s.rev++; s.grid.rev++; }
        if (field) { field.update(P.x, P.z, true); if (live) live.reseed(); }
        return true;
      },
      view(name) { U.uSnowView.value = name ? VIEWS[name] || 0 : 0; return U.uSnowView.value; },
      flush: () => actors.flush(),
      release, activate,
      get field() { return field; }, get live() { return live; }, get mesh() { return mesh; },
    },
  };
})();
