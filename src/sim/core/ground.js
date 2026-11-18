// Ground: one surface made of a base height, a coarse "macro" grid and a fine grid. Generic: no words of any one game.
//
//   surfaceY(x, z) = base(x, z) + macro(x, z) + fine(x, z)
//   base:  a pure function (x, z) -> metres, the untouched land (the host's terrain generator)
//   macro: an earthwork-format grid (core/earthwork.js), points 1 m apart, tiles of 32 x 32: machine scale, pads, yards
//   fine:  an earthwork-format grid, points 0.1 m apart: hand scale (spade, trench, footing), owned by the caller
// Base and macro are blended bilinearly over the macro lattice (the way a terrain mesh draws them); fine rides on top.
// Macro and fine are the same data and are edited by the same functions, so one tool works at either scale.
//
// Routing: a footprint narrower than FINE_MAX_R (or `on: 'fine'`) edits fine; wider (or `on: 'macro'`) edits macro
// and first absorbs the fine ground under its core: fine height there is zeroed and its net volume is folded into the
// macro operation, so volume is conserved across the two grids and a machine-graded yard costs a few macro tiles.
//
// G = { v, macro, rev }. Every function takes G, the fine grid (or null) and, where heights are absolute, `base`.
// Regions: { poly: [[x, z]...] } | { path: [[x, z]...], w } | { at: [x, z], r } | { near: [[x, z]...], r }.

import * as EW from './earthwork.js';

export const MACRO_STEP = 1, MACRO_T = 32;
export const FINE_MAX_R = 0.75;           // a footprint at least this wide is machine work, on the macro grid
const CORE_K = 0.8;                       // a round macro op absorbs fine ground within this fraction of its radius
const GRADED = 'graded';

export function makeGround() { return { v: 1, macro: { step: MACRO_STEP, T: MACRO_T, codes: [EW.UNTOUCHED], tiles: {}, rev: 0 }, rev: 0 }; }

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const newTile = (N) => ({ h: new Array(N).fill(0), s: new Array(N).fill(0), l: new Array(N).fill(0), f: new Array(N).fill(0), t: new Array(N).fill(0) });
// the tile and index of lattice point (i, j), creating the tile if asked
function at(g, i, j, make) {
  const tx = Math.floor(i / g.T), tz = Math.floor(j / g.T), k = tx + ',' + tz;
  let t = g.tiles[k];
  if (!t && make) t = g.tiles[k] = newTile(g.T * g.T);
  return t ? [t, (j - tz * g.T) * g.T + (i - tx * g.T), k] : null;
}
const tileEmpty = (t) => ['h', 's', 'l', 'f', 't'].every((c) => t[c].every((v) => v === 0));
// tile keys of g covering the world box (x0, z0)-(x1, z1)
export function keysIn(g, x0, z0, x1, z1) {
  const span = g.step * g.T, out = [];
  for (let tz = Math.floor(z0 / span); tz <= Math.floor(z1 / span); tz++) for (let tx = Math.floor(x0 / span); tx <= Math.floor(x1 / span); tx++) out.push(tx + ',' + tz);
  return out;
}

