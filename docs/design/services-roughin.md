## 10-line summary

1. Today there are three connection models: abstract `FX.links` in `src/build.js` (9888-10310), the kit-parts lattice (`core/parts.js` + `plumbing.js`), and nothing hands-on for power. `powerAvailable: () => false` is hardcoded at `src/engine.js:4495`.
2. Refactor to one generic store, `routes` (`src/sim/core/routes.js`): nodes and runs riding on "frames" (a building), with per-run work items (bores, pull, joins). No water or power words.
3. One generic compiler, `src/sim/core/links.js`, turns any terminal/edge graph into the `wire` / `pipe` / `leak` pieces `electrical.js` and `water.js` already solve. Both `routes` and the kit-parts lattice feed it; `compilePlumbing` becomes a thin adapter.
4. A content system `services` (`src/sim/services.js` + `src/sim/content/services.js`) publishes links and synthetic breakers/devices. `water.js` (121-133) and `electrical.js` (531-532) merge them. Legacy build links migrate page-side, keeping their ids and lengths.
5. Stages: `rough-in` sits after gutters and before insulation; `trim-out` after lining. They enter the Build panel through a small "external tally" addition to `sim/construction.js`, so the Build panel, ordering and deliveries are reused.
6. Insulation waits for rough-in only when runs are planned, with a "Close up anyway" override. Lining hides runs by ordinary depth. "Open this wall" reuses `construction.dismantle` on the wall's `.ln` member.
7. UI is two clicks: pick a start socket, pick a stud or joist spot; a router (`core/routefind.js` over channels built from `__build.membersOf`) draws the run along studs and joists; R cycles alternatives; confirm.
8. Gestures: drill sweep through studs, nail a box, one continuous cable or PEX pull, crimp, click-in drain lengths with visible fall; trim-out devices; throw the breaker or open the valve by hand.
9. Feedback: lights come on along the circuit, taps sputter then run, drains swirl or gurgle when unvented, leaks spray at uncapped stubs. X-ray overlay via a small generic `src/overlays.js` (no full-screen pass).
10. 15 slices; build.js is touched only by three small exports and two guards. Main risks: flooring branch stage edits, member-id regeneration, the electrical topology cache, point lights.

## Slice list

| # | Slice | Model | Blocked by |
|---|---|---|---|
| S0 | `powerAvailable` reads the electrical solve | sonnet | none |
| S1 | Generic `links.js` + `routes.js` store; `plumbing.js` re-based | opus | none |
| S2 | `services` system + content; water/electrical merge | opus | S1 |
| S3 | Generic runs view `src/engine/routes.js` + `src/overlays.js` | sonnet | S1 |
| S4 | Legacy link migration + build.js shim | opus | S2, S3 |
| S5 | Channels from framing + router | opus | S1 |
| S6 | Plan UI: two clicks, ghost, alternatives, confirm | opus | S3, S5 |
| S7 | Rough-in gestures: drill sweep, box, pull | opus | S6 |
| S8 | Construction integration: stages, external tally, supply, cover and reopen | opus | S2, S7 |
| S9a | Grid service entrance in `electrical.js` + catalog | opus | S2 |
| S9b | Electrical trim-out, breaker, lights, tester beat | sonnet | S7, S8 |
| S10 | Supply plumbing: manifold, PEX, stubs, pressure test, fixtures | sonnet | S7, S8 |
| S11 | Drains and vents with real fall; gurgle | opus | S10 |
| S12 | Overlay polish, Home panel text, docs | sonnet | S9b, S10 |
| S13 | Ground hook-ups: trench channels, well line, sewer/septic, service lateral | opus | ground workstream |
| S14 | Fixture macro ("rough in this sink"), kits, hired hand | sonnet | S10 |

---

# Services rough-in: plumbing and electrical inside the building process

Workstream design, 18 Nov. Repo state studied: `main` clone at `/home/claude/homesteadsimgame`.

## 1. Summary

Wires and pipes become things that run through the frame of a building. The player picks two points; the game routes along studs and joists; the player drills, pulls and fastens in a few gestures; insulation and lining hide the work; devices and fixtures go on at trim-out; a breaker thrown or a valve opened by hand gives an immediate result.

Underneath, one generic mechanism (`routes`) replaces the abstract port-to-port links, and one generic compiler (`links`) serves both `routes` and the First Water kit-parts lattice. `water.js` and `electrical.js` stay the judges and are barely changed.

Design rules followed:
- Generic files carry no water or power words. Content supplies classes, specs, rules and looks.
- `src/build.js` is not reorganised: three small exports and two guards.
- Nothing runs per frame when idle. Meshes rebuild only on a version change.
- Nothing can be built wrong; routing and sizing are the game's job. Mistakes show as reasons in plain words.

