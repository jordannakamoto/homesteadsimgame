// Snow: where the weather's snowpack actually lies. The weather keeps one open-field reference pack (SWE, density, totals);
// this system spreads it over the ground in 0.5 m cells: roofs and crowns keep it off, trees drop it in rings, walls and
// slopes change how fast it melts, wind carries it into drifts, and hands, wheels and shovels pack and move it.
// See docs/design/snow.md section 2. The generic mechanism is core/snowfield.js; the numbers are content/snow.js.
//
// state sys.snow = { v: 1, grid (earthwork format, h and l in micrometres of water), meta: { 'tx,tz': { fall, melt, unload, worked } },
//   focus, seen: { fall, melt }, canopyMm, freshMm, unloadMm, extraMelt, obstacles: { v, trees }, totals: { fall, melt, unload, sublim, blown }, rev }
// Static per-tile factors and the wind scratch arrays are caches kept outside the state (a pure function of the site,
// the trees and the ground), so the state stays plain JSON and a loaded save rebuilds them.
//
// Events: 'snow.changed' {} when the grid changed; 'snow.unload' { mm } when a step sheds more than 0.3 mm from the crowns.

import * as SF from './core/snowfield.js';
import { groundRead } from './ground.js';
import { sunPosition, START_DAY_OF_YEAR } from './calendar.js';
import { DAY, HOUR } from './time.js';
import { RHO_PACKED, RHO_BEAR, NEW_DENSITY, GRID, ACTIVE_R, DROP_R, MAX_TREES, DDF, CANOPY, FRESH_TAU, MELT, WIND, TOOLS } from './content/snow.js';

const V = 1, EVERY = 10, TS = GRID.T, SPAN = GRID.step * GRID.T, NC = TS * TS, NL = TS >> 1;   // NL: 1 m lattice cells along a tile
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (reason) => ({ ok: false, reason });
const KEY = (tx, tz) => tx + ',' + tz;

function fresh(ctx) {
  const W = ctx && ctx.get ? ctx.get('weather') : null;
  const tot = (W && W.totals) || {};
  return {
    v: V, grid: SF.makeField(GRID.step, GRID.T), meta: {}, focus: { x: 0, z: 0 },
    seen: { fall: tot.snowfallMm || 0, melt: tot.meltMm || 0 },
    canopyMm: 0, freshMm: 0, unloadMm: 0, extraMelt: 0,
    obstacles: { v: 0, trees: [] },
    totals: { fall: 0, melt: 0, unload: 0, sublim: 0, blown: 0 }, rev: 0,
  };
}

// ------------------------------------------------------------------------------------------------ static factors
// caches: WeakMap keyed by the state object -> { sig, tiles: Map(key -> factors), shapes, scratch }
const caches = new WeakMap();
function cacheOf(s) { let c = caches.get(s); if (!c) caches.set(s, c = { tiles: new Map(), coords: new Map(), shapes: null, scratch: null, sv: -1, ov: -1, gr: -1, lr: -1, lat: -1 }); return c; }

const sunCache = new Map();
function sunVector(lat) {   // the clear-sky beam at noon, 1 March: when the melt happens
  const key = lat.toFixed(2);
  let v = sunCache.get(key);
  if (!v) {
    const p = sunPosition((MELT.sunDay - START_DAY_OF_YEAR) * DAY + 12 * HOUR, { latitudeDeg: lat }), c = Math.cos(p.elevationRad);
    v = { x: Math.sin(p.azimuthRad) * c, y: Math.max(0.05, Math.sin(p.elevationRad)), z: -Math.cos(p.azimuthRad) * c };
    sunCache.set(key, v);
  }
  return v;
}

function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const bboxOf = (pts) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; } return [x0, z0, x1, z1]; };

