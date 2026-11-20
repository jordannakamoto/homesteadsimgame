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
  supply: { id: 'supply', linkKind: 'water', steps: ['bore', 'pull', 'join'], phases: { rough: ['stub_supply', 'manifold'], trim: ['stub_supply'] }, name: 'Supply', colour: '#3a7bd5' },
  drain: { id: 'drain', linkKind: 'drain', steps: ['seg', 'join'], phases: { rough: ['stub_drain', 'cleanout'], trim: ['stub_drain'] }, name: 'Waste', colour: '#7a5230' },
  vent: { id: 'vent', linkKind: 'vent', steps: ['seg', 'join'], phases: { rough: ['vent_term'], trim: [] }, name: 'Vent', colour: '#8a8a80' },
});

// Specs: what a run is made of. Each maps to the existing catalogs (a wire gauge in fixtures-electrical.js,
// a pipe material in fixtures-water.js, or a bore for drains). `breaker`: the breaker a circuit of this cable
// gets at the panel (NEC 240.4(D): 14 AWG on 15 A, 12 on 20 A, 10 on 30 A). `radiusM`: drawn size.
export const SERVICE_SPECS = Object.freeze({
  cable_nm_14_2: { id: 'cable_nm_14_2', holeMm: 19, cls: 'cable', name: '14/2 cable', gauge: 14, ratingA: 15, breaker: 'breaker_15a', radiusM: 0.006, colour: '#f0f0e8' },
  cable_nm_12_2: { id: 'cable_nm_12_2', holeMm: 19, cls: 'cable', name: '12/2 cable', gauge: 12, ratingA: 20, breaker: 'breaker_20a', radiusM: 0.007, colour: '#e8d040' },
  cable_nm_10_3: { id: 'cable_nm_10_3', holeMm: 22, cls: 'cable', name: '10/3 cable', gauge: 10, ratingA: 30, breaker: 'breaker_30a', radiusM: 0.009, colour: '#e89040' },
  pex_12_blue: { id: 'pex_12_blue', holeMm: 22, cls: 'supply', name: '1/2 in PEX (cold)', material: 'pipe_pex_12', hot: false, radiusM: 0.008, colour: '#3a7bd5' },
  pex_12_red: { id: 'pex_12_red', holeMm: 22, cls: 'supply', name: '1/2 in PEX (hot)', material: 'pipe_pex_12', hot: true, radiusM: 0.008, colour: '#d04030' },
  pex_34: { id: 'pex_34', holeMm: 29, cls: 'supply', name: '3/4 in PEX (main)', material: 'pipe_pex_34', hot: false, radiusM: 0.0115, colour: '#3a7bd5' },
  pex_20: { id: 'pex_20', holeMm: 25, cls: 'supply', name: '20 mm PEX', material: 'pipe_pex_20', hot: false, radiusM: 0.01, colour: '#3a7bd5' },
  dwv_40: { id: 'dwv_40', holeMm: 51, cls: 'drain', name: '1-1/2 in drain', diameterMm: 40, radiusM: 0.024, colour: '#ece8e0' },
  dwv_50: { id: 'dwv_50', holeMm: 64, cls: 'drain', name: '2 in drain', diameterMm: 50, radiusM: 0.03, colour: '#ece8e0' },
  dwv_75: { id: 'dwv_75', holeMm: 92, cls: 'drain', name: '3 in drain', diameterMm: 75, radiusM: 0.045, colour: '#ece8e0' },
  dwv_100: { id: 'dwv_100', holeMm: 117, cls: 'drain', name: '4 in drain', diameterMm: 100, radiusM: 0.057, colour: '#ece8e0' },
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
  manifold: { id: 'manifold', name: 'PEX manifold', noun: 'manifold', presetM: 1.2 },         // the water twin of the panel: one line per fixture
  stub_drain: { id: 'stub_drain', name: 'drain stub-out', noun: 'stub', presetM: 0.45 },
  cleanout: { id: 'cleanout', name: 'cleanout', noun: 'cleanout' },
  vent_term: { id: 'vent_term', name: 'vent through the roof', noun: 'vent' },
  exit: { id: 'exit', name: 'where it leaves the building', noun: 'exit' },
  port: { id: 'port', name: 'equipment connection', noun: 'connection' },                  // bound to a piece's port (ref)
});
export const PRESETS_M = Object.freeze({ outlet: 0.4, switch: 1.2, counter: 1.1, sink: 0.5, bath: 0.5, toilet: 0.2, shower: 1.2, manifold: 1.2 });

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
  sink_bath: { id: 'sink_bath', name: 'Bathroom sink', water: 'sink_bath', stubM: 0.5 },
  shower_indoor: { id: 'shower_indoor', name: 'Shower', water: 'shower_indoor', stubM: 1.2 },
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

