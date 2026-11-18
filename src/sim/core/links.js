// Links: a generic compiler from a graph of joined things to point-to-point links between its terminals.
// It knows nothing about what flows. Content builds the graph (from kit parts, from routes in a building,
// from anything) and turns the result into whatever pieces its solver reads.
//
// INTERFACE
//   compileLinks(graph, rules?) -> { links, open, reach, walks }   pure; same input, same output, same order
//     graph = {
//       terminals: [{ id, ref? }],                 // walks start here (sorted by id, so order never matters)
//       edges:     [{ a, b, lengthM?, ...any }],    // undirected; adjacency keeps this order
//       joints:    { [id]: { lengthM?, blocked?, stop?, ...any } },  // cost of entering a node; blocked: a
//                                                  // closed gate on the way; stop: a walk ends here and reports it
//                                                  // as reached, like a terminal it does not start from
//       openEnds:  [{ at, ...any }] }               // a loose end at node `at` (an uncapped stub, a free socket)
//     rules = { start?(terminal) -> acc, sum?(acc, { from, to, edge, joint }) -> acc }   // a content reducer
//   Each walk goes breadth first from a terminal through the nodes, never through another terminal or stop.
//   Best way to each node: fewest blocked joints, then shortest; on a tie the first found stays.
//   walks: [{ terminal, reaches: [ids], blocked: [joint ids], found: [record] }] in terminal order; `found` is
//          every link and open record of that walk in the order it was found (to rebuild pieces in a stable order)
//   links: [{ type: 'link', a, b, lengthM, acc, blocked: [ids], via: [node ids between] }], one per pair: between
//          two terminals from the lower id's walk (a < b); to a stop, from every terminal that reaches it
//   open:  [{ type: 'open', from, at, end, lengthM, acc }]   an open end reachable with no blocked joint
//   reach: { [terminalId]: walk }
//   A node only reachable through a blocked joint is dry: its open ends are not reported.

export function compileLinks(graph, rules = {}) {
  const terminals = (graph.terminals || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const joints = graph.joints || {}, isTerm = new Set(terminals.map((t) => t.id));
  const adj = new Map();
  for (const e of graph.edges || []) {
    if (e.a === e.b) continue;
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ other: e.b, edge: e });
    adj.get(e.b).push({ other: e.a, edge: e });
  }
  const openAt = new Map();
  for (const o of graph.openEnds || []) { if (!openAt.has(o.at)) openAt.set(o.at, []); openAt.get(o.at).push(o); }
  const ends = (id) => isTerm.has(id) || !!(joints[id] && joints[id].stop);
  const sum = rules.sum || ((acc) => acc);
  const links = [], open = [], reach = {}, walks = [];

  for (const T of terminals) {
    const best = new Map([[T.id, { lengthM: 0, acc: rules.start ? rules.start(T) : null, blocked: [], via: [] }]]);
    let frontier = [T.id];
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        if (id !== T.id && ends(id)) continue;                          // another terminal: the walk ends there
        const cur = best.get(id);
        for (const ln of adj.get(id) || []) {
          const j = joints[ln.other] || {};
          const blocked = j.blocked ? [...cur.blocked, ln.other] : cur.blocked;
          const cand = { lengthM: cur.lengthM + (ln.edge.lengthM || 0) + (j.lengthM || 0), acc: sum(cur.acc, { from: id, to: ln.other, edge: ln.edge, joint: j }),
            blocked, via: [...cur.via, ln.other] };
          const had = best.get(ln.other);
          if (had && (had.blocked.length < cand.blocked.length || (had.blocked.length === cand.blocked.length && had.lengthM <= cand.lengthM))) continue;
          best.set(ln.other, cand); next.push(ln.other);
        }
      }
      frontier = next;
    }
    const walk = { terminal: T.id, reaches: [], blocked: [], found: [] };
    for (const [id, r] of best) {
      if (id === T.id) continue;
      if (ends(id)) {
        walk.reaches.push(id);
        for (const v of r.blocked) if (!walk.blocked.includes(v)) walk.blocked.push(v);
        if (T.id < id || !isTerm.has(id)) {                             // a stop never walks: link it from here
          const L = { type: 'link', a: T.id, b: id, lengthM: r.lengthM, acc: r.acc, blocked: r.blocked, via: r.via.slice(0, -1) };
          links.push(L); walk.found.push(L);
        }
        continue;
      }
      if (r.blocked.length) continue;                                   // dry beyond a blocked joint
      for (const o of openAt.get(id) || []) {
        const O = { type: 'open', from: T.id, at: id, end: o, lengthM: r.lengthM, acc: r.acc };
        open.push(O); walk.found.push(O);
      }
    }
    walks.push(walk); reach[T.id] = walk;
  }
  return { links, open, reach, walks };
}
