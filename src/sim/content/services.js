// Services content: what the generic routes store (src/sim/core/routes.js) carries in a building.
// Cable, supply pipe, drains and vents; the specs they come in; the kinds of node a run starts, ends or meets
// at; the devices that go in at trim-out. src/sim/services.js reads this and turns the runs into the pieces
// src/sim/electrical.js and src/sim/water.js already solve.
//
// Code numbers quoted here (bore limits, fall, preset heights) are common IRC / NEC / IPC practice from memory;
// the slices that turn them into rules (router, drains) check them before they become rule text.

// Classes (the routes system's `classes`). steps run in order; phases say which node kinds are set at
// rough-in (rough) and finished at trim-out (trim).
export const SERVICE_CLASSES = Object.freeze({
  cable: { id: 'cable', linkKind: 'power', steps: ['bore', 'pull', 'join'], phases: { rough: ['box', 'box_ceiling'], trim: ['box', 'box_ceiling', 'slot'] }, name: 'Cable', colour: '#e8c440' },
  supply: { id: 'supply', linkKind: 'water', steps: ['bore', 'pull', 'join'], phases: { rough: ['stub_supply'], trim: ['stub_supply'] }, name: 'Supply', colour: '#3a7bd5' },
  drain: { id: 'drain', linkKind: 'drain', steps: ['seg', 'join'], phases: { rough: ['stub_drain', 'cleanout'], trim: ['stub_drain'] }, name: 'Waste', colour: '#7a5230' },
  vent: { id: 'vent', linkKind: 'vent', steps: ['seg', 'join'], phases: { rough: ['vent_term'], trim: [] }, name: 'Vent', colour: '#8a8a80' },
});

// Specs: what a run is made of. Each maps to the existing catalogs (a wire gauge in fixtures-electrical.js,
// a pipe material in fixtures-water.js, or a bore for drains). `breaker`: the breaker a circuit of this cable
// gets at the panel (NEC 240.4(D): 14 AWG on 15 A, 12 on 20 A, 10 on 30 A). `radiusM`: drawn size.
export const SERVICE_SPECS = Object.freeze({
  cable_nm_14_2: { id: 'cable_nm_14_2', cls: 'cable', name: '14/2 cable', gauge: 14, ratingA: 15, breaker: 'breaker_15a', radiusM: 0.006, colour: '#f0f0e8' },
  cable_nm_12_2: { id: 'cable_nm_12_2', cls: 'cable', name: '12/2 cable', gauge: 12, ratingA: 20, breaker: 'breaker_20a', radiusM: 0.007, colour: '#e8d040' },
  cable_nm_10_3: { id: 'cable_nm_10_3', cls: 'cable', name: '10/3 cable', gauge: 10, ratingA: 30, breaker: 'breaker_30a', radiusM: 0.009, colour: '#e89040' },
  pex_12_blue: { id: 'pex_12_blue', cls: 'supply', name: '1/2 in PEX (cold)', material: 'pipe_pex_12', hot: false, radiusM: 0.008, colour: '#3a7bd5' },
  pex_12_red: { id: 'pex_12_red', cls: 'supply', name: '1/2 in PEX (hot)', material: 'pipe_pex_12', hot: true, radiusM: 0.008, colour: '#d04030' },
  pex_20: { id: 'pex_20', cls: 'supply', name: '20 mm PEX', material: 'pipe_pex_20', hot: false, radiusM: 0.01, colour: '#3a7bd5' },
  dwv_40: { id: 'dwv_40', cls: 'drain', name: '1-1/2 in drain', diameterMm: 40, radiusM: 0.024, colour: '#ece8e0' },
  dwv_50: { id: 'dwv_50', cls: 'drain', name: '2 in drain', diameterMm: 50, radiusM: 0.03, colour: '#ece8e0' },
  dwv_75: { id: 'dwv_75', cls: 'drain', name: '3 in drain', diameterMm: 75, radiusM: 0.045, colour: '#ece8e0' },
  dwv_100: { id: 'dwv_100', cls: 'drain', name: '4 in drain', diameterMm: 100, radiusM: 0.057, colour: '#ece8e0' },
});
export const specOf = (id) => SERVICE_SPECS[id] || null;
// The default spec of a class, for a run that names none.
export const DEFAULT_SPEC = Object.freeze({ cable: 'cable_nm_14_2', supply: 'pex_12_blue', drain: 'dwv_50', vent: 'dwv_40' });