// ------------------------------------------------------------------------------------------- routing rules
// What a run of a given spec may do in a frame (src/sim/core/routefind.js walks the channels of
// src/sim/content/frame-channels.js with this rule). holeMm on each spec is the bit or hole saw it needs: 3/4 in
// for NM cable, 7/8 in for 1/2 in PEX, the pipe's outside diameter plus a little for drains.
// Code numbers, checked Nov 2026:
//   IRC R602.6      a bearing stud may be bored to 40% of its depth (a non-bearing one 60%), the hole kept 5/8 in
//                   from either edge; R602.6.1: a top plate bored past half its width needs a steel tie.
//   IRC R502.8.1    a joist hole at most a third of the joist's depth and at least 2 in from its top and bottom.
//   NEC 300.4(A)(1) cable in a hole nearer than 1-1/4 in (32 mm) to the stud's face gets a 1/16 in steel plate;
//   IRC P2603.2.1   pipe within 1-1/2 in (38 mm) of the face gets a shield plate too.
//   IPC 704.1       horizontal drain falls 1/4 in per foot (2%) up to 2-1/2 in pipe, 1/8 in per foot (1%) for 3 in and up.
export const BORE_LIMITS = Object.freeze({ studBearing: 0.4, studOther: 0.6, topPlate: 0.5, plateEdgeMm: 16, joist: 1 / 3, joistEdgeMm: 51 });
export const PLATE_EDGE_MM = Object.freeze({ cable: 32, supply: 38, drain: 38, vent: 38 });
export const fallFor = (diameterMm) => (diameterMm <= 65 ? 0.02 : 0.01);
const LUMBER_NAME = [[0.089, '2x4'], [0.14, '2x6'], [0.184, '2x8'], [0.235, '2x10'], [0.286, '2x12']];
const lumberName = (d) => { for (const [x, n] of LUMBER_NAME) if (Math.abs(x - d) < 0.004) return n; return Math.round(d * 1000) + ' mm'; };

// Whether a hole for this spec may go through a member, and if it needs a steel plate. -> { ok, plate, reason }
export function boreCheck(specId, bore) {
  const sp = SERVICE_SPECS[specId] || {}, cls = sp.cls, hole = (sp.holeMm || 20) / 1000, d = bore.depthM || 0.089, what = sp.name || 'this run';
  const big = cls === 'drain' ? 'too fat' : 'too big';
  if (bore.kind === 'stud') {
    const lim = (bore.bearing === false ? BORE_LIMITS.studOther : BORE_LIMITS.studBearing) * d;
    if (hole > lim + 1e-6) return { ok: false, reason: 'A ' + what + ' is ' + big + ' to bore through ' + lumberName(d) + ' studs (' + Math.round(lim * 1000) + ' mm hole at most): ' + (cls === 'drain' ? 'take it down into the floor.' : 'take it over the top or under the floor.') };
  } else if (bore.kind === 'plate') {
    const lim = bore.top ? BORE_LIMITS.topPlate * d : d - 2 * BORE_LIMITS.plateEdgeMm / 1000;
    if (hole > lim + 1e-6) return { ok: false, reason: 'A ' + what + ' needs a wider wall: a ' + lumberName(d) + ' plate takes a ' + Math.round(lim * 1000) + ' mm hole at most.' };
  } else if (bore.kind === 'joist') {
    const lim = Math.min(BORE_LIMITS.joist * d, d - 2 * BORE_LIMITS.joistEdgeMm / 1000);
    if (hole > lim + 1e-6) return { ok: false, reason: 'A ' + what + ' is ' + big + ' for a hole in ' + lumberName(d) + ' joists (' + Math.round(lim * 1000) + ' mm at most): run it along them' + (cls === 'drain' ? ', or hang it under a raised floor.' : '.') };
  }
  const edge = (d - hole) / 2;
  return { ok: true, plate: bore.kind === 'stud' && edge * 1000 < (PLATE_EDGE_MM[cls] || 32) };
}

