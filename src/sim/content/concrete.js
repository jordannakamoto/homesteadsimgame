// Concrete for the homestead: the numbers and words the foundation system (src/sim/foundation.js) and the generic
// cure core (src/sim/core/cure.js) are given. Later slices add mixes per bag, form and rebar items, step specs and
// the mixer machine records here.
import { STAGES } from './construction.js';
import { DEFAULTS } from '../core/cure.js';
import { FLAG as GROUND_FLAG } from './landscape.js';
export { ITEMS_CONCRETE } from './concrete-items.js';

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

// Layout and digging to the line (slice B2). Heights are world metres; fractions are of the dig region's area.
export const DIG = Object.freeze({
  tolUpM: 0.02,       // ground this far above the line still counts as dug (a flat shovel's tolerance)
  tolDownM: 0.04,     // dug deeper than this shows as too deep (the gravel base makes it up)
  cellM: 0.2,         // how finely the dig is checked
  roughM: 0.07,       // dug roughly: within this of the line (a shovel cannot dig to the centimetre)
  trimFrom: 0.85,     // once this much is roughly dug, the flat of the shovel trims it to the line with push strokes
  done: 0.97,         // dug: the excavation step is finished and the site stage of the building with it
  bladeW: 0.3,        // the swath one trim stroke cuts
  spoilOutM: 0.35,    // trimmed earth is pushed this far past the edge of the dig
  maxStrokeM: 4,      // one trim command covers at most this much of a stroke
});
export const LAYOUT = Object.freeze({ batterOutM: 0.9, stakeAboveM: 0.06 });
export const STEP_SAYS = Object.freeze({
  layout: 'Lay out the corners with string lines first',
  excavate: 'Dig to the strings: the amber is ground still too high',
  base: 'Dug to the line. The gravel base goes in next',
  forms: 'The base is firm. Set the form boards along the strings and stake them',
  pour: 'Formed. Mix concrete in the barrow, tip it in, rake it and screed it off the forms',
});

// The gravel base (slice B3). Gravel is delivered as heaps (the landscape's bulk delivery), barrowed, raked to the
// level under the slab and tamped twice with the hand tamper (the landscape's tamp flags). Heights are world metres.
export const BASE = Object.freeze({
  item: 'gravel',                       // what the base is bought as (m3)
  surfaces: Object.freeze(['gravel', 'crushed']),   // ground layers that count as a base
  thickM: 0.1,                          // default base under a slab: 4 in of compacted gravel
  slabM: 0.1,                           // default slab thickness (when the page sends no base level)
  tolUpM: 0.02, tolDownM: 0.03,         // the top of the base counts as level within these of the line
  minLayer: 0.5,                        // a point is gravelled filled at least this fraction of the base thickness
  gravelSurf: 0.5,                      // ... once at least this much of the base reads as gravel on top
  tamp1: GROUND_FLAG.TAMP1, tamp2: GROUND_FLAG.TAMP2,   // tamped once, tamped twice (firm)
  levelDone: 0.9, gravelDone: 0.92, compactDone: 0.9,   // fractions of the base area for the base to be done
  heapM3: 0.12,                         // one heap off the truck as it tips along a drag
  extra: 1.1,                           // a tenth more than the base volume is delivered (tamping takes some up)
});

// Forms (slice B3): 2x6 boards on edge with their inside face on the string line and their top at the finished
// height, held by stakes outside them. An unstaked stretch bows under the concrete as a beam would: the deflection of
// a simply supported board under the hydrostatic push of wet concrete, 5 w L^4 / 384 EI, and leaks once it gapes.
export const FORMS = Object.freeze({
  boardItem: 'form_board', stakeItem: 'form_stake',
  boardM: 2.44, boardH: 0.14, boardT: 0.038,
  stakeEveryM: 0.9, stakeEndM: 0.15, stakeOutM: 0.06,
  EI: 10e9 * (0.14 * 0.038 ** 3) / 12,  // N m2: a 2x6 (E 10 GPa) bent flat-wise, outward
  wetKNm3: 23.5,                        // wet concrete pushes like a fluid this heavy (kN/m3)
  leakBowM: 0.01,                       // a board bowed out this far opens a gap at its foot: the concrete leaks
});

// Mixing by hand in the barrow (slice B4). An 80 lb bag of mix holds about 5.4 kg of cement; the maker asks about
// 3 L of water a bag (a water/cement ratio near 0.55). The bands are of water/cement ratio: too dry crumbles and
// will not close under the screed, too wet slumps flat, bleeds and is weaker (Abrams: strength falls about 14^(w/c)).
export const MIX = Object.freeze({
  item: 'concrete_mix', bagKg: 36, bagM3: 0.017, cementKgPerBag: 5.4,
  idealLPerBag: 3.0, barrowBags: 3,     // a 6 cu ft barrow mixes three bags at a time
  hoseLps: 0.5,                         // a garden hose running into the barrow
  workPerBagM: 1.4,                     // metres of hoe strokes to mix one bag through once water is in
  tipMixed: 0.5,                        // mixed enough to tip (less leaves streaks of dry powder)
  designWc: 0.56, abramsB: 14,          // full design strength at the maker's 3 L a bag; weaker as it gets wetter
  bands: Object.freeze([
    Object.freeze({ id: 'dry', upTo: 0.4, slope: 0.75, rakeK: 0.18, screeds: false, says: 'Dry and crumbly: it will not close up under the screed. Add water' }),
    Object.freeze({ id: 'stiff', upTo: 0.48, slope: 0.42, rakeK: 0.4, screeds: true, says: 'Stiff: it holds its heap. A little more water and it flows' }),
    Object.freeze({ id: 'good', upTo: 0.64, slope: 0.2, rakeK: 0.65, screeds: true, says: 'Right: a rolling, glossy mud that holds a ridge' }),
    Object.freeze({ id: 'wet', upTo: 0.78, slope: 0.08, rakeK: 0.85, screeds: true, says: 'Wet: it slumps and spreads. It will be weaker' }),
    Object.freeze({ id: 'soupy', upTo: Infinity, slope: 0.03, rakeK: 0.9, screeds: true, says: 'Soupy: it runs flat and bleeds water. Much weaker' }),
  ]),
});

// How a pour behaves (the tunables of the pour field): the wet concrete is an earthwork grid inside the job whose
// height is millimetres of concrete over the base; the forms are walls in it.
export const FEEL_POUR = Object.freeze({
  tipR: 0.3,               // a barrow tipped lands as a heap this wide
  flowR: 1.6, flowIters: 80,
  rakeR: 0.35,
  screedStepM: 0.1,        // a screed stroke is pushed in short steps so the board follows the forms
  screedOverM: 0.12,       // the board is this much longer than the gap between the forms it rides on
  screedTolM: 0.004,       // on the level within this: screeded (flat and wet-bright)
  hollowM: 0.006,          // below the level by more: a hollow behind the board (dull)
  screedDone: 0.95,        // this much of the slab screeded flat: the pour is done
  ringM: 0.12,             // the form boards stand in a ring of points this wide outside the line
  maxStrokeM: 4,
});
// Finish codes kept per point of the pour grid (the earthwork surface channel).
export const FINISH = Object.freeze({ mud: 'mud', screeded: 'screeded' });
