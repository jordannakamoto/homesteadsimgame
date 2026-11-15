// Chickens: a small laying flock of individual birds with inherited traits, fed from feeders the player
// fills, laying by day length, age and nutrition, roosting at dusk, foraging on range or under a tractor.
//
// State, at sim.state.sys.chickens (see ARCHITECTURE.md, iteration 13):
//   birds: { [id]: { name, sex, breed, bornT, traits: { bv, pe, genes }, massKg, hungerKg (crop and gut fill, kg as fed),
//            waterL (body-water balance, 0 = fully hydrated, negative = short), energy (smoothed energy balance, MJ/day),
//            health (0..1), stress (0..1), roosting, location (pieceId | "range"), eggs: { nextT, laidTotal, ... }, mood,
//            plus: home, phase, status, personality, quirk, plumage, comb, gut {...}, lastMatedT, matedBy, dam, sire } }
//   flock: { feedKg, waterL, scrapsKg, count, laying, eggsWaiting, eggsToday }
//   eggs:  [{ id, laidT, nestId, fertile, hen, sire, massG, where }]
//   fx:    { [fixturePieceId]: { feedKg, waterL, iceL, doorOpen, light, bedKg, litterKg, litterNKg, emptySinceT, dryT, x, z } }
//   own:   fixture pieces the chickens panel placed itself (until the fixture placement tool lands)
//   ground: { range: { areaM2, forageGm2, nGm2, manureKgM2 }, cells: { [key]: { x, z, w, d, forageGm2, nGm2, manureKgM2, t } } }
//   totals: running sums for bookkeeping (feed, forage, scraps, water, eggs, manure)
//   issues: [{ id, severity, reason, fix }]
//
// Physiology runs every 10 ticks (10 minutes of world time). Movement on screen is the view's business.
//
// Sources for the figures, by family:
//   Energy:   NRC (1994) Nutrient Requirements of Poultry, laying-hen ME equation
//             ME (kcal/day) = W^0.75 (173 - 1.95 T) + 5.5 dW (g/day) + 2.07 EE (g egg/day)
//   Feed:     layer ration 2750 kcal/kg (11.5 MJ ME/kg), 16-17% CP, 89% DM (feed-mill and extension specs)
//   Water:    water:feed about 2:1 at 21 C, rising steeply in heat (Leeson & Summers, Commercial Poultry Nutrition;
//             hens at 32 C drink roughly twice what they drink at 21 C)
//   Laying:   photoperiod response (Lewis & Morris, Poultry Lighting; extension: about 14-16 h of light for full lay,
//             little below 12 h); the ovulation-oviposition cycle of 24-26 h with an "open period" in the first 8-9 h
//             after lights-on, which makes sequences and pause days (Fraps 1955; Etches, Reproduction in Poultry)
//   Breeds:   American Poultry Association Standard of Perfection weights, Livestock Conservancy and hatchery figures
//   Manure:   ASABE D384.2 (layers about 0.06 kg fresh manure per kg live weight per day); N by mass balance
//   Forage:   temperate pasture growth up to 60-80 kg DM/ha/day in spring, a grazed sward about 1.5-2.5 t DM/ha;
//             herbage ME for poultry about 5 MJ/kg DM (NRC 1994, alfalfa meal)

import { DAY, HOUR, hourOfDay, dayIndex } from './time.js';
import { sunTimes } from './calendar.js';
import { ITEMS } from './items.js';
import { stockAdd, stockRemove, stockBuy } from './stock.js';
import {
  newId, pickName, founderTraits, inheritTraits, hasAllele, ageDays, gompertz, gompertzRate,
  relax, clamp, smoothstep,
} from './animals.js';
import { FIXTURES_CHICKENS, ITEMS_CHICKENS } from './fixtures-chickens.js';

export { FIXTURES_CHICKENS, ITEMS_CHICKENS, ITEM_CATEGORIES_CHICKENS } from './fixtures-chickens.js';

const EVERY = 10;                       // ticks
const STATE_V = 1;
export const MAX_BIRDS = 60;

// ---------------------------------------------------------------------------------------- nutrition constants
export const FEED = Object.freeze({ meMJkg: 11.5, dm: 0.89, n: 0.165 / 6.25, indigestible: 0.30 });   // layer ration
export const SCRAPS = Object.freeze({ meMJkg: 2.0, dm: 0.20, n: 0.025 / 6.25, indigestible: 0.35 }); // mixed kitchen scraps, as fed (mostly vegetable)
export const HERBAGE = Object.freeze({ meMJkgDM: 5.0, n: 0.035, indigestible: 0.55, waterPerKgDM: 4 }); // fresh pasture, 20% DM
const KJ_PER_G_EGG = 8.66;              // 2.07 kcal per g of egg mass (NRC 1994)
const MJ_PER_KG_GAIN = 23;              // 5.5 kcal per g of gain (NRC 1994)
const MJ_PER_KG_LOSS = 16;              // ME yielded by mobilised hen tissue (mixed fat and lean)
const EGG_N = 0.019;                    // egg about 12% protein -> 1.9% N
const GAIN_N = 0.029;                   // body gain about 18% protein -> 2.9% N
const MANURE_DM = 0.25;                 // fresh droppings about 75% moisture
const GUT_TAU_S = 4 * HOUR;             // feed passage time 3-5 h
const GUT_CAP = 0.04;                   // crop and gut hold up to about 4% of body mass as fed
const HERBAGE_MAX_KG_DM = 0.025;        // herbage a hen eats at most, kg DM/day (free-range studies: 20-40 g DM)
const SCRATCH_WASTE = 1.0;              // herbage scratched up or trampled per kg eaten
const PASTURE_K = 250;                  // g DM/m2, a grazed sward at full cover
const PASTURE_GMAX = 8;                 // g DM/m2/day at the best of spring
const PASTURE_HALF = 50;                // g DM/m2 at which a hen finds half her fill
const RANGE_AREA_M2 = 250;              // default free range, about 10 m2 per bird for a backyard flock
const M2_PER_BIRD_COOP = 0.37;          // 4 sq ft per large-fowl bird
const M2_PER_BIRD_TRACTOR = 0.75;       // tractors are moved daily, so they run tighter than a coop and run
const ROOST_M_PER_BIRD = 0.22;
const TWILIGHT_H = 0.5;                 // civil twilight at mid latitudes: hens see by it
const OPEN_PERIOD_H = 9;                // ovulation possible up to about 9 h after lights-on
const FERTILE_DAYS = 14;
const FOUNT_UA = 3;                     // W/K, heat loss of a water fount                // a hen keeps fertile sperm about two weeks

// ---------------------------------------------------------------------------------------- traits
// Heritabilities and phenotypic variation, poultry quantitative genetics reviews (Kinney 1969; Muir & Aggrey 2003):
// adult body weight h2 0.4-0.6, CV about 8%; egg number h2 0.2-0.3; fearfulness (tonic immobility) about 0.3;
// broodiness 0.2-0.3. "calm", "brood" and "tone" are in phenotypic SD units; size and lay are fractions of the breed mean.
export const TRAIT_SPECS = Object.freeze({
  size: { h2: 0.45, cv: 0.08 },
  lay: { h2: 0.25, cv: 0.08 },
  calm: { h2: 0.3, cv: 1 },
  brood: { h2: 0.25, cv: 1 },
  tone: { h2: 0.5, cv: 0.12 },
});
// Mendelian loci (Smyth, in Crawford: Poultry Breeding and Genetics, 1990):
//   I  dominant white (I > i): Leghorn white          C  recessive white (cc white): White Wyandotte
//   E  extended black (E > e+): Australorp, Barred Rock base     R  rose comb (R > r+): Wyandotte
//   S  silver (S > s+, Z-linked)    B  barring (B > b+, Z-linked; BB cocks are paler than B- hens)
// Hens are ZW, so the Z-linked loci carry one allele in a hen.
export const SEX_LINKED = Object.freeze(['B', 'S']);

