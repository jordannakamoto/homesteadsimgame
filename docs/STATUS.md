# Run status

Where the game stands, as of 19 Nov 2026 (`main` 7d33931, save version 3). Update it when a wave lands. History, wave by wave, is in `docs/PLAYTEST.md`; the plan is `docs/V1_PLAN.md`; the design round is in `docs/design/` (with the save-version ledger).

The old standing orders (14 Nov) expired; the owner is playtesting and the coordinator lands branches one at a time. In wave 2 implementers push only their own branch.

## How to playtest and critique

- The live page holds the newest published build of `main`. Any commit can be rebuilt (`git checkout <commit> && npm install && sh build.sh`).
- `docs/PLAYTEST.md` has one section per change: what is new, what to try, what is weak.
- Write critiques in `docs/FEEDBACK.md`, or say them in chat.

## What is in the game now

- **Spine (held since 15 Nov):** the first shed from bare ground to dried in, by hand or guided. `test/shed.e2e.mjs` passes on `main` 5040672 (hands-on and guided); it is the gate before publishing.
- **Build mode, construction and finishing:** stick framing as real members, stages from site to trim-out (23 in `__framing.STAGES`: dry-in, gutters, rough-in, tape and mud, trim carpentry and paint were added since 15 Nov), drywall hung sheet by sheet or boards by course, taping, paint, casings and baseboard with real miters.
- **Weather you can see, heat, power, water, garden, chickens, kitchen, the Yard (shovel, paths, stone, pond), night sky and soft clouds.**
- **Wave 1 (17-18 Nov), the design round:**
  - Ground: one ground for every system that cuts and fills (`sys.ground`, macro 1 m + fine 10 cm), packed earthwork in saves (about ten times smaller), build sites prepared through it (A1-A3).
  - Foundations: lay out with strings, dig to the line, gravel base, forms, barrow concrete and screed, cure by temperature with covers, anchor bolts and stripping (B1-B5).
  - Services: cable and pipe planned in two clicks through the frame, rough-in by hand (drill, boxes, pull, clamp, crimp), Rough-in and Trim-out as stages, Power and Water overlays (S1-S8).
  - Vehicles: the ATV with a drive model, fuel, a possession stack for the seat, a trailer, hauling lumber to the build (V0-V8).
- **Wave 2 (18-19 Nov):** build extension point X1 (nothing on screen yet), one bag for what other systems keep on a building X2, key map and controls sheet on ? / F1 (K1), shared page test helper and `stepFrames` (T1), electrical trim-out by hand (outlets, switches, lights, breakers, tester), supply plumbing by hand (PEX manifold, pressure test, fixtures on stubs), poured piers and stem walls by hand with the post-hole digger (B-1), the UI redesign (game HUD, Cozy and Minimal skins, close third-person and first-person views), trim slice 2, cabin feedback. Tests run about 45 s (the sim ticks about five times faster).
- **This docs slice (D0):** ARCHITECTURE and the CLAUDE.md code map made true to the code; the Steam and co-op plan renamed `docs/PLATFORM.md`.

## Known gaps

- Three interaction grammars for one job (construct-view L/E, Site on key 7, Hands F); several barrows (construction, landscape, foundation) and a duplicate `wheelbarrow` item; the fine grid is still owned by landscape; legacy abstract wire and pipe links in build mode; nine hint and prompt implementations; five buy flows; about ten private rAF loops. Each has a slice in the coordinator's cohesion-wave2 plan (outside the repo) (problems 1 to 13).
- Not yet: drains and vents by hand, no grid service entrance for electrical, no machines beyond the ATV, no decks, porches, lofts, skylights, chimneys or greenhouse, no rebar or mixer, no masonry.
- Camp and journal, contractors, goats, dairy and the plan book beyond the shed and cabin are not started. The engine and game folder tidy-up is deferred.

## What is next (lanes in the coordinator's cohesion-wave2 plan, outside the repo)

- **Ground and machines:** G-1 = A5 (fine grid into `sys.ground.fine`, save v4); G-2 = one barrow as a vehicles unit kind; G-3 = the drive model on a non-homestead fixture (per-wheel loads, hitch sway, skid-steer tracks); then V6 and V9 touch and HUD, a skid steer, the excavator arm.
- **Services:** S-1 trim-out by hand (landed), S-2 supply fixtures and pressure test (landed), S-3 = S4 legacy links to routes (save v5) plus a grid service entrance, after G-1 and X1; then drains and vents.
- **Building elements:** B-1 piers and stem walls (landed), B-2 deck, B-3 porch, rails and stairs, then skylight, loft, flue chimney, greenhouse, masonry chimney, all through the extension point.
- **Cohesion:** K1b one notice module (hint, prompt, toast), K3 one Buy action, P1 `G.frameHooks` with per-hook cost, T1 follow-ups, V11 fold `reach.js` onto `hands.js`.

## Landing rules (set 14 Nov after the owner said: "the current workload is quite massive, make sure it lands well")

The scope roughly doubled after the first playtest. These rules put landing each piece well ahead of getting through the list.

0. **Two things the owner wants to playtest first: building (the first shed) and farming (the first garden).** They touch different files, so they are built side by side. See `docs/CONSTRUCTION.md` and `docs/FARMING.md`.
1. **One thing is the spine: the first shed.** Until a new player can go from bare land to a finished shed (plan, order, delivery, raise it stage by stage, dried in, insulated) and enjoy it, nothing else is added to the live page. Every other system is judged by whether it makes that path better.
2. **Nothing merges on its report alone.** Each iteration is merged only after the orchestrator has run the tests, played the feature in a browser, looked at screenshots, and read the code that touches shared files. Data tables from cheaper agents are spot-checked against references.
3. **Definition of done for an iteration:** headless tests against known physical relationships pass; the page loads clean on Low and High; the feature is reachable without reading docs; it is not tedious; old saves load; the frame budget is measured; `docs/PLAYTEST.md` says what to try and what is weak.
3a. **Engine and game stay separate.** Mechanisms (vehicles, carrying, assembly, networks, animals) are generic and take homestead content as data, so the engine can be reused for other games. See `ARCHITECTURE.md`, "Engine and game".
4. **Integrate before widening.** A wave is not finished until its systems are visibly connected in play (overlays, catalog, placement), not just merged. No new wave starts while the previous one is only headless.
5. **Fewer agents at once from wave D on.** At most three in parallel, and the construction loop is built by one Fable agent with nothing else touching build mode.
6. **An end-to-end test is the gate.** A browser test that builds the tutorial shed through real input, from ordering to the last stage, must pass before each publish.
7. **An independent review per wave.** A fresh agent that did not write the code plays the build and reports what is confusing, broken or dull. Its findings are fixed or written into the playtest notes.
8. **Cut line.** If time or usage runs short, things are dropped in this order, last first: rented machines, septic and groundworks, hydroponics, goats, contractors, dairy. The shed, the cabin, weather you can see, heat, power, water, a garden and chickens are the V1 that must land.

## Open questions for the owner

Things decided on the owner's behalf that are easy to reverse. Say so if any is wrong.

- A day at 1x takes 20 real minutes (it was 10).
- Log and timber-frame construction are in V1; stone masonry, cob, earthbag and yurts are deferred.
- The default climate is temperate at about 45 degrees north, so there are four real seasons with snow. Other climates exist as presets.
- Starting money is a placeholder until prices and the pace of play can be felt.
