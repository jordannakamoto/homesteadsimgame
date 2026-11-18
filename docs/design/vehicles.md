## 10-line summary
1. One new engine module, `src/engine/control.js` (`__game.control`), owns "what body does input drive, what does the camera follow": an exclusive possession stack plus composable modifiers and camera requests. It lands additively (6 small engine.js edits) and existing takeovers keep working untouched.
2. Migration order: vehicle seat first (new code, disrupts nobody), then cooking, then scaffold/roofwalk/hands/reach, and construct-view's ladder and camera drift last, when that file is quiet.
3. Physics: a custom lightweight model, not Rapier. Rapier is already in the bundle (4.3 MB), so size is not the argument; the arguments are three ground truths that only exist as sampled functions, async WASM init, and cost of keeping colliders in step with edits.
4. Drive model is one pure function in `src/sim/core/vehicles.js` (wheeled, tracked, towed), stepped at a fixed 120 Hz of real time on the page; headless-testable with a go-kart/tank fixture.
5. World truth: sim system `vehicles` (parked pose, fuel, seats, hitches, rental), changed only through commands; live motion is page-side and committed twice a second and on stepping off, the wheelbarrow's existing pattern.
6. No save migration needed (`sim.load` initialises a missing system); a test proves an old save loads and receives the starter ATV once.
7. ATV: present on the land from the start, mount by walking into its side, camera-relative "push where you want to go" steering identical on keyboard and the left touch stick, camera stays high with look-ahead and a slight speed zoom.
8. Trailer: a towed unit; lumber on it stays a construction stack with a `carrier` flag, so a trailer parked by the wall is a pile the build draws from directly: no unload step.
9. Implements are records plus a stroke sampler; strokes become commands. The ground workstream is asked for three tool-agnostic commands (`ground.cut`, `ground.fill`, `ground.push`) and one read (`G.groundAt`).
10. Budget: under 0.05 ms CPU per driven vehicle per frame, zero for parked ones, +3 draw calls per vehicle, no new passes.

## Slice list
| # | Slice | Model | Playtest |
|---|---|---|---|
| V0 | Control stack + engine hooks, no behaviour change | opus | regression only |
| V1 | Drive model core + headless tests | opus | headless (lands with V3) |
| V2 | Sim `vehicles` system + records + tests | sonnet | headless (parallel with V1) |
| V3 | Page vehicles: grey-box drive, mount/dismount, collisions, persistence | opus | drive a box, reload |
| V4 | ATV model, suspension, rider pose, camera feel | opus | the ATV feels good |
| V5 | Dust, tracks ribbon, stream splashes (grass press optional) | opus | visual |
| V6 | Touch drive layout, control option, HUD chip, help | sonnet | phone |
| V7 | Trailer: towed body, hitching, cargo drawing | opus | tow it, back it up |
| V8 | Hauling loop with construction stacks | sonnet | haul lumber, build off the trailer |
| V9 | Starter ATV, supplier trailer, fuel, docs | sonnet | new world and old save |
| V10 | Cooking moves onto the control stack | opus | cooking unchanged |
| V11 | Scaffold, roofwalk, hands, reach move onto modifiers/camera requests | opus | each unchanged |
| V12 | construct-view ladder and camera drift (coordinate with its owner) | opus | ladder unchanged |
| L1-L4 | later: mower, skid steer + blade, articulated arm + mini excavator, mixer | mixed | |

---

# Vehicles: core, controller stack, and the ATV first

## 1. Summary

- **Controller stack** (`src/engine/control.js`, exposed as `window.__game.control`): the one place that decides which body the input drives and what the camera follows. Three parts: an exclusive *possession* stack (walk, vehicle seat, cooking station, ladder), composable *modifiers* (pace, stand height, lead, face hold) and *camera requests* (distance, pitch, target, saved and restored centrally).
- **Vehicle mechanism** (generic, no homestead words): records in, behaviour out. Pure drive model and the sim system in `src/sim/core/vehicles.js`; page controller, meshes and effects in `src/engine/vehicles.js`.
- **Content**: `src/sim/content/vehicles.js` (ATV, trailer, fuel, prices) and `src/game/vehicles-atv.js` (procedural models, hauling gestures, supplier wiring). `src/game/` is the content folder ARCHITECTURE.md names; it does not exist yet.
- **Physics**: custom 3-DOF chassis on four ground probes, 120 Hz fixed real-time step. Not Rapier (section 4).
- **Truth**: the sim owns where each unit is parked, its fuel, who sits where, what is hitched and loaded. The page owns motion between commits.

## 2. Refactor plan (A): the controller stack

### 2.1 What exists today (audit)

| Takeover | How it takes control | Where |
|---|---|---|
| Cooking | `if (cooking.active) return` checks; own camera | engine.js 3393, 3516, 3831, 4140, 4213, 4231; cooking/view.js open 143-178, updateCamera 599-614 |
| Ladder (construction) | writes `P.x/z`, `P.climbY`, `P.faceTarget` | construct-view.js 556-591; hop onto roof 634-645 |
| Scaffold | `P.climbY`, `P.standY`, clamps `P.x/z` | src/engine/scaffold.js 57, 78, 100-111 |
| Roof walking | `P.standY`, `P.pace`, snaps `P.x/z` back | src/engine/roofwalk.js 84, 99, 112-126 |
| Hands | saves/restores `cam.dist/pitch`, sets `P.pace`, `P.faceHold`, `P.lead`, `G.handPose` | src/engine/hands.js 235, 296-298, 310-311 |
| Reach (water) | saves/restores `cam.dist/pitch` and tool | src/engine/reach.js 111, 120, 149 |
| Construction camera drift | eases `cam.dist/pitch`, guesses whether the player moved the camera | construct-view.js 1906-1922 |
| Build mode | `B.camSaved` | build.js 7708, 7725 |
| Carry / barrow | `P.carryK` | construct-view.js 529, 1117, 1140 |

