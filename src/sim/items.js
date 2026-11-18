// The item catalog: everything the player can own, carry and buy.
//
// Mass per unit is computed, never typed, wherever the item has a material and dimensions:
//   massKgPerUnit = material density x volume of one unit (see unitVolumeM3).
// Units: "each", "m" (a length of stick or board), "m2" (area of sheet, insulation, roofing, glass),
// "m3" (bulk volume), "kg", "L". `dims` is in metres; which keys apply depends on the unit:
//   m     -> widthM x depthM          (cross-section, so volume per metre = widthM * depthM)
//   m2    -> thicknessM               (volume per square metre)
//   each  -> lengthM x widthM x thicknessM (or depthM)
//   m3, kg, L -> no dims (m3 is the volume itself)
// Prices are 2026 US retail, rounded; they are game prices, not quotes.

import { MATERIALS } from './materials.js';
import { INGREDIENTS, foodId } from './food-catalog.js';
import { ITEMS_GARDEN, GARDEN_CATEGORIES } from './content/garden-items.js';
import { ITEMS_LANDSCAPE, LANDSCAPE_CATEGORIES } from './content/landscape.js';
import { ITEMS_VEHICLES, VEHICLE_CATEGORIES } from './content/vehicles.js';
import { openingItems, openingItemFromId } from './content/openings.js';

export const ITEM_UNITS = Object.freeze(['each', 'm', 'm2', 'm3', 'kg', 'L']);

// Shop and inventory order. `tool` categories live in stock.tools, everything else in stock.items.
export const ITEM_CATEGORIES = Object.freeze([
  { id: 'food', name: 'Food & pantry', blurb: 'Ingredients for your homestead kitchen' },
  { id: 'lumber', name: 'Dimensional lumber', blurb: 'Framing lumber sold by the metre' },
  { id: 'logs', name: 'Logs and boards', blurb: 'Raw logs, boards and cut wood' },
  { id: 'sheet', name: 'Sheets and membranes', blurb: 'Plywood, OSB, board, wraps' },
  { id: 'insulation', name: 'Insulation', blurb: 'Keeps the warm in and the cold out' },
  { id: 'roofing', name: 'Roofing', blurb: 'What keeps the rain off' },
  { id: 'glass', name: 'Glass', blurb: 'Glazing by the square metre' },
  { id: 'windows', name: 'Windows', blurb: 'Ready-made units in their frames, by type and size' },
  { id: 'doors', name: 'Doors', blurb: 'Pre-hung, sliding, pocket, barn and garage doors' },
  { id: 'stone', name: 'Stone and concrete', blurb: 'Rock, gravel and mixes' },
  { id: 'fasteners', name: 'Fasteners', blurb: 'Nails and screws, sold by weight' },
  { id: 'tools_hand', name: 'Hand tools', blurb: 'Work anywhere, no power needed' },
  { id: 'tools_power', name: 'Power tools', blurb: 'Need electricity' },
  ...GARDEN_CATEGORIES,
  ...LANDSCAPE_CATEGORIES,
  ...VEHICLE_CATEGORIES,
]);
export const isToolCategory = (c) => c === 'tools_hand' || c === 'tools_power';

// Actual (not nominal) dimensions of North American dimensional lumber, in metres.
const ACTUAL = { '2x4': [0.038, 0.089], '2x6': [0.038, 0.14], '2x8': [0.038, 0.184], '2x10': [0.038, 0.235], '2x12': [0.038, 0.286], '4x4': [0.089, 0.089], '6x6': [0.14, 0.14] };

export function unitVolumeM3(item) {
  const d = item.dims;
  if (!d) return item.unit === 'm3' ? 1 : item.unit === 'L' ? 0.001 : NaN;
  if (item.unit === 'm') return d.widthM * d.depthM;
  if (item.unit === 'm2') return d.thicknessM;
  if (item.unit === 'each') return d.lengthM * d.widthM * (d.thicknessM ?? d.depthM);
  return NaN;
}

