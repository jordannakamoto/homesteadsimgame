import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, heightAt, walkLine, toWorld, toLocal, fromRecord, layoutOf, lookOf, TYPES, RULES, GRAND_TYPES } from '../src/sim/content/stairs.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('a storey with 4.5 m of run is a straight stair of 16 risers near 178 mm', () => {
  const L = solve({ rise: 2.84, run: 4.5 });
  assert.equal(L.ok, true);
  assert.equal(L.type, 'straight');
  assert.equal(L.auto, true);
  assert.equal(L.n, 16);
  near(L.riser, 0.178, 0.002);
  assert.ok(L.tread >= 0.25 && L.tread <= 0.28);
  const stride = 2 * L.riser + L.tread;
  assert.ok(stride >= 0.6 - 1e-6 && stride <= 0.64 + 1e-6, 'stride ' + stride);
  assert.ok(L.length <= 4.5);
  assert.equal(L.flights.length, 1);
  assert.ok(L.headroom >= RULES.headroom, 'headroom ' + L.headroom);
  assert.ok(L.well.length === 1 && L.well[0][2] === L.length, 'well runs to the head');
  assert.equal(L.label, '16 x 178 mm');
});

test('a 0.45 m rise gives Steps with 3 risers and no rail', () => {
  const L = solve({ rise: 0.45 });
  assert.equal(L.ok, true);
  assert.equal(L.type, 'steps');
  assert.equal(L.n, 3);
  near(L.riser, 0.15, 1e-6);
  assert.equal(L.railDefault, 'none');
  assert.equal(L.well.length, 0);
});

test('3.0 m of run is too steep for a straight stair and offers an L', () => {
  const L = solve({ rise: 2.84, run: 3.0, type: 'straight' });
  assert.equal(L.ok, false);
  assert.equal(L.issues[0].code, 'run');
  assert.match(L.issues[0].text, /^Too steep: \d+ risers of \d+ mm in 3\.0 m$/);
  assert.ok(L.length <= 3.0 + 1e-6, 'drawn inside the run');
  const l = L.fixes.find((f) => f.patch.type === 'l');
  assert.ok(l, 'L fix: ' + L.fixes.map((f) => f.label));
  assert.equal(l.label, 'Make it L-shaped');
  assert.ok(L.fixes.some((f) => f.code === 'run'));
  // Auto picks the L itself, turning the way there is room
  const A = solve({ rise: 2.84, run: 3.0, side: { left: 3, right: 0.4 } });
  assert.equal(A.type, 'l');
  assert.equal(A.turn, 'left');
  assert.ok(A.ok && A.landing && A.landing.y === A.flights[1].y0);
});

test('a 1.6 m square gives a spiral with at least 2.0 m of headroom', () => {
  const L = solve({ rise: 2.84, run: 1.6, side: 0.3, clear: 1.6 });
  assert.equal(L.type, 'spiral');
  assert.equal(L.ok, true);
  assert.ok(L.headroom >= 2.0, 'headroom ' + L.headroom);
  assert.ok(L.riser <= RULES.spiral.riser + 1e-9);
  assert.ok(L.length <= 1.6 + 1e-9 && L.span[1] - L.span[0] <= 1.6 + 1e-9);
  const tight = solve({ rise: 2.84, clear: 1.2, type: 'spiral' });
  assert.equal(tight.ok, false);
  assert.equal(tight.issues[0].code, 'clear');
});

test('Auto falls back to a ship\'s ladder where nothing else fits', () => {
  const L = solve({ rise: 2.84, run: 1.2, side: 0.2 });
  assert.equal(L.type, 'ladder');
  assert.equal(L.ok, true);
  assert.ok(L.angle >= 60 && L.angle <= 70.5, 'angle ' + L.angle);
});