Two structural problems: add-on `stepHooks` (engine.js 4240) run *after* `updatePlayer` (4224) and `updateCamera` (4232), so anything that places the player is a frame late; and four files each save and restore the same two camera numbers, which breaks when they nest.

### 2.2 The module

`src/engine/control.js` is an ES module imported by engine.js (like `src/cooking/view.js`), so it is in the engine bundle and is **not** added to build.sh's add-on list. No homestead words.

```
createControl({ player, cam, keys, mouse }) -> control

// --- possession: exclusive, a stack; the bottom entry is the built-in 'walk'
control.push(p) -> handle           p = {
    id,                             // 'seat', 'station', 'ladder' ...
    update(dt, input),              // called from updatePlayer INSTEAD of walking; places the body and poses it
    follow(out) -> out | null,      // { x, y, z, vx, vz } the default camera follows; null = the player
    camera(dt, camera) -> bool,     // optional: true = I placed the camera completely (cooking close-up)
    cam: { distK, pitch, leadS, fov },   // optional soft camera wants, eased in and out by the rig
    touch: 'walk' | 'drive' | 'none',    // which touch layout to show
    locks: { tools: bool, pointer: 'keep' | 'free' },
    onEnter(), onExit(reason) }
control.pop(handle, reason)
control.top() -> p; control.is(id) -> bool; control.walking() -> bool
control.canTake(id) -> { ok, reason }      // one place for "not while carrying / on a ladder / in build mode"

// --- modifiers: not exclusive; composed every frame and written to the fields updatePlayer already reads
control.mod(id, { pace, standY, climbY, lead, faceHold, carryK } | null)

// --- camera requests: the rig remembers what the player chose and blends the top request over it
control.cam.request(id, { dist, pitch, k (ease per s), priority } | null)
control.cam.user                    // { dist, pitch }: what wheel and mouse set

// --- input: one normalised read, so keyboard and sticks are the same thing to a controller
control.input -> { mx, mz (camera-relative, world space, length 0..1), ix, iz (raw), a, b, brake, shift }

// --- collisions: extra pushers used by pushOut (vehicle bodies, later anything)
control.colliders                   // array of (o, rad) => void
```

Composition rules: `pace` and `carryK` multiply; `standY`, `climbY`, `lead`, `faceHold` take the most recently set non-null. The composed values are written to `P.pace`, `P.standY` and so on once per frame at the top of `updatePlayer`, **only for fields that some `control.mod` owns**. Fields nobody registered are left alone, which is what lets un-migrated add-ons keep writing `P.*` directly.

### 2.3 Engine edits (all additive, engine.js)

1. Import and create: `const control = createControl({ player, cam, keys, mouse })` near line 2591.
2. `updatePlayer` (3830): after the cooking check on 3831 add `control.compose(); if (control.possess(dt)) { ring.visible = false; return; }`. `possess` builds `control.input` and runs the top possession's `update` when it is not `walk`.
3. Extract lines 3986-3987 into `function groundAt(x, z, y)` (terrain + `reliefFn` + `__build.ground`) and call it there. This is the single ground read for wheels.
4. `pushOut` (3503): after line 3517 add `for (const f of control.colliders) f(o, rad);`.
5. `updateCamera` (4139): after the cooking line, `if (control.camera(dt, camera)) { afterCamera(); return; }`; replace the follow target on 4143-4145 with `control.follow()` (defaults to the player) plus its lead; multiply `cam.dist` on 4148 by the rig's `distK`. Move the tail (fog 4165-4166, `U.playerPx` 4170-4175, water follow 4176) into `afterCamera()` so a full camera override still updates them. Cooking keeps its early return until V10.
6. `window.__game` (4492): add `control, groundAt, pushOut, vehicleCore`. `vehicleCore` comes from `src/sim/index.js` the way `earthwork` does (4526).

Nothing is removed in V0. The cooking checks, `P.climbY` on 3982 and the add-ons stay as they are.

### 2.4 Migration order

| Step | What moves | Why this order |
|---|---|---|
| V0 | The module and hooks, no users | Additive; a rebase conflict is at worst six one-line hunks |
| V3 | Vehicle seat: first possession, first `colliders` user, first `follow` user | New code only |
| V10 | Cooking: `open()` pushes `{ id: 'station', camera, touch: 'none' }`, `close()` pops; engine drops the checks on 3393, 3516, 3831, 4140, 4213, 4231 (its `collide` joins `control.colliders`) | One file plus engine; nobody else is in cooking/view.js |
| V11 | scaffold.js and roofwalk.js use `control.mod('scaffold' / 'roof', ...)`; hands.js and reach.js use `control.cam.request` in place of their `saved` objects | Generic files, small diffs; do after the current merges land |
| V12 | construct-view.js: ladder becomes possession `ladder` (fixes the one-frame lag), the camera drift on 1906-1922 becomes a camera request (the "did the player move the camera" guess on 1907 goes away because the rig tracks `cam.user`) | Biggest, in the most contended file; hand it to whoever owns construction, with the API already proven |
| Never | build.js `B.camSaved` | Do not touch build.js for this |

