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
| `src/touch.js` | ~280 | Dual-stick touch controls | Keep. |
| `src/buildui.js` | ~330 | Build mode's interface (2a): tool palette, options strip and property inspector, live dimensions | Draws only what `__build.view()` describes. |

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

Structure, heat, salvage, contractors and blueprints all need to read buildings without knowing how build mode stores them. They read **pieces**: every built element as plain data. As built in iteration 2a:

```
piece = {
  id,          // "p12": persistent. Survives save and load, undo and redo, and never shifts when other pieces come or go.
               // Parts of one element share its id with a suffix: "p8.0" a roof plane, "p8.g0" its gable infill, "p8.rb" its ridge beam,
               // "p3.s4" a tower side, "p3.f0" a tower floor, "p3.r" its roof, "p3.st" its stair, "p5.fd" the footing under floor p5, "p7+p9" the beam between two pillars.
  struct,      // the structure it belongs to (persistent number); storey: its storey there (-1 cellar, 0 ground, 1..)
  kind,        // "wall" | "floor" | "roof" | "door" | "window" | "post" | "beam" | "stair" | "tower" | "foundation" | "path" | "fixture"
  type,        // build mode's own name: wall "wall" | "rail" | "parapet" | "rampart" | "gable"; roof "gable" | "hip" | "shed" | "flat" | "cone" | "dome" | "pyramid";
               // door "door" | "door2" | "gate" | "railgate"; window "window".."window4"; post "pillar" | "chimney"; stair "straight" | "spiral"; fixture: the furniture name
  material,    // build mode's appearance name until the orchestrator maps it through APPEARANCE_MATERIAL
  a, b,        // world metres { x, z }: wall and beam ends, a roof plane's eave edge, a stair's foot and head, opposite corners of a floor; a point piece has a = b
  y0, y1,      // bottom and top in world metres (right for upper storeys, stretched storeys, raised floors and turned structures)
  length, height, thickness, area,   // whichever apply, metres and square metres. A wall's area is its whole face; netArea leaves out its openings.
  layers,      // walls, floors, roofs, doors, windows: [{ material, thickness, role }] from the outside in (floors from the underside up)
  openings,    // walls: [{ id, kind: "door" | "window" | "opening", type, offset (m along the wall from a), width, sill, height, y0, y1, area, fill }]
               // doors and windows are also pieces of their own, with wall: the id of the wall they are in. An "opening" is an open arch: no id, no piece.
  // floors: outline and holes (world corner loops), perimeter. Roof planes: footprint, pitchDeg, planArea, eaveY, ridgeY, facing { x, z } (downslope), roof: the roof's id.
  // towers: radius, sides, storeys, parts: [ids]; their parts carry tower: id. Fixtures: name, width, depth, rotationRad. Paths: width.
}
```

- `window.__build.pieces()` returns the list (cached until something changes: treat it as read only); `piece(id)` finds one; `quantities(list?)` totals wall length, floor and roof area and counts.
- `window.__build.version` changes whenever any structure changes; `onChange(fn)` calls `fn(version)` at most once a frame when it has, and returns a function that stops it.
- `window.__build.serialize()` gives every building as plain JSON (`{ format: "homestead-buildings", v: 2, nextStruct, nextPiece, structs }`) and `restore(data)` puts it back exactly, ids included; version 1 saves (no ids) load and are given ids. Build mode still keeps its own copy under `world-engine-build:1:<seed>`; the world save can take over by calling these two.
- **How identity works.** Roofs, towers, stairs, pillars, paths and furniture store their id. Walls and floors are stored as 1 m edges and tiles, so a wall piece is a straight run of edges of one kind and material, and a floor piece is a connected area of one surface. Each run or area keeps the id most of its parts already had; a part split off (or a wall repainted in part) is a new piece. Changing a door or window to another type makes a new piece.
- **Layers.** Each appearance implies a default build-up (`window.__build.ASSEMBLIES`; the plain material names used are in `LAYER_MATERIALS` for the registry to map). `setLayers(id, layers | null)` stores a different build-up for one piece; it is saved with the building and follows the piece through copies and splits.
- Not yet: `supports` (iteration 3) and `condition` (18). A chimney is a `post` of type `chimney`. Tower landings above the ground floor report the inner deck as `outline` and the landing strip as `landingArea`.
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
- Delivered (iteration 1): `windDirRad` is the direction the wind blows *from*, clockwise from north (meteorological). Extra calendar exports: `sunTimes(t, site)` -> `{ sunriseH, sunsetH, solarNoonH, dayLengthH }`, `solarDeclinationRad`, `monthOf`, `dayOfMonth`, `dailyInsolationTOA`. Weather extras: `CLIMATES` presets (`temperate` default at 45 N, `mediterranean-coast`, `cold-continental`), command `weather.setSite { climate?, latitudeDeg? }`, internal `gen`, `snowSweMm`, `snowDensityKgM3`, `totals`.

