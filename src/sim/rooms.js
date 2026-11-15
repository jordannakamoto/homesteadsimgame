// Rooms: the enclosed volumes of everything built, found from the real geometry of the pieces.
// Pure: findRooms(pieces) reads only the piece list (ARCHITECTURE.md, "The piece interface") and
// returns plain data. The thermal system is its first user; anything that asks "which room is this in"
// or "is this space closed" can use it too.
//
// How it works. In plan, every floor outline, every wall and the edge of every roof plane or floor
// above is a straight line. Those lines cut the floor into convex cells. Two cells that share an edge
// are the same room unless a wall stands on that edge; a cell's ceiling is the lowest roof or floor
// over it; a balcony edge that looks into the room below (a stairwell, a tower landing) joins the two.
// A room is closed when every outer edge has a full-height wall with nothing bigger than a crack in
// it and every cell has a roof. Everything is tolerant of gaps of a few centimetres.
//
// Unbuilt pieces (built: false) do not exist yet: a house is judged as it stands.
//
// Known limits: partitions are taken to close a room even where the roof space above them is open;
// a storey joined to the one below by an open stairwell is one room with it; curved roofs (domes) are
// one surface facing straight up; wall thickness is ignored (areas are on the drawn lines).

import { material } from './materials.js';

const TAU = Math.PI * 2;
const TOL = 0.03;        // m: lines closer than this are one line (walls snap to floor edges)
const EPS = 1e-7;
const GAP_M = 0.1;       // m: an unwalled run of edge longer than this is a hole, shorter is a crack
const MIN_WALL = 1.6;    // m above the floor a wall must reach to close a room (rails and parapets do not)
const VERT_TOL = 0.75;   // m: allowed between a wall top and the roof line (roof thickness, eave detail)
const HOLE_M2 = 0.5;     // m2: an unfilled opening this big leaves the room open; smaller ones are draughts
const HEADROOM = 1.8;    // m: a floor or another building's roof must be this far up to be a ceiling

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bearing = (x, z) => { const a = Math.atan2(x, -z); return a < 0 ? a + TAU : a; };   // +x east, +z south
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassName = (az) => COMPASS[Math.round((((az % TAU) + TAU) % TAU) / (TAU / 8)) % 8];

// ------------------------------------------------------------------------------------ plan geometry
function loopArea(P) { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inLoop(P, x, z) {
  let c = false;
  for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function inFloor(f, x, z) {
  if (!inLoop(f.loops[0], x, z)) return false;
  for (let i = 1; i < f.loops.length; i++) if (inLoop(f.loops[i], x, z)) return false;
  return true;
}
function bboxOf(P) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } return { x0, z0, x1, z1 }; }
const bbHit = (a, b, g = 0) => a.x0 <= b.x1 + g && b.x0 <= a.x1 + g && a.z0 <= b.z1 + g && b.z0 <= a.z1 + g;