## 2. Refactor plan (A): one connection model

### 2.1 What exists

| Model | Where | Problem |
|---|---|---|
| Abstract links | `src/build.js` `FX.links`, `fxConnect` (10217), `linkRoute` (10020), emitted by `fxPieces` (10286-10301) | No place in the building, length from a fixed L-shaped guess, port dots the owner found janky |
| Kit parts lattice | `src/sim/core/parts.js`, compiled by `compilePlumbing` (`src/sim/plumbing.js:23-70`) | Good for loose yard pipe; unsuited to in-wall runs (0.25 m lattice, one part per fitting) |
| Electrical hands-on | none | Wires only via Equip port dots (`build.js:10068-10069`) |
| `powerAvailable` | `src/engine.js:4495` returns false | Nail gun and saw never see power |

### 2.2 Target

```
 kit parts (yard, by hand) ─┐
                            ├─► neutral graph ─► core/links.js ─► connection pieces ─► water.js / electrical.js
 routes (in buildings)   ───┘     (terminals, edges, open ends)     (wire, pipe, leak, synthetic fixtures)
```

- **`src/sim/core/links.js`** (new, generic, pure). `compileLinks(graph, rules) -> { links, open, reach }`.
  - `graph = { terminals: [{ id, ref }], edges: [{ id, a, b, lengthM, extra }], joints: { [id]: { blocked?: bool, cost? } }, openEnds: [{ id, at, edge }] }`.
  - Walks breadth-first from each terminal through joints to other terminals. Carries length, a content reducer (`rules.sum(acc, edge)`), and the blocking joints passed. Same tie-breaks as today's plumbing BFS: fewest blocks, then shortest.
  - This is today's loop at `plumbing.js:28-67` lifted out with names made neutral.
- **`src/sim/core/routes.js`** (new, generic). Store and commands for runs on frames; section 3.
- **`src/sim/plumbing.js`**: `compilePlumbing` keeps its signature and output (so `test/plumbing.test.mjs` and `test/water.smoke.mjs`, which reads `sys.plumbing.pieces`, stay green) but builds a neutral graph from `graph()` of parts and calls `compileLinks`.
- **`src/sim/services.js`** (new, content): compiles `routes` through `compileLinks` and publishes pieces.
- **Kit parts stay** for exposed yard pipe. Converting them to routes was considered and rejected: it would break First Water saves and gestures for no player gain. They stop being a separate *connection* model because they share the compiler, and a route node of kind `stub` can expose a kit `port` anchor so yard pipe joins house pipe at a hose bib or stub-out.
- **`FX.links` goes away** for power and water. Flue links (`CONN.flue`, `build.js:9904`) stay where they are; out of scope.

### 2.3 Consumers

- `src/sim/water.js:121-133` (`piecesFor`, `versionOf`): read a list of sources `['plumbing', 'services']`, taking `state.waterPieces || state.pieces`. Keep the `merged` WeakMap memo.
- `src/sim/electrical.js:531-532`: `topology(site && site.pieces, s)` becomes `topology(piecesFor(ctx), s)` with the same memo pattern. This matters: `cache` (line 125) is keyed by array identity, so an unmemoised concat would recompile the network every tick.
- `GAME_SYSTEMS` (`src/sim/index.js:63`): insert `routesSystem, services` before `electrical`.

### 2.4 `powerAvailable`

- Add to `src/sim/electrical.js` beside `powerAvailableAt` (950): `powerNear(state, x, z, cordM = 30, minW = 1)`. True when a load point in `s.points` within `cordM` has `powerAvailableAt(state, id) >= minW`. With no load points at all it falls back to `powerAvailableAt(state) >= minW`.
- `src/engine.js:4495`: `powerAvailable: (minW = 1) => powerNear(sim.state, player.x, player.z, 30, minW)`.
- Callers (`construct-view.js:902, 1226, 1445, 1451`, `stock-view.js:65`) need no change.

### 2.5 Migration

1. **Sim state.** New systems initialise themselves on load (`sim.js:16, 102`), so `sys.routes` and `sys.services` appear in old saves without a step.
2. **Build links.** Lengths are computed at run time by `linkRoute`, so a pure save migration cannot reproduce them. Do it once on the page:
   - `src/sim/save.js`: `SAVE_VERSION = 2`; `MIGRATIONS[1]` sets `world.legacyLinks = true` when `world.builds.fx.links` holds any `wire`, or any `pipe` under 100 mm.
   - `syncSite` (`engine.js:3102`), after `build.ensureLoaded()`: if the flag is set and `__build.legacyLinks` exists, for each link issue `routes.addNode` twice (bound to the two refs) and `routes.addRun { cls, path: pts, lengthM, props: { linkId, gauge | diameterMm, material }, legacy: true, state: 'done' }`, then `__build.dropLegacyLinks(ids)` and clear the flag.
   - The compiled link keeps `props.linkId` as its id, so `electrical.wires[id]`, `water.pipes[id]` and breaker state carry over.
