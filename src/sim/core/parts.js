// Parts: kit parts that click together end to end on a 3D lattice. A generic mechanism: it knows
// nothing about what the parts carry. Content supplies the kinds and which end types mate; a content
// system then reads the graph of what is joined and makes of it what it likes (a run of conduit, a circuit,
// a flue, a gutter line, a fence).
//
// INTERFACE
//   createPartsSystem({ name = 'parts', stepM = 0.25, kinds, mates }) -> a simulation system
//     kinds   { [kindId]: { id, name?, ends: [{ id, type, at: [x, y, z], dir: [x, y, z] }],   // local, lattice units
//                           stretch?: { min, max, end },   // a kind that comes in lengths along local +x: the end
//                                                         // named `end` sits at [len, 0, 0]; it can be cut shorter
//                           set?: { ...defaults },         // per-part settings (a switch, a gate)
//                           anchor?: true,                 // only ever placed fixed, by the game (a socket on equipment)
//                           thin?: true } }                // takes up no room: a face on something else, so a fitting can sit right on it
//     mates   { [endType]: [endTypes it joins] }
//   State (plain JSON, saved): { v, version, next, origin: { x, y, z, yaw }, parts: { [id]: part } }
//     part = { id, kind, len?, at: [i, j, k] | null, rot: 0..23, pose: { x, y, z, yaw } | null, fixed?, ref?, set? }
//     at !== null  -> fitted: fixed geometry on the lattice, turned by ROTATIONS[rot]
//     at === null  -> loose: lying in the world at `pose` (metres)
//     fixed        -> put there by the game; cannot be taken off.  ref: whatever the content wants to remember
//   Lattice: point p (integers) is at origin + yaw-turned p * stepM. Fitted parts never move.
//   A fitting sits on one lattice point. A stretch part spans len steps. Two ends are joined when they are at
//   the same point, face each other, and their types mate. Joins are derived, never stored: nothing to desync.
//   Commands (all return { ok, ... } or { ok: false, reason }), each bumps `version` and emits '<name>.changed':
//     <name>.setOrigin { x, y, z, yaw }
//     <name>.spawn     { kind, len?, pose, id? }            -> { ok, id }      a loose part
//     <name>.anchor    { id, kind, at, rot, ref }           -> { ok, id }      a fixed fitted part (idempotent)
//     <name>.fit       { id, at, rot, free? }               -> { ok, joins }   must join something unless free
//     <name>.unfit     { id, pose }                         -> { ok }
//     <name>.move      { id, pose }                         -> { ok }          a loose part came to rest somewhere
//     <name>.cut       { id, len, pose? }                   -> { ok, offcut }  shorten; the rest is a new loose part
//     <name>.set       { id, key, value }                   -> { ok }
//     <name>.remove    { id }                               -> { ok }
//   Pure read-outs, exported, given (kinds, mates, state):
//     partEnds(kinds, part)                  -> [{ id, type, p, d }] in lattice coordinates
//     graph(sys, state)                      -> { joins, open, adj, version }  (cached per state object and version)
//     placements(sys, state, kind, len, end) -> [{ at, rot, len, end }]  every way `kind` can sit on that open end
//     canFit(sys, state, { kind, len, at, rot, ignore? }) -> { ok, joins, reason }
//     toWorld(state, p, stepM) / toLattice(state, w, stepM)
//     rotationTo(xDir, yDir?)                -> the orientation index that points local +x (and +y) that way
//   sys.api = { name, kinds, mates, stepM, partEnds, graph, placements, canFit, toWorld, toLattice, lengthOf, ROTATIONS, rotate, rotationTo }

const STATE_V = 1;

