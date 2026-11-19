# Carpentry: trim, cabinets and furniture from real parts

Design round, 18 Nov 2026. Finish carpentry comes first (casings and baseboard, inside the building). It is built on a core that cabinets and furniture use later, so all wooden things in a house come from the same parts, cuts, joints and finishes. Builds on `interior-walls.md` (lining, taping), `interior-finishes.md` (paint by surface) and the site-cut mechanic at the sawhorses.

## What the owner asked for

- Trim now; cabinets and a carpentry and furniture building system later, with as much as possible shared.
- Today's furniture is too coarse ("2x or 4x the detail") for players to make their dream rooms, and it is to be replaced rather than extended.

## The core (shared by trim, cabinets and furniture)

- **Stock**: what the supplier sells. Linear stock in standard lengths (mouldings, boards, dowels, framing lumber; `STICK.stocksM`), sheet stock (plywood, MDF, gypsum). Each has real sections: a colonial casing is 57 x 17.5 mm, a base 83 x 14 mm.
- **Parts**: a piece cut from stock, with a length, a section, a profile, and the cut at each end: `sq` (square), `m45` (miter), `cope` (shaped to the face of the piece it meets), `scarf` (a 45 degree bevel lapped over the next length). Parts are members like framing members (`framing.js` `M`), at millimetre precision: nothing is a voxel, so a cabinet door or a chair rail can be drawn as finely as it is built.
- **Cutting**: every carpentry part is cut on site (`isSiteCut`): at the sawhorses, from a stick of stock, end by end, with the saw swung to the angle (the cut list packs the parts into stock lengths, offcuts kept). Furniture later adds a workbench next to the sawhorses with the same cut list.
- **Joining**: finish nails (brads) for trim; glue and screws (pocket screws, dowels) for cabinets and furniture.
- **Finishing**: the paint surfaces of `interior-finishes.md` (`PAINTABLE`): interior trim is the `trim` surface, so the trim colour covers it with the siding trim; cabinets and furniture add their own surfaces and can be painted piece by piece (`items`).
- **Placing**: trim is fitted to the building (it belongs to its walls). Furniture and cabinets are objects: assembled at the bench from parts, then carried and set (cabinets screwed to studs, which need blocking in the wall).

## Slice 1: casings and baseboard (shipped)

- Stage `carpentry`, "Trim carpentry", after taping (`needs: ['lining', 'finish']`); Paint needs it, so trim goes up before the room is painted and is painted with the walls (real new-construction order: hang, tape, trim, caulk, paint).
- Pieces per lined face (`framing.js`, after the seams):
  - Casings round every door and window (`<wall>.cs<face>.<k>`, kind `casing`): set back a 5 mm reveal from the opening edge. A door gets two legs to the floor and a head, mitered at the top corners; a window gets a picture frame of four, mitered at every corner.
  - Baseboard (`<wall>.bs<face>.<k>`, kind `base`) along the face at the floor, stopping at the door casings (square butt). At the room corners one end runs square into the corner and the other is coped over it; a run longer than a stock length is split with a scarf.
- Stock: `trim_casing` (colonial casing, primed finger-joint pine) and `trim_base` (colonial base), sold in stock lengths like lumber, ordered with the stage. Finish nails by weight.
- Hands: as framing pieces cut on site. The cut prompt says the cut ("miter both ends", "square, cope the other end"); the piece is set and nailed with the hammer. Nail holes show until the room is painted (filled and painted over).
- Drawing: the trim colour of the building, or the primed white it comes in. Finished buildings keep drawing it, with the lining. The old voxel wall body's foot is pulled in behind framed walls so it no longer hides the baseboard.

## Later slices

2. Window stool and apron (the sill style instead of a picture frame), caulk as a bead along the top edge (a coat like the seams), miters drawn as diagonal seams, a miter saw.
3. Blocking in partitions where cabinets and shelves will hang (frame stage), a workbench by the sawhorses.
4. **Cabinets**: base and wall cabinets as parametric designs (width in 75 mm steps, height, depth): a plywood carcass, face frame, doors and drawers, built part by part at the bench, carried in, levelled, screwed to the studs; a counter on top; the sink base over the drain from services. Their doors and frames take paint or a clear finish.
5. **Furniture**: designs made of parts (legs, rails, aprons, tops, panels) on a fine grid (10 mm, real board sizes), with joints; tables, benches, beds, shelves, chairs; saved designs; the old hand-modelled furniture is retired.

## Open questions

- Should finish nail holes be filled as a step (wood filler, like a coat), or folded into painting?
- Window trim style default: picture frame (simpler) or stool and apron (more traditional)?
- A miter saw as a bought tool that speeds trim cutting, or the circular saw at the horses for everything?