3. **Acceptance.** For a v1 fixture save, `electrical.wires` and `water.pipes` have the same keys, and flows match within rounding after one tick.
4. `__build.connect` stays as a shim (chickens and `test/build.smoke.mjs:253` use it): with `routes` present it issues the same two-node, one-run commands and returns `{ ok, id }`.

## 3. Data model and interfaces

### 3.1 Generic: `routes` state (`sim.state.sys.routes`)

```
{ v: 1, version, next,
  frames: { [frameId]: { x, y, z, yaw } },              // a rigid body runs ride on; content uses the struct id. null frame = world
  nodes:  { [id]: { id, frame, at: [x, y, z],           // frame-local metres
                    kind,                               // content id: where runs end or meet
                    ref?: { piece, port },              // a terminal on equipment
                    host?: { parent, member? },         // what it is fixed to (a wall id, a stud id)
                    set?: { ... },                      // per-node settings (capped, open, on)
                    state: 'planned' | 'set' | 'trimmed' } },
  runs:   { [id]: { id, cls, spec, frame, a, b,         // node ids
                    path: [[x, y, z], ...], lengthM,
                    bores: [{ at: [x, y, z], parent, done: 0 | 1 }],
                    hosts: [parentId, ...],             // every wall, floor or roof it passes inside
                    pulled: 0..1, joined: { a: 0 | 1, b: 0 | 1 }, segs?: n, segsDone?: n,
                    state: 'planned' | 'roughed' | 'done', group?, props?, legacy? } } }
```

Commands, each `{ ok, ... }` or `{ ok: false, reason }`, bumping `version` and emitting `routes.changed`:

| Command | Payload |
|---|---|
| `routes.setFrames` | `{ frames }` (replaces; runs on a vanished frame are flagged `stray`, never deleted) |
| `routes.addNode` / `moveNode` / `setNode` / `removeNode` | `{ kind, frame, at, ref?, host? }`, `{ id, at }`, `{ id, key, value }`, `{ id }` |
| `routes.addRun` | `{ cls, spec, frame, a, b, path, bores, hosts, group?, props?, state? }` (length is recomputed in the sim) |
| `routes.reroute` | `{ id, path, bores, hosts }` (only while untouched or reopened) |
| `routes.work` | `{ id, what: 'bore' | 'pull' | 'join' | 'seg', index? | to? | end?, n? }` (`n`: several per gesture) |
| `routes.removeRun` | `{ id }` |

Pure read-outs on `api`: `toNeutral(state, classes)`, `progress(state, frame, phase) -> [done, total]`, `runState(run, cls)`, `worldOf(state, frame, p)`.

`createRoutesSystem({ name = 'routes', classes })`. A class is data: `{ id, linkKind, steps: ['bore', 'pull', 'join'] | ['seg', 'join'], phases: { rough: [...kinds], trim: [...kinds] } }`. Tested with a non-homestead fixture (a pneumatic message-tube set in a rack), `test/routes.test.mjs`.

### 3.2 Generic: router (`src/sim/core/routefind.js`, pure)

- Input: `channels = { verts: [{ id, p, tag }], edges: [{ a, b, lengthM, bore?: { at, parent, depthM }, tag }] }`, `from`, `to`, `rule = { cost(edge), allowed(edge), finish?(path) }`, `k` alternatives.
- Dijkstra; alternatives by penalising the edge tags already used (through the wall, over the top, under the floor).
- Output: `[{ path, lengthM, bores, hosts, why }]`, or `{ refused: reason }`.
- Runs on the page for preview. The sim stores the chosen result, so replays never depend on the router.
- Exposed as `window.__game.routes = { find, channelsFor }` (one added name in the `window.__game` object, same pattern as `garden` and `earthwork`).

### 3.3 Content

