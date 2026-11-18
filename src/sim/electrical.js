// Electrical: solar panels, charge controllers, batteries, inverters, generators, wires, breakers and
// loads, solved every minute of world time from what is actually built and wired.
//
// What the system knows comes only from pieces (ARCHITECTURE.md, "Fixtures and connections"): fixture
// pieces whose `fixture` is in FIXTURES_ELECTRICAL, and connection pieces of kind "wire" between their
// ports. Other systems add loads with the command electrical.setLoad. With no electrical fixture built
// the step returns after one cached lookup.
//
// The network
//   Ports are vertices; a junction (busbar, breaker panel) is one vertex; wires and closed breakers are
//   edges. Connected vertices form a bus. A bus is "pv" (panels to a charge controller), "dc" (the
//   battery side) or "ac" (inverter or generator output) by the ports on it. A circuit is one DC bus
//   with its batteries, the controllers that charge it with their PV buses, and the AC bus its inverters
//   feed; or an AC bus fed by a generator alone. Each bus is solved as a tree rooted at its slack device
//   (battery, controller, inverter or generator): power flows from the leaves to the root, and each
//   wire adds I^2 R of loss with I = P / V on that run (a loop is reported and its extra wire ignored).
//
// Each minute
//   Solar     plane-of-array irradiance from weather.solar and the sun's position: direct beam by the
//             incidence angle on the panel (with the ASHRAE glass reflection modifier, b0 = 0.05),
//             isotropic sky diffuse by the sky-view factor (1 + cos tilt) / 2, and ground reflection
//             with albedo 0.2 rising to 0.8 over fresh snow. Cell temperature from NOCT:
//             Tc = Ta + (NOCT - 20) x POA / 800. DC power = rated x POA / 1000 x (1 + gamma (Tc - 25))
//             x 0.96 (soiling 2 %, mismatch and nameplate tolerance 2 %) x (1 - snow cover).
//             Snow: snowfall covers a panel tilted below 60 degrees (1 mm of water, about 1 cm of new
//             snow, covers it fully). It slides off at 0.197 x sin(tilt) of the panel per hour whenever
//             Ta > -POA / 80 (the sliding rule of Marion et al. 2013, NREL), and melts at 2 % per degree-
//             hour above 0 C (a simple rule of our own, so flat panels clear eventually). Controllers:
//             MPPT converts at its efficiency if the array voltage is at least battery + 1 V; PWM pulls
//             the array down to battery voltage and loses the difference. Both clip at their current.
//   Batteries charge and discharge with separate efficiencies, within C-rate limits, between the usable
//             floor (1 - usable fraction of capacity) and full, with a charge taper near full,
//             self-discharge, and no charging of lithium below its minimum charge temperature (the air
//             temperature, or locationTempC[pieceId] set by electrical.setLocationTemp for a battery
//             indoors). Bus voltage is the bank's open-circuit voltage at its state of charge.
//   Loads     on or off, scheduled by settings.hours, duty-cycled (a fridge runs more when it is warm).
//             When the panels, the battery's allowed discharge and the generator cannot meet demand,
//             or the inverter is too small, loads are shed from the lowest priority up; a load that only
//             fits for part of the minute (the battery reaching its floor) gets that fraction. `served`
//             is the delivered share of what it asked for (0..1).
//   Wires     current against ampacity, voltage drop 2 I R L as a percentage (warned above 3 %), I^2 R
//             loss as heat. Breakers integrate their overload along a trip curve and stay tripped until
//             electrical.resetBreaker.
//   Generator runs when switched on or by its auto-start rule (settings.autoStart, startBelow and
//             stopAbove as fractions of the usable battery), serves AC loads first, charges the battery
//             through an inverter-charger, and burns fuel along its Willans line until the tank is empty.
//
// Energy is conserved, every minute and in the books:
//   generated + discharged + generator = used + charged + wire losses + inverter losses + wasted
// where generated is what the charge controllers could deliver and wasted is what they held back
// because nothing could take it (a full battery). Upstream of that, array output = generated +
// controller loss (including PWM mismatch and clipping) + PV wire loss; and inside each battery,
// change in stored = charged x chargeEff - discharged / dischargeEff - self-discharge.
//
// Simplified: one battery bank and one AC side per circuit (a second inverter to a different AC side
// is reported and left out); no DC-DC converters, alternator charging, motor start surges, battery
// internal resistance or ageing; breaker panels are junctions (their main is not checked); a flush roof
// mount does not read the roof pitch yet (set tiltDeg). Ampacity is checked without the 125 %
// continuous-load factor, which is only used to recommend a gauge.

import { FIXTURES_ELECTRICAL as CAT, WIRE_GAUGES, wireSpec } from './fixtures-electrical.js';
import { sunPosition, clearSkyIrradiance } from './calendar.js';
import { dayIndex, dayFraction } from './time.js';
import { hashString } from './rng.js';

export { FIXTURES_ELECTRICAL, WIRE_GAUGES, wireSpec } from './fixtures-electrical.js';

const STATE_V = 1;
const ISSUE_EVERY = 10;                 // ticks between refreshes of the dynamic issues
const DERATE = 0.96;                    // soiling and mismatch
const IAM_B0 = 0.05;                    // ASHRAE incidence angle modifier
const ALBEDO = 0.2, ALBEDO_SNOW = 0.8;
const DROP_WARN = 3;                    // percent
const COLD_DESIGN_C = -20;              // array open-circuit voltage is checked at this cell temperature
const AC_V = 120;
const RAD = Math.PI / 180;
const EPS = 1e-9;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (x) => Math.round(x * 1000) / 1000;
const classV = (v) => (v < 18 ? 12 : v < 36 ? 24 : 48);           // nominal system class of a DC voltage

// ------------------------------------------------------------------------------------------- pure physics
// Plane-of-array irradiance, W/m2. solar: { directNormalWm2, diffuseWm2, globalHorizontalWm2 };
// sun: { elevationRad, azimuthRad }; tilt from horizontal, azimuth clockwise from north (both radians).
export function planeOfArray(solar, sun, tiltRad, azimuthRad, albedo = ALBEDO) {
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  let beam = 0, cosInc = 0;
  if (sun.elevationRad > 0) {
    cosInc = Math.sin(sun.elevationRad) * cosT + Math.cos(sun.elevationRad) * sinT * Math.cos(sun.azimuthRad - azimuthRad);
    if (cosInc > 0) beam = solar.directNormalWm2 * cosInc * Math.max(0, 1 - IAM_B0 * (1 / cosInc - 1));
  }
  const diffuse = solar.diffuseWm2 * (1 + cosT) / 2, ground = solar.globalHorizontalWm2 * albedo * (1 - cosT) / 2;
  return { poaWm2: beam + diffuse + ground, beamWm2: beam, diffuseWm2: diffuse, groundWm2: ground, cosIncidence: cosInc };
}
export const cellTempC = (airC, poaWm2, noctC) => airC + ((noctC - 20) * poaWm2) / 800;
export const panelDcW = (def, poaWm2, airC, cover = 0) =>
  Math.max(0, def.ratedW * (poaWm2 / 1000) * (1 + def.tempCoeffPmaxPerC * (cellTempC(airC, poaWm2, def.noctC) - 25)) * DERATE * (1 - cover));
