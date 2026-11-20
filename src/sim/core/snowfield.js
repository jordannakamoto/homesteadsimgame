// Snowfield: a granular deposit lying on the ground, on a tiled grid. Generic: it knows nothing of weather or buildings,
// only of a layer of loose material with a part of it packed down, that can be trodden, shovelled, pushed, relaxed to an
// angle of repose and blown along by a wind. Constants come in as parameters.
//
// The cells use the earthwork tile format (core/earthwork.js), so core/earthwork-codec.js packs them in saves unchanged:
//   grid = { step, T, codes: [''], tiles: { 'tx,tz': { h, s, l, f, t } }, rev }   (plain JSON, integers)
//   h  the deposit in a cell, micrometres of water (integer)
//   l  the part of it that is packed, same unit, l <= h
//   s, f, t  unused (zero)
// A cell (i, j) covers [i * step, (i + 1) * step) in x and z; its centre is (i + 0.5) * step.

import { tileKey } from './earthwork.js';
export { tileKey };

export function makeField(step = 0.5, T = 32) { return { step, T, codes: [''], tiles: {}, rev: 0 }; }
export function newTile(T) {
  const N = T * T;
  return { h: new Array(N).fill(0), s: new Array(N).fill(0), l: new Array(N).fill(0), f: new Array(N).fill(0), t: new Array(N).fill(0) };
}
export const tileAt = (g, tx, tz) => g.tiles[tx + ',' + tz] || null;
function tileMake(g, tx, tz) {
  const k = tx + ',' + tz;
  return g.tiles[k] || (g.tiles[k] = newTile(g.T));
}
export function hasTiles(g) { for (const k in g.tiles) return true; return false; }
// total deposit, micrometres x cells
export function total(g) { let v = 0; for (const k in g.tiles) { const h = g.tiles[k].h; for (let n = 0; n < h.length; n++) v += h[n]; } return v; }

// ------------------------------------------------------------------------------------------------ reading
// bilinear between the four cell centres round (x, z); a cell with no tile reads (refH, 0). out = [h, l] in micrometres.
export function sample(g, x, z, refH, out) {
  const s = g.step, T = g.T, fx = x / s - 0.5, fz = z / s - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  let h = 0, l = 0;
  for (let q = 0; q < 4; q++) {
    const ci = i + (q & 1), cj = j + (q >> 1), w = (q & 1 ? u : 1 - u) * (q >> 1 ? v : 1 - v);
    if (w === 0) continue;
    const tx = Math.floor(ci / T), tz = Math.floor(cj / T), t = g.tiles[tx + ',' + tz];
    if (t) { const n = (cj - tz * T) * T + (ci - tx * T); h += w * t.h[n]; l += w * t.l[n]; } else h += w * refH;
  }
  out[0] = h; out[1] = l;
  return out;
}

// Fill a toroidal window of n x n cells centred on (cx, cz) (snapped to cells): cell (i, j) goes to texel (i mod n, j mod n),
// so moving the window rewrites only what came into view. write(out, offset, h, l, hasTile) fills one texel (the caller's
// channels). Returns the snapped origin: world corner of cell (i0, j0).
export function fillWindow(g, cx, cz, n, out, write) {
  const s = g.step, T = g.T, ci = Math.round(cx / s), cj = Math.round(cz / s), i0 = ci - (n >> 1), j0 = cj - (n >> 1);
  let tile = null, ltx = NaN, ltz = NaN;
  for (let j = j0; j < j0 + n; j++) {
    const tz = Math.floor(j / T), jj = ((j % n) + n) % n;
    for (let i = i0; i < i0 + n; i++) {
      const tx = Math.floor(i / T);
      if (tx !== ltx || tz !== ltz) { tile = g.tiles[tx + ',' + tz] || null; ltx = tx; ltz = tz; }
      const ii = ((i % n) + n) % n, o = (jj * n + ii) * 4;
      if (tile) { const q = (j - tz * T) * T + (i - tx * T); write(out, o, tile.h[q], tile.l[q], true); } else write(out, o, 0, 0, false);
    }
  }
  return { x: i0 * s, z: j0 * s, i0, j0 };
}

