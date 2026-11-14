# Homestead sim game (World Engine prototype)

Browser homestead builder (heading toward a Stardew-style sim) on a Valheim-style world engine.

`main` = the `build-mode` branch + the `fx` add-on. The `combat` branch is archived and not merged.

- `combat`: the old action-RPG source (world engine, combat, allies, camps), kept for reference
- `build-mode`: what `main` was built from
- `fx`: the add-on as it was before merging

## Layout

`npm install && npm run build` writes `dist/index.html`, a single self-contained page.

- `src/engine.js`: the world engine. This is not original module source: it is the main prototype's minified bundle (three.js r187 included), prettified and then patched in place, so identifiers are mangled. `base/engine-base.js` is the unpatched prettified bundle it started from; diff the two to see every engine patch.
- `src/build.js`: build mode (walls, roofs, castle kit, paths, copy, save, furniture).
- `src/touch.js`: mobile dual-stick controls and build buttons.
- `src/nature.js`: ground cover, ivy, fallen logs, insects, animals, unified soft lighting, pine level of detail.
- `src/relight.js`: screen-space ambient occlusion, colour spill, haze and grade (High quality only).
- `src/fxpost.js`: the post pass from the `fx` add-on (depth of field, sun shafts, glow, vignette), adapted to this build's `window.__game`.
- `src/fxhost.js`: builds the `window.__fxHost` bridge `src/fx.js` expects, with a once-per-frame hook on `scene.onBeforeRender`.
- `src/fx.js`: campfires and embers, soft smoke and particles, per-tree shape variety, and the procedural cel-shaded characters ("Models: anime / blocks" button). Its own post pass stays off here, because `fxpost.js` already installs it.
- `fx/`: the character generator source (`fx/body/body.js`, synced into `src/fx.js` between the markers) and viewer/screenshot tools.
- `template/head.html`, `template/tail.html`: page shell and CSS around the scripts.

The add-ons talk to the engine through `window.__game` and the hooks `window.__build` and `window.__nature`.
