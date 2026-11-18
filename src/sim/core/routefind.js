// Route finding over channels: the cheapest way from one point to another through a graph of places a run may
// pass, and a few different alternatives. Generic and pure: it knows nothing about what is being routed or what
// the channels are made of. Content supplies the channels (src/sim/content/frame-channels.js builds them from a
// building's frame) and a rule (what an edge costs, whether a run of this kind may take it, a last check).
//
// INTERFACE
//   find(channels, from, to, rule?, k = 3) -> [{ path, lengthM, bores, hosts, tags, verts, why }] | { refused: reason }
//     channels { verts: [{ id, p: [x, y, z], tag?, yMin? }], edges: [{ a, b, lengthM?, bore?, tag?, host?, via?, level? }] }
//       an edge is walked both ways; via: points between a and b (in a-to-b order) for the drawn path;
//       bore: { at, parent, depthM, kind, plies? } a hole the run needs to pass this edge.
//     from, to: a vert id, or a free point joined to the channels by its own edges:
//       { id?, p, links: [{ v, lengthM?, bore?, tag?, host?, via? }] }   (via in point-to-vert order)
//     rule {
//       cost?(edge, step) -> number          default lengthM + 0.3 per bore. step = { from: vert, to: vert, dir: 1 | -1 }
//       allowed?(edge, step) -> true | false | 'reason'   a string is a plain-words reason, kept for a refusal
//       finish?(result) -> result | { refused }          a last look at a whole route (a fall to add, a limit)
//     }
//     k: how many different routes to try for. Alternatives come from penalising what the earlier ones used:
//     their edges, and the tags of their edges (through the wall, over the top, under the floor).
//   Result: path [[x, y, z]] through every vert and via point; lengthM along it; bores [{ ...bore, seg, t }]
//   (seg: the path segment it is on, t: how far along it); hosts: the hosts passed, in order, once each;
//   tags: { [tag]: metres }; verts: the vert of each path point or null; why: 'wall' | 'over' | 'under' plus
//   a level word, for the caller to put in words.

const LOWEST = { refused: 'No way through the frame from here to there.' };

class Heap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }

// The graph once, with the two free points spliced in: adjacency lists of { e, to, dir }.
function graphOf(ch, from, to) {
  const verts = new Map(), adj = new Map();
  for (const v of ch.verts || []) { verts.set(v.id, v); adj.set(v.id, []); }
  const edges = [];
  const add = (e) => {
    if (!verts.has(e.a) || !verts.has(e.b) || e.a === e.b) return;
    const pts = [verts.get(e.a).p, ...(e.via || []), verts.get(e.b).p];
    const ed = { ...e, lengthM: e.lengthM > 0 ? e.lengthM : polyLen(pts), i: edges.length };
    edges.push(ed);
    adj.get(e.a).push({ e: ed, to: e.b, dir: 1 });
    adj.get(e.b).push({ e: ed, to: e.a, dir: -1 });
  };
  for (const e of ch.edges || []) add(e);
  const end = (x, name) => {
    if (typeof x === 'string' || typeof x === 'number') return verts.has(String(x)) ? String(x) : null;
    if (!x || !x.p) return null;
    const id = x.id != null ? String(x.id) : '@' + name;
    if (!verts.has(id)) { verts.set(id, { id, p: x.p, free: true }); adj.set(id, []); }
    for (const L of x.links || []) {
      if (!verts.has(L.v)) continue;
      add({ ...L, a: id, b: L.v });
    }
    return id;
  };
  const a = end(from, 'from'), b = end(to, 'to');
  return { verts, adj, edges, a, b };
}

function dijkstra(g, rule, pen, reasons) {
  const best = new Map([[g.a, 0]]), prev = new Map(), heap = new Heap();
  heap.push(0, g.a);
  const seen = new Set();
  while (heap.size) {
    const [d, v] = heap.pop();
    if (seen.has(v)) continue;
    seen.add(v);
    if (v === g.b) break;
    for (const st of g.adj.get(v)) {
      if (seen.has(st.to)) continue;
      const step = { from: g.verts.get(v), to: g.verts.get(st.to), dir: st.dir };
      if (rule.allowed) {
        const ok = rule.allowed(st.e, step);
        if (ok !== true && ok !== undefined) { if (typeof ok === 'string') reasons.set(ok, (reasons.get(ok) || 0) + 1); continue; }
      }
      let c = rule.cost ? rule.cost(st.e, step) : st.e.lengthM + (st.e.bore ? 0.3 : 0);
      if (!(c >= 0)) c = st.e.lengthM;
      c *= pen(st.e);
      const nd = d + c;
      if (nd < (best.has(st.to) ? best.get(st.to) : Infinity) - 1e-12) { best.set(st.to, nd); prev.set(st.to, st); heap.push(nd, st.to); }
    }
  }
  if (!seen.has(g.b)) return null;
  const steps = [];
  for (let v = g.b; v !== g.a;) { const st = prev.get(v); steps.push({ ...st, from: st.dir === 1 ? st.e.a : st.e.b }); v = steps[steps.length - 1].from; }
  steps.reverse();
  return { steps, cost: best.get(g.b) };
}

