// Services: cable and pipe run through a building's frame (system `routes`, src/sim/core/routes.js) turned into
// the connection pieces src/sim/electrical.js and src/sim/water.js already solve. It owns no power and no water:
// those two stay the judges. Recompiled only when the routes change; a plain version compare per tick otherwise.
//
// What it emits (all ids start with "sv:", so they never collide with build mode's pieces):
//   power  every node a finished cable reaches is a point on the circuit: a trimmed panel slot is a breaker
//          (fixture `sv:br:<slot>`, catalog from the cable: 14 AWG gets 15 A) with a short wire from the panel's
//          port (`sv:bw:<slot>`); a box with a device in it is that device (`sv:<node>`: outlet, light); a box
//          without one, or with a switch, is an electrical box (a junction). One wire per cable run (`sv:w:<run>`),
//          so electrical.wires[id] maps straight back to the run. Rough-in alone powers nothing: no devices yet.
//          An untrimmed slot has no breaker, so what hangs off it is dead.
//   water  a node bound to equipment (`ref`, e.g. a tank's outlet) or with a fixture set on it at trim (`sv:<node>`,
//          a tap, a sink) is a terminal; other nodes (a stub, a tee in a joist bay) are joints the walk passes
//          through (core/links.js). One pipe per pair of terminals (`sv:p:<a>><b>`) with the length along the runs;
//          a leak (`sv:leak:<at>`) for every open end a source can reach: an uncapped stub (set.capped === false)
//          or an end not yet crimped. Drains compile the same way between drain ports.
// State (saved, plain JSON): { v, routesV, version, pieces, powerPieces, waterPieces, sig, links: { [pieceId]: [runIds] },
//   tally: { [frame]: { 'rough-in': [done, total], 'trim-out': [done, total] } }, covered: { [runId]: true },
//   issues: [{ runId, severity, reason, fix }], checks: {}, deferred: { [runId]: true }, notes: {} }
// Commands: services.sync, services.note { key } -> { first }.
// Readers: overlayData(state), runInfo(state, runId), servicesGuard (the routes system's guard: covered runs refuse work).

import { compileLinks } from './core/links.js';
import { toNeutral, worldOf, runState, progress, pathLength } from './core/routes.js';
import { SERVICE_CLASSES, SERVICE_SPECS, DEFAULT_SPEC, DEVICES, NODE_KINDS, SERVICE_TEXT } from './content/services.js';
import { FIXTURES_ELECTRICAL } from './fixtures-electrical.js';
import { FIXTURES_WATER } from './fixtures-water.js';

const STATE_V = 1;
const fresh = () => ({ v: STATE_V, routesV: -1, version: 0, pieces: [], powerPieces: [], waterPieces: [], sig: '[[],[]]', links: {},
  tally: {}, covered: {}, issues: [], checks: {}, deferred: {}, notes: {} });
const specFor = (run) => SERVICE_SPECS[run.spec] || SERVICE_SPECS[DEFAULT_SPEC[run.cls]] || {};
const r3 = (x) => Math.round(x * 1000) / 1000;
const deviceOf = (n) => (n && n.state === 'trimmed' && n.set && n.set.device ? DEVICES[n.set.device] || null : null);

// A fixture piece standing where a node is, in world space.
function fixturePiece(R, n, id, fixture, dy = 0) {
  const w = worldOf(R, n.frame, n.at), f = n.frame != null && R.frames[n.frame] ? R.frames[n.frame] : null;
  return { id, kind: 'fixture', fixture, a: { x: r3(w[0]), z: r3(w[2]) }, b: { x: r3(w[0]), z: r3(w[2]) }, y0: r3(w[1] - dy), y1: r3(w[1] - dy),
    yawRad: f ? f.yaw : 0, settings: {}, node: n.id, services: true };
}
// Where an end of a run is in the world: its path end, or its node.
function endWorld(R, run, e) {
  const p = run.path && run.path.length >= 2 ? run.path[e === 'a' ? 0 : run.path.length - 1] : (R.nodes[run[e]] || {}).at || [0, 0, 0];
  return worldOf(R, run.frame, p);
}

