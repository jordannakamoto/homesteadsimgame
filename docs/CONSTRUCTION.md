# Construction: how building works

The design for iterations 2c (construction) and 2d (store and plan book), written after the owner's first playtest. The owner has never built anything and wants the game to teach it: structures need framing, insulation and boards assembled like real life, with a tutorial that builds a shed. This document is the brief for whoever implements those iterations. `docs/V1_PLAN.md` has the short version.

## The idea in one paragraph

A building is designed in Plan mode and then raised by hand, in the order a real one is. The plan decides what materials are needed and the game orders them for you; they arrive as stacks on the ground; you carry them to the building and work them into place, stage by stage. Every stage is a real step with a real reason, and the simulation makes the reason felt: a frame without sheathing wobbles in the wind, a house without roofing gets wet inside, a wall without insulation is cold. The player learns how houses are built by building one, and is never asked to know it in advance.

## What is real and what is abstracted

| Real | Abstracted |
|---|---|
| The order of construction | Measuring: each piece is sawn to its length from a stock stick at the sawhorses (lumber is bought in 8 to 20 ft sticks; long runs are spliced over a support) |
| Every member exists: each stud, joist, rafter and sheet | Fasteners: nails and screws are bought by the box and used up, not placed |
| Real sizes and spacings (studs at 40 cm, real lumber sections) | Squaring, plumbing and levelling: the ghost is always true |
| What each layer does, with consequences if it is missing | Tool handling: one "work" action, speed set by the tools you own |
| Quantities, weight and cost | Waste and offcuts |
| Structure, heat and weather acting on a half-built house | Permits, inspections, injuries |

## The layers of a building, and why each exists

This is the knowledge the game teaches. Each is a build stage; each has one sentence the player sees, and a consequence the simulation applies.

| # | Stage | What the player does | The one-line reason | If it is missing |
|---|---|---|---|---|
| 1 | Site | Stake out the plan, clear and level the ground | A building needs flat, firm ground | Cannot start |
| 2 | Foundation | Set pier blocks, piers, a stem wall or a slab | Keeps wood off wet ground and spreads the weight | Structure fails bearing; floor rots (later) |
| 3 | Floor frame | Beams, rim joists, joists at 40 cm | Joists carry the floor; closer joists mean a stiffer floor | Overspanned floor flagged by structure |
| 4 | Subfloor | Sheets across the joists | Gives you a deck to stand and build on | Walls cannot be built |
| 5 | Wall frames | Lay plates and studs flat on the deck, frame openings with headers, tilt the wall up, brace it | Studs carry the roof down to the floor; a header carries the load around a door or window | Nothing to hold the roof |
| 6 | Top plates | A second plate lapping the corners | Ties the walls together | Walls act alone |
| 7 | Roof frame | Ridge and rafters, or trusses | Pitch sheds rain and snow; rafters carry it to the walls | No roof |
| 8 | Roof deck | Sheets on the rafters | Makes the roof one stiff surface | Roofing has nothing to sit on |
| 9 | Roofing | Underlayment, then shingles, metal or thatch | Keeps the water out. This is "dried in" | Rain gets inside; floor and anything stored gets wet |
| 10 | Sheathing | Sheets on the outside of the studs | Stops the frame racking sideways in wind | Frame visibly sways; structure flags racking |
| 11 | Wrap | Housewrap over the sheathing | Stops wind and rain getting in while letting damp out | Draughty: higher air leakage in the thermal model |
| 12 | Windows and doors | Set them in their openings | Light, a way in, and they close the envelope | The room is not enclosed |
| 13 | Cladding | Siding or boards | Protects the wall from weather and sun | Wrap degrades (later) |
| 14 | Insulation | Fill the stud and rafter bays | Slows heat leaving in winter and entering in summer | Cold in winter: thermal model shows it |
| 15 | Lining | Interior boards or panels | Covers the insulation; a finished room | Unfinished look; insulation exposed |
| 16 | Services | Wiring, pipes, stove (other iterations) | | |

Stages 1 to 9 make a weatherproof shell. A shed can stop at 13. A cabin to live in goes to 15. Stages 14 and 15 are where the player first meets the thermal model: an indoor thermometer before and after insulating is the lesson.

Log and timber-frame buildings use the same stage list with different members: log walls replace stages 5, 6, 10, 11, 13 and 14 in one step (a log is structure, cladding and some insulation at once, which is why people like them and why they are less warm than they look).

