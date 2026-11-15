import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim } from '../src/sim/index.js';
import { RECIPES, FOOD_STARTER, foodId } from '../src/sim/food-catalog.js';
import { readyToCook, mealFreshness } from '../src/sim/cooking.js';

const make = () => {
  const sim = createGameSim(1337);
  sim.commandNow('cooking.place', { kind: 'stove', x: 0, y: 4, z: -4 });
  return sim;
};
function action(sim, name, payload = {}) {
  const result = sim.commandNow('cooking.' + name, payload);
  assert.equal(result.ok, true, name + ': ' + result.reason);
}
function prepare(sim, id, herb = false) {
  action(sim, 'recipe', { id });
  const recipe = RECIPES[id];
  const ingredients = [...Object.keys(recipe.ingredients), ...(herb && recipe.herb ? [recipe.herb] : [])];
  for (const ingredient of ingredients) {
    action(sim, 'take', { id: ingredient });
    if (!sim.state.sys.cooking.batch.hand.prepared) {
      action(sim, 'board'); action(sim, 'chop'); action(sim, 'board');
    }
    action(sim, 'add');
  }
  if (recipe.mix) action(sim, 'mix');
  assert.equal(readyToCook(sim.state.sys.cooking.batch), true);
}
function cook(sim, id, herb = false) {
  prepare(sim, id, herb);
  action(sim, 'start', { heat: RECIPES[id].heat });
  for (let tick = 0; tick < 150 && sim.state.sys.cooking.batch.status === 'cooking'; tick++) sim.runTicks(1);
  assert.equal(sim.state.sys.cooking.batch.status, 'ready');
  action(sim, 'serve');
}
test('all six recipes prepare, cook and produce the declared portions', () => {
  for (const [id, recipe] of Object.entries(RECIPES)) {
    const sim = make(), before = { ...sim.state.sys.stock.items };
    cook(sim, id, true);
    const meal = sim.state.sys.cooking.meals[0];
    assert.equal(meal.qty, recipe.portions);
    assert.equal(meal.quality, recipe.herb ? 'lovely' : 'good');
    for (const [ingredient, qty] of Object.entries(recipe.ingredients)) {
      assert.equal(before[foodId(ingredient)] - (sim.state.sys.stock.items[foodId(ingredient)] || 0), qty);
    }
    assert.ok(sim.state.sys.cooking.learned.includes(id));
  }
});
test('rejected actions preserve ingredients, and cancellation refunds each held item once', () => {
  const sim = make(), before = { ...sim.state.sys.stock.items };
  action(sim, 'recipe', { id: 'soup' });
  action(sim, 'take', { id: 'potato' });
  const snapshot = sim.serialize();
  assert.equal(sim.commandNow('cooking.add').ok, false);
  assert.equal(sim.commandNow('cooking.take', { id: 'carrot' }).ok, false);
  assert.equal(sim.commandNow('cooking.start', { heat: 'high' }).ok, false);
  assert.deepEqual(sim.serialize(), snapshot);
  action(sim, 'board'); action(sim, 'chop'); action(sim, 'board'); action(sim, 'add');
  action(sim, 'take', { id: 'carrot' }); action(sim, 'board');
  action(sim, 'take', { id: 'onion' });
  action(sim, 'clear'); action(sim, 'clear');
  assert.deepEqual(sim.state.sys.stock.items, before);
});
test('chopper batch preparation requires a learned recipe, ownership and sufficient inventory', () => {
  const sim = make();
  action(sim, 'recipe', { id: 'soup' });
  assert.equal(sim.commandNow('cooking.autoprep').ok, false);
  action(sim, 'clear');
  cook(sim, 'soup');
  action(sim, 'recipe', { id: 'soup' });
  assert.equal(sim.commandNow('cooking.autoprep').ok, false);
  sim.commandNow('stock.buy', { id: 'kitchen_chopper', qty: 1 });
  action(sim, 'autoprep');
  const batch = sim.state.sys.cooking.batch;
  assert.equal(batch.added.potato, 1);
  assert.equal(batch.added.water_food, undefined, 'the chopper only prepares vegetables');
  assert.equal(readyToCook(batch), false);
  assert.equal(sim.commandNow('cooking.autoprep').ok, false);
  action(sim, 'take', { id: 'water_food' }); action(sim, 'add'); action(sim, 'mix');
  assert.equal(readyToCook(batch), true);
});
test('heat, time and seasoning influence quality, and unattended food burns', () => {
  const sim = make();
  prepare(sim, 'eggs');
  action(sim, 'start', { heat: 'low' });
  sim.runTicks(8);
  assert.equal(sim.state.sys.cooking.batch.status, 'cooking', 'gentle heat cooks eggs slowly');
  action(sim, 'heat', { heat: 'high' });
  sim.runTicks(60);
  assert.equal(sim.state.sys.cooking.batch.status, 'burnt');
  assert.equal(sim.commandNow('cooking.serve').ok, false);
  assert.equal(sim.state.sys.cooking.batch.heat, 'off');
});
test('turning off heat holds a finished dish, spoilage prevents eating, hunger stays nonlethal', () => {
  const sim = make();
  prepare(sim, 'fish');
  action(sim, 'start', { heat: 'medium' });
  while (sim.state.sys.cooking.batch.status === 'cooking') sim.runTicks(1);
  action(sim, 'heat', { heat: 'off' });
  sim.runTicks(60);
  assert.equal(sim.state.sys.cooking.batch.status, 'ready');
  action(sim, 'serve');
  const meal = sim.state.sys.cooking.meals[0];
  const before = sim.state.sys.cooking.fullness;
  action(sim, 'eat', { id: meal.id });
  assert.ok(sim.state.sys.cooking.fullness > before);
  assert.equal(meal.qty, 1);
  sim.runDays(6);
  assert.equal(sim.state.sys.cooking.fullness, 0);
  assert.equal(mealFreshness(meal, sim.state.t), 0);
  assert.equal(sim.commandNow('cooking.eat', { id: meal.id }).ok, false);
});
test('save/load keeps ingredient custody and resumes cooking identically', () => {
  const first = make();
  action(first, 'recipe', { id: 'soup' }); action(first, 'take', { id: 'potato' });
  const loaded = make(); loaded.load(first.serialize());
  assert.equal(loaded.hash(), first.hash());
  for (const sim of [first, loaded]) { action(sim, 'clear'); prepare(sim, 'bread'); action(sim, 'start', { heat: 'high' }); sim.runTicks(8); }
  assert.equal(loaded.hash(), first.hash());
  const resumed = make(); resumed.load(first.serialize());
  first.runTicks(22); resumed.runTicks(22);
  assert.equal(resumed.hash(), first.hash());
});
test('legacy saves get one starter pantry and malformed commands cannot create food', () => {
  const sim = make(), old = sim.serialize();
  delete old.sys.cooking;
  for (const id of Object.keys(FOOD_STARTER)) delete old.sys.stock.items[foodId(id)];
  sim.load(old);
  assert.equal(sim.state.sys.stock.items.food_potato, FOOD_STARTER.potato);
  sim.load(sim.serialize());
  assert.equal(sim.state.sys.stock.items.food_potato, FOOD_STARTER.potato);
  for (const id of ['__proto__', 'constructor', 'missing']) {
    assert.equal(sim.commandNow('cooking.recipe', { id }).ok, false);
  }
  action(sim, 'place', { kind: 'fire', x: 0, y: 4, z: -4 });
  assert.equal(sim.commandNow('cooking.recipe', { id: 'bread' }).ok, false);
  assert.equal(sim.commandNow('cooking.place', { kind: 'stove', x: NaN, y: 0, z: 0 }).ok, false);
});
