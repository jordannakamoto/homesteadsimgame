# Finishes: paint and wallpaper, by surface

Design round, 18 Nov 2026. Planned with a Fable planning agent from a read of the code; builds on `interior-walls.md` (hang, tape and mud) and `services-roughin.md` (trim-out). Walls only for now; ceilings, floors, exterior paint and casings plug into the same pieces later.

## Surfaces (the model every finish uses)

A building's finishes are one record of surfaces, each painted on its own, stored on the structure in build mode (`S.deco`), saved with it and passed to the framing as `spec.deco`:

```
{ walls: "sage_eggshell",                       // every lined wall face
  faces: { "<wall>|<face>": "ochre_matte" },     // a face of its own (slice 2: accent walls)
  trim:  "chalk_semigloss",                      // corner boards and the trim round doors and windows
  items: { "<piece id>": "charcoal_semigloss" } } // one piece of its own: a trim board now; a cabinet door or a chair later
```

`framing.js` `finFor(deco, surface, key)` reads it: a key in `faces` or `items` wins over its surface's colour. Walls get primer and paint rectangles (below). Anything else that takes paint is listed in `PAINTABLE` (surface name and which pieces it covers) and gets a skin of paint 1 mm larger than the piece on every side, `<piece>.pt`, kind `paint`, two coats over stock that comes primed (no primer piece, so the 'prime first' rule passes). Cabinets and new furniture join by adding their pieces to `PAINTABLE` under a surface of their own (`cabinets`, `furniture`) and a name in `SURFACES` (`src/sim/content/decor.js`); nothing else in the sim, the order lines or the drawing changes. Today's furniture is not hooked in: it is to be replaced, not painted.

## Real practice (what the game copies)

- New drywall: one coat of PVA primer (about 10 m2/L), then two finish coats (about 12 m2/L each). Cut in the edges with a brush, roll each section in a W and lay off; recoat after a few hours. Sheens: matte, eggshell, satin.
- Pine boards: clear oil or varnish, two coats; or knot-sealing primer and two coats of paint.
- Trim: bought primed (finger-jointed pine or MDF), caulked and given two coats of a harder sheen (semi-gloss) once it is up.
- Wallpaper: prime or size, plumb a line a roll's width from a corner, cut drops at wall height plus 10 cm, paste the wall (or paste and book the paper), hang from the top, smooth from the centre out, butt the seams, trim top and bottom. A roll is 0.53 x 10.05 m; each drop can waste up to one pattern repeat.

## Construction side

- A stage after taping: `decorate`, "Paint", `needs: ['cladding', 'lining', 'finish']` (the trim is on the siding, so it is up before it is painted). Services' `trim-out` then needs `decorate` too (devices go on painted walls). A building with no finish chosen has no `decorate` pieces, so the stage counts as done and nothing changes for it or for old saves.
- Pieces (generated in `framing.js` `wallMembers` after the seams), per face that has a finish, one per opening-free rectangle of the lining split to 1.2 m widths, `draw: 0` like seams:
  - `<wall>.pr<face>.<k>` kind `prime`: one coat.
  - `<wall>.pt<face>.<k>` kind `paint`: two coats, carries `fin` (the finish key).
  - `<wall>.wp<face>.<k>` kind `paper` (slice 3): drops 0.53 m wide, hung in order.
- Coats reuse the taping rules: `m.coat`, `m.dryAt`, one pass per install call (`coatPass`), refused while wet, paint refused until its primer is in and dry (`'prime first'`). Paint and primer are built on their last coat (no sanding).
- Materials: PVA primer by the litre; paint made to order per colour and sheen by the litre; wallpaper by the roll with paste in its price.
- Hands: a roller in the hand (beside the hammer prop). Point at a rectangle with a tin in your arms or by the stack, press E: the roller runs over it and the coat spreads across; hold to go on to the next. The first coat is thin (the primer shows through), the second solid; wet paint is darker and dries lighter.

## Design side

- Slice 1 (shipped): chosen in the plan options under "Inside": "Walls: Bare / a paint colour" with "Paint finish" (matte, eggshell, satin), and "Trim: As it comes / a paint colour" (semi-gloss). Picking a colour for a standing building in construction mode adds the paint as work to do; a new colour on painted walls means two more coats (the primer stays).
- Slice 2: per wall face in Furnish ("Walls"), the way shutters are applied: click a face, drag across faces, fill a room, pick a finish up; accent walls fall out of per-face storage.
- Palette: 12 paints (Chalk white, Linen, Oat, Clay, Sage, Moss, Duck egg, Slate blue, Ochre, Terracotta, Dusty rose, Charcoal), sheens matte, eggshell and satin, 6 wallpapers in a few colourways.
- Stored on the structure in build mode (`S.deco`), saved with it, passed to the framing as `spec.deco`.

## Rendering

- A finish is a thin skin 1 to 2 mm proud of the lining, one instanced box per rectangle, in a building's own dollhouse-cut material. Colour per instance; coverage and wetness folded into it (slice 1); a pattern shader for wallpaper (slice 3) from a pattern id and two colours, continuous across rectangles, no textures.
- Two renderers as for seams: the construction view draws coats going on; build mode draws finished paint. One extra draw call per building; buffers rewritten only when something changes or dries. No full-screen pass.

## Slices

1. Paint the walls and the trim by hand, a colour for each per building (shipped).
2. Per-face finishes in Furnish, accent walls, sheen, clear oil on boards, repainting a finished room without it reading as a building site, opening a wall resets its paint.
3. Wallpaper: patterns in the shader, drops, unfurl and smooth, rolls with repeat waste.
4. Polish: cut-in band and W reveal in the shader, litres left in the inspector, touch controls.

## Open questions for the owner

- Should trim-out wait for paint (realistic) or only advise it?
- Default for a new drywall building: Chalk white or bare?
- Drying: about an hour for primer and an hour and a half between paint coats. Three waits per room may drag; one option is that only the primer waits.
