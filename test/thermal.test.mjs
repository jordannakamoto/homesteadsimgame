// Rooms and heat: checked against hand calculations and known physical relationships. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, createGameSim, siteSystem, calendar as C, DAY, HOUR, makeSave, readSave, findRooms, roomAt, thermal, assemblyR, uValue, innerMass, roomModels, roomIdAt, thermalOverlayData } from '../src/sim/index.js';
import { material } from '../src/sim/materials.js';
import { rse, infiltrationLs, leakageClass, groundFloorU, cavityR } from '../src/sim/thermal.js';
import { house, setSite } from './helpers/pieces.mjs';
import { BENCH, benchOnly } from './helpers/bench.mjs';

const near = (v, ref, tol, msg) => assert.ok(Math.abs(v - ref) <= tol, `${msg}: ${v} vs ${ref} (+-${tol})`);
const L = (material, thickness, role) => ({ material, thickness, role });
const TIMBER = [L('spf_seasoned', 0.022, 'cladding'), L('air', 0.089, 'cavity'), L('spf_seasoned', 0.019, 'lining')];
const INSULATED = [L('spf_seasoned', 0.022, 'cladding'), L('mineral_wool', 0.089, 'insulation'), L('spf_seasoned', 0.019, 'lining')];
const STONE = [L('granite', 0.3, 'structure')];
const ROOF = [L('cedar_shake', 0.02, 'covering'), L('spf_seasoned', 0.02, 'deck'), L('mineral_wool', 0.14, 'insulation'), L('spf_seasoned', 0.019, 'lining')];
const FLOOR = [L('air', 0.095, 'joist-bay'), L('spf_seasoned', 0.025, 'deck')];
const GLASS = [L('float_glass', 0.004, 'glazing')], LEAF = [L('spf_seasoned', 0.045, 'leaf')];
const AIR_J_M3K = 1.204 * 1006;

// A plain rectangular room as pieces: north is -z, east is +x. openings: { n|e|s|w: [{ id, kind, width, height, offset, layers }] }.
function box({ id = 'b', x = 0, z = 0, w = 4, d = 4, h = 2.6, y = 0, storey = 0, wall = TIMBER, roof = ROOF, floor = FLOOR, openings = {}, skip = [], foundation = storey === 0 } = {}) {
  const P = (px, pz) => ({ x: px, z: pz }), out = [], outline = [P(x, z), P(x + w, z), P(x + w, z + d), P(x, z + d)];
  out.push({ id: id + '.f', kind: 'floor', type: 'floor', storey, struct: id, y0: y, y1: y + 0.12, thickness: 0.12, area: w * d, outline, holes: [], layers: floor });
  if (foundation) out.push({ id: id + '.f.fd', kind: 'foundation', type: 'plinth', material: 'granite', floor: id + '.f', y0: y - 0.4, y1: y, height: 0.4, outline });
  const sides = { n: [P(x, z), P(x + w, z)], e: [P(x + w, z), P(x + w, z + d)], s: [P(x, z + d), P(x + w, z + d)], w: [P(x, z), P(x, z + d)] };
  for (const k of 'nesw') {
    if (skip.includes(k)) continue;
    const [a, b] = sides[k], len = Math.hypot(b.x - a.x, b.z - a.z), opens = [];
    for (const o of openings[k] || []) {
      const width = o.width || 1, height = o.height || 1, area = width * height, offset = o.offset ?? (len - width) / 2;
      opens.push({ id: o.id, kind: o.kind || 'window', type: o.kind || 'window', offset, width, sill: 0.9, height, area, fill: o.fill || (o.kind === 'door' ? 'leaf' : 'glazing') });
      if (o.kind !== 'opening' && !o.missing) out.push({ id: o.id, kind: o.kind || 'window', wall: id + '.' + k, storey, struct: id, area, layers: o.layers || (o.kind === 'door' ? LEAF : GLASS), fill: o.fill || (o.kind === 'door' ? 'leaf' : 'glazing'), built: o.built });
    }
    out.push({ id: id + '.' + k, kind: 'wall', type: 'wall', storey, struct: id, a, b, y0: y, y1: y + h, length: len, height: h, thickness: 0.13, area: len * h, layers: wall, openings: opens });
  }
  if (roof) out.push({ id: id + '.r', kind: 'roof', type: 'flat', storey, struct: id, a: P(x, z), b: P(x + w, z), y0: y + h, y1: y + h, eaveY: y + h, ridgeY: y + h, pitchDeg: 0, area: w * d, planArea: w * d, footprint: outline, facing: { x: 0, z: 0 }, layers: roof });
  return out;
}
// Weather held to what a test asks for. sun: clear-sky sun from the calendar, dimmed by cloud as the real weather does.
function fixedWeather({ tempC = 0, groundTempC = tempC, windMs = 3, cloud = 1, sun = false, humidity = 0.6 } = {}) {
  const val = (v, t) => (typeof v === 'function' ? v(t) : v), site = { latitudeDeg: 45, climate: 'temperate' };
  const make = (t) => {
    const c = val(cloud, t), cs = sun ? C.clearSkyIrradiance(t, site) : { directNormalWm2: 0, diffuseWm2: 0, globalHorizontalWm2: 0 };
    const cosZ = cs.directNormalWm2 > 0 ? (cs.globalHorizontalWm2 - cs.diffuseWm2) / cs.directNormalWm2 : 0;
    const ghi = cs.globalHorizontalWm2 * (1 - 0.75 * Math.pow(c, 3.4)), dni = cs.directNormalWm2 * Math.max(0, 1 - Math.pow(c, 1.5));
    return { site, tempC: val(tempC, t), groundTempC: val(groundTempC, t), windMs: val(windMs, t), cloud: c, humidity, pressureHPa: 1013, snowDepthM: 0,
      solar: { directNormalWm2: dni, diffuseWm2: Math.max(0, ghi - dni * cosZ), globalHorizontalWm2: ghi } };
  };
  return { name: 'weather', every: 5, init: (ctx) => make(ctx.t), step: (ctx) => { ctx.s = make(ctx.t + 150); } };
}
const lab = (pieces, wx) => { const sim = createSim({ seed: 1, systems: [fixedWeather(wx), siteSystem(), thermal] }); setSite(sim, pieces); return sim; };
const rooms = (sim) => sim.state.sys.thermal.rooms;
const lossSum = (r) => r.lossW.walls + r.lossW.roof + r.lossW.floor + r.lossW.windows + r.lossW.infiltration + r.toRoomsW;
const stored = (sim) => { let e = 0; for (const m of roomModels(sim.state)) { const r = rooms(sim)[m.id]; if (r.enclosed) e += m.airCapacityJK * r.tempC + m.massCapacityJK * r.massTempC; } return e; };

