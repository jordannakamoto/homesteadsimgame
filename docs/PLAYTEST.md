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