const list = [];
// spec: { id, name, category, unit, material?, dims?, massKg? (only for items without material and dims), priceUsd, powerW?, blurb? }
const add = (spec) => {
  const { massKg, ...rest } = spec;
  const item = { ...rest };
  if (item.material) {
    const m = MATERIALS[item.material];
    if (!m) throw new Error('item ' + item.id + ' uses unknown material ' + item.material);
    if (item.unit === 'kg') item.massKgPerUnit = 1;
    else if (item.unit === 'L') item.massKgPerUnit = m.densityKgM3 / 1000;
    else item.massKgPerUnit = m.densityKgM3 * unitVolumeM3(item);
  } else item.massKgPerUnit = massKg;
  if (!(item.massKgPerUnit > 0)) throw new Error('item ' + item.id + ' has no mass');
  list.push(Object.freeze(item));
};

// ---- dimensional lumber, spruce-pine-fir, kiln dried, sold by the metre
const lumberPrice = { '2x4': 1.95, '2x6': 3.3, '2x8': 4.9, '2x10': 7.1, '2x12': 9.6, '4x4': 5.6, '6x6': 17.5 };
for (const [size, [w, dpt]] of Object.entries(ACTUAL)) {
  add({ id: 'lumber_' + size, name: size.replace('x', ' x ') + ' framing lumber', category: 'lumber', unit: 'm', material: 'spf_seasoned',
    dims: { widthM: w, depthM: dpt }, priceUsd: lumberPrice[size] });
}
add({ id: 'glulam_90x225', name: 'Glulam beam 90 x 225', category: 'lumber', unit: 'm', material: 'glulam', dims: { widthM: 0.09, depthM: 0.225 }, priceUsd: 38, blurb: 'Strong long-span beam' });

// ---- logs, boards and the engine's cut wood and stone
add({ id: 'log_pine', name: 'Pine log (green)', category: 'logs', unit: 'm3', material: 'log_pine_green', priceUsd: 150, blurb: 'Freshly felled. Needs seasoning' });
add({ id: 'log_birch', name: 'Birch log (green)', category: 'logs', unit: 'm3', material: 'log_birch_green', priceUsd: 170, blurb: 'Freshly felled. Needs seasoning' });
add({ id: 'log_oak', name: 'Oak log (green)', category: 'logs', unit: 'm3', material: 'log_oak_green', priceUsd: 260, blurb: 'Freshly felled. Needs seasoning' });
add({ id: 'board_pine_1x6', name: 'Pine board 19 x 140', category: 'logs', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.14, depthM: 0.019 }, priceUsd: 3.7 });
add({ id: 'board_cedar_1x6', name: 'Cedar board 19 x 140', category: 'logs', unit: 'm', material: 'western_redcedar', dims: { widthM: 0.14, depthM: 0.019 }, priceUsd: 5.2 });
add({ id: 'board_oak_1x6', name: 'Oak board 19 x 140', category: 'logs', unit: 'm', material: 'oak_seasoned', dims: { widthM: 0.14, depthM: 0.019 }, priceUsd: 9 });
// the engine's "wood" counter: one cut billet, the size of the pickup you see drop from a split log
add({ id: 'wood', name: 'Cut wood', category: 'logs', unit: 'each', material: 'pine_seasoned', dims: { lengthM: 0.42, widthM: 0.13, thicknessM: 0.13 }, priceUsd: 1.5, blurb: 'What build mode spends' });

