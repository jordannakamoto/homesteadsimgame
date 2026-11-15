// Game quantities and cooking durations use the world's accelerated clock.
// These are approachable recipe abstractions, not food-safety instructions.
export const INGREDIENTS = Object.freeze({
  potato: { name: 'Potato', massKg: 0.2, priceUsd: 0.6, prep: 'chop', color: 0xb89b60 },
  carrot: { name: 'Carrot', massKg: 0.1, priceUsd: 0.4, prep: 'chop', color: 0xe78b35 },
  onion: { name: 'Onion', massKg: 0.15, priceUsd: 0.5, prep: 'chop', color: 0xd6b186 },
  tomato: { name: 'Tomato', massKg: 0.15, priceUsd: 0.7, prep: 'chop', color: 0xc94735 },
  egg: { name: 'Egg', massKg: 0.06, priceUsd: 0.4, prep: 'crack', color: 0xe9d6b4 },
  milk: { name: 'Milk jug', massKg: 0.25, priceUsd: 0.5, prep: 'pour', color: 0xe9e4cd },
  flour: { name: 'Flour scoop', massKg: 0.2, priceUsd: 0.3, prep: 'pour', color: 0xd9c9a3 },
  parsley: { name: 'Parsley', massKg: 0.01, priceUsd: 0.2, prep: 'chop', color: 0x4e853e },
  thyme: { name: 'Thyme', massKg: 0.01, priceUsd: 0.2, prep: 'chop', color: 0x718449 },
  fish: { name: 'Cleaned trout', massKg: 0.3, priceUsd: 2, prep: 'whole', color: 0x8babad },
  water_food: { name: 'Water jug', massKg: 0.5, priceUsd: 0.05, prep: 'pour', color: 0x89b6c0 },
  oil_food: { name: 'Cooking oil', massKg: 0.02, priceUsd: 0.1, prep: 'pour', color: 0xd5b954 },
  baking_powder: { name: 'Baking powder', massKg: 0.005, priceUsd: 0.1, prep: 'pour', color: 0xf0e8d2 },
});
export const FOOD_STARTER = Object.freeze({
  potato: 8, carrot: 8, onion: 6, tomato: 6, egg: 12, milk: 8, flour: 10,
  parsley: 6, thyme: 6, fish: 3, water_food: 12, oil_food: 12, baking_powder: 4,
});
export const RECIPES = Object.freeze({
  soup: { name: 'Vegetable soup', method: 'simmer', vessel: 'pot', mix: true,
    ingredients: { potato: 1, carrot: 1, onion: 1, tomato: 1, water_food: 2 },
    herb: 'parsley', minutes: 24, heat: 'low', minC: 80, idealC: 100, maxC: 120, portions: 4, satiety: 24, freshDays: 2,
    steps: 'Chop the vegetables, add water to the pot, stir, then simmer gently.' },
  eggs: { name: 'Fried eggs', method: 'fry', vessel: 'pan', mix: false,
    ingredients: { egg: 2, oil_food: 1 }, herb: 'parsley', minutes: 4, heat: 'medium', minC: 90, idealC: 150, maxC: 200,
    portions: 2, satiety: 20, freshDays: 1, steps: 'Oil the pan, crack in two eggs, then fry over medium heat.' },
  roast: { name: 'Roasted vegetables', method: 'roast', vessel: 'tray', mix: true,
    ingredients: { potato: 2, carrot: 1, onion: 1, oil_food: 1 }, herb: 'thyme', minutes: 26, heat: 'high', minC: 130, idealC: 200, maxC: 240,
    portions: 4, satiety: 25, freshDays: 2, steps: 'Chop, toss with oil in the tray, then roast in the oven.' },
  pancakes: { name: 'Pancakes', method: 'fry', vessel: 'bowl', mix: true,
    ingredients: { flour: 1, egg: 1, milk: 1, oil_food: 1 }, minutes: 6, heat: 'medium', minC: 90, idealC: 160, maxC: 200,
    portions: 3, satiety: 25, freshDays: 2, steps: 'Combine flour, egg and milk, whisk the batter, then pour into the pan.' },
  bread: { name: 'Quick milk bread', method: 'bake', vessel: 'bowl', mix: true,
    ingredients: { flour: 2, milk: 1, baking_powder: 1 }, minutes: 28, heat: 'high', minC: 130, idealC: 200, maxC: 240,
    portions: 6, satiety: 22, freshDays: 3, steps: 'Mix flour, milk and baking powder into dough, then bake a small loaf.' },
  fish: { name: 'Pan-fried trout', method: 'fry', vessel: 'pan', mix: false,
    ingredients: { fish: 1, oil_food: 1 }, herb: 'thyme', minutes: 9, heat: 'medium', minC: 100, idealC: 170, maxC: 210,
    portions: 2, satiety: 32, freshDays: 1, steps: 'Place the cleaned fish in an oiled pan. Add thyme if you like, then fry.' },
});
export const COOKERS = Object.freeze({
  stove: { name: 'Stove & oven', methods: ['simmer', 'fry', 'roast', 'bake'] },
  fire: { name: 'Open-fire grate', methods: ['simmer', 'fry'] },
});
export const HEAT = Object.freeze({ off: 20, low: 110, medium: 180, high: 230 });
export const foodId = (id) => 'food_' + id;