// ------------------------------------------------------------------------------------------------ regions
export function regionBox(R) {
  if (R.at) return [R.at[0] - R.r, R.at[1] - R.r, R.at[0] + R.r, R.at[1] + R.r];
  const pts = R.poly || R.path || R.near, m = R.path ? R.w / 2 : R.near ? R.r : 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0 - m, z0 - m, x1 + m, z1 + m];
}
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const k = L2 > 0 ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1) : 0;
  return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k);
}
export function inRegion(R, x, z) {
  if (R.at) return Math.hypot(x - R.at[0], z - R.at[1]) < R.r;
  if (R.near) { for (const p of R.near) if (Math.hypot(x - p[0], z - p[1]) < R.r) return true; return false; }
  if (R.path) {
    const p = R.path;
    if (p.length === 1) return Math.hypot(x - p[0][0], z - p[0][1]) <= R.w / 2;
    for (let k = 1; k < p.length; k++) if (segDist(x, z, p[k - 1], p[k]) <= R.w / 2) return true;
    return false;
  }
  const P = R.poly;
  let inside = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
    if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) inside = !inside;
  }
  return inside;
}
export function validRegion(R) {
  const pt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const pts = (a, n) => Array.isArray(a) && a.length >= n && a.length <= 4096 && a.every(pt);
  if (!R || typeof R !== 'object') return false;
  if (R.at) return pt(R.at) && R.r > 0 && R.r < 1000;
  if (R.near) return pts(R.near, 1) && R.r > 0 && R.r < 1000;
  if (R.path) return pts(R.path, 1) && R.w > 0 && R.w < 1000;
  if (R.poly) return pts(R.poly, 3);
  return false;
}
// every lattice point of g inside R, as [i, j]
function* pointsIn(g, R) {
  const s = g.step, [x0, z0, x1, z1] = regionBox(R);
  for (let j = Math.ceil(z0 / s); j <= Math.floor(z1 / s); j++) for (let i = Math.ceil(x0 / s); i <= Math.floor(x1 / s); i++) if (inRegion(R, i * s, j * s)) yield [i, j];
}

// ------------------------------------------------------------------------------------------------ reads
// graded ground: base plus macro, bilinear over the macro lattice
export function gradedY(G, base, x, z) {
  const g = G.macro, s = g.step, fi = x / s, fj = z / s, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const p = (a, b) => base(a * s, b * s) + EW.hAt(g, a, b);
  return lerp(lerp(p(i, j), p(i + 1, j), u), lerp(p(i, j + 1), p(i + 1, j + 1), u), v);
}
export const surfaceY = (G, fine, base, x, z) => gradedY(G, base, x, z) + (fine ? EW.reliefAt(fine, x, z) : 0);
export const reliefTotal = (G, fine, x, z) => EW.reliefAt(G.macro, x, z) + (fine ? EW.reliefAt(fine, x, z) : 0);
// net volume of both grids, m3 (conservation checks)
export const netVolume = (G, fine) => EW.netVolume(G.macro) + (fine ? EW.netVolume(fine) : 0);

const scaleOf = (G, fine, r, on) => (on === 'macro' || on === 'fine' ? (on === 'fine' && !fine ? 'macro' : on) : fine && r < FINE_MAX_R ? 'fine' : 'macro');
const keysRound = (G, x, z, r) => keysIn(G.macro, x - r, z - r, x + r, z + r);

// ------------------------------------------------------------------------------------------------ absorb
// Zero the fine ground inside a region (a machine has scraped it into its own work). Returns its net volume and how
// many fine tiles were left empty and dropped.
export function absorb(G, fine, R) {
  if (!fine) return { m3Net: 0, tilesDropped: 0 };
  let mm = 0, any = false;
  const keys = new Set();
  for (const [i, j] of pointsIn(fine, R)) {
    const a = at(fine, i, j, false);
    if (!a) continue;
    const [t, n, k] = a;
    if (!t.h[n] && !t.s[n] && !t.l[n] && !t.f[n] && !t.t[n]) continue;
    mm += t.h[n];
    t.h[n] = t.s[n] = t.l[n] = t.f[n] = t.t[n] = 0;
    keys.add(k); any = true;
  }
  let dropped = 0;
  for (const k of keys) if (tileEmpty(fine.tiles[k])) { delete fine.tiles[k]; dropped++; }
  if (any) fine.rev++;
  return { m3Net: (mm / 1000) * fine.step * fine.step, tilesDropped: dropped };
}
// absorb() for the fine points whose nearest point on a coarser lattice (spacing `cs`) is in `cells` ('i,j' keys):
// visits only fine tiles that exist inside the box. Returns the net m3 taken.
function absorbCells(fine, cells, cs, box) {
  const fs = fine.step, T = fine.T, span = fs * T;
  let mm = 0, any = false;
  for (const k of keysIn(fine, box[0], box[1], box[2], box[3])) {
    const t = fine.tiles[k];
    if (!t) continue;
    const [tx, tz] = k.split(',').map(Number);
    let hit = false;
    for (let n = 0; n < T * T; n++) {
      if (!t.h[n] && !t.s[n] && !t.l[n] && !t.f[n] && !t.t[n]) continue;
      const x = tx * span + (n % T) * fs, z = tz * span + ((n / T) | 0) * fs;
      if (!cells.has(Math.round(x / cs) + ',' + Math.round(z / cs))) continue;
      mm += t.h[n];
      t.h[n] = t.s[n] = t.l[n] = t.f[n] = t.t[n] = 0;
      hit = true;
    }
    if (!hit) continue;
    any = true;
    if (tileEmpty(t)) delete fine.tiles[k];
  }
  if (any) fine.rev++;
  return (mm / 1000) * fs * fs;
}
// Spread m3 (either sign) over the macro points of a region in whole millimetres; returns what was spread.
function spread(g, R, m3, t) {
  const pts = [...pointsIn(g, R)];
  if (!pts.length || !m3) return 0;
  const A = g.step * g.step, total = Math.round((m3 / A) * 1000), each = Math.trunc(total / pts.length);
  let left = total - each * pts.length;
  const soil = EW.code(g, 'soil');
  for (const [i, j] of pts) {
    const d = each + (left > 0 ? 1 : left < 0 ? -1 : 0);
    if (left > 0) left--; else if (left < 0) left++;
    if (!d) continue;
    const [tl, n] = at(g, i, j, true);
    tl.h[n] += d;
    if (d > 0) { tl.f[n] |= EW.LOOSE_BIT; if (tl.s[n] === 0) { tl.s[n] = soil; tl.t[n] = t; } }
  }
  g.rev++;
  return (total / 1000) * A;
}

