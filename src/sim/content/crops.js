// The first twelve garden crops: content records for the generic growth model (src/sim/core/growth.js)
// and soil-water model (src/sim/core/soilwater.js). Real figures, with their source family:
//
//   Temperatures      base, optimum and ceiling for development; university extension and crop-model
//                     literature (e.g. the base 10 C "86/50" method for warm-season crops, base 4.4 C (40 F)
//                     for cool-season vegetables, base 0 C for wheat and garlic). germMinC: minimum soil
//                     temperature for germination (extension planting guides, e.g. UC and Minnesota).
//   Thermal time      degree days (C d) from sowing (or from planting out, for tomato) to first harvest.
//                     Chosen so a normal season matches the seed-packet days, and checked against published
//                     GDD totals (sweet corn about 1,350 F d base 50 F = 750 C d; peas about 1,250 F d base 40 F;
//                     spring wheat about 1,600 C d base 0 C to maturity). Calibrated against the temperate
//                     climate in test/garden.test.mjs; marked approx.
//   Days to maturity  as printed on a typical seed packet for a common variety (named).
//   Spacing           square-equivalent spacing in an intensive bed (square-foot and bio-intensive guides).
//   Crop water        FAO-56 (Allen et al. 1998): basal crop coefficients Kcb ini/mid/end (Table 17), maximum
//                     rooting depth and the depletion fraction p at which stress begins (Table 22).
//   Frost and heat    frost class and the temperatures at which leaves are damaged and plants are killed
//                     (extension frost-tolerance tables: tender, half-hardy, hardy). Tomato fruit set fails
//                     above about 32 C; lettuce bolts after spells above about 24 to 27 C on long days.
//   Nutrients         uptake of N, P and K per kg of fresh yield (g/kg), from crop uptake and removal tables
//                     (fertiliser-industry and extension nutrient-removal tables, approx); nRemovedGPerKg is
//                     the nitrogen that leaves in the produce, the rest stays in the residue. fixFrac: share
//                     of a legume's nitrogen it can fix from the air.
//   Growth            radiation-use efficiency rue in g of dry matter per MJ of intercepted global solar
//                     radiation (Sinclair and Muchow 1999: about 1.2 to 1.5 for C3 crops, 1.6 to 1.8 for maize);
//                     extinction coefficient k; laiMax; partition: share of new growth going to the harvested
//                     part as the crop develops; dmf: dry-matter fraction of the produce (USDA food composition).
//   Yield             expected fresh yield per m2 for a well tended bed, kg (extension garden-yield tables and
//                     field yields: 10 t/ha = 1 kg/m2).
//   Storage           typical storage life in days at the right conditions (USDA Handbook 66).
//
// Stage fractions are of the degree days to first harvest. Stage ids are shared by every crop so the
// view can draw them: sown, seedling, leafy, flowering, fruiting, ready, past.

const S = (seedling, leafy, flowering, fruiting, past) => ({ leafy, flowering, fruiting, past });