- **`src/sim/content/frame-channels.js`**: turns framing members (`__build.membersOf(structId).list`, or `__framing.generate` in tests) into channels. Knows stud, plate, joist, header; no service words.
  - Walls: studs sorted along the wall give bays. Verts per bay at travel heights (0.35 m, 1.15 m, top minus 0.2 m). Vertical edges are free (stapled to a stud). Sideways edges carry a bore through the stud between. Openings block the bays between king studs except above the header and below the sill (cripple bays).
  - Top: one bore pair (top plate and cap plate) up to a ceiling/attic line along the wall. Bottom: one bore down into the joist bay under it.
  - Floors: along a joist bay free; across joists bored, or hung below when the foundation leaves a crawl space (`pier-blocks`, `piers`, `stemwall`).
  - A cabin is about 400 verts. Cached per struct `ver`.
- **`src/sim/content/services.js`**:
  - Classes: `cable`, `supply` (cold, hot as a spec colour), `drain`, `vent`.
  - Specs: `cable_nm_14_2` (15 A), `cable_nm_12_2` (20 A), `cable_nm_10_3` (30 A); `pex_12_blue`, `pex_12_red`, `pex_20`; `dwv_40`, `dwv_50`, `dwv_75`, `dwv_100`. Each maps to the existing catalog (`gauge`, or `material: 'pipe_pex_12'`).
  - Node kinds: `slot` (a place on a panel or manifold), `box`, `box_ceiling`, `stub_supply` (capped until trim), `stub_drain`, `cleanout`, `vent_term`, `exit` (where a run leaves the building for the ground workstream).
  - Presets: outlet 0.40 m, switch 1.20 m, counter 1.10 m, sink stubs 0.50 m, toilet stub 0.20 m, shower valve 1.20 m.
  - Rules (to be checked against code tables by the implementer): bore at most 40% of stud depth in a bearing wall; a bore nearer than 32 mm to the stud face gets a nail plate automatically; joist holes at most a third of depth, in the middle third; drain fall 2 cm per metre; trap arm length by diameter; one vent per fixture group; a pipe in an outside wall is flagged for freezing.
  - `ITEMS_SERVICES` (cable by the metre on spools, boxes, staples, nail plates, PEX coils, crimp rings, DWV lengths, a fittings pack, drill and auger bit, crimp tool, tester, pressure gauge), merged in `src/sim/items.js` like `ITEMS_GARDEN` (line 165).
  - `FIXTURES_SERVICES`: `service_entrance_100a`, `manifold_pex_6`, `switch_single`, `light_ceiling`, `drain_stub`, `vent_cap`; merged in `src/sim/fixtures.js`.
  - Stage texts, card lines, reasons.
- **`src/sim/services.js`** (system `services`, every tick, recompiles only on a version change):

```
sys.services = { v, routesV, siteV, version, pieces, powerPieces, waterPieces, sig,
  tally: { [structId]: { 'rough-in': [done, total], 'trim-out': [done, total] } },
  covered: { [runId]: true }, issues: [{ runId | pieceId, severity, reason, fix }],
  checks: { [structId]: { power?: { ok, t, faults }, water?: { ok, t, faults } } }, deferred: { [runId]: true }, notes: {} }
```

  What it emits:
  - `wire` per cable run between devices. A box with no device yet is a pass-through joint, so rough-in alone powers nothing.
  - A synthetic `fixture` piece per breaker (`sv:br:<group>`, catalog `breaker_15a` / `20a` / `30a` from the spec) plus the two short wires either side, so `electrical.js` trips and resets it by a stable id.
  - A synthetic `fixture` per device in a box (`sv:n<id>`: `outlet_120v`, `light_led_9w`, `switch_single`). Devices are not in `FX.list`, so build.js is untouched.
  - `pipe` per supply run with `indoor`, `insulationMm`, `buriedDepthM` (all already read at `water.js:158-161`).
  - `leak` for an uncapped, uncrimped or open end water can reach.
  - `pipe` from a fixture's `drain` port to its destination; `water.js` `route()` (406-429) already moves it.
  - A switch node carries `controls: [nodeIds]`; flipping it issues `electrical.switch { id, on }` for those devices.

  Commands: `services.sync`, `services.check { structId, kind: 'power' | 'water' }`, `services.defer { structId }`, `services.auto { structId, stage }`, `services.note { key }`.
  Exports: `overlayData(state)`, `runInfo(state, runId)` (plain-words status and reason).

### 3.4 Page files (new)