Until V11/V12 land, `control.canTake('seat')` refuses while any legacy takeover is live: `P.tool === 'build'`, `__reach.on`, cooking active, `P.climbY != null`, `P.standY != null`, or a load in the arms (`sim.state.sys.construction.carried`).

## 3. Data model and interfaces (B)

### 3.1 Generic versus content

| Generic (no homestead words) | Content |
|---|---|
| `src/engine/control.js` | |
| `src/sim/core/vehicles.js`: drive model, `createVehicleSystem` | `src/sim/content/vehicles.js`: `VEHICLE_KINDS`, `IMPLEMENT_KINDS`, `ITEMS_VEHICLES`, rental and fuel prices |
| `src/engine/vehicles.js` (`window.__vehicles`): live bodies, fixed step, seat possession, mount zones, camera wants, box-model helper, dust/track emitters, stroke sampler | `src/game/vehicles-atv.js`: ATV and trailer model functions, surface-to-dust colours, hauling gestures, supplier entries, starter grant |
| `test/vehicles.test.mjs` with a go-kart, a tank and a cart | `test/vehicles-content.test.mjs` (records sane, ledger conserved when hauling) |

### 3.2 Vehicle record

```
kind = {
  id, name,
  drive: 'wheeled' | 'tracked' | 'towed',
  dims: { l, w, h }, massKg, cgH,                     // metres; centre of gravity height drives weight transfer
  wheelbase, track, wheelR,
  axles: [{ z, steer: bool, driven: bool }],          // wheeled; tracked uses track + contact length instead
  powerW, topMps, reverseMps, brakeG,
  steerMaxRad, steerRate, steerSpeedFalloff,          // wheeled
  pivotRadS,                                          // tracked: yaw rate on the spot
  grip: { mu, lateral, rolling },                     // scaled by the surface under the wheels
  susp: { travel, hz, damp },                         // "feel": bob frequency and how fast it settles
  seats: [{ id, at: [x, y, z], pose: 'straddle' | 'sit' | 'stand', mount: [{ x0, x1, side }] }],
  points: [{ id, type: 'ball' | 'front' | 'rear3' | 'bed', at: [x, y, z] }],     // where implements and trailers attach
  hitch: { type, at } | null,                         // towed kinds: their tongue
  cargo: { capKg, bed: { at, l, w, h }, tips: bool } | null,
  fuel: { item, tankL, burnLph } | null,
  look,                                               // key the page resolves to a model function
}
```

### 3.3 Sim state and commands

`createVehicleSystem({ name = 'vehicles', kinds, implementKinds, hooks })` returns a system; registered in `GAME_SYSTEMS` (`src/sim/index.js` line ~63) after `stockSystem()`. `every` is large (60 ticks): its step only ends rentals. Everything else is commands.

```
sys.vehicles = {
  nextId, starter: bool,
  units: { [id]: {
    id, kind, x, z, yaw,                 // where it stands (y is derived from the ground)
    fuelL, odoM, engineS,
    seats: { [seatId]: actor | null },   // actor: 'player' today, an id in co-op
    towing: unitId | null, towedBy: unitId | null, artic,     // artic: trailer angle to the tow unit, rad
    impl: { [pointId]: { kind, q: [], state: {} } },          // q: joint values of an articulated implement
    owner: 'own' | 'rent', rentUntil: t | null,
  } },
  totals: { fuelAddedL, fuelBurnedL, distM },
}
```

Commands (all return `{ ok, reason? }`, all usable through `commandNow` so they work while paused):
`vehicles.add { kind, x, z, yaw, fuelL, owner, rentUntil }`, `vehicles.remove { id }`, `vehicles.sit { id, seat, actor }`, `vehicles.leave { id, seat }`, `vehicles.sync { id, x, z, yaw, artic, burnedL, distM, engineS }` (rejected unless a seat is taken; clamps burn to the tank), `vehicles.hitch { id, to }`, `vehicles.unhitch { id }`, `vehicles.attach { id, point, kind }`, `vehicles.detach { id, point }`, `vehicles.setJoints { id, point, q }`, `vehicles.refuel { id, litres }` (calls `hooks.takeFuel(ctx, litres)` so content pays from stock), `vehicles.rent { kind, days, x, z }` (calls `hooks.pay`).

Conservation test: `fuelAddedL = sum(fuelL) + fuelBurnedL`.

Why pose arrives by command: the sim tick is 60 world seconds (0.83 real seconds at 1x), far too coarse to integrate driving, and FOUNDATIONS.md step 4 says dynamic physics belongs on a fixed real-time step that fast-forward cannot multiply. `construction.barrowMove` (construction.js 923, sent every 0.2 s from construct-view.js 1116) is the precedent. Replays reproduce because the reported poses are in the command log.

### 3.4 Save

