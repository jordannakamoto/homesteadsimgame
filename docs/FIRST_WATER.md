# First Water: the first hands-on slice

Adapted on 15 Nov from the owner's "The First Drop" brief to what this repo already has.
This replaces the port-dot way of running pipes (Equip tool) for water. It is also the
template for every other hands-on system: wiring, flue, gutters, irrigation, fencing.

**Playtime:** 10 to 15 minutes. **Goal:** stand at your own tap and fill the watering can
from water you pumped and piped yourself.

**Loop to prove:** Order → Delivered → Unpack → Pick up → Assemble → Test → Tinker.

**The bar** is the woodcutting: every action is a gesture with the body, lands with a
sound and something you can see, and leaves a visible result. If putting the pipes
together is not fun before any water flows, the slice is not finished.

## What the owner asked for, and how this answers it

| Said | Answer in this slice |
|---|---|
| "I just want to use the spigot to fill my water bucket" | Step 1 needs no parts at all: work the pump handle, water comes out, the can fills. |
| "maybe connect it to a sink or something" | Step 2 is the kit: pipe the tank to a tap by the garden. A sink is the tinker goal (the tee is in the kit for it). |
| "are we relying on gravity? or do we need a pump?" | Both, and you feel each: your arm lifts water up into a raised tank; gravity brings it back down to the tap. A tap above the tank's water level gives nothing, and the game says so. |
| "the node based thing doesn't really work, maybe a 3D grid" | No nodes. Real parts in your hands that click together end to end in 3D: down the tank stand, along the ground, up the post. |
| "the nodes don't disappear" | Fix the leftover port dots first (Milestone 0), and take pipes out of the Equip tool. |
| "woodcutting is tactile, good feedback, rewarding" | See "Feel" below; it is an acceptance gate, not polish. |

## What changes from the original brief, and why

- **No physics engine here** (Rapier is a later plan in `docs/FOUNDATIONS.md`). Loose parts
  use a small scripted tumble-and-settle, like felled logs and pickups already do. Parts at
  rest are instanced and static. No rigid bodies on installed plumbing either way.
- **Third-person camera, so the character holds the part** (the hands rule), not the camera.
  While a part is held near other parts the camera eases in. The Zelda overhead beat plays
  when the box is opened and when the first water runs.
- **The source is what new plots already have:** dug well → hand pump. The brief's pressure
  tank becomes a **200 L barrel on a 1.5 m stand** beside the pump, preinstalled, with the
  pump already piped into it. Pressure tanks and powered pumps are the next unlock, not this slice.
- **No workshop building needed.** A plain workbench stands near the well. The tap is on a
  post about 6 m away beside the starter garden patch, placed so the straight line is
  blocked (the well and the bench), which forces at least two turns plus the drop from
  the stand and the rise up the post.
- **Ordering and delivery reuse** `src/sim/core/supply.js`, `src/engine/carry.js` and the
  store from the construction work. The drone is one scripted prop. This is the last
  milestone, so the slice does not wait on construction merging.
- **The water sim stays the judge.** `src/sim/water.js` already does head, pump curves, pipe
  friction and outlets. The assembled parts compile into its network. It gains what the
  slice needs: a shutoff valve, a tee, and an open end that leaks.

## Start of a new plot

Already there, working: dug well, hand pump, barrel on its stand (empty), the pump piped
into the barrel, a capped outlet low on the barrel, a tap on a post with an open inlet,
a workbench, a watering can, and enough money for one starter kit.

## Step 1: water by hand (no kit)

