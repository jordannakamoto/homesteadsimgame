// Earthwork: the ground as shaped by hand, a smooth heightfield laid over the terrain. Generic: it knows nothing of
// gardens or paths, only of ground that has been cut, filled, smoothed, covered and marked.
//
// The field is a lattice of points 10 cm apart, kept only where something was done, in tiles of 32 x 32 points
// (3.2 m). Each point holds:
//   h  height above the untouched ground, mm (negative: dug out)
//   s  surface code (an index into grid.codes; 0 is the untouched surface, bound by roots)
//   l  thickness of a loose layer on top (gravel, chips...), mm, part of h
//   f  flags (bit field, meaning given by the caller: liner, fabric, how well tamped...)
//   t  when the surface was last set (hours on the caller's clock), for surfaces that change with time
// Between points the ground is the bilinear blend of the four round it, so it is smooth everywhere.
//
// Tools work with round footprints (a blade, a rake, a heap landing) that fade out at their rim. Loose ground runs
// down wherever it is steeper than its angle of repose (about 35 degrees for moist loose soil), the way a heap
// spreads; untouched turf holds a straight face. Everything conserves volume except cut (which hands the volume
// back) and fill (which takes it).
//
// grid = { step, T, codes: [''], tiles: { 'tx,tz': { h: [], s: [], l: [], f: [], t: [] } }, rev }   (plain JSON)

export const UNTOUCHED = '';
const STEP = 0.1, TS = 32, N = TS * TS;
const OFF4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const REPOSE = 0.7;   // tan 35 degrees
// Two neighbouring points whose flags differ in this bit have a wall between them (a box's side): loose ground
// does not run across it.
export const WALL_BIT = 128;

export function makeGrid() { return { step: STEP, T: TS, codes: [UNTOUCHED], tiles: {}, rev: 0 }; }
export const tileKey = (tx, tz) => tx + ',' + tz;
const area = (g) => g.step * g.step;
export function code(g, name) { let i = g.codes.indexOf(name); if (i < 0) { g.codes.push(name); i = g.codes.length - 1; } return i; }
export const nameOf = (g, c) => g.codes[c] ?? UNTOUCHED;

