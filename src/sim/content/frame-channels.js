// Frame channels: where a run may go inside a stick-framed building, read from the members src/framing.js lists
// (studs, plates, headers, sills, joists). The graph is what src/sim/core/routefind.js walks. Knows framing, not
// what is routed: no cable or pipe words here; the hole limits for a given run are the caller's rule.
//
//   walls   studs sorted along a wall make bays. Each bay has a vert at three travel heights (0.35 m, 1.15 m above
//           the floor, and 0.2 m under the top of the wall). Up and down a bay is free (along a stud side);
//           sideways crosses the studs between two bays: one hole through the post (a doubled king and jack is one
//           hole, `plies` 2). An opening blocks its bays from sill to header (a window keeps its cripple bays
//           under the sill and over the header; a door only over the header); a header is never bored.
//   top     each bay's top vert goes up through the top and cap plates (one hole) to an attic vert over the wall;
//           attic verts run along the wall and across the ceiling joists, and join at corners.
//   floor   each bay's lowest vert goes down through the bottom plate into the joist bay under it. Along a joist
//           bay is free; across the joists is a hole through each joist, or, over a crawl space (pier blocks,
//           poured piers, a stem wall), hung under them with no hole.
//   corners two walls that meet join at each height through a vert in the corner (a hole through each end post).
//
// INTERFACE
//   channelsFromMembers(list, { found?, level? }) -> channels
//     { verts: [{ id, p, tag, yMin?, yTop? }], edges: [{ a, b, lengthM, tag, host, bore?, via?, level? }],
//       (yMin, yTop: how low and how high a run may sit at a floor vert)
//       walls: [wall], floor: floor | null, attic: { y } | null, crawl, ceiling: [{ id, a, b, parent }] }
//     tags: stud (up or down a bay), wall (sideways through studs), corner, top (up through the plates), attic,
//           down (through the bottom plate into the floor), floor (along a joist bay), joist (through a joist),
//           under (hung below the joists), drop (from a point to the channels), out (through the rim)
//     bore: { at, parent (member id), depthM (how deep the member is across the hole), kind: 'stud' | 'plate' |
//           'joist' | 'rim', plies, bearing }
//     wall: { id, o: [x, z], u: [x, z], n: [x, z], L, yb, yt, SB, SD, out, posts, bays, blocks, levels }
//   attach(channels, p, { wall?, near? }) -> { p, links } | null      a free point (a box, a stub, a port) joined to
//     the channels for routefind's from/to; null when the point is not in the frame
//   rayHit(channels, origin, dir, { maxT? }) -> { kind: 'wall' | 'floor' | 'ceiling', t, point, wall?, s?, y, side? } | null
//   snap(channels, hit, { heightM?, box?: half-width, depth?, exit? }) -> { at, wall?, s, y, side, host, onto } | { refused }
//   wallAt(wall, s, y, off) -> [x, y, z]           frame-local point on a wall (off: across it, + is the wall's n side)
//   channelsFor(structId, build = globalThis.__build) -> channels (cached per building version)

const LEVELS = [0.35, 1.15];
const TOP_DROP = 0.2;
const CRAWL = new Set(['pier-blocks', 'piers', 'stemwall']);
const r3 = (v) => Math.round(v * 1000) / 1000;
const P3 = (p) => [r3(p[0]), r3(p[1]), r3(p[2])];
const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
const dxz = (p, q) => Math.hypot(q[0] - p[0], q[2] - p[2]);

export const wallAt = (w, s, y, off = 0) => [w.o[0] + w.u[0] * s + w.n[0] * off, y, w.o[1] + w.u[1] * s + w.n[1] * off];
const sOf = (w, p) => (p[0] - w.o[0]) * w.u[0] + (p[2] - w.o[1]) * w.u[1];
const offOf = (w, p) => (p[0] - w.o[0]) * w.n[0] + (p[2] - w.o[1]) * w.n[1];
const blockedV = (w, s, ya, yb) => w.blocks.some((r) => s > r.s0 && s < r.s1 && Math.max(ya, yb) > r.y0 && Math.min(ya, yb) < r.y1);
const blockedH = (w, y, sa, sb) => w.blocks.some((r) => y > r.y0 && y < r.y1 && Math.max(sa, sb) > r.s0 && Math.min(sa, sb) < r.s1);
const inBlock = (w, s, y) => w.blocks.some((r) => s > r.s0 && s < r.s1 && y > r.y0 && y < r.y1);