// The 24 ways a box can sit square on the lattice: rows of a rotation matrix with integer entries.
export const ROTATIONS = (() => {
  const out = [], ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < 3; i++) for (const si of [1, -1]) for (let j = 0; j < 3; j++) {
    if (j === i) continue;
    for (const sj of [1, -1]) {
      const x = ax[i].map((v) => v * si), y = ax[j].map((v) => v * sj), z = cross(x, y);
      out.push([x, y, z]);                 // columns: where local x, y and z point
    }
  }
  return Object.freeze(out);
})();
export const rotate = (rot, v) => {
  const [x, y, z] = ROTATIONS[rot];
  return [x[0] * v[0] + y[0] * v[1] + z[0] * v[2], x[1] * v[0] + y[1] * v[1] + z[1] * v[2], x[2] * v[0] + y[2] * v[1] + z[2] * v[2]];
};
// The orientation that points local +x along xDir (and local +y along yDir, when given). -1 if there is none.
export const rotationTo = (xDir, yDir) => ROTATIONS.findIndex((m) => m[0].join() === xDir.join() && (!yDir || m[1].join() === yDir.join()));
const key = (p) => p[0] + ',' + p[1] + ',' + p[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const neg = (a) => [-a[0], -a[1], -a[2]];
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const lenOf = (spec, part) => (spec.stretch ? Math.max(spec.stretch.min, Math.min(spec.stretch.max, Math.round(part.len ?? spec.stretch.max))) : 0);
function localEnds(spec, len) {
  if (!spec.stretch) return spec.ends;
  return spec.ends.map((e) => (e.id === spec.stretch.end ? { ...e, at: [len, 0, 0] } : e));
}
export function partEnds(kinds, part) {
  const spec = kinds[part.kind];
  if (!spec || !part.at) return [];
  return localEnds(spec, lenOf(spec, part)).map((e) => ({ id: e.id, type: e.type, p: add(part.at, rotate(part.rot, e.at)), d: rotate(part.rot, e.dir) }));
}
// What a part takes up, in doubled lattice coordinates (so the middle of a step has a key of its own):
// a fitting takes its point; a stretch part takes every step it spans and every point strictly inside.
function occupancy(kinds, part) {
  const spec = kinds[part.kind], out = [];
  if (spec.thin) return out;
  if (!spec.stretch) { out.push(key([part.at[0] * 2, part.at[1] * 2, part.at[2] * 2])); return out; }
  const d = rotate(part.rot, [1, 0, 0]), n = lenOf(spec, part);
  for (let i = 1; i < 2 * n; i++) out.push(key([part.at[0] * 2 + d[0] * i, part.at[1] * 2 + d[1] * i, part.at[2] * 2 + d[2] * i]));
  return out;
}

const graphs = new WeakMap();
export function graph(sys, state) {
  const hit = graphs.get(state);
  if (hit && hit.version === state.version) return hit;
  const { kinds, mates } = sys, at = new Map(), joins = [], open = [], adj = new Map();
  for (const id in state.parts) {
    const part = state.parts[id];
    if (!part.at) continue;
    adj.set(id, []);
    for (const e of partEnds(kinds, part)) {
      const k = key(e.p), rec = { part: id, end: e.id, type: e.type, p: e.p, d: e.d, joined: false };
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(rec);
    }
  }
  for (const list of at.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.joined || b.joined || a.part === b.part || !same(a.d, neg(b.d)) || !(mates[a.type] || []).includes(b.type)) continue;
      a.joined = b.joined = true;
      joins.push({ a: { part: a.part, end: a.end }, b: { part: b.part, end: b.end }, p: a.p });
      adj.get(a.part).push({ end: a.end, other: b.part, otherEnd: b.end });
      adj.get(b.part).push({ end: b.end, other: a.part, otherEnd: a.end });
    }
    for (const e of list) if (!e.joined) open.push(e);
  }
  const g = { version: state.version, joins, open, adj };
  graphs.set(state, g);
  return g;
}

