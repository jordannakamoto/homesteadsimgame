// Interior trim for the homestead game: what each trim style is bought as. The pieces and the order they go up in are
// worked out by src/trim.js (the page and the tests read it as globalThis.__trim); these are the items it names, merged
// into the catalog by src/sim/items.js. Real 2026 US retail figures for paint-grade and stain-grade trim, rounded.
export const TRIM_CATEGORIES = Object.freeze([
  { id: 'trim', name: 'Trim', blurb: 'Casing, baseboard, mouldings and what finishes them' },
]);

export const ITEMS_TRIM = Object.freeze([
  // Craftsman: flat fir boards, stain grade
  { id: 'trim_flat_1x4', name: 'Fir trim board 19 x 89 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.089, depthM: 0.019 }, priceUsd: 5.2, blurb: 'Clear, flat stock: Craftsman casing legs' },
  { id: 'trim_flat_1x6', name: 'Fir trim board 19 x 140 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.14, depthM: 0.019 }, priceUsd: 7.8, blurb: 'Wide flat stock: Craftsman heads and baseboard' },
  // Colonial: moulded, primed for paint
  { id: 'casing_colonial', name: 'Colonial casing 16 x 57 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.057, depthM: 0.016 }, priceUsd: 3.4, blurb: 'A moulded profile, mitred at the corners' },
  { id: 'baseboard_primed', name: 'Colonial baseboard 14 x 83 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.083, depthM: 0.014 }, priceUsd: 4.6, blurb: 'Primed, with a moulded top edge' },
  { id: 'shoe_moulding', name: 'Shoe moulding 13 x 19 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.019, depthM: 0.013 }, priceUsd: 1.6, blurb: 'Runs along the foot of the baseboard on a hard floor' },
  { id: 'crown_moulding', name: 'Crown moulding 95 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.095, depthM: 0.014 }, priceUsd: 6.4, blurb: 'Sprung across the corner where wall meets ceiling' },
  // Modern: square-edge MDF
  { id: 'trim_mdf_square', name: 'Square-edge MDF casing 12 x 64 mm', category: 'trim', unit: 'm', material: 'mdf', dims: { widthM: 0.064, depthM: 0.012 }, priceUsd: 2.3, blurb: 'Thin and plain, primed: a picture frame round each window' },
  { id: 'trim_mdf_base', name: 'Square-edge MDF baseboard 12 x 89 mm', category: 'trim', unit: 'm', material: 'mdf', dims: { widthM: 0.089, depthM: 0.012 }, priceUsd: 3.1, blurb: 'A plain, flat baseboard, primed' },
  // Farmhouse: wide rough-sawn pine
  { id: 'trim_rough_1x6', name: 'Rough-sawn pine 22 x 140 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.14, depthM: 0.022 }, priceUsd: 4.4, blurb: 'Wide boards with a sawn face, for casing' },
  { id: 'trim_rough_1x8', name: 'Rough-sawn pine 22 x 184 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.184, depthM: 0.022 }, priceUsd: 5.8, blurb: 'A tall farmhouse baseboard' },
  // under windows, and the finish
  { id: 'window_stool', name: 'Window stool 25 x 90 mm', category: 'trim', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.09, depthM: 0.025 }, priceUsd: 9.5, blurb: 'The shelf at the foot of a window, with a rounded nose' },
  { id: 'trim_paint', name: 'Trim finish kit (paint or oil, caulk, filler)', category: 'trim', unit: 'L', material: 'paint_acrylic', priceUsd: 18, blurb: 'Two coats over the trim, caulk for the seams, filler for the nail holes' },
  { id: 'nails_brad', name: 'Brad nails 18 ga', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 12, blurb: 'Thin finish nails; the holes are filled and painted over' },
]);