// everything that stands on the ground, as shapes the tiles test against
function buildShapes(ctx, s) {
  const site = ctx.get('site'), pieces = (site && site.pieces) || [], roofs = [], floors = [], walls = [], trees = [];
  const gy = (x, z) => groundRead.surfaceY(ctx.state, x, z);
  for (const p of pieces) {
    if (!p || p.built === false) continue;
    if (p.kind === 'roof' && Array.isArray(p.footprint) && p.footprint.length >= 3) {
      const poly = p.footprint.map((q) => [q.x, q.z]), f = p.facing, fl = f ? Math.hypot(f.x, f.z) : 0;
      roofs.push({ poly, bb: bboxOf(poly), eaveY: p.eaveY, ridgeY: p.ridgeY, slope: Math.tan(((p.pitchDeg || 0) * Math.PI) / 180), fx: fl ? f.x / fl : 0, fz: fl ? f.z / fl : 0, ax: p.a ? p.a.x : 0, az: p.a ? p.a.z : 0, hasFacing: !!fl });
    } else if (p.kind === 'floor' && Array.isArray(p.outline) && p.outline.length >= 3) {
      const poly = p.outline.map((q) => [q.x, q.z]), c = poly.reduce((a, q) => [a[0] + q[0] / poly.length, a[1] + q[1] / poly.length], [0, 0]);
      if (p.y0 - gy(c[0], c[1]) > MELT.floorAbove) floors.push({ poly, bb: bboxOf(poly), y1: p.y1 });   // a deck or upper floor: it roofs what is under it
    } else if (p.kind === 'wall' && p.a && p.b && p.type !== 'rail' && p.y1 - p.y0 >= MELT.wallMinH) {
      walls.push({ ax: p.a.x, az: p.a.z, bx: p.b.x, bz: p.b.z, y1: p.y1, half: Math.max(0.1, (p.thickness || 0.13) / 2) });
    }
  }
  for (const t of s.obstacles.trees) {
    const [x, z, R, ht, ev] = t;
    let n = 0, sum = 0;
    for (let j = Math.floor((z - R) / 0.5); j <= Math.floor((z + R) / 0.5); j++) for (let i = Math.floor((x - R) / 0.5); i <= Math.floor((x + R) / 0.5); i++) {
      const d = Math.hypot((i + 0.5) * 0.5 - x, (j + 0.5) * 0.5 - z) / R;
      if (d >= 1) continue;
      n++; sum += ring(d);
    }
    trees.push({ x, z, R, ht, ev: !!ev, norm: ev && sum > 0 ? n / sum : 0 });
  }
  return { roofs, floors, walls, trees };
}
// where unloaded snow lands: between 0.6 and 1.0 of the crown radius, heaviest between
const ring = (d) => { const lo = CANOPY.ringLo, hi = CANOPY.ringHi, mid = (lo + hi) / 2; return d < lo || d > hi ? 0 : 1 - Math.abs(d - mid) / ((hi - lo) / 2); };
const coverage = (d) => 1 - smooth(CANOPY.edgeFrac, 1, d);   // 1 inside the crown, fading at its edge

function roofTop(r, x, z) {
  if (!r.hasFacing) return (r.eaveY + r.ridgeY) / 2;
  const up = -((x - r.ax) * r.fx + (z - r.az) * r.fz);
  return Math.min(r.ridgeY, r.eaveY + Math.max(0, up) * r.slope);
}
function segDist(wl, x, z) {   // distance to a wall's line, the side (+1 / -1 along its normal) and the normal's z
  const dx = wl.bx - wl.ax, dz = wl.bz - wl.az, L2 = dx * dx + dz * dz || 1, u = clamp(((x - wl.ax) * dx + (z - wl.az) * dz) / L2, 0, 1);
  const px = wl.ax + u * dx, pz = wl.az + u * dz, d = Math.hypot(x - px, z - pz), L = Math.sqrt(L2);
  const side = (x - wl.ax) * -dz + (z - wl.az) * dx > 0 ? 1 : -1;   // sign of the left normal (-dz, dx)
  return { d, nz: (side * dx) / L };
}

// the cache for this state, emptied if the site, trees or ground changed since it was filled (call once per step or command)
function prepare(ctx, s) {
  const c = cacheOf(s), site = ctx.get('site'), gs = ctx.get('ground'), ls = ctx.get('landscape'), W = ctx.get('weather');
  const lat = (W && W.site && W.site.latitudeDeg) || 45, sv = site ? site.version : 0, ov = s.obstacles.v, gr = gs ? gs.rev : 0, lr = ls && ls.grid ? ls.grid.rev : 0;
  if (c.sv !== sv || c.ov !== ov || c.gr !== gr || c.lr !== lr || c.lat !== lat) { c.tiles.clear(); c.shapes = null; c.sv = sv; c.ov = ov; c.gr = gr; c.lr = lr; c.lat = lat; }
  return c;
}
function factorsFor(ctx, s, tx, tz) {
  const c = prepare(ctx, s), key = KEY(tx, tz);
  let f = c.tiles.get(key);
  if (f) return f;
  if (!c.shapes) c.shapes = buildShapes(ctx, s);
  f = buildTile(ctx, c.shapes, tx, tz, c.lat);
  c.tiles.set(key, f);
  return f;
}