function compilePower(R, g, out) {
  const fx = new Map(), wires = [];
  const terminals = [], refs = {};
  const slotRating = {};                                                   // slot id -> thinnest cable from it
  for (const e of g.edges) for (const end of ['a', 'b']) {
    const run = R.runs[e.run], node = run && R.nodes[run[end]];
    if (node && node.kind === 'slot') { const sp = specFor(run); if (!slotRating[node.id] || (sp.ratingA || 15) < slotRating[node.id].ratingA) slotRating[node.id] = sp; }
  }
  for (const id of Object.keys(g.joints).sort()) {
    const j = g.joints[id];
    if (j.loose) continue;
    const n = R.nodes[id]; if (!n) continue;
    terminals.push({ id });
    const dev = deviceOf(n);
    if (n.kind === 'slot' && n.ref) {
      if (n.state !== 'trimmed') { refs[id] = null; continue; }        // no breaker in yet: dead
      const sp = slotRating[id] || SERVICE_SPECS[DEFAULT_SPEC.cable], brId = 'sv:br:' + id;
      fx.set(brId, fixturePiece(R, n, brId, sp.breaker || 'breaker_15a'));
      wires.push({ id: 'sv:bw:' + id, kind: 'wire', from: { ...n.ref }, to: { piece: brId, port: 'line' }, gauge: sp.gauge || 14, lengthM: 0.3, node: id, services: true });
      refs[id] = { piece: brId, port: 'load' };
    } else if (n.ref) refs[id] = { ...n.ref };
    else if (dev && dev.elec && FIXTURES_ELECTRICAL[dev.elec] && FIXTURES_ELECTRICAL[dev.elec].role !== 'junction') {
      const pid = 'sv:' + id; fx.set(pid, fixturePiece(R, n, pid, dev.elec)); refs[id] = { piece: pid, port: FIXTURES_ELECTRICAL[dev.elec].ports[0].id };
    } else {
      const pid = 'sv:' + id; fx.set(pid, fixturePiece(R, n, pid, 'box_junction')); refs[id] = { piece: pid, port: 'main' };
    }
  }
  // every node is a terminal, so each link is one run between neighbours
  const res = compileLinks({ terminals, edges: g.edges, joints: g.joints, openEnds: [] }, { start: () => [], sum: (acc, st) => acc.concat(st.edge.run) });
  for (const L of res.links) {
    const A = refs[L.a], B = refs[L.b], runId = L.acc[0];
    if (!A || !B || !runId) continue;
    const id = 'sv:w:' + runId;
    wires.push({ id, kind: 'wire', from: A, to: B, gauge: specFor(R.runs[runId]).gauge || 14, lengthM: r3(Math.max(0.05, L.lengthM)), run: runId, services: true });
    out.links[id] = [runId];
  }
  return [...fx.values(), ...wires];
}

