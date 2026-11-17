// Landscaping content: the surfaces you can lay, the stones you can set, the plants a nursery sells, and the tools.
// Figures are real where they matter (2026 US retail prices, rounded; volumes and depths from landscaping guides),
// approximate where marked.
//
// A shovelful: a round-point shovel lifts about 5 to 8 L of loosened soil (approx). The game's scoop is 7 L, and a
// setting (earth per scoop) lets the player move two or four times that per gesture to take the tedium out of big
// jobs, the way pieces-per-gesture does for framing.
//
// Planting holes (nursery and extension planting guides): dig about as deep as the root ball and two to three times
// as wide. A 1-gallon perennial wants a hole about 15 cm deep, a 3-gallon shrub about 25 cm, a 15-gallon tree about
// 35 cm. A path or patio base is dug out 5 to 10 cm and filled back to grade with gravel.

export const SCOOP_M3 = 0.007;
export const SCOOP_SCALES = Object.freeze([1, 2, 4]);
// grass seed: about 40 g per square metre for a new lawn (seed-bag rates for cool-season mixes, approx); a sown lawn
// covers over in about three weeks of growing weather
export const LAWN = Object.freeze({ seedKgPerM2: 0.04, coverDays: 21 });

// Surfaces. `item`: what laying it spends, and in what unit; m3 per unit for bulk. layer: laid on top, raking keeps it.
export const SURFACES = Object.freeze({
  soil: { id: 'soil', name: 'Bare soil' },
  lawn_sown: { id: 'lawn_sown', name: 'Sown lawn' },
  gravel: { id: 'gravel', name: 'Gravel', item: 'gravel', m3PerUnit: 1, layer: true, blurb: 'Pea gravel for paths and patios. Dig out the sod first, or the grass comes through' },
  bark: { id: 'bark', name: 'Bark mulch', item: 'bark_mulch', m3PerUnit: 0.001, layer: true, blurb: 'Shredded bark around shrubs and in borders: 5 to 8 cm deep keeps weeds down' },
  sand: { id: 'sand', name: 'Sand', item: 'sand', m3PerUnit: 1, layer: true, blurb: 'A bed for flagstones and pavers, or a sand pit' },
});
export const LAYERS = Object.freeze(['gravel', 'bark', 'sand']);

// Things set by hand on the ground. dims in metres: w (across), d (along), h (tall). sink: how much of it is set below
// the surface. stack: another of its kind can sit on top (a dry-stone wall course by course). spacing: the gap
// along a dragged line. qty: how much of the item one costs.
export const THINGS = Object.freeze({
  flagstone: { id: 'flagstone', name: 'Flagstone', item: 'flagstone_40', qty: 0.2, dims: { w: 0.5, d: 0.4, h: 0.04 }, sink: 0.02, spacing: 0.62, line: 'step', blurb: 'Stepping stones: a stride apart' },
  paver: { id: 'paver', name: 'Brick paver', item: 'paver_brick', qty: 1, dims: { w: 0.2, d: 0.1, h: 0.06 }, sink: 0.04, spacing: 0.205, line: 'tight', blurb: 'Clay brick for edging and paths' },
  wallstone: { id: 'wallstone', name: 'Wall stone', item: 'stone', qty: 1, dims: { w: 0.25, d: 0.2, h: 0.2 }, sink: 0.03, spacing: 0.26, line: 'tight', stack: true, blurb: 'Fieldstone for dry-stone walls and terraces: lay a course, then the next on top' },
  boulder: { id: 'boulder', name: 'Boulder', item: 'boulder', qty: 1, dims: { w: 0.7, d: 0.55, h: 0.45 }, sink: 0.12, spacing: 0.9, line: 'step', blurb: 'A feature rock, set a third into the ground' },
});