// One wall's geometry from its members.
function wallOf(id, ms) {
  const studs = ms.filter((m) => m.kind === 'stud'), plates = ms.filter((m) => m.kind === 'plate');
  const tops = plates.filter((m) => m.type === 'top'), caps = plates.filter((m) => m.type === 'cap'), bottoms = plates.filter((m) => m.type === 'bottom');
  if (studs.length < 2 || !tops.length) return null;
  const t0 = tops[0], dx = t0.b[0] - t0.a[0], dz = t0.b[2] - t0.a[2], l = Math.hypot(dx, dz) || 1;
  const u = [dx / l, dz / l], n = [studs[0].n[0], studs[0].n[2]];
  let smin = Infinity, smax = -Infinity;
  const ref = [t0.a[0], t0.a[2]];
  for (const m of tops) for (const p of [m.a, m.b]) { const s = (p[0] - ref[0]) * u[0] + (p[2] - ref[1]) * u[1]; smin = Math.min(smin, s); smax = Math.max(smax, s); }
  const w = { id, o: [ref[0] + u[0] * smin, ref[1] + u[1] * smin], u, n, L: smax - smin };
  const SB = studs[0].section.b, SD = studs[0].section.d;
  w.SB = SB; w.SD = SD;
  // what will cover the studs on the inside (drywall, pine boards; docs/design/interior-walls.md): boxes are set proud of
  // the studs by that much, so their faces end up flush with the finished wall, as an electrician sets them
  { const ln = ms.find((m) => m.kind === 'lining'); w.finish = ln ? ln.thickness ?? ln.section.b : 0; }
  w.yt = t0.a[1] + 1.5 * SB;
  w.yb = bottoms.length ? bottoms[0].a[1] - SB / 2 : Math.min(...studs.map((m) => Math.min(m.a[1], m.b[1]))) - SB;
  // which side is outdoors: sheathing goes on the outside of an outside wall; inside walls have none
  const sh = ms.find((m) => m.kind === 'sheathing' && m.type === 'wall');
  w.out = sh ? Math.sign(offOf(w, sh.a)) || 1 : 0;
  const span = (m) => { const a = sOf(w, m.a), b = sOf(w, m.b); return [Math.min(a, b), Math.max(a, b)]; };
  w.tops = tops.map((m) => [...span(m), m.id]);
  w.caps = caps.length;
  w.bottoms = bottoms.map((m) => [...span(m), m.id]);
  const verts = studs.map((m) => ({ id: m.id, type: m.type, s: sOf(w, m.a), y0: Math.min(m.a[1], m.b[1]), y1: Math.max(m.a[1], m.b[1]) })).sort((p, q) => p.s - q.s);
  // openings: the header and what it sits on; the sill under a window
  w.blocks = [];
  for (const h of ms.filter((m) => m.kind === 'header')) {
    const [hs0, hs1] = span(h), hy0 = h.a[1] - h.section.d / 2, hy1 = h.a[1] + h.section.d / 2, mid = (hs0 + hs1) / 2;
    const jacks = verts.filter((v) => v.type === 'jack' && v.s > hs0 - 0.01 && v.s < hs1 + 0.01);
    const L = jacks.filter((v) => v.s < mid), R = jacks.filter((v) => v.s > mid);
    const os0 = L.length ? Math.max(...L.map((v) => v.s)) + SB / 2 : hs0, os1 = R.length ? Math.min(...R.map((v) => v.s)) - SB / 2 : hs1;
    const sill = plates.find((m) => m.type === 'sill' && span(m)[1] > os0 + 0.01 && span(m)[0] < os1 - 0.01);
    const oy0 = sill ? sill.a[1] - SB / 2 : w.yb - 0.3;
    w.blocks.push({ s0: hs0, s1: hs1, y0: hy0, y1: hy1, header: h.id, opening: h.opening || null });
    w.blocks.push({ s0: os0, s1: os1, y0: oy0, y1: hy0, header: h.id, opening: h.opening || null, open: true, door: !sill });
  }
  // posts: studs side by side (a corner pair, a king and its jacks) are drilled as one
  w.posts = [];
  for (const v of verts) {
    const last = w.posts[w.posts.length - 1];
    if (last && v.s - last.s1 <= SB * 0.7 + 0.005) { last.members.push(v); last.s1 = v.s + SB / 2; }
    else w.posts.push({ s0: v.s - SB / 2, s1: v.s + SB / 2, members: [v] });
  }
  w.bays = [];
  for (let i = 0; i + 1 < w.posts.length; i++) {
    const a = w.posts[i].s1, b = w.posts[i + 1].s0;
    if (b - a > 0.03) w.bays.push({ i: w.bays.length, s0: a, s1: b, sc: (a + b) / 2, left: w.posts[i], right: w.posts[i + 1] });
  }
  const top = w.yt - TOP_DROP;
  w.levels = LEVELS.map((h) => w.yb + h).filter((y) => y < top - 0.25).concat([top]);
  return w;
}