// ------------------------------------------------------------------------------------------------ footprints
// Cells whose centres lie within r of (x, z), with the cosine falloff the earthwork footprint uses (1 at the centre, 0 at
// the rim): [[i, j, w]]. A footprint smaller than a cell still holds the nearest one.
export function disc(g, x, z, r) {
  const s = g.step, out = [];
  for (let j = Math.floor((z - r) / s); j <= Math.floor((z + r) / s); j++) for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++) {
    const d = Math.hypot((i + 0.5) * s - x, (j + 0.5) * s - z) / r;
    if (d >= 1) continue;
    out.push([i, j, 0.5 + 0.5 * Math.cos(Math.PI * d)]);
  }
  if (!out.length) out.push([Math.floor(x / s), Math.floor(z / s), 1]);
  return out;
}
// the tile keys a footprint of radius r round (x, z) touches
export function keysAround(g, x, z, r) {
  const span = g.step * g.T, out = [];
  for (let tz = Math.floor((z - r) / span); tz <= Math.floor((z + r) / span); tz++) for (let tx = Math.floor((x - r) / span); tx <= Math.floor((x + r) / span); tx++) out.push([tx, tz]);
  return out;
}
function cellRef(g, i, j, make) {
  const T = g.T, tx = Math.floor(i / T), tz = Math.floor(j / T);
  const t = make ? tileMake(g, tx, tz) : g.tiles[tx + ',' + tz];
  return t ? [t, (j - tz * T) * T + (i - tx * T), tx + ',' + tz] : null;
}

// ------------------------------------------------------------------------------------------------ treading
// A presser of bearing ratio k packs the column under its footprint: l = max(l, h * k * w). `touched`: a Set that collects
// the keys of tiles that changed. Returns the number of cells changed.
export function tread(g, x, z, r, k, touched) {
  let n = 0;
  for (const [i, j, w] of disc(g, x, z, r)) {
    const c = cellRef(g, i, j, false);
    if (!c) continue;
    const [t, q, key] = c, want = Math.min(t.h[q], Math.round(t.h[q] * k * w));
    if (want > t.l[q]) { t.l[q] = want; n++; if (touched) touched.add(key); }
  }
  if (n) g.rev++;
  return n;
}

// ------------------------------------------------------------------------------------------------ moving
// Take the fraction `frac` (weighted by the falloff) of the deposit in a footprint, loose part first.
// Returns { h, l }: what was taken, and how much of it was packed.
export function take(g, x, z, r, frac, touched) {
  let th = 0, tl = 0;
  for (const [i, j, w] of disc(g, x, z, r)) {
    const c = cellRef(g, i, j, false);
    if (!c) continue;
    const [t, q, key] = c, h = t.h[q], amt = Math.min(h, Math.round(h * frac * w));
    if (amt <= 0) continue;
    const fromLoose = Math.min(amt, h - t.l[q]), fromPacked = amt - fromLoose;
    t.h[q] = h - amt; t.l[q] -= fromPacked;
    th += amt; tl += fromPacked;
    if (touched) touched.add(key);
  }
  if (th) g.rev++;
  return { h: th, l: tl };
}
// Share `h` over a list of cells [[i, j, w]] by weight, in whole micrometres that add up exactly (largest remainders get
// the odd ones); `packed` of it is packed. Creates tiles as needed.
function spread(g, cells, h, packed, touched) {
  if (!(h > 0) || !cells.length) return 0;
  let wsum = 0; for (const c of cells) wsum += c[2];
  const want = cells.map((c) => (h * c[2]) / wsum), dd = want.map(Math.floor);
  let left = h - dd.reduce((a, b) => a + b, 0);
  const order = want.map((v, q) => [v - Math.floor(v), q]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const o of order) { if (left <= 0) break; dd[o[1]]++; left--; }
  const pf = h > 0 ? Math.min(1, packed / h) : 0;
  for (let q = 0; q < cells.length; q++) {
    if (!dd[q]) continue;
    const [t, n, key] = cellRef(g, cells[q][0], cells[q][1], true);
    t.h[n] += dd[q]; t.l[n] = Math.min(t.h[n], t.l[n] + Math.round(dd[q] * pf));
    if (touched) touched.add(key);
  }
  g.rev++;
  return h;
}
// Put h micrometres (of which `packed` is packed) on a footprint, by the falloff.
export function give(g, x, z, r, h, packed, touched) { return spread(g, disc(g, x, z, r), h, packed, touched); }

