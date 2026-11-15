# World engine + combat prototype (`combat` branch)

A top-down action RPG prototype that runs in the browser as one self-contained HTML page: a procedural, destructible world, skill-based melee and bow combat, enemy squads with formations, two AI allies and four set-piece camps.

This branch is archived. `main` went a different way (a peaceful homestead builder). It is kept as the starting point for a future game on the same engine, for one reason above all: **this is the only branch with the engine's original, readable source.** `main`'s `src/engine.js` is a prettified minified bundle of an older build of this file, patched in place.

## Build and run

```
npm install
npm run build        # writes dist/index.html (about 860 KB, three.js included)
```

Open `dist/index.html` in a browser. A world seed can be given in the URL hash: `#seed-1337`.

The page also loads an optional `fx.js` from beside it (the effects add-on on the `fx` branch) and exposes `window.__fxHost` for it. Without that file the game runs normally; the browser just logs one missing-file message.

## Layout

- `src/main.js`: the whole game, about 3,100 lines of plain JavaScript. Sections are marked with `// =====` banners, in this order:
  utilities, sound, world constants, renderer, shared materials, geometry library, chunks, particles, player, dynamic objects (falling trees, logs, pickups), swings and terrain tools, input, water and sky, HUD, combat, allies, camps, main loop.
- `src/template.html`: page shell, HUD and controls list. `/*__BUNDLE__*/` is replaced by the bundle.
- `build.mjs`: esbuild bundle, inlined into the template.
- `tools/`: headless test and simulation scripts (see below).
- `docs/DESIGN-NOTES.md`: what the combat design settled on, what was tried and rejected, and what is unfinished.

## Where the engine ends and the game begins

Roughly lines 1 to 1600 of `src/main.js` are the world engine and are not specific to combat:

- seeded heightfield in 32 m chunks, loaded in a radius around the player, with terrain edits stored as per-tile deltas (`world.edits`) and removed objects as a set (`world.removed`), which together are the save diff
- instanced trees, rocks and grass per chunk; trees fall as whole trunks, then split into logs, then wood
- water (shared wave function on CPU and GPU, depth texture, foam, caustics), day and night, bloom, a Low quality mode
- player movement, jump, roll, crouch, camera, pointer lock, synthesised sound, particles, HUD

Everything from the `combat` banner onward (enemies, moves, allies, camps) is game content built on that. A new game can delete from the `combat` banner to the `main loop` banner and the calls into it (`updateEnemies`, `updateAllies`, `updateHexes`, `updateArrows`, `spawnAllies`, `placeCamps`, the chunk enemy spawn in `Chunk.populate`) and keep a working world.

## Test interface

The page exposes `window.__game` with the live objects and a `step(dt)` that advances the simulation without rendering: `world, player, cam, keys, mouse, enemies, allies, arrows, hexes, MOVES, KIND, CAMPS, step, render, heightAt, spawnEnemy, setQuality, lockQuality, THREE` and a few more (see the last line of `src/main.js`).

The scripts in `tools/` drive that from headless Chrome through `puppeteer-core`. Build first, then for example `node tools/formations-allies.mjs`. Chrome is expected at `/usr/bin/google-chrome`; set `CHROME` to point elsewhere.

| Script | What it checks |
| --- | --- |
| `sim.mjs` | Plays each camp with scripted players (backstep-and-mash, parry-and-drive), with and without allies |
| `formations-allies.mjs` | Ally travel, shield-line cohesion, flankers reaching your back, shaman hexes |
| `camp-placement.mjs` | Camps find a spot across 25 random worlds (written for the first three camps) |
| `controls.mjs` | Guard, bow aim, roll, jump, down attack, stance and zoom |
| `melee-flow.mjs`, `twist-drive.mjs`, `head-lock.mjs` | Driven cuts, flow chain, head staying on target |
| `bow-pull.mjs`, `planted-shots.mjs` | String pull and power, steady shots when standing still |
| `stealth.mjs` | Detection ranges standing and crouched, sneak attacks |

These are checks written during development, not a test suite: they print results for a person to read and do not exit non-zero on failure. Some expected numbers in their output predate later tuning.

## State when archived

Works in headless runs with no errors. Not verified: frame rate on real hardware, and fight difficulty, which was tuned by hand over a few play sessions and never settled. The scripted players in `sim.mjs` proved a poor guide to how hard fights are for a person.
