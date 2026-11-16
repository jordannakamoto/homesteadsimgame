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

const STATE_V = 1;
const fresh = () => ({ v: STATE_V, partsV: -1, version: 0, pieces: [], runs: {}, yard: null, kits: {}, nextKit: 1, notes: {} });

// Pure: (parts state, kinds, mates, options) -> { pieces, runs }
export function compilePlumbing(parts, { kinds, mates, stepM, material, innerM = 0.0204 }) {
  const g = graph({ kinds, mates }, parts), pieces = [], runs = {};
  const openAt = new Map();
  for (const e of g.open) { if (!openAt.has(e.part)) openAt.set(e.part, []); openAt.get(e.part).push(e); }
  const anchors = Object.values(parts.parts).filter((p) => p.at && p.ref && p.ref.piece != null).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const A of anchors) {
    // breadth first over joined parts, carrying length, fittings and whether a closed valve was passed
    const best = new Map([[A.id, { lenM: 0, equivM: 0, shut: [], via: [] }]]);
    let frontier = [A.id];
    const run = (runs[A.id] = { reaches: [], open: 0, shut: [] });
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        const cur = best.get(id), part = parts.parts[id], spec = kinds[part.kind];
        if (id !== A.id && part.ref) continue;                        // another connection: the run ends there
        for (const ln of g.adj.get(id) || []) {
          const o = parts.parts[ln.other], os = kinds[o.kind];
          const shut = o.set && o.set.open === false ? [...cur.shut, o.id] : cur.shut;
          const cand = { lenM: cur.lenM + (os.stretch ? (o.len || os.stretch.max) * stepM : 0), equivM: cur.equivM + (os.equivD || 0) * innerM, shut, via: [...cur.via, o.id] };
          const had = best.get(ln.other);
          if (had && (had.shut.length < cand.shut.length || (had.shut.length === cand.shut.length && had.lenM <= cand.lenM))) continue;
          best.set(ln.other, cand); next.push(ln.other);
        }
        void spec;
      }
      frontier = next;
    }
    for (const [id, r] of best) {
      if (id === A.id) continue;
      const part = parts.parts[id];
      if (part.ref) {
        run.reaches.push(id);
        if (r.shut.length) for (const v of r.shut) if (!run.shut.includes(v)) run.shut.push(v);
        if (A.id < id) pieces.push({ id: 'run:' + A.id + '>' + id, kind: 'pipe', from: { ...A.ref }, to: { ...part.ref }, lengthM: Math.max(0.05, r.lenM), equivM: r.equivM,
          material, shut: r.shut.length > 0, valves: r.shut, via: r.via.slice(0, -1) });
        continue;
      }
      if (r.shut.length) continue;                                     // dry beyond a closed valve
      for (const e of openAt.get(id) || []) {
        const w = toWorld(parts, e.p, stepM);
        run.open++;
        if (A.ref.port === 'out') pieces.push({ id: 'leak:' + id + ':' + e.end, kind: 'leak', from: { ...A.ref }, lengthM: Math.max(0.05, r.lenM), equivM: r.equivM, material,
          y: w.y, a: { x: w.x, z: w.z }, part: id, end: e.end, d: e.d });
      }
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
