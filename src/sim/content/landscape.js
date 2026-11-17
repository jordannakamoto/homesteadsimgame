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

// How landscaping is put in (hardscape installation guides: ICPI paver installation, extension and landscape-supply
// how-tos; figures typical, approx):
//  - A path or patio: dig out 10 to 15 cm, tamp the ground, roll out landscape fabric (a woven weed barrier), lay
//    7 to 10 cm of crushed stone and tamp it firm (the base), screed 2 to 3 cm of sand (the bed), set the stones on it
//    and sweep sand into the joints. Skip the base and stones rock and sink unevenly over the first months; skip the
//    fabric and weeds come up through gravel, chips and joints.
//  - A gravel or chip path: dig out 5 to 10 cm, fabric, then 5 to 8 cm of gravel or chips, held by edging.
//  - A garden wall: dig a trench, tamp in a gravel base, bury the first course, stagger the joints and step each
//    course back a little, cap it. On loose or untamped ground a wall settles and leans.
//  - A garden box (raised bed): set the frame on levelled ground (cardboard under it smothers the grass) and fill it
//    with a mix of topsoil and compost.
// The game keeps these as plain facts of the ground: whether a spot is under fabric, how well it was tamped, and
// what is laid on it. Stones on tamped ground stay put; on loose ground they sink a little and tilt. Laid surfaces
// with no fabric under them grow weeds; fabric slows that to almost nothing.
export const INSTALL = Object.freeze({
  tampPasses: 2,          // tamped twice is firm
  sagM: 0.035, sagDays: 40,   // an unprepared stone sinks up to 3.5 cm over its first weeks (approx)
  weedDaysBare: 18, weedDaysFabric: 160,   // days of growing weather for each step of weeds to come up (0..7 steps)
});
// The flag bits the landscape keeps on each point of the ground.
export const FLAG = Object.freeze({ LINER: 1, FABRIC: 2, TAMP1: 4, TAMP2: 8, WEED: 16 * 7, WALL: 128 });   // WEED: bits 4-6 (0..7)

// Surfaces. `item`: what laying it spends, and in what unit; m3 per unit for bulk. layer: laid on top, raking keeps it.
export const SURFACES = Object.freeze({
  soil: { id: 'soil', name: 'Bare soil' },
  lawn_sown: { id: 'lawn_sown', name: 'Sown lawn' },
  gravel: { id: 'gravel', name: 'Pea gravel', item: 'gravel', m3PerUnit: 1, layer: true, blurb: 'Small rounded stones for paths and patios. Dig out the sod first, or the grass comes through' },
  crushed: { id: 'crushed', name: 'Crushed stone', item: 'crushed_stone', m3PerUnit: 1, layer: true, blurb: 'Angular grey 20 mm stone: it locks together, so it makes a firm path or a drive' },
  dg: { id: 'dg', name: 'Decomposed granite', item: 'decomposed_granite', m3PerUnit: 1, layer: true, blurb: 'Fine tan granite grit that packs into a smooth, natural path' },
  slate: { id: 'slate', name: 'Slate chips', item: 'slate_chips', m3PerUnit: 1, layer: true, blurb: 'Flat blue-grey flakes for borders and around boulders' },
  marble: { id: 'marble', name: 'White marble chips', item: 'marble_chips', m3PerUnit: 1, layer: true, blurb: 'Bright white stone for a formal border' },
  lava: { id: 'lava', name: 'Lava rock', item: 'lava_rock', m3PerUnit: 1, layer: true, blurb: 'Light, porous red-brown rock for dry gardens' },
  woodchips: { id: 'woodchips', name: 'Wood chips', item: 'wood_chips', m3PerUnit: 0.001, layer: true, blurb: 'Arborist wood chips: a soft path between beds, or a deep mulch under trees' },
  bark: { id: 'bark', name: 'Bark mulch', item: 'bark_mulch', m3PerUnit: 0.001, layer: true, blurb: 'Shredded bark around shrubs and in borders: 5 to 8 cm deep keeps weeds down' },
  sand: { id: 'sand', name: 'Sand', item: 'sand', m3PerUnit: 1, layer: true, blurb: 'A bed for flagstones and pavers, or a sand pit' },
  bedmix: { id: 'bedmix', name: 'Raised-bed soil', item: 'raised_bed_mix', m3PerUnit: 0.001, fillSoil: true, blurb: 'Topsoil and compost, mixed: fill a garden box with it' },
  riverrock: { id: 'riverrock', name: 'River rock', item: 'river_rock', m3PerUnit: 1, layer: true, blurb: 'Rounded 5 to 15 cm stones: a dry creek bed for the rain to run along, or a pond beach' },
});
export const LAYERS = Object.freeze(['gravel', 'crushed', 'dg', 'slate', 'marble', 'lava', 'woodchips', 'bark', 'sand', 'riverrock']);