- `sys.vehicles` is saved with the sim state automatically. `sim.load` (sim.js 124-131) initialises a system missing from an old save, so **no `MIGRATIONS` entry and no `SAVE_VERSION` bump**. Test: a version-1 save without `sys.vehicles` loads, has `units: {}`, and `starter === false`.
- The page commits `vehicles.sync` every 0.5 s while a unit moves, on stepping off, and from a `pagehide`/`visibilitychange` listener registered before the engine's (so it runs ahead of `saveGame`). Worst case a crash loses half a second of travel.
- On load, if `units[id].seats` holds `'player'`, the page re-seats the player (the saved `world.player` x, z is already at the seat).
- Stacks on a trailer gain an optional field `carrier: unitId` (section 5.6): additive, old saves unaffected.

### 3.5 Page interface

```
window.__vehicles = {
  register({ kinds, models, surfaces, onStroke }),   // content calls this once
  units(), unit(id), driven() -> id | null,
  mount(id, seat), dismount(),                       // also done by walking in / pressing E
  body(id) -> { x, y, z, yaw, pitch, roll, speed }   // live pose, for content that draws on it (cargo, hauling)
  bedPoint(id, out), nearest(x, z, r),
  spawn(kind, x, z)                                  // debug and tests
}
```

`models[look] = (T, helper) -> { body: Mesh, wheels: InstancedMesh | null, anchors }`. The helper (`boxModel(parts)`) merges coloured boxes into one geometry with vertex colours; reuse `window.__parts.mergeGeo` (src/engine/parts.js 437).

### 3.6 Shared files touched (all small and additive)

| File | Edit |
|---|---|
| src/engine.js | the six edits in 2.3 |
| src/sim/index.js | import, `export * as vehicleCore`, one entry in `GAME_SYSTEMS`, export the content records |
| build.sh | `mkdir -p dist/game`; add `engine/vehicles` and `game/vehicles-atv` to both lists (lines 10 and 14) |
| template/head.html | `#veh` HUD chip, three touch buttons' CSS, two help lines |
| src/touch.js | drive mode (V6): about 15 lines |
| src/sim/items.js | merge `ITEMS_VEHICLES` (fuel can, trailer) as `ITEMS_GARDEN` is merged |
| src/sim/core/supply.js, src/sim/construction.js, src/construct-view.js | `carrier` flag (V8): about ten one-line edits, listed in 5.6 |
| ARCHITECTURE.md, docs/PLAYTEST.md | interface and playtest notes |

Not touched: build.js, landscape-view.js, src/sim/landscape.js, sky/weather files.

## 4. Physics and drive model

### 4.1 Rapier or custom

`@dimforge/rapier3d-compat` is imported by `src/sim/physical-kitchen.js`, which `src/sim/index.js` pulls into the engine bundle, so its 4.3 MB (inlined WASM) is **already paid**. Bundle size does not decide this. What does:

| | Rapier raycast vehicle | Custom probe model |
|---|---|---|
| Ground | Needs colliders. The ground is three things today (chunk heights with 1 m deltas, the 10 cm earthwork relief, built floors via `__build.ground`), unified only as a function you sample. Colliders would have to be built per chunk as it streams and rebuilt on every dig, at 10 cm resolution near earthwork | Samples `G.groundAt(x, z, y)` directly; always agrees with what the player walks on |
| Obstacles | Trees, rocks, walls need collider mirrors kept in step with felling and building | Reuses `pushOut` and `__build.collide`, the circles the player already uses |
| Start-up | Async `R.init()`; the kitchen shows "physics is loading" | None |
| Determinism | Same-machine only per FOUNDATIONS.md; cross-machine unproven | Plain float arithmetic on sampled heights; and it does not matter for truth, because pose enters the sim by command |
| Cost | 0.09 ms per step at 32 bodies, plus transform reads and collider updates | A few microseconds |
| Mobile | WASM heap plus heightfield colliders | Nothing extra |
| Feel | Physically right, harder to tune toward "fun" | Every feel parameter is a record field |

Decision: **custom**. Keep the seam narrow (`stepBody(body, kind, input, env, dt)`) so a Rapier-backed body could replace it for one kind later (a rolling log trailer, say) without touching controllers.

### 4.2 The model

Body state: `{ x, z, yaw, u, w, r, y, vy, pitch, vp, roll, vr, steer, air, contact[4] }` (`u` forward speed, `w` sideways speed, `r` yaw rate).

Per 1/120 s substep:
1. **Probe** the ground at the four wheel positions (tracked: the four corners of the contact patch). From the four heights get the target heave, pitch and roll and the slope along and across the body.
2. **Chassis** heave, pitch and roll are three damped springs toward those targets (`susp.hz`, `susp.damp`). Longitudinal acceleration adds a pitch moment and lateral acceleration a roll moment, both scaled by `cgH`: that is the visible weight transfer, and it shifts the per-axle load used for traction.
3. **Longitudinal**: drive force `min(powerW * throttle / max(|u|, 1.5), mu * load)`, minus rolling resistance, quadratic drag, braking (`brakeG`), and gravity along the slope. Surface scales `mu` (grass, wet grass from `weather.rainMmH`, dirt, gravel, shallow water).
4. **Lateral**: `w` decays at the `grip.lateral` rate but no faster than `mu * g` allows, so a hard turn on wet grass slides. Handbrake drops rear lateral grip.
5. **Yaw**, wheeled: `r = u * tan(steer) / wheelbase`, steer eased at `steerRate` and limited more as speed rises. Tracked: left and right track speeds from throttle and turn; `r = (vR - vL) / track`, pivot turn allowed.
6. **Air**: if every probe is above the wheels by more than the travel, go ballistic until contact; landing compresses the springs (and asks the camera for a small shake).
7. **Collide**: three circles along the body (front, middle, rear) go through `G.pushOut`; the correction moves the body, removes velocity into the obstacle, and adds a little yaw. Speed lost above a threshold triggers a thump and shake. No damage, no rollover: roll is clamped and a steep cross-slope slides the unit downhill instead.
8. **Towed unit**: its hitch follows the tow point; `artic' = -(u / L) * sin(artic) - r`, clamped at 75 degrees (at the stop the tow unit cannot turn further that way). Its mass adds to the tow unit's for acceleration and braking; its own two probes give it roll and bob.
9. **Water**: `G.streamWaterAt` depth slows it (as wading does, engine.js 4001); deeper than the axle, the engine stalls and it drifts to a stop. Sea level is a wall.