### Iteration 2: materials, items and inventory

Owns `src/sim/materials.js`, `src/sim/items.js`, `src/sim/stock.js`, `src/stock-view.js` (add-on), `test/materials.test.mjs`. In `src/engine.js` it may change only the `world` object's `wood` and `stone` fields (into views of the stock, the way `time` is a view of the clock), the tree-felling and pickup functions, and the HUD stock lines.

- `materials.js` exports `MATERIALS`, a frozen map `id -> { id, name, class ("wood" | "masonry" | "metal" | "insulation" | "glass" | "roofing" | "earth" | "membrane" | "fabric"), densityKgM3, conductivityWmK, specificHeatJkgK, bendingStrengthMPa?, compressiveStrengthMPa?, elasticModulusGPa?, embodiedNote? }` with real published values, and `material(id)`. It also exports `APPEARANCE_MATERIAL`, mapping every build-mode appearance name (wall, floor, roof and path surfaces in `src/build.js`) to a registry id.
- `items.js` exports `ITEMS`, a frozen map `id -> { id, name, category, unit ("each" | "m" | "m2" | "m3" | "kg" | "L"), material?, massKgPerUnit, priceUsd, dims? }` covering lumber sizes, logs, sheet goods, insulation, roofing, fasteners, glass, stone, hand tools and power tools.
- System `stock`, state `sim.state.sys.stock = { money, items: { [itemId]: quantity }, tools: [...], projects: [...] }`. Commands: `stock.add`, `stock.remove`, `stock.buy` (fails cleanly if unaffordable), `projects.add`, `projects.done`, `projects.dismiss`. Mass and money are conserved by every command.
- As built: material classes also include `"fluid"` (water, air). Glazing assemblies carry `uValueWm2K` and `thicknessM`. `APPEARANCE_MATERIAL` is a flat name map; `APPEARANCE_BY_KIND` is the same by wall/floor/roof/path (shared names such as `dark`, `tile`, `cobble` map to the same material in every table). Tools live in `stock.tools` (single, unconsumed); `world.wood` and `world.stone` are the stock items `wood` and `stone`; felled logs add `log_pine` / `log_birch` / `log_oak` (m3, from real trunk volume). Add-ons use `window.__game.stock` (`state`, `do(command, payload)` for instant, replay-recorded commands, catalog and helpers) and `window.__game.powerAvailable()`.
- Power tools declare `powerW`; whether power is available is asked through `window.__game.powerAvailable()` (returns false until the electrical iteration).

### Iteration 2a (first half): build mode redesign

Owns `src/build.js`, `src/touch.js`, the build markup and styles in `template/head.html` (`#buildbar`, `#blabel`, `#bdecor`, `#btouch` and new build elements), and `test/build.smoke.mjs`. It does not touch `src/engine.js` except to add names to `window.__game`.

- Delivers the clear-and-precise interface (see `docs/V1_PLAN.md` iteration 2a: clarity and precision), remodeling, and the full piece interface: persistent piece ids, roofs and towers as proper pieces, `layers`, `openings`, `window.__build.onChange(fn)`, and `window.__build.serialize()` / `window.__build.restore(data)` so buildings join the world save.
- The second half (construction methods: stick frame, log, timber frame, A-frame; assisted framing; plan, elevation and section views) runs in wave C on the same files.
- Material ids: until iteration 2 merges, pieces carry build mode's appearance names; the orchestrator maps them through `APPEARANCE_MATERIAL` at merge.

## Wave C contracts

Six iterations run in parallel. Every system reads buildings only through pieces, weather only through `ctx.get('weather')`, and materials only through `material(id)`. Each owns the files listed. Shared files (`src/sim/index.js`, `build.sh`, `template/head.html`) get one added line or block each. No iteration edits `src/engine.js` except to add a name to `window.__game`; if a system needs something from the engine, it asks for it through a name there.