| File | Kind | Holds |
|---|---|---|
| `src/engine/routes.js` (`window.__routes`) | generic | `attach({ system, looks, frameMatrix(frameId) })`: merged prism geometry per frame and class, node instancing, bore dots, ghost path, pick (nearest run, node, bore), pull progress, x-ray material swap. `view.refresh()`, `view.pick(R)`, `view.ghost(path | null)`, `view.xray(on)` |
| `src/overlays.js` (`window.__overlays`) | generic | The overlay switcher ARCHITECTURE.md plans: `register({ id, name, key?, on(), off(), legend })`, one active at a time. No drawing of its own |
| `src/services-plan.js` | content | Class picker, two-click planning, router call, alternatives, waypoint drag, confirm |
| `src/services-hands.js` (`window.__servicesHands`) | content | Drill, box, pull, crimp, drain lengths, trim-out, breaker and valve handles, tester and gauge beats, lights, streams, gurgle |

All four are added to both lists in `build.sh` after `water-hands`. Smoke test: `node test/services.smoke.mjs`.

### 3.5 build.js touch (complete list)

In the export block near line 11241:
- `portPos: (fixtureId, portId) => [x, y, z] | null` (wraps `portPos`, 10008).
- `legacyLinks()` -> `[{ ...link, pts, lengthM }]` for power and water links (uses `linkRoute`).
- `dropLegacyLinks(ids)` (filters `FX.links`, calls `fxTouch`).

Guards:
- `fxConnect` (10217): when `window.__game.sim.handlers.has('routes.addRun')` and the port type is power or water, delegate.
- Port dots (10069): also skip `power` once `window.__servicesHands` exists. Help text at 7177 updated.

If the foundations workstream lands a general `__build.extend`, these three exports register through it instead.

## 4. Stage changes (B)

### 4.1 Order

`site, foundation, floor-frame, subfloor, wall-frame, top-plates, roof-frame, roof-deck, dry-in, roofing, sheathing, wrap, openings, cladding, gutters, **rough-in**, insulation, lining, **trim-out**, services`

- `src/framing.js:7-8`: add the two ids and names. `services` stays last for yard equipment and old saves.
- `src/sim/content/construction.js` after line 25: `{ id: 'rough-in', needs: ['roofing', 'sheathing'], by: 'services', verb: 'Run the pipes and cables', what: 'Drill the studs, pull cable and pipe to each box and stub.', why: 'Everything inside a wall goes in while you can still see the studs.' }`.
- Line 26: insulation `needs` gains `'rough-in'`. A stage with no tally counts as complete (`stageComplete`, `sim/construction.js:188`), and rough-in has the same `needs` as insulation had, so buildings without planned services behave exactly as before.
- After line 27: `{ id: 'trim-out', needs: ['lining'], by: 'services', verb: 'Fit the devices and fixtures', ... }`. When the flooring branch merges, `trim-out` should also need its stage.
- `UNLOCKS` (266): add `services:in-wall` to the `plan:cabin` row. The shed stays service-free.

### 4.2 How services join the Build panel

Three additive commands in `src/sim/construction.js`:
- `construction.setExternal { structId, stage, built, total }`: stored in `pr.ext[stage]`; `retally` (368) adds it; `setPlan` (466) carries `old.ext` over.
- `construction.setExtLines { structId, source, lines }`: kept in `pr.extLines` and re-merged at the end of `setPlan`, so `order`, deliveries, stacks and carrying work unchanged.
- `construction.use { structId, key, qty, from: 'carried' | 'stacks' }`: `SUP.useCarried` / `SUP.useFromStacks`, then `ln.used += qty`; the ledger identity (`SUP.imbalance`) must hold.

`services` calls the first two whenever its tally or quantities change. Staples, nail plates, crimp rings and the fittings pack join `SITE_SUPPLY` (line 52): used up, never carried.

`src/construct-view.js` guard (about ten lines in `nextAction` 1568, `updatePrompt` 1530, `startAuto` 1344): for a stage with `by`, the prompt reads "Rough-in: Hands (F), then pick Power or Water", it does not look for members to nail, and "do it for me" calls `services.auto`.

### 4.3 Electrical sequence

1. **Source.** A service entrance (meter and mast on an outside wall; new grid source in `electrical.js`, slice S9a) or the off-grid chain already modelled (panels, controller, battery, inverter).
2. **Panel** (`panel_ac_100a`) placed with Equip on a wall; its free slots become `slot` nodes.
3. **Rough-in.** Boxes nailed to studs; cable from a slot to box to box (one group is one circuit, one breaker); bores drilled; cable pulled; staples and nail plates appear on their own.
4. **Check (optional beat).** Clip the tester at the panel.
5. **Cover.** Insulation and lining, the existing stages.
6. **Trim-out.** Devices pushed into boxes, plates on, breaker snapped in, main thrown.

Abstracted: neutral and ground conductors, switch loops (a switch controls what is downstream of it on the cable), three-way switches, GFCI.

### 4.4 Plumbing sequence