// Granular relaxation: a deposit steeper than `slope` (rise per run) between neighbours runs down, the loose part and the
// packed part together in proportion. `mpu`: metres of height per micrometre of deposit. Local to a window round (x, z);
// a cell with no tile is a wall. Conserves the deposit.
const OFF8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];
export function relax(g, x, z, r, slope, mpu, touched, iters = 80) {
  const s = g.step, T = g.T, i0 = Math.floor((x - r) / s), i1 = Math.ceil((x + r) / s), j0 = Math.floor((z - r) / s), j1 = Math.ceil((z + r) / s);
  const cache = new Map();
  const tileOf = (tx, tz) => { const ck = tx * 1e6 + tz; let t = cache.get(ck); if (t === undefined) { t = g.tiles[tx + ',' + tz] || null; cache.set(ck, t); } return t; };
  let any = false;
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let j = j0; j <= j1; j++) {
      const tz = Math.floor(j / T);
      for (let i = i0; i <= i1; i++) {
        const tx = Math.floor(i / T), A = tileOf(tx, tz);
        if (!A) continue;
        const na = (j - tz * T) * T + (i - tx * T), ha = A.h[na];
        if (ha <= 0) continue;
        for (let o = 0; o < 8; o++) {
          const bi = i + OFF8[o][0], bj = j + OFF8[o][1], dl = OFF8[o][2], btx = Math.floor(bi / T), btz = Math.floor(bj / T), B = tileOf(btx, btz);
          if (!B) continue;
          const nb = (bj - btz * T) * T + (bi - btx * T), cur = A.h[na], ex = (cur - B.h[nb]) * mpu - slope * s * dl;
          if (ex <= 0) continue;
          let mv = Math.round((ex / mpu) * 0.15);
          if (mv > cur) mv = cur;
          if (mv < 1) continue;
          const lm = cur > 0 ? Math.round((mv * A.l[na]) / cur) : 0;
          A.h[na] = cur - mv; A.l[na] = Math.min(A.h[na], A.l[na] - lm);
          B.h[nb] += mv; B.l[nb] = Math.min(B.h[nb], B.l[nb] + lm);
          moved += mv;
          if (touched) { touched.add(tx + ',' + tz); touched.add(btx + ',' + btz); }
        }
      }
    }
    if (!moved) break;
    any = true;
  }
  if (any) g.rev++;
  return any;
}

// A blade pushed from (x0, z0) to (x1, z1), w wide: the strip comes clear and what it held is left as a windrow along the
// downstream end and the right-hand side (looking along the push; z runs the way a map's y runs down), `packed` of it
// packed, then relaxed. Conserves the deposit. Returns the micrometres moved.
export function push(g, x0, z0, x1, z1, w, { packed = 0.6, reach = 0.6, slope = 1, mpu = 1e-5 } = {}, touched) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  if (L < 1e-6) return 0;
  const dx = (x1 - x0) / L, dz = (z1 - z0) / L, rx = -dz, rz = dx, hw = w / 2, s = g.step;
  const bx0 = Math.min(x0, x1) - hw - reach - s, bx1 = Math.max(x0, x1) + hw + reach + s, bz0 = Math.min(z0, z1) - hw - reach - s, bz1 = Math.max(z0, z1) + hw + reach + s;
  let th = 0, tl = 0;
  const windrow = [];
  for (let j = Math.floor(bz0 / s); j <= Math.floor(bz1 / s); j++) for (let i = Math.floor(bx0 / s); i <= Math.floor(bx1 / s); i++) {
    const px = (i + 0.5) * s - x0, pz = (j + 0.5) * s - z0, u = px * dx + pz * dz, v = px * rx + pz * rz;
    if (u >= 0 && u < L && Math.abs(v) < hw) {
      const c = cellRef(g, i, j, false);
      if (!c) continue;
      const [t, q, key] = c, h = t.h[q];
      if (h > 0) { th += h; tl += t.l[q]; t.h[q] = 0; t.l[q] = 0; if (touched) touched.add(key); }
    } else if ((u >= L && u < L + reach && Math.abs(v) < hw + reach) || (u >= 0 && u < L && v >= hw && v < hw + reach)) windrow.push([i, j, 1]);
  }
  if (!th) return 0;
  const dropped = spread(g, windrow, th, th * packed, touched);
  if (!dropped) {   // no room for a windrow (cannot happen for a real strip): put it back where it was
    spread(g, [[Math.floor(x0 / s), Math.floor(z0 / s), 1]], th, tl, touched);
  }
  relax(g, (bx0 + bx1) / 2, (bz0 + bz1) / 2, Math.max(bx1 - bx0, bz1 - bz0) / 2 + s, slope, mpu, touched);
  g.rev++;
  return th;
}