// ------------------------------------------------------------------------------------------ assemblies
test('R-values: a wall build-up equals the hand sum; an 89 mm batt is about R-13; single glazing is about 5.8', () => {
  // 22 mm softwood / 89 mm cavity / 19 mm softwood: 0.022/0.12 + 0.18 (ISO 6946 cavity) + 0.019/0.12
  near(assemblyR(TIMBER), 0.022 / 0.12 + 0.18 + 0.019 / 0.12, 1e-12, 'frame wall R');
  near(uValue(TIMBER), 1 / (0.13 + 0.5216667 + 0.04), 1e-6, 'frame wall U');
  near(assemblyR(INSULATED), 0.022 / 0.12 + 0.089 / 0.037 + 0.019 / 0.12, 1e-12, 'insulated wall R');
  const batt = assemblyR([L('fibreglass_batt', 0.089)]);
  assert.ok(batt >= 2.2 && batt <= 2.4, 'fibreglass 89 mm: ' + batt); near(batt * 5.678, 13, 0.6, 'US R-value');
  near(uValue(GLASS), 5.8, 0.1, 'single glazing');
  near(uValue([L('dgu', 0.02)]), 2.8, 1e-9, 'double glazing unit keeps its EN 673 value');
  near(uValue([L('dgu_lowe', 0.024)]), 1.1, 1e-9, 'low-e unit');
  // a cavity is not 89 mm of still air (that would be R 3.5), and an air layer open to the room is nothing
  assert.ok(cavityR(0.089) < 0.2 && cavityR(0.089, 'down') > cavityR(0.089, 'up'));
  near(assemblyR([L('slate', 0.008), L('spf_seasoned', 0.02), L('air', 0.14)], { flow: 'up' }), 0.008 / 2.2 + 0.02 / 0.12, 1e-12, 'open rafter bay');
  // wind strips the outside film: 0.04 at about 4 m/s, more in calm air
  near(rse(4), 0.04, 0.002, 'Rse at 4 m/s'); assert.ok(rse(0) > 0.1 && rse(12) < 0.02);
  assert.ok(uValue(GLASS, { windMs: 0 }) < uValue(GLASS, { windMs: 10 }));
});

test('thermal mass: only the inner part counts, and stone holds far more than a timber lining', () => {
  const tim = innerMass(TIMBER), ins = innerMass(INSULATED), st = innerMass(STONE);
  near(tim.capacityJm2K, 420 * material('spf_seasoned').specificHeatJkgK * 0.019, 1e-6, 'the lining alone: density x specific heat x thickness');
  near(ins.capacityJm2K, tim.capacityJm2K, 1e-9, 'mass behind insulation is not the room\'s');
  // granite: daily penetration depth sqrt(2.8 x 86400 / (pi x 2.7e6)) = 0.169 m, effective 0.119 m of a 0.3 m wall
  near(st.capacityJm2K, 2700 * 1000 * 0.1194, 3000, 'stone inner mass');
  assert.ok(st.capacityJm2K > 20 * tim.capacityJm2K);
  near(innerMass([L('granite', 0.1)]).capacityJm2K, 2700 * 1000 * 0.05, 1, 'a thin wall: half its thickness');
  assert.equal(innerMass([L('spf_seasoned', 0.025), L('carpet', 0.01)]).capacityJm2K, 0, 'carpet hides the floor from the room');
});

// ------------------------------------------------------------------------------------------ rooms
test('the real house is one enclosed room of 20 m2 with the right volume and envelope', () => {
  const rs = findRooms(house());
  assert.equal(rs.length, 1);
  const r = rs[0];
  assert.equal(r.id, 'r:p5'); assert.equal(r.enclosed, true); assert.deepEqual(r.leaks, []);
  near(r.floorAreaM2, 20, 1e-6, 'floor area');
  // 20 m2 x 2.72 m to the wall top, plus the gable prism 0.5 x 4 x 1.7 x 5
  near(r.volumeM3, 20 * 2.72 + 0.5 * 4 * 1.7 * 5, 1e-3, 'volume'); near(r.stackHeightM, 4.42, 1e-6, 'floor to ridge');
  const by = Object.fromEntries(r.envelope.map((s) => [s.pieceId, s]));
  for (const [id, a] of [['p1', 14.2], ['p2', 12.5682], ['p3', 11.36], ['p4', 10.736], ['p8.g0', 3.44], ['p8.g1', 3.44], ['p5', 20]]) near(by[id].areaM2, a, 1e-6, id + ' net area');
  near(by['p8.0'].areaM2, 10 / Math.cos((40.3645 * Math.PI) / 180), 1e-3, 'roof plane over the room, not its eaves');
  assert.equal(by.p5.toRoom, 'ground'); assert.equal(by.p1.toRoom, 'outside'); assert.equal(by.p5.foundation.material, 'granite');
  assert.deepEqual(by.p2.openings.map((o) => [o.pieceId, o.kind, o.open]), [['p6', 'door', false]]);
  assert.equal(by.p4.openings[0].layers[0].material, 'float_glass');
  // the house is turned 30 degrees: p1 faces 330 (north-west), the roof plane over it the same way at 40 degrees
  near((by.p1.orientationRad * 180) / Math.PI, 330, 1e-6, 'p1 bearing'); near((by.p2.orientationRad * 180) / Math.PI, 150, 1e-6, 'p2 bearing');
  near((by['p8.1'].orientationRad * 180) / Math.PI, 150, 1e-6, 'roof bearing'); near((by['p8.1'].tiltRad * 180) / Math.PI, 40.36, 0.01, 'roof tilt');
  assert.equal(roomAt(rs, -4.8, -1.5).id, 'r:p5'); assert.equal(roomAt(rs, 5, 5), null);
});

