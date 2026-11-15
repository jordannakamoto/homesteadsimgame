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

## Wave B, part 1 — materials, money and inventory (commit on `main`; see `docs/STATUS.md`)

Wave B is landing in three parts as each finishes. This is the first.

**What is new**

- Three buttons under the stamina bar: Items (I), Supplier (U) and Projects (J).
- **Supplier.** Browse lumber, logs, sheets, insulation, roofing, glass, stone, fasteners and tools. Each line shows the price, the unit, and real properties such as density and insulation value. You start with $2,500. Delivery is instant.
- **Items.** Everything you own, grouped by category, with quantities and total mass.
- **Projects.** A few optional cards (put a roof over your head, fell a tree, buy your first lumber). Tick them, dismiss them, or ignore them. Two tick themselves when you do the thing.
- **Trees give real logs.** Chopping a felled trunk adds pine, birch or oak logs by the trunk's actual volume, on top of the wood you already got.
- Underneath: a registry of 55 real materials (density, conductivity, heat capacity, strength) that every later system reads.

**Try this**

1. Press U, buy 20 m of 2 x 4 and a hammer, then press I and check the mass.
2. Fell and chop a pine, then look for pine logs in Items.
3. Reload the page: money, items and project ticks should all come back.

**Known gaps**

- Buying does nothing for building yet. Build mode still counts plain wood; it starts using real materials when its redesign lands.
- Owning a tool does not yet gate any action.
- Prices are estimates and starting money is a placeholder.
- A handful of material values are marked approximate in the registry (green logs, cob, thatch, straw bale and a few others).

**Critique prompts**

- Is the Supplier readable at a glance, or is there too much small print on each line?
- Is $2,500 too much or too little to start with?
