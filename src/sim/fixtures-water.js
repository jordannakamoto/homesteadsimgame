// Water equipment catalog (iteration 7). Shape per ARCHITECTURE.md "Fixtures and connections":
// id -> { id, name, category, system: "water", ports, priceUsd, massKg, dims: { w, d, h }, ...ratings in SI }.
//
// Ratings are typical datasheet values for the named product family, not quotes for one model.
// Prices are 2026 US retail, rounded; they are game prices. Every port is a water port; `role` says
// which way water goes through it ("in", "out", "hot", "drain", "overflow", "garden", "sewer").
//
// Categories:
//   catchment  gutter, downpipe, first-flush diverter (rain off a roof plane, into storage)
//   storage    tanks and barrels (free surface at base + level; settings.indoor / insulationMm / buriedDepthM)
//   grey       tanks that store waste water (the van grey tank)
//   pump       moves water: head/flow curve, power, suction limit
//   pressure   pressure tank (accumulator between a pump and the outlets)
//   source     wells (depth, static level, yield)
//   pipe       pipe by size, used by connection pieces (kind "pipe", material = one of these ids)
//   outlet     taps, showers, sinks, toilets (rated flow at a rated pressure: Q = Qr * sqrt(P / Pr))
//   heater     water heaters
//   drain      greywater diverter, mulch basin, soakaway

const W = (id, role) => ({ id, type: 'water', role });
const P = { in: W('in', 'in'), out: W('out', 'out'), hot: W('hot', 'hot'), drain: W('drain', 'drain'), overflow: W('overflow', 'overflow') };
const frozen = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze({ id: k, system: 'water', ...v })])));