// Node kinds. `room`: drawn as a box. `presetM`: usual height above the floor.
export const NODE_KINDS = Object.freeze({
  slot: { id: 'slot', name: 'panel slot', noun: 'slot' },                                  // a place on a panel or manifold
  box: { id: 'box', name: 'wall box', noun: 'box', presetM: 0.4 },
  box_ceiling: { id: 'box_ceiling', name: 'ceiling box', noun: 'box' },
  stub_supply: { id: 'stub_supply', name: 'supply stub-out', noun: 'stub', presetM: 0.5 },   // capped until trim
  stub_drain: { id: 'stub_drain', name: 'drain stub-out', noun: 'stub', presetM: 0.45 },
  cleanout: { id: 'cleanout', name: 'cleanout', noun: 'cleanout' },
  vent_term: { id: 'vent_term', name: 'vent through the roof', noun: 'vent' },
  exit: { id: 'exit', name: 'where it leaves the building', noun: 'exit' },
  port: { id: 'port', name: 'equipment connection', noun: 'connection' },                  // bound to a piece's port (ref)
});
export const PRESETS_M = Object.freeze({ outlet: 0.4, switch: 1.2, counter: 1.1, sink: 0.5, toilet: 0.2, shower: 1.2 });

// Devices fitted at trim-out (node.set.device on a trimmed node). `elec`: the electrical catalog entry it
// stands for in the solve; `water`: the water catalog entry; `switch`: a pass-through that controls others;
// `stubM`: how far the stub sits above the fixture's base (so the fixture stands at the right height).
export const DEVICES = Object.freeze({
  outlet_120v: { id: 'outlet_120v', name: 'Outlet', elec: 'outlet_120v' },
  light_ceiling: { id: 'light_ceiling', name: 'Ceiling light', elec: 'light_led_9w' },
  light_wall: { id: 'light_wall', name: 'Wall light', elec: 'light_led_9w' },
  switch_single: { id: 'switch_single', name: 'Switch', elec: 'box_junction', switch: true },
  tap_hose_bib: { id: 'tap_hose_bib', name: 'Hose bib', water: 'tap_hose_bib', stubM: 0 },
  sink_kitchen: { id: 'sink_kitchen', name: 'Kitchen sink', water: 'sink_kitchen', stubM: 0.5 },
  toilet_flush: { id: 'toilet_flush', name: 'Toilet', water: 'toilet_flush', stubM: 0.2 },
});

// Catalog entries for the store and the equipment list (merged in src/sim/fixtures.js). No dims: they are
// fitted into boxes and onto stubs, not set down with Equip.
export const FIXTURES_SERVICES = Object.freeze({
  switch_single: Object.freeze({ id: 'switch_single', system: 'services', name: 'Wall switch, single pole', noun: 'switch', category: 'device', ports: [], priceUsd: 4, massKg: 0.1 }),
  light_ceiling: Object.freeze({ id: 'light_ceiling', system: 'services', name: 'Ceiling light (LED 9 W)', noun: 'light', category: 'device', ports: [], priceUsd: 25, massKg: 0.5 }),
  light_wall: Object.freeze({ id: 'light_wall', system: 'services', name: 'Wall light (LED 9 W)', noun: 'light', category: 'device', ports: [], priceUsd: 20, massKg: 0.4 }),
});

// Plain words for the read-outs.
export const SERVICE_TEXT = Object.freeze({
  covered: 'Open this wall first',
  stray: 'What it was fixed to is gone.',
  steps: { bore: 'drill the holes', pull: 'pull it through', seg: 'fit the lengths', join: 'connect the ends' },
  states: { planned: 'planned', roughed: 'roughed in', done: 'finished' },
});