// A convex cell: corners (xs, zs) and, for the edge leaving each corner, the id of the line it lies on.
function metrics(c) {
  let a = 0, cx = 0, cz = 0; const n = c.xs.length;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, w = c.xs[i] * c.zs[j] - c.xs[j] * c.zs[i]; a += w; cx += (c.xs[i] + c.xs[j]) * w; cz += (c.zs[i] + c.zs[j]) * w; }
  c.area = Math.abs(a / 2);
  if (Math.abs(a) > 1e-12) { c.cx = cx / (3 * a); c.cz = cz / (3 * a); } else { c.cx = c.xs[0]; c.cz = c.zs[0]; }
  c.ccw = a > 0;
  return c;
}
function split(c, L, li) {
  const n = c.xs.length, s = new Array(n), v = new Array(n);
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) { v[i] = L.nx * c.xs[i] + L.nz * c.zs[i] - L.d; s[i] = v[i] > EPS ? 1 : v[i] < -EPS ? -1 : 0; if (s[i] > 0) pos = true; else if (s[i] < 0) neg = true; }
  if (!pos || !neg) return null;
  const A = { xs: [], zs: [], ids: [], floor: c.floor }, B = { xs: [], zs: [], ids: [], floor: c.floor };
  const put = (P, x, z, id) => { P.xs.push(x); P.zs.push(z); P.ids.push(id); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, si = s[i], sj = s[j], e = c.ids[i], x = c.xs[i], z = c.zs[i];
    const cross = si * sj < 0, t = cross ? v[i] / (v[i] - v[j]) : 0, X = x + t * (c.xs[j] - x), Z = z + t * (c.zs[j] - z);
    if (si >= 0) put(A, x, z, sj >= 0 ? e : si > 0 ? e : li);
    if (si <= 0) put(B, x, z, sj <= 0 ? e : si < 0 ? e : li);
    if (cross) { put(A, X, Z, si > 0 ? li : e); put(B, X, Z, si < 0 ? li : e); }
  }
  return [A, B];
}
function inCell(c, x, z) {
  let s = 0; const n = c.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, cr = (c.xs[j] - c.xs[i]) * (z - c.zs[i]) - (c.zs[j] - c.zs[i]) * (x - c.xs[i]);
    if (cr > 1e-9) { if (s < 0) return false; s = 1; } else if (cr < -1e-9) { if (s > 0) return false; s = -1; }
  }
  return true;
}
// area shared by two convex cells
function overlapArea(A, B) {
  let px = A.xs, pz = A.zs; const n = B.xs.length, sg = B.ccw ? 1 : -1;
  for (let i = 0; i < n && px.length >= 3; i++) {
    const j = (i + 1) % n, ex = B.xs[j] - B.xs[i], ez = B.zs[j] - B.zs[i], qx = [], qz = [];
    for (let k = 0, m = px.length; k < m; k++) {
      const l = (k + 1) % m;
      const sk = sg * (ex * (pz[k] - B.zs[i]) - ez * (px[k] - B.xs[i])), sl = sg * (ex * (pz[l] - B.zs[i]) - ez * (px[l] - B.xs[i]));
      if (sk >= 0) { qx.push(px[k]); qz.push(pz[k]); }
      if ((sk > 0 && sl < 0) || (sk < 0 && sl > 0)) { const t = sk / (sk - sl); qx.push(px[k] + t * (px[l] - px[k])); qz.push(pz[k] + t * (pz[l] - pz[k])); }
    }
    px = qx; pz = qz;
  }
  if (px.length < 3) return 0;
  let a = 0; for (let i = 0, m = px.length; i < m; i++) { const j = (i + 1) % m; a += px[i] * pz[j] - px[j] * pz[i]; }
  return Math.abs(a / 2);
}
// integral of h(x, z) over a cell (exact for flat and sloping ceilings: edge-midpoint rule on a fan)
function integrate(c, h) {
  let sum = 0; const n = c.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = c.xs[i], az = c.zs[i], bx = c.xs[j], bz = c.zs[j];
    const ar = Math.abs((ax - c.cx) * (bz - c.cz) - (bx - c.cx) * (az - c.cz)) / 2;
    sum += (ar / 3) * (h((c.cx + ax) / 2, (c.cz + az) / 2) + h((ax + bx) / 2, (az + bz) / 2) + h((bx + c.cx) / 2, (bz + c.cz) / 2));
  }
  return sum;
}

