// Garden items for the catalog: seed packets, garden tools, amendments by volume, and the produce.
// Specs in the format of src/sim/items.js (`add` computes nothing here: every garden item carries its own
// mass, typed). Prices are 2026 US retail, rounded; produce prices are what the same food costs in a shop,
// kept for the ledger and a roadside stand later.
//
// Potatoes, carrots and tomatoes are harvested as the kitchen's own ingredients (food_potato, food_carrot,
// food_tomato in src/sim/food-catalog.js), counted whole, so they can be cooked; the rest are produce by weight.
//
// Seed counts per packet are typical for the variety's seed size (seed-catalogue figures, approx).
// Seed potatoes and seed garlic are sold by weight: a 55 g seed piece per plant (about 18 per kg), and
// about 100 cloves per kg of hardneck seed garlic. Tomatoes come as transplants, six to a tray.

export const GARDEN_CATEGORIES = Object.freeze([
  { id: 'seeds', name: 'Seeds and plants', blurb: 'Packets, seed potatoes, garlic and transplants' },
  { id: 'garden', name: 'Garden supplies', blurb: 'Compost, manure, lime and mulch' },
  { id: 'produce', name: 'Produce', blurb: 'What the garden grew' },
]);

const seed = (id, name, priceUsd, massKg, blurb, unit = 'each') => ({ id, name, category: 'seeds', unit, massKg, priceUsd, blurb });
export const ITEMS_GARDEN = Object.freeze([
  seed('seed_radish', 'Radish seed (Cherry Belle)', 3.5, 0.006, 'About 300 seeds. Ready in four weeks'),
  seed('seed_lettuce', 'Lettuce seed (Black Seeded Simpson)', 3.5, 0.003, 'About 500 seeds. Leaf lettuce, 46 days'),
  seed('seed_peas', 'Pea seed (Sugar Snap)', 4.5, 0.03, 'About 120 seeds. Sow early, 62 days'),
  seed('seed_bean', 'Bush bean seed (Provider)', 4.5, 0.06, 'About 100 seeds. After the frost, 50 days'),
  seed('seed_carrot', 'Carrot seed (Nantes)', 3.5, 0.003, 'About 1,000 seeds. 68 days'),
  seed('seed_squash', 'Winter squash seed (Waltham Butternut)', 4, 0.006, 'About 25 seeds. 100 days'),
  seed('seed_kale', 'Kale seed (Lacinato)', 3.5, 0.002, 'About 300 seeds. 60 days, picks all winter'),
  seed('seed_corn', 'Sweet corn seed (Early Sunglow)', 4.5, 0.03, 'About 100 seeds. Sow in a block, 70 days'),
  seed('seed_wheat', 'Wheat seed (hard red spring)', 3, 1, 'About 25,000 seeds per kg. 105 days', 'kg'),
  seed('seed_potato', 'Seed potatoes (Yukon Gold)', 3.5, 1, 'About 18 seed pieces per kg. 90 days', 'kg'),
  seed('seed_garlic', 'Seed garlic (Music)', 26, 1, 'About 100 cloves per kg. Plant in autumn', 'kg'),
  seed('seedling_tomato', 'Tomato transplants (Early Girl), tray of 6', 6, 1.2, 'Plant out after the frost. 59 days'),

  { id: 'spade', name: 'Garden spade', category: 'tools_hand', unit: 'each', massKg: 2.1, priceUsd: 45, blurb: 'Turns sod into a bed' },
  { id: 'hoe', name: 'Hand hoe', category: 'tools_hand', unit: 'each', massKg: 0.7, priceUsd: 28, blurb: 'Cuts weeds off at the root' },
  { id: 'watering_can', name: 'Watering can, 9 L', category: 'tools_hand', unit: 'each', massKg: 1.1, priceUsd: 25, blurb: 'Holds 9 litres' },
  { id: 'hose', name: 'Garden hose, 15 m', category: 'tools_hand', unit: 'each', massKg: 3, priceUsd: 40, blurb: 'Waters from a tap or tank' },

  // bulk by the litre (loose volume): compost 0.55 kg/L, aged manure 0.7 kg/L, straw mulch 0.05 kg/L
  { id: 'compost', name: 'Compost', category: 'garden', unit: 'L', massKg: 0.55, priceUsd: 0.15, blurb: 'Feeds the soil slowly. 20 L per m2 is a 2 cm layer' },
  { id: 'manure', name: 'Aged manure', category: 'garden', unit: 'L', massKg: 0.7, priceUsd: 0.12, blurb: 'Richer than compost' },
  { id: 'lime', name: 'Garden lime (ground limestone)', category: 'garden', unit: 'kg', massKg: 1, priceUsd: 0.6, blurb: 'Sweetens sour soil, slowly' },
  { id: 'mulch_straw', name: 'Straw mulch', category: 'garden', unit: 'L', massKg: 0.05, priceUsd: 0.03, blurb: '75 L covers a square metre: less watering, fewer weeds' },

  ...[
    ['produce_radish', 'Radishes', 6], ['produce_lettuce', 'Lettuce', 9], ['produce_peas', 'Snap peas', 10], 
    ['produce_bean', 'Green beans', 8], ['produce_squash', 'Butternut squash', 3.5],
    ['produce_kale', 'Kale', 10], ['produce_garlic', 'Garlic', 18], ['produce_corn', 'Sweet corn', 4], ['produce_wheat', 'Wheat grain', 0.6],
  ].map(([id, name, priceUsd]) => ({ id, name, category: 'produce', unit: 'kg', massKg: 1, priceUsd, blurb: 'Grown here' })),
]);
