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

- **A small utility trailer comes with the ATV** (for now, in new worlds and once in older saves; V9 moves it to the supplier). It is parked loose beyond the ATV (on the side away from where you start, clear of a first building's deliveries), its tongue toward the ATV: an ATV dump trailer of the common steel kind, 1.8 x 1.1 m bed, 90 kg, rated 350 kg, on a 2-inch ball. Steel tub with a front board, side rails and the tailgate hung open for long loads, A-frame tongue with a coupler and jack post, two wheels under fenders.
- **Hitch by backing onto it.** Reverse toward the tongue: within 3 m a faint line runs from the ball to the coupler (pale yellow, greener when you are lined up). Get the ball within 0.4 m with the trailer lined up within 35 degrees and it latches with a clunk ("Hitched"). Not lined up: it says so. **X unhitches** while seated (stop first).
- **Towing feels the load.** The trailer's mass and its load add to what the engine pulls and what the ATV's brakes stop (small trailers have no brakes of their own), so a full trailer pulls away slower and stops longer (in the test, deceleration on dry grass drops by over a quarter with 350 kg on). A tenth of its gross weight sits on the ball, behind the rear axle: more weight on the driven wheels, less on the front, so the steering washes out sooner with a heavy load. It follows on the ball without sliding at its own axle, so it cuts corners and swings in a tight turn. Backing up is unstable the way it is in life: it folds, and at 75 degrees (the jackknife stop) the rig binds and stops ("Jackknifed: pull forward to straighten the trailer").
- **Loading at a pile: hold.** With the trailer parked within about 4 m of a pile, aim at the pile and hold the left button (or E). The press picks up an armful as always; still holding after half a second, that armful goes onto the bed and the rest of the pile streams after it, about eight pieces a second, each flying from the pile to its place, until you let go, the pile is gone or the bed reaches 350 kg. A tap is exactly the old pick-up. Studs and joists lie along the bed and hang over the open tailgate; sheets lie flat; boxes and bags in rows. Mixed loads stack layer on layer.
- **Build straight off the trailer.** What is on the bed stays a construction pile that rides with the trailer, so a trailer parked by the work is the pile the build draws from (guided building, work until done, cutting at the sawhorses take from the nearest pile), and by hand you can take an armful off the bed (walk up to it: "Pick up ... off the trailer").
- **Tipping.** While seated with the trailer on, hold the left button: the bed tips up about its pivot (30 degrees a second, to 48). Past about 27 degrees (dry lumber on steel) the load slides off the tail and lands as an ordinary pile behind the trailer. Let go and the bed comes down.

**Try this**

1. New world or an old save: walk past the well. The trailer is beyond the ATV, its tongue toward it. Get on, drive round so the trailer is behind you, then hold S (or push away from the nose): watch the guide line and back onto the tongue. Tow it around the house; back it into a spot between two trees (Shift is gentle throttle).
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
