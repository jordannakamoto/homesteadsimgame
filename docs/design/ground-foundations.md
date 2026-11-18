# Ground and realistic foundations (design, 18 Nov 2026)

## 10-line summary
1. One ground = procedural base + a 1 m "macro" grid + the existing 10 cm "fine" grid, both in the earthwork grid format, both edited by the same generic functions (`cut/fill/push/settle`), which already work at any `g.step`.
2. A new sim system `ground` owns the macro grid (migrated from engine `world.edits`) and exposes the one command API (`ground.cut/fill/push/grade/tamp`) used by shovel, build site prep and future machine implements; the engine's `world.edits` becomes a render mirror.
3. Rendering stays single-path: macro by terrain chunks, fine by the existing landscape mesh + dig mask. No new renderer for excavations; zero edits to landscape files until the landscaping branch merges.
4. Saves: earthwork grids are packed (delta/RLE varints, base64; about 17 KB to about 1 KB per tile) by a JSON replacer/reviver in save.js; SAVE_VERSION 2 migrates `world.edits` into `sys.ground.macro`.
5. Foundations become a `foundation` sim system: one job per structure (or free-standing), with real elements (slab, strip, pad, pier, wall) derived from the existing framing members, and steps layout, excavate, base, forms, rebar, pour, finish, cure, strip.
6. Concrete is a material with cure state (`core/cure.js`: equivalent age, strength fraction, frost and drying damage); gates (walk 10%, strip 20%, frame 50%, backfill 70%) hold construction stages through a small `construction.setHold`.
7. Wet concrete is an earthwork-format grid inside the job: forms are WALL bits, tipping is `fill`, raking is `relax`, screeding is `push` (the ridge riding ahead of the board is already what `push` does). That is the "tree falls" payoff.
8. The mixer is a generic machine record (body + mounts + a `batch` drum work function) compatible with the vehicles core; ready-mix truck and hired hand are services shortcuts.
9. Landscaping and farming converge on the same ground: tilling/hilling/drills become earthwork operations, a `soil` system (30 cm cells) sits under beds, boxes, shrubs and lawn, and one toolbelt registry shares shovel/rake/hoe/can.
10. 22 slices, each playtestable, ordered so that only late, small, flagged slices touch landscaping-owned files.

## Slice list
Ground: A1 codec + save v2 (sonnet) · A2 ground core/system + engine mirror + migration (opus) · A3 build site prep through ground (opus) · A4 machine-scale fixture test + chunk-refresh throttle (sonnet) · A5 ownership move of the fine grid, after landscaping merges (opus)
Foundations: B1 cure core + concrete content + foundation skeleton + hold gate (sonnet) · B2 layout strings + dig-to-line (opus) · B3 gravel base, compaction, forms (sonnet) · B4 pour field, barrow mixing, screed (opus) · B5 finishing, cure visuals, covers, strip, anchor bolts (sonnet) · B6 rebar/mesh + structure hooks (sonnet) · B7 mixer machine (opus) · B8 piers and stem wall (sonnet) · B9 ready-mix truck + hired hand (sonnet, needs services) · B10 masonry courses core + CMU stem wall (opus) · B11 brick content (sonnet)
Landscaping + farming: G1 toolbelt registry (sonnet) · G2 till/hill/drill as earthwork ops (opus) · G3 soil system extraction + migration (opus) · G4 garden boxes are beds (sonnet) · G5 landscape plants and lawn on the soil layer (sonnet) · G6 one ground renderer + wetness tint, after landscaping merges (opus)

---


# Ground and realistic foundations

Design for the "Ground and realistic foundations" workstream of Homestead. Written against `main` as cloned at /home/claude/homesteadsimgame on 18 Nov. All paths are relative to that repo. Line numbers are as of that clone; other sessions are merging, so re-grep the named function before editing.

## 1. Summary

Today there are three grounds: the engine's 1 m height deltas (`world.edits`, src/engine.js:229-274), the 10 cm earthwork grid in `sys.landscape.grid` (src/sim/core/earthwork.js) drawn over it, and build mode's `cutTerrain` (src/build.js:4277) which silently rewrites engine deltas outside the sim. Foundations are a string (`S.found`) that framing.js turns into members which the player "installs" by blows.

This design makes:
- **One ground model**: surface = `base(x,z)` (procedural, pure of the seed) + `macro` (1 m lattice, 32 m tiles) + `fine` (0.1 m lattice, 3.2 m tiles). Macro and fine are the same data format and are edited by the same generic functions. One sim command API. The engine and the landscape view only draw.
- **Foundations as a process**: a `foundation` system with jobs, elements and steps, driven by hands-on gestures, with concrete that cures on the sim clock and blocks framing while green.
- **One soil**: the garden's beds, landscaping's boxes, shrubs and lawn share one soil layer and one set of tools on that same ground.

Design rules kept: generic mechanism in `src/sim/core/` and `src/engine/`, content in `src/sim/content/`; build.js is not reorganised; landscaping-owned files get at most small flagged edits; no new full-screen passes; nothing per frame when idle.

## 2. Refactor plan (A): one ground authority

### 2.1 What exists (facts the plan relies on)
- Engine macro: `world.edits` Map of `Float32Array(CS*CS)`, CS = 32, index `(gz - tz*CS)*CS + (gx - tx*CS)` (engine.js:255-267). Writers: `applyBrush` (engine.js:2564), `placeStartingWell` (engine.js:3093), build.js `cutTerrain` via `G.editSet` (build.js:4302-4307). Saved as base64 in `world.edits` (engine.js:3117, 3139).
- Fine: earthwork grid `{ step, T, codes, tiles: { 'tx,tz': { h, s, l, f, t } }, rev }`, tiles of 32 x 32 points with index `(j - tz*T)*T + (i - tx*T)`. Every function reads `g.step` and `g.T`; only `makeGrid()` hardcodes 0.1. So the same code runs unchanged on a grid with `step: 1, T: 32`, and a macro tile has exactly the layout of an engine edit tile.
- Fine relief is relative to engine `heightAt` (landscape-view.js:119 adds `G.heightAt + EW.hAt`), the player walks on `heightAt + reliefFn` (engine.js:3986), and the terrain shader discards where the dig mask is set (engine.js:1078-1102, landscape-view.js:241-258).
- The landscape view redraws when `grid().rev` changes (landscape-view.js:213-216), so any writer that bumps `g.rev` is drawn with no edit to that file.
- Save cost: each fine tile is 5 x 1024 JSON numbers (about 17 KB). `sim.serialize()` deep-clones the whole state (sim.js:115).