export function ocvAt(def, soc) {
  const c = def.ocv; if (soc <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (soc <= c[i][0]) { const [s0, v0] = c[i - 1], [s1, v1] = c[i]; return v0 + ((v1 - v0) * (soc - s0)) / (s1 - s0); }
  return c[c.length - 1][1];
}
export const inverterLossW = (def, outW) => def.idleW + def.lossK1 * outW + def.lossK2 * outW * outW;
export const generatorFuelLph = (def, outW) => def.idleLph + (def.lPerKWh * outW) / 1000;
// Seconds to trip at a multiple of the breaker rating (log-linear between the conventional points).
const TRIP = [[1.13, 1e9], [1.45, 3600], [2, 120], [3, 20], [5, 0.01]];
export function tripSeconds(m) {
  if (m <= TRIP[0][0]) return Infinity;
  if (m >= 5) return 0.01;
  for (let i = 1; i < TRIP.length; i++) if (m <= TRIP[i][0]) {
    const [m0, t0] = TRIP[i - 1], [m1, t1] = TRIP[i];
    return Math.exp(Math.log(t0) + ((m - m0) / (m1 - m0)) * (Math.log(t1) - Math.log(t0)));
  }
  return 0.01;
}
// Voltage drop of a two-conductor run, percent of the voltage.
export const dropPercent = (currentA, spec, lengthM, volts) => (200 * currentA * spec.ohmPerM * lengthM) / volts;
const cloudTransmission = (c) => 1 - 0.75 * Math.pow(c, 3.4);   // the same rules weather.js uses
const directTransmission = (c) => Math.max(0, 1 - Math.pow(c, 1.5));

// ------------------------------------------------------------------------------------------- pieces
// The site's pieces plus what other systems add (services: cable runs in buildings, as { version, powerPieces }).
// Memoised by the identity of both arrays: the topology cache below is keyed by array identity, so an
// unmemoised concat would recompile the network every tick.
const SOURCES = ['services'];
const merged = new WeakMap();
function piecesFor(state) {
  const site = state && state.sys ? state.sys.site : null;
  if (!site || !Array.isArray(site.pieces)) return null;
  const extras = [];
  for (const n of SOURCES) { const x = state.sys[n], e = x && (x.powerPieces || x.pieces); if (e && e.length) extras.push(e); }
  if (!extras.length) return site.pieces;
  let m = merged.get(site.pieces);
  if (!m || m.extras.length !== extras.length || m.extras.some((e, i) => e !== extras[i])) { m = { extras, all: site.pieces.concat(...extras) }; merged.set(site.pieces, m); }
  return m.all;
}
function versionOf(state) {
  const site = state.sys.site;
  let v = String(site ? site.version | 0 : 0);
  for (const n of SOURCES) { const x = state.sys[n]; if (x && x.version) v += ':' + n + x.version; }
  return v;
}

// ------------------------------------------------------------------------------------------- topology
// Compiled from pieces plus the few things in state that change the wiring (tripped breakers, inverters
// switched off, loads attached by command). Pure, cached per pieces array and key, never saved.
const cache = new WeakMap();
export const electricalStats = { compiles: 0 };    // topology compiles since load (a test asserts idle ticks add none)
const EMPTY = Object.freeze({ empty: true });
const FOREIGN = Object.freeze({ id: 'foreign', noun: 'device', category: 'load', ratedW: 0, supply: 'any', priority: 5, voltageV: 120, loadPoint: true, foreign: true });

function topology(pieces, s) {
  if (!Array.isArray(pieces) || !pieces.length) return EMPTY;
  let m = cache.get(pieces);
  if (!m) { m = new Map(); cache.set(pieces, m); }
  let t = m.get(s.topoKey);
  if (!t) { t = compile(pieces, s); if (m.size > 16) m.clear(); m.set(s.topoKey, t); }
  return t;
}
function topoKeyOf(s) {
  const trips = Object.keys(s.breakers).filter((k) => s.breakers[k].tripped).sort().join(',');
  const sw = Object.keys(s.switches).filter((k) => s.switches[k] === false).sort().join(',');
  const cmd = Object.keys(s.loads).filter((k) => s.loads[k].source === 'command').sort()
    .map((k) => k + ':' + (s.loads[k].pieceId || '') + ':' + s.loads[k].priority + ':' + (s.loads[k].supply || '') + ':' + (s.loads[k].voltageV || '')).join(',');
  return trips + '|' + sw + '|' + cmd;
}

const ROLE_OF = { solar_panel: 'panel', battery: 'battery', generator: 'gen', load: 'load', tool: 'load', outlet: 'load' };

function compile(pieces, s) {
  electricalStats.compiles++;
  const fx = new Map();          // pieceId -> { p, def }
  let own = 0;
  for (const p of pieces) {
    if (!p || p.kind !== 'fixture') continue;
    const def = CAT[p.fixture];
    if (def) { fx.set(p.id, { p, def }); own++; }
    else if (Array.isArray(p.ports) && p.ports.some((q) => q && q.type === 'power')) fx.set(p.id, { p, def: { ...FOREIGN, ports: p.ports.filter((q) => q.type === 'power') } });
  }
  if (!own) return EMPTY;
  const issues = [];
  const issue = (severity, pieceId, reason, fix) => issues.push({ severity, pieceId, reason, fix });
  const nounOf = (id) => { const f = fx.get(id); return f ? f.def.noun : 'device'; };
  const set = (p, k, d) => (p.settings && p.settings[k] !== undefined ? p.settings[k] : d);

  // vertices
  const vKey = new Map(), verts = [];
  const vertex = (key, info) => { if (!vKey.has(key)) { vKey.set(key, verts.length); verts.push(info); } return vKey.get(key); };
  const terms = [];              // { v, pieceId, port, role, def, p }
  for (const [id, { p, def }] of fx) {
    if (def.category === 'solar_mount') continue;
    const off = s.switches[id] === false || (def.category === 'inverter' && set(p, 'on', true) === false);
    if (def.role === 'junction') { vertex(id, { pieceId: id }); continue; }
    for (const port of def.ports) {
      const v = vertex(id + ':' + port.id, { pieceId: id, port: port.id });
      if (def.role === 'breaker' || off) continue;
      let role = ROLE_OF[def.category];
      if (def.category === 'charge_controller') role = port.id === 'pv' ? 'ctrl_pv' : 'ctrl_dc';
      if (def.category === 'inverter') role = port.id === 'dc' ? 'inv_dc' : 'inv_ac';
      if (def.foreign) role = 'load';
      terms.push({ v, pieceId: id, port: port.id, role, def, p, bus: port.bus });
    }
  }
  const portVertex = (end) => {
    if (!end || !fx.has(end.piece)) return -1;
    const { def } = fx.get(end.piece);
    if (def.role === 'junction') return vKey.get(end.piece);
    const k = end.piece + ':' + end.port;
    return vKey.has(k) ? vKey.get(k) : -1;
  };

  // edges: wires and closed breakers
  const edges = [];              // { a, b, R, wire?, breaker? }
  const wires = [], breakers = [];
  for (const p of pieces) {
    if (!p || p.kind !== 'wire') continue;
    const a = portVertex(p.from), b = portVertex(p.to);
    if (a < 0 || b < 0) { issue('warning', p.id, 'A wire ends at something that is not an electrical port.', 'Connect both ends of the wire to a device.'); continue; }
    let spec = wireSpec(p.gauge);
    if (!spec) { spec = wireSpec(14); issue('warning', p.id, 'A wire has no gauge set, so it is treated as 14 AWG.', 'Choose the wire gauge.'); }
    const lengthM = p.lengthM > 0 ? p.lengthM : 1;
    const w = { id: p.id, from: p.from.piece, to: p.to.piece, spec, lengthM, R: 2 * spec.ohmPerM * lengthM, bus: -1, v: -1 };
    wires.push(w); if (a !== b) edges.push({ a, b, R: w.R, wire: w });
  }
  for (const [id, { def }] of fx) {
    if (def.role !== 'breaker') continue;
    const br = { id, ratingA: def.ratingA, bus: -1, v: -1, tripped: !!(s.breakers[id] && s.breakers[id].tripped) };
    breakers.push(br);
    if (!br.tripped) edges.push({ a: vKey.get(id + ':line'), b: vKey.get(id + ':load'), R: 0, breaker: br });
  }

  // buses (union-find)
  const uf = verts.map((_, i) => i);
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  for (const e of edges) uf[find(e.a)] = find(e.b);
  const busOf = new Map(), buses = [];
  for (let i = 0; i < verts.length; i++) {
    const r = find(i);
    if (!busOf.has(r)) { busOf.set(r, buses.length); buses.push({ idx: buses.length, verts: [], terms: [], types: new Set(), edges: [] }); }
    const B = buses[busOf.get(r)]; verts[i].bus = B.idx; verts[i].local = B.verts.length; B.verts.push(i);
  }
  for (const t of terms) { const B = buses[verts[t.v].bus]; B.terms.push(t); if (t.bus) B.types.add(t.bus); }
  for (const e of edges) buses[verts[e.a].bus].edges.push(e);
  const wired = new Set();
  for (const e of edges) { wired.add(verts[e.a].pieceId); wired.add(verts[e.b].pieceId); }
  for (const [id, { def }] of fx) if (def.category !== 'solar_mount' && !wired.has(id))
    issue('info', id, 'The ' + def.noun + ' is not wired to anything.', 'Run a wire from it to the rest of the system.');

  const byRole = (B, role) => B.terms.filter((t) => t.role === role).sort((x, y) => (x.pieceId < y.pieceId ? -1 : 1));
  for (const B of buses) {
    B.type = B.types.size === 1 ? [...B.types][0] : B.types.size === 0 ? 'none' : 'mixed';
    if (B.type === 'mixed') {
      const panels = byRole(B, 'panel');
      if (panels.length && B.types.has('dc')) issue('danger', panels[0].pieceId, 'The solar panel is wired straight to the battery side.', 'Put a charge controller between the panels and the battery.');
      else issue('danger', B.terms[0].pieceId, 'Two different sides of the system are wired together (' + [...B.types].join(' and ') + ').', 'Separate them: panels go to a charge controller, the battery to the inverter, AC loads after the inverter.');
    }
  }

  // circuits: one per usable DC bus, then generator-only AC buses
  const circuits = [], claimedAc = new Set(), claimedPv = new Set();
  const panels = [], ctrls = [], bats = [], invs = [], gens = [], loads = [];
  const newCircuit = () => { const c = { idx: circuits.length, dc: null, ac: null, pv: [], ctrls: [], bats: [], invs: [], gens: [], loads: [], classV: 12 }; circuits.push(c); return c; };
  for (const B of buses) {
    if (B.type !== 'dc') continue;
    const bt = byRole(B, 'battery'), ct = byRole(B, 'ctrl_dc'), it = byRole(B, 'inv_dc');
    if (!bt.length && !ct.length) {
      if (it.length) issue('warning', it[0].pieceId, 'The ' + it[0].def.noun + ' has nothing to draw from: no battery or charge controller is wired to it.', 'Wire it to a battery.');
      continue;
    }
    const c = newCircuit(); c.dc = B;
    // battery bank: one voltage class
    const cv = bt.length ? classV(bt[0].def.nominalV) : classV(set(ct[0].p, 'systemV', 12));
    c.classV = cv;
    for (const t of bt) {
      if (classV(t.def.nominalV) !== cv) { issue('danger', t.pieceId, 'A ' + t.def.nominalV + ' V battery is wired to a ' + cv + ' V battery bank.', 'Batteries in one bank must have the same voltage.'); continue; }
      if (c.bats.length && t.def.chemistry !== c.bats[0].def.chemistry) issue('warning', t.pieceId, 'Lead-acid and lithium batteries are mixed in one bank.', 'Use one chemistry per bank; they charge to different voltages.');
      const b = { ...t, circuit: c.idx, idx: bats.length }; bats.push(b); c.bats.push(b);
    }
    c.root = c.bats.length ? c.bats[0] : ct[0];
    for (const t of ct) {
      const def = t.def;
      if (!def.systemV.includes(cv)) { issue('danger', t.pieceId, 'The ' + def.name + ' does not work on a ' + cv + ' V battery.', 'Use a controller rated for ' + cv + ' V.'); continue; }
      const pvT = terms.find((q) => q.pieceId === t.pieceId && q.role === 'ctrl_pv'), PB = buses[verts[pvT.v].bus];
      const series = Math.max(1, set(t.p, 'seriesPanels', 1) | 0);
      const k = { ...t, circuit: c.idx, idx: ctrls.length, pvBus: null, pvRoot: pvT, series, panels: [] };
      if (PB.type === 'pv' && !claimedPv.has(PB.idx)) {
        claimedPv.add(PB.idx); k.pvBus = PB;
        for (const pt of byRole(PB, 'panel')) { const pn = { ...pt, ctrl: k.idx, idx: panels.length }; panels.push(pn); k.panels.push(pn); }
        for (const q of byRole(PB, 'ctrl_pv')) if (q.pieceId !== t.pieceId) issue('warning', q.pieceId, 'Two charge controllers share one set of panels.', 'Give each controller its own panels.');
        if (k.panels.length) checkArray(k, cv, issue);
      }
      ctrls.push(k); c.ctrls.push(k);
    }
    if (!c.bats.length) { if (c.ctrls.length) c.root = c.ctrls[0]; else c.deadDc = true; }
    // inverters to one AC side
    for (const t of it) {
      const def = t.def;
      if (def.dcV !== cv) { issue('danger', t.pieceId, 'The ' + def.dcV + ' V ' + def.noun + ' is wired to a ' + cv + ' V battery.', 'Use a ' + cv + ' V inverter or a ' + def.dcV + ' V battery bank.'); continue; }
      const acT = terms.find((q) => q.pieceId === t.pieceId && q.role === 'inv_ac'), AB = buses[verts[acT.v].bus];
      if (AB.type !== 'ac') continue;
      if (c.ac && c.ac !== AB) { issue('warning', t.pieceId, 'This inverter feeds a second, separate AC side; only one is supported per battery bank.', 'Join the AC outputs on one breaker panel.'); continue; }
      if (claimedAc.has(AB.idx) && c.ac !== AB) { issue('warning', t.pieceId, 'Two battery banks feed the same AC side through different inverters.', 'Give each bank its own AC side.'); continue; }
      claimedAc.add(AB.idx); c.ac = AB;
      const inv = { ...t, circuit: c.idx, idx: invs.length, acTerm: acT }; invs.push(inv); c.invs.push(inv);
    }
  }
  for (const B of buses) if (B.type === 'ac' && !claimedAc.has(B.idx) && byRole(B, 'gen').length) { const c = newCircuit(); c.ac = B; claimedAc.add(B.idx); }
  for (const B of buses) if (B.type === 'pv' && !claimedPv.has(B.idx)) { const pt = byRole(B, 'panel'); if (pt.length) issue('warning', pt[0].pieceId, 'The solar panel is not wired to a charge controller, so its power goes nowhere.', 'Wire the panels to a charge controller.'); }

  // generators, loads
  const cmdAt = new Map();
  for (const k of Object.keys(s.loads).sort()) { const L = s.loads[k]; if (L.source === 'command' && L.pieceId) cmdAt.set(L.pieceId, k); }
  for (const c of circuits) {
    if (c.ac) for (const t of byRole(c.ac, 'gen')) { const g = { ...t, circuit: c.idx, idx: gens.length }; gens.push(g); c.gens.push(g); }
    if (!c.root && c.ac) c.root = c.gens[0];
    c.splitPhase = c.invs.length ? c.invs.every((i) => i.def.splitPhase) : c.gens.length ? c.gens.every((g) => g.def.splitPhase) : false;
  }
  const circuitOfBus = new Map();
  for (const c of circuits) { if (c.dc) circuitOfBus.set(c.dc.idx, c); if (c.ac) circuitOfBus.set(c.ac.idx, c); }
  const addLoad = (id, t, def, opts) => {
    const B = buses[verts[t.v].bus], c = circuitOfBus.get(B.idx);
    const L = { id, pieceId: t.pieceId, def, v: t.v, bus: B.idx, circuit: c ? c.idx : -1, idx: loads.length, ...opts };
    const supply = opts.supply || def.supply, volts = opts.voltageV || def.voltageV || AC_V;
    L.voltageV = B.type === 'ac' ? volts : c ? c.classV : 12;
    L.ok = !!c;
    if (!c) { if (B.type !== 'mixed') issue('warning', t.pieceId, 'The ' + def.noun + ' has no power: nothing on its wiring can supply it.', 'Wire it to a battery, an inverter or a generator.'); }
    else if (B.type === 'pv') { L.ok = false; issue('danger', t.pieceId, 'The ' + def.noun + ' is wired to the panel side of the charge controller.', 'Wire it to the battery side.'); }
    else if (B.type === 'dc' && supply === 'ac') { L.ok = false; issue('warning', t.pieceId, 'The ' + def.noun + ' needs 120 V AC, but it is wired to the ' + c.classV + ' V battery side.', 'Wire it after the inverter.'); }
    else if (B.type === 'dc' && def.dcV && !def.dcV.includes(c.classV)) { L.ok = false; issue('warning', t.pieceId, 'The ' + def.noun + ' is a ' + def.dcV[0] + ' V device on a ' + c.classV + ' V battery.', 'Power it from a ' + def.dcV[0] + ' V system or through the inverter.'); }
    else if (B.type === 'ac' && supply === 'dc') { L.ok = false; issue('warning', t.pieceId, 'The ' + def.noun + ' runs on 12 V DC, but it is wired to the 120 V AC side.', 'Wire it to the battery side, or use the 120 V version.'); }
    else if (B.type === 'ac' && volts === 240 && !c.splitPhase) { L.ok = false; issue('warning', t.pieceId, 'The ' + def.noun + ' needs 240 V, and this AC side only gives 120 V.', 'Use a split-phase inverter or generator.'); }
    loads.push(L); if (c) c.loads.push(L);
  };
  for (const t of terms) {
    if (t.role !== 'load') continue;
    const cmd = cmdAt.get(t.pieceId);
    if (cmd) continue;   // a command load attached here speaks for this fixture
    const def = t.def, p = t.p;
    addLoad(t.pieceId, t, def, { fixture: true, priority: set(p, 'priority', def.priority), hours: set(p, 'hours', null), dutyFraction: set(p, 'dutyFraction', null) });
  }
  const main = circuits.slice().sort((a, b) => mainScore(b) - mainScore(a))[0];
  for (const k of Object.keys(s.loads).sort()) {
    const L = s.loads[k]; if (L.source !== 'command') continue;
    let t = null;
    if (L.pieceId && fx.has(L.pieceId)) {
      const f = fx.get(L.pieceId);
      t = f.def.role === 'junction' ? { v: vKey.get(L.pieceId), pieceId: L.pieceId } : terms.find((q) => q.pieceId === L.pieceId) || { v: vKey.get(L.pieceId + ':' + f.def.ports[0].id), pieceId: L.pieceId };
    } else if (main && !L.pieceId) t = { v: (main.ac ? (main.invs[0] ? main.invs[0].acTerm : main.root) : main.root).v, pieceId: null };
    if (!t || t.v === undefined) continue;
    addLoad(k, t, { ...FOREIGN, noun: L.noun || 'load', supply: L.supply || 'any', voltageV: L.voltageV || AC_V }, { command: true, priority: L.priority, supply: L.supply, voltageV: L.voltageV });
  }

  // trees
  for (const B of buses) buildTree(B, verts, circuits, issue);
  for (const w of wires) { const e = edges.find((q) => q.wire === w); if (e && e.child !== undefined) { w.bus = verts[e.a].bus; w.v = e.child; } }
  for (const br of breakers) { const e = edges.find((q) => q.breaker === br); if (e && e.child !== undefined) { br.bus = verts[e.a].bus; br.v = e.child; } }
  for (const B of buses) { B.wires = wires.filter((w) => w.bus === B.idx && w.v >= 0); B.breakers = breakers.filter((b) => b.bus === B.idx && b.v >= 0); }
  const local = (gv) => verts[gv].local;
  for (const c of circuits) {
    c.order = c.loads.slice().sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
    c.dcLoads = c.loads.filter((L) => L.ok && L.bus === (c.dc && c.dc.idx));
    c.acLoads = c.loads.filter((L) => L.ok && L.bus === (c.ac && c.ac.idx));
    for (const L of c.loads) L.lv = local(L.v);
    for (const x of [...c.bats, ...c.ctrls, ...c.invs, ...c.gens]) x.lv = local(x.v);
    for (const i of c.invs) i.alv = local(i.acTerm.v);
    for (const k of c.ctrls) { k.plv = local(k.pvRoot.v); for (const pn of k.panels) pn.lv = local(pn.v); }
    c.invRatedW = c.invs.reduce((a, i) => a + i.def.ratedW, 0);
    c.charger = c.invs.find((i) => i.def.charger) || null;
    c.genRated = c.gens.reduce((a, g) => a + g.def.ratedW, 0);
    c.demand = new Float64Array(c.order.length); c.served = new Float64Array(c.order.length);
    for (let i = 0; i < c.order.length; i++) c.order[i].oi = i;
    c.rootIsBat = !!(c.root && c.root.role === 'battery');
    c.acRootGen = !!(c.ac && !c.invs.length);
  }
  for (const L of loads) {
    L.phase = (hashString(L.id) % 997) / 997;
    if (L.def.duty === 'fridge') L.cycleMin = L.def.cycleMin;
  }
  for (const pn of panels) {
    const p = pn.p, mountP = p.settings && p.settings.mount ? (fx.get(p.settings.mount) || null) : null;
    const md = mountP ? mountP.def.defaultSettings : null, ms = mountP ? mountP.p.settings || {} : {};
    const tilt = set(p, 'tiltDeg', ms.tiltDeg !== undefined ? ms.tiltDeg : md ? md.tiltDeg : 0);
    const az = set(p, 'azimuthDeg', ms.azimuthDeg !== undefined ? ms.azimuthDeg : md ? md.azimuthDeg : 180);
    pn.tiltRad = clamp(tilt, 0, 90) * RAD; pn.azRad = az * RAD; pn.cosT = Math.cos(pn.tiltRad); pn.sinT = Math.sin(pn.tiltRad);
  }
  designChecks(buses, verts, wires, circuits, ctrls, nounOf, issue);
  return { empty: false, buses, verts, wires, breakers, circuits, panels, ctrls, bats, invs, gens, loads, issues, fx, main };
}
const mainScore = (c) => c.bats.reduce((a, b) => a + b.def.capacityWh, 0) + c.invs.reduce((a, i) => a + i.def.ratedW, 0) + c.gens.reduce((a, g) => a + g.def.ratedW, 0);

function checkArray(k, cv, issue) {
  const pd = k.panels[0].def, def = k.def;
  const vocCold = pd.vocV * k.series * (1 + pd.tempCoeffVocPerC * (COLD_DESIGN_C - 25));
  if (vocCold > def.maxPvV) { k.disabled = true; issue('danger', k.pieceId, 'On a cold morning the panels reach ' + vocCold.toFixed(0) + ' V, above the ' + def.maxPvV + ' V the charge controller can take.', 'Wire fewer panels in series, or use a controller with a higher voltage limit.'); }
  const vmp = pd.vmpV * k.series, vbat = cv * 1.15;
  if (def.type === 'mppt' && vmp < vbat + 5) { issue('warning', k.pieceId, 'The panels give ' + vmp.toFixed(0) + ' V, too little to charge a ' + cv + ' V battery through an MPPT controller.', 'Wire ' + Math.ceil((vbat + 5) / pd.vmpV) + ' panels in series (settings.seriesPanels).'); }
  if (def.type === 'pwm' && vmp > vbat * 1.35) issue('info', k.pieceId, 'A PWM controller holds these panels at battery voltage and wastes about ' + Math.round(100 * (1 - vbat / vmp)) + '% of their power.', 'Use an MPPT controller.');
}

// Breadth-first spanning tree from the bus's slack device; post-order for the power pass.
function buildTree(B, verts, circuits, issue) {
  const n = B.verts.length;
  B.n = n; B.parent = new Int32Array(n).fill(-1); B.R = new Float64Array(n); B.vf = new Float64Array(n).fill(1);
  B.inj = new Float64Array(n); B.acc = new Float64Array(n); B.loss = new Float64Array(n); B.V = 1;
  const adj = Array.from({ length: n }, () => []);
  for (const e of B.edges) { const a = verts[e.a].local, b = verts[e.b].local; adj[a].push([b, e]); adj[b].push([a, e]); }
  let rootT = null;
  const c = circuits.find((q) => q.dc === B || q.ac === B);
  if (c && c.dc === B) rootT = c.root;
  else if (c && c.ac === B) rootT = c.invs.length ? c.invs[0].acTerm : c.gens[0];
  else if (B.type === 'pv') rootT = B.terms.find((t) => t.role === 'ctrl_pv');
  const root = rootT ? verts[rootT.v].local : 0;
  B.root = root;
  const seen = new Uint8Array(n), bfs = [root]; seen[root] = 1;
  const used = new Set();
  for (let i = 0; i < bfs.length; i++) {
    const v = bfs[i];
    for (const [u, e] of adj[v]) {
      if (seen[u]) continue;
      seen[u] = 1; B.parent[u] = v; B.R[u] = e.R; e.child = u; used.add(e); bfs.push(u);
    }
  }
  for (const e of B.edges) if (!used.has(e) && e.wire) issue('info', e.wire.id, 'This wire closes a loop; the simulator carries no current on it.', 'Wire the system as a tree, from the battery out.');
  B.order = Int32Array.from(bfs.slice(1).reverse());
}

// Design currents (everything on at its rating), checked once when the wiring changes.
function designChecks(buses, verts, wires, circuits, ctrls, nounOf, issue) {
  for (const B of buses) {
    if (B.type === 'mixed' || B.type === 'none') continue;
    const c = circuits.find((q) => q.dc === B || q.ac === B);
    // two design cases, each with its own flows: (a) every load and inverter at its rating, supplied
    // by the batteries in proportion to capacity; (b) every controller, panel and generator at its
    // rating, taken up by the batteries (or the slack device). An edge must carry the larger.
    const fa = new Float64Array(B.n), fb = new Float64Array(B.n), n120 = new Int32Array(B.n), n240 = new Int32Array(B.n);
    let V = B.type === 'ac' ? AC_V : c ? c.classV : 12;
    if (B.type === 'pv') { const t = B.terms.find((q) => q.role === 'panel'), k = ctrls.find((q) => q.pvBus === B); V = t ? t.def.vmpV * (k ? k.series : 1) : 18; }
    let sinks = 0, srcs = 0;
    const batT = c && c.dc === B ? c.bats : [], capSum = batT.reduce((x, b) => x + b.def.capacityWh, 0);
    for (const t of B.terms) {
      const lv = verts[t.v].local, d = t.def;
      if (t.role === 'load') { const w = t.p.settings && t.p.settings.ratedW !== undefined ? t.p.settings.ratedW : d.ratedW || 0; fa[lv] += w; sinks += w; if (d.voltageV === 240) n240[lv]++; else n120[lv]++; }
      else if (t.role === 'inv_dc') { fa[lv] += d.ratedW / d.eff100; sinks += d.ratedW / d.eff100; }
      else if (t.role === 'ctrl_dc') { fb[lv] -= d.maxOutputA * V; srcs += d.maxOutputA * V; }
      else if (t.role === 'panel' || t.role === 'gen') { fb[lv] -= d.ratedW; srcs += d.ratedW; }
    }
    for (const b of batT) { const lv = verts[b.v].local, sh = b.def.capacityWh / capSum; fa[lv] -= sinks * sh; fb[lv] += srcs * sh; }
    for (const v of B.order) { const p = B.parent[v]; fa[p] += fa[v]; fb[p] += fb[v]; n120[p] += n120[v]; n240[p] += n240[v]; }
    if (B.type === 'ac') for (const v of B.order) if (n240[v] > 0 && n120[v] === 0) B.vf[v] = 2;
    B.designW = Float64Array.from({ length: B.n }, (_, i) => Math.max(Math.abs(fa[i]), Math.abs(fb[i])));
    B.nomV = V;
  }
  for (const w of wires) {
    if (w.v < 0 || !buses[w.bus].designW) continue;
    const B = buses[w.bus], V = B.nomV * B.vf[w.v], I = B.designW[w.v] / V;
    w.designA = I; w.designDropPct = dropPercent(I, w.spec, w.lengthM, V);
    const between = 'from the ' + nounOf(w.from) + ' to the ' + nounOf(w.to);
    const thin = I > w.spec.ampacityA, drop = w.designDropPct > DROP_WARN;
    if (!thin && !drop) continue;
    const need = WIRE_GAUGES.find((g) => g.ampacityA >= 1.25 * I && dropPercent(I, g, w.lengthM, V) <= DROP_WARN);
    const atV = V < 60 ? ' at ' + Math.round(V) + ' V' : '';
    const shorter = 'shorten the run to ' + Math.max(0.1, (DROP_WARN * V) / (200 * I * w.spec.ohmPerM)).toFixed(1) + ' m';
    const reason = thin
      ? 'The wire ' + between + ' is too thin for ' + Math.round(I) + ' A' + atV + '. ' + w.spec.gaugeAwg + ' AWG is rated for ' + w.spec.ampacityA + ' A.'
      : 'The wire ' + between + ' loses ' + w.designDropPct.toFixed(1) + '% of the voltage' + atV + ' (' + (w.designDropPct * V / 100).toFixed(2) + ' V).';
    const fix = need ? 'Use ' + need.gaugeAwg + ' AWG' + (drop ? ' or ' + shorter : thin ? ' or shorten the run' : '') + '.'
      : 'Even the thickest cable is not enough: run two cables in parallel, shorten the run, or use a higher system voltage.';
    issue(thin ? 'danger' : 'warning', w.id, reason, fix);
  }
}

// One power pass over a bus: children before parents; each edge adds (P / V)^2 R. Returns the slack
// device's net demand (negative when it receives power).
function pass(B) {
  const { order, parent, R, vf, inj, acc, loss } = B, V = B.V;
  for (let i = 0; i < B.n; i++) acc[i] = inj[i];
  let tot = 0;
  for (let k = 0; k < order.length; k++) {
    const v = order[k], a = acc[v], I = a / (V * vf[v]), l = I * I * R[v];
    loss[v] = l; tot += l; acc[parent[v]] += a + l;
  }
  B.totalLoss = tot;
  return acc[B.root];
}

// ------------------------------------------------------------------------------------------- state
const LEDGER_KEYS = ['generatedWh', 'usedWh', 'wastedWh', 'dischargedWh', 'chargedWh', 'generatorWh', 'wireLossWh', 'inverterLossWh', 'unservedWh', 'fuelL',
  'arrayWh', 'controllerLossWh', 'pvWireLossWh', 'batteryLossWh', 'selfDischargeWh'];
const ledger = (day) => ({ day, generatedWh: 0, usedWh: 0, wastedWh: 0, dischargedWh: 0, chargedWh: 0, generatorWh: 0, wireLossWh: 0,
  inverterLossWh: 0, unservedWh: 0, fuelL: 0, arrayWh: 0, controllerLossWh: 0, pvWireLossWh: 0, batteryLossWh: 0, selfDischargeWh: 0 });
function initState(ctx) {
  return { v: STATE_V, active: false, topoKey: '||', sig: '', circuits: [], sources: {}, batteries: {}, inverters: {}, loads: {}, breakers: {}, wires: {},
    busV: 0, generationW: 0, solarAvailableW: 0, demandW: 0, unservedW: 0, today: ledger(dayIndex(ctx.t)), yesterday: null, totals: ledger(null),
    issues: [], switches: {}, locationTempC: {}, points: {}, weatherOverride: null };
}

// Bring per-device state in line with what is built: new devices get state, removed ones lose it.
function reconcile(s, T, sig) {
  const keep = (obj, ids, make) => {
    for (const k of Object.keys(obj)) if (!ids.has(k) && !(obj[k] && obj[k].source === 'command')) delete obj[k];
    for (const id of ids) if (!obj[id]) obj[id] = make(id);
  };
  const srcIds = new Map();
  for (const pn of T.panels) srcIds.set(pn.pieceId, () => ({ kind: 'solar', ratedW: pn.def.ratedW, outputW: 0, energyWh: 0, snowCover: 0 }));
  for (const k of T.ctrls) srcIds.set(k.pieceId, () => ({ kind: 'controller', ratedW: k.def.maxOutputA * T.circuits[k.circuit].classV, outputW: 0, availableW: 0 }));
  for (const g of T.gens) srcIds.set(g.pieceId, () => ({ kind: 'generator', ratedW: g.def.ratedW, outputW: 0, fuelL: g.def.tankL, tankL: g.def.tankL, running: false, manual: false, hours: 0, fuelUsedL: 0 }));
  keep(s.sources, new Set(srcIds.keys()), (id) => srcIds.get(id)());
  const batMake = new Map(T.bats.map((b) => [b.pieceId, b]));
  keep(s.batteries, new Set(batMake.keys()), (id) => {
    const b = batMake.get(id), d = b.def, soc = clamp(b.p.settings && b.p.settings.socStart !== undefined ? b.p.settings.socStart : d.shipSoc, 0, 1);
    return { capacityWh: d.capacityWh, storedWh: d.capacityWh * soc, floorWh: d.capacityWh * (1 - d.usableFraction), voltageV: ocvAt(d, soc), chargeW: 0, soc, tempC: 20, chargeBlocked: false };
  });
  const invMake = new Map(T.invs.map((i) => [i.pieceId, i]));
  keep(s.inverters, new Set(invMake.keys()), (id) => ({ ratedW: invMake.get(id).def.ratedW, outputW: 0, lossW: 0, charging: false }));
  const loadMake = new Map(T.loads.filter((L) => L.fixture).map((L) => [L.id, L]));
  for (const k of Object.keys(s.loads)) if (s.loads[k].source !== 'command' && !loadMake.has(k)) delete s.loads[k];
  for (const [id, L] of loadMake) {
    const p = L.p || T.fx.get(id).p, st = s.loads[id] || (s.loads[id] = { source: 'fixture', on: !(p.settings && p.settings.on === false), drawW: 0, demandW: 0, served: 0 });
    st.ratedW = p.settings && p.settings.ratedW !== undefined ? p.settings.ratedW : L.def.ratedW;
    st.priority = L.priority;
  }
  keep(s.breakers, new Set(T.breakers.map((b) => b.id)), (id) => ({ ratingA: T.breakers.find((b) => b.id === id).ratingA, currentA: 0, tripped: false, heat: 0 }));
  s.wires = {};
  for (const w of T.wires) s.wires[w.id] = { from: w.from, to: w.to, gauge: w.spec.gaugeAwg, lengthM: w.lengthM, ratingA: w.spec.ampacityA, currentA: 0, powerW: 0, dropPct: 0, lossW: 0, ok: true };
  s.circuits = T.circuits.map((c) => ({ id: 'c' + c.idx, classV: c.classV, busV: c.classV, acV: c.ac ? AC_V : null, splitPhase: c.splitPhase,
    batteries: c.bats.map((b) => b.pieceId), controllers: c.ctrls.map((k) => k.pieceId), panels: c.ctrls.flatMap((k) => k.panels.map((p) => p.pieceId)),
    inverters: c.invs.map((i) => i.pieceId), generators: c.gens.map((g) => g.pieceId), loads: c.loads.map((L) => L.id),
    generationW: 0, demandW: 0, unservedW: 0, spareDcW: 0, spareAcW: 0, socUsable: null, short: null }));
  // where each load point sits, and the wires and breakers between it and its source (for powerAvailableAt)
  s.points = {};
  for (const L of T.loads) {
    if (!L.pieceId || L.circuit < 0) continue;
    const B = T.buses[L.bus], path = [];
    for (let v = L.lv; B.parent[v] >= 0; v = B.parent[v]) {
      const w = T.wires.find((q) => q.bus === L.bus && q.v === v); if (w) path.push(w.id);
      const br = T.breakers.find((q) => q.bus === L.bus && q.v === v); if (br) path.push(br.id);
    }
    s.points[L.pieceId] = { circuit: L.circuit, side: B.type, voltageV: L.voltageV, path, ok: L.ok };
  }
  s.sig = sig;
  s.active = true;
}

function deactivate(s) {
  s.active = false; s.circuits = []; s.wires = {}; s.points = {}; s.issues = []; s.sig = '';
  s.sources = {}; s.batteries = {}; s.inverters = {}; s.breakers = {};
  for (const k of Object.keys(s.loads)) { if (s.loads[k].source !== 'command') delete s.loads[k]; else { s.loads[k].drawW = 0; s.loads[k].served = 0; } }
  s.busV = 0; s.generationW = 0; s.solarAvailableW = 0; s.demandW = 0; s.unservedW = 0;
}

// ------------------------------------------------------------------------------------------- the step
function step(ctx) {
  let s = ctx.s;
  if (!s || s.v !== STATE_V) ctx.s = s = initState(ctx);
  const T = topology(piecesFor(ctx.state), s);
  if (T.empty) { if (s.active) deactivate(s); return; }
  const sig = versionOf(ctx.state) + '|' + s.topoKey;
  let fresh = false;
  if (s.sig !== sig) { reconcile(s, T, sig); fresh = true; }
  const dt = ctx.dt, dtH = dt / 3600, t = ctx.t, tMid = t + dt / 2;
  const day = dayIndex(t);
  if (s.today.day !== day) { s.yesterday = s.today; s.today = ledger(day); }
  const W = ctx.get('weather') || {}, O = s.weatherOverride;
  const airC = O && O.tempC !== undefined ? O.tempC : W.tempC !== undefined ? W.tempC : 15;
  const hour = dayFraction(tMid) * 24, minute = Math.floor(t / 60);
  const led = T.led || (T.led = ledger(0));
  for (const k of LEDGER_KEYS) led[k] = 0;

  // ---- solar
  const site0 = (W.site) || { latitudeDeg: 45 };
  let solar = W.solar || { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 };
  if (O && O.cloud !== undefined && T.panels.length) {
    const clear = clearSkyIrradiance(tMid, site0), c = clamp(O.cloud, 0, 1);
    const cosZ = clear.directNormalWm2 > 0 ? (clear.globalHorizontalWm2 - clear.diffuseWm2) / clear.directNormalWm2 : 0;
    const ghi = clear.globalHorizontalWm2 * cloudTransmission(c), dni = clear.directNormalWm2 * directTransmission(c);
    solar = { directNormalWm2: dni, diffuseWm2: Math.max(0, ghi - dni * cosZ), globalHorizontalWm2: ghi };
  }
  const snowMmH = O && O.snowMmH !== undefined ? O.snowMmH : W.snowMmH || 0, snowDepth = W.snowDepthM || 0;
  const lit = solar.globalHorizontalWm2 > 0;
  const sun = lit ? sunPosition(tMid, site0) : null;
  const albedo = ALBEDO + (ALBEDO_SNOW - ALBEDO) * clamp(snowDepth / 0.05, 0, 1);
  let solarAvail = 0;
  for (const pn of T.panels) {
    const st = s.sources[pn.pieceId];
    let poa = 0;
    if (lit) {
      let beam = 0;
      if (sun.elevationRad > 0) {
        const ci = Math.sin(sun.elevationRad) * pn.cosT + Math.cos(sun.elevationRad) * pn.sinT * Math.cos(sun.azimuthRad - pn.azRad);
        if (ci > 0) beam = solar.directNormalWm2 * ci * Math.max(0, 1 - IAM_B0 * (1 / ci - 1));
      }
      poa = beam + solar.diffuseWm2 * (1 + pn.cosT) / 2 + solar.globalHorizontalWm2 * albedo * (1 - pn.cosT) / 2;
    }
    // snow on the panel
    if (snowMmH > 0 && pn.tiltRad < 60 * RAD) st.snowCover = snowMmH >= 1 ? 1 : Math.min(1, st.snowCover + snowMmH * dtH);
    else if (st.snowCover > 0) {
      if (airC > -poa / 80) st.snowCover -= 0.197 * pn.sinT * dtH;
      if (airC > 0) st.snowCover -= 0.02 * airC * dtH;
      if (st.snowCover < 1e-6) st.snowCover = 0;
    }
    const tc = cellTempC(airC, poa, pn.def.noctC);
    pn.tc = tc;
    const P = poa > 0 ? Math.max(0, pn.def.ratedW * (poa / 1000) * (1 + pn.def.tempCoeffPmaxPerC * (tc - 25)) * DERATE * (1 - st.snowCover)) : 0;
    pn.P = P; st.outputW = P; st.energyWh += P * dtH; st.poaWm2 = poa;
    led.arrayWh += P * dtH;
  }

  // ---- circuits
  let demandAll = 0, unservedAll = 0, genAll = 0;
  for (const c of T.circuits) {
    const cs = s.circuits[c.idx];
    // battery bank
    let cap = 0, vsum = 0, Dmax = 0, DmaxP = 0, Cmax = 0, stored = 0, floor = 0;
    for (const b of c.bats) {
      const bs = s.batteries[b.pieceId], d = b.def;
      const soc = bs.storedWh / bs.capacityWh, V = ocvAt(d, soc);
      bs.soc = soc; bs.voltageV = V;
      const tC = s.locationTempC[b.pieceId] !== undefined ? s.locationTempC[b.pieceId] : airC;
      bs.tempC = tC;
      const pPow = d.maxDischargeC * d.capacityAh * V, pEn = Math.max(0, bs.storedWh - bs.floorWh) * d.dischargeEff / dtH;
      b.D = Math.min(pPow, pEn); b.DP = pPow;
      const taper = d.chemistry === 'agm' ? (soc > 0.8 ? Math.max(0.1, (1 - soc) / 0.2) : 1) : soc > 0.95 ? Math.max(0.05, (1 - soc) / 0.05) : 1;
      bs.chargeBlocked = tC < d.minChargeTempC;
      b.C = bs.chargeBlocked ? 0 : Math.min(d.maxChargeC * d.capacityAh * V * taper, Math.max(0, bs.capacityWh - bs.storedWh) / d.chargeEff / dtH);
      cap += bs.capacityWh; vsum += V * bs.capacityWh; Dmax += b.D; DmaxP += b.DP; Cmax += b.C; stored += bs.storedWh; floor += bs.floorWh;
    }
    const busV = cap > 0 ? vsum / cap : c.classV;
    if (c.dc) c.dc.V = busV;
    if (c.ac) c.ac.V = AC_V;
    const socUsable = cap > 0 ? clamp((stored - floor) / (cap - floor), 0, 1) : null;
    // charge controllers: what each could deliver to the battery bus this minute
    let pvAvail = 0;
    for (const k of c.ctrls) {
      k.avail = 0; k.inW = 0; k.pvLoss = 0;
      if (k.disabled || !k.panels.length || !lit) continue;
      const PB = k.pvBus;
      PB.inj.fill(0);
      let tcs = 0;
      for (const pn of k.panels) { PB.inj[pn.lv] -= pn.P; tcs += pn.tc; }
      const pd = k.panels[0].def, tc = tcs / k.panels.length;
      const vmp = pd.vmpV * k.series * (1 + pd.tempCoeffPmaxPerC * (tc - 25)), voc = pd.vocV * k.series * (1 + pd.tempCoeffVocPerC * (tc - 25));
      PB.V = vmp;
      const inW = Math.max(0, -pass(PB));
      k.inW = inW; k.vmp = vmp; k.pvLoss = PB.totalLoss;
      let out;
      if (k.def.type === 'mppt') out = vmp >= busV + 1 ? inW * k.def.efficiency : 0;
      else { const I = inW / vmp; out = I * busV * k.def.efficiency * (vmp >= busV ? 1 : clamp((voc - busV) / Math.max(0.1, voc - vmp), 0, 1)); }
      out = Math.min(out, k.def.maxOutputA * busV);
      k.avail = out; pvAvail += out;
    }
    solarAvail += pvAvail;
    // generators
    let genAvail = 0;
    for (const g of c.gens) {
      const gs = s.sources[g.pieceId], d = g.def;
      const auto = g.p.settings && g.p.settings.autoStart;
      if (auto && socUsable !== null) {
        if (socUsable <= (g.p.settings.startBelow !== undefined ? g.p.settings.startBelow : 0.2)) gs.autoOn = true;
        else if (socUsable >= (g.p.settings.stopAbove !== undefined ? g.p.settings.stopAbove : 0.9)) gs.autoOn = false;
      }
      const want = gs.manual || !!gs.autoOn;
      const fuelW = ((gs.fuelL / dtH - d.idleLph) / d.lPerKWh) * 1000;
      gs.running = want && fuelW > 0;
      if (want && !gs.running && gs.fuelL > 0) {   // less than a minute of idling left: it sputters and stops
        gs.fuelUsedL += gs.fuelL; led.fuelL += gs.fuelL; gs.fuelL = 0; gs.manual = false; gs.autoOn = false;
        ctx.emit('electrical.outOfFuel', { id: g.pieceId });
      }
      g.avail = gs.running ? Math.min(d.ratedW, fuelW) : 0;
      genAvail += g.avail;
    }
    // demand
    const n = c.order.length, demand = c.demand, served = c.served;
    let dem = 0;
    for (let i = 0; i < n; i++) {
      const L = c.order[i], st = s.loads[L.id];
      let d = 0;
      if (L.ok && st && st.on) {
        d = st.ratedW;
        if (L.hours && !inHours(L.hours, hour)) d = 0;
        let duty = L.dutyFraction !== null && L.dutyFraction !== undefined ? L.dutyFraction : null;
        if (L.def.duty === 'fridge') {
          const amb = s.locationTempC[L.pieceId] !== undefined ? s.locationTempC[L.pieceId] : airC;
          duty = clamp(L.def.dutyAt25C * (1 + L.def.dutyPerC * (amb - 25)), 0.03, 1);
        }
        if (duty !== null && duty < 1 && d > 0) {
          const per = L.cycleMin || 30, ph = (((minute + L.phase * per) % per) + 0.5) / per;
          if (ph >= duty) d = 0;
        }
      }
      demand[i] = d; served[i] = d > 0 ? 1 : 0; dem += d;
    }
    // dispatch: everything that asks, unless that does not fit; then by priority
    // an inverter with nothing to draw its idle power from shuts down (low-voltage cutoff); with a
    // generator running through an inverter-charger it passes the generator through instead
    let idle = 0; for (const i of c.invs) idle += i.def.idleW;
    const invDown = c.invs.length > 0 && pvAvail + Dmax < idle && !(genAvail > 0 && c.charger);
    const ctx2 = c.X || (c.X = { r: { margin: 0, why: null, invOut: 0, invLoss: 0, genOut: 0, needDc0: 0, pvUsed: 0, wireLoss: 0, chargerDc: 0 } });
    ctx2.c = c; ctx2.busV = busV; ctx2.pvAvail = pvAvail; ctx2.Dmax = Dmax; ctx2.DmaxP = DmaxP; ctx2.Cmax = Cmax; ctx2.genAvail = genAvail; ctx2.invDown = invDown;
    let short = null;
    const m0 = evaluate(ctx2, false);
    if (m0.margin < -1e-6) {
      short = m0.why;
      for (let i = 0; i < n; i++) served[i] = 0;
      if (pvAvail + Dmax + genAvail <= 0) short = 'energy';
      else {
        let base = evaluate(ctx2, false).margin;   // margin with everything kept so far
        for (let i = 0; i < n; i++) {
          if (demand[i] <= 0) continue;
          served[i] = 1;
          const r1 = evaluate(ctx2, false), m1 = r1.margin, why = r1.why;
          if (m1 >= -1e-6) { base = m1; continue; }
          short = why; served[i] = 0;
          // the battery's energy, not its power, is the limit: this load runs for part of the minute
          if (why === 'energy' && Dmax < DmaxP && base > 0) {
            served[i] = clamp(base / (base - m1), 0, 1);
            if (evaluate(ctx2, false).margin < -1e-6) served[i] = 0;
            break;
          }
        }
      }
    }
    const fin = evaluate(ctx2, true);
    // apply: batteries
    for (const b of c.bats) {
      const bs = s.batteries[b.pieceId], d = b.def, P = b.P;
      if (P > 0) { bs.storedWh -= (P * dtH) / d.dischargeEff; led.dischargedWh += P * dtH; led.batteryLossWh += P * dtH * (1 / d.dischargeEff - 1); }
      else if (P < 0) { bs.storedWh += -P * dtH * d.chargeEff; led.chargedWh += -P * dtH; led.batteryLossWh += -P * dtH * (1 - d.chargeEff); }
      const sd = bs.storedWh * (d.selfDischargePerMonth / (30 * 24)) * dtH;
      bs.storedWh -= sd; led.selfDischargeWh += sd;
      if (bs.storedWh < 0) bs.storedWh = 0;
      bs.chargeW = -P; bs.soc = bs.storedWh / bs.capacityWh;
    }
    // controllers and panels
    for (const k of c.ctrls) {
      const ks = s.sources[k.pieceId], u = k.avail > 0 ? clamp(k.used / k.avail, 0, 1) : 0;
      ks.outputW = k.used; ks.availableW = k.avail;
      led.controllerLossWh += (k.inW - k.avail) * dtH; led.pvWireLossWh += (k.pvLoss || 0) * dtH;
      if (k.pvBus) wireFlows(T, s, k.pvBus, u);
    }
    led.generatedWh += pvAvail * dtH; led.wastedWh += (pvAvail - fin.pvUsed) * dtH;
    // inverters
    for (const i of c.invs) {
      const is = s.inverters[i.pieceId], sh = c.invRatedW > 0 ? i.def.ratedW / c.invRatedW : 0;
      is.outputW = fin.invOut * sh; is.lossW = fin.invLoss * sh; is.charging = fin.invOut < 0;
    }
    led.inverterLossWh += fin.invLoss * dtH;
    // generators
    let gOut = 0;
    for (const g of c.gens) {
      const gs = s.sources[g.pieceId], d = g.def, P = c.genRated > 0 && fin.genOut > 0 ? (fin.genOut * g.avail) / Math.max(EPS, genAvail) : 0;
      gs.outputW = P;
      if (gs.running) {
        const fuel = Math.min(gs.fuelL, generatorFuelLph(d, P) * dtH);
        gs.fuelL -= fuel; gs.fuelUsedL += fuel; gs.hours += dtH; led.fuelL += fuel;
        if (gs.fuelL <= 1e-9) { gs.fuelL = 0; gs.running = false; gs.manual = false; gs.autoOn = false; ctx.emit('electrical.outOfFuel', { id: g.pieceId }); }
      }
      gOut += P;
    }
    led.generatorWh += fin.genOut * dtH;
    led.wireLossWh += fin.wireLoss * dtH;
    // loads
    let used = 0, uns = 0, firstShed = -Infinity;
    for (let i = 0; i < n; i++) if (demand[i] > 0 && served[i] < 1 && c.order[i].priority > firstShed) firstShed = c.order[i].priority;
    const dead = pvAvail + Dmax + genAvail <= 0;
    for (let i = 0; i < n; i++) {
      const L = c.order[i], st = s.loads[L.id]; if (!st) continue;
      const got = demand[i] * served[i];
      st.demandW = demand[i]; st.drawW = got;
      st.served = !L.ok ? 0 : demand[i] > 0 ? served[i] : dead ? 0 : L.priority > firstShed ? 1 : 0;
      used += got; uns += demand[i] - got;
    }
    led.usedWh += used * dtH; led.unservedWh += uns * dtH;
    // wires and breakers on the battery and AC sides
    if (c.dc) wireFlows(T, s, c.dc, 1);
    if (c.ac) wireFlows(T, s, c.ac, 1);
    cs.busV = busV; cs.generationW = fin.pvUsed + fin.genOut; cs.solarAvailableW = pvAvail; cs.demandW = dem; cs.unservedW = uns;
    cs.socUsable = socUsable; cs.short = short;
    cs.spareDcW = Math.max(0, pvAvail + Dmax + (fin.chargerDc || 0) - fin.needDc0);
    cs.spareAcW = c.ac ? Math.max(0, Math.min(c.invs.length ? c.invRatedW - Math.max(0, fin.invOut) : 0, cs.spareDcW * (c.invs[0] ? c.invs[0].def.eff50 : 0)) + Math.max(0, genAvail - fin.genOut)) : 0;
    demandAll += dem; unservedAll += uns; genAll += fin.pvUsed + fin.genOut;
  }
  // loads that no circuit reaches
  for (const L of T.loads) if (L.circuit < 0 && s.loads[L.id]) { const st = s.loads[L.id]; st.drawW = 0; st.served = 0; st.demandW = st.on ? st.ratedW : 0; }
  // breakers
  let tripped = false;
  for (const br of T.breakers) {
    const bs = s.breakers[br.id]; if (!bs || bs.tripped) continue;
    const m = bs.currentA / br.ratingA;
    if (m > TRIP[0][0]) bs.heat += dt / tripSeconds(m); else bs.heat *= Math.exp(-dt / 300);
    if (bs.heat >= 1) { bs.tripped = true; bs.tripA = bs.currentA; bs.heat = 0; bs.currentA = 0; tripped = true; ctx.emit('electrical.trip', { id: br.id, currentA: bs.tripA }); }
  }
  if (tripped) s.topoKey = topoKeyOf(s);
  // books
  for (const k of LEDGER_KEYS) { s.today[k] += led[k]; s.totals[k] += led[k]; }
  s.busV = T.main ? s.circuits[T.main.idx].busV : 0;
  s.generationW = genAll; s.solarAvailableW = solarAvail; s.demandW = demandAll; s.unservedW = unservedAll;
  if (fresh || ctx.tick % ISSUE_EVERY === 0 || tripped) s.issues = issuesNow(s, T);
}

const inHours = (spans, h) => {
  if (!Array.isArray(spans) || !spans.length) return true;
  for (const [a, b] of spans) if (a <= b ? h >= a && h < b : h >= a || h < b) return true;
  return false;
};

// The power balance of one circuit for the current served[] choice. With final = false it reports
// whether the choice fits (margin >= 0, why it does not) with losses as if everything came from the
// slack device. With final = true it fixes the solar used, the battery shares and the generator, and
// leaves the flows of the last pass in each bus's arrays.
function evaluate(X, final) {
  const { c, busV, pvAvail, Dmax, Cmax, genAvail } = X, served = c.served, demand = c.demand;
  let margin = Infinity, why = null, invOut = 0, invLoss = 0, invIn = 0, genOut = 0, acLoss = 0, chargerDc = 0;
  // AC side
  if (c.ac) {
    const B = c.ac; B.inj.fill(0);
    for (const L of c.acLoads) B.inj[L.lv] += demand[L.oi] * served[L.oi];
    let need = pass(B);
    if (c.acRootGen) {
      genOut = need;
      if (genOut > genAvail) { margin = genAvail - genOut; why = 'generator'; }
      if (final && c.gens.length > 1 && genAvail > 0) {   // share among generators: the root takes the rest
        let others = 0;
        for (const g of c.gens.slice(1)) { const sh = (genOut * g.avail) / genAvail; B.inj[g.lv] -= sh; others += sh; }
        genOut = pass(B) + others;
      }
      acLoss = B.totalLoss;
    } else {
      let charge = 0;
      if (genAvail > 0 && c.charger) {
        const room = Math.max(0, Cmax - pvAvail) / c.charger.def.charger.eff;
        charge = Math.min(Math.max(0, genAvail - Math.max(0, need)), c.charger.def.charger.acW, room);
      }
      genOut = Math.min(genAvail, Math.max(0, need) + charge);
      if (genOut > 0) { for (const g of c.gens) B.inj[g.lv] -= (genOut * g.avail) / genAvail; need = pass(B); }
      acLoss = B.totalLoss;
      invOut = need;
      if (X.invDown && invOut > 1e-12) { margin = -invOut; why = 'energy'; }
      else if (invOut > c.invRatedW + 1e-9) { margin = c.invRatedW - invOut; why = 'inverter'; }
      if (invOut > 1e-12 && !X.invDown) { for (const i of c.invs) { const o = (invOut * i.def.ratedW) / c.invRatedW; invLoss += inverterLossW(i.def, o); } invIn = invOut + invLoss; }
      else if (invOut < -1e-12 && c.charger) { const e = c.charger.def.charger.eff; chargerDc = -invOut * e; invLoss = -invOut * (1 - e); invIn = -chargerDc; }
      else if (invOut < -1e-12) { /* generator surplus with no charger: cannot happen, charge is 0 */ }
      else if (!X.invDown) { invOut = 0; for (const i of c.invs) invLoss += i.def.idleW; invIn = invLoss; }
      else invOut = 0;
    }
  }
  // DC side
  let needDc0 = 0, pvUsed = 0, dcLoss = 0;
  if (c.dc) {
    const B = c.dc; B.inj.fill(0);
    for (const L of c.dcLoads) B.inj[L.lv] += demand[L.oi] * served[L.oi];
    if (c.invs.length) for (const i of c.invs) B.inj[i.lv] += (invIn * i.def.ratedW) / c.invRatedW;
    needDc0 = pass(B);
    const supply = pvAvail + (c.rootIsBat ? Dmax : 0);
    if (needDc0 - supply > -margin) { margin = supply - needDc0; why = c.rootIsBat ? 'energy' : 'solar'; }
    if (final) {
      if (c.rootIsBat) {
        let pv = clamp(needDc0 + Cmax, 0, pvAvail);
        for (let it = 0; it < 3; it++) {
          for (const k of c.ctrls) { k.used = pvAvail > 0 ? (pv * k.avail) / pvAvail : 0; B.inj[k.lv] -= k.used; }
          const est = needDc0 - pv, others = c.bats.slice(1);
          let wsum = 0; for (const b of c.bats) wsum += est > 0 ? b.D : b.C;
          for (const b of others) { b.P = wsum > 0 ? (est * (est > 0 ? b.D : b.C)) / wsum : 0; B.inj[b.lv] -= b.P; }
          const root = c.bats[0], P0 = pass(B);
          root.P = P0;
          // the battery took a little more than allowed because the panels' current runs on other wires
          const over = P0 > root.D + 1e-9 ? P0 - root.D : P0 < -root.C - 1e-9 ? P0 + root.C : 0;
          if (over === 0 || (over > 0 && pv >= pvAvail - 1e-12) || (over < 0 && pv <= 1e-12) || it === 2) { pvUsed = pv; break; }
          // undo this attempt's injections and try again with more (or less) solar
          for (const k of c.ctrls) B.inj[k.lv] += k.used;
          for (const b of others) B.inj[b.lv] += b.P;
          pv = clamp(pv + over, 0, pvAvail);
        }
      } else {
        // no battery: the first controller is the slack and the others share by what they can give
        const others = c.ctrls.filter((k) => k !== c.root);
        for (const k of others) { k.used = pvAvail > 0 ? (needDc0 * k.avail) / pvAvail : 0; B.inj[k.lv] -= k.used; }
        c.root.used = pass(B);
        pvUsed = c.ctrls.reduce((a, k) => a + k.used, 0);
      }
      dcLoss = B.totalLoss;
    }
  } else if (final) pvUsed = 0;
  if (final && c.ac && c.acRootGen) acLoss = c.ac.totalLoss;
  const r = X.r;
  r.margin = margin; r.why = why; r.invOut = invOut; r.invLoss = invLoss; r.genOut = genOut; r.needDc0 = needDc0; r.pvUsed = pvUsed; r.wireLoss = dcLoss + acLoss; r.chargerDc = chargerDc;
  return r;
}

// Currents, drops and losses of every wire and breaker on a bus, from the last pass. scale: share of
// the potential flow actually taken (for panel wires when the controller is holding back).
function wireFlows(T, s, B, scale) {
  for (const w of B.wires) {
    const ws = s.wires[w.id], V = B.V * B.vf[w.v], P = B.acc[w.v] * scale, I = Math.abs(P) / V;
    ws.currentA = r3(I); ws.powerW = r3(P); ws.lossW = r3(B.loss[w.v] * scale * scale); ws.dropPct = r3(dropPercent(I, w.spec, w.lengthM, V)); ws.ok = I <= w.spec.ampacityA;
  }
  for (const br of B.breakers) {
    s.breakers[br.id].currentA = Math.abs(B.acc[br.v] * scale) / (B.V * B.vf[br.v]);
  }
}

// Plain-language issues: those of the wiring itself plus what is happening now.
function issuesNow(s, T) {
  const out = T.issues.slice();
  const noun = (id) => (T.fx.get(id) ? T.fx.get(id).def.noun : 'load');
  for (const w of T.wires) {
    const ws = s.wires[w.id];
    if (ws && !ws.ok && !(w.designA > w.spec.ampacityA)) {
      const need = WIRE_GAUGES.find((g) => g.ampacityA >= 1.25 * ws.currentA);
      out.push({ severity: 'danger', pieceId: w.id, reason: 'The wire from the ' + noun(w.from) + ' to the ' + noun(w.to) + ' is carrying ' + Math.round(ws.currentA) + ' A; ' + w.spec.gaugeAwg + ' AWG is rated for ' + w.spec.ampacityA + ' A. It is overheating.',
        fix: need ? 'Use ' + need.gaugeAwg + ' AWG, or put a breaker on it.' : 'Split the load over two cables or use a higher voltage.' });
    }
  }
  for (const br of T.breakers) {
    const bs = s.breakers[br.id];
    if (bs && bs.tripped) out.push({ severity: 'warning', pieceId: br.id, reason: 'The ' + br.ratingA + ' A breaker has tripped: the circuit after it drew ' + Math.round(bs.tripA || 0) + ' A.', fix: 'Switch something off on that circuit, then reset the breaker.' });
  }
  for (const c of T.circuits) {
    const cs = s.circuits[c.idx];
    for (const L of c.loads) {
      const st = s.loads[L.id];
      if (!st || !L.ok || !(st.demandW > 0) || st.served >= 1) continue;
      const what = 'The ' + noun(L.pieceId || L.id) + (L.pieceId ? '' : ' (' + L.id + ')');
      if (cs.short === 'inverter') out.push({ severity: 'warning', pieceId: L.pieceId || L.id, reason: what + ' was switched off: together with everything else it needs more than the ' + c.invRatedW + ' W inverter can give.', fix: 'Use a bigger inverter or run fewer things at once.' });
      else out.push({ severity: 'warning', pieceId: L.pieceId || L.id, reason: what + ' was switched off to save power: ' + (c.bats.length ? 'the battery is at its limit and ' : '') + (c.ctrls.length ? 'the panels are not keeping up.' : 'nothing is charging it.'), fix: 'Add panels or battery storage, run a generator, or use less.' });
    }
    for (const b of c.bats) {
      const bs = s.batteries[b.pieceId];
      if (bs.chargeBlocked) out.push({ severity: 'warning', pieceId: b.pieceId, reason: 'The battery is too cold to charge (' + bs.tempC.toFixed(0) + ' C). Lithium batteries must not be charged below ' + b.def.minChargeTempC + ' C.', fix: 'Move it somewhere warmer or insulate it; it charges again above ' + b.def.minChargeTempC + ' C.' });
      else if (bs.storedWh <= bs.floorWh + 1e-6) out.push({ severity: 'info', pieceId: b.pieceId, reason: 'The battery is down to its reserve (' + Math.round(100 * bs.soc) + '% charge).', fix: 'It recovers when the sun comes back, or charge it with a generator.' });
    }
    for (const g of c.gens) { const gs = s.sources[g.pieceId]; if (gs.fuelL <= 0) out.push({ severity: 'warning', pieceId: g.pieceId, reason: 'The generator is out of fuel.', fix: 'Refuel it.' }); }
  }
  return out.map((x, i) => ({ id: 'e' + i, ...x }));
}

// ------------------------------------------------------------------------------------------- commands
const commands = {
  // Other systems' loads: { id, ratedW, on, priority, pieceId?, supply?, voltageV?, noun? }. Without
  // pieceId the load sits on the homestead's main circuit (the one with the most storage and inverter).
  'electrical.setLoad': (ctx, p = {}) => {
    const s = ctx.s; if (!p.id) throw new Error('electrical.setLoad needs an id');
    const L = s.loads[p.id] && s.loads[p.id].source === 'command' ? s.loads[p.id] : (s.loads[p.id] = { source: 'command', ratedW: 0, on: false, priority: 5, drawW: 0, demandW: 0, served: 0 });
    if (p.ratedW !== undefined) L.ratedW = Math.max(0, +p.ratedW || 0);
    if (p.on !== undefined) L.on = !!p.on;
    if (p.priority !== undefined) L.priority = +p.priority;
    for (const k of ['pieceId', 'supply', 'voltageV', 'noun']) if (p[k] !== undefined) L[k] = p[k];
    s.topoKey = topoKeyOf(s);
    return L;
  },
  'electrical.removeLoad': (ctx, p = {}) => { const s = ctx.s; if (s.loads[p.id] && s.loads[p.id].source === 'command') { delete s.loads[p.id]; s.topoKey = topoKeyOf(s); } },
  // Switch a load, an inverter or a generator: { pieceId, on }.
  'electrical.switch': (ctx, p = {}) => {
    const s = ctx.s, id = p.pieceId, on = !!p.on;
    if (s.sources[id] && s.sources[id].kind === 'generator') { s.sources[id].manual = on; if (!on) s.sources[id].autoOn = false; return; }
    if (s.loads[id]) { s.loads[id].on = on; return; }
    if (on) delete s.switches[id]; else s.switches[id] = false;
    s.topoKey = topoKeyOf(s);
  },
  'electrical.resetBreaker': (ctx, p = {}) => { const b = ctx.s.breakers[p.id]; if (b && b.tripped) { b.tripped = false; b.heat = 0; ctx.s.topoKey = topoKeyOf(ctx.s); } },
  // Pour fuel into a generator: { id, litres }. Returns the litres that fit.
  'electrical.refuel': (ctx, p = {}) => { const g = ctx.s.sources[p.id]; if (!g || g.kind !== 'generator') return 0; const add = clamp(+p.litres || 0, 0, g.tankL - g.fuelL); g.fuelL += add; return add; },
  // Temperature where a device stands, for devices indoors (until rooms report it): { pieceId, tempC | null }.
  'electrical.setLocationTemp': (ctx, p = {}) => { if (p.tempC === null || p.tempC === undefined) delete ctx.s.locationTempC[p.pieceId]; else ctx.s.locationTempC[p.pieceId] = +p.tempC; },
};

export const electrical = { name: 'electrical', every: 1, init: initState, step, commands };

// ------------------------------------------------------------------------------------------- readers
const sysState = (state) => (state && state.sys ? state.sys.electrical : state);

// Watts a tool or appliance could draw at a load point right now (0 if none). Without a pieceId, at
// the main circuit's AC side (or its battery if it has no inverter).
export function powerAvailableAt(state, pieceId) {
  const s = sysState(state); if (!s || !s.active) return 0;
  let c, pt = pieceId ? s.points[pieceId] : null;
  if (pieceId && !pt) return 0;
  if (pt && !pt.ok) return 0;
  if (pt) c = s.circuits[pt.circuit];
  else c = s.circuits.slice().sort((a, b) => b.spareAcW + b.spareDcW - (a.spareAcW + a.spareDcW))[0];
  if (!c) return 0;
  let watts = pt ? (pt.side === 'ac' ? c.spareAcW : c.spareDcW) : c.acV ? c.spareAcW : c.spareDcW;
  if (pt) for (const id of pt.path) {
    const w = s.wires[id], b = s.breakers[id];
    if (b && b.tripped) return 0;
    const headA = w ? w.ratingA - w.currentA : b ? b.ratingA - b.currentA : Infinity;
    watts = Math.min(watts, Math.max(0, headA) * pt.voltageV);
  }
  return Math.max(0, watts);
}

// Where each site piece stands (x, z), memoised by the pieces array so a per-frame caller costs a lookup.
const placeCache = new WeakMap();
function placesOf(pieces) {
  let m = placeCache.get(pieces);
  if (!m) {
    m = new Map();
    for (const p of pieces) if (p && p.id && p.a) { const b = p.b || p.a; m.set(p.id, [(p.a.x + b.x) / 2, (p.a.z + b.z) / 2]); }
    placeCache.set(pieces, m);
  }
  return m;
}

// Can a corded tool at (x, z) draw at least minW? True when a load point within cordM of it (a cord's
// reach) has that much spare. With no load points at all, falls back to the main circuit's spare.
export function powerNear(state, x, z, cordM = 30, minW = 1) {
  const s = sysState(state); if (!s || !s.active) return false;
  const ids = Object.keys(s.points || {});
  if (!ids.length) return powerAvailableAt(state) >= minW;
  const all = piecesFor(state);
  const places = all ? placesOf(all) : null;
  if (!places) return false;
  const r2 = cordM * cordM;
  for (const id of ids) {
    const at = places.get(id); if (!at) continue;
    const dx = at[0] - x, dz = at[1] - z;
    if (dx * dx + dz * dz <= r2 && powerAvailableAt(state, id) >= minW) return true;
  }
  return false;
}

// Pure data for the energy-flow overlay: flows per wire, state per device.
export function overlayData(state) {
  const s = sysState(state);
  if (!s || !s.active) return { wires: [], devices: [], circuits: [] };
  const wires = Object.entries(s.wires).map(([id, w]) => ({ id, from: w.from, to: w.to, gauge: w.gauge, currentA: w.currentA, ratingA: w.ratingA,
    powerW: w.powerW, dropPct: w.dropPct, lossW: w.lossW, ok: w.ok, load: w.ratingA > 0 ? w.currentA / w.ratingA : 0 }));
  const devices = [];
  for (const [id, x] of Object.entries(s.sources)) devices.push({ pieceId: id, kind: x.kind, outputW: x.outputW, ratedW: x.ratedW, running: x.running, fuelL: x.fuelL, snowCover: x.snowCover });
  for (const [id, b] of Object.entries(s.batteries)) devices.push({ pieceId: id, kind: 'battery', soc: b.soc, chargeW: b.chargeW, voltageV: b.voltageV, chargeBlocked: b.chargeBlocked });
  for (const [id, i] of Object.entries(s.inverters)) devices.push({ pieceId: id, kind: 'inverter', outputW: i.outputW, lossW: i.lossW, ratedW: i.ratedW, charging: i.charging });
  for (const [id, b] of Object.entries(s.breakers)) devices.push({ pieceId: id, kind: 'breaker', currentA: b.currentA, ratingA: b.ratingA, tripped: b.tripped });
  for (const [id, L] of Object.entries(s.loads)) devices.push({ pieceId: L.pieceId || id, loadId: id, kind: 'load', on: L.on, drawW: L.drawW, served: L.served });
  return { wires, devices, circuits: s.circuits.map((c) => ({ id: c.id, busV: c.busV, socUsable: c.socUsable, generationW: c.generationW, demandW: c.demandW, unservedW: c.unservedW })) };
}
