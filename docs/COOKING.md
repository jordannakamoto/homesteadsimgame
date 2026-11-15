# Physical cooking prototype

The current kitchen replaces the recipe/button interface with direct manipulation. This is a deliberately narrow carrot, knife, pan and burner prototype. Existing ingredient definitions, hunger, meal inventory, spoilage, legacy recipe commands and saves remain intact; the six old recipes are not exposed as the new physical workflow.

## Play

Press **K** near the kitchen (first use places a starter bench). No cooking buttons or recipe selectors appear.

- Click the knife to pick it up, then click where you want to cut. The blade lowers through the carrot and lifts for the next cut. Right-click to set the knife down. Each slice remains a separate physical piece.
- Drag an ingredient to move it, or drag the cutting board or Shift-drag a piece to gather everything on the board at once. Drop the pieces into the pan.
- Drag the pan onto the hob. Partial overlap with the burner changes the heating pattern. Drag the stove dial up for more heat and down to turn it off. A hot pan with food gives off wisps that darken as the food burns. **H** shows the temperature grid.
- While holding the pan, press **Space** to toss and flip the food. The pan steadies briefly for the catch. The raised rim catches more pieces, and setting down the pan lowers it gently.
- Once the food is cooked, drag the pan over the plate and release. The kitchen shows **Meal ready**, and the packed meal goes to **Inventory (I)**. Eat it later from the inventory, or press **E** in the kitchen. **Delete** discards hovered pieces. The plate refuses undercooked, burned or spoiled food.
- **Esc** leaves the kitchen. Heating continues with world time. Turning off the burner leaves residual heat.

**M** collects a completed legacy batch in the kitchen. Legacy prep ingredients are refunded on entering the new kitchen. The supplier replenishes carrots.

## Simulation

`src/sim/food-solid.js` clips convex polygon solids by a plane, constructs closed cap faces, and computes volume. Splitting conserves mass and retains temperature/doneness. Very small slivers are rejected; a kitchen is capped at 32 food pieces.

`src/sim/physical-kitchen.js` owns JSON state and commands. Rapier 0.21 provides gravity, angular motion, convex ingredient colliders, a compound hollow pan and a moving knife at 60 Hz. Held objects are rate-limited kinematic bodies; free bodies are dynamic. Sleeping kitchens skip physics work. The rendering host submits elapsed interaction time through `kitchen.advance`; a future server must own that clock and validate player reach/ownership. This is not networked yet.

The separate 9×9 pan grid receives heat at cells whose underside overlaps the burner at contact height. Neighbor diffusion distributes heat; room losses cool the pan. Food samples nearby pan cells when resting against the pan base. Smaller pieces warm faster. Food temperature drives doneness and burning. Stable thermal substeps run from the existing world clock (72 world seconds per physical heating second, matching 1× game time).

The model is intentionally approximate: each food piece has one temperature, not a volumetric temperature field; contact footprints are approximate. There is no liquid/fluid solver, pouring, stirring tool, fuel consumption or connection to the electrical system yet. No pretense of nutritional or food-safety simulation.

Poses, velocities, cut solids, mass, heat, doneness and spoilage age are saved. Rapier caches are disposable and reconstructed from state. A loaded save releases stale mouse grabs. Warm-start contact caches are not saved, so continuation is not promised to be bit-identical at the rigid-body solver level.

## Validation and cost (2026-11-15)

- 99 tests passed; subsequent main integration changed only docs/STATUS.md. Six new physical-kitchen tests cover closed arbitrary cuts and volume conservation, blade-location slicing, containment and pan transport, partial heat overlap/diffusion/lifting, save recovery, inventory and eating validation.
- Browser smoke uses actual pointer events for knife cutting, piece transfer, pan placement, dial operation and unattended heating; also verifies plating/eating and cut geometry after reload. No cooking buttons are present. Run `node test/cooking.smoke.mjs` (alias of `physical-kitchen.smoke.mjs`) after building; PLAYWRIGHT_MODULE and CHROMIUM_PATH can select local installations.
- Existing page smoke passed Low/High rendering, time controls, build-mode opening, save/reload and no page errors. Local browser paths were substituted and its redundant screenshot skipped.
- `node bench/physical-kitchen.mjs`: 32 whole food bodies plus cookware during settling, median 0.057 ms / p95 1.066 ms per 60 Hz physics step. Thermal update with 32 foods: median 0.501 ms / p95 0.960 ms per world tick. JSON kitchen state in that fixture: 73,597 bytes. Node 24 on the development host; not integrated-GPU FPS measurements.
- Single-file HTML is about 5.75 MB, up roughly 4.4 MB from embedding Rapier's compatibility WASM build. No runtime CDN dependency. A desktop release could ship WASM separately to avoid base64 overhead; that packaging change is outside this prototype.

## Follow-ups

Playtest mouse ergonomics first. Add trackpad/touch controls, clearer hand/knife feedback and sound, safe constrained tilting/pouring, more sliceable ingredient shapes, a physical pot and liquids, and dish recognition from actual contents. Benchmark larger fields and kitchens on target integrated graphics before increasing the active-body cap. The camera still needs occlusion handling inside tight player-built rooms.

### Integration with current main (PR #2)

Preserved thermal, chickens, construction and equipment updates when resolving the system registration conflict. Combined suite: 136/137 passed on the first run; the remaining weather wall-time bound passed in isolation after browser checks finished (2.69 s, versus 2.63 s on unchanged main). Both the general page smoke and physical cooking smoke passed. Cooking smoke now waits, with a bounded timeout, for an edible piece and selects that piece rather than assuming all differently sized pieces finish at a fixed time.