// ------------------------------------------------------------------------------------------------ cut, fill, push
// Take up to m3 from a round footprint. Returns { m3, s, on, keys } (keys: macro tiles that changed).
export function cut(G, fine, x, z, m3, { r = 0.17, maxDepth, bare = 'soil', t = 0, on, absorb: abs = true } = {}) {
  const sc = scaleOf(G, fine, r, on);
  if (sc === 'fine') { const res = EW.cut(fine, x, z, m3, { r, maxDepth: maxDepth ?? 1.2, bare, t }); return { m3: res.m3, s: res.s, on: 'fine', keys: [] }; }
  const vf = abs && fine ? absorb(G, fine, { at: [x, z], r: r * CORE_K }).m3Net : 0;
  const want = m3 - vf;
  let got = 0, s = bare;
  if (want > 0) { const res = EW.cut(G.macro, x, z, want, { r, maxDepth: maxDepth ?? 10, bare, t }); got = res.m3; s = res.s; }
  else if (want < 0) got = -EW.fill(G.macro, x, z, -want, { r, surface: bare, t });
  G.rev++;
  return { m3: vf + got, s, on: 'macro', keys: keysRound(G, x, z, r + 1.5) };
}
// Put m3 of loose material on a round footprint. `layer`: laid on top as a layer (earthwork.js). Returns { m3, on, keys }.
export function fill(G, fine, x, z, m3, { r = 0.22, surface = 'soil', layer = false, t = 0, on, absorb: abs = true } = {}) {
  const sc = scaleOf(G, fine, r, on);
  if (sc === 'fine') return { m3: EW.fill(fine, x, z, m3, { r, surface, layer, t }), on: 'fine', keys: [] };
  const vf = abs && fine ? absorb(G, fine, { at: [x, z], r: r * CORE_K }).m3Net : 0;
  const want = m3 + vf;              // the fine ground scraped up joins the load
  let put = 0;
  if (want > 0) put = EW.fill(G.macro, x, z, want, { r, surface, layer, t });
  else if (want < 0) put = -EW.cut(G.macro, x, z, -want, { r, bare: surface, t }).m3;
  G.rev++;
  return { m3: put - vf, on: 'macro', keys: keysRound(G, x, z, r + 1.5) };
}
// A blade pushed from (x0, z0) to (x1, z1), width w, riding at `level` (relief metres on the grid it works, or world
// height with levelIsWorldY). Volume is conserved. Returns { m3 (carried ahead), s, on, keys, settle: [x, z, r] }.
export function push(G, fine, x0, z0, x1, z1, level, { w = 0.45, t = 0, levelIsWorldY = false, base = () => 0, on, absorb: abs = true } = {}) {
  const sc = scaleOf(G, fine, w / 2, on), g = sc === 'fine' ? fine : G.macro;
  let lv = level;
  if (levelIsWorldY) lv = sc === 'fine' ? (x, z) => level - gradedY(G, base, x, z) : (x, z) => level - base(x, z);
  if (sc === 'macro' && abs && fine) {
    const R = { path: [[x0, z0], [x1, z1]], w }, vf = absorb(G, fine, R).m3Net;
    if (vf) spread(G.macro, R, vf, t);         // what the blade scraped off the fine ground joins the macro strip
  }
  const res = EW.push(g, x0, z0, x1, z1, lv, { w, t, ahead: Math.max(0.14, g.step * 1.5) });
  G.rev++;
  const L = Math.hypot(x1 - x0, z1 - z0) + w + 2;
  return { m3: res.m3, s: res.s, on: sc, keys: sc === 'macro' ? keysIn(G.macro, Math.min(x0, x1) - w - 3, Math.min(z0, z1) - w - 3, Math.max(x0, x1) + w + 3, Math.max(z0, z1) + w + 3) : [], settle: [(x0 + x1) / 2, (z0 + z1) / 2, L / 2 + 1, sc] };
}
// Pack loose ground: set a tamp flag (bits[0] after one pass, bits[1] after two or more), clear the loose bit.
export function tamp(G, fine, x, z, r, passes = 1, bits = [0, 0], { on } = {}) {
  const sc = scaleOf(G, fine, r, on), g = sc === 'fine' ? fine : G.macro;
  const setF = passes >= 2 ? bits[1] : bits[0], clearF = EW.LOOSE_BIT | (passes >= 2 ? bits[0] : 0);
  const n = EW.paint(g, x, z, r, { setF, clearF, ok: (p) => p.s !== EW.UNTOUCHED });
  if (n) G.rev++;
  return { n, on: sc, keys: sc === 'macro' && n ? keysRound(G, x, z, r) : [] };
}