test('a house that is not closed says what is open, in plain words', () => {
  const without = (...ids) => findRooms(house().filter((p) => !ids.includes(p.id)))[0];
  const unbuilt = (...ids) => findRooms(house().map((p) => (ids.includes(p.id) ? { ...p, built: false } : p)))[0];
  assert.deepEqual(without('p1').leaks, ['The north-west wall is missing.']);
  assert.deepEqual(without('p8.0', 'p8.1').leaks, ['There is no roof over this room.']);
  assert.match(without('p8.0').leaks[0], /^Part of this room has no roof over it \(about 10\.0 square metres\)\.$/);
  assert.deepEqual(without('p8.g0').leaks, ['The south-west wall stops short of the roof.']);
  // construction stages: an opening whose door or window is not in yet is a hole; an unbuilt wall is no wall
  assert.deepEqual(unbuilt('p6').leaks, ['The south-east wall has an open doorway with no door in it.']);
  assert.deepEqual(unbuilt('p7').leaks, ['The north-east wall has a window opening with no window in it.']);
  assert.deepEqual(unbuilt('p1').leaks, ['The north-west wall is missing.']);
  assert.equal(unbuilt('p1').enclosed, false);
  // roof framed and decked but no roofing on it
  const bare = house().map((p) => (p.kind === 'roof' ? { ...p, layers: [L('spf_seasoned', 0.02, 'deck')] } : p));
  assert.deepEqual(findRooms(bare)[0].leaks, ['The roof has no roofing on it yet.']);
  // a 0.5 m gap where two walls should meet, and a rail in place of a wall
  const gap = box({}).map((p) => (p.id === 'b.n' ? { ...p, b: { x: 3.5, z: 0 } } : p));
  assert.deepEqual(findRooms(gap)[0].leaks, ['There is a 0.5 m gap in the north wall.']);
  const crack = box({}).map((p) => (p.id === 'b.n' ? { ...p, b: { x: 3.96, z: 0.02 } } : p));
  assert.equal(findRooms(crack)[0].enclosed, true, 'a few centimetres is tolerance, not a hole');
  const rail = box({}).map((p) => (p.id === 'b.e' ? { ...p, type: 'rail', y1: 1.02 } : p));
  assert.deepEqual(findRooms(rail)[0].leaks, ['The east side has only a low rail, not a wall.']);
});

