// Routing runs through a building's frame: channels from the real members of src/framing.js, the generic router,
// and the services rules (hole limits, nail plates, a drain's fall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import { find } from '../src/sim/core/routefind.js';
import { channelsFromMembers, attach, snap, rayHit, wallAt } from '../src/sim/content/frame-channels.js';
import { routeRule, boreCheck } from '../src/sim/content/services.js';
const F = globalThis.__framing;

// a 4 x 3 m cabin: four outside walls; the front wall (z = 0) has a tall window from 0.2 m up
function cabin({ found = 'plinth', floor = false, window = true } = {}) {
  const pts = [[0, 0], [4, 0], [4, 3], [0, 3]], walls = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    const out = -Math.sign(n[0] * (2 - (a[0] + b[0]) / 2) + n[1] * (1.5 - (a[1] + b[1]) / 2));
    walls.push({ id: 'w' + i, a, b, y0: 0, h: 2.84, out, mat: 'timber', foot: floor ? undefined : 0.12,
      openings: i === 0 && window ? [{ id: 'win', kind: 'window', offset: 1.6, width: 0.8, sill: 0.2, height: 1.9 }] : [] });
  }
  const desc = { found, spec: { ins: 'fibreglass_batt', lining: 'gypsum' }, walls, floors: floor ? [{ id: 'f', outline: pts, y0: 0, ground: true }] : [], roofs: [] };
  return channelsFromMembers(F.generate(desc), { found });
}
const front = (ch) => ch.walls.find((w) => w.id === 'w0');
// a box beside the stud nearest s, at a height, on the inside
function box(ch, wallId, s, h) {
  const w = ch.walls.find((x) => x.id === wallId);
  const sn = snap(ch, { kind: 'wall', wall: wallId, s, y: w.yb + h, side: -w.out }, { heightM: h });
  assert.ok(sn && sn.at, 'snapped: ' + JSON.stringify(sn));
  return attach(ch, sn.at);
}

test('channels: bays, three heights, the window blocks its bays, a hole per post crossed', () => {
  const ch = cabin(), w = front(ch);
  assert.equal(w.out, -1);
  assert.ok(w.bays.length >= 8, 'bays ' + w.bays.length);
  assert.deepEqual(w.levels.map((y) => +(y - w.yb).toFixed(2)), [0.35, 1.15, 2.52]);
  const win = w.blocks.find((b) => b.open);
  assert.ok(win && Math.abs(win.s0 - 1.6) < 0.01 && Math.abs(win.s1 - 2.4) < 0.01, JSON.stringify(win));
  // no vert inside the window, none of its bays has a low or middle vert
  for (const v of ch.verts) if (v.wall === 'w0') { const s = (v.p[0] - w.o[0]) * w.u[0] + (v.p[2] - w.o[1]) * w.u[1]; assert.ok(!(s > 1.6 && s < 2.4 && v.p[1] < win.y1), v.id); }
  // a header is never bored: no sideways edge at a height inside it
  const hd = w.blocks.find((b) => b.header && !b.open);
  for (const e of ch.edges) if (e.tag === 'wall' && e.host === 'w0') assert.ok(!(e.bore && e.bore.at[1] > hd.y0 && e.bore.at[1] < hd.y1));
  assert.ok(ch.verts.length < 600, 'verts ' + ch.verts.length);
});

test('a plain stretch of wall: straight through the studs, one hole in each', () => {
  const ch = cabin({ window: false }), w = front(ch);
  const a = box(ch, 'w0', 0.4, 0.4), b = box(ch, 'w0', 2.0, 0.4);
  const r = find(ch, a, b, routeRule('cable_nm_14_2'), 3);
  assert.ok(Array.isArray(r), JSON.stringify(r));
  const best = r[0];
  // the boxes sit on the stud sides beside 0.4 and 2.0: studs at 0.8, 1.2, 1.6 (and maybe 2.0 or 0.4) lie between
  const between = w.posts.filter((p) => { const s = (p.s0 + p.s1) / 2; return s > Math.min(sOfP(w, a.p), sOfP(w, b.p)) && s < Math.max(sOfP(w, a.p), sOfP(w, b.p)); });
  assert.equal(best.bores.length, between.length, 'holes ' + best.bores.length + ' posts ' + between.length);
  assert.ok(best.bores.every((x) => x.kind === 'stud' && x.parent && x.parent.startsWith('w0.st')));
  assert.equal(best.why, 'wall'); assert.ok(best.level < 0.7);
  assert.deepEqual(best.hosts, ['w0']);
  assert.ok(best.lengthM > 1.5 && best.lengthM < 2.2, 'length ' + best.lengthM);
  // alternatives differ (high through the studs, over the top)
  assert.ok(r.length >= 2 && r[1].path.length && JSON.stringify(r[1].path) !== JSON.stringify(best.path));
  // 14/2 in a 2x4: a 3/4 in hole leaves 35 mm each side, no plate; 1/2 in PEX (7/8 in hole) gets plates
  assert.ok(best.bores.every((x) => x.plate === 0));
  const pex = find(ch, a, b, routeRule('pex_12_blue'), 1);
  assert.ok(pex[0].bores.length && pex[0].bores.every((x) => x.plate === 1));
});
const sOfP = (w, p) => (p[0] - w.o[0]) * w.u[0] + (p[2] - w.o[1]) * w.u[1];