test('every fix returned solves ok', () => {
  const cases = [];
  for (const type of TYPES.map((t) => t.id)) for (const rise of [0, 0.3, 0.45, 0.9, 1.4, 2.84, 3.5]) for (const run of [0.5, 1.2, 3.0, 4.5, undefined])
    for (const side of [0.2, 1.0, { left: 0, right: 2.5 }, undefined]) cases.push({ type, rise, run, side });
  cases.push({ rise: 2.84, run: 4.5, type: 'straight', opening: 1 }, { rise: 2.84, n: 12, type: 'straight' }, { rise: 2.84, run: 3, type: 'l', at: 14, side: 1 });
  let fixes = 0;
  for (const c of cases) {
    const L = solve(c);
    assert.equal(L.ok, L.issues.length === 0);
    assert.ok(L.type !== 'auto' && L.text);
    for (const f of L.fixes) {
      fixes++;
      assert.ok(f.code && f.label && f.patch, JSON.stringify(f));
      const F = solve({ ...c, ...f.patch });
      assert.equal(F.ok, true, `${JSON.stringify(c)} + ${f.label} -> ${F.text}`);
    }
  }
  assert.ok(fixes > 50);
  const h = solve({ rise: 2.84, run: 4.5, type: 'straight', opening: 1 });
  assert.equal(h.issues[0].code, 'headroom');
  assert.ok(h.fixes.some((f) => f.code === 'opening'));
});

test('heightAt rises monotonically along each type and is flat on landings', () => {
  const ins = [
    { type: 'steps', rise: 0.45 }, { type: 'straight', rise: 2.84 }, { type: 'l', rise: 2.84, run: 3 }, { type: 'l', rise: 2.84, run: 3, turn: 'left' },
    { type: 'u', rise: 2.84, run: 3 }, { type: 'winder', rise: 2.84, run: 3, turn: 'left' }, { type: 'spiral', rise: 2.84 }, { type: 'spiral', rise: 3.4, turn: 'left' },
    { type: 'ladder', rise: 2.84, run: 1.2 }, { type: 'deck', rise: 1.2 },
    { type: 'curved', rise: 2.84 }, { type: 'curved', rise: 2.84, sweep: 180, turn: 'left' }, { type: 'curved', rise: 2.84, radius: 1.2, flare: 2 },
    { type: 'curved', rise: 2.84, sweep: 135 }, { type: 'curved', rise: 3.5, sweep: 270 }, { type: 'grand', rise: 2.84 }, { type: 'grand', rise: 3.4, turn: 'left', flare: 3 },
    { type: 'imperial', rise: 2.84, flare: 2 }, { type: 'imperial', rise: 2.84, turn: 'left' }, { type: 'bifurcated', rise: 2.84 }, { type: 'horseshoe', rise: 2.84 },
    { type: 'straight', rise: 2.84, flare: 3 }, { type: 'l', rise: 2.84, run: 3, flare: 1 },
  ];
  for (const dir of [0, 1, 2, 3]) for (const inp of ins) {
    const L = solve({ ...inp, x: 3, z: -2, dir });
    assert.ok(L.ok, inp.type + ' ' + L.text);
    const pts = walkLine(L, 0.05);
    assert.ok(pts.length > 5, inp.type);
    let y = 0;
    for (const p of pts) {
      const h = heightAt(L, p.x, p.z, y);
      assert.ok(h !== null, `${inp.type} dir ${dir} off the stair at s=${p.s}`);
      assert.ok(h >= y - 1e-6, `${inp.type} dir ${dir} drops at s=${p.s.toFixed(2)}: ${h} < ${y}`);
      y = h;
    }
    near(y, L.rise, 1e-6, inp.type + ' reaches the top');
    near(heightAt(L, pts[0].x, pts[0].z, 0), 0, 1e-6, inp.type + ' starts at the floor');
    for (const l of L.landings) {
      // a rect landing at points across it; a polygon or curved one at the middle of each piece
      const spots = l.pts || l.quads ? (l.quads || [l.pts]).map((q) => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length])
        : [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.2, 0.9]].map(([a, b]) => [l.r[0] + (l.r[2] - l.r[0]) * a, l.r[1] + (l.r[3] - l.r[1]) * b]);
      for (const [u, v] of spots) near(heightAt(L, ...toWorld(L, u, v), l.y), l.y, 1e-9, inp.type + ' flat landing');
    }
    if (L.flare) for (const q of L.flare.quads) {
      const u = q.pts.reduce((a, p) => a + p[0], 0) / 4, v = q.pts.reduce((a, p) => a + p[1], 0) / 4;
      near(heightAt(L, ...toWorld(L, u, v), q.y), q.y, 1e-9, inp.type + ' flared step');
    }
  }
  const L = solve({ rise: 2.84 });
  const [x, z] = toWorld(L, -0.5, 0);
  assert.equal(heightAt(L, x, z), null, 'off the stair');
  const [u, v] = toLocal(L, ...toWorld(L, 1.25, -0.3));
  near(u, 1.25, 1e-9), near(v, -0.3, 1e-9);
});