// ------------------------------------------------------------------------------------------------ pads and levels
// Level a pad: macro points within `core` of any sample go to targetY; out to `rim` they blend back to the ground
// with a smoothstep (the maths build mode's site cut has always used). `pit`: only ever lowers. Fine ground on the pad
// (every macro cell that ends at least half way to targetY, so the middle of a big pad as well as the ring round its
// samples) is absorbed: a hand-dug hole there is filled, a heap is taken off (counted as fill or cut). Returns
// { cutM3, fillM3, keys }.
export function gradePad(G, fine, base, samples, targetY, { core, rim, pit = false, absorb: abs = true, t = 0 } = {}) {
  const g = G.macro, s = g.step, A = s * s;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of samples) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  let cutM3 = 0, fillM3 = 0;
  const keys = new Set(), graded = EW.code(g, GRADED), pad = new Set();
  for (let j = Math.floor((z0 - rim) / s); j <= Math.ceil((z1 + rim) / s); j++) for (let i = Math.floor((x0 - rim) / s); i <= Math.ceil((x1 + rim) / s); i++) {
    const u = i * s, v = j * s;
    let dist = Infinity;
    for (const [x, z] of samples) { const d = Math.hypot(x - u, z - v); if (d < dist) dist = d; }
    if (dist >= rim) continue;
    const b = base(u, v), cur = b + EW.hAt(g, i, j);
    let k = clamp((dist - core) / (rim - core), 0, 1);
    k = k * k * (3 - 2 * k);
    const want = targetY + (cur - targetY) * k;
    if (pit && want > cur + 0.01) continue;
    if (k <= 0.5) pad.add(i + ',' + j);
    if (!(Math.abs(want - cur) > 0.01)) continue;
    const [tl, n, key] = at(g, i, j, true), mm = Math.round(clamp(want - b, -10, 10) * 1000), d = mm - tl.h[n];
    if (!d) continue;
    tl.h[n] = mm; tl.s[n] = graded; tl.t[n] = t; tl.l[n] = 0; tl.f[n] &= ~EW.LOOSE_BIT;
    if (d < 0) cutM3 -= (d / 1000) * A; else fillM3 += (d / 1000) * A;
    keys.add(key);
  }
  if (keys.size) g.rev++;
  if (abs && fine && pad.size) {
    const vf = absorbCells(fine, pad, s, [x0 - rim, z0 - rim, x1 + rim, z1 + rim]);
    if (vf > 0) cutM3 += vf; else fillM3 -= vf;
  }
  G.rev++;
  // a change at a tile's edge shows in the neighbouring terrain chunk too: report the ring of tiles round the pad
  return { cutM3, fillM3, keys: keys.size ? keysIn(g, x0 - rim - 1, z0 - rim - 1, x1 + rim + 1, z1 + rim + 1) : [] };
}
// Cut the fine ground (the macro grid if there is none) down to world height targetY inside a region. Returns { m3, keys }.
export function trimTo(G, fine, base, R, targetY, { bare = 'soil', t = 0 } = {}) {
  const g = fine || G.macro, s = g.step, A = s * s, c = EW.code(g, bare), keys = new Set();
  let mm = 0;
  for (const [i, j] of pointsIn(g, R)) {
    const y = fine ? gradedY(G, base, i * s, j * s) + EW.hAt(g, i, j) : base(i * s, j * s) + EW.hAt(g, i, j);
    const d = Math.round((y - targetY) * 1000);
    if (d <= 0) continue;
    const [tl, n, k] = at(g, i, j, true);
    tl.h[n] -= d; mm += d;
    if (tl.s[n] === 0 || tl.l[n]) { tl.s[n] = c; tl.t[n] = t; }
    tl.l[n] = 0;
    if (tl.h[n] <= 0) tl.f[n] &= ~EW.LOOSE_BIT;
    keys.add(k);
  }
  if (mm) { g.rev++; G.rev++; }
  return { m3: (mm / 1000) * A, keys: fine ? [] : [...keys] };
}
// How well the ground inside a region matches world height targetY: the fraction of cells within tolUp above and
// tolDown below, and the cells too high and too low as [x, z, d] (d: metres off).
export function conform(G, fine, base, R, targetY, tolUp, tolDown, cellM = 0.2) {
  const [x0, z0, x1, z1] = regionBox(R), high = [], low = [];
  let n = 0, ok = 0;
  for (let z = z0 + cellM / 2; z < z1; z += cellM) for (let x = x0 + cellM / 2; x < x1; x += cellM) {
    if (!inRegion(R, x, z)) continue;
    const d = surfaceY(G, fine, base, x, z) - targetY;
    n++;
    if (d > tolUp) high.push([x, z, d]); else if (d < -tolDown) low.push([x, z, d]); else ok++;
  }
  return { frac: n ? ok / n : 0, n, high, low };
}

// ------------------------------------------------------------------------------------------------ bridge
// Heights of one macro tile from metres (a host's own height deltas): whole millimetres. Returns true if it changed.
export function importTile(G, key, metres) {
  const g = G.macro, N = g.T * g.T;
  let t = g.tiles[key];
  if (!t) { let any = false; for (let n = 0; n < N; n++) if (Math.round(metres[n] * 1000)) { any = true; break; } if (!any) return false; t = g.tiles[key] = newTile(N); }
  let changed = false;
  for (let n = 0; n < N; n++) { const mm = Math.round(metres[n] * 1000) || 0; if (t.h[n] !== mm) { t.h[n] = mm; changed = true; } }
  if (tileEmpty(t)) delete g.tiles[key];
  if (changed) { g.rev++; G.rev++; }
  return changed;
}
// One macro tile's heights in metres into `out` (zeros where nothing was done). Returns whether the tile exists.
export function tileMetres(G, key, out) {
  const t = G.macro.tiles[key];
  if (!t) { out.fill(0); return false; }
  for (let n = 0; n < out.length; n++) out[n] = t.h[n] / 1000;
  return true;
}
