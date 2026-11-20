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
// eight neighbours with their distance, so loose earth slides into round cones rather than square pyramids
const OFF8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];
export const REPOSE = 0.7;   // tan 35 degrees
// Two neighbouring points whose flags differ in this bit have a wall between them (a box's side): loose ground
// does not run across it.
export const WALL_BIT = 128;
// Loose material: anything put down (filled, thrown, slid off a heap) is loose and runs down to its angle of repose.
// Ground that was only cut is firm: undisturbed earth holds a steep wall (a spade-dug hole keeps its sides), giving
// way only where a wall is steeper than FIRM. Packing (a tamper) makes loose ground firm again.
export const LOOSE_BIT = 512;
export const FIRM = 1.8;                 // a firm wall holds up to 1.8 m rise per metre (about 60 degrees); steeper, its lip crumbles in

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
// `looseStays`: loose earth left over-steep by the cut is not settled here (the caller lets it slide, grain by grain)
export function cut(g, x, z, m3, { r = 0.17, bare = 'soil', maxDepth = 1.2, t = 0, clearF = 0, looseStays = false } = {}) {
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
      const d = Math.round(Math.max(0, Math.min(room, per * p[2])) * 1000) / 1000;   // whole millimetres, so what is taken is exact
      if (d > 0) {
        tile.h[n] = Math.round((h - d) * 1000);
        if (layer) { tile.l[n] = Math.max(0, tile.l[n] - Math.round(d * 1000)); if (tile.l[n] <= 1) { tile.l[n] = 0; tile.s[n] = code(g, bare); tile.t[n] = t; } }
        else { if (tile.s[n] === 0 || tile.l[n]) { tile.s[n] = code(g, bare); tile.t[n] = t; } tile.l[n] = 0; tile.f[n] &= ~clearF; if (tile.h[n] <= 0) tile.f[n] &= ~LOOSE_BIT; }   // cut down to native ground: firm   // `clearF`: flags that digging undoes (the caller's: how firm it was)
        got += d * A; want -= d * A;
      }
      if (d >= room - 1e-6) p[2] = 0; else w2 += p[2];
    }
    wsum = w2;
    if (!wsum) break;
  }
  g.rev++;
  settle(g, x, z, r + 0.5, REPOSE, 40, looseStays);
  return { m3: got, s: layer ? g.codes[layer] : 'soil' };
}
// Put m3 of loose material on a round footprint centred on (x, z). layer: laid on top (it thickens l; only on loose
// ground unless `onTurf`), else earth (it buries any layer). Then it runs down to its angle of repose.
export function fill(g, x, z, m3, { r = 0.22, surface = 'soil', layer = false, onTurf = true, t = 0, spread = true, markF = 0 } = {}) {
  if (!(m3 > 0)) return 0;
  const fp = footprint(g, x, z, r).filter((p) => onTurf || isLooseCode(sAt(g, p[0], p[1])));
  if (!fp.length) return 0;
  const A = area(g), c = code(g, surface);
  let wsum = 0; for (const p of fp) wsum += p[2];
  // whole millimetres that add up to the load (largest remainders get the odd millimetre), so nothing is rounded away
  const want = fp.map((p) => ((m3 * p[2]) / wsum / A) * 1000), dd = want.map(Math.floor);
  let left = Math.round((m3 / A) * 1000) - dd.reduce((a, b) => a + b, 0);
  for (const k of want.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0])) { if (left <= 0) break; dd[k[1]]++; left--; }
  let put = 0;
  for (let q = 0; q < fp.length; q++) {
    const [i, j] = fp[q], [tile, n] = tileOf(g, i, j, true), d = dd[q];
    put += d;
    tile.h[n] += d;
    if (d > 0) tile.f[n] |= LOOSE_BIT;
    if (layer && markF && tile.s[n] === 0) tile.f[n] |= markF;   // `markF`: flags for a layer laid straight on untouched ground (the caller's)
    if (layer) { if (tile.s[n] !== c) tile.l[n] = 0; tile.l[n] += d; }
    else if (d > 1) tile.l[n] = 0;
    if (d > 1 || layer) { if (tile.s[n] !== c) tile.t[n] = t; tile.s[n] = c; }
  }
  g.rev++;
  if (spread) settle(g, x, z, r + 0.6);
  return (put / 1000) * A;              // what was actually put down (whole millimetres)
}
// The flowing layer (after Zhu and Bridson's two-layer sand: a static heightfield under a thin layer of rolling
// grains). Loose ground steeper than its angle of repose sheds its surface: the excess at each over-steep point is
// taken off the heightfield and handed back as grains for the caller to roll downhill, [x, z, m3, surface, dx, dz]
// (dx, dz: the way down). Grains that come to rest are put back with fill(..., { spread: false }). Volume moves, it is
// never lost: what is shed is the caller's until it lands.
export function shed(g, x, z, r = 0.7, slope = REPOSE, maxM3 = 0.004) {
  const s = g.step, A = area(g), i0 = Math.floor((x - r) / s), i1 = Math.ceil((x + r) / s), j0 = Math.floor((z - r) / s), j1 = Math.ceil((z + r) / s);
  const lim = slope * s * 1000, soil = code(g, 'soil'), out = [];
  let tot = 0;
  for (let j = j0; j <= j1 && tot < maxM3; j++) for (let i = i0; i <= i1 && tot < maxM3; i++) {
    const a = tileOf(g, i, j, false);
    if (!a || a[0].s[a[1]] === 0) continue;
    const [ta, na] = a, loose = (ta.f[na] & LOOSE_BIT) || ta.l[na] > 0;
    if (!loose) continue;
    let best = 0, bx = 0, bz = 0;
    for (const [di, dj, dl] of OFF8) {
      const b = tileOf(g, i + di, j + dj, false), hb = b ? b[0].h[b[1]] : 0;
      if ((ta.f[na] ^ (b ? b[0].f[b[1]] : 0)) & WALL_BIT) continue;
      const d = (ta.h[na] - hb - lim * dl) / dl;
      if (d > best) { best = d; bx = di / dl; bz = dj / dl; }
    }
    if (best < 3) continue;
    let mv = Math.round(best * 0.45);
    if (ta.l[na] > 0) mv = Math.min(mv, ta.l[na]);
    if (mv < 1) continue;
    const name = g.codes[ta.s[na]];
    ta.h[na] -= mv;
    if (ta.l[na] > 0) { ta.l[na] -= mv; if (ta.l[na] <= 0) { ta.l[na] = 0; ta.s[na] = soil; } }
    const m3 = (mv / 1000) * A;
    out.push([i * s, j * s, m3, name, bx, bz]);
    tot += m3;
  }
  if (out.length) g.rev++;
  return out;
}
// Loose ground steeper than its angle of repose runs down (thermal erosion, iterated in the window round (x, z)).
// Untouched turf never gives soil, and takes it only as a cover (it becomes loose soil). Volume is conserved.
// `mask(i, j)`: only points it accepts give or take (a blade face that earth cannot flow back through)
export function settle(g, x, z, r = 0.8, slope = REPOSE, iters = 40, firmOnly = false, mask = null) {
  const s = g.step, i0 = Math.floor((x - r) / s), i1 = Math.ceil((x + r) / s), j0 = Math.floor((z - r) / s), j1 = Math.ceil((z + r) / s);
  const lim = slope * s * 1000, limFirm = Math.max(slope, FIRM) * s * 1000, soil = code(g, 'soil');
  // This is the hot loop of every dig, push and pour, so tiles are looked up through a cache local to this call
  // (nothing else adds or drops tiles while it runs) instead of a string key and a fresh array per neighbour.
  // Same points, same order, same arithmetic as before: the results are identical.
  const T = g.T, cache = new Map();
  const tileAt = (tx, tz, make) => {
    const ck = tx * 1e6 + tz;
    let t = cache.get(ck);
    if (t === undefined) { t = g.tiles[tileKey(tx, tz)] || null; cache.set(ck, t); }
    if (!t && make) { t = tileOf(g, tx * T, tz * T, true)[0]; cache.set(ck, t); }
    return t;
  };
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let j = j0; j <= j1; j++) {
      const tz = Math.floor(j / T);
      for (let i = i0; i <= i1; i++) {
        const tx = Math.floor(i / T), A = tileAt(tx, tz, false);
        if (!A) continue;
        const na = (j - tz * T) * T + (i - tx * T);
        if (A.s[na] === 0) continue;
        const loose = (A.f[na] & LOOSE_BIT) || A.l[na] > 0, la = loose ? lim : limFirm;
        if (loose && firmOnly) continue;
        if (mask && !mask(i, j)) continue;
        for (let o = 0; o < 8; o++) {
          const di = OFF8[o][0], dj = OFF8[o][1], dl = OFF8[o][2], bi = i + di, bj = j + dj;
          if (mask && !mask(bi, bj)) continue;
          const btx = Math.floor(bi / T), btz = Math.floor(bj / T), nb = (bj - btz * T) * T + (bi - btx * T);
          const B = tileAt(btx, btz, false);
          const ha = A.h[na], hb = B ? B.h[nb] : 0, d = ha - hb, lm = la * dl;
          if ((A.f[na] ^ (B ? B.f[nb] : 0)) & WALL_BIT) continue;
          if (d <= lm + 1) continue;
          const mv = Math.round((d - lm) * 0.15);
          if (mv < 1) continue;
          const BB = B || tileAt(btx, btz, true);
          A.h[na] -= mv; BB.h[nb] += mv;
          if (A.l[na]) A.l[na] = Math.max(0, A.l[na] - mv);
          if (BB.s[nb] === 0) BB.s[nb] = A.l[na] ? A.s[na] : soil;
          BB.f[nb] |= LOOSE_BIT;                       // what slid down is loose where it lands
          moved += mv;
        }
      }
    }
    if (!moved) break;
  }
  g.rev++;
}
// The flat of a blade pushed along the ground from (x0, z0) to (x1, z1), riding at relief `level` (metres): loose
// earth and layers above that height in the swept strip (width w) come away in front of the blade; low spots it
// passes are filled from what it pushes, up to the level; what is left is dropped as a ridge just ahead of the blade,
// where the next push picks it up again. Firm ground and turf are not cut. Volume is conserved. Returns
// { m3: what is now in front of the blade, s: its surface }.
// `level` may also be a function (x, z) -> relief metres, for a blade held at one height over uneven untouched ground.
// Optional limits for a hand blade (a shovel): `cap` (m3), what it holds, more spilling off its ends to either side;
// `stop` (m), firm ground standing more than that above the blade where it is going stops it ({ blocked: true }).
export function push(g, x0, z0, x1, z1, level, { w = 0.45, t = 0, ahead: AHEAD = 0.14, cap = Infinity, stop = Infinity } = {}) {
  const st = g.step, A = area(g), L = Math.hypot(x1 - x0, z1 - z0);
  if (L < 1e-4) return { m3: 0, s: '' };
  const ux = (x1 - x0) / L, uz = (z1 - z0) / L, half = w / 2, lvAt = typeof level === 'function' ? (i, j) => Math.round(level(i * st, j * st) * 1000) : null;
  let lv = lvAt ? 0 : Math.round(level * 1000);
  const xs = [x0, x1, x1 + ux * AHEAD], zs = [z0, z1, z1 + uz * AHEAD];
  const i0 = Math.floor((Math.min(...xs) - half) / st), i1 = Math.ceil((Math.max(...xs) + half) / st);
  const j0 = Math.floor((Math.min(...zs) - half) / st), j1 = Math.ceil((Math.max(...zs) + half) / st);
  const swept = [], ahead = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = i * st - x0, pz = j * st - z0, along = px * ux + pz * uz, across = Math.abs(-px * uz + pz * ux);
    if (across > half) continue;
    if (along >= -st * 0.5 && along <= L) swept.push([i, j, along]);
    else if (along > L && along <= L + AHEAD) ahead.push([i, j]);
  }
  // firm ground (the wall of a hole, a bank of undug earth) standing above the blade where it is going: it stops
  if (Number.isFinite(stop)) for (const [i, j, along] of swept) {
    if (along < L - st * 1.5) continue;
    const r = tileOf(g, i, j, false), h = r ? r[0].h[r[1]] : 0, firm = !r || r[0].s[r[1]] === 0 || !((r[0].f[r[1]] & LOOSE_BIT) || r[0].l[r[1]] > 0);
    if (firm && h > (lvAt ? lvAt(i, j) : lv) + stop * 1000) return { m3: 0, s: '', blocked: true };
  }
  // what the blade gathers, by surface (in mm over one point's area)
  const load = new Map();
  let total = 0;
  for (const [i, j] of [...swept, ...ahead]) {
    const r = tileOf(g, i, j, false);
    if (!r) continue;
    const [tl, n] = r, loose = (tl.f[n] & LOOSE_BIT) || tl.l[n] > 0;
    if (lvAt) lv = lvAt(i, j);
    if (!loose || tl.s[n] === 0 || tl.h[n] <= lv) continue;
    // a layer (chips, gravel) comes off on its own, down to what is under it; loose earth down to the level
    const name = tl.l[n] > 0 ? g.codes[tl.s[n]] : 'soil', take = tl.l[n] > 0 ? Math.min(tl.h[n] - lv, tl.l[n]) : tl.h[n] - lv;
    tl.h[n] -= take;
    if (tl.l[n] > 0) { tl.l[n] = Math.max(0, tl.l[n] - take); if (!tl.l[n]) tl.s[n] = code(g, 'soil'); }
    load.set(name, (load.get(name) || 0) + take); total += take;
  }
  // the blade's surface: whatever it holds most of
  let surf = 'soil', most = -1;
  for (const [k, v] of load) if (v > most) { most = v; surf = k; }
  const layer = surf !== 'soil', c = code(g, surf);
  const stopMm = Number.isFinite(stop) ? stop * 1000 : Infinity;
  const put = (i, j, d) => {
    const [tl, n] = tileOf(g, i, j, true);
    // earth pushed up against firm ground standing above a hand blade does not make that ground loose (or the blade
    // would cut the wall of a hole away under the earth it piled there)
    const wall = stopMm < Infinity && !((tl.f[n] & LOOSE_BIT) || tl.l[n] > 0) && tl.h[n] > (lvAt ? lvAt(i, j) : lv) + stopMm;
    tl.h[n] += d; if (!wall) tl.f[n] |= LOOSE_BIT;
    if (layer) { if (tl.s[n] !== c) tl.l[n] = 0; tl.l[n] += d; tl.s[n] = c; } else if (tl.s[n] === 0 || tl.l[n] === 0) { tl.s[n] = code(g, 'soil'); }
    tl.t[n] = t;
  };
  // low spots it passes over fill first, nearest the blade first (that is where the earth is)
  swept.sort((a, b) => b[2] - a[2]);
  for (const [i, j] of swept) {
    if (total <= 0) break;
    const r = tileOf(g, i, j, false), h = r ? r[0].h[r[1]] : 0;
    if (lvAt) lv = lvAt(i, j);
    if (h >= lv) continue;
    const d = Math.min(lv - h, total);
    put(i, j, d); total -= d;
  }
  // more than the blade holds spills off its ends, to either side of it
  const capMm = Number.isFinite(cap) ? Math.round((cap / A) * 1000) : Infinity;
  if (total > capMm) {
    const sides = [];
    for (let j = j0 - 3; j <= j1 + 3; j++) for (let i = i0 - 3; i <= i1 + 3; i++) {
      const px = i * st - x0, pz = j * st - z0, along = px * ux + pz * uz, across = Math.abs(-px * uz + pz * ux);
      if (across > half && across <= half + 0.2 && along >= L - 0.25 && along <= L + AHEAD) sides.push([i, j]);
    }
    if (sides.length) {
      const spill = total - capMm, each = Math.floor(spill / sides.length);
      let left = spill - each * sides.length;
      for (const [i, j] of sides) { const d = each + (left > 0 ? 1 : 0); if (left > 0) left--; if (d > 0) put(i, j, d); }
      total = capMm;
      settle(g, x1, z1, half + 0.45, REPOSE, 8, false, (i, j) => Math.abs(-(i * st - x0) * uz + (j * st - z0) * ux) > half - st * 0.5);
    }
  }
  // the rest rides ahead of the blade as a ridge
  if (total > 0 && ahead.length) {
    const each = Math.floor(total / ahead.length);
    let left = total - each * ahead.length;
    for (const [i, j] of ahead) { const d = each + (left > 0 ? 1 : 0); if (left > 0) left--; if (d > 0) put(i, j, d); }
    total = 0;
  } else if (total > 0) { const i = Math.round(x1 / st), j = Math.round(z1 / st); put(i, j, total); total = 0; }
  // the ridge in front of the blade is loose earth: it slumps to its angle of repose at once (never a wall or a spire)
  settle(g, x1 + ux * AHEAD * 0.5, z1 + uz * AHEAD * 0.5, half + 0.35, REPOSE, 14, false, (i, j) => (i * st - x0) * ux + (j * st - z0) * uz > L + st * 0.3);   // behind it is the blade
  // and the sides of the cut it leaves behind slump into it (the blade face holds the ridge, not the channel's walls)
  settle(g, (x0 + x1) / 2, (z0 + z1) / 2, L / 2 + half + 0.35, REPOSE, 10, false, (i, j) => (i * st - x0) * ux + (j * st - z0) * uz < L - st * 0.3);
  g.rev++;
  return { m3: (most > 0 ? [...load.values()].reduce((a, b) => a + b, 0) : 0) / 1000 * A, s: surf };
}
// The back of a shovel patted down on worked ground: within r the surface is drawn toward the plane that best fits it,
// by k (0..1), with that plane's tilt eased by `level` (0: the slope stays, 1: dead flat), so lumps go at once and
// slopes flatten with each pat; loose earth there is firmed so it stays put. The edge blends over the outer quarter.
// Volume is conserved.
// `firm: false`: smooth without packing (a hoe or a rake working a tilth)
export function pat(g, x, z, r = 0.5, k = 1, level = 0.35, { firm = true } = {}) {
  const st = g.step, pts = [];
  for (let j = Math.floor((z - r) / st); j <= Math.ceil((z + r) / st); j++) for (let i = Math.floor((x - r) / st); i <= Math.ceil((x + r) / st); i++) {
    const dx = i * st - x, dz = j * st - z;
    if (dx * dx + dz * dz > r * r) continue;
    const t = tileOf(g, i, j, false);
    if (!t) continue;
    const [tl, n] = t;
    if (tl.s[n] === 0 || (tl.f[n] & WALL_BIT)) continue;             // worked ground (not turf, not a box wall)
    pts.push([tl, n, dx, dz, tl.h[n]]);
  }
  if (pts.length < 4) return 0;
  // least squares plane h = a + b dx + c dz
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  const N = pts.length;
  for (const [, , dx, dz, h] of pts) { sx += dx; sz += dz; sh += h; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxh += dx * h; szh += dz * h; }
  const mx = sx / N, mz = sz / N, mh = sh / N, cxx = sxx / N - mx * mx, czz = szz / N - mz * mz, cxz = sxz / N - mx * mz, cxh = sxh / N - mx * mh, czh = szh / N - mz * mh;
  const det = cxx * czz - cxz * cxz, b = det > 1e-12 ? (cxh * czz - czh * cxz) / det : 0, c = det > 1e-12 ? (czh * cxx - cxh * cxz) / det : 0;
  // move each point toward the plane by k, in whole millimetres that add back to nothing
  const bl = b * (1 - level), cl = c * (1 - level);
  const want = pts.map(([, , dx, dz, h]) => { const d = Math.hypot(dx, dz) / r, edge = d < 0.75 ? 1 : Math.max(0, (1 - d) / 0.25); return k * edge * (mh + bl * (dx - mx) + cl * (dz - mz) - h); });
  // the blend at the edge would add or take a little: spread the difference evenly so volume stays exact
  { const off = want.reduce((a2, v) => a2 + v, 0) / want.length; for (let q = 0; q < want.length; q++) want[q] -= off; }
  const dd = want.map(Math.round);
  let err = dd.reduce((a2, v) => a2 + v, 0);
  for (let q = 0; err !== 0 && q < dd.length * 2; q++) { const n2 = q % dd.length; const s2 = Math.sign(err); dd[n2] -= s2; err -= s2; }
  let moved = 0;
  pts.forEach(([tl, n], q) => {
    tl.h[n] += dd[q];
    if (tl.l[n] > 0) tl.l[n] = Math.max(0, tl.l[n] + Math.min(0, dd[q]));
    else if (firm) tl.f[n] &= ~LOOSE_BIT;            // patted earth is firm: it stays where it was put
    moved += Math.abs(dd[q]);
  });
  g.rev++;
  return (moved / 1000) * area(g);
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
