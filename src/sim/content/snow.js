// Snow: the numbers. Everything the generic deposit (core/snowfield.js) is told, and the system (snow.js) needs.
// Units: lengths m, water equivalent mm (cells hold micrometres of water), densities kg/m3, times s.

export const RHO_PACKED = 450;                       // what trodden, driven-on or wind-slabbed snow comes to
// bearing densities: the density at which a presser no longer sinks (boot 330, tyre 400, hoof or small animal 200, sled 250)
export const RHO_BEAR = Object.freeze({ boot: 330, tyre: 400, hoof: 200, sled: 250 });
export const NEW_DENSITY = 100;                      // weather's new-snow density, for the debug storm

export const GRID = Object.freeze({ step: 0.5, T: 32 });   // 0.5 m cells, tiles of 32 x 32 (16 m)
export const ACTIVE_R = 40;                          // m from the focus: tiles this close are stepped
export const DROP_R = 72;                            // m: farther tiles are dropped unless worked by hand or wheel
export const MAX_TREES = 3000;

export const DDF = 3.5 / 86400;                      // mm per C per s: the weather's degree-day factor, for melt once the reference pack is bare

// Canopy interception (Hedstrom and Pomeroy). Fractions of the fall.
export const CANOPY = Object.freeze({
  evergreenCatch: 0.45, evergreenWell: 0.8, wellR: 0.3,   // fall lost under a crown; at its deepest in the tree well (within 0.3 R)
  edgeFrac: 0.75,                                          // crown coverage is 1 inside this fraction of the radius, fading to 0 at R
  decidCatch: 0.08,                                        // bare deciduous crowns
  ringLo: 0.6, ringHi: 1.0,                                // unloaded snow lands between these fractions of R, peaking between them
  gain: 0.45, capMm: 6,                                    // store gains 0.45 of the fall, saturating at 6 mm
  tauCalm: 2 * 86400, tauWindy: 6 * 3600, windyMs: 6, tauWarm: 3 * 3600,
  sublimated: 0.25, eventMm: 0.3,
});

export const FRESH_TAU = 1.5 * 86400;                // erodible layer of the reference pack

// Melt factors per cell (level open ground is 1)
export const MELT = Object.freeze({
  base: 0.6, sun: 0.4, evergreen: 0.7, southOfWall: 1.25, southReach: 1.5, northOfWall: 0.75, northReach: 3,
  sunDay: 59, wallMinH: 1.0, sideCos: 0.5, floorAbove: 1.2,
});

// Wind transport (Winstral's shelter index; Li and Pomeroy's threshold)
export const WIND = Object.freeze({
  every: 3,                                            // steps between passes
  utC: [9.43, 0.18, 0.0033], freshMinMm: 0.05,
  dists: [1, 2, 3, 4, 6, 8, 12], sxFull: 0.25, eMax: 1.5,
  pick: 0.02, pickCap: 0.5,                            // mm/h per (m/s)^2 at exposure 1; at most half the erodible layer
  hops: 12, settleBase: 0.08, settleGain: 0.9,
  over: 0.5, reach: 8,                                 // share of a load that clears an obstacle, and how far it can fly doing so (cells)
  slab: 0.35,                                          // share of what settles that is wind slab (packed)
});

// Hand and machine work
export const TOOLS = Object.freeze({
  repose: 1.0,                                         // 45 degrees
  movePacked: 0.5, windrowPacked: 0.6, windrowReach: 0.6,
  maxPts: 512, maxTreadR: 5, maxMoveR: 3, maxPlaceR: 5, maxPushW: 20, maxPushLen: 60,
});
