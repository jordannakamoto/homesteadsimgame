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
- Test headlessly before pushing: `npm test` (simulation, seconds) and `node test/page.smoke.mjs` (the built page: loads with no errors, build mode opens, Low and High quality work, saves survive a reload). After touching build mode also run `node test/build.smoke.mjs`.

## The live page
- The game page is the claude.ai artifact "Homestead" (formerly "World Engine Prototype"; slug `17909dd9-2610-496f-be32-0d354df886eb`).
- Publish only a build of `main` that is already pushed. Read the artifact's live version first and publish over that.

## Code map
- `ARCHITECTURE.md`: the layers, the simulation rules and the interfaces. `docs/V1_PLAN.md`: the plan and vision. `docs/PLAYTEST.md`: what each wave added.
- `src/sim/`: the simulation. All world truth that changes over time lives here: deterministic, fixed ticks, seeded randomness, no DOM or three.js. One system per file, registered in `src/sim/index.js`.
- `src/engine.js`: world, terrain, trees, grass, water, player, tools, day and night. Ordinary source with real names; edit it directly.
- `src/build.js`: build mode, furniture and the piece interface. `src/buildui.js`: build mode's bar, options strip and inspector. `src/touch.js`: touch controls. `src/nature.js`: ground cover, shrubs, insects, animals, soft foliage lighting.
- Hands-on water (docs/FIRST_WATER.md): generic `src/sim/core/parts.js`, `src/engine/parts.js`, `src/engine/reach.js` (no water words in these); content `src/sim/content/plumbing-parts.js`, `src/sim/plumbing.js`, `src/water-hands.js`. After touching them run `node test/water.smoke.mjs`.
- Digging and landscaping: generic `src/sim/core/earthwork.js` (30 cm squares: cut, fill, slump, rake), content `src/sim/content/landscape.js`, system `src/sim/landscape.js`, view `src/landscape-view.js` (Yard, key 6; the shaped-ground mesh and the terrain's dig mask). The garden reads the shape of the ground. After touching them run `node test/landscape.smoke.mjs`.
- `src/fxpost.js`: the one post pass (occlusion, depth of field, sun shafts, haze, grade). `src/fxhost.js` + `src/fx.js`: fires, smoke, tree variety, characters.
- Add-ons reach the engine only through `window.__game`, `window.__build` and `window.__nature`. Add a name there rather than reaching into engine internals.

## Direction
- Peaceful by default. Combat is switched off, not deleted (`localStorage.combat = '1'` brings it back); do not build on it.
- Look: realistic lighting on a voxel world, calm rather than noisy. Performance target is 144 fps on a desktop GPU: no new full-screen passes, and measure before adding per-frame work.
