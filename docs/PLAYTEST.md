# Playtest notes

One section per wave: what is new, how to try it, known gaps. Leave feedback in `docs/FEEDBACK.md`; it is read before each wave starts.

## Wave A — simulation spine (tag `wave-A`)

**What is new**

- World time is now run by a real simulation that ticks in fixed steps, separate from drawing. Nothing visible depends on frame rate.
- Time controls in the top bar: Pause, 1×, 10×, 100×, 1000×. Keys: `` ` `` pauses, `;` slower, `'` faster (outside build mode; the buttons work everywhere). Holding T still fast-forwards.
- A day counter next to the clock. At 1× a day takes 20 real minutes (it was 10).
- The world saves itself: terrain you dug or raised, trees you felled, your wood and stone, the day and time, and where you stood all come back on reload. It reopens the last world you played.

**Try this**

1. Press 1000× and watch a few days and nights go by, then Pause and walk around: time stands still but you can still move and build.
2. Dig a hole, fell a tree, note the day and time, reload the page. Everything should be as you left it.
3. Press New world, then reopen the old seed from the address bar (`#seed-1337`): the old world is still there.
4. Check frames per second against what you had before. The simulation costs a few thousandths of a millisecond per frame, so it should be unchanged.

**Known gaps**

- There is nothing for time to act on yet. Weather, seasons and materials arrive in wave B.
- Buildings are still saved separately by build mode (they do persist). They join the main save in the build mode redesign.
- Trees in mid-fall and loose logs are not saved.
- Frame rate could not be measured in the test sandbox (no GPU); only the simulation's own cost was.

**Deferred**

- A proper pause menu and manual save slots.

## Wave B — weather, materials and the new build mode

Everything below is live. Wave B is the first wave where the game looks and plays differently.

### Build mode (press B)

**What is new**

- It opens on **Select**, the home tool. Esc always comes back to it.
- **A clear palette.** Thirteen tools in groups, each with an icon, a name and a letter: Select V, Room R, Wall N, Floor F, Roof O, Door J, Window U, Stairs Z, Pillar P, Path L, Furnish C, Measure Y, Remove X. Number keys still work.
- **One strip for options and properties.** With a drawing tool it shows that tool's choices as swatches and chips (shape, wall and floor material, ceiling height, raise). With something selected it becomes that piece's inspector: style, material, typed Length and Ceiling.
- **Live dimensions.** Lengths and area show while you drag. Type a number during a drag for an exact size.
- **Snap magnet** on the bar (hold Ctrl to invert), with a marker showing what you snapped to, and alignment guides.
- **Remodeling.** Click a wall to select it and change its style or material in place. Drag a selected wall outward and the room stretches: floor, side walls and roof follow. Walls have end handles.
- **Less tedium.** Drag to lay a row of windows or pillars. Place over an existing piece to replace it. Paint and Pick are buttons on the bar. Undo is deep and one drag is one step. Drag over open ground to select a group; copy or delete it.
- **Quantities without asking.** A selection shows its wall length, floor area, and door and window counts.
- **Invalid placements** are hatched red and say why in plain words.
- **Measure tool.** Click two points for distance, height difference and angle.
- Tower moved into Room (Shape: Round). Copy is reached from Select.
- Works on a phone: the strip scrolls sideways and targets are at least 40 px.

**Try this**

1. Press B, R, and drag a room. Watch the dimensions. Type `4` mid-drag.
2. Press O and click inside the room to roof it.
3. Press V, click a wall, change its material in the strip, then type a new length.
4. Drag that wall outward and watch the room stretch. Undo once.
5. Press U and drag along a wall to lay a row of windows.
6. The plan's fun check: build a small house with a pitched roof and a round room in a few minutes without consulting anything.

**Known gaps**

- The bar is tall: about 190 px of a 720 px view. Shrinking it is first on the list for the second half.
- Corners drag along one axis per drag, not diagonally. No mirror, array or repeat-last yet.
- In one trial, an upper-storey room drawn after stamping a copy came out about 2 m too high. Not yet reproduced or fixed.
- Group move, the ceiling field, cellars and towers were not exercised end to end by the automated test.
- Not in yet (second half, wave C): log, timber-frame and A-frame construction, generated framing, the 2D plan view with sections and elevations, reusable symbols, offset and fillet, layers, schedules.

**Critique prompts**

- Is the palette clear at a glance? Too many tools, or about right?
- Does the options strip feel like Flash's property inspector, or is it in the way?
- Does placing feel like Enshrouded, or does it still feel like a menu-driven tool?
- What was the first tedious thing you hit?

### Weather and seasons

**What is new**

- A real calendar: a new world starts on 10 April. The top bar shows the date, temperature and a condition word. Click it, or press Y, for humidity, wind, cloud, rain rate, snow depth, sunrise, sunset and day length, and to switch climate.
- **The sun follows real geometry.** Days are long in June and short in December, and the sun sits lower in winter.
- **Weather is simulated, not scripted.** Fronts lasting a few days bring cloud, falling pressure, wind and rain together. Clear nights are colder than cloudy ones.
- **Rain and snow** fall on screen, slanted by the wind. Snow lies on the ground and grass in winter and melts in spring.
- Three climates: temperate (the default, about 45 degrees north, four seasons with snow), Mediterranean coast, and cold continental. Each is fitted to real monthly normals.

**Try this**

1. Press Y, then 1000x, and watch a year go by. Note the day length in June and December.
2. Wait for a storm at 100x and watch the readout: pressure falls, cloud builds, wind rises, then rain.
3. Switch climate in the panel and run another winter.

**Known gaps**

- Trees stay green all winter.
- Lying snow at noon is quite bright on High quality.
- Rain varies more from year to year than real rain does.
- Weather does not yet affect anything you build. That starts in wave C (heat, power, water).

**Critique prompts**

- Does the weather feel calm and beautiful, or noisy?
- Is winter too long, too short, too bright?

### Materials, money and inventory

**What is new**

- Three buttons under the stamina bar: Items (I), Supplier (U) and Projects (J).
- **Supplier.** Lumber, logs, sheets, insulation, roofing, glass, stone, fasteners and tools, each with price, unit and real properties. You start with $2,500. Delivery is instant.
- **Items.** Everything you own by category, with quantities and total mass.
- **Projects.** Optional cards to tick, dismiss or ignore.
- **Trees give real logs** by the trunk's actual volume, on top of the wood you already got.
- Underneath: 55 real materials that every later system reads, and every built piece now reports what it is made of.

**Try this**

1. Press U, buy 20 m of 2 x 4 and a hammer, then press I and check the mass.
2. Fell and chop a pine and look for pine logs in Items.
3. Reload: money, items, project ticks and buildings all come back.

**Known gaps**

- Buying does nothing for building yet; build mode still counts plain wood. Owning a tool gates nothing yet.
- Prices are estimates and starting money is a placeholder.
- Some material values are marked approximate (green logs, cob, thatch, straw bale and a few others).

**Critique prompts**

- Is each Supplier line readable, or is there too much small print?
- Is $2,500 too much or too little?

### Under the hood in wave B

- Buildings are now part of the main save.
- Whatever you build is mirrored into the simulation as pieces with real materials, even while time is paused. Structure and heat will read that in wave C.
- 44 headless tests and two browser tests pass.

## Wave C so far — chickens, the kitchen, a short year (live; more of wave C still to land)

### Chickens (press H, or the Chickens button)

**What is new**

- Buy hens of six real breeds and place a starter coop or a movable chicken tractor from the panel.
- Each bird is an individual with a name, a temperament and inherited plumage. The panel lists every bird with a plain sentence about how it is doing.
- **Morning chores in a few clicks:** open the door, fill the feeder, fresh water, collect eggs.
- **Laying follows day length.** Expect about 260 eggs a year per Rhode Island Red with a coop light and about 175 without, with almost none in midwinter.
- They leave the coop at dawn, forage, crowd the feeder when you fill it, and roost at dusk.
- Eggs go to your pantry and can be cooked in the kitchen.

**Try this**

1. Press H, place a starter coop, buy six hens, fill feed and water.
2. Run a few days at 100x and collect eggs each morning.
3. Leave the feeder empty for three days and read what the panel says about the birds.

**Known gaps**

- Tall meadow grass hides much of the birds. They need shorter ground around the coop.
- The coop and its fittings are placed from the panel and are free for now; they move into the store and build mode when fixture placement lands.
- A coop light needs electricity, and nothing can supply it yet, so the light does nothing in play for now.
- No chicks, illness or death yet (that is the lifecycle iteration).
- H no longer opens the controls help.

**Critique prompts**

- Do they read as chickens? Too chunky?
- Is the chore round pleasant or fiddly?

### The kitchen (press K) — built in another session

Close-up cooking with six recipes, a meals shelf and gentle hunger. See `docs/COOKING.md`. Hens' eggs use the kitchen's egg ingredient.

### A shorter year

- New worlds have a 20-day year, five days a season. Change it in the weather panel (Y): 12, 20, 40, 120 or 365 days.
- Days are unchanged. Seasons, plants and animals move faster in a shorter year; hens reach laying age about 15 times sooner in a 20-day year and still eat the same each day.
- Worlds saved before this keep the real year until you change it.

**Critique prompt:** is five days a season too fast to enjoy a season, or about right?

### Simulated but not yet playable