// The routefind rule for one spec. opts.fixedEnd: the far end is an existing drain that cannot move down.
export function routeRule(specId, opts = {}) {
  const sp = SERVICE_SPECS[specId] || {}, drain = sp.cls === 'drain';
  const climb = 'A drain cannot climb: move the sink or lower the exit.';
  return {
    allowed(edge, step) {
      if (drain && step.to.p[1] > step.from.p[1] + 0.002) return climb;
      if (drain && edge.via) { let y = step.from.p[1]; for (const q of step.dir === 1 ? edge.via : edge.via.slice().reverse()) { if (q[1] > y + 0.002) return climb; y = q[1]; } }
      if (edge.bore) { const c = boreCheck(specId, edge.bore); if (!c.ok) return c.reason; }
      return true;
    },
    cost(edge) {
      // a hole is a minute's work: worth about 40 cm of extra run; a drain prefers to stay straight and low
      return edge.lengthM + (edge.bore ? 0.4 : 0) + (drain && edge.tag === 'wall' ? edge.lengthM : 0);
    },
    finish(res) {
      for (const b of res.bores) b.plate = boreCheck(specId, b).plate ? 1 : 0;
      if (!drain) return res;
      // the fall: every horizontal metre drops by the slope, from the fixture down to where it goes. In a joist bay
      // the pipe starts high, just under the subfloor, to have the most room to fall.
      const slope = fallFor(sp.diameterMm || 50), r = (sp.holeMm || 50) / 2000, P = res.path, ny = [P[0][1]];
      for (let i = 1; i < P.length; i++) {
        const v = res.verts[i], want = v && v.yTop != null ? Math.min(v.yTop - r, ny[i - 1]) : P[i][1];
        const h = Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
        ny[i] = Math.min(want, ny[i - 1] - slope * h);
      }
      for (let i = 0; i < P.length; i++) {
        const v = res.verts[i];
        if (v && v.yMin != null && ny[i] - r < v.yMin - 1e-6) return { refused: 'Not enough fall: this drain runs too far to keep dropping ' + Math.round(slope * 100) + ' cm a metre inside the floor. Put the exit nearer.' };
      }
      const last = P.length - 1;
      if (opts.fixedEnd && ny[last] < P[last][1] - 0.005) return { refused: 'Not enough fall to reach that drain: it needs to drop ' + Math.round(slope * 100) + ' cm a metre. Join it lower down.' };
      for (const b of res.bores) {
        const k = b.t || 0, d0 = ny[b.seg] - P[b.seg][1], d1 = (ny[b.seg + 1] ?? ny[b.seg]) - (P[b.seg + 1] || P[b.seg])[1], dy = d0 + (d1 - d0) * k;
        if (b.kind === 'joist' && Math.abs(dy) > b.depthM / 2 - BORE_LIMITS.joistEdgeMm / 1000 - r) return { refused: 'With its fall this drain would cross a joist too near the edge: run it along the joists.' };
        b.at[1] += dy;
      }
      res.path = P.map((q, i) => [q[0], Math.round(ny[i] * 1000) / 1000, q[2]]);
      res.fall = { slope, dropM: P[0][1] - ny[last] };
      return res;
    },
  };
}