// ------------------------------------------------------------------------------------ reading pieces
const COVERING_CLASS = { roofing: 1, metal: 1, glass: 1, membrane: 1, fabric: 1 };
function weatherproof(p) {
  if (!Array.isArray(p.layers)) return true;                       // nothing said about its build-up: take it as finished
  return p.layers.some((l) => l && (l.role === 'covering' || l.role === 'roofing' || (material(l.material) && COVERING_CLASS[material(l.material).class])));
}
function roofRec(p) {
  const poly = p.footprint.map((q) => [q.x, q.z]);
  const eave = num(p.eaveY, num(p.y0, 0)), ridge = num(p.ridgeY, num(p.y1, eave)), rise = ridge - eave;
  const r = { p, id: p.id, struct: p.struct, poly, bb: bboxOf(poly), yMax: Math.max(eave, ridge), fan: null, facetAt: () => 0, tight: weatherproof(p) };
  const ax = p.a ? p.a.x : poly[0][0], az = p.a ? p.a.z : poly[0][1], bx = p.b ? p.b.x : ax, bz = p.b ? p.b.z : az, el = Math.hypot(bx - ax, bz - az);
  if (!(rise > 1e-6)) {                                             // flat: the underside is its y0
    const h = Math.min(eave, num(p.y0, eave));
    r.heightAt = () => h; r.facets = [{ az: 0, tilt: 0, k: 1 }];
  } else if (p.type === 'dome' && p.radius > 0) {
    const re = p.radius;
    r.heightAt = (x, z) => eave + rise * Math.sqrt(Math.max(0, 1 - ((x - ax) ** 2 + (z - az) ** 2) / (re * re)));
    r.facets = [{ az: 0, tilt: 0, k: p.area > 0 && p.planArea > 0 ? p.area / p.planArea : 1.4 }];
  } else if (el > 1e-6 && !p.facets) {                              // one plane rising from its eave edge a-b
    let mx = -(bz - az) / el, mz = (bx - ax) / el; const f = p.facing;
    if (f && Math.hypot(f.x, f.z) > 1e-6) { if (mx * f.x + mz * f.z > 0) { mx = -mx; mz = -mz; } }
    else { let cx = 0, cz = 0; for (const q of poly) { cx += q[0]; cz += q[1]; } if ((cx / poly.length - ax) * mx + (cz / poly.length - az) * mz < 0) { mx = -mx; mz = -mz; } }
    let run = 1e-3; for (const q of poly) run = Math.max(run, (q[0] - ax) * mx + (q[1] - az) * mz);
    r.heightAt = (x, z) => eave + rise * clamp(((x - ax) * mx + (z - az) * mz) / run, 0, 1);
    r.facets = [{ az: bearing(-mx, -mz), tilt: Math.atan2(rise, run), k: Math.hypot(rise, run) / run }];
  } else {                                                          // pointed: a facet from every eave edge to the apex over a
    const n = poly.length, fac = [], sg = loopArea(poly) > 0 ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
      const ox = (sg * ez) / l, oz = (-sg * ex) / l, dist = (a[0] - ax) * ox + (a[1] - az) * oz, ok = dist > 1e-6;
      fac.push({ ox, oz, dist, ok, az: bearing(ox, oz), tilt: ok ? Math.atan2(rise, dist) : Math.PI / 2, k: ok ? Math.hypot(rise, dist) / dist : 1 });
    }
    const where = (x, z) => { let best = 0, s = -Infinity; for (let k = 0; k < n; k++) if (fac[k].ok) { const v = ((x - ax) * fac[k].ox + (z - az) * fac[k].oz) / fac[k].dist; if (v > s) { s = v; best = k; } } return [best, s]; };
    r.facetAt = (x, z) => where(x, z)[0];
    r.heightAt = (x, z) => eave + rise * (1 - clamp(where(x, z)[1], 0, 1));
    r.facets = fac; r.fan = [ax, az];
  }
  return r;
}
function prepare(pieces) {
  const floors = [], walls = [], low = [], roofs = [], founds = new Map(), byId = new Map(), unbuilt = new Set();
  for (const p of pieces || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.built === false) { if (p.id != null) unbuilt.add(p.id); continue; }
    if (p.id != null) byId.set(p.id, p);
    if (p.kind === 'floor' && Array.isArray(p.outline) && p.outline.length >= 3) {
      const loops = [p.outline, ...(p.holes || [])].filter((l) => Array.isArray(l) && l.length >= 3).map((l) => l.map((q) => [q.x, q.z]));
      const base = num(p.y0, 0);
      floors.push({ p, id: p.id, loops, base, top: num(p.y1, base + num(p.thickness, 0.12)), struct: p.struct, storey: p.storey | 0, bb: bboxOf(loops[0]) });
    } else if (p.kind === 'wall' && p.a && p.b) {
      const ax = p.a.x, az = p.a.z, bx = p.b.x, bz = p.b.z, len = Math.hypot(bx - ax, bz - az);
      if (!(len > 1e-6)) continue;
      const y0 = num(p.y0, 0);
      (p.type === 'rail' || p.type === 'parapet' ? low : walls).push({ p, id: p.id, ax, az, bx, bz, len, y0, y1: num(p.y1, y0 + num(p.height, 0)), gable: p.type === 'gable' });
    } else if (p.kind === 'roof' && Array.isArray(p.footprint) && p.footprint.length >= 3) roofs.push(roofRec(p));
    else if (p.kind === 'foundation' && p.floor != null) founds.set(p.floor, p);
  }
  return { floors, walls, low, roofs, founds, byId, unbuilt };
}
// An opening as a room sees it. A door or window that is not built yet, or an arch, is a hole.
function openingOf(o, P) {
  const piece = o.id != null ? P.byId.get(o.id) : null;
  const layers = (piece && piece.layers) || o.layers || [];
  const fill = (piece && piece.fill) || o.fill;
  const filled = o.kind !== 'opening' && o.built !== false && !(o.id != null && P.unbuilt.has(o.id)) && fill !== 'none' && fill !== 'grille' && layers.length > 0;
  return { pieceId: o.id != null ? o.id : null, kind: o.kind, type: o.type, areaM2: num(o.area, num(o.width, 0) * num(o.height, 0)), widthM: num(o.width, 0), heightM: num(o.height, 0), fill: fill || null, layers, open: !filled };
}
const holeWord = (o) => (o.kind === 'door' ? (o.fill === 'grille' ? 'an open iron gate' : 'an open doorway with no door in it') : o.kind === 'window' ? 'a window opening with no window in it' : 'an open archway');

