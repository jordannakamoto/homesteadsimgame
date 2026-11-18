// Plumbing: turns the parts the player has fitted by hand (system `parts`, src/sim/core/parts.js) into the
// network the water system solves. It owns no water: src/sim/water.js stays the judge of what flows.
//
// For every piece of equipment with a connection on the lattice (an anchor part whose ref is
// { piece, port }) it walks the joined parts and reports, as plain connection pieces:
//   { kind: "pipe", from, to, lengthM, equivM, material, shut, valves, via }   a run to another connection
//       shut: a closed valve stands on every way through. A tee simply yields a run to each branch.
//   { kind: "leak", from, lengthM, equivM, material, y, a: { x, z }, part, end }   an open end water can reach
// State: { v, partsV, version, pieces, runs: { [anchorId]: { reaches: [anchorIds], open: n, shut: [valve ids] } } }.
// Recompiled only when the parts change (fit, take off, a valve turned), never per tick otherwise.
// It also remembers the yard's props that are not equipment: yard { bench }, kits { [id]: { id, x, y, z, yaw, opened } }
// (a kit box and what it holds: `contents`), and notes (once-only moments such as the first water at the tap).
// Commands: plumbing.sync, plumbing.setYard { bench }, plumbing.addKit { x, y, z, yaw } -> { id },
// plumbing.openKit { id } -> { ok, contents: [[kind, qty]] } (the page spawns the parts where they tumble out),
// plumbing.note { key } -> { first }.

import { graph, partEnds, toWorld } from './core/parts.js';
import { compileLinks } from './core/links.js';

const STATE_V = 1;
const fresh = () => ({ v: STATE_V, partsV: -1, version: 0, pieces: [], sig: '[]', runs: {}, yard: null, kits: {}, nextKit: 1, notes: {} });

// Pure: (parts state, kinds, mates, options) -> { pieces, runs }
// The walk itself is the generic one in core/links.js: the parts become a neutral graph (a part is a node,
// a join an edge, a stretch part's length and a fitting's equivalent length the cost of entering it, a
// closed valve a blocked joint) and the result is read back into pipe and leak pieces.
export function compilePlumbing(parts, { kinds, mates, stepM, material, innerM = 0.0204 }) {
  const g = graph({ kinds, mates }, parts), pieces = [], runs = {};
  const terminals = [], joints = {};
  for (const id of g.adj.keys()) {
    const o = parts.parts[id], os = kinds[o.kind];
    joints[id] = { lengthM: os.stretch ? (o.len || os.stretch.max) * stepM : 0, equivM: (os.equivD || 0) * innerM,
      blocked: !!(o.set && o.set.open === false), stop: !!o.ref };
    if (o.ref && o.ref.piece != null) terminals.push({ id, ref: o.ref });
  }
  const res = compileLinks({ terminals, joints, edges: g.joins.map((j) => ({ a: j.a.part, b: j.b.part })), openEnds: g.open.map((e) => ({ ...e, at: e.part })) },
    { start: () => 0, sum: (acc, step) => acc + step.joint.equivM });
  for (const w of res.walks) {
    const A = parts.parts[w.terminal], run = (runs[A.id] = { reaches: w.reaches, open: 0, shut: w.blocked });
    for (const r of w.found) {
      if (r.type === 'link') {
        if (!(A.id < r.b)) continue;                                   // as before: a connection with no piece links one way only
        pieces.push({ id: 'run:' + A.id + '>' + r.b, kind: 'pipe', from: { ...A.ref }, to: { ...parts.parts[r.b].ref }, lengthM: Math.max(0.05, r.lengthM), equivM: r.acc,
          material, shut: r.blocked.length > 0, valves: r.blocked, via: r.via });
        continue;
      }
      const e = r.end, wp = toWorld(parts, e.p, stepM);
      run.open++;
      if (A.ref.port === 'out') pieces.push({ id: 'leak:' + r.at + ':' + e.end, kind: 'leak', from: { ...A.ref }, lengthM: Math.max(0.05, r.lengthM), equivM: r.acc, material,
        y: wp.y, a: { x: wp.x, z: wp.z }, part: r.at, end: e.end, d: e.d });
    }
  }
  return { pieces, runs };
}

export function plumbingSystem({ kinds, mates, stepM, material, kit, partsName = 'parts' }) {
  const compile = (ctx) => {
    if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh();
    const parts = ctx.get(partsName), s = ctx.s;
    if (!parts || parts.version === s.partsV) return s;
    const out = compilePlumbing(parts, { kinds, mates, stepM, material });
    // keep the same array (and so the water network) when nothing that matters to water changed
    const sig = JSON.stringify(out.pieces);
    if (sig !== s.sig) { s.pieces = out.pieces; s.sig = sig; s.version++; ctx.emit('plumbing.changed', { version: s.version }); }
    s.runs = out.runs; s.partsV = parts.version;
    return s;
  };
  const S = (ctx) => { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); const s = ctx.s; s.kits = s.kits || {}; s.notes = s.notes || {}; s.nextKit = s.nextKit || 1; return s; };
  return { name: 'plumbing', every: 1, init: fresh, step: compile, commands: {
    'plumbing.sync': (ctx) => { compile(ctx); return { ok: true, version: ctx.s.version }; },
    'plumbing.setYard': (ctx, p = {}) => { S(ctx).yard = { bench: p.bench || null }; return { ok: true }; },
    'plumbing.addKit': (ctx, p = {}) => { const s = S(ctx), id = 'kit' + s.nextKit++; s.kits[id] = { id, x: +p.x || 0, y: +p.y || 0, z: +p.z || 0, yaw: +p.yaw || 0, opened: false, contents: (p.contents || kit || []).map((c) => [...c]) }; ctx.emit('plumbing.kit', { id }); return { ok: true, id }; },
    'plumbing.openKit': (ctx, p = {}) => { const k = S(ctx).kits[p.id]; if (!k || k.opened) return { ok: false, reason: 'no unopened kit' }; k.opened = true; ctx.emit('plumbing.kit', { id: k.id, opened: true }); return { ok: true, contents: k.contents }; },
    'plumbing.note': (ctx, p = {}) => { const s = S(ctx), first = !s.notes[p.key]; s.notes[p.key] = true; return { ok: true, first }; },
  } };
}
export { partEnds };
