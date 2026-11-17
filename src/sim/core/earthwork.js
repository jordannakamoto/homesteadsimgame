// Earthwork: the shape and surface of the ground at hand scale, on a sparse grid of small squares laid over the
// terrain. Generic: it knows nothing of gardens or paths, only of squares that have been cut, filled, smoothed and
// covered. Plain JSON data; every operation conserves volume except cut (which hands the volume back) and fill
// (which takes it).
//
// grid = { cellM, sq: { 'gx,gz': square }, rev }
// square = [h, s, l, t]
//   h: height of the surface above the untouched ground, metres (negative: dug out)
//   s: surface id (string), absent for the untouched surface ('' = untouched)
//   l: thickness of a loose layer laid on top (gravel, bark...), metres, part of h
//   t: when the surface was last set (world seconds), for surfaces that change with time
// Square gx covers x from gx * cellM to (gx + 1) * cellM.
//
// Untouched ground is bound by roots: it holds a vertical face. Worked ground is loose: wherever a loose square
// stands more than `maxStep` above a neighbour, soil runs down to it (the angle of repose: about 35 degrees for
// moist loose soil, so a step of 0.2 m between 0.3 m squares).

export const UNTOUCHED = '';
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const OFF4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeGrid(cellM = 0.3) { return { cellM, sq: {}, rev: 0 }; }
export const keyOf = (gx, gz) => gx + ',' + gz;
export const cellOf = (grid, x) => Math.floor(x / grid.cellM + 1e-9);
export function square(grid, gx, gz) { return grid.sq[keyOf(gx, gz)] || null; }
export function heightOf(grid, gx, gz) { const q = grid.sq[keyOf(gx, gz)]; return q ? q[0] : 0; }
export function surfaceOf(grid, gx, gz) { const q = grid.sq[keyOf(gx, gz)]; return q ? q[1] : UNTOUCHED; }
export const isLoose = (q) => !!q && q[1] !== UNTOUCHED;
function touch(grid, gx, gz, surface) {
  const k = keyOf(gx, gz);
  let q = grid.sq[k];
  if (!q) q = grid.sq[k] = [0, surface == null ? UNTOUCHED : surface, 0, 0];
  return q;
}
// a square back at the untouched height with the untouched surface is forgotten
function tidy(grid, gx, gz) {
  const k = keyOf(gx, gz), q = grid.sq[k];
  if (q && q[1] === UNTOUCHED && Math.abs(q[0]) < 5e-4 && !q[2]) delete grid.sq[k];
}
const area = (grid) => grid.cellM * grid.cellM;

// Take up to m3 from a square. The loose layer comes off first (reported as `layer` with its surface id), then the
// soil below. Returns { m3, layer: { s, m3 } | null }. `bare` is the surface left behind once the layer is gone.
// A square cannot be dug deeper than maxDepth below the untouched ground.
export function cut(grid, gx, gz, m3, { bare = 'soil', maxDepth = 1.2, t = 0 } = {}) {
  const q = touch(grid, gx, gz), A = area(grid);
  let want = Math.max(0, m3), layer = null;
  if (q[2] > 0 && want > 0) {
    const take = Math.min(want, q[2] * A);
    layer = { s: q[1], m3: r4(take) };
    q[2] = r4(q[2] - take / A); q[0] = r4(q[0] - take / A); want -= take;
    if (q[2] <= 1e-4) { q[2] = 0; q[1] = bare; q[3] = t; }
  }
  const room = Math.max(0, q[0] + maxDepth) * A, soil = Math.min(want, room);
  if (soil > 0) { q[0] = r4(q[0] - soil / A); if (!q[2]) { if (q[1] !== bare) q[3] = t; q[1] = bare; } }
  grid.rev++;
  slump(grid, gx, gz);
  tidy(grid, gx, gz);
  return { m3: r4(soil + (layer ? layer.m3 : 0)), soil: r4(soil), layer };
}

// Put m3 of loose material on a square. surface: what the top becomes (soil, or a layer material); layer: true for a
// layer laid on top (it thickens l), false for soil (it buries any layer: the layer is lost into the fill).
export function fill(grid, gx, gz, m3, { surface = 'soil', layer = false, t = 0, spread = true } = {}) {
  if (!(m3 > 0)) return 0;
  const q = touch(grid, gx, gz), A = area(grid), dh = m3 / A;
  q[0] = r4(q[0] + dh);
  if (layer) { if (q[1] !== surface) { q[2] = 0; q[3] = t; } q[1] = surface; q[2] = r4(q[2] + dh); }
  else { if (q[1] !== surface) q[3] = t; q[1] = surface; q[2] = 0; }
  grid.rev++;
  if (spread) slump(grid, gx, gz);
  return m3;
}

