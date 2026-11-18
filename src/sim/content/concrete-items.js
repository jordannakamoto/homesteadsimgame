// Store items for poured foundations (forms and their stakes). Kept apart from content/concrete.js so the item catalog
// (src/sim/items.js) can take them without importing the rest of the concrete content.
export const ITEMS_CONCRETE = Object.freeze([
  // a 2x6 on edge holds a 10 cm slab and its base: an 8 ft board, reused (stripped boards go back to stock)
  { id: 'form_board', name: 'Form board, 2 x 6 x 8 ft', category: 'stone', unit: 'each', material: 'spf_seasoned', dims: { lengthM: 2.44, widthM: 0.038, thicknessM: 0.14 }, priceUsd: 8.5, blurb: 'Set on edge along the string line to hold wet concrete to shape and to height. Reusable' },
  // 18 in pointed wooden stakes, driven on the outside of the form every 3 ft and nailed to it
  { id: 'form_stake', name: 'Form stake, 18 in', category: 'stone', unit: 'each', material: 'spf_seasoned', dims: { lengthM: 0.45, widthM: 0.038, thicknessM: 0.038 }, priceUsd: 0.85, blurb: 'Driven outside a form board every 3 ft and nailed to it, so the board cannot bow out under the concrete' },
  // 1/2 in x 10 in J-bolts with a nut and washer, set in the wet slab edge along the sill line so framing can be bolted down
  { id: 'anchor_bolt', name: 'Anchor bolt, 1/2 x 10 in', category: 'fasteners', unit: 'each', material: 'steel', dims: { lengthM: 0.25, widthM: 0.013, thicknessM: 0.013 }, priceUsd: 1.6, blurb: 'Pushed into the wet slab edge every 6 ft along the sill line (and near each corner) so the wall plate can be bolted down' },
  // the finishing hand tools as one kit: bull float, edger, groover, steel trowel and a stiff broom
  { id: 'concrete_finishing_kit', name: 'Concrete finishing kit', category: 'tools_hand', unit: 'each', massKg: 6, priceUsd: 95, blurb: 'Bull float, edger, groover, steel trowel and a stiff broom for finishing a slab' },
  // reusable covers for curing: plastic holds the moisture in, a blanket also keeps the heat in on a cold night
  { id: 'poly_sheeting', name: 'Polyethylene sheeting 6 mil', category: 'tools_hand', unit: 'each', massKg: 4, priceUsd: 28, blurb: 'Laid over a finished slab to hold its moisture in while it cures. Reusable' },
  { id: 'curing_blanket', name: 'Curing blanket', category: 'tools_hand', unit: 'each', massKg: 14, priceUsd: 70, blurb: 'An insulated blanket for curing in the cold: keeps moisture and heat in. Reusable' },
]);
