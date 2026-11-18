// Where streams and rivers run, and the channels they carve. Pure: no THREE, no DOM, so it is unit-tested in node.
//
// A drainage graph on a jittered grid of nodes (one per CELL m square; 20 m, fine enough that the small islands of
// this world gather real catchments: at 64 m nearly every node drained straight to the sea). Every quantity is a memoised pure function
// of a node, decided by a local rule, so any chunk that asks gets the same answer in any order and nothing needs
// saving:
//   down(n)  the lowest of its 8 neighbours if lower; failing that the lowest lower node two rings out (a breach);
//            failing that n is a pond. Below SEA + 0.3 m a node is a mouth.
//   area(n)  1 + the areas of every node that flows into n: its catchment, counted in nodes.
// A channel runs from n to down(n) when its catchment is at least MIN_HA hectares. Its size follows hydraulic
// geometry, in game scale: width and depth grow with the square root of catchment, discharge with both. The bed steps down in pools and riffles (about
// 0.35 m a step, steps at least 6 m apart; a step over 1 m is a waterfall), and the channel is carved into the
// terrain with 1:1.5 banks, raised into a levee where the ground around sits lower than the banks would.
//
// height(x, z) is the terrain without its finest detail; the carve is applied by the engine to its full height.

const CELL = 20, JITTER = 6, NODE_HA = (CELL * CELL) / 10000, MIN_HA = 0.4, STEP = 0.35, MIN_STEP_LEN = 6, SAMPLE = 3, RING = 4;
const MIN_AREA = Math.ceil(MIN_HA / NODE_HA);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// channel size from catchment (nodes): width and bankfull depth (m), and a typical discharge (m3/s) for a flow of
// about 0.5 m/s through 60% of bankfull. 0.4 ha: 2.3 m wide, 0.33 m deep; 2 ha: 3.2 m, 0.42 m; 10 ha: 5 m, 0.6 m.
// wetness scales flow with the weather (1 = an ordinary day).
export function channelSize(area, wetness = 1) {
  const ha = area * NODE_HA, s = Math.sqrt(ha);
  const w = clamp(1.6 + 1.1 * s, 2, 14), D = 0.25 + 0.12 * s;
  return { w, D, Q: 0.5 * w * 0.6 * D * wetness, ha };
}

