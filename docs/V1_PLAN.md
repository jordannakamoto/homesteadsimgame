# Homestead Simulator V1 — Orchestrator Run

You are the orchestrator for building V1 of Homestead Simulator in the repo `jordannakamoto/homesteadsimgame`. Run at maximum effort. This file has three parts: how to run (Part 1), the iterations (Part 2), and the vision (Part 3). Part 3 is the source of truth for what the game should be; Parts 1 and 2 are how to get there.

Your first action: save this file into the repo as `docs/V1_PLAN.md` and commit it, so every subagent can read it.

---

# Part 1 — How to run

## Your job

Work through the waves in Part 2 in order, A to H. For each wave:

1. **Prepare.** Before spawning anything, write or update the interface contracts the wave's iterations will code against (in `ARCHITECTURE.md`). Subagents working in parallel must never have to guess at a shared interface.
2. **Fan out.** Run the wave's iterations in parallel, each in its own git worktree and branch (`iter/NN-short-name`). Do the iterations marked `fable` yourself or with a Fable subagent; delegate the others to the tier listed. Never run two agents in the same working tree.
3. **Merge.** Merge every branch from the wave into `main` yourself. Resolve conflicts by understanding both sides, not by picking one.
4. **Verify.** Run the full headless test suite, load the game in a browser, and confirm the wave's playtest checks actually work. Fix what is broken before moving on. Check frame rate against the performance floor below.
5. **Fun check.** Play the wave's new content as a player, not a tester. Ask whether it feels good, whether it is clear what to do, and whether anything is tedious. Fix the worst offender before moving on, and note the rest in `docs/PLAYTEST.md`.
6. **Checkpoint.** Tag the commit `wave-X`, append a section to `docs/PLAYTEST.md` (what is new, how to try it, known gaps, anything deferred), and push.
7. **Continue.** Do not wait for approval between waves. Before starting each wave, read `docs/FEEDBACK.md` if it exists and address anything in it first.

Stop and report only if something blocks all further progress, or a decision would be irreversible and could reasonably go either way.

## Model tiers

Each iteration lists a tier:

- `fable` — you, or a Fable subagent at maximum effort. Architecture, solvers, cross-system integration, merges.
- `mid` — an Opus or Sonnet subagent. Self-contained models with known equations and a defined interface.
- `cheap` — a Sonnet or Haiku subagent. Data, recipes and UI on top of systems that already exist.

Inside any iteration, hand these to a `cheap` subagent regardless of the iteration's tier: data tables (material properties, crop parameters, breed traits, recipe times and temperatures), overlays and HUD readouts once the system exposes its numbers, headless test scenarios, and catalog or inspector text.

Cheap models sometimes invent plausible-looking values. At every merge, spot-check delegated data tables against real-world references and against the physical-relationship tests. If a subagent's work is not good enough, redo it at a higher tier instead of patching around it.

## Brief for every subagent

Give each subagent: the iteration's entry from Part 2, a pointer to `docs/V1_PLAN.md` Part 3 and `ARCHITECTURE.md`, the exact interfaces it must use and expose, the files it owns, and the standing rules below. Tell it to finish with a short report: what it built, how to try it, what it deferred.

## Standing rules

- **Physically grounded, not themed numbers.** Use real units and real relationships (energy conservation, heat transfer, load paths, growing degree days). Simplify resolution, never the relationship. See the quality bar in Part 3.
- **One world.** All systems read and write the same world state through the shared simulation. No system keeps a private copy of weather, materials or time.
- **Deterministic.** Fixed timestep, seeded randomness, no wall-clock or frame-rate dependence in simulation code. The same seed and inputs give the same world.
- **Tested.** Every iteration adds headless tests that check behavior against a known physical relationship or a representative scenario, not just that code runs.
- **Performance floor.** The game runs in the browser and must hold 144 fps on desktop. Simulation work is budgeted and amortized; it does not hitch the render loop.
- **Preserve what works.** Keep world rendering, lighting and mobile controls working. The build mode is the exception: its capabilities must survive, but its interface is being redesigned in iteration 2a and is not to be treated as finished. Do not regress the look of the world. Refactor architecture that blocks the simulation; do not rewrite things that are fine.
- **Leave the `combat` branch alone.** The game is peaceful. Do not delete, merge or modify that branch.
- **Fun comes first.** Read "Fun comes first" and "What people actually want to do" in Part 3. Each iteration should make at least one of those player wishes playable or better, and should ship with the feel (feedback, sound, motion, visible change) that makes it satisfying, not just the model.
- **No survival pressure, no shopping grind.** Consequences teach; they do not punish. Supplies are available; scarcity is not the loop.
- **Save/load always works.** Every new system serializes. A save from the previous wave either loads or migrates.

