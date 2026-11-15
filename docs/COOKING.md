# Physical cooking prototype

The current kitchen replaces the recipe/button interface with direct manipulation. This is a deliberately narrow carrot, knife, pan and burner prototype. Existing ingredient definitions, hunger, meal inventory, spoilage, legacy recipe commands and saves remain intact; the six old recipes are not exposed as the new physical workflow.

## Play

Press **K** near the kitchen (first use places a starter bench). No cooking buttons or recipe selectors appear.

- Left-drag the carrot, knife or pan. Releasing drops it under gravity. Drag the basket to take another carrot from pantry stock.
- Drag the knife above a carrot, then **hold right mouse while still holding left** to lower the blade. Release right to lift it for another cut. The blade cuts where it crosses the food, rather than triggering a canned chop. Pieces have new closed geometry, independent rigid bodies and conserved mass.
- Drop pieces into the hollow pan. Drag the pan onto any part of the hob, including partly off the burner. Its walls carry the loose ingredients through collision contacts.
- Drag the physical stove dial upward for heat, downward to switch it off. **H** toggles a diagnostic temperature overlay on the pan. Hover food to see temperature and doneness. Normal rendering shows browning without the diagnostic colors.
- Wheel adjusts held-object height. **Esc** leaves; heat continues with world time. Turning off the burner leaves residual pan heat. Handling works while world time is paused; heating does not.
- Drop food onto the plate and press **E** to eat. **Delete** discards hovered food. Eating restores hunger, with a modest bonus for cooked food. Burned/spoiled pieces are refused.

Old saved prepared meals can still be eaten with E when no physical food is selected. M collects a completed legacy batch. Legacy prep ingredients are refunded on entering the new kitchen. The supplier still replenishes carrots.

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