function floorOf(list) {
  const js = list.filter((m) => m.kind === 'joist' && m.stage === 'floor-frame' && (m.type === 'joist' || m.type === 'end'));
  if (js.length < 2) return null;
  const j0 = js[0], dx = js.reduce((s, m) => s + (m.b[0] - m.a[0]), 0), dz = js.reduce((s, m) => s + (m.b[2] - m.a[2]), 0), l = Math.hypot(dx, dz) || 1;
  const J = [dx / l, dz / l], K = [-J[1], J[0]];
  const c = (p) => p[0] * K[0] + p[2] * K[1], t = (p) => p[0] * J[0] + p[2] * J[1];
  const lines = new Map();
  for (const m of js) {
    const key = Math.round(c(m.a) * 200);
    const L = lines.get(key) || { c: c(m.a), ids: [], t0: Infinity, t1: -Infinity };
    L.ids.push(m.id); L.t0 = Math.min(L.t0, t(m.a), t(m.b)); L.t1 = Math.max(L.t1, t(m.a), t(m.b));
    lines.set(key, L);
  }
  const ls = [...lines.values()].sort((p, q) => p.c - q.c);
  const D = j0.section.d, jy = j0.a[1];
  const rims = list.filter((m) => m.kind === 'joist' && m.type === 'rim').map((m) => m.id);
  return { id: j0.parent, J, K, c, t, lines: ls, D, jy, JT: jy + D / 2, JB: jy - D / 2, top: jy + D / 2 + 0.018, B: j0.section.b, rims,
    at: (cc, y, tt) => [K[0] * cc + J[0] * tt, y, K[1] * cc + J[1] * tt] };
}

