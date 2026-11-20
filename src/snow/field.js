// The two CPU-filled snow textures, both toroidal (a texel holds the cell at world index mod N, so a window that moves
// rewrites only what came into view):
//   uSnowField  192 x 192 RGBA16F, linear, 0.5 m cells (96 m round the player): depth before packing (m), density / 600,
//               packed fraction, spare. Filled from the simulation's snowpack (__game.snow.window); where there is no
//               snowpack yet it is the open-field reference. Zero under stream water and below the sea.
//   uSnowGround 128 x 128 R32F, nearest, 0.5 m lattice points (64 m round the player): the height of the terrain mesh
//               as it is drawn (its 1 m quads are split along the same diagonal), plus the hand-dug fine ground. The
//               snow surface stands on this, so it never dips under the terrain on a twisted quad.
import { tmod } from './gpu.js';

export const FIELD_N = 192, FIELD_CELL = 0.5, FIELD_M = FIELD_N * FIELD_CELL;
export const GROUND_N = 128, GROUND_CELL = 0.5;
const FIELD_RECENTRE = 16, FIELD_SNAP = 8, FIELD_MIN_S = 0.5;        // m from centre before the window moves; s between refills
const GROUND_RECENTRE = 4, GROUND_LOCAL = 12, GROUND_REV_S = 1;      // m; half-size of the patch redone when the ground changes; s

