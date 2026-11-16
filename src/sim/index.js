// Entry point for the simulation. The page and the headless tests both build the game's
// simulation through createGameSim, so they always run the same systems in the same order.

import { createSim } from './sim.js';
import { stockSystem } from './stock.js';
import { weather } from './weather.js';
import { siteSystem } from './site.js';
import { physicalKitchenSystem } from './physical-kitchen.js';
import { cookingSystem } from './cooking.js';
import { water } from './water.js';
import { electrical } from './electrical.js';
import { thermal } from './thermal.js';
import { chickensSystem } from './chickens.js';
import { structure } from './structure.js';
import { garden } from './garden.js';
import { createPartsSystem } from './core/parts.js';
import { plumbingSystem } from './plumbing.js';
import { PLUMBING_KINDS, PLUMBING_MATES, PLUMBING_STEP_M, PLUMBING_PIPE, STARTER_KIT } from './content/plumbing-parts.js';

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
export { electrical, powerAvailableAt, overlayData as electricalOverlay, FIXTURES_ELECTRICAL, WIRE_GAUGES, wireSpec } from './electrical.js';
export { garden, gardenSteps, gardenRead, almanac, plantInfo, plantStatus, coldestNightC, bedSummary, cellInfo, frostDates, sowAdvice, frostTonight, rotationHint, nitrogenTotal, storedWaterL, CELL_M, CAN_L } from './garden.js';
export { CROPS, CROP_IDS } from './content/crops.js';
export { SOILS, AMENDMENTS, MULCH } from './content/soils.js';
export { ITEMS_GARDEN } from './content/garden-items.js';
export { findRooms, roomAt, compassName } from './rooms.js';
export { thermal, assemblyR, uValue, innerMass, roomModels, roomIdAt, overlayData as thermalOverlayData } from './thermal.js';
export { chickensSystem, BREEDS, FIXTURES_CHICKENS, ITEMS_CHICKENS, ITEM_CATEGORIES_CHICKENS, overlayData as chickensOverlayData } from './chickens.js';
export * as animals from './animals.js';
export { structure, solveStructure, environment as structureEnvironment, overlayData as structureOverlayData, swayNow, designValues, analyseBeam, joistCheck, maxSpan, columnCapacity, designSnowKPa, SOILS as GROUND_SOILS } from './structure.js';
export * from './fixtures.js';
export { createPartsSystem, ROTATIONS as PART_ROTATIONS, rotationTo } from './core/parts.js';
export { plumbingSystem, compilePlumbing } from './plumbing.js';
export * from './content/plumbing-parts.js';

// Systems are added here, in dependency order, as the iterations land. Electrical runs before water
// so a pump's request for power is answered in the same minute; the garden runs after water, whose draws it uses.
// Kit parts fitted by hand (generic), then plumbing, which compiles them for water, which runs after both.
const partsSystem = createPartsSystem({ name: 'parts', stepM: PLUMBING_STEP_M, kinds: PLUMBING_KINDS, mates: PLUMBING_MATES });
const plumbing = plumbingSystem({ kinds: PLUMBING_KINDS, mates: PLUMBING_MATES, stepM: PLUMBING_STEP_M, material: PLUMBING_PIPE, kit: STARTER_KIT });
export const GAME_SYSTEMS = [weather, stockSystem(), siteSystem(), structure, electrical, partsSystem, plumbing, water, thermal, cookingSystem(), chickensSystem(), physicalKitchenSystem(), garden];

export function createGameSim(seed, opts = {}) {
  return createSim({ seed, systems: GAME_SYSTEMS, ...opts });
}

export const SPEEDS = [0, 1, 10, 100, 1000];
// At 1x one world day takes 20 real minutes.
export const WORLD_SECONDS_PER_REAL_SECOND = 86400 / 1200;