// Let loose ground run down until no loose square stands more than maxStep above a neighbour. Soil running onto
// untouched ground covers it (it becomes loose soil). Volume is conserved. Works outward from (gx, gz).
export function slump(grid, gx, gz, maxStep = 0.2, rounds = 24) {
  const A = area(grid);
  let front = [[gx, gz]];
  for (let r = 0; r < rounds && front.length; r++) {
    const next = [];
    for (const [x, z] of front) {
      const q = grid.sq[keyOf(x, z)];
      if (!isLoose(q)) continue;
      for (const [dx, dz] of OFF4) {
        const h = heightOf(grid, x + dx, z + dz), d = q[0] - h;
        if (d <= maxStep + 1e-4) continue;
        const mv = (d - maxStep) / 2;
        if (!grid.sq[keyOf(x + dx, z + dz)] && mv * A < 2e-4) continue;
        const n = touch(grid, x + dx, z + dz);
        q[0] = r4(q[0] - mv); n[0] = r4(n[0] + mv);
        if (q[2] > 0) q[2] = r4(Math.max(0, q[2] - mv));
        if (n[1] === UNTOUCHED) n[1] = 'soil';
        next.push([x + dx, z + dz]);
      }
      // a loose square sunk more than maxStep below a loose neighbour takes soil from it
      for (const [dx, dz] of OFF4) {
        const n = grid.sq[keyOf(x + dx, z + dz)];
        if (!isLoose(n)) continue;
        const d = n[0] - q[0];
        if (d <= maxStep + 1e-4) continue;
        const mv = (d - maxStep) / 2;
        n[0] = r4(n[0] - mv); q[0] = r4(q[0] + mv);
        if (n[2] > 0) n[2] = r4(Math.max(0, n[2] - mv));
        next.push([x + dx, z + dz]);
      }
    }
    front = next;
  }
}

// Smooth loose ground in a round brush toward its local mean (a rake). k: 0..1, the share of the difference taken
// out in one pass. Untouched ground is left alone and takes no part. Volume is conserved within the brush.
export function relax(grid, cx, cz, r, k = 0.5, t = 0) {
  const c = grid.cellM, x0 = Math.floor((cx - r) / c), x1 = Math.floor((cx + r) / c), z0 = Math.floor((cz - r) / c), z1 = Math.floor((cz + r) / c);
  const cells = [];
  for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
    if (Math.hypot((gx + 0.5) * c - cx, (gz + 0.5) * c - cz) > r) continue;
    const q = grid.sq[keyOf(gx, gz)];
    if (isLoose(q)) cells.push([gx, gz, q]);
  }
  if (cells.length < 2) return 0;
  const delta = cells.map(([gx, gz, q]) => {
    let s = 0, n = 0;
    for (const [dx, dz] of OFF4) { const o = grid.sq[keyOf(gx + dx, gz + dz)]; if (isLoose(o)) { s += o[0]; n++; } }
    return n ? (s / n - q[0]) * k * 0.5 : 0;
  });
  // keep the volume: whatever the smoothing added or took is shared back evenly
  const mean = delta.reduce((a, b) => a + b, 0) / cells.length;
  let moved = 0;
  cells.forEach(([, , q], i) => { const d = delta[i] - mean; q[0] = r4(q[0] + d); if (q[2] > 0) q[2] = r4(Math.max(0, q[2] + Math.min(0, d))); moved += Math.abs(d); });
  grid.rev++;
  for (const [gx, gz] of cells) tidy(grid, gx, gz);
  return moved * area(grid) / 2;
}

// Move m3 of soil from one square to another (drawing soil up round a plant). Returns what moved.
export function move(grid, from, to, m3, t = 0) {
  const [fx, fz] = from, [tx, tz] = to;
  const got = cut(grid, fx, fz, m3, { t }).soil;
  const q = grid.sq[keyOf(tx, tz)];
  fill(grid, tx, tz, got, { surface: q && q[2] > 0 ? q[1] : (q && q[1]) || 'soil', layer: !!(q && q[2] > 0), t, spread: false });
  return got;
}

// Set the surface of a square without changing its height (sowing grass on bare soil, a lawn coming back).
export function setSurface(grid, gx, gz, surface, t = 0) {
  const q = touch(grid, gx, gz);
  q[1] = surface; q[3] = t;
  if (surface === UNTOUCHED) q[2] = 0;
  grid.rev++;
  tidy(grid, gx, gz);
}

// Total volume above (+) and below (-) the untouched ground, m3: a check that cut and fill balance.
export function netVolume(grid) {
  let v = 0;
  for (const k in grid.sq) v += grid.sq[k][0];
  return v * area(grid);
}

// Height of the shaped surface above the untouched ground at a point, smoothly: each square's own height at its
// centre, shared heights on the lines and corners between squares, and zero wherever an untouched square meets
// it, so the shape always closes against the ground around it.
export function reliefAt(grid, x, z) {
  const c = grid.cellM, h2 = c / 2;
  // the half-square lattice: vertex (i, j) at x = i * h2
  const fi = x / h2, fj = z / h2, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const a = latticeH(grid, i, j), b = latticeH(grid, i + 1, j), d = latticeH(grid, i, j + 1), e = latticeH(grid, i + 1, j + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
}
// a lattice vertex at half-square steps: odd indices are square centres, even ones square edges
export function latticeH(grid, i, j) {
  const oi = i & 1, oj = j & 1;
  if (oi && oj) return heightOf(grid, (i - 1) >> 1, (j - 1) >> 1);
  // the squares that share this vertex
  const xs = oi ? [(i - 1) >> 1] : [(i >> 1) - 1, i >> 1], zs = oj ? [(j - 1) >> 1] : [(j >> 1) - 1, j >> 1];
  let s = 0, n = 0;
  for (const gz of zs) for (const gx of xs) {
    const q = grid.sq[keyOf(gx, gz)];
    if (!q) return 0;
    s += q[0]; n++;
  }
  return s / n;
}