// ------------------------------------------------------------------------------------------- materials (S8)
// What rough-in uses, as the store sells it (2026 US retail, rounded; masses from the makers' sheets). Cable and PEX
// by the metre (a spool or coil at the stacks serves a whole circuit); boxes one each; staples, nail plates and crimp
// rings are small supplies that sit by the stacks and are used up (src/sim/content/construction.js SITE_SUPPLY).
export const SERVICE_ITEM_CATEGORIES = Object.freeze([
  { id: 'electrical', name: 'Electrical', blurb: 'Cable, boxes and what holds them' },
  { id: 'plumbing', name: 'Plumbing', blurb: 'PEX, rings and fittings' },
]);
export const ITEMS_SERVICES = Object.freeze([
  { id: 'nm_cable_14_2', name: '14/2 NM cable with ground', category: 'electrical', unit: 'm', massKg: 0.063, priceUsd: 1.3, blurb: 'Sheathed house cable for 15 A circuits: lights and outlets. Comes on a 76 m (250 ft) spool' },
  { id: 'nm_cable_12_2', name: '12/2 NM cable with ground', category: 'electrical', unit: 'm', massKg: 0.096, priceUsd: 2, blurb: 'Heavier cable for 20 A circuits: kitchen counters, bathrooms' },
  { id: 'nm_cable_10_3', name: '10/3 NM cable with ground', category: 'electrical', unit: 'm', massKg: 0.2, priceUsd: 6, blurb: 'For 30 A, 240 V loads: a dryer, a water heater' },
  { id: 'pex_coil_12_blue', name: '1/2 in PEX, blue (cold)', category: 'plumbing', unit: 'm', massKg: 0.06, priceUsd: 0.75, blurb: 'Flexible water pipe, pulled through the studs like cable. Comes in a 30 m (100 ft) coil' },
  { id: 'pex_coil_12_red', name: '1/2 in PEX, red (hot)', category: 'plumbing', unit: 'm', massKg: 0.06, priceUsd: 0.75, blurb: 'The same pipe in red, so hot is never mistaken for cold' },
  { id: 'pex_coil_34', name: '3/4 in PEX, blue', category: 'plumbing', unit: 'm', massKg: 0.1, priceUsd: 1.4, blurb: 'The main line from the tank or pump to the manifold: a size up from the branches' },
  { id: 'pex_coil_20', name: '20 mm PEX', category: 'plumbing', unit: 'm', massKg: 0.11, priceUsd: 1.2, blurb: 'A size up, for a main line' },
  { id: 'elec_box_wall', name: 'Nail-on wall box, single', category: 'electrical', unit: 'each', massKg: 0.06, priceUsd: 0.75, blurb: 'Nailed to the side of a stud; an outlet or a switch goes in it at trim-out' },
  { id: 'elec_box_ceiling', name: 'Nail-on ceiling box, round', category: 'electrical', unit: 'each', massKg: 0.12, priceUsd: 2.5, blurb: 'Holds a ceiling light' },
  { id: 'cable_staple', name: 'Insulated cable staples', category: 'fasteners', unit: 'each', massKg: 0.002, priceUsd: 0.05, blurb: 'Hold cable to the side of a stud' },
  { id: 'pex_staple', name: 'PEX staples', category: 'fasteners', unit: 'each', massKg: 0.003, priceUsd: 0.08, blurb: 'Plastic straps that hold PEX to a stud or joist' },
  { id: 'nail_plate', name: 'Steel nail plate', category: 'fasteners', unit: 'each', massKg: 0.03, priceUsd: 0.6, blurb: 'Over a hole near the face of a stud, so a drywall screw cannot reach the cable or pipe' },
  { id: 'crimp_ring_12', name: 'Copper crimp rings, 1/2 in', category: 'plumbing', unit: 'each', massKg: 0.004, priceUsd: 0.25, blurb: 'Squeezed over PEX on a fitting with the crimp tool' },
  { id: 'crimp_ring_34', name: 'Copper crimp rings, 3/4 in', category: 'plumbing', unit: 'each', massKg: 0.007, priceUsd: 0.4, blurb: 'The same for the 3/4 in main' },
  { id: 'manifold_pex_6', name: 'PEX manifold, 6 ports with stop valves', category: 'plumbing', unit: 'each', massKg: 2.4, priceUsd: 115, blurb: 'One line to each fixture, so there are no joints hidden in the walls; a quarter-turn stop on every line and a main on the way in' },
  { id: 'pex_cap_12', name: 'PEX stub-out cap, 1/2 in', category: 'plumbing', unit: 'each', massKg: 0.01, priceUsd: 1.1, blurb: 'Seals a stub-out so the pipes can be pressure tested before the walls close' },
  { id: 'stop_valve_12', name: 'Angle stop, 1/2 in PEX x 3/8 in', category: 'plumbing', unit: 'each', massKg: 0.15, priceUsd: 8, blurb: 'A quarter-turn valve on the stub-out under a fixture, to shut it off alone' },
  { id: 'supply_line_12', name: 'Braided supply line, 3/8 in, 30 cm', category: 'plumbing', unit: 'each', massKg: 0.1, priceUsd: 6, blurb: 'Joins the angle stop to the faucet or the toilet' },
  { id: 'fx_sink_kitchen', name: 'Kitchen sink and faucet', category: 'plumbing', unit: 'each', massKg: 12, priceUsd: 220, blurb: 'A double-bowl sink with a 2.2 gpm faucet' },
  { id: 'fx_sink_bath', name: 'Bathroom sink and faucet', category: 'plumbing', unit: 'each', massKg: 14, priceUsd: 140, blurb: 'A basin with a 1.5 gpm faucet' },
  { id: 'fx_toilet', name: 'Toilet, 1.28 gpf', category: 'plumbing', unit: 'each', massKg: 40, priceUsd: 260, blurb: 'A bowl and tank; sits on the drain, fed by a stop on the stub-out' },
  { id: 'fx_shower', name: 'Shower valve and head', category: 'plumbing', unit: 'each', massKg: 5, priceUsd: 160, blurb: 'A mixing valve on hot and cold, and a 2.0 gpm head' },
  { id: 'fx_hose_bib', name: 'Hose bib, 1/2 in', category: 'plumbing', unit: 'each', massKg: 0.4, priceUsd: 18, blurb: 'An outdoor tap through the wall' },
  { id: 'pex_coil_20', name: 'Copper crimp rings, 20 mm', category: 'plumbing', unit: 'each', massKg: 0.006, priceUsd: 0.35, blurb: 'The same for 20 mm PEX' },
  // the grid (S9a): the meter base and mast kit with the utility's hook-up; the catalog entry is service_entrance_* in fixtures-electrical.js
  { id: 'svc_entrance_100a', name: 'Grid service, 100 A: meter base, mast and hook-up', category: 'electrical', unit: 'each', massKg: 14, priceUsd: 1400, blurb: 'The power company brings the line to a mast on an outside wall; the meter feeds the breaker panel behind it. Billed by the kWh' },
  { id: 'svc_entrance_200a', name: 'Grid service, 200 A: meter base, mast and hook-up', category: 'electrical', unit: 'each', massKg: 18, priceUsd: 2100, blurb: 'A bigger service, for electric heat or a shop' },
  // trim-out (S9b): what goes into the boxes and the panel once the walls are finished
  { id: 'elec_receptacle', name: 'Duplex outlet, 15 A', category: 'electrical', unit: 'each', massKg: 0.09, priceUsd: 1.8, blurb: 'Two sockets; the wires land on its screws, then it folds into the box' },
  { id: 'elec_switch', name: 'Wall switch, single pole, 15 A', category: 'electrical', unit: 'each', massKg: 0.07, priceUsd: 1.6, blurb: 'Breaks the hot wire to the lights after it' },
  { id: 'elec_light_ceiling', name: 'LED ceiling light, flush mount', category: 'electrical', unit: 'each', massKg: 0.6, priceUsd: 22, blurb: 'Screws to a ceiling box; about 800 lumens on 9 W' },
  { id: 'elec_light_wall', name: 'LED wall light', category: 'electrical', unit: 'each', massKg: 0.45, priceUsd: 20, blurb: 'A sconce on a wall box' },
  { id: 'elec_plate_outlet', name: 'Outlet cover plate', category: 'electrical', unit: 'each', massKg: 0.02, priceUsd: 0.6, blurb: 'Covers the box around an outlet' },
  { id: 'elec_plate_switch', name: 'Switch cover plate', category: 'electrical', unit: 'each', massKg: 0.02, priceUsd: 0.6, blurb: 'Covers the box around a switch' },
  { id: 'elec_breaker_15', name: 'Breaker, 15 A single pole', category: 'electrical', unit: 'each', massKg: 0.15, priceUsd: 9, blurb: 'Snaps onto the panel\'s bus bar; protects a 14/2 circuit' },
  { id: 'elec_breaker_20', name: 'Breaker, 20 A single pole', category: 'electrical', unit: 'each', massKg: 0.15, priceUsd: 9, blurb: 'For a 12/2 circuit' },
  { id: 'elec_breaker_30', name: 'Breaker, 30 A double pole', category: 'electrical', unit: 'each', massKg: 0.3, priceUsd: 16, blurb: 'For a 10/3 circuit: a dryer, a water heater' },
]);
// the trim-out items: small, boxed, kept by the stacks (never carried one by one)
export const TRIM_SUPPLY = Object.freeze(['elec_receptacle', 'elec_switch', 'elec_light_ceiling', 'elec_light_wall', 'elec_plate_outlet', 'elec_plate_switch', 'elec_breaker_15', 'elec_breaker_20', 'elec_breaker_30']);
// used up by the stacks, never carried
// plumbing trim-out (S10): the fixtures and the little parts that connect them, kept by the stacks too
export const WATER_TRIM_SUPPLY = Object.freeze(['pex_cap_12', 'stop_valve_12', 'supply_line_12', 'fx_sink_kitchen', 'fx_sink_bath', 'fx_toilet', 'fx_shower', 'fx_hose_bib']);
export const SERVICE_SUPPLY = Object.freeze(['cable_staple', 'pex_staple', 'nail_plate', 'crimp_ring_12', 'crimp_ring_20', 'crimp_ring_34', ...TRIM_SUPPLY, ...WATER_TRIM_SUPPLY]);
// what a run of each spec is bought as, and the ring that closes each end of it
export const SPEC_ITEM = Object.freeze({ cable_nm_14_2: 'nm_cable_14_2', cable_nm_12_2: 'nm_cable_12_2', cable_nm_10_3: 'nm_cable_10_3', pex_12_blue: 'pex_coil_12_blue', pex_12_red: 'pex_coil_12_red', pex_34: 'pex_coil_34', pex_20: 'pex_coil_20' });
export const SPEC_RING = Object.freeze({ pex_12_blue: 'crimp_ring_12', pex_12_red: 'crimp_ring_12', pex_34: 'crimp_ring_34', pex_20: 'crimp_ring_20' });
export const NODE_ITEM = Object.freeze({ box: 'elec_box_wall', box_ceiling: 'elec_box_ceiling', manifold: 'manifold_pex_6' });
// Fastening (NEC 334.30: NM cable stapled within 12 in of a box and every 4-1/2 ft; IRC table P2605.1: PEX supported
// every 32 in run horizontally). A hole through a stud holds the run, so no staple right beside one. Each end leaves
// some over to work with (NEC 300.14: at least 6 in of free conductor at a box), so a run takes a little more than its
// length. A hole near the face gets a plate on each face (the hole is centred in the stud).
export const FIXINGS = Object.freeze({ stapleM: Object.freeze({ cable: 1.2, supply: 0.8 }), staple: Object.freeze({ cable: 'cable_staple', supply: 'pex_staple' }), endM: 0.2, clearM: 0.12, slackM: Object.freeze({ cable: 0.3, supply: 0.2 }), platesPerHole: 2 });
// The Build panel's lines for rough-in: label and why, by item
export const SERVICE_LINES = Object.freeze({
  nm_cable_14_2: { label: '14/2 cable', why: 'House cable from the panel to each box: 15 A circuits.' },
  nm_cable_12_2: { label: '12/2 cable', why: 'Heavier cable for 20 A circuits.' },
  nm_cable_10_3: { label: '10/3 cable', why: 'For a 30 A circuit.' },
  pex_coil_12_blue: { label: 'Blue PEX', why: 'Cold water from the supply to each stub-out.' },
  pex_coil_12_red: { label: 'Red PEX', why: 'Hot water from the heater to each stub-out.' },
  pex_coil_20: { label: '20 mm PEX', why: 'The main water line.' },
  pex_coil_34: { label: '3/4 in PEX', why: 'The main line from the supply to the manifold.' },
  crimp_ring_34: { label: 'Crimp rings, 3/4 in', why: 'One at each end of a 3/4 in run.' },
  manifold_pex_6: { label: 'Manifold', why: 'One line from here to each fixture, with a stop valve on every line.' },
  pex_cap_12: { label: 'Stub caps', why: 'One on each stub-out until its fixture goes on, so the pipes can be tested.' },
  stop_valve_12: { label: 'Angle stops', why: 'One on each stub-out under a fixture.' },
  supply_line_12: { label: 'Supply lines', why: 'One from each stop to its fixture.' },
  fx_sink_kitchen: { label: 'Kitchen sinks', why: 'Set on its stub-outs at trim-out.' },
  fx_sink_bath: { label: 'Bathroom sinks', why: 'Set on its stub-outs at trim-out.' },
  fx_toilet: { label: 'Toilets', why: 'Set on its stub-out at trim-out.' },
  fx_shower: { label: 'Shower valves', why: 'Set on its stub-outs at trim-out.' },
  fx_hose_bib: { label: 'Hose bibs', why: 'Set on its stub-out at trim-out.' },
  elec_box_wall: { label: 'Wall boxes', why: 'An outlet or switch goes in each one at trim-out.' },
  elec_box_ceiling: { label: 'Ceiling boxes', why: 'A light hangs from each one.' },
  cable_staple: { label: 'Cable staples', why: 'Hold the cable to the studs.' },
  pex_staple: { label: 'PEX staples', why: 'Hold the pipe to the studs and joists.' },
  nail_plate: { label: 'Nail plates', why: 'Guard holes near the face of a stud from the screws of the wall boards.' },
  crimp_ring_12: { label: 'Crimp rings', why: 'One at each end of a PEX run.' },
  crimp_ring_20: { label: 'Crimp rings, 20 mm', why: 'One at each end of a 20 mm run.' },
  elec_receptacle: { label: 'Outlets', why: 'One in each outlet box.' },
  elec_switch: { label: 'Switches', why: 'One in each switch box.' },
  elec_light_ceiling: { label: 'Ceiling lights', why: 'One on each ceiling box.' },
  elec_light_wall: { label: 'Wall lights', why: 'One on each wall-light box.' },
  elec_plate_outlet: { label: 'Outlet plates', why: 'Cover each outlet box.' },
  elec_plate_switch: { label: 'Switch plates', why: 'Cover each switch box.' },
  elec_breaker_15: { label: '15 A breakers', why: 'One in the panel for each 14/2 circuit.' },
  elec_breaker_20: { label: '20 A breakers', why: 'One in the panel for each 12/2 circuit.' },
  elec_breaker_30: { label: '30 A breakers', why: 'One in the panel for each 10/3 circuit.' },
});

