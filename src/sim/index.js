// Entry point for the simulation. The page and the headless tests both build the game's
// simulation through createGameSim, so they always run the same systems in the same order.

import { createSim } from './sim.js';
import { stockSystem } from './stock.js';
import { weather } from './weather.js';
import { siteSystem } from './site.js';
import { water } from './water.js';
import { garden } from './garden.js';

export * from './sim.js';
export * from './time.js';
export * from './save.js';
export { stream, hashString } from './rng.js';
export * from './materials.js';
export * from './items.js';
export * from './stock.js';
export * as calendar from './calendar.js';
export { weather, CLIMATES, conditionWord } from './weather.js';
export * from './site.js';
export { water, overlayData as waterOverlay, freshStoredL } from './water.js';
export * from './fixtures-water.js';
export { garden, almanac, plantInfo, bedSummary, cellInfo, frostDates, sowAdvice, frostTonight, rotationHint, nitrogenTotal, storedWaterL, CELL_M, CAN_L } from './garden.js';
export { CROPS, CROP_IDS } from './content/crops.js';
export { SOILS, AMENDMENTS, MULCH } from './content/soils.js';
export { ITEMS_GARDEN } from './content/garden-items.js';

// Systems are added here, in dependency order, as the iterations land (thermal, power...).
export const GAME_SYSTEMS = [weather, stockSystem(), siteSystem(), water, garden];

export function createGameSim(seed, opts = {}) {
  return createSim({ seed, systems: GAME_SYSTEMS, ...opts });
}

export const SPEEDS = [0, 1, 10, 100, 1000];
// At 1x one world day takes 20 real minutes.
export const WORLD_SECONDS_PER_REAL_SECOND = 86400 / 1200;