1. **Supply.** A manifold (the water twin of the panel: one line per fixture, so no tees buried in walls) fed from the tank, pump or pressure tank. PEX pulled like cable, a crimp at each end, a capped stub-out at each fixture. Copper is a later unlock.
2. **Drains.** Rigid lengths from each fixture's stub down and along a joist bay or under the floor, falling 2 cm per metre, to a stack and out through an `exit` node. A vent rises through the roof.
3. **Check (optional).** Pressure test on the gauge.
4. **Cover**, then **trim-out**: sink, toilet, tap or shower set on their stubs.
5. **Outside** (ground workstream): the supply line in from the well or tank and the drain out to septic or sewer. Until then the drain ends at `drain_stub`, which is a `ground` drain: water visibly lands outside.

Slab foundations: runs hosted in the ground under a slab belong before the pour. `services` reports them under whatever stage id the foundations workstream defines (section 7).

### 4.5 Seeing inside walls, and reopening

- Runs are real geometry between the stud faces. Batts and the lining hide them by ordinary depth; no new rendering. Since the interior walls workstream (`interior-walls.md`) a wall face is hung sheet by sheet (`<wall>.ln<face>.<k>`, both faces of a partition), with taped seams (`<wall>.jt<face>.<k>`, stage `finish`).
- Boxes are set proud of the studs by the wall's lining thickness (`frame-channels` `w.finish`), so their faces sit flush with the finished drywall or boards and stay visible once the wall is closed.
- `services` marks a run `covered` when any lining piece of any of its `hosts` is built (read from `ctx.get('construction').progress`). Covered runs refuse `reroute` and `work` with "Open this wall first".
- "Open this wall" in Hands calls `construction.dismantle` on that wall's lining pieces, its taped seams and the batts. Boards come back; gypsum is waste and spent compound comes back as nothing, as that command decides.
- A limit to state plainly: opening takes the whole wall (both faces of a partition), not one sheet. A cut-out patch is later work.
- "Close up anyway" calls `services.defer`: unfinished planned runs leave the tally and stay as faint plan lines.

## 5. Player experience (C)

### 5.1 Planning: two clicks

1. Hands (F). Near a framed building a four-button strip appears: Power (yellow), Cold (blue), Hot (red), Waste (brown).
2. Every valid start glows as a large socket: a panel slot, a manifold port, the last box of a circuit, a stub.
3. Click one. Then aim at the frame: a ghost box or stub snaps to the nearest stud side or joist at the preset height (wheel steps the preset).
4. Click. The route draws itself along the studs and joists as a dashed line, with a dot at every bore. Hint line: "14/2 cable, 6.4 m, 5 holes. Click to confirm, R for another way."
5. R cycles up to three routes. Dragging a point on the ghost pins it and re-routes.
6. After confirming, the start stays on the new box, so a circuit is a chain of single clicks. Clicking mid-run branches.
7. A refused route says why and what to do: "A drain cannot climb: move the sink or lower the exit."

Fixture macro (S14): aim a sink at a wall and one click plans cold, hot and drain together.

### 5.2 Rough-in gestures

| Work | Gesture | Feedback |
|---|---|---|
| Drill bores | Hold with the drill and sweep along the wall; every dot the pointer passes within reach is drilled. The per-gesture setting (`construction.options.gesture`) widens it | Chips, a dark hole, the dot goes out. Faster with power (`powerAvailable`) |
| Set a box | Click the ghost with a box in hand; two taps | Blow pose, puff, the box is solid |
| Pull cable or PEX | Click the spool end at the start, drag or walk along the run; it follows through the holes. Let go anywhere; progress stays (`pulled`) | Cable pays out, staples tick in behind |
| Crimp | Hold on each end | Ring darkens, a green flash |
| Drain lengths | Click along the ghost; lengths pop in with fittings, several per gesture | Primer puff, small fall arrows on the pipe |

Nothing is carried one piece at a time: a spool or coil serves a whole circuit, and small supplies sit at the stacks.

### 5.3 The check beat (optional)

- **Power:** clip the tester to the panel. A light hops box to box along each circuit, green or red. Red names the cause on hover ("cable not pulled through to here").
- **Water:** pump the gauge up. The needle holds or sags, and an uncapped or uncrimped end sprays.
- Passing hangs a green tag on the panel or manifold and ticks the Build panel. Skipping costs nothing now; a fault found later means opening a wall.

### 5.4 Switch-on