const list = [
  {
    id: 'radish', name: 'Radish', plural: 'radishes', variety: 'Cherry Belle', family: 'brassica', part: 'root',
    tb: 4.4, topt: 22, tceil: 32, germMinC: 7,
    emergeGdd: 45, readyGdd: 225, stages: S(0, 0.3, null, null, 1.4), daysToMaturity: 24, daysFrom: 'sowing',
    spacingM: 0.075, seedItem: 'seed_radish', seedsPerUnit: 300, seedsPerPlant: 1.3, produce: 'produce_radish',
    kcb: [0.15, 0.85, 0.75], rootDepthM: 0.35, comfortP: 0.3,
    frost: { class: 'half-hardy', damageC: -3, killC: -6 },
    npk: [4, 0.6, 5], nRemovedGPerKg: 2, ph: [6.0, 7.0],
    rue: 1.2, k: 0.65, laiMax: 1.8, partition: { from: 0.3, to: 0.55, max: 0.75 }, dmf: 0.05,
    yieldKgM2: [1.0, 3.0], harvest: 'once', gesture: 'pull', storageDays: 28, pithy: true,
    sow: [{ anchor: 'last', from: -30, to: 30 }, { anchor: 'first', from: -60, to: -20 }],
    sowText: 'Sow from a month before the last frost, every two weeks, and again in late summer. Ready in about four weeks.',
  },
  {
    id: 'lettuce', name: 'Lettuce', plural: 'lettuces', variety: 'Black Seeded Simpson (leaf)', family: 'aster', part: 'leaves',
    tb: 4.4, topt: 20, tceil: 30, germMinC: 4.4,
    emergeGdd: 60, readyGdd: 430, stages: S(0, 0.25, null, null, 1.5), daysToMaturity: 46, daysFrom: 'sowing',
    spacingM: 0.15, seedItem: 'seed_lettuce', seedsPerUnit: 500, seedsPerPlant: 2, produce: 'produce_lettuce',
    kcb: [0.15, 0.9, 0.9], rootDepthM: 0.4, comfortP: 0.3,
    frost: { class: 'half-hardy', damageC: -2, killC: -5 },
    bolt: { aboveC: 24, index: 14, longDayH: 14 },
    npk: [2.5, 0.4, 5], nRemovedGPerKg: 2, ph: [6.0, 7.0],
    rue: 0.85, k: 0.7, laiMax: 2.2, partition: { from: 0, to: 0.15, max: 0.6 }, dmf: 0.05,
    yieldKgM2: [1.5, 3.5], harvest: 'once', gesture: 'cut', storageDays: 14,
    sow: [{ anchor: 'last', from: -30, to: 21 }, { anchor: 'first', from: -70, to: -35 }],
    sowText: 'A cool-weather crop: sow a month before the last frost until early summer, and again in late summer. It bolts in hot weather.',
  },
  {
    id: 'peas', name: 'Peas', plural: 'peas', variety: 'Sugar Snap', family: 'legume', part: 'pods',
    tb: 4.4, topt: 20, tceil: 30, germMinC: 4.4,
    emergeGdd: 100, readyGdd: 600, stages: S(0, 0.2, 0.6, 0.75, 1.45), daysToMaturity: 62, daysFrom: 'sowing',
    spacingM: 0.1, seedItem: 'seed_peas', seedsPerUnit: 120, seedsPerPlant: 1.2, produce: 'produce_peas',
    kcb: [0.15, 1.1, 1.05], rootDepthM: 0.8, comfortP: 0.35,
    frost: { class: 'hardy', damageC: -3, killC: -7 },
    npk: [10, 1.0, 6], nRemovedGPerKg: 7, fixFrac: 0.65, ph: [6.0, 7.5],
    rue: 1.3, k: 0.65, laiMax: 3.5, partition: { from: 0.65, to: 0.8, max: 0.52 }, dmf: 0.2, ripenGdd: 70,
    yieldKgM2: [0.5, 1.3], harvest: 'repeat', gesture: 'pick', storageDays: 7, climbs: true,
    sow: [{ anchor: 'last', from: -42, to: -5 }],
    sowText: 'Sow early, about six weeks before the last frost: peas like cold soil and stop in summer heat. They feed the soil with nitrogen.',
  },
  {
    id: 'potato', name: 'Potato', plural: 'potatoes', variety: 'Yukon Gold', family: 'nightshade', part: 'tubers',
    tb: 7, topt: 20, tceil: 30, germMinC: 7,
    emergeGdd: 150, readyGdd: 800, stages: S(0, 0.25, 0.55, null, 2.2), daysToMaturity: 90, daysFrom: 'planting',
    spacingM: 0.3, seedItem: 'seed_potato', seedsPerUnit: 18, seedsPerPlant: 1, produce: 'food_potato',
    kcb: [0.15, 1.1, 0.65], rootDepthM: 0.5, comfortP: 0.35,
    frost: { class: 'half-hardy', damageC: -1, killC: -2.5 }, keepsAfterKill: true,
    npk: [4, 0.6, 6], nRemovedGPerKg: 3, ph: [5.0, 6.5],
    rue: 1.3, k: 0.65, laiMax: 3.5, partition: { from: 0.25, to: 0.5, max: 0.85 }, dmf: 0.21,
    yieldKgM2: [2.5, 5.0], harvest: 'once', gesture: 'dig', storageDays: 180,
    sow: [{ anchor: 'last', from: -21, to: 21 }],
    sowText: 'Plant seed potatoes two or three weeks before the last frost; shoots that come up early may be nipped but regrow.',
  },
  {
    id: 'tomato', name: 'Tomato', plural: 'tomatoes', variety: 'Early Girl (transplants)', family: 'nightshade', part: 'fruit',
    tb: 10, topt: 26, tceil: 35, germMinC: 10, transplant: { lai: 0.15, bioG: 12 },
    emergeGdd: 0, readyGdd: 545, stages: S(0, 0.1, 0.35, 0.55, 3.5), daysToMaturity: 59, daysFrom: 'planting out',
    spacingM: 0.6, seedItem: 'seedling_tomato', seedsPerUnit: 6, seedsPerPlant: 1, produce: 'food_tomato',
    kcb: [0.15, 1.1, 0.7], rootDepthM: 1.0, comfortP: 0.4,
    frost: { class: 'tender', damageC: -0.5, killC: -1.5 },
    setLoss: { aboveC: 32, hoursForNoSet: 4 },
    npk: [2.5, 0.4, 4], nRemovedGPerKg: 1.5, ph: [6.0, 6.8],
    rue: 1.25, k: 0.65, laiMax: 3.5, partition: { from: 0.45, to: 0.7, max: 0.75 }, dmf: 0.06, ripenGdd: 120,
    yieldKgM2: [4, 10], harvest: 'repeat', gesture: 'pick', storageDays: 10, staked: true,
    sow: [{ anchor: 'last', from: 7, to: 35 }],
    sowText: 'Tender: plant out one to two weeks after the last frost, once nights stay above 10 C. Frost kills it.',
  },
  {
    id: 'bean', name: 'Bush bean', plural: 'bush beans', variety: 'Provider', family: 'legume', part: 'pods',
    tb: 10, topt: 27, tceil: 35, germMinC: 15.5,
    emergeGdd: 70, readyGdd: 480, stages: S(0, 0.2, 0.65, 0.8, 1.6), daysToMaturity: 50, daysFrom: 'sowing',
    spacingM: 0.1, seedItem: 'seed_bean', seedsPerUnit: 100, seedsPerPlant: 1.2, produce: 'produce_bean',
    kcb: [0.15, 1.0, 0.8], rootDepthM: 0.6, comfortP: 0.45,
    frost: { class: 'tender', damageC: -0.5, killC: -1.5 },
    npk: [8, 1.0, 7], nRemovedGPerKg: 3, fixFrac: 0.4, ph: [6.0, 7.0],
    rue: 1.1, k: 0.65, laiMax: 3.0, partition: { from: 0.7, to: 0.85, max: 0.42 }, dmf: 0.1, ripenGdd: 50,
    yieldKgM2: [0.8, 1.8], harvest: 'repeat', gesture: 'pick', storageDays: 7,
    sow: [{ anchor: 'last', from: 7, to: 60 }],
    sowText: 'Warm season: sow after the last frost when the soil is warm, and every few weeks until midsummer. Fixes nitrogen.',
  },
  {
    id: 'carrot', name: 'Carrot', plural: 'carrots', variety: 'Nantes', family: 'umbellifer', part: 'root',
    tb: 4.4, topt: 22, tceil: 32, germMinC: 7,
    emergeGdd: 140, readyGdd: 810, stages: S(0, 0.25, null, null, 2.2), daysToMaturity: 68, daysFrom: 'sowing',
    spacingM: 0.075, seedItem: 'seed_carrot', seedsPerUnit: 1000, seedsPerPlant: 3, produce: 'food_carrot',
    kcb: [0.15, 0.95, 0.85], rootDepthM: 0.7, comfortP: 0.35,
    frost: { class: 'half-hardy', damageC: -4, killC: -9 }, keepsAfterKill: true,
    npk: [2.5, 0.4, 5], nRemovedGPerKg: 1.5, ph: [6.0, 6.8],
    rue: 1.2, k: 0.65, laiMax: 3.0, partition: { from: 0.25, to: 0.55, max: 0.75 }, dmf: 0.12,
    yieldKgM2: [3, 6], harvest: 'once', gesture: 'pull', storageDays: 150,
    sow: [{ anchor: 'last', from: -21, to: 50 }],
    sowText: 'Sow from three weeks before the last frost into early summer. Slow to come up: keep the seed bed moist for two weeks.',
  },
  {
    id: 'squash', name: 'Winter squash', plural: 'winter squash', variety: 'Waltham Butternut', family: 'cucurbit', part: 'fruit',
    tb: 10, topt: 28, tceil: 38, germMinC: 15.5,
    emergeGdd: 85, readyGdd: 945, stages: S(0, 0.15, 0.45, 0.6, 1.6), daysToMaturity: 100, daysFrom: 'sowing',
    spacingM: 0.9, seedItem: 'seed_squash', seedsPerUnit: 25, seedsPerPlant: 3, produce: 'produce_squash',
    kcb: [0.15, 0.95, 0.7], rootDepthM: 1.0, comfortP: 0.35,
    frost: { class: 'tender', damageC: -0.5, killC: -1.5 }, keepsAfterKill: true,
    npk: [4, 0.6, 5], nRemovedGPerKg: 2, ph: [6.0, 7.0],
    rue: 1.1, k: 0.65, laiMax: 3.0, partition: { from: 0.55, to: 0.75, max: 0.65 }, dmf: 0.13,
    yieldKgM2: [1.5, 3.5], harvest: 'once', gesture: 'cut', storageDays: 120, sprawls: true,
    sow: [{ anchor: 'last', from: 7, to: 28 }],
    sowText: 'Tender and slow: sow after the last frost in warm soil. It needs a long summer and a square metre of room.',
  },
  {
    id: 'kale', name: 'Kale', plural: 'kale', variety: 'Lacinato', family: 'brassica', part: 'leaves',
    tb: 4.4, topt: 20, tceil: 32, germMinC: 7,
    emergeGdd: 65, readyGdd: 615, stages: S(0, 0.25, null, null, 6), daysToMaturity: 60, daysFrom: 'sowing',
    spacingM: 0.3, seedItem: 'seed_kale', seedsPerUnit: 300, seedsPerPlant: 2, produce: 'produce_kale',
    kcb: [0.15, 0.95, 0.85], rootDepthM: 0.6, comfortP: 0.45,
    frost: { class: 'hardy', damageC: -7, killC: -14 },
    npk: [5, 0.7, 5], nRemovedGPerKg: 5, ph: [6.0, 7.5],
    rue: 1.2, k: 0.65, laiMax: 3.0, partition: { from: 0.0, to: 0.3, max: 0.42 }, dmf: 0.13, ripenGdd: 60,
    yieldKgM2: [1.5, 3.5], harvest: 'repeat', gesture: 'pick', storageDays: 14,
    sow: [{ anchor: 'last', from: -35, to: 21 }, { anchor: 'first', from: -90, to: -55 }],
    sowText: 'Sow in spring from a month before the last frost, or in midsummer for autumn and winter. Frost makes it sweeter.',
  },
  {
    id: 'garlic', name: 'Garlic', plural: 'garlic', variety: 'Music (hardneck)', family: 'allium', part: 'bulbs',
    tb: 0, topt: 20, tceil: 30, germMinC: 0,
    emergeGdd: 150, readyGdd: 1750, stages: S(0, 0.2, null, null, 1.12), daysToMaturity: 270, daysFrom: 'planting',
    spacingM: 0.15, seedItem: 'seed_garlic', seedsPerUnit: 100, seedsPerPlant: 1, produce: 'produce_garlic',
    kcb: [0.15, 0.9, 0.6], rootDepthM: 0.4, comfortP: 0.3,
    frost: { class: 'hardy', damageC: -12, killC: -25 },
    npk: [12, 1.5, 10], nRemovedGPerKg: 8, ph: [6.0, 7.0],
    rue: 1.0, k: 0.6, laiMax: 1.8, partition: { from: 0.6, to: 0.75, max: 0.8, needsDayH: 13 }, dmf: 0.38,
    yieldKgM2: [0.6, 1.2], harvest: 'once', gesture: 'pull', storageDays: 210,
    sow: [{ anchor: 'first', from: 10, to: 45 }],
    sowText: 'Plant cloves in autumn, a few weeks after the first frost and before the ground freezes. Harvest next summer when the lower leaves brown.',
  },
  {
    id: 'corn', name: 'Sweet corn', plural: 'sweet corn', variety: 'Early Sunglow', family: 'grass', part: 'ears',
    tb: 10, topt: 30, tceil: 40, germMinC: 10,
    emergeGdd: 65, readyGdd: 690, stages: S(0, 0.15, 0.7, 0.8, 1.15), daysToMaturity: 70, daysFrom: 'sowing',
    spacingM: 0.3, seedItem: 'seed_corn', seedsPerUnit: 100, seedsPerPlant: 2, produce: 'produce_corn',
    kcb: [0.15, 1.1, 1.0], rootDepthM: 1.0, comfortP: 0.5,
    frost: { class: 'tender', damageC: -1, killC: -2 },
    npk: [10, 1.6, 6], nRemovedGPerKg: 5, ph: [5.8, 7.0],
    rue: 1.6, k: 0.55, laiMax: 3.5, partition: { from: 0.55, to: 0.7, max: 0.9 }, dmf: 0.25,
    yieldKgM2: [1.0, 2.0], harvest: 'once', gesture: 'twist', storageDays: 5, block: true,
    sow: [{ anchor: 'last', from: 7, to: 40 }],
    sowText: 'Sow after the last frost in warm soil, in a block of short rows rather than one long row, so the wind pollinates it.',
  },
  {
    id: 'wheat', name: 'Wheat', plural: 'wheat', variety: 'hard red spring', family: 'grass', part: 'grain',
    tb: 0, topt: 25, tceil: 35, germMinC: 4,
    emergeGdd: 120, readyGdd: 1550, stages: S(0, 0.2, 0.6, 0.7, 1.35), daysToMaturity: 105, daysFrom: 'sowing',
    spacingM: 0.06, seedItem: 'seed_wheat', seedsPerUnit: 25000, seedsPerPlant: 1.3, produce: 'produce_wheat',
    kcb: [0.15, 1.1, 0.25], rootDepthM: 1.0, comfortP: 0.55,
    frost: { class: 'hardy', damageC: -5, killC: -9 }, keepsAfterKill: true,
    npk: [30, 5, 24], nRemovedGPerKg: 20, ph: [6.0, 7.0],
    rue: 1.3, k: 0.5, laiMax: 4.0, partition: { from: 0.55, to: 0.7, max: 0.85 }, dmf: 0.87,
    yieldKgM2: [0.3, 0.6], harvest: 'once', gesture: 'reap', storageDays: 720,
    sow: [{ anchor: 'last', from: -28, to: 10 }],
    sowText: 'Spring wheat: sow a month before the last frost. A field crop: it takes a lot of ground to make a loaf.',
  },
];