test('partitions, archways, storeys, stairwells and cellars', () => {
  // one floor 8 x 4 with a wall across the middle: two rooms that share it
  const two = [...box({ w: 8 }), { id: 'mid', kind: 'wall', type: 'wall', a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, y0: 0, y1: 2.6, length: 4, height: 2.6, area: 10.4, layers: TIMBER,
    openings: [{ id: 'd1', kind: 'door', offset: 1.5, width: 0.9, height: 2, area: 1.8, fill: 'leaf', layers: LEAF }] }];
  let rs = findRooms(two);
  assert.deepEqual(rs.map((r) => [r.id, Math.round(r.floorAreaM2), r.enclosed]), [['r:b.f', 16, true], ['r:b.f#2', 16, true]]);
  const part = rs.map((r) => r.envelope.find((s) => s.pieceId === 'mid'));
  assert.equal(part[0].toRoom, 'r:b.f#2'); assert.equal(part[1].toRoom, 'r:b.f'); near(part[0].areaM2, 10.4 - 1.8, 1e-9, 'partition net area'); near(part[1].areaM2, part[0].areaM2, 1e-9, 'same from both sides');
  near(Math.abs(part[0].orientationRad - part[1].orientationRad), Math.PI, 1e-9, 'seen from opposite sides');
  // an open arch (or a door not yet hung) in the partition makes them one room
  two[two.length - 1].openings[0] = { kind: 'opening', offset: 1.5, width: 0.9, height: 2, area: 1.8, fill: 'none' };
  rs = findRooms(two); assert.equal(rs.length, 1); near(rs[0].floorAreaM2, 32, 1e-9, 'merged area'); assert.equal(rs[0].enclosed, true);
  // an upper storey: the floor between is a ceiling below and a floor above
  const up = [...box({ id: 'g', roof: null }), ...box({ id: 'u', y: 2.6, storey: 1 })];
  rs = findRooms(up); assert.equal(rs.length, 2); assert.ok(rs.every((r) => r.enclosed));
  const g = rs.find((r) => r.id === 'r:g.f'), u = rs.find((r) => r.id === 'r:u.f');
  near(g.volumeM3, 16 * (2.6 - 0.12), 1e-9, 'ground storey volume to the underside of the floor above');
  assert.deepEqual([g.envelope.find((s) => s.kind === 'ceiling').toRoom, u.envelope.find((s) => s.kind === 'floor').toRoom], ['r:u.f', 'r:g.f']);
  // cut a stairwell in the upper floor and the two storeys are one air space
  const well = up.map((p) => (p.id === 'u.f' ? { ...p, outline: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 1, z: 4 }, { x: 1, z: 3 }, { x: 0, z: 3 }] } : p));
  rs = findRooms(well); assert.equal(rs.length, 1); assert.equal(rs[0].enclosed, true); near(rs[0].floorAreaM2, 16 + 15, 1e-9, 'both floors');
  near(rs[0].volumeM3, 16 * 2.48 + 15 * 2.48 + 1 * 2.6, 1e-9, 'volume including the well');
  // take the upper storey's roof away: the room below is still closed, the deck above is not a room
  rs = findRooms(up.filter((p) => p.id !== 'u.r'));
  assert.equal(rs.find((r) => r.id === 'r:g.f').enclosed, true); assert.equal(rs.find((r) => r.id === 'r:u.f').enclosed, false);
  assert.equal(rs.find((r) => r.id === 'r:g.f').envelope.find((s) => s.kind === 'ceiling').toRoom, 'outside');
  // earth-sheltered: with terrain heights, walls below the ground are against it; a cellar storey is by default
  const dug = findRooms(box({ h: 2.4, wall: STONE }), { groundHeightAt: (x) => (x > 4 ? 0 : 2.4) })[0];
  assert.deepEqual(['b.n', 'b.e', 'b.s', 'b.w'].map((id) => dug.envelope.filter((s) => s.pieceId === id).map((s) => s.toRoom).join()), ['ground', 'outside', 'ground', 'ground']);
  const half = findRooms(box({ h: 2.4 }), { groundHeightAt: () => 1.2 })[0].envelope.filter((s) => s.pieceId === 'b.n');
  assert.deepEqual(half.map((s) => [s.toRoom, +s.areaM2.toFixed(3)]), [['ground', 4.8], ['outside', 4.8]]);
  assert.ok(findRooms(box({ storey: -1, y: -2.6 }))[0].envelope.every((s) => s.toRoom === 'ground'));
  // a twelve-sided tower with a pointed roof and a landing inside is one tall room
  const ring = (r, n = 12) => Array.from({ length: n }, (_, k) => ({ x: r * Math.cos((2 * Math.PI * k) / n), z: r * Math.sin((2 * Math.PI * k) / n) }));
  const o = ring(3), tower = [{ id: 't.f0', kind: 'floor', y0: 0, y1: 0.12, outline: o, holes: [], layers: FLOOR }, { id: 't.f1', kind: 'floor', y0: 2.84, y1: 2.96, outline: ring(1.8), holes: [], layers: FLOOR },
    { id: 't.r', kind: 'roof', type: 'cone', a: { x: 0, z: 0 }, b: { x: 0, z: 0 }, y0: 5.56, y1: 9.6, eaveY: 5.56, ridgeY: 9.6, footprint: ring(3.55), facets: 12, layers: ROOF },
    ...o.map((p, k) => ({ id: 't.s' + k, kind: 'wall', type: 'wall', a: p, b: o[(k + 1) % 12], y0: 0, y1: 5.68, height: 5.68, length: Math.hypot(o[(k + 1) % 12].x - p.x, o[(k + 1) % 12].z - p.z), layers: STONE, openings: [] }))];
  rs = findRooms(tower); assert.equal(rs.length, 1); assert.equal(rs[0].enclosed, true, rs[0].leaks.join());
  assert.equal(rs[0].envelope.filter((s) => s.kind === 'wall').length, 12); assert.equal(rs[0].envelope.filter((s) => s.kind === 'roof').length, 12);
  near(rs[0].envelope.filter((s) => s.kind === 'wall').reduce((a, s) => a + s.areaM2, 0), 12 * 2 * 3 * Math.sin(Math.PI / 12) * 5.68, 1e-6, 'tower wall area');
});

// ------------------------------------------------------------------------------------------ heat balance
test('steady state: a closed box loses exactly UA x dT plus the infiltration term, and 200 W warms it by P / (UA + infiltration)', () => {
  for (const [P, wall] of [[200, TIMBER], [1500, INSULATED]]) {
    const sim = lab(box({ w: 3, d: 3, openings: { s: [{ id: 'w1' }] } }), { tempC: -5, windMs: 3 });
    sim.runTicks(5); sim.commandNow('thermal.setGain', { roomId: 'r:b.f', source: 'lamp', watts: P, radiant: 0 });   // all of it into the air
    sim.runDays(wall === TIMBER ? 12 : 30);
    const r = rooms(sim)['r:b.f'], m = roomModels(sim.state)[0], dT = r.tempC + 5;
    near(lossSum(r), P, P * 1e-6, 'losses balance the gain');
    assert.equal(r.internalGainW, P);
    const hInf = (AIR_J_M3K * m.volumeM3 * r.infiltrationAch) / 3600;
    near(r.lossW.infiltration, hInf * dT, 1e-6, 'rho cp V ACH / 3600 x dT');
    near((r.infiltrationAch * m.volumeM3) / 3.6, infiltrationLs(m.leakageCm2, dT, 3, m.stackHeightM), 1e-9, 'air change from leakage area, wind and stack');
    // the roof also radiates to the (overcast) sky: 63 W/m2 x 0.15 x emissivity 0.9 through its outside film
    const roof = thermalOverlayData(sim.state).rooms[0].surfaces.find((s) => s.kind === 'roof'), sky = roof.uWm2K * roof.areaM2 * rse(3) * 0.9 * 63 * 0.15;
    near((r.uaWK + hInf) * dT + sky, P, P * 1e-6, 'UA x dT + infiltration');
    near(dT, (P - sky) / (r.uaWK + hInf), 1e-6, 'steady temperature rise');
    // UA is the sum of U x A, piece by piece, by hand
    const g = groundFloorU({ areaM2: 9, perimeterM: 12, wallThicknessM: 0.13, floorR: 0.025 / 0.12 + cavityR(0.095, 'down') + 0.4 / 2.8 });
    const hand = (4 * 3 * 2.6 - 1) * uValue(TIMBER, { windMs: 3 }) + uValue(GLASS, { windMs: 3 }) + 9 * uValue(ROOF, { windMs: 3, flow: 'up' }) + 9 * g;
    near(r.uaWK, hand, 1e-9, 'UA by hand');
    const shares = thermalOverlayData(sim.state).rooms[0].surfaces; near(shares.reduce((a, s) => a + s.share, 0), 1, 1e-9, 'overlay shares');
    near(shares.reduce((a, s) => a + s.lossW, 0), P - r.lossW.infiltration, P * 1e-6, 'overlay losses');
    // the default gain is half radiant: part lands on the walls and leaves without warming the air, so the air ends a little cooler
    sim.commandNow('thermal.setGain', { roomId: 'r:b.f', source: 'lamp', watts: P }); sim.runDays(wall === TIMBER ? 12 : 30);
    const dT2 = rooms(sim)['r:b.f'].tempC + 5; assert.ok(dT2 < dT && dT2 > 0.85 * dT, `half-radiant rise ${dT2} K vs ${dT} K`);
    near(lossSum(rooms(sim)['r:b.f']), P, P * 1e-6, 'still balanced');
    if (wall === TIMBER) break;
  }
});