function buildTile(ctx, sh, tx, tz, lat) {
  const x0 = tx * SPAN, z0 = tz * SPAN, x1 = x0 + SPAN, z1 = z0 + SPAN;
  const through = new Float32Array(NC).fill(1), canopy = new Float32Array(NC), melt = new Float32Array(NC);
  const top = new Float32Array(NL * NL).fill(-1e9), solid = new Uint8Array(NL * NL), gc = new Float32Array(NL * NL);
  // ground on the 1 m lattice (one more point each way), then centres and slopes
  const NV = NL + 1, gv = new Float32Array(NV * NV);
  for (let b = 0; b < NV; b++) for (let a = 0; a < NV; a++) gv[b * NV + a] = groundRead.surfaceY(ctx.state, x0 + a, z0 + b);
  const sun = sunVector(lat);
  const mfl = new Float32Array(NL * NL);
  for (let b = 0; b < NL; b++) for (let a = 0; a < NL; a++) {
    const h00 = gv[b * NV + a], h10 = gv[b * NV + a + 1], h01 = gv[(b + 1) * NV + a], h11 = gv[(b + 1) * NV + a + 1];
    const hx = (h10 + h11 - h00 - h01) / 2, hz = (h01 + h11 - h00 - h10) / 2;
    gc[b * NL + a] = (h00 + h10 + h01 + h11) / 4;
    const cosInc = Math.max(0, (-sun.x * hx + sun.y - sun.z * hz) / Math.sqrt(1 + hx * hx + hz * hz)) / sun.y;   // relative to level ground
    mfl[b * NL + a] = MELT.base + MELT.sun * clamp(cosInc, 0, 2.5);
  }
  const near = (bb, p) => bb[0] <= x1 + p && bb[2] >= x0 - p && bb[1] <= z1 + p && bb[3] >= z0 - p;
  const roofs = sh.roofs.filter((r) => near(r.bb, 0)), floors = sh.floors.filter((r) => near(r.bb, 0));
  const walls = sh.walls.filter((w) => near([Math.min(w.ax, w.bx), Math.min(w.az, w.bz), Math.max(w.ax, w.bx), Math.max(w.az, w.bz)], MELT.northReach + 1));
  const trees = sh.trees.filter((t) => t.x + t.R >= x0 && t.x - t.R <= x1 && t.z + t.R >= z0 && t.z - t.R <= z1);
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
    const n = j * TS + i, x = x0 + (i + 0.5) * GRID.step, z = z0 + (j + 0.5) * GRID.step;
    let th = 1, mf = mfl[(j >> 1) * NL + (i >> 1)], cn = 0;
    for (const r of roofs) if (x >= r.bb[0] && x <= r.bb[2] && z >= r.bb[1] && z <= r.bb[3] && inPoly(r.poly, x, z)) { th = 0; break; }
    if (th) for (const r of floors) if (x >= r.bb[0] && x <= r.bb[2] && z >= r.bb[1] && z <= r.bb[3] && inPoly(r.poly, x, z)) { th = 0; break; }
    for (const wl of walls) {
      const q = segDist(wl, x, z);
      if (q.d <= wl.half) th = 0;
      else if (q.nz > MELT.sideCos && q.d <= MELT.southReach) mf *= MELT.southOfWall;          // the side facing south: sun and reflected heat
      else if (q.nz < -MELT.sideCos && q.d <= MELT.northReach) mf *= MELT.northOfWall;         // the shaded side
    }
    for (const t of trees) {
      const d = Math.hypot(x - t.x, z - t.z) / t.R;
      if (d >= 1) continue;
      const w = coverage(d);
      if (t.ev) {
        const well = 1 - smooth(CANOPY.wellR, CANOPY.wellR + 0.2, d);   // the tree well: within 0.3 R, fading out by 0.5 R
        th *= 1 - (CANOPY.evergreenCatch + (CANOPY.evergreenWell - CANOPY.evergreenCatch) * well) * w;
        mf *= 1 - (1 - MELT.evergreen) * w;
        cn += ring(d) * t.norm;
      } else th *= 1 - CANOPY.decidCatch * w;
    }
    through[n] = th; melt[n] = mf; canopy[n] = cn;
  }
  // obstacle tops and blocked cells on the 1 m lattice, for the wind
  const mark = (a, b, y) => { if (a < 0 || b < 0 || a >= NL || b >= NL) return; solid[b * NL + a] = 1; if (y > top[b * NL + a]) top[b * NL + a] = y; };
  for (const r of roofs) for (let b = 0; b < NL; b++) for (let a = 0; a < NL; a++) { const x = x0 + a + 0.5, z = z0 + b + 0.5; if (inPoly(r.poly, x, z)) mark(a, b, roofTop(r, x, z)); }
  for (const r of floors) for (let b = 0; b < NL; b++) for (let a = 0; a < NL; a++) if (inPoly(r.poly, x0 + a + 0.5, z0 + b + 0.5)) mark(a, b, r.y1);
  for (const wl of walls) {
    const L = Math.hypot(wl.bx - wl.ax, wl.bz - wl.az), n = Math.max(1, Math.ceil(L / 0.25));
    for (let q = 0; q <= n; q++) { const x = wl.ax + ((wl.bx - wl.ax) * q) / n, z = wl.az + ((wl.bz - wl.az) * q) / n; mark(Math.floor(x - x0), Math.floor(z - z0), wl.y1); }
  }
  for (const t of trees) {
    if (!t.ev) continue;   // bare crowns are porous
    for (let b = 0; b < NL; b++) for (let a = 0; a < NL; a++) {
      if (Math.hypot(x0 + a + 0.5 - t.x, z0 + b + 0.5 - t.z) < t.R) { const y = gc[b * NL + a] + t.ht * 0.5; if (y > top[b * NL + a]) top[b * NL + a] = y; }   // evergreens at half height, being porous
    }
  }
  return { through, canopy, melt, top, solid, gc };
}