### 4.3 Stepping

Page side, accumulator with `SUB = 1/120`, at most 4 substeps a frame (engine dt is clamped to 0.05 on line 4446, so 6 would be owed at worst: the excess is dropped). At 144 fps most frames run one substep and some none; the drawn pose interpolates between the last two states so motion is smooth at any frame rate. Only driven units and their trailers step. A parked unit has `matrixAutoUpdate = false` and costs nothing.

### 4.4 Budget

| Item | Cost |
|---|---|
| Substep: 4 `groundAt` + 3 `pushOut` circles | estimated 5-10 microseconds; target under 0.05 ms per frame with a trailer |
| Parked units | 0 per frame |
| Draw | body 1 call, wheels 1 instanced call, cargo 1 instanced call (cap 96 boxes); plus the shadow pass |
| Particles | through `G.burst` (shared pool, `MAXP` 500, engine.js 2289): at most 6 a frame |
| Track ribbon | 1 call, 256 segments in a ring buffer, one segment written per 0.25 m |
| DOM | `#veh` chip written only when a rounded value changes |
| Full-screen passes | none |

Measure with `__game.bench` and the Graphics panel's JS milliseconds before and after V3 and V5. Chunk streaming is the real risk at speed (section 8).

## 5. The ATV experience (C)

### 5.1 Record (content, `src/sim/content/vehicles.js`)

Utility quad: length 2.1 m, width 1.2 m, wheelbase 1.28, track 0.95, wheel radius 0.3, 320 kg, 24 kW, top speed 11 m/s forward (walking is 5.4, sprinting 8.2), 3 m/s reverse, steering 32 degrees falling to 12 at speed, suspension 2.2 Hz lightly damped (it should bob), one `straddle` seat, a `ball` point at the rear, a `front` point for a later blade, 14 L tank at 5 L per hour of full throttle (about 3 hours of real driving).

Small trailer: `drive: 'towed'`, bed 1.8 x 1.1 m, 90 kg, 350 kg capacity, tipping bed, hitch type `ball`.

### 5.2 Model (procedural, `src/game/vehicles-atv.js`)

About 35 boxes merged into one geometry with vertex colours, in the game's blocky-but-real style: frame rails, engine block, plastic fenders in a muted farm green, black seat, front and rear tube racks, handlebars with grips, headlight, tank cap, skid plate. Wheels are one instanced mesh of four: a ten-sided tyre with eight tread lugs and a pale hub, so spin is readable. The handlebars are a separate small mesh that turns with `steer`. One Lambert material, shadows cast. The trailer is about 15 boxes plus two wheels from the same instanced geometry. Cost to make: a function, no assets.

### 5.3 Getting on and off

- **Mount by walking in.** Each seat has mount zones along the unit's sides between the axles. Walk into one, pushing toward the seat, for 0.25 s and you swing on (a 0.3 s hop, the same shape as `tickHop` in construct-view.js 634). While you are in the zone the seat and bars glow faintly, so it is readable before it happens. Refused with a short line when `control.canTake` says no (arms full, build mode).
- **Step off** with E (touch: an "Off" button), only below 1.5 m/s; faster, E brakes first. You are put down on the side nearest the camera's right unless blocked, then the other, then behind. The unit keeps its parking brake.
- Tools: the tool bar is locked while seated (`locks.tools`), the hatchet is hidden, pointer lock is kept so the mouse still turns the camera.

### 5.4 Controls

Default scheme, **heading steer**: the direction you push is where it goes, relative to the camera, exactly as walking works. The controller turns that into throttle and steering: steer toward the pushed heading, throttle by how far you push and how well you are lined up. Push more than 120 degrees away from the nose while slower than 2 m/s and it reverses toward that heading; while faster it brakes first. This is the same on WASD and on the left touch stick, so there is nothing to relearn and no separate phone design.

| | Keyboard and mouse | Touch |
|---|---|---|
| Go / steer | WASD or arrows (camera-relative) | left stick (analogue throttle) |
| Camera | mouse (pointer-locked), wheel zooms | right stick, drag on the view |
| Brake / handbrake slide | Space | "Brake" |
| Gentle throttle (hitching, tight spots) | hold Shift | small stick deflection |
| Implement primary (tip the trailer; later blade, mower) | left mouse | "Use" |
| Unhitch | X | long-press "Use" |
| Step off | E | "Off" |