// ------------------------------------------------------------------------------------ one group of floors
function buildCluster(fl, P, cells, segs) {
  let bb = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }, fmin = Infinity, fmax = -Infinity;
  for (const f of fl) { bb = { x0: Math.min(bb.x0, f.bb.x0), z0: Math.min(bb.z0, f.bb.z0), x1: Math.max(bb.x1, f.bb.x1), z1: Math.max(bb.z1, f.bb.z1) }; fmin = Math.min(fmin, f.top); fmax = Math.max(fmax, f.top); }
  const lines = [], wallsOn = [];
  const lineOf = (ax, az, bx, bz, create) => {
    let ux = bx - ax, uz = bz - az; const l = Math.hypot(ux, uz);
    if (!(l > 1e-6)) return -1;
    ux /= l; uz /= l;
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uz < 0)) { ux = -ux; uz = -uz; }
    const nx = -uz, nz = ux;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (Math.abs(L.nx * ax + L.nz * az - L.d) < TOL && Math.abs(L.nx * bx + L.nz * bz - L.d) < TOL && Math.abs(L.ux * uz - L.uz * ux) < 0.05) return i;
    }
    if (!create) return -1;
    lines.push({ nx, nz, d: nx * ax + nz * az, ux, uz }); wallsOn.push([]);
    return lines.length - 1;
  };
  const loopLines = (loop) => { for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; lineOf(a[0], a[1], b[0], b[1], true); } };
  const cutBy = (cs, from, to) => {
    for (let li = from; li < to; li++) {
      const out = [];
      for (const c of cs) { const r = split(c, lines[li], li); if (!r) out.push(c); else for (const h of r) if (h.xs.length >= 3 && metrics(h).area > 1e-9) out.push(h); }
      cs = out;
    }
    return cs;
  };
  // the floor itself
  for (const f of fl) for (const loop of f.loops) loopLines(loop);
  let cs = cutBy([metrics({ xs: [bb.x0 - 1, bb.x1 + 1, bb.x1 + 1, bb.x0 - 1], zs: [bb.z0 - 1, bb.z0 - 1, bb.z1 + 1, bb.z1 + 1], ids: [-1, -1, -1, -1], floor: null })], 0, lines.length);
  cs = cs.filter((c) => { let best = null; for (const f of fl) if (inFloor(f, c.cx, c.cz) && (!best || f.top > best.top)) best = f; c.floor = best; return !!best; });
  const nFloor = lines.length;
  // walls that can close this storey, then what may be overhead
  const near = P.walls.filter((w) => bbHit({ x0: Math.min(w.ax, w.bx), x1: Math.max(w.ax, w.bx), z0: Math.min(w.az, w.bz), z1: Math.max(w.az, w.bz) }, bb, 0.2));
  const reg = (w, create) => {
    const li = lineOf(w.ax, w.az, w.bx, w.bz, create);
    if (li < 0) return false;
    const L = lines[li], ta = L.ux * w.ax + L.uz * w.az, tb = L.ux * w.bx + L.uz * w.bz;
    wallsOn[li].push({ w, lo: Math.min(ta, tb), hi: Math.max(ta, tb), ta, dir: tb >= ta ? 1 : -1 });
    return true;
  };
  const later = [];
  for (const w of near) { if (!w.gable && w.y0 <= fmax + 0.5 && w.y1 >= fmin + MIN_WALL) reg(w, true); else later.push(w); }
  for (const w of later) reg(w, false);
  const overF = P.floors.filter((c) => !fl.includes(c) && c.base >= fmin + HEADROOM && bbHit(c.bb, bb));
  const overR = P.roofs.filter((r) => r.yMax > fmin + 0.5 && bbHit(r.bb, bb));
  for (const c of overF) for (const loop of c.loops) loopLines(loop);
  for (const r of overR) { loopLines(r.poly); if (r.fan) for (const q of r.poly) lineOf(r.fan[0], r.fan[1], q[0], q[1], true); }
  cs = cutBy(cs, nFloor, lines.length);
  // ceilings
  for (const c of cs) {
    const f = c.floor.top; let best = null, bh = Infinity;
    for (const o of overF) { if (o.base < f + HEADROOM || o.base >= bh || !inFloor(o, c.cx, c.cz)) continue; bh = o.base; best = { kind: 'floor', rec: o }; }
    for (const r of overR) {
      if (r.yMax <= f + 0.5 || !inLoop(r.poly, c.cx, c.cz)) continue;
      const h = r.heightAt(c.cx, c.cz);
      if (h < f + (r.struct === c.floor.struct ? -0.05 : HEADROOM) || h >= bh) continue;
      bh = h; best = { kind: 'roof', rec: r, facet: r.facetAt(c.cx, c.cz) };
    }
    c.cover = best;
    c.h = best ? (best.kind === 'floor' ? () => best.rec.base : best.rec.heightAt) : null;
    c.idx = cells.length; cells.push(c);
  }
  // every cell edge, cut where a wall or a neighbour starts or stops
  const edgesOn = lines.map(() => []);
  for (const c of cs) for (let i = 0, n = c.xs.length; i < n; i++) {
    const li = c.ids[i]; if (li < 0) continue;
    const L = lines[li], j = (i + 1) % n, t0 = L.ux * c.xs[i] + L.uz * c.zs[i], t1 = L.ux * c.xs[j] + L.uz * c.zs[j];
    if (Math.abs(t1 - t0) < 1e-6) continue;
    edgesOn[li].push({ cell: c, lo: Math.min(t0, t1), hi: Math.max(t0, t1), side: L.nx * c.cx + L.nz * c.cz - L.d > 0 ? 1 : -1 });
  }
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], E = edgesOn[li], W = wallsOn[li];
    for (const e of E) {
      const c = e.cell, f = c.floor.top;
      const lw = W.filter((x) => !x.w.gable && x.w.y0 <= f + 0.5 && x.w.y1 >= f + MIN_WALL && x.hi > e.lo + 1e-6 && x.lo < e.hi - 1e-6);
      const nbs = E.filter((o) => o.side !== e.side && o.cell !== c && o.hi > e.lo + 1e-6 && o.lo < e.hi - 1e-6);
      const cuts = [e.lo, e.hi];
      for (const x of lw.concat(nbs)) cuts.push(clamp(x.lo, e.lo, e.hi), clamp(x.hi, e.lo, e.hi));
      cuts.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k], b = cuts[k + 1]; if (b - a < 1e-6) continue;
        const tm = (a + b) / 2, nbE = nbs.find((o) => o.lo < tm && tm < o.hi), wl = lw.find((x) => x.lo < tm && tm < x.hi) || null;
        const ox = -e.side * L.nx, oz = -e.side * L.nz, mx = L.nx * L.d + L.ux * tm, mz = L.nz * L.d + L.uz * tm;
        const sg = { cell: c, a, b, len: b - a, nb: nbE ? nbE.cell : null, wl, ox, oz, mx, mz, ux: L.ux, uz: L.uz, li: lines, lid: li, stack: [], vgap: false, need: c.h ? c.h(mx - ox * 0.01, mz - oz * 0.01) : null };
        if (wl) {                                                    // what stands above this wall, up to the roof line
          let reach = wl.w.y1; sg.stack.push(wl);
          const up = W.filter((x) => x !== wl && x.w.y0 >= wl.w.y0 + 0.5 && x.lo - TOL < tm && tm < x.hi + TOL).sort((p, q) => p.w.y0 - q.w.y0);
          for (const x of up) {
            if (x.w.y0 > reach + VERT_TOL || (sg.need !== null && x.w.y0 >= sg.need - 0.05)) break;
            sg.stack.push(x); reach = x.w.gable ? Infinity : Math.max(reach, x.w.y1);
          }
          sg.vgap = sg.need !== null && reach < sg.need - VERT_TOL;
        }
        segs.push(sg);
      }
    }
  }
}

