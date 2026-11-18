# Homestead

Browser homestead builder (heading toward a Stardew-style sim) on a Valheim-style world engine. Working rules for contributors are in `CLAUDE.md`.

Peaceful by default: the old combat is switched off, not removed (`localStorage.setItem('combat', '1')` and reload brings it back).

`main` = the `build-mode` branch + the `fx` add-on. The `combat` branch is archived and not merged; it holds the later combat work (stealth, flow, allies, camps) on the same engine, without the engine patches made here.

- `combat`: the old action-RPG source (world engine, combat, allies, camps), kept for reference
- `build-mode`: what `main` was built from
- `fx`: the add-on as it was before merging

## Layout

See `ARCHITECTURE.md` for how the simulation, world and rendering fit together, and `docs/V1_PLAN.md` for where the game is going.

`npm install && npm run build` writes `dist/index.html`, a single self-contained page.

- `src/engine.js`: the world engine, as ordinary readable source (about 2,800 lines, imports three.js r187; `build.sh` bundles it). It is the main prototype's source as of the build the Build Mode page was taken from, with every engine patch made for build mode, nature and lighting ported in. It replaces the earlier `src/engine.js`, which was that build's minified bundle prettified and patched in place; the port was checked token for token against it. Four functions that the patches rewrote wholesale (`makeAtlas`, `buildPine`, `tubeTiled`, `groundTint`) still carry short local names from the bundle.
- `src/sim/`: the deterministic simulation (clock, saving, and each simulated system as it lands). Runs in the page and headlessly: `npm test`.
- `src/build.js`: build mode (walls, roofs, towers, paths, copy, save, furniture).
- `src/touch.js`: mobile dual-stick controls and build buttons.
- `src/nature.js`: ground cover, ivy, fallen logs, insects, animals, unified soft lighting, pine level of detail.
- `src/fxpost.js`: the one post pass (High quality only): half-resolution ambient occlusion with bounce light (formerly `relight.js`, joined back with a depth-aware upsample), depth of field, sun shafts, distance haze, glow, colour grade, saturation and vignette.
- `src/fxhost.js`: builds the `window.__fxHost` bridge `src/fx.js` expects, with a once-per-frame hook on `scene.onBeforeRender`.
- `src/fx.js`: campfires and embers, soft smoke and particles, per-tree shape variety, and the procedural cel-shaded characters ("Models: anime / blocks" button). Its own post pass stays off here, because `fxpost.js` already installs it.
- `fx/`: the character generator source (`fx/body/body.js`, synced into `src/fx.js` between the markers) and viewer/screenshot tools.
- `template/head.html`, `template/tail.html`: page shell and CSS around the scripts.

The add-ons talk to the engine through `window.__game` and the hooks `window.__build` and `window.__nature`.