### 2.2 Target model
```
surfaceY(x,z) = base(x,z) + bilinear(macro, x, z) + bilinear(fine, x, z)
macro: earthwork-format grid, step 1 m, T 32   -> sys.ground.macro     (machine scale, pads, yards)
fine:  earthwork-format grid, step 0.1 m, T 32 -> sys.landscape.grid   (hand scale; moves to sys.ground.fine in A5)
```
The scale question is answered by routing, not by a third structure:
- Tool footprint radius < 0.75 m (shovel, trencher, bucket teeth, tamper, screed) edits **fine**.
- Radius >= 0.75 m or an area op (dozer blade, skid-steer bucket, box blade, pad grading) edits **macro**, then **absorbs** the fine tiles in its core: fine `h` inside the core is folded into the op's volume and zeroed; a fine tile left all-zero with one uniform surface code is deleted. A machine-graded 50 x 50 m yard therefore costs 3-4 macro tiles (about 100 bytes each packed), not 244 fine tiles.
- Edges stay sharp where they matter because a trench, footing or hole is always fine, riding on whatever macro is under it.
- Macro `s` (surface code per 1 m point) records "bare graded earth" versus untouched, so later the engine can colour and de-grass graded ground from sim truth instead of from `delta != 0` (engine.js:2101-2104 already tints by delta; keep that for now).

### 2.3 New generic code
`src/sim/core/ground.js` (no homestead words; imports only `./earthwork.js`):
```
makeGround()                         -> { v:1, macro: {step:1,T:32,codes:[''],tiles:{},rev:0}, rev:0 }
surfaceY(G, fine, base, x, z)        -> metres (base is a function (x,z)->m)
reliefTotal(G, fine, x, z)           -> macro + fine, metres
cut(G, fine, x, z, m3, o)            -> { m3, s, layer:'macro'|'fine' }   o: { r, maxDepth, bare, t }
fill(G, fine, x, z, m3, o)           -> m3 put                             o: { r, surface, layer, t }
push(G, fine, x0,z0,x1,z1, level, o) -> { m3, s }                          o: { w, t, levelIsWorldY, base }
gradePad(G, fine, base, samples, targetY, o) -> { cutM3, fillM3, tiles:[keys] }
        o: { core, rim, pit, absorb=true }  // same smoothstep rim maths as build.js cutTerrain:4290-4309, moved here
trimTo(G, fine, base, region, targetY, o)   -> { m3 }   // fine cut down to an absolute level inside a polygon
conform(G, fine, base, region, targetY, tolUp, tolDown, cellM=0.2) -> { frac, high:[[x,z,d]], low:[...] }
absorb(G, fine, region)              -> { m3Net, tilesDropped }
importTile(G, key, float32m)         // from engine deltas (migration and write-through)
tileMetres(G, key, out Float32Array) // for the engine mirror
```
`region` is `{ poly: [[x,z]...] }` or `{ path: [[x,z]...], w }`.

`src/sim/ground.js` (the system; still generic, takes content through its factory):
```
export function setGroundBase(fn)            // host hook; default () => 0. Engine passes baseHeight (pure of seed + rivers).
export const groundSystem = ({ fineOf = (ctx) => ctx.get('landscape').grid } = {}) => ({ name:'ground', every: 60, init, step, commands })
state sys.ground = { v:1, macro, rev, totals: { cutM3, fillM3 } }
commands (all return { ok, reason?, ... } and change nothing on failure):
  ground.cut   { x, z, r, m3, maxDepth?, bare? }        ground.fill  { x, z, r, m3, surface?, layer? }
  ground.push  { x0, z0, x1, z1, w, level | levelY }    ground.grade { samples, targetY, core, rim, pit, absorb? }
  ground.trim  { region, targetY }                      ground.tamp  { x, z, r, passes }   (sets TAMP flags, clears LOOSE_BIT)
  ground.importMacro { key, b64 }                       (bridge only)
events: 'ground.macro' { keys:[...] } after any macro change; fine changes only bump fine.rev
export const groundRead = { surfaceY(state,x,z), relief(state,x,z), conform(state, region, targetY, tolUp, tolDown), macroTile(state,key,out) }
```
Note on the convention "write only your own state": until A5 the ground system writes the fine grid that lives in `sys.landscape`. This is deliberate and temporary (it avoids editing landscape.js while that session is pushing); say so in a comment at `fineOf`. `step` only settles macro slopes left over-steep; it returns at once when nothing is flagged.

`src/sim/core/earthwork-codec.js` (generic):
```
packGrid(g)   -> { enc:'ew1', step, T, codes, rev, tiles: { key: base64 } }
unpackGrid(p) -> plain grid (arrays of numbers, exactly today's in-memory shape)
isGrid(v) / isPacked(v)
packReplacer(key, value)  // for JSON.stringify: any value with { step, T, codes, tiles } and no enc is packed
unpackReviver(key, value) // for JSON.parse: any value with enc === 'ew1' is unpacked
```
Tile bytes: `[1]` then five channels, each `varint byteLength` + payload. `h`: zigzag varint of the difference from the previous point in row order (smooth ground is 1 byte a point, flat ground compresses further with a zero-run escape). `s, l, f, t`: run-length pairs (zigzag varint value, varint run). All-zero tiles are dropped. Expected: hand-dug tile 0.8-1.5 KB, flat machine tile about 0.1 KB, versus 17 KB. In-memory shape does not change, so earthwork.js, landscape.js and landscape-view.js are untouched. Encoding 250 tiles is about 1.3 M integer steps, a few ms once per 20 s autosave; no cache needed (measure, then add a per-tile checksum cache only if it shows).

### 2.4 Save format v2 (src/sim/save.js)
- `SAVE_VERSION = 2`. `MIGRATIONS[1]`: build `save.sim.sys.ground = { v:1, macro: <grid from world.edits via base64ToF32, metres to integer mm>, rev:1, totals:{cutM3:0,fillM3:0} }`, then `delete save.world.edits`. A v1 save with no edits gets an empty macro grid.
- `readSave(raw)`: parse with `JSON.parse(raw, unpackReviver)` when `raw` is a string, so v1 (raw arrays) and v2 (packed) both load; migrations run on unpacked grids.
- New export `stringifySave(save)` = `JSON.stringify(save, packReplacer)`. Engine `saveGame` (engine.js:3125-3131) uses it and passes `sim.state` by reference instead of `sim.serialize()` for this path, removing the 4 MB deep clone. `saveData()` (used by tests and tools) keeps returning a plain clone.
- This also packs the wet-concrete grid (section 3) and any future earthwork-format grid with no further work.

