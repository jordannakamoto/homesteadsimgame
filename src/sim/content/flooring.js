// Flooring content for the homestead game: what a finished floor is bought as. The shapes and the order a floor goes
// down in are worked out by src/flooring.js (the page and the tests read it as globalThis.__flooring); these are the
// items it names, merged into the catalog by src/sim/items.js. Real 2026 US retail figures, rounded.
//
// How each kind of floor goes down (docs/FLOORING.md):
//   nail-down boards  rosin paper rolled out and stapled, a chalk line, then board after board from the start wall,
//                     each blind-nailed through its tongue, end joints staggered; the last row ripped to fit
//   floating plank    foam underlayment (none under vinyl with its own pad), then click boards: angle in, drop, tap tight;
//                     the cut-off from the end of one row starts the next
//   tile              cement board screwed down over the subfloor (not on a slab), layout from the middle so the cut
//                     tiles at the walls are even, each tile set in thinset and beaten in, then the joints grouted and
//                     the haze sponged off
//   carpet            tack strip nailed round the walls, pad rolled out and stapled, the carpet unrolled and stretched
//                     onto the tack strip with a knee kicker
//   every floor       baseboard nailed round the walls over the expansion gap, a threshold under each door

export const FLOORING_CATEGORIES = Object.freeze([
  { id: 'flooring', name: 'Flooring', blurb: 'Floorboards, plank, tile and carpet, and what goes under them' },
]);

export const ITEMS_FLOORING = Object.freeze([
  // the finish
  { id: 'floor_oak_strip', name: 'Oak strip flooring 19 x 83 mm', category: 'flooring', unit: 'm2', material: 'oak_seasoned', dims: { thicknessM: 0.019 }, priceUsd: 58, blurb: 'Solid oak, tongue and groove, in random lengths: nailed down board by board' },
  { id: 'floor_engineered', name: 'Engineered oak plank 14 x 190 mm', category: 'flooring', unit: 'm2', material: 'engineered_oak', dims: { thicknessM: 0.014 }, priceUsd: 62, blurb: 'An oak wear layer on a plywood core. Clicks together and floats on foam' },
  { id: 'floor_laminate', name: 'Laminate plank 8 x 195 mm', category: 'flooring', unit: 'm2', material: 'hdf', dims: { thicknessM: 0.008 }, priceUsd: 21, blurb: 'A printed wood look on fibreboard. Clicks together and floats on foam' },
  { id: 'floor_lvp', name: 'Luxury vinyl plank 6 x 180 mm', category: 'flooring', unit: 'm2', material: 'vinyl_plank', dims: { thicknessM: 0.006 }, priceUsd: 34, blurb: 'Waterproof rigid-core vinyl with its own pad. Clicks together' },
  { id: 'tile_terracotta', name: 'Terracotta tile 300 x 300', category: 'flooring', unit: 'm2', material: 'clay_tile', dims: { thicknessM: 0.012 }, priceUsd: 32, blurb: 'Warm fired-clay squares, set in thinset' },
  { id: 'tile_porcelain', name: 'Porcelain tile 600 x 600', category: 'flooring', unit: 'm2', material: 'porcelain', dims: { thicknessM: 0.01 }, priceUsd: 46, blurb: 'Large, hard and stain-proof. Tight joints' },
  { id: 'tile_marble', name: 'Marble tile 300 x 300', category: 'flooring', unit: 'm2', material: 'marble', dims: { thicknessM: 0.01 }, priceUsd: 92, blurb: 'Polished stone squares with hairline joints' },
  { id: 'carpet_cut', name: 'Cut-pile carpet, 12 ft roll', category: 'flooring', unit: 'm2', material: 'carpet', dims: { thicknessM: 0.012 }, priceUsd: 28, blurb: 'Soft broadloom off a 3.66 m roll, stretched over pad' },
  { id: 'carpet_berber', name: 'Wool berber carpet, 12 ft roll', category: 'flooring', unit: 'm2', material: 'carpet', dims: { thicknessM: 0.01 }, priceUsd: 46, blurb: 'Hard-wearing looped wool, stretched over pad' },
  // what goes under it
  { id: 'underlay_rosin', name: 'Rosin paper', category: 'flooring', unit: 'm2', material: 'rosin_paper', dims: { thicknessM: 0.0005 }, priceUsd: 0.45, blurb: 'Red building paper under nailed floors: no squeaks, less draught' },
  { id: 'underlay_foam', name: 'Foam underlayment 2 mm', category: 'flooring', unit: 'm2', material: 'pe_foam', dims: { thicknessM: 0.002 }, priceUsd: 1.6, blurb: 'The soft layer a floating floor rides on' },
  { id: 'carpet_pad', name: 'Rebond carpet pad 11 mm', category: 'flooring', unit: 'm2', material: 'rebond_foam', dims: { thicknessM: 0.011 }, priceUsd: 6, blurb: 'Bonded foam under carpet: softer to walk on and it lasts longer' },
  { id: 'backer_board', name: 'Cement backer board 12 mm (915 x 1525)', category: 'sheet', unit: 'each', material: 'cement_board', dims: { lengthM: 1.525, widthM: 0.915, thicknessM: 0.0127 }, priceUsd: 16, blurb: 'Screwed over a wood subfloor under tile: it will not swell or flex' },
  { id: 'thinset_mortar', name: 'Thinset mortar', category: 'flooring', unit: 'kg', material: 'mortar', priceUsd: 0.9, blurb: 'Combed out with a notched trowel; tile is pressed into it' },
  { id: 'grout_sanded', name: 'Sanded grout', category: 'flooring', unit: 'kg', material: 'mortar', priceUsd: 1.6, blurb: 'Floated into the joints between tiles' },
  { id: 'tack_strip', name: 'Carpet tack strip', category: 'flooring', unit: 'm', material: 'spf_seasoned', dims: { widthM: 0.025, depthM: 0.007 }, priceUsd: 1.1, blurb: 'Wood strips with angled pins: they grip the carpet round the walls' },
  // the edge, where it meets the next floor
  { id: 'threshold_oak', name: 'Oak threshold 915 mm', category: 'flooring', unit: 'each', material: 'oak_seasoned', dims: { lengthM: 0.915, widthM: 0.1, thicknessM: 0.015 }, priceUsd: 26, blurb: 'A low saddle under a door where two floors meet' },
  { id: 'nails_floor', name: 'Flooring cleats', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 9.5, blurb: 'L-shaped nails driven through the tongue at 45 degrees' },
]);
