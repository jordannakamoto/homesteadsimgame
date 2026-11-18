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
  cable_nm_14_2: { id: 'cable_nm_14_2', holeMm: 19, cls: 'cable', name: '14/2 cable', gauge: 14, ratingA: 15, breaker: 'breaker_15a', radiusM: 0.006, colour: '#f0f0e8' },
  cable_nm_12_2: { id: 'cable_nm_12_2', holeMm: 19, cls: 'cable', name: '12/2 cable', gauge: 12, ratingA: 20, breaker: 'breaker_20a', radiusM: 0.007, colour: '#e8d040' },
  cable_nm_10_3: { id: 'cable_nm_10_3', holeMm: 22, cls: 'cable', name: '10/3 cable', gauge: 10, ratingA: 30, breaker: 'breaker_30a', radiusM: 0.009, colour: '#e89040' },
  pex_12_blue: { id: 'pex_12_blue', holeMm: 22, cls: 'supply', name: '1/2 in PEX (cold)', material: 'pipe_pex_12', hot: false, radiusM: 0.008, colour: '#3a7bd5' },
  pex_12_red: { id: 'pex_12_red', holeMm: 22, cls: 'supply', name: '1/2 in PEX (hot)', material: 'pipe_pex_12', hot: true, radiusM: 0.008, colour: '#d04030' },
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
  { id: 'pex_coil_20', name: '20 mm PEX', category: 'plumbing', unit: 'm', massKg: 0.11, priceUsd: 1.2, blurb: 'A size up, for a main line' },
  { id: 'elec_box_wall', name: 'Nail-on wall box, single', category: 'electrical', unit: 'each', massKg: 0.06, priceUsd: 0.75, blurb: 'Nailed to the side of a stud; an outlet or a switch goes in it at trim-out' },
  { id: 'elec_box_ceiling', name: 'Nail-on ceiling box, round', category: 'electrical', unit: 'each', massKg: 0.12, priceUsd: 2.5, blurb: 'Holds a ceiling light' },
  { id: 'cable_staple', name: 'Insulated cable staples', category: 'fasteners', unit: 'each', massKg: 0.002, priceUsd: 0.05, blurb: 'Hold cable to the side of a stud' },
  { id: 'pex_staple', name: 'PEX staples', category: 'fasteners', unit: 'each', massKg: 0.003, priceUsd: 0.08, blurb: 'Plastic straps that hold PEX to a stud or joist' },
  { id: 'nail_plate', name: 'Steel nail plate', category: 'fasteners', unit: 'each', massKg: 0.03, priceUsd: 0.6, blurb: 'Over a hole near the face of a stud, so a drywall screw cannot reach the cable or pipe' },
  { id: 'crimp_ring_12', name: 'Copper crimp rings, 1/2 in', category: 'plumbing', unit: 'each', massKg: 0.004, priceUsd: 0.25, blurb: 'Squeezed over PEX on a fitting with the crimp tool' },
  { id: 'crimp_ring_20', name: 'Copper crimp rings, 20 mm', category: 'plumbing', unit: 'each', massKg: 0.006, priceUsd: 0.35, blurb: 'The same for 20 mm PEX' },
]);
// used up by the stacks, never carried
export const SERVICE_SUPPLY = Object.freeze(['cable_staple', 'pex_staple', 'nail_plate', 'crimp_ring_12', 'crimp_ring_20']);
// what a run of each spec is bought as, and the ring that closes each end of it
export const SPEC_ITEM = Object.freeze({ cable_nm_14_2: 'nm_cable_14_2', cable_nm_12_2: 'nm_cable_12_2', cable_nm_10_3: 'nm_cable_10_3', pex_12_blue: 'pex_coil_12_blue', pex_12_red: 'pex_coil_12_red', pex_20: 'pex_coil_20' });
export const SPEC_RING = Object.freeze({ pex_12_blue: 'crimp_ring_12', pex_12_red: 'crimp_ring_12', pex_20: 'crimp_ring_20' });
export const NODE_ITEM = Object.freeze({ box: 'elec_box_wall', box_ceiling: 'elec_box_ceiling' });
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
  elec_box_wall: { label: 'Wall boxes', why: 'An outlet or switch goes in each one at trim-out.' },
  elec_box_ceiling: { label: 'Ceiling boxes', why: 'A light hangs from each one.' },
  cable_staple: { label: 'Cable staples', why: 'Hold the cable to the studs.' },
  pex_staple: { label: 'PEX staples', why: 'Hold the pipe to the studs and joists.' },
  nail_plate: { label: 'Nail plates', why: 'Guard holes near the face of a stud from the screws of the wall boards.' },
  crimp_ring_12: { label: 'Crimp rings', why: 'One at each end of a PEX run.' },
  crimp_ring_20: { label: 'Crimp rings, 20 mm', why: 'One at each end of a 20 mm run.' },
});

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