## When the run ends

After wave H, write `docs/V1_REPORT.md`: what was built, how the "V1 is done when" target in Part 3 is met, which of the player wishes in Part 3 are playable, known weaknesses in each model, and the recommended next steps.

---

# Part 2 — Iterations

## Wave A (run alone)

### 0. Audit and simulation spine — `fable`
Needs: nothing.
Build: Read the whole engine. Write `ARCHITECTURE.md` covering what exists, what stays, what gets refactored, and the module boundaries between rendering, construction, world state and simulation. Add a fixed-timestep, seeded simulation loop separate from rendering; versioned save/load of world state; time controls (pause, 1x, 10x, 100x); a headless harness that can run the simulation for simulated days without a browser. Define the interface by which a build piece exposes its material and geometry, since structure, thermal and salvage all depend on it.
Playtest: Speed up time and watch day and night pass. Save, reload, get the same world. Still 144 fps.

## Wave B

### 1. Calendar, sun and weather — `mid`
Needs: 0.
Build: Calendar and seasons; sun position from latitude, date and time; seeded weather producing temperature, humidity, wind, cloud, rain and snow with plausible daily and seasonal patterns; weather drives the existing lighting and sky; HUD readout.
Playtest: Skip through a year. Days shorten, it gets cold, storms arrive.

### 2. Materials, items and inventory — `cheap`, with `fable` reviewing the registry design
Needs: 0.
Build: One registry for materials and items with real properties (density, strength, stiffness, thermal conductivity, heat capacity, cost). Existing build pieces reference registry materials. Player inventory and carrying. A basic supplier catalog. Felled trees from the player's own land yield logs that are real building material. Hand tools that work anywhere and power tools that need electricity. A projects notebook: optional, ignorable project cards ("build a coop", "get through a night on your own power") that later iterations add to, giving direction without quests.
Playtest: Buy lumber, carry it, place it. An inspected wall reports the material it was built from.

