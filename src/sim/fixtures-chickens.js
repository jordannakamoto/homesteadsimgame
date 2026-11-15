// Poultry equipment and supplies: the fixtures catalog and the items the chickens system needs.
// The orchestrator merges FIXTURES_CHICKENS into src/sim/fixtures.js and ITEMS_CHICKENS (with
// ITEM_CATEGORIES_CHICKENS) into the item catalog; until then the chickens system bridges them itself.
//
// Sizes follow common extension guidance (e.g. University of Maine / Penn State backyard-flock bulletins,
// Storey's Guide to Raising Chickens): about 0.37 m2 (4 sq ft) of coop floor per large-fowl bird,
// 20-25 cm of roost per bird, one nest box per four or five hens. Capacities are those of common
// hardware-store models (a 15 lb tube feeder holds about 7 kg; a 3 gallon fount holds about 11 L).
// Prices are 2026 US retail, rounded.

const f = (o) => Object.freeze({ category: 'poultry', system: 'chickens', ports: [], ...o, dims: Object.freeze(o.dims) });

export const FIXTURES_CHICKENS = Object.freeze({
  coop_small: f({
    id: 'coop_small', name: 'Small coop', priceUsd: 420, massKg: 85, dims: { w: 2.0, d: 1.5, h: 1.7 },
    shelter: true, floorAreaM2: 3.0, roostM: 2.0, door: true, ports: [{ id: 'light', type: 'power' }],
    blurb: 'A raised wooden coop with a pop door, a mesh front for air and a roost bar inside. Room for eight hens.',
  }),
  chicken_tractor: f({
    id: 'chicken_tractor', name: 'Chicken tractor', priceUsd: 380, massKg: 55, dims: { w: 1.5, d: 3.0, h: 1.2 },
    shelter: true, movable: true, confines: true, floorAreaM2: 4.5, roostM: 1.5, nests: 1, feedCapKg: 4, waterCapL: 8,
    blurb: 'A bottomless pen on skids with a roost, a nest and its own feeder and drinker. Move it to fresh grass every day or two.',
  }),
  feeder_hanging: f({
    id: 'feeder_hanging', name: 'Hanging feeder', priceUsd: 32, massKg: 2.2, dims: { w: 0.35, d: 0.35, h: 0.5 },
    feedCapKg: 7, wasteFrac: 0.03,          // tube feeders hung at back height waste a few per cent (troughs 10% or more)
    blurb: 'A tube feeder that holds about 7 kg of layer feed: four or five days for six hens.',
  }),
  waterer_fount: f({
    id: 'waterer_fount', name: 'Water fount', priceUsd: 35, massKg: 2.0, dims: { w: 0.4, d: 0.4, h: 0.45 },
    waterCapL: 11, ports: [{ id: 'in', type: 'water' }],
    blurb: 'A 3 gallon (11 L) double-walled drinker. It freezes in a hard frost.',
  }),
  nest_box: f({
    id: 'nest_box', name: 'Nest box', priceUsd: 45, massKg: 9, dims: { w: 0.8, d: 0.4, h: 0.45 },
    nests: 2, blurb: 'Two straw-lined nests with a lid that lifts from outside. One nest for every four or five hens.',
  }),
  roost_bar: f({
    id: 'roost_bar', name: 'Roost bar', priceUsd: 12, massKg: 3, dims: { w: 1.2, d: 0.06, h: 0.6 },
    roostM: 1.2, blurb: 'A 1.2 m perch: room for five or six hens side by side.',
  }),
});

export const ITEM_CATEGORIES_CHICKENS = Object.freeze([
  Object.freeze({ id: 'poultry', name: 'Poultry', blurb: 'Feed, bedding and birds' }),
]);

// Item specs in the shape items.js's add() takes (massKg given, as these have no registry material).
//   layer feed: complete layer ration, about 16-17% crude protein, 3.5-4% calcium, 11.5 MJ ME/kg (2750 kcal/kg), 89% dry matter
//   egg: a large egg is about 58 g (USDA large: at least 24 oz per dozen = 57 g)
//   straw: a small square bale is about 18-20 kg
// The bird items stand for a bird while it is being bought: stock.buy then stock.remove, so the money
// moves through the stock system and the bird itself lives in the chickens system.
export const ITEMS_CHICKENS = Object.freeze({
  layer_feed: Object.freeze({ id: 'layer_feed', name: 'Layer feed', category: 'poultry', unit: 'kg', massKg: 1, massKgPerUnit: 1, priceUsd: 0.55, blurb: 'Complete ration for laying hens, 16% protein. Sold by the kg (a 20 kg bag lasts six hens about a month)' }),
  egg: Object.freeze({ id: 'egg', name: 'Egg', category: 'poultry', unit: 'each', massKg: 0.058, massKgPerUnit: 0.058, priceUsd: 0.4, blurb: 'Fresh from your own hens' }),
  straw_bedding: Object.freeze({ id: 'straw_bedding', name: 'Straw bedding', category: 'poultry', unit: 'kg', massKg: 1, massKgPerUnit: 1, priceUsd: 0.45, blurb: 'Litter for the coop floor and nests. Goes on the compost when spent' }),
  kitchen_scraps: Object.freeze({ id: 'kitchen_scraps', name: 'Kitchen scraps', category: 'poultry', unit: 'kg', massKg: 1, massKgPerUnit: 1, priceUsd: 0, blurb: 'Peelings, crusts and leftovers. The hens love them' }),
  chicken_started: Object.freeze({ id: 'chicken_started', name: 'Started pullet (8-15 weeks)', category: 'poultry', unit: 'each', massKg: 1.0, massKgPerUnit: 1.0, priceUsd: 16, blurb: 'Feathered out and off heat' }),
  chicken_pullet: Object.freeze({ id: 'chicken_pullet', name: 'Point-of-lay pullet', category: 'poultry', unit: 'each', massKg: 1.8, massKgPerUnit: 1.8, priceUsd: 30, blurb: 'About to start laying' }),
  chicken_hen: Object.freeze({ id: 'chicken_hen', name: 'Laying hen', category: 'poultry', unit: 'each', massKg: 2.4, massKgPerUnit: 2.4, priceUsd: 25, blurb: 'In lay now' }),
  chicken_rooster: Object.freeze({ id: 'chicken_rooster', name: 'Rooster', category: 'poultry', unit: 'each', massKg: 3.2, massKgPerUnit: 3.2, priceUsd: 20, blurb: 'Fertile eggs, a watchful eye, and a dawn chorus' }),
});
