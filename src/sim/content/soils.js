// Soils and soil amendments for the garden: content records for the generic soil-water model
// (src/sim/core/soilwater.js) and the garden system (src/sim/garden.js).
//
// Soil water: volumetric field capacity and wilting point are the mid-points of the ranges in
// FAO-56 (Allen et al. 1998, Table 19); saturation is total porosity from bulk density (1 - rho / 2.65).
// rewMm is FAO-56's readily evaporable water (Table 19). drainTauH is the time constant for water above
// field capacity to drain out of the root zone: hours in sand, days in clay (approx: USDA hydrologic
// soil groups A to D, saturated conductivity of tens of cm per hour in sand to well under 1 mm per hour in clay).
// Fertility starting values are those of an ordinary, unimproved garden soil of that texture
// (approx: extension soil-test summaries; organic matter rises with clay content).
// limeGPerPh: ground limestone (CaCO3) to raise the top 15 to 20 cm by one pH unit; extension rule of thumb
// "about 2.5 kg per 10 m2 on loam, half on sand, half again on clay" (approx).

export const SOILS = Object.freeze({
  sand: Object.freeze({
    id: 'sand', name: 'Sand', word: 'sandy', fc: 0.12, wp: 0.04, bulkGcm3: 1.6, rewMm: 4, drainTauH: 3,
    ph: 6.0, omPct: 1.0, nMinG: 3, pG: 6, kG: 15, limeGPerPh: 120,
    feel: 'Gritty and loose. It drains fast and dries fast, and needs feeding often.',
  }),
  sandy_loam: Object.freeze({
    id: 'sandy_loam', name: 'Sandy loam', word: 'sandy loam', fc: 0.23, wp: 0.10, bulkGcm3: 1.5, rewMm: 7, drainTauH: 8,
    ph: 6.3, omPct: 2.0, nMinG: 4, pG: 9, kG: 22, limeGPerPh: 180,
    feel: 'A little gritty, holds together when squeezed. Warms early in spring.',
  }),
  loam: Object.freeze({
    id: 'loam', name: 'Loam', word: 'loam', fc: 0.27, wp: 0.12, bulkGcm3: 1.35, rewMm: 9, drainTauH: 20,
    ph: 6.5, omPct: 3.5, nMinG: 5, pG: 11, kG: 30, limeGPerPh: 260,
    feel: 'Crumbly and dark. Holds water but drains well: the gardener\'s soil.',
  }),
  clay_loam: Object.freeze({
    id: 'clay_loam', name: 'Clay loam', word: 'clay loam', fc: 0.33, wp: 0.19, bulkGcm3: 1.3, rewMm: 10, drainTauH: 40,
    ph: 6.8, omPct: 4.0, nMinG: 5, pG: 12, kG: 38, limeGPerPh: 330,
    feel: 'Sticky when wet, cracks when dry. Rich, but slow to warm in spring.',
  }),
  clay: Object.freeze({
    id: 'clay', name: 'Clay', word: 'clay', fc: 0.36, wp: 0.22, bulkGcm3: 1.25, rewMm: 11, drainTauH: 72,
    ph: 7.0, omPct: 4.0, nMinG: 5, pG: 12, kG: 45, limeGPerPh: 400,
    feel: 'Smooth and heavy. Holds water for a long time, and puddles after rain.',
  }),
});
export const DEFAULT_SOIL = 'loam';

// Amendments, per litre as sold (loose volume). Nutrient contents are on a dry-matter basis.
//   Finished compost: bulk about 550 kg/m3 at 45% moisture; N 1.5%, P 0.4%, K 0.8% of dry matter; organic
//   matter about half the dry matter; about 5% of its N is already mineral, and roughly a tenth of the rest becomes
//   available in a temperate first year (releasePerYear is the rate at a steady 20 C, so about half that in practice)
//   (approx: university extension compost guides, e.g. Cornell, Washington State).
//   Aged manure (composted cattle or horse): bulk about 700 kg/m3 at 60% moisture; N 2.0%, P 0.6%, K 1.6% dry;
//   a tenth of its N mineral, about a quarter of the rest available in the first year (approx: extension manure fact sheets).
//   Ground limestone: calcium carbonate, reacting over a couple of months in moist soil.
//   Straw mulch: about 50 kg/m3 loose; a 7.5 cm layer (75 L per m2) is full cover, and it rots down over a season.
export const AMENDMENTS = Object.freeze({
  compost: Object.freeze({ id: 'compost', name: 'Compost', kgPerL: 0.55, moisture: 0.45, nPct: 1.5, pPct: 0.4, kPct: 0.8, omFrac: 0.5, mineralFrac: 0.05, releasePerYear: 0.25, pAvail: 0.5, kAvail: 0.9 }),
  manure: Object.freeze({ id: 'manure', name: 'Aged manure', kgPerL: 0.7, moisture: 0.6, nPct: 2.0, pPct: 0.6, kPct: 1.6, omFrac: 0.6, mineralFrac: 0.1, releasePerYear: 0.5, pAvail: 0.5, kAvail: 0.9 }),
  lime: Object.freeze({ id: 'lime', name: 'Ground limestone', perKg: true, reactTauDays: 60 }),
});
export const MULCH = Object.freeze({ id: 'straw', name: 'Straw mulch', kgPerL: 0.05, fullCoverLPerM2: 75, decayPerYear: 1.6, nPct: 0.6, evapCut: 0.5, weedCut: 0.85 });