// ---- sheet goods and membranes
const SHEET = { lengthM: 2.44, widthM: 1.22 };
add({ id: 'plywood_12', name: 'Plywood 12 mm (1220 x 2440)', category: 'sheet', unit: 'each', material: 'plywood', dims: { ...SHEET, thicknessM: 0.012 }, priceUsd: 42 });
add({ id: 'plywood_18', name: 'Plywood 18 mm (1220 x 2440)', category: 'sheet', unit: 'each', material: 'plywood', dims: { ...SHEET, thicknessM: 0.018 }, priceUsd: 64 });
add({ id: 'osb_11', name: 'OSB 11 mm (1220 x 2440)', category: 'sheet', unit: 'each', material: 'osb', dims: { ...SHEET, thicknessM: 0.011 }, priceUsd: 19 });
add({ id: 'osb_18', name: 'OSB 18 mm (1220 x 2440)', category: 'sheet', unit: 'each', material: 'osb', dims: { ...SHEET, thicknessM: 0.018 }, priceUsd: 31 });
add({ id: 'gypsum_13', name: 'Gypsum board 12.7 mm (1220 x 2440)', category: 'sheet', unit: 'each', material: 'gypsum_board', dims: { ...SHEET, thicknessM: 0.0127 }, priceUsd: 15 });
add({ id: 'housewrap', name: 'Housewrap', category: 'sheet', unit: 'm2', material: 'housewrap', dims: { thicknessM: 0.00018 }, priceUsd: 1.9 });
add({ id: 'vapour_barrier', name: 'Polyethylene vapour barrier 0.15 mm', category: 'sheet', unit: 'm2', material: 'poly_vapour_barrier', dims: { thicknessM: 0.00015 }, priceUsd: 0.65 });
add({ id: 'canvas', name: 'Canvas 0.8 mm', category: 'sheet', unit: 'm2', material: 'canvas', dims: { thicknessM: 0.0008 }, priceUsd: 9 });

// ---- insulation, sold by the square metre at a stated thickness
add({ id: 'ins_fibreglass_89', name: 'Fibreglass batt 89 mm', category: 'insulation', unit: 'm2', material: 'fibreglass_batt', dims: { thicknessM: 0.089 }, priceUsd: 5.6 });
add({ id: 'ins_mineral_89', name: 'Mineral wool batt 89 mm', category: 'insulation', unit: 'm2', material: 'mineral_wool', dims: { thicknessM: 0.089 }, priceUsd: 10.5 });
add({ id: 'ins_cellulose_140', name: 'Dense-pack cellulose 140 mm', category: 'insulation', unit: 'm2', material: 'cellulose', dims: { thicknessM: 0.14 }, priceUsd: 7 });
add({ id: 'ins_eps_50', name: 'EPS foam board 50 mm', category: 'insulation', unit: 'm2', material: 'eps', dims: { thicknessM: 0.05 }, priceUsd: 9.4 });
add({ id: 'ins_xps_50', name: 'XPS foam board 50 mm', category: 'insulation', unit: 'm2', material: 'xps', dims: { thicknessM: 0.05 }, priceUsd: 15 });
add({ id: 'ins_polyiso_50', name: 'Polyiso foam board 50 mm', category: 'insulation', unit: 'm2', material: 'polyiso', dims: { thicknessM: 0.05 }, priceUsd: 16 });
add({ id: 'ins_wool_89', name: "Sheep's wool batt 89 mm", category: 'insulation', unit: 'm2', material: 'sheep_wool', dims: { thicknessM: 0.089 }, priceUsd: 18 });
add({ id: 'straw_bale', name: 'Straw bale (900 x 460 x 360)', category: 'insulation', unit: 'each', material: 'straw_bale', dims: { lengthM: 0.9, widthM: 0.46, thicknessM: 0.36 }, priceUsd: 9 });

// ---- roofing, by the square metre of roof covered
add({ id: 'roof_asphalt', name: 'Asphalt shingles', category: 'roofing', unit: 'm2', material: 'asphalt_shingle', dims: { thicknessM: 0.007 }, priceUsd: 12 });
add({ id: 'roof_steel', name: 'Standing-seam steel 0.5 mm', category: 'roofing', unit: 'm2', material: 'steel_roofing', dims: { thicknessM: 0.0005 }, priceUsd: 22 });
add({ id: 'roof_cedar', name: 'Cedar shakes', category: 'roofing', unit: 'm2', material: 'cedar_shake', dims: { thicknessM: 0.02 }, priceUsd: 45 });
add({ id: 'roof_thatch', name: 'Water-reed thatch 300 mm', category: 'roofing', unit: 'm2', material: 'thatch', dims: { thicknessM: 0.3 }, priceUsd: 40 });
add({ id: 'roof_slate', name: 'Slate 8 mm', category: 'roofing', unit: 'm2', material: 'slate', dims: { thicknessM: 0.008 }, priceUsd: 95 });
add({ id: 'roof_clay', name: 'Clay tiles 15 mm', category: 'roofing', unit: 'm2', material: 'clay_tile', dims: { thicknessM: 0.015 }, priceUsd: 45 });
add({ id: 'roof_epdm', name: 'EPDM membrane 1.5 mm', category: 'roofing', unit: 'm2', material: 'epdm', dims: { thicknessM: 0.0015 }, priceUsd: 11 });