// ------------------------------------------------------------------------------------------------ tiles
const tileDist = (s, tx, tz) => {
  const dx = Math.max(tx * SPAN - s.focus.x, 0, s.focus.x - (tx + 1) * SPAN), dz = Math.max(tz * SPAN - s.focus.z, 0, s.focus.z - (tz + 1) * SPAN);
  return Math.hypot(dx, dz);
};
const meltTotal = (s, W) => W.totals.meltMm + s.extraMelt;
const newMeta = (s, W) => ({ fall: W.totals.snowfallMm, melt: meltTotal(s, W), unload: s.unloadMm, worked: false });

// A tile for ground nobody has watched: the reference pack times what the cell catches; no history.
function createTile(ctx, s, W, tx, tz) {
  const f = factorsFor(ctx, s, tx, tz), t = SF.newTile(TS), refUm = W.snowSweMm * 1000;
  let sum = 0;
  for (let n = 0; n < NC; n++) { const h = Math.round(refUm * f.through[n]); t.h[n] = h; sum += h; }
  const k = KEY(tx, tz);
  s.grid.tiles[k] = t; s.meta[k] = newMeta(s, W);
  s.totals.fall += sum / 1000;
  return sum > 0;
}
// make sure the tiles a footprint touches exist (from the reference pack where there is snow); true if any was created
function ensureAround(ctx, s, W, x, z, r) {
  let made = false;
  for (const [tx, tz] of SF.keysAround(s.grid, x, z, r)) if (!s.grid.tiles[KEY(tx, tz)] && W.snowSweMm > 0) { createTile(ctx, s, W, tx, tz); made = true; }
  return made;
}
// tiles that a command made without meta (a deposit into empty ground) get the current totals, so they do not catch up on history
function reconcile(s, W) { for (const k in s.grid.tiles) if (!s.meta[k]) s.meta[k] = newMeta(s, W); }
function manage(ctx, s, W) {
  let changed = false;
  if (W.snowSweMm > 0) {
    const R = ACTIVE_R, fx = s.focus.x, fz = s.focus.z;
    for (let tz = Math.floor((fz - R) / SPAN); tz <= Math.floor((fz + R) / SPAN); tz++) for (let tx = Math.floor((fx - R) / SPAN); tx <= Math.floor((fx + R) / SPAN); tx++) {
      if (tileDist(s, tx, tz) > R || s.grid.tiles[KEY(tx, tz)]) continue;
      createTile(ctx, s, W, tx, tz); changed = true;
    }
  }
  const drop = [];
  for (const k in s.grid.tiles) {
    const m = s.meta[k], [tx, tz] = k.split(',').map(Number);
    if (m && m.worked) continue;
    if (tileDist(s, tx, tz) > DROP_R) drop.push(k);
  }
  const c = cacheOf(s);
  for (const k of drop) { delete s.grid.tiles[k]; delete s.meta[k]; c.tiles.delete(k); }
  return changed;
}

// ------------------------------------------------------------------------------------------------ the step
const al = new Int32Array(4), ll = new Int32Array(4);