// ------------------------------------------------------------------------------------------------ wind transport
// Blown deposit on a working lattice of W x H cells (1 m in the caller's use). The caller fills:
//   surf   Float32Array  surface height of the deposit (ground + its depth), m
//   top    Float32Array  height of an obstacle's top (a building, a crown) or a large negative number
//   solid  Uint8Array    0 free, 1 obstacle (load cannot enter), 2 void (outside the area: load that gets there is lost)
//   avail  Float32Array  erodible deposit per cell, mm
// and scratch Float64Arrays erode, dep, cur, nxt, and Float32Arrays e (the exposure) and st (the share that settles on arrival). (wx, wz) is the unit vector the wind
// blows toward. Pick-up is p.pick * exposure (mm), at most p.pickCap of what is erodible; the load makes p.hops hops, one
// cell each, split between the two neighbours by the wind's components, settling a share clamp(base + gain * (1 - exposure))
// on arrival. A load meeting an obstacle drops a share (1 - over) in front of it and carries the rest over it to the next
// free cell (up to p.reach cells). What is left after the last hop settles where it is. Results: erode and dep per cell
// (mm), and the returned { eroded, blown } totals; eroded = sum of dep + blown.
export function transport(L, wx, wz, p) {
  const W = L.W, H = L.H, N = W * H, { surf, top, solid, avail, e, erode, dep } = L;
  let cur = L.cur, nxt = L.nxt;
  const ux = -wx, uz = -wz, nd = p.dists.length, di = new Int32Array(nd), dj = new Int32Array(nd), dd = new Float64Array(nd);
  let m = 0;
  for (let q = 0; q < nd; q++) {
    const a = Math.round(p.dists[q] * ux), b = Math.round(p.dists[q] * uz);
    if (a || b) { di[m] = a; dj[m] = b; dd[m] = p.dists[q]; m++; }
  }
  erode.fill(0, 0, N); dep.fill(0, 0, N); cur.fill(0, 0, N);
  // exposure from the upwind shelter index, and pick-up
  let eroded = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const idx = j * W + i;
    if (solid[idx]) { e[idx] = 0; continue; }
    const s0 = surf[idx];
    let best = -Infinity;
    for (let q = 0; q < m; q++) {
      const ii = i + di[q], jj = j + dj[q];
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const k = jj * W + ii;
      if (solid[k] === 2) continue;
      let t = surf[k]; if (top[k] > t) t = top[k];
      const v = (t - s0) / dd[q];
      if (v > best) best = v;
    }
    const sx = best === -Infinity ? 0 : best;
    let ex = 1 - sx / p.sxFull; if (ex < 0) ex = 0; else if (ex > p.eMax) ex = p.eMax;
    e[idx] = ex;
    const a = avail[idx];
    if (a > 0 && ex > 0) {
      let pk = p.pick * ex; const cap = p.pickCap * a; if (pk > cap) pk = cap;
      erode[idx] = pk; cur[idx] = pk; eroded += pk;
    }
  }
  if (eroded <= 0) return { eroded: 0, blown: 0 };
  const sgx = wx > 0 ? 1 : wx < 0 ? -1 : 0, sgz = wz > 0 ? 1 : wz < 0 ? -1 : 0, aw = Math.abs(wx) + Math.abs(wz), fx = aw > 0 ? Math.abs(wx) / aw : 0;
  let blown = 0;
  // the share that settles on arrival, per cell (from the exposure), computed once
  const st = L.st;
  for (let idx = 0; idx < N; idx++) { const v = p.settleBase + p.settleGain * (1 - e[idx]); st[idx] = v < 0 ? 0 : v > 1 ? 1 : v; }
  // a load `v` meets an obstacle or the edge of the area on its way from cell `from` into (ti, tj): the slow path of a hop
  const arrive = (ti, tj, v, from, dI, dJ) => {
    if (ti < 0 || tj < 0 || ti >= W || tj >= H) { blown += v; return; }
    let k = tj * W + ti;
    if (solid[k] === 2) { blown += v; return; }
    if (solid[k] === 1) {
      dep[from] += v * (1 - p.over);                 // what does not clear it settles in front
      const over = v * p.over;
      let n = 0;
      while (n < p.reach) {
        ti += dI; tj += dJ; n++;
        if (ti < 0 || tj < 0 || ti >= W || tj >= H) { blown += over; return; }
        k = tj * W + ti;
        if (solid[k] === 2) { blown += over; return; }
        if (solid[k] === 0) break;
      }
      if (solid[k] !== 0) { dep[from] += over; return; }
      v = over;
    }
    const put = v * st[k];
    dep[k] += put; nxt[k] += v - put;
  };
  for (let hop = 0; hop < p.hops; hop++) {
    nxt.fill(0, 0, N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const idx = j * W + i, v = cur[idx];
      if (v <= 0) continue;
      if (fx > 0) {
        const vv = v * fx, ti = i + sgx;
        if (ti >= 0 && ti < W && solid[idx + sgx] === 0) { const k = idx + sgx, put = vv * st[k]; dep[k] += put; nxt[k] += vv - put; } else arrive(ti, j, vv, idx, sgx, 0);
      }
      if (fx < 1) {
        const vv = v * (1 - fx), tj = j + sgz;
        if (tj >= 0 && tj < H && solid[idx + sgz * W] === 0) { const k = idx + sgz * W, put = vv * st[k]; dep[k] += put; nxt[k] += vv - put; } else arrive(i, tj, vv, idx, 0, sgz);
      }
    }
    const tmp = cur; cur = nxt; nxt = tmp;
  }
  for (let idx = 0; idx < N; idx++) if (cur[idx] > 0) dep[idx] += cur[idx];
  L.cur = cur; L.nxt = nxt;
  return { eroded, blown };
}
