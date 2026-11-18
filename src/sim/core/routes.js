// Routes: runs that ride on frames (a rigid body such as a building), from node to node, with the work
// that puts each one in. A generic mechanism: it knows nothing about what a run carries. Content supplies
// classes (which work steps a run needs, which node kinds are set at rough-in or finished at trim) and turns
// the read-out of toNeutral into whatever pieces its solvers read (core/links.js does the walking).
//
// INTERFACE
//   createRoutesSystem({ name = 'routes', classes, guard? }) -> a simulation system
//     classes { [clsId]: { id, linkKind, steps: ['bore', 'pull', 'join'] | ['seg', 'join'] | [...],
//                          phases?: { rough?: [nodeKinds], trim?: [nodeKinds] } } }
//       steps run in order: a step starts only when the ones before it are complete.
//       bore: every bore drilled; pull: pulled reaches 1; seg: segsDone reaches segs; join: both ends joined.
//     guard(ctx, run, what) -> reason | null      // content may refuse 'work' or 'reroute' (a covered wall)
//   State (plain JSON, saved): { v, version, next, frames, nodes, runs }
//     frames { [frameId]: { x, y, z, yaw } }                       // null frame = the world
//     nodes  { [id]: { id, frame, at: [x, y, z], kind, ref?, host?, set?, state: 'planned' | 'set' | 'trimmed' } }
//     runs   { [id]: { id, cls, spec, frame, a, b, path: [[x, y, z]], lengthM, bores: [{ at, parent, done, plate? }],
//                      hosts: [ids], pulled, joined: { a, b }, segs?, segsDone?, state: 'planned' | 'roughed' | 'done',
//                      group?, props?, legacy?, stray? } }
//     Positions are frame-local metres. A run's length is worked out here from its path (or the straight line
//     between its nodes when it has none); only a legacy run may bring its own.
//   Commands (each returns { ok, ... } or { ok: false, reason }; each change bumps `version` and emits
//   '<name>.changed' { version, why, id }):
//     <name>.setFrames  { frames }                        replaces; runs and nodes on a vanished frame are
//                                                         flagged stray, never deleted (and unflagged if it returns)
//     <name>.addNode    { kind, frame, at, ref?, host?, set?, state?, id? } -> { ok, id }
//     <name>.moveNode   { id, at }                        only while no run from it has been worked
//     <name>.setNode    { id, key, value } | { id, state }   a per-node setting, or its state
//     <name>.removeNode { id }                            refused while a run ends there
//     <name>.addRun     { cls, spec, frame, a, b, path?, bores?, hosts?, group?, props?, state?, segs?, legacy?, lengthM?, id? } -> { ok, id }
//     <name>.reroute    { id, path, bores?, hosts? }      only while nothing on it has been worked
//     <name>.work       { id, what: 'bore' | 'pull' | 'seg' | 'join', index?, to?, end?, n? } -> { ok, done, state }
//                         bore: `index`, or the next n undrilled; pull: up to `to` (0..1, never backwards), or +n/10;
//                         seg: n more; join: `end` ('a' | 'b'), or the next n unjoined ends
//     <name>.removeRun  { id }
//   Pure read-outs (exported, and on sys.api bound to the classes):
//     runState(run, cls, nodes?) -> { state, steps: { [step]: [done, total] }, next: step | null, complete }
//     progress(state, classes, frame, phase, skip?) -> [done, total]   phase 'rough' | 'trim'
//     toNeutral(state, classes, rules?) -> { [linkKind]: graph for compileLinks }
//     worldOf(state, frame, p) -> [x, y, z]
//     pathLength(path) -> metres

const STATE_V = 1;
const fresh = () => ({ v: STATE_V, version: 0, next: 1, frames: {}, nodes: {}, runs: {} });
const NODE_STATES = ['planned', 'set', 'trimmed'];
const vec = (p) => (Array.isArray(p) && p.length === 3 && p.every((v) => Number.isFinite(+v)) ? p.map((v) => +v) : null);

export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < (path || []).length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  return L;
}

export function worldOf(state, frame, p) {
  const f = frame != null && state.frames ? state.frames[frame] : null;
  if (!f) return [p[0], p[1], p[2]];
  const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0);           // same turn as core/parts.js toWorld
  return [f.x + p[0] * c + p[2] * s, f.y + p[1], f.z - p[0] * s + p[2] * c];
}

