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
