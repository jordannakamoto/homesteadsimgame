// The electrical catalog: real equipment with typical datasheet ratings and 2026 US retail prices
// (rounded game prices, not quotes). Shape per ARCHITECTURE.md "Fixtures and connections":
//   id -> { id, name, noun, category, system: "electrical", ports, priceUsd, massKg, dims: { w, d, h }, ...ratings }
// Ratings are SI or the unit in the field name. Where a value comes from a named product class it says
// so; everything else is a typical value of current datasheets for that kind of equipment.
//
// Ports carry a `bus` the solver uses to tell the sides of a system apart:
//   "pv"  panel side of a charge controller (array voltage, DC)
//   "dc"  battery bus (12, 24 or 48 V nominal)
//   "ac"  inverter or generator output (120 V, or 120/240 V split phase)
//   none  a load or a junction: it takes whatever bus it is wired to
// Fixtures with role "junction" join all their ports into one node (busbars, breaker panels).
// Breakers have role "breaker": two ports, joined until the breaker trips.

import { ITEMS } from './items.js';

const list = [];
const add = (e) => list.push(Object.freeze({ system: 'electrical', ...e, ports: Object.freeze(e.ports.map((p) => Object.freeze({ type: 'power', ...p }))) }));
const dims = (w, d, h) => ({ w, d, h });

// ---------------------------------------------------------------- solar panels
// Ratings at STC (1000 W/m2, 25 C cell, AM1.5). tempCoeffPmaxPerC is the fractional change of
// maximum power per degree of cell temperature; NOCT is the cell temperature at 800 W/m2, 20 C air,
// 1 m/s wind. Typical crystalline-silicon datasheet values.
const panel = (id, name, ratedW, vmpV, impA, vocV, iscA, tc, noct, w, d, h, massKg, priceUsd, blurb) => add({
  id, name, noun: 'solar panel', category: 'solar_panel', ports: [{ id: 'pv', bus: 'pv' }], priceUsd, massKg, dims: dims(w, d, h),
  ratedW, vmpV, impA, vocV, iscA, tempCoeffPmaxPerC: tc, tempCoeffVocPerC: -0.0028, noctC: noct, areaM2: w * d, blurb,
});
panel('panel_100w_12v', '100 W 12 V solar panel', 100, 18.0, 5.56, 21.6, 5.95, -0.0037, 45, 1.05, 0.54, 0.035, 6.5, 85,
  'A 36-cell "12 volt" panel. Small, light, fits a van roof or a shed.');
panel('panel_200w_12v', '200 W 12 V solar panel', 200, 20.0, 10.0, 24.0, 10.6, -0.0035, 45, 1.48, 0.67, 0.035, 11, 160,
  'The usual van and cabin panel.');
panel('panel_400w', '400 W residential solar panel', 400, 31.0, 12.9, 37.0, 13.8, -0.0034, 44, 1.722, 1.134, 0.03, 21.5, 210,
  'A 108 half-cell house panel. Too high a voltage for PWM on 12 V; use MPPT.');

// ---------------------------------------------------------------- mounts
// A panel takes its tilt and azimuth from its own settings, else from the mount it names in
// settings.mount, else the mount's defaults. azimuthDeg is clockwise from north (180 = south).
const mount = (id, name, tiltDeg, adjustable, maxPanels, priceUsd, massKg, blurb) => add({
  id, name, noun: 'panel mount', category: 'solar_mount', ports: [], priceUsd, massKg, dims: dims(1.2, 0.2, 0.1),
  defaultSettings: { tiltDeg, azimuthDeg: 180 }, tiltRangeDeg: adjustable ? [0, 75] : [tiltDeg, tiltDeg], adjustable, maxPanels, blurb,
});
mount('mount_van_flat', 'Flat roof-rack mount (van)', 0, false, 2, 60, 3, 'Panels lie flat on the roof. Easy, but poor in winter and snow stays on.');
mount('mount_roof_flush', 'Flush roof mount', 25, true, 4, 120, 6, 'Rails on the roof; the panel takes the roof pitch.');
mount('mount_ground', 'Adjustable ground mount', 40, true, 4, 350, 40, 'Steel frame on the ground. Tilt it steeper for winter.');
mount('mount_pole', 'Pole mount', 45, true, 2, 450, 35, 'Raised clear of snow and shade, turns to face the sun.');