export const FIXTURES_WATER = frozen({
  // ------------------------------------------------------------------ catchment
  // 5 in (125 mm) K-style aluminium gutter, sold in 10 ft (3.05 m) lengths. Attaches to one roof plane
  // through settings.roofPieceId; its catchment area is that plane's planArea.
  gutter_k5: { name: 'Gutter, 5 in K-style aluminium (3 m)', category: 'catchment', ports: [P.out], priceUsd: 16, massKg: 1.9,
    dims: { w: 3.05, d: 0.125, h: 0.1 }, lengthM: 3.05 },
  // 2 x 3 in (50 x 75 mm) aluminium downspout, 10 ft. Rule of thumb: one per ~56 m2 (600 ft2) of roof.
  downpipe_2x3: { name: 'Downpipe, 2 x 3 in aluminium (3 m)', category: 'catchment', ports: [P.in, P.out], priceUsd: 14, massKg: 1.4,
    dims: { w: 0.075, d: 0.05, h: 3.05 }, roofAreaM2: 56 },
  // Standpipe first-flush diverter: the first water off the roof (dust, droppings, leaf tea) fills a
  // chamber that seals, then rain passes to the tank. Sizing guidance 0.5 L per m2 of roof (Australian
  // rainwater-tank practice; the Texas Rainwater Harvesting Manual gives 0.4 L/m2). A drip outlet
  // empties the chamber between storms, so it diverts again next event.
  first_flush: { name: 'First-flush diverter, 20 L chamber', category: 'catchment', ports: [P.in, P.out], priceUsd: 55, massKg: 3,
    dims: { w: 0.11, d: 0.11, h: 1.2 }, chamberL: 20, dripLh: 2 },

  // ------------------------------------------------------------------ storage
  // heightM is the inner water height when full; dims are outside dimensions (w = d = diameter for round tanks).
  rain_barrel_200: { name: 'Rain barrel, 200 L (53 gal) HDPE', category: 'storage', ports: [P.in, P.out, P.overflow], priceUsd: 110, massKg: 9,
    dims: { w: 0.6, d: 0.6, h: 0.9 }, capacityL: 200, heightM: 0.8, potable: false },
  ibc_1000: { name: 'IBC tote, 1000 L (275 gal), reconditioned food grade', category: 'storage', ports: [P.in, P.out, P.overflow], priceUsd: 180, massKg: 60,
    dims: { w: 1.2, d: 1.0, h: 1.16 }, capacityL: 1000, heightM: 0.95, potable: true },
  poly_tank_2500: { name: 'Poly tank, 2500 L (660 gal) vertical', category: 'storage', ports: [P.in, P.out, P.overflow], priceUsd: 1050, massKg: 68,
    dims: { w: 1.55, d: 1.55, h: 1.65 }, capacityL: 2500, heightM: 1.45, potable: true },
  poly_tank_10000: { name: 'Poly tank, 10,000 L (2,640 gal) vertical', category: 'storage', ports: [P.in, P.out, P.overflow], priceUsd: 3200, massKg: 210,
    dims: { w: 2.4, d: 2.4, h: 2.45 }, capacityL: 10000, heightM: 2.25, potable: true },
  van_fresh_75: { name: 'Van fresh-water tank, 75 L (20 gal) rotomoulded', category: 'storage', ports: [P.in, P.out, P.overflow], priceUsd: 150, massKg: 6,
    dims: { w: 0.8, d: 0.4, h: 0.25 }, capacityL: 75, heightM: 0.23, potable: true },
  van_grey_75: { name: 'Van grey-water tank, 75 L (20 gal)', category: 'grey', ports: [P.in, P.out, P.overflow], priceUsd: 140, massKg: 6,
    dims: { w: 0.8, d: 0.4, h: 0.25 }, capacityL: 75, heightM: 0.23 },

  // ------------------------------------------------------------------ pumps
  // curve: "linear" H = H0 (1 - Q / Qmax) (positive-displacement diaphragm pumps are close to this);
  //        "quadratic" H = H0 (1 - (Q / Qmax)^2) (centrifugal); "human" hydraulic power P: H = P / (rho g Q).
  // maxSuctionM: how far above the water a surface pump can lift by suction (atmosphere gives 10.3 m at best).
  hand_pump: { name: 'Hand pump, cast-iron pitcher (suction)', category: 'pump', ports: [P.in, P.out], priceUsd: 95, massKg: 9,
    dims: { w: 0.2, d: 0.35, h: 0.45 }, curve: 'human', humanW: 40, maxLmin: 20, ratedW: 0, maxSuctionM: 7.6, strokeL: 1,
    note: 'A person pumping steadily puts about 40 W into the water; practical suction lift 25 ft (7.6 m).' },
  // 12 V diaphragm pump, Shurflo/Seaflo 3.0 gpm family: 11.4 L/min open flow, 2.8 bar (40 psi) pressure
  // switch, 7 A at 12 V (84 W), self-priming to about 1.8 m.
  pump_12v_diaphragm: { name: '12 V diaphragm pump, 11 L/min, 2.8 bar', category: 'pump', ports: [P.in, P.out], priceUsd: 110, massKg: 1.8,
    dims: { w: 0.22, d: 0.13, h: 0.11 }, curve: 'linear', shutoffHeadM: 28.5, maxLmin: 11.4, ratedW: 84, voltageV: 12, maxSuctionM: 1.8 },
  // 4 in submersible well pump, 1/2 hp 10 gpm 230 V class (Franklin/Goulds/Grundfos curves): about 55 m
  // shut-off head, 38 L/min (10 gpm) at ~33 m, ~60 L/min open; ~750 W input.
  pump_submersible: { name: 'Submersible well pump, 1/2 hp, 10 gpm, 230 V', category: 'pump', ports: [P.in, P.out], priceUsd: 520, massKg: 11,
    dims: { w: 0.1, d: 0.1, h: 0.75 }, curve: 'quadratic', shutoffHeadM: 55, maxLmin: 60, ratedW: 750, voltageV: 230, submersible: true },

  // Pressure tank, 20 gal (76 L) diaphragm (Well-X-Trol WX-202 class): drawdown 21.6 L at a 30/50 psi
  // (207/345 kPa) pressure switch. Cuts pump starts from one per tap use to one per ~20 L.
  pressure_tank_76: { name: 'Pressure tank, 20 gal (76 L), 30/50 psi', category: 'pressure', ports: [P.in, P.out], priceUsd: 260, massKg: 14,
    dims: { w: 0.4, d: 0.4, h: 0.65 }, volumeL: 76, drawdownL: 21.6, cutInKPa: 207, cutOutKPa: 345 },

  // ------------------------------------------------------------------ wells
  // depthM total depth, staticLevelM depth to water at rest, yieldLmin what the aquifer gives at full
  // drawdown (pump intake), boreDiameterM sets how much water the bore itself stores per metre.
  // Groundwater temperature is near the site's mean annual air temperature.
  well_drilled: { name: 'Drilled well, 60 m, 6 in casing (drilling contract)', category: 'source', ports: [P.out], priceUsd: 12000, massKg: 0,
    dims: { w: 0.15, d: 0.15, h: 0.5 }, depthM: 60, staticLevelM: 15, yieldLmin: 20, boreDiameterM: 0.152 },
  well_dug: { name: 'Shallow dug well, 6 m, concrete rings', category: 'source', ports: [P.out], priceUsd: 1500, massKg: 0,
    dims: { w: 1.2, d: 1.2, h: 0.6 }, depthM: 6, staticLevelM: 2, yieldLmin: 5, boreDiameterM: 0.9 },

  // ------------------------------------------------------------------ pipe (sold by the metre)
  // Hazen-Williams C for smooth plastics is 140-150 (AWWA / standard hydraulics tables).
  // PEX: ASTM F876 SDR 9 copper-tube-size; poly: PE100 SDR 11 metric (ISO 4427).
  pipe_pex_12: { name: 'PEX pipe, 1/2 in (12 mm bore)', category: 'pipe', ports: [], priceUsd: 0.7, priceUnit: 'm', massKg: 0.06,
    dims: { w: 0.0159, d: 0.0159, h: 1 }, nominalMm: 12, innerMm: 12.3, outerMm: 15.9, hazenC: 150 },
  pipe_pex_20: { name: 'PEX pipe, 20 mm (metric 20 x 2.0)', category: 'pipe', ports: [], priceUsd: 1.2, priceUnit: 'm', massKg: 0.11,
    dims: { w: 0.02, d: 0.02, h: 1 }, nominalMm: 20, innerMm: 16.0, outerMm: 20, hazenC: 150 },
  // 3/4 in PEX (ASTM F876, CTS): 22.2 mm outside, about 17.0 mm bore. The size of a house's main line to a manifold.
  pipe_pex_34: { name: 'PEX pipe, 3/4 in (17 mm bore)', category: 'pipe', ports: [], priceUsd: 1.2, priceUnit: 'm', massKg: 0.1,
    dims: { w: 0.0222, d: 0.0222, h: 1 }, nominalMm: 19, innerMm: 17.0, outerMm: 22.2, hazenC: 150 },
  pipe_poly_25: { name: 'Poly pipe, 25 mm PE100 SDR 11', category: 'pipe', ports: [], priceUsd: 1.3, priceUnit: 'm', massKg: 0.17,
    dims: { w: 0.025, d: 0.025, h: 1 }, nominalMm: 25, innerMm: 20.4, outerMm: 25, hazenC: 145 },
  pipe_poly_32: { name: 'Poly pipe, 32 mm PE100 SDR 11', category: 'pipe', ports: [], priceUsd: 1.9, priceUnit: 'm', massKg: 0.27,
    dims: { w: 0.032, d: 0.032, h: 1 }, nominalMm: 32, innerMm: 26.2, outerMm: 32, hazenC: 145 },

  // ------------------------------------------------------------------ outlets
  // ratedLmin at ratedKPa: flow through the outlet's orifice goes as the square root of pressure.
  // outletHeightM: where the water comes out above the piece's base y0.
  tap_hose_bib: { name: 'Outdoor tap (hose bib), 1/2 in', category: 'outlet', ports: [P.in], priceUsd: 18, massKg: 0.4,
    dims: { w: 0.06, d: 0.12, h: 0.08 }, ratedLmin: 19, ratedKPa: 345, outletHeightM: 0 },
  // WaterSense maximum 2.0 gpm at 80 psi (7.6 L/min at 552 kPa): a mains shower head, weak on gravity.
  shower_outdoor: { name: 'Outdoor shower, standard head', category: 'outlet', ports: [P.in, P.hot, P.drain], priceUsd: 140, massKg: 3,
    dims: { w: 0.3, d: 0.3, h: 2.1 }, ratedLmin: 7.6, ratedKPa: 552, outletHeightM: 2.0, defaultTempC: 38 },
  // Wide-bore rose for header-tank (low-pressure) systems: UK low-pressure heads give ~8 L/min at 0.2 bar.
  shower_gravity: { name: 'Outdoor shower, low-pressure gravity rose', category: 'outlet', ports: [P.in, P.hot, P.drain], priceUsd: 90, massKg: 2.5,
    dims: { w: 0.3, d: 0.3, h: 2.1 }, ratedLmin: 8, ratedKPa: 20, outletHeightM: 2.0, defaultTempC: 38 },
  // US federal maximum for kitchen faucets: 2.2 gpm at 60 psi (8.3 L/min at 414 kPa).
  sink_kitchen: { name: 'Kitchen sink and faucet', category: 'outlet', ports: [P.in, P.hot, P.drain], priceUsd: 220, massKg: 12,
    dims: { w: 0.8, d: 0.55, h: 0.9 }, ratedLmin: 8.3, ratedKPa: 414, outletHeightM: 1.0, waste: 'grey' },
  // WaterSense lavatory faucet maximum 1.5 gpm at 60 psi (5.7 L/min at 414 kPa).
  sink_bath: { name: 'Bathroom sink and faucet', category: 'outlet', ports: [P.in, P.hot, P.drain], priceUsd: 140, massKg: 14,
    dims: { w: 0.55, d: 0.45, h: 0.85 }, ratedLmin: 5.7, ratedKPa: 414, outletHeightM: 0.95, waste: 'grey' },
  // A tub/shower valve and a WaterSense head: 2.0 gpm at 80 psi (7.6 L/min at 552 kPa), head at 2.0 m. Indoors it drains to a floor drain.
  shower_indoor: { name: 'Shower valve and head', category: 'outlet', ports: [P.in, P.hot, P.drain], priceUsd: 160, massKg: 5,
    dims: { w: 0.9, d: 0.9, h: 2.1 }, ratedLmin: 7.6, ratedKPa: 552, outletHeightM: 2.0, defaultTempC: 38, waste: 'grey' },
  // WaterSense toilet, 1.28 gpf (4.8 L per flush); a fill valve passes ~11 L/min at 50 psi and needs ~20 psi.
  toilet_flush: { name: 'Flush toilet, 4.8 L (1.28 gpf)', category: 'outlet', ports: [P.in, P.drain], priceUsd: 260, massKg: 40,
    dims: { w: 0.38, d: 0.7, h: 0.75 }, ratedLmin: 11, ratedKPa: 345, outletHeightM: 0.6, flushL: 4.8, waste: 'black' },
  // Urine-diverting composting toilet (Nature's Head class): no water at all.
  toilet_composting: { name: 'Composting toilet, urine diverting', category: 'outlet', ports: [], priceUsd: 1050, massKg: 13,
    dims: { w: 0.5, d: 0.48, h: 0.54 }, ratedLmin: 0, ratedKPa: 0, outletHeightM: 0, flushL: 0, waste: 'none' },

  // ------------------------------------------------------------------ heaters
  // 40 gal (150 L) electric tank, 4500 W element at 240 V; standby loss coefficient ~1.6 W/K
  // (DOE test-procedure standby of ~60 W at a 38 K tank-to-room difference).
  heater_tank_electric: { name: 'Electric water heater, 150 L (40 gal), 4500 W', category: 'heater', ports: [P.in, P.out], priceUsd: 650, massKg: 45,
    dims: { w: 0.55, d: 0.55, h: 1.5 }, kind: 'tank', volumeL: 150, ratedW: 4500, voltageV: 240, uaWK: 1.6, setpointC: 50, deadbandC: 5 },
  // Portable outdoor tankless propane heater, ~10 kW input (34,000 BTU/h), ~82 % thermal efficiency,
  // ignites above ~1.9 L/min (0.5 gpm). Propane lower heating value 46.35 MJ/kg.
  heater_tankless_propane: { name: 'Tankless propane water heater, 10 kW (34,000 BTU/h)', category: 'heater', ports: [P.in, P.out], priceUsd: 180, massKg: 6,
    dims: { w: 0.35, d: 0.12, h: 0.5 }, kind: 'tankless', inputW: 10000, efficiency: 0.82, minLmin: 1.9, maxLmin: 5, setpointC: 45, fuelMJkg: 46.35 },
  // Integral-collector-storage (batch) heater: a black 150 L tank in a glazed box. Optical efficiency
  // ~0.6 and an overall loss coefficient ~3 W/m2K of aperture (SRCC OG-100 ratings of ICS collectors).
  // Collector tilt is not modelled: it sees the global horizontal irradiance.
  heater_solar_batch: { name: 'Solar batch heater, 150 L, 1.5 m2 glazed', category: 'heater', ports: [P.in, P.out], priceUsd: 350, massKg: 60,
    dims: { w: 1.0, d: 1.5, h: 0.4 }, kind: 'solar', volumeL: 150, apertureM2: 1.5, opticalEff: 0.6, uaWK: 4.5 },

  // ------------------------------------------------------------------ drains
  greywater_diverter: { name: 'Greywater 3-way diverter valve', category: 'drain', ports: [P.in, W('garden', 'garden'), W('sewer', 'sewer')], priceUsd: 60, massKg: 0.6,
    dims: { w: 0.15, d: 0.1, h: 0.15 }, kind: 'diverter' },
  mulch_basin: { name: 'Mulch basin (1 m2, wood chips)', category: 'drain', ports: [P.in], priceUsd: 25, massKg: 0,
    dims: { w: 1, d: 1, h: 0.3 }, kind: 'ground', areaM2: 1 },
  soakaway: { name: 'Drain to soakaway (gravel pit)', category: 'drain', ports: [P.in], priceUsd: 150, massKg: 0,
    dims: { w: 1, d: 1, h: 1 }, kind: 'ground', areaM2: 1 },
});

export const isWaterFixture = (id) => !!FIXTURES_WATER[id];