function windStep(ctx, s, W, act, rhoRef) {
  const T = W.tempC, U = W.windMs, ut = WIND.utC[0] + WIND.utC[1] * T + WIND.utC[2] * T * T;
  if (!(U > ut) || s.freshMm <= WIND.freshMinMm || act.length === 0) return false;
  let tx0 = Infinity, tz0 = Infinity, tx1 = -Infinity, tz1 = -Infinity;
  for (const a of act) { if (a.tx < tx0) tx0 = a.tx; if (a.tx > tx1) tx1 = a.tx; if (a.tz < tz0) tz0 = a.tz; if (a.tz > tz1) tz1 = a.tz; }
  const Wc = (tx1 - tx0 + 1) * NL, Hc = (tz1 - tz0 + 1) * NL, N = Wc * Hc, c = cacheOf(s);
  let L = c.scratch;
  if (!L || L.N < N) {
    L = c.scratch = { N, surf: new Float32Array(N), top: new Float32Array(N), solid: new Uint8Array(N), avail: new Float32Array(N), e: new Float32Array(N), st: new Float32Array(N),
      erode: new Float64Array(N), dep: new Float64Array(N), cur: new Float64Array(N), nxt: new Float64Array(N) };
  }
  L.W = Wc; L.H = Hc;
  L.solid.fill(2, 0, N); L.top.fill(-1e9, 0, N); L.avail.fill(0, 0, N); L.surf.fill(0, 0, N);
  for (const a of act) {
    const H = a.tile.h, Lp = a.tile.l, f = a.f;
    for (let b = 0; b < NL; b++) for (let i = 0; i < NL; i++) {
      const gi = (a.tz - tz0) * NL + b, gj = (a.tx - tx0) * NL + i, idx = gi * Wc + gj, q = 2 * b * TS + 2 * i, m = b * NL + i;
      const h = H[q] + H[q + 1] + H[q + TS] + H[q + TS + 1], lp = Lp[q] + Lp[q + 1] + Lp[q + TS] + Lp[q + TS + 1];
      L.surf[idx] = f.gc[m] + h / 4000 / rhoRef;
      L.top[idx] = f.top[m]; L.solid[idx] = f.solid[m];
      const th = (f.through[q] + f.through[q + 1] + f.through[q + TS] + f.through[q + TS + 1]) / 4, loose = (h - lp) / 4000, fr = s.freshMm * th;
      L.avail[idx] = loose < fr ? loose : fr;
    }
  }
  const dir = W.windDirRad, wx = -Math.sin(dir), wz = Math.cos(dir);   // the way it blows: opposite to where it comes from
  const hours = (WIND.every * ctx.dt) / HOUR;
  const R = SF.transport(L, wx, wz, { ...WIND, pick: WIND.pick * (U - ut) * U * hours });
  if (R.eroded <= 0) return false;
  let eroded = 0, deposited = 0;
  for (const a of act) {
    const H = a.tile.h, Lp = a.tile.l;
    for (let b = 0; b < NL; b++) for (let i = 0; i < NL; i++) {
      const idx = ((a.tz - tz0) * NL + b) * Wc + (a.tx - tx0) * NL + i, q = 2 * b * TS + 2 * i;
      const E = L.erode[idx], D = L.dep[idx];
      if (E > 0) {
        let want = Math.round(E * 4000), sum = 0;
        for (let k = 0; k < 4; k++) { const n = q + (k & 1) + (k >> 1) * TS; ll[k] = H[n] - Lp[n]; sum += ll[k]; }
        if (sum > 0) {
          if (want > sum) want = sum;
          let got = 0;
          for (let k = 0; k < 4; k++) { al[k] = Math.min(ll[k], Math.floor((want * ll[k]) / sum)); got += al[k]; }
          for (let rem = want - got; rem > 0;) { let moved = false; for (let k = 0; k < 4 && rem > 0; k++) if (al[k] < ll[k]) { al[k]++; rem--; moved = true; } if (!moved) break; }
          for (let k = 0; k < 4; k++) { const n = q + (k & 1) + (k >> 1) * TS; H[n] -= al[k]; eroded += al[k]; }
        }
      }
      if (D > 0) {
        const di = Math.round(D * 4000), base = Math.floor(di / 4), rem = di - base * 4;
        for (let k = 0; k < 4; k++) {
          const n = q + (k & 1) + (k >> 1) * TS, add = base + (k < rem ? 1 : 0);
          H[n] += add; Lp[n] = Math.min(H[n], Lp[n] + Math.round(add * WIND.slab)); deposited += add;
        }
      }
    }
  }
  s.totals.blown += (eroded - deposited) / 1000;
  return eroded > 0 || deposited > 0;
}

