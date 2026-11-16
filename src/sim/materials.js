// The materials registry: real physical properties in SI units, one record per material.
//
// Units, always: densityKgM3 (kg/m3), conductivityWmK (W/m.K), specificHeatJkgK (J/kg.K),
// bendingStrengthMPa / compressiveStrengthMPa (MPa), elasticModulusGPa (GPa).
//
// Where the numbers come from (each record carries a short `source` tag):
//   - Wood Handbook (USDA Forest Products Laboratory, FPL-GTR-282): clear-wood means at 12 % moisture
//     for the named species (MOR as bending strength, MOE as modulus, compression parallel to grain);
//     density at 12 % is 1.12 x the tabulated oven-dry-mass / 12 %-volume specific gravity.
//   Wood strengths come on two bases, marked by `strengthBasis`: 'clear-wood-mean' (average of small
//   defect-free specimens; far above what a graded board may carry) and 'characteristic' (5th-percentile
//   graded values). Structural code must convert to a design value from the basis, never mix them raw.
//   - EN 338 (softwood strength classes, here C24 for spruce-pine-fir), EN 14080 (glulam GL24h),
//     EN 300 / EN 12369 (OSB, plywood): characteristic grading values, which are lower than clear-wood means.
//   - ISO 10456 / EN 12524 (hygrothermal design values) and ASHRAE Handbook Fundamentals ch. 26
//     (thermal properties of building materials) for conductivity and specific heat of building materials.
//   - Eurocode 2 (concrete C25/30), Eurocode 3 / EN 1993 and EN 10025 (S275 structural steel),
//     EN 998-2 (mortar), EN 12524, ISO 13370 (ground), DIN 4108-4 / Minke "Building with Earth" (unfired earth),
//     manufacturers' published declared values for insulation (EN 13162-13171 declared lambda).
//   - EN 673 (U-values of glazing) for glazing assemblies.
// Values that are typical-product figures rather than a single standard value are marked `approx: true`.
// Never edit a number to "look right": replace it with a handbook value and cite the family above.

const frozen = (o) => Object.freeze(o);

// Specific heat of wood at moisture content mc (kg water / kg dry wood). Dry wood is
// 0.1031 + 0.003867 T kJ/kg.K (Wood Handbook ch. 4) = 1237 J/kg.K at 20 C; the mixture rule adds the water.
const WATER_CP = 4186;
const woodCp = (mc) => Math.round((1237 + WATER_CP * mc) / (1 + mc));
const dens12 = (sg12) => Math.round(sg12 * 1120);                 // Wood Handbook SG at 12 % -> kg/m3 at 12 %
const greenDens = (sgGreen, mc) => Math.round(sgGreen * (1 + mc) * 1000);   // oven-dry mass / green volume, plus water

export const MATERIAL_CLASSES = frozen(['wood', 'masonry', 'metal', 'insulation', 'glass', 'roofing', 'earth', 'membrane', 'fabric', 'fluid']);

const list = [];
const add = (id, name, cls, densityKgM3, conductivityWmK, specificHeatJkgK, extra = {}) => {
  list.push(frozen({ id, name, class: cls, densityKgM3, conductivityWmK, specificHeatJkgK, ...extra }));
};

// ------------------------------------------------------------------ wood (seasoned: 12 % moisture)
add('spf_seasoned', 'Spruce-pine-fir (kiln dried)', 'wood', 420, 0.12, woodCp(0.12), {
  strengthBasis: 'characteristic', bendingStrengthMPa: 24, compressiveStrengthMPa: 21, elasticModulusGPa: 11, source: 'EN 338 C24 characteristic strengths; ISO 10456 wood 0.12-0.13' });
add('douglas_fir', 'Douglas fir', 'wood', dens12(0.48), 0.13, woodCp(0.12), {
  strengthBasis: 'clear-wood-mean', bendingStrengthMPa: 85, compressiveStrengthMPa: 49.9, elasticModulusGPa: 13.4, source: 'Wood Handbook, Douglas-fir (coast), 12 % MC' });