// How far a run has got: per step [done, total], the next step to do, and its state.
export function runState(run, cls, nodes) {
  const steps = {};
  for (const st of (cls && cls.steps) || []) {
    if (st === 'bore') steps.bore = [run.bores.filter((b) => b.done).length, run.bores.length];
    else if (st === 'pull') steps.pull = [run.pulled >= 1 ? 1 : 0, 1];
    else if (st === 'seg') steps.seg = [Math.min(run.segsDone | 0, run.segs | 0), run.segs | 0];
    else if (st === 'join') steps.join = [(run.joined.a ? 1 : 0) + (run.joined.b ? 1 : 0), 2];
  }
  let next = null;
  for (const st of (cls && cls.steps) || []) if (steps[st] && steps[st][0] < steps[st][1]) { next = st; break; }
  const complete = run.legacy || next === null;
  let state = run.legacy ? 'done' : !complete ? 'planned' : 'roughed';
  if (state === 'roughed' && nodes) {
    const trim = (cls.phases && cls.phases.trim) || [];
    const ends = [nodes[run.a], nodes[run.b]].filter((n) => n && trim.includes(n.kind));
    if (ends.every((n) => n.state === 'trimmed')) state = 'done';
  }
  return { state, steps, next: run.legacy ? null : next, complete };
}
const worked = (run) => run.bores.some((b) => b.done) || run.pulled > 0 || run.joined.a || run.joined.b || (run.segsDone | 0) > 0;

// Work units on a frame for one phase: rough is every step of every run plus every node of a rough kind
// being set; trim is every node of a trim kind being trimmed. `skip(run | node)` leaves things out.
export function progress(state, classes, frame, phase, skip) {
  let done = 0, total = 0;
  const kinds = new Set();
  for (const c of Object.values(classes)) for (const k of (c.phases && c.phases[phase]) || []) kinds.add(k);
  if (phase === 'rough') for (const run of Object.values(state.runs)) {
    if (run.frame !== frame || (skip && skip(run))) continue;
    const r = runState(run, classes[run.cls]);
    for (const [d, t] of Object.values(r.steps)) { done += run.legacy ? t : d; total += t; }
  }
  for (const n of Object.values(state.nodes)) {
    if (n.frame !== frame || !kinds.has(n.kind) || (skip && skip(n))) continue;
    total++;
    if (phase === 'rough' ? n.state !== 'planned' : n.state === 'trimmed') done++;
  }
  return [done, total];
}

// The neutral graphs core/links.js walks, one per link kind. A node is a graph node, a run an edge. A run
// is in the graph once `carries(run, cls)` (default: every step but the joins complete); an end not yet
// joined hangs loose on a node of its own ('<runId>|a') with an open end, so what reaches it spills there.
// rules.joint(node) -> { blocked?, stop?, open? } lets content say what a node does (open: an open end on it).
export function toNeutral(state, classes, rules = {}) {
  const carries = rules.carries || ((run, cls, rs) => run.legacy || Object.entries(rs.steps).every(([k, [d, t]]) => k === 'join' || d >= t));
  const out = {};
  const G = (k) => out[k] || (out[k] = { terminals: [], edges: [], joints: {}, openEnds: [], seen: new Set() });
  const touch = (g, id) => {
    if (g.seen.has(id)) return;
    g.seen.add(id);
    const n = state.nodes[id]; if (!n) return;
    const j = rules.joint ? rules.joint(n) || {} : {};
    g.joints[id] = { ...j, node: id, kind: n.kind };
    if (n.ref) g.terminals.push({ id, ref: n.ref });
    if (j.open) g.openEnds.push({ at: id, node: id });
  };
  const ids = Object.keys(state.runs).sort();
  for (const id of ids) {
    const run = state.runs[id], cls = classes[run.cls];
    if (!cls || run.stray) continue;
    const rs = runState(run, cls);
    if (!carries(run, cls, rs)) continue;
    const g = G(cls.linkKind), joins = run.legacy || !(cls.steps || []).includes('join');
    const end = (e) => {
      const node = run[e];
      if (joins || run.joined[e]) { touch(g, node); return node; }
      touch(g, node);                                                  // still there, just not joined to this run
      const loose = id + '|' + e;
      g.joints[loose] = { loose: true, run: id, end: e };
      g.openEnds.push({ at: loose, run: id, end: e, node });
      return loose;
    };
    g.edges.push({ a: end('a'), b: end('b'), lengthM: run.lengthM, run: id, cls: run.cls, spec: run.spec, props: run.props || null });
  }
  for (const g of Object.values(out)) delete g.seen;
  return out;
}