## The loop

1. **Plan.** Pick a ready-made plan from the plan book, or draw one in Plan mode. It appears on the ground as a ghost.
2. **Materials.** A Build panel lists the stages. Each shows what it needs in plain words ("28 studs: the uprights inside your walls") and its cost. Order one stage or everything.
3. **Delivery.** Materials arrive as stacks at a spot you choose: lumber by length, sheets, bags, rolls, boxes.
4. **Carry.** Pick up from a stack. You carry a sensible armful by weight, visibly. A wheelbarrow or cart carries more.
5. **Work.** Stand at the ghost and hold the work button. Members go in one after another in a sensible order, each with a blow or two, a settle and a sound, using up what you carry. Let go any time. Progress stays.
6. **Big moments.** Tilting a framed wall up, setting the ridge, the last sheet of roofing ("dried in"), hanging the door. Each gets its own short interaction and a beat to look at it.
7. **Next stage.** Opens when the one it stands on is done. The Build panel always says what comes next and why.

### Keeping it from being tedious

- A small shed is about ten minutes from bare ground to roofed. A stage is one to three minutes.
- "Work until done": start a stage, keep the button held or toggle it, and watch it go up. The player chooses how hands-on to be.
- Three levels of detail, chosen per building and changeable at any time:
  - **Guided:** each stage is one action; members fill in as an animation. For players who want the building, not the labour.
  - **Hands-on (default):** carry and work as above.
  - **Piece by piece:** place individual members yourself, for players who want to frame a wall stud by stud.
- Tools change speed, not possibility: a hammer works, a nail gun on power is several times faster, a helper (contractor) can take a stage.
- Sandbox, a world option, skips all of it: plans are built the moment they are drawn.

### Being forgiving

- Nothing can be built wrong. The ghost is always correct; the player's choices are the plan, the materials and the order between independent stages.
- Mistakes are in design, not assembly, and the simulation shows them kindly and early: an overlong span turns amber in the plan before any wood is bought.
- Anything can be taken apart and the material comes back.
- Running out of money pauses a stage, nothing more. Felling your own trees and milling them is the free route.

## The first shed: a guided project

Offered as the first card in the projects notebook: "Build your first shed". It is the tutorial, and it is optional and skippable at every step. The plan is a 2.4 x 3.0 m tool shed with a single-pitch roof, one door and one window.

| Step | What happens | What it teaches |
|---|---|---|
| 1 | Choose where it goes. The plan is staked out as a ghost | Buildings start as a plan on the ground |
| 2 | Order the shed kit. A delivery arrives | How much material a small building is; what each stack is |
| 3 | Set six pier blocks on levelled ground | Foundations keep wood dry and carry the load |
| 4 | Build the floor frame, then the subfloor | Joists and spacing; you now have a deck |
| 5 | Frame the back wall flat on the deck and tilt it up | Plates and studs; the tilt-up moment |
| 6 | Frame the side walls and the front wall with its door opening | Headers carry load around an opening |
| 7 | Add the top plates | Tying the walls together |
| 8 | Set the rafters | Pitch and why roofs slope |
| 9 | Roof deck, underlayment and metal roofing | "Dried in". The game waits for rain or offers to show one: it is dry inside |
| 10 | Sheathe the walls | Before: push the frame and it sways. After: it does not |
| 11 | Wrap, hang the door, set the window | Closing the envelope |
| 12 | Siding | Protecting the wall |
| 13 | Optional: insulate and line it, with a thermometer inside | Insulation, seen as a number that changes |

Each step shows one short card at the moment it is needed: a sentence of what to do, a sentence of why, and nothing else. The structure and thermal overlays are used as teaching aids at steps 6, 10 and 13.

Finishing the shed opens the small cabin plan and the choices that go with it.

## Below ground: trenches, pipes and wires

Houses need water in, waste out and power across the yard, and most of that goes underground. The owner raised this after the first playtest. It follows the same rule as the rest: real reasons, simple hands.

**One tool: the trench.** Draw a line on the ground from here to there. It appears as a ghost trench at the right depth. Dig it (a shovel is slow and honest; a rented trencher or mini excavator is fast), lay what goes in it, and backfill. The terrain really changes while it is open, using the engine's existing digging.

**What goes in a trench, and the one thing to know about each**