**Bridging pieces into the simulation.** Pieces live in build mode, outside the simulation. The orchestrator provides `src/sim/site.js`: a `site` system whose state holds a plain-data snapshot of what is built, refreshed by the command `site.setPieces` that the page issues whenever `__build.onChange` fires. Systems read `ctx.get('site').pieces` and `ctx.get('site').version`. Headless tests construct pieces by hand with the helpers in `test/helpers/pieces.mjs`. Equipment that is not a building piece (a panel, a tank, a stove, a coop feeder) is placed through the same mechanism: it is a piece with `kind: "fixture"`, a `fixture` id from the fixtures catalog, and `ports` describing its connections.

**Fixtures and connections.** A fixture piece is `{ id, kind: "fixture", fixture: <catalog id>, a: { x, z }, y0, y1, yawRad, settings: {...}, ports: [{ id, type: "power" | "water" | "flue" }] }`. A connection is a piece of kind `"wire"` or `"pipe"`: `{ id, kind, from: { piece, port }, to: { piece, port }, lengthM, gauge | diameterMm, material }`. Each system that needs equipment exports its catalog from its own `fixtures-<system>.js` as `FIXTURES_<SYSTEM>`: a frozen map `id -> { id, name, category, system, ports: [...], priceUsd, massKg, dims: { w, d, h }, ...ratings in SI units }`. The orchestrator merges the catalogs into `src/sim/fixtures.js` and the supplier. Systems find their equipment by filtering `ctx.get('site').pieces` for their fixture ids; nothing else tells a system what exists. Test helpers: `test/helpers/pieces.mjs` (`house()`, `setSite()`, `fixture()`, `link()`).