// ------------------------------------------------------------------------------------------- trim-out (S9b)
// A box at trim-out: strip each cable end, land its wires on the device (one drag each), fold the device into the box
// and screw it, then the plate (a light: its shade). A panel slot: the breaker pressed onto the bus bar. What each takes:
// the device at the first wire landed, the plate at the plate; the breaker as it goes in.
export const DEVICE_ITEM = Object.freeze({
  outlet_120v: { item: 'elec_receptacle', plate: 'elec_plate_outlet', fits: ['box'] },
  switch_single: { item: 'elec_switch', plate: 'elec_plate_switch', fits: ['box'] },
  light_wall: { item: 'elec_light_wall', fits: ['box'] },
  light_ceiling: { item: 'elec_light_ceiling', fits: ['box_ceiling'] },
});
export const DEFAULT_DEVICE = Object.freeze({ box: 'outlet_120v', box_ceiling: 'light_ceiling' });
// what a planned box was planned as (services-plan presets) -> the device it gets at trim-out
export const PRESET_DEVICE = Object.freeze({ outlet: 'outlet_120v', counter: 'outlet_120v', switch: 'switch_single', light: 'light_ceiling' });
export const BREAKER_ITEM = Object.freeze({ breaker_15a: 'elec_breaker_15', breaker_20a: 'elec_breaker_20', breaker_30a: 'elec_breaker_30' });
// the steps in order; strip and land are one per cable end in the box, fold and plate one each, press one per slot
export const TRIM_STEPS = Object.freeze({ box: ['strip', 'land', 'fold', 'plate'], box_ceiling: ['strip', 'land', 'fold', 'plate'], slot: ['press'] });
export const TRIM_TEXT = Object.freeze({
  steps: { strip: 'strip the cable ends', land: 'land the wires on the device', fold: 'fold it in and screw it', plate: 'put the plate on', press: 'press the breaker in' },
  lightPlate: 'put the shade on',
  notReady: { planned: 'Nail the box to the stud first.', runs: 'The cable to this box is not roughed in yet.', none: 'No cable comes to this box.', stray: 'What it was fixed to is gone.' },
  faults: { bore: 'holes not drilled through to here', pull: 'cable not pulled through to here', join: 'cable not clamped in this box', box: 'box not fixed to the stud', loose: 'not joined to the panel: plan a run from the panel to it' },
});
const isLight = (dev) => dev === 'light_ceiling' || dev === 'light_wall';
export const deviceIsLight = isLight;
// what one step at a node takes: { [itemId]: qty }. done: the trim state before the step.
export function trimCost(kind, dev, step, units, done = {}, breaker = null) {
  const out = {}, d = DEVICE_ITEM[dev] || {};
  if (!(units > 0)) return out;
  if (step === 'land' && !(done.land > 0) && d.item) out[d.item] = 1;
  if (step === 'plate' && d.plate) out[d.plate] = 1;
  if (step === 'press' && breaker && BREAKER_ITEM[breaker]) out[BREAKER_ITEM[breaker]] = units;
  return out;
}