| Run | The rule the player learns | How the game helps |
|---|---|---|
| Water supply | Bury it below the frost line or it freezes | The trench ghost is drawn at frost depth for the climate; a shallower trench shows an amber "this will freeze in winter" |
| Power | Wire outdoors goes in conduit, and thicker wire for longer runs | The run picks conduit automatically and suggests the gauge for its length and load |
| Sewage | Waste runs downhill: the pipe must fall all the way, about 2 cm per metre | The ghost shows the fall with arrows and deepens along its length; a run that would have to climb is refused with the reason |
| Drainage | Water must be led away from the foundation | A perimeter drain option on foundations, shown working in rain |

Water and power can share a trench. Sewage gets its own.

**Dealing with waste: three honest choices**

- **Composting toilet.** No pipes, no water, makes compost. The off-grid default and the first one unlocked.
- **Greywater to the garden.** Sink and shower water run to a mulch basin and water a tree. Simple, and it closes a loop.
- **Septic system.** A buried tank and a drain field sized to the household and the soil. The grown-up option for a full house with flush toilets: more digging, more money, no maintenance for years.

**Order matters here too.** Pipes under a slab go in before the concrete is poured; pipes and wires inside walls go in after framing and before insulation and lining. The stage list has "services" at those points, and the Build panel says so at the right moment ("Run your pipes now: once the slab is poured you cannot").

**Seeing it.** An underground view fades the ground and shows every buried run in colour (blue water, brown waste, yellow power), with depth and fall. It is the same overlay system as heat and structure.

**Kept simple on purpose.** No pipe fittings, glue or individual joints; no vent stacks; no percolation test beyond a soil class. A run is one piece with a length, a diameter and a depth.

## Hooking things up: wires and pipes

Requested by the owner: an intuitive way to lay wiring and pipes. Today the Equip tool joins equipment by dragging from one small port to another, which works but assumes the player knows what joins to what. The redesign makes hook-ups a mode of their own and lets the game carry the knowledge.

**Revised 15 Nov: the work is done by hand.** The owner judged the first plan here "not quite there" for Nintendo-level intuition plus real-world gestures. The Hook-up view below becomes the *planning* layer: it shows what joins to what and marks the route. The work is then done in the body, like building:

- **Wire:** carry a spool, press at the first terminal to fix the end, walk the route and the cable pays out behind you, staple it along studs with a tap of the hammer, cut, and push the end into the next terminal. Terminals are big and colour-matched; a wrong one will not take the wire and says why in a few words.
- **Pipe:** carry lengths to the trench or wall, set each into the last with a push and a quarter turn, the joint clicks. Fittings are automatic. Open the valve and watch water arrive.
- **Dig the trench yourself** with the shovel (pull strokes, like the hoe) or a rented trencher you walk behind.
- **Switch it on.** Throwing the breaker or opening the valve is a physical act with an immediate visible result: the light comes on, the tap runs.
- "Hook it up for me" remains for players who have done it once, and for contractors.

**A Hook-up view.** One button in Build. The world dims, buildings go see-through, and only utilities stay bright: equipment, existing runs, and every free connection point as a large coloured socket. Yellow is power, blue is clean water, brown is waste, grey is flue. Buried runs show through the ground.

**Click, click.** Click a socket, and every socket it can sensibly join lights up while the rest fade. Click one of those and the run draws itself: along the wall and under the floor indoors, as a trench line outdoors. No dragging, no aiming at small dots.

**The game picks the size and says why.** A new run gets the right wire gauge or pipe diameter for its length and load, with one line of reason ("8 AWG: 30 A over 4 m at 12 V"). The player can change it; a bad choice turns the run amber with the reason and the fix, live.

**What usually comes next.** Hovering a socket names its usual partner in plain words: "A panel goes to a charge controller", "A tank's outlet goes to a pump or straight to a tap below it".

**Carry on and branch.** After a run lands, the next click continues from there. Clicking the middle of an existing run makes a branch.

**"Hook it up for me."** Select a group of equipment and one button joins it in the standard arrangement, drawing each run in turn with a one-line caption of what it is for. This is the default for kits and the way a beginner learns the pattern; they can then undo any run and do it by hand.

**Kits.** The store sells starter sets that arrive as one delivery and place as a group: a cabin solar kit (panel, controller, battery, fuse, two lights), a rain barrel kit (gutter, downpipe, barrel, tap), a gravity shower kit.

**A picture of the system.** The Home panel draws each system as a simple one-line diagram: sun to panel to battery to loads, with live numbers on each link; roof to tank to taps. Clicking a part of the diagram shows where it is in the world.

