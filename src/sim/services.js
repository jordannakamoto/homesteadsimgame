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
//   issues: [{ runId, severity, reason, fix }], checks: {}, deferred: { [runId]: true }, notes: {}, mains: { [panelKey]: bool } }
//   want: { [frame]: { sig, tally, lines } }: what the Build panel is told (construction.setExternal / setExtLines)
// Commands: services.sync, services.note { key } -> { first }, services.defer { structId, undo? } ("Close up anyway"),
//   services.auto { structId, stage } ("do it for me"; trim-out draws every device, plate and breaker from the stacks),
//   services.openWall { structId, host } ("Open this wall").
// Trim-out by hand (S9b): services.trim { node, step?, n? } (strip, land, fold, plate at a box; press at a panel slot; n per
//   gesture), services.device { node, device } (what goes in a box, until a wire is on it), services.main { panel | node, on }
//   (state mains: { [panelKey]: false } is off; unset is on, so older saves stay lit; the first breaker pressed in by hand
//   turns it off), services.breaker { node, on } (a tripped one is reset by throwing it on), services.flip { node, on? } (a
//   wall switch: its `controls`, by default the lights after it on the cable), services.check { structId, kind: 'power' }
//   (the tester: checks[structId].power = { pass, t, circuits: [{ slot, hops }], faults }).
// The building (src/sim/construction.js) sees rough-in and trim-out as two stages: services tells it the tally of each and
// the shopping lines for them (cable, PEX, boxes, staples, plates, rings), so ordering, deliveries and stacks are the
// Build panel's own. A run is covered when the lining of a wall or ceiling it passes inside is on.
// Readers: overlayData(state), runInfo(state, runId), servicesGuard (the routes system's guard: covered runs refuse work).

import { kept } from './core/keep.js';
import { compileLinks } from './core/links.js';
import { toNeutral, worldOf, runState, progress, pathLength } from './core/routes.js';
import { SERVICE_CLASSES, SERVICE_SPECS, DEFAULT_SPEC, DEVICES, NODE_KINDS, SERVICE_TEXT, PRESETS_M, routeRule, boreCheck,
  SERVICE_LINES, FIXINGS, workCost, runCostLeft, runCostAll, nodeCost, stapleMarks,
  DEVICE_ITEM, DEFAULT_DEVICE, PRESET_DEVICE, TRIM_STEPS, TRIM_TEXT, trimCost, deviceIsLight,
  WATER_DEVICE, WATER_TRIM_STEPS, WATER_PRESET_DEVICE, WATER_TRIM_TEXT, WATER_TEST, MATE_M, waterTrimCost, capCost } from './content/services.js';
import { FIXTURES_ELECTRICAL } from './fixtures-electrical.js';
import { FIXTURES_WATER } from './fixtures-water.js';

const STATE_V = 1;
const fresh = () => ({ v: STATE_V, routesV: -1, version: 0, pieces: [], powerPieces: [], waterPieces: [], sig: '[[],[]]', links: {},
  tally: {}, covered: {}, issues: [], checks: {}, deferred: {}, notes: {}, want: {}, mains: {}, valves: {} });
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