// a path's running lengths, and how far along it the point nearest q is
function cumOf(path) { const c = [0]; for (let i = 1; i < path.length; i++) c.push(c[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2])); return c; }
function sAlong(path, cum, q) {
  let best = 0, bd = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
    const k = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1] + (q[2] - a[2]) * d[2]) / L2));
    const e = Math.hypot(a[0] + d[0] * k - q[0], a[1] + d[1] * k - q[1], a[2] + d[2] * k - q[2]);
    if (e < bd) { bd = e; best = cum[i - 1] + k * Math.sqrt(L2); }
  }
  return best;
}
// where the staples go along a run of length L (metres from its start a); the page draws them at the same places
export function stapleMarks(L, cls, boreS = []) {
  const every = FIXINGS.stapleM[cls], e = FIXINGS.endM, out = [];
  if (!every || !(L > 2 * e)) return out;
  out.push(e);
  for (let s = e + every; s < L - e - 0.3; s += every) out.push(s);
  out.push(L - e);
  return out.filter((s) => !boreS.some((bs) => Math.abs(bs - s) < FIXINGS.clearM));
}
const add = (o, id, q) => { if (id && q > 1e-9) o[id] = Math.round(((o[id] || 0) + q) * 1e6) / 1e6; };
// Material a step of work on a run takes: { [itemId]: qty }. what: 'pull' (from, to: 0..1 of the run) or 'join' (end).
export function workCost(run, what, opts = {}) {
  const out = {}, cls = run.cls, itemId = SPEC_ITEM[run.spec || DEFAULT_SPEC[cls]];
  if (what === 'pull' && itemId) {
    const path = run.path && run.path.length >= 2 ? run.path : null, cum = path ? cumOf(path) : null, L = path ? cum[cum.length - 1] : run.lengthM || 0;
    const f0 = Math.max(0, +opts.from || 0), f1 = Math.min(1, +opts.to || 0);
    if (!(f1 > f0)) return out;
    const s0 = f0 * L, s1 = f1 * L, slack = FIXINGS.slackM[cls] || 0, bs = path ? (run.bores || []).map((b) => sAlong(path, cum, b.at)) : [];
    add(out, itemId, s1 - s0 + (f0 <= 1e-9 ? slack : 0) + (f1 >= 1 - 1e-9 ? slack : 0));
    add(out, FIXINGS.staple[cls], stapleMarks(L, cls, bs).filter((s) => s > s0 + 1e-9 && s <= s1 + 1e-9).length);
    add(out, 'nail_plate', FIXINGS.platesPerHole * (run.bores || []).filter((b, i) => b.plate && bs[i] > s0 - 1e-9 && bs[i] <= s1 + 1e-9 && !(f0 > 0 && bs[i] <= s0 + 1e-9)).length);
  }
  if (what === 'join') add(out, SPEC_RING[run.spec], 1);
  return out;
}
// what is still to go into a run (all of it for one not started): pull what is left, join the ends still open
export function runCostLeft(run) {
  const out = {};
  if ((SERVICE_CLASSES[run.cls] || {}).steps && SERVICE_CLASSES[run.cls].steps.includes('pull') && run.pulled < 1) for (const [k, q] of Object.entries(workCost(run, 'pull', { from: run.pulled || 0, to: 1 }))) add(out, k, q);
  if ((SERVICE_CLASSES[run.cls] || {}).steps && SERVICE_CLASSES[run.cls].steps.includes('join')) for (const e of ['a', 'b']) if (!run.joined || !run.joined[e]) for (const [k, q] of Object.entries(workCost(run, 'join', { end: e }))) add(out, k, q);
  return out;
}
export const runCostAll = (run) => runCostLeft({ ...run, pulled: 0, joined: { a: 0, b: 0 } });
export const nodeCost = (node) => (NODE_ITEM[node.kind] ? { [NODE_ITEM[node.kind]]: 1 } : {});