test('an old { i, j, dir } record converts to a straight stair to the storey above', () => {
  const r = fromRecord({ id: 'st1', i: 2, j: 3, dir: 1 });
  assert.equal(r.type, 'straight');
  assert.equal(r.id, 'st1');
  assert.equal(r.width, 0.92);
  near(r.rise, 2.84, 1e-9);
  assert.deepEqual([r.x, r.z, r.dir], [2.5, 3, 1]);   // the foot's centre: the near edge of cell (2, 3), climbing +z
  const L = layoutOf({ id: 'st1', i: 2, j: 3, dir: 1 });
  assert.equal(L.ok, true);
  assert.equal(L.type, 'straight');
  assert.ok(L.riser >= 0.15 && L.riser <= 0.19);
  const [hx, hz] = toWorld(L, ...L.head);
  near(hx, 2.5, 1e-9), assert.ok(hz > 3 + 3.5);
  assert.equal(fromRecord({ id: 'a', i: 0, j: 0, dir: 0 }, { hs: 1.5 }).rise, 4.26);
  const look = lookOf(r, L);
  assert.deepEqual(look, { mat: 'pine', rail: 'both', railStyle: 'square', open: false, nosing: true, boxed: false, flare: 0, gallery: true });
  // a new record keeps its fields and solves the same twice over
  const nr = fromRecord({ id: 'b', type: 'l', x: 1, z: 1, dir: 0, rise: 2.84, run: 3, n: 16, at: 8, turn: 'left', rail: 'wall' });
  assert.equal(nr.rail, 'wall');
  assert.deepEqual(JSON.stringify(layoutOf(nr)), JSON.stringify(layoutOf(nr)));
  assert.equal(layoutOf(nr).at, 8);
});

// ---- grand stairs

const ROOMS = [
  { rise: 2.84 }, { rise: 2.84, run: 3.0, side: 0.6 }, { rise: 2.84, run: 4.5, side: 0.3 }, { rise: 2.84, run: 2.2, side: { left: 0.2, right: 3 } },
  { rise: 2.84, run: 1.6, side: 0.3, clear: 1.6 }, { rise: 2.84, run: 6, side: 3 }, { rise: 3.4, run: 8, side: 4 }, { rise: 2.84, run: 12, side: 6, opening: 2 },
  { rise: 0.45 }, { rise: 1.2, run: 6, side: 3 },
];

test('Auto never picks a grand stair; it suggests them only in a big open hall', () => {
  for (const r of ROOMS) {
    const L = solve(r);
    assert.ok(!GRAND_TYPES.includes(L.type), JSON.stringify(r) + ' -> ' + L.type);
  }
  assert.deepEqual(solve({ rise: 2.84 }).suggest, [], 'no room given, no suggestion');
  assert.deepEqual(solve({ rise: 2.84, run: 3.0, side: 0.6 }).suggest, [], 'a small room');
  assert.deepEqual(solve({ rise: 2.84, run: 12, side: 6, opening: 2 }).suggest, [], 'the floor above is not free to open');
  const hall = solve({ rise: 2.84, run: 6, side: 3 });
  assert.ok(hall.suggest.includes('curved') && hall.suggest.includes('imperial'), 'hall suggests ' + hall.suggest);
  for (const t of hall.suggest) assert.ok(solve({ rise: 2.84, run: 6, side: 3, type: t }).ok, t);
  assert.ok(hall.fits.includes('imperial'));
  // a straight stair too long for the room, in a big hall, may be offered as curved
  const long = solve({ rise: 2.84, run: 4.5, side: 3, type: 'straight', n: 18 });
  assert.ok(long.fixes.every((f) => solve({ rise: 2.84, run: 4.5, side: 3, type: 'straight', n: 18, ...f.patch }).ok));
});