add('western_redcedar', 'Western red cedar', 'wood', dens12(0.32), 0.10, woodCp(0.12), {
  strengthBasis: 'clear-wood-mean', bendingStrengthMPa: 51.7, compressiveStrengthMPa: 31.4, elasticModulusGPa: 7.7, source: 'Wood Handbook, western redcedar, 12 % MC; ISO 10456 (300 kg/m3: 0.10)' });
add('pine_seasoned', 'Pine (seasoned)', 'wood', dens12(0.51), 0.14, woodCp(0.12), {
  strengthBasis: 'clear-wood-mean', bendingStrengthMPa: 88.3, compressiveStrengthMPa: 49.2, elasticModulusGPa: 12.3, source: 'Wood Handbook, loblolly pine, 12 % MC; ISO 10456' });
add('birch_seasoned', 'Birch (seasoned)', 'wood', dens12(0.62), 0.16, woodCp(0.12), {
  strengthBasis: 'clear-wood-mean', bendingStrengthMPa: 114.5, compressiveStrengthMPa: 56.3, elasticModulusGPa: 13.9, source: 'Wood Handbook, yellow birch, 12 % MC; ISO 10456' });
add('oak_seasoned', 'Oak (seasoned)', 'wood', dens12(0.68), 0.18, woodCp(0.12), {
  strengthBasis: 'clear-wood-mean', bendingStrengthMPa: 104.3, compressiveStrengthMPa: 51.3, elasticModulusGPa: 12.3, source: 'Wood Handbook, white oak, 12 % MC; ISO 10456 (700 kg/m3: 0.18)' });

// Green logs: density is the green specific gravity times (1 + mean moisture content), so a freshly
// felled log is far heavier than the same wood once seasoned. Moisture contents are Wood Handbook
// ch. 4 means (pine 80 %, between heartwood 33 % and sapwood 110 %; yellow birch 73 %; white oak 70 %).
// Green strength is not tabulated here: use the seasoned species (`seasonedId`) once dry.
add('log_pine_green', 'Pine log (green)', 'wood', greenDens(0.47, 0.8), 0.2, woodCp(0.8), {
  seasonedId: 'pine_seasoned', approx: true, source: 'Wood Handbook green SG 0.47 and mean MC; conductivity of wet wood is an estimate' });
add('log_birch_green', 'Birch log (green)', 'wood', greenDens(0.55, 0.73), 0.2, woodCp(0.73), {
  seasonedId: 'birch_seasoned', approx: true, source: 'Wood Handbook green SG 0.55 and mean MC; conductivity of wet wood is an estimate' });
add('log_oak_green', 'Oak log (green)', 'wood', greenDens(0.6, 0.7), 0.2, woodCp(0.7), {
  seasonedId: 'oak_seasoned', approx: true, source: 'Wood Handbook green SG 0.60 and mean MC; conductivity of wet wood is an estimate' });

// ------------------------------------------------------------------ engineered wood
add('plywood', 'Plywood', 'wood', 500, 0.13, 1600, {
  strengthBasis: 'characteristic', bendingStrengthMPa: 24, compressiveStrengthMPa: 18, elasticModulusGPa: 6, approx: true, source: 'ISO 10456 plywood 500 kg/m3; strengths are nominal softwood-ply values (EN 12369-2 family)' });
add('osb', 'OSB', 'wood', 650, 0.13, 1700, {
  strengthBasis: 'characteristic', bendingStrengthMPa: 18, compressiveStrengthMPa: 15, elasticModulusGPa: 4.93, source: 'ISO 10456 OSB 650 kg/m3; EN 300 OSB/3 major-axis bending and modulus' });
add('glulam', 'Glulam (GL24h)', 'wood', 420, 0.12, woodCp(0.12), {
  strengthBasis: 'characteristic', bendingStrengthMPa: 24, compressiveStrengthMPa: 24, elasticModulusGPa: 11.5, source: 'EN 14080 GL24h; mean density 420' });

// ------------------------------------------------------------------ masonry and concrete
add('concrete', 'Concrete (C25/30)', 'masonry', 2400, 2.0, 1000, {
  compressiveStrengthMPa: 25, elasticModulusGPa: 31, source: 'Eurocode 2 C25/30 (fck 25, Ecm 31); ISO 10456 2400 kg/m3: 2.0' });