- Main breaker: a drag on the handle. Breakers: a click each. Lights come on in order along the circuit. A wall switch is clicked in the world. A tripped breaker hangs in the middle and is reset by hand, with the reason on hover.
- Main valve: quarter-turn drag (as the tap in `water-hands.js`). Pipe knock, taps sputter then run.
- Drains: a swirl at the plug and a short trap burble. Unvented: big slow bubbles and a slow drain, with the reason.
- First light and first indoor tap each get the overhead beat once (`services.note`).

### 5.5 Overlays

- Key X (free outside build mode at the time of writing; confirm) cycles Off, Power, Water through `__overlays`.
- The run meshes switch to a depth-test-off material in class colours. Walls are not changed, so no new pass.
- Power: runs coloured by `currentA / ratingA`; moving dashes only on live runs (one time uniform); dead runs grey; a tripped breaker pulses.
- Water: blue, red, brown; dash speed from `flowLmin`; pressure at a tap on hover; leaks marked.
- Data: `electricalOverlay`, `waterOverlay`, plus `services.overlayData` to map link ids back to runs.

### 5.6 Performance

- One merged geometry per frame and class (four-sided prisms, which also suits the pixel look), rebuilt only when `routes.version` changes for that frame.
- Lamp glow is emissive, with one pooled point light at the nearest lit lamp. Light count never changes at run time, so no shader recompiles.
- Sim: compile on change only; a plain version compare per tick otherwise.

## 6. Implementation slices

Each is 30 to 60 minutes for an implementer agent and can be played or checked alone.

**S0. `powerAvailable` reads the solve.** sonnet.
Owns: `powerNear` in `src/sim/electrical.js`, tests in `test/electrical.test.mjs`. Shared: `src/sim/index.js:36` export, `src/engine.js:4495`.
Play: place a generator and an outlet with Equip; the circular saw at the sawhorses runs.

**S1. Generic links and routes.** opus.
Owns: `src/sim/core/links.js`, `src/sim/core/routes.js`, `test/routes.test.mjs` (non-homestead fixture). Edits: `src/sim/plumbing.js` (`compilePlumbing` on `compileLinks`).
Check: `test/plumbing.test.mjs` unchanged and green; First Water plays the same.

**S2. Services system.** opus.
Owns: `src/sim/services.js`, `src/sim/content/services.js` (classes, specs, node kinds), `test/services.test.mjs`. Shared: `src/sim/index.js` (register and export), `src/sim/water.js:121-133`, `src/sim/electrical.js:531-532`, `src/sim/fixtures.js`.
Check headless: a panel, cable to a light, served; tank, PEX, tap flows; an uncapped stub leaks; energy and water conserved. Playable from the console with `routes.addRun`.

**S3. Runs view and overlay switcher.** sonnet.
Owns: `src/engine/routes.js`, `src/overlays.js`. Shared: `build.sh`.
Play: a debug key drops a sample run into the cabin frame; X shows it through a lined wall.

**S4. Legacy migration and shim.** opus.
Shared: `src/build.js` (the three exports and two guards of 3.5), `src/sim/save.js`, `src/engine.js` `syncSite`. Tests: `test/build.smoke.mjs`, a v1 save fixture.
Play: an old save with a wired panel and a piped tap loads and works; the runs are drawn by S3.

**S5. Channels and router.** opus.
Owns: `src/sim/core/routefind.js`, `src/sim/content/frame-channels.js`, `test/routefind.test.mjs` (a wall with a window from `__framing.generate`: the route detours over the header; bore count; a drain refused for climbing). Shared: `engine.js` `window.__game.routes`.
Play: with S6.

**S6. Plan UI.** opus (feel-critical).
Owns: `src/services-plan.js`. Shared: `build.sh`, a style block in `template/head.html`.
Play: in a framed cabin pick a panel slot, then a stud; ghost route; R; confirm; reload and it is still planned.

**S7. Rough-in gestures.** opus.
Owns: `src/services-hands.js` (drill sweep, box, pull, staples), `test/services.smoke.mjs`.
Play: finish one circuit's rough-in and see the cable through the open studs.

**S8. Construction integration.** opus.
Shared: `src/sim/construction.js` (`setExternal`, `setExtLines`, `use`, `retally`), `src/sim/content/construction.js` (lines 25-27, 52, 266), `src/framing.js:7-8`, `src/construct-view.js` guard, `src/sim/items.js`. Tests added to `test/construction.test.mjs`.
Play: the Build panel lists Rough-in after Gutters; order it and spools arrive; insulation waits; "Close up anyway"; lining hides the cable; "Open this wall" shows it.

**S9a. Grid service entrance.** opus.
Owns: the service source in `src/sim/electrical.js` (an AC slack with rated amps, metered kWh charged to money, no fuel), `service_entrance_100a` in `src/sim/fixtures-electrical.js`, tests.
Play: a meter on the wall powers the panel on a cloudy day.