### 2.5 Engine bridge (src/engine.js, small additive edits)
1. After rivers exist: `setGroundBase(baseHeight)`.
2. New function `syncMacro(keys)`: for each key copy `groundRead.macroTile` (mm to m) into `world.edits`, call `chunk.refresh()` for the chunk and its neighbours, set `depthState.dirty`. Subscribed with `sim.listen` to `'ground.macro'` and `'loaded'`. Refreshes are queued and flushed at most every 120 ms (a blade moving at 4 edits a second must not rebuild a chunk per edit).
3. Write-through for legacy writers: `setDelta` (engine.js:261) adds the tile key to `macroDirty`; `flushMacro()` (called next to `syncSite()` before `sim.advance` and in `saveData`) sends `ground.importMacro` for each dirty tile. `applyBrush` and `placeStartingWell` keep working unchanged and still end up in sim truth.
4. `applySave` (engine.js:3139): drop the `w.edits` loop; `world.edits` is rebuilt by `syncMacro` on `'loaded'`. `saveData` (engine.js:3117-3118): stop writing `edits`.
5. `window.__game` additions (engine.js:4503-4528 block): `ground: { read: groundRead, cmd: (name, p) => sim.commandNow('ground.' + name, p), surfaceAt: (x, z) => heightAt(x, z) + (reliefFn ? reliefFn(x, z) : 0), get rev() }`. `heightAt` keeps meaning "graded ground" (base + macro); `ground.surfaceAt` is the walked surface. Document both in ARCHITECTURE.md.
6. When a macro tile changes under existing fine tiles, the ground system bumps `fine.rev`, so landscape-view rebuilds those meshes (its `heightSig` at landscape-view.js:215 only watches `edits.size`). No edit to landscape-view.

### 2.6 Build mode site prep (src/build.js, minimal)
- `cutTerrain` (build.js:4277-4320): keep the signature; replace the two nested loops with `G.ground.cmd('grade', { samples, targetY: S.y0 - dropOf(S), core: CORE, rim: RIM, pit })` when `G.ground` exists, else the old body (kept for one release as fallback). The chunk refresh loop at 4312-4318 goes away on the new path (the mirror does it).
- First line of `cutTerrain`: `if (window.__foundation && window.__foundation.owns(S.id)) return;` so a structure whose foundation is being built by hand is never magically levelled (section 3).
- Nothing else in build.js changes for part A.

### 2.7 Order of changes (each step leaves `main` working)
1. A1: codec + save.js + the three engine save lines. No behaviour change; saves shrink.
2. A2: ground core + system, `src/sim/index.js` (one import, one export line, `groundSystem()` placed before `landscape` in `GAME_SYSTEMS`), engine bridge items 1-6, migration. Behaviour identical; macro truth now in the sim.
3. A3: `cutTerrain` routed; fine absorb under new pads.
4. A4: generic fixture test and the refresh throttle measurement.
5. A5 (only after the landscaping branch is merged): move the fine grid to `sys.ground.fine`. landscape.js `ensure()` (landscape.js:39-44) gains one line `s.grid = ctx.get('ground').fine` and the packer writes `sys.landscape.grid` as `{ ref: 'ground' }`; `MIGRATIONS[2]` moves the grid. landscape-view.js: no change (it reads `L().grid`). This is the only step in part A that edits a landscaping-owned file, and it is two lines.

## 3. Foundations (B): data model and interfaces

### 3.1 Principle: geometry from framing, process in a new system
`src/framing.js` `floorMembers` (framing.js:95-181) already emits the right things with real sizes and volumes: `site` pad, `footing` gravel-bed / pad / strip / edge, `pier` poured, `stemwall`, `slab`. `materialsList` (framing.js:725-726) already turns them into `concrete_mix` kg and `gravel` m3. Keep all of that as the design source. What changes is who builds them:
- `found` in `plinth | pier-blocks | skids`: unchanged (the starter shed stays ten minutes).
- `found` in `slab | piers | stemwall` (unlocked later, content/construction.js:266-271): the `site` and `foundation` stages are owned by the foundation system. construct-view stops offering those members and foundation-view takes over.

### 3.2 New files (generic versus content)
| File | Kind | Holds |
|---|---|---|
| `src/sim/core/cure.js` | generic | cementitious cure: equivalent age, strength fraction, set, frost and drying damage |
| `src/sim/core/batch.js` | generic | a batch process in a vessel: inputs, mixing time, quality window, discharge (the drum work function) |
| `src/sim/core/courses.js` (B10) | generic | units laid in courses along a path: bond pattern, per-course progress, joints |
| `src/sim/foundation.js` | system | jobs, elements, steps, commands; uses ground, cure, batch, earthwork |
| `src/sim/content/concrete.js` | content | mixes, bag yields, set and cure constants, gates, step specs per foundation type, form/rebar items, machine records, texts |
| `src/sim/content/masonry.js` (B10) | content | CMU and brick units, mortar, bond rules |
| `src/engine/fieldmesh.js` | generic page | earthwork-format grid to a mesh with a colour callback; also the conformance overlay |
| `src/engine/payout.js` | generic page | a line that pays out behind the character between fixed points (string now, wire spool for services later) |
| `src/foundation-view.js` | content page | the hands-on steps; registers as `window.__foundation` |
| `test/ground.test.mjs`, `test/cure.test.mjs`, `test/foundation.test.mjs` | tests | fast headless only |
Shared-file edits: `src/sim/index.js` (+imports, +systems), `build.sh` (add `engine/fieldmesh engine/payout foundation-view` to both lists), `template/head.html` (one small `#foundbar` block if needed; prefer reusing the hands bar), `src/sim/items.js` or content merge for new items.

