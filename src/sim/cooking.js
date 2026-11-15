// Headless cooking. All ingredient custody, heat, meals and hunger are saved here.
// The view animates successful actions; commands own the actual transfers.
import { INGREDIENTS, FOOD_STARTER, RECIPES, COOKERS, HEAT, foodId } from './food-catalog.js';
import { stockAdd, stockRemove } from './stock.js';
import { DAY } from './time.js';

const has = (catalog, id) => typeof id === 'string' && Object.hasOwn(catalog, id);
const ok = () => ({ ok: true });
const fail = (reason) => ({ ok: false, reason });
const batchOf = (c) => c.s.batch;
const prepping = (c) => c.s.batch?.status === 'prep';
const stockOf = (c) => c.get('stock');

export function cookingQuality(batch) {
  if (batch.status === 'burnt') return 'burnt';
  if (batch.damage > 0.5) return 'rough';
  return batch.seasoned && batch.damage < 0.15 ? 'lovely' : 'good';
}
export function readyToCook(batch) {
  if (!batch || batch.status !== 'prep' || batch.hand || batch.board) return false;
  const recipe = RECIPES[batch.recipe];
  return Object.entries(recipe.ingredients).every(([id, qty]) => batch.added[id] === qty) &&
    (!recipe.mix || batch.mixed);
}
export function mealFreshness(meal, t) {
  return Math.max(0, Math.min(1, (meal.expiresAt - t) / (meal.expiresAt - meal.madeAt)));
}
function validIngredient(batch, id) {
  const recipe = RECIPES[batch.recipe];
  return has(INGREDIENTS, id) && (Object.hasOwn(recipe.ingredients, id) || recipe.herb === id);
}
function refundPrep(c) {
  const batch = c.s.batch;
  for (const [id, qty] of Object.entries(batch.added)) stockAdd(stockOf(c), foodId(id), qty);
  for (const held of [batch.hand, batch.board]) if (held) stockAdd(stockOf(c), foodId(held.id), held.qty);
}
const commands = {
  'cooking.place': (c, p) => {
    if (!has(COOKERS, p.kind) || ![p.x, p.y, p.z].every((v) => Number.isFinite(v) && Math.abs(v) < 1e6)) return fail('Choose a level site.');
    if (c.s.batch) return fail('Finish or clear the current dish before moving the kitchen.');
    c.s.station = { kind: p.kind, x: p.x, y: p.y, z: p.z };
    return ok();
  },
  'cooking.pack': (c) => {
    if (c.s.batch) return fail('Finish or put away the current dish before packing the kitchen.');
    c.s.station = null;
    return ok();
  },
  'cooking.recipe': (c, p) => {
    if (!c.s.station || !has(RECIPES, p.id)) return fail('Choose a recipe at a kitchen.');
    if (c.s.batch) return fail('Finish or clear the current dish first.');
    if (!COOKERS[c.s.station.kind].methods.includes(RECIPES[p.id].method)) return fail('This recipe needs an oven.');
    c.s.batch = { recipe: p.id, status: 'prep', added: {}, hand: null, board: null,
      mixed: false, seasoned: false, heat: 'off', temperatureC: 20, progress: 0, damage: 0, rest: 0 };
    return ok();
  },
  'cooking.take': (c, p) => {
    const b = batchOf(c);
    if (!prepping(c) || b.hand || !validIngredient(b, p.id)) return fail('Put down what you are holding first.');
    if (b.board?.id === p.id || b.added[p.id]) return fail('That ingredient is already prepared.');
    const qty = RECIPES[b.recipe].ingredients[p.id] || 1;
    const r = stockRemove(stockOf(c), foodId(p.id), qty);
    if (!r.ok) return fail('Get more ' + INGREDIENTS[p.id].name.toLowerCase() + ' from the supplier.');
    b.hand = { id: p.id, qty, prepared: INGREDIENTS[p.id].prep !== 'chop' };
    return ok();
  },
  'cooking.board': (c) => {
    const b = batchOf(c);
    if (!prepping(c)) return fail('Choose a dish first.');
    if (b.board && !b.hand) { b.hand = b.board; b.board = null; return ok(); }
    if (!b.hand || b.board || INGREDIENTS[b.hand.id].prep !== 'chop') return fail('Place a vegetable or herb on the board.');
    b.board = b.hand; b.hand = null;
    return ok();
  },
  'cooking.chop': (c) => {
    const b = batchOf(c);
    if (!prepping(c) || !b.board || b.board.prepared) return fail('Put an uncut vegetable on the board.');
    b.board.prepared = true;
    return ok();
  },
  'cooking.add': (c) => {
    const b = batchOf(c);
    if (!prepping(c) || !b.hand) return fail('Pick up an ingredient first.');
    if (!b.hand.prepared) return fail('Chop this on the board first.');
    b.added[b.hand.id] = b.hand.qty;
    if (RECIPES[b.recipe].herb === b.hand.id) b.seasoned = true;
    b.hand = null; b.mixed = false;
    return ok();
  },
  'cooking.mix': (c) => {
    const b = batchOf(c);
    if (!prepping(c) || b.hand || b.board || !RECIPES[b.recipe].mix) return fail('Add the ingredients first.');
    if (!Object.entries(RECIPES[b.recipe].ingredients).every(([id, qty]) => b.added[id] === qty)) return fail('Add all the recipe ingredients before mixing.');
    b.mixed = true;
    return ok();
  },
  'cooking.autoprep': (c) => {
    const b = batchOf(c);
    if (!prepping(c) || b.hand || b.board) return fail('Put down the ingredient you are holding first.');
    if (!c.s.learned.includes(b.recipe) || !stockOf(c).tools.includes('kitchen_chopper')) return fail('Cook this recipe once and buy the mechanical chopper first.');
    const ingredients = Object.fromEntries(Object.entries(RECIPES[b.recipe].ingredients)
      .filter(([id]) => INGREDIENTS[id].prep === 'chop' && !b.added[id]));
    if (!Object.keys(ingredients).length) return fail('There are no vegetables left to chop.');
    if (!Object.entries(ingredients).every(([id, qty]) => (stockOf(c).items[foodId(id)] || 0) >= qty)) return fail('Some ingredients are missing.');
    for (const [id, qty] of Object.entries(ingredients)) stockRemove(stockOf(c), foodId(id), qty);
    Object.assign(b.added, ingredients); b.mixed = false;
    return ok();
  },
  'cooking.start': (c, p) => {
    const b = batchOf(c);
    if (!readyToCook(b)) return fail('Finish preparing the ingredients first.');
    if (!has(HEAT, p.heat) || p.heat === 'off') return fail('Choose a cooking temperature.');
    b.status = 'cooking'; b.heat = p.heat;
    return ok();
  },
  'cooking.heat': (c, p) => {
    if (!c.s.batch || !['cooking', 'ready'].includes(c.s.batch.status) || !has(HEAT, p.heat)) return fail('Start cooking before adjusting the heat.');
    c.s.batch.heat = p.heat;
    return ok();
  },
  'cooking.serve': (c) => {
    const b = batchOf(c);
    if (!b || b.status !== 'ready') return fail('The dish is not ready to serve.');
    if (c.s.meals.length >= 40) return fail('Your meal shelf is full. Eat or discard a batch first.');
    const recipe = RECIPES[b.recipe];
    c.s.meals.push({ id: c.s.nextMeal++, recipe: b.recipe, qty: recipe.portions, quality: cookingQuality(b),
      madeAt: c.t, expiresAt: c.t + DAY * recipe.freshDays });
    if (!c.s.learned.includes(b.recipe)) c.s.learned.push(b.recipe);
    c.s.batch = null;
    return ok();
  },
  'cooking.clear': (c) => {
    if (prepping(c)) refundPrep(c);
    c.s.batch = null;
    return ok();
  },
  'cooking.eat': (c, p) => {
    const i = c.s.meals.findIndex((meal) => meal.id === p.id), meal = c.s.meals[i];
    if (!meal || meal.expiresAt <= c.t) return fail('That meal has spoiled.');
    const factor = meal.quality === 'rough' ? 0.75 : meal.quality === 'lovely' ? 1.1 : 1;
    c.s.fullness = Math.min(100, c.s.fullness + RECIPES[meal.recipe].satiety * factor);
    c.s.wellFedUntil = c.t + 6 * 3600;
    if (--meal.qty === 0) c.s.meals.splice(i, 1);
    return ok();
  },
  'cooking.discardMeal': (c, p) => {
    const i = c.s.meals.findIndex((meal) => meal.id === p.id);
    if (i < 0) return fail('Meal not found.');
    c.s.meals.splice(i, 1);
    return ok();
  },
};