test('a tall window in the way: the route goes over the header, never through the opening', () => {
  const ch = cabin(), w = front(ch), hd = w.blocks.find((b) => b.header && !b.open);
  const a = box(ch, 'w0', 0.8, 1.2), b = box(ch, 'w0', 3.2, 1.2);
  const r = find(ch, a, b, routeRule('cable_nm_14_2'), 3);
  assert.ok(Array.isArray(r), JSON.stringify(r));
  for (const alt of r) {
    const across = alt.path.filter((q) => { const s = sOfP(w, q); return s > 1.6 && s < 2.4; });
    assert.ok(across.length && across.every((q) => q[1] > hd.y1), alt.why + ' crosses above the header');
    assert.ok(!alt.bores.some((x) => x.parent && /hd/.test(x.parent)), 'never the header');
  }
  // one way bores the cripple studs over the header, another goes up through the plates and over the top
  assert.ok(r.some((x) => x.bores.some((b) => /\.st/.test(b.parent) && b.at[1] > hd.y1 && sOfP(w, b.at) > 1.6 && sOfP(w, b.at) < 2.4)), 'through the cripples');
  assert.ok(r.some((x) => x.why === 'over' && x.bores.filter((b) => b.top).length === 2), 'over the top: a hole up and a hole down');
  const p = r[0].path;
  const across = p.filter((q) => { const s = sOfP(w, q); return s > 1.6 && s < 2.4; });
  assert.ok(across.length && across.every((q) => q[1] > hd.y1), 'crosses above the header: ' + JSON.stringify(across));
});

test('a drain falls 2 cm a metre from the sink to the exit, and is refused when asked to climb', () => {
  const ch = cabin({ found: 'skids', floor: true, window: false });
  // a 2x4 wall cannot take a 1-1/2 in drain sideways; it goes down into the floor
  const sink = box(ch, 'w0', 1.0, 0.45);
  const w2 = ch.walls.find((x) => x.id === 'w2');
  const ex = snap(ch, { kind: 'wall', wall: 'w2', s: 2.0, y: w2.yb, side: w2.out }, { exit: true });
  assert.ok(ex.at, JSON.stringify(ex));
  const exit = attach(ch, ex.at);
  assert.ok(exit, 'exit joins the floor');
  const r = find(ch, sink, exit, routeRule('dwv_40'), 2);
  assert.ok(Array.isArray(r), JSON.stringify(r));
  const p = r[0].path;
  for (let i = 1; i < p.length; i++) assert.ok(p[i][1] <= p[i - 1][1] + 1e-9, 'never rises at ' + i);
  assert.ok(r[0].fall && r[0].fall.slope === 0.02);
  // along the floor it drops by the slope
  let h = 0; for (let i = 1; i < p.length; i++) if (p[i][1] < 0.12) h += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
  assert.ok(r[0].tags.floor > 0 || r[0].tags.joist > 0);
  assert.ok(!r[0].bores.some((b) => b.kind === 'stud'), 'no hole through a 2x4 stud for a drain');
  // the other way round, the drain would climb
  const up = find(ch, exit, sink, routeRule('dwv_40'), 1);
  assert.ok(up.refused && /cannot climb/.test(up.refused), JSON.stringify(up));
});

test('hole limits in plain words', () => {
  const stud = { kind: 'stud', depthM: 0.089, bearing: true }, joist = { kind: 'joist', depthM: 0.184 };
  assert.ok(boreCheck('cable_nm_14_2', stud).ok);
  const d = boreCheck('dwv_50', stud);
  assert.ok(!d.ok && /2x4 studs/.test(d.reason) && /36 mm/.test(d.reason), d.reason);
  assert.ok(boreCheck('dwv_40', joist).ok);
  const j = boreCheck('dwv_50', joist);
  assert.ok(!j.ok && /2x8 joists/.test(j.reason), j.reason);
  assert.ok(boreCheck('pex_12_blue', stud).plate && !boreCheck('cable_nm_14_2', stud).plate);
});

test('aiming: a ray from inside the room meets the front wall on its inside face', () => {
  const ch = cabin(), w = front(ch);
  const h = rayHit(ch, [1.0, 1.5, 1.5], [0, 0, -1]);
  assert.equal(h.kind, 'wall'); assert.equal(h.wall, 'w0'); assert.equal(h.side, -w.out);
  assert.ok(Math.abs(h.s - 1.0) < 1e-6);
  const sn = snap(ch, h, { heightM: 0.4 });
  const q = wallAt(w, sn.s, sn.y, 0);
  assert.ok(Math.abs(q[1] - (w.yb + 0.4)) < 1e-6 && sn.host.member && sn.host.parent === 'w0');
  // up into a window, a box is refused
  const win = snap(ch, { kind: 'wall', wall: 'w0', s: 2.0, y: 1, side: 1 }, { heightM: 1.0 });
  assert.ok(win.refused, JSON.stringify(win));
});