// ---- glass
add({ id: 'glass_float_4', name: 'Float glass 4 mm', category: 'glass', unit: 'm2', material: 'float_glass', dims: { thicknessM: 0.004 }, priceUsd: 55 });
add({ id: 'glass_dgu', name: 'Double glazing unit (4-12-4)', category: 'glass', unit: 'm2', material: 'dgu', dims: { thicknessM: 0.02 }, priceUsd: 120 });
add({ id: 'glass_dgu_lowe', name: 'Low-e argon double glazing', category: 'glass', unit: 'm2', material: 'dgu_lowe', dims: { thicknessM: 0.024 }, priceUsd: 160 });
add({ id: 'polycarbonate_6', name: 'Polycarbonate sheet 6 mm', category: 'glass', unit: 'm2', material: 'polycarbonate', dims: { thicknessM: 0.006 }, priceUsd: 35 });

// ---- stone and concrete
// the engine's "stone" counter: a hand-sized rock, the size of the pickup you see drop from a boulder
add({ id: 'stone', name: 'Fieldstone', category: 'stone', unit: 'each', material: 'granite', dims: { lengthM: 0.25, widthM: 0.2, thicknessM: 0.2 }, priceUsd: 2.5, blurb: 'What build mode spends' });
add({ id: 'flagstone_40', name: 'Flagstone 40 mm', category: 'stone', unit: 'm2', material: 'sandstone', dims: { thicknessM: 0.04 }, priceUsd: 75 });
add({ id: 'gravel', name: 'Gravel (bulk)', category: 'stone', unit: 'm3', material: 'gravel', priceUsd: 50 });
add({ id: 'concrete_mix', name: 'Concrete mix (dry)', category: 'stone', unit: 'kg', material: 'concrete', priceUsd: 0.19, blurb: 'Add water. Cures to concrete' });
add({ id: 'mortar_mix', name: 'Mortar mix (dry)', category: 'stone', unit: 'kg', material: 'mortar', priceUsd: 0.22 });

// ---- fasteners, by weight
add({ id: 'nails_framing', name: 'Framing nails (galvanised)', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 6.2 });
add({ id: 'screws_wood', name: 'Wood screws', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 12.5 });
add({ id: 'screws_structural', name: 'Structural screws', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 22 });

// ---- hand tools (they work anywhere). Masses are the tool's own, typed.
add({ id: 'axe', name: 'Felling axe', category: 'tools_hand', unit: 'each', massKg: 1.6, priceUsd: 45, blurb: 'Fells and splits' });
add({ id: 'hatchet', name: 'Hatchet', category: 'tools_hand', unit: 'each', massKg: 0.9, priceUsd: 30 });
add({ id: 'bow_saw', name: 'Bow saw', category: 'tools_hand', unit: 'each', massKg: 0.6, priceUsd: 28, blurb: 'Cuts logs to length' });
add({ id: 'hand_saw', name: 'Hand saw', category: 'tools_hand', unit: 'each', massKg: 0.4, priceUsd: 22, blurb: 'Cuts lumber and boards' });
add({ id: 'hammer', name: 'Framing hammer', category: 'tools_hand', unit: 'each', massKg: 0.6, priceUsd: 25 });
add({ id: 'chisel_set', name: 'Chisel set', category: 'tools_hand', unit: 'each', massKg: 0.8, priceUsd: 35 });
add({ id: 'hand_drill', name: 'Hand drill', category: 'tools_hand', unit: 'each', massKg: 0.9, priceUsd: 35 });
add({ id: 'shovel', name: 'Shovel', category: 'tools_hand', unit: 'each', massKg: 2.0, priceUsd: 38 });
add({ id: 'level', name: 'Spirit level 600 mm', category: 'tools_hand', unit: 'each', massKg: 0.9, priceUsd: 30 });
add({ id: 'tape', name: 'Tape measure 7.5 m', category: 'tools_hand', unit: 'each', massKg: 0.3, priceUsd: 15 });