An option in the Graphics/controls panel (`localStorage.driveScheme = 'car'`) switches to vehicle-relative controls: W/S throttle and reverse, A/D steer. Tracked machines honour the same two schemes.

Jump (Space) and roll are not read while seated because `updatePlayer` returns before them.

### 5.5 Camera

The owner rejected low cameras for this game, so the camera stays the high orbit it is, still fully under the player's hand. Three soft changes while driving, all through `control`:
- **Look-ahead**: the follow target leads by 0.35 s of velocity, capped at 5 m, eased, so you see where you are going.
- **Speed zoom**: `distK` rises to 1.15 at top speed and returns when you slow.
- **Weight**: a small shake on landing and on a hard bump; none while cruising.

No automatic yaw. With heading steer an auto-turning camera would fight the stick.

### 5.6 Feel

- Suspension bob over bumps, a nose dip under braking, squat on throttle, lean into turns; the rider leans with it (arms on the bars through `pm.armL/armR`, legs bent, torso lean from lateral acceleration). Wheels spin by distance travelled and the front pair turn.
- Small jumps off humps and banks, with a soft landing.
- Dust on dirt, clippings on grass, spray in shallow water: `G.burst` at the driven wheels, rate by wheel slip and speed, colour from the surface (`G.palette` and the earthwork surface name). Quiet at cruise, busier when sliding or launching: calm, not noisy.
- **Tracks**: a two-strip ribbon (flattened, slightly darker and yellower than the grass under it) that fades over about 40 s. Cosmetic only, one draw call.
- **Grass bending** (optional, last, measured): one `uPress` uniform (xz, radius, strength) in `addWind` (engine.js 903) pushes blade tips away from the unit. It edits the grass shader, which is look-sensitive shared code, so it ships behind `__game.look.toggle('grassPress')`, default off until the owner likes it.
- Persistent flattened tracks are out of scope: that would be world truth, and it belongs to the ground workstream if wanted.

### 5.7 The trailer and the lumber loop

- **Hitch** by backing the ATV's ball to within 0.4 m of the tongue, roughly aligned (under 35 degrees): it latches with a clunk and a line of text. A faint guide line from ball to tongue shows while you are within 3 m in reverse. X unhitches. A loose trailer can also be pulled around by hand a short way (reuse the barrow's grab if cheap; otherwise later).
- **Lumber on the trailer stays a construction stack.** A stack gets `carrier: unitId`; its `x, z` follow the trailer through a new `construction.carrierMove { carrier, x, z }` (a copy of `barrowPlace`, construction.js 609), sent with `vehicles.sync`. Because `useFromStacks` (supply.js 121) already takes from the nearest stack, **a trailer parked by the wall is a pile the build draws from**. No unload step.
- **Loading** at the delivery pile: with the trailer within 4 m, aim at a stack and hold the mouse; boards stream onto the bed (about 8 a second, drawn flying with the existing assembly fly-in) until you let go or it reaches 350 kg. One gesture, many pieces. Command `construction.carrierLoad { stackId, carrier, capKg, qty }`, modelled on `barrowLoad` (construction.js 623) and conserving the ledger the same way.
- **Tipping**: hold "Use" to tip the bed; the load slides off as an ordinary stack behind the trailer (`construction.carrierUnload { carrier, x, z }`).
- Cargo is drawn by the vehicles view on the bed (pitching and rolling with it) using the pile description construct-view already computes; expose it as one more name on `window.__construct` (`describe`).
- The `carrier` flag needs these one-line guards: supply.js 54 (do not merge deliveries into a carried stack), construction.js 456 and 568 (pick a ground stack), 627 (barrow cannot load from a trailer), and construct-view.js 351/355 (do not draw carried stacks on the ground).

### 5.8 How the player gets it

- **The ATV comes with the land.** A new world places one near the starting well (beside `placeStartingWell`, engine.js 3079) with a full tank. Its purpose is to remove walking, so gating it behind money would add the tedium it exists to remove. Old saves get it once, parked near the player, through `vehicles.add` guarded by `starter`.
- **The trailer is bought** from the supplier (about $450), delivered with the next order to the drop point. It is also offered on the first lumber order as one line ("add a trailer"), so the supplier stays un-crowded.
- **Fuel**: a 20 L can from the supplier; walk up to the ATV holding it and pour (hold). To keep it from being a chore in the first version, every delivery tops the tank up. Empty means it sputters and stops.
- **Bigger machines are rented by the day**, like the scaffold (`rentScaffold`, construction.js 558): `vehicles.rent`.

## 6. Implementation slices

Each is 30-60 minutes for an implementer. "Shared" lists files outside the slice's own that it edits.

**V0. Control stack and hooks.** opus. Owns `src/engine/control.js`. Shared: engine.js (the six edits in 2.3). Done when: page smoke passes, cooking, ladder, scaffold, roof and hands behave as before, `__game.control.top().id === 'walk'`. Playtest: regression only.

**V1. Drive model core.** opus. Owns `src/sim/core/vehicles.js` (drive part), `test/vehicles.test.mjs`. Shared: none. Fixture: a go-kart, a tank, a cart on analytic terrain (flat, ramp, bowl). Tests: top speed converges to the record; steady turning radius equals wheelbase / tan(steer); stops within the braking distance; holds on a slope with the brake; tank pivots on the spot; towed cart converges behind and jackknife clamps; same inputs give the same state hash; halving the substep changes the end pose by under 2 percent. Headless: it is playtested through V3.