export function channelsFromMembers(list, opts = {}) {
  const verts = [], edges = [], vid = new Map();
  const V = (id, p, tag, extra) => { const v = { id, p: P3(p), tag, ...extra }; verts.push(v); vid.set(id, v); return v; };
  const E = (a, b, tag, host, extra = {}) => {
    const A = vid.get(a), B = vid.get(b); if (!A || !B) return;
    const pts = [A.p, ...(extra.via || []), B.p];
    let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    const e = { a, b, lengthM: r3(Math.max(0.001, L)), tag, host: host ?? null, ...extra };
    if (e.via) e.via = e.via.map(P3);
    if (e.bore) e.bore = { ...e.bore, at: P3(e.bore.at) };
    edges.push(e);
  };
  const byParent = new Map();
  for (const m of list) { if (!byParent.has(m.parent)) byParent.set(m.parent, []); byParent.get(m.parent).push(m); }
  const walls = [];
  for (const [id, ms] of byParent) { if (!ms.some((m) => m.kind === 'stud')) continue; const w = wallOf(id, ms); if (w) walls.push(w); }
  walls.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const floor = floorOf(list);
  const crawl = !!floor && CRAWL.has(opts.found) && !(opts.level > 0);
  const atticY = walls.length ? Math.max(...walls.map((w) => w.yt)) + 0.05 : null;

  // ---- walls
  for (const w of walls) {
    const wv = (b, li) => w.id + ':' + b + ':' + li;
    for (const bay of w.bays) {
      bay.verts = [];
      w.levels.forEach((y, li) => { if (!inBlock(w, bay.sc, y)) { V(wv(bay.i, li), wallAt(w, bay.sc, y), 'wall', { wall: w.id, bay: bay.i }); bay.verts.push({ li, y, id: wv(bay.i, li) }); } });
      for (let k = 1; k < bay.verts.length; k++) {
        const a = bay.verts[k - 1], b = bay.verts[k];
        if (!blockedV(w, bay.sc, a.y, b.y)) E(a.id, b.id, 'stud', w.id);
      }
      // up through the plates into the attic
      const top = bay.verts[bay.verts.length - 1], tp = w.tops.find((x) => bay.sc > x[0] && bay.sc < x[1]);
      if (top && top.li === w.levels.length - 1 && tp) {
        const aid = 'A:' + w.id + ':' + bay.i;
        V(aid, wallAt(w, bay.sc, w.yt + 0.05), 'attic', { wall: w.id, bay: bay.i });
        bay.attic = aid;
        E(top.id, aid, 'top', w.id, { bore: { at: wallAt(w, bay.sc, w.yt - w.SB), parent: tp[2], depthM: w.SD, kind: 'plate', plies: w.caps ? 2 : 1, top: true, bearing: true } });
      }
    }
    // sideways through the posts between bays
    for (let i = 0; i + 1 < w.bays.length; i++) {
      const A = w.bays[i], B = w.bays[i + 1];
      for (const va of A.verts) {
        const vb = B.verts.find((x) => x.li === va.li); if (!vb) continue;
        if (blockedH(w, va.y, A.sc, B.sc)) continue;
        const posts = w.posts.filter((p) => p.s0 >= A.s1 - 1e-6 && p.s1 <= B.s0 + 1e-6);
        const crossed = posts.flatMap((p) => p.members.filter((m) => va.y >= m.y0 - 1e-6 && va.y <= m.y1 + 1e-6));
        const extra = { level: r3(va.y - w.yb) };
        if (crossed.length) {
          const ps = (Math.min(...crossed.map((m) => m.s)) + Math.max(...crossed.map((m) => m.s))) / 2;
          extra.bore = { at: wallAt(w, ps, va.y), parent: crossed[0].id, depthM: w.SD, kind: 'stud', plies: crossed.length, bearing: w.out !== 0 };
        }
        E(va.id, vb.id, 'wall', w.id, extra);
      }
    }
    for (let i = 0; i + 1 < w.bays.length; i++) if (w.bays[i].attic && w.bays[i + 1].attic) E(w.bays[i].attic, w.bays[i + 1].attic, 'attic', null);
  }

  // ---- corners and tees: walls that meet
  const ends = (w) => [[0, wallAt(w, 0, 0)], [w.L, wallAt(w, w.L, 0)]];
  const endBay = (w, s) => (s < w.L / 2 ? w.bays[0] : w.bays[w.bays.length - 1]);
  const nearBay = (w, s) => w.bays.reduce((b, x) => (!b || Math.abs(x.sc - s) < Math.abs(b.sc - s) ? x : b), null);
  let ci = 0;
  for (const w1 of walls) for (const [s1, p1] of ends(w1)) for (const w2 of walls) {
    if (w2 === w1) continue;
    const s2 = sOf(w2, p1), off = offOf(w2, p1);
    if (Math.abs(off) > w2.SD / 2 + w1.SD + 0.05 || s2 < -0.2 || s2 > w2.L + 0.2) continue;
    const isCorner = s2 < 0.2 || s2 > w2.L - 0.2;
    if (isCorner && w1.id > w2.id) continue;                                  // a corner once, from the lower id
    const b1 = endBay(w1, s1), b2 = isCorner ? endBay(w2, s2) : nearBay(w2, s2);
    if (!b1 || !b2) continue;
    if (b1.attic && b2.attic) E(b1.attic, b2.attic, 'attic', null);
    const post1 = s1 < w1.L / 2 ? w1.posts[0] : w1.posts[w1.posts.length - 1];
    const cs = isCorner ? (s2 < w2.L / 2 ? 0 : w2.L) : s2;
    const post2 = isCorner ? (s2 < w2.L / 2 ? w2.posts[0] : w2.posts[w2.posts.length - 1]) : null;
    for (const va of b1.verts || []) {
      const vb = (b2.verts || []).find((x) => Math.abs(x.y - va.y) < 0.01); if (!vb) continue;
      const cid = 'C' + ci++, cp = wallAt(w2, Math.max(0, Math.min(w2.L, cs)), va.y);
      V(cid, cp, 'corner');
      const m1 = post1.members.filter((m) => va.y >= m.y0 && va.y <= m.y1);
      E(va.id, cid, 'corner', w1.id, m1.length ? { bore: { at: wallAt(w1, (post1.s0 + post1.s1) / 2, va.y), parent: m1[0].id, depthM: w1.SD, kind: 'stud', plies: m1.length, bearing: w1.out !== 0 } } : {});
      const m2 = post2 ? post2.members.filter((m) => va.y >= m.y0 && va.y <= m.y1) : [];
      if (!post2 && blockedH(w2, va.y, cs, b2.sc)) continue;
      E(cid, vb.id, 'corner', w2.id, m2.length ? { bore: { at: wallAt(w2, (post2.s0 + post2.s1) / 2, va.y), parent: m2[0].id, depthM: w2.SD, kind: 'stud', plies: m2.length, bearing: w2.out !== 0 } } : {});
    }
  }

  // ---- ceiling joists: across the attic
  const atticVerts = verts.filter((v) => v.tag === 'attic');
  const ceiling = list.filter((m) => m.kind === 'joist' && m.type === 'ceiling').map((m) => ({ id: m.id, a: m.a, b: m.b, parent: m.parent }));
  const nearestAttic = (p, maxD) => { let best = null, bd = maxD; for (const v of atticVerts) { const d = dxz(v.p, p); if (d < bd) { bd = d; best = v; } } return best; };
  for (const cj of ceiling) {
    const A = nearestAttic(cj.a, 0.9), B = nearestAttic(cj.b, 0.9);
    if (A && B && A !== B) E(A.id, B.id, 'attic', cj.parent, { via: [[cj.a[0], A.p[1], cj.a[2]], [cj.b[0], B.p[1], cj.b[2]]] });
  }

  // ---- floor: joist bays, and the holes down into them from the walls
  let F = null;
  if (floor) {
    F = floor;
    const bays = [];
    for (let k = 0; k + 1 < floor.lines.length; k++) {
      const a = floor.lines[k], b = floor.lines[k + 1];
      if (b.c - a.c < 0.05) continue;
      bays.push({ k: bays.length, c0: a.c, c1: b.c, cc: (a.c + b.c) / 2, t0: Math.max(a.t0, b.t0), t1: Math.min(a.t1, b.t1), right: b, ts: [], downs: [] });
    }
    F.bays = bays;
    const bayAtC = (c) => bays.find((b) => c > b.c0 && c < b.c1) || null;
    // wall bays that sit over the floor: a hole through the bottom plate
    for (const w of walls) for (const bay of w.bays) {
      const low = bay.verts && bay.verts[0], bp = w.bottoms.find((x) => bay.sc > x[0] + 0.02 && bay.sc < x[1] - 0.02);
      if (!low || !bp) continue;
      const pin = wallAt(w, bay.sc, 0, -(w.out || 0) * (w.SD / 2 + 0.06)), fb = bayAtC(floor.c(pin));
      if (!fb) continue;
      const tt = Math.max(fb.t0 + 0.05, Math.min(fb.t1 - 0.05, floor.t(pin)));
      fb.downs.push({ t: tt, from: low.id, w, bay, bp });
    }
    const yv = crawl ? floor.JB - 0.06 : floor.jy;
    for (const b of bays) {
      const ts = [];
      for (let tt = b.t0 + 0.15; tt <= b.t1 - 0.15 + 1e-6; tt += 0.6) ts.push({ t: tt });
      for (const d of b.downs) ts.push({ t: d.t, down: d });
      ts.sort((p, q) => p.t - q.t);
      for (const x of ts) {
        const prev = b.ts[b.ts.length - 1];
        if (prev && x.t - prev.t < 0.05) { if (x.down) (prev.downs || (prev.downs = [])).push(x.down); continue; }
        x.id = 'F:' + b.k + ':' + b.ts.length; x.downs = x.down ? [x.down] : [];
        V(x.id, floor.at(b.cc, yv, x.t), 'floor', { yMin: crawl ? floor.JB - 0.6 : floor.JB, yTop: crawl ? floor.JB - 0.02 : floor.JT, floor: floor.id });
        b.ts.push(x);
      }
      for (let i = 1; i < b.ts.length; i++) E(b.ts[i - 1].id, b.ts[i].id, 'floor', floor.id);
      for (const x of b.ts) for (const d of x.downs) {
        const w = d.w, top = wallAt(w, d.bay.sc, floor.JT - 0.03);
        E(d.from, x.id, 'down', w.id, { via: [top], bore: { at: wallAt(w, d.bay.sc, w.yb), parent: d.bp[2], depthM: w.SD, kind: 'plate', plies: 1, bearing: true } });
      }
    }
    // across the joists: a hole in each, or hung under them over a crawl space
    for (let k = 0; k + 1 < bays.length; k++) {
      const A = bays[k], B = bays[k + 1];
      for (const x of A.ts) {
        let y = null, bd = 0.35;
        for (const z of B.ts) { const d = Math.abs(z.t - x.t); if (d < bd) { bd = d; y = z; } }
        if (!y) continue;
        const tm = (x.t + y.t) / 2;
        if (crawl) E(x.id, y.id, 'under', floor.id);
        else E(x.id, y.id, 'joist', floor.id, { bore: { at: floor.at(B.c0, floor.jy, tm), parent: A.right.ids[0], depthM: floor.D, kind: 'joist', plies: 1, bearing: true } });
      }
    }
  }
  return { verts, edges, walls, floor: F, attic: atticY != null ? { y: atticY } : null, crawl, ceiling };
}

