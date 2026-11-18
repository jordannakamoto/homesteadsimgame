// Concrete for the homestead: the numbers and words the foundation system (src/sim/foundation.js) and the generic
// cure core (src/sim/core/cure.js) are given. Later slices add mixes per bag, form and rebar items, step specs and
// the mixer machine records here.
import { STAGES } from './construction.js';
import { DEFAULTS } from '../core/cure.js';

// The design strength is the catalog's concrete (C25/30): cure fractions are of this.
export const DESIGN_MPA = 25;
// An 80 lb bag of mix: 36 kg, about 0.017 m3 placed.
export const BAG = Object.freeze({ kg: 36, yieldM3: 0.017 });
// Initial set at 20 C is about 2.5 hours for ordinary concrete; the game stretches the working time so a hand pour
// is not a race (WORKABLE_SCALE), and pausing the clock removes the pressure entirely.
export const SET_H20 = 2.5;
export const WORKABLE_SCALE = 2.5;
export const CURE = Object.freeze({ ...DEFAULTS, frostSafe: 3.5 / DESIGN_MPA });

// Strength gates, as fractions of the design strength: what may be done on or against new concrete.
export const CURE_GATES = Object.freeze({ walk: 0.10, strip: 0.20, frame: 0.50, backfill: 0.70, drive: 0.75 });
export const GATE_ORDER = Object.freeze(['walk', 'strip', 'frame', 'backfill', 'drive']);
export const GATE_SAYS = Object.freeze({
  walk: 'Keep off: the concrete is still soft',
  strip: 'Leave the forms on: the concrete is still green',
  frame: 'The concrete is still green. Framing waits until it is half strength',
  backfill: 'Do not backfill yet: the wall is still green',
  drive: 'Keep vehicles off until it has cured',
});

// Construction stages held while a poured foundation is below a gate: every stage that stands on the foundation
// waits for the frame gate.
const above = (id, seen = new Set()) => {
  const st = STAGES.find((s) => s.id === id);
  if (!st) return false;
  if (st.needs.includes('foundation')) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  return st.needs.some((n) => above(n, seen));
};
export const GATE_HOLDS = Object.freeze([{ gate: 'frame', stages: Object.freeze(STAGES.filter((s) => above(s.id)).map((s) => s.id)) }]);

// Foundations the foundation system builds (the rest stay quick construction members).
export const POURED_TYPES = Object.freeze(['slab', 'piers', 'stemwall']);
// Which construction members a poured foundation stands for: the poured concrete, and the gravel base under it.
export const POURED_ITEMS = Object.freeze(['concrete_mix']);
export const POURED_KINDS = Object.freeze(['slab', 'stemwall']);
export const BASE_ITEMS = Object.freeze(['gravel']);
// element kind for a construction member kind (the shape of the pour)
export const ELEMENT_OF = Object.freeze({ slab: 'slab', stemwall: 'wall', pier: 'pier', footing: 'strip' });

// How often the cure is stepped (sim ticks of 60 s) and when it stops being followed: 28 days equivalent.
export const CURE_EVERY = 10;
export const CURE_DONE_EQH = 28 * 24;