**V2. Sim system and records.** sonnet. Parallel with V1. Owns the system half of `src/sim/core/vehicles.js` (agree the file split with V1: suggest `vehicles.js` = system, `vehicles-drive.js` = model, to avoid two agents in one file), `src/sim/content/vehicles.js`, tests. Shared: `src/sim/index.js`, `src/sim/items.js`. Tests: fuel conservation, sit/leave/hitch rules, rental expiry, save round trip, old save loads.

**V3. Page vehicles, grey box.** opus. Owns `src/engine/vehicles.js`. Shared: build.sh, engine.js (`vehicleCore` name only). Box body and cylinder wheels, fixed step with interpolation, seat possession, mount by walking in, E to step off, default camera with look-ahead, collisions both ways (unit against world through `G.pushOut`; player against unit through `control.colliders`, an oriented box), `vehicles.sync`, re-seat on load. Playtest: `__vehicles.spawn('atv')`, drive around trees and a building, get off, reload, it is where you left it.

**V4. The ATV.** opus. Owns `src/game/vehicles-atv.js` (models). Shared: build.sh. Model, wheel spin and steer, suspension visuals, rider pose, jumps and landings, speed zoom, shake, feel tuning of the record. Playtest: is it fun over the hills.

**V5. Effects.** opus. Owns the fx part of `src/engine/vehicles.js`. Dust and clippings by surface, track ribbon, stream splash and wake (`G.waterFx`, `G.rippleSim.mover`). Optional last step: `uPress` in engine.js `addWind` behind a look toggle, with before/after numbers.

**V6. Touch, options, HUD.** sonnet. Shared: src/touch.js (drive mode: `ui.dataset.mode = 'drive'` when `G.control.top().touch === 'drive'`, three buttons), template/head.html (CSS, `#veh`, help lines). Car-controls option.

**V7. Trailer.** opus. Towed body on the page, hitch guide and latch, unhitch, trailer model, tipping bed animation, cargo instancing with a test load. Playtest: hitch, tow, reverse it into a spot.

**V8. Hauling loop.** sonnet (careful: ledger). Shared: supply.js, construction.js, construct-view.js (the guards in 5.7), `window.__construct.describe`. Commands `carrierLoad`, `carrierMove`, `carrierUnload`; hold-to-load gesture; build draws from the trailer. Tests: ledger balance (`imbalance`, supply.js 145) stays zero through load, drive, use, tip. Run `test/shed.e2e.mjs` and the construction smoke.

**V9. Acquisition, fuel, docs.** sonnet. Starter ATV for new and old saves, trailer in the supplier, fuel can and pour, delivery top-up; ARCHITECTURE.md (control stack, vehicles interface, new globals), docs/PLAYTEST.md.

**V10. Cooking onto the stack.** opus. Shared: src/cooking/view.js, engine.js (remove six checks).

**V11. Modifiers and camera requests.** opus. Shared: scaffold.js, roofwalk.js, hands.js, reach.js.

**V12. construct-view ladder and camera.** opus, coordinated with construction's owner.

Order: V0, then V1 and V2 together, V3, V4, then V5, V6, V7 in any order, V8 after V7, V9, then V10-V12 when the other sessions are quiet. V0-V4 is the first thing worth the owner's time (about four slices).

## 7. Later machines

### 7.1 Implements

```
implementKind = {
  id, name, mounts: 'ball' | 'front' | 'rear3' | 'bed', massKg, dims,
  tool: { shape: 'bar' | 'disc' | 'point', w, r, at: [x, y, z] },   // the working edge, in the unit's frame
  controls: [{ id, kind: 'toggle' | 'axis', min, max, rate }],        // deck down, blade height, drum spin
  joints: [...] | null,                                               // articulated only (7.3)
  work: 'mow' | 'grade' | 'dig' | 'mix' | 'haul',                     // a name content maps to commands
  powerW,                                                             // drawn from the engine while working
}
```

The generic **stroke sampler** in `src/engine/vehicles.js` watches the tool edge move through the world and emits a stroke every fixed distance (0.25 m) or bite, so work never depends on frame rate:

`stroke = { unit, impl, work, x0, z0, x1, z1, yaw, w, y (edge height), m3 (carried), t }`

Content's `onStroke(stroke)` turns it into a command and returns what came back (volume cut, resistance). Resistance feeds the drive model as drag, so a full blade slows the machine and a deep cut bogs it: that is the tactile feedback.

| Machine | Body | Implement | Stroke becomes |
|---|---|---|---|
| Ride-on mower | wheeled, rear steer | deck, `disc` | `landscape.mow { x0, z0, x1, z1, w, heightM }` (new, landscaping branch) |
| ATV blade / skid steer / bulldozer | wheeled or tracked | blade, `bar`, height axis | `ground.push` |
| Skid steer bucket, loader | tracked or wheeled | bucket on lift arms (2 joints) | `ground.cut` to load, `ground.fill` to dump |
| Mini excavator, backhoe | tracked / wheeled with stabilisers | boom, stick, bucket (7.3) | `ground.cut`, `ground.fill` |
| Concrete mixer | towed drum, or a truck | drum, `mix`, spin toggle, chute axis | concrete workstream's `mix` and `pour` commands; the drum's contents are implement `state` |
| Trailer, cart | towed | `haul` | section 5.7 |