// Nursery plants. holeM: depth of hole the root ball needs. size: height and spread when bought and when mature (m),
// and the years it takes to fill out. Mature sizes are typical garden figures for the named variety.
export const PLANTS = Object.freeze({
  lavender: { id: 'lavender', name: 'Lavender', variety: 'Hidcote', item: 'plant_lavender', holeM: 0.12, buy: [0.2, 0.25], mature: [0.5, 0.6], years: 2, look: 'lavender', blurb: 'Silver leaves and purple spikes. Loves sun and dry, well-drained ground' },
  coneflower: { id: 'coneflower', name: 'Black-eyed Susan', variety: 'Goldsturm', item: 'plant_rudbeckia', holeM: 0.12, buy: [0.25, 0.25], mature: [0.65, 0.5], years: 1.5, look: 'daisy', blurb: 'Gold daisies from midsummer to frost' },
  grass: { id: 'grass', name: 'Feather reed grass', variety: 'Karl Foerster', item: 'plant_reedgrass', holeM: 0.15, buy: [0.4, 0.3], mature: [1.5, 0.6], years: 2, look: 'grass', blurb: 'Upright plumes that move in the wind' },
  boxwood: { id: 'boxwood', name: 'Boxwood', variety: 'Green Velvet', item: 'plant_boxwood', holeM: 0.2, buy: [0.35, 0.35], mature: [0.9, 0.9], years: 5, look: 'ball', blurb: 'Evergreen. Plant in a row for a low hedge' },
  hydrangea: { id: 'hydrangea', name: 'Hydrangea', variety: 'Annabelle', item: 'plant_hydrangea', holeM: 0.22, buy: [0.45, 0.45], mature: [1.2, 1.3], years: 3, look: 'hydrangea', blurb: 'Big white flower heads. Likes some afternoon shade and moist soil' },
  rose: { id: 'rose', name: 'Shrub rose', variety: 'Knock Out', item: 'plant_rose', holeM: 0.22, buy: [0.45, 0.4], mature: [1.1, 1.0], years: 3, look: 'rose', blurb: 'Red blooms all season with little fuss' },
  maple: { id: 'maple', name: 'Japanese maple', variety: 'Bloodgood', item: 'plant_maple', holeM: 0.32, buy: [1.4, 0.7], mature: [4.5, 4.5], years: 15, look: 'maple', blurb: 'A small tree with deep red leaves. Slow, and worth it' },
});

export const LANDSCAPE_CATEGORIES = Object.freeze([
  { id: 'landscape', name: 'Landscape supplies', blurb: 'Bark, sand, pavers, boulders and grass seed' },
  { id: 'nursery', name: 'Nursery', blurb: 'Perennials, shrubs and trees in pots' },
]);

const plant = (p, price, massKg) => ({ id: p.item, name: p.name + ' (' + p.variety + ')', category: 'nursery', unit: 'each', massKg, priceUsd: price, blurb: p.blurb });
// Gravel, flagstone and fieldstone are already in the catalog (src/sim/items.js); these are the rest.
export const ITEMS_LANDSCAPE = Object.freeze([
  { id: 'trowel', name: 'Hand trowel', category: 'tools_hand', unit: 'each', massKg: 0.3, priceUsd: 12, blurb: 'Planting holes and seed drills' },
  { id: 'rake', name: 'Bow rake', category: 'tools_hand', unit: 'each', massKg: 1.4, priceUsd: 28, blurb: 'Levels and smooths loose ground' },
  // bulk by the litre or cubic metre; shredded bark about 0.3 kg/L, sand 1.6 t/m3
  { id: 'bark_mulch', name: 'Shredded bark mulch', category: 'landscape', unit: 'L', massKg: 0.3, priceUsd: 0.06, blurb: SURFACES.bark.blurb },
  { id: 'sand', name: 'Sand (bulk)', category: 'landscape', unit: 'm3', massKg: 1600, priceUsd: 45, blurb: SURFACES.sand.blurb },
  { id: 'grass_seed', name: 'Lawn seed (sun and shade mix)', category: 'landscape', unit: 'kg', massKg: 1, priceUsd: 14, blurb: '40 g sows a square metre' },
  { id: 'paver_brick', name: 'Clay brick paver', category: 'landscape', unit: 'each', massKg: 2.3, priceUsd: 0.9, blurb: THINGS.paver.blurb },
  { id: 'boulder', name: 'Feature boulder', category: 'landscape', unit: 'each', massKg: 260, priceUsd: 85, blurb: THINGS.boulder.blurb },
  plant(PLANTS.lavender, 9, 1.5), plant(PLANTS.coneflower, 8, 1.5), plant(PLANTS.grass, 14, 2.5),
  plant(PLANTS.boxwood, 22, 6), plant(PLANTS.hydrangea, 32, 9), plant(PLANTS.rose, 28, 8), plant(PLANTS.maple, 90, 30),
]);
