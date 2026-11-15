import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameSim } from "../src/sim/index.js";
import {
  initKitchenPhysics,
  heatStep,
  GRID,
  validCell,
  cellPoint,
} from "../src/sim/physical-kitchen.js";
import { carrotSolid, splitSolid, volume } from "../src/sim/food-solid.js";
await initKitchenPhysics();
function make() {
  const sim = createGameSim(1337);
  sim.commandNow("cooking.place", { kind: "stove", x: 0, y: 4, z: 0 });
  sim.commandNow("kitchen.setup");
  sim.commandNow("kitchen.carrot");
  return sim;
}
const s = (sim) => sim.state.sys.physicalKitchen;
const act = (sim, name, p = {}) => {
  const r = sim.commandNow("kitchen." + name, p);
  assert.equal(r.ok, true, r.reason);
};
const advance = (sim, n = 60) => {
  for (let i = 0; i < n; i++) act(sim, "advance", { dt: 1 / 60 });
};
function move(sim, id, p) {
  act(sim, "grab", { id });
  act(sim, "move", p);
  advance(sim, 90);
  act(sim, "release");
  advance(sim, 60);
}
test("convex cuts are closed, arbitrary and conserve volume", () => {
  const whole = carrotSolid(),
    v = volume(whole);
  for (const [n, d] of [
    [[1, 0, 0], 0.1],
    [[0.6, 0.8, 0], 0],
    [[0, 0, 1], 0.015],
  ]) {
    const pieces = splitSolid(whole, n, d);
    assert.ok(pieces);
    assert.ok(Math.abs(pieces.reduce((a, p) => a + volume(p), 0) - v) < 1e-8);
    for (const p of pieces) {
      const edges = new Map();
      const key = (v) => v.map((x) => x.toFixed(6)).join(",");
      for (const face of p)
        for (let i = 0; i < face.length; i++) {
          const edge = [key(face[i]), key(face[(i + 1) % face.length])]
            .sort()
            .join("|");
          edges.set(edge, (edges.get(edge) || 0) + 1);
        }
      assert.ok([...edges.values()].every((n) => n === 2));
    }
  }
  assert.equal(splitSolid(whole, [1, 0, 0], 2), null);
});
test("descending physical knife slices where its blade crosses food, conserving mass", () => {
  const sim = make();
  advance(sim, 60);
  const knife = s(sim).objects.find((o) => o.kind === "knife");
  const carrot = s(sim).objects.find((o) => o.kind === "carrot");
  const x = carrot.p.x + 0.12,
    z = carrot.p.z;
  act(sim, "grab", { id: knife.id });
  act(sim, "move", { x, y: 0.6, z });
  advance(sim, 60);
  assert.equal(s(sim).cuts, 0, "hovering does not cut");
  act(sim, "move", { x, y: 0.105, z });
  advance(sim, 40);
  assert.equal(s(sim).cuts, 1);
  const pieces = s(sim).objects.filter((o) => o.kind === "carrot");
  assert.equal(pieces.length, 2);
  assert.ok(Math.abs(pieces.reduce((a, o) => a + o.mass, 0) - 0.12) < 1e-8);
  assert.notEqual(pieces[0].mass, pieces[1].mass);
});
test("food drops into a hollow pan and travels with it through contacts", () => {
  const sim = make();
  advance(sim);
  const pan = s(sim).objects.find((o) => o.kind === "pan"),
    food = s(sim).objects.find((o) => o.kind === "carrot");
  move(sim, food.id, { x: pan.p.x, y: 0.7, z: pan.p.z });
  assert.ok(Math.abs(food.p.x - pan.p.x) < 0.4);
  assert.ok(food.p.y > pan.p.y);
  move(sim, pan.id, { x: 1.4, y: 0.65, z: -0.25 });
  assert.ok(
    Math.hypot(food.p.x - pan.p.x, food.p.z - pan.p.z) < 0.48,
    "walls carry loose food",
  );
  assert.ok(Math.abs(pan.p.y - 0.185) < 0.06, "pan settles on stove");
});
test("partial burner overlap heats contact cells, diffusion spreads heat and lifting stops input", () => {
  const sim = make(),
    st = s(sim),
    pan = st.objects.find((o) => o.kind === "pan");
  pan.p = { x: 1.75, y: 0.185, z: -0.25 };
  pan.q = { x: 0, y: 0, z: 0, w: 1 };
  st.power = 1;
  heatStep(st, 15);
  const left = [],
    right = [];
  for (let i = 0; i < GRID * GRID; i++)
    if (validCell(i)) (cellPoint(i)[0] < 0 ? left : right).push(st.grid[i]);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(left) > avg(right) + 30, "overlapping side gets hotter");
  const max = Math.max(...st.grid);
  pan.p.y = 1;
  heatStep(st, 30);
  assert.ok(Math.max(...st.grid) < max, "lifting removes burner contact");
  st.power = 0;
  heatStep(st, 300);
  assert.ok(Math.max(...st.grid) < 40);
});
test("raw handling and heat state survive saves, with finite physics after load", () => {
  const sim = make();
  advance(sim);
  act(sim, "grab", { id: s(sim).objects[0].id });
  act(sim, "move", { x: 1, y: 0.7, z: 0 });
  advance(sim, 10);
  s(sim).grid[40] = 120;
  const saved = sim.serialize(),
    copy = createGameSim(1337);
  copy.load(saved);
  assert.deepEqual(s(copy), s(sim));
  advance(copy, 90);
  assert.equal(s(copy).held, null);
  assert.equal(s(copy).grid[40], 120);
  assert.ok(s(copy).objects.every((o) => Number.isFinite(o.p.y) && o.p.y > -1));
});
test("pantry custody, fragment limits, eating and bad commands cannot duplicate food", () => {
  const sim = make(),
    st = s(sim),
    stock = sim.state.sys.stock.items;
  assert.equal(stock.food_carrot, 7);
  const before = JSON.stringify(st);
  assert.equal(
    sim.commandNow("kitchen.move", { x: NaN, y: 0, z: 0 }).ok,
    false,
  );
  assert.equal(JSON.stringify(st), before);
  const food = st.objects.find((o) => o.kind === "carrot");
  const pan = st.objects.find((o) => o.kind === "pan");
  food.p = { ...pan.p, y: pan.p.y + 0.1 };
  sim.state.sys.cooking.fullness = 30;
  act(sim, "grab", { id: pan.id });
  const plate = { x: 0.05, y: 0, z: 0.8 };
  assert.equal(
    sim.commandNow("kitchen.plate", plate).ok,
    false,
    "raw food stays in pan",
  );
  food.cooked = 1;
  act(sim, "plate", plate);
  assert.equal(sim.state.sys.cooking.fullness, 30, "serving does not eat");
  advance(sim, 1); // The held pan can still move after its contents are removed.
  assert.equal(
    sim.commandNow("kitchen.plate", plate).ok,
    false,
    "cannot serve twice",
  );
  const copy = createGameSim(1337);
  copy.load(sim.serialize());
  const meal = copy.state.sys.cooking.meals[0];
  assert.equal(meal.recipe, "panCarrots");
  assert.equal(copy.commandNow("cooking.eat", { id: meal.id }).ok, true);
  assert.equal(copy.state.sys.cooking.fullness, 42);
  for (let i = 0; i < 7; i++) act(sim, "carrot");
  assert.equal(stock.food_carrot || 0, 0);
  assert.equal(sim.commandNow("kitchen.carrot").ok, false);
});
