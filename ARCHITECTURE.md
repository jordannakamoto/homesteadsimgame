# Architecture

How the game is put together, what each part may and may not do, and the contracts the V1 iterations code against. The plan itself is `docs/V1_PLAN.md`. Update this file in the same commit as any change to a boundary or interface described here.

## What exists (audit, November 2026)

The game is one self-contained HTML page built by `build.sh`: `src/engine.js` is bundled with three.js into one script, and the add-ons are minified into a second.

| File | Lines | What it holds | Verdict |
|---|---|---|---|
| `src/engine.js` | ~2,900 | Terrain (chunked heightfield, 32 m chunks, seeded noise, height edits as deltas), trees and felling, grass, water, sky and light, player movement, tools, HUD, the frame loop, and the switched-off combat | Keep. Rendering and world generation are good. It mixed world truth with drawing; simulation truth now lives in `src/sim/`. Combat stays dormant and is not built on. |
| `src/build.js` | ~4,600 | Build mode: structures made of grid floors, grid walls, free-angle wall segments, roofs, towers, stairs, pillars, paths, furniture; undo, copy, save | Keep the capabilities and geometry code. The interface is redesigned in iteration 2a. Its data model is the starting point for the piece interface below. |
| `src/nature.js` | ~1,200 | Ground cover, insects, animals, foliage lighting, pine level of detail | Keep. Purely visual. |
| `src/fxpost.js` | ~250 | The single post-processing pass (High quality only) | Keep. No new full-screen passes. |
| `src/fx.js`, `src/fxhost.js` | ~840 | Fires, smoke, tree variety, procedural characters | Keep. Purely visual. |
| `src/touch.js` | ~280 | Dual-stick touch controls and touch build buttons | Keep. |

Findings that shaped the plan:

- **No simulation existed.** Time of day was a number advanced by frame time. Nothing was deterministic, and visual code used `Math.random()` freely (fine for particles, not for world truth).
- **The world did not save.** Terrain edits and felled trees were lost on reload; only buildings persisted, in build mode's own storage.
- **Buildings have no materials or physics.** A wall is a type string on a grid edge; wall and floor "materials" are appearance names. Wood and stone are two counters.
- **The engine and add-ons are already decoupled** through `window.__game`, `window.__build` and `window.__nature`. That boundary is kept.
- **Performance.** The page targets 144 fps on a desktop GPU. Chunk building is time-budgeted per frame; the simulation follows the same rule (see below).

## The three layers

```
 input ──► commands ──►  SIMULATION  (src/sim/)      truth, deterministic, headless
                              │  state (plain data) and events
                              ▼
                        WORLD BRIDGE (engine.js, build.js)   terrain, pieces, saving
                              │
                              ▼
                         RENDERING (engine.js, nature, fx)    draws state, owns nothing
```

1. **Simulation (`src/sim/`).** All world truth that changes over time: the clock, and from wave B on weather, materials and stock, structure, heat, power, water, soil, plants, animals, food. Pure JavaScript modules with no DOM, no three.js, no wall clock. They run identically in the page and in Node.
2. **World bridge.** The engine and build mode own the *shape* of the world (terrain heights, where pieces stand) and expose it to the simulation as plain data. They also do the saving.
3. **Rendering.** Reads simulation state and draws it. May interpolate, animate and use `Math.random()` for cosmetics. Must never be the only place a fact lives: if it matters after a reload, it belongs in simulation state.

**The rule that keeps this honest:** delete every renderer and the simulation must still produce the same world. The headless tests do exactly that.

## Simulation core

`src/sim/sim.js`. One state object, advanced in fixed ticks.

- **Units.** SI throughout, and time in seconds of world time. State field names carry the unit when it is not obvious (`litres`, `tempC`, `kWh`). No unitless "stats".
- **Tick.** `TICK` = 60 s of world time. A day is 86,400 s (1,440 ticks). A new world starts at 08:10 on day 1.
- **State.** `{ v, seed, tick, t, rng, sys }`, plain JSON. `sys[name]` is each system's state. Nothing else holds simulation truth.
- **Systems.** `{ name, every, init(ctx), step(ctx), commands }`, registered in `GAME_SYSTEMS` in `src/sim/index.js`, in dependency order. A system runs when `tick % every === 0`, and always receives the same `ctx.dt = every × TICK`, so its numerical behaviour never depends on frame rate or game speed. Choose the slowest cadence that is physically adequate: weather hourly-ish, heat every few minutes, plant growth a few times a day.
- **Context.** `ctx.s` is the system's own state; `ctx.get(name)` reads another system's state (read only by convention; write only your own); `ctx.rng(name)` is a seeded stream; `ctx.emit(type, data)` tells the renderer something happened.
- **Randomness.** Only through `ctx.rng()`. Stream positions are saved, so a loaded game continues the same sequence.
- **Commands.** Player and game actions enter with `sim.command(name, payload)` and apply at the start of the next tick. Systems declare handlers in `commands`. This is what makes a session replayable and is what the build journal and time-lapse will record.
- **Events.** `sim.listen(fn)` for one-way notifications to rendering and audio. Events carry no truth.
- **Advancing.** The page calls `sim.advance(worldSeconds, maxTicksPerFrame)` once per frame. Whole ticks run; the remainder waits. If a frame cannot afford the ticks owed (top speed on a slow machine), the excess is dropped: time runs slower, nothing stalls, determinism holds.
- **Speed.** Pause, 1×, 10×, 100×, 1000×. At 1× a day takes 20 real minutes; at 1000× about a second. Pause stops world time only: the player can still walk and build.
- **Cost budget.** The simulation gets at most 1 ms of a 6.9 ms frame at 144 fps. At 1000× that is about 8 ticks per frame, so a full tick of all systems must average under ~0.1 ms. Systems that cannot meet that run on a slower cadence or amortise work across ticks. Spatial fields (soil, heat) use coarse grids sized to the homestead, not the world.
- **Conservation tests.** Every physical system ships a headless test that checks a conserved quantity or known relationship over a long run (energy in = stored + lost; water in = stored + used). `test/sim.test.mjs` shows the pattern.