const RESIDUE_RATE = { legume: 0.7, brassica: 0.6, aster: 0.6, nightshade: 0.4, umbellifer: 0.5, cucurbit: 0.5, allium: 0.4, grass: 0.08 };

// Derived figures: absolute stage thresholds in degree days, nitrogen per gram of dry matter, plants per 30 cm cell.
function finish(c) {
  const R = c.readyGdd, st = c.stages;
  const stages = [{ id: 'sown', gdd: 0 }, { id: 'seedling', gdd: c.emergeGdd }];
  const add = (id, f) => { if (f != null) stages.push({ id, gdd: Math.max(c.emergeGdd + 1, f * R) }); };
  add('leafy', st.leafy); add('flowering', st.flowering); add('fruiting', st.fruiting);
  stages.push({ id: 'ready', gdd: R }); stages.push({ id: 'past', gdd: st.past * R });
  // nitrogen in the whole plant per g of dry matter: uptake per kg of produce x produce per g of dry matter
  const hi = c.partition.max * 0.8;                                    // typical final harvest index of the dry matter
  return Object.freeze({
    ...c, approx: true, stages, stageIds: stages.map((s) => s.id),
    // dry matter of a good crop at harvest, g/m2: the reference for nitrogen dilution (see garden.js)
    bioRef: ((c.yieldKgM2[0] + c.yieldKgM2[1]) / 2) * 1000 * c.dmf / hi,
    nConc: (c.npk[0] / 1000) * hi / c.dmf, pConc: (c.npk[1] / 1000) * hi / c.dmf, kConc: (c.npk[2] / 1000) * hi / c.dmf,
    legume: !!c.fixFrac,
    // crop residue: the share of its nitrogen released in a year, and the mineral N its microbes lock up per g of
    // dry residue. Legume and leafy residues (C:N about 15) release fast; corn stalks and straw (C:N 60 to 80) tie
    // up 7 to 10 kg of N per tonne while they rot (approx: extension residue-management guides).
    residueRate: RESIDUE_RATE[c.family] ?? 0.5, immobilizeGPerG: c.family === 'grass' ? 0.008 : 0,
  });
}
export const CROPS = Object.freeze(Object.fromEntries(list.map((c) => [c.id, finish(c)])));
export const CROP_IDS = Object.freeze(list.map((c) => c.id));
export const crop = (id) => CROPS[id];
