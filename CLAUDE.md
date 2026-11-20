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
- Browser smoke tests need the built page (`sh build.sh`) and Playwright. Run `node test/page.smoke.mjs` before pushing (the page loads with no errors, build mode opens, Low and High quality work, saves survive a reload). Then the one for what you touched:
  - `test/build.smoke.mjs`: build mode (builds a small house by pointer; piece list, undo, save, phone controls).
  - `test/plan-unbuilt.smoke.mjs`: plan mode (adding a door to an unbuilt design builds nothing).
  - `test/construction-tools.smoke.mjs`: sawhorses, scaffolding, ladder, roof walking and the other construction tools.
  - `test/water.smoke.mjs`: hands-on water (pump, kit parts, valve, tap).
  - `test/garden.smoke.mjs`: the garden (key 5).
  - `test/landscape.smoke.mjs`: the Yard (key 6): digging, paths, stone, pond.
  - `test/chickens.smoke.mjs`: the chickens view.
  - `test/physical-kitchen.smoke.mjs` (`test/cooking.smoke.mjs` runs the same): the kitchen.
  - `test/ui.smoke.mjs`: the interface kit and both skins (Cozy and Minimal) at desktop and phone size, no overlapping HUD pieces; saves `dist/ui-<skin>-<size>.png`.
  - `test/designer.smoke.mjs`: the door and window designer (stage handles, fit line, door models, recents).
  - `test/planview.smoke.mjs`: the plan view (finished look, automatic views, the view control and Section slider); `test/planview-v1.mjs` is its first-version check.
  - `test/shed.e2e.mjs` builds the tutorial shed from bare ground and is the gate before publishing; `test/shed.clumsy.mjs` is the clumsy-player version.

## The live page
- The game page is the claude.ai artifact "Homestead" (formerly "World Engine Prototype"; slug `17909dd9-2610-496f-be32-0d354df886eb`).
- Publish only a build of `main` that is already pushed. Read the artifact's live version first and publish over that.

## Code map
- `ARCHITECTURE.md`: the layers, the simulation rules and the interfaces. `docs/V1_PLAN.md`: the plan and vision. `docs/PLAYTEST.md`: what each wave added.
- `src/sim/`: the simulation. All world truth that changes over time lives here: deterministic, fixed ticks, seeded randomness, no DOM or three.js. One system per file, registered in `src/sim/index.js`.
- `src/engine.js`: world, terrain, trees, grass, water, player, tools, day and night. Ordinary source with real names; edit it directly.
- `src/build.js`: build mode, furniture and the piece interface. `src/buildui.js`: build mode's bar, options strip and inspector. `src/touch.js`: touch controls. `src/nature.js`: ground cover, shrubs, insects, animals, soft foliage lighting.
- Interface: all looks live in `template/ui/*.css` (inlined by `build.sh` in name order after the `<style>` in `template/head.html`): `00-tokens` (both skins' tokens), `10-kit` (components), `20-hud`, `30-hotbar`, `40-panels`, `41-stock`, `50-build`, `60-touch`, `90-skin-minimal`. No literal colours; use tokens. `src/engine/ui.js` is the generic kit `window.__ui` (skins, icons, lanes, panels, dock, toasts, prompt line); `src/game/hud.js` wires the game's own elements into it. A new system adds a panel with `__ui.panel` + `__ui.dock.add`. After touching them run `node test/ui.smoke.mjs`.
- Doors, windows and stairs in build mode: `src/sim/content/openings.js` (catalogue and fit rules), `src/opening-preview.js` (`__openingPreview`: the designer's drawings, string-building only), `src/sim/content/stairs.js` (`__stairs`: stair types and the solver), `src/stairs-geo.js` (`__stairsGeo`: carpentry boxes and drawings), `src/stairs-spiral.js` and `src/stairs-curved.js` (the spiral and curved types). After touching them run `node test/designer.smoke.mjs` and `node --test test/openings.test.mjs test/stairs.test.mjs`.
- Hands-on water (docs/FIRST_WATER.md): generic `src/sim/core/parts.js`, `src/engine/parts.js`, `src/engine/reach.js` (no water words in these); content `src/sim/content/plumbing-parts.js`, `src/sim/plumbing.js`, `src/water-hands.js`. After touching them run `node test/water.smoke.mjs`.
- Digging and landscaping: generic `src/sim/core/earthwork.js` (a smooth heightfield, points 10 cm apart: round cut and fill, settling to the angle of repose, rake, flags), content `src/sim/content/landscape.js`, system `src/sim/landscape.js`, view `src/landscape-view.js` (Yard, key 6; the shaped-ground mesh and the terrain's dig mask). The garden reads the shape of the ground. After touching them run `node test/landscape.smoke.mjs`.
- `src/fxpost.js`: the one post pass (occlusion, depth of field, sun shafts, haze, grade). `src/fxhost.js` + `src/fx.js`: fires, smoke, tree variety, characters.
- Add-ons reach the engine only through `window.__game`, `window.__build` and `window.__nature`. Add a name there rather than reaching into engine internals.

## Direction
- Peaceful by default. Combat is switched off, not deleted (`localStorage.combat = '1'` brings it back); do not build on it.
- Look: realistic lighting on a voxel world, calm rather than noisy. Performance target is 144 fps on a desktop GPU: no new full-screen passes, and measure before adding per-frame work.