### 2a. Build mode redesign — `fable`
Split by the orchestrator: the interface (clarity, precision, remodeling, touch, the full piece interface) lands in wave B; construction methods, assisted building and the plan, elevation and section views land in wave C on the same files.
Needs: 0. Owns the build tools and build UI; iteration 2 owns the registry. Both code against the piece interface from iteration 0.
Goal: a build mode that merges the clarity of The Sims 4 or a Nintendo game with the precision of CAD and architectural software. The current one is neither clear enough nor precise enough. Study it first, keep everything it can build, and redesign how the player gets there.
Reference workflows, named by the owner: Macromedia Flash and Rayon (rayon.design).
From Flash: a selection-first workflow where the arrow tool is home and drawing tools are modal; one property inspector in a fixed place that shows the settings of the tool in hand or the properties of whatever is selected, editable there; direct manipulation of ends, edges and corners by dragging; single-letter tool shortcuts; a visible snap magnet; and a library of reusable symbols with linked instances, where editing the master updates every copy and double-clicking enters a group with a breadcrumb back out.
From Rayon: a true 2D plan as a first-class drawing surface alongside 3D, with sections and elevations; a block library for furniture and fixtures; offset, fillet and chamfer; layers; and automatic quantities and schedule tables (areas, lengths, counts) computed from what is drawn, which here become the bill of materials.
From Enshrouded, whose placement style the owner likes: a piece held in hand with its ghost in the world, click to place and keep placing, a snap toggle with free placement and nudging, style and material swapped on the wheel without a menu trip, and a shape that can also cut. Its weaknesses are what to fix: one piece at a time is tedious, undo is shallow, and there is no replace mode.
Removing tedium is a requirement, not a nicety: drag to lay a run or fill an area with a live count, replace in place by placing over an existing piece, paint materials by dragging, a visible eyedropper, undo at least 100 deep with one drag as one step, one-click roof and one-drag room, group duplicate and move, and mirror and array.
First half (wave B): selection-first, the property inspector, direct manipulation, shortcuts, snap magnet, automatic quantities. Second half (wave C): the plan view with sections and elevations, symbols with linked instances, offset and fillet, layers, schedules.
Clarity: a new player understands what each tool does without reading anything. Large legible icons, a small number of top-level tools, immediate ghost previews, obvious valid and invalid states, one-step undo and redo, no deep nested menus. Decide the look and layout yourself and hold it to that standard.
Precision: snapping to grid, edges, midpoints, angles and existing pieces, with a way to turn snapping off; live dimensions while dragging; typed exact lengths and angles; alignment guides and construction lines; a measure tool; plan, elevation and section views alongside the 3D view.
Construction methods: stick framing, log, timber frame and A-frame, each as real pieces with real materials.
Remodeling: change an existing building as easily as starting a new one. Remove or replace pieces, open up a wall, add a window, re-roof, extend.
Shape: free rotation so round structures are possible; floors and ceilings at any height, not fixed storeys, so great halls, cellars, nooks and cliff-side builds work; arches, balconies, fences, stairs and roofs as first-class tools. Structure first; decoration can wait.
Assisted building: draw a wall, room or roof as one gesture and have the framing, sheathing and finish pieces generated as real pieces, with the option to place every piece by hand.
Touch: the same tools work with the mobile build menus.
Playtest: Build a small house with a pitched roof, a round room and a cellar in a few minutes without consulting anything, then set one wall to an exact typed length.

## Wave C

### 3. Structural loads — `fable`
Needs: 1, 2, 2a.
Build: A simplified structural solver over the build pieces: dead, live, snow and wind loads; load paths to the foundation; span and capacity checks from material properties; foundation suitability against soil. A structural overlay. Failures are shown and explained before anything collapses.
Playtest: Overspan a beam and see it flagged. Add a post and it clears.

### 4. Rooms and thermal model — `fable`
Needs: 1, 2.
Build: Detect enclosed volumes from the build pieces. Per-room heat balance: conduction through each assembly, infiltration, solar gain through glazing, thermal mass. A thermal overlay and indoor temperature readout.
Playtest: Stand inside on a cold night. Add insulation and the indoor temperature curve changes.

### 6. Electrical — `mid`
Needs: 1, 2.
Build: Solar panels driven by sun angle and cloud; batteries with capacity and efficiency; loads; wires and breakers with capacity limits; a generator. Works at small 12-volt cabin or van scale as well as whole-house scale. A battery and power monitor readable at a glance. An energy-flow overlay.
Playtest: Run lights and a heater from one panel. A cloudy week drains the battery.

### 7. Water — `mid`
Needs: 1, 2.
Build: Roof catchment from actual rainfall; tanks; pressure from gravity head and pumps; pipes, taps, a well, drainage. A cistern, a gravity-fed outdoor shower, hot water, greywater reuse to the garden and a composting toilet should all be buildable from these parts. A water-network overlay.
Playtest: A storm fills the tank. A tap uphill of the tank with no pump gives nothing.

### 13. Chickens — `mid`
Needs: 1, 2.
Build: Chickens as persistent individuals with inherited traits; hunger and thirst; foraging and flocking; roosting at dusk; laying tied to day length, age and nutrition. Chickens eat kitchen scraps and garden waste. A morning chore round (let out, feed, water, collect) that is quick and pleasant. Coop, feeder, waterer and nest box pieces, plus a movable chicken tractor that fertilizes and scratches up the ground it sits on.
Playtest: Build a coop and collect eggs. Laying drops in winter.

## Wave D

### 5. Heating, ventilation and moisture — `mid`
Needs: 4.
Build: Wood stove burning real firewood with output and efficiency; openable windows and vents affecting air exchange; indoor humidity; rain and snow on roofs, with leaks and damp where roofing is missing.
Playtest: Get through a winter night on a stack of wood, then run out.