### 3.3 Sim state
```
sys.foundation = { v:1, nextId, jobs: { [id]: job }, carry: { m3, mixT, slump } | null, machines: { [id]: machineState } }

job = { id, owner: { structId } | null,            // null: free-standing (deck piers, porch slab, wall footing, mixer pad)
  type: 'slab' | 'piers' | 'stemwall' | 'stemwall-cmu',
  x, z, yaw, topY,                                 // world; topY = finished concrete top
  step: 'layout' | 'excavate' | 'base' | 'forms' | 'rebar' | 'roughin' | 'pour' | 'finish' | 'cure' | 'strip' | 'done',
  layout: { corners: [[x, z, set]], closed, squareOk },
  roughIn: { needed: [ids], done: [ids] },         // filled by the services workstream (sleeves, drains, conduit under a slab)
  elements: [ element ], pour: { grid, firstWaterT, lastPlaceT } | null }

element = { id, kind: 'slab' | 'strip' | 'pad' | 'pier' | 'wall', memberIds: [...],     // framing member ids it stands for
  outline | path | at, w, botY, topY, volM3,
  dig:   { frac },                                 // from ground.conform against botY
  base:  { needM, frac, compact },                 // gravel thickness and tamp fraction, snapshot at pour
  forms: { needM, setM, staked, stripped },
  rebar: { need, set, tied }, bolts: { need, set },
  pour:  { m3, level, cold, vib },                 // level: fill height for walls and piers (they do not use the grid)
  finish:{ screed, float, trowel, joints, broom }, // each 0..1
  cure:  cureRecord | null }

cureRecord (core/cure.js) = { t0, setH, eqH, strength (0..1 of design), cap (1 minus damage), frost, dry, covered, wet }
```
The pour grid is an earthwork-format grid whose `h` is millimetres of wet concrete above the prepared base; form lines are marked with `WALL_BIT` on the points just outside the form; a finish code per point (`mud`, `screeded`, `floated`, `troweled`, `broomed`) lives in `s`. It exists only from first tip until the slab is finished, and is packed in saves by the same codec.

### 3.4 Commands (`foundation.*`)
```
setPlan    { structId, type, topY, elements:[...] }   // from the page, like construction.setPlan; keeps progress of matching element ids
addFree    { type, at | path, ... }                   // free-standing job (later slices)
stake      { jobId, corner }                          // layout
check      { jobId }                                  // re-evaluates dig/base fractions from the ground; advances step when met
setForm    { jobId, elementId, m }                    stakeForm { jobId, elementId, n }
layRebar   { jobId, elementId, n }                    tie { jobId, elementId, n }
mix        { vessel:'barrow' | machineId, bags, waterL }   -> batch state
take       { from: machineId | 'barrow', m3 }         tip { jobId, x, z, m3 }
rake       { jobId, x, z, r }                         screed { jobId, x0, z0, x1, z1 }
finishAt   { jobId, x, z, r, kind:'float' | 'trowel' | 'broom' }    joint { jobId, x0, z0, x1, z1 }
rod        { jobId, elementId }                       setBolt { jobId, elementId, n }
cover      { jobId, kind:'blanket' | 'plastic' | null }    mist { jobId }
strip      { jobId, elementId, m }
debugPour  { jobId }                                  // test/sandbox: jumps to cured-from-now
```
Each handler that completes an element calls `construction.markBuilt { structId, memberIds }`; each cure update calls `construction.setHold` (below). Materials come out of the construction stacks through `construction.draw { itemId, qty, x, z }`.

Small additive edits to `src/sim/construction.js` (three commands, about 20 lines, beside `construction.settle` at line 926):
- `construction.markBuilt { structId, memberIds }`: like `settle` but allowed for `kind === 'site'`, emits the same stage-done events.
- `construction.draw { itemId, qty, x, z }`: wraps the existing `drawSupply` (construction.js:389) so the ledger stays conserved.
- `construction.setHold { structId, stage, reason | null }`: stores `pr.hold[stage]`; `stageOpen` (construction.js:203) returns false while a hold is set and `blocked` (227) returns the hold's reason. Content adds `SUPPORT_SAYS`-style text "The concrete is still green".

`src/construct-view.js` edit (one filter): where `pl.inst` is built (construct-view.js:99), drop members whose stage is `site` or `foundation` when `window.__foundation && window.__foundation.owns(structId)`; the hint line then reads from `__foundation.hint(structId)`.

### 3.5 Concrete as a material (`core/cure.js`)
```
newCure(t, { setH20 = 2.5 })                         -> cureRecord
stepCure(c, dtH, lifeDtH, env)                       // env: { airC, windMs, rh, rainMmH, covered, wet }
strengthFrac(c)  = cap * te / (4 + 0.85 * te)        // te = eqH / 24 days; ACI 209 form: 21% at 1 d, 46% at 3 d, 70% at 7 d, 100% at 28 d
workability(c, t) -> 0..1                            // 1 fresh, 0 at initial set
```
- Equivalent age (Nurse-Saul, datum -10 C): `eqH += lifeDtH * max(0, (Tc + 10) / 30)`, `Tc` = air + hydration warmth (+5 C in the first day, +8 C more under a blanket). Cure runs on the seasonal clock (`ctx.lifeDt`), so with the default 20-day year "frame at 50%" is about 4.6 world hours (pour in the afternoon, frame in the morning), and with a 365-day year it is the real 3.5 days.
- Initial set runs on clock time (`ctx.dt`): 2.5 h at 20 C, x2 at 10 C, x0.5 at 30 C, times a content `WORKABLE_SCALE` (start at 2.5). Pausing the clock (the game already lets you walk and work while paused, and `commandNow` applies) removes all time pressure. Concrete placed against set concrete makes a visible cold joint and a small `cold` penalty, never a failure.
- Frost: while `Tc < 0` and strength x 25 MPa < 3.5 MPa, `frost` grows and `cap` falls toward 0.5 (ACI 306 rule of thumb). Drying: high evaporation (wind, heat, low humidity) in the first day without `covered` or `wet` grows `dry` (surface crazing drawn as fine cracks, cap -10% at most). Rain before set pits the surface (cosmetic) unless covered.
- Gates (content `CURE_GATES`): walk 0.10, strip forms 0.20, frame on it 0.50, backfill against a wall 0.70, drive on it 0.75.
- `src/sim/materials.js` is not changed; the registry's `concrete` (C25/30) is the design strength. `src/sim/structure.js` reads `ctx.get('foundation')` in slice B6: capacity x `strengthFrac`, and issues for unreinforced, uncompacted base, frost-damaged, loaded while green, each with the plain-language `reason` and `fix` the inspector already shows.
- Soil: `structure.site.soil` (structure.js:74-80, bearing classes) and the garden's `SOILS` (content/soils.js) become one site soil in slice G3 through a small map `BEARING_OF[texture]`.