### World time and the engine

`world.time` in the engine is now a view of the simulation clock (fraction of a day). Reading it is free. Setting it moves time *forward* to the next moment the clock shows that time; time never runs backwards. Sheltered resting and the screenshot tools use this.

## Saving

`src/sim/save.js`. One JSON document per world seed in `localStorage` under `homestead:save:<seed>`:

```
{ format: "homestead-save", v, sim: <simulation state>, world: { edits, removed, wood, stone, player, cam } }
```

- Autosaves every 20 s and when the page is hidden or closed. The last world played reopens on load.
- `SAVE_VERSION` and `MIGRATIONS` in `save.js`: any change to the shape of a save adds a migration. A save from the previous wave must load.
- Terrain edits are stored as base64 `Float32Array` tiles keyed by chunk.
- **Not yet unified:** buildings are still saved by build mode under `world-engine-build:1:<seed>`. Iteration 2a moves them into the world save through the piece interface. Loose objects in flight (falling trees, logs, pickups) are not saved.
- New systems get saved automatically, because their state lives in `sim.state.sys`.

## The piece interface

Structure, heat, salvage, contractors and blueprints all need to read buildings without knowing how build mode stores them. They read **pieces**: every built element as plain data.

```
piece = {
  id,          // stable within a session; becomes persistent in 2a
  struct,      // the structure it belongs to
  kind,        // "wall" | "floor" | "roof" | "door" | "window" | "post" | "beam" | "stair" | "tower" | "foundation" | "fixture"
  type,        // build mode's own style name (appearance and shape)
  material,    // id in the materials registry (iteration 2). Today: build mode's appearance name.
  a, b,        // end points or opposite corners in world metres { x, z }
  y0, y1,      // bottom and top in world metres
  length, height, thickness, area,   // whichever apply, in metres and square metres
  layers,      // (2a) for assemblies: [{ material, thickness }] from outside to inside, e.g. siding, sheathing, stud bay with insulation, lining
  openings,    // (2a) for walls: doors and windows cut into this piece
  supports,    // (3) ids of pieces this one bears on
  condition,   // (18) 0..1 wear, for used and salvaged components
}
```

- `window.__build.pieces()` returns the current list; `window.__build.version` changes whenever any structure changes, so systems can cache.
- **Version 0 (now):** floors, grid walls, doors, windows, free-angle walls and pillars come out with real dimensions and positions. Roofs and towers come out as `raw` records. Materials are appearance names.
- **Iteration 2** replaces appearance names with registry material ids carrying density, strength, stiffness, thermal conductivity, heat capacity and cost.
- **Iteration 2a** owns the full version: persistent ids, roofs and towers as proper pieces, layered assemblies, openings, and a notification when pieces change. Structure (3) and thermal (4) code against the shape above, not against build mode internals.
- A piece is the same piece for its whole life: built, removed, stored, sold, reinstalled. Its properties never change with where it is.

## Wave B contracts

Three iterations run in parallel in wave B. Each owns the files listed and touches shared files only where stated.

### Iteration 1: calendar, sun and weather

Owns `src/sim/calendar.js`, `src/sim/weather.js`, `src/weather-view.js` (add-on), `test/weather.test.mjs`. In `src/engine.js` it may change only `updateSky()` and the sky constants beside it.

