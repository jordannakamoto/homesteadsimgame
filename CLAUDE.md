# Homestead: rules for every chat working in this repo

A browser homestead builder (Stardew-style direction) on a Valheim-style voxel world engine. One page, built from this repo.

## Workflow
- `main` is the game. Before any work: `git fetch origin main` and start from the newest `main`.
- Work on your own branch, keep commits small, and merge into `main` often. Never force-push `main`.
- If `main` moved while you worked, rebase or merge it in before pushing. Do not restore files `main` deleted.
- Say in the commit message what the player would notice.
- Archived, do not merge: `combat` (old action RPG), `build-mode`, `fx`, `engine-source`.

## Build and test
- `npm install && sh build.sh` writes `dist/index.html`, one self-contained page.
- `npm test` runs the headless simulation tests and takes about 3 minutes now, not seconds. While iterating, run one file: `node --test test/<name>.test.mjs`.
- Wall-clock budget asserts (chickens, electrical, garden.cost, sim, structure, thermal, water, weather) run only with `BENCH=1` (`BENCH=1 node --test test/water.test.mjs`); otherwise they are skipped so a loaded machine never fails a functional run. New timing asserts use `test/helpers/bench.mjs`.
- Browser smokes should start from `test/helpers/page.mjs` (`openPage()`: Playwright launch, 640x360, Low quality locked, fonts blocked, page errors collected; `t.load()` waits for the game, not a sleep). `__game.stepFrames(n)` steps n fixed frames synchronously for checks that need game time without input timing; smokes that press and hold with the real clock (the yard, vehicles) keep real waits. Software GL is slow: a browser smoke is minutes, not seconds, and several at once slow each other down, so run them one at a time.
- Browser smoke tests need the built page (`sh build.sh`) and Playwright. Run `node test/page.smoke.mjs` before pushing (the page loads with no errors, build mode opens, Low and High quality work, saves survive a reload). Then the one for what you touched:
  - `test/build.smoke.mjs`: build mode (builds a small house by pointer; piece list, undo, save, phone controls).
  - `test/plan-unbuilt.smoke.mjs`: plan mode (adding a door to an unbuilt design builds nothing).
  - `test/construction-tools.smoke.mjs`: sawhorses, scaffolding, ladder, roof walking and the other construction tools.
  - `test/water.smoke.mjs`: hands-on water (pump, kit parts, valve, tap).
  - `test/garden.smoke.mjs`: the garden (key 5).
  - `test/landscape.smoke.mjs`: the Yard (key 6), fast core: digging, right-drag push, paths, stone, reload. Run for any landscape change. `test/landscape.tail.smoke.mjs` is the long tail (bags, garden box, plant, barrow, pond, garden bar): run it only when `src/sim/core/earthwork.js`, `src/sim/content/landscape.js`, `src/sim/landscape.js` or `src/landscape-view.js` change.
  - `test/chickens.smoke.mjs`: the chickens view.
  - `test/physical-kitchen.smoke.mjs` (`test/cooking.smoke.mjs` runs the same): the kitchen.
  - `test/shed.e2e.mjs` builds the tutorial shed from bare ground and is the gate before publishing; `test/shed.clumsy.mjs` is the clumsy-player version.

## The live page
- The game page is the claude.ai artifact "Homestead" (formerly "World Engine Prototype"; slug `17909dd9-2610-496f-be32-0d354df886eb`).
- Publish only a build of `main` that is already pushed. Read the artifact's live version first and publish over that.

## Code map
- `ARCHITECTURE.md`: the layers, the simulation rules and the interfaces. `docs/V1_PLAN.md`: the plan and vision. `docs/PLAYTEST.md`: what each wave added.
- `src/sim/`: the simulation. All world truth that changes over time lives here: deterministic, fixed ticks, seeded randomness, no DOM or three.js. One system per file, registered in `src/sim/index.js`.
- `src/engine.js`: world, terrain, trees, grass, water, player, tools, day and night. Ordinary source with real names; edit it directly.
- `src/build.js`: build mode, furniture and the piece interface. `src/buildui.js`: build mode's bar, options strip and inspector. `src/touch.js`: touch controls. `src/nature.js`: ground cover, shrubs, insects, animals, soft foliage lighting.
- Hands-on water (docs/FIRST_WATER.md): generic `src/sim/core/parts.js`, `src/engine/parts.js`, `src/engine/reach.js` (no water words in these); content `src/sim/content/plumbing-parts.js`, `src/sim/plumbing.js`, `src/water-hands.js`. After touching them run `node test/water.smoke.mjs`.
- Digging and landscaping: generic `src/sim/core/earthwork.js` (a smooth heightfield, points 10 cm apart: round cut and fill, settling to the angle of repose, rake, flags), content `src/sim/content/landscape.js`, system `src/sim/landscape.js`, view `src/landscape-view.js` (Yard, key 6; the shaped-ground mesh and the terrain's dig mask). The garden reads the shape of the ground. After touching them run `node test/landscape.smoke.mjs`.
- `src/fxpost.js`: the one post pass (occlusion, depth of field, sun shafts, haze, grade). `src/fxhost.js` + `src/fx.js`: fires, smoke, tree variety, characters.
- Add-ons reach the engine only through `window.__game`, `window.__build` and `window.__nature`. Add a name there rather than reaching into engine internals.

## Direction
- Peaceful by default. Combat is switched off, not deleted (`localStorage.combat = '1'` brings it back); do not build on it.
- Look: realistic lighting on a voxel world, calm rather than noisy. Performance target is 144 fps on a desktop GPU: no new full-screen passes, and measure before adding per-frame work.