### 3.6 The mixer as a generic machine
Record shape, written to match the vehicles core in ARCHITECTURE.md (body + drive + seats + attachment points + implements with a work function):
```
MACHINES.mixer_towable = { id, name, body: { kind: 'towable', dims: { w: 1.2, d: 1.9, h: 1.5 }, massKg: 320, wheels: 2, hitch: 'ball' },
  drive: null, seats: [], mounts: [{ id: 'drum', at: [0, 0.9, 0] }],
  implements: [{ id: 'drum', mount: 'drum', work: 'batch', params: { capM3: 0.10, mixWorldS: 240, powerW: 550, tipDeg: 110 } }],
  rental: { usdPerDay: 55 }, priceUsd: 2400 }
MACHINES.mixer_electric_small = { body: { kind: 'static', ... }, implements: [{ work: 'batch', params: { capM3: 0.05, powerW: 370 } }], priceUsd: 330 }
MACHINES.wheelbarrow = { body: { kind: 'pushed', ... }, implements: [{ id: 'tub', work: 'batch', params: { capM3: 0.05, byHand: true } }] }
```
`core/batch.js`: `newBatch(params)`, `add(b, input, qty)`, `stepBatch(b, dt, running)`, `quality(b)` (water-to-cement window: dry and crumbly, right, soupy), `discharge(b, m3)`. Nothing in it names concrete; mortar, plaster, feed or compost tea can use it. Until the vehicles core lands, machine instances live in `sys.foundation.machines` with `{ id, kind, x, z, yaw, until (rental end) , batch }`; when it lands they become vehicle entities and the foundation system reads their implement state. `powerW` asks `window.__game.powerAvailable()` / the electrical system; a petrol towable needs none.
Real numbers used: an 80 lb (36 kg) bag yields about 0.017 m3; the towable mixes six bags (0.10 m3); a 3 x 2.4 m shed slab at 10 cm is 0.72 m3, seven batches; above about 1 m3 the store suggests ready-mix.

### 3.7 Page interfaces
`window.__foundation = { owns(structId), hint(structId), job(structId), redraw(), tools }`.
`window.__game.foundation = foundationRead` (`gates(state, jobId)`, `cureOf`, `jobView`).
`window.__fieldmesh.create({ grid, baseY(i,j), colour(tile, n, i, j), step })` returns `{ mesh, refresh(rect), dispose }`; refresh is rect-limited and throttled to 70 ms like the landscape mesh. Only alive while a pour or overlay is active.
`window.__payout.create({ from, colour, sagM })`.
Build-mode extension point (to be added once, by whichever workstream lands first, at build.js:10862): `window.__build.extend = (name, hooks) => {...}`. This workstream needs only `hooks.sitePrep` (not required if 2.6 is done inline) and later `hooks.tool` for the free-standing footing tool.

## 4. Ground shared by landscaping and farming

### 4.1 What exists
- `src/sim/garden.js` keeps beds as rectangles of 30 cm cells (`core/cellfield.js`) on a global lattice (`x = (gx + 0.5) * CELL_M`, garden.js:670-672), each cell a soil-water bucket (`core/soilwater.js`) plus N, P, K, pH, weeds, straw mulch, a `till` progress and an `open` flag for drills and holes. It only reads the ground's shape (`reliefOf`, garden.js:158-200).
- `src/sim/landscape.js` has the real ground (dig, dump, rake, tamp, layers such as wood chips and bark, garden boxes as WALL-flagged cages filled with `bedmix`, landscape.js:376-387), nursery plants with a single moisture number `w` and `est` (landscape.js:709-713), and lawns as a timed surface code.
- `landscape-view.js` hides its mesh where a bed is tilled (`bedTilledAt`, used at line 121) and `garden-view.js` draws those squares; garden-view borrows `__landscape.tools.shovel` (garden-view.js:563, 826, 858, 911).
So there are two descriptions of tilled soil, two mulches, two moistures and two tool bars.

