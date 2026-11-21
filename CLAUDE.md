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
- `npm test` runs the headless simulation tests: about 45 s on a 2-core machine, less with more cores. While iterating, run one file: `node --test test/<name>.test.mjs`.
- Keep it fast. A long run (years of game time) that checks one system which reads no other registers that system alone (`createSim({ seed, systems: [weather] })`, as the weather climate runs do) instead of the whole game; keep one full-game test for determinism and saves. Look at the timings (`node --test --test-reporter=spec`) when adding a test that runs more than a few game months.
- A system's `ctx` is a class instance with `s` on its prototype: `{ ...ctx }` loses `s`. To change a field for a call, derive: `const c = Object.create(ctx); c.t = ...`.
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
  - `test/foundation.smoke.mjs`: the Site tools (key 7): layout, dig, forms, pour, cure, piers, stem walls.
  - `test/services.smoke.mjs`: plan, rough-in and trim-out of cable and pipe (Hands, F). `test/services-water.smoke.mjs`: supply plumbing, pressure test, fixtures.
  - `test/vehicles.smoke.mjs`: the ATV (mount, drive, fuel). `test/trailer.smoke.mjs`: hitch, tow, haul lumber.
  - `test/build-ext.smoke.mjs`: the build extension point (fixture extension through save and undo).
  - `test/deck.smoke.mjs`: decks (`src/game/deck.js`): drawn against a wall and free-standing, refused spans, picked and deleted, walked on, reload.
  - `test/ui.smoke.mjs`: the interface kit and both skins (Cozy and Minimal) at desktop and phone size, no overlapping HUD pieces; saves `dist/ui-<skin>-<size>.png`.
  - `test/designer.smoke.mjs`: the door and window designer (stage handles, fit line, door models, recents).
  - `test/planview.smoke.mjs`: the plan view (finished look, automatic views, the view control and Section slider); `test/planview-v1.mjs` is its first-version check.
  - `test/shed.e2e.mjs` builds the tutorial shed from bare ground and is the gate before publishing; `test/shed.clumsy.mjs` is the clumsy-player version.

## The live page
- The game page is the claude.ai artifact "Homestead" (formerly "World Engine Prototype"; slug `17909dd9-2610-496f-be32-0d354df886eb`).
- Publish only a build of `main` that is already pushed. Read the artifact's live version first and publish over that.

