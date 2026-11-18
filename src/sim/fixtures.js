// Every piece of equipment the game knows, gathered from the systems that own it.
// Systems export their own catalog (FIXTURES_<SYSTEM>); this is the one list the store and the
// Equip tool read. A catalog entry is data only: adding equipment never needs code here.

import { FIXTURES_ELECTRICAL } from './electrical.js';
import { FIXTURES_WATER } from './fixtures-water.js';
import { FIXTURES_CHICKENS } from './chickens.js';
import { FIXTURES_SERVICES } from './content/services.js';

export const FIXTURES = Object.freeze({ ...FIXTURES_ELECTRICAL, ...FIXTURES_WATER, ...FIXTURES_CHICKENS, ...FIXTURES_SERVICES });

// What can be set down in the world: things with a body and at least one port, or a body that
// stands alone (a coop, a tank). Wire and pipe by the metre are runs between ports, not placed; `fitted` things
// (a box, a switch) go into a wall through services, not Equip.
const isRun = (f) => /^(wire|pipe)/.test(f.category || '') || /^(wire_|pipe_)/.test(f.id);
export const PLACEABLE_FIXTURES = Object.freeze(Object.fromEntries(
  Object.entries(FIXTURES).filter(([, f]) => f.dims && !isRun(f) && !f.fitted),
));

export const fixtureDef = (id) => FIXTURES[id];