test('energy is conserved over ten days of real weather: stored heat changes by gains minus losses', () => {
  const sim = createGameSim(21);
  setSite(sim, [...house(), ...box({ id: 'k', x: 20, w: 8, wall: STONE }), { id: 'mid', kind: 'wall', type: 'wall', a: { x: 24, z: 0 }, b: { x: 24, z: 4 }, y0: 0, y1: 2.6, length: 4, height: 2.6, area: 10.4, layers: TIMBER, openings: [] }]);
  sim.runTicks(5);
  assert.equal(Object.keys(rooms(sim)).length, 3);
  const sys = sim.systems.find((x) => x.name === 'thermal'), step = sys.step;
  let net = 0, gross = 0;
  sys.step = (c) => { step(c); for (const id in c.s.rooms) { const r = c.s.rooms[id], g = r.solarGainW + r.internalGainW + r.heatingW; net += (g - lossSum(r)) * c.dt; gross += (Math.abs(g) + Math.abs(lossSum(r))) * c.dt; } };
  const e0 = stored(sim);
  try {
    for (let d = 0; d < 10; d++) { sim.command('thermal.setGain', { roomId: 'r:p5', source: 'stove', watts: d % 2 ? 2500 : 0, heating: true }); sim.command('thermal.setGain', { roomId: 'r:k.f', source: 'people', watts: 150 }); sim.runDays(1); }
  } finally { sys.step = step; }
  assert.ok(gross > 1e8);
  assert.ok(Math.abs(stored(sim) - e0 - net) < 1e-6 * gross, `stored ${stored(sim) - e0} J vs gains - losses ${net} J`);
  near(rooms(sim)['r:k.f'].toRoomsW, -rooms(sim)['r:k.f#2'].toRoomsW, 1e-9, 'what one room gives through the shared wall the other receives');
  assert.equal(rooms(sim)['r:p5'].heatingW, 2500); assert.equal(rooms(sim)['r:p5'].internalGainW, 0); assert.equal(rooms(sim)['r:k.f'].internalGainW, 150);
});

test('time constant: a timber room cools at about C / UA, a stone room of the same size several times more slowly', () => {
  const tau = (wall) => {
    const sim = lab(box({ wall, openings: { s: [{ id: 'w1' }] } }), { tempC: 0, windMs: 4 });
    sim.runTicks(5);
    const r = rooms(sim)['r:b.f'], m = roomModels(sim.state)[0]; r.tempC = r.massTempC = 20;
    sim.runTicks(120);                                             // let the air settle against the walls
    const T = []; for (let k = 0; k < 3; k++) { T.push(r.tempC); sim.runTicks(240); }
    const hInf = (AIR_J_M3K * m.volumeM3 * r.infiltrationAch) / 3600;
    return { measured: (-240 * 60) / Math.log((T[1] - T[2]) / (T[0] - T[1])), plain: (m.airCapacityJK + m.massCapacityJK) / (r.uaWK + hInf) };
  };
  const tim = tau(TIMBER), st = tau(STONE);
  assert.ok(tim.measured > 2 * HOUR && tim.measured < 8 * HOUR, 'timber tau ' + tim.measured / HOUR + ' h');
  // the wall's mass sits part-way through the wall, below full indoor temperature, so the room cools a little faster than C / UA
  assert.ok(tim.measured / tim.plain > 0.7 && tim.measured / tim.plain < 1.05, 'timber measured / (C / UA) = ' + tim.measured / tim.plain);
  assert.ok(st.measured / st.plain > 0.45 && st.measured / st.plain < 1.05, 'stone measured / (C / UA) = ' + st.measured / st.plain);
  assert.ok(st.measured > 3 * tim.measured, `stone ${st.measured / HOUR} h vs timber ${tim.measured / HOUR} h`);
});

test('any room is stable at the 5-minute step: a cupboard of glass, a tent, a vault', () => {
  const tent = [L('canvas', 0.0008, 'covering')];
  for (const b of [box({ w: 0.6, d: 0.6, h: 1.8, wall: GLASS, roof: GLASS }), box({ w: 2, d: 2, h: 1.6 + 0.01, wall: tent, roof: tent, floor: tent, foundation: false }), box({ w: 12, d: 12, h: 6, wall: [L('granite', 1)], roof: [L('slate', 0.01), L('granite', 0.5)], floor: [L('granite', 0.3)] })]) {
    const sim = lab(b, { tempC: (t) => 5 + 15 * Math.sin((2 * Math.PI * t) / DAY), windMs: 9, cloud: 0, sun: true });
    sim.runTicks(5); sim.commandNow('thermal.setGain', { roomId: 'r:b.f', source: 'x', watts: 3000 });
    let lo = Infinity, hi = -Infinity, jump = 0, last = null;
    for (let k = 0; k < 2 * 288; k++) { sim.runTicks(5); const T = rooms(sim)['r:b.f'].tempC; assert.ok(Number.isFinite(T)); lo = Math.min(lo, T); hi = Math.max(hi, T); if (last !== null) jump = Math.max(jump, Math.abs(T - last)); last = T; }
    assert.ok(lo > -12 && hi < 400, `range ${lo} .. ${hi}`);
    sim.commandNow('thermal.setGain', { roomId: 'r:b.f', source: 'x', watts: 0 }); sim.runDays(3);
    const T = rooms(sim)['r:b.f'].tempC; assert.ok(T > -12 && T < 60, 'settles back: ' + T);
  }
});