// Steps to a drawn route: points, bores placed on their segments, hosts and tags.
function resultOf(g, steps) {
  const path = [g.verts.get(g.a).p.slice()], verts = [g.verts.get(g.a)];
  const bores = [], hosts = [], tags = {};
  let wallH = 0, wallL = 0;
  for (const st of steps) {
    const e = st.e, via = e.via ? (st.dir === 1 ? e.via : e.via.slice().reverse()) : [];
    const segStart = path.length - 1;
    for (const q of via) { path.push(q.slice()); verts.push(null); }
    path.push(g.verts.get(st.to).p.slice()); verts.push(g.verts.get(st.to).free ? null : g.verts.get(st.to));
    if (e.tag) tags[e.tag] = (tags[e.tag] || 0) + e.lengthM;
    if (e.host != null && !hosts.includes(e.host)) hosts.push(e.host);
    if (e.level != null) { wallH += e.level * e.lengthM; wallL += e.lengthM; }
    if (e.bore) {
      // the segment of this edge's polyline that the bore lies on, and how far along it
      let bi = segStart, bt = 0, bd = Infinity;
      for (let i = segStart; i < path.length - 1; i++) {
        const A = path[i], B = path[i + 1], AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((e.bore.at[0] - A[0]) * AB[0] + (e.bore.at[1] - A[1]) * AB[1] + (e.bore.at[2] - A[2]) * AB[2]) / L2));
        const d = dist([A[0] + AB[0] * t, A[1] + AB[1] * t, A[2] + AB[2] * t], e.bore.at);
        if (d < bd) { bd = d; bi = i; bt = t; }
      }
      bores.push({ ...e.bore, at: e.bore.at.slice(), seg: bi, t: bt });
    }
  }
  // drop repeated points (a via that lands on a vert)
  for (let i = path.length - 1; i > 0; i--) if (dist(path[i], path[i - 1]) < 1e-6) {
    path.splice(i, 1); const v = verts.splice(i, 1)[0]; if (v && !verts[i - 1]) verts[i - 1] = v;
    for (const b of bores) if (b.seg >= i) b.seg--;
  }
  const why = tags.attic || tags.over ? 'over' : tags.floor || tags.joist || tags.under ? 'under' : 'wall';
  const level = wallL ? wallH / wallL : null;
  return { path, lengthM: polyLen(path), bores, hosts, tags, verts, why, level };
}

export function find(channels, from, to, rule = {}, k = 3) {
  const g = graphOf(channels || {}, from, to);
  if (!g.a || !g.b) return { refused: 'That spot is not on the frame.' };
  if (g.a === g.b) return { refused: 'Both ends are the same place.' };
  const out = [], reasons = new Map(), usedE = new Map(), usedT = new Map(), sigs = new Set();
  let finishRefusal = null;
  const pen = (e) => 1 + (usedE.get(e.i) || 0) * 3 + (e.tag && usedT.has(e.tag) ? usedT.get(e.tag) * 1.5 : 0);
  for (let tries = 0; out.length < Math.max(1, k) && tries < k * 3; tries++) {
    const r = dijkstra(g, rule, pen, reasons);
    if (!r) break;
    for (const st of r.steps) { usedE.set(st.e.i, (usedE.get(st.e.i) || 0) + 1); if (st.e.tag) usedT.set(st.e.tag, (usedT.get(st.e.tag) || 0) + 1); }
    const sig = r.steps.map((s) => s.e.i).join(',');
    if (sigs.has(sig)) continue;
    sigs.add(sig);
    let res = resultOf(g, r.steps);
    if (out.length && res.lengthM > out[0].lengthM * 2.5 + 1) continue;          // a silly long way round is no alternative
    if (rule.finish) {
      const f = rule.finish(res);
      if (!f || f.refused) { finishRefusal = finishRefusal || (f && f.refused) || 'That way does not work.'; continue; }
      res = f;
    }
    out.push(res);
  }
  if (out.length) return out;
  if (finishRefusal) return { refused: finishRefusal };
  let top = null;
  for (const [why, n] of reasons) if (!top || n > top[1]) top = [why, n];
  return top ? { refused: top[0] } : LOWEST;
}