export const cookingSystem = () => ({
  name: 'cooking',
  init(c) {
    // Provision once, including legacy saves that predate the kitchen.
    for (const [id, qty] of Object.entries(FOOD_STARTER)) stockAdd(stockOf(c), foodId(id), qty);
    return { station: null, batch: null, meals: [], learned: [], nextMeal: 1, fullness: 80, wellFedUntil: 0, version: 0 };
  },
  step(c) {
    const s = c.s;
    s.fullness = Math.max(0, s.fullness - 20 * c.dt / DAY);
    const b = s.batch;
    if (!b || b.status === 'prep' || b.status === 'burnt' || b.status === 'spoiled') return;
    const recipe = RECIPES[b.recipe];
    b.temperatureC += (HEAT[b.heat] - b.temperatureC) * (1 - Math.exp(-c.dt / 150));
    if (b.heat === 'off') {
      b.rest += c.dt;
      if (b.rest >= recipe.freshDays * DAY) { b.status = 'spoiled'; c.emit('cooking.notice', { message: 'The dish left at the station has spoiled. Clear it before cooking again.' }); }
      return;
    }
    const rate = Math.max(0, Math.min(1.25, (b.temperatureC - recipe.minC) / (recipe.idealC - recipe.minC)));
    b.progress += c.dt * rate;
    b.damage += Math.max(0, b.temperatureC - recipe.maxC) / 100 * c.dt / (recipe.minutes * 60);
    const duration = recipe.minutes * 60;
    if (b.status === 'cooking' && b.progress >= duration) {
      b.status = 'ready';
      c.emit('cooking.notice', { message: recipe.name + ' is ready. Turn off the heat or serve when you return.' });
    }
    if (b.progress > duration * 1.6) b.damage += c.dt / duration;
    if (b.damage >= 1) {
      b.status = 'burnt'; b.heat = 'off';
      c.emit('cooking.notice', { message: recipe.name + ' burned. Clear the pan to start again.' });
    }
  },
  commands: Object.fromEntries(Object.entries(commands).map(([name, fn]) => [name, (c, p = {}) => {
    const result = fn(c, p || {});
    if (result.ok) c.s.version++;
    c.emit('cooking.action', { name, ...result });
    return result;
  }])),
});
