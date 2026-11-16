// The starter plumbing kit: the part kinds for the parts mechanism (src/sim/core/parts.js), which end types
// mate, and what a kit holds. One material and one bore: 25 mm poly (pipe_poly_25 in the water catalog).
// Lattice step 0.25 m, so a 1.5 m stock length is 6 steps.

const E = (id, type, at, dir) => ({ id, type, at, dir });
export const PLUMBING_STEP_M = 0.25;
export const PLUMBING_PIPE = 'pipe_poly_25';
export const PLUMBING_KINDS = Object.freeze({
  // a plain length: both ends push into fittings. Cuts shorter in 0.25 m steps; never longer than its stock.
  pipe: { id: 'pipe', name: 'Pipe', ends: [E('a', 'spigot', [0, 0, 0], [-1, 0, 0]), E('b', 'spigot', [1, 0, 0], [1, 0, 0])], stretch: { min: 1, max: 6, end: 'b' } },
  elbow: { id: 'elbow', name: 'Elbow', ends: [E('a', 'socket', [0, 0, 0], [1, 0, 0]), E('b', 'socket', [0, 0, 0], [0, 1, 0])], equivD: 30 },
  tee: { id: 'tee', name: 'Tee', ends: [E('a', 'socket', [0, 0, 0], [1, 0, 0]), E('b', 'socket', [0, 0, 0], [-1, 0, 0]), E('c', 'socket', [0, 0, 0], [0, 1, 0])], equivD: 60 },
  valve: { id: 'valve', name: 'Shutoff valve', ends: [E('a', 'socket', [0, 0, 0], [1, 0, 0]), E('b', 'socket', [0, 0, 0], [-1, 0, 0])], set: { open: false }, equivD: 3 },
  coupling: { id: 'coupling', name: 'Coupling', ends: [E('a', 'socket', [0, 0, 0], [1, 0, 0]), E('b', 'socket', [0, 0, 0], [-1, 0, 0])], equivD: 2 },
  cap: { id: 'cap', name: 'End cap', ends: [E('a', 'socket', [0, 0, 0], [1, 0, 0])] },
  // where equipment takes a pipe: placed by the game, fixed. ref = { piece, port } of the fixture it stands for.
  port: { id: 'port', name: 'Connection', ends: [E('a', 'port', [0, 0, 0], [1, 0, 0])], anchor: true, thin: true },
});
// a plain pipe end pushes into a fitting; equipment takes either
export const PLUMBING_MATES = Object.freeze({ spigot: ['socket', 'port'], socket: ['spigot', 'port'], port: ['spigot', 'socket'] });
export const STARTER_KIT = Object.freeze([['pipe', 4], ['elbow', 4], ['tee', 1], ['valve', 1], ['coupling', 2], ['cap', 1]]);

// The yard every new plot starts with, laid out on the parts lattice around (ox, oy, oz): a dug well with a
// hand pump on its cover, a barrel on a 1.5 m stand with the pump already piped into its top, a capped outlet
// at the barrel's foot, a tap on a post about 3 m off around the well, and a workbench with the kit on it.
// Returns plain data; the page places the fixtures and anchors from it. Lattice numbers are steps of 0.25 m.
// The kit's 6 m of pipe reaches from the outlet to the tap with half a metre to spare: 1 step out, 5 down,
// 14 along the ground around the well in an L, 2 up the post.
export function starterYard(ox, oy, oz) {
  const s = PLUMBING_STEP_M, at = (i, j, k) => ({ x: ox + i * s, y: oy + j * s, z: oz + k * s });
  return {
    origin: { x: ox, y: oy, z: oz, yaw: 0 },
    fixtures: [
      { key: 'well', fixture: 'well_dug', ...at(0, 0, 0), settings: { viewOwned: true } },
      { key: 'pump', fixture: 'hand_pump', ...at(0, 3, 0), settings: { viewOwned: true, manual: true } },
      { key: 'barrel', fixture: 'rain_barrel_200', ...at(5, 6, 0), settings: { viewOwned: true } },
      { key: 'tap', fixture: 'tap_hose_bib', ...at(-3, 3, 9), settings: { viewOwned: true } },
    ],
    // fixed parts: x = where local +x points, y = where local +y points (see rotationTo)
    anchors: [
      { id: 'y:well', kind: 'port', at: [0, 2, 0], x: [0, 1, 0], ref: ['well', 'out'] },
      { id: 'y:suck', kind: 'pipe', len: 1, at: [0, 2, 0], x: [0, 1, 0] },
      { id: 'y:pin', kind: 'port', at: [0, 3, 0], x: [0, -1, 0], ref: ['pump', 'in'] },
      { id: 'y:pout', kind: 'port', at: [1, 4, 0], x: [0, 1, 0], ref: ['pump', 'out'] },
      { id: 'y:rise', kind: 'pipe', len: 5, at: [1, 4, 0], x: [0, 1, 0] },
      { id: 'y:bend', kind: 'elbow', at: [1, 9, 0], x: [1, 0, 0], y: [0, -1, 0] },
      { id: 'y:over', kind: 'pipe', len: 3, at: [1, 9, 0], x: [1, 0, 0] },
      { id: 'y:bin', kind: 'port', at: [4, 9, 0], x: [-1, 0, 0], ref: ['barrel', 'in'] },
      { id: 'y:bout', kind: 'port', at: [5, 6, 2], x: [0, 0, 1], ref: ['barrel', 'out'] },
      { id: 'y:tap', kind: 'port', at: [-3, 3, 9], x: [0, -1, 0], ref: ['tap', 'in'] },
    ],
    bench: { ...at(11, 0, 8), yaw: 0, w: 1.6, d: 0.7, h: 0.85 },
    levelRadiusM: 6,
  };
}