// ------------------------------------------------------------------------------------------- supply plumbing (S10)
// Stub-outs: a PEX stub is capped when the stubs are set (a cap each), so the lines can be pressure tested before the
// walls close; the cap comes off when its fixture goes on. Trim-out of a stub: set the fixture on it, then a stop on each
// supply it takes, then a supply line from each stop. A sink or shower takes cold and hot: its hot stub is the nearest
// other stub within MATE_M that carries hot pipe, and is trimmed with it.
// Numbers: WaterSense and EPA/IPC fixture flows are in fixtures-water.js; test pressure: IRC P2503.7 asks for the system's
// working pressure at least, held 15 minutes; many authorities ask 100 psi (690 kPa), which is what the gauge reads here.
export const WATER_TEST = Object.freeze({ kPa: 690, holdMin: 15, strokes: 24 });
export const MATE_M = 0.6;
export const WATER_DEVICE = Object.freeze({
  sink_kitchen: { item: 'fx_sink_kitchen', ports: ['in', 'hot'] },
  sink_bath: { item: 'fx_sink_bath', ports: ['in', 'hot'] },
  toilet_flush: { item: 'fx_toilet', ports: ['in'] },
  shower_indoor: { item: 'fx_shower', ports: ['in', 'hot'] },
  tap_hose_bib: { item: 'fx_hose_bib', ports: ['in'] },
});
export const WATER_TRIM_STEPS = Object.freeze(['fix', 'stop', 'line']);
export const WATER_PRESET_DEVICE = Object.freeze({ sink: 'sink_kitchen', bath: 'sink_bath', toilet: 'toilet_flush', shower: 'shower_indoor', tap: 'tap_hose_bib' });
export const WATER_TRIM_TEXT = Object.freeze({
  steps: { fix: 'set the fixture on its stub-out', stop: 'screw an angle stop onto each stub', line: 'connect a supply line from each stop' },
  notReady: { planned: 'Strap the stub-out to the stud first.', runs: 'The pipe to this stub-out is not roughed in yet.', none: 'No pipe comes to this stub-out.', stray: 'What it was fixed to is gone.', mate: 'This is the hot side of a fixture: trim its cold stub.' },
  faults: { bore: 'holes not drilled through to here', pull: 'pipe not pulled through to here', join: 'end not crimped: it sprays', cap: 'stub-out not capped: it sprays', unset: 'stub-out not strapped to the stud' },
});
// what one step at a stub takes: { [itemId]: qty }
export function waterTrimCost(dev, step, units, done = {}) {
  const out = {}, d = WATER_DEVICE[dev];
  if (!d || !(units > 0)) return out;
  if (step === 'fix' && !(done.fix > 0)) out[d.item] = 1;
  if (step === 'stop') out.stop_valve_12 = units;
  if (step === 'line') out.supply_line_12 = units;
  return out;
}
// the cap a stub-out asks for, until it is capped (a node planned before caps existed, already capped, asks for none)
export const capCost = (node) => (node.kind === 'stub_supply' && !(node.set && node.set.capped === true && !node.set.capUsed) ? { pex_cap_12: 1 } : {});
