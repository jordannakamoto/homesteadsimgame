import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, heightAt, walkLine, toWorld, toLocal, fromRecord, layoutOf, lookOf, TYPES, RULES } from '../src/sim/content/stairs.js';

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
    for (const l of L.landings) for (const [a, b] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.2, 0.9]]) {
      const [x, z] = toWorld(L, l.r[0] + (l.r[2] - l.r[0]) * a, l.r[1] + (l.r[3] - l.r[1]) * b);
      near(heightAt(L, x, z, l.y), l.y, 1e-9, 'flat landing');
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
  assert.deepEqual(look, { mat: 'pine', rail: 'both', railStyle: 'square', open: false, nosing: true, boxed: false });
  // a new record keeps its fields and solves the same twice over
  const nr = fromRecord({ id: 'b', type: 'l', x: 1, z: 1, dir: 0, rise: 2.84, run: 3, n: 16, at: 8, turn: 'left', rail: 'wall' });
  assert.equal(nr.rail, 'wall');
  assert.deepEqual(JSON.stringify(layoutOf(nr)), JSON.stringify(layoutOf(nr)));
  assert.equal(layoutOf(nr).at, 8);
});