export function createRoutesSystem({ name = 'routes', classes, guard } = {}) {
  const ensure = (ctx) => { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return ctx.s; };
  const no = (reason) => ({ ok: false, reason });
  const touch = (ctx, why, id) => { ctx.s.version++; ctx.emit(name + '.changed', { version: ctx.s.version, why, id }); };
  const lengthOf = (s, run) => {
    if (run.path.length >= 2) return pathLength(run.path);
    const a = s.nodes[run.a], b = s.nodes[run.b];
    return a && b && a.frame === b.frame ? pathLength([a.at, b.at]) : 0;
  };
  const restate = (s, run) => { run.state = runState(run, classes[run.cls], s.nodes).state; };
  const pts = (path) => (Array.isArray(path) ? path.map(vec) : []);
  const boresOf = (b) => (Array.isArray(b) ? b.map((x) => ({ at: vec(x.at) || [0, 0, 0], parent: x.parent ?? null, done: x.done ? 1 : 0, ...(x.plate ? { plate: 1 } : {}) })) : []);
  const strayOn = (s) => {
    for (const x of [...Object.values(s.nodes), ...Object.values(s.runs)]) {
      if (x.frame != null && !s.frames[x.frame]) x.stray = true; else delete x.stray;
    }
  };

  const commands = {
    [name + '.setFrames']: (ctx, p = {}) => {
      const s = ensure(ctx), frames = {};
      for (const [id, f] of Object.entries(p.frames || {})) frames[id] = { x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, yaw: +f.yaw || 0 };
      s.frames = frames; strayOn(s);
      touch(ctx, 'frames'); return { ok: true };
    },
    [name + '.addNode']: (ctx, p = {}) => {
      const s = ensure(ctx), at = vec(p.at);
      if (!at) return no('no position');
      if (!p.kind) return no('no kind');
      if (p.frame != null && !s.frames[p.frame]) return no('no such frame');
      const id = p.id != null && !s.nodes[p.id] ? String(p.id) : 'n' + s.next++;
      const n = { id, frame: p.frame ?? null, at, kind: String(p.kind), state: NODE_STATES.includes(p.state) ? p.state : 'planned' };
      if (p.ref) n.ref = { ...p.ref };
      if (p.host) n.host = { ...p.host };
      if (p.set) n.set = { ...p.set };
      s.nodes[id] = n;
      touch(ctx, 'addNode', id); return { ok: true, id };
    },
    [name + '.moveNode']: (ctx, p = {}) => {
      const s = ensure(ctx), n = s.nodes[p.id], at = vec(p.at);
      if (!n) return no('no such node');
      if (!at) return no('no position');
      const runs = Object.values(s.runs).filter((r) => r.a === n.id || r.b === n.id);
      if (runs.some(worked)) return no('work has started on a run from here');
      n.at = at;
      for (const r of runs) {                                                // keep its paths ending on it
        if (r.path.length >= 2) r.path[r.a === n.id ? 0 : r.path.length - 1] = [...at];
        if (!r.legacy) r.lengthM = lengthOf(s, r);
      }
      touch(ctx, 'moveNode', n.id); return { ok: true };
    },
    [name + '.setNode']: (ctx, p = {}) => {
      const s = ensure(ctx), n = s.nodes[p.id];
      if (!n) return no('no such node');
      if (p.state !== undefined) {
        if (!NODE_STATES.includes(p.state)) return no('no such state');
        n.state = p.state;
        for (const r of Object.values(s.runs)) if (r.a === n.id || r.b === n.id) restate(s, r);
      } else {
        if (p.key == null) return no('no setting');
        (n.set || (n.set = {}))[p.key] = p.value;
      }
      touch(ctx, 'setNode', n.id); return { ok: true };
    },
    [name + '.removeNode']: (ctx, p = {}) => {
      const s = ensure(ctx);
      if (!s.nodes[p.id]) return no('no such node');
      if (Object.values(s.runs).some((r) => r.a === p.id || r.b === p.id)) return no('a run ends here');
      delete s.nodes[p.id];
      touch(ctx, 'removeNode', p.id); return { ok: true };
    },
    [name + '.addRun']: (ctx, p = {}) => {
      const s = ensure(ctx), cls = classes[p.cls];
      if (!cls) return no('unknown class');
      const a = s.nodes[p.a], b = s.nodes[p.b];
      if (!a || !b) return no('no such node');
      if (a.id === b.id) return no('a run needs two ends');
      const path = pts(p.path);
      if (path.some((q) => !q)) return no('bad path');
      const frame = p.frame !== undefined ? p.frame : a.frame;
      if (frame != null && !s.frames[frame]) return no('no such frame');
      const id = p.id != null && !s.runs[p.id] ? String(p.id) : 'r' + s.next++;
      const run = { id, cls: cls.id || p.cls, spec: p.spec ?? null, frame: frame ?? null, a: a.id, b: b.id, path, lengthM: 0,
        bores: boresOf(p.bores), hosts: Array.isArray(p.hosts) ? [...p.hosts] : [], pulled: 0, joined: { a: 0, b: 0 }, state: 'planned' };
      if ((cls.steps || []).includes('seg')) { run.segs = Math.max(1, p.segs | 0 || Math.ceil(pathLength(path) / 3) || 1); run.segsDone = 0; }
      if (p.group != null) run.group = p.group;
      if (p.props) run.props = { ...p.props };
      if (p.legacy) run.legacy = true;
      run.lengthM = run.legacy && +p.lengthM > 0 ? +p.lengthM : lengthOf(s, run);
      if (p.state === 'done' || p.state === 'roughed') {                    // already in (a legacy link, a kit)
        for (const x of run.bores) x.done = 1;
        run.pulled = 1; run.joined = { a: 1, b: 1 }; if (run.segs) run.segsDone = run.segs;
      }
      restate(s, run);
      s.runs[id] = run;
      touch(ctx, 'addRun', id); return { ok: true, id, lengthM: run.lengthM };
    },
    [name + '.reroute']: (ctx, p = {}) => {
      const s = ensure(ctx), run = s.runs[p.id];
      if (!run) return no('no such run');
      if (worked(run)) return no('work has started on this run');
      const why = guard && guard(ctx, run, 'reroute'); if (why) return no(why);
      const path = pts(p.path);
      if (path.some((q) => !q)) return no('bad path');
      run.path = path; run.bores = boresOf(p.bores);
      if (p.hosts) run.hosts = [...p.hosts];
      run.lengthM = lengthOf(s, run);
      if (run.segs !== undefined) run.segs = Math.max(1, p.segs | 0 || Math.ceil(run.lengthM / 3) || 1);
      restate(s, run);
      touch(ctx, 'reroute', run.id); return { ok: true, lengthM: run.lengthM };
    },
    [name + '.work']: (ctx, p = {}) => {
      const s = ensure(ctx), run = s.runs[p.id], cls = run && classes[run.cls];
      if (!run || !cls) return no('no such run');
      if (run.stray) return no('what it was fixed to is gone');
      const what = p.what, order = cls.steps || [];
      if (!order.includes(what)) return no('this run has no ' + what + ' step');
      const why = guard && guard(ctx, run, 'work'); if (why) return no(why);
      const rs = runState(run, cls);
      for (const st of order) { if (st === what) break; if (rs.steps[st][0] < rs.steps[st][1]) return { ok: false, reason: 'needs ' + st + ' first', need: st }; }
      const n = Math.max(1, p.n | 0 || 1);
      let done = 0;
      if (what === 'bore') {
        if (p.index != null) { const b = run.bores[p.index]; if (!b) return no('no such bore'); if (!b.done) { b.done = 1; done = 1; } }
        else for (const b of run.bores) { if (done >= n) break; if (!b.done) { b.done = 1; done++; } }
      } else if (what === 'pull') {
        const to = p.to != null ? Math.max(0, Math.min(1, +p.to || 0)) : Math.min(1, run.pulled + n / 10);
        if (to > run.pulled) { done = to - run.pulled; run.pulled = to; }
      } else if (what === 'seg') {
        const before = run.segsDone | 0; run.segsDone = Math.min(run.segs, before + n); done = run.segsDone - before;
      } else if (what === 'join') {
        const ends = p.end ? [p.end] : ['a', 'b'];
        for (const e of ends) { if (e !== 'a' && e !== 'b') return no('no such end'); if (done >= n) break; if (!run.joined[e]) { run.joined[e] = 1; done++; } }
      }
      if (!done) return { ok: true, done: 0, state: run.state };
      restate(s, run);
      touch(ctx, 'work', run.id); return { ok: true, done, state: run.state };
    },
    [name + '.removeRun']: (ctx, p = {}) => {
      const s = ensure(ctx);
      if (!s.runs[p.id]) return no('no such run');
      delete s.runs[p.id];
      touch(ctx, 'removeRun', p.id); return { ok: true };
    },
  };
  return {
    name, init: fresh, commands,
    api: { name, classes, pathLength, worldOf, runState: (run, nodes) => runState(run, classes[run.cls], nodes),
      progress: (state, frame, phase, skip) => progress(state, classes, frame, phase, skip),
      toNeutral: (state, rules) => toNeutral(state, classes, rules) },
  };
}