// ------------------------------------------------------------------------------------------- free points
const wallOfPoint = (ch, p, prefer) => {
  let best = null;
  for (const w of ch.walls) {
    const s = sOf(w, p), off = offOf(w, p);
    if (s < -0.05 || s > w.L + 0.05 || Math.abs(off) > w.SD / 2 + 0.25 || p[1] < w.yb - 0.05 || p[1] > w.yt + 0.05) continue;
    const score = Math.abs(off) - (prefer && w.id === prefer ? 1 : 0);
    if (!best || score < best.score) best = { w, s, off, score };
  }
  return best;
};

export function attach(ch, p, opts = {}) {
  if (!ch || !p) return null;
  const links = [];
  const W = wallOfPoint(ch, p, opts.wall);
  if (W) {
    const w = W.w;
    if (inBlock(w, W.s, p[1])) return null;
    let bay = w.bays.find((b) => W.s >= b.s0 - 0.03 && W.s <= b.s1 + 0.03);
    if (!bay) bay = w.bays.reduce((b, x) => (!b || Math.abs(x.sc - W.s) < Math.abs(b.sc - W.s) ? x : b), null);
    if (!bay || !bay.verts) return null;
    const into = wallAt(w, bay.sc, p[1]);
    const above = bay.verts.filter((v) => v.y >= p[1] - 1e-6).sort((a, b) => a.y - b.y)[0];
    const below = bay.verts.filter((v) => v.y < p[1] - 1e-6).sort((a, b) => b.y - a.y)[0];
    for (const v of [above, below]) if (v && !blockedV(w, bay.sc, p[1], v.y)) links.push({ v: v.id, tag: 'stud', host: w.id, via: [into] });
    if (links.length) return { p, links, wall: w.id };
  }
  const F = ch.floor;
  if (ch.attic && p[1] >= ch.attic.y - 0.3) {
    const vs = ch.verts.filter((v) => v.tag === 'attic').map((v) => [dxz(v.p, p), v]).sort((a, b) => a[0] - b[0]).slice(0, 3).filter((x) => x[0] < 4.5);
    for (const [, v] of vs) links.push({ v: v.id, tag: 'attic', host: null, via: [[p[0], v.p[1], p[2]]] });
    if (links.length) return { p, links };
  }
  if (F && p[1] <= F.top + 0.08 && p[1] >= F.JB - 0.8) {
    const c = F.c(p), bay = F.bays.find((b) => c > b.c0 && c < b.c1);
    if (bay && bay.ts.length) {
      const tt = F.t(p), vs = bay.ts.map((x) => [Math.abs(x.t - tt), x]).sort((a, b) => a[0] - b[0]).slice(0, 2);
      const y = vs.length ? ch.verts.find((v) => v.id === vs[0][1].id).p[1] : F.jy;
      for (const [, x] of vs) links.push({ v: x.id, tag: 'drop', host: F.id, via: [[p[0], y, p[2]]] });
      if (links.length) return { p, links };
    }
    // just outside the floor (a pipe leaving through the rim): the nearest joist bays
    const fl = ch.verts.filter((v) => v.tag === 'floor').map((v) => [dxz(v.p, p), v]).sort((a, b) => a[0] - b[0]).slice(0, 2).filter((x) => x[0] < 1.2);
    for (const [, v] of fl) links.push({ v: v.id, tag: 'out', host: F.id, via: [[p[0], v.p[1], p[2]]], bore: { at: [(p[0] + v.p[0]) / 2, v.p[1], (p[2] + v.p[2]) / 2], parent: F.rims[0] || null, depthM: F.B, kind: 'rim', plies: 1 } });
    if (links.length) return { p, links };
  }
  return null;
}