add('brick_clay', 'Clay brick', 'masonry', 1700, 0.84, 800, {
  compressiveStrengthMPa: 20, source: 'CIBSE Guide A / ASHRAE outer-leaf brick; compressive strength is a typical common-brick value', approx: true });
add('mortar', 'Cement mortar (M5)', 'masonry', 1800, 1.0, 1000, {
  compressiveStrengthMPa: 5, source: 'ISO 10456 cement mortar 1800 kg/m3; EN 998-2 class M5' });
add('granite', 'Granite / fieldstone', 'masonry', 2700, 2.8, 1000, {
  compressiveStrengthMPa: 150, elasticModulusGPa: 55, source: 'ISO 10456 granite; compressive strength and modulus typical (100-250 MPa, 50-60 GPa)' });
add('limestone', 'Limestone (hard)', 'masonry', 2200, 1.7, 1000, {
  compressiveStrengthMPa: 60, source: 'ISO 10456 hard limestone 2200 kg/m3; compressive strength typical', approx: true });
add('sandstone', 'Sandstone', 'masonry', 2600, 2.3, 1000, {
  compressiveStrengthMPa: 70, source: 'ISO 10456 sandstone 2600 kg/m3; compressive strength typical (30-150 MPa)', approx: true });
add('marble', 'Marble', 'masonry', 2800, 3.5, 1000, {
  compressiveStrengthMPa: 100, elasticModulusGPa: 55, source: 'ISO 10456 marble 2800 kg/m3; strength typical', approx: true });
add('gypsum_board', 'Gypsum board', 'masonry', 700, 0.21, 1000, {
  source: 'ISO 10456 gypsum plasterboard 700 kg/m3' });
add('lime_plaster', 'Lime plaster', 'masonry', 1600, 0.8, 1000, {
  source: 'ISO 10456 lime plaster 1600 kg/m3' });

// ------------------------------------------------------------------ unfired earth (DIN 4108-4 / Minke)
add('cob', 'Cob', 'earth', 1500, 0.66, 1000, { compressiveStrengthMPa: 1.5, approx: true, source: 'Interpolated from unstabilised loam 1400: 0.59, 1600: 0.73 (Minke); strength typical' });
add('adobe', 'Adobe brick', 'earth', 1800, 0.91, 1000, { compressiveStrengthMPa: 2.5, approx: true, source: 'Unstabilised loam 1800 kg/m3: 0.91 (DIN 4108-4, Minke); strength typical' });
add('rammed_earth', 'Rammed earth', 'earth', 2000, 1.1, 1000, { compressiveStrengthMPa: 3, approx: true, source: 'Unstabilised loam 2000 kg/m3: 1.1 (DIN 4108-4, Minke); strength typical (2-4 MPa)' });
add('soil_dry', 'Soil (dry)', 'earth', 1500, 0.35, 800, { approx: true, source: 'Dry loam: mineral specific heat 800; conductivity typical of dry soil (0.25-0.4)' });
add('soil_moist', 'Soil (moist)', 'earth', 1900, 1.5, 1300, { source: 'ISO 13370 clay or silt ground 1.5; specific heat by mixture (85 % mineral 800 + 15 % water 4186)' });
add('gravel', 'Gravel', 'earth', 1700, 0.81, 1000, { source: 'ISO 10456 gravel, bulk 1700 kg/m3' });

// ------------------------------------------------------------------ metals
add('steel', 'Structural steel (S275)', 'metal', 7850, 50, 450, {
  bendingStrengthMPa: 275, compressiveStrengthMPa: 275, elasticModulusGPa: 210, source: 'EN 1993 / EN 10025 S275 (yield); ISO 10456 steel' });
add('aluminium', 'Aluminium (6061-T6)', 'metal', 2700, 167, 896, {
  bendingStrengthMPa: 276, compressiveStrengthMPa: 276, elasticModulusGPa: 68.9, source: 'ASM data sheet 6061-T6 (yield 276 MPa)' });
add('copper', 'Copper', 'metal', 8900, 380, 380, {
  elasticModulusGPa: 120, source: 'ISO 10456 copper 8900 kg/m3: 380; modulus of sheet copper' });