// Things set by hand on the ground. dims in metres: w (across), d (along), h (tall). sink: how much of it is set below
// the surface. stack: another of its kind can sit on top (a dry-stone wall course by course). spacing: the gap
// along a dragged line. qty: how much of the item one costs.
export const THINGS = Object.freeze({
  flagstone: { id: 'flagstone', name: 'Flagstone', item: 'flagstone_40', qty: 0.2, dims: { w: 0.5, d: 0.4, h: 0.04 }, sink: 0.02, spacing: 0.62, line: 'step', blurb: 'Stepping stones: a stride apart' },
  paver: { id: 'paver', name: 'Brick paver', item: 'paver_brick', qty: 1, dims: { w: 0.2, d: 0.1, h: 0.06 }, sink: 0.04, spacing: 0.205, line: 'tight', blurb: 'Clay brick for edging and paths' },
  wallstone: { id: 'wallstone', name: 'Wall stone', item: 'stone', qty: 1, dims: { w: 0.25, d: 0.2, h: 0.2 }, sink: 0.03, spacing: 0.26, line: 'tight', stack: true, blurb: 'Fieldstone for dry-stone walls and terraces: lay a course, then the next on top' },
  // granite setts (cobblestones): laid tight in a band three wide as you drag, for a cobbled path or patio
  cobble: { id: 'cobble', name: 'Cobblestone', item: 'granite_sett', qty: 1, dims: { w: 0.1, d: 0.1, h: 0.09 }, sink: 0.07, spacing: 0.108, line: 'tight', band: 3, blurb: 'Granite setts, 10 cm: drag to lay a cobbled band' },
  // a garden wall: cut stone in courses, finished with flat capstones
  cutstone: { id: 'cutstone', name: 'Cut stone', item: 'cut_stone', qty: 1, dims: { w: 0.4, d: 0.2, h: 0.15 }, sink: 0.03, spacing: 0.41, line: 'tight', stack: true, blurb: 'Squared sandstone blocks for a neat garden wall' },
  capstone: { id: 'capstone', name: 'Capstone', item: 'capstone', qty: 1, dims: { w: 0.5, d: 0.3, h: 0.06 }, sink: 0.01, spacing: 0.51, line: 'tight', stack: true, blurb: 'A flat slab to finish the top of a wall, or a step' },
  curb: { id: 'curb', name: 'Granite edging', item: 'granite_curb', qty: 1, dims: { w: 0.9, d: 0.1, h: 0.22 }, sink: 0.16, spacing: 0.91, line: 'tight', blurb: 'Long granite edging set on end: a crisp line between lawn and path' },
  boulder: { id: 'boulder', name: 'Boulder', item: 'boulder', qty: 1, dims: { w: 0.7, d: 0.55, h: 0.45 }, sink: 0.12, spacing: 0.9, line: 'step', blurb: 'A feature rock, set a third into the ground' },
  // a 4 x 6 landscape timber cut in half: raised beds, steps and low retaining walls, stacked course on course
  timber: { id: 'timber', name: 'Timber', item: 'landscape_timber', qty: 1, dims: { w: 1.2, d: 0.14, h: 0.1 }, sink: 0.02, spacing: 1.21, line: 'tight', stack: true, blurb: 'Treated 4 x 6 timber, 1.2 m: raised beds, steps and edging' },
  // a cedar garden box: a frame that holds earth, so the soil you put in it stays in (no running out at the sides)
  gardenbox: { id: 'gardenbox', name: 'Garden box', item: 'garden_box_kit', qty: 1, dims: { w: 2.4, d: 1.2, h: 0.3 }, sink: 0, spacing: 2.5, line: 'step', box: true, blurb: 'A 1.2 x 2.4 m cedar raised bed, 30 cm deep: set it down, fill it with soil, then hoe it into a bed' },
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
  { id: 'tamper', name: 'Hand tamper', category: 'tools_hand', unit: 'each', massKg: 6, priceUsd: 38, blurb: 'A heavy steel plate on a handle: tamp the ground and the base firm before laying stone' },
  { id: 'landscape_fabric', name: 'Landscape fabric', category: 'landscape', unit: 'm2', massKg: 0.1, priceUsd: 0.5, blurb: 'Woven weed barrier: lay it under gravel, chips and stone so weeds cannot come up' },
  { id: 'raised_bed_mix', name: 'Raised-bed soil mix', category: 'landscape', unit: 'L', massKg: 1.1, priceUsd: 0.09, blurb: SURFACES.bedmix.blurb },
  { id: 'garden_box_kit', name: 'Cedar garden box kit, 1.2 x 2.4 m', category: 'landscape', unit: 'each', massKg: 40, priceUsd: 110, blurb: THINGS.gardenbox.blurb },
  { id: 'garden_hose', name: 'Garden hose (25 m)', category: 'tools_hand', unit: 'each', massKg: 4, priceUsd: 35, blurb: 'Fills a pond from the tap: about 15 L a minute' },
  { id: 'pond_liner', name: 'EPDM pond liner', category: 'landscape', unit: 'm2', massKg: 1.1, priceUsd: 9, blurb: 'Rubber liner that holds a pond. Lay it over the whole dug hole' },
  { id: 'river_rock', name: 'River rock (bulk)', category: 'landscape', unit: 'm3', massKg: 1500, priceUsd: 160, blurb: SURFACES.riverrock.blurb },
  { id: 'landscape_timber', name: 'Landscape timber, 4 x 6, 1.2 m', category: 'landscape', unit: 'each', massKg: 12, priceUsd: 7, blurb: THINGS.timber.blurb },
  { id: 'path_light', name: 'Solar path light', category: 'landscape', unit: 'each', massKg: 0.4, priceUsd: 14, blurb: THINGS.pathlight.blurb },
  // bulk stone and chips (2026 landscape-yard prices, approx; crushed stone about 1.5 t/m3)
  { id: 'crushed_stone', name: 'Crushed stone, 20 mm (bulk)', category: 'landscape', unit: 'm3', massKg: 1500, priceUsd: 60, blurb: SURFACES.crushed.blurb },
  { id: 'decomposed_granite', name: 'Decomposed granite (bulk)', category: 'landscape', unit: 'm3', massKg: 1600, priceUsd: 80, blurb: SURFACES.dg.blurb },
  { id: 'slate_chips', name: 'Slate chips (bulk)', category: 'landscape', unit: 'm3', massKg: 1400, priceUsd: 260, blurb: SURFACES.slate.blurb },
  { id: 'marble_chips', name: 'White marble chips (bulk)', category: 'landscape', unit: 'm3', massKg: 1500, priceUsd: 300, blurb: SURFACES.marble.blurb },
  { id: 'lava_rock', name: 'Lava rock (bulk)', category: 'landscape', unit: 'm3', massKg: 700, priceUsd: 220, blurb: SURFACES.lava.blurb },
  { id: 'wood_chips', name: 'Wood chips', category: 'landscape', unit: 'L', massKg: 0.25, priceUsd: 0.03, blurb: SURFACES.woodchips.blurb },
  { id: 'granite_sett', name: 'Granite sett (cobblestone)', category: 'landscape', unit: 'each', massKg: 2.4, priceUsd: 1.2, blurb: THINGS.cobble.blurb },
  { id: 'cut_stone', name: 'Cut sandstone block', category: 'landscape', unit: 'each', massKg: 30, priceUsd: 7, blurb: THINGS.cutstone.blurb },
  { id: 'capstone', name: 'Capstone slab', category: 'landscape', unit: 'each', massKg: 22, priceUsd: 12, blurb: THINGS.capstone.blurb },
  { id: 'granite_curb', name: 'Granite edging, 0.9 m', category: 'landscape', unit: 'each', massKg: 50, priceUsd: 22, blurb: THINGS.curb.blurb },
  { id: 'paver_brick', name: 'Clay brick paver', category: 'landscape', unit: 'each', massKg: 2.3, priceUsd: 0.9, blurb: THINGS.paver.blurb },
  { id: 'boulder', name: 'Feature boulder', category: 'landscape', unit: 'each', massKg: 260, priceUsd: 85, blurb: THINGS.boulder.blurb },
  plant(PLANTS.lavender, 9, 1.5), plant(PLANTS.coneflower, 8, 1.5), plant(PLANTS.grass, 14, 2.5),
  plant(PLANTS.boxwood, 22, 6), plant(PLANTS.hydrangea, 32, 9), plant(PLANTS.rose, 28, 8), plant(PLANTS.maple, 90, 30),
  plant(PLANTS.blueberry, 25, 8), plant(PLANTS.apple, 45, 25), plant(PLANTS.iris, 12, 1.5),
]);