// Where a frame-local ray first meets a wall, the floor or the ceiling.
export function rayHit(ch, o, d, opts = {}) {
  if (!ch) return null;
  const maxT = opts.maxT || 30;
  let best = null;
  const take = (h) => { if (h.t > 0.02 && h.t < maxT && (!best || h.t < best.t)) best = h; };
  for (const w of ch.walls) {
    const den = d[0] * w.n[0] + d[2] * w.n[1];
    if (Math.abs(den) < 1e-6) continue;
    const side = Math.sign((o[0] - w.o[0]) * w.n[0] + (o[2] - w.o[1]) * w.n[1]) || 1;
    // the face the viewer sees: half the stud depth out on their side
    const t = ((w.o[0] + w.n[0] * side * w.SD / 2 - o[0]) * w.n[0] + (w.o[1] + w.n[1] * side * w.SD / 2 - o[2]) * w.n[1]) / den;
    const pt = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], s = sOf(w, pt);
    if (s < -0.02 || s > w.L + 0.02 || pt[1] < w.yb - 0.25 || pt[1] > w.yt + 0.02) continue;
    take({ kind: 'wall', t, point: pt, wall: w.id, s, y: pt[1], side });
  }
  const F = ch.floor, bb = (() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const w of ch.walls) for (const s of [0, w.L]) { const q = wallAt(w, s, 0); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); }
    return { x0, x1, z0, z1 };
  })();
  const inBox = (pt, m) => pt[0] > bb.x0 - m && pt[0] < bb.x1 + m && pt[2] > bb.z0 - m && pt[2] < bb.z1 + m;
  if (Math.abs(d[1]) > 1e-6) {
    if (F && d[1] < 0) { const t = (F.top - o[1]) / d[1], pt = [o[0] + d[0] * t, F.top, o[2] + d[2] * t]; if (inBox(pt, 0)) take({ kind: 'floor', t, point: pt, y: F.top }); }
    if (ch.attic && d[1] > 0) { const y = ch.attic.y - 0.05, t = (y - o[1]) / d[1], pt = [o[0] + d[0] * t, y, o[2] + d[2] * t]; if (inBox(pt, 0)) take({ kind: 'ceiling', t, point: pt, y }); }
  }
  return best;
}