function compileWater(R, g, kind, out, fxSeen) {
  const pieces = [], terminals = [], refs = {};
  for (const id of Object.keys(g.joints).sort()) {
    const j = g.joints[id], n = !j.loose && R.nodes[id];
    if (!n) continue;
    const dev = deviceOf(n), wdef = dev && dev.water && FIXTURES_WATER[dev.water];
    if (n.ref) { refs[id] = { ...n.ref }; terminals.push({ id, ref: refs[id] }); continue; }
    if (!wdef) continue;
    const pid = 'sv:' + id;
    if (!fxSeen.has(pid)) { fxSeen.add(pid); pieces.push(fixturePiece(R, n, pid, dev.water, dev.stubM || 0)); }
    const hot = g.edges.some((e) => (e.a === id || e.b === id) && (SERVICE_SPECS[e.spec] || {}).hot);
    const port = kind === 'drain' ? 'drain' : hot && wdef.ports.some((p) => p.id === 'hot') ? 'hot' : 'in';
    refs[id] = { piece: pid, port }; terminals.push({ id, ref: refs[id] });
  }
  const res = compileLinks({ terminals, edges: g.edges, joints: g.joints, openEnds: g.openEnds }, { start: () => [], sum: (acc, st) => acc.concat(st.edge.run) });
  const material = (runs) => { const sp = specFor(R.runs[runs[0]] || {}); return sp.material ? { material: sp.material } : { diameterMm: sp.diameterMm || 50 }; };
  for (const r of res.links) {
    const A = refs[r.a], B = refs[r.b];
    if (!A || !B || !r.acc.length) continue;
    const runs = r.acc, first = R.runs[runs[0]], props = (first && first.props) || {};
    const id = 'sv:p:' + r.a + '>' + r.b;
    pieces.push({ id, kind: 'pipe', from: A, to: B, lengthM: r3(Math.max(0.05, r.lengthM)), ...material(runs), shut: r.blocked.length > 0,
      indoor: props.indoor ?? runs.every((x) => R.runs[x] && R.runs[x].frame != null), insulationMm: +props.insulationMm || 0, buriedDepthM: +props.buriedDepthM || 0,
      runs, services: true });
    out.links[id] = runs;
  }
  for (const o of res.open) {
    const from = refs[o.from];
    if (!from || from.port !== 'out' || !o.acc.length) continue;               // only a source spills
    const e = o.end, run = e.run ? R.runs[e.run] : null, n = R.nodes[e.node || o.at];
    const w = run ? endWorld(R, run, e.end) : n ? worldOf(R, n.frame, n.at) : [0, 0, 0];
    const id = 'sv:leak:' + o.at;
    if (out.links[id]) continue;
    pieces.push({ id, kind: 'leak', from, lengthM: r3(Math.max(0.05, o.lengthM)), ...material(o.acc), y: r3(w[1]), a: { x: r3(w[0]), z: r3(w[2]) }, at: o.at, runs: o.acc, services: true });
    out.links[id] = o.acc;
  }
  return pieces;
}

// Pure: routes state -> { powerPieces, waterPieces, links, issues }
export function compileServices(R, classes = SERVICE_CLASSES) {
  const out = { links: {} };
  const graphs = toNeutral(R, classes, {
    joint: (n) => ({ open: (n.kind === 'stub_supply' || n.kind === 'stub_drain') && !n.ref && !deviceOf(n) && !!n.set && n.set.capped === false }),
  });
  const powerPieces = graphs.power ? compilePower(R, graphs.power, out) : [];
  const fxSeen = new Set(), waterPieces = [];
  for (const k of ['water', 'drain']) if (graphs[k]) waterPieces.push(...compileWater(R, graphs[k], k, out, fxSeen));
  const issues = [];
  for (const run of Object.values(R.runs)) if (run.stray) issues.push({ runId: run.id, severity: 'warning', reason: SERVICE_TEXT.stray, fix: 'Take the run out, or put back what it was fixed to.' });
  return { powerPieces, waterPieces, links: out.links, issues };
}

function tallyOf(R, s, classes) {
  const frames = new Set(Object.keys(R.frames || {}));
  for (const x of [...Object.values(R.runs), ...Object.values(R.nodes)]) if (x.frame != null) frames.add(x.frame);
  const skip = (x) => !!s.deferred[x.id], t = {};
  for (const f of [...frames].sort()) t[f] = { 'rough-in': progress(R, classes, f, 'rough', skip), 'trim-out': progress(R, classes, f, 'trim', skip) };
  return t;
}

export function servicesSystem({ classes = SERVICE_CLASSES, routesName = 'routes' } = {}) {
  const ensure = (ctx) => { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return ctx.s; };
  const compile = (ctx) => {
    const s = ensure(ctx), R = ctx.get(routesName);
    if (!R || R.version === s.routesV) return s;
    const c = compileServices(R, classes);
    const sig = JSON.stringify([c.powerPieces, c.waterPieces]);
    if (sig !== s.sig) {                                                     // same arrays (so the same networks) when nothing changed
      s.powerPieces = c.powerPieces; s.waterPieces = c.waterPieces; s.pieces = c.powerPieces.concat(c.waterPieces);
      s.sig = sig; s.links = c.links; s.version++;
      ctx.emit('services.changed', { version: s.version });
    }
    s.issues = c.issues; s.tally = tallyOf(R, s, classes); s.routesV = R.version;
    return s;
  };
  return {
    name: 'services', every: 1, init: fresh, step: compile,
    commands: {
      'services.sync': (ctx) => { compile(ctx); return { ok: true, version: ctx.s.version }; },
      'services.note': (ctx, p = {}) => { const s = ensure(ctx), first = !s.notes[p.key]; s.notes[p.key] = true; return { ok: true, first }; },
    },
    // for page add-ons (global scripts cannot import): the content tables and the pure read-outs
    api: { classes, specs: SERVICE_SPECS, devices: DEVICES, nodeKinds: NODE_KINDS, compileServices: (R) => compileServices(R, classes), overlayData, runInfo },
  };
}
export const services = servicesSystem();