function compilePower(R, g, out, opts = {}) {
  const fx = new Map(), wires = [], mains = opts.mains || {}, dark = switchedOff(R, opts.classes || SERVICE_CLASSES);
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
      // the breaker's own handle off, or the panel's main off: it stands in its slot fed by nothing
      if (!(n.set && n.set.on === false) && mains[panelKey(n)] !== false) wires.push({ id: 'sv:bw:' + id, kind: 'wire', from: { ...n.ref }, to: { piece: brId, port: 'line' }, gauge: sp.gauge || 14, lengthM: 0.3, node: id, services: true });
      refs[id] = { piece: brId, port: 'load' };
    } else if (n.ref) refs[id] = { ...n.ref };
    else if (dev && dev.elec && FIXTURES_ELECTRICAL[dev.elec] && FIXTURES_ELECTRICAL[dev.elec].role !== 'junction') {
      const pid = 'sv:' + id, pc = fixturePiece(R, n, pid, dev.elec);
      if (dark.has(id)) pc.settings = { on: false };                             // a wall switch before it is off
      fx.set(pid, pc); refs[id] = { piece: pid, port: FIXTURES_ELECTRICAL[dev.elec].ports[0].id };
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

// narrowest pipe of a set of runs, and the extra length that stands for the roomier ones (Hazen-Williams: K goes as 1 / d^4.87),
// so a 3/4 in main feeding a 1/2 in branch is one pipe of the branch's size, shortened where it is wide
const hwK = (f) => 10.67 / (Math.pow(f.hazenC || 140, 1.852) * Math.pow(f.innerMm / 1000, 4.8704));
function narrowest(R, runs) {
  let ref = null;
  const fx = runs.map((id) => { const sp = R.runs[id] ? specFor(R.runs[id]) : {}; return sp.material && FIXTURES_WATER[sp.material] || null; });
  if (!fx.length || fx.some((f) => !f)) return null;
  for (const f of fx) if (!ref || f.innerMm < ref.innerMm) ref = f;
  let eq = 0;
  runs.forEach((id, i) => { eq += (R.runs[id].lengthM || 0) * (hwK(fx[i]) / hwK(ref) - 1); });
  return { material: ref.id, equivM: Math.abs(eq) > 1e-9 ? r3(eq) : 0 };
}
const closedRun = (opts, id) => !!(opts.valves && opts.valves['r:' + id] === false);
const closedNode = (opts, id) => !!(opts.valves && opts.valves['n:' + id] === false);

function compileWater(R, g, kind, out, fxSeen, opts = {}) {
  const pieces = [], terminals = [], refs = {};
  for (const id of Object.keys(g.joints).sort()) {
    const j = g.joints[id], n = !j.loose && R.nodes[id];
    if (!n) continue;
    const dev = deviceOf(n), wdef = dev && dev.water && FIXTURES_WATER[dev.water];
    if (n.ref) { refs[id] = { ...n.ref }; terminals.push({ id, ref: refs[id] }); continue; }
    if (!wdef) continue;
    const pid = 'sv:' + id;
    if (!fxSeen.has(pid)) { fxSeen.add(pid); pieces.push(fixturePiece(R, n, pid, dev.water, dev.stubM || 0)); }
    const mate = kind !== 'drain' && n.set && n.set.mate && R.nodes[n.set.mate] && g.joints[n.set.mate] ? n.set.mate : null;
    const hot = !mate && g.edges.some((e) => (e.a === id || e.b === id) && (SERVICE_SPECS[e.spec] || {}).hot);
    const port = kind === 'drain' ? 'drain' : hot && wdef.ports.some((p) => p.id === 'hot') ? 'hot' : 'in';
    refs[id] = { piece: pid, port }; terminals.push({ id, ref: refs[id] });
    if (mate) { refs[mate] = { piece: pid, port: 'hot' }; terminals.push({ id: mate, ref: refs[mate] }); }   // the hot stub of the same fixture
  }
  const res = compileLinks({ terminals, edges: g.edges, joints: g.joints, openEnds: g.openEnds }, { start: () => [], sum: (acc, st) => acc.concat(st.edge.run) });
  const material = (runs) => {
    const sp = specFor(R.runs[runs[0]] || {});
    if (!sp.material) return { diameterMm: sp.diameterMm || 50 };
    const nw = narrowest(R, runs);
    return nw ? { material: nw.material, ...(nw.equivM ? { equivM: nw.equivM } : {}) } : { material: sp.material };
  };
  for (const r of res.links) {
    const A = refs[r.a], B = refs[r.b];
    if (!A || !B || !r.acc.length) continue;
    const runs = r.acc, first = R.runs[runs[0]], props = (first && first.props) || {};
    const id = 'sv:p:' + r.a + '>' + r.b;
    const shut = r.blocked.length > 0 || runs.some((x) => closedRun(opts, x)) || closedNode(opts, r.a) || closedNode(opts, r.b);   // the main, a line's stop, a fixture's stop
    pieces.push({ id, kind: 'pipe', from: A, to: B, lengthM: r3(Math.max(0.05, r.lengthM)), ...material(runs), shut,
      indoor: props.indoor ?? runs.every((x) => R.runs[x] && R.runs[x].frame != null), insulationMm: +props.insulationMm || 0, buriedDepthM: +props.buriedDepthM || 0,
      runs, services: true });
    out.links[id] = runs;
  }
  for (const o of res.open) {
    const from = refs[o.from];
    if (!from || from.port !== 'out' || !o.acc.length) continue;               // only a source spills
    if (o.acc.some((x) => closedRun(opts, x))) continue;                       // a line stopped at the manifold is dry beyond
    const e = o.end, run = e.run ? R.runs[e.run] : null, n = R.nodes[e.node || o.at];
    const w = run ? endWorld(R, run, e.end) : n ? worldOf(R, n.frame, n.at) : [0, 0, 0];
    const id = 'sv:leak:' + o.at;
    if (out.links[id]) continue;
    pieces.push({ id, kind: 'leak', from, lengthM: r3(Math.max(0.05, o.lengthM)), ...material(o.acc), y: r3(w[1]), a: { x: r3(w[0]), z: r3(w[2]) }, at: o.at, runs: o.acc, services: true });
    out.links[id] = o.acc;
  }
  return pieces;
}

// What a node is to the water walk. A stub-out is an open end unless it is capped or has a fixture on it: a stub that is
// strapped up and not capped is open (capped === false is the same by name); one not yet strapped, or an older save's
// (capped true), is not. The hot stub of a fixture (set.of) is the fixture's, never open. A manifold is a hub; closing its
// main blocks everything past it.
export function jointRule(opts = {}) {
  return (n) => {
    const set = n.set || {}, stub = (n.kind === 'stub_supply' || n.kind === 'stub_drain') && !n.ref && !deviceOf(n) && !set.of;
    const open = stub && (set.capped === false || (n.kind === 'stub_supply' && set.capped === undefined && n.state === 'set'));
    return { open, ...(n.kind === 'manifold' && closedNode(opts, n.id) ? { blocked: true } : {}) };
  };
}

// Pure: routes state -> { powerPieces, waterPieces, links, issues }
export function compileServices(R, classes = SERVICE_CLASSES, opts = {}) {
  const out = { links: {} };
  const graphs = toNeutral(R, classes, { joint: jointRule(opts) });
  const powerPieces = graphs.power ? compilePower(R, graphs.power, out, { ...opts, classes }) : [];
  const fxSeen = new Set(), waterPieces = [];
  for (const k of ['water', 'drain']) if (graphs[k]) waterPieces.push(...compileWater(R, graphs[k], k, out, fxSeen, opts));
  const issues = [];
  for (const run of Object.values(R.runs)) if (run.stray) issues.push({ runId: run.id, severity: 'warning', reason: SERVICE_TEXT.stray, fix: 'Take the run out, or put back what it was fixed to.' });
  for (const n of Object.values(R.nodes)) {                                  // a 6-port manifold has six lines, one of which may be the main
    if (n.kind !== 'manifold' || n.stray) continue;
    const k = Object.values(R.runs).filter((r) => (r.a === n.id || r.b === n.id) && !r.stray).length;
    if (k > MANIFOLD_PORTS + 1) issues.push({ pieceId: n.id, severity: 'warning', reason: 'A 6-port manifold has six lines (and its main): this one has ' + (k - 1) + '.', fix: 'Take a line off, or plan another manifold.' });
  }
  return { powerPieces, waterPieces, links: out.links, issues };
}

function tallyOf(R, s, classes) {
  const frames = new Set(Object.keys(R.frames || {}));
  for (const x of [...Object.values(R.runs), ...Object.values(R.nodes)]) if (x.frame != null) frames.add(x.frame);
  const skip = (x) => !!s.deferred[x.id], t = {};
  for (const f of [...frames].sort()) t[f] = { 'rough-in': progress(R, classes, f, 'rough', skip), 'trim-out': progress(R, classes, f, 'trim', skip) };
  return t;
}

const ROUGH = 'rough-in', TRIM = 'trim-out';
const WATER_TEST_TEXT = WATER_TRIM_TEXT.faults;
const MANIFOLD_PORTS = 6;
const addTo = (o, more) => { for (const [k, q] of Object.entries(more)) o[k] = Math.round(((o[k] || 0) + q) * 1e6) / 1e6; return o; };
// the shopping lines of one building: what every run and box planned there takes (deferred ones left out)
function linesOf(R, s, frame, classes) {
  const tot = {}, count = {};
  for (const id of Object.keys(R.runs).sort()) {
    const run = R.runs[id];
    if (run.frame !== frame || run.legacy || run.stray || s.deferred[id] || !classes[run.cls]) continue;
    const c = runCostAll(run);
    addTo(tot, c);
    for (const k of Object.keys(c)) count[k] = (count[k] || 0) + 1;
  }
  for (const id of Object.keys(R.nodes).sort()) {
    const n = R.nodes[id];
    if (n.frame !== frame || n.stray || s.deferred[id]) continue;
    const c = { ...nodeCost(n), ...capCost(n) };
    addTo(tot, c); addTo(count, c);
  }
  // trim-out: a device (and its plate) for each box a cable comes to, a breaker for each slot. A node trimmed before
  // trim-out took stock (no `set.trim`) was fitted for free: it asks for nothing now.
  const trimTot = {};
  for (const id of Object.keys(R.nodes).sort()) {
    const n = R.nodes[id];
    if (n.frame !== frame || n.stray || s.deferred[id] || !(CABLE_TRIM.has(n.kind) || n.kind === 'stub_supply') || (n.state === 'trimmed' && !(n.set && n.set.trim))) continue;
    if (!(n.kind === 'stub_supply' ? supplyRunsAt(R, id, classes, s.deferred) : cableRunsAt(R, id, classes, s.deferred)).length) continue;
    addTo(trimTot, fullTrimCost(R, n, classes, s.deferred));
  }
  const line = (stage, tot, cnt) => (itemId) => ({ key: stage + '|services:' + itemId, stage, itemId, qty: tot[itemId], label: (SERVICE_LINES[itemId] || {}).label || itemId, why: (SERVICE_LINES[itemId] || {}).why || '', count: cnt ? cnt[itemId] || 0 : Math.round(tot[itemId]) });
  return [...Object.keys(tot).sort().map(line(ROUGH, tot, count)), ...Object.keys(trimTot).sort().map(line(TRIM, trimTot, null))];
}

// ------------------------------------------------------------------------------------------- trim-out helpers (pure)
const CABLE_TRIM = new Set(['box', 'box_ceiling', 'slot']);
// the panel a slot is on (its equipment piece), or the building for a slot bound to nothing
export const panelKey = (n) => (n && n.ref && n.ref.piece != null ? String(n.ref.piece) : 'f:' + (n ? n.frame : ''));
const isPower = (classes, r) => !!classes[r.cls] && classes[r.cls].linkKind === 'power';
function cableRunsAt(R, id, classes = SERVICE_CLASSES, deferred = {}) {
  const out = [];
  for (const k of Object.keys(R.runs).sort()) { const r = R.runs[k]; if ((r.a === id || r.b === id) && isPower(classes, r) && !r.stray && !deferred[r.id]) out.push(r); }
  return out;
}
const isSupply = (classes, r) => !!classes[r.cls] && classes[r.cls].linkKind === 'water';
function supplyRunsAt(R, id, classes = SERVICE_CLASSES, deferred = {}) {
  const out = [];
  for (const k of Object.keys(R.runs).sort()) { const r = R.runs[k]; if ((r.a === id || r.b === id) && isSupply(classes, r) && !r.stray && !deferred[r.id]) out.push(r); }
  return out;
}
const hotRuns = (rs) => rs.length > 0 && rs.every((r) => specFor(r).hot);
const dist3 = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
// the stub that carries hot for the fixture on stub n: the nearest other stub-out within MATE_M with hot pipe, not already taken.
// A stub with only hot pipe, and a cold one beside it, is the hot side (set.of) and gives way to it.
export function mateOf(R, n, classes = SERVICE_CLASSES, deferred = {}) {
  if (!n || n.kind !== 'stub_supply') return null;
  if (n.set && n.set.mate && R.nodes[n.set.mate]) return R.nodes[n.set.mate];
  if (hotRuns(supplyRunsAt(R, n.id, classes, deferred))) return null;
  let best = null, bd = MATE_M;
  for (const id of Object.keys(R.nodes).sort()) {
    const o = R.nodes[id];
    if (o === n || o.kind !== 'stub_supply' || o.frame !== n.frame || o.stray || o.ref || (o.set && (o.set.device || (o.set.of && o.set.of !== n.id)))) continue;
    if (!hotRuns(supplyRunsAt(R, id, classes, deferred))) continue;
    const d = dist3(n, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
// the cold stub a hot stub belongs to, or null
export function primaryOf(R, n, classes = SERVICE_CLASSES, deferred = {}) {
  if (!n || n.kind !== 'stub_supply') return null;
  if (n.set && n.set.of && R.nodes[n.set.of]) return R.nodes[n.set.of];
  if (!hotRuns(supplyRunsAt(R, n.id, classes, deferred))) return null;
  for (const id of Object.keys(R.nodes).sort()) {
    const o = R.nodes[id];
    if (o === n || o.kind !== 'stub_supply' || o.frame !== n.frame || o.stray || o.ref || (o.set && (o.set.device || o.set.of))) continue;
    if (supplyRunsAt(R, id, classes, deferred).length && !hotRuns(supplyRunsAt(R, id, classes, deferred)) && dist3(n, o) <= MATE_M && mateOf(R, o, classes, deferred) === n) return o;
  }
  return null;
}
// the fixture a stub-out gets: chosen, or what it was planned as (sink, bath, toilet, shower), or a kitchen sink
export const waterDeviceFor = (n) => (n && n.set && (n.set.device || WATER_PRESET_DEVICE[n.set.preset])) || 'sink_kitchen';
// Where a stub-out's trim stands, like trimInfo for a box: steps fix, stop, line. units: one fixture, and a stop and a line
// for each supply it takes (cold, and hot when it has a hot stub beside it). The hot stub is trimmed with the cold one.
export function waterTrimInfo(R, n, classes = SERVICE_CLASSES, deferred = {}) {
  if (!n || n.kind !== 'stub_supply') return null;
  const runs = supplyRunsAt(R, n.id, classes, deferred), N = WATER_TRIM_TEXT.notReady, trimmed = n.state === 'trimmed';
  const prim = primaryOf(R, n, classes, deferred), mate = prim ? null : mateOf(R, n, classes, deferred), dev = waterDeviceFor(prim || n), d = WATER_DEVICE[dev] || { ports: ['in'] };
  const P = 1 + (mate && d.ports.includes('hot') ? 1 : 0), units = { fix: 1, stop: P, line: P };
  const t = (n.set && n.set.trim) || {}, done = {};
  for (const st of WATER_TRIM_STEPS) done[st] = trimmed ? units[st] : Math.min(units[st], +t[st] || 0);
  let next = null;
  if (!trimmed) for (const st of WATER_TRIM_STEPS) if (done[st] < units[st]) { next = st; break; }
  const mateRuns = mate ? supplyRunsAt(R, mate.id, classes, deferred) : [];
  const incomplete = (rs) => rs.some((r) => !runState(r, classes[r.cls]).complete);
  const reason = n.stray ? N.stray : prim ? N.mate : !runs.length ? N.none : n.state === 'planned' ? N.planned : incomplete(runs) || incomplete(mateRuns) ? N.runs : null;
  return { node: n.id, kind: 'stub_supply', water: true, steps: WATER_TRIM_STEPS, units, done, next, ready: !reason, reason, trimmed, ends: runs.map((r) => ({ run: r.id, end: r.a === n.id ? 'a' : 'b' })),
    device: dev, mate: mate ? mate.id : null, hotOf: prim ? prim.id : null, ports: d.ports, capped: !!(n.set && n.set.capped === true) };
}
// the device a box gets: chosen, or what it was planned as, or by its kind (an outlet in a wall box, a light in a ceiling box)
export const deviceFor = (n) => (n && n.set && (n.set.device || PRESET_DEVICE[n.set.preset])) || (n ? DEFAULT_DEVICE[n.kind] : null) || null;
// the breaker a slot takes: the thinnest cable leaving it sets it (NEC 240.4(D))
export function breakerFor(R, slotId, classes = SERVICE_CLASSES) {
  let sp = null;
  for (const r of cableRunsAt(R, slotId, classes)) { const q = specFor(r); if (!sp || (q.ratingA || 15) < (sp.ratingA || 15)) sp = q; }
  return (sp && sp.breaker) || 'breaker_15a';
}
// Where a node's trim-out stands: { steps, units, done, next, ready, reason, ends, device, breaker, trimmed } or null
export function trimInfo(R, n, classes = SERVICE_CLASSES, deferred = {}) {
  if (n && n.kind === 'stub_supply') return waterTrimInfo(R, n, classes, deferred);
  if (!n || !CABLE_TRIM.has(n.kind)) return null;
  const steps = TRIM_STEPS[n.kind], runs = cableRunsAt(R, n.id, classes, deferred), E = runs.length;
  const units = n.kind === 'slot' ? { press: 1 } : { strip: E, land: E, fold: 1, plate: 1 };
  const t = (n.set && n.set.trim) || {}, trimmed = n.state === 'trimmed', done = {};
  for (const st of steps) done[st] = trimmed ? units[st] : Math.min(units[st], +t[st] || 0);
  let next = null;
  if (!trimmed) for (const st of steps) if (done[st] < units[st]) { next = st; break; }
  const N = TRIM_TEXT.notReady;
  const reason = n.stray ? N.stray : !E ? N.none : n.kind !== 'slot' && n.state === 'planned' ? N.planned : runs.some((r) => !runState(r, classes[r.cls]).complete) ? N.runs : null;
  return { node: n.id, kind: n.kind, steps, units, done, next, ready: !reason, reason, trimmed, ends: runs.map((r) => ({ run: r.id, end: r.a === n.id ? 'a' : 'b' })),
    device: n.kind === 'slot' ? null : deviceFor(n), breaker: n.kind === 'slot' ? breakerFor(R, n.id, classes) : null };
}
// what is still to go into a node at trim-out
function fullTrimCost(R, n, classes, deferred) {
  const ti = trimInfo(R, n, classes, deferred), out = {};
  if (!ti) return out;
  const done = { ...ti.done };
  if (ti.water) { for (const st of ti.steps) { addTo(out, waterTrimCost(ti.device, st, ti.units[st] - done[st], done)); done[st] = ti.units[st]; } return ti.hotOf ? {} : out; }
  for (const st of ti.steps) { addTo(out, trimCost(n.kind, ti.device, st, ti.units[st] - done[st], done, ti.breaker)); done[st] = ti.units[st]; }
  return out;
}
// the cable network as neighbours: node -> [{ to, run }]
function cableGraph(R, classes) {
  const adj = {};
  for (const id of Object.keys(R.runs).sort()) {
    const r = R.runs[id];
    if (!isPower(classes, r) || r.stray) continue;
    (adj[r.a] || (adj[r.a] = [])).push({ to: r.b, run: r });
    (adj[r.b] || (adj[r.b] = [])).push({ to: r.a, run: r });
  }
  return adj;
}
// What a wall switch controls: the lights after it on the cable (away from the panel), through other switches (those are in
// series); with no light after it, the outlets (a switched outlet). An explicit `set.controls` list wins.
export function switchControls(R, swId, classes = SERVICE_CLASSES) {
  const sw = R.nodes[swId];
  if (!sw) return [];
  if (sw.set && Array.isArray(sw.set.controls)) return sw.set.controls.filter((id) => R.nodes[id]);
  const adj = cableGraph(R, classes);
  // which neighbour leads back to a panel slot
  let up = null;
  { const prev = { [swId]: null }, q = [swId];
    while (q.length && up == null) {
      const x = q.shift();
      for (const e of adj[x] || []) {
        if (e.to in prev) continue;
        prev[e.to] = x;
        if (R.nodes[e.to] && R.nodes[e.to].kind === 'slot') { let k = e.to; while (prev[k] !== swId) k = prev[k]; up = k; break; }
        q.push(e.to);
      }
    } }
  const seen = new Set([swId]), q = [swId], lights = [], outlets = [];
  while (q.length) {
    const x = q.shift();
    for (const e of adj[x] || []) {
      if (seen.has(e.to) || (x === swId && e.to === up)) continue;
      seen.add(e.to);
      const n = R.nodes[e.to];
      if (!n || n.kind === 'slot') continue;
      const dev = deviceFor(n);
      if (deviceIsLight(dev)) lights.push(n.id); else if (dev === 'outlet_120v') outlets.push(n.id);
      q.push(e.to);
    }
  }
  return lights.length ? lights : outlets;
}
// the devices a switch that is off keeps dark
function switchedOff(R, classes) {
  const out = new Set();
  for (const id of Object.keys(R.nodes)) {
    const n = R.nodes[id];
    if (n.state === 'trimmed' && n.set && n.set.on === false && deviceFor(n) === 'switch_single') for (const c of switchControls(R, id, classes)) out.add(c);
  }
  return out;
}
// A circuit from its panel slot, box to box in the order the cable reaches them: [{ node, run, from, depth, ok, why }].
// A run not finished stops the walk there; `why` names what is missing (the tester at the panel shows it in red).
export function circuitWalk(R, slotId, classes = SERVICE_CLASSES) {
  const adj = cableGraph(R, classes), hops = [], seen = new Set([slotId]), runs = new Set(), q = [{ id: slotId, depth: 0 }];
  while (q.length) {
    const { id, depth } = q.shift();
    for (const e of adj[id] || []) {
      if (runs.has(e.run.id)) continue;
      runs.add(e.run.id);
      const rs = runState(e.run, classes[e.run.cls]), n = R.nodes[e.to];
      if (!rs.complete) { hops.push({ node: e.to, run: e.run.id, from: id, depth: depth + 1, ok: false, why: TRIM_TEXT.faults[rs.next] || rs.next }); continue; }
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      const bad = n && n.state === 'planned' && n.kind !== 'slot';
      hops.push({ node: e.to, run: e.run.id, from: id, depth: depth + 1, ok: !bad, why: bad ? TRIM_TEXT.faults.box : null });
      q.push({ id: e.to, depth: depth + 1 });
    }
  }
  return hops;
}
// a command of another system, run now with that system's own context (the way construction moves money through stock)
function callAs(ctx, sysName, name, payload) {
  const h = ctx.sim && ctx.sim.handlers.get(name);
  if (!h || ctx.state.sys[sysName] === undefined) return null;
  const st = ctx.state;
  return h.fn({ sim: ctx.sim, state: st, t: st.t, tick: st.tick, dt: 0, get s() { return st.sys[sysName]; }, set s(v) { st.sys[sysName] = v; }, get: (n) => st.sys[n], emit: ctx.emit, rng: ctx.rng }, payload);
}
// a wall is covered once any of its lining is up: a wall face is hung sheet by sheet (`<wall>.ln<face>.<k>`, see
// docs/design/interior-walls.md), and older plans have one `<wall>.ln` piece; either way nothing behind it can be reached
const builtLining = (pr, host) => !!pr && Object.keys(pr.members).some((id) => { const m = pr.members[id]; return m.kind === 'lining' && m.parent === host && m.built; }) || !!(pr && pr.members[host + '.ln'] && pr.members[host + '.ln'].built);

export function servicesSystem({ classes = SERVICE_CLASSES, routesName = 'routes' } = {}) {
  const ensure = (ctx) => { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); if (!ctx.s.want) { ctx.s.want = {}; ctx.s.routesV = -1; } if (!ctx.s.mains) ctx.s.mains = {}; if (!ctx.s.valves) ctx.s.valves = {}; return ctx.s; };   // a save from before S8: work the lines out again
  const compile = (ctx) => {
    const s = ensure(ctx), R = ctx.get(routesName);
    if (!R || R.version === s.routesV) return s;
    const c = compileServices(R, classes, { mains: s.mains, valves: s.valves });
    const sig = JSON.stringify([c.powerPieces, c.waterPieces]);
    if (sig !== s.sig) {                                                     // same arrays (so the same networks) when nothing changed
      s.powerPieces = c.powerPieces; s.waterPieces = c.waterPieces; s.pieces = c.powerPieces.concat(c.waterPieces);
      s.sig = sig; s.links = c.links; s.version++;
      ctx.emit('services.changed', { version: s.version });
    }
    s.issues = c.issues; s.tally = tallyOf(R, s, classes); s.routesV = R.version;
    s.want = {};
    for (const f of Object.keys(s.tally)) {
      const lines = linesOf(R, s, f, classes);
      s.want[f] = { sig: JSON.stringify([s.tally[f], lines]), lines };
    }
    return s;
  };
  // the building's side: which runs its linings cover, and the Build panel told the tally and the lines when they change.
  // Each tick: a lookup per run and host, and a string compare per building.
  const link = (ctx) => {
    const s = ensure(ctx), R = ctx.get(routesName), CN = ctx.get('construction');
    if (!R || !CN || !CN.progress) return;
    let cov = null;
    for (const run of Object.values(R.runs)) {
      const pr = run.frame != null ? CN.progress[run.frame] : null;
      if (pr && (run.hosts || []).some((h) => builtLining(pr, h))) (cov || (cov = {}))[run.id] = true;
    }
    cov = cov || {};
    const a = Object.keys(cov), b = Object.keys(s.covered || {});
    if (a.length !== b.length || a.some((k) => !s.covered[k])) { s.covered = cov; ctx.emit('services.covered', { runs: a }); }
    for (const f of Object.keys(s.want)) {
      const pr = CN.progress[f], w = s.want[f];
      if (!pr) continue;
      const have = (kept(pr, 'extLines') || {}).services;
      if (have && have.sig === w.sig) continue;
      const t = s.tally[f] || {};
      for (const st of [ROUGH, TRIM]) callAs(ctx, 'construction', 'construction.setExternal', { structId: f, stage: st, built: (t[st] || [0, 0])[0], total: (t[st] || [0, 0])[1] });
      callAs(ctx, 'construction', 'construction.setExtLines', { structId: f, source: 'services', lines: w.lines, sig: w.sig });
    }
  };
  const recount = (ctx) => { const s = ensure(ctx); s.routesV = -1; compile(ctx); link(ctx); };
  const routes = (ctx, cmd, p) => callAs(ctx, routesName, routesName + '.' + cmd, p) || { ok: false, reason: 'no routes' };

  // material from the building's lines: null when there is enough (or the building counts nothing), else the refusal
  function lack(ctx, f, need) {
    for (const [itemId, qty] of Object.entries(need)) {
      const c = callAs(ctx, 'construction', 'construction.use', { structId: f, itemId, qty, from: 'stacks', check: true });
      if (c && !c.ok && c.reason !== 'not in the plan') return { ok: false, reason: c.reason, itemId, need: qty, have: c.have };
    }
    return null;
  }
  function useAll(ctx, f, need) { for (const [itemId, qty] of Object.entries(need)) callAs(ctx, 'construction', 'construction.use', { structId: f, itemId, qty, from: 'stacks' }); }

  // Trim-out by hand, one gesture: { node, step?, n? }. n: how many of the step one gesture does (the Build panel's
  // per-gesture setting): ends stripped or landed at this box, or breakers pressed into this panel. Fold and plate are both
  // clicks, so a gesture of two or more folds the device in and puts its plate on.
  function trim(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), n = R && R.nodes[p.node];
    if (!n) return { ok: false, reason: 'no such box' };
    const ti = trimInfo(R, n, classes, s.deferred);
    if (!ti) return { ok: false, reason: 'nothing to fit there' };
    if (ti.water) return trimWater(ctx, n, ti, p);
    if (ti.trimmed) return { ok: true, done: 0, trimmed: true, node: n.id };
    if (!ti.ready) return { ok: false, reason: ti.reason };
    const step = p.step || ti.next, want = Math.max(1, p.n | 0 || 1);
    if (step !== ti.next) return { ok: false, reason: 'First ' + TRIM_TEXT.steps[ti.next] + '.', need: ti.next };
    const work = [[step, Math.min(want, ti.units[step] - ti.done[step])]];
    if (step === 'fold' && want >= 2) work.push(['plate', 1]);
    const more = [];                                                     // the next slots of the same panel, for a press of several
    if (step === 'press' && want > 1) for (const id of Object.keys(R.nodes).sort()) {
      if (more.length >= want - 1) break;
      const o = R.nodes[id];
      if (o === n || o.kind !== 'slot' || o.frame !== n.frame || panelKey(o) !== panelKey(n) || o.state === 'trimmed') continue;
      const oi = trimInfo(R, o, classes, s.deferred);
      if (oi && oi.ready) more.push(oi);
    }
    const need = {}, done = { ...ti.done };
    for (const [st, k] of work) { addTo(need, trimCost(n.kind, ti.device, st, k, done, ti.breaker)); done[st] += k; }
    for (const oi of more) addTo(need, trimCost('slot', null, 'press', 1, {}, oi.breaker));
    const miss = lack(ctx, n.frame, need);
    if (miss) return miss;
    const fin = ti.steps.every((st) => done[st] >= ti.units[st]);
    if (ti.device && !(n.set && n.set.device)) routes(ctx, 'setNode', { id: n.id, key: 'device', value: ti.device });
    if (n.kind !== 'slot') routes(ctx, 'setNode', { id: n.id, key: 'trim', value: done });
    const pressed = [];
    for (const x of fin ? [n, ...more.map((oi) => R.nodes[oi.node])] : []) {
      routes(ctx, 'setNode', { id: x.id, state: 'trimmed' });
      if (x.kind === 'slot') { pressed.push(x.id); if (s.mains[panelKey(x)] === undefined) s.mains[panelKey(x)] = false; }   // you work with the main off
    }
    useAll(ctx, n.frame, need);
    recount(ctx);
    ctx.emit('services.trim', { node: n.id, step, trimmed: fin });
    return { ok: true, node: n.id, step, did: work.map(([st, k]) => ({ step: st, n: k })), trimmed: fin, pressed, used: need, next: fin ? null : trimInfo(R, n, classes, s.deferred).next };
  }
  // A stub-out at trim-out, one gesture: { node, step?, n? } steps fix (the fixture goes on its stubs), stop (an angle stop on
  // each supply), line (a supply line from each stop); n stops or lines per gesture. The first fixture shuts the manifold's
  // main (you work with the water off); the hot stub of a sink or shower is trimmed with its cold one.
  function trimWater(ctx, n, ti, p) {
    const s = ensure(ctx), R = ctx.get(routesName);
    if (ti.trimmed) return { ok: true, done: 0, trimmed: true, node: n.id };
    if (!ti.ready) return { ok: false, reason: ti.reason };
    const step = p.step || ti.next, want = Math.max(1, p.n | 0 || 1);
    if (step !== ti.next) return { ok: false, reason: 'First ' + WATER_TRIM_TEXT.steps[ti.next] + '.', need: ti.next };
    const k = Math.min(want, ti.units[step] - ti.done[step]), need = waterTrimCost(ti.device, step, k, ti.done);
    const miss = lack(ctx, n.frame, need);
    if (miss) return miss;
    const done = { ...ti.done }; done[step] += k;
    const fin = ti.steps.every((st) => done[st] >= ti.units[st]);
    let closed = [];
    if (step === 'fix') {
      if (!(n.set && n.set.device)) routes(ctx, 'setNode', { id: n.id, key: 'device', value: ti.device });
      if (ti.mate) { routes(ctx, 'setNode', { id: n.id, key: 'mate', value: ti.mate }); routes(ctx, 'setNode', { id: ti.mate, key: 'of', value: n.id }); }
      for (const m of Object.values(R.nodes)) if (m.kind === 'manifold' && m.frame === n.frame && !m.stray && s.valves['n:' + m.id] === undefined) { s.valves['n:' + m.id] = false; closed.push(m.id); }
    }
    routes(ctx, 'setNode', { id: n.id, key: 'trim', value: done });
    if (fin) for (const id of [n.id, ti.mate]) if (id) routes(ctx, 'setNode', { id, state: 'trimmed' });
    useAll(ctx, n.frame, need);
    recount(ctx);
    ctx.emit('services.trim', { node: n.id, step, trimmed: fin });
    return { ok: true, node: n.id, step, did: [{ step, n: k }], trimmed: fin, used: need, mate: ti.mate, mainClosed: closed, next: fin ? null : trimInfo(R, n, classes, s.deferred).next };
  }
  // cap or uncap a stub-out: { node, on? }. The first cap takes one from the stacks; a cap taken off and put back is the same cap.
  function cap(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), n = R && R.nodes[p.node];
    if (!n || n.kind !== 'stub_supply') return { ok: false, reason: 'no stub-out there' };
    if (n.state === 'planned') return { ok: false, reason: WATER_TRIM_TEXT.notReady.planned };
    if (n.state === 'trimmed') return { ok: false, reason: 'A fixture is on it.' };
    const on = p.on === undefined ? !(n.set && n.set.capped === true) : !!p.on;
    if (on && !(n.set && n.set.capUsed)) {
      const need = { pex_cap_12: 1 }, miss = lack(ctx, n.frame, need);
      if (miss) return miss;
      useAll(ctx, n.frame, need);
      routes(ctx, 'setNode', { id: n.id, key: 'capUsed', value: true });
    }
    routes(ctx, 'setNode', { id: n.id, key: 'capped', value: on });
    recount(ctx);
    return { ok: true, capped: on, node: n.id };
  }
  // a valve by hand: { node | run, on? }. A manifold node is its main; a run is the stop on its line; a stub-out with its
  // fixture on is the angle stop. Opening the main on dry pipe sends the knock back (page: shake, sputtering taps).
  function valve(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName);
    let key = null, what = null;
    if (p.run != null && R.runs[p.run]) { key = 'r:' + p.run; what = 'line'; }
    else if (p.node != null && R.nodes[p.node]) {
      const n = R.nodes[p.node];
      if (n.kind === 'manifold') { key = 'n:' + n.id; what = 'main'; }
      else if (n.kind === 'stub_supply' && n.state === 'trimmed' && n.set && n.set.device) { key = 'n:' + n.id; what = 'stop'; }
      else if (n.kind === 'stub_supply' && n.set && n.set.of && n.state === 'trimmed') { key = 'n:' + n.id; what = 'stop'; }
      else return { ok: false, reason: n.kind === 'stub_supply' ? 'No stop on this stub-out yet.' : 'No valve there.' };
    } else return { ok: false, reason: 'no valve there' };
    const was = s.valves[key] !== false, on = p.on === undefined ? !was : !!p.on;
    if (on) delete s.valves[key]; else s.valves[key] = false;
    recount(ctx);
    const first = on && !was && what === 'main' && !s.notes['water:first-flow'];
    ctx.emit('services.valve', { key, what, on });
    return { ok: true, what, on, changed: on !== was, knock: on && !was && what === 'main', first };
  }
  // choose what goes in a box, until the first wire is on it: { node, device }
  function device(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), n = R && R.nodes[p.node];
    const ti = n && trimInfo(R, n, classes, s.deferred);
    if (!ti || n.kind === 'slot') return { ok: false, reason: 'no such box' };
    if (!DEVICE_ITEM[p.device] || !DEVICE_ITEM[p.device].fits.includes(n.kind)) return { ok: false, reason: 'that does not go in this box' };
    if (ti.done.land > 0 || ti.trimmed) return { ok: false, reason: 'the wires are already on it' };
    routes(ctx, 'setNode', { id: n.id, key: 'device', value: p.device });
    recount(ctx);
    return { ok: true, device: p.device };
  }
  // the panel's main breaker: { panel | node, on }. Off, nothing after it has power.
  function main(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName);
    const k = p.panel != null ? String(p.panel) : R && R.nodes[p.node] ? panelKey(R.nodes[p.node]) : null;
    if (k == null) return { ok: false, reason: 'no such panel' };
    const on = p.on === undefined ? s.mains[k] === false : !!p.on;
    s.mains[k] = on;
    recount(ctx);
    ctx.emit('services.main', { panel: k, on });
    return { ok: true, panel: k, on };
  }
  // one breaker's handle: { node, on }. A tripped one is reset by throwing it on (through off: one drag).
  function breaker(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), n = R && R.nodes[p.node];
    if (!n || n.kind !== 'slot') return { ok: false, reason: 'no such breaker' };
    if (n.state !== 'trimmed') return { ok: false, reason: TRIM_TEXT.steps.press + ' first' };
    const E = ctx.get('electrical'), b = E && E.breakers ? E.breakers['sv:br:' + n.id] : null, tripped = !!(b && b.tripped);
    const on = p.on === undefined ? tripped || (n.set && n.set.on === false) : !!p.on;
    if (tripped && on) callAs(ctx, 'electrical', 'electrical.resetBreaker', { id: 'sv:br:' + n.id });
    if (!!(n.set && n.set.on === false) === on) routes(ctx, 'setNode', { id: n.id, key: 'on', value: on });
    recount(ctx);
    return { ok: true, on, reset: tripped && on };
  }
  // a wall switch clicked: { node, on? }. The lights it controls follow at once.
  function flip(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), n = R && R.nodes[p.node];
    if (!n || n.state !== 'trimmed' || deviceFor(n) !== 'switch_single') return { ok: false, reason: 'no switch there' };
    const on = p.on === undefined ? !!(n.set && n.set.on === false) : !!p.on;
    routes(ctx, 'setNode', { id: n.id, key: 'on', value: on });
    const ctl = switchControls(R, n.id, classes), dark = switchedOff(R, classes);
    for (const id of ctl) callAs(ctx, 'electrical', 'electrical.switch', { pieceId: 'sv:' + id, on: !dark.has(id) });
    recount(ctx);
    return { ok: true, on, controls: ctl };
  }
  // the tester clipped on at the panel: every circuit walked from its slot, box to box. { structId, kind: 'power' }
  function check(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), f = p.structId != null ? String(p.structId) : null;
    if (!R || f == null) return { ok: false, reason: 'unknown building' };
    if (p.kind === 'water') return waterCheck(ctx, f);
    if ((p.kind || 'power') !== 'power') return { ok: false, reason: 'only power and water can be tested' };
    const slots = Object.keys(R.nodes).sort().filter((id) => R.nodes[id].frame === f && R.nodes[id].kind === 'slot' && !R.nodes[id].stray && cableRunsAt(R, id, classes).length);
    if (!slots.length) return { ok: false, reason: 'No circuit starts at a panel in this building.' };
    const circuits = slots.map((slot) => ({ slot, hops: circuitWalk(R, slot, classes) })), reached = new Set(slots), faults = [];
    for (const c of circuits) for (const h of c.hops) { reached.add(h.node); if (!h.ok) faults.push({ slot: c.slot, node: h.node, run: h.run, why: h.why }); }
    for (const id of Object.keys(R.runs).sort()) {
      const r = R.runs[id];
      if (r.frame !== f || !isPower(classes, r) || r.stray || s.deferred[id] || reached.has(r.a) || reached.has(r.b)) continue;
      faults.push({ slot: null, node: r.b, run: id, why: TRIM_TEXT.faults.loose });
    }
    const res = { pass: !faults.length, t: ctx.state.t, circuits, faults };
    s.checks[f] = { ...(s.checks[f] || {}), power: res };
    ctx.emit('services.checked', { structId: f, kind: 'power', pass: res.pass });
    return { ok: true, ...res };
  }

  // The pressure test: the lines are shut off from the supply and a test pump and gauge are put on at the manifold; pumped to
  // WATER_TEST.kPa, the needle holds for WATER_TEST.holdMin minutes or sags. Anything open sprays: an uncapped stub-out, an end
  // not crimped; a run not yet pulled through is named too. Judged from the pipes themselves (the water network is not
  // touched), so it can be done with the main closed, tank empty, or nothing connected yet.
  function waterCheck(ctx, f) {
    const s = ensure(ctx), R = ctx.get(routesName);
    const runs = Object.keys(R.runs).sort().map((id) => R.runs[id]).filter((r) => r.frame === f && isSupply(classes, r) && !r.stray && !r.legacy && !s.deferred[r.id]);
    if (!runs.length) return { ok: false, reason: 'No supply pipe in this building to test.' };
    const faults = [], leaks = [];
    for (const r of runs) {
      const rs = runState(r, classes[r.cls]);
      if (!rs.complete && rs.next !== 'join') faults.push({ run: r.id, node: r.b, why: WATER_TRIM_TEXT.faults[rs.next] || rs.next, w: endWorld(R, r, 'b') });
    }
    const g = toNeutral(R, classes, { joint: jointRule({ valves: {} }) }).water || { edges: [], openEnds: [] };
    const wired = new Set(); for (const e of g.edges) { wired.add(e.a); wired.add(e.b); }
    for (const o of g.openEnds) {
      if (o.run) { const r = R.runs[o.run]; if (!r || r.frame !== f || s.deferred[r.id]) continue; leaks.push({ run: o.run, end: o.end, node: o.node, why: WATER_TEST_TEXT.join, w: endWorld(R, r, o.end) }); continue; }
      const n = R.nodes[o.node || o.at];
      if (!n || n.frame !== f || !wired.has(n.id) || s.deferred[n.id]) continue;
      leaks.push({ node: n.id, why: WATER_TEST_TEXT.cap, w: worldOf(R, n.frame, n.at) });
    }
    const man = Object.keys(R.nodes).sort().find((id) => R.nodes[id].kind === 'manifold' && R.nodes[id].frame === f) || null;
    const res = { pass: !faults.length && !leaks.length, t: ctx.state.t, testKPa: WATER_TEST.kPa, holdMin: WATER_TEST.holdMin, at: man, lines: runs.length, leaks, faults,
      holds: !leaks.length && !faults.length, peakKPa: leaks.length ? 25 : WATER_TEST.kPa };
    s.checks[f] = { ...(s.checks[f] || {}), water: res };
    ctx.emit('services.checked', { structId: f, kind: 'water', pass: res.pass });
    return { ok: true, ...res };
  }
  // "Close up anyway": what is not roughed in on this building leaves the tally and stays as plan lines
  function defer(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), f = p.structId != null ? String(p.structId) : null;
    if (!R || f == null) return { ok: false, reason: 'unknown building' };
    let n = 0;
    for (const run of Object.values(R.runs)) {
      if (run.frame !== f) continue;
      if (p.undo) { if (s.deferred[run.id]) { delete s.deferred[run.id]; n++; } continue; }
      if (!s.deferred[run.id] && !runState(run, classes[run.cls]).complete) { s.deferred[run.id] = true; n++; }
    }
    const kinds = new Set(Object.values(classes).flatMap((c) => (c.phases && c.phases.rough) || []));
    for (const nd of Object.values(R.nodes)) {
      if (nd.frame !== f || !kinds.has(nd.kind)) continue;
      if (p.undo) { if (s.deferred[nd.id]) { delete s.deferred[nd.id]; n++; } continue; }
      if (!s.deferred[nd.id] && nd.state === 'planned') { s.deferred[nd.id] = true; n++; }
    }
    recount(ctx);
    return { ok: true, deferred: n };
  }
  // "Do it for me": every run and box of the stage on this building, in one go, using the material from the stacks
  function auto(ctx, p = {}) {
    const s = ensure(ctx), R = ctx.get(routesName), f = p.structId != null ? String(p.structId) : null, stage = p.stage || ROUGH;
    if (!R || f == null) return { ok: false, reason: 'unknown building' };
    compile(ctx); link(ctx);
    const ids = (o) => Object.keys(o).sort();
    if (stage === ROUGH) {
      const runs = ids(R.runs).map((id) => R.runs[id]).filter((r) => r.frame === f && !r.stray && !r.legacy && !s.deferred[r.id] && classes[r.cls] && !runState(r, classes[r.cls]).complete);
      const open = runs.filter((r) => !s.covered[r.id]);
      const kinds = new Set(Object.values(classes).flatMap((c) => (c.phases && c.phases.rough) || []));
      const nodes = ids(R.nodes).map((id) => R.nodes[id]).filter((n) => n.frame === f && !n.stray && n.state === 'planned' && kinds.has(n.kind) && !s.deferred[n.id]);
      const caps = ids(R.nodes).map((id) => R.nodes[id]).filter((n) => n.frame === f && n.kind === 'stub_supply' && !n.stray && !s.deferred[n.id] && n.state !== 'trimmed' && !(n.set && n.set.capped === true));
      if (!open.length && !nodes.length && !caps.length) return { ok: false, reason: runs.length ? SERVICE_TEXT.covered : 'nothing to rough in', covered: runs.length };
      const need = {};
      for (const r of open) addTo(need, runCostLeft(r));
      for (const n of nodes) addTo(need, nodeCost(n));
      for (const n of caps) addTo(need, capCost(n));
      for (const [itemId, qty] of Object.entries(need)) {
        const c = callAs(ctx, 'construction', 'construction.use', { structId: f, itemId, qty, from: 'stacks', check: true });
        if (c && !c.ok) return { ok: false, reason: c.reason, itemId, need: qty, have: c.have };
      }
      for (const r of open) for (const st of classes[r.cls].steps || []) {
        if (st === 'bore') routes(ctx, 'work', { id: r.id, what: 'bore', n: r.bores.length || 1 });
        else if (st === 'pull') routes(ctx, 'work', { id: r.id, what: 'pull', to: 1 });
        else if (st === 'seg') routes(ctx, 'work', { id: r.id, what: 'seg', n: r.segs || 1 });
        else if (st === 'join') routes(ctx, 'work', { id: r.id, what: 'join', n: 2 });
      }
      for (const n of nodes) routes(ctx, 'setNode', { id: n.id, state: 'set' });
      for (const n of caps) { routes(ctx, 'setNode', { id: n.id, key: 'capUsed', value: true }); routes(ctx, 'setNode', { id: n.id, key: 'capped', value: true }); }
      for (const [itemId, qty] of Object.entries(need)) callAs(ctx, 'construction', 'construction.use', { structId: f, itemId, qty, from: 'stacks' });
      recount(ctx);
      return { ok: true, runs: open.length, nodes: nodes.length, capped: caps.length, covered: runs.length - open.length, used: need };
    }
    if (stage === TRIM) {
      const kinds = new Set(Object.values(classes).flatMap((c) => (c.phases && c.phases.trim) || []));
      let waiting = 0;
      const todo = [];
      for (const id of ids(R.nodes)) {
        const n = R.nodes[id];
        if (n.frame !== f || n.stray || n.state === 'trimmed' || !kinds.has(n.kind) || s.deferred[id]) continue;
        const ends = Object.values(R.runs).filter((r) => (r.a === id || r.b === id) && !s.deferred[r.id] && classes[r.cls]);
        if (!ends.length || ends.some((r) => !runState(r, classes[r.cls]).complete) || (n.state === 'planned' && n.kind !== 'slot')) { waiting++; continue; }
        todo.push(n);
      }
      if (!todo.length) return { ok: false, reason: waiting ? 'rough-in first' : 'nothing to trim', waiting };
      // every device, plate and breaker comes off the stacks: all of it there, or nothing is done
      const need = {};
      for (const n of todo) addTo(need, fullTrimCost(R, n, classes, s.deferred));
      const miss = lack(ctx, f, need);
      if (miss) return miss;
      const panels = new Set();
      for (const n of todo) {
        const ti = trimInfo(R, n, classes, s.deferred);
        if (ti) {
          if (ti.device && !ti.hotOf && !(n.set && n.set.device)) routes(ctx, 'setNode', { id: n.id, key: 'device', value: ti.device });
          if (ti.mate) { routes(ctx, 'setNode', { id: n.id, key: 'mate', value: ti.mate }); routes(ctx, 'setNode', { id: ti.mate, key: 'of', value: n.id }); }
          if (n.kind !== 'slot' && !ti.hotOf) routes(ctx, 'setNode', { id: n.id, key: 'trim', value: { ...ti.units } });
          if (n.kind === 'slot') panels.add(panelKey(n));
        }
        routes(ctx, 'setNode', { id: n.id, state: 'trimmed' });
      }
      useAll(ctx, f, need);
      for (const k of panels) s.mains[k] = true;                             // and the main thrown: it is all done
      for (const m of Object.values(R.nodes)) if (m.kind === 'manifold' && m.frame === f) delete s.valves['n:' + m.id];      // and the water main opened
      recount(ctx);
      return { ok: true, nodes: todo.length, waiting, used: need };
    }
    return { ok: false, reason: 'unknown stage' };
  }
  // "Open this wall": the lining comes off (and the batts behind it), so what is inside can be worked on again
  function openWall(ctx, p = {}) {
    const CN = ctx.get('construction'), pr = CN && CN.progress ? CN.progress[p.structId] : null;
    if (!pr) return { ok: false, reason: 'unknown building' };
    if (!p.host) return { ok: false, reason: 'no wall' };
    const ids = [];
    // the paint, the taped seams and the lining first (every sheet or board on the wall, or an older plan's single piece), then the batts
    for (const id of Object.keys(pr.members).sort()) { const m = pr.members[id]; if ((m.kind === 'joint' || m.kind === 'lining' || m.kind === 'prime' || m.kind === 'paint' || m.kind === 'casing' || m.kind === 'base' || m.kind === 'stool' || m.kind === 'caulk' || id === p.host + '.ln') && m.stage !== 'subfloor' && m.parent === p.host && (m.built || m.got > 0 || m.coat > 0)) ids.push(id); }
    for (const id of Object.keys(pr.members).sort()) { const m = pr.members[id]; if (m.stage === 'insulation' && m.parent === p.host && (m.built || m.got > 0)) ids.push(id); }
    if (!ids.length) return { ok: false, reason: 'nothing covers it' };
    const r = callAs(ctx, 'construction', 'construction.dismantle', { structId: p.structId, memberIds: ids, local: true }) || { ok: false, reason: 'no construction' };
    link(ctx);
    return { ...r, host: p.host };
  }
  return {
    name: 'services', every: 1, init: fresh, step: (ctx) => { compile(ctx); link(ctx); },
    commands: {
      'services.sync': (ctx) => { compile(ctx); link(ctx); return { ok: true, version: ctx.s.version }; },
      'services.note': (ctx, p = {}) => { const s = ensure(ctx), first = !s.notes[p.key]; s.notes[p.key] = true; return { ok: true, first }; },
      'services.defer': defer,
      'services.auto': auto,
      'services.openWall': openWall,
      'services.trim': trim,
      'services.device': device,
      'services.main': main,
      'services.breaker': breaker,
      'services.flip': flip,
      'services.check': check,
      'services.cap': cap,
      'services.valve': valve,
    },
    // for page add-ons (global scripts cannot import): the content tables and the pure read-outs
    api: { classes, specs: SERVICE_SPECS, devices: DEVICES, nodeKinds: NODE_KINDS, compileServices: (R) => compileServices(R, classes), overlayData, runInfo,
      presets: PRESETS_M, routeRule, boreCheck, workCost, runCostLeft, nodeCost, stapleMarks, fixings: FIXINGS, coveredHosts,
      trimInfo: (R, n, deferred) => trimInfo(R, n, classes, deferred), switchControls: (R, id) => switchControls(R, id, classes), circuitWalk: (R, slot) => circuitWalk(R, slot, classes),
      deviceFor, panelKey, waterTrimInfo: (R, n, deferred) => waterTrimInfo(R, n, classes, deferred), mateOf: (R, n) => mateOf(R, n, classes), primaryOf: (R, n) => primaryOf(R, n, classes), waterDeviceFor, waterDevices: WATER_DEVICE, waterTrimText: WATER_TRIM_TEXT, waterTest: WATER_TEST, breakerFor: (R, id) => breakerFor(R, id, classes), deviceItems: DEVICE_ITEM, trimText: TRIM_TEXT, isLight: deviceIsLight },
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
    return { id, kind: n.kind, frame: n.frame, state: n.state, device: n.set && n.set.device, tripped: !!(br && br.tripped), on: !(n.set && n.set.on === false) };
  });
  return { runs, nodes };
}

// The hosts (walls, ceilings) of a run whose lining is on: what "Open this wall" takes off to get at it.
export function coveredHosts(state, runId) {
  const R = state && state.sys ? state.sys.routes : null, CN = state && state.sys ? state.sys.construction : null, run = R && R.runs[runId];
  const pr = run && CN && CN.progress && run.frame != null ? CN.progress[run.frame] : null;
  return pr ? (run.hosts || []).filter((h) => builtLining(pr, h)) : [];
}
