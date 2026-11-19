// Services S4: build mode's Equip wires and pipes in an old save become runs in the routes store, keeping their ids,
// so electrical.wires, water.pipes and breaker state carry over and the flows match after one tick.
// The fixture is a recorded version 3 save (a generator, a breaker panel with a breaker, an outlet and a light; a
// battery and inverter with a light; a tote feeding an open hose bib; and a flue link that stays in build mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, readSave, SAVE_VERSION, isLegacyLink, legacyLinkCommands, legacyPrune, convertLegacyLinks } from '../src/sim/index.js';

const raw = readFileSync(new URL('./fixtures/save-v3-equip-links.json', import.meta.url), 'utf8');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} +- ${tol}, got ${a}`);

function loaded() {
  const save = readSave(raw), sim = createGameSim(save.sim.seed);
  sim.load(save.sim);
  return { save, sim };
}
// What the page does once build mode has the links (engine.js syncSite): build mode's legacyLinks() gives each link with
// its routed points and length; the site loses the link pieces and the routes gain the runs.
function migrate(sim, save) {
  const site = sim.state.sys.site.pieces, byId = new Map(site.map((p) => [p.id, p]));
  const links = save.world.builds.links.filter(isLegacyLink).map((l) => {
    const p = byId.get(l.id);
    return { ...l, lengthM: p.lengthM, pts: [[p.a.x, p.y0, p.a.z], [p.a.x, p.y0, p.b.z], [p.b.x, p.y0, p.b.z]] };
  });
  const res = convertLegacyLinks(sim, links);
  const gone = new Set(res.ids);
  sim.commandNow('site.setPieces', { pieces: site.filter((p) => !gone.has(p.id)) });
  return res;
}

test('a version 3 save with Equip links is marked on load; flue links are not legacy', () => {
  const save = readSave(raw);
  assert.equal(SAVE_VERSION, 4);
  assert.equal(save.v, 4);
  assert.equal(save.world.legacyLinks, true);
  const links = save.world.builds.links;
  assert.deepEqual(links.filter(isLegacyLink).map((l) => l.id), ['p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17']);
  assert.ok(!isLegacyLink(links.find((l) => l.id === 'p18')), 'a 150 mm flue stays a build mode link');
});

test('old links become legacy runs: same wire and pipe keys, breaker state and flows within rounding after one tick', () => {
  const before = loaded(), after = loaded();
  before.sim.runTicks(1);
  const res = migrate(after.sim, after.save);
  assert.equal(res.refused.length, 0, JSON.stringify(res.refused));
  assert.equal(res.ids.length, 7);
  after.sim.runTicks(1);
  const E0 = before.sim.state.sys.electrical, E1 = after.sim.state.sys.electrical, W0 = before.sim.state.sys.water, W1 = after.sim.state.sys.water;
  assert.deepEqual(Object.keys(E1.wires).sort(), Object.keys(E0.wires).sort(), 'electrical.wires keeps its keys');
  assert.deepEqual(Object.keys(W1.pipes).sort(), Object.keys(W0.pipes).sort(), 'water.pipes keeps its keys');
  assert.ok(!after.sim.state.sys.site.pieces.some((p) => p.kind === 'wire' || (p.kind === 'pipe' && p.diameterMm < 100)), 'the links left the site pieces');
  for (const id of Object.keys(E0.wires)) {
    const a = E0.wires[id], b = E1.wires[id];
    assert.equal(b.gauge, a.gauge, id + ' gauge'); near(b.lengthM, a.lengthM, 1e-9, id + ' length');
    assert.equal(b.from, a.from, id + ' from'); assert.equal(b.to, a.to, id + ' to');
    near(b.currentA, a.currentA, 1e-3, id + ' current'); near(b.lossW, a.lossW, 1e-3, id + ' loss');
  }
  assert.ok(E0.wires.p13.currentA > 4, 'the outlet circuit carries current: ' + E0.wires.p13.currentA);
  assert.deepEqual(Object.keys(E1.breakers), Object.keys(E0.breakers));
  near(E1.breakers.p3.currentA, E0.breakers.p3.currentA, 1e-3, 'breaker current');
  for (const id of Object.keys(E0.loads)) near(E1.loads[id].drawW, E0.loads[id].drawW, 1e-6, id + ' draw');
  for (const id of Object.keys(W0.pipes)) near(W1.pipes[id].flowLmin, W0.pipes[id].flowLmin, 1e-3, id + ' flow');
  assert.ok(W0.pipes.p17.flowLmin > 1, 'the tap runs');
  near(W1.tanks.p9.storedL, W0.tanks.p9.storedL, 1e-3, 'tank level');
  // the runs are legacy, done, world-frame, and carry the link's length
  const R = after.sim.state.sys.routes;
  for (const id of res.ids) { const r = R.runs[id]; assert.ok(r.legacy && r.state === 'done' && r.frame === null && r.props.linkId === id, id); }
  near(R.runs.p11.lengthM, 4.62, 1e-9);
  assert.equal(R.nodes['lg:p4:power'].ref.piece, 'p4');
  assert.equal(Object.keys(R.nodes).filter((k) => k === 'lg:p4:power').length, 1, 'two links at one port share its node');
});

test('a tripped breaker stays tripped across the conversion, and resets by its own id', () => {
  const { sim, save } = loaded();
  const E = sim.state.sys.electrical;
  E.breakers.p3.tripped = true; E.topoKey = 'p3||';                      // as electrical leaves it when the breaker trips
  migrate(sim, save);
  sim.runTicks(1);
  assert.equal(sim.state.sys.electrical.breakers.p3.tripped, true);
  assert.equal(sim.state.sys.electrical.loads.p4.drawW, 0, 'the outlet is dark behind the tripped breaker');
  sim.commandNow('electrical.resetBreaker', { id: 'p3' });
  sim.runTicks(1);
  near(sim.state.sys.electrical.loads.p4.drawW, 600, 1e-6);
});

test('the conversion is idempotent, refuses a second run between the same ports, and prunes runs whose equipment is gone', () => {
  const { sim, save } = loaded();
  migrate(sim, save);
  const R = sim.state.sys.routes, v = R.version;
  assert.equal(legacyLinkCommands(R, { id: 'p11', kind: 'wire', from: { piece: 'p1', port: 'ac' }, to: { piece: 'p2', port: 'main' } }).cmds.length, 0, 'already converted');
  const dup = legacyLinkCommands(R, { id: 'p99', kind: 'wire', from: { piece: 'p2', port: 'main' }, to: { piece: 'p1', port: 'ac' } });
  assert.equal(dup.ok, false); assert.match(dup.reason, /already joined/);
  assert.equal(R.version, v);
  // the tote is taken away: its pipe goes, and the tap's port node with it
  const ids = new Set(sim.state.sys.site.pieces.filter((p) => p.id !== 'p9').map((p) => p.id));
  const cmds = legacyPrune(R, ids);
  assert.deepEqual(cmds.map((c) => c[0] + ' ' + c[1].id), ['routes.removeRun p17', 'routes.removeNode lg:p10:in', 'routes.removeNode lg:p9:out']);
  for (const [n, p] of cmds) assert.notEqual(sim.commandNow(n, p).ok, false);
  sim.runTicks(1);
  assert.equal(sim.state.sys.water.pipes.p17, undefined);
  assert.equal(legacyPrune(R, ids).length, 0, 'nothing left to prune');
});