// ---------------------------------------------------------------- charge controllers
// MPPT: converts array power at its efficiency (typical 96 to 98 %), needs the array voltage above
// the battery (Victron rule: battery + 5 V to start, + 1 V to keep running). PWM: connects the array
// straight to the battery, so the array works at battery voltage and the difference is lost.
const ctrl = (id, name, type, maxOutputA, maxPvV, systemV, efficiency, priceUsd, massKg, blurb) => add({
  id, name, noun: 'charge controller', category: 'charge_controller',
  ports: [{ id: 'pv', bus: 'pv' }, { id: 'bat', bus: 'dc' }], priceUsd, massKg, dims: dims(0.13, 0.07, 0.19),
  type, maxOutputA, maxPvV, systemV, efficiency, blurb,
});
ctrl('cc_pwm_30a', 'PWM charge controller 30 A', 'pwm', 30, 50, [12, 24], 0.98, 30, 0.4, 'Cheap. Fine for a 12 V panel on a 12 V battery, wasteful otherwise.');
ctrl('cc_mppt_30a', 'MPPT charge controller 100/30', 'mppt', 30, 100, [12, 24], 0.97, 140, 1.3, 'Victron SmartSolar 100/30 class.');
ctrl('cc_mppt_60a', 'MPPT charge controller 150/60', 'mppt', 60, 150, [12, 24, 48], 0.97, 380, 3.0, 'Victron SmartSolar 150/60 class.');
ctrl('cc_mppt_100a', 'MPPT charge controller 250/100', 'mppt', 100, 250, [12, 24, 48], 0.97, 700, 4.5, 'Victron SmartSolar 250/100 class.');

// ---------------------------------------------------------------- batteries
// usableFraction: the share of rated capacity the system lets you use (50 % depth of discharge is the
// usual rule for lead-acid life; LiFePO4 is rated for 80 to 100 %). Round trip = chargeEff x dischargeEff:
// AGM 0.86 x 0.95 = 0.82, LiFePO4 0.975 x 0.975 = 0.95. C-rates are the continuous limits of typical
// datasheets (and of the BMS for lithium). Self-discharge per month at 25 C. ocv: open-circuit voltage
// against state of charge for one 12 V block (scaled for higher voltages).
const OCV_AGM = [[0, 11.8], [0.25, 12.0], [0.5, 12.2], [0.75, 12.5], [1, 12.85]];
const OCV_LFP = [[0, 10.8], [0.1, 12.8], [0.2, 13.0], [0.5, 13.15], [0.8, 13.3], [0.95, 13.4], [1, 13.6]];
const battery = (id, name, chem, nominalV, ah, usable, ce, de, chC, disC, sdPerMonth, priceUsd, massKg, d, extra, blurb) => add({
  id, name, noun: 'battery', category: 'battery', ports: [{ id: 'dc', bus: 'dc' }], priceUsd, massKg, dims: d,
  chemistry: chem, nominalV, capacityAh: ah, capacityWh: nominalV * ah, usableFraction: usable, chargeEff: ce, dischargeEff: de,
  maxChargeC: chC, maxDischargeC: disC, selfDischargePerMonth: sdPerMonth,
  ocv: (chem === 'agm' ? OCV_AGM : OCV_LFP).map(([s, v]) => [s, (v * nominalV) / (chem === 'agm' ? 12 : 12.8)]),
  ...extra, blurb,
});
battery('bat_agm_12v_100ah', '12 V 100 Ah AGM battery', 'agm', 12, 100, 0.5, 0.86, 0.95, 0.2, 0.5, 0.03, 230, 30, dims(0.33, 0.17, 0.22),
  { shipSoc: 1, minChargeTempC: -20 }, 'Lead-acid. Heavy, cheap, only half of it is usable.');
battery('bat_lfp_12v_100ah', '12 V 100 Ah LiFePO4 battery', 'lfp', 12.8, 100, 0.9, 0.975, 0.975, 0.5, 1.0, 0.02, 250, 11, dims(0.33, 0.17, 0.22),
  { shipSoc: 0.5, minChargeTempC: 0 }, 'Lithium iron phosphate. Light, efficient, must not be charged below 0 C.');
