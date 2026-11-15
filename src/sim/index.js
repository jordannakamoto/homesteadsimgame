// Entry point for the simulation. The page and the headless tests both build the game's
// simulation through createGameSim, so they always run the same systems in the same order.

import { createSim } from './sim.js';

export * from './sim.js';
export * from './time.js';
export * from './save.js';
export { stream, hashString } from './rng.js';

// Systems are added here, in dependency order, as the iterations land (weather, thermal, power...).
export const GAME_SYSTEMS = [];

export function createGameSim(seed, opts = {}) {
  return createSim({ seed, systems: GAME_SYSTEMS, ...opts });
}

export const SPEEDS = [0, 1, 10, 100, 1000];
// At 1x one world day takes 20 real minutes.
export const WORLD_SECONDS_PER_REAL_SECOND = 86400 / 1200;