// ------------------------------------------------------------------------------------------ the lessons
// The house through one January week, started in early winter. Returns the hourly indoor and outdoor temperatures.
function januaryWeek(pieces, watts = 0, seed = 9) {
  const sim = createGameSim(seed); setSite(sim, pieces);
  sim.runDays(262); if (watts) sim.command('thermal.setGain', { roomId: 'r:p5', source: 'stove', watts, heating: true });
  sim.runDays(4);
  const inT = [], outT = [], ach = [];
  for (let h = 0; h < 7 * 24; h++) { sim.runTicks(60); const r = rooms(sim)['r:p5']; assert.ok(Number.isFinite(r.tempC) && Number.isFinite(r.massTempC) && Number.isFinite(r.humidity)); inT.push(r.tempC); outT.push(sim.state.sys.weather.tempC); ach.push(r.infiltrationAch); }
  return { inT, outT, ach, sim };
}
const withWalls = (fn) => house().map((p) => (p.kind === 'wall' ? { ...p, layers: fn(p.layers) } : p));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('the real house in winter: it follows the weather, smoothed and a few hours behind, and never NaN', () => {
  const { inT, outT, sim } = januaryWeek(house());
  assert.match(C.dateText(sim.state.t), /January/);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
  const corr = (lag) => { const a = inT.slice(lag), b = outT.slice(0, outT.length - lag), ma = mean(a), mb = mean(b); return mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / (sd(a) * sd(b)); };
  let best = 0; for (let l = 1; l <= 12; l++) if (corr(l) > corr(best)) best = l;
  assert.ok(corr(best) > 0.85, 'indoor follows outdoor, r = ' + corr(best));
  assert.ok(best >= 1 && best <= 6, 'lag of ' + best + ' h');
  assert.ok(mean(inT) > mean(outT) && mean(inT) < mean(outT) + 6, `an unheated house sits a little above the air: ${mean(inT)} vs ${mean(outT)}`);
  const r = rooms(sim)['r:p5']; assert.ok(r.humidity > 0.2 && r.humidity <= 1 && r.dewPointC <= r.tempC + 1e-9);
});

test('insulation: fill the wall cavities and the same stove keeps the house far warmer through a January night', () => {
  const insulate = (ls) => ls.map((l) => (l.material === 'air' ? { ...l, material: 'mineral_wool', role: 'insulation' } : l));
  const bare = januaryWeek(house(), 2000), filled = januaryWeek(withWalls(insulate), 2000);
  assert.deepEqual(bare.outT, filled.outT, 'the same weather');
  const dMin = Math.min(...filled.inT) - Math.min(...bare.inT), dMean = mean(filled.inT) - mean(bare.inT);
  assert.ok(dMin > 4 && dMean > 5, `coldest hour ${dMin} K warmer, mean ${dMean} K warmer`);
  assert.ok(filled.inT.every((v, i) => v > bare.inT[i]), 'warmer at every hour');
  // the thermometer lesson with no heat at all: less of a difference, but the curve still moves
  const cold = januaryWeek(house()), coldFilled = januaryWeek(withWalls(insulate));
  assert.ok(Math.min(...coldFilled.inT) > Math.min(...cold.inT) + 0.3, `unheated night minimum ${Math.min(...cold.inT)} -> ${Math.min(...coldFilled.inT)}`);
  // construction stages: the insulation layer listed but not yet in the wall is an empty cavity
  const staged = withWalls((ls) => ls);
  assert.deepEqual(januaryWeek(staged, 2000).inT, bare.inT);
  near(roomModels(filled.sim.state)[0].room.envelope[0].layers[1].thickness, 0.089, 1e-9, 'same wall, filled');
});

test('wrap: the same house without its housewrap is draughtier and colder', () => {
  const sheathed = (ls) => [ls[0], L('osb', 0.011, 'sheathing'), ...ls.slice(1)], wrapped = (ls) => [ls[0], L('housewrap', 0.0002, 'wrap'), L('osb', 0.011, 'sheathing'), ...ls.slice(1)];
  assert.deepEqual([leakageClass(TIMBER), leakageClass(sheathed(TIMBER)), leakageClass(wrapped(TIMBER)), leakageClass(STONE)], ['boards', 'sheathed', 'wrapped', 'masonry']);
  const a = januaryWeek(withWalls(sheathed), 2000), b = januaryWeek(withWalls(wrapped), 2000);
  const la = roomModels(a.sim.state)[0].leakageCm2, lb = roomModels(b.sim.state)[0].leakageCm2;
  assert.ok(la > lb + 40, `leakage area ${la} cm2 without wrap, ${lb} cm2 with`);
  assert.ok(a.ach.every((v, i) => v > b.ach[i]), 'more air changes at every hour');
  assert.ok(mean(a.inT) < mean(b.inT) - 0.3, `colder without wrap: ${mean(a.inT)} vs ${mean(b.inT)}`);
  near(rooms(a.sim)['r:p5'].uaWK, rooms(b.sim)['r:p5'].uaWK, 0.5, 'the wrap changes the draughts, not the conduction');
});