**Honest rules stay.** Wire ampacity, voltage drop, gravity head, pipe friction, frost depth and sewer fall are all still checked. The interface carries them so the player does not have to know them first.

## Renting machines

Requested by the owner: the machines people commonly rent when building a house. Renting is how real owner-builders do the heavy jobs, and it gives the game a pleasant kind of planning: you have the machine for the day, so line the work up.

**How renting works.** A Rentals aisle in the store. Pick a machine and a number of days; it is delivered on a trailer with the next delivery and collected when the rental ends. A day's rate is a real one. Nothing bad happens if you waste the day; you just paid for it. Everything a machine does can also be done by hand, slowly, so renting is always a choice.

**The machines for V1**

| Machine | What it does in the game | By hand instead |
|---|---|---|
| Mini excavator | Digs trenches, footings, a cellar or a pond many times faster; pulls stumps | Shovel |
| Skid steer, with bucket, forks and auger | Levels and grades a building pad, moves pallets and whole stacks, drills post and pier holes | Shovel, rake, carrying, post-hole digger |
| Walk-behind trencher | Cuts a narrow utility trench at a set depth in one pass | Shovel |
| Plate compactor | Firms gravel and soil under a slab, pad or path so it does not settle | Hand tamper |
| Concrete mixer | Mixes bags for piers, footings and small slabs; a ready-mix truck delivery for big pours | Wheelbarrow and hoe |
| Scaffolding | Lets you work on upper walls and roofs safely and faster | Ladder, slower |
| Portable sawmill | Turns your own logs into boards and beams | Buy lumber |
| Stump grinder and wood chipper | Clears a site; chips become mulch for the garden | Dig stumps, burn or pile brush |

Later, not V1: telehandler, crane for timber frames, well-drilling rig, road grader.

**Operating them.** The two ride-on machines are driven: climb in, drive, and hold the same work button, which now digs a bucket at a time or grades a strip. Simple, readable controls, not a machine simulator. The excavator's bucket and the skid steer's blade really move earth using the engine's terrain editing, so a pad you grade is a pad you can build on. Walk-behind machines are carried like tools and make the work action faster.

**What they teach.** Why ground is compacted before a slab (an uncompacted pad settles and the structure model shows it), why a pad is graded to shed water away from the house, and how much faster a machine is than a shovel, which is why people rent them.

## The store

- Organised by job: Foundation, Framing, Roof, Weatherproofing, Insulation, Windows and doors, Power, Water, Animals, Tools.
- A few items per aisle, shown as good, better, best where that is true (fibreglass batt, mineral wool, rigid foam).
- Each item: a name a beginner understands, one line of what it does, one or two numbers that matter, the price.
- The usual way to buy is the plan's list. Browsing is for curiosity and extras.
- Real property tables stay available behind a "details" toggle for players who want them.

## Unlocks

Opened by finishing things, shown as an invitation, never as a grind.

| Finish | Opens |
|---|---|
| Nothing (start) | Tent and tarp, the tool shed plan, pier-block foundations, stick framing, metal and shingle roofing |
| The shed | The small cabin plan, drawing your own plans, windows and insulation choices, the wood stove |
| The cabin | Concrete piers and slab, larger plans, timber frame, power and water equipment |
| A second building | Log construction, stem-wall foundations, the A-frame |

## How it ties to the rest of the game

- **Structure (iteration 3)** reads built members only. A half-built house is judged as it stands: an unbraced frame in a gale is a real, visible risk, shown as sway and an amber warning, not a collapse.
- **Thermal (iteration 4)** reads the layers that are actually built. No insulation means the cavity is air. No wrap means higher air leakage. No door means the room is not enclosed.
- **Weather.** Rain falls inside an unroofed building. Building in winter is cold work.
- **Stock and money.** Deliveries come out of stock and money; members put into a building leave stock; taking apart returns them.
- **Build journal (iteration 5b).** Every stage finished is a snapshot. The time-lapse of your own build comes from this.
- **Contractors (iteration 19).** A contractor takes stages off your hands and works the same loop.

## Data this needs from Plan mode

Supplied by the second half of iteration 2a: every member as a piece with `stage`, `parent`, `built`, real `section` and length; `setBuilt`; `materialsList` by stage in buyable units with a plain "what this is for" line; foundation types as real pieces; a ghost look for planned members.
