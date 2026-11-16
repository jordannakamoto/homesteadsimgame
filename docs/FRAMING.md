# Framing: doors, windows and the things real homes have

Goal: get into the framing phase. More window types, different door types, placement options, and the details real houses have that are fun to build and design.

## Phase 1 (now): doors and windows
- A real catalog of window and door types, each with standard sizes (`src/sim/content/openings.js`).
- Free placement along a wall, not tied to 1 m modules: snap to wall centre, centre between openings, equal spacing, aligned heads; sill presets (standard, counter, low, high); drag to move or resize; no overlaps.
- Real rough-opening framing (`src/framing.js`): king and jack studs, header sized by span, sill and cripples, pocket and garage-door specials. The structure sim checks the header.
- Each unit is one item: sold in the Supplier, carried, set into its rough opening, nailed, then operated by hand (swing, slide, tilt, roll).
- Old saves keep working: the old fixed shapes map to the nearest type.

## Phase 2: wall and floor features
Interior walls with corners and backing, a porch with posts and a beam, a covered porch roof, a loft floor with a stair or ladder opening (framed in the joists), simple stairs (stringers).

## Phase 3: roof features
Skylight (rafter header), dormer, bay bump-out with its own floor and roof, overhang and eave options, gable vent.

## Rules throughout
- Catalog data lives in `src/sim/content`; framing rules in `src/framing.js`; the structure sim judges.
- Every feature is buildable by hand in construction mode.
- Nothing runs per frame when idle.