function step(ctx) {
  let s = ctx.s;
  if (!s || s.v !== V || !s.grid) { ctx.s = s = fresh(ctx); }
  const W = ctx.get('weather');
  if (!W || !W.totals) return;
  const dt = ctx.dt, T = W.tempC, fall = W.totals.snowfallMm, dFallRef = fall - s.seen.fall, g = s.grid;
  const hasTiles = SF.hasTiles(g);
  if (!hasTiles && !(W.snowSweMm > 0) && s.canopyMm === 0 && s.freshMm === 0 && dFallRef === 0) { s.seen.fall = fall; s.seen.melt = W.totals.meltMm; return; }
  let changed = false;
  // crown store
  if (dFallRef > 0 && s.obstacles.trees.some((t) => t[4])) s.canopyMm += dFallRef * CANOPY.gain * (1 - s.canopyMm / CANOPY.capMm);
  if (s.canopyMm > 0) {
    const tau = T > 0 ? CANOPY.tauWarm : W.windMs > CANOPY.windyMs ? CANOPY.tauWindy : CANOPY.tauCalm, shed = s.canopyMm * (1 - Math.exp(-dt / tau));
    s.canopyMm -= shed; s.totals.sublim += CANOPY.sublimated * shed; s.unloadMm += (1 - CANOPY.sublimated) * shed;
    if (s.canopyMm < 1e-6) s.canopyMm = 0;
    if (shed > CANOPY.eventMm) ctx.emit('snow.unload', { mm: shed });
  }
  // the erodible layer
  s.freshMm = s.freshMm * Math.exp(-dt / FRESH_TAU) + dFallRef;
  if (T > 0 || s.freshMm < 1e-4) s.freshMm = 0;
  // once the reference pack is gone, what still lies in the lee of a wall melts by the same degree-day rule
  if (!(W.snowSweMm > 0) && T > 0 && hasTiles) s.extraMelt += DDF * T * dt;
  const fallNow = fall, meltNow = meltTotal(s, W);
  if (manage(ctx, s, W)) changed = true;
  // each active tile catches up with the totals
  const act = [], dead = [], rhoRef = W.snowDensityKgM3 || NEW_DENSITY;
  const cc = prepare(ctx, s);
  for (const k in g.tiles) {
    let m = s.meta[k];
    if (!m) m = s.meta[k] = newMeta(s, W);
    let xy = cc.coords.get(k);
    if (!xy) cc.coords.set(k, xy = k.split(',').map(Number));
    const tx = xy[0], tz = xy[1];
    if (tileDist(s, tx, tz) > ACTIVE_R) continue;
    const tile = g.tiles[k], f = cc.tiles.get(k) || factorsFor(ctx, s, tx, tz);
    act.push({ tx, tz, tile, f });
    const dF = fallNow - m.fall, dM = meltNow - m.melt, dU = s.unloadMm - m.unload;
    if (dF === 0 && dM === 0 && dU === 0) continue;
    const H = tile.h, Lp = tile.l, thr = f.through, can = f.canopy, mf = f.melt, fUm = dF * 1000, uUm = dU * 1000, mUm = dM * 1000;
    let af = 0, au = 0, rm = 0, sum = 0;
    if (!uUm && !(mUm > 0)) {                       // a storm and nothing else: the common case, one multiply a cell
      for (let n = 0; n < NC; n++) { const a = Math.round(thr[n] * fUm); H[n] += a; af += a; }
      sum = af;
    } else {
      for (let n = 0; n < NC; n++) {
        let h = H[n];
        if (fUm) { const a = Math.round(thr[n] * fUm); h += a; af += a; }
        if (uUm) { const a = Math.round(can[n] * uUm); h += a; au += a; }
        if (mUm > 0 && h > 0) { const r = Math.round(mf[n] * mUm); if (r >= h) { rm += h; h = 0; } else { rm += r; h -= r; } }
        H[n] = h; sum += h;
        if (Lp[n] > h) Lp[n] = h;
      }
    }
    m.fall = fallNow; m.melt = meltNow; m.unload = s.unloadMm;
    s.totals.fall += af / 1000; s.totals.unload += au / 1000; s.totals.melt += rm / 1000;
    if (af || au || rm) changed = true;
    if (sum === 0 && !(W.snowSweMm > 0)) dead.push(k);
  }
  if (dead.length) {
    const c = cacheOf(s);
    for (const k of dead) { delete g.tiles[k]; delete s.meta[k]; c.tiles.delete(k); const i = act.findIndex((a) => KEY(a.tx, a.tz) === k); if (i >= 0) act.splice(i, 1); }
  }
  if ((ctx.tick / EVERY) % WIND.every === 0 && windStep(ctx, s, W, act, rhoRef)) changed = true;
  s.seen.fall = fall; s.seen.melt = W.totals.meltMm;
  if (changed) { s.rev++; g.rev++; ctx.emit('snow.changed', {}); }
}

// ------------------------------------------------------------------------------------------------ commands
const pt = (p) => p && num(p.x) && num(p.z);
function touch(s, set) { for (const k of set) if (s.meta[k]) s.meta[k].worked = true; }
function done(ctx, s, changed) { if (changed) { s.rev++; s.grid.rev++; ctx.emit('snow.changed', {}); } }