Water, electricity and room heat are merged and tested headlessly. They become playable when equipment can be placed and wired (the build mode agent's fixture tool) and the overlays are added.

## Wave C — Plan mode: real construction, the Schedule and equipment (iteration 2a, second half)

**What is new**

- **A lower bar.** About 120 px instead of 200, and the view is framed above it. The backquote key folds the options away.
- **Real foundations.** New buildings stand on pier blocks with beams and joists. Room and Floor offer the others (skids, poured piers, stem wall, slab, the old stone plinth), and a selected building can be changed.
- **Real framing.** Timber walls are plates, studs every 40 cm, headers over doors and windows; floors are joists and subfloor; roofs are rafters, deck, underlayment and roofing. Insulation and inside lining are choices.
- **Planned and built.** In construction mode (off for now; the construction iteration turns it on) a plan is a pale ghost, and each stage appears as it is built.
- **Schedule** (the List button): what to buy for each stage, in plain words, with cost.
- **Ready-made plans**: a tool shed and a small cabin (from code for now: `__build.placePlan('shed', x, z, 0)`).
- **Equip** (E): place equipment on the ground, a floor, a wall or a roof, and join ports with wires and pipes.
- Guides along the line of an angled wall; a room corner drags both ways; an upper storey starts over the building under the cursor.

**Try this**

1. Draw a room and look under its floor edge: piers, beams and joists. Select it and change "Stands on".
2. Press List and read the Schedule.
3. In the console: `__build.setConstructionMode(true); __build.placePlan('shed', __game.player.x, __game.player.z + 6, 0)`, then `__build.setStageBuilt(null, 'foundation', true)` and on through `__build.STAGES`.
4. Press E, put a solar panel on a roof and a battery indoors, and drag from one port dot to the other.

**Known gaps**

- Only timber and dark-wood walls are framed. Log, timber-frame and A-frame construction are not in; nor is the 2D plan view.
- A clad wall looks finished from indoors even when it is not lined. Housewrap is drawn across window openings until the wall is clad.
- Planned (ghost) walls still block the player.
- Group move, the ceiling field, cellars and towers were still not exercised end to end.
- No precast pier block, door, or roof underlayment in the item catalog yet; the Schedule says "not sold yet".
- Upper floors' joists overlap the top of the walls below by 8 cm.

## Power and water are playable (live)

**What is new**

- The Equip tool in Build (B, then E) now offers the real equipment: 71 items including solar panels, charge controllers, batteries, inverters, lights, a fridge, a generator, gutters, tanks, pumps, taps, a shower, water heaters and a well.
- Place them, then drag from a port on one to a port on another to run a wire or a pipe.
- **Home panel (P, or the Home button).** Power: what you are making and using now, battery charge, today's totals. Water: tank levels, taps running, what was caught and used today. Indoors: each room's temperature against outside. Problems are stated in plain words with a fix, for example "The wire from the charge controller to the battery is too thin for 30 A at 12 V. Use 8 AWG or shorten the run."

**Try this**

1. Build, Equip: place a 200 W 12 V panel, an MPPT charge controller, a 12 V lithium battery and an LED light. Wire panel to controller, controller to battery, battery to light.
2. Press P at midday. You should see about 150 W coming in and the light served. Run a cloudy day and a night and watch the battery.
3. Place an IBC tank up on a platform or a slope and a tap lower down. Pipe them. The tap runs by gravity; the panel shows its flow. Put the tap above the tank and it will not.
4. Draw a room with a roof and a door and read its temperature in the panel through a cold night.

**Known gaps**

- Equipment is free and appears instantly; it is not yet bought from the store.
- Equipment looks like simple stand-in shapes.
- There is no overlay in the world yet: flows and temperatures are only in the Home panel.
- A panel placed on a roof does not yet take the roof's pitch.
- The structural check is not in yet (in progress).

**Critique prompts**

- Is the Home panel enough to understand what your power and water are doing, or do you want to see it in the world?
- Is wiring by dragging between ports clear?

## F2: gardening with your hands (branch `iter/f2-garden-hands`)

**What changed**

- The nine-button palette and working the ground from above are gone. Key 5 puts you in gardening stance with a hotbar of things to hold (Hands, Hoe, Can, seed packets, Straw, Compost, Seed box); the mouse aims within arm's reach of the character.
- No Bed tool and no hold-to-dig: you till by pulling the hoe through the grass. Each stroke turns a strip; a second pass makes fine, furrowed soil. Worked ground that touches becomes one bed.
- The can is lifted by holding and poured by dragging down to tip it. It is filled at the pump, a tap or tank, or by dipping in a pond.
- Seed is dropped by clicking or by dragging along the row; root crops are pulled upward, leaves cut with a swipe, fruit clicked. The first of each crop is held up overhead.
- A name tag by the marker says what a plant is and the one thing it needs. F opens the full card, N the almanac. The first-salad cards are rewritten for the gestures.
- Old saves: existing beds and plants load as fully worked soil and look as before.

**Try this**

1. Press 5. With the hoe, press ahead of you and drag back; do three strips side by side, each twice. Time it: a small bed should be dug, sown and watered in under a minute.
2. Seed box, radish, then drag along a row. Can (3): hold, drag down, walk the row.
3. Empty the can and fill it at the pump by the well.
4. Run time forward, then pull a radish with Hands (1).

**Questions**

- Does the pull of the hoe feel like work in a good way, and is two strokes the right number?
- Is tipping by dragging down natural, or would you rather hold the right button?
- Is the overhead moment charming or in the way?

**Known gaps**

- The hoe is hard to see from the high camera when it points away from you; the character has no two-handed grip.
- The pump refill is the simplest working version (in `src/garden-view.js`: `fixtureNear`, `drawFrom`, `settleDraw` and the `fill` branch); the handle does not move.
- Produce goes straight to the stores after the overhead moment: there is no basket to carry.
- Peas, tomatoes and beans are picked a plant at a time, not fruit by fruit.

## F1 — farming, first playable (branch `iter/f1-farming`)

**What is new**

- A Garden tool on the tool bar (key 5) with a palette: Bed, Sow, Water, Hoe, Harvest, Inspect, Mulch, Compost, Almanac. Right-drag turns the view while gardening; the mouse stays free.
- Beds: drag on the grass to mark one out (snapped to 30 cm squares, live size and area), then hold on it to dig. The grass goes and a mounded bed of soil appears.
- Twelve crops grown on real warmth, light, water and soil: radish, lettuce, peas, potato, tomato (as transplants), bush bean, carrot, winter squash, kale, garlic, sweet corn, wheat. Seed cards say when to sow here, in plain words, and buy the packet if you have none.
- Soil darkens when wet and pales as it dries; plants wilt when thirsty, yellow when short of nitrogen, brown when frost-burnt, and lettuce bolts in heat.
- Inspect any plant or bed for what it is, a calendar strip from sowing to harvest (ahead or behind the seed packet), and the reason for its state. Details toggle for the numbers.
- Almanac (N): typical last and first frost for this climate, what to sow now and soon, what is ready, and tonight's frost risk with a "Cover the beds" button (row covers keep about 2 C of frost off).
- Harvests go to your stores (potatoes, carrots and tomatoes as the kitchen's own ingredients). The "Grow your first salad" project card and four short, skippable tips.

**Try this**

1. Press 5, draw a small bed, hold to dig it, sow radish on one half and lettuce on the other, water it until the soil is dark.
2. Run 100x or 1000x and watch the seedlings come up. Inspect a radish. Harvest when ready.
3. Plant tomatoes in early spring and watch the almanac's frost warnings; leave one bed uncovered.
4. Stop watering a bed in midsummer and see it pale and wilt; inspect a plant for the reason.

**Known gaps**

- Watering refills free from anywhere ("Refill"); the hose and drip lines are not wired to tanks and taps in the interface yet (the simulation can already draw from the water system).
- No pests, diseases or seed saving. Mulch and compost are in, rotation advice shows in the bed card; hilling and staking are not separate actions.
- In a short year (the 20-day default) the weather model is far cloudier than in a real year, so crops yield about half; this is the weather system's, reported for a fix.
- The supplier also lists the garden's produce for sale.

## First Water — water by hand (branch `iter/w1-first-water`)

**What is new**

- Every new plot starts with a yard: a dug well with a hand pump on its cover, a 200 L barrel on a stand with the pump already piped into its top, a tap on a post, a workbench, and a starter kit box on the bench. You also start with a watering can. Start a new world to see it (old worlds keep their old well).
- **Hands** (press **F**, or the Hands button). The mouse is freed and aims at things within arm's reach. One line above the tool bar always says what the thing under the pointer does. Right-drag turns the view, the wheel zooms, F or Esc puts the hands away.
- **Pump:** hold the left button on the handle. Just holding keeps stroking; moving the mouse down and up strokes it yourself. Three dry strokes prime it, then every stroke is a real litre from the well. The can stands under the spout and fills.
- **Red lever on the pump:** click it. It points where the water goes: the spout, or up the riser into the barrel. The white sight tube on the barrel shows the level.
- **Kit:** click the box. Parts tumble out: four 1.5 m pipes, four elbows, a tee, a valve, two couplings, a cap.
- **Parts:** click one to pick it up. Carry it near a glowing end: a ghost shows it already turned to fit. **R** steps through the other ways it can sit. Click to fit. Click the ground to set it down, right-click to toss it. Hold and drag on a fitted part to pull it off. Drag the free end of a fitted pipe back toward its joint to cut it shorter; the offcut is a real pipe in your hands. A pipe too long for a gap is offered already cut to fit.
- **Valve:** click it (handle along the pipe is open, across is shut; it comes shut). **Tap:** click the red handle.
- The water simulation decides everything: no path, valve shut, barrel empty, tap above the water level each give that reason in words. An open end leaks, sprays, and drains the barrel until you shut the valve or fit the next part.

**Try this**

1. F, hold the pump handle until the can is full.
2. Click the red lever, pump twenty strokes, watch the sight tube.
3. Open the kit. Run: valve on the brass outlet at the foot of the barrel, a short pipe, elbow down, pipe to the ground, elbow, along the ground and around the well (two legs, one more elbow), elbow up, short pipe into the tap. The kit has half a metre of pipe to spare.
4. Open the tap before the valve and read the hint. Open the valve. Pull a pipe off while it runs.
5. Reload: the run, the barrel level and the can are as you left them.

**Known gaps**

- No sound yet. No delivery: the kit is simply on the bench (`__waterHands.spawnKit()` in the console gives another).
- The tap and leaks run on world time (a minute of flow every 0.8 s at 1×), so the barrel empties fast; a pump stroke is one litre.
- No touch controls for Hands. The garden's Water tool still refills the can for free.

## Wave D1 — Construction: the first shed, raised by hand (iteration 2c)

**What is new**

- **Build panel (L, or the Build button on the left).** The plan book offers the tool shed (the small cabin opens when the shed is finished). Choose it, and a ghost of the whole plan follows the pointer: the wheel or Q / E turns it, a click sets it down, red means the ground will not do.
- **Stages in order**, each with what it is, why it exists, its materials in plain words with cost, its state, and one next action. A note on the left of the screen always says what to do next, and an arrow in the world points at it.
- **Order one stage or everything.** A delivery takes about an hour of game time (under a minute; "Instant deliveries" is an option) and lands as stacks beside the building: lumber, sheets, pier blocks, rolls, bundles, boxes, the door leaning on a trestle.
- **By hand, at arm's reach.** A ring on the ground shows where your hands are (the pointer, held within about 2 m of you). Point at a stack and click (or E) for an armful by weight: eight studs on the shoulder, one sheet overhead, one pier block. The first time, a line says what the piece is.
- **Set, then nail.** With the right material, the open places within reach glow. Point at one and click: the piece swings into place and sits loose. Click it again to strike: two blows seat a stud, three a sheet, two stamps level a pier block. Holding the button keeps a steady rhythm: set, strike, strike, next. A wrong material says what the place needs.
- **Walls are framed flat on the deck and tilted up**: hold the button and push the mouse up (or just hold): it comes up heavy and lands with a thud, and gets a brace until the sheathing is on.
- **Moments:** the deck, each wall up, framed, the first rafter, dried in, the door, finished.
- **How hands-on** is a choice per building, any time: Guided (one press a stage) or Hands-on. "Work until done" keeps a stage going while you watch.
- **The first project card, "Build your first shed"**, is ticked when it is finished; the cabin plan and drawing your own plans open.
- **Sandbox** (in the Build panel, and a button in Plan mode) gives back instant building. Saves with buildings load as they were.
- The tool bar's B is now labelled Plan. Start money is $4,000 (the shed's materials are about $2,850).

**Try this**

1. Press L, choose the tool shed, set it down on open ground near you.
2. Order everything. While it is on its way, stand on the plan and hold the mouse button (or E) to dig it level the ground.
3. Follow the note on the left: pier blocks, beams, joists, the deck, four walls up, plates, rafters, the roof.
4. Save or reload at any point: stacks, the load in your arms and a half-framed wall come back as they were.
5. Switch a later stage to Guided, or tick "Work until done".

**Measured** (the end-to-end test, a player who never hesitates): hands-on to a roof in about 4 to 5 minutes of play, the whole shed in about 7; Guided about 2. A person reading the notes should take about twice that.

**Known gaps**

- Building by hand works with the ordinary tools out (axe and so on); it stands down while the Garden or Hands tool is out. It should move into the Hands tool.
- The end-to-end test builds the foundation, floor and four walls by hand and uses "Work until done" from the top plates on; the roof by hand has only been tried informally.
- With all four walls up, the way in and out is the door opening.

- Sound is switched off by default (the Sound box in the Build panel turns it on); it has not been tuned.
- Aiming and the reach ring are construction's own (`createReach` in `src/engine/carry.js`), not yet `window.__hands`; the two should be merged.
- Wrap, door, insulation and lining use the same set-and-nail motion; they have no special gesture yet.
- No delivery truck: the stacks drop in with a bump.
- Stacks sit level on sloping ground and can land on things already there; they are not solid.
- "Work until done" fetches from the stacks without walking: the character stays put and the armful appears.
- A piece too heavy for one load (siding, roofing) goes in over several trips and only appears when the last load arrives.
- The cabin has not been played through; drawn plans become buildings in progress but walls that are not stick-framed are not handled.
- The nail gun and the wheelbarrow are in the content but not yet in the store.
- After the roof is on, the view from above hides the walls being sheathed.

## Construction fixes: blueprints, ladders, never trapped, stock lumber, the saw, scaffolding (branch `construction-fixes`)

**What the owner reported, and what changed**

- **"Walls aren't blueprints, they're like yellow."** The shell of an unstarted plan was the finished building's own colours (tan timber) at 30 % opacity, and the pieces within reach glowed amber. Now a plan is a blueprint: cyan-blue fill, a grid line every 0.4 m across (the stud spacing) and 0.6 m up, and a bright rim. Planned members are a stronger blue; the pieces within reach glow pale cyan.
- **"Sometimes we don't get ladders."** The ladder was a line of the Site stage and only existed for plans with a roof. Ordering a stage at a time after digging the site (the site needs no material) never bought it, and a walls-only plan never had one. Now any order for walls, top plates or roof brings the ladder if it has not come, and a building with work up high and no ladder anywhere (leaned, carried, stacked or on its way) gets one at its stacks.
- **"Stuck inside if there is no door."** Bare stud framing (frame up, no sheathing yet) is no wall to the player: you step through between the studs, as framers do. In a room with no doorway at all, pushing into a wall for about two-thirds of a second climbs you out over it. A room with a door is never climbed out of.
- **Scaffolding.** "Rent scaffolding, $35 a day" in the Build panel once a building has work up high. The bundle lands by the stacks: point at it and press E to take it, point at a raised wall and press again to set a bay up along it. Walk into the ladder at its end to climb (no key), walk the plank, walk back off the ladder end to come down. From the plank the top plates, rafter tails and roof edge are in reach. Point at its foot from a step away to take it down. Collected when the days run out ("One more day" and "Send it back" in the panel).
- **The saw** (owner: "I asked for a saw for cuts"). It had never been built. Now every piece of lumber is sawn to length as it goes in: the stick is laid across the sawhorses, the saw strokes through with sawdust, the offcut drops (kept ones pile up beside the horses, short ends are scrap) and the piece arcs to its place before it swings in. The sawhorses are set up at the edge of the work when the lumber arrives; within 4.5 m of them cuts are quick, anywhere else you kneel and cut on the deck, slower. Point at them and press E to carry them somewhere else. A circular saw with power cuts in one pass.
- **Stock lengths** (owner: "we need longer studs for long sections instead of auto-expanding them"). Lumber is bought as whole sticks of 8, 10, 12, 14, 16, 18 or 20 ft. A run longer than 16 ft is two pieces butted over a stud (plates), a joist (rim joists), a pier (beams) or between rafters (ridge); the cap plate's joints fall 1.2 m from the top plate's so they lap. Each line keeps a cut list: each piece from the shortest offcut that holds it, else a new stick; cripples and short pieces come out of offcuts. The Build panel shows lumber as sticks ("26 x 10 ft"). Studs for these 2.84 m walls are 2.61 m, sawn from 10 ft sticks.

**Framing technique added**

- **Layout marks.** Once a wall's plates are down on the deck, every stud, king and jack position is marked on their up-facing edge: a pencil line each side and a cross. The studs go in on the marks.
- Already in and kept: walls framed flat on the deck and tilted up, a temporary diagonal brace on each raised wall until the sheathing is on.

**Try this**

1. Place the tool shed: the plan is a blue blueprint, not tan.
2. Order the foundation only, then each stage as it comes: the ladder still turns up for the top plates.
3. Frame a wall: plates first, then watch the layout marks appear and each stud get sawn at the horses and arc onto its mark.
4. With four bare walls up, walk out through one. Draw a doorless room in Plan mode, build it, stand inside and push into a wall.
5. Rent scaffolding, set it along a wall, walk into its ladder, and put the top plates on from the plank.

**Known gaps**

- The Supplier (U) still sells lumber by the metre; the Build panel's order is in sticks.
- The cut always happens near you: at the horses when they are close, else on the deck. The character does not walk to the horses.
- Scaffold bays are one bay long (2.6 m); a long wall takes moving it. The frames are not solid to walk into.
- A save from before this branch keeps any lumber line it had started by the metre; new lines are bought in sticks.
- `test/shed.e2e.mjs` was already failing on `main` before this branch (the wheelbarrow's prompt takes the pointer near the stacks); `test/construction-tools.smoke.mjs` covers the new tools in the page.

## Digging and landscaping (Yard, key 6)

The ground is a physical thing now: a smooth surface you shape 10 cm at a time, not a grid, with a layer of rolling grains on top of it (after Zhu and Bridson's two-layer sand model). Undisturbed earth is firm: a hole keeps its steep sides. What you throw leaves the blade as a shower of clods that bounce, tumble and roll down the slope with the friction of the material, and goes into the ground grain by grain where each one stops, so a heap's shape comes from the physics, not a formula. Dig into the foot of a heap and it slides in: the over-steep face sheds grains that roll down until it stands. A bag ripped open slumps out beside itself. How hard the ground is decides the stroke: loose earth or chips take the blade at a push, firm ground wants a stamp, turf a hard stamp and a jolt. Fresh earth is dark and rich in two or three tones, lumpy, with clods half sunk in it and grass still showing where it thins out; a heap dries paler on top; holes are damp and dark with lighter subsoil in the walls.

**The tools and how they move**

- **Shovel.** The mouse is your hand on the shovel. Press where the blade should go in: it is stamped in (a stop and crumbs; quick in loose earth, a hard stamp in turf) and takes about half a blade. Hold still and it goes on sinking, deeper and fuller (faster in loose earth, slowly through turf and clay), with earth crumbling in from the rim. Drag and it levers up and comes with you: a ring shows where it will land, dots show the arc if it will be thrown, and you walk after your hand past arm's reach. Let go and it drops there; a plain click drops it beside the hole. Press a bag to rip it open. No screen shake.
- **The flat of the blade (right-drag).** Drag it along the ground: loose earth in its way is pushed ahead of it, hollows it passes are filled from what it pushes, and what is left drops where you let go. The blade only goes down as you push (it starts a few centimetres into the ground where you press and follows the ground down), so pushed into a heap from beside it, it bulldozes the heap along; dragged off the top of a heap, it spreads it out. The ridge it pushes slumps as it goes and the sides of its track fall in behind it, so nothing stands up in walls or spires. Firm ground and turf are not cut.
- **Pat it down (right-click).** The back of the blade slapped on the spot: lumps go, the slope stays, and the earth is firm (it no longer slides). Pat a bank to shape it, or a bed to level it.
- **The view.** Q and E turn it, the wheel zooms, shift and the wheel tilt it, and the middle button drags it round. The yard opens on a lower view so the shape of the ground reads.
- **Cut turf.** The shovel held flat: drag along the grass to strip the turf off in a strip.
- **Materials arrive as things.** Wood chips, bark and bed soil come in 56 L bags set down in front of you (a ring marks the spot, and the store closes so you see them): drag one with your hands, rip it open with the shovel, then scoop the heap where it goes. Gravel, crushed stone, sand and the rest are tipped in a heap. Chips thrown straight on grass work, but the grass comes up through them in a week or two; fabric under them stops it.
- **Wheelbarrow.** Click to shovel a scoop in (up to 100 L); walk it over and drag down to tip it out.
- **Rake.** Drag over loose earth to level it.
- **Hand tamper.** Click to thump, hold and walk to tamp a strip. Twice is firm.
- **Landscape fabric.** The woven weed barrier: hold and sweep it over dug-out ground.
- **Watering can, hose.** Water new plants in; run the hose into a lined pond.

**How things are put in (and what happens if you skip a step)**

- **A path or patio:** dig it out (skim the turf, then dig 5 to 15 cm), tamp it, roll out fabric, lay crushed stone and tamp it again, then gravel, chips, or stone on a little sand. Stones set on loose ground sink and tilt over their first weeks; on tamped ground they stay put. Gravel and chips with no fabric under them grow weeds in a few weeks; pull them by hand (Hands, drag over the path). Point at any ground and the tag tells you what it is and how it was put in ("Crushed stone 8 cm · on fabric · tamped firm").
- **A garden box:** set the cedar box down (R turns it), fill it with raised-bed soil (or earth from the barrow). The earth stays inside the walls. Then hoe it into a bed in the Garden (5).
- **A wall:** cut stone or fieldstone, dragged along in courses, one course on top of another, finished with capstones. Set it on tamped ground or it settles.
- **A pond:** dig a bowl (a shelf round the edge, deeper in the middle), click it with liner to lay one sheet over the whole hole, run the hose in. The water stops at the lowest point of the rim; rain tops it up, the sun takes a little. An iris goes on the shallow shelf.
- **Plants:** dig a hole as deep as the root ball (the tag counts the centimetres), plant, water in, keep moist for three weeks while it roots.

**Materials (Yard store, by aisle)**

- Wood chips and bark mulch; pea gravel, crushed stone, decomposed granite, slate chips, white marble chips, lava rock, river rock, sand; lawn seed.
- Cobblestones (granite setts, laid three wide as you drag), flagstones, brick pavers; fieldstone, cut stone, capstones, granite edging, landscape timbers, boulders; solar path lights.
- Base and fabric; garden boxes and bed soil; pond liner; tools; the nursery (lavender, black-eyed Susan, feather reed grass, boxwood, hydrangea, rose, Japanese maple, blueberry, dwarf apple, iris).

**Try this**

1. Press 6. Dig a few scoops (press and pull down) and throw them beside you (click): a hole and a heap. Rake the heap flat.
2. Put in a path properly: skim it, tamp it, fabric, crushed stone, tamp, then pea gravel or cobblestones. Put a second path in carelessly beside it and watch the difference over a few weeks (100× speed).
3. Set a garden box, fill it, and hoe it into a bed (5); sow it with the trowel.
4. Build a cut-stone wall three courses high with capstones on top.
5. Dig and line a pond, run the hose, ring it with fieldstone, put an iris on the shelf.

**Rough edges (what to expect)**

- Thrown earth always lands where you aim (no misses or spray yet).
- Pond water is a flat sheet at the level the simulation finds, not the streams' live water.
- No rentable machines yet (mini excavator, plate compactor).
- The old terrain tools (keys 2 to 4) still work at their 1 m scale.
- The bar holds more slots than there are number keys: past 9, click them.
- Yards dug before this update start fresh (the ground's data changed shape).

## The building reads from anywhere (branch `quickwins`)

- Every piece that can go in next breathes with a faint glow from any distance, not only within arm's reach, so you can see what's next from across the yard.
- Pale means you can reach it from where you stand; amber means it is above you: get on the ladder, a scaffold or the roof first. The colour changes as you climb.

## Hands that feel like work (branch `feel`)

- **Work camera.** When you start setting and nailing by hand, the camera eases in close and a little lower, then drifts back out a couple of seconds after you stop. Scrolling the camera yourself turns it off until next time.
- **A real hammer.** A framing hammer replaces the hatchet in the hand while there is nailing to do. Each blow winds up behind the head, snaps down and recoils. The dust, the shake and the nail going in all land at the moment of contact, not on the click. Click again before a blow lands and it lands at once, then the next one starts. "Work until done" uses the same swing.
- **Pieces fly from the shoulder.** Sheets, blocks and other unsawn pieces leave your shoulder, arc over and drop onto their seat with a small rock, a puff and a nudge of the camera. Sawn sticks still arc from the saw as before.
- **Blows you can see.** A set piece stands nearly twice as proud as before, so each blow visibly drives it down, and the last one seats it with a bright spark.

Try: lay the subfloor by hand from the default camera; nail a wall frame lying on the deck.

## Cut to length at the yard; you cut the fitted pieces (branch `cuts`)

- Most lumber comes cut to length on the order: precut studs, plates, joists, beams and headers. Carry them in and they fly from your arms into place: no trip to the saw and back.
- The cuts a carpenter really makes on site are yours to make, as a job of their own: posts cut to height, cripples, gable studs, rafters, blocking, and any stub under 60 cm. Point at the sawhorses and press E once per piece: the stick is sawn there and the piece goes into your arms (six at most; with full arms it waits on the horses). Then carry them in and each goes where it was cut for.
- The Build panel lists precut pieces as "36 × cut to 2.61 m"; what you cut yourself is still bought as stock sticks ("8 × 12 ft").
- "Work until done" and guided building still cut for you.

## Siding that looks like siding (branch `cuts`)

- Finished walls showed the old voxel wall (planks with a dark beam every metre) fighting the siding boards at the same depth: the brick-and-stripe look. A wall clad with boards now keeps its body behind them, so only the siding shows, with slim corner posts hidden inside the trim.
- Lap siding is drawn flat, course on course, with the lap painted by its own material: a crisp shadow line under each butt edge and a lit bottom edge. No more shadow-map blocks from leaning boards.
- Corner and opening trim is painted white; plain siding is a soft grey-green, dark siding a deep brown. Nail heads don't show on finished siding (it is blind-nailed).
- Board and batten carries on up the gables as vertical boards; the battens sit tight on the boards.

## The dollhouse cut opens the siding too (branch `dollhouse`)

- Inside a building, the stretch of wall between the camera and you opens as before, and now its siding boards (and the framing, wrap and anything else drawn as pieces) open with it. Each building draws its pieces with its own copy of the materials, cut by the same planes as its walls, in build mode's drawing and in the construction view's.

## Cutting made easy (branch `easycut`)

- Fixed: after the first cut the sawhorses stopped cutting (a timer never counted down).
- A cut piece is no longer something you carry: it waits at the sawhorses and is fetched from there when you set it. Point at its glowing place and click, whatever is in your arms; it flies in from the horses.
- Hold E at the sawhorses to cut piece after piece. Pieces for the frame lying on the deck now are cut first.
- The guide sends you to the sawhorses when only cut-to-fit pieces are left in a stage, then back to the frame once they are cut. Guided building and "Work until done" still cut for you.

## Services S0 — power tools see real power

**What is new**

- `window.__game.powerAvailable()` now asks the electrical solve instead of always saying no. A corded tool has power when a live load point (an outlet, a light, any wired load) with spare watts is within 30 m of you; with no load points wired at all it falls back to the main circuit's spare.
- The circular saw at the sawhorses, power-tool work speed and the stock panel's "needs power" note all follow it.

**Try this**

1. Equip: a battery or generator, an inverter, a 15 A breaker and an outlet, wired together. Stand near the outlet with a circular saw owned: cutting at the sawhorses uses the saw.
2. Walk more than 30 m from every outlet, or trip the breaker: the saw stops counting as powered. Console: `__game.powerAvailable()`, `__game.powerAvailable(1500)`.

**What's weak**

- The cord is invisible and its 30 m is a fixed number; no extension cords yet.

## Services S1 — one connection compiler, and a store for runs in buildings

**What is new**

- Nothing to see yet: this is groundwork for in-wall wiring and plumbing. First Water (the kit pipes in the yard) now compiles through the new generic `src/sim/core/links.js` and must play exactly as before; its output was checked identical on 400 random pipe networks.
- `src/sim/core/routes.js`: a generic store of runs on frames (a building), with nodes, bores, pulling, joins and segments as work steps. Not registered in the game yet (that is S2, with the content).

**Try this**

1. First Water: pump, fit kit parts from the barrel to the tap, open the valve, leave an end open. Flow, leaks and the valve should behave as before.

**What's weak**

- No player-facing change; routes become visible with S2/S3.

## Vehicles V0 — the controller stack (no visible change)

**What is new**

- Nothing you should notice. Under the hood the engine now has one place that decides what body your input drives and what the camera follows (`src/engine/control.js`, `__game.control`). Vehicles (the ATV next) sit on it; cooking, ladders, scaffold, roof walking and the hands move onto it later.
- Also exposed for add-ons: `__game.groundAt(x, z, y)` (the one ground read: terrain, shaped yard ground and built floors) and `__game.pushOut(o, rad)` (the circle push-out the player uses against trees, rocks and walls).

**Try this (regression only)**

1. Walk, sprint, jump, scroll the camera in and out: the same as before.
2. Climb a ladder and a scaffold, walk on a roof, open the kitchen and cook, use the hands on the water kit: all the same as before.
3. Console: `__game.control.top().id` is `'walk'`; `__game.control.canTake('seat')` says why a seat would be refused (e.g. `arms full`, `build mode`).

**Known gaps**

- Nothing uses it yet; the first user is the vehicle seat (V3).

## Vehicles, under the hood (branch `vehicles-v1v2-core`)

- Nothing to drive yet: this is the drive model and the world's record of vehicles that the ATV (next slices) runs on. The page part lands in V3.
- What exists: an ATV and a small trailer as records (`VEHICLE_KINDS`), gasoline, a 20 L fuel can and the trailer in the catalog (new "Vehicles and fuel" category), and a `vehicles` sim system: parked poses, fuel, seats, hitches, rentals.
- Try from the console: `__game.sim.commandNow('vehicles.add', { kind: 'atv', x: __game.player.x + 3, z: __game.player.z })`, then look at `__game.sim.state.sys.vehicles`. `__game.vehicleCore` has the drive model (`createBody`, `stepBody`, `headingControl`).
- Weak: no feel tuning yet (the numbers are from the design, checked only headless); towing a trailer while reversing is purely kinematic; no damage, no rollover by design.

## Ground A1 — smaller saves (branch `ground-a1a2`)

**What is new**

- Dug and shaped ground (the Yard, key 6) is stored packed in the save: about 1-2 KB per 3.2 m patch instead of about 17 KB. A big dug yard no longer runs into the browser's storage limit. Old saves load as before (save version 2).
- Autosave no longer copies the whole simulation first, so the 20 s autosave hitch is smaller.

**Try this**

1. Console: `__game.saveSize()` gives `{ bytes, plainBytes }` (stored size versus plain JSON). Dig a large area in the Yard, check again, reload: everything is where you left it.

**What's weak**

- Packing a very large dug area (300 patches) takes about 30 ms once per autosave.

## Services S2 + S3 — cable and pipe in buildings feed the real power and water; X shows them

**What is new**

- Runs in a building (the `routes` store from S1) now count: a finished cable from a panel slot to a box with a light lights it, through a breaker that appears in the slot at trim-out; a finished PEX run from a tank to a stub with a tap runs water indoors; an uncapped stub or an uncrimped end sprays. Electrical and water stay the judges (system `services`, `src/sim/services.js`).
- Corded tools also find power at an outlet on one of these circuits.
- The runs are drawn where they ride in the frame (`src/engine/routes.js`): full colour as far as they are pulled, pale beyond (a plan line), yellow dots where a hole is still to drill.
- X (outside build mode) cycles Off, Power, Water (`src/overlays.js`): the runs show through the walls, cable green to red by load and grey when dead; water blue, red, brown, orange where it leaks.

**Try this**

1. Place a cabin (or any building) and finish its walls, stand near it, then in the console: `__servicesView.sample()`. A 14/2 cable runs from a wall box through two studs to a switch-height box, and a planned PEX run sits lower down with its holes still to drill.
2. Press X: Power, then Water, then off. The sample cable is grey in Power (nothing feeds it); the PEX is dim in Water.
3. `__servicesView.clearSample()` takes it out. `__servicesView.info('sample:cable')` says where the run is up to in plain words.
4. A whole circuit from the console (a panel on a generator first, with Equip): add a `slot` node with `ref: { piece: <panel id>, port: 'b1' }`, a box, a `routes.addRun` with `cls: 'cable'`, `routes.work` it through, `routes.setNode` the box `{ key: 'device', value: 'light_ceiling' }` and both nodes `{ state: 'trimmed' }`. The light draws 9 W (`__game.sim.state.sys.electrical.loads`).

**What's weak**

- No planning or gestures yet (S5 to S7): runs come only from the console. The sample sets the building's frame once; frames do not follow a moved building until the plan UI syncs them.
- Overlay colours are per run, not per segment, and there are no moving dashes yet (S12). Drains and vents compile but nothing drains through them indoors yet (S11).
- A switch box is just a box: switching what it controls comes with trim-out (S9b).
## A finished building looks finished (branch `finish`)

- Once the last stage is done, the construction view lets go of the building: no nail heads, no studs or sheathing showing through. Build mode draws it (siding on the walls, the roof) as it does any finished building.
- The dollhouse cut shows solid wall sections: a cut piece is drawn with a dark section where it was opened, not as a hollow box.
- A gable's sheathing, wrap and siding belong to its roof and hide with it when you are inside (siding on a gable end is real; it just floated there with the roof gone).
- By the sawhorses, two neat stacks: the pieces cut and waiting to go in on the near side, the offcuts on the far side, each sorted longest first, ends flush, four to a layer, at their real lengths and sizes.

## Ground A2 — one ground in the simulation (branch `ground-a1a2`)

**What is new**

- Nothing should look different. Terrain height edits (the brush, the starting well's levelled spot, build mode's site cut) are now part of the simulation's save (save version 3) instead of a side list in the engine, and there is one command API for moving earth at any scale, ready for machines and foundations.
- Old saves load with their levelled sites and dug terrain.

**Try this (console)**

1. `p = __game.player; y = __game.heightAt(p.x + 6, p.z) - 0.5; __game.ground.cmd('grade', { samples: [[p.x + 6, p.z], [p.x + 9, p.z]], targetY: y, core: 1.5, rim: 3.5 })`: a sunken pad appears beside you. Reload: it is still there.
2. `__game.ground.cmd('cut', { x: p.x + 4, z: p.z + 4, r: 2, m3: 3 })` (machine-sized bite) and `__game.ground.cmd('fill', { x: p.x - 4, z: p.z, r: 2, m3: 3 })`.
3. Use the old terrain brush and build a site as before; `__game.ground.verify()` should report `tiles: 0`.

**What's weak**

- Macro (1 m) cuts and fills are blocky next to the 10 cm hand-dug ground, and a machine-sized cut wipes hand-dug detail under it (by design: it absorbs it).
- Build mode's site cut still goes through the old path (slice A3 routes it through `ground.grade`).

## Services S5 + S6 — plan cable and pipe through the frame in two clicks

**What is new**

- A router finds the way a run takes through a building's frame (`src/sim/core/routefind.js` over channels read from the framing members, `src/sim/content/frame-channels.js`): up and down beside a stud, sideways through the studs at outlet height, waist height or near the top, up through the top plates and over the ceiling joists, or down through the bottom plate into a joist bay and along or across the joists (hung under them over a crawl space). Openings block their bays: a window keeps the bays under its sill and over its header; a header is never bored.
- Holes are sized and checked to code: a bearing stud loses at most 40% of its depth (IRC R602.6), a joist a third and never within 2 in of an edge (R502.8.1), a top plate half its width; a hole nearer than 1-1/4 in (cable) or 1-1/2 in (pipe) to the stud face gets a nail plate (NEC 300.4, IRC P2603.2.1). A 2 in drain will not go through 2x4 studs or 2x8 joists, and says so.
- A drain only ever runs downhill and falls 2 cm a metre (1 cm for 3 in and up, IPC 704.1); it starts high in a joist bay to have room. Too long a run for the floor's depth is refused in plain words.
- Planning by hand (`src/services-plan.js`). Hands (F) near a framed building shows Power, Cold, Hot, Waste (keys 1 to 4). Places a run can start glow: a breaker panel (its next free breaker), a tank, pump or heater, a box, a stub, a drain exit. Click one, or a stud to start fresh. Aim at the frame: a ghost box or stub snaps beside the nearest stud at the preset height; the wheel steps the preset (outlet 0.40 m, switch 1.20 m, counter 1.10 m on 12/2, ceiling light; sink, toilet, shower; sink drain, toilet and shower floor drains, out of the building). The route draws itself in dashes with a dot at every hole (silver where a nail plate goes) and the hint line reads like "14/2 cable, 4.5 m, 11 holes, through the studs". R tries another way (up to three). Drag the dashes to pin a point the route must pass; right-click unpins. Click plans it, and the new box is the next start, so a circuit is a chain of clicks. Right-click steps back.
- Runs ride on their building's frame, now kept in step with where the building stands: a moved building takes its runs along.

**Try this**

1. Set down the cabin plan (Build, Plans) and stand inside its walls. F, then 1. Click a stud low on one wall (a new outlet box), aim at another wall: watch the dashes, press R a couple of times, click. Click on round the room.
2. Wheel to Switch and plan a box at 1.2 m beside the door; wheel to Ceiling light and aim at the floor under where the light should be.
3. Press 4 (Waste). Wheel to Sink drain, click a stud on an outside wall, wheel to Out of the building, aim low at an outside wall: the drain drops into the floor and falls to the exit. On a building on skids (no crawl space), a sink drain run far across the floor is refused when the joists are not deep enough for its fall; over the cabin's crawl space it hangs under the joists instead.
4. With a panel placed on a wall (Equip), its glow is breaker 1; the run you plan from it becomes that breaker's circuit.
5. Console: `__servicesPlan.plan('power', [x, y, z], [x, y, z], 'outlet')` plans between two frame-local points; `__game.routes.find(...)` and `__game.routes.channelsFor(structId)` are the router and the channels.

**What's weak**

- Clicking the middle of a planned run to branch from it is not there yet. Vents are not planned (S11).
- Water equipment standing in the yard cannot be routed to: the line in from outside comes with the ground work (S13). Start supply from a stub, or from a tank or heater inside the building.
- The cost of a hole is a guess (worth 40 cm of extra run), so the first route sometimes goes over the top where an electrician would bore straight through; R shows the others.
- Planned runs are not yet worked (drill, pull, crimp: S7) and the Build panel does not list rough-in yet (S8).

## Services S7 — rough-in by hand: drill, fix boxes, pull, clamp and crimp

**What is new**

- Planned cable and PEX runs are now put in by hand (`src/services-hands.js`, Hands F, with no Power/Cold/Hot/Waste mode picked). The hint line near a building lists what is left: "Rough-in: 2 boxes to fix, 5 holes to drill, 1 run to pull, 2 ends to crimp."
- **Boxes and stub-outs:** a planned one is drawn pale. Click it twice: hold it to the stud, then nail it (puff, hammer pose); it turns solid.
- **Drill:** hold the button on a yellow dot and sweep along the wall. Every dot the pointer passes within reach is queued and drilled in turn: the drill sits in the hole, chips fly, the dot goes dark. The sweep is wider with a higher per-gesture setting (Build panel, 1x to 4x). With power near (`powerAvailable`) a hole takes 0.2 s, on the battery 0.5 s. A quick flick still catches the dots between frames.
- **Pull:** hold the cable (or PEX) end at the start of the run; a spool or coil sits on the floor beside it and turns as it pays out. Drag along the run, or walk along it holding on: the cable follows through the holes (at most 3 m/s, never backwards, only within reach). Let go anywhere; progress is kept. Staples tick in behind it (within 20 cm of each end, then every 1.2 m for cable, NEC 334.30; every 0.8 m for PEX, IRC P2605.1), and steel nail plates go over the holes that need them as the run passes.
- **Clamp / crimp:** hold on an end until the ring closes (PEX) or the cable is clamped in its box: the ring darkens, green flash. Every end waiting at that box goes at once. The first finished run gets the overhead "Roughed in!" beat.

**Try this**

1. Cabin plan, stand inside. F, 1, plan an outlet circuit of two or three boxes (right-click to leave planning).
2. With no mode picked, click each pale box twice. Hold on the first yellow dot and sweep along the wall.
3. Grab the cable end at the first box and drag it along to the next box, or hold on and walk. Then hold on each end.
4. `__servicesHands.summary()` counts the work near you; `__servicesHands.targets()` lists it. `node test/services.smoke.mjs` does all of the above with the pointer.

**What's weak**

- An end that sits on a box still to fix is aimed as the box: fix the box first, then clamp.
- No tool or supply check yet: the drill, cable and staples are free until S8 (supply lines in the Build panel). Drains are not worked by hand yet (S11).
- The drill is only a model at the hole, not in the character's hand; the hammer for boxes is a pose only. No sound.
- Walls are not checked for being in the way of the pointer: you can aim at a dot through a lined wall (covered runs cannot be worked, though).

## Services S8 — rough-in and trim-out are stages of the building

**What is new**

- The Build panel lists **Rough-in** after Gutters and **Trim-out** after Lining, but only for a building with cable or pipe planned in it. With nothing planned (the shed) nothing changes: no new stages, insulation as before.
- Rough-in has its own shopping lines, worked out from what is planned: 14/2 or 12/2 cable and blue or red PEX by the metre (each run plus 30 cm spare at each box for cable, 20 cm for PEX), wall and ceiling boxes, cable or PEX staples, nail plates (two per hole near a stud face), crimp rings (one per PEX end). Order them like any stage; they come as stacks. Staples, plates and rings sit by the stacks and are used up (never carried).
- The hands draw on them: nailing a box takes a box, pulling takes the metres pulled with their staples and plates, crimping takes a ring. They come from the spool in your arms if you carry it, otherwise from the stacks. Short of something, the gesture stops and says "Out of 14/2 nm cable: order the rough-in in the Build panel (L)". Sandbox: free.
- **Insulation waits for rough-in** while runs are planned. **Close up anyway** (Build panel, or the note on the left) leaves whatever is not roughed in out of the stage; it stays as plan lines.
- **Do it for me** on Rough-in drills, pulls and crimps every run and nails every box of that building, from the stacks. On Trim-out it puts an outlet in each wall box, a light in each ceiling box, a breaker in each slot (devices by hand are S9b).
- **Lining covers the runs:** once a wall's lining is on, the runs inside it cannot be worked. A marker on such a run (Hands, F) says the wall is closed: **hold** on it to open the wall. Its lining and batts come off (the whole face: lining is one piece per wall), the books stay straight, and the stages go back to wanting them.
- Unlocks: finishing a cabin opens `services:in-wall` (nothing is gated on it yet).

**Try this**

1. Cabin plan, framed and roofed (sandbox off). F, 1, plan an outlet circuit. Open the Build panel (L): Rough-in after Gutters, with cable, boxes, staples and plates. Order it.
2. Fix the boxes, drill, pull and crimp by hand (S7). Watch the Rough-in count climb; Insulation opens when it is done.
3. Or plan a second circuit and press **Close up anyway**: insulation opens and the new circuit stays as a plan.
4. Line a wall with a run in it, plan another run through it: the marker says it is closed; hold on it to open the wall.
5. Console: `__game.sim.commandNow('services.auto', { structId: <id>, stage: 'rough-in' })`, `'services.defer'`, `'services.openWall', { structId, host: '<wall id>' }`; `__game.sim.state.sys.services.want` shows the lines the Build panel was told.

**What's weak**

- Trim-out has no shopping lines yet (outlets, switches, lights, breakers come with S9b) and no hands: only "Do it for me". A cabin with services planned is not finished until trim-out is done.
- Planning cable into a finished building reopens it (Rough-in and Trim-out appear), and finishing it again counts as a second finish.
- Spools are drawn from the stacks wherever you stand, like nails; carrying one only decides where it comes from.
- Floors do not cover runs (a crawl space is reachable from below); a ceiling's lining does.
- Drains and vents have no lines and no hands yet (S11): "Do it for me" fits them.
- The shed gate (`test/shed.e2e.mjs`) fails on current `main` and on this branch alike (the hand-building loop keeps picking up the wrong stack at the foundation, 10 checks); it is not caused by S8.

## Ground A3 and foundations B1 — sites through the ground, concrete that cures (branch `ground-a3b1`)

**What is new**

- Levelling a building site (finishing its Site stage, or placing a building outside construction mode) now goes through the ground system. Pads should look as before. A hole you dug by hand in the Yard (key 6) where the new building stands is filled when the site is levelled; ground outside the pad is left alone.
- Concrete cures on the sim clock. A building on a slab, poured piers or a stem wall can be given a foundation job; while its concrete is below half strength, framing refuses with "The concrete is still green" and opens by itself once the concrete reaches it. Warmth speeds it, cold slows it, a hard frost on fresh concrete weakens it for good.

**Try this**

1. Yard (6): dig a hole with the shovel. Place a Tool shed plan over it (construction mode) and finish its Site stage: the hole is gone and the pad is flat. `__game.ground.verify()` reports `tiles: 0`.
2. Foundations (console). Build a cabin on a slab (Plan mode, foundation "Slab on grade"), then with `id` its building id (`__build.structs()`):
   `__game.sim.commandNow('foundation.setPlan', { structId: id })`, then `__game.sim.commandNow('foundation.debugPour', { structId: id })`. The foundation stage is done; try to frame: "The concrete is still green". Watch `__game.sim.state.sys.foundation.jobs` (`elements[0].cure.strength`); at 100x or 1000x speed the framing opens after a few world hours with the default 20-day year (about 3.5 days with a real-length year).

**What's weak**

- No hands-on steps yet (layout, dig, base, forms, pour, screed, finish, strip come in B2-B8); `debugPour` jumps straight to curing, and there is no cure tint or gate chip on the slab yet.
- The foundation job is not created automatically: it needs the console call above until the foundation view (B2) does it.
- A building drawn with only walls (no floor) samples its site round the walls, so the middle of a large plan is levelled only partly, as before; a hole there is filled only where the pad really is level.


## Foundations B2 — layout strings and dig to the line (branch `ground-b2`)

**What is new**

- A building with a **slab**, **stem wall** or **poured piers** put up in construction mode is now a foundation job: its site is no longer levelled by magic and its site and foundation stages are done by hand (the construction panel says so).
- **Site tool, key 7** (also a button on the tool strip). Two things in hand:
  - **Layout kit**: press a glowing corner and a stake goes in with two hammer blows. Keep holding and pull toward the next corner: you walk after your hand, the pink string pays out behind you, and every corner your hand reaches gets its stake. The last one closes the loop: batter boards pop up beyond the corners, the strings go up on them at finished height, the diagonals flash white (square).
  - **Shovel** (the Yard's own): inside the white painted line, ground still to dig is **dark amber** (darker = more to go), ground within a few cm of the line is **pale yellow**, dug too deep is faint blue. A yellow tape hangs from the string at the blade and the hint reads "Here: 9 cm to go". Once most of the dark amber is gone, **right-drag** the flat of the blade across the yellow: it trims to the line and pushes the earth out past the edge. When it is all down, "Dug to the line" and the site stage is done.
- Escape puts the site tools away.

**Try this**

1. On flat-ish ground: L, choose the tool shed, set it down, then in Plan mode (B) change its foundation to Slab (or console: `__build.setFoundation(__build.structs().at(-1).id, 'slab')`).
2. Press 7, stake the four corners in one drag. Take up the shovel (2), dig the amber (Yard store scoop size 2x or 4x speeds it up), trim, watch the amber go.
3. Then `__foundation.debugPour()` in the console: framing says the concrete is still green until it cures (speed time up).

**Weak / not in yet**

- After the dig the gravel base, forms and pour are B3-B5; until then use `__foundation.debugPour()`.
- The slab's thickened edges are not dug as trenches yet (only the pad to the gravel bottom); stem-wall trenches and pier holes are dug the same way but are deep and slow by hand (an auger or machine is later).
- On a slope the low side ends up below the line (blue); filling it is the gravel base's job (B3).
- Hammer-blow pose and batter-board look are first passes; untuned against a real playtest. Guided level has no one-click layout yet.
- Console: `__foundation.drawn()`, `__game.foundation.jobView(__game.sim.state, '1')`. Smoke test: `node test/foundation.smoke.mjs`.

## Foundations B3 + B4 — gravel base, forms, barrow concrete and the screed (branch `ground-b3b4`)

**What is new**

- After the dig, a **slab** carries on by hand in the Site tool (key 7); the bar changes with the step.
  - **Base**: **Gravel**: press and drag along the pad and the truck tips heaps where you guide it (the building's ordered gravel, or gravel bought in the Yard store). **Barrow** (click a heap to shovel in, drag down to tip), **Rake** (drag: the back of it pulls gravel to the line under the strings, the tines even it), **Tamper** (click to thump, hold and walk for a strip). The overlay: amber wants more gravel, blue stands proud, faint dots are not yet tamped twice. The bar reads gravel / level / tamped %. Done when level and twice tamped: the gravel bed member is finished.
  - **Forms**: hold a **board** near a string: a ghost snaps along the run; click sets as many as the gesture setting (Supplier/construction 1x-4x). Then the **Stakes** (hammer): glowing marks outside the boards; click one, two blows, and it and its neighbours go in. Missing boards or stakes: a Buy button in the hint. Unstaked boards wobble.
  - **Pour**: **Barrow**: drag **up** to slash bags in (gesture count, three fill it), hold the **right button** to run the hose, drag **side to side** to hoe it through, drag **down** at the forms to tip. A meter under the hint shows water/cement against dry / stiff / right / wet / soupy. Too dry sits in a crumbly heap and tears under the screed; too wet slumps flat and cures weaker (Abrams). **Rake** spreads it into the corners. **Screed**: press at one end and drag the board toward you; it rides the forms at the slab's top, the surplus rolls ahead as a ridge, the top behind it turns flat and wet-bright; dull patches are hollows (tip a little more ahead, pass again). Fully screeded: a burst, "Screeded", the slab starts to cure and framing waits for half strength.
  - An **unstaked form bows** under the concrete (a real beam deflection between whatever holds it) and **leaks** grey out at its foot; stake it during the pour and it stops (what ran out stays out).
- Building plans sent again by build mode no longer drop the green-concrete hold.

**Try this**

1. As B2 (a shed with a slab on flat ground; 7; stake; dig). Buy a rake, tamper and wheelbarrow in the Yard store if you have none (the hint offers Buy buttons), and order the building's materials (gravel, concrete mix).
2. Gravel: one drag over the pad. Rake it until the amber and blue are gone, tamp it over twice.
3. Boards on the four strings, then the stakes (try setting gesture to 3x). Leave one long side unstaked to see it bow and leak.
4. Mix: up, right-hold for ~6 s for three bags, hoe until 100%, tip. About 14 batches for the 3 x 2.4 m shed slab at 1x. Then screed. Console shortcuts: `__game.sim.commandNow('foundation.mix', { jobId: '1', bags: 3 })`, `{ waterL: 9 }`, `{ work: 5 }`, then `foundation.tip { jobId: '1', x, z }`.

**Weak / not in yet**

- Slabs only: stem walls and piers still use `__foundation.debugPour()` (B8). Finishing (float, joints, broom), cure colour, covers and stripping the forms are B5; the wet mesh disappears when the screed finishes and the slab member is drawn.
- Leaked concrete cannot be shovelled back yet; it is lost. The ridge pushed past the far form ends up on it (shovel-off is not modelled).
- The barrow is the only mixer; 14 barrow batches for a shed slab is real but long (the mixer is B7, ready-mix B9).
- Gravel coverage is read as "filled to half the base depth over the dig line" once the job's own gravel has been tipped in (core earthwork loses track of a raked layer's thickness, so the label alone is not reliable).
- Water feedback is the meter, the colour of the heap in the barrow and the hint; no sloshing or crumb visuals in the tub yet. The screed's "saw" is a small wobble of the board.
- Console: `__foundation.drawn()`, `__game.foundation.jobView(__game.sim.state, '1')`, `__game.foundation.carry(__game.sim.state)`. Tests: `node --test test/foundation-pour.test.mjs`, `node test/foundation.smoke.mjs`.

## Foundations B5 — finishing, cure, covers, bolts and stripping (branch `ground-b5`)

**What is new**

- Screeded, a slab is no longer "poured and done": it is **finished by hand** (step `finish`) and **cures from the moment it is placed**. The Site bar (key 7) becomes the finishing kit (one tool in the store, **Concrete finishing kit**, $95): **Float** (bull float: drag over the screeded top, it goes from wet-bright to an even satin), **Trowel** and **Broom** (drag), **Edger** (drag along inside a form), **Joints** (the groover along dashed lines; only slabs with a span over 3 m need them, at most 2.5 m apart) and **Bolts** (anchor bolts, $1.6 each: press a glowing mark along the sill line; `gesture` at a time).
- **Timing matters.** The wet top bleeds: a bright sheen of water rises after the screed. Float right away, then **wait for the sheen to go** (the wet-bright look fades; a wetter mix bleeds longer). Trowel or broom **before** that works the water into the skin: pale scaled blotches and a weaker top. After **final set** the tools tear and refuse; the finish step ends by itself and what was not worked stays as it is. All windows are in units of the concrete's set time at its temperature, so cold stretches them and heat shrinks them (and pausing the clock removes the pressure). The hint and the chip tell you the phase and the hours left.
- **Anchor bolts** are needed on a slab: **framing refuses** ("Anchor bolts first...") until every mark has a bolt, even once the concrete is strong. They push in while it is wet; after initial set they are drilled and epoxied in, one at a time.
- The finish step ends when the top is floated and worked (troweled or broomed), jointed where needed and bolted: the wet field goes and build mode draws the slab.
- **Cure look**: a thin dark overlay on the slab (not build mode's member) that is wet-dark at first and **lightens with strength**; misting darkens it again; drying out shows pale crazing, frost shows scaled patches. A **chip** at the top of the screen shows the strength with ticks at walk 10% / strip 20% / frame 50% and what is next.
- **Covers**: **Blanket** (holds moisture and heat in: for cold nights) and **Plastic** (holds moisture in), $70 / $28, reusable, press to roll over, press again to take off. **Mist** (a garden hose, $35 in the Yard store): the top stays wet for half an hour (not in frost). Both feed the cure's drying and frost terms: a hot windy day on a bare slab crazes it.
- **Strip**: at a fifth of the strength the Strip tool pries a side (`gesture` boards at a time); the first board off takes that side's stakes. Boards and stakes go back to stock. A side whose edge was not run with the edger chips as it comes off.
- Fixed: the screed's strength factor (a wet mix, a cold joint) used to be overwritten by the next cure step; it now sticks (`cure.q`).

**Try this**

1. As B4 (a slab shed, dig, base, forms, pour, screed), but buy the finishing kit, a blanket (or plastic), a hose and 8+ anchor bolts first (the hints have Buy buttons).
2. After the screed: float the whole top, watch the sheen. Try the broom on a corner right away (scales), then wait until the hint says the sheen is gone and broom the rest. Click each bolt mark.
3. Cover it, wait until the chip shows Strip forms at 20%, strip the sides. Framing opens at 50% with the bolts in.
4. Console: `__game.foundation.finish(__game.sim.state, '1')` (window, bolts, joints, cover), `__game.sim.commandNow('foundation.finishAt', { jobId: '1', x, z, kind: 'float' })`, `foundation.setBolt`, `foundation.joint`, `foundation.cover { kind }`, `foundation.mist`, `foundation.strip`, `foundation.finish` (stop working the top now). Time speeds the cure: `__game.sim.runTicks(60)` is an hour.

**Weak / not in yet**

- The windows are tuned on paper (bleed ends at 0.3 of initial set, tools stop at 1.5), with the 2.5x working-time scale; they need a playtest against the real game clock. The sheen and phase are read from the cure every 10 sim minutes, so they lag a little.
- Slabs only (stem walls and piers by `debugPour` have no finish step, bolts or strip yet: B8). No saw-cut for a joint missed in time, and a slab left unjointed is not cracked yet. No rebar (B6).
- The cover is a flat sheet with a pop-in, no cloth physics; the mist is a particle spray with no water use. Hand models for the finishing tools are first-pass boxes.
- The tint is an overlay at the slab top; if build mode's slab member is raised or changed in height it will not follow (it reads the job's top).
- Tests: `node --test test/foundation-finish.test.mjs`, `node test/foundation.smoke.mjs` (now through strip).

## Vehicles V3 + V4 — ride the ATV (branch `vehicles-v3v4-atv`)

**What is new**

- A utility ATV is parked a few steps past the old well in every world (new worlds, and once in older saves). It is modelled on a real mid-size 4x4 automatic quad (table below): racks front and rear, fenders, footwells, a winch, a ball hitch, 24 in tyres with tread you can see turning, handlebars that turn with the steering.
- **Get on by walking into its side** (between the axles, pushing toward the seat) for a quarter of a second: it glows faintly when you are in the zone, then you swing on. Refused with a line if your arms are full or you are in build mode.
- **Drive like walking**: push where you want to go (WASD relative to the camera, or the left touch stick). Space brakes, Shift is gentle throttle (slippery slopes, tight spots). Push behind you at a crawl and it reverses. **E** brakes to a stop and steps you off on the side toward the camera's right (else the other side, else behind).
- It handles like a 290 kg machine: about 4 s to 50 km/h through a five-speed automatic (you can see the nose squat and dip at each shift), engine braking when you let go, a slow creep on hard floors, a rider-held brake once it is nearly stopped. Grip comes from the ground under it: dry grass, wet grass (when it rains), packed or loose dirt, mud (wet dirt), gravel and stone paths, mulch, sand, snow, stream water and floors each have their own peak and sliding grip and rolling drag. Too much throttle on wet grass or mud spins the wheels; it climbs about 25 degrees of dry grass, not of wet grass, and nothing past about 33 degrees. Steering slows and narrows with speed, and the front washes out (understeer) rather than drifting.
- Weight transfer you can see: it dips under braking, squats under power, leans out of turns and bobs on its springs (0.2 m of travel, about 2 Hz). It leaves the ground off humps and lands with a thump, a little camera shake and a puff of dust. On a steep side slope or in a hard turn it warns you ("Steep side slope: ease off"); go past it and it rolls over softly, you jump clear uphill, and it is set back on its wheels after a few seconds.
- The rider straddles the seat with hands on the grips and feet on the footrests, leans forward, leans into turns and turns with the bars. The hatchet is put away and the tool keys (1-6), build mode (B), the hands (F) and the construction keys are locked while seated; the panels (I, U, J, Y, H) still open.
- The camera stays high and yours: it looks a little ahead of where you are going and draws back slightly at speed.
- It stays where you left it: the position and fuel go to the world twice a second while you drive, when you step off, and before the page closes; reload while seated and you are still on it.

**Try this**

1. New world: walk past the well; the ATV is there. Walk into its side to get on. Drive around trees and the house; get off with E; reload; it is where you left it.
2. Hold W down a long grass slope and let go: feel the engine braking. Turn hard at speed: it leans and runs wide. Make it rain (weather panel, Y) and try the same slope again.
3. Drive across a dug or graded patch (Yard, key 6) and a gravel path: the grip and drag change (`__vehicles.body('v1').surface`).
4. Console: `__vehicles.body(__vehicles.driven())` (speed, rpm, gear, spin, tip), `__vehicles.spawn('atv')` (another one in front of you), `__vehicles.bench()` (microseconds per drive step here), `__vehicles.stats()`.

**Real-world references the ATV is tuned against** (Honda FourTrax Rancher 4x4 420 published specifications; tyre figures are typical published off-road ranges)

| Figure | Real | In the game |
|---|---|---|
| Length x width x height | 84.6 x 47.4 x 46.8 in (2.15 x 1.20 x 1.19 m) | 2.15 x 1.20 x 1.19 m |
| Wheelbase | 51.0 in (1.295 m) | 1.295 m |
| Seat height / ground clearance | 34.9 in (0.886 m) / 9.2 in (0.234 m) | 0.886 m / 0.234 m |
| Turning radius | 11.5 ft (3.5 m) | 23 degrees of lock, 3.5 m |
| Tyres | 24 x 8-12 front, 24 x 10-11 rear | radius 0.305 m |
| Curb mass | 643-676 lb (292-307 kg) | 292 kg + 80 kg rider |
| Engine | 420 cc single, about 26.6 hp (19.8 kW) | 32 N m peak, 19.8 kW, 7000 rpm limiter, 5-speed automatic |
| Suspension travel | 7.3 in front, 8.5 in rear (0.19-0.22 m) | 0.20 m, 2.0 Hz, lightly damped |
| Fuel | 3.9 gal (14.8 L) | 14.8 L, about 5 L/h flat out |
| Towing | 848 lb (385 kg) | trailer: 350 kg on the bed |
| Top speed | about 55 mph claimed (24 m/s) | governed at 18 m/s (65 km/h), see below |
| Tyre peak grip (knobby) | dry grass 0.6-0.7, wet grass 0.3-0.4, packed dirt 0.65-0.75, gravel 0.55-0.65, mud 0.2-0.35 | 0.65, 0.39, 0.72, 0.6, 0.29 (sliding about 85 percent of peak) |
| Rolling resistance | hard ground 0.03, grass 0.05, mud and sand 0.1-0.15 | 0.034-0.135 by surface |

**Frame cost**

Measured headless (SwiftShader, Low preset, same view, `main` at e09c44a vs this branch); `__game.bench()` itself did not finish in 25 minutes without a GPU timer, so these are the CPU numbers plus draw calls:

| | before | after |
|---|---|---|
| Draw calls / triangles, standing at arrival with the ATV 12 m away | 67 / 369,464 | 70 / 370,892 (+1 body, +1 wheels, +1 bars) |
| Vehicles' per-frame hooks with the ATV parked | - | 0.002 ms (+0.005 ms for the starter check) |
| One drive substep (4 ground reads, 3 push-outs, the model): `__vehicles.bench()` | - | 0.011-0.017 ms; at 144 fps that is about 1.2 substeps a frame, about 0.02 ms |
| The whole seated update per frame (substeps, drawing the unit, posing the rider, sync) at 1/144 s | - | 0.055-0.085 ms (noisy, software-rendered host) |
| `step()` median at 1/144 s, driving flat out | 0.10 ms (standing) | 0.10 ms |

No new passes; parked units cost nothing per frame beyond the zone check. On your machine: Graphics panel JS ms while driving, and `__vehicles.stats()` (ms per frame, substeps per frame).

**What's weak**

- Top speed is governed at 18 m/s rather than the real 20-24 m/s: chunk streaming builds a new row of 32 m chunks each time you cross one (every 1.8 s at 18 m/s), and headless software rendering cannot show whether that hitches on a real GPU. Check the Graphics panel's JS milliseconds while driving flat out; if it holds, raise `topMps` in `src/sim/content/vehicles.js`.
- No touch "Off" button yet (V6): on a phone the act button gets you off. No HUD chip (speed, fuel) yet (V6). No dust, tracks or splashes beyond the landing puff (V5). No trailer on the page yet (V7): the trailer is still a grey box if spawned.
- The rider is the existing blocky character with one-piece legs, so knees do not bend; the legs reach the footrests straight.
- Fuel runs down but there is no way to refuel by hand yet (V9); `__game.sim.commandNow('vehicles.refuel', { id })` takes gasoline from stock.
- Collisions with buildings and trees use three circles along the body; it can clip a corner slightly.

## Vehicles V7 + V8 — tow the trailer, haul lumber with it (branch `vehicles-v7v8-trailer`)

**What is new**

- **A small utility trailer comes with the ATV** (for now, in new worlds and once in older saves; V9 moves it to the supplier). It is parked loose alongside the ATV, on its far side from you and a little ahead, facing the same way: an ATV dump trailer of the common steel kind, 1.8 x 1.1 m bed, 90 kg, rated 350 kg, on a 2-inch ball. Steel tub with a front board, side rails and the tailgate hung open for long loads, A-frame tongue with a coupler and jack post, two wheels under fenders.
- **Hitch by backing onto it.** Reverse toward the tongue: within 3 m a faint line runs from the ball to the coupler (pale yellow, greener when you are lined up). Get the ball within 0.4 m with the trailer lined up within 35 degrees and it latches with a clunk ("Hitched"). Not lined up: it says so. **X unhitches** while seated (stop first).
- **Towing feels the load.** The trailer's mass and its load add to what the engine pulls and what the ATV's brakes stop (small trailers have no brakes of their own), so a full trailer pulls away slower and stops longer (in the test, deceleration on dry grass drops by over a quarter with 350 kg on). A tenth of its gross weight sits on the ball, behind the rear axle: more weight on the driven wheels, less on the front, so the steering washes out sooner with a heavy load. It follows on the ball without sliding at its own axle, so it cuts corners and swings in a tight turn. Backing up is unstable the way it is in life: it folds, and at 75 degrees (the jackknife stop) the rig binds and stops ("Jackknifed: pull forward to straighten the trailer").
- **Loading at a pile: hold.** With the trailer parked within about 4 m of a pile, aim at the pile and hold the left button (or E). The press picks up an armful as always; still holding after half a second, that armful goes onto the bed and the rest of the pile streams after it, about eight pieces a second, each flying from the pile to its place, until you let go, the pile is gone or the bed reaches 350 kg. A tap is exactly the old pick-up. Studs and joists lie along the bed and hang over the open tailgate; sheets lie flat; boxes and bags in rows. Mixed loads stack layer on layer.
- **Build straight off the trailer.** What is on the bed stays a construction pile that rides with the trailer, so a trailer parked by the work is the pile the build draws from (guided building, work until done, cutting at the sawhorses take from the nearest pile), and by hand you can take an armful off the bed (walk up to it: "Pick up ... off the trailer").
- **Tipping.** While seated with the trailer on, hold the left button: the bed tips up about its pivot (30 degrees a second, to 48). Past about 27 degrees (dry lumber on steel) the load slides off the tail and lands as an ordinary pile behind the trailer. Let go and the bed comes down.

**Try this**

1. New world or an old save: walk past the well. The trailer is alongside the ATV. Get on, swing round so the trailer's tongue is behind you, then hold S (or push away from the nose): watch the guide line and back onto the tongue. Tow it around the house; back it into a spot between two trees (Shift is gentle throttle).
2. Order lumber (Build panel), drive the trailer to the delivered pile, step off, hold at the stud pile. Drive to the far side of the building and build with "work until done": the studs come off the trailer.
3. Tip the rest off behind the building; X to unhitch.
4. Console: `__vehicles.bed('v2')` (tip angle, pieces, kg), `__vehicles.hitch()`, `__vehicles.unhitch()`, `__vehicles.tip(true)`.

**What's weak**

- The trailer is given with the ATV, not bought: V9 adds it to the supplier (the item `trailer_small`, $450, is already in the catalog).
- No touch control yet for tipping or unhitching (V6: "Use" and a long press). On a phone, the trailer can be towed and loaded but not tipped or unhitched.
- A loose trailer cannot be pulled around by hand yet; only the ATV moves it.
- Its tongue rests at ball height on the jack whether hitched or not (no crank). Loads longer than the bed pass through the open tailgate's line rather than over it.
- The pieces flying onto the bed are drawn by the trailer's own instanced load (a short arc), not by construction's member fly-in, which is tied to building members.
- The trailer pushes no sideways force into the ATV through the ball (the tow model is kinematic: the trailer's mass slows and lengthens stops, its tongue load moves the ATV's grip, and it binds at the jackknife stop, but it cannot shove the ATV's tail out on a downhill turn).

## Shed by hand again: the barrow, the sawhorses and the last pieces stop getting in the way
- **New:** the wheelbarrow arrives beside the stacks on the far side from the building, no longer on its footprint (it used to take E from "Work until done" and from the pier blocks). Pointing at a pile nearer than the barrow picks up the pile. A wall frame ready to tilt up, or a glowing place right under the pointer, comes before cutting at or grabbing the sawhorses that stand by the wall. With empty hands (or a load too short for the next stick), the note sends you to the stacks even when only a few places are left; the view no longer offers to set a piece the arms hold too little lumber for.
- **Try:** a new world, the tool shed by hand (L, place, order, level). Stand by the east wall near the sawhorses and nail, cut, raise: E does what the note says.
- **Test:** `node test/shed.e2e.mjs` passes again (it aims at the foot of a pile, cuts at the sawhorses, and expects bare framing to let the player through).
- **Weak:** the sawhorses still stand close to the building when the delivery spot is near it; pointing at the top of a pile on a steep slope can still pick the pile behind it (the ring shows where the pointer lands).
## Interior walls: hang, tape and mud (branch `interior`, design in `docs/design/interior-walls.md`)

- Lining is hung piece by piece. Drywall: sheets 1.2 m tall laid flat, the top row first, end joints on the studs and staggered between rows, cut round windows and doors; each sheet set and screwed. Pine boards: a course at a time from the floor up, blind-nailed.
- Partition walls (floor on both sides) are lined on both faces.
- New stage after lining for drywall, **Tape and mud**: every seam (between rows, the end joints, the inside corners) takes tape and a first coat, a fill coat and a finish coat, each on dry compound (about 90 game minutes), then a sanding pass. With joint compound in your arms (or by the stack), point at a seam and press E; hold to go round the room. The seam widens coat by coat, dark while wet, light when dry, and vanishes when sanded. The guide says how long until the next coat.
- A finished room shows its drywall or boards, not the old plank-and-post faces; no screws or nails show once the walls are finished.
- To try it: in plan options choose Inside: Drywall (the cabin defaults to pine boards). `__build.placePlan('cabin', x, z, yaw, { lining: 'gypsum' })` does it from the console.
- Old saves: a wall lined in one piece before this change counts its new sheets and seams as in, so finished buildings stay finished.
- Known: `test/shed.e2e.mjs` still fails at the foundation (the pointer picks a neighbouring stack and puts it back), as noted above; not from this branch.

## Interior walls and services, reconciled (branch `reconcile`)

- Electrical boxes are set proud of the studs by the wall's lining (13 mm drywall, 19 mm boards), so after hanging and taping they sit flush with the finished wall and the outlets fitted at Trim-out are on the surface, not buried behind the drywall. Boxes placed before this change keep where they are.
- Order inside a building: rough-in, insulation, lining (hang), tape and mud, trim-out (devices and fixtures). Trim-out waits for the taping.
- Opening a wall to get at a run takes off every sheet or board of it, its taped seams and the batts; the hints say so.
- The planned interior "trim" slice (casings, baseboard) is renamed finish carpentry, apart from services' Trim-out. See `docs/design/interior-walls.md` and the design README.

## Paint: walls and trim (branch `paint`, design in `docs/design/interior-finishes.md`)

- New last building stage, **Paint**: primer on every lined wall face, a rectangle (up to 1.2 m wide, clear of the openings) at a time, then two coats of colour, each on dry paint. The trim (corner boards and round doors and windows) takes two coats of its own colour; it comes primed.
- Hands: point at a part of a wall or a trim board with E. The roller runs over it and the coat wipes on from the end you stand at; the first coat lets the primer show through, wet paint is darker. The roller in the hand carries the colour.
- Choosing: plan options (or a selected building's options) have **Walls** (12 colours or bare, with Matte, Eggshell or Satin) and **Trim** (12 colours or as it comes). On a finished building in construction mode, a colour adds the painting as work; changing a colour later means two more coats. Paint is ordered by the litre per colour and sheen, primer by the litre.
- Finishes are stored by surface (walls, a face, trim, a single piece), so cabinets and new furniture can take their own colour later without changes to the paint code.
- Opening a wall for services takes its paint off with the drywall.
- Console: `__build.setDeco(structId, { walls: 'sage_eggshell', trim: 'moss_semigloss' })`.
- Weak: one colour for all the walls of a building (per face comes in slice 2); no clear oil for boards yet; sheen does not change the look yet; with "Work until done" the paint stage works like taping (waits on wet coats).

## Trim carpentry: casings and baseboard (branch `finish-carpentry`, design in `docs/design/carpentry.md`)

- New stage after taping, **Trim carpentry**: casings round every door and window (a door: two legs to the floor and a head; a window: a frame of four), set back a 5 mm reveal from the jamb, then baseboard along the floor from corner to corner, stopping at the door casings. Paint now comes after it, so walls and trim are painted together.
- Every piece is cut to fit at the sawhorses from primed moulding in stock lengths: the prompt and the note say the cut ("miter both ends", "cope one end, square the other"), the stick on the horses is the moulding's size and white, and the saw swings to 45 degrees for a miter. A run longer than a stock length is joined with a scarf.
- Set each piece and nail it: a finish nail about every 40 cm. The nail heads show until the room is painted (filled and painted over).
- Trim takes the building's Trim colour, inside and out.
- Drawing: the old wall body's foot (a dark band 30 cm tall) no longer stands in front of framed walls, inside or out, so the baseboard and siding meet the floor as built.
- Ordered as Casing, Baseboard and Finish nails. The guide no longer asks to reorder when every stick has been cut into pieces still to set.
- Weak: miters and copes are drawn as square ends; window trim is a picture frame (stool and apron later); no caulk yet; the aim can pick a neighbouring piece first at a corner.

## Trim-out by hand: outlets, switches, lights, breakers (branch `wave2-s1-trim`, slice S9b of `docs/design/services-roughin.md`)

- Trim-out is real work and real stock now. The Build panel's Trim-out lines list an outlet and its plate, a switch and its plate, or a light for each box a cable comes to, and a breaker sized to the cable (15 A for 14/2) for each panel slot. Order them like any stage; they sit by the stacks. "Do it for me" still finishes the stage, but it draws all of it from the stacks and says what is missing if it is short.
- A box planned as a switch gets a switch, an outlet an outlet, a ceiling box a light. Before the first wire goes on, the wheel over the box changes it (outlet, switch, wall light).
- In Hands (F), at a roughed-in box whose walls are done: **click** strips the cable ends (the copper shows), **drag** away from the box lands the wires on the device (it comes off the stacks then), **click** folds it in and screws it, **click** puts on the plate (a light: its shade). The per-gesture setting (1x to 4x) is how many ends one click or drag does; from 2x the fold click puts the plate on too.
- At the panel: empty slots pulse; **click** presses a breaker onto the bus bar (several at 3x/4x). The main goes off while you work: **drag** its handle up and the lights come on one after another along the circuit. **Click** a breaker to switch it off or on. A tripped breaker sits mid-throw; hover it for what it drew; switch the load off and click to reset.
- **Click** a wall switch: the lights after it on the cable go out or on (with no light after it, the outlets: a switched outlet).
- **Hold** on the yellow tester under the panel: a light hops box to box along every circuit, green where the cable is through, red where it is not; the red marks stay a while and say why on hover ("cable not pulled through to here", "not joined to the panel"). A pass hangs a green tag on the panel. The tester works during rough-in too.
- Lamps glow by their lens; one point light follows the nearest lit lamp.
- Console: `__servicesTrim.targets()`, `.where('trim' | 'slot' | 'breaker' | 'main' | 'switch' | 'tester' | 'fault')`, `.lamps()`; sim commands `services.trim { node, n }`, `services.main { panel, on }`, `services.breaker { node }`, `services.flip { node }`, `services.check { structId }`.
- Old saves: boxes and slots trimmed before this change stay as they were, live and free; a panel has no main state until a breaker is pressed in by hand.
- Weak: the device is a plain ivory box and the plate a white slab; the land drag accepts any drag of about 20 px from the box (it does not need to end on a screw); touch has no drag mapping for land or the main; wall-face direction for boxes on partitions is guessed from where the box sits in the wall; one switch per light chain (no three-way); the light's glow follows the electrical tick, so after throwing the main it can take a moment of game time to start.