// The routes system's guard: a run inside a closed-up wall cannot be worked on or moved.
export function servicesGuard(ctx, run) {
  const s = ctx.get('services');
  return s && s.covered && s.covered[run.id] ? SERVICE_TEXT.covered : null;
}

// ------------------------------------------------------------------------------------------- readers
// Plain-words status of one run: { id, name, lengthM, state, next, steps, words, reason }.
export function runInfo(state, runId) {
  const R = state && state.sys ? state.sys.routes : null, s = state && state.sys ? state.sys.services : null;
  const run = R && R.runs[runId];
  if (!run) return null;
  const cls = SERVICE_CLASSES[run.cls], sp = specFor(run), rs = runState(run, cls, R.nodes);
  const covered = !!(s && s.covered && s.covered[runId]);
  let words = (sp.name || (cls && cls.name) || 'Run') + ', ' + run.lengthM.toFixed(1) + ' m: ' + (SERVICE_TEXT.states[rs.state] || rs.state);
  if (rs.next) { const [d, t] = rs.steps[rs.next]; words += '. Next: ' + SERVICE_TEXT.steps[rs.next] + (t > 1 ? ' (' + d + ' of ' + t + ' done)' : ''); }
  const reason = run.stray ? SERVICE_TEXT.stray : covered ? SERVICE_TEXT.covered : null;
  return { id: runId, cls: run.cls, spec: run.spec, name: sp.name || null, lengthM: run.lengthM, state: rs.state, next: rs.next, steps: rs.steps, covered, stray: !!run.stray, words, reason };
}

// Pure data for the overlays: every run with its class, colour, state and what flows in it now.
export function overlayData(state) {
  const R = state && state.sys ? state.sys.routes : null, s = state && state.sys ? state.sys.services : null;
  if (!R) return { runs: [], nodes: [] };
  const E = state.sys.electrical, W = state.sys.water, flow = {};
  for (const [pid, runs] of Object.entries((s && s.links) || {})) for (const rid of runs) {
    const f = flow[rid] || (flow[rid] = { pieces: [] });
    f.pieces.push(pid);
    const w = E && E.wires && E.wires[pid];
    if (w) { f.currentA = w.currentA; f.ratingA = w.ratingA; f.live = w.currentA > 1e-6; }
    const p = W && W.pipes && W.pipes[pid];
    if (p) { f.flowLmin = (f.flowLmin || 0) + (p.flowLmin || 0); f.live = f.live || p.flowLmin > 1e-6; }
    const lk = W && W.leaks && W.leaks[pid];
    if (lk) { f.leakLmin = lk.flowLmin || 0; f.live = f.live || lk.flowLmin > 1e-6; }
  }
  const runs = Object.keys(R.runs).sort().map((id) => {
    const run = R.runs[id], cls = SERVICE_CLASSES[run.cls] || {}, sp = specFor(run), f = flow[id] || { pieces: [] };
    return { id, cls: run.cls, spec: run.spec, frame: run.frame, state: run.state, colour: sp.colour || cls.colour || '#888', radiusM: sp.radiusM || 0.01,
      lengthM: run.lengthM || pathLength(run.path), covered: !!(s && s.covered && s.covered[id]), stray: !!run.stray, pieces: f.pieces,
      live: !!f.live, currentA: f.currentA, ratingA: f.ratingA, load: f.ratingA ? f.currentA / f.ratingA : 0, flowLmin: f.flowLmin, leakLmin: f.leakLmin };
  });
  const brk = (E && E.breakers) || {};
  const nodes = Object.keys(R.nodes).sort().map((id) => {
    const n = R.nodes[id], br = brk['sv:br:' + id];
    return { id, kind: n.kind, frame: n.frame, state: n.state, device: n.set && n.set.device, tripped: !!(br && br.tripped) };
  });
  return { runs, nodes };
}