**S9b. Electrical trim-out and feedback.** sonnet.
Owns: additions to `src/services-hands.js` (devices, plates, breakers, main, wall switch, lamp glow, tester beat, trip reset, reasons).
Play: flip the main; lights come on in order; overload an outlet and reset the breaker by hand.

**S10. Supply plumbing.** sonnet (opus review of the leak path).
Owns: `supply` class content, manifold, stubs and caps, crimp, gauge beat, trim fixtures; water additions in `services-hands.js`.
Play: manifold to a kitchen sink; forget a cap and watch it spray; fix it; the tap runs indoors.

**S11. Drains and vents.** opus.
Owns: `drain` and `vent` rules in `frame-channels.js` and `content/services.js`, `drain_stub`, gurgle and swirl.
Play: the sink drains to the stub outside; remove the vent and it glugs.

**S12. Overlay polish, Home panel, docs.** sonnet.
Shared: `src/utilities-view.js` (hints at 24 and 35; a one-line diagram per system), `ARCHITECTURE.md`, new `docs/SERVICES.md`, stage table in `docs/CONSTRUCTION.md`.

**S13. Ground hook-ups.** opus. Blocked on the ground workstream.
Owns: a ground channel provider, `exit` to trench runs with `buriedDepthM`, well line, septic or sewer link, service lateral.

**S14. Fixture macro, kits, hired hand.** sonnet.
Owns: "Rough in this sink", cabin wiring and plumbing kits as one delivery, `services.auto` animation.

## 7. Dependencies on parallel workstreams

**Ground and foundations**
- Trenches: we need `trenchAt(x, z) -> { id, depthM, bottomY }`, or a list of trench centre lines, to build ground channels. We supply `window.__game.routes.addChannels(provider)`.
- One ground truth: `exit` nodes and `drain_stub` take their height from whichever heightfield that workstream settles on.
- Slab: they define the stage id for under-slab work and the pour gate. We publish an external tally under that id and `services.groundworkReady(structId)`.
- Crawl-space access: `frame-channels.js` reads `S.found` through `__build.structs()`; if foundation becomes its own element, that read changes.
- Septic tank, drain field, well and frost depth stay theirs; `water.js` already has `soakaway`, `mulch_basin` and the `sewer` port.
- `__build.extend`: whoever lands it first owns it; we need only the three exports in 3.5.

**Vehicles**
- No hard dependency. A trencher or excavator digs what S13 lays into.
- A vehicle that carries a generator or inverter can expose a load-point fixture and is then picked up by `powerNear` with no further work.
- Their controller abstraction should leave Hands (F) alone; services add no new possession of `G.player`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The flooring branch edits `content/construction.js` STAGES, `framing.js` STAGES and construct-view | Our edits are single inserted lines; agree stage ids before S8; `trim-out` gains the flooring stage in `needs` at merge |
| Other sessions in `build.js` (dollhouse, siding) | Touch only the export block and two guards; no reordering. Land S4 as one small commit right after a fetch |
| Dollhouse cut-away materials (`memberLook().matsFor`, `build.js:10928`) may not clip our meshes | S3 uses the same per-struct materials where it can; otherwise runs simply stay visible in cut-away, which is acceptable |
| Member ids regenerate when a wall changes shape | Bores are stored by position and parent wall, not member id; on a struct `ver` change the view re-snaps bores and flags runs whose wall is gone as `stray` with a reason. Never deleted silently |
| `electrical.js` topology cache keyed by array identity | Memoised merge as in `water.js:124`; a test asserts no recompile across idle ticks |
| `test/water.smoke.mjs` reads `sys.plumbing.pieces` | The `plumbing` system and its state shape stay |
| Three Hands users (`__parts`, water, services) competing for hover; `__reach` due to be swapped for `__hands` | Services yield when a kit part is held; use only the documented `__reach.use` names |
| Point lights are costly and recompile shaders when their count changes | One pooled light, emissive otherwise |
| Insulation now waits on rough-in | Only when runs are planned; identical `needs` otherwise; override button. `test/shed.e2e.mjs` should stay green; S8 confirms |
| Touch | Two-tap planning works as is; sweep and pull need a drag mapping in `src/touch.js`, not designed here |
| Code numbers (bore limits, trap arms, staple spacing) | Quoted from memory of IRC/IPC/NEC practice; S5 and S11 implementers confirm before they become rule text |
| Lining is one member per wall | Reopening strips a whole wall face in V1; say so in the hint |
| Save size | A cabin is about 40 runs of about 10 points: a few KB |