### 5a. Interiors, furnishing and small-space design — `fable`
Needs: 2, 2a, 4.
Build: Interior design as a first-class activity, using the same clear-and-precise tools as build mode. Furniture, cabinetry, counters, shelving, beds, appliances and fixtures as real objects with dimensions, storage volume, weight and power or water connections. Built-ins and convertible pieces: a bed platform with storage under it, a fold-down table, a bench that is also a chest, overhead cabinets. Wall, floor and ceiling finishes and colors with fast, forgiving application and undo. Furniture must look crafted and appealing, not blocky.
A space-performance readout that says how well a room works: walkable clearances and pinch points, whether doors and drawers can open, storage capacity against what the household owns, reach and workflow in the kitchen, daylight, and whether each fixture is actually connected. Framed as helpful feedback, not a score to chase.
Prefabricated shells to fit out as homes: a van-sized shell, a tiny house on a trailer, and a shipping container. In each, the same systems (12-volt power, water tanks, insulation, ventilation) must all fit.
Before-and-after snapshots of any room.
Playtest: Fit a bed, kitchen, table, storage and a water tank into a van-sized shell and have it read as livable. Then furnish one room of the house and repaint it in a minute.

### 5b. Arrival, camp and the build journal — `mid`
Needs: 2, 2a, 4.
Build: The game can begin with the player arriving on bare land with a tent and basic tools. A camp: tent, tarp shelter, campfire, somewhere to cook and store things, all using the real thermal and weather models so a tent is cold and a dry roof matters. An optional project card to be dry and warm before the first snow, with no penalty for missing it beyond a cold camp. Simple solo rigging aids for heavy pieces (hoist and pulley, standing a framed wall) as satisfying moments, not obstacles.
A build journal that records every project automatically: dated snapshots from fixed viewpoints, materials used, money spent and simulated hours worked. It feeds the before-and-after views and the timelapse replay later.
Playtest: Arrive in autumn, camp, and get a small cabin closed in before the snow. Open the journal and see the build recorded.

### 8. Soil moisture and irrigation — `mid`
Needs: 1, 7.
Build: Per-plot soil water balance (rain, evaporation, plant uptake, drainage) by soil type. Drip and sprinkler irrigation drawing from the water network. A soil overlay.
Playtest: A bed dries out in July. Put it on a drip line.

### 14. Chicken lifecycle and welfare — `mid`
Needs: 4, 13.
Build: Brooding, incubation, hatching, growth to maturity, aging; health; heat and cold stress read from the coop's thermal state; a welfare readout.
Playtest: Hatch a clutch and watch chicks mature. A drafty coop shows in their health.

### 18. Used equipment, salvage and repair — `cheap`
Needs: 2, 3.
Build: Used listings with condition; deconstruction that returns the same component instances with their properties; wear and repair. A ruin on the property with good bones and a failed roof, as an alternative starting point to bare land. Keep the sound old walls, find what is rotten or leaking using the structural and moisture models, replace beams, re-roof, insulate, fix drainage, lay a floor, refinish. A few discoveries hidden in the old building, good and bad. Finishing each room is marked with a before-and-after reveal.
Playtest: Renovate the derelict cabin into somewhere you would want to stay. Tear down a shed and reinstall its window in the house with its properties intact.

## Wave E

### 9. Crops — `mid`
Needs: 1, 8.
Build: At least three crops growing on accumulated warmth, light and soil water, with frost damage, visible growth stages, planting, propagation and harvest. Harvests arrive as real gluts over a short window, not a steady trickle.
Playtest: Plant a bed and fast-forward a season. Plant too early and frost kills it.

### 19. Contractors — `fable`
Needs: 3, 6, 7.
Build: Hire a carpenter, electrician or plumber. Each generates a valid design for the request under the same rules the player is bound by, then installs real pieces and equipment over simulated time. The player can inspect and modify the result.
Playtest: Hire an electrician, then inspect the wiring they left.