battery('bat_lfp_48v_5kwh', '48 V 5 kWh LiFePO4 rack battery', 'lfp', 51.2, 100, 0.9, 0.975, 0.975, 0.5, 1.0, 0.02, 1300, 45, dims(0.44, 0.5, 0.18),
  { shipSoc: 0.5, minChargeTempC: 0 }, 'Server-rack lithium for a whole house. Stack several.');

// ---------------------------------------------------------------- inverters
// Losses follow loss(P) = idleW + k1 P + k2 P^2 (the usual inverter loss model), fitted exactly to
// the idle draw and to the efficiency at half and full rated output.
const inverter = (id, name, dcV, ratedW, surgeW, idleW, eff50, eff100, acV, splitPhase, charger, priceUsd, massKg, d, blurb) => {
  const L50 = 0.5 * ratedW * (1 / eff50 - 1) - idleW, L100 = ratedW * (1 / eff100 - 1) - idleW;
  const k2 = (2 * (L100 - 2 * L50)) / (ratedW * ratedW), k1 = (L100 - k2 * ratedW * ratedW) / ratedW;
  add({ id, name, noun: charger ? 'inverter-charger' : 'inverter', category: 'inverter', ports: [{ id: 'dc', bus: 'dc' }, { id: 'ac', bus: 'ac' }],
    priceUsd, massKg, dims: d, dcV, ratedW, surgeW, idleW, eff50, eff100, lossK1: k1, lossK2: k2, acV, splitPhase, charger, blurb });
};
inverter('inv_12v_1000w', '12 V 1000 W pure sine inverter', 12, 1000, 2000, 10, 0.9, 0.87, 120, false, null, 250, 3.5, dims(0.35, 0.2, 0.09),
  'Runs 120 V lights, a laptop, small tools. No charger.');
inverter('inv_48v_3000w', '48 V 3000 W inverter-charger', 48, 3000, 5500, 25, 0.945, 0.925, 120, false, { acW: 2000, eff: 0.92 }, 1400, 20, dims(0.36, 0.13, 0.55),
  'Victron MultiPlus-II 48/3000 class. Charges the battery from a generator.');
inverter('inv_48v_6000w', '48 V 6000 W split-phase inverter-charger', 48, 6000, 12000, 50, 0.93, 0.91, 120, true, { acW: 5000, eff: 0.92 }, 1800, 30, dims(0.5, 0.2, 0.7),
  '120/240 V for a whole house, a well pump included.');

// ---------------------------------------------------------------- generators
// Fuel use follows a Willans line, litres per hour = idleLph + lPerKWh x kW, fitted to the maker's run
// times. Honda EU2200i datasheet: 3.6 L tank, 3.2 h at rated 1800 W, 8.1 h at quarter load. Honda
// EU7000is datasheet: 19.2 L tank, 6.5 h at rated 5500 W, 18 h at quarter load. That gives about
// 0.75 and 0.62 L/kWh at half load: small petrol sets are thirstier per kWh than large ones.
const generator = (id, name, ratedW, surgeW, tankL, hoursRated, hoursQuarter, acV, splitPhase, priceUsd, massKg, d, blurb) => {
  const full = tankL / hoursRated, quarter = tankL / hoursQuarter;
  const lPerKWh = (full - quarter) / (0.75 * ratedW / 1000), idleLph = quarter - lPerKWh * 0.25 * ratedW / 1000;
  add({ id, name, noun: 'generator', category: 'generator', ports: [{ id: 'ac', bus: 'ac' }], priceUsd, massKg, dims: d,
    ratedW, surgeW, tankL, fuel: 'petrol', idleLph, lPerKWh, acV, splitPhase, blurb,
    sfcHalfLoadLPerKWh: (idleLph + lPerKWh * 0.5 * ratedW / 1000) / (0.5 * ratedW / 1000) });
};
generator('gen_petrol_2kw', '2 kW petrol inverter generator', 1800, 2200, 3.6, 3.2, 8.1, 120, false, 1200, 21, dims(0.51, 0.29, 0.43),
  'Quiet, portable. Honda EU2200i class.');
generator('gen_petrol_5500w', '5.5 kW petrol inverter generator', 5500, 7000, 19.2, 6.5, 18, 120, true, 4500, 118, dims(0.71, 0.64, 0.73),
  '120/240 V on wheels. Honda EU7000is class.');

