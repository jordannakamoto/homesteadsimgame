# Steam and co-op platform plan

Audit baseline: `main` at `f644069`. The build remains a self-contained HTML page, bundled by esbuild. This plan works alongside the first-shed milestone in [STATUS.md](STATUS.md) and the construction sequence in [CONSTRUCTION.md](CONSTRUCTION.md).

## Codebase audit

| Area | What main runs today | Constraint |
|---|---|---|
| Simulation | `src/sim/` owns the 60-world-second tick, seeded RNG, ten-minute weather updates, materials, inventory and a building-piece snapshot. Systems are registered in `sim/index.js`. Node and the page run the same systems. | The browser supplies clock advancement. Pausing or dropping frame backlog affects elapsed world time. The command API and state hash are useful for local verification, but commands lack actor identity, sequencing, network validation and a full authoritative replay contract. |
| Construction | `build.js` owns the editable model, stable piece IDs, previews, snapping, undo, geometry rebuilds, shelter, terrain leveling and collision. Grid walls have local edge checks; angled segments use segment contact, with a broad per-structure distance check. Walkable floors, roofs and stairs use custom height queries. | Construction physics presently means placement, geometry and player contact. Load paths, bearing, snow and wind demand, deflection and failure are documented Wave C work. Building edits produce a full material-mapped snapshot for the sim. Mesh creation and UI/input remain coupled to edits. |
| Other simulation | Weather, calendar, material properties and stock are implemented. Build shelter, logs, pickups, harvesting, terrain and movement still run in frame-driven browser code. The planned thermal, power, water, crop and livestock systems have no registered implementations on this baseline. | Frame time and some unseeded randomness influence gameplay outside the headless core. Wood and stone compatibility setters write stock directly. Moving this work behind commands matters before networking. |
| Terrain and foliage | 32 m chunks, nearest-first loads, padded height arrays, instanced trees, rocks, grass and flowers, plus near/far foliage policies. | Startup builds the full initial neighborhood synchronously. A travel frame can exceed the nominal 5 ms budget because it cannot interrupt a chunk constructor. Terrain edits refresh full mesh attributes and multiple instance buffers for affected chunks. |
| Rendering | High uses shadows, multisampled half-float composer buffers, bloom, and an atmospheric pass with reduced-resolution effects. Low renders directly at DPR 1, disables shadows and reduces visible grass. Construction creates derived meshes per structure, plus overlays and previews. | Render-pass bandwidth, foliage alpha overdraw, chunk construction/upload, and geometry rebuilds are candidates for profiling. A Low switch bypasses composer rendering but retains its buffers. The current CPU scheduler measurement cannot rank GPU costs. |
| Persistence and UI | A versioned world save carries sim state, terrain edits, removals, player/camera and build records. A second build key supports older saves. DOM UI and Three.js adapters access engine hooks via globals. | Editable buildings and their derived piece snapshot are both persisted. In-flight trees, logs and pickups are omitted. Legacy globals expose mutable state and make adapter boundaries implicit. |

## Implementation order

1. **Keep the single-player build as the reference.** Start with the current fixed-tick core and the existing Three.js renderer. This change synchronizes construction before ticks and saves, corrects immediate command state replacement, and extracts chunk residency scheduling without changing generation or draw quality.
2. **Move the first shed through authoritative commands.** Extract the existing build geometry data and validation incrementally, starting with place/remove on a small set of shed pieces. Use stable IDs, validated local intents and a monotonic host sequence. Make stock debit and construction commit one transaction. Treat piece lists, collision indices and meshes as derived data. Migrate legacy saves through a single reader and prove the old geometry and IDs round-trip. Keep undo as a local editor affordance until multiplayer has versioned, conflict-aware inverse operations.
3. **Model structure as a load graph.** Use static members and spatially indexed contacts to find load paths from roof and floor through walls, beams and posts into foundations. Cache topology by site revision, recompute affected connected components after edits, and reevaluate demand when wind or snow crosses a configured band. Validate against hand-calculated beams, supported and cantilevered members, and complete versus incomplete sheds. Start with advisory results so the current construction loop remains playable while the model is calibrated.
4. **Give the host a real-time clock independent of rendered frames.** Keep slow homestead systems on game-time cadences. Run movement and any dynamic physics on a separate fixed real-time step so calendar fast-forward cannot multiply contact solving. Use the same host API in-process for single-player and over a transport for co-op. Replicate chunk-scoped state revisions and periodic snapshots, interpolate remote actors on clients, and test loss, latency, reconnect, save/reload and simultaneous edits. Replicate game IDs and relevant dynamic state rather than raw WASM snapshots per network tick.
5. **Profile frame time before changing quality defaults.** On an integrated-GPU Windows test machine, record p50/p95/p99 CPU and GPU frame times, draw calls, triangles, memory over travel, and chunk-build/upload times. Use a fixed seed with stationary, traversal, and dense-build scenes, comparing Low and High at 1080p. Use 16.7 ms and 33.3 ms as 60/30 fps budgets. Isolate shadows, post-processing and grass before changing shaders. If streaming spikes dominate, split CPU-only chunk preparation from main-thread GPU upload. Keep batch bounds chunk-local, share geometry/materials and use measured dirty ranges for edits.
6. **Put React at the UI boundary.** Migrate one panel using read-only snapshots and command dispatch once the host contract exists. Keep Three.js rendering imperative and React updates outside per-frame transforms. Validate the same save and input flows in a small Steam desktop packaging trial before choosing a wrapper.