// Where a box or stub goes for a hit: beside the nearest stud at a height, on the floor between joists, or on
// the ceiling beside a joist. side: which face of the wall (+ the wall's n side); boxes go on the inside.
export function snap(ch, hit, opts = {}) {
  if (!ch || !hit) return null;
  const half = opts.box ?? 0.035, depth = opts.depth ?? 0.07;
  if (hit.kind === 'wall') {
    const w = ch.walls.find((x) => x.id === hit.wall); if (!w) return null;
    if (opts.exit) {
      if (!w.out || !ch.floor) return { refused: 'A pipe leaves the building through an outside wall above a framed floor.' };
      const bay = w.bays.reduce((b, x) => (!b || Math.abs(x.sc - hit.s) < Math.abs(b.sc - hit.s) ? x : b), null);
      if (!bay) return null;
      const y = ch.crawl ? ch.floor.JB - 0.06 : ch.floor.jy;
      return { at: P3(wallAt(w, bay.sc, y, w.out * (w.SD / 2 + 0.06))), wall: w.id, s: bay.sc, y, side: w.out, host: { parent: w.id }, onto: 'exit' };
    }
    const y = opts.heightM != null ? w.yb + opts.heightM : hit.y;
    const side = w.out ? -w.out : hit.side || 1;
    // the stud nearest the aim, among those that stand at that height
    let st = null;
    for (const p of w.posts) for (const m of p.members) if (y >= m.y0 && y <= m.y1 && (!st || Math.abs(m.s - hit.s) < Math.abs(st.s - hit.s))) st = m;
    if (!st) return { refused: 'No stud to fix to there.' };
    const dir = hit.s >= st.s ? 1 : -1;
    let s = st.s + dir * (w.SB / 2 + half);
    if (inBlock(w, s, y) || !w.bays.some((b) => s > b.s0 - 1e-6 && s < b.s1 + 1e-6)) s = st.s - dir * (w.SB / 2 + half);
    if (inBlock(w, s, y)) return { refused: 'That height is in a window or door opening.' };
    if (!w.bays.some((b) => s > b.s0 - 1e-6 && s < b.s1 + 1e-6)) return { refused: 'No room between the studs there.' };
    // the box's face at the finished wall: proud of the stud by the lining (and a hair more, so it is not lost in it)
    const fin = w.finish ? w.finish + 0.001 : 0;
    return { at: P3(wallAt(w, s, y, side * (w.SD / 2 + fin - depth / 2))), wall: w.id, s, y, side, host: { parent: w.id, member: st.id }, onto: 'stud' };
  }
  if (hit.kind === 'floor' && ch.floor) {
    const F = ch.floor, c = F.c(hit.point), bay = F.bays.find((b) => c > b.c0 && c < b.c1);
    if (!bay) return { refused: 'Not over the floor frame.' };
    return { at: P3(F.at(bay.cc, F.top, F.t(hit.point))), s: F.t(hit.point), y: F.top, side: 1, host: { parent: F.id }, onto: 'floor' };
  }
  if (hit.kind === 'ceiling') {
    let at = [hit.point[0], hit.y, hit.point[2]];
    // beside the nearest ceiling joist
    let best = null;
    for (const cj of ch.ceiling) {
      const ax = cj.b[0] - cj.a[0], az = cj.b[2] - cj.a[2], L2 = ax * ax + az * az || 1, k = Math.max(0, Math.min(1, ((at[0] - cj.a[0]) * ax + (at[2] - cj.a[2]) * az) / L2));
      const q = [cj.a[0] + ax * k, at[1], cj.a[2] + az * k], dd = dxz(q, at);
      if (dd < 0.8 && (!best || dd < best.d)) best = { d: dd, q, cj, ax, az, L: Math.sqrt(L2) };
    }
    if (best) {
      const nx = -best.az / best.L, nz = best.ax / best.L, sg = Math.sign((at[0] - best.q[0]) * nx + (at[2] - best.q[2]) * nz) || 1;
      at = [best.q[0] + nx * sg * (0.019 + 0.06), at[1], best.q[2] + nz * sg * (0.019 + 0.06)];
    }
    return { at: P3(at), y: at[1], side: -1, host: { parent: best ? best.cj.parent : null, member: best ? best.cj.id : undefined }, onto: 'ceiling' };
  }
  return null;
}

// ------------------------------------------------------------------------------------------- the page
const cache = new Map();
export function channelsFor(structId, build = globalThis.__build) {
  if (!build || !build.structs) return null;
  const s = build.structs().find((x) => String(x.id) === String(structId));
  if (!s) return null;
  const c = cache.get(String(structId));
  if (c && c.ver === s.ver && c.found === s.found) return c.ch;
  const m = build.membersOf(s.id);
  if (!m) return null;
  const ch = channelsFromMembers(m.list, { found: s.found, level: s.level });
  ch.struct = s.id; ch.ver = s.ver;
  cache.set(String(structId), { ver: s.ver, found: s.found, ch });
  return ch;
}