test('a doorway with no door in it: the house is not enclosed, says why, and is as cold as outside', () => {
  const sim = createGameSim(4); setSite(sim, house().map((p) => (p.id === 'p6' ? { ...p, built: false } : p)));
  sim.command('thermal.setGain', { roomId: 'r:p5', source: 'stove', watts: 3000, heating: true }); sim.runDays(3);
  const r = rooms(sim)['r:p5'];
  assert.equal(r.enclosed, false); assert.equal(r.tempC, sim.state.sys.weather.tempC); assert.equal(r.humidity, sim.state.sys.weather.humidity);
  assert.deepEqual(roomModels(sim.state)[0].leaks, ['The south-east wall has an open doorway with no door in it.']);
  assert.deepEqual(thermalOverlayData(sim.state).rooms[0].leaks, roomModels(sim.state)[0].leaks);
  // hang the door: the room closes, keeps its id and warms up from where it was
  const before = r.tempC; setSite(sim, house()); sim.runTicks(5);
  assert.equal(rooms(sim)['r:p5'].enclosed, true); near(rooms(sim)['r:p5'].tempC, before, 3, 'starts from where it was');
  sim.runDays(1); assert.ok(rooms(sim)['r:p5'].tempC > sim.state.sys.weather.tempC + 8);
});

test('sun: south glass gains far more than north glass in winter, and a clear day more than an overcast one', () => {
  const gain = (side, cloud) => {
    const sim = lab(box({ openings: { [side]: [{ id: 'w1', width: 2, height: 1.2 }] } }), { tempC: 0, sun: true, cloud });
    sim.runDays(266);                                              // into early January
    let wh = 0, peak = 0, sum = 0; for (let k = 0; k < 288; k++) { sim.runTicks(5); const q = rooms(sim)['r:b.f'].solarGainW; sum += rooms(sim)['r:b.f'].tempC; wh += q / 12; peak = Math.max(peak, q); }
    return { wh, peak, T: sum / 288 };
  };
  const south = gain('s', 0), north = gain('n', 0), dull = gain('s', 1);
  assert.ok(south.wh > 4 * north.wh && north.wh > 0, `south ${south.wh} Wh, north ${north.wh} Wh a day`);
  assert.ok(south.wh > 4 * dull.wh && dull.wh > 0, `clear ${south.wh} Wh, overcast ${dull.wh} Wh`);
  // 2.4 m2 of single glass facing the low winter sun: several hundred watts per m2 at noon, times 0.86
  assert.ok(south.peak > 2.4 * 350 && south.peak < 2.4 * 900 * 0.86, 'noon peak ' + south.peak + ' W');
  assert.ok(south.T > north.T + 1);
});

test('the root cellar: walls and floor in the ground keep it within a few degrees of the earth while the air swings 45 C', () => {
  const YEAR = 365 * DAY, air = (t) => 8 + 17 * Math.sin((2 * Math.PI * t) / YEAR) + 5.5 * Math.sin((2 * Math.PI * t) / DAY), ground = (t) => 8 + 6 * Math.sin((2 * Math.PI * (t - 40 * DAY)) / YEAR);
  const sod = [L('soil_moist', 0.4, 'turf'), L('epdm', 0.002, 'membrane'), L('oak_seasoned', 0.06, 'deck')];
  const cellar = box({ id: 'c', w: 3, d: 4, h: 2.2, y: -2.4, storey: -1, wall: STONE, roof: sod, floor: [L('gravel', 0.1), L('granite', 0.06)], openings: { s: [{ id: 'hatch', kind: 'door', width: 0.8, height: 1.8, layers: [L('oak_seasoned', 0.05), L('mineral_wool', 0.05), L('oak_seasoned', 0.02)] }] } });
  const shed = box({ id: 'h', x: 10, w: 3, d: 4, h: 2.2, wall: STONE, roof: sod, floor: [L('gravel', 0.1), L('granite', 0.06)], openings: { s: [{ id: 'hd', kind: 'door', width: 0.8, height: 1.8 }] } });
  const sim = lab([...cellar, ...shed], { tempC: air, groundTempC: ground, windMs: 4, cloud: 0.5, sun: true });
  sim.runDays(30);
  let worst = 0, cLo = Infinity, cHi = -Infinity, aLo = Infinity, aHi = -Infinity, sLo = Infinity, sHi = -Infinity;
  for (let h = 0; h < 365 * 8; h++) {
    sim.runTicks(180);
    const T = rooms(sim)['r:c.f'].tempC, w = sim.state.sys.weather, S = rooms(sim)['r:h.f'].tempC;
    worst = Math.max(worst, Math.abs(T - w.groundTempC)); cLo = Math.min(cLo, T); cHi = Math.max(cHi, T); aLo = Math.min(aLo, w.tempC); aHi = Math.max(aHi, w.tempC); sLo = Math.min(sLo, S); sHi = Math.max(sHi, S);
  }
  assert.ok(aHi - aLo > 40, 'outside range ' + (aHi - aLo));
  assert.ok(worst < 3, 'cellar strays at most ' + worst + ' K from the ground');
  assert.ok(cHi - cLo < 15 && cLo > 0, `cellar ${cLo} .. ${cHi} C: never freezes`);
  assert.ok(sHi - sLo > 2 * (cHi - cLo) && sLo < -3, `the same room above ground: ${sLo} .. ${sHi} C`);
  assert.ok(findRooms(cellar)[0].envelope.every((s) => s.toRoom === 'ground' || s.openings.length));
});

