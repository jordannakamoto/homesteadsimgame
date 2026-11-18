# Flooring: finished floors laid by hand

The last stage of a building, after the lining: what goes under, the floor itself row by row, then the trim. Built on the same hands-on loop as the rest of construction (`docs/CONSTRUCTION.md`): order, stacks, carry, point, set, fasten, learn, sweep.

## What the player can choose

Plan mode's Floor swatches. Every one goes down the way the trade does it:

| Floor | How it goes down |
|---|---|
| Pine floorboards, Oak floorboards, Oak strip | Rosin paper rolled out and stapled (a vapour barrier on a slab), then rows from the far wall, each board slid in and blind-nailed through its tongue (the first row face-nailed by the wall too) |
| Engineered oak, Laminate | Foam underlayment, taped at the seams, then click boards: angled in, dropped, tapped tight. They float |
| Vinyl plank | No underlayment (it has its own pad); click boards as above |
| Terracotta, Porcelain, Marble tile | Cement board set in thinset and screwed down (not on a slab), tiles laid out from the middle of the room so the cuts at both walls match, each buttered, set and beaten in, then grout floated across each row and the haze sponged off |
| Red carpet, Berber carpet | Tack strip nailed round the walls (not across the door), pad rolled out and stapled, carpet unrolled and kicked tight onto the strip with a knee kicker |
| Bare subfloor | Nothing: the deck is the floor (the tool shed) |
| Flagstone, Cobbles, Lawn | One piece, as before |

Every floor then gets baseboard round its walls, broken at the doorways, and an oak threshold under each door.

## The rules the layout follows (src/flooring.js)

- The room is the floor's outline drawn in to the faces of the walls standing on it; open sides (a porch) stay as drawn.
- Boards run along the room's long side (across the joists). A 10-12 mm expansion gap is left at every wall; the baseboard hides it.
- Rows are laid from the start wall. The last row is ripped to fit; a last row under 0.4 of a board is shared with the first, so neither wall gets a sliver.
- End joints sit at least 15 cm from those of the row before, and no end piece is shorter than 20 cm. The cut-off from the end of one row starts the next.
- Tile is set out from the middle of the room (on a joint or half a tile off it, whichever leaves bigger cuts).
- Materials are bought with a tenth extra for cuts; cleats and thinset are used up from the stacks as the work goes on.

## How it plays

- Only the row being laid glows; a blue chalk line marks its leading edge.
- Set (click): a board slides along its row and sits a finger proud; a click board comes in angled; a tile drops onto its bed with a puff of thinset; rolls unroll; grout sweeps along its row; trim slides along the wall.
- Fasten (strike, or hold and drag): nails through the tongue, taps with the block, a rubber-mallet beat, staples, knee kicks, sponge wipes. Each closes the gap or settles the piece a little.
- Boards and tiles cut to fit go through the saw first (tiles on the wet saw), and the cut piece arcs to its place.
- After two of a kind by hand the kind is learned: hold and drag along the row and they go in as you pass.
- Moments: "First row down", "Every tile set", "Floor down".

## Changing a floor

Choosing another floor in Plan mode makes it a new floor to order and lay. The pieces of the old one are gone, and what they used (boards, nails) is spent, so the stage can be ordered again.