test('every grand type lays out a comfortable storey stair in a hall', () => {
  for (const type of GRAND_TYPES) for (const turn of [null, 'left']) {
    const L = solve({ type, rise: 2.84, turn });
    assert.equal(L.ok, true, type + ' ' + L.text);
    assert.equal(L.type, type);
    assert.ok(L.riser >= RULES.riser.min - 1e-9 && L.riser <= RULES.riser.max + 1e-9, type + ' riser ' + L.riser);
    assert.ok(L.tread >= RULES.tread.min - 1e-9 && L.tread <= RULES.tread.max + 1e-9, type + ' tread ' + L.tread);
    const stride = 2 * L.riser + L.tread;
    assert.ok(stride >= RULES.stride.min - 1e-3 && stride <= RULES.stride.max + 1e-3, type + ' stride ' + stride);
    assert.ok(L.arrive.length >= 1 && L.well.length >= 1, type + ' arrives on a gallery');
    assert.ok(L.headroom >= RULES.headroom, type + ' headroom ' + L.headroom);
    // every arrival line lies on the edge of the well, so the gallery guard can stop there
    for (const [a, b] of L.arrive) {
      const onEdge = L.well.some((W) => [0, 1].some((k) => [W[k], W[k + 2]].some((e) => Math.abs(a[k] - e) < 2e-3 && Math.abs(b[k] - e) < 2e-3)));
      assert.ok(onEdge, `${type} arrival ${JSON.stringify([a, b])} on the well ${JSON.stringify(L.well)}`);
    }
    if (L.curves.length) {
      assert.ok(L.narrow >= RULES.curved.narrow - 1e-6, type + ' narrow end ' + L.narrow);
      assert.ok(L.radius >= RULES.curved.rin[0] - 1e-6 && L.radius <= RULES.curved.rin[1] + 1e-6, type + ' radius ' + L.radius);
      // the going is the same on the walking line all the way up
      for (const cv of L.curves) assert.equal(cv.lines.length, L.n);
    }
  }
  const imp = solve({ type: 'imperial', rise: 2.84 });
  assert.equal(imp.flights.length, 3);
  assert.ok(imp.flights[0].w > imp.flights[1].w, 'the central flight is the wide one');
  near(imp.landing.y, imp.at * imp.riser, 0.01);
  near(imp.well[0][0], imp.arrive[0][0][0], 1e-3, 'the gallery edge is where the wings arrive');
  const bif = solve({ type: 'bifurcated', rise: 2.84 });
  assert.deepEqual(bif.flights.slice(1).map((f) => f.d), [[0, 1], [0, -1]]);
  const g = solve({ type: 'grand', rise: 2.84 });
  assert.ok(g.widthFoot > g.width + 0.3, 'wider at the foot');
  assert.ok(g.curves[0].rin[0] > g.curves[0].rin[1], 'elliptical: the curve opens out at the foot');
  assert.equal(g.sweep, 180);
});

test('curved: the sweep sets the radius, the head is square to the floor, odd sweeps get a curved landing', () => {
  const half = solve({ type: 'curved', rise: 2.84, sweep: 180 });
  assert.equal(half.ok, true);
  assert.equal(half.sweep, 180);
  assert.ok(Math.abs(half.head[0]) < 0.05, 'a half turn comes back over the foot line: ' + half.head);
  const q = solve({ type: 'curved', rise: 2.84, sweep: 90 });
  assert.ok(q.radius > half.radius, 'a quarter turn is a bigger curve');
  // a radius with walk to spare starts straight
  const r15 = solve({ type: 'curved', rise: 2.84, radius: 1.5 });
  assert.ok(r15.lead > 0.3 && r15.sweep === 90, `lead ${r15.lead} sweep ${r15.sweep}`);
  // 135 degrees: a curved landing brings the head round to the next quarter
  const odd = solve({ type: 'curved', rise: 2.84, sweep: 135 });
  assert.equal(odd.ok, true, odd.text);
  assert.ok(odd.landings.length === 1 && odd.landings[0].quads.length >= 1);
  const [a, b] = odd.arrive[0];
  assert.ok(Math.abs(a[0] - b[0]) < 2e-3 || Math.abs(a[1] - b[1]) < 2e-3, 'head line square to the floor');
  // too tight, too narrow, too far round
  const full = solve({ type: 'curved', rise: 2.84, sweep: 360 });
  assert.equal(full.ok, false);
  assert.ok(['radius', 'narrow'].includes(full.issues[0].code), full.issues[0].code);
  assert.ok(full.fixes.some((f) => f.code === 'sweep' && f.label === 'Sweep 90°'), full.fixes.map((f) => f.label));
  const tall = solve({ type: 'curved', rise: 3.4, sweep: 360 });
  assert.ok(tall.issues.length >= 1);
  for (const f of full.fixes) assert.ok(solve({ type: 'curved', rise: 2.84, sweep: 360, ...f.patch }).ok, f.label);
  for (const f of tall.fixes) assert.ok(solve({ type: 'curved', rise: 3.4, sweep: 360, ...f.patch }).ok, f.label);
});