// ------------------------------------------------------------------------------------ findRooms
// pieces: the simulation's piece list. opts.groundHeightAt(x, z): terrain height in world metres, if known.
// Without it a floor on a plinth, and everything on a cellar storey, is taken to be against the ground.
export function findRooms(pieces, opts = {}) {
  const groundAt = typeof opts.groundHeightAt === 'function' ? opts.groundHeightAt : null;
  const P = prepare(pieces), cells = [], segs = [];
  // floors that touch in plan at about the same height are worked on together
  const par = P.floors.map((_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let i = 0; i < P.floors.length; i++) for (let j = i + 1; j < P.floors.length; j++) {
    const a = P.floors[i], b = P.floors[j];
    if (Math.abs(a.top - b.top) <= 1 && bbHit(a.bb, b.bb, 0.25)) par[find(i)] = find(j);
  }
  const groups = new Map();
  P.floors.forEach((f, i) => { const r = find(i); groups.has(r) || groups.set(r, []); groups.get(r).push(f); });
  for (const g of groups.values()) buildCluster(g, P, cells, segs);

  const up = cells.map((_, i) => i), root = (a) => { while (up[a] !== a) a = up[a] = up[up[a]]; return a; };
  const join = (a, b) => { up[root(a.idx)] = root(b.idx); };
  const spaceAt = (x, z, y, not) => {
    for (const c of cells) {
      if (c === not || y < c.floor.top - 0.3 || !inCell(c, x, z)) continue;
      if (y <= (c.h ? c.h(x, z) : c.floor.top + 2.5)) return c;
    }
    return null;
  };
  const openingsIn = (sg, x) => (x.w.p.openings || []).map((o) => ({ o, t: x.ta + x.dir * (num(o.offset, 0) + num(o.width, 0) / 2) })).filter((q) => q.t >= sg.a && q.t < sg.b).map((q) => openingOf(q.o, P));
  for (const sg of segs) {
    const c = sg.cell, f = c.floor.top, px = sg.mx + sg.ox * 0.05, pz = sg.mz + sg.oz * 0.05;
    if (sg.wl) sg.holes = sg.stack.map((x) => openingsIn(sg, x));
    if (sg.nb) {
      if (!sg.wl) { if (sg.len > GAP_M) join(c, sg.nb); }
      else if (sg.holes[0].some((o) => o.open && o.areaM2 >= HOLE_M2)) join(c, sg.nb);       // an arch between two rooms makes them one
    } else if (!sg.wl) {
      if (sg.len <= GAP_M) continue;
      const o = spaceAt(px, pz, f + 1, c);                            // a balcony edge over the room below
      if (o && o.floor.top < f - 0.5 && o.h && (sg.need === null || o.h(px, pz) >= sg.need - VERT_TOL)) { join(c, o); sg.inner = true; }
    } else sg.other = spaceAt(px, pz, f + 1.2, c);
  }
  // rooms
  const byRoot = new Map();
  for (const c of cells) { const r = root(c.idx); byRoot.has(r) || byRoot.set(r, { cells: [], segs: [] }); byRoot.get(r).cells.push(c); c.room = byRoot.get(r); }
  for (const sg of segs) sg.cell.room.segs.push(sg);
  const rooms = [...byRoot.values()];

  // names: the largest floor piece of a room anchors its id, so a room keeps its id through edits
  const pidKey = (id) => String(id).replace(/\d+/g, (d) => d.padStart(8, '0'));
  for (const R of rooms) {
    const by = new Map(); let area = 0, sx = 0, sz = 0;
    for (const c of R.cells) { by.set(c.floor, (by.get(c.floor) || 0) + c.area); area += c.area; sx += c.cx * c.area; sz += c.cz * c.area; }
    R.area = area; R.cx = sx / area; R.cz = sz / area;
    R.anchor = [...by.entries()].sort((p, q) => q[1] - p[1] || (pidKey(p[0].id) < pidKey(q[0].id) ? -1 : 1))[0][0];
    R.floors = [...by.keys()];
  }
  const sharing = new Map();
  for (const R of rooms) { sharing.has(R.anchor) || sharing.set(R.anchor, []); sharing.get(R.anchor).push(R); }
  for (const [fl, list] of sharing) {
    list.sort((p, q) => q.area - p.area || p.cx - q.cx || p.cz - q.cz);
    list.forEach((R, k) => { R.id = 'r:' + fl.id + (k ? '#' + (k + 1) : ''); });
  }

  // leaks
  for (const R of rooms) {
    const leaks = new Set(); let bare = 0, wet = 0; R.openAreaM2 = 0;
    for (const c of R.cells) { if (!c.cover) bare += c.area; else if (c.cover.kind === 'roof' && !c.cover.rec.tight) wet += c.area; }
    const sides = new Map();
    for (const sg of R.segs) {
      if (sg.nb && sg.nb.room === R) continue;
      const k = sg.lid + '|' + (sg.ox > 0 || (sg.ox === 0 && sg.oz > 0) ? 1 : 0) + '|' + sg.cell.floor.id;
      sides.has(k) || sides.set(k, []); sides.get(k).push(sg);
      const dir = compassName(bearing(sg.ox, sg.oz));
      if (!sg.wl) continue;
      if (sg.vgap && !sg.nb && !sg.other) leaks.add('The ' + dir + ' wall stops short of the roof.');
      if (!sg.nb && !sg.other) sg.holes.forEach((list) => list.forEach((o) => { if (!o.open) return; if (o.areaM2 >= HOLE_M2) leaks.add('The ' + dir + ' wall has ' + holeWord(o) + '.'); else R.openAreaM2 += o.areaM2; }));
    }
    for (const list of sides.values()) {
      list.sort((p, q) => p.a - q.a);
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const total = run[run.length - 1].b - run[0].a, open = run.filter((s) => !s.wl && !s.nb && !s.inner && s.len > GAP_M);
        const gap = open.reduce((s, x) => s + x.len, 0);
        if (gap > 0) {
          const s0 = open[0], dir = compassName(bearing(s0.ox, s0.oz));
          const lowWall = P.low.find((w) => Math.abs((w.ax - s0.mx) * s0.ox + (w.az - s0.mz) * s0.oz) < TOL * 2 && Math.abs((w.bx - s0.mx) * s0.ox + (w.bz - s0.mz) * s0.oz) < TOL * 2 && ((s0.mx - w.ax) * (w.bx - w.ax) + (s0.mz - w.az) * (w.bz - w.az)) / (w.len * w.len) > 0 && ((s0.mx - w.ax) * (w.bx - w.ax) + (s0.mz - w.az) * (w.bz - w.az)) / (w.len * w.len) < 1);
          leaks.add(lowWall ? 'The ' + dir + ' side has only a low ' + (lowWall.p.type === 'rail' ? 'rail' : 'parapet') + ', not a wall.'
            : gap >= total - 2 * GAP_M ? 'The ' + dir + ' wall is missing.' : 'There is a ' + gap.toFixed(1) + ' m gap in the ' + dir + ' wall.');
        }
        run = [];
      };
      for (const s of list) { if (run.length && s.a > run[run.length - 1].b + 1e-3) flush(); run.push(s); }
      flush();
    }
    if (bare >= 0.98 * R.area) leaks.add('There is no roof over this room.');
    else if (bare > Math.max(0.25, 0.02 * R.area)) leaks.add('Part of this room has no roof over it (about ' + bare.toFixed(1) + ' square metres).');
    if (wet > Math.max(0.25, 0.02 * R.area)) leaks.add('The roof has no roofing on it yet.');
    R.leaks = [...leaks]; R.enclosed = R.leaks.length === 0;
  }
  const idOf = (R) => (R.enclosed ? R.id : 'outside');

  // envelope
  for (const R of rooms) { R.surf = new Map(); R.internal = []; R.perim = 0; R.wallT = 0; R.wallL = 0; }
  const surface = (R, key, make) => { let s = R.surf.get(key); if (!s) R.surf.set(key, (s = make())); return s; };
  for (const sg of segs) {
    if (!sg.wl) continue;
    const R = sg.cell.room, az = bearing(sg.ox, sg.oz);
    sg.stack.forEach((x, n) => {
      const w = x.w, H = w.y1 - w.y0, len = n ? Math.max(0, Math.min(sg.b, x.hi) - Math.max(sg.a, x.lo)) : sg.len;
      if (!(len > 0)) return;
      const gross = w.gable || w.p.shape === 'triangle' ? num(w.p.area, len * H / 2) * (len / w.len) : len * H;
      const oc = n ? spaceAt(sg.mx + sg.ox * 0.05, sg.mz + sg.oz * 0.05, (w.y0 + (sg.need !== null ? Math.min(w.y1, sg.need) : w.y1)) / 2, null) : sg.nb || sg.other;
      const O = oc && oc.room !== sg.cell.room ? oc.room : null, holes = sg.holes[n];
      if (oc && !O) { R.internal.push({ pieceId: w.id, kind: 'wall', areaM2: gross, layers: w.p.layers || [] }); return; }
      let buried = 0;
      if (!O) {
        if (groundAt) buried = clamp(groundAt(sg.mx + sg.ox * 0.5, sg.mz + sg.oz * 0.5) - w.y0, 0, H); else if ((w.p.storey | 0) < 0) buried = H;
        if (buried > 0.98 * H) buried = H; else if (buried < 0.02 * H) buried = 0;
        if (!n) { R.wallT += num(w.p.thickness, 0.2) * len; R.wallL += len; if (!sg.nb) R.perim += len; }
      }
      const add = (to, area, depth, withHoles) => {
        // layers run from the far side to this room: a partition is read backwards from its second room
        const flip = O && R.id > O.id;
        const s = surface(R, w.id + '>' + to, () => ({ pieceId: w.id, kind: 'wall', areaM2: 0, toRoom: to, orientationRad: az, tiltRad: Math.PI / 2, lengthM: 0, layers: flip ? (w.p.layers || []).slice().reverse() : w.p.layers || [], openings: [], depthM: 0 }));
        s.areaM2 += area; s.lengthM += len; if (depth) s.depthM += depth * len;
        if (withHoles) for (const o of holes) { s.openings.push(o); s.areaM2 -= o.areaM2; }
      };
      if (O) add(idOf(O), gross, 0, true);
      else if (buried >= H) { add('ground', gross, buried, false); if (holes.length) add('outside', 0, 0, true); }
      else if (buried > 0) { add('ground', gross * (buried / H), buried, false); add('outside', gross * (1 - buried / H), 0, true); }
      else add('outside', gross, 0, true);
    });
  }
  // roofs and the floors between storeys
  const under = new Map();                                            // floor record -> cells whose ceiling it is
  for (const c of cells) {
    if (!c.cover) continue;
    if (c.cover.kind === 'floor') { under.has(c.cover.rec) || under.set(c.cover.rec, []); under.get(c.cover.rec).push(c); continue; }
    const r = c.cover.rec, fc = r.facets[c.cover.facet] || r.facets[0], R = c.room;
    let to = 'outside', cover = 0;
    if (groundAt) { const g = groundAt(c.cx, c.cz) - c.h(c.cx, c.cz); if (g > 0.05) { to = 'ground'; cover = g; } } else if ((r.p.storey | 0) < 0) { to = 'ground'; cover = 0.5; }
    const s = surface(R, r.id + '>' + to + '#' + c.cover.facet, () => ({ pieceId: r.id, kind: 'roof', areaM2: 0, toRoom: to, orientationRad: fc.az, tiltRad: fc.tilt, layers: r.p.layers || [], openings: [], coverM: 0 }));
    s.areaM2 += c.area * fc.k; s.coverM = Math.max(s.coverM, cover);
  }
  for (const c of cells) {
    const F = c.floor, R = c.room; let left = c.area;
    for (const lo of under.get(F) || []) {
      const a = overlapArea(lo, c); if (a < 1e-6) continue;
      left -= a;
      if (lo.room === R) { R.internal.push({ pieceId: F.id, kind: 'floor', areaM2: 2 * a, layers: F.p.layers || [] }); continue; }
      const sF = surface(R, F.id + '>' + idOf(lo.room), () => ({ pieceId: F.id, kind: 'floor', areaM2: 0, toRoom: idOf(lo.room), orientationRad: 0, tiltRad: Math.PI, layers: F.p.layers || [], openings: [] }));
      sF.areaM2 += a;
      const sC = surface(lo.room, F.id + '^' + idOf(R), () => ({ pieceId: F.id, kind: 'ceiling', areaM2: 0, toRoom: idOf(R), orientationRad: 0, tiltRad: 0, layers: (F.p.layers || []).slice().reverse(), openings: [] }));
      sC.areaM2 += a;
    }
    if (left < 1e-6) continue;
    const fd = P.founds.get(F.id);
    let to, depth = 0;
    if (groundAt) { const g = groundAt(c.cx, c.cz); to = F.base - g <= 0.6 ? 'ground' : 'outside'; depth = Math.max(0, g - F.top); }
    else if (fd) to = fd.type === 'posts' ? 'outside' : 'ground';
    else { to = F.storey <= 0 ? 'ground' : 'outside'; if (F.storey < 0) depth = 2.5; }
    c.ground = to === 'ground';
    const s = surface(R, F.id + '>' + to, () => ({ pieceId: F.id, kind: 'floor', areaM2: 0, toRoom: to, orientationRad: 0, tiltRad: Math.PI, layers: F.p.layers || [], openings: [], depthM: 0,
      foundation: fd && to === 'ground' ? { pieceId: fd.id, type: fd.type, material: fd.material, thicknessM: num(fd.height, num(fd.y1, 0) - num(fd.y0, 0)) } : null }));
    s.areaM2 += left; s.depthM += depth * left;
  }
  for (const [F, list] of under) for (const lo of list) {                 // a ceiling with nothing lived-in above it
    let used = 0; for (const c of cells) if (c.floor === F) used += overlapArea(lo, c);
    if (lo.area - used < 1e-6) continue;
    const s = surface(lo.room, F.id + '^outside', () => ({ pieceId: F.id, kind: 'ceiling', areaM2: 0, toRoom: 'outside', orientationRad: 0, tiltRad: 0, layers: (F.p.layers || []).slice().reverse(), openings: [] }));
    s.areaM2 += lo.area - used;
  }

  // the result
  const out = rooms.map((R) => {
    let vol = 0, y0 = Infinity, y1 = -Infinity, perim = 0;
    for (const c of R.cells) {
      const f = c.floor.top; y0 = Math.min(y0, f);
      if (c.h) { vol += integrate(c, (x, z) => Math.max(0, c.h(x, z) - f)); for (let i = 0; i < c.xs.length; i++) y1 = Math.max(y1, c.h(c.xs[i], c.zs[i])); }
      else { vol += c.area * 2.5; y1 = Math.max(y1, f + 2.5); }
    }
    for (const sg of R.segs) if (!sg.nb && !sg.inner && sg.cell.ground) perim += sg.len;
    const envelope = [...R.surf.values()].filter((s) => s.areaM2 > 1e-6 || s.openings.length);
    for (const s of envelope) { if (s.depthM) s.depthM /= s.kind === 'wall' ? s.lengthM : s.areaM2; s.areaM2 = Math.max(0, s.areaM2); }
    return {
      id: R.id, storey: Math.min(...R.floors.map((f) => f.storey)), floorIds: R.floors.map((f) => f.id).sort(),
      floorAreaM2: R.area, volumeM3: vol, heightM: vol / R.area, stackHeightM: y1 - y0, floorY: y0, topY: y1, centre: { x: R.cx, z: R.cz },
      envelope, internal: R.internal, enclosed: R.enclosed, leaks: R.leaks, openAreaM2: R.openAreaM2,
      groundPerimeterM: perim, wallThicknessM: R.wallL > 0 ? R.wallT / R.wallL : 0.2,
      cells: R.cells.map((c) => ({ y0: c.floor.top, poly: c.xs.map((x, i) => ({ x, z: c.zs[i] })), heightAt: c.h })),
    };
  });
  return out.sort((p, q) => (pidKey(p.id) < pidKey(q.id) ? -1 : 1));
}

// The room a point is in, or null. y is optional (world metres).
export function roomAt(rooms, x, z, y) {
  for (const r of rooms) for (const c of r.cells) {
    const n = c.poly.length; let s = 0, inside = true;
    for (let i = 0; i < n && inside; i++) {
      const a = c.poly[i], b = c.poly[(i + 1) % n], cr = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
      if (cr > 1e-9) { if (s < 0) inside = false; s = 1; } else if (cr < -1e-9) { if (s > 0) inside = false; s = -1; }
    }
    if (inside && (y === undefined || (y >= c.y0 - 0.3 && y <= (c.heightAt ? c.heightAt(x, z) : c.y0 + 2.5)))) return r;
  }
  return null;
}
