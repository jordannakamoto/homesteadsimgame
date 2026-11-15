// Pieces for headless tests. house() is a real small house captured from the game as the simulation
// sees it (refresh with: DUMP_HOUSE=test/helpers/house.json node test/build.smoke.mjs): a 5 x 4 m timber
// room with a door, a window, a floor on a stone foundation and a thatched gable roof.
import { readFileSync } from 'node:fs';

export const house = () => JSON.parse(readFileSync(new URL('./house.json', import.meta.url), 'utf8'));

// Put pieces into a simulation the way the page does.
export function setSite(sim, pieces) { sim.commandNow('site.setPieces', { pieces }); return sim.state.sys.site; }

// A fixture piece (equipment that is not part of the building fabric). See ARCHITECTURE.md.
let n = 0;
export function fixture(fixtureId, { x = 0, z = 0, y = 0, yawRad = 0, settings = {}, ports = [], id } = {}) {
  return { id: id || 'f' + ++n, kind: 'fixture', fixture: fixtureId, a: { x, z }, b: { x, z }, y0: y, y1: y, yawRad, settings, ports };
}
// A wire or pipe run between two fixture ports.
export function link(kind, from, fromPort, to, toPort, extra = {}) {
  return { id: 'l' + ++n, kind, from: { piece: from.id, port: fromPort }, to: { piece: to.id, port: toPort }, lengthM: 5, ...extra };
}