// ------------------------------------------------------------------ insulation
add('mineral_wool', 'Mineral wool batt', 'insulation', 30, 0.037, 840, { source: 'Declared lambda 0.035-0.040 (EN 13162); ISO 10456 mineral wool cp 840' });
add('fibreglass_batt', 'Fibreglass batt', 'insulation', 12, 0.04, 840, { source: 'ASHRAE: R-3.5 per inch (0.041 W/m.K) at 12 kg/m3; cp 840' });
add('cellulose', 'Cellulose (dense-pack)', 'insulation', 50, 0.04, 1600, { source: 'ASHRAE: R-3.7 per inch (0.039 W/m.K); ISO 10456 cellulose cp 1600' });
add('eps', 'EPS foam board', 'insulation', 18, 0.038, 1450, { source: 'EN 13163 declared lambda 0.036-0.040; ISO 10456 cp 1450' });
add('xps', 'XPS foam board', 'insulation', 35, 0.034, 1450, { source: 'EN 13164 declared lambda 0.034; ISO 10456 cp 1450' });
add('polyiso', 'Polyiso foam board', 'insulation', 32, 0.024, 1400, { source: 'ASHRAE R-6 per inch (0.024 W/m.K); ISO 10456 PIR cp 1400' });
add('sheep_wool', "Sheep's wool batt", 'insulation', 25, 0.039, 1720, { source: 'Declared lambda 0.038-0.040 (EN 13171 products); cp 1720 per manufacturers', approx: true });
add('straw_bale', 'Straw bale', 'insulation', 100, 0.06, 2000, { source: 'Published whole-bale lambda 0.052-0.080 (0.06 used); density 90-110; cp typical for straw', approx: true });

// ------------------------------------------------------------------ glass and glazing
add('float_glass', 'Float glass', 'glass', 2500, 1.0, 750, {
  strengthBasis: 'characteristic', bendingStrengthMPa: 45, compressiveStrengthMPa: 1000, elasticModulusGPa: 70, source: 'EN 572-1 soda-lime glass; EN 16612 annealed characteristic bending 45 MPa' });
// Glazing assemblies: conductivity is the effective value (U x thickness) and density the mass per
// area over the overall thickness; use uValueWm2K for heat-loss sums.
add('dgu', 'Double glazing unit (4-12-4 air)', 'glass', 1000, 0.056, 750, {
  thicknessM: 0.02, uValueWm2K: 2.8, source: 'EN 673 centre-of-glass U 2.8 W/m2.K for clear 4-12-4 air; two 4 mm panes' });
add('dgu_lowe', 'Double glazing, low-e argon (4-16-4)', 'glass', 833, 0.0264, 750, {
  thicknessM: 0.024, uValueWm2K: 1.1, source: 'EN 673 centre-of-glass U 1.1 W/m2.K for 4-16-4 argon, low-e coating' });
add('polycarbonate', 'Polycarbonate sheet', 'glass', 1200, 0.2, 1200, {
  elasticModulusGPa: 2.4, source: 'ISO 10456 polycarbonate 1200 kg/m3: 0.20; cp 1200' });

// ------------------------------------------------------------------ roofing
add('asphalt_shingle', 'Asphalt shingle', 'roofing', 1500, 0.17, 1000, { approx: true, source: 'ISO 10456 bitumen-based 0.17; effective density from ~10.5 kg/m2 at 7 mm (two-layer coverage)' });
add('steel_roofing', 'Steel roofing (galvanised)', 'roofing', 7850, 50, 450, { elasticModulusGPa: 200, source: 'ISO 10456 steel; coated sheet' });
add('cedar_shake', 'Cedar shake', 'roofing', dens12(0.32), 0.1, woodCp(0.12), { source: 'Wood Handbook western redcedar; ISO 10456 300 kg/m3: 0.10' });
add('thatch', 'Thatch (water reed)', 'roofing', 160, 0.09, 1300, { approx: true, source: 'Published reed/straw thatch lambda ~0.09; density 100-200 (Historic England guidance)' });
add('slate', 'Slate', 'roofing', 2800, 2.2, 1000, { source: 'ISO 10456 slate 2800 kg/m3: 2.2' });
add('epdm', 'EPDM membrane', 'roofing', 1150, 0.25, 1000, { source: 'ISO 10456 EPDM 1150 kg/m3: 0.25' });
add('clay_tile', 'Clay tile', 'roofing', 1900, 0.8, 800, { compressiveStrengthMPa: 30, approx: true, source: 'ISO 10456 fired clay tile 2000: 1.0 / 1700: 0.8; ASHRAE clay cp 0.8 kJ/kg.K' });