test('a grand stair that does not fit says what hall it needs and offers a plainer stair', () => {
  const L = solve({ type: 'curved', rise: 2.84, run: 3.0, side: 0.6 });
  assert.equal(L.ok, false);
  assert.equal(L.issues[0].code, 'hall');
  assert.match(L.issues[0].text, /^Needs a [\d.]+ (m square|x [\d.]+ m) hall$/);
  assert.ok(L.fixes.length >= 1);
  assert.match(L.fixes[0].label, / instead$/);
  for (const f of L.fixes) assert.ok(solve({ type: 'curved', rise: 2.84, run: 3.0, side: 0.6, ...f.patch }).ok, f.label);
  const I = solve({ type: 'imperial', rise: 2.84, run: 3.2, side: 1.0 });
  assert.equal(I.issues[0].code, 'hall');
  assert.ok(I.fixes.some((f) => f.code === 'width'), I.fixes.map((f) => f.label));
  const low = solve({ type: 'imperial', rise: 0.45 });
  assert.equal(low.ok, false);
  assert.equal(low.issues[0].code, 'rise');
  assert.equal(low.fixes[0].code, 'type');
  assert.ok(!GRAND_TYPES.includes(low.fixes[0].patch.type) && solve({ type: 'imperial', rise: 0.45, ...low.fixes[0].patch }).ok);
});

test('a flared start widens the bottom steps, walks right, and is checked against the room', () => {
  const plain = solve({ type: 'straight', rise: 2.84 }), L = solve({ type: 'straight', rise: 2.84, flare: 3 });
  assert.equal(L.ok, true);
  assert.equal(L.flare.n, 3);
  assert.equal(L.flare.quads.length, 6);
  assert.equal(L.flare.curtail.length, 2);
  assert.ok(L.span[1] - L.span[0] > plain.span[1] - plain.span[0] + 0.5, 'wider at the foot');
  const c = L.flare.curtail[0];
  near(heightAt(L, ...toWorld(L, c.c[0], c.c[1]), 0), L.riser, 1e-9, 'on the curtail step');
  const tight = solve({ type: 'straight', rise: 2.84, flare: 2, side: 0.1 });
  assert.equal(tight.ok, false);
  assert.equal(tight.issues[0].code, 'flare');
  assert.ok(tight.fixes.some((f) => f.label === 'Plain start'));
  assert.equal(solve({ type: 'ladder', rise: 2.84, flare: 2 }).flare, undefined, 'not on a ladder');
  assert.equal(solve({ type: 'u', rise: 2.84, flare: 1 }).flare.sides.length, 1, 'a U flares on its outer side only');
  assert.equal(solve({ type: 'curved', rise: 2.84, flare: 2, flareSide: 'right' }).flare.sides.join(), '1');
});

test('grand records keep their sweep, radius and flare; a record solves the same twice', () => {
  const rec = { id: 'g1', type: 'curved', x: 2, z: 3, dir: 1, rise: 2.84, sweep: 180, radius: null, flare: 2, rail: 'wall', wall: 'left', turn: 'left' };
  const r = fromRecord(rec);
  assert.equal(r.sweep, 180);
  assert.equal(r.flare, 2);
  assert.equal(r.width, null, 'a grand record without a width takes its type\'s');
  const L = layoutOf(rec);
  assert.equal(L.ok, true, L.text);
  assert.equal(L.sweep, 180);
  assert.deepEqual(L.flare.sides, [1], 'flared on the open side, not the wall side');
  assert.equal(JSON.stringify(layoutOf(rec)), JSON.stringify(L));
  assert.equal(lookOf(r, L).flare, 2);
  assert.equal(lookOf({ flare: 2 }, solve({ type: 'spiral', rise: 2.84 })).flare, 0);
});