// ---------------------------------------------------------------- distribution
const junction = (id, name, n, extra, priceUsd, massKg, d, blurb) => add({
  id, name, noun: extra.noun, category: extra.category, role: 'junction',
  ports: [{ id: 'main' }, ...Array.from({ length: n }, (_, i) => ({ id: 'b' + (i + 1) }))], priceUsd, massKg, dims: d, ...extra, blurb,
});
junction('panel_ac_100a', '100 A breaker panel (120/240 V)', 20, { noun: 'breaker panel', category: 'breaker_panel', mainA: 100 }, 180, 9, dims(0.36, 0.1, 0.6),
  'Where the house circuits start. Put a breaker on each branch.');
junction('panel_dc_12', '12-circuit DC fuse block', 12, { noun: 'DC fuse block', category: 'breaker_panel', mainA: 100 }, 45, 0.5, dims(0.2, 0.05, 0.12),
  'Distribution for 12 V lights, fridge and sockets.');
junction('busbar_dc', 'DC busbar (250 A)', 6, { noun: 'busbar', category: 'busbar', mainA: 250 }, 40, 0.6, dims(0.2, 0.05, 0.05),
  'Joins battery, controller and inverter cables.');
// A box in a wall where cables meet (a switch box is one too, electrically). fitted: services put it in, Equip does not.
junction('box_junction', 'Electrical box', 0, { noun: 'electrical box', category: 'junction_box', mainA: 30, fitted: true }, 2, 0.1, dims(0.05, 0.07, 0.1),
  'Where cables in a wall meet or pass a device.');
// Breakers: thermal-magnetic, rated for AC and low-voltage DC. Trip times follow the conventional
// currents of IEC 60898 / UL 489: no trip below 1.13 x rating, trip within an hour at 1.45 x, about
// two minutes at 2 x, seconds at 3 x, instantly (magnetic) at 5 x and above.
const breaker = (id, ratingA, priceUsd, dcOnly) => add({
  id, name: (dcOnly ? 'DC breaker ' : 'Breaker ') + ratingA + ' A', noun: 'breaker', category: 'breaker', role: 'breaker',
  ports: [{ id: 'line' }, { id: 'load' }], priceUsd, massKg: dcOnly ? 0.4 : 0.15, dims: dims(0.02, 0.07, 0.09), ratingA,
  blurb: 'Trips when the circuit draws more than ' + ratingA + ' A for too long.',
});
breaker('breaker_15a', 15, 12); breaker('breaker_20a', 20, 12); breaker('breaker_30a', 30, 18);
breaker('breaker_dc_60a', 60, 35, true); breaker('breaker_dc_150a', 150, 60, true);

// ---------------------------------------------------------------- wire
// Copper conductors. ampacityA: NEC Table 310.16, 75 C column, copper, with the small-conductor limits
// of NEC 240.4(D) (14 AWG 15 A, 12 AWG 20 A, 10 AWG 30 A). Resistance per metre of one conductor is
// computed, not typed: AWG diameter d = 0.127 mm x 92^((36 - n) / 39), annealed copper (IACS)
// 1.7241e-8 ohm m at 20 C, corrected to 75 C with alpha 0.00393 /C; this lands within about 2 % of
// NEC Chapter 9 Table 8 (which adds stranding). priceUsdPerM is for a run of two conductors.
const RHO20 = 1.7241e-8, ALPHA = 0.00393, T_WIRE = 75;
export const awgDiameterM = (n) => 0.000127 * Math.pow(92, (36 - n) / 39);
const wire = (label, n, ampacityA, priceUsdPerM) => {
  const areaM2 = Math.PI * awgDiameterM(n) ** 2 / 4;
  add({ id: 'wire_awg' + label.replace('/', '_'), name: label + ' AWG copper wire', noun: 'wire', category: 'wire', ports: [], priceUsd: priceUsdPerM,
    priceUsdPerM, massKg: 2 * areaM2 * 8960, dims: dims(0.01, 0.01, 1), gaugeAwg: label, awgNumber: n, areaMm2: areaM2 * 1e6,
    ohmPerM: (RHO20 * (1 + ALPHA * (T_WIRE - 20))) / areaM2, ampacityA });
};
wire('14', 14, 15, 0.9); wire('12', 12, 20, 1.3); wire('10', 10, 30, 2.3); wire('8', 8, 50, 4);
wire('6', 6, 65, 6); wire('4', 4, 85, 9); wire('2', 2, 115, 14); wire('1/0', 0, 150, 20); wire('2/0', -1, 175, 25);