export function createRivers({ seed = 0, height, SEA = 0, spawnClear = 28, springNear = true }) {
  const nodes = new Map();
  const hash = (i, j, k) => {
    let h = (seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function node(i, j) {
    const k = i + ',' + j;
    let n = nodes.get(k);
    if (!n) {
      const x = (i + 0.5) * CELL + (hash(i, j, 1) - 0.5) * 2 * JITTER, z = (j + 0.5) * CELL + (hash(i, j, 2) - 0.5) * 2 * JITTER;
      n = { i, j, x, z, h: height(x, z), down: undefined, area: 0, seg: undefined };
      nodes.set(k, n);
    }
    return n;
  }
  function down(n) {
    if (n.down !== undefined) return n.down;
    n.down = null;
    if (n.h < SEA + 0.3) { n.mouth = true; return null; }
    let best = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const m = node(n.i + di, n.j + dj);
      if (m.h < n.h && (!best || m.h < best.h)) best = m;
    }
    if (!best) {
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (Math.abs(di) < 2 && Math.abs(dj) < 2) continue;
        const m = node(n.i + di, n.j + dj);
        if (m.h < n.h && (!best || m.h < best.h)) best = m;
      }
      if (best) n.breach = true; else n.pond = true;
    }
    n.down = best;
    return best;
  }
  // nodes that flow straight into n (they can only be within two rings of it)
  function ups(n) {
    if (n.ups) return n.ups;
    const out = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      if (!di && !dj) continue;
      const m = node(n.i + di, n.j + dj);
      if (down(m) === n) out.push(m);
    }
    return (n.ups = out);
  }
  // catchment, without recursion (basins can hold thousands of nodes): a post-order walk up the tree
  function area(n) {
    if (n.area) return n.area;
    const stack = [n], order = [];
    while (stack.length) {
      const m = stack.pop();
      if (m.area || m.seen) continue;
      m.seen = true; order.push(m);
      for (const u of ups(m)) if (!u.area && !u.seen) stack.push(u);
      if (order.length > 200000) break;          // a pathological basin: stop rather than hang
    }
    for (let q = order.length - 1; q >= 0; q--) {
      const m = order[q];
      let a = 1 + (m.spring || 0);
      for (const u of ups(m)) a += u.area || 1;
      m.area = a; m.seen = false;
    }
    return n.area;
  }
  // the main stem upstream of n (largest catchment), for a smooth curve through n
  function mainUp(n) {
    let best = null;
    for (const u of ups(n)) if (area(u) >= MIN_AREA && (!best || u.area > best.area)) best = u;
    return best;
  }
  function bedAtNode(n) {
    if (n.mouth) return SEA - 0.6;
    const { D } = channelSize(area(n));
    return Math.max(SEA + 0.05, n.h - (D + 0.4));
  }
  // the channel from n to down(n): a centreline sampled every SAMPLE m, with size and bed along it
  function segment(n) {
    if (n.seg !== undefined) return n.seg;
    n.seg = null;
    const d = down(n);
    if (!d || area(n) < MIN_AREA) return null;
    const u = mainUp(n), dd = down(d);
    const p0 = u ? [u.x, u.z] : [2 * n.x - d.x, 2 * n.z - d.z], p1 = [n.x, n.z], p2 = [d.x, d.z], p3 = dd ? [dd.x, dd.z] : [2 * d.x - n.x, 2 * d.z - n.z];
    const len0 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), cnt = Math.max(2, Math.ceil(len0 / SAMPLE));
    const wob = (hash(n.i, n.j, 3) - 0.5) * 2 * 0.12 * len0, nx = -(p2[1] - p1[1]) / len0, nz = (p2[0] - p1[0]) / len0;
    const pts = [];
    for (let s = 0; s <= cnt; s++) {
      const t = s / cnt, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      const off = wob * Math.sin(Math.PI * t);
      pts.push([cr(p0[0], p1[0], p2[0], p3[0]) + nx * off, cr(p0[1], p1[1], p2[1], p3[1]) + nz * off]);
    }
    let L = 0; const acc = [0];
    for (let s = 1; s < pts.length; s++) { L += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]); acc.push(L); }
    const a0 = area(n), a1 = d.mouth ? a0 : area(d), z0 = bedAtNode(n), z1 = Math.min(z0, bedAtNode(d)), dz = z0 - z1;
    const s0 = channelSize(a0), s1 = channelSize(a1), wmax = Math.max(s0.w, s1.w) * (d.mouth ? 2 : 1);
    // steep reaches gather their fall into fewer, bigger steps a few channel widths apart (step-pool streams: a
    // boulder or rock step, a plunge pool, the next step), so they cascade and fall; gentle ones riffle in small steps
    const slope = dz / L, spacing = slope > 0.07 ? Math.max(7, 3.5 * s0.w) : MIN_STEP_LEN;
    const k = Math.max(1, Math.min(Math.round(dz / STEP), Math.floor(L / spacing)));
    // signed curvature at each sample (1/m; + turns left), smoothed over a few samples: the outside of a bend is
    // cut steep and deep, the inside builds a gravel bar
    const curv = pts.map((_, s) => {
      const a = pts[Math.max(0, s - 2)], b = pts[s], c = pts[Math.min(pts.length - 1, s + 2)];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz);
      if (la < 1e-6 || lb < 1e-6) return 0;
      return (ux * vz - uz * vx) / (la * lb) / ((la + lb) / 2);
    });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const reach = wmax * 2.5 + 2;
    n.seg = { n, d, pts, acc, curv, L, z0, z1, dz, k, drop: dz / k, fall: dz / k > 0.7, s0, s1, mouth: !!d.mouth, box: [x0 - reach, y0 - reach, x1 + reach, y1 + reach], reach };
    return n.seg;
  }
  // bed height a fraction t along a segment: steps of pools and riffles, pools scoured just below each crest
  // a fall drops over a short, near vertical face at the end of its step, into a plunge pool scoured below
  function bedAt(sg, t, noScour) {
    const u = t * sg.k, f = u - Math.floor(u);
    let z = sg.z0 - sg.dz * (Math.floor(u) + (sg.fall ? smooth(0.9, 0.96, f) : smooth(0.78, 1, f))) / sg.k;
    if (!noScour && (sg.k > 1 || sg.dz > 0.05)) z -= (sg.fall ? 0.2 + 0.25 * sg.drop : 0.12) * (1 - smooth(0, sg.fall ? 0.4 : 0.3, f)) * (u >= 1 ? 1 : 0);
    if (sg.mouth) z = Math.min(z, sg.z0 + (SEA - 0.6 - sg.z0) * smooth(0.5, 1, t));
    return z;
  }
  function closest(sg, x, z) {
    let best = Infinity, bt = 0, side = 0, cv = 0;
    const P = sg.pts;
    for (let s = 1; s < P.length; s++) {
      const ax = P[s - 1][0], az = P[s - 1][1], bx = P[s][0] - ax, bz = P[s][1] - az, l2 = bx * bx + bz * bz;
      const q = l2 > 0 ? clamp(((x - ax) * bx + (z - az) * bz) / l2, 0, 1) : 0;
      const ex = x - ax - bx * q, ez = z - az - bz * q, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; bt = (sg.acc[s - 1] + q * (sg.acc[s] - sg.acc[s - 1])) / sg.L; side = bx * ez - bz * ex; cv = sg.curv[s - 1] + (sg.curv[s] - sg.curv[s - 1]) * q; }
    }
    // bend: +1 on the outside of a tight bend (radius 10 m or less), -1 on the inside, 0 on a straight
    return { dist: Math.sqrt(best), t: bt, bend: -Math.sign(side) * Math.sign(cv) * clamp(Math.abs(cv) * 10, 0, 1) };
  }
  // channels that can reach into node cell (i, j)
  const cellCache = new Map();
  function segsNear(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL), k = i + ',' + j;
    let list = cellCache.get(k);
    if (!list) {
      list = [];
      const cx0 = i * CELL, cz0 = j * CELL, cx1 = cx0 + CELL, cz1 = cz0 + CELL;
      for (let dj = -RING; dj <= RING; dj++) for (let di = -RING; di <= RING; di++) {
        const sg = segment(node(i + di, j + dj));
        if (sg && sg.box[0] < cx1 && sg.box[2] > cx0 && sg.box[1] < cz1 && sg.box[3] > cz0) list.push(sg);
      }
      cellCache.set(k, list);
    }
    return list;
  }
  function sizeAt(sg, t) {
    const w = sg.s0.w + (sg.s1.w - sg.s0.w) * t, D = sg.s0.D + (sg.s1.D - sg.s0.D) * t, Q = sg.s0.Q + (sg.s1.Q - sg.s0.Q) * t;
    return { w: sg.mouth ? w * (1 + smooth(0.5, 1, t)) : w, D, Q };
  }
  // the terrain with every nearby channel cut into it (h is the full terrain height at x, z)
  function carve(h, x, z) {
    const list = segsNear(x, z);
    if (!list.length) return h;
    const keep = spawnClear > 0 ? smooth(spawnClear, spawnClear * 1.35, Math.hypot(x, z)) : 1;
    if (keep <= 0) return h;
    let out = h;
    for (const sg of list) {
      if (x < sg.box[0] || x > sg.box[2] || z < sg.box[1] || z > sg.box[3]) continue;
      const { dist, t, bend } = closest(sg, x, z);
      const { w, D } = sizeAt(sg, t);
      if (dist > w * 2.5 + 2) continue;
      // the bed deepens toward the outside of a bend (the thalweg) and shelves up onto the bar inside it
      const across = Math.min(1, dist / (w / 2));
      const bed = bedAt(sg, t) - 0.35 * D * bend * across;
      // banks: 1:1.5 on a straight, cut to 1:0.6 on the outside of a bend, a 1:3 gravel bar on the inside
      const run = bend > 0 ? 1.5 - 0.9 * bend : 1.5 - 1.5 * bend;
      const bank = bed + Math.max(0, dist - w / 2) / run;
      const cut = Math.min(out, bank);
      const levee = Math.min(bank, bed + D);                       // where the ground sits low, banks up to bankfull
      const fillW = 1 - smooth(w / 2 + 1.5 * D, w * 2.5, dist);
      out = Math.max(cut, out + (levee - out) * fillW);
    }
    return h + (out - h) * keep;
  }
  // the nearest channel at x, z, or null: for baking water, placing plants and effects
  function riverInfo(x, z) {
    let best = null;
    for (const sg of segsNear(x, z)) {
      if (x < sg.box[0] || x > sg.box[2] || z < sg.box[1] || z > sg.box[3]) continue;
      const c = closest(sg, x, z);
      if (best && c.dist >= best.dist) continue;
      const s = sizeAt(sg, c.t), P = sg.pts, q = Math.min(P.length - 2, Math.floor(c.t * (P.length - 1)));
      const dx = P[q + 1][0] - P[q][0], dz = P[q + 1][1] - P[q][1], dl = Math.hypot(dx, dz) || 1;
      const u = c.t * sg.k, f = u - Math.floor(u);
      // phase: where in its step this is (pool below 0.78, riffle above); bedLip: the bed without pool scour,
      // which is where the water surface rides
      best = { dist: c.dist, t: c.t, w: s.w, D: s.D, Q: s.Q, dir: [dx / dl, dz / dl], bedZ: bedAt(sg, c.t), bedLip: bedAt(sg, c.t, true), phase: f, riffle: f > 0.78, fall: sg.fall && f > 0.78, face: sg.fall && f > 0.88 && f < 0.98, drop: sg.drop, bend: c.bend, mouth: sg.mouth, area: sg.n.area, seg: sg };
    }
    return best;
  }
  // a point a fraction t along a segment, and the direction there
  function pointAt(sg, t) {
    const P = sg.pts, A = sg.acc, want = clamp(t, 0, 1) * sg.L;
    let s = 1;
    while (s < P.length - 1 && A[s] < want) s++;
    const q = A[s] > A[s - 1] ? clamp((want - A[s - 1]) / (A[s] - A[s - 1]), 0, 1) : 0;
    const dx = P[s][0] - P[s - 1][0], dz = P[s][1] - P[s - 1][1], l = Math.hypot(dx, dz) || 1;
    return [P[s - 1][0] + dx * q, P[s - 1][1] + dz * q, dx / l, dz / l];
  }
  const curvAt = (sg, t) => { const f = clamp(t, 0, 1) * (sg.curv.length - 1), i = Math.floor(f); return sg.curv[i] + ((sg.curv[i + 1] ?? sg.curv[i]) - sg.curv[i]) * (f - i); };
  // Rocks of a channel: { x, z, r (m), sink (how much of it is buried, of r), squash (height over width) }. Where
  // real streams have them: the step of each fall framed by boulders at its ends, more round its plunge pool; cobbles
  // and boulders on riffles, a few breaking the surface (more on steep reaches); boulders fallen from the cut bank on
  // the outside of bends. The engine sets them on the ground and the live water flows round them.
  function rocksOf(sg) {
    if (sg.rocks) return sg.rocks;
    const out = [], H = (a, b) => hash(sg.n.i * 7 + a, sg.n.j * 13 + b, 11);
    const add = (t, u, r, sink, squash) => { const [x, z, dx, dz] = pointAt(sg, t); out.push({ x: x - dz * u, z: z + dx * u, r, sink, squash }); };
    for (let i = 0; i < sg.k; i++) {
      const tl = (i + 0.9) / sg.k, { w } = sizeAt(sg, tl);
      if (sg.fall) {
        for (const sd of [-1, 1]) add(tl - 0.4 / sg.L, sd * (w / 2 + 0.15 - 0.35 * H(i, sd + 2)), (0.5 + 0.45 * H(i, sd + 5)) * Math.min(1.4, 0.6 + sg.drop * 0.3), 0.35, 0.8 + 0.4 * H(i, sd + 7));
        const nb = 2 + Math.floor(H(i, 21) * 3.5), tb = (i + 1) / sg.k;
        for (let q = 0; q < nb; q++) {
          const side = H(i, 30 + q) < 0.5 ? -1 : 1;
          add(Math.min(1, tb + (0.6 + 2.2 * H(i, 40 + q)) / sg.L), side * (w / 2 - 0.2 + 0.9 * H(i, 50 + q)), 0.3 + 0.45 * H(i, 60 + q), 0.4, 0.7 + 0.4 * H(i, 70 + q));
        }
      } else {
        // riffles: a scatter of cobbles and boulders, many breaking the surface (more on steep reaches)
        const n = 1 + Math.floor(H(i, 80) * (sg.drop > 0.3 ? 5.5 : 3.8));
        for (let q = 0; q < n; q++) {
          const big = H(i, 130 + q) < 0.35;
          add((i + 0.7 + 0.28 * H(i, 90 + q)) / sg.k, (2 * H(i, 100 + q) - 1) * w * 0.44, (big ? 0.32 + 0.3 * H(i, 110 + q) : 0.13 + 0.2 * H(i, 110 + q)) * Math.min(1.2, 0.55 + w / 6), big ? 0.22 : 0.4, 0.6 + 0.45 * H(i, 120 + q));
        }
      }
      // pools: now and then a boulder standing up out of the water, the current parting round it
      if (H(i, 180) < 0.45) {
        const tp = (i + 0.2 + 0.4 * H(i, 181)) / sg.k;
        add(tp, (2 * H(i, 182) - 1) * w * 0.3, (0.4 + 0.35 * H(i, 183)) * Math.min(1.3, 0.6 + w / 6), 0.18, 0.75 + 0.35 * H(i, 184));
      }
    }
    // along both banks: stones lying half in the water, more where the bank is cut
    for (let t = 0.03, q = 0; t < 0.98; t += 3.2 / sg.L, q++) {
      if (H(q, 190) < 0.55) continue;
      const { w } = sizeAt(sg, t), sd = H(q, 191) < 0.5 ? -1 : 1;
      add(t, sd * (w / 2 - 0.15 + 0.6 * H(q, 192)), 0.16 + 0.3 * H(q, 193), 0.32, 0.65 + 0.4 * H(q, 194));
    }
    // fallen from the cut bank on the outside of bends
    for (let t = 0.04, q = 0; t < 0.97; t += 5 / sg.L, q++) {
      const cv = curvAt(sg, t);
      if (Math.abs(cv) < 0.06 || H(q, 140) < 0.55) continue;
      const { w } = sizeAt(sg, t);
      add(t, -Math.sign(cv) * (w / 2 + 0.1 + 0.9 * H(q, 150)), 0.3 + 0.5 * H(q, 160), 0.3, 0.75 + 0.35 * H(q, 170));
    }
    return (sg.rocks = out);
  }
  // Falls: { x, z (middle of the lip), dx, dz (downstream), w, top (water surface over the lip), bottom (the pool's
  // surface below), drop }
  function fallsOf(sg) {
    if (sg.falls) return sg.falls;
    const out = [];
    if (sg.fall) for (let i = 0; i < sg.k; i++) {
      const tl = (i + 0.9) / sg.k, [x, z, dx, dz] = pointAt(sg, tl), { w, D } = sizeAt(sg, tl);
      const lip = bedAt(sg, tl, true), below = bedAt(sg, Math.min(1, (i + 0.99) / sg.k), true);
      if (lip - below > 0.5 && below > SEA) out.push({ x, z, dx, dz, w, D, top: lip + D * 0.3, bottom: below + D * 0.62, drop: lip - below });
    }
    return (sg.falls = out);
  }
  const inRect = (o, x0, z0, x1, z1) => o.x >= x0 && o.x < x1 && o.z >= z0 && o.z < z1;
  function rocksIn(x0, z0, x1, z1) { const out = []; for (const sg of segmentsIn(x0, z0, x1, z1)) for (const r of rocksOf(sg)) if (inRect(r, x0, z0, x1, z1)) out.push(r); return out; }
  function fallsIn(x0, z0, x1, z1) { const out = []; for (const sg of segmentsIn(x0, z0, x1, z1)) for (const f of fallsOf(sg)) if (inRect(f, x0, z0, x1, z1)) out.push(f); return out; }
  // every channel whose box touches the rectangle (for drawing maps and debugging)
  function segmentsIn(x0, z0, x1, z1) {
    const out = new Set();
    for (let z = Math.floor(z0 / CELL) * CELL; z <= z1; z += CELL) for (let x = Math.floor(x0 / CELL) * CELL; x <= x1; x += CELL) for (const s of segsNear(x + 1, z + 1)) out.add(s);
    return [...out];
  }
  // a spring a short walk from spawn, so every world has a brook near home: the node 42-70 m out whose way down
  // reaches the sea without passing back within 40 m of spawn, closest to 48 m and preferring a longer run. Its
  // water joins the catchment of everything below it, so the brook it starts grows on downstream like any other.
  // Chosen from heights and flow directions alone, before any catchment is asked for.
  let spring = null;
  if (springNear) {
    let bestScore = Infinity;
    const R = Math.ceil(70 / CELL) + 1;
    for (let j = -R; j < R; j++) for (let i = -R; i < R; i++) {
      const n = node(i, j), r = Math.hypot(n.x, n.z);
      if (r < 42 || r > 70 || n.h < SEA + 2) continue;
      let m = n, len = 0, ok = true;
      for (; m && !m.mouth && len < 300; len++) {
        if (Math.hypot(m.x, m.z) < 40) { ok = false; break; }
        m = down(m);
      }
      if (!ok || !m || !m.mouth || len < 3) continue;
      const score = Math.abs(r - 48) - Math.min(len, 12) * 0.8;
      if (score < bestScore) { bestScore = score; spring = n; }
    }
    if (spring) spring.spring = 2 * MIN_AREA;
  }
  return { spring, node, down, area, segment, bedAt, carve, riverInfo, segmentsIn, rocksIn, fallsIn, CELL, MIN_AREA, stats: () => ({ nodes: nodes.size, cells: cellCache.size }) };
}