### 20. Automation — `mid`
Needs: 6, 7, 13.
Build: Timers, thermostats, float valves, automatic waterers and feeders, an automatic coop door. Each is a real device with power or water needs.
Playtest: Leave for a simulated week and come back to a living homestead.

## Wave F

### 10. Soil nutrients and compost — `cheap`
Needs: 9.
Build: Soil nitrogen, phosphorus, potassium and pH affecting yield; depletion by crop; a compost pile that heats and matures with inputs, moisture and time. Close the loops: kitchen scraps, garden waste, animal bedding and manure all flow into compost and back to the beds, and the player can see the flow.
Playtest: The same bed planted twice yields less. Compost fixes it.

### 11. Greenhouse — `fable`
Needs: 4, 5, 6, 7, 9.
Build: A greenhouse as an ordinary building whose glazing gain, venting, heater and irrigation run through the existing thermal, power, water and crop systems. No greenhouse-specific shortcuts. Fix whatever cross-system seams this exposes.
Playtest: Grow in winter and see what it costs in power or fuel.

### 12. Hydroponics — `mid`
Needs: 6, 7, 9.
Build: Reservoir, pump circulation, nutrient concentration and pH that drift as plants feed, water temperature and oxygenation effects, dosing.
Playtest: Run a lettuce rack. Kill the pump or ignore the pH and it fails.

### 15. Goats — `mid`
Needs: 9, 13.
Build: Goats as individuals on the same animal framework; fencing; pasture that is eaten and regrows; breeding, kidding, milking; shelter needs.
Playtest: Overgraze a small paddock, then rotate it.

### 16. Kitchen and food processing — `cheap`
Needs: 5, 9.
Build: Milling grain to flour; baking with real oven heat and time; preserving (drying, canning) with spoilage affected by temperature and humidity. Storage quality reads the room's real conditions, so a root cellar dug into the ground works because the thermal model says it does. A pantry view of what is stored for winter and how long it will last the household. Handling a glut is the core activity: a big harvest day where the player chooses what to eat fresh, can, dry, cellar or feed to the animals.
Playtest: Go from your own wheat to a loaf.

## Wave G

### 17. Dairy and workshop — `cheap`
Needs: 15, 16.
Build: Butter and cheese with temperature and time; a woodworking bench turning logs into lumber and build parts with the same registry materials.
Playtest: Make cheese from goat milk. Build a shelf from a tree you felled.

### 21. Inspector, explanations and blueprints — `mid`
Needs: all prior systems.
Build: One inspector across structure, energy, water, thermal, soil, crops and animals that states the physical cause of each outcome and what would improve it. Save and place reusable blueprints. A self-sufficiency ledger showing what share of the household's food, power, water and heat came from the player's own land, and an end-of-season review of what thrived, what failed and why. Bring the structural, thermal, energy and water overlays into the redesigned build mode so a design can be checked while it is being drawn, and do a second clarity and precision pass on the build tools using what the earlier waves revealed.
Playtest: Click a failing crop and get the actual cause. Stamp down a saved coop.

## Wave H (run alone)

### 22. V1 integration — `fable`
Needs: everything.
Build: A scripted one-year homestead scenario as a headless test (house, utilities, garden or greenhouse, a few animals, basic goods). Balance, performance pass back to 144 fps, save/load hardening, cleanup of deferred items from `docs/PLAYTEST.md`. A timelapse replay of the player's own build from bare land, a one-year recap with the cost and materials breakdown from the build journal, and a walk-through tour and photo mode for the finished homestead. Garden and pantry tours alongside the whole-homestead tour. Two or three starting sites at different scales (a backyard lot, half an acre, a wooded acreage). A pass on ambient sound and pacing so the game can be played quietly. A final fun pass over the first hour of play, and a check that each of the four seasons feels different to play. Then write `docs/V1_REPORT.md`.
Playtest: Play a full year from empty land to working homestead. Then check that the game is also complete and satisfying played only as an off-grid cabin build, and only as a restoration.

---

# Part 3 — Vision

## What this game is