export function canFit(sys, state, q) {
  const { kinds, mates } = sys, spec = kinds[q.kind];
  if (!spec) return { ok: false, joins: 0, reason: 'unknown kind' };
  if (!(q.rot >= 0 && q.rot < 24) || !Array.isArray(q.at) || q.at.some((v) => !Number.isInteger(v))) return { ok: false, joins: 0, reason: 'off the lattice' };
  const probe = { kind: q.kind, len: q.len, at: q.at, rot: q.rot };
  const taken = new Set();
  for (const id in state.parts) { const p = state.parts[id]; if (p.at && id !== q.ignore) for (const k of occupancy(kinds, p)) taken.add(k); }
  for (const k of occupancy(kinds, probe)) if (taken.has(k)) return { ok: false, joins: 0, reason: 'something is in the way' };
  let joins = 0;
  const mine = partEnds(kinds, probe);
  for (const id in state.parts) {
    const p = state.parts[id];
    if (!p.at || id === q.ignore) continue;
    for (const e of partEnds(kinds, p)) for (const m of mine) if (same(e.p, m.p) && same(e.d, neg(m.d)) && (mates[m.type] || []).includes(e.type)) joins++;
  }
  return { ok: true, joins, reason: null };
}

// Every way a part of `kind` can sit on the open end `end` ({ p, d, type }): one entry per end of the kind
// that mates and per turn about the joint. A stretch part too long for the gap is offered cut to fit.
export function placements(sys, state, kind, len, end, ignore) {
  const { kinds, mates } = sys, spec = kinds[kind], out = [], seen = new Set();
  if (!spec) return out;
  const want = neg(end.d);
  const tryLen = (L) => {
    let any = false;
    for (const e of localEnds(spec, L)) {
      if (!(mates[e.type] || []).includes(end.type)) continue;
      for (let rot = 0; rot < 24; rot++) {
        if (!same(rotate(rot, e.dir), want)) continue;
        const at = add(end.p, neg(rotate(rot, e.at)));
        const probe = { kind, len: L, at, rot }, sig = partEnds(kinds, probe).map((x) => key(x.p) + '>' + key(x.d)).sort().join('|');
        if (seen.has(sig)) continue;
        if (!canFit(sys, state, { ...probe, ignore }).ok) continue;
        seen.add(sig); out.push({ at, rot, len: spec.stretch ? L : undefined, end: e.id }); any = true;
      }
    }
    return any;
  };
  if (!spec.stretch) tryLen(0);
  else for (let L = lenOf(spec, { len }); L >= spec.stretch.min; L--) if (tryLen(L)) break;
  return out;
}

export function toWorld(state, p, stepM) {
  const o = state.origin, c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), x = p[0] * stepM, z = p[2] * stepM;
  return { x: o.x + x * c + z * s, y: o.y + p[1] * stepM, z: o.z - x * s + z * c };
}
export function toLattice(state, w, stepM) {
  const o = state.origin, c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), dx = w.x - o.x, dz = w.z - o.z;
  return [(dx * c - dz * s) / stepM, (w.y - o.y) / stepM, (dx * s + dz * c) / stepM];
}