export function createField(G, U) {
  const T = G.THREE;
  const N = FIELD_N, fdata = new Float32Array(N * N * 4), mask = new Uint8Array(N * N);
  const ftex = new T.DataTexture(fdata, N, N, T.RGBAFormat, T.FloatType);
  ftex.internalFormat = 'RGBA16F';                                   // half floats filter linearly everywhere
  ftex.minFilter = ftex.magFilter = T.LinearFilter; ftex.wrapS = ftex.wrapT = T.RepeatWrapping; ftex.generateMipmaps = false; ftex.needsUpdate = true;
  U.uSnowField.value = ftex;
  let fx0 = null, fz0 = null, lastRev = null, lastFill = -1e9, maxD = 0, rev = 0, scratch = null;
  let groundRevMask = -1;
  const W = () => G.sim.state.sys.weather;

  // where snow cannot lie: stream water and below the sea
  const SEA = typeof G.sea === 'number' ? G.sea : 0;
  function wet(x, z) {
    if (G.heightAt(x, z) < SEA + 0.03) return 1;
    if (G.rivers && G.streamWaterAt) { const s = G.streamWaterAt(x, z); if (s && s.depth > 0.02) return 1; }
    return 0;
  }
  function maskRange(i0, i1, j0, j1) {
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) mask[tmod(j, N) * N + tmod(i, N)] = wet((i + 0.5) * FIELD_CELL, (j + 0.5) * FIELD_CELL);
  }
  // the snowpack's own revision, or (no snowpack system) the reference pack's state
  function snowRev() {
    const s = G.sim.state.sys.snow, w = W();
    if (s) return (s.rev | 0) + ':' + ((s.grid && s.grid.rev) | 0) + ':' + Math.round(w.snowSweMm * 20) + ':' + Math.round(w.snowDensityKgM3);
    return Math.round(w.snowSweMm * 20) + ':' + Math.round(w.snowDensityKgM3);
  }
  function fill() {
    const w = W(), R = G.snow, st = G.sim.state;
    const refD = w.snowDepthM || 0, refR = (w.snowDensityKgM3 || 100) / 600;
    const cx = (fx0 + N / 2) * FIELD_CELL, cz = (fz0 + N / 2) * FIELD_CELL;
    let done = false;
    if (R && R.window && st.sys.snow) {
      try {
        scratch = scratch || new Float32Array(N * N * 4);
        R.window(st, cx, cz, N, scratch);
        fdata.set(scratch); done = true;
      } catch (e) { done = false; }
    }
    if (!done) for (let k = 0; k < N * N; k++) { fdata[k * 4] = refD; fdata[k * 4 + 1] = refR; fdata[k * 4 + 2] = 0; fdata[k * 4 + 3] = 0; }
    let m = 0;
    for (let k = 0; k < N * N; k++) { if (mask[k]) fdata[k * 4] = 0; else if (fdata[k * 4] > m) m = fdata[k * 4]; }
    maxD = m; rev++;
    ftex.needsUpdate = true;
  }
  // keep the window round (px, pz); refill when the snowpack changed (at most twice a second) or force
  function update(px, pz, force = false) {
    const now = performance.now() / 1000;
    let moved = false;
    if (fx0 === null || Math.abs((fx0 + N / 2) * FIELD_CELL - px) > FIELD_RECENTRE || Math.abs((fz0 + N / 2) * FIELD_CELL - pz) > FIELD_RECENTRE) {
      const nx0 = Math.round(px / FIELD_SNAP) * FIELD_SNAP / FIELD_CELL - N / 2, nz0 = Math.round(pz / FIELD_SNAP) * FIELD_SNAP / FIELD_CELL - N / 2;
      // only the cells that came into view need their wet mask worked out
      if (fx0 === null || Math.abs(nx0 - fx0) >= N || Math.abs(nz0 - fz0) >= N) maskRange(nx0, nx0 + N, nz0, nz0 + N);
      else {
        if (nx0 !== fx0) { const a = nx0 > fx0 ? fx0 + N : nx0, b = nx0 > fx0 ? nx0 + N : fx0; maskRange(a, b, nz0, nz0 + N); }
        if (nz0 !== fz0) { const a = nz0 > fz0 ? fz0 + N : nz0, b = nz0 > fz0 ? nz0 + N : fz0; maskRange(nx0, nx0 + N, a, b); }
      }
      fx0 = nx0; fz0 = nz0; moved = true;
      U.uSnowFieldWin.value.set(fx0 * FIELD_CELL, fz0 * FIELD_CELL, FIELD_M, 1);
    }
    const gr = G.ground ? G.ground.rev : 0;
    if (gr !== groundRevMask && groundRevMask !== -1) maskRange(fx0, fx0 + N, fz0, fz0 + N);   // dug ponds and channels hold water now
    groundRevMask = gr;
    const r = snowRev();
    if (force || moved || (r !== lastRev && now - lastFill > FIELD_MIN_S)) { lastRev = r; lastFill = now; fill(); return true; }
    return false;
  }

  // ---------------------------------------------------------------- the ground under the snow
  let gtex = null, gdata = null, gx0 = null, gz0 = null, gRev = null, gRevT = 0;
  const GN = GROUND_N;
  function groundOn() {
    if (gtex) return;
    gdata = new Float32Array(GN * GN);
    gtex = new T.DataTexture(gdata, GN, GN, T.RedFormat, T.FloatType);
    gtex.internalFormat = 'R32F'; gtex.minFilter = gtex.magFilter = T.NearestFilter; gtex.generateMipmaps = false;
    gtex.wrapS = gtex.wrapT = T.RepeatWrapping;
    U.uSnowGround.value = gtex; gx0 = gz0 = null;
  }
  function groundOff() { if (gtex) gtex.dispose(); gtex = null; gdata = null; U.uSnowGround.value = null; gx0 = gz0 = null; }
  // the terrain mesh's height at a 0.5 m lattice point: its 1 m quad split from (i+1, j) to (i, j+1), as the chunk
  // mesh is built; heightAt is exact at the mesh's vertices
  let hc = null, hcI = 0, hcJ = 0, hcW = 0, hcH = 0;
  const H = (i, j) => { const a = i - hcI, b = j - hcJ; return a >= 0 && b >= 0 && a < hcW && b < hcH ? hc[b * hcW + a] : G.heightAt(i, j); };
  function meshH(x, z) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    if (fx + fz <= 1) { const h00 = H(i, j); return h00 + fx * (H(i + 1, j) - h00) + fz * (H(i, j + 1) - h00); }
    const h11 = H(i + 1, j + 1);
    return h11 + (1 - fx) * (H(i, j + 1) - h11) + (1 - fz) * (H(i + 1, j) - h11);
  }
  const surf = G.ground && G.ground.surfaceAt;
  function groundRange(i0, i1, j0, j1) {
    // the mesh vertices this range touches, read once
    const a = Math.floor(i0 * GROUND_CELL), b = Math.floor(j0 * GROUND_CELL);
    const w = Math.ceil((i1 - i0) * GROUND_CELL) + 2, hgt = Math.ceil((j1 - j0) * GROUND_CELL) + 2;
    if (!hc || hc.length < w * hgt) hc = new Float32Array(w * hgt);
    hcW = 0;
    for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) hc[j * w + i] = G.heightAt(a + i, b + j);
    hcI = a; hcJ = b; hcW = w; hcH = hgt;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const x = i * GROUND_CELL, z = j * GROUND_CELL;
      let h = meshH(x, z);
      if (surf) { const rel = surf(x, z) - G.heightAt(x, z); if (rel === rel) h += rel; }   // the hand-dug fine ground
      gdata[tmod(j, GN) * GN + tmod(i, GN)] = h;
    }
    hcW = 0;
  }
  // keep the ground window round (cx, cz), the snow surface's centre
  function groundUpdate(cx, cz) {
    if (!gtex) return;
    let dirty = false;
    if (gx0 === null || Math.abs((gx0 + GN / 2) * GROUND_CELL - cx) > GROUND_RECENTRE || Math.abs((gz0 + GN / 2) * GROUND_CELL - cz) > GROUND_RECENTRE) {
      const nx0 = Math.round(cx) / GROUND_CELL - GN / 2, nz0 = Math.round(cz) / GROUND_CELL - GN / 2;
      if (gx0 === null || Math.abs(nx0 - gx0) >= GN || Math.abs(nz0 - gz0) >= GN) groundRange(nx0, nx0 + GN, nz0, nz0 + GN);
      else {
        if (nx0 !== gx0) { const a = nx0 > gx0 ? gx0 + GN : nx0, b = nx0 > gx0 ? nx0 + GN : gx0; groundRange(a, b, nz0, nz0 + GN); }
        if (nz0 !== gz0) { const a = nz0 > gz0 ? gz0 + GN : nz0, b = nz0 > gz0 ? nz0 + GN : gz0; groundRange(nx0, nx0 + GN, a, b); }
      }
      gx0 = nx0; gz0 = nz0; dirty = true;
      U.uSnowGroundWin.value.set(gx0, gz0, GN, 1);
    }
    // the ground was shaped (dug, filled, graded): redo the patch round the player, at most once a second
    const r = G.ground ? G.ground.rev : 0, now = performance.now() / 1000;
    if (gRev === null) gRev = r;
    if (r !== gRev && now - gRevT > GROUND_REV_S) {
      gRev = r; gRevT = now;
      const p = G.player, c = GROUND_LOCAL / GROUND_CELL;
      const i0 = Math.max(gx0, Math.round(p.x / GROUND_CELL) - c), j0 = Math.max(gz0, Math.round(p.z / GROUND_CELL) - c);
      const i1 = Math.min(gx0 + GN, i0 + 2 * c), j1 = Math.min(gz0 + GN, j0 + 2 * c);
      if (i1 > i0 && j1 > j0) { groundRange(i0, i1, j0, j1); dirty = true; }
    }
    if (dirty) gtex.needsUpdate = true;
  }

  return {
    tex: ftex, update, groundOn, groundOff, groundUpdate,
    get maxD() { return maxD; }, get rev() { return rev; },
    get built() { return fx0 !== null; },
    // the field's value at a world point as the shader reads it (nearest cell; for tests and the presser code)
    at(x, z) {
      if (fx0 === null) return null;
      const i = Math.floor(x / FIELD_CELL), j = Math.floor(z / FIELD_CELL);
      if (i < fx0 || j < fz0 || i >= fx0 + N || j >= fz0 + N) return null;
      const k = (tmod(j, N) * N + tmod(i, N)) * 4;
      return [fdata[k], fdata[k + 1], fdata[k + 2], fdata[k + 3]];
    },
    groundAt(x, z) { if (!gtex || gx0 === null) return null; return gdata[tmod(Math.round(z / GROUND_CELL), GN) * GN + tmod(Math.round(x / GROUND_CELL), GN)]; },
    dispose() { groundOff(); ftex.dispose(); U.uSnowField.value = null; U.uSnowFieldWin.value.w = 0; fx0 = fz0 = null; },
  };
}