// ------------------------------------------------------------------------------------------ the system
test('rooms follow the building: edits keep a room\'s warmth, new rooms start at the outside air, gone rooms are forgotten', () => {
  const sim = lab(box({}), { tempC: 2 });
  sim.runTicks(5); sim.commandNow('thermal.setGain', { roomId: 'r:b.f', source: 'stove', watts: 1500, heating: true });
  sim.runDays(2);
  const T = rooms(sim)['r:b.f'].tempC, v = sim.state.sys.thermal.version; assert.ok(T > 10); assert.equal(rooms(sim)['r:b.f'].heatingW, 1500);
  assert.equal(roomIdAt(sim.state, 2, 2), 'r:b.f'); assert.equal(roomIdAt(sim.state, 9, 9), null);
  setSite(sim, [...box({ openings: { e: [{ id: 'w9' }] } }), ...box({ id: 'n', x: 10 })]); sim.runTicks(5);
  assert.equal(sim.state.sys.thermal.version, v + 1);
  near(rooms(sim)['r:b.f'].tempC, T, 0.5, 'the room that was there keeps its temperature'); near(rooms(sim)['r:n.f'].tempC, 2, 0.01, 'the new one starts cold');
  // a partition splits it: both halves start from the old room's temperature
  setSite(sim, [...box({}), { id: 'mid', kind: 'wall', type: 'wall', a: { x: 1.5, z: 0 }, b: { x: 1.5, z: 4 }, y0: 0, y1: 2.6, length: 4, height: 2.6, area: 10.4, layers: TIMBER, openings: [] }]); sim.runTicks(5);
  assert.deepEqual(Object.keys(rooms(sim)).sort(), ['r:b.f', 'r:b.f#2']); assert.ok(rooms(sim)['r:b.f#2'].tempC > 9);
  assert.equal(sim.state.sys.thermal.heat['r:n.f'], undefined);
  setSite(sim, []); sim.runTicks(5);
  assert.deepEqual(sim.state.sys.thermal.rooms, {}); assert.deepEqual(sim.state.sys.thermal.heat, {});
  assert.throws(() => sim.commandNow('thermal.setGain', { source: 'x', watts: 5 })); assert.throws(() => sim.commandNow('thermal.setGain', { roomId: 'r:b.f', watts: NaN }));
  // an open window (the next iteration's hook) raises the air change
  setSite(sim, box({})); sim.runTicks(10); const a0 = rooms(sim)['r:b.f'].infiltrationAch;
  sim.commandNow('thermal.setVent', { roomId: 'r:b.f', source: 'w1', areaM2: 0.3 }); sim.runTicks(5);
  assert.ok(rooms(sim)['r:b.f'].infiltrationAch > 3 * a0);
});

test('deterministic, survives a save and load mid-run, and a save from before heat existed loads', () => {
  const make = () => { const s = createGameSim(77); setSite(s, [...house(), ...box({ id: 'k', x: 20 })]); s.command('thermal.setGain', { roomId: 'r:p5', source: 'stove', watts: 900, heating: true }); return s; };
  const a = make(), b = make(); a.runDays(12); b.runDays(12);
  assert.equal(a.hash(), b.hash());
  const first = make(); first.runDays(5);
  const save = readSave(JSON.stringify(makeSave(first.serialize())));
  const second = createGameSim(1); second.load(save.sim); second.runDays(7);
  assert.equal(second.hash(), a.hash());
  // a building edit between the save and the next step gives the same world either way
  const c = make(), d = make(); c.runDays(2); d.runDays(2);
  setSite(c, box({ id: 'z' })); const moved = createGameSim(1); moved.load(c.serialize()); setSite(d, box({ id: 'z' })); moved.runDays(1); d.runDays(1);
  assert.equal(moved.hash(), d.hash());
  const old = createGameSim(3); setSite(old, house()); old.runDays(2);
  const st = old.serialize(); delete st.sys.thermal;
  const fresh = createGameSim(3); fresh.load(st); fresh.runDays(1);
  const r = fresh.state.sys.thermal.rooms['r:p5'];
  assert.ok(r && r.enclosed && Number.isFinite(r.tempC));
  // exactly the contract's fields, plus the ones documented as extra
  assert.deepEqual(Object.keys(r).sort(), ['dewPointC', 'enclosed', 'heatingW', 'humidity', 'infiltrationAch', 'internalGainW', 'lossW', 'massTempC', 'radiantW', 'solarGainW', 'tempC', 'toRoomsW', 'uaWK', 'ventM2']);
  assert.deepEqual(Object.keys(r.lossW), ['walls', 'roof', 'floor', 'windows', 'infiltration']);
  assert.deepEqual(Object.keys(fresh.state.sys.thermal).sort(), ['gains', 'heat', 'radiant', 'rooms', 'v', 'vents', 'version']);
});

test('twenty rooms cost well under 0.05 ms a step', () => {
  const pieces = [];
  for (let k = 0; k < 14; k++) pieces.push(...box({ id: 'h' + k, x: k * 12, wall: k % 2 ? STONE : TIMBER, openings: { s: [{ id: 'hw' + k }, { id: 'hd' + k, kind: 'door', width: 0.9, height: 2, offset: 0.2 }], e: [{ id: 'he' + k }] } }));
  pieces.push(...box({ id: 't', z: 30, w: 24, openings: { s: [{ id: 'tw' }] } }));                       // a terrace of six rooms sharing walls
  for (let k = 1; k < 6; k++) pieces.push({ id: 'tp' + k, kind: 'wall', type: 'wall', a: { x: 4 * k, z: 30 }, b: { x: 4 * k, z: 34 }, y0: 0, y1: 2.6, length: 4, height: 2.6, area: 10.4, layers: TIMBER, openings: [] });
  const sim = createGameSim(12); setSite(sim, pieces); sim.runTicks(5);
  assert.equal(Object.keys(rooms(sim)).length, 20); assert.ok(Object.values(rooms(sim)).every((r) => r.enclosed));
  const sys = sim.systems.find((x) => x.name === 'thermal'), step = sys.step;
  let ms = 0, n = 0;
  sys.step = (c) => { const t0 = performance.now(); step(c); ms += performance.now() - t0; n++; };
  try { sim.runDays(20); } finally { sys.step = step; }
  console.log(`# thermal: ${((ms / n) * 1000).toFixed(1)} microseconds a step for 20 rooms (${n} steps)`);
  if (BENCH) assert.ok(ms / n < 0.05, (ms / n).toFixed(4) + ' ms per thermal step');
  const t0 = performance.now(); const found = findRooms(pieces); const tFind = performance.now() - t0;
  assert.equal(found.length, 20); if (BENCH) assert.ok(tFind < 250, 'finding the rooms took ' + tFind.toFixed(1) + ' ms');
});