A peaceful, creative homesteading sandbox where the player turns a piece of bare land into a working home: a house, power, water, a garden, a few animals, food on the shelf. Underneath is a small believable physical world, so that what works in the game is roughly what works in real life, and the player comes away actually understanding why a root cellar stays cool or why the battery died in December.

Think of the creative freedom of Minecraft, the interlocking systems of RimWorld, and the warmth and daily satisfaction of Stardew Valley. No combat, no hunger meter chasing the player, no money grind.

## Fun comes first

Realism is in service of fun, never the other way round. The simulation is there because consequences that make sense are more satisfying than arbitrary ones. Every iteration should leave the game more enjoyable to play, not just more correct.

- **The pleasure is in making and tending.** Placing a beam, watching seedlings come up, collecting warm eggs, lighting the stove on a cold night. Make these moments feel good: responsive controls, satisfying sound and motion, visible change.
- **Pride in what you built.** People homestead mostly as a creative outlet and for the pride of having done it themselves. The game should constantly show the player their own handiwork functioning: the tank filling from their roof, the lights running off their panels, a pantry they stocked.
- **Cozy, not punishing.** Mistakes cost a harvest or a cold night, then teach something. Nothing spirals into a failure state. Animals in poor conditions show it clearly and early. The player can always recover.
- **Short loops inside long ones.** There is always something worth doing in the next two minutes (water, collect, fix, place) and something worth planning for next season (greenhouse, bigger battery bank, a goat barn).
- **Curiosity is rewarded.** "What if I built it into the hillside?" should have a real answer. Systems interacting in ways the player did not expect, but can understand afterwards, is the best thing this game can do.
- **Skip the tedium, keep the decisions.** Time controls, assisted building, contractors and automation exist so the player spends time on choices, not repetition.
- **Beautiful and calm.** Weather, light, seasons and growth are the scenery. A homestead at golden hour with smoke from the chimney should make someone want to take a screenshot.

## What people actually want to do

This is drawn from what draws the biggest audiences in homesteading, off-grid and van-life video, where people go to dream about and learn this life. V1 does not need bespoke features for each; most should fall out of the physics if the systems are honest. Use this list to choose examples, test scenarios, starter content and playtest checks.

- **Start from bare land and build a home.** The start-to-finish cabin build is the genre's signature story. Small cabins, timber frames, tiny houses, earth-sheltered and unconventional builds. Being able to replay your own build as a timelapse and walk a visitor's-eye tour of the finished place.
- **Get off the grid.** Size a solar array and battery bank and find out whether it lasts the winter. Small 12-volt systems for a cabin or van-sized dwelling as well as whole-house systems. Power monitoring the player can read at a glance.
- **Catch, store and move water.** Rainwater off the roof into a cistern, gravity-fed taps, a well, an outdoor shower with no pump, hot water, greywater reuse, a composting toilet.
- **Keep chickens.** By far the most common first animal. A cheap quick coop, a hoop coop, a movable chicken tractor that fertilizes ground as it goes, fresh eggs every morning.
- **Grow real food.** Raised beds, tomatoes, salad greens through winter under cover, perennials, burying kitchen scraps and seeing what happens, building soil year over year.
- **Put food by.** Daily bread, canning, drying, a root cellar that works because it is underground, keeping eggs for winter. A full pantry going into the cold season is the payoff for the whole year.
- **Work with the land.** Rotational grazing, permaculture, fruit and nut trees, compost, letting animals and plants do work for each other.
- **Stay warm simply.** A wood stove, a stack of firewood you cut, rocket stoves, thermal mass, a sauna.
- **Design a small space that has everything.** The heart of the van-build and tiny-house appeal is interior design as an optimization puzzle: every litre, watt and centimetre counted, a bed that hides storage, a table that folds away, a kitchen in a metre and a half, and a layout that somehow fits a whole life and still feels good to be in. Players should be able to design interiors at this level of care, at van, tiny-house and full-house scale, and be told how well the space actually works.
- **Turn a wreck into a home.** Take a run-down cabin or shed, clear it out, repair it, refinish it and furnish it. The before-and-after is the reward.
- **Make and mend.** Restoring an old tool, reusing salvaged windows, building furniture, fixing what breaks.

## Three ways in