- `calendar.js` exports pure functions of world time `t` and a site `{ latitudeDeg }`: `dayOfYear(t)` (0..364, 365-day year), `yearIndex(t)`, `season(t)` ("spring" | "summer" | "autumn" | "winter"), `dateText(t)`, `sunPosition(t, site)` -> `{ elevationRad, azimuthRad }` (azimuth clockwise from north), `dayLengthHours(t, site)`, `clearSkyIrradiance(t, site)` -> `{ directNormalWm2, diffuseWm2, globalHorizontalWm2 }`. A new world starts on a spring date; `START_T` in `time.js` stays the zero point and calendar adds a start-of-year offset.
- System `weather`, state `sim.state.sys.weather`:
  `{ site: { latitudeDeg, climate }, tempC, humidity (relative, 0..1), dewPointC, windMs, windDirRad, cloud (0..1), rainMmH, snowMmH (water equivalent), snowDepthM, pressureHPa, solar: { directNormalWm2, diffuseWm2, globalHorizontalWm2 }, groundTempC (deep soil, slow), ...internal generator state }`
  Other systems read these fields with `ctx.get('weather')`. Field names and units are fixed from here on.
- Engine world +x is east and +z is south for sun azimuth.

### Iteration 2: materials, items and inventory

Owns `src/sim/materials.js`, `src/sim/items.js`, `src/sim/stock.js`, `src/stock-view.js` (add-on), `test/materials.test.mjs`. In `src/engine.js` it may change only the `world` object's `wood` and `stone` fields (into views of the stock, the way `time` is a view of the clock), the tree-felling and pickup functions, and the HUD stock lines.

- `materials.js` exports `MATERIALS`, a frozen map `id -> { id, name, class ("wood" | "masonry" | "metal" | "insulation" | "glass" | "roofing" | "earth" | "membrane" | "fabric"), densityKgM3, conductivityWmK, specificHeatJkgK, bendingStrengthMPa?, compressiveStrengthMPa?, elasticModulusGPa?, embodiedNote? }` with real published values, and `material(id)`. It also exports `APPEARANCE_MATERIAL`, mapping every build-mode appearance name (wall, floor, roof and path surfaces in `src/build.js`) to a registry id.
- `items.js` exports `ITEMS`, a frozen map `id -> { id, name, category, unit ("each" | "m" | "m2" | "m3" | "kg" | "L"), material?, massKgPerUnit, priceUsd, dims? }` covering lumber sizes, logs, sheet goods, insulation, roofing, fasteners, glass, stone, hand tools and power tools.
- System `stock`, state `sim.state.sys.stock = { money, items: { [itemId]: quantity }, tools: [...], projects: [...] }`. Commands: `stock.add`, `stock.remove`, `stock.buy` (fails cleanly if unaffordable), `projects.add`, `projects.done`, `projects.dismiss`. Mass and money are conserved by every command.
- Power tools declare `powerW`; whether power is available is asked through `window.__game.powerAvailable()` (returns false until the electrical iteration).

### Iteration 2a (first half): build mode redesign

Owns `src/build.js`, `src/touch.js`, the build markup and styles in `template/head.html` (`#buildbar`, `#blabel`, `#bdecor`, `#btouch` and new build elements), and `test/build.smoke.mjs`. It does not touch `src/engine.js` except to add names to `window.__game`.

- Delivers the clear-and-precise interface (see `docs/V1_PLAN.md` iteration 2a: clarity and precision), remodeling, and the full piece interface: persistent piece ids, roofs and towers as proper pieces, `layers`, `openings`, `window.__build.onChange(fn)`, and `window.__build.serialize()` / `window.__build.restore(data)` so buildings join the world save.
- The second half (construction methods: stick frame, log, timber frame, A-frame; assisted framing; plan, elevation and section views) runs in wave C on the same files.
- Material ids: until iteration 2 merges, pieces carry build mode's appearance names; the orchestrator maps them through `APPEARANCE_MATERIAL` at merge.

## Global hooks

Add-ons and tests reach the game only through these. Add a name here rather than reaching into internals.

- `window.__game`: engine. New in wave A: `sim` (the live simulation), `saveGame()`, `saveData()`, `setSpeed(n)`, `speed`.
- `window.__build`: build mode. New in wave A: `pieces()`, `version`.
- `window.__nature`: ground cover and wildlife.

## Module layout and ownership for the waves

New simulation code goes in `src/sim/<system>.js`, one system per file, registered in `src/sim/index.js`. New interface code goes in its own add-on file under `src/` and is added to the module list in `build.sh`. Parallel iterations each own their files and touch shared files (`index.js`, `build.sh`, `template/head.html`, `ARCHITECTURE.md`) only to add their own line, so merges stay mechanical.

## Testing

- `npm test`: headless simulation tests under `test/*.test.mjs` (Node's test runner, no browser). Runs in seconds.
- `node test/page.smoke.mjs`: loads the built page in a headless browser and checks that it loads without errors, Low and High quality render, build mode opens, time controls work, a save survives a reload, and the simulation's frame cost is in budget.
- Frame rate itself can only be judged on a real GPU; the smoke test measures the simulation's cost per frame instead.

## Dormant and archived

Combat is switched off in the engine (`localStorage.combat = '1'` restores it) and must not be built on. The `combat`, `build-mode`, `fx` and `engine-source` branches are archives: do not merge, delete or modify them.