// ---------------------------------------------------------------------------------------- breeds
// Masses: APA Standard of Perfection for the heritage breeds where hatchery stock matches it; production
// Rhode Island Reds and Leghorns run lighter than exhibition birds and are given at hatchery weights.
// eggsPerYear: first laying year with good management and lighting (hatchery and Livestock Conservancy figures).
// Growth: Gompertz curves fitted to published breed growth (A = mature mass, k per day, ti days).
const sl = (a, b) => [a, b];
export const BREEDS = Object.freeze({
  rir: Object.freeze({
    id: 'rir', name: 'Rhode Island Red', henKg: 2.6, roosterKg: 3.6, eggsPerYear: 270, eggG: 58, eggColour: 'brown',
    pointOfLayWeeks: 20, eggIntervalH: 25.5, k: 0.022, ti: 63, calm: 0.2, brood: -0.8, tone: 0.85,
    genes: { I: sl('i', 'i'), C: sl('C', 'C'), E: sl('e+', 'e+'), R: sl('r+', 'r+'), S: sl('s+', 's+'), B: sl('b+', 'b+') },
    cold: 'Very hardy; the single comb can get frostbite in hard frost', heat: 'Copes with heat if there is shade',
    temperament: 'Confident and busy; some hens are bossy', blurb: 'The classic backyard layer: brown eggs nearly every day.',
  }),
  leghorn: Object.freeze({
    id: 'leghorn', name: 'White Leghorn', henKg: 2.0, roosterKg: 2.7, eggsPerYear: 290, eggG: 58, eggColour: 'white',
    pointOfLayWeeks: 18, eggIntervalH: 24.8, k: 0.025, ti: 55, calm: -1.0, brood: -1.5, tone: 0.5,
    genes: { I: sl('I', 'I'), C: sl('C', 'C'), E: sl('E', 'E'), R: sl('r+', 'r+'), S: sl('s+', 's+'), B: sl('b+', 'b+') },
    cold: 'The big comb frostbites easily', heat: 'Very heat tolerant',
    temperament: 'Flighty, quick and noisy; a great forager', blurb: 'Small, white and the best layer of them all.',
  }),
  rock: Object.freeze({
    id: 'rock', name: 'Barred Plymouth Rock', henKg: 3.2, roosterKg: 4.1, eggsPerYear: 240, eggG: 57, eggColour: 'brown',
    pointOfLayWeeks: 21, eggIntervalH: 25.8, k: 0.021, ti: 66, calm: 0.8, brood: -0.2, tone: 0.5,
    genes: { I: sl('i', 'i'), C: sl('C', 'C'), E: sl('E', 'E'), R: sl('r+', 'r+'), S: sl('s+', 's+'), B: sl('B', 'B') },
    cold: 'Very hardy', heat: 'Moderate', temperament: 'Docile and friendly; good with children',
    blurb: 'The grey-barred farmyard hen. Steady layer, easy to handle.',
  }),
  australorp: Object.freeze({
    id: 'australorp', name: 'Black Australorp', henKg: 2.9, roosterKg: 3.85, eggsPerYear: 260, eggG: 58, eggColour: 'brown',
    pointOfLayWeeks: 21, eggIntervalH: 25.5, k: 0.022, ti: 63, calm: 1.0, brood: 0.3, tone: 0.5,
    genes: { I: sl('i', 'i'), C: sl('C', 'C'), E: sl('E', 'E'), R: sl('r+', 'r+'), S: sl('s+', 's+'), B: sl('b+', 'b+') },
    cold: 'Hardy', heat: 'Black feathers soak up the sun: give shade in summer',
    temperament: 'Gentle and calm', blurb: 'Glossy green-black and a record-setting layer.',
  }),
  wyandotte: Object.freeze({
    id: 'wyandotte', name: 'White Wyandotte', henKg: 2.7, roosterKg: 3.6, eggsPerYear: 220, eggG: 56, eggColour: 'light brown',
    pointOfLayWeeks: 22, eggIntervalH: 26, k: 0.022, ti: 63, calm: 0.6, brood: 0.4, tone: 0.5,
    genes: { I: sl('i', 'i'), C: sl('c', 'c'), E: sl('e+', 'e+'), R: sl('R', 'R'), S: sl('S', 'S'), B: sl('b+', 'b+') },
    cold: 'Very hardy: the low rose comb shrugs off frost', heat: 'Moderate',
    temperament: 'Calm and chatty', blurb: 'A round white hen with a neat rose comb, made for cold winters.',
  }),
  pekin: Object.freeze({
    id: 'pekin', name: 'Buff Pekin bantam', henKg: 0.68, roosterKg: 0.8, eggsPerYear: 120, eggG: 32, eggColour: 'cream',
    pointOfLayWeeks: 24, eggIntervalH: 26, k: 0.026, ti: 50, calm: 1.4, brood: 1.6, tone: 0.18,
    genes: { I: sl('i', 'i'), C: sl('C', 'C'), E: sl('e+', 'e+'), R: sl('r+', 'r+'), S: sl('s+', 's+'), B: sl('b+', 'b+') },
    cold: 'Fluffy but small: needs a dry, draught-free coop', heat: 'Moderate',
    temperament: 'Very tame; often goes broody', blurb: 'A tiny round ball of buff feathers with feathered feet. Small eggs, big personality.',
  }),
});

export const HEN_NAMES = Object.freeze(['Henrietta', 'Mabel', 'Clementine', 'Dot', 'Pearl', 'Ginger', 'Hazel', 'Marigold', 'Nutmeg', 'Penny',
  'Rosie', 'Olive', 'Ruby', 'Daisy', 'Agatha', 'Bramble', 'Biscuit', 'Peggy', 'Florence', 'Winifred', 'Juniper', 'Poppy', 'Maude',
  'Tilly', 'Edna', 'Fern', 'Goldie', 'Ivy', 'Lottie', 'Martha', 'Nellie', 'Opal', 'Primrose', 'Queenie', 'Sage', 'Tansy', 'Violet',
  'Wren', 'Beatrix', 'Cora', 'Dolly', 'Elsie', 'Flossie', 'Gertie', 'Hattie', 'Iris', 'Josie', 'Lulu', 'Minnie', 'Nora', 'Pip',
  'Sadie', 'Trudy', 'Vera', 'Willa', 'Honey', 'Butterscotch', 'Pickle', 'Custard', 'Matilda']);
export const ROOSTER_NAMES = Object.freeze(['Rupert', 'Chanticleer', 'Barnaby', 'Reginald', 'Archie', 'Gus', 'Hector', 'Ollie', 'Percy',
  'Winston', 'Duke', 'Monty', 'Cosmo', 'Sterling', 'Bertram', 'Cecil', 'Ned', 'Oscar', 'Alfred', 'Basil']);
// Small personalities: cosmetic, but the view acts them out and the status lines mention them.
export const QUIRKS = Object.freeze(['loves a dust bath', 'is always first to the feeder', 'follows you about', 'talks to herself',
  'likes to wander far', 'sticks close to the flock', 'hunts for beetles', 'sunbathes on her side', 'is nosy about everything',
  'sings the egg song loudly', 'naps in the afternoon', 'scratches like a digger']);

// ---------------------------------------------------------------------------------------- phenotype from genotype
const COL = {
  white: [0.93, 0.91, 0.86], whiteSec: [0.86, 0.84, 0.78],
  black: [0.12, 0.13, 0.15], blackSec: [0.09, 0.16, 0.13],
  barredLight: [0.66, 0.67, 0.69], barredDark: [0.2, 0.21, 0.24],
  silver: [0.88, 0.87, 0.83], silverSec: [0.14, 0.14, 0.16],
  buff: [0.86, 0.64, 0.33], mahogany: [0.46, 0.2, 0.09], goldTail: [0.16, 0.11, 0.08],
};
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u].map((v) => Math.round(v * 1000) / 1000);

// What the bird looks like: { plumage (word), comb, colour [r,g,b], colour2 (tail and wings), pattern 0 solid | 1 barred }
export function phenotypeLook(bird) {
  const g = bird.traits.genes, br = BREEDS[bird.breed];
  const tone = clamp((br ? br.tone : 0.5) + (bird.traits.bv.tone || 0) + (bird.traits.pe.tone || 0), 0, 1);
  const comb = hasAllele(g.R, 'R') ? 'rose' : 'single';
  const barred = hasAllele(g.B, 'B'), doubleBar = g.B && g.B.length === 2 && g.B[0] === 'B' && g.B[1] === 'B';
  if (hasAllele(g.I, 'I') || (g.C && g.C.every((a) => a === 'c'))) return { plumage: 'white', comb, colour: COL.white, colour2: COL.whiteSec, pattern: 0 };
  if (hasAllele(g.E, 'E')) {
    if (barred) return { plumage: 'barred', comb, colour: doubleBar ? mix(COL.barredLight, COL.white, 0.35) : COL.barredLight, colour2: COL.barredDark, pattern: 1 };
    return { plumage: 'black', comb, colour: COL.black, colour2: COL.blackSec, pattern: 0 };
  }
  if (hasAllele(g.S, 'S')) return { plumage: barred ? 'silver cuckoo' : 'silver', comb, colour: COL.silver, colour2: COL.silverSec, pattern: barred ? 1 : 0 };
  const main = mix(COL.buff, COL.mahogany, tone);
  const word = tone > 0.6 ? 'red' : tone > 0.32 ? 'gold' : 'buff';
  return { plumage: barred ? word + ' cuckoo' : word, comb, colour: main, colour2: tone > 0.32 ? COL.goldTail : mix(COL.buff, COL.mahogany, tone + 0.25), pattern: barred ? 1 : 0 };
}

const personalityOf = (calm) => (calm > 1.1 ? 'placid' : calm > 0.4 ? 'easygoing' : calm > -0.3 ? 'curious' : calm > -1 ? 'nervy' : 'flighty');

// ---------------------------------------------------------------------------------------- individuals
export const sizeFactor = (b) => 1 + b.traits.bv.size + b.traits.pe.size;
export const layFactor = (b) => 1 + b.traits.bv.lay + b.traits.pe.lay;
export const calmOf = (b) => (BREEDS[b.breed].calm || 0) + b.traits.bv.calm + b.traits.pe.calm;
export function matureKg(b) { const br = BREEDS[b.breed]; return (b.sex === 'rooster' ? br.roosterKg : br.henKg) * sizeFactor(b); }
// target (well-grown, well-fed) mass at this age
export function targetKg(b, t) {
  const br = BREEDS[b.breed];
  return gompertz(ageDays(b, t), matureKg(b), br.k, br.ti + (b.sex === 'rooster' ? 5 : 0));
}
export function pointOfLayWeeks(b) { return BREEDS[b.breed].pointOfLayWeeks * (1 - 0.6 * (b.traits.bv.lay + b.traits.pe.lay)); }

function founderGenes(br, sex) {
  const g = {};
  for (const [L, pair] of Object.entries(br.genes)) g[L] = SEX_LINKED.includes(L) && sex === 'hen' ? [pair[0]] : pair.slice();
  return g;
}

function finishBird(s, b, rng) {
  const look = phenotypeLook(b);
  b.plumage = look.plumage; b.comb = look.comb; b.colour = look.colour; b.colour2 = look.colour2; b.pattern = look.pattern;
  b.personality = personalityOf(calmOf(b));
  b.quirk = rng.pick(QUIRKS);
  if (b.sex === 'rooster') b.quirk = b.quirk.replace('herself', 'himself').replace('her side', 'his side');
  return b;
}

function blankBird(id, name, sex, breed, bornT, traits, massKg) {
  return {
    id, name, sex, breed, breedName: BREEDS[breed].name, bornT, traits, massKg,
    hungerKg: 0, waterL: 0, energy: 0, health: 1, stress: 0, roosting: false, location: 'range',
    eggs: { nextT: null, laidTotal: 0, tryDay: -1, recent: [] },
    gut: { mj: 0, ind: 0, n: 0 }, mood: 'content', status: '', home: null, phase: 'range',
    lastMatedT: null, matedBy: null, dam: null, sire: null, out: false, fedT: null, cond: 1,
  };
}