Homesteading is one of three overlapping fantasies this game serves, and a player may care about only one of them. Each should be a complete, satisfying way to play.

- **The homesteader** wants a garden, animals, a pantry and a year lived by the seasons.
- **The off-grid dweller** wants a self-reliant home somewhere beautiful: power, water, heat and a clever small dwelling, with no farm required. A cabin with a wood stove, a few panels and a rain tank is a finished game for this player.
- **The builder and remodeler** wants the project itself: raising a cabin from bare ground, or taking a ruin and bringing it back. For this player the build is the game and everything else is a reason to build more.

## Builds, remodels and off-grid dwellings

Drawn from the cabin-build, restoration and alternative-dwelling channels, which are some of the most-watched in this whole space.

- **Arrive with a tent.** The classic story starts with someone camping on their land while they build, often racing to be dry and warm before the first snow. That gives a natural progression with no grind: camp, then a dry roof, then a warm cabin, then a home, then a homestead. The first snow is a goal to aim for, never a fail state.
- **From the first tree to the last floorboard.** Fell trees on your own land, turn them into logs and lumber, and build with them. Hand tools work anywhere; power tools need the power you have not built yet. Working alone means clever rigging: a hoist and pulley for a heavy log, cutting the window opening out of a wall before standing it up.
- **Many kinds of home.** Stick-frame cabins, log cabins, timber frames and A-frames; tiny houses on a trailer; shipping containers fitted out as homes; passive-solar earth-sheltered houses that work because of thermal mass and south-facing glass. Build tools and physics should make these possible without a special mode for each.
- **Bring a ruin back.** An old building with good bones and a failed roof. Keep the old walls, strip what is rotten, put in new beams, insulate, let light in with a skylight, fix the drainage, lay a floor, install a stove. Old buildings hold surprises, good and bad: hidden rot, a sound stone wall behind plaster, something left behind by whoever lived there.
- **Remodel what you have.** Open up a wall, add a window, re-roof, convert a shed into a guest cabin, add a porch. Changing an existing building should be as natural as building a new one.
- **Room-by-room reveals.** Restoration channels live on the before-and-after of a single room. Finishing a room should feel like an event.
- **The upgrades never end.** After the cabin comes the outhouse, the well, the solar array, the wood shed, the outdoor kitchen, the sauna, the greenhouse, and then, often, chickens. A restored cabin naturally grows into a homestead. There is always a next project and it is always optional.
- **The numbers behind the build.** Builders love the cost breakdown and the one-year recap. Keep an automatic record of every project: materials used, money spent, simulated hours worked, and snapshots along the way.
- **Slow is the point.** The most-loved restoration series are long, quiet and unhurried, with natural sound and almost no talk. People watch them to calm down. Never rush the player.

## The texture of homestead life

Beyond individual projects, the most-watched homesteading channels share a texture that the game should have.

- **A daily rhythm.** Mornings start with chores: let the birds out, move the tractor to fresh grass, feed, water, collect, check on things. A five-minute chore round that feels good and tells the player how the place is doing is the heartbeat of the game. It should be pleasant enough to do by hand and optional once automated.
- **A year with a shape.** Spring planting, summer tending, the autumn rush to bring in and put up the harvest, and a quiet winter living on what was stored. Preparing for winter is a whole genre on its own. Each season should feel different to play and ask something different of the player.
- **Gluts, not trickles.** Real harvests arrive all at once: ten bushels of corn, more milk than anyone can drink, forty kilos of tomatoes in a week. Deciding what to eat fresh, what to can, dry, cellar or feed to the animals is one of the most satisfying decisions in homesteading. Do not smooth it away.
- **Closed loops.** Kitchen scraps and imperfect produce feed the chickens and compost; bedding and manure become compost; compost feeds the garden; the garden feeds the kitchen. Players should be able to see these loops and feel clever for closing one.
- **How much of this did I make myself?** A recurring hook is the claim to produce most of a household's food on half an acre. Give the player an honest ledger: what share of their food, power, water and heat came from their own land this year.
- **Tours and time-lapses.** Garden tours, pantry tours, whole-homestead tours and one-year time-lapses are staple formats, because showing the place off is half the joy.
- **Honest setbacks.** The best-loved creators show the failures too, and call it a farming reality show. A crop that failed, a coop that flooded, a system that was undersized. Setbacks should be legible, a little funny in hindsight, and followed by an end-of-season look at what worked and what to do differently.
- **Any scale.** A city backyard, half an acre, or a wooded acreage with a cabin. The same systems should make sense at each.
- **Quiet craft.** The most-watched cabin builds have almost no talking, only the work and its sounds: saw, axe, hammer, rain on the roof, fire in the stove. Let the game be quiet. Sound and unhurried pacing carry as much as visuals.
- **Building for the long run.** Planting trees that will not bear for years, improving soil season over season, building something that outlasts the builder. Reward patience with things that only time can give.

