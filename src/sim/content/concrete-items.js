// Store items for poured foundations (forms and their stakes). Kept apart from content/concrete.js so the item catalog
// (src/sim/items.js) can take them without importing the rest of the concrete content.
export const ITEMS_CONCRETE = Object.freeze([
  // a 2x6 on edge holds a 10 cm slab and its base: an 8 ft board, reused (stripped boards go back to stock)
  { id: 'form_board', name: 'Form board, 2 x 6 x 8 ft', category: 'stone', unit: 'each', material: 'spf_seasoned', dims: { lengthM: 2.44, widthM: 0.038, thicknessM: 0.14 }, priceUsd: 8.5, blurb: 'Set on edge along the string line to hold wet concrete to shape and to height. Reusable' },
  // 18 in pointed wooden stakes, driven on the outside of the form every 3 ft and nailed to it
  { id: 'form_stake', name: 'Form stake, 18 in', category: 'stone', unit: 'each', material: 'spf_seasoned', dims: { lengthM: 0.45, widthM: 0.038, thicknessM: 0.038 }, priceUsd: 0.85, blurb: 'Driven outside a form board every 3 ft and nailed to it, so the board cannot bow out under the concrete' },
]);
