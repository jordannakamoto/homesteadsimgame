// Legacy Equip links: the wires and pipes build mode's Equip tool ran straight from port to port (FX.links in
// src/build.js) become runs in the routes store (src/sim/core/routes.js), so the player has one connection model.
// A link becomes two nodes bound to the fixture ports (one node per port, shared by every link at that port) and one
// run with the link's path and length, `legacy: true`, already done. The run keeps the link's id (run id and
// props.linkId), and services compiles it back to a wire or pipe piece of that same id, so electrical.wires,
// water.pipes and breaker state carry over (src/sim/services.js).
//
// The lengths are build mode's (linkRoute): a pure save migration cannot work them out, so the page converts the
// links once build mode has loaded them (src/engine.js syncSite). This file is the pure part, testable headless.
//
// INTERFACE
//   isLegacyLink(link) -> bool                         a power wire or a water pipe (a flue stays in build mode)
//   legacyLinkCommands(R, link) -> { ok, id, cmds: [[name, payload]] } | { ok: false, reason }
//       link: { id, kind: 'wire' | 'pipe', from: { piece, port }, to, material?, gauge? | diameterMm?, pts?, lengthM }
//       R: the routes state (to reuse port nodes and refuse a second run between the same two ports)
//   legacyPrune(R, pieceIds) -> [[name, payload]]       legacy runs and port nodes whose equipment is gone
//   convertLegacyLinks(sim, links) -> { ids, refused }   issues the commands with sim.commandNow

export const LEGACY_NODE = 'lg:';
export const legacyNodeId = (end) => LEGACY_NODE + end.piece + ':' + end.port;

export function isLegacyLink(ln) {
  if (!ln || !ln.from || !ln.to) return false;
  if (ln.kind === 'wire') return true;
  return ln.kind === 'pipe' && !(+ln.diameterMm >= 100);              // a pipe of 100 mm and up is a flue
}

const vec = (p) => (Array.isArray(p) && p.length === 3 && p.every((v) => Number.isFinite(+v)) ? p.map((v) => +v) : null);

export function legacyLinkCommands(R, ln) {
  if (!isLegacyLink(ln)) return { ok: false, reason: 'not a wire or water pipe' };
  if (ln.id == null) return { ok: false, reason: 'no id' };
  const id = String(ln.id), runs = (R && R.runs) || {}, nodes = (R && R.nodes) || {};
  if (runs[id]) return { ok: true, id, cmds: [], already: true };
  const a = legacyNodeId(ln.from), b = legacyNodeId(ln.to);
  if (a === b) return { ok: false, reason: 'A piece cannot be joined to itself.' };
  for (const r of Object.values(runs)) if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return { ok: false, reason: 'These two ports are already joined.' };
  const pts = Array.isArray(ln.pts) ? ln.pts.map(vec).filter(Boolean) : [];
  const ends = { a: pts[0] || [0, 0, 0], b: pts[pts.length - 1] || pts[0] || [0, 0, 0] };
  const cmds = [];
  for (const [nid, end, at] of [[a, ln.from, ends.a], [b, ln.to, ends.b]]) {
    if (!nodes[nid]) cmds.push(['routes.addNode', { id: nid, kind: 'port', frame: null, at, ref: { piece: end.piece, port: end.port }, state: 'set' }]);
  }
  const wire = ln.kind === 'wire', props = { linkId: id, material: ln.material || 'copper' };
  if (wire) props.gauge = ln.gauge != null ? ln.gauge : 12;
  else props.diameterMm = +ln.diameterMm || 19;
  cmds.push(['routes.addRun', { id, cls: wire ? 'cable' : 'supply', spec: null, frame: null, a, b, path: pts.length >= 2 ? pts : [], lengthM: +ln.lengthM || 0, legacy: true, state: 'done', props }]);
  return { ok: true, id, cmds };
}

// Equipment taken away: its legacy runs go with it (as its links did in build mode), and a legacy port node left with
// no run is taken out too.
export function legacyPrune(R, pieceIds) {
  const cmds = [], gone = (n) => !!(n && n.ref && n.id.startsWith(LEGACY_NODE) && !pieceIds.has(n.ref.piece));
  if (!R) return cmds;
  const dropped = new Set();
  for (const id of Object.keys(R.runs).sort()) {
    const r = R.runs[id];
    if (r.legacy && (gone(R.nodes[r.a]) || gone(R.nodes[r.b]))) { cmds.push(['routes.removeRun', { id }]); dropped.add(id); }
  }
  for (const id of Object.keys(R.nodes).sort()) {
    const n = R.nodes[id];
    if (!id.startsWith(LEGACY_NODE) || !n.ref) continue;
    const used = Object.values(R.runs).some((r) => !dropped.has(r.id) && (r.a === id || r.b === id));
    if (!used) cmds.push(['routes.removeNode', { id }]);
  }
  return cmds;
}

export function convertLegacyLinks(sim, links) {
  const ids = [], refused = [];
  for (const ln of links || []) {
    const c = legacyLinkCommands(sim.state.sys.routes, ln);
    if (!c.ok) { refused.push({ id: ln.id, reason: c.reason }); continue; }
    let ok = true;
    for (const [name, p] of c.cmds) { const r = sim.commandNow(name, p); if (r && r.ok === false) { ok = false; refused.push({ id: ln.id, reason: r.reason }); break; } }
    if (ok) ids.push(c.id);
  }
  return { ids, refused };
}