## After V1

These are wanted, but not in V1. Do not build them now; do make sure the architecture leaves room for them: bees and honey, pigs, ducks, sheep, a milk cow, a livestock guardian dog, maple sugaring, fruit and nut orchards and food forests, freeze-drying and smoking, medicinal herbs, natural building methods such as stone masonry, cob and earthbag, yurts and other fabric structures, and a drivable vehicle-based home.

## Lessons from games people love

Borrow what makes the best building, renovation and cozy sims work, and avoid what their players complain about.

- **Transformation is the payoff.** House Flipper lives on turning a dingy space into a lovely one. Make before-and-after visible everywhere: bare land to homestead, shell to furnished room, weedy plot to garden. Keep snapshots so the player can compare.
- **Instant, visible feedback.** PowerWash Simulator works because every action shows its result immediately and directly. Each tool here should change something the player can see the moment they use it.
- **No pressure.** No timers, no fail states, no scolding. The satisfaction is a job well done at the player's own pace.
- **Tedium is what kills these games.** The most common complaint about renovation sims is repetitive painting and cleaning. Any action repeated more than a few times needs a faster tool, a bigger brush, or a way to hand it off. Never make the player pixel-hunt for the last bit; completion should be forgiving.
- **Always an undo.** Its absence is a noted frustration in this genre. Building, furnishing and finishing are freely undoable.
- **A few tools done very well.** Restraint beats a toolbox of thirty half-good tools. Add variety through what the player works on, not through more buttons.
- **Sandbox with a gentle hand on the shoulder.** Building from scratch was the feature House Flipper players asked for most, yet a blank sandbox with no direction overwhelms some people. Offer optional projects the player can pick up or ignore, never a mandatory quest line.
- **Expression above all.** People stay with cozy games because the result is theirs. Finishes, colors, furniture, layout and the shape of the land should all be the player's to choose, and the homestead should look unmistakably like the person who built it.

## Quality bar

- **Honest simulation.** Real units and real relationships. Never a number that only looks like physics.
- **Right level of detail.** Realism means preserving the important relationships between things, not maximum resolution. A heat-and-airflow balance for greenhouse ventilation, not fluid dynamics. Load paths and real material properties for beams, not finite elements. Nutrient concentration and uptake for hydroponics, not molecules. Prefer a simple grounded model that can be refined later.
- **Everything is connected.** Buildings, terrain, weather, equipment, plants and animals share one world. Changing one part of the property should meaningfully affect others.
- **Depth over breadth.** Two animals done properly beat ten done thinly. A few crops with real growth beat a seed catalog of reskins.
- **Explained.** The player can inspect any system and be told, in plain language, the physical reason for what is happening and what would improve it. Teaching happens through consequences and feedback, not mandatory tutorials.
- **Consistent objects.** A salvaged window is the same window, with the same properties, wherever it ends up. Contractor-built work is real work under the same rules as the player's.
- **Player's choice of focus.** Nobody is forced to master every discipline. Hire it out, automate it, or do it by hand.

## V1 is done when

A player can take bare land to a small working homestead across a full simulated year: build a house, live through real weather in it, run it on their own power and water, grow food in a garden or greenhouse, raise a few animals, and turn what they produce into basic goods. The systems are connected enough that the property behaves like one place. And someone who has never homesteaded would enjoy an evening with it and come away knowing something true.