// ---------------------------------------------------------------- loads
// supply: "ac" (needs the inverter or a generator), "dc" (12 V device; dcV lists the bus voltages it
// takes), "any" (resistive or dual-voltage: a 12 V and a 120 V version exist at the same wattage).
// priority: higher is kept longer when power runs short (10 = never shed first). duty: "fridge" cycles
// with the temperature around it; others run while on unless settings.dutyFraction says otherwise.
const load = (id, name, noun, ratedW, supply, priority, priceUsd, massKg, d, extra = {}, blurb) => add({
  id, name, noun, category: extra.category || 'load', ports: [{ id: 'power' }], priceUsd, massKg, dims: d, ratedW, supply, priority, voltageV: 120, ...extra, blurb,
});
load('light_led_9w', 'LED light 9 W', 'light', 9, 'any', 8, 6, 0.1, dims(0.06, 0.06, 0.11), {}, 'As bright as an old 60 W bulb. 12 V and 120 V versions.');
// 12 V compressor fridge, about 45 L (Dometic CFX3 45 class): 45 W running, about 0.9 Ah per hour at
// 25 C (a 25 % duty cycle), rising about 4 % per degree warmer around it.
load('fridge_12v', '12 V compressor fridge 45 L', 'fridge', 45, 'dc', 9, 750, 18, dims(0.7, 0.4, 0.45),
  { dcV: [12, 24], duty: 'fridge', dutyAt25C: 0.25, dutyPerC: 0.04, cycleMin: 20 }, 'Holds food in a van or cabin on about 250 Wh a day.');
load('well_pump', 'Submersible well pump 1/2 hp (240 V)', 'well pump', 1000, 'ac', 7, 550, 12, dims(0.1, 0.1, 0.8), { voltageV: 240 },
  'Lifts water from the well. Needs 240 V: a split-phase inverter or generator.');
load('circ_pump', 'Circulator pump (hydronic)', 'circulator pump', 65, 'ac', 6, 160, 2.5, dims(0.16, 0.12, 0.12), {}, 'Wet-rotor, three-speed, middle speed.');
load('space_heater', 'Space heater 1500 W', 'space heater', 1500, 'any', 3, 50, 3, dims(0.25, 0.2, 0.35), { lowW: 750 },
  'Every watt becomes heat, and it takes a lot of watts. Low setting 750 W (settings.ratedW).');
for (const [itemId, noun] of [['circular_saw', 'circular saw'], ['power_drill', 'drill'], ['chainsaw', 'chainsaw'], ['table_saw', 'table saw'], ['miter_saw', 'miter saw']]) {
  const it = ITEMS[itemId];
  load('tool_' + itemId, it.name, noun, it.powerW, 'ac', 5, it.priceUsd, it.massKgPerUnit, dims(0.3, 0.2, 0.2), { category: 'tool', item: itemId }, 'Plug it into an outlet.');
}
load('outlet_120v', '120 V outlet', 'outlet', 0, 'ac', 5, 8, 0.1, dims(0.07, 0.04, 0.12), { category: 'outlet', loadPoint: true },
  'A load point: whatever is plugged in (settings.ratedW) draws through it.');
load('outlet_12v', '12 V socket and USB', '12 V socket', 0, 'dc', 5, 15, 0.1, dims(0.07, 0.04, 0.07), { category: 'outlet', loadPoint: true, dcV: [12, 24] },
  'For phones, laptops and 12 V gadgets.');

export const FIXTURES_ELECTRICAL = Object.freeze(Object.fromEntries(list.map((e) => [e.id, e])));

// Wire gauges, thinnest first, and the lookup for a wire piece's `gauge` (14, "14", "14 AWG", "awg14", "2/0", "wire_awg2_0").
export const WIRE_GAUGES = Object.freeze(list.filter((e) => e.category === 'wire'));
export function wireSpec(gauge) {
  if (gauge === undefined || gauge === null) return null;
  const g = String(gauge).toLowerCase().replace('wire_', '').replace(/awg/g, '').replace(/\s+/g, '').replace('_', '/');
  return WIRE_GAUGES.find((w) => w.gaugeAwg === g) || null;
}