const commands = {
  'snow.focus'(ctx, p = {}) {
    if (!pt(p)) return fail('no place');
    const s = ctx.s, W = ctx.get('weather');
    s.focus = { x: p.x, z: p.z };
    if (W && W.totals) done(ctx, s, manage(ctx, s, W));
    return { ok: true };
  },
  'snow.tread'(ctx, p = {}) {
    if (!Array.isArray(p.pts) || !p.pts.length || p.pts.length > TOOLS.maxPts) return fail('no treads');
    if (!p.pts.every((q) => Array.isArray(q) && num(q[0]) && num(q[1]) && num(q[2]) && q[2] > 0 && q[2] <= TOOLS.maxTreadR && num(q[3]) && q[3] >= 0 && q[3] <= 1)) return fail('bad tread');
    const s = ctx.s, W = ctx.get('weather');
    if (!W || !W.totals) return fail('no weather');
    const touched = new Set(); let n = 0, made = false;
    for (const [x, z, r, k] of p.pts) {
      if (ensureAround(ctx, s, W, x, z, r)) made = true;
      n += SF.tread(s.grid, x, z, r, k, touched);
    }
    touch(s, touched);
    done(ctx, s, n > 0 || made);
    return { ok: true, cells: n };
  },
  'snow.move'(ctx, p = {}) {
    if (!pt(p) || !num(p.tx) || !num(p.tz)) return fail('no place');
    if (!(num(p.r) && p.r > 0 && p.r <= TOOLS.maxMoveR) || !(num(p.tr) && p.tr > 0 && p.tr <= TOOLS.maxPlaceR)) return fail('bad footprint');
    if (!(num(p.frac) && p.frac > 0 && p.frac <= 1)) return fail('bad share');
    const s = ctx.s, W = ctx.get('weather');
    if (!W || !W.totals) return fail('no weather');
    const g = s.grid, touched = new Set();
    ensureAround(ctx, s, W, p.x, p.z, p.r); ensureAround(ctx, s, W, p.tx, p.tz, p.tr + 1.5);
    const took = SF.take(g, p.x, p.z, p.r, p.frac, touched);
    if (took.h <= 0) return fail('no snow there');
    SF.give(g, p.tx, p.tz, p.tr, took.h, Math.max(took.l, Math.round(took.h * TOOLS.movePacked)), touched);   // thrown snow is half packed (what was packed stays so)
    const rho = ((W.snowDensityKgM3 || NEW_DENSITY) + RHO_PACKED) / 2;
    SF.relax(g, p.tx, p.tz, p.tr + 1.5, TOOLS.repose, 1 / (1000 * rho), touched);
    reconcile(s, W); touch(s, touched); done(ctx, s, true);
    return { ok: true, mm: took.h / 1000 };
  },
  'snow.push'(ctx, p = {}) {
    if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no path');
    if (!(num(p.w) && p.w > 0 && p.w <= TOOLS.maxPushW)) return fail('bad blade');
    if (Math.hypot(p.x1 - p.x0, p.z1 - p.z0) > TOOLS.maxPushLen) return fail('too far in one push');
    const s = ctx.s, W = ctx.get('weather');
    if (!W || !W.totals) return fail('no weather');
    const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2, r = Math.hypot(p.x1 - p.x0, p.z1 - p.z0) / 2 + p.w / 2 + 2, touched = new Set();
    ensureAround(ctx, s, W, mx, mz, r);
    const rho = ((W.snowDensityKgM3 || NEW_DENSITY) + RHO_PACKED) / 2;
    const moved = SF.push(s.grid, p.x0, p.z0, p.x1, p.z1, p.w, { packed: TOOLS.windrowPacked, reach: TOOLS.windrowReach, slope: TOOLS.repose, mpu: 1 / (1000 * rho) }, touched);
    reconcile(s, W); touch(s, touched); done(ctx, s, moved > 0);
    return { ok: true, mm: moved / 1000 };
  },
  'snow.setObstacles'(ctx, p = {}) {
    if (!Array.isArray(p.trees) || p.trees.length > MAX_TREES) return fail('bad trees');
    const trees = [];
    for (const t of p.trees) {
      if (!Array.isArray(t) || !num(t[0]) || !num(t[1]) || !(num(t[2]) && t[2] > 0.2 && t[2] <= 20) || !num(t[3])) return fail('bad tree');
      trees.push([t[0], t[1], t[2], t[3], t[4] ? 1 : 0]);
    }
    const s = ctx.s;
    if (JSON.stringify(trees) !== JSON.stringify(s.obstacles.trees)) { s.obstacles = { v: s.obstacles.v + 1, trees }; }
    return { ok: true, n: trees.length };
  },
  // sandbox: snow falls on the reference pack, the way the weather's own step adds it (the one place that writes another system's state)
  'snow.debugFall'(ctx, p = {}) {
    const W = ctx.get('weather');
    if (!W || !W.totals) return fail('no weather');
    if (!(num(p.mm) && p.mm > 0 && p.mm <= 2000)) return fail('bad amount');
    W.snowDensityKgM3 = (W.snowDensityKgM3 * W.snowSweMm + NEW_DENSITY * p.mm) / (W.snowSweMm + p.mm);
    W.snowSweMm += p.mm; W.totals.snowfallMm += p.mm;
    W.snowDepthM = W.snowSweMm / W.snowDensityKgM3;
    return { ok: true, sweMm: W.snowSweMm };
  },
};