export function createPartsSystem({ name = 'parts', stepM = 0.25, kinds, mates }) {
  const sys = { kinds, mates, stepM };
  const fresh = () => ({ v: STATE_V, version: 1, next: 1, origin: { x: 0, y: 0, z: 0, yaw: 0 }, parts: {} });
  const ensure = (ctx) => { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return ctx.s; };
  const no = (reason) => ({ ok: false, reason });
  const touch = (ctx, why, id) => { ctx.s.version++; ctx.emit(name + '.changed', { version: ctx.s.version, why, id }); };
  const pose = (p) => ({ x: +p.x || 0, y: +p.y || 0, z: +p.z || 0, yaw: +p.yaw || 0 });
  const commands = {
    [name + '.setOrigin']: (ctx, p) => { ensure(ctx).origin = pose(p); touch(ctx, 'origin'); return { ok: true }; },
    [name + '.spawn']: (ctx, p = {}) => {
      const s = ensure(ctx), spec = kinds[p.kind];
      if (!spec || spec.anchor) return no('unknown kind');
      const id = p.id && !s.parts[p.id] ? String(p.id) : 'k' + s.next++;
      const part = { id, kind: spec.id, at: null, rot: 0, pose: pose(p.pose || {}) };
      if (spec.stretch) part.len = lenOf(spec, { len: p.len });
      if (spec.set) part.set = { ...spec.set };
      s.parts[id] = part;
      touch(ctx, 'spawn', id);
      return { ok: true, id };
    },
    [name + '.anchor']: (ctx, p = {}) => {
      const s = ensure(ctx), spec = kinds[p.kind];
      if (!spec || p.id == null) return no('unknown kind');
      const part = { id: String(p.id), kind: spec.id, at: p.at.map(Math.round), rot: p.rot | 0, pose: null, fixed: true, ref: p.ref ?? null };
      if (spec.stretch) part.len = lenOf(spec, { len: p.len });
      if (spec.set) part.set = { ...spec.set, ...(p.set || {}) };
      s.parts[part.id] = part;
      touch(ctx, 'anchor', part.id);
      return { ok: true, id: part.id };
    },
    [name + '.fit']: (ctx, p = {}) => {
      const s = ensure(ctx), part = s.parts[p.id];
      if (!part) return no('no such part');
      if (part.fixed) return no('that is fixed in place');
      const r = canFit(sys, s, { kind: part.kind, len: part.len, at: p.at, rot: p.rot, ignore: part.id });
      if (!r.ok) return no(r.reason);
      if (!r.joins && !p.free) return no('it has nothing to join on to there');
      part.at = [...p.at]; part.rot = p.rot; part.pose = null;
      touch(ctx, 'fit', part.id);
      return { ok: true, joins: r.joins };
    },
    [name + '.unfit']: (ctx, p = {}) => {
      const s = ensure(ctx), part = s.parts[p.id];
      if (!part || !part.at) return no('no such fitted part');
      if (part.fixed) return no('that is fixed in place');
      part.pose = pose(p.pose || toWorld(s, part.at, stepM)); part.at = null;
      touch(ctx, 'unfit', part.id);
      return { ok: true };
    },
    [name + '.move']: (ctx, p = {}) => {
      const s = ensure(ctx), part = s.parts[p.id];
      if (!part || part.at) return no('no such loose part');
      part.pose = pose(p.pose || {});
      touch(ctx, 'move', part.id);
      return { ok: true };
    },
    [name + '.cut']: (ctx, p = {}) => {
      const s = ensure(ctx), part = s.parts[p.id], spec = part && kinds[part.kind];
      if (!part || !spec.stretch) return no('that cannot be cut');
      if (part.fixed) return no('that is fixed in place');
      const old = lenOf(spec, part), len = Math.round(+p.len);
      if (!(len >= spec.stretch.min && len < old)) return no('it can only be cut shorter');
      part.len = len;
      const id = 'k' + s.next++, at = part.at ? toWorld(s, add(part.at, rotate(part.rot, [len, 0, 0])), stepM) : part.pose;
      s.parts[id] = { id, kind: part.kind, len: old - len, at: null, rot: 0, pose: pose(p.pose || at) };
      if (spec.set) s.parts[id].set = { ...spec.set };
      touch(ctx, 'cut', part.id);
      return { ok: true, offcut: id };
    },
    [name + '.set']: (ctx, p = {}) => {
      const s = ensure(ctx), part = s.parts[p.id];
      if (!part || !part.set || !(p.key in part.set)) return no('no such setting');
      part.set[p.key] = p.value;
      touch(ctx, 'set', part.id);
      return { ok: true };
    },
    [name + '.remove']: (ctx, p = {}) => {
      const s = ensure(ctx);
      if (!s.parts[p.id]) return no('no such part');
      delete s.parts[p.id];
      touch(ctx, 'remove', p.id);
      return { ok: true };
    },
  };
  return {
    name, init: fresh, commands,
    api: { name, kinds, mates, stepM, ROTATIONS, rotate, rotationTo, partEnds: (part) => partEnds(kinds, part), graph: (state) => graph(sys, state),
      placements: (state, kind, len, end, ignore) => placements(sys, state, kind, len, end, ignore), canFit: (state, q) => canFit(sys, state, q),
      toWorld: (state, p) => toWorld(state, p, stepM), toLattice: (state, w) => toLattice(state, w, stepM), lengthOf: (part) => lenOf(kinds[part.kind], part) },
  };
}