// ------------------------------------------------------------------ membranes, fabric
add('housewrap', 'Housewrap (spunbonded HDPE)', 'membrane', 950, 0.5, 1900, { source: 'High-density polyethylene (ISO 10456 / ASHRAE plastics); thin film, thermally negligible' });
add('poly_vapour_barrier', 'Polyethylene vapour barrier', 'membrane', 920, 0.33, 2300, { source: 'Low-density polyethylene (ISO 10456: 0.33)' });
add('canvas', 'Canvas (cotton duck)', 'fabric', 500, 0.07, 1300, { approx: true, source: 'Cotton fabric ~400 g/m2 at 0.8 mm; cotton cp 1300; conductivity typical of dry fabric' });
add('carpet', 'Wool carpet', 'fabric', 200, 0.06, 1300, { approx: true, source: 'CIBSE/ASHRAE carpet and underlay ~0.06; wool cp ~1300' });

// ------------------------------------------------------------------ fluids
add('water', 'Water', 'fluid', 998, 0.6, 4186, { source: 'Properties of water at 20 C (IAPWS)' });
add('air', 'Air (still)', 'fluid', 1.204, 0.0257, 1006, { source: 'Dry air at 20 C, 101.325 kPa (ASHRAE Fundamentals ch. 1)' });

export const MATERIALS = frozen(Object.fromEntries(list.map((m) => [m.id, m])));

// Look up a material by registry id. Returns undefined for an unknown id.
export const material = (id) => MATERIALS[id];

// Thermal resistance in m2.K/W (RSI) of a layer, or of a glazing assembly if it declares a U-value.
export function rValue(id, thicknessM) {
  const m = MATERIALS[id];
  if (!m) return NaN;
  if (m.uValueWm2K) return 1 / m.uValueWm2K;
  return thicknessM / m.conductivityWmK;
}
// RSI of 100 mm of the material (the player-facing "R per 100 mm").
export const rValuePer100mm = (id) => rValue(id, 0.1);
// Volumetric heat capacity, J/m3.K.
export const volumetricHeatCapacity = (id) => MATERIALS[id].densityKgM3 * MATERIALS[id].specificHeatJkgK;

// ------------------------------------------------------------------ build mode appearance names
// Every wall, floor, roof and path surface name used in src/build.js (the WALLS, FLOORS, ROOFS and
// PATHS tables) mapped to a registry material. build.js uses the same short name in more than one
// table (dark, tile, cobble, stone); every such pair is deliberately mapped to the same material.
export const APPEARANCE_BY_KIND = frozen({
  wall: frozen({
    timber: 'spf_seasoned', batten: 'spf_seasoned', stone: 'granite', plaster: 'lime_plaster', dark: 'oak_seasoned', brick: 'brick_clay',
    halftimber: 'lime_plaster', sandstone: 'sandstone', whitestone: 'limestone', mossy: 'granite', log: 'pine_seasoned',
  }),
  floor: frozen({
    planks: 'pine_seasoned', flags: 'sandstone', dark: 'oak_seasoned', tile: 'clay_tile',
    marble: 'marble', cobble: 'granite', carpet: 'carpet', moss: 'soil_moist',
  }),
  roof: frozen({
    thatch: 'thatch', slate: 'slate', tile: 'clay_tile', shingle: 'cedar_shake', copper: 'copper', redslate: 'slate',
  }),
  path: frozen({ cobble: 'granite', dirt: 'soil_dry', gravel: 'gravel', boards: 'western_redcedar' }),
});
export const APPEARANCE_MATERIAL = frozen(Object.assign({}, ...Object.values(APPEARANCE_BY_KIND)));
// Material for a build-mode appearance name; pass the kind ("wall" | "floor" | "roof" | "path") when known.
export function appearanceMaterial(name, kind) {
  const id = kind ? APPEARANCE_BY_KIND[kind] && APPEARANCE_BY_KIND[kind][name] : APPEARANCE_MATERIAL[name];
  return id ? MATERIALS[id] : undefined;
}