- Walk to the pump with the can. Hold the button and **stroke down and up**; each full
  stroke lifts about half a litre (through `water.draw`, limited by the well's yield).
- A diverter lever on the pump sends water to the **spout** (into the can or bucket set
  under it) or up to the **barrel**. The barrel has a sight tube so the level is readable
  from across the yard.
- First strokes are dry and squeaky, then it primes, gurgles and gushes. The can gets
  visibly fuller and the pouring note rises as it fills.

## Step 2: the starter kit

| Part | Qty |
|---|---:|
| Straight pipe, 1.5 m (cuts shorter) | 4 |
| 90° elbow | 4 |
| Tee | 1 |
| Shutoff valve | 1 |
| Coupling | 2 |
| End cap | 1 |

One material, one diameter (25 mm poly, already in the catalog as `pipe_poly_25`).

Order at the store → the drone sets a box down by the bench → pick the box up, put it on
the bench, open it, tip the parts out. Nothing goes into an abstract inventory.

Intended run: barrel outlet → valve → elbow down the stand → along the ground → elbow
around the well → elbow up the post → tap inlet. The player chooses every part. No path
is ever generated for them. Any valid order of assembly works.

## Handling parts (the heart of it)

- **Pick up:** aim at a part within reach, click. The nearest part to the pointer wins,
  with a generous radius, and small parts beat big ones when both are close, so an elbow
  in a pile is easy. The part is carried in the hands, visibly.
- **Offer it up:** bring it near an open end. A ghost shows it already turned so a matching
  end meets; compatible open ends glow. **R** steps through the other ways it can sit
  (four for an elbow, and so on). No free rotation, ever.
- **Click to fit:** it pops on with a push from the character, a click you can hear, and a
  small puff. It is now fixed geometry.
- **Take off:** aim at a fitted part, hold the button and pull back; it comes off into the hand.
- **Drop / toss:** right button drops; a held throw tosses. It tumbles, settles and sleeps.
- **Pipe length:** fit one end, then **drag the free end** out or in; it moves in 0.25 m
  steps up to the stock in the piece, and the offcut stays in your hand as a real shorter
  pipe. Length comes only from pipe you own.
- **Closing a run:** all fixtures and parts sit on one 0.25 m lattice in 3D (axis-aligned
  to the starting fixture), so runs meet. An open end within 0.15 m of a facing end closes
  with a coupling rather than refusing.
- No menus during assembly. The can, pipe cutter and loose parts live in the hands and the hotbar.

## Water that tells the truth

- Open the tap by **turning its handle** (click and drag round). With water in the barrel,
  the valve open and the run complete, it flows at the rate the sim gives for that head:
  a modest gravity stream, stronger with a fuller barrel.
- Close the valve: flow stops. Empty barrel: it dribbles out, and you go and pump.
- Pull a pipe off while the barrel has water: water pours from the open end at the sim's
  rate and the barrel level drops for real. Cap it or refit it to stop it.
- When nothing comes out, aiming at the tap says why in plain words, using the reasons the
  sim already produces (no path, valve shut, empty, tap higher than the water).
- Recompute the network only when a part is fitted, removed or a valve or tap moves. No
  per-frame hydraulics.

## Feel (acceptance gate)

Every one of these has a sound, a motion and a lasting mark:

| Moment | Feedback |
|---|---|
| Pump stroke | arm and handle move together, squeak, then gush in bursts timed to the stroke |
| Can filling | level rises in the can, pitch rises, slop over the rim when full |
| Part fitted | push, click, puff, the glow hands on to the next open end |
| Tap opened | pipe knock and air sputter along the run, then a steady stream |
| Stream on ground | splash, a dark wet patch that grows and later dries |
| Leak | spray from the open end, hiss, puddle |
| First water at the tap | the overhead beat, once |

## Out of scope for this slice

Powered pumps and pressure tanks, hot water, drains and vents, buried or in-wall pipe,
frost, other pipe materials, solvent or crimp joints, store economy, pressure-loss readouts.
(The sim already models several of these; they are just not surfaced here.)

## Built to be reused

Nothing below may mention water. Plumbing is the first set of content on top.

| Generic (engine) | What it does | Next users |
|---|---|---|
| `src/sim/core/parts.js` | Deterministic state for kit parts: loose or fitted, pose on the 3D lattice, ends with a type and facing, joins between ends, the graph of what is connected, events when it changes, save and load | wiring, flue, gutters, irrigation, fence, framing connectors |
| `src/engine/parts.js` (`window.__parts`) | Draws parts (instanced), picking from a pile, carry in hand, ghost and snap with allowed orientations, fit and pull-off gestures, length drag, tumble-and-settle | same |
| `src/engine/hands.js` (from the garden work) | hotbar, reach, gesture measures, overhead beat | everything |
| `src/engine/carry.js`, `src/sim/core/supply.js` (from construction) | boxes and stacks, orders and deliveries | everything bought |

| Homestead content | |
|---|---|
| `src/sim/content/plumbing-parts.js` | the six part kinds: shapes, ends, which end types mate, stock length |
| `src/sim/plumbing.js` | turns the fitted graph into the network `water.js` solves; valve, tee and open-end leak added to `water.js` with tests |
| `src/water-hands.js` | pump handle, diverter, tap handle, can filling, streams, leaks, wet ground, sounds |

## Milestones

0. **Clear the old way.** Port dots no longer linger after leaving the Equip tool; pipes
   are removed from Equip (wires stay until the wiring pass).
1. **Water by hand.** Pump strokes fill the can and the barrel. Playable on its own; publish.
2. **The toybox.** Bench, loose parts, pick, carry, ghost, fit, pull off, length drag. Parts
   placed by a debug key until delivery exists. Highest risk; publish and let the owner play
   before going on.
3. **It works.** Parts compile into the water network; tap, valve, leak, reasons.
4. **The delivery.** Kit order, drone, box, unpack (after the construction merge).
5. **Polish from playtest.** Fix what felt awkward before adding anything.

## Acceptance

A new player, with no help: pumps the can full; orders the kit; watches the drop; carries
the box to the bench and tips it out; fits a run from barrel to tap with at least three
turns; opens the tap and gets water; closes the valve and it stops; pulls a pipe and sees
the leak and the barrel falling; refits it; reloads the page and finds the run as left.

Quality gates: an elbow is easy to pick from a pile; a held part never jitters or hides
the work; fitting needs little precision; elbows are oriented with one key; fitted parts
never move; no menus while assembling; any valid order works; the player can tell why
water is not flowing. Headless: `npm test` covers the parts graph, the compile to the
water network, valve, tee, leak and conservation of water; one smoke run drives real
pointer input through pump → fit → tap.