## Code map
- `ARCHITECTURE.md`: the layers, the simulation rules and the interfaces. `docs/V1_PLAN.md`: the plan and vision. `docs/PLAYTEST.md`: what each wave added. `docs/STATUS.md`: where things stand. `docs/design/`: design docs and the save-version ledger. `docs/PLATFORM.md`: the Steam and co-op plan.
- `src/sim/`: the simulation. All world truth that changes over time lives here: deterministic, fixed ticks, seeded randomness, no DOM or three.js. One system per file, registered in `src/sim/index.js`.
- `src/engine.js`: world, terrain, trees, grass, water, player, tools, day and night. Ordinary source with real names; edit it directly.
- `src/build.js`: build mode, furniture and the piece interface. `src/buildui.js`: build mode's bar, options strip and inspector. `src/touch.js`: touch controls. `src/nature.js`: ground cover, shrubs, insects, animals, soft foliage lighting.
- Interface: all looks live in `template/ui/*.css` (inlined by `build.sh` in name order after the `<style>` in `template/head.html`): `00-tokens` (both skins' tokens), `10-kit` (components), `20-hud`, `30-hotbar`, `40-panels`, `41-stock`, `50-build`, `60-touch`, `90-skin-minimal`. No literal colours; use tokens. `src/engine/ui.js` is the generic kit `window.__ui` (skins, icons, lanes, panels, dock, toasts, prompt line); `src/game/hud.js` wires the game's own elements into it. A new system adds a panel with `__ui.panel` + `__ui.dock.add`. After touching them run `node test/ui.smoke.mjs`.
- Doors, windows and stairs in build mode: `src/sim/content/openings.js` (catalogue and fit rules), `src/opening-preview.js` (`__openingPreview`: the designer's drawings, string-building only), `src/sim/content/stairs.js` (`__stairs`: stair types and the solver), `src/stairs-geo.js` (`__stairsGeo`: carpentry boxes and drawings), `src/stairs-spiral.js` and `src/stairs-curved.js` (the spiral and curved types). After touching them run `node test/designer.smoke.mjs` and `node --test test/openings.test.mjs test/stairs.test.mjs`.
- Hands-on water (docs/FIRST_WATER.md): generic `src/sim/core/parts.js`, `src/engine/parts.js`, `src/engine/reach.js` (no water words in these); content `src/sim/content/plumbing-parts.js`, `src/sim/plumbing.js`, `src/water-hands.js`. After touching them run `node test/water.smoke.mjs`.
- Digging and landscaping: generic `src/sim/core/earthwork.js` (a smooth heightfield, points 10 cm apart: round cut and fill, settling to the angle of repose, rake, flags), content `src/sim/content/landscape.js`, system `src/sim/landscape.js`, view `src/landscape-view.js` (Yard, key 6; the shaped-ground mesh and the terrain's dig mask). The garden reads the shape of the ground. After touching them run `node test/landscape.smoke.mjs`.
- Ground: `src/sim/ground.js` (the one command API for moving earth: `ground.cut/fill/push/grade/tamp`) over generic `src/sim/core/ground.js` (base + 1 m macro + 10 cm fine). Machines, foundations, build-site prep and the shovel go through it; do not write `world.edits` or the fine grid directly. See ARCHITECTURE "One ground".
- Foundations: `src/sim/foundation.js` (jobs: layout, dig, base, forms, rebar, pour, cure gates), `src/foundation-view.js` (Site tools, key 7), generic `src/sim/core/cure.js` and `core/batch.js`, content `src/sim/content/concrete.js` (frost depths, cure gates). After touching them run `node test/foundation.smoke.mjs`.
- Services (cable, pipe, drain, vent in the frame): generic `src/sim/core/links.js`, `core/routes.js` and `core/routefind.js`, content `src/sim/content/services.js` and `frame-channels.js`, system `src/sim/services.js`, page `src/engine/routes.js`, `src/services-plan.js`, `services-hands.js`, `services-trim.js`, `services-water.js`, `services-view.js`. Kit parts above are the yard pipe model; routes are in-building. After touching them run `test/services.smoke.mjs` (and `services-water.smoke.mjs` for plumbing).
- Vehicles: generic `src/engine/control.js` (possession stack: the seat is a possession, walking is the bottom), `src/engine/vehicles.js`, `src/sim/core/vehicles.js` + `vehicles-drive.js`; content `src/sim/content/vehicles.js` and `src/game/vehicles-atv.js`. Pose enters the sim by command (`vehicles.sync`), never by tick. Run `test/vehicles.smoke.mjs` and `test/trailer.smoke.mjs`.
- Snow (docs/design/snow.md): the weather keeps the open-field pack; system `src/sim/snow.js` over generic `src/sim/core/snowfield.js` spreads it in 0.5 m cells (drifts, shade, packed paths; `snow.tread/move/push`, reads `snowRead` = `__game.snow`); on screen `src/snow/` (one bundled add-on, `window.__snow`: field and deformation textures, the ring mesh, snow on objects, tracks). Sandbox: the Graphics panel's "Snow sandbox" row (+10 cm, +40 cm, Thaw, Winter on/off = `weather.debugShift`), or `__snow.debug.storm(40)`. After touching them run `node --test test/snow.test.mjs` and `node test/snow.smoke.mjs`.
- Build extension point: new building elements (deck, porch, loft, skylight, chimney) go in their own file via `__build.extend`, `__build.setExt` and `__framing.register` (`src/build-ext.js`), not into `build.js`. What other systems keep on a building lives in `pr.keep[source]` (`src/sim/core/keep.js`); `construction.setPlan` carries it whole.
- Keys: `src/game/keymap.js` is the one key table (draws the controls sheet on ? / F1 and the key chips). Move a key, move its row. X is overlays everywhere.
- `src/fxpost.js`: the one post pass (occlusion, depth of field, sun shafts, haze, grade). `src/fxhost.js` + `src/fx.js`: fires, smoke, tree variety, characters.
- Add-ons reach the engine only through `window.__game`, `window.__build` and `window.__nature`. Add a name there rather than reaching into engine internals.

## Direction
- Peaceful by default. Combat is switched off, not deleted (`localStorage.combat = '1'` brings it back); do not build on it.
- Look: realistic lighting on a voxel world, calm rather than noisy. Performance target is 144 fps on a desktop GPU: no new full-screen passes, and measure before adding per-frame work.
