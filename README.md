# Homestead sim game (World Engine prototype)

Top-down browser action RPG: Valheim-style world engine, skill combat, party play, build mode.

Branches being merged into `main`:
- `combat` — main game source (world engine, combat, allies, camps)
- `build-mode` — build mode, furniture, touch controls, realism passes
- `fx` — post-processing, firelight, smoke, tree variety, procedural anime characters (`fx.js` add-on)

## `build-mode` branch layout

`npm install && npm run build` writes `dist/index.html`, a single self-contained page.

- `src/engine.js`: the world engine. This is not original module source: it is the main prototype's minified bundle (three.js r187 included), prettified and then patched in place, so identifiers are mangled. `base/engine-base.js` is the unpatched prettified bundle it started from; diff the two to see every engine patch.
- `src/build.js`: build mode (walls, roofs, castle kit, paths, copy, save, furniture).
- `src/touch.js`: mobile dual-stick controls and build buttons.
- `src/nature.js`: ground cover, ivy, fallen logs, insects, animals, unified soft lighting, pine level of detail.
- `src/relight.js`: screen-space ambient occlusion, colour spill, haze and grade (High quality only).
- `src/fxpost.js`: the post pass from the `fx` add-on (depth of field, sun shafts, glow, vignette), adapted to this build's `window.__game`.
- `template/head.html`, `template/tail.html`: page shell and CSS around the scripts.

The add-ons talk to the engine through `window.__game` and the hooks `window.__build` and `window.__nature`.