// ---- power tools: powerW is the electrical load while working
add({ id: 'circular_saw', name: 'Circular saw', category: 'tools_power', unit: 'each', massKg: 4.0, priceUsd: 110, powerW: 1500 });
add({ id: 'power_drill', name: 'Drill', category: 'tools_power', unit: 'each', massKg: 1.8, priceUsd: 75, powerW: 710 });
add({ id: 'chainsaw', name: 'Electric chainsaw', category: 'tools_power', unit: 'each', massKg: 4.5, priceUsd: 120, powerW: 1800 });
add({ id: 'table_saw', name: 'Table saw', category: 'tools_power', unit: 'each', massKg: 25, priceUsd: 400, powerW: 1800 });

for (const [id, ingredient] of Object.entries(INGREDIENTS)) {
  add({ id: foodId(id), name: ingredient.name, category: 'food', unit: 'each',
    massKg: ingredient.massKg, priceUsd: ingredient.priceUsd });
}
add({ id: 'kitchen_chopper', name: 'Mechanical vegetable chopper', category: 'tools_hand',
  unit: 'each', massKg: 1.5, priceUsd: 35, blurb: 'Fast chopping and batch preparation for recipes you have cooked' });

// ---- doors and windows from the catalog: one item per type and size (src/sim/content/openings.js)
for (const { dims, massKgPerUnit, ...o } of Object.values(openingItems())) add({ ...o, massKg: massKgPerUnit });   // sold by the unit: no dims, the size is in the name

// ---- the garden: seeds, garden tools, amendments and produce (src/sim/content/garden-items.js)
for (const g of ITEMS_GARDEN) add(g);

// ---- landscaping: trowel and rake, bark, sand, grass seed, pavers, boulders and nursery plants (src/sim/content/landscape.js)
for (const g of ITEMS_LANDSCAPE) add(g);

// ---- vehicles: fuel, the fuel can and the trailer (src/sim/content/vehicles.js)
for (const g of ITEMS_VEHICLES) add(g);

// Read-only. A made-to-order door or window (any size off the store's list) is not listed but is made from its id the
// first time it is asked for, the same every time, so saves and orders that name one keep working.
const BASE = Object.fromEntries(list.map((i) => [i.id, i])), MADE = Object.create(null);
const madeItem = (id) => {
  if (typeof id !== 'string') return undefined;
  if (MADE[id]) return MADE[id];
  // pieces cut at the sawhorses: counted one by one, about 1.2 m each on average, never sold
  if (id.startsWith('cut_lumber_') && BASE[id.slice(4)]) {
    const b = BASE[id.slice(4)];
    return (MADE[id] = Object.freeze({ id, name: 'Cut pieces, ' + b.name.replace(' framing lumber', ''), category: b.category, unit: 'each', material: b.material,
      dims: { lengthM: 1.2, widthM: b.dims.widthM, depthM: b.dims.depthM }, massKgPerUnit: b.massKgPerUnit * 1.2, priceUsd: 0, made: true }));
  }
  if (!id.startsWith('op_')) return undefined;
  const o = openingItemFromId(id);
  if (!o) return undefined;
  const { dims, massKgPerUnit, ...rest } = o;
  return (MADE[id] = Object.freeze({ ...rest, massKgPerUnit }));
};
export const ITEMS = new Proxy(BASE, {
  get: (t, k) => (k in t ? t[k] : madeItem(k)),
  has: (t, k) => k in t || !!madeItem(k),
  set: () => false, defineProperty: () => false, deleteProperty: () => false,
});
export const item = (id) => ITEMS[id];
for (const i of list) if (!ITEM_CATEGORIES.some((c) => c.id === i.category)) throw new Error('item ' + i.id + ' has unknown category');