// ------------------------------------------------------------------------------------------------ points
function tileOf(g, i, j, make) {
  const tx = Math.floor(i / g.T), tz = Math.floor(j / g.T), k = tileKey(tx, tz);
  let t = g.tiles[k];
  if (!t && make) t = g.tiles[k] = { h: new Array(N).fill(0), s: new Array(N).fill(0), l: new Array(N).fill(0), f: new Array(N).fill(0), t: new Array(N).fill(0) };
  return t ? [t, (j - tz * g.T) * g.T + (i - tx * g.T)] : null;
}
// the point (i, j): { h, s, l, f, t } in metres and names, or null where nothing was done
export function point(g, i, j) {
  const r = tileOf(g, i, j, false);
  if (!r) return null;
  const [t, n] = r;
  return { h: t.h[n] / 1000, s: g.codes[t.s[n]], l: t.l[n] / 1000, f: t.f[n], t: t.t[n] };
}
export const hAt = (g, i, j) => { const r = tileOf(g, i, j, false); return r ? r[0].h[r[1]] / 1000 : 0; };
export const sAt = (g, i, j) => { const r = tileOf(g, i, j, false); return r ? r[0].s[r[1]] : 0; };
export const fAt = (g, i, j) => { const r = tileOf(g, i, j, false); return r ? r[0].f[r[1]] : 0; };
export const lAt = (g, i, j) => { const r = tileOf(g, i, j, false); return r ? r[0].l[r[1]] / 1000 : 0; };
export function setPoint(g, i, j, p) {
  const [t, n] = tileOf(g, i, j, true);
  if (p.h != null) t.h[n] = Math.round(p.h * 1000);
  if (p.s != null) t.s[n] = typeof p.s === 'number' ? p.s : code(g, p.s);
  if (p.l != null) t.l[n] = Math.max(0, Math.round(p.l * 1000));
  if (p.f != null) t.f[n] = p.f;
  if (p.t != null) t.t[n] = Math.round(p.t);
}
export const isLooseCode = (c) => c !== 0;
// every point within r of (x, z), with its weight (1 at the centre, fading smoothly to 0 at the rim)
export function footprint(g, x, z, r) {
  const s = g.step, out = [];
  for (let j = Math.ceil((z - r) / s); j <= Math.floor((z + r) / s); j++) for (let i = Math.ceil((x - r) / s); i <= Math.floor((x + r) / s); i++) {
    const d = Math.hypot(i * s - x, j * s - z) / r;
    if (d >= 1) continue;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
    out.push([i, j, w]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ height
// Height of the shaped ground above the untouched ground at a world point, metres: smooth everywhere.
export function reliefAt(g, x, z) {
  const s = g.step, fi = x / s, fj = z / s, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const a = hAt(g, i, j), b = hAt(g, i + 1, j), c = hAt(g, i, j + 1), d = hAt(g, i + 1, j + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
// the surface at a point: the name at the nearest lattice point
export function surfaceAt(g, x, z) { return g.codes[sAt(g, Math.round(x / g.step), Math.round(z / g.step))]; }
export function netVolume(g) { let v = 0; for (const k in g.tiles) for (const h of g.tiles[k].h) v += h; return (v / 1000) * area(g); }

// ------------------------------------------------------------------------------------------------ cut and fill
// Take up to m3 from a round footprint centred on (x, z) (a blade's bite). If a loose layer lies at the centre the
// bite takes the layer only (a scoop is gravel, or earth, never both). Returns { m3, s } (s: what was taken).
// `bare`: the surface left where earth was taken; maxDepth: how deep the tool reaches below the untouched ground.
export function cut(g, x, z, m3, { r = 0.17, bare = 'soil', maxDepth = 1.2, t = 0, clearF = 0 } = {}) {
  const fp = footprint(g, x, z, r), A = area(g);
  if (!fp.length || !(m3 > 0)) return { m3: 0, s: bare };
  const ci = Math.round(x / g.step), cj = Math.round(z / g.step), layer = lAt(g, ci, cj) > 0.002 ? sAt(g, ci, cj) : 0;
  let wsum = 0;
  for (const p of fp) wsum += p[2];
  let want = m3, got = 0;
  // two passes: points that run out pass their share to the rest
  for (let pass = 0; pass < 3 && want > 1e-7; pass++) {
    const per = want / wsum / A;
    let w2 = 0;
    for (const p of fp) {
      if (!p[2]) continue;
      const [tile, n] = tileOf(g, p[0], p[1], true), h = tile.h[n] / 1000;
      let room = layer ? (tile.s[n] === layer ? tile.l[n] / 1000 : 0) : h + maxDepth;
      const d = Math.max(0, Math.min(room, per * p[2]));
      if (d > 0) {
        tile.h[n] = Math.round((h - d) * 1000);
        if (layer) { tile.l[n] = Math.max(0, tile.l[n] - Math.round(d * 1000)); if (tile.l[n] <= 1) { tile.l[n] = 0; tile.s[n] = code(g, bare); tile.t[n] = t; } }
        else { if (tile.s[n] === 0 || tile.l[n]) { tile.s[n] = code(g, bare); tile.t[n] = t; } tile.l[n] = 0; tile.f[n] &= ~clearF; }   // `clearF`: flags that digging undoes (the caller's: how firm it was)
        got += d * A; want -= d * A;
      }
      if (d >= room - 1e-6) p[2] = 0; else w2 += p[2];
    }
    wsum = w2;
    if (!wsum) break;
  }
  g.rev++;
  settle(g, x, z, r + 0.5);
  return { m3: got, s: layer ? g.codes[layer] : 'soil' };
}
// Put m3 of loose material on a round footprint centred on (x, z). layer: laid on top (it thickens l; only on loose
// ground unless `onTurf`), else earth (it buries any layer). Then it runs down to its angle of repose.
export function fill(g, x, z, m3, { r = 0.22, surface = 'soil', layer = false, onTurf = true, t = 0, spread = true } = {}) {
  if (!(m3 > 0)) return 0;
  const fp = footprint(g, x, z, r).filter((p) => onTurf || isLooseCode(sAt(g, p[0], p[1])));
  if (!fp.length) return 0;
  const A = area(g), c = code(g, surface);
  let wsum = 0; for (const p of fp) wsum += p[2];
  for (const [i, j, w] of fp) {
    const [tile, n] = tileOf(g, i, j, true), d = Math.round(((m3 * w) / wsum / A) * 1000);
    tile.h[n] += d;
    if (layer) { if (tile.s[n] !== c) tile.l[n] = 0; tile.l[n] += d; }
    else if (d > 1) tile.l[n] = 0;
    if (d > 1 || layer) { if (tile.s[n] !== c) tile.t[n] = t; tile.s[n] = c; }
  }
  g.rev++;
  if (spread) settle(g, x, z, r + 0.6);
  return m3;
}
// Loose ground steeper than its angle of repose runs down (thermal erosion, iterated in the window round (x, z)).
// Untouched turf never gives soil, and takes it only as a cover (it becomes loose soil). Volume is conserved.
export function settle(g, x, z, r = 0.8, slope = REPOSE, iters = 40) {
  const s = g.step, i0 = Math.floor((x - r) / s), i1 = Math.ceil((x + r) / s), j0 = Math.floor((z - r) / s), j1 = Math.ceil((z + r) / s);
  const lim = slope * s * 1000, soil = code(g, 'soil');
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = tileOf(g, i, j, false);
      if (!a || a[0].s[a[1]] === 0) continue;
      for (const [di, dj] of OFF4) {
        const ha = a[0].h[a[1]], b = tileOf(g, i + di, j + dj, false), hb = b ? b[0].h[b[1]] : 0, d = ha - hb;
        if ((a[0].f[a[1]] ^ (b ? b[0].f[b[1]] : 0)) & WALL_BIT) continue;
        if (d <= lim + 1) continue;
        const mv = Math.round((d - lim) * 0.25);
        if (mv < 1) continue;
        const bb = b || tileOf(g, i + di, j + dj, true);
        a[0].h[a[1]] -= mv; bb[0].h[bb[1]] += mv;
        if (a[0].l[a[1]]) a[0].l[a[1]] = Math.max(0, a[0].l[a[1]] - mv);
        if (bb[0].s[bb[1]] === 0) bb[0].s[bb[1]] = a[0].l[a[1]] ? a[0].s[a[1]] : soil;
        moved += mv;
      }
    }
    if (!moved) break;
  }
  g.rev++;
}
// Smooth loose ground in a round footprint toward its neighbours (a rake), keeping its volume. k: 0..1 a pass.
export function relax(g, x, z, r = 0.35, k = 0.5) {
  const fp = footprint(g, x, z, r).filter((p) => isLooseCode(sAt(g, p[0], p[1])));
  if (fp.length < 3) return 0;
  const d = fp.map(([i, j, w]) => {
    let s = 0, n = 0;
    for (const [di, dj] of OFF4) if (!((fAt(g, i, j) ^ fAt(g, i + di, j + dj)) & WALL_BIT) && (isLooseCode(sAt(g, i + di, j + dj)) || Math.abs(hAt(g, i + di, j + dj)) > 0)) { s += hAt(g, i + di, j + dj); n++; }
    return n ? (s / n - hAt(g, i, j)) * k * w : 0;
  });
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  let moved = 0;
  fp.forEach(([i, j], n) => { const [t, q] = tileOf(g, i, j, true), dd = d[n] - mean; t.h[q] += Math.round(dd * 1000); if (t.l[q] && dd < 0) t.l[q] = Math.max(0, t.l[q] + Math.round(dd * 1000)); moved += Math.abs(dd); });
  g.rev++;
  return (moved * area(g)) / 2;
}
// Strip the untouched surface in a footprint: it becomes loose `bare` ground `depth` lower. Returns m3 taken.
export function strip(g, x, z, r, depth, { bare = 'soil', t = 0 } = {}) {
  let m = 0;
  for (const [i, j, w] of footprint(g, x, z, r)) {
    if (w < 0.25 || sAt(g, i, j) !== 0) continue;
    const [tile, n] = tileOf(g, i, j, true);
    tile.h[n] -= Math.round(depth * 1000); tile.s[n] = code(g, bare); tile.t[n] = t; m += depth * area(g);
  }
  if (m) g.rev++;
  return m;
}
// Set the surface (and optionally flags) of the points in a footprint, where `ok(point)` allows.
export function paint(g, x, z, r, { surface = null, setF = 0, clearF = 0, t = 0, ok = () => true } = {}) {
  let n = 0;
  for (const [i, j, w] of footprint(g, x, z, r)) {
    if (w < 0.2) continue;
    const p = point(g, i, j) || { h: 0, s: UNTOUCHED, l: 0, f: 0, t: 0 };
    if (!ok(p, i, j)) continue;
    const [tile, q] = tileOf(g, i, j, true);
    if (surface != null) { tile.s[q] = code(g, surface); tile.t[q] = t; if (surface === UNTOUCHED) tile.l[q] = 0; }
    tile.f[q] = (tile.f[q] | setF) & ~clearF;
    n++;
  }
  if (n) g.rev++;
  return n;
}
// Move m3 of earth from one point to another (soil drawn up round a plant).
export function move(g, from, to, m3, t = 0) {
  const got = cut(g, from[0], from[1], m3, { r: 0.12, t }).m3;
  fill(g, to[0], to[1], got, { r: 0.12, t, spread: false });
  return got;
}
// Every point that has been worked (any surface but the untouched one, or moved more than `minH`), as
// [i, j, h, code, l, f]: for drawing, masks and slow changes.
export function* worked(g, minH = 0.004) {
  for (const k in g.tiles) {
    const t = g.tiles[k], [tx, tz] = k.split(',').map(Number);
    for (let n = 0; n < N; n++) {
      if (t.s[n] === 0 && Math.abs(t.h[n]) < minH * 1000 && !t.f[n]) continue;
      yield [tx * g.T + (n % g.T), tz * g.T + Math.floor(n / g.T), t.h[n] / 1000, t.s[n], t.l[n] / 1000, t.f[n], t.t[n], t, n];
    }
  }
}