// A purchased bird of a breed, sex and age.
export function makeBird(s, rng, breedId, sex, bornT, t) {
  const br = BREEDS[breedId];
  const id = newId(rng, 'c', s.birds);
  const used = Object.values(s.birds).map((b) => b.name);
  const name = pickName(rng, sex === 'rooster' ? ROOSTER_NAMES : HEN_NAMES, used);
  const traits = founderTraits(rng, TRAIT_SPECS, founderGenes(br, sex));
  const b = blankBird(id, name, sex, breedId, bornT, traits, 0);
  b.massKg = round4(targetKg(b, t));
  return finishBird(s, b, rng);
}

// A chick from two parents (the lifecycle iteration hatches eggs with this). Same breed as the dam
// unless the parents differ, when it is a cross.
export function makeOffspring(s, rng, dam, sire, sex, bornT) {
  const id = newId(rng, 'c', s.birds);
  const used = Object.values(s.birds).map((b) => b.name);
  const name = pickName(rng, sex === 'rooster' ? ROOSTER_NAMES : HEN_NAMES, used);
  const traits = inheritTraits(rng, TRAIT_SPECS, dam, sire, { sex, sexLinked: SEX_LINKED, heteroSex: 'hen' });
  const b = blankBird(id, name, sex, dam.breed, bornT, traits, 0);
  if (dam.breed !== sire.breed) b.breedName = 'Cross (' + BREEDS[dam.breed].name + ' x ' + BREEDS[sire.breed].name + ')';
  b.dam = dam.id; b.sire = sire.id;
  b.massKg = round4(targetKg(b, bornT));
  return finishBird(s, b, rng);
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------------------------------- fixtures
export const isChickenFixture = (p) => p && p.kind === 'fixture' && !!FIXTURES_CHICKENS[p.fixture];

// Fixture pieces the chickens system can see: the site's (placed in build mode) and its own (from the panel).
function allFixtures(c) {
  const site = c.get('site');
  const out = [];
  if (site && site.pieces) for (const p of site.pieces) if (isChickenFixture(p)) out.push(p);
  for (const p of c.s.own) out.push(p);
  return out;
}

// Derived index of fixtures and which coop each accessory belongs to. Cached per state object and
// invalidated by the site version and the system's own fixture version.
const indexCache = new WeakMap();
function fixtureIndex(c) {
  const s = c.s, site = c.get('site');
  const key = (site ? site.version : 0) + ':' + s.fxVersion;
  const hit = indexCache.get(s);
  if (hit && hit.key === key) return hit;
  const list = allFixtures(c);
  const idx = { key, all: [], byId: {}, coops: [], feeders: [], waterers: [], nests: [], roosts: [], owner: {} };
  for (const p of list) {
    const cat = FIXTURES_CHICKENS[p.fixture];
    const fs = fxState(s, p, cat);
    const e = { id: p.id, piece: p, cat, x: fs.x ?? p.a.x, z: fs.z ?? p.a.z, yaw: fs.yawRad ?? p.yawRad ?? 0 };
    idx.all.push(e); idx.byId[p.id] = e;
    if (cat.shelter) idx.coops.push(e);
    if (cat.feedCapKg) idx.feeders.push(e);
    if (cat.waterCapL) idx.waterers.push(e);
    if (cat.nests) idx.nests.push(e);
    if (cat.roostM && !cat.shelter) idx.roosts.push(e);
  }
  // accessories belong to the coop whose footprint (grown by 1.5 m) holds them; a tractor's own parts belong to it
  for (const e of idx.all) {
    if (e.cat.shelter) { idx.owner[e.id] = e.id; continue; }
    let best = null, bd = Infinity;
    for (const co of idx.coops) {
      const dx = e.x - co.x, dz = e.z - co.z, r = Math.max(co.cat.dims.w, co.cat.dims.d) / 2 + 1.5, d = Math.hypot(dx, dz);
      if (d <= r && d < bd && !co.cat.movable) { best = co.id; bd = d; }
    }
    idx.owner[e.id] = best;
  }
  for (const co of idx.coops) {
    co.nestIds = idx.nests.filter((n) => idx.owner[n.id] === co.id).map((n) => n.id);
    co.roostM = co.cat.roostM + idx.roosts.filter((r) => idx.owner[r.id] === co.id).reduce((a, r) => a + r.cat.roostM, 0);
    co.capacity = Math.floor(co.cat.floorAreaM2 / (co.cat.movable ? M2_PER_BIRD_TRACTOR : M2_PER_BIRD_COOP) + 1e-9);
  }
  indexCache.set(s, idx);
  return idx;
}

function fxState(s, p, cat) {
  let f = s.fx[p.id];
  if (!f) {
    f = s.fx[p.id] = {};
    if (cat.feedCapKg) { f.feedKg = 0; f.emptySinceT = null; }
    if (cat.waterCapL) { f.waterL = 0; f.iceL = 0; f.dryT = null; }
    if (cat.door) f.doorOpen = p.settings && p.settings.door !== undefined ? !!p.settings.door : true;
    if (cat.shelter) { f.light = { on: false, hours: 15 }; f.bedKg = 0; f.litterKg = 0; f.litterNKg = 0; }
  }
  return f;
}

// ---------------------------------------------------------------------------------------- stock bridge
// Items and money move through the stock system's own command handlers. Until the orchestrator merges
// ITEMS_CHICKENS into the item catalog, items the catalog does not know are kept in this system's `store`
// and their money moves as the stock rules would move it (exact cents). After the merge the bridge is unused.
const known = (id) => !!ITEMS[id];
const cents = (x) => Math.round(x * 100) / 100;
function stockState(c) { return c.get('stock'); }
export function haveItem(state, id) {
  const st = state.sys.stock, s = state.sys.chickens;
  return known(id) ? (st && st.items[id]) || 0 : (s && s.store[id]) || 0;
}
function callStock(c, name, payload) {
  const h = c.sim && c.sim.handlers.get(name);
  const st = stockState(c);
  if (!st) return { ok: false, reason: 'no stock' };
  if (h) {
    const ctx = { sim: c.sim, state: c.state, t: c.t, tick: c.tick, dt: 0, get s() { return c.state.sys[h.sys.name]; }, get: c.get, rng: c.rng, emit: c.emit };
    return h.fn(ctx, payload);
  }
  const fn = name === 'stock.add' ? stockAdd : name === 'stock.remove' ? stockRemove : stockBuy;
  return fn(st, payload.id, payload.qty);
}
function itemAdd(c, id, qty) {
  if (known(id)) return callStock(c, 'stock.add', { id, qty });
  c.s.store[id] = round6((c.s.store[id] || 0) + qty);
  return { ok: true, id, qty };
}
function itemRemove(c, id, qty) {
  if (known(id)) return callStock(c, 'stock.remove', { id, qty });
  const have = c.s.store[id] || 0;
  if (have + 1e-9 < qty) return { ok: false, id, qty, reason: 'not enough' };
  const left = round6(have - qty);
  if (left <= 0) delete c.s.store[id]; else c.s.store[id] = left;
  return { ok: true, id, qty };
}
function itemBuy(c, id, qty) {
  if (known(id)) return callStock(c, 'stock.buy', { id, qty });
  const it = ITEMS_CHICKENS[id], st = stockState(c);
  if (!it || !st) return { ok: false, id, qty, reason: 'unknown item' };
  if (!(qty > 0) || (it.unit === 'each' && !Number.isInteger(qty))) return { ok: false, id, qty, reason: 'quantity must be positive' };
  const costUsd = cents(it.priceUsd * qty);
  if (st.money + 1e-9 < costUsd) return { ok: false, id, qty, costUsd, reason: 'not enough money' };
  st.money = cents(st.money - costUsd);
  itemAdd(c, id, qty);
  c.emit('stock.buy', { ok: true, id, qty, costUsd });
  return { ok: true, id, qty, costUsd };
}

// ---------------------------------------------------------------------------------------- init
export function initChickens() {
  return {
    v: STATE_V, birds: {}, flock: { feedKg: 0, waterL: 0, scrapsKg: 0, count: 0, laying: 0, eggsWaiting: 0, eggsToday: 0, day: -1 },
    eggs: [], fx: {}, own: [], fxVersion: 0, nextFx: 1, store: {},
    ground: { range: { areaM2: RANGE_AREA_M2, forageGm2: PASTURE_K * 0.8, nGm2: 0, manureKgM2: 0 }, cells: {} },
    totals: {
      feedFilledKg: 0, feederEatenKg: 0, feederWastedKg: 0, forageKgDM: 0, scrapsGivenKg: 0, scrapsEatenKg: 0, scrapsLostKg: 0,
      waterFilledL: 0, waterDrunkL: 0, eggs: 0, eggMassKg: 0, manureKg: 0, manureNKg: 0, intakeMJ: 0,
    },
    issues: [], lastStepT: null,
  };
}

// ---------------------------------------------------------------------------------------- the light of the day
// Natural light runs from civil dawn to civil dusk; a coop light on a timer adds light in the morning (the
// usual practice, so the birds still go to roost at the natural dusk). Returns hours of day, clock hours.
function lightDay(t, site, light, lit) {
  const st = sunTimes(t, site);
  const dawnH = st.sunriseH - TWILIGHT_H, duskH = st.sunsetH + TWILIGHT_H, natural = duskH - dawnH;
  const extra = lit && light && light.on && light.hours > natural;
  const onH = extra ? duskH - light.hours : dawnH;
  return { dawnH, duskH, onH, photoH: extra ? light.hours : natural, natural };
}

// pasture growth by temperature: none below about 4 C, full from 12 C, falling off in heat; none under snow
function pastureGrowth(W) {
  if (W.snowDepthM > 0.02) return 0;
  return smoothstep(4, 12, W.tempC) * (1 - 0.7 * smoothstep(26, 34, W.tempC));
}

// ---------------------------------------------------------------------------------------- the step
function step(c) {
  const s = c.s, W = c.get('weather');
  if (!W) return;
  const t = c.t, dt = c.dt, dtD = dt / DAY, dtH = dt / HOUR;
  const idx = fixtureIndex(c);
  const site = W.site || { latitudeDeg: 45 };
  const hour = hourOfDay(t), today = dayIndex(t);
  const T = W.tempC;
  const elec = c.get('electrical');
  if (s.flock.day !== today) { s.flock.day = today; s.flock.eggsToday = 0; }

  // fixtures: water freezes in a hard frost and thaws above zero; feeders note when they ran dry
  // ice forms at the rate the fount loses heat: UA about 3 W/K for a plastic fount (0.4 m2 at 7-8 W/m2K, sheltered),
  // latent heat 334 kJ/kg; so a full 11 L fount takes a day and a half to freeze solid at -9 C
  for (const e of idx.waterers) {
    const f = s.fx[e.id], Tw = owner(idx, e) && !owner(idx, e).cat.confines ? T + 3 : T;
    const kg = (FOUNT_UA * Math.abs(Tw) * dt) / 334000;
    if (Tw < 0) f.iceL = Math.min(f.waterL, f.iceL + kg);
    else if (f.iceL > 0) f.iceL = Math.max(0, f.iceL - kg);
  }

  // pasture: the range and every tractor cell grow back
  const g = pastureGrowth(W) * PASTURE_GMAX * dtD;
  if (g > 0) {
    const r = s.ground.range;
    r.forageGm2 += g * (1 - r.forageGm2 / PASTURE_K);
    for (const k in s.ground.cells) { const cl = s.ground.cells[k]; if (cl.forageGm2 < PASTURE_K) cl.forageGm2 += g * (1 - cl.forageGm2 / PASTURE_K); }
  }
  // scraps on the ground spoil or go to wild birds within a couple of days
  if (s.flock.scrapsKg > 0) {
    const lost = s.flock.scrapsKg * (1 - Math.exp(-dt / (2 * DAY)));
    s.flock.scrapsKg -= lost; s.totals.scrapsLostKg += lost;
  }

  // homes: each bird belongs to a shelter with room for it
  assignHomes(s, idx);

  // light per shelter today
  const days = {};
  for (const co of idx.coops) {
    const f = s.fx[co.id];
    let lit = !!(f.light && f.light.on);
    if (lit && elec && elec.loads && elec.loads[co.id + ':light']) lit = !!elec.loads[co.id + ':light'].served;
    days[co.id] = lightDay(t, site, f.light, lit);
  }
  const wild = lightDay(t, site, null, false);

  // roosters present at each place, for fertility
  let roosters = 0, hens = 0;
  for (const id in s.birds) { if (s.birds[id].sex === 'rooster') roosters++; else hens++; }
  const coverage = roosters ? Math.min(1, (10 * roosters) / Math.max(1, hens)) : 0;   // one cock serves about ten hens

  const rngLay = c.rng('lay');
  for (const k in homeLoad) delete homeLoad[k];
  for (const id in s.birds) { const h = s.birds[id].home; if (h) homeLoad[h] = (homeLoad[h] || 0) + 1; }
  let feedTotal = 0, waterTotal = 0, laying = 0, count = 0;
  for (const id in s.birds) {
    const b = s.birds[id];
    count++;
    const home = b.home ? idx.byId[b.home] : null;
    const ld = home ? days[home.id] : wild;
    stepBird(c, s, b, home, ld, idx, hour, T, W, dt, dtD, t, today, rngLay, coverage);
    if (b.eggs.nextT !== null) laying++;
  }
  for (const e of idx.feeders) feedTotal += s.fx[e.id].feedKg;
  for (const e of idx.waterers) waterTotal += s.fx[e.id].waterL;
  s.flock.feedKg = round4(feedTotal); s.flock.waterL = round4(waterTotal);
  s.flock.count = count; s.flock.laying = laying; s.flock.eggsWaiting = s.eggs.length;
  for (const e of idx.feeders) { const f = s.fx[e.id]; if (f.feedKg <= 1e-6) { f.feedKg = 0; if (f.emptySinceT === null) f.emptySinceT = t; } else f.emptySinceT = null; }
  for (const e of idx.waterers) { const f = s.fx[e.id]; if (f.waterL - f.iceL <= 1e-6) { if (f.dryT === null) f.dryT = t; } else f.dryT = null; }
  s.issues = computeIssues(s, idx, t, W, days, wild);
  for (const id in s.birds) s.birds[id].status = statusLine(s, s.birds[id], idx, t, days, wild);
  s.lastStepT = t;
}

const homeLoad = {};                    // scratch: birds per shelter in the current step (derived, not state)

const owner = (idx, e) => (idx.owner[e.id] ? idx.byId[idx.owner[e.id]] : null);

function assignHomes(s, idx) {
  const load = {};
  for (const co of idx.coops) load[co.id] = 0;
  const ids = Object.keys(s.birds).sort();
  for (const id of ids) { const b = s.birds[id]; if (b.home && load[b.home] !== undefined) load[b.home]++; else b.home = null; }
  for (const id of ids) {
    const b = s.birds[id];
    if (b.home) continue;
    let best = null;
    for (const co of idx.coops) if (load[co.id] < co.capacity && (!best || load[co.id] / co.capacity < load[best.id] / best.capacity)) best = co;
    if (!best && idx.coops.length) best = idx.coops[0];          // overcrowded rather than homeless
    if (best) { b.home = best.id; load[best.id]++; if (best.cat.confines) b.location = best.id; }
  }
}

// Where the bird is and whether it is awake, from the light and the door.
function placeBird(s, b, home, ld, hour) {
  const light = hour >= ld.dawnH && hour < ld.duskH;
  const litInside = hour >= ld.onH && hour < ld.duskH;           // coop light (or daylight) inside the shelter
  b.out = false;
  if (!home) {
    b.location = 'range'; b.roosting = !light; b.phase = light ? 'wild' : 'wildRoost';
    return;
  }
  if (home.cat.confines) {
    b.location = home.id; b.roosting = !litInside; b.phase = b.roosting ? 'roost' : 'tractor';
    return;
  }
  const open = !!s.fx[home.id].doorOpen;
  if (!light) {
    if (b.location === home.id || open) { b.location = home.id; b.roosting = !litInside; b.phase = b.roosting ? 'roost' : 'coop'; }
    else { b.location = 'range'; b.roosting = true; b.out = true; b.phase = 'out'; }
    return;
  }
  b.roosting = false;
  if (open) { b.location = 'range'; b.phase = 'range'; }
  else if (b.location === home.id) b.phase = 'coop';
  else { b.phase = 'range'; }                                    // shut out in daylight: they mill about the door
}

function maintenanceMJ(massKg, tempC) {
  const T = clamp(tempC, -20, 38);
  return (0.7238 - 0.008159 * T) * Math.pow(massKg, 0.75);       // NRC 1994: (173 - 1.95 T) kcal per kg^0.75
}
export const waterFeedRatio = (tempC) => (tempC <= 21 ? 2 : 2 * Math.exp(0.075 * (tempC - 21)));

function stepBird(c, s, b, home, ld, idx, hour, T, W, dt, dtD, t, today, rngLay, coverage) {
  const br = BREEDS[b.breed];
  placeBird(s, b, home, ld, hour);
  const awake = !b.roosting;
  const inShelter = home && b.location === home.id;
  const ambient = inShelter && !home.cat.confines ? T + 3 : T;    // body heat in a small closed coop; the lifecycle iteration reads the real coop
  const Wt = targetKg(b, t), mass = b.massKg;
  const cond = mass / Wt;
  b.cond = round4(cond);

  // ---- requirements (MJ/day)
  const fast = clamp(-b.energy / 1.2, 0, 1);
  const maint = maintenanceMJ(mass, ambient) * (b.phase === 'range' ? 1.05 : 1) * (1 - 0.2 * fast);
  const forming = b.eggs.nextT !== null;
  const eggG = eggMassG(b, t);
  const eggMJday = forming ? (KJ_PER_G_EGG * eggG / 1000) * (24 / eggIntervalH(b, t)) : 0;
  const ageD = ageDays(b, t);
  const growKgDay = gompertzRate(ageD, matureKg(b), br.k, br.ti + (b.sex === 'rooster' ? 5 : 0));
  const needMJ = maint + eggMJday + growKgDay * MJ_PER_KG_GAIN;
  const dehyd = clamp(-b.waterL / mass, 0, 1);                    // fraction of body mass short of water
  const hydrIntake = clamp(1 - (dehyd - 0.03) / 0.05, 0, 1);       // hens stop eating when short of water

  // ---- eating (only while awake and with light)
  const gutCap = GUT_CAP * mass;
  let ateMJ = 0, ateDM = 0, ateInd = 0, ateN = 0, waterInFood = 0;
  let accessFeed = false;
  if (awake) {
    const correction = clamp(4 * (Wt - mass) / Wt, -0.4, 0.6);
    let wantMJ = needMJ * (1 + correction) * hydrIntake * dt / (Math.max(8, ld.photoH) * HOUR);
    const room = Math.max(0, gutCap - b.hungerKg);
    // scraps first (they come running), then forage, then the feeder
    if (wantMJ > 0 && s.flock.scrapsKg > 0 && b.phase !== 'tractor') {
      const kg = Math.min(s.flock.scrapsKg, wantMJ / SCRAPS.meMJkg, room);
      s.flock.scrapsKg -= kg; s.totals.scrapsEatenKg += kg;
      ateMJ += kg * SCRAPS.meMJkg; ateDM += kg * SCRAPS.dm; ateInd += kg * SCRAPS.dm * SCRAPS.indigestible; ateN += kg * SCRAPS.n;
      waterInFood += kg * (1 - SCRAPS.dm); b.hungerKg += kg; wantMJ -= kg * SCRAPS.meMJkg;
    }
    const patch = b.phase === 'range' || b.phase === 'wild' ? s.ground.range : b.phase === 'tractor' ? tractorCell(s, home) : null;
    if (wantMJ > 0 && patch && patch.forageGm2 > 1) {
      const area = patch === s.ground.range ? patch.areaM2 : patch.w * patch.d;
      const frac = patch.forageGm2 / (patch.forageGm2 + PASTURE_HALF);
      let dm = Math.min(HERBAGE_MAX_KG_DM * frac * dt / (Math.max(8, ld.photoH) * HOUR), wantMJ / HERBAGE.meMJkgDM);
      const availKg = (patch.forageGm2 / 1000) * area / (1 + SCRATCH_WASTE);
      dm = Math.max(0, Math.min(dm, availKg));
      patch.forageGm2 = Math.max(0, patch.forageGm2 - (dm * (1 + SCRATCH_WASTE) * 1000) / area);
      s.totals.forageKgDM += dm;
      ateMJ += dm * HERBAGE.meMJkgDM; ateDM += dm; ateInd += dm * HERBAGE.indigestible; ateN += dm * HERBAGE.n;
      waterInFood += dm * HERBAGE.waterPerKgDM; b.hungerKg += dm * (1 + HERBAGE.waterPerKgDM); wantMJ -= dm * HERBAGE.meMJkgDM;
    }
    if (wantMJ > 0) {
      const fe = pickSource(s, idx, b, home, 'feedKg');
      if (fe) {
        accessFeed = true;
        const f = s.fx[fe.id], waste = fe.cat.wasteFrac || 0;
        const kg = Math.min(wantMJ / FEED.meMJkg, f.feedKg * (1 - waste));
        const used = kg / (1 - waste);
        f.feedKg = Math.max(0, f.feedKg - used);
        s.totals.feederEatenKg += kg; s.totals.feederWastedKg += used - kg;
        ateMJ += kg * FEED.meMJkg; ateDM += kg * FEED.dm; ateInd += kg * FEED.dm * FEED.indigestible; ateN += kg * FEED.n;
        waterInFood += kg * (1 - FEED.dm); b.hungerKg += kg;
      } else accessFeed = !!pickSource(s, idx, b, home, 'feedKg', true);
    }
  }
  b.gut.mj += ateMJ; b.gut.ind += ateInd; b.gut.n += ateN;
  s.totals.intakeMJ += ateMJ;

  // ---- digestion: the gut empties with the passage time; what is digested is absorbed, the rest becomes droppings
  const frac = 1 - Math.exp(-dt / GUT_TAU_S);
  const absMJ = b.gut.mj * frac, outInd = b.gut.ind * frac, absN = b.gut.n * frac;
  b.gut.mj -= absMJ; b.gut.ind -= outInd; b.gut.n -= absN; b.hungerKg *= 1 - frac;
  if (b.hungerKg < 1e-7) b.hungerKg = 0;

  // ---- energy balance -> body mass (no gain without intake: surplus comes only from what was absorbed)
  const spentMJ = (maint + eggMJday) * dtD;
  const net = absMJ - spentMJ;
  let dMass = net >= 0 ? net / MJ_PER_KG_GAIN : net / MJ_PER_KG_LOSS;
  if (dMass > 0 && mass > Wt * 1.12) dMass = 0;                   // a fat hen does not keep laying down fat: the surplus is burned
  b.massKg = round6(Math.max(0.03, mass + dMass));
  b.energy = relax(b.energy, net / dtD, dt, DAY);

  // ---- droppings and nitrogen: N absorbed minus N into the forming egg and into gain
  const eggN = forming ? EGG_N * (eggG / 1000) * (dt / (eggIntervalH(b, t) * HOUR)) : 0;
  const nOut = Math.max(0, absN - eggN - Math.max(0, dMass) * GAIN_N);
  const manureKg = outInd / MANURE_DM;                              // droppings by mass from undigested dry matter at 25% DM
  depositManure(s, b, home, manureKg, nOut);

  // ---- water
  const feedEq = needMJ / FEED.meMJkg;
  const needL = waterFeedRatio(ambient) * feedEq * dtD * (awake ? 1.3 : 0.5) - waterInFood * 0.8;
  let drunk = 0;
  if (awake) {
    const we = pickSource(s, idx, b, home, 'waterL');
    if (we) {
      const f = s.fx[we.id], liquid = Math.max(0, f.waterL - f.iceL);
      const want = Math.max(0, needL - b.waterL);
      drunk = Math.min(want, liquid);
      f.waterL -= drunk; s.totals.waterDrunkL += drunk;
    }
  }
  b.waterL = Math.max(-0.25 * mass, Math.min(0, b.waterL - needL + drunk));

  // ---- stress, health
  let stressT = 0;
  if (b.out) stressT = Math.max(stressT, 0.6);
  if (!home && b.roosting) stressT = Math.max(stressT, 0.5);
  if (cond < 0.94) stressT = Math.max(stressT, clamp((0.94 - cond) / 0.1, 0, 1) * 0.5);
  if (awake && !accessFeed && b.hungerKg < 0.15 * gutCap && !ateMJ) stressT = Math.max(stressT, 0.3);
  if (dehyd > 0.03) stressT = Math.max(stressT, clamp((dehyd - 0.03) / 0.05, 0, 1) * 0.6);
  if (b.phase === 'coop') stressT = Math.max(stressT, 0.12);
  if (home && home.capacity) {
    const n = homeLoad[home.id] || 0;
    if (n > home.capacity) stressT = Math.max(stressT, Math.min(0.5, (n / home.capacity - 1)));
  }
  stressT = clamp(stressT * (1 - 0.15 * clamp(calmOf(b), -1.5, 1.5)), 0, 1);
  b.stress = relax(b.stress, stressT, dt, stressT > b.stress ? 6 * HOUR : 36 * HOUR);
  const healthT = clamp(1 - 0.6 * clamp((0.85 - cond) / 0.2, 0, 1) - 0.5 * clamp((dehyd - 0.06) / 0.08, 0, 1), 0.15, 1);
  b.health = relax(b.health, healthT, dt, healthT < b.health ? 2 * DAY : 5 * DAY);

  // ---- mating: a hen sharing the day with a rooster stays fertile about two weeks
  if (b.sex === 'hen' && coverage > 0 && awake && hour > 12 && hour - dt / HOUR <= 12) {
    for (const id in s.birds) {
      const r = s.birds[id];
      if (r.sex === 'rooster' && r.home === b.home && rngLay.float() < coverage) { b.lastMatedT = t; b.matedBy = r.id; break; }
    }
  }

  // ---- laying
  if (b.sex === 'hen') stepLaying(c, s, b, home, ld, idx, hour, t, dt, today, rngLay, cond, dehyd);

  b.mood = moodOf(b, awake, cond, dehyd, accessFeed, t);
}

function tractorCell(s, home) {
  const f = s.fx[home.id];
  const key = (Math.round(home.x * 2) / 2) + ',' + (Math.round(home.z * 2) / 2);
  let cl = s.ground.cells[key];
  if (!cl) {
    cl = s.ground.cells[key] = { x: Math.round(home.x * 2) / 2, z: Math.round(home.z * 2) / 2, w: home.cat.dims.w, d: home.cat.dims.d, yaw: home.yaw, forageGm2: PASTURE_K, nGm2: 0, manureKgM2: 0, t: 0 };
    pruneCells(s);
  }
  f.cell = key;
  return cl;
}
function pruneCells(s) {
  const keys = Object.keys(s.ground.cells);
  if (keys.length <= 400) return;
  keys.sort((a, b) => s.ground.cells[a].t - s.ground.cells[b].t);
  for (const k of keys.slice(0, keys.length - 400)) delete s.ground.cells[k];
}

function depositManure(s, b, home, kg, nKg) {
  if (kg <= 0 && nKg <= 0) return;
  s.totals.manureKg += kg; s.totals.manureNKg += nKg;
  if (home && b.location === home.id && !home.cat.confines) {
    const f = s.fx[home.id]; f.litterKg += kg; f.litterNKg += nKg;
  } else if (home && home.cat.confines) {
    const cl = tractorCell(s, home), a = cl.w * cl.d;
    cl.manureKgM2 += kg / a; cl.nGm2 += (nKg * 1000) / a; cl.t = s.lastStepT || 0;
  } else {
    const r = s.ground.range; r.manureKgM2 += kg / r.areaM2; r.nGm2 += (nKg * 1000) / r.areaM2;
  }
}

// The feeder or waterer this bird can reach right now (the fullest). `any` finds one even if empty.
function pickSource(s, idx, b, home, field, any = false) {
  const list = field === 'feedKg' ? idx.feeders : idx.waterers;
  let best = null, bv = any ? -1 : 1e-9;
  for (const e of list) {
    if (!reachable(s, idx, b, home, e)) continue;
    const f = s.fx[e.id], v = field === 'waterL' ? f.waterL - f.iceL : f.feedKg;
    if (v > bv) { best = e; bv = v; }
  }
  return best;
}
function reachable(s, idx, b, home, e) {
  const owner = idx.owner[e.id];
  if (e.cat.movable || (owner && idx.byId[owner] && idx.byId[owner].cat.movable)) return home && (owner === home.id || e.id === home.id);
  if (b.phase === 'coop' || b.phase === 'roost') return owner === (home && home.id);
  if (b.phase === 'tractor') return false;
  // on range: anything outside a tractor; inside a coop only if its door is open
  if (owner) return !!s.fx[owner].doorOpen || owner === b.location;
  return true;
}

// ---------------------------------------------------------------------------------------- laying
export function eggIntervalH(b, t) {
  const yrs = Math.max(0, (ageDays(b, t) / 7 - pointOfLayWeeks(b)) / 52);
  return BREEDS[b.breed].eggIntervalH + 0.4 * yrs;               // the interval lengthens as hens age
}
export function eggMassG(b, t) {
  const w = ageDays(b, t) / 7 - pointOfLayWeeks(b);
  const young = 0.8 + 0.2 * clamp(w / 10, 0, 1);                // pullet eggs are small for the first couple of months
  return BREEDS[b.breed].eggG * young * (1 + 0.04 * clamp(w / 52, 0, 3)) * Math.sqrt(sizeFactor(b));
}
// Photoperiod response: little below about 10 h of light, about half at 12 h, full at 14-15 h and over.
export const photoFactor = (photoH) => smoothstep(9.5, 14.5, photoH);
// Age: nothing before point of lay, a rise to peak over about six weeks, then a slow decline
// (persistency: production falls about 15-20% a year).
export function ageFactor(b, t) {
  const w = ageDays(b, t) / 7 - pointOfLayWeeks(b);
  if (w < 0) return 0;
  if (w < 6) return 0.35 + 0.65 * (w / 6);
  return Math.exp(-0.0042 * (w - 6));
}
// Probability that an ovulation the hen is ready for actually happens, from everything that drives lay.
export function layDrive(b, t, photoH, cond, dehyd) {
  const br = BREEDS[b.breed];
  const peak = clamp(br.eggsPerYear / 365 / LAY_CAL, 0, 1);
  const nutrition = clamp((cond - 0.88) / 0.08, 0, 1) * clamp(1 + b.energy / 1.0, 0, 1);
  const water = clamp(1 - (dehyd - 0.02) / 0.04, 0, 1);
  return clamp(peak * layFactor(b) * ageFactor(b, t) * photoFactor(photoH) * nutrition * water * (1 - 0.8 * b.stress) * b.health * b.health, 0, 1);
}
// Calibration of the breed figure to the ovulation model: the mean hen-day rate of a hen with drive 1 over her
// first laying year (sequence limits from the open period and the 25-26 h interval, the rise to peak and the
// decline after). Fitted once against the model itself (test/chickens.test.mjs checks the result).
export const LAY_CAL = 0.72;

function stepLaying(c, s, b, home, ld, idx, hour, t, dt, today, rng, cond, dehyd) {
  const end = t + dt;
  // an egg due in this step is laid at its time
  if (b.eggs.nextT !== null && b.eggs.nextT < end) {
    const laidT = b.eggs.nextT;
    layEgg(c, s, b, home, idx, laidT, t);
    // next ovulation about half an hour after laying, if it still falls inside the open period
    const candT = laidT + 0.5 * HOUR;
    const candH = hourOfDay(candT) + (dayIndex(candT) - dayIndex(laidT)) * 24;
    if (candH <= ld.onH + OPEN_PERIOD_H && rng.float() < layDrive(b, t, ld.photoH, cond, dehyd)) {
      b.eggs.nextT = candT + eggIntervalH(b, t) * HOUR;
    } else {
      b.eggs.nextT = null;
      b.eggs.tryDay = today;                                      // a pause day: try again tomorrow morning
    }
  }
  // after a pause, the first ovulation comes in the morning, soon after lights-on
  if (b.eggs.nextT === null && b.eggs.tryDay !== today && hour >= ld.onH + 0.5) {
    b.eggs.tryDay = today;
    if (rng.float() < layDrive(b, t, ld.photoH, cond, dehyd)) b.eggs.nextT = t + rng.float() * HOUR + eggIntervalH(b, t) * HOUR;
  }
}

function layEgg(c, s, b, home, idx, laidT, t) {
  let nestId = null, where = 'range';
  const canNest = home && (home.cat.confines || b.location === home.id || s.fx[home.id].doorOpen);
  if (canNest) {
    const nests = home.cat.nests ? [home.id, ...home.nestIds] : home.nestIds;
    let best = null, bn = Infinity;
    for (const nid of nests) { const n = s.eggs.reduce((a, e) => a + (e.nestId === nid ? 1 : 0), 0); if (n < bn) { bn = n; best = nid; } }
    if (best) { nestId = best; where = 'nest'; } else where = 'floor';
  }
  const fertile = b.lastMatedT !== null && laidT - b.lastMatedT < FERTILE_DAYS * DAY;
  const massG = Math.round(eggMassG(b, t) * 10) / 10;
  const egg = { id: newId(c.rng('egg'), 'e', null), laidT, nestId, where, fertile, hen: b.id, sire: fertile ? b.matedBy : null, massG };
  s.eggs.push(egg);
  b.eggs.laidTotal++;
  b.eggs.lastT = laidT;
  b.eggs.recent.push(laidT); if (b.eggs.recent.length > 8) b.eggs.recent.shift();
  s.totals.eggs++; s.totals.eggMassKg += massG / 1000;
  s.flock.eggsToday++;
  c.emit('chickens.egg', { hen: b.id, name: b.name, nestId, where });
}

// ---------------------------------------------------------------------------------------- mood and words
function moodOf(b, awake, cond, dehyd, accessFeed, t) {
  if (b.out) return 'miserable';
  if (dehyd > 0.04) return 'thirsty';
  if (cond < 0.93 || (awake && !accessFeed && b.hungerKg < 0.002 && b.phase !== 'range')) return 'hungry';
  if (b.health < 0.6) return 'unwell';
  if (b.roosting) return 'asleep';
  if (b.stress > 0.35) return 'stressed';
  if (b.phase === 'coop') return 'restless';
  if (b.eggs.lastT && t - b.eggs.lastT < 8 * HOUR) return 'proud';
  if (b.stress < 0.12 && (b.phase === 'range' || b.phase === 'tractor')) return 'happy';
  return 'content';
}

function since(t0, t) {
  const h = (t - t0) / HOUR, d0 = dayIndex(t0), d = dayIndex(t);
  if (d === d0) return h < 1 ? 'for a little while' : hourOfDay(t0) < 12 ? 'since this morning' : 'since this afternoon';
  if (d - d0 === 1) return 'since yesterday';
  return 'for ' + (d - d0) + ' days';
}
const her = (b) => (b.sex === 'rooster' ? 'his' : 'her');
const she = (b) => (b.sex === 'rooster' ? 'he' : 'she');
const cap1 = (x) => x.charAt(0).toUpperCase() + x.slice(1);

function feedersOf(s, idx, b) {
  const home = b.home && idx.byId[b.home];
  return idx.feeders.filter((e) => (home && home.cat.confines ? e.id === home.id || idx.owner[e.id] === home.id : !(e.cat.movable || (idx.owner[e.id] && idx.byId[idx.owner[e.id]].cat.movable))));
}
function waterersOf(s, idx, b) {
  const home = b.home && idx.byId[b.home];
  return idx.waterers.filter((e) => (home && home.cat.confines ? e.id === home.id || idx.owner[e.id] === home.id : !(e.cat.movable || (idx.owner[e.id] && idx.byId[idx.owner[e.id]].cat.movable))));
}

function statusLine(s, b, idx, t, days, wild) {
  const n = b.name, home = b.home && idx.byId[b.home];
  const ld = home ? days[home.id] : wild;
  const fs = feedersOf(s, idx, b), ws = waterersOf(s, idx, b);
  const feedEmpty = fs.length && fs.every((e) => s.fx[e.id].feedKg <= 1e-6);
  const waterDry = ws.length && ws.every((e) => s.fx[e.id].waterL - s.fx[e.id].iceL <= 1e-6);
  const frozen = waterDry && ws.some((e) => s.fx[e.id].iceL > 0.05);
  const ageW = ageDays(b, t) / 7;
  if (b.out) return n + ' could not get into the coop and is roosting outside: the door was shut before ' + she(b) + ' went in.';
  if (b.mood === 'thirsty') {
    if (!ws.length) return n + ' is thirsty: there is no waterer.';
    const since0 = Math.min(...ws.map((e) => s.fx[e.id].dryT ?? t));
    return n + ' is thirsty: the waterer ' + (frozen ? 'is frozen solid' : 'has been empty ' + since(since0, t)) + '.';
  }
  if (b.mood === 'hungry' || (b.cond < 0.95 && feedEmpty)) {
    if (!fs.length) return n + ' is hungry: there is no feeder' + (b.phase === 'range' ? ', only what ' + she(b) + ' can find on the range' : '') + '.';
    if (feedEmpty) {
      const since0 = Math.min(...fs.map((e) => s.fx[e.id].emptySinceT ?? t));
      return n + ' is hungry: the feeder has been empty ' + since(since0, t) + '.';
    }
    return n + ' is thin and catching up on ' + her(b) + ' food. Keep the feeder full and ' + she(b) + ' will fill out.';
  }
  if (b.health < 0.6) return n + ' is unwell and needs good food, water and quiet to recover.';
  if (!home) return n + ' has no coop and roosts wherever ' + she(b) + ' can. A coop would settle ' + (b.sex === 'rooster' ? 'him' : 'her') + '.';
  if (b.roosting) {
    const close = home && !home.cat.confines && s.fx[home.id].doorOpen;
    return n + ' is asleep on the roost' + (close ? '. The door is still open.' : '.');
  }
  if (b.phase === 'coop') return n + ' is waiting by the door to be let out.';
  if (b.sex === 'rooster') return n + ' is keeping an eye on the hens' + (b.phase === 'tractor' ? ' in the tractor.' : '.') ;
  const pol = pointOfLayWeeks(b);
  if (ageW < pol) return n + ' is a pullet, ' + Math.floor(ageW) + ' weeks old. ' + cap1(BREEDS[b.breed].name) + 's start laying at about ' + Math.round(BREEDS[b.breed].pointOfLayWeeks) + ' weeks.';
  if (b.eggs.lastT && t - b.eggs.lastT < 10 * HOUR && dayIndex(b.eggs.lastT) === dayIndex(t)) return n + ' laid an egg this morning and is very pleased about it.';
  const week = b.eggs.recent.filter((x) => t - x < 7 * DAY).length;
  if (week === 0 && ld.photoH < 12.5) return n + ' is resting from laying: the days are short (' + ld.photoH.toFixed(1) + ' hours of light).';
  if (week === 0 && b.stress > 0.3) return n + ' is too unsettled to lay.';
  if (week === 0 && b.eggs.laidTotal === 0) return n + ' is ready to lay any day now.';
  if (week >= 5) return n + ' is laying beautifully: ' + week + ' eggs this week. ' + cap1(she(b)) + ' ' + b.quirk + '.';
  if (week >= 1) return n + ' has laid ' + week + ' egg' + (week > 1 ? 's' : '') + ' this week. ' + cap1(she(b)) + ' ' + b.quirk + '.';
  return n + ' is foraging. ' + cap1(she(b)) + ' ' + b.quirk + '.';
}

const nameList = (names) => (names.length <= 2 ? names.join(' and ') : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more');

function computeIssues(s, idx, t, W, days, wild) {
  const out = [], birds = Object.values(s.birds);
  if (!birds.length) return out;
  const hens = birds.filter((b) => b.sex === 'hen');
  if (!idx.coops.length) out.push({ id: 'no-coop', severity: 'bad', reason: 'Your birds have no coop and roost wherever they can.', fix: 'Place a coop or a chicken tractor (Chickens panel, K).' });
  const feeders = idx.feeders;
  if (!feeders.length) out.push({ id: 'no-feeder', severity: 'warn', reason: 'There is no feeder.', fix: 'Place a feeder near the coop.' });
  for (const e of feeders) {
    const f = s.fx[e.id];
    if (f.feedKg <= 1e-6 && f.emptySinceT !== null) out.push({ id: 'feeder-empty:' + e.id, severity: 'warn', reason: 'The ' + e.cat.name.toLowerCase() + ' has been empty ' + since(f.emptySinceT, t) + '.', fix: 'Fill it with layer feed.' });
  }
  const dailyKg = birds.reduce((a, b) => a + 0.12 * Math.pow(b.massKg / 2.2, 0.75), 0);
  if (feeders.length && s.flock.feedKg > 1e-6 && s.flock.feedKg < dailyKg) out.push({ id: 'feed-low', severity: 'info', reason: 'The feed will run out within a day.', fix: 'Top up the feeder.' });
  if (!idx.waterers.length) out.push({ id: 'no-waterer', severity: 'bad', reason: 'There is no waterer.', fix: 'Place a water fount near the coop.' });
  for (const e of idx.waterers) {
    const f = s.fx[e.id];
    if (f.waterL - f.iceL <= 1e-6 && f.dryT !== null) out.push({ id: 'water-dry:' + e.id, severity: 'bad', reason: f.iceL > 0.05 ? 'The water has frozen.' : 'The waterer has been empty ' + since(f.dryT, t) + '.', fix: f.iceL > 0.05 ? 'Bring fresh water (and think about a heated base for winter).' : 'Fill it with fresh water.' });
    else if (f.iceL > 0.3 * f.waterL && f.waterL > 0) out.push({ id: 'water-freezing:' + e.id, severity: 'info', reason: 'The water is starting to freeze.', fix: 'Swap in fresh water in the morning.' });
  }
  const out_ = birds.filter((b) => b.out);
  if (out_.length) out.push({ id: 'locked-out', severity: 'bad', reason: nameList(out_.map((b) => b.name)) + (out_.length > 1 ? ' are' : ' is') + ' shut out of the coop for the night.', fix: 'Open the coop door: they will go in by themselves.' });
  const hour = hourOfDay(t);
  for (const co of idx.coops) {
    if (co.cat.confines) {
      const cl = s.ground.cells[s.fx[co.id].cell];
      if (cl && cl.forageGm2 < 0.35 * PASTURE_K) out.push({ id: 'tractor-bare:' + co.id, severity: 'info', reason: 'The ground under the tractor is scratched bare (and well manured).', fix: 'Move the tractor onto fresh grass.' });
      continue;
    }
    const f = s.fx[co.id], ld = days[co.id];
    const home = birds.filter((b) => b.home === co.id);
    if (!home.length) continue;
    if (f.doorOpen && (hour >= ld.duskH + 0.5 || hour < ld.dawnH - 0.5) && home.every((b) => b.location === co.id)) out.push({ id: 'door-open-night:' + co.id, severity: 'info', reason: 'Everyone is in, and the coop door is still open.', fix: 'Shut the door for the night to keep foxes out.' });
    if (!f.doorOpen && hour >= ld.dawnH + 1 && hour < ld.duskH && home.some((b) => b.phase === 'coop')) out.push({ id: 'door-shut-day:' + co.id, severity: 'info', reason: 'The hens are waiting to be let out.', fix: 'Open the coop door.' });
    if (home.length > co.capacity) out.push({ id: 'crowded:' + co.id, severity: 'warn', reason: 'The coop is crowded: ' + home.length + ' birds in room for ' + co.capacity + '.', fix: 'Add another coop or tractor.' });
    if (home.length * ROOST_M_PER_BIRD > co.roostM + 1e-9) out.push({ id: 'roost-short:' + co.id, severity: 'info', reason: 'There is not quite enough roost for everyone.', fix: 'Add a roost bar inside the coop.' });
    if (!co.nestIds.length && home.some((b) => b.sex === 'hen')) out.push({ id: 'no-nest:' + co.id, severity: 'warn', reason: 'There is no nest box, so eggs are laid on the floor or hidden outside.', fix: 'Place a nest box beside the coop.' });
    if (f.litterKg > 3 + 1.5 * f.bedKg) out.push({ id: 'litter:' + co.id, severity: 'info', reason: 'The coop litter is getting dirty (' + f.litterKg.toFixed(1) + ' kg of droppings).', fix: 'Clean it out onto the compost, or add fresh straw.' });
  }
  if (s.eggs.length) out.push({ id: 'eggs', severity: 'info', reason: s.eggs.length + ' egg' + (s.eggs.length > 1 ? 's are' : ' is') + ' waiting to be collected.', fix: 'Collect the eggs.' });
  const outside = s.eggs.filter((e) => e.where !== 'nest').length;
  if (outside) out.push({ id: 'eggs-outside', severity: 'info', reason: outside + ' egg' + (outside > 1 ? 's were' : ' was') + ' laid outside a nest.', fix: 'Give them a nest box and keep them in until mid-morning.' });
  const laid = hens.filter((b) => ageDays(b, t) / 7 >= pointOfLayWeeks(b));
  const anyLit = idx.coops.some((co) => s.fx[co.id].light && s.fx[co.id].light.on);
  const ld = idx.coops.length ? days[idx.coops[0].id] : wild;
  if (laid.length && !anyLit && ld.photoH < 12.5) out.push({ id: 'short-days', severity: 'info', reason: 'The days are short (' + ld.photoH.toFixed(1) + ' hours of light). Hens lay little below about 12 hours.', fix: 'Let them rest (it is natural), or put a light in the coop on a timer for 15 hours.' });
  const thin = birds.filter((b) => b.cond < 0.9);
  if (thin.length) out.push({ id: 'thin', severity: 'warn', reason: nameList(thin.map((b) => b.name)) + (thin.length > 1 ? ' are' : ' is') + ' underweight.', fix: 'Keep the feeder full; they recover in a week or two.' });
  return out;
}

// ---------------------------------------------------------------------------------------- commands
const bad = (reason) => ({ ok: false, reason });

function coopsFor(c, id, pred) {
  const idx = fixtureIndex(c);
  if (id) { const e = idx.byId[id]; return e && (!pred || pred(e)) ? [e] : []; }
  return idx.all.filter((e) => !pred || pred(e));
}

export function starterFixtures(x, z, yawRad = 0) {
  // coop centred on (x, z); feeder and waterer beside its door side, nest box on its flank
  const cs = Math.cos(yawRad), sn = Math.sin(yawRad);
  const at = (lx, lz) => ({ x: Math.round((x + lx * cs + lz * sn) * 100) / 100, z: Math.round((z - lx * sn + lz * cs) * 100) / 100 });
  return [
    { fixture: 'coop_small', ...at(0, 0), yawRad },
    { fixture: 'nest_box', ...at(1.45, -0.2), yawRad },
    { fixture: 'feeder_hanging', ...at(-0.7, 1.6), yawRad },
    { fixture: 'waterer_fount', ...at(0.7, 1.7), yawRad },
  ];
}

function placeOwn(c, spec) {
  const cat = FIXTURES_CHICKENS[spec.fixture];
  if (!cat) return null;
  let id = spec.id;
  if (!id || c.s.own.some((p) => p.id === id)) id = 'ck' + c.s.nextFx++;
  const p = { id, kind: 'fixture', fixture: cat.id, name: cat.name, a: { x: +spec.x || 0, z: +spec.z || 0 }, b: { x: +spec.x || 0, z: +spec.z || 0 },
    y0: +spec.y || 0, y1: (+spec.y || 0) + cat.dims.h, yawRad: +spec.yawRad || 0, width: cat.dims.w, depth: cat.dims.d, settings: {}, ports: cat.ports.map((q) => ({ ...q })) };
  c.s.own.push(p);
  c.s.fxVersion++;
  return p;
}

const BIRD_ITEM = (sex, ageWeeks) => (sex === 'rooster' ? 'chicken_rooster' : ageWeeks < 16 ? 'chicken_started' : ageWeeks < 26 ? 'chicken_pullet' : 'chicken_hen');

const commands = {
  // { breed, count = 1, ageWeeks = 18, sex = 'hen' }
  'chickens.buy': (c, p = {}) => {
    const s = c.s, br = BREEDS[p.breed];
    if (!br) return bad('unknown breed');
    const count = Math.floor(p.count ?? 1), ageWeeks = p.ageWeeks ?? 18, sex = p.sex === 'rooster' ? 'rooster' : 'hen';
    if (!(count >= 1)) return bad('count must be at least 1');
    if (Object.keys(s.birds).length + count > MAX_BIRDS) return bad('that would be more than ' + MAX_BIRDS + ' birds');
    if (!(ageWeeks >= 8)) return bad('chicks under 8 weeks need a brooder (coming soon)');
    if (ageWeeks > 260) return bad('too old');
    const item = BIRD_ITEM(sex, ageWeeks);
    const r = itemBuy(c, item, count);
    if (!r.ok) return r;
    itemRemove(c, item, count);                                   // the bird leaves the stock and joins the flock
    const rng = c.rng('birth'), ids = [];
    const bornT = c.t - ageWeeks * 7 * DAY;
    for (let i = 0; i < count; i++) { const b = makeBird(s, rng, br.id, sex, bornT, c.t); s.birds[b.id] = b; ids.push(b.id); }
    assignHomes(s, fixtureIndex(c));
    for (const id of ids) { const b = s.birds[id]; const home = b.home && fixtureIndex(c).byId[b.home]; if (home && (home.cat.confines || !s.fx[home.id].doorOpen)) b.location = home.id; }
    s.flock.count = Object.keys(s.birds).length;
    c.emit('chickens.arrived', { ids });
    return { ok: true, ids, costUsd: r.costUsd };
  },
  'chickens.buySupply': (c, p = {}) => {
    if (!ITEMS_CHICKENS[p.id] && !ITEMS[p.id]) return bad('unknown item');
    return itemBuy(c, p.id, p.qty);
  },
  // { id? (one feeder or a tractor), kg? (default: fill to the brim from what is in stock) }
  'chickens.fillFeeder': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.feedCapKg);
    if (!list.length) return bad('no feeder');
    let have = haveItem(c.state, 'layer_feed'), put = 0;
    if (have <= 1e-9) return bad('no layer feed in stock');
    for (const e of list) {
      const f = c.s.fx[e.id], room = e.cat.feedCapKg - f.feedKg;
      let kg = Math.min(room, have, p.kg !== undefined ? Math.max(0, p.kg - put) : Infinity);
      kg = Math.floor(kg * 1000) / 1000;
      if (kg <= 0) continue;
      const r = itemRemove(c, 'layer_feed', kg);
      if (!r.ok) break;
      f.feedKg = round6(f.feedKg + kg); have -= kg; put += kg; f.emptySinceT = null;
      c.s.totals.feedFilledKg += kg;
    }
    if (put <= 0) return bad('the feeder is already full');
    c.s.flock.feedKg = round4(c.s.flock.feedKg + put);
    for (const id in c.s.birds) c.s.birds[id].fedT = c.t;
    c.emit('chickens.fed', { kg: put });
    return { ok: true, kg: round4(put) };
  },
  // { id?, litres? }. Water comes from the water system when there is one (water.draw), otherwise from the tap or well by bucket.
  'chickens.fillWaterer': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.waterCapL);
    if (!list.length) return bad('no waterer');
    let put = 0;
    const hasWater = c.sim && c.sim.handlers.has('water.draw');
    for (const e of list) {
      const f = c.s.fx[e.id];
      const ice = f.iceL; f.waterL -= ice; f.iceL = 0;                // knock out the ice
      if (ice > 0) c.s.totals.waterIceDumpedL = (c.s.totals.waterIceDumpedL || 0) + ice;
      let want = Math.min(e.cat.waterCapL - f.waterL, p.litres !== undefined ? Math.max(0, p.litres - put) : Infinity);
      if (want <= 0) continue;
      if (hasWater) {
        const r = c.sim.handlers.get('water.draw');
        const ctx = { sim: c.sim, state: c.state, t: c.t, tick: c.tick, dt: 0, get s() { return c.state.sys[r.sys.name]; }, get: c.get, rng: c.rng, emit: c.emit };
        const got = r.fn(ctx, { id: e.id, litres: want });
        want = Math.max(0, typeof got === 'number' ? got : got && got.litres !== undefined ? got.litres : got && got.suppliedL !== undefined ? got.suppliedL : want);
      }
      f.waterL = round6(f.waterL + want); put += want; f.dryT = null;
      c.s.totals.waterFilledL += want;
    }
    if (put <= 0) return bad(hasWater ? 'no water came from the tap' : 'the waterer is already full');
    c.emit('chickens.watered', { litres: put });
    return { ok: true, litres: round4(put) };
  },
  'chickens.setDoor': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.door);
    if (!list.length) return bad('no coop door');
    for (const e of list) c.s.fx[e.id].doorOpen = !!p.open;
    c.emit('chickens.door', { open: !!p.open });
    return { ok: true, open: !!p.open };
  },
  // { id?, on, hours = 15 }: a light in the coop on a timer, adding light before dawn up to `hours` of day
  'chickens.setLight': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.shelter);
    if (!list.length) return bad('no coop');
    const hours = clamp(p.hours ?? 15, 8, 18);
    for (const e of list) {
      const f = c.s.fx[e.id]; f.light = { on: !!p.on, hours };
      if (c.sim && c.sim.handlers.has('electrical.setLoad')) {
        const h = c.sim.handlers.get('electrical.setLoad');
        const ctx = { sim: c.sim, state: c.state, t: c.t, tick: c.tick, dt: 0, get s() { return c.state.sys[h.sys.name]; }, get: c.get, rng: c.rng, emit: c.emit };
        h.fn(ctx, { id: e.id + ':light', ratedW: 9, on: !!p.on, priority: 3 });
      }
    }
    return { ok: true, on: !!p.on, hours };
  },
  // { id?, x, z } or { id?, dx, dz }; default moves it one length forward onto fresh ground
  'chickens.moveTractor': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.movable);
    if (!list.length) return bad('no tractor');
    const e = list[0], f = c.s.fx[e.id];
    let x, z;
    if (p.x !== undefined) { x = +p.x; z = +p.z; }
    else if (p.dx !== undefined) { x = e.x + +p.dx; z = e.z + +(p.dz || 0); }
    else { x = e.x + Math.sin(e.yaw) * e.cat.dims.d; z = e.z + Math.cos(e.yaw) * e.cat.dims.d; }
    f.x = Math.round(x * 100) / 100; f.z = Math.round(z * 100) / 100;
    const own = c.s.own.find((q) => q.id === e.id);
    if (own) { own.a = { x: f.x, z: f.z }; own.b = { x: f.x, z: f.z }; }
    c.s.fxVersion++;
    c.emit('chickens.tractorMoved', { id: e.id, x: f.x, z: f.z });
    return { ok: true, x: f.x, z: f.z };
  },
  // { nestId? }: eggs go into stock as `egg`
  'chickens.collectEggs': (c, p = {}) => {
    const s = c.s;
    const take = s.eggs.filter((e) => !p.nestId || e.nestId === p.nestId);
    if (!take.length) return { ok: true, count: 0 };
    const r = itemAdd(c, 'egg', take.length);
    if (!r.ok) return r;
    s.eggs = s.eggs.filter((e) => !take.includes(e));
    s.flock.eggsWaiting = s.eggs.length;
    s.totals.collected = (s.totals.collected || 0) + take.length;
    c.emit('chickens.collected', { count: take.length, fertile: take.filter((e) => e.fertile).length });
    return { ok: true, count: take.length, fertile: take.filter((e) => e.fertile).length };
  },
  // { kg }: kitchen scraps from stock, thrown down for the flock
  'chickens.feedScraps': (c, p = {}) => {
    const kg = +p.kg || 0;
    if (!(kg > 0)) return bad('nothing to give');
    const r = itemRemove(c, 'kitchen_scraps', kg);
    if (!r.ok) return bad('no kitchen scraps in stock');
    c.s.flock.scrapsKg += kg; c.s.totals.scrapsGivenKg += kg;
    c.emit('chickens.fed', { scrapsKg: kg });
    return { ok: true, kg };
  },
  'chickens.addBedding': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.shelter && !e.cat.movable);
    if (!list.length) return bad('no coop');
    const kg = p.kg ?? 5;
    const r = itemRemove(c, 'straw_bedding', kg);
    if (!r.ok) return bad('no straw in stock');
    c.s.fx[list[0].id].bedKg += kg;
    return { ok: true, kg };
  },
  // Clean the coop out. The litter (bedding and droppings) is reported for the compost iteration.
  'chickens.cleanCoop': (c, p = {}) => {
    const list = coopsFor(c, p.id, (e) => !!e.cat.shelter && !e.cat.movable);
    if (!list.length) return bad('no coop');
    let kg = 0, nKg = 0;
    for (const e of list) { const f = c.s.fx[e.id]; kg += f.litterKg + f.bedKg; nKg += f.litterNKg; f.litterKg = 0; f.litterNKg = 0; f.bedKg = 0; }
    c.s.totals.litterOutKg = (c.s.totals.litterOutKg || 0) + kg;
    c.emit('chickens.litter', { kg, nKg });
    return { ok: true, kg: round4(kg), nKg: round6(nKg) };
  },
  // Temporary placement until the fixture tool lands: { pieces: [{ fixture, x, z, yawRad, id? }] }
  'chickens.placeFixtures': (c, p = {}) => {
    const placed = [];
    for (const spec of p.pieces || []) { const q = placeOwn(c, spec); if (q) placed.push(q.id); }
    if (!placed.length) return bad('nothing placed');
    assignHomes(c.s, fixtureIndex(c));
    c.emit('chickens.placed', { ids: placed });
    return { ok: true, ids: placed };
  },
  'chickens.placeStarter': (c, p = {}) => commands['chickens.placeFixtures'](c, { pieces: starterFixtures(+p.x || 0, +p.z || 0, +p.yawRad || 0) }),
  'chickens.removeFixture': (c, p = {}) => {
    const i = c.s.own.findIndex((q) => q.id === p.id);
    if (i < 0) return bad('not one of the panel\'s fixtures');
    c.s.own.splice(i, 1); delete c.s.fx[p.id]; c.s.fxVersion++;
    for (const id in c.s.birds) if (c.s.birds[id].home === p.id) { c.s.birds[id].home = null; c.s.birds[id].location = 'range'; }
    s_eggsDrop(c.s, p.id);
    return { ok: true };
  },
  'chickens.rename': (c, p = {}) => {
    const b = c.s.birds[p.id];
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    if (!b || !name) return bad('no such bird or no name');
    b.name = name;
    return { ok: true, name };
  },
  'chickens.setRange': (c, p = {}) => {
    const a = +p.areaM2;
    if (!(a >= 10 && a <= 20000)) return bad('range area must be 10 to 20000 m2');
    const r = c.s.ground.range; r.nGm2 *= r.areaM2 / a; r.manureKgM2 *= r.areaM2 / a; r.areaM2 = a;
    return { ok: true, areaM2: a };
  },
};
function s_eggsDrop(s, nestId) { for (const e of s.eggs) if (e.nestId === nestId) { e.nestId = null; e.where = 'floor'; } }

// Pure data for the shared overlay add-on: forage cover and manure nitrogen on the ground the birds use.
export function overlayData(state) {
  const s = state.sys ? state.sys.chickens : state;
  if (!s) return { cells: [], range: null };
  return {
    range: { ...s.ground.range, forage: s.ground.range.forageGm2 / PASTURE_K },
    cells: Object.values(s.ground.cells).map((c) => ({ x: c.x, z: c.z, w: c.w, d: c.d, yaw: c.yaw, forage: c.forageGm2 / PASTURE_K, nGm2: c.nGm2 })),
  };
}

export const chickensSystem = () => ({
  name: 'chickens',
  every: EVERY,
  init: () => initChickens(),
  step,
  commands,
  // for add-ons (reached through sim.systems): catalogs and helpers that carry no state
  api: { BREEDS, FIXTURES_CHICKENS, ITEMS_CHICKENS, starterFixtures, overlayData, haveItem, PASTURE_K, phenotypeLook },
});