export const snow = { name: 'snow', every: EVERY, init: (ctx) => fresh(ctx), step, commands };

// ------------------------------------------------------------------------------------------------ reads (any state, no ctx)
const SS = (state) => (state && state.sys && state.sys.snow && state.sys.snow.grid ? state.sys.snow : null);
const WW = (state) => (state && state.sys && state.sys.weather && state.sys.weather.totals ? state.sys.weather : null);
const tmp = [0, 0];

// k = how far a presser of bearing density rhoBear packs a column of density rho (0..1)
export function bearing(rho, rhoBear) {
  const den = 1 - rho / RHO_PACKED;
  return den <= 0 ? 0 : clamp((1 - rho / rhoBear) / den, 0, 1);
}
function derive(sweMm, packed, rhoRef, out) {
  const rho = rhoRef + (RHO_PACKED - rhoRef) * packed, depth0 = sweMm / rhoRef;
  out.sweMm = sweMm; out.depth0M = depth0; out.packed = packed; out.rho = rho; out.depthM = sweMm / rho;
  out.sinkM = depth0 * (1 - rho / RHO_PACKED) * bearing(rho, RHO_BEAR.boot) * (1 - packed);
  return out;
}
const ZERO = () => ({ sweMm: 0, depthM: 0, depth0M: 0, packed: 0, rho: NEW_DENSITY, sinkM: 0 });

export const snowRead = {
  // the snowpack at a point, bilinear; the reference pack where there is no tile
  at(state, x, z, out = ZERO()) {
    const s = SS(state), W = WW(state);
    if (!s || !W) return Object.assign(out, ZERO());
    const rhoRef = W.snowDensityKgM3 || NEW_DENSITY;
    SF.sample(s.grid, x, z, W.snowSweMm * 1000, tmp);
    const swe = tmp[0] / 1000;
    return derive(swe, tmp[0] > 0 ? clamp(tmp[1] / tmp[0], 0, 1) : 0, rhoRef, out);
  },
  // fill a Float32Array(n * n * 4) of 0.5 m cells centred on (cx, cz): [depth0 m, rho / 600, packed, 0], toroidal. Returns the snapped origin.
  window(state, cx, cz, n, out) {
    const s = SS(state), W = WW(state);
    if (!s || !W) { out.fill(0, 0, n * n * 4); const i0 = Math.round(cx / GRID.step) - (n >> 1), j0 = Math.round(cz / GRID.step) - (n >> 1); return { x: i0 * GRID.step, z: j0 * GRID.step, i0, j0 }; }
    const rhoRef = W.snowDensityKgM3 || NEW_DENSITY, refUm = W.snowSweMm * 1000, k = 1 / (1000 * rhoRef);
    return SF.fillWindow(s.grid, cx, cz, n, out, (o, q, h, l, has) => {
      if (!has) h = refUm, l = 0;
      if (h > 0) { const p = clamp(l / h, 0, 1); o[q] = h * k; o[q + 1] = (rhoRef + (RHO_PACKED - rhoRef) * p) / 600; o[q + 2] = p; } else { o[q] = 0; o[q + 1] = 0; o[q + 2] = 0; }
      o[q + 3] = 0;
    });
  },
  bearing,
  sinkM: (rho, depth0M, packed) => depth0M * (1 - rho / RHO_PACKED) * bearing(rho, RHO_BEAR.boot) * (1 - packed),
  total: (state) => { const s = SS(state); return s ? SF.total(s.grid) / 1000 : 0; },   // all the deposit, mm x cells
  rev: (state) => { const s = SS(state); return s ? s.rev : 0; },
  canopyMm: (state) => { const s = SS(state); return s ? s.canopyMm : 0; },
  freshMm: (state) => { const s = SS(state); return s ? s.freshMm : 0; },
  trees: (state) => { const s = SS(state); return s ? s.obstacles.trees : []; },
  RHO_BEAR, RHO_PACKED,
};