**As built in wave B, for wave C to rely on.** Pieces arrive in `ctx.get('site').pieces` with `material` and every `layers[].material` as registry ids (`appearance` keeps build mode's name; `unknownMaterial` flags anything unresolved). Walls carry `openings`, `area`, `netArea`; roofs come as one piece per plane with `pitchDeg`, `area`, `planArea`, `footprint`, `facing`, `eaveY`, `ridgeY`; floors carry `outline` and a derived `foundation` piece; see the piece-interface section for the full list. `site.version` increases on every change. Wood strengths in the registry are on two bases, marked `strengthBasis` ("characteristic" or "clear-wood-mean"): convert to a design value from the basis. `weather.windDirRad` is the direction the wind blows from, clockwise from north. Commands issued by the interface use `sim.commandNow`, so they apply even while time is paused.

**Overlays.** Each system that has an overlay exposes pure data for it (`overlayData(state)`), and one shared add-on, `src/overlays.js`, owned by the orchestrator, draws whichever overlay is selected. Systems do not draw.

**Units in state.** Temperatures `...C`, power `...W`, energy `...Wh` or `...kWh`, water `...L`, flow `...Lmin`, pressure `...kPa`, force `...N`, stress `...MPa`, lengths metres.

### Iteration 3: structural loads

Owns `src/sim/structure.js`, `test/structure.test.mjs`. System `structure`, cadence: recompute only when `site.version` or snow depth band or wind band changes.
State: `{ version, members: { [pieceId]: { load: { deadN, liveN, snowN, windN }, demand, capacity, utilisation (0..1+), governs ("bending" | "compression" | "deflection" | "bearing" | "uplift" | "unsupported"), supports: [ids], ok } }, foundations: { [pieceId]: { bearingKPa, allowableKPa, ok } }, worst, issues: [{ pieceId, severity, reason, fix }] }`.
Loads follow real practice: dead load from material density and geometry; floor live load 1.9 kPa; roof snow from `weather.snowDepthM` and snow density, with a design value so a structure is judged before the storm arrives; wind pressure from `0.613 * v^2` Pa with a design gust. Load paths: roof to walls, posts and beams, to floors, to foundation and soil. Capacity from registry strength and stiffness with section properties from piece dimensions; span checks for bending, shear and deflection (L/240 floors, L/180 roofs).
`issues[].reason` and `fix` are plain-language sentences for the inspector.

### Iteration 4: rooms and thermal model

Owns `src/sim/rooms.js`, `src/sim/thermal.js`, `test/thermal.test.mjs`. 
`rooms.js` is pure: `findRooms(pieces)` -> `[{ id, floorAreaM2, volumeM3, heightM, envelope: [{ pieceId, areaM2, toRoom | "outside" | "ground", orientationRad, openings: [...] }], enclosed (bool), leaks: [reason] }]`. A space that is not closed (missing wall, no roof) is reported as not enclosed with the reason.
System `thermal`, cadence 5 minutes. State: `{ rooms: { [roomId]: { tempC, massTempC, humidity, enclosed, uaWK, infiltrationAch, solarGainW, internalGainW, heatingW, lossW: { walls, roof, floor, windows, infiltration } } }, version }`.
Per-room heat balance as a two-node model (air, and thermal mass from the assembly heat capacity): conduction through each assembly from its `layers` (series R-values plus surface films), windows by U-value, ground-contact floors against `weather.groundTempC`, infiltration from an air-change rate that rises with wind and openings, solar gain through glazing from `weather.solar` and the sun's angle on each window, internal gains supplied by other systems through the command `thermal.setGain({ roomId, source, watts })`. An unenclosed space tracks outside air. Energy is conserved: the test checks stored energy change equals gains minus losses.

As built: `findRooms(pieces, { groundHeightAt? })` also gives each room `storey`, `floorIds`, `stackHeightM`, `floorY`, `topY`, `openAreaM2`, `internal` (mass inside the room) and `cells` (for `roomAt(rooms, x, z, y)`); each envelope surface also has `kind` ("wall" | "roof" | "floor" | "ceiling"), `tiltRad`, `layers` (far side to room side) and, on its openings, `{ pieceId, kind, areaM2, layers, open }`. `toRoom` is another room's id, `"outside"` or `"ground"`. Room ids are `"r:" + floor piece id` (`#2`, `#3` where one floor holds several rooms). Pieces with `built: false` are ignored; an opening whose door or window is unbuilt is a hole. Rooms joined by an archway or an open stairwell are one room. Without terrain heights, a floor on a plinth and everything on a cellar storey (`storey < 0`) count as against the ground.
Thermal state also holds, per room, `dewPointC`, `toRoomsW`, `ventM2`, `radiantW`, and at the top `gains`, `heat`, `vents`, `radiant` (what the commands stored). `lossW.windows` includes doors. Commands: `thermal.setGain({ roomId, source, watts, heating?, radiant? })` (`heating: true` counts toward `heatingW`; `radiant` is the share landing on surfaces, default 0.5) and `thermal.setVent({ roomId, source, areaM2 })` (a hole to outside air: an open window or vent). Readers take the whole `sim.state`: `roomModels(state)`, `roomIdAt(state, x, z, y)`, `overlayData(state)` (exported from `index.js` as `thermalOverlayData`). Calendar calls use `ctx.ct ?? ctx.t`.

### Iteration 6: electrical

Owns `src/sim/electrical.js`, `src/sim/fixtures-electrical.js` (catalog entries), `test/electrical.test.mjs`. System `electrical`, cadence 1 minute.
State: `{ circuits: [...], sources: { [id]: { kind, ratedW, outputW } }, batteries: { [id]: { capacityWh, storedWh, voltageV, chargeW, soc } }, loads: { [id]: { ratedW, on, drawW, served } }, busV, generationW, demandW, unservedW, wires: { [id]: { currentA, ratingA, ok } }, today: { generatedWh, usedWh, wastedWh } }`.
Solar output from `weather.solar`, panel area, tilt and azimuth (direct beam by incidence angle plus diffuse), cell temperature derating, and system losses. Batteries with round-trip efficiency, depth-of-discharge limits and charge-rate limits. Loads shed in priority order when supply and storage fall short. Wire current against ampacity for the gauge, breakers trip on overload, voltage drop reported. A generator burns fuel at a real specific consumption. Works at 12 V and at 120/240 V. Energy is conserved: generated = used + stored + losses + curtailed.
Other systems register loads with the command `electrical.setLoad({ id, ratedW, on, priority })` and read `loads[id].served`. Exposes `powerAvailableAt(state, pieceId)` for power tools.

### Iteration 7: water

Owns `src/sim/water.js`, `src/sim/fixtures-water.js`, `test/water.test.mjs`. System `water`, cadence 1 minute.
State: `{ tanks: { [id]: { capacityL, storedL, elevationM, overflowL } }, catchments: { [id]: { areaM2, efficiency, inflowLmin } }, pumps: { [id]: { on, ratedW, headM, flowLmin } }, taps: { [id]: { open, pressureKPa, flowLmin, served } }, wells: { [id]: { depthM, yieldLmin } }, greywater: { storedL }, today: { collectedL, usedL, overflowL } }`.
Roof catchment from `weather.rainMmH` times roof plan area times a runoff coefficient (1 mm on 1 m2 is 1 L), snow contributing as it melts. Static pressure from elevation head (9.81 kPa per metre); a tap below the tank's water level flows by gravity, one above it needs a pump. Pipe friction as a simple head loss per metre by diameter and flow. Pumps draw power through `electrical.setLoad`. Freezing: exposed tanks and pipes can freeze when cold enough for long enough, reported as an issue before it happens. Water is conserved: collected + pumped = stored + used + overflow.
Other systems draw water with the command `water.draw({ id, litres })` and get the amount actually supplied.

### Iteration 13: chickens

Owns `src/sim/animals.js` (the shared individual-animal framework), `src/sim/chickens.js`, `src/chickens-view.js` (add-on; models and behaviour on screen), `test/chickens.test.mjs`. System `chickens`, cadence 10 minutes for physiology; movement on screen is the view's business and carries no truth.
State: `{ birds: { [id]: { name, sex, breed, bornT, traits: { ...heritable }, massKg, hungerKg (crop fill), waterL, energy, health, stress, roosting, location (pieceId | "range"), eggs: { nextT, laidTotal }, mood } }, flock: { feedKg, waterL }, eggs: [{ id, laidT, nestId, fertile }] }`.
Laying follows day length (hens need roughly 14 hours of light for full lay), age and nutrition; feed intake about 110 to 130 g a day for a laying hen with real metabolisable energy; water about twice feed by mass, more in heat; birds roost at dusk and leave the coop at dawn; they forage on range and eat kitchen scraps; a chicken tractor moved onto fresh ground adds forage and leaves manure (recorded as nitrogen per square metre for the soil iteration). Each bird is an individual with inherited traits from a small genetic model.
Fixtures: coop is an ordinary building; feeder, waterer, nest box and roost bar are fixtures.

### Iteration 2a, second half: construction methods and the plan view

Owns `src/build.js`, `src/buildui.js` if it exists, `src/touch.js`, build markup and CSS. Delivers: stick-frame, log, timber-frame and A-frame construction as real pieces; assisted building (draw a wall, generate framing, sheathing and finish pieces, with the option to place each by hand); a 2D plan view with sections and elevations; symbols with linked instances; offset, fillet, mirror and array; layers; schedule tables. Also the fixture placement tool the other five iterations rely on: place any catalog fixture, connect ports (wire, pipe) by dragging between them, and report it through `pieces()`.

## Global hooks

Add-ons and tests reach the game only through these. Add a name here rather than reaching into internals.

- `window.__game`: engine. New in wave A: `sim` (the live simulation), `saveGame()`, `saveData()`, `setSpeed(n)`, `speed`.
- `window.__build`: build mode. New in wave A: `pieces()`, `version`. New in 2a: `piece(id)`, `quantities()`, `onChange(fn)`, `serialize()`, `restore(data)`, `setLayers()`, and for its own interface (`src/buildui.js`) `view()` and `choose(id, value)`.
- `window.__nature`: ground cover and wildlife.
- `window.__game.calendar` (iteration 1): the pure calendar and sun functions of `src/sim/calendar.js`, for add-ons. `window.__weatherView`: the weather add-on's test hooks (`info`, `bench`, `settle`, `open`).

## Module layout and ownership for the waves

New simulation code goes in `src/sim/<system>.js`, one system per file, registered in `src/sim/index.js`. New interface code goes in its own add-on file under `src/` and is added to the module list in `build.sh`. Parallel iterations each own their files and touch shared files (`index.js`, `build.sh`, `template/head.html`, `ARCHITECTURE.md`) only to add their own line, so merges stay mechanical.

## Testing

- `npm test`: headless simulation tests under `test/*.test.mjs` (Node's test runner, no browser). Runs in seconds.
- `node test/page.smoke.mjs`: loads the built page in a headless browser and checks that it loads without errors, Low and High quality render, build mode opens, time controls work, a save survives a reload, and the simulation's frame cost is in budget.
- `node test/build.smoke.mjs`: builds a house in build mode through pointer events and checks the piece list, typed sizes, selection and remodeling, undo, the save round trip, and the bar on a phone.
- Frame rate itself can only be judged on a real GPU; the smoke test measures the simulation's cost per frame instead.

## Dormant and archived

Combat is switched off in the engine (`localStorage.combat = '1'` restores it) and must not be built on. The `combat`, `build-mode`, `fx` and `engine-source` branches are archives: do not merge, delete or modify them.
