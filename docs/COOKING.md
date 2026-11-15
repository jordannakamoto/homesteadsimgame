# V1 cooking

Press K or Kitchen to place/open the starter kitchen nearby. The camera moves into a close-up workbench view. Escape or Leave returns to exploration. Click physical ingredients or their labels, click the board to chop in one short animation, then add to the vessel. Pouring, cracking eggs and mixing animate briefly. Click the cooker to start, leave it cooking, and return to serve. Heat and elapsed world time affect readiness, quality and burning. Turn heat off to hold a finished dish; food still eventually spoils.

Six recipes: vegetable soup, fried eggs, roasted vegetables, pancakes, quick milk bread and pan-fried trout. Optional herbs improve quality. Stove/oven supports all methods; open fire supports simmering and frying. Recipe selection shows quantities and recommended heat. Prep cancellation returns ingredients. Packing requires an empty kitchen. Purchase a mechanical chopper from the supplier; after successfully making a recipe once, it can batch-chop that recipe's vegetables.

Meals opens the prepared-food shelf, with freshness, eating and discarding. Hunger falls by 20 points per world day without starvation damage. Eating restores fullness and can grant 10% faster stamina recovery for six world hours while fullness stays at least 60. Starter pantry supplies are granted once, including when loading a legacy save. Replenish through the supplier's Food & pantry category.

## Architecture and scope

`src/sim/food-catalog.js` holds ingredient, recipe and cooker data. `src/sim/cooking.js` owns authoritative ingredient custody, heat, quality, meals, spoilage and hunger through commands and fixed simulation ticks. State persists through the existing save system. `src/cooking/view.js` handles camera, interactions and UI; `models.js` supplies shared low-poly geometry/materials. Existing construction and world rendering remain in place.

V1 uses constrained workstation interactions and procedural models, not freely simulated rigid-body ingredients. There is one kitchen per save. Farming/livestock/fishing production integration, multiple simultaneous users/stations, fuel consumption, oven-door interactions and networking remain future work. Heat and recipe durations are gameplay abstractions, not real food-safety guidance. No Rapier dependency or new full-screen render passes were added.

## Validation, 2026-11-15

- `npm test`: 53 passed, 0 failed. Cooking coverage includes all recipes, conservation/refunds, invalid actions, chopper requirements, heat/time outcomes, hunger/spoilage and save/load determinism.
- Existing page smoke also passes: Low/High rendering, time controls, construction UI, save/reload and no page errors. Executed with local browser paths; its redundant screenshot was skipped.
- `npm run build`: succeeds; self-contained HTML 1,339,138 bytes.
- `test/cooking.smoke.mjs`: all six recipes completed through browser UI; actual ingredient mesh picking, movement/build input isolation, unattended cooking, meals/hunger, reload and portrait interactions pass without page errors. Screenshots inspected for desktop and portrait layout.
- `node bench/cooking.mjs`: isolated Node 24 median of five 500,000-tick runs measured idle 0.000018 ms/tick and simmering soup 0.000038 ms/tick. Microbenchmark excludes other simulation systems/rendering.
- Chromium SwiftShader at 1280×800, same paused close-up scene: kitchen adds 58 draw calls and 1,896 triangles (49 to 107 calls). Cached view update averaged 0.0053 ms over 1,000 calls. These are software-renderer diagnostics, not integrated-GPU FPS measurements. Static kitchen batching and further mobile layout polish are sensible follow-ups.

Browser reproduction: set PLAYWRIGHT_MODULE to an available Playwright module and CHROMIUM_PATH to its Chromium executable, then run `node test/cooking.smoke.mjs` after building.
