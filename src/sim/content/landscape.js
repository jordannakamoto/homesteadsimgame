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

// A wheelbarrow: a 6 cu ft contractor barrow is 170 L struck; a person wheels about 100 L of soil in it comfortably
// (approx). It is filled scoop by scoop and tipped all at once.
export const BARROW_M3 = 0.1;

// Newly planted shrubs: the root ball holds roughly 25 mm of water for the plant to use, and a plant loses about a
// quarter of the air temperature in mm a day in summer (a rule of thumb for reference evapotranspiration, approx).
// Watered in and kept moist for the first three weeks it roots out into the ground; after that it only needs help
// in a drought. A dry plant wilts and stops growing; it does not die.
export const ESTABLISH = Object.freeze({ rootMm: 25, days: 21, wiltAt: 0.15, growAt: 0.3, litresFull: 8 });

// Ponds (RHS, wildlife-pond guides): dig a bowl with shelves (a marginal shelf 20 to 30 cm deep, a deeper middle),
// lay a liner over the whole hole and up the sides, hide its edge under stone or turf, and fill with a hose. The
// liner keeps the water in; rain tops it up and it overflows at the lowest point of its rim. Open water evaporates
// about 3 to 5 mm a day in summer. A garden hose runs about 15 L a minute.
export const POND = Object.freeze({ hoseLpm: 15, evapMmWarm: 4, evapMmCool: 1 });

// Surfaces. `item`: what laying it spends, and in what unit; m3 per unit for bulk. layer: laid on top, raking keeps it.
export const SURFACES = Object.freeze({
  soil: { id: 'soil', name: 'Bare soil' },
  lawn_sown: { id: 'lawn_sown', name: 'Sown lawn' },
  gravel: { id: 'gravel', name: 'Gravel', item: 'gravel', m3PerUnit: 1, layer: true, blurb: 'Pea gravel for paths and patios. Dig out the sod first, or the grass comes through' },
  bark: { id: 'bark', name: 'Bark mulch', item: 'bark_mulch', m3PerUnit: 0.001, layer: true, blurb: 'Shredded bark around shrubs and in borders: 5 to 8 cm deep keeps weeds down' },
  sand: { id: 'sand', name: 'Sand', item: 'sand', m3PerUnit: 1, layer: true, blurb: 'A bed for flagstones and pavers, or a sand pit' },
  riverrock: { id: 'riverrock', name: 'River rock', item: 'river_rock', m3PerUnit: 1, layer: true, blurb: 'Rounded 5 to 15 cm stones: a dry creek bed for the rain to run along, or a pond beach' },
});
export const LAYERS = Object.freeze(['gravel', 'bark', 'sand', 'riverrock']);