### 4.2 Target
Three layers with clear jobs, all on one ground:
1. **Shape and cover: the earthwork fine grid.** Tilled, hilled, mounded, drilled, mulched and boxed ground are surface codes, heights, layers and flags there. New surface codes (content): `tilth` (worked soil, loose), `straw` (a layer). Tilling a square = `paint` its 3 x 3 points `tilth` + `LOOSE_BIT` + lift 20 mm (fluffed); hilling = the existing `EW.move`; a seed drill = a 2 cm `cut` along a line with r 0.05; a planting hole = the shovel's bowl (landscape's `holeNear` already finds it). Tamping or walking packs it (`ground.tamp` clears LOOSE). The garden's `till`, `open` and `mulch` cell fields become derived reads of the ground.
2. **Soil: a `soil` system on 30 cm cells.** Extracted from the garden: the cellfield, the bucket step and the nutrient step move to `src/sim/soil.js` unchanged in maths. A soil cell exists wherever ground is cultivated or planted: a tilled square, the inside of a garden box, the root zone of a shrub (3 x 3 cells) or tree (5 x 5), and lawn through a second coarse field (1.2 m cells) so a big lawn stays cheap. Texture per group: the site's native soil, or `bed_mix` where the earthwork column holds at least 15 cm of `bedmix` fill. Mulch for evaporation = thickness of any mulch layer (`straw`, `woodchips`, `bark`) read from the fine grid, so chips round a shrub and straw on a bed are the same physics.
3. **Plants: the garden for crops, landscape for ornamentals, one response model.** Landscape plants stop keeping their own `w`: they read root-zone water from their soil cells (`stressOf`, `topFraction`), transpire through the same FAO-56 coefficient from their canopy size, and their yearly growth is scaled by `growth.thermalRate`, water stress and nitrogen status, with a few numbers per plant in content (`tBase, tOpt, tMax, kcb, rootM, nNeed`). Lawn is a perennial crop record (`turf`) on the coarse field; mowing later is an implement work function from the vehicles workstream acting on that record.
Beds and boxes are the same thing: a bed is a group of soil cells. Tilling native ground makes one; filling a garden box makes one (`group.box = thingId`, deeper root zone, the box's WALL cage already keeps the soil in, and raised relief already warms it earlier through `reliefOf`). Sowing, watering and harvesting act on any group.

### 4.3 Shared tools and gestures
New generic `src/engine/toolbelt.js`: `window.__tools = { add(id, tool), get(id), slotsFor(viewId) }`, where a tool is the object the hands already drive: `{ id, icon, item, press(aim), frame(aim, dt), release(aim), hint(), slot() }`. Shovel, rake, tamper, barrow and hose are registered by landscape-view; hoe, can, seed packet by garden-view; layout kit, screed, float by foundation-view. Each view lists the tool ids its hotbar shows, so the Yard (6), Garden (5) and a foundation site hold the same shovel object with the same feel. Merging keys 5 and 6 into one outdoor belt is then an owner choice, not a refactor.

### 4.4 Migration safety
- G1 and G2 change no saved shapes. In G2 `garden.js` `ensure()` runs a one-time pass (flag `s.ewSync = 1`, the pattern landscape.js:42 uses for `loose`): every tilled cell paints `tilth` on its points, and `mulch` L/m2 becomes a `straw` layer of the same millimetres. Old garden saves load and look the same.
- G3 adds `MIGRATIONS[n]`: move `sys.garden.field` to `sys.soil.field`, keep bed ids and cell indices (plants reference `bed` and `cell`, garden.js:28-29), move water totals. `garden.js` reads `ctx.get('soil')`. `test/garden.test.mjs` conservation tests must pass unchanged apart from the state path.
- G5 migrates landscape plants: `w` seeds the new cells' water once; the field `w` is kept as a cached read so landscape-view needs no change.
- Edits to landscaping-owned files, all small, each in its own commit, flagged in the slice: `content/landscape.js` (+2 surface records, +plant response numbers), `landscape-view.js` (+3 lines registering tools at the `window.__landscape` export near line 1508; later +1 colour for `tilth` and a moisture term in `pointColour`), `landscape.js` (plant water read, about 10 lines in `step` near 709-713; `cage()` emits `landscape.box` so soil can claim the box).

## 5. Player experience

Bar: every step is done in the body, aimed with the mouse inside arm's reach, readable from the working camera, several pieces per gesture (the existing `gesture` 1-4 setting applies everywhere), and each step ends with something that visibly changes. No step asks the player to fetch one item per press: materials are delivered beside the work, the barrow or mixer stands at the pour, and stacks are drawn from within reach (`drawSupply` already takes a position).

| Step | What the player does | What they see | Teaches |
|---|---|---|---|
| Layout | Hold the layout kit. Click each ghost corner: a stake goes in with two hammer blows. Walk to the next corner and the string pays out behind you. Closing the loop pulls the strings taut; batter boards pop in at the corners and the diagonals flash once | Bright string lines at finished height; a painted dig line on the ground | Buildings start from square string lines |
| Excavate | The same shovel as the Yard: press to bite, drag to throw or drop in the barrow. Inside the paint, ground still too high is tinted amber and a depth stick at the aim point shows how far to go. At 90% the flat shovel "trims to the line" with push strokes | Amber shrinking to nothing; a clean flat bottom; a real spoil heap that can be reused as fill | Dig to firm ground; topsoil comes off |
| Base | Gravel arrives as a heap. Barrow it in and tip, rake it level, then tamp: each tamp blow is a firm stamp with a dust ring and the gravel visibly drops and darkens. A rented plate compactor is walked across it instead | Loose pale gravel turning tight and dark, two passes | Why slabs sit on compacted gravel |
| Forms | Hold a form board, aim at a string: the ghost snaps along the whole run, click sets up to `gesture` boards. Stakes show as dots along the outside: hammer them (the nailing strike, large clear targets) | A crisp wooden frame; unstaked runs wobble | Forms hold the shape and the level |
| Rough-in | Any sleeve or drain the services plan needs glows in the base. "Run your pipes now: once the slab is poured you cannot" | | Order of trades |
| Rebar | Lay mesh sheets like subfloor sheets (they rise onto chairs by themselves with a tick); footing bars lay a whole run per gesture; a twist-flick ties the glowing laps at corners | A steel grid floating mid-depth | Steel takes the tension |
| Mix | At the barrow or mixer: slash a bag open on the lip (a pull stroke, a puff of dust), up to `gesture` bags at once; hold the hose and watch the mix turn from grey powder to crumbs to a rolling, glossy mud. Too dry looks crumbly, too wet looks soupy; the right band is wide | The drum turning, the mix changing texture | Water makes or ruins concrete |
| Pour | Tip the drum into the barrow (drag down), wheel it to the form, tip: a heavy grey heap that slumps and spreads to the forms. An unstaked form bulges and leaks (shovel it back, stake it) | Mud filling the frame, creeping to the edges | |
| Screed | Stand at one end, grab the screed board resting on both forms and drag it toward you with a slight saw: behind it the surface is dead flat and wet-bright, ahead of it a little wave of surplus rolls. Hollows show dull behind the board: flick a shovelful ahead and pass again | The big reveal, like the tree coming down | Forms set the level, the board transfers it |
| Finish | Wait for the bleed-water sheen to fade (visible), then sweep the float in arcs: matte turns to an even satin. Drag the groover along a straightedge every 2.5 m for joints. Outdoor slabs get one broom drag. Press anchor bolts into the wet edge at the marked dots | Sheen changes under the tool; crisp joint lines | Why slabs have joints; how wood is bolted down |
| Cure | Nothing to hold. The slab lightens from dark wet grey to pale over hours; a small chip on the job shows walk / strip / frame gates filling. Cold night forecast: roll a blanket over it (the fabric gesture). Hot wind: mist it with the hose | Colour and gate chip; frost or crazing if neglected | Concrete gains strength with time and warmth |
| Strip | Pull-stroke on a form board: it pops off and flies to a stack, `gesture` at a time, exposing the clean edge. Boards go back to stock | The finished slab standing alone | |
Piers: auger or dig the hole (fine cut), drop a tube form in (one thunk), bars, pour until the level rises to the top, rod it with a stick (bubbles rise, level drops, top up), set the post bracket. Stem wall: footing as above, panel pairs snap along the line, pour in lifts, rod, set anchor bolts, strip, backfill at 70%.

Where tedium is removed:
- **Hired hand** (services): takes any whole step for a fee and a time ("dig to the lines by morning", "set the forms"). The job API is `foundation.*` commands issued by the worker, the same ones the player issues.
- **Ready-mix truck** (services): order by the cubic metre for pours over about 1 m3. It backs up at the booked hour; the player only swings the chute (aim) and screeds. It waits an hour, then charges waiting time.
- **Mixer**: six bags a batch against the barrow's three; a rented compactor does both tamp passes in one walk.
- **Guided level** (existing per-building setting): each step is one action with the animation; **sandbox**: steps complete instantly. Cure still applies unless sandbox.

## 6. Phased slices

Each is about 30-60 minutes for an implementer agent and playtestable alone. "Owns" = new or solely edited files; "touches" = shared files with small additive edits.

### Ground
**A1. Earthwork codec and save v2 packing** (sonnet). Owns: `src/sim/core/earthwork-codec.js`, `test/ground-codec.test.mjs`. Touches: `src/sim/save.js` (SAVE_VERSION 2, pass-through `MIGRATIONS[1]`, reviver in `readSave`, `stringifySave`), `src/engine.js` `saveGame` (2 lines), `window.__game.saveSize()`. Test: round trip is exact for random grids; a v1 save loads. Playtest: dig a large area in the Yard, `__game.saveSize()` before and after, reload.
**A2. Ground core, system and engine mirror** (opus). Owns: `src/sim/core/ground.js`, `src/sim/ground.js`, `test/ground.test.mjs` (volume conserved by cut/fill/push at step 1 and 0.1; `gradePad` matches the old cutTerrain maths; non-homestead fixture). Touches: `src/sim/index.js` (+3 lines), `src/sim/save.js` (`MIGRATIONS[1]` now builds `sys.ground.macro`), `src/engine.js` (2.5 items 1-6), ARCHITECTURE.md (ground section). Playtest: old save loads with its levelled sites; the brush still works; `__game.ground.cmd('grade', ...)` from the console makes a pad that survives reload.
**A3. Build site prep through the ground** (opus). Touches: `src/build.js` `cutTerrain` only (2.6); run `node test/build.smoke.mjs`. Playtest: place a plan in Plan mode on a slope and over a hand-dug hole: the pad looks as before and the hole is gone.
**A4. Machine-scale fixture and refresh throttle** (sonnet). Owns: `test/ground-machine.test.mjs` (a 2.4 m blade pushing at 1 m resolution, a 0.3 m bucket at 0.1 m, through `ground.*` commands only), `bench/ground.bench.mjs`. Touches: `src/engine.js` `syncMacro` throttle constant. Deliverable for the vehicles workstream: the commands are proven sufficient for dig and grade work functions.
**A5. Fine grid ownership move** (opus; only after the landscaping branch merges). Touches: `src/sim/landscape.js` `ensure()` (+1 line), `src/sim/ground.js`, `src/sim/save.js` (`MIGRATIONS[2]`). Run `node test/landscape.smoke.mjs`.

### Foundations
**B1. Cure core, concrete content, foundation skeleton, hold gate** (sonnet). Owns: `src/sim/core/cure.js`, `src/sim/content/concrete.js`, `src/sim/foundation.js` (state, `setPlan`, `debugPour`, cure step, gates), `test/cure.test.mjs`, `test/foundation.test.mjs`. Touches: `src/sim/construction.js` (+`markBuilt`, `draw`, `setHold`, 2 lines in `stageOpen`/`blocked`), `src/sim/index.js`. Playtest: slab cabin in construction mode, console `debugPour`, framing refuses with "still green" then opens after the gate; speed up time to see it.
**B2. Layout strings and dig-to-line** (opus). Owns: `src/foundation-view.js` (job from `__build.membersOf`, layout kit tool, overlay), `src/engine/payout.js`, `src/engine/fieldmesh.js` (overlay part). Touches: `src/construct-view.js` (one filter, 3.4), `src/build.js` (the one-line early return in `cutTerrain`), `build.sh`. Playtest: string a slab plan, dig the pad with the real shovel until the amber is gone, trim.
**B3. Gravel base, compaction and forms** (sonnet). Owns: additions to `foundation-view.js`, `foundation.js` (`check`, `setForm`, `stakeForm`), content items (form boards, stakes, tube forms). Uses existing `landscape.deliver/load/tip/rake/tamp` commands as they are. Playtest: gravel in, raked, tamped twice; forms snapped and staked.
**B4. Pour field, barrow mixing and the screed** (opus). Owns: `src/sim/core/batch.js`, pour grid in `foundation.js` (`mix`, `take`, `tip`, `rake`, `screed`), `fieldmesh.js` mesh part with the wet look (vertex colour and a finish channel; no new pass), gestures in `foundation-view.js`. Playtest: mix in the barrow, tip, rake, screed a shed slab; an unstaked form leaks.
**B5. Finishing, cure visuals, covers, strip, anchor bolts** (sonnet). Owns: `finishAt`, `joint`, `setBolt`, `cover`, `mist`, `strip`; slab colour by cure; gate chip. Touches: `src/build.js` only if the slab member needs a colour hook (prefer drawing the cure tint as a thin overlay from foundation-view). Playtest: full slab from string to stripped, then frame on it.
**B6. Rebar and mesh, structure hooks** (sonnet). Owns: `layRebar`, `tie`, items. Touches: `src/sim/structure.js` (read `ctx.get('foundation')`: strength fraction, issues), `test/structure.test.mjs` (+cases).
**B7. The mixer machine** (opus). Owns: `MACHINES` records in `content/concrete.js`, machine state and `batch` wiring, the mixer model (procedural) and its gestures, rental through the store. Touches: supplier content (one rental line), vehicles core if landed (register the record) else `sys.foundation.machines`. Playtest: rent, tow or place, load six bags, hose, tip.
**B8. Piers and stem wall** (sonnet). Owns: `rod`, wall and pier pours by `level`, tube and panel forms, frost-depth warning text (content `FROST_DEPTH_M` by climate). Touches: none shared beyond content.
**B9. Ready-mix truck and hired hand** (sonnet; needs services). Owns: truck visit state and chute gesture. Touches: services delivery scheduling and worker job API.
**B10. Masonry courses core and CMU stem wall** (opus). Owns: `src/sim/core/courses.js`, `src/sim/content/masonry.js`, `test/courses.test.mjs`, laying gestures (butter, lay along a rising string line `gesture` units at a time, strike joints with one drag). Touches: `src/framing.js` `FOUNDATIONS` (+`stemwall-cmu` record and its members; small, flagged).
**B11. Brick** (sonnet). Content and looks on top of B10: brick units, bonds, a garden wall and a chimney base as first uses.

### Landscaping and farming
**G1. Toolbelt registry** (sonnet). Owns: `src/engine/toolbelt.js`. Touches: `src/garden-view.js` (use `__tools.get('shovel')`, register hoe and can), `src/landscape-view.js` (+3 lines registering its tools; flagged, landscaping-owned), `build.sh`. Playtest: shovel and can behave the same from both bars.
**G2. Tilling, hilling and drills as earthwork operations** (opus). Touches: `src/sim/garden.js` (`till`, `open`, `mulch`, `ensure` one-time sync; writes through `ground.*`), `src/sim/content/landscape.js` (+`tilth`, `straw` surface records; flagged). `test/garden.test.mjs` stays green. Playtest: till a bed, rake it, walk on it, hill a potato; old garden save loads.
**G3. Soil system extraction** (opus). Owns: `src/sim/soil.js`, `test/soil.test.mjs` (water and nitrogen conservation moved from the garden tests). Touches: `src/sim/garden.js` (reads `ctx.get('soil')`), `src/sim/save.js` (migration), `src/sim/index.js`, `src/sim/structure.js` + `content/soils.js` (`BEARING_OF`, one site soil).
**G4. Garden boxes are beds** (sonnet). Touches: `src/sim/soil.js` (claim cells inside a WALL cage with enough fill), `src/sim/landscape.js` (`cage()` emits `landscape.box`; flagged, 1 line), `src/garden-view.js` (sow and harvest in boxes). Playtest: set a cedar box, fill it with bed mix, sow lettuce in it.
**G5. Landscape plants and lawn on the soil layer** (sonnet). Touches: `src/sim/landscape.js` `step` (about 10 lines at 709-713; flagged), `src/sim/content/landscape.js` (response numbers per plant; flagged), `src/sim/soil.js` (coarse lawn field). Playtest: a shrub in mulched ground stays moist longer than one in bare soil; a dry spell yellows the lawn.
**G6. One ground renderer and wetness tint** (opus; after the landscaping branch merges). Touches: `src/landscape-view.js` (`tilth` colour, moisture term in `pointColour`, drop `bedTilledAt` skip; flagged), `src/garden-view.js` (stop drawing soil squares; plants and marks only).

Suggested order: A1, A2, B1 in parallel with G1; then A3, B2; then B3, B4, B5 (the first full slab); A4 for vehicles; G2, G3; then B6-B8, G4, G5; B9-B11, A5, G6 last.

## 7. Dependencies on other workstreams

**Vehicles.**
- Needs from it: the machine record schema (3.6 is written to its stated shape; adjust field names to match when it lands), a work-function registry where `work: 'batch'` can be registered from outside the core, towing of `body.kind: 'towable'`, rental start and end.
- Gives to it: the ground command API (2.3) as the only way implements move earth: `dig` = `ground.cut` + carried volume + `ground.fill`; `grade` = `ground.push` with `levelY`; `compact` = `ground.tamp`; `drill` = `ground.cut` with small r and large `maxDepth`. A4 proves these at machine scale with a fixture that has no homestead content.
- Suggestion: the wheelbarrow is the simplest vehicle (a pushed body with a tub). Today there are two barrows (`sys.construction.barrow`, `sys.landscape.barrow`) and this design would add a third load; one barrow entity owned by the vehicles core, with a tub implement that holds earth, gravel, lumber or wet concrete, removes all three.
- The controller/possession abstraction (audit finding 3) is not needed for the mixer (it is worked on foot) but is needed before a plate compactor or excavator is driven.

**Services (plumbing, electrical, deliveries, hired help).**
- Under-slab rough-in: the foundation job has a `roughin` step and `roughIn.needed/done`. Services registers what must be in the ground before a pour (`foundation.needRoughIn { jobId, ids }`, `foundation.roughInDone`) and owns the gestures for laying them; trenches for them are fine-grid cuts through `ground.cut` with a `path` region and `ground.conform` for depth and fall.
- Deliveries by appointment (ready-mix) and rental collection: needs a scheduled-visit mechanism; `core/supply.js` deliveries are close but have no "waits, then leaves" state.
- Hired hand: needs a worker that issues the same commands over time; this design guarantees every step is a command with a measurable fraction.
- `src/engine/payout.js` is generic so the wire spool ("walk the route and the cable pays out behind you", CONSTRUCTION.md) can use it.
- Power for an electric mixer: `window.__game.powerAvailable()` is still hardcoded false (audit finding 4); the petrol towable avoids blocking on it.

**Other sessions.** Landscaping: sections 2.7 and 4.4 list every edit to its files; all are late and small. Flooring: slab finish (`troweled` versus `broomed`) and cure state are what a flooring sim will want to read (`foundationRead.cureOf`); tile over green concrete is a natural later rule.

## 8. Risks

1. **Engine mirror drift.** Two copies of macro (sim truth, engine cache). Mitigation: one direction of truth, a debug `__game.ground.verify()` that diffs them, and the write-through queue for legacy writers. Remove `editSet` from `window.__game` once build.js no longer uses it.
2. **Chunk refresh cost.** `Chunk.refresh()` (engine.js:2086) rebuilds heights, colours and instance placement; machine edits could call it often. Throttle at 120 ms and measure in A4; if still heavy, split a heights-only refresh (engine work, opus).
3. **Base height purity.** `baseHeight` depends on `rivers.carve` (engine.js:203-206). `setGroundBase` must be called after rivers are built and the function must be pure of the seed, or replays and tests diverge. Headless tests use a fixture base.
4. **Writing another system's state until A5.** The ground system edits `sys.landscape.grid`. Contained by `fineOf` and documented; A5 removes it.
5. **Merge pressure.** construct-view.js, construction.js and build.js are touched by several sessions. Every edit here is a few lines at a named function; do them in their own small commits and re-grep before editing.
6. **Pour feel.** The whole foundation loop stands or falls on B4. Budget it for opus and expect one tuning pass after the owner plays it (slump angle, screed speed, how forgiving hollows are). Keep the tunables in `content/concrete.js` `FEEL_POUR`.
7. **Clock pressure.** World time runs 72 times real time at 1x; any set clock can feel frantic. Defaults are generous, pause removes it entirely, and nothing fails: late concrete only looks worse.
8. **Bag counts.** Real numbers (42 bags for a shed slab) are tedious by barrow. That is true to life and is the reason for the mixer and ready-mix, but check the first-slab time stays near ten minutes with `gesture` 3 and the towable mixer; if not, raise batch size before lowering realism elsewhere.
9. **Garden migration.** G3 moves live player data. Keep bed ids and cell indices byte-identical, ship the migration with a fixture save from current `main`, and keep `test/garden.test.mjs` conservation checks as the guard.
10. **Three soil notions.** Bearing class, garden texture and landscape fill must not disagree; G3's single site soil is the fix, and until then foundations read `structure.site.soil` only.
11. **Performance of fine meshes during a pour.** Pour grid for a 6 x 8 m slab is 4,800 points; refresh is rect-limited and only alive during the pour. No per-frame work once the slab is finished.
12. **Scope.** 22 slices. The first playable foundation (A1-A3, B1-B5) is eight slices; everything after is independently valuable and can be reordered.

### Critical Files for Implementation
- /home/claude/homesteadsimgame/src/sim/core/earthwork.js (the grid format and operations everything reuses, at both scales)
- /home/claude/homesteadsimgame/src/engine.js (terrain edits 229-274, dig mask 1078-1102, save 3115-3145, `window.__game` 4503-4528)
- /home/claude/homesteadsimgame/src/build.js (`cutTerrain` 4277-4320, `settle` 5142, `markBuilt` 9797, `window.__build` 10862)
- /home/claude/homesteadsimgame/src/sim/construction.js (stage gating 188-237, commands 885-947) with /home/claude/homesteadsimgame/src/framing.js (`floorMembers` 95-181, `materialsList` 725)
- /home/claude/homesteadsimgame/src/sim/save.js (version and migrations) and /home/claude/homesteadsimgame/src/sim/garden.js (beds, `till` 661-727, `reliefOf` 158-200) for the soil convergence