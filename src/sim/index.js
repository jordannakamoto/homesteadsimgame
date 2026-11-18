// Entry point for the simulation. The page and the headless tests both build the game's
// simulation through createGameSim, so they always run the same systems in the same order.

import { createSim } from './sim.js';
import { stockSystem } from './stock.js';
import { weather } from './weather.js';
import { streams } from './streams.js';
import { siteSystem } from './site.js';
import { physicalKitchenSystem } from './physical-kitchen.js';
import { cookingSystem } from './cooking.js';
import { water } from './water.js';
import { electrical } from './electrical.js';
import { thermal } from './thermal.js';
import { chickensSystem } from './chickens.js';
import { constructionSystem } from './construction.js';
import { structure } from './structure.js';
import { garden } from './garden.js';
import { landscape } from './landscape.js';
import { groundSystem } from './ground.js';
import { FLAG as LANDSCAPE_FLAG } from './content/landscape.js';
import { createPartsSystem } from './core/parts.js';
import { createRoutesSystem } from './core/routes.js';
import { services, servicesGuard } from './services.js';
import { SERVICE_CLASSES } from './content/services.js';
import { plumbingSystem } from './plumbing.js';
import { createVehicleSystem } from './core/vehicles.js';
import { VEHICLE_KINDS, IMPLEMENT_KINDS, VEHICLE_HOOKS } from './content/vehicles.js';
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
export { streams, streamLook } from './streams.js';
export * from './site.js';
export { water, overlayData as waterOverlay, freshStoredL } from './water.js';
export * from './fixtures-water.js';
export { electrical, powerAvailableAt, powerNear, overlayData as electricalOverlay, FIXTURES_ELECTRICAL, WIRE_GAUGES, wireSpec } from './electrical.js';
export { garden, gardenSteps, gardenRead, almanac, plantInfo, plantStatus, coldestNightC, bedSummary, cellInfo, frostDates, sowAdvice, frostTonight, rotationHint, nitrogenTotal, storedWaterL, CELL_M, CAN_L } from './garden.js';
export { CROPS, CROP_IDS } from './content/crops.js';
export { landscape, landscapeRead, reliefAt, plantSize } from './landscape.js';
export { SURFACES, THINGS, PLANTS as NURSERY, SCOOP_M3, SCOOP_SCALES, ITEMS_LANDSCAPE } from './content/landscape.js';
export * as earthwork from './core/earthwork.js';
export { groundSystem, groundRead, setGroundBase } from './ground.js';
export { SOILS, AMENDMENTS, MULCH } from './content/soils.js';
export { ITEMS_GARDEN } from './content/garden-items.js';
export { findRooms, roomAt, compassName } from './rooms.js';
export { thermal, assemblyR, uValue, innerMass, roomModels, roomIdAt, overlayData as thermalOverlayData } from './thermal.js';
export { chickensSystem, BREEDS, FIXTURES_CHICKENS, ITEMS_CHICKENS, ITEM_CATEGORIES_CHICKENS, overlayData as chickensOverlayData } from './chickens.js';
export * as animals from './animals.js';
export { constructionSystem, CONSTRUCTION_CATALOG, buildingView as constructionView } from './construction.js';
export { ITEMS_CONSTRUCTION } from './content/construction.js';
export * as supply from './core/supply.js';
export { structure, solveStructure, environment as structureEnvironment, overlayData as structureOverlayData, swayNow, designValues, analyseBeam, joistCheck, maxSpan, columnCapacity, designSnowKPa, SOILS as GROUND_SOILS } from './structure.js';
export * from './fixtures.js';
export { createPartsSystem, ROTATIONS as PART_ROTATIONS, rotationTo } from './core/parts.js';
export { compileLinks } from './core/links.js';
export { createRoutesSystem, runState as routeRunState, toNeutral as routesToNeutral, worldOf as routeWorldOf, pathLength } from './core/routes.js';
export { plumbingSystem, compilePlumbing } from './plumbing.js';
export * from './content/plumbing-parts.js';
export { services, servicesSystem, compileServices, servicesGuard, runInfo as serviceRunInfo, overlayData as servicesOverlay } from './services.js';
export { SERVICE_CLASSES, SERVICE_SPECS, NODE_KINDS as SERVICE_NODE_KINDS, DEVICES as SERVICE_DEVICES, FIXTURES_SERVICES, PRESETS_M as SERVICE_PRESETS_M } from './content/services.js';
export * as vehicleCore from './core/vehicles.js';
export { VEHICLE_KINDS, IMPLEMENT_KINDS, ITEMS_VEHICLES, FUEL_ITEM } from './content/vehicles.js';

// Systems are added here, in dependency order, as the iterations land. Electrical runs before water
// so a pump's request for power is answered in the same minute; the garden runs after water, whose draws it uses,
// and after the landscape, whose shape of the ground it reads.
// Kit parts fitted by hand (generic), then plumbing, which compiles them for water, which runs after both.
const partsSystem = createPartsSystem({ name: 'parts', stepM: PLUMBING_STEP_M, kinds: PLUMBING_KINDS, mates: PLUMBING_MATES });
// Vehicles (generic mechanism, homestead records): parked poses, fuel, seats, hitches, rentals. The page drives them.
const vehicles = createVehicleSystem({ name: 'vehicles', kinds: VEHICLE_KINDS, implementKinds: IMPLEMENT_KINDS, hooks: VEHICLE_HOOKS });
const plumbing = plumbingSystem({ kinds: PLUMBING_KINDS, mates: PLUMBING_MATES, stepM: PLUMBING_STEP_M, material: PLUMBING_PIPE, kit: STARTER_KIT });
// Runs in buildings (generic routes with services content), compiled by services before electrical and water read them.
const routesSystem = createRoutesSystem({ name: 'routes', classes: SERVICE_CLASSES, guard: servicesGuard });
export const GAME_SYSTEMS = [weather, streams, stockSystem(), siteSystem(), structure, routesSystem, services, electrical, partsSystem, plumbing, water, thermal, cookingSystem(), chickensSystem(), physicalKitchenSystem(), groundSystem({ tampBits: [LANDSCAPE_FLAG.TAMP1, LANDSCAPE_FLAG.TAMP2] }), landscape, garden, constructionSystem(), vehicles];

export function createGameSim(seed, opts = {}) {
  return createSim({ seed, systems: GAME_SYSTEMS, ...opts });
}

export const SPEEDS = [0, 1, 10, 100, 1000];
// At 1x one world day takes 20 real minutes.
export const WORLD_SECONDS_PER_REAL_SECOND = 86400 / 1200;