// Things set by hand on the ground. dims in metres: w (across), d (along), h (tall). sink: how much of it is set below
// the surface. stack: another of its kind can sit on top (a dry-stone wall course by course). spacing: the gap
// along a dragged line. qty: how much of the item one costs.
export const THINGS = Object.freeze({
  flagstone: { id: 'flagstone', name: 'Flagstone', item: 'flagstone_40', qty: 0.2, dims: { w: 0.5, d: 0.4, h: 0.04 }, sink: 0.02, spacing: 0.62, line: 'step', blurb: 'Stepping stones: a stride apart' },
  paver: { id: 'paver', name: 'Brick paver', item: 'paver_brick', qty: 1, dims: { w: 0.2, d: 0.1, h: 0.06 }, sink: 0.04, spacing: 0.205, line: 'tight', blurb: 'Clay brick for edging and paths' },
  wallstone: { id: 'wallstone', name: 'Wall stone', item: 'stone', qty: 1, dims: { w: 0.25, d: 0.2, h: 0.2 }, sink: 0.03, spacing: 0.26, line: 'tight', stack: true, blurb: 'Fieldstone for dry-stone walls and terraces: lay a course, then the next on top' },
  boulder: { id: 'boulder', name: 'Boulder', item: 'boulder', qty: 1, dims: { w: 0.7, d: 0.55, h: 0.45 }, sink: 0.12, spacing: 0.9, line: 'step', blurb: 'A feature rock, set a third into the ground' },
  // a 4 x 6 landscape timber cut in half: raised beds, steps and low retaining walls, stacked course on course
  timber: { id: 'timber', name: 'Timber', item: 'landscape_timber', qty: 1, dims: { w: 1.2, d: 0.14, h: 0.1 }, sink: 0.02, spacing: 1.21, line: 'tight', stack: true, blurb: 'Treated 4 x 6 timber, 1.2 m: raised beds, steps and edging' },
  pathlight: { id: 'pathlight', name: 'Path light', item: 'path_light', qty: 1, dims: { w: 0.12, d: 0.12, h: 0.42 }, sink: 0.1, spacing: 1.6, line: 'step', glow: true, blurb: 'A solar light on a stake: it charges by day and glows at dusk' },
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
  // edible landscaping
  blueberry: { id: 'blueberry', name: 'Blueberry', variety: 'Bluecrop', item: 'plant_blueberry', holeM: 0.22, buy: [0.4, 0.35], mature: [1.6, 1.3], years: 6, look: 'blueberry', blurb: 'Berries in midsummer and red leaves in fall. Likes acid soil and a bark mulch' },
  apple: { id: 'apple', name: 'Dwarf apple', variety: 'Honeycrisp on M9', item: 'plant_apple', holeM: 0.35, buy: [1.5, 0.5], mature: [2.8, 2.4], years: 6, look: 'apple', blurb: 'A dwarf tree: fruit from the third year, picked from the ground' },
  iris: { id: 'iris', name: 'Yellow flag iris', variety: 'water margin', item: 'plant_iris', holeM: 0.1, buy: [0.4, 0.2], mature: [0.9, 0.5], years: 2, look: 'iris', wet: true, blurb: 'For the shallow shelf of a pond: roots in water, flowers in the air' },
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
  { id: 'wheelbarrow', name: 'Wheelbarrow (6 cu ft)', category: 'tools_hand', unit: 'each', massKg: 21, priceUsd: 129, blurb: 'Moves 100 L at a time: fill it scoop by scoop, tip it out where you need it' },
  { id: 'garden_hose', name: 'Garden hose (25 m)', category: 'tools_hand', unit: 'each', massKg: 4, priceUsd: 35, blurb: 'Fills a pond from the tap: about 15 L a minute' },
  { id: 'pond_liner', name: 'EPDM pond liner', category: 'landscape', unit: 'm2', massKg: 1.1, priceUsd: 9, blurb: 'Rubber liner that holds a pond. Lay it over the whole dug hole' },
  { id: 'river_rock', name: 'River rock (bulk)', category: 'landscape', unit: 'm3', massKg: 1500, priceUsd: 160, blurb: SURFACES.riverrock.blurb },
  { id: 'landscape_timber', name: 'Landscape timber, 4 x 6, 1.2 m', category: 'landscape', unit: 'each', massKg: 12, priceUsd: 7, blurb: THINGS.timber.blurb },
  { id: 'path_light', name: 'Solar path light', category: 'landscape', unit: 'each', massKg: 0.4, priceUsd: 14, blurb: THINGS.pathlight.blurb },
  { id: 'paver_brick', name: 'Clay brick paver', category: 'landscape', unit: 'each', massKg: 2.3, priceUsd: 0.9, blurb: THINGS.paver.blurb },
  { id: 'boulder', name: 'Feature boulder', category: 'landscape', unit: 'each', massKg: 260, priceUsd: 85, blurb: THINGS.boulder.blurb },
  plant(PLANTS.lavender, 9, 1.5), plant(PLANTS.coneflower, 8, 1.5), plant(PLANTS.grass, 14, 2.5),
  plant(PLANTS.boxwood, 22, 6), plant(PLANTS.hydrangea, 32, 9), plant(PLANTS.rose, 28, 8), plant(PLANTS.maple, 90, 30),
  plant(PLANTS.blueberry, 25, 8), plant(PLANTS.apple, 45, 25), plant(PLANTS.iris, 12, 1.5),
]);