Each of these should need records, a model function and an `onStroke` mapping: no change to the drive model or the controller.

### 7.2 What the ground workstream should provide

Machines need one ground (brief, audit finding 1) and tool-agnostic commands. Today `landscape.dig` demands a shovel and a hand scoop (landscape.js 87-108) and `landscape.push` refuses more than 0.5 m (173-178). Requested, as thin commands over `earthwork.cut/fill/push/settle` (earthwork.js 96, 129, 224, 191) with no tool checks:

```
ground.cut  { x, z, r, maxM3, maxDepthM, bare }            -> { ok, m3, s }      // a bucket bite
ground.fill { x, z, r, m3, s }                              -> { ok }             // a bucket dump, a tipped load
ground.push { x0, z0, x1, z1, w, levelY, carryM3, capM3 }   -> { ok, carryM3 }    // a blade: cut above levelY, carry, fill below
ground.settle { x, z, r }
```

Notes for that workstream: radii up to about 1.2 m and depths past the current 1.2 m default (`maxDepth`, earthwork.js 96) are needed for an excavator; `levelY` should be absolute world height, so a blade can grade across the boundary between the 1 m terrain and the 10 cm field; page side, wheels read only `G.groundAt(x, z, y)`, so whatever the unified ground becomes, keeping that one function right is the whole contract for driving. A heavy machine compacting loose fill (clearing `LOOSE_BIT`) could be a later stroke kind.

### 7.3 Articulated implements (sketch only)

- `joints: [{ id, parent, at, axis, min, max, rate, len }]`: a chain (swing, boom, stick, bucket). State is `q[]` in `units[id].impl[point].q`, committed with `vehicles.setJoints` when the arm rests.
- Page: forward kinematics each frame gives the bucket edge pose; each link is a box model. Joint speeds are rate-limited, which is what makes hydraulics feel heavy.
- Two control modes: direct (two sticks in the standard excavator pattern: left = swing and stick, right = boom and bucket), and assisted, the default: the mouse picks a point within the machine's reach ring and a small solver drives the joints toward it; hold to bite, drag back to curl. That is the owner's "mouse-aimed within reach" rule with the machine's reach replacing the body's.
- While the arm works, the body is a different possession (`id: 'arm'`) pushed on top of `seat`: the same stack, so swapping between driving and digging is one key.
- Bites go through the stroke sampler as `ground.cut`; the bucket's load is implement `state`; opening it is `ground.fill`. Stabilisers are a toggle that locks the drive model.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Chunk streaming hitches at 11 m/s (FOUNDATIONS.md notes a travel frame can pass the 5 ms budget; a chunk is crossed every 3 s) | Measure in V3 before tuning top speed; cap speed by measured hitching, not by taste; the look-ahead camera hides less than a walking camera so pop-in is more visible |
| engine.js edits collide with active sessions | Six small hunks in V0, none in the sky block; land V0 early and alone |
| Legacy takeovers and the seat both think they own the player | `control.canTake` guard list until V11/V12; seat possession returns early from `updatePlayer`, so legacy `P.*` writes are simply ignored while seated |
| Heading steer feels vague, or reversing a trailer is frustrating | Car scheme option from V6; Shift for gentle throttle; hitch guide line; the 75 degree clamp prevents a locked jackknife |
| `carrier` stacks break the construction ledger or the shed test | Conservation test in V8; run `test/shed.e2e.mjs`; the change is a flag, not a new store |
| The player parks on a building site and build mode's `cutTerrain` levels under it | Units read the ground every frame when driven and once when woken; a parked unit re-seats on the ground when `__build.version` changes nearby |
| Unit stuck inside geometry after an edit or a load | On wake, if any body circle is inside an obstacle, push out along the shortest exit; debug `__vehicles.unstick(id)` |
| Grass press shader changes the look or costs fill | Optional, behind a toggle, measured, default off |
| Two agents in `src/sim/core/vehicles.js` (V1 and V2) | Split into `vehicles-drive.js` and `vehicles.js` up front |
| The owner finds fuel tedious | Delivery top-up from day one; fuel policy is content, one flag to switch off |
| Co-op later | Seats hold an actor id, commands carry the unit id, pose sync is already a message: the shape is ready, nothing more is built now |
| Touch layout crowding on a phone | Drive mode replaces the action cluster rather than adding to it |

### Critical Files for Implementation
- /home/claude/homesteadsimgame/src/engine.js (updatePlayer 3830, pushOut 3503, ground read 3986-3987, updateCamera 4139, step 4210, `window.__game` 4492)
- /home/claude/homesteadsimgame/src/sim/index.js (system registration and the `vehicleCore` export) with /home/claude/homesteadsimgame/src/sim/sim.js (commandNow, load)
- /home/claude/homesteadsimgame/src/sim/construction.js (barrow pattern 607-645, 923: the model for carrier stacks and pose-by-command) with /home/claude/homesteadsimgame/src/sim/core/supply.js
- /home/claude/homesteadsimgame/src/engine/scaffold.js and /home/claude/homesteadsimgame/src/engine/roofwalk.js (the modifier pattern to migrate; mount-by-movement reference)
- /home/claude/homesteadsimgame/src/touch.js and /home/claude/homesteadsimgame/src/sim/core/earthwork.js (drive layout; the functions behind the requested `ground.*` commands)