## Measurements

Node 24.22.1 on an AMD EPYC 9V74. Chunk scheduler medians from seven trials of 200,000 updates after warmup. Identical final chunk order was asserted in each trial. Generation, GPU uploads and rendering were excluded.

| Scheduler workload | Baseline | Current |
|---|---:|---:|
| Stationary, all chunks resident | 1.947 µs/frame | 0.009 µs/frame |
| Cross into another chunk every 60 updates | 2.200 µs/frame | 0.061 µs/frame |

Run `node bench/chunk-stream.mjs`. This removes roughly 2 µs of CPU work per frame in these scenarios. The next larger opportunities lie in chunk creation and rendering.

### Rendering workload probe

Seed 1337 at spawn, 640×360 Chromium with SwiftShader, all 37 initial chunks resident. These are last-frame Three.js counters with automatic reset disabled so all render passes are counted. They describe submitted work, including repeated draws across passes.

| Quality | Draw calls | Submitted triangles |
|---|---:|---:|
| Low | 62 | 358,552 |
| High | 161 | 695,457 |

To reproduce, load the seed at that viewport, pause with `__game.setSpeed(0)`, and run `__game.lockQuality()`. For each quality, warm the renderer, set `__game.renderer.info.autoReset = false`, reset its info, call `__game.render()` and read `__game.renderer.info.render` in the same browser task. This probe did not measure integrated-GPU frame time or attribute cost to individual passes.

### Rapier WASM spike

Rapier 3D compat 0.21.0, fixed 60 Hz, a flat floor and box-shaped logs, sleeping disabled. Three 600-step runs per size after warmup. Each size ended with byte-identical snapshots across the three runs on this host.

| Awake bodies | Step p50 | Step p95 | Snapshot |
|---|---:|---:|---:|
| 32 | 0.093 ms | 0.170 ms | 57,489 B |
| 128 | 0.344 ms | 0.473 ms | 222,441 B |
| 512 | 1.280 ms | 1.534 ms | 880,849 B |

```sh
npm install --prefix /tmp/homestead-rapier @dimforge/rapier3d-compat@0.21.0
node bench/rapier-dynamics.mjs /tmp/homestead-rapier/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs
```

Rapier is a candidate for loose logs, carried objects that are dropped, and vehicles. The spike measures solver cost on one CPU. The integration test should use terrain colliders, moving actors and sleeping bodies, and measure the cost of reading transforms, changing colliders after edits and initializing WASM. Rapier's [determinism guide](https://rapier.rs/docs/user_guides/javascript/determinism/) spells out input and insertion-order requirements. Cross-machine determinism was outside this spike. Keep placed construction on the load graph and use Rapier for the objects that need contacts and motion. Consider custom WASM only when a representative profile identifies a bounded JS kernel and a prototype wins including data transfer.

## Verification

`npm test` passes 46 tests and `npm run build` produces the single-page build. Coverage includes the new chunk-stream reset, budget and boundary cases and immediate state replacement. The build smoke test also checks that a paused save captures edited geometry without waiting for a frame.

The Chromium headless shell with SwiftShader passed the desktop and touch build smoke checks and the page smoke's gameplay assertions, including Low/High rendering, pause, fast-forward and save/reload. The test required a local launcher adaptation because stock Chromium could not create its process singleton socket in this environment. The standalone page screenshot timed out. The build smoke captured desktop and phone screenshots. No integrated-GPU frame-time result is available from this environment.
