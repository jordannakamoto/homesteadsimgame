// Foundations as a process (ground-foundations design, part B). One job per building whose foundation is poured
// (slab, piers, stem wall) or free-standing (later slices), with elements that stand for the building's foundation
// members, the steps layout .. done, and concrete that cures on the sim clock and holds the stages built on it while
// it is green (construction.setHold).
//
// B1 is the skeleton: state, foundation.setPlan / forget, foundation.debugPour (sandbox: the pour happens now), the
// cure step and the gates. B2 adds the layout and the dig: setPlan takes the corners and the dig regions from the
// page, foundation.stake closes the string lines, foundation.check reads the dig from the ground (and finishes the
// building's site stage when it is down to the line), foundation.trim is the flat of the shovel along a stroke.
// B3: the gravel base is read from the ground (foundation.check: gravel, level under the slab, tamped twice through
// the landscape's tamp flags; foundation.gravel tips the building's gravel as a landscape heap), then forms: runs of
// boards on the strings (foundation.setForm) held by stakes (foundation.stakeForm). B4: the barrow mix is a generic
// batch (core/batch.js; foundation.mix, foundation.take) whose water/cement ratio sets its slump, whether it screeds
// and its strength; the wet slab is an earthwork-format grid in job.pour (h = mm of concrete over the base, the
// forms are WALL bits) worked by foundation.tip (fill and flow), foundation.rake (relax) and foundation.screed (push
// riding on the forms, the ridge rolling ahead). Each board bows as a beam between what holds it; past
// FORMS.leakBowM it gapes and the concrete runs out. Screeded flat, the slab starts to cure (finishing is B5).
// B5: screeded, the slab is not yet cured but finished: step 'finish' (cure runs from here, on the set clock): the bull
// float (foundation.finishAt float), the bleed-water sheen that must go before troweling or brooming (too early scales
// the skin; too late, past final set, the tool tears and the step ends), the edger, joints along a straightedge
// (foundation.joint, planned lines for spans over 3 m) and anchor bolts along the sill line (foundation.setBolt: pushed
// in while wet; framing stays held without them). Then 'cure': covers (foundation.cover plastic | blanket) and misting
// (foundation.mist) feed the cure's drying and frost terms; at the strip gate (20%) the forms come off
// (foundation.strip, boards and stakes go back to stock). The other hands-on steps (rebar, piers and walls) are B6-B8.
//
// state sys.foundation = { v: 1, nextId, jobs: { [id]: job }, carry: batch | null (the barrow's mix), machines: {} }
// job = { id, owner: { structId } | null, type, x, z, yaw, topY, step, layout, digs: [{ poly, targetY, frac, rough }], roughIn, elements: [element], pour,
//         held: reason | null, baseIds: [construction member ids of the gravel base], base: { level, gravel, compact },
//         gravelM3, forms: { runs: [{ a, b, len, out, boards, set, stakes, driven, bow, leak }] },
//         pour: { grid, m3, wcM3, weakM3, leakM3, cold, firstT, lastT, screed, needM3 },
//         finish: { bolts: { pos: [[x, z, set, retro]] }, joints: { lines: [{ a, b, len, cells }] }, edge: [[0|1]], early, cov, result } | null,
//         cover: null | 'plastic' | 'blanket', wetUntil: sim seconds | 0, stripped: 0 | 1 }
// element = { id, kind, memberIds, w, botY, topY, volM3, dig, base, forms, rebar, bolts, pour, finish, cure }
// events: 'foundation.gate' { jobId, gate } when a gate opens; 'foundation.cured' { jobId } when it is followed no more.
import { kept } from './core/keep.js';
import * as CU from './core/cure.js';
import * as CC from './content/concrete.js';
import * as EW from './core/earthwork.js';
import * as BA from './core/batch.js';
import { groundRead } from './ground.js';

const STEPS = ['layout', 'excavate', 'base', 'forms', 'rebar', 'roughin', 'pour', 'finish', 'cure', 'strip', 'done'];
const fail = (reason) => ({ ok: false, reason });
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const okPt = (q) => Array.isArray(q) && num(q[0]) && num(q[1]);

export function freshFoundation() { return { v: 1, nextId: 1, jobs: {}, carry: null, machines: {} }; }
function ensure(ctx) {
  if (!ctx.s || ctx.s.v !== 1 || !ctx.s.jobs) ctx.s = freshFoundation();
  return ctx.s;
}
export function newElement(e) {
  const el = {
    id: String(e.id), kind: e.kind || 'slab', memberIds: Array.isArray(e.memberIds) ? e.memberIds.map(String) : [],
    w: num(e.w) ? e.w : null, botY: num(e.botY) ? e.botY : null, topY: num(e.topY) ? e.topY : null, volM3: num(e.volM3) ? r6(e.volM3) : 0,
    dig: { frac: 0 }, base: { needM: 0, frac: 0, compact: 0 }, forms: { needM: 0, setM: 0, staked: 0, stripped: 0 },
    rebar: { need: 0, set: 0, tied: 0 }, bolts: { need: 0, set: 0 }, pour: { m3: 0, level: 0, cold: 0, vib: 0 },
    finish: { screed: 0, float: 0, trowel: 0, joints: 0, broom: 0 }, cure: null,
  };
  for (const k of ['outline', 'path', 'at', 'hole', 'run']) if (e[k] !== undefined) el[k] = JSON.parse(JSON.stringify(e[k]));
  return el;
}
const KEEP = ['dig', 'base', 'forms', 'rebar', 'bolts', 'pour', 'finish', 'cure'];
// what a hole (a pier) or a run (a footing or a wall) has had done to it: kept when the plan is sent again. Where it
// stands (and how deep it goes) is kept too while the pier or run has not moved, so digging the ground does not move the line.
const KEEP_HOLE = ['dug', 'tube', 'tilt', 'plumb', 'm3', 'air', 'wcM3', 'weakM3', 'firstT', 'full', 'bracket', 'rods'];
const KEEP_RUN = ['m3', 'air', 'wcM3', 'weakM3', 'firstT', 'full', 'panels', 'ties', 'stripped', 'rods'];
function keepPart(e, o, key, keys) {
  if (!e[key] || !o[key]) return;
  const a = e[key], b = o[key];
  const same = key === 'hole' ? Math.hypot(a.x - b.x, a.z - b.z) < 0.05 : Math.hypot(a.a[0] - b.a[0], a.a[1] - b.a[1]) < 0.05 && Math.hypot(a.b[0] - b.b[0], a.b[1] - b.b[1]) < 0.05;
  if (!same) return;
  for (const k of ['gy', 'botY', 'need', 'footT', 'footW']) if (b[k] !== undefined) a[k] = b[k];
  if (key === 'run' && b.botY !== undefined) { a.botY = b.botY; if (b.need !== undefined) a.need = b.need; }
  for (const k of keys) if (b[k] !== undefined) a[k] = JSON.parse(JSON.stringify(b[k]));
}

// The foundation members of a construction plan, grouped into elements (when the page sends none).
export function elementsFromProgress(pr, type) {
  if (!pr) return { elements: [], baseIds: [] };
  const elements = [], baseIds = [];
  for (const id in pr.members) {
    const m = pr.members[id];
    if (m.stage !== 'foundation') continue;
    const ln = m.line && pr.lines[m.line], item = ln ? ln.itemId : null;
    if (item && CC.BASE_ITEMS.includes(item)) { baseIds.push(id); continue; }
    if (!((item && CC.POURED_ITEMS.includes(item)) || (!item && CC.POURED_KINDS.includes(m.kind)))) continue;
    const kind = m.kind === 'footing' && type === 'piers' ? 'pad' : CC.ELEMENT_OF[m.kind] || 'pad';
    elements.push(newElement({ id, kind, memberIds: [id] }));
  }
  return { elements, baseIds };
}
export function typeFromProgress(pr) {
  if (!pr) return null;
  const kinds = new Set(), items = new Set();
  for (const id in pr.members) { const m = pr.members[id]; if (m.stage !== 'foundation') continue; kinds.add(m.kind); const ln = m.line && pr.lines[m.line]; if (ln) items.add(ln.itemId); }
  if (kinds.has('slab')) return 'slab';
  if (kinds.has('stemwall')) return 'stemwall';
  if (kinds.has('pier') && CC.POURED_ITEMS.some((i) => items.has(i))) return 'piers';
  return null;
}
const jobOf = (s, p) => (p && p.jobId !== undefined ? s.jobs[p.jobId] : p && p.structId !== undefined ? Object.values(s.jobs).find((j) => j.owner && j.owner.structId === p.structId) : null) || null;

// ------------------------------------------------------------------------------------------------ plans from the members (B-1)
// The foundation members of a building carry their shape (construction.setPlan keeps each one's geo: world a, b, y0,
// y1, w, h, type, mat, vol), so the job is laid out here with no page: the corners, the digs, the holes and the runs.
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const near2 = (p, q, d = 0.05) => Math.hypot(p[0] - q[0], p[1] - q[1]) < d;
export function frostOf(state) {
  const w = state && state.sys && state.sys.weather, c = (w && w.site && w.site.climate) || 'temperate';
  return { m: CC.FROST_DEPTH_M[c] ?? CC.FROST_DEFAULT_M, climate: c };
}
function geoMembers(pr) {
  const out = [];
  for (const id in pr.members) {
    const m = pr.members[id];
    if (m.stage !== 'foundation' || !m.geo) continue;
    const ln = m.line && pr.lines[m.line];
    out.push({ ...m.geo, id, kind: m.kind, built: !!m.built, item: ln ? ln.itemId : null });
  }
  return out;
}
const isConc = (g) => g.item ? CC.POURED_ITEMS.includes(g.item) : g.mat === 'concrete';
const isBase = (g) => g.item ? CC.BASE_ITEMS.includes(g.item) : g.mat === 'gravel';
const hash01 = (str) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
function rectAround(a, b, w, ext) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz * w / 2, nz = ux * w / 2;
  const ax = a[0] - ux * ext, az = a[1] - uz * ext, bx = b[0] + ux * ext, bz = b[1] + uz * ext;
  return [[r4(ax + nx), r4(az + nz)], [r4(bx + nx), r4(bz + nz)], [r4(bx - nx), r4(bz - nz)], [r4(ax - nx), r4(az - nz)]];
}
const dropCollinear = (P) => P.filter((q, k) => { const a = P[(k + P.length - 1) % P.length], b = P[(k + 1) % P.length]; return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) > 1e-4; });
// a pier: its hole to the frost line (or the plan's footing, if deeper), a belled footing, the tube up to the top
function pierHole(state, pier, pad, frostM) {
  const x = pier.a[0], z = pier.a[1], gy = r4(groundRead.gradedY(state, x, z));
  const planBot = pad ? pad.y0 : pier.y0, botY = r4(Math.min(planBot, gy - frostM));
  const footW = pad ? pad.w || CC.PIER.footW : CC.PIER.footW, footT = pad ? r4(pad.y1 - pad.y0) || CC.PIER.footT : CC.PIER.footT, d = pier.w || 0.25;
  const topY = r4(pier.y1), tubeL = r4(Math.max(0.2, topY - botY - footT));
  const h1 = hash01(pier.id), h2 = hash01(pier.id + '/'), off = CC.PIER.tiltMinM + (CC.PIER.tiltMaxM - CC.PIER.tiltMinM) * h1, an = h2 * Math.PI * 2;
  return { x: r4(x), z: r4(z), gy, botY, topY, d, footW, footT, tubeL, planCm: Math.round((gy - planBot) * 100),
    need: r6(footW * footW * footT + Math.PI * (d / 2) ** 2 * tubeL), dug: 0, tube: 0, tilt: [r4(Math.cos(an) * off), r4(Math.sin(an) * off)], plumb: 0,
    m3: 0, air: 0, wcM3: 0, weakM3: 0, firstT: null, full: 0, bracket: 0, rods: 0 };
}
export function planGeometry(state, pr, type, frostM = CC.FROST_DEFAULT_M) {
  const gm = geoMembers(pr);
  if (!gm.length) return null;
  const by = (kind, t) => gm.filter((m) => m.kind === kind && (!t || m.type === t));
  let topY = -Infinity;
  for (const m of gm) if (isConc(m)) topY = Math.max(topY, m.y1);
  if (!Number.isFinite(topY)) return null;
  const out = { corners: [], digs: [], topY: r4(topY), elements: null, baseIds: gm.filter(isBase).map((m) => m.id), timber: gm.filter((m) => !isConc(m) && !isBase(m)).map((m) => m.id) };
  const piers = [], pierEls = (list) => {
    const pads = by('footing', 'pad');
    for (const m of list) {
      const pad = pads.find((q) => near2(q.a, m.a));
      piers.push(m);
      out.elements.push(newElement({ id: m.id, kind: 'pier', memberIds: pad ? [m.id, pad.id] : [m.id], volM3: m.vol || 0, hole: pierHole(state, m, pad, frostM) }));
    }
  };
  if (type === 'slab') {
    out.corners = dropCollinear(by('footing', 'edge').map((m) => m.a));
    const slab = by('slab')[0], bed = by('footing', 'gravel-bed')[0];
    if (out.corners.length >= 3 && slab) out.digs.push({ poly: out.corners, targetY: r4(Math.min(slab.y0, bed ? bed.y0 : Infinity)), baseY: r4(slab.y0) });
  } else if (type === 'stemwall') {
    out.elements = [];
    const W = CC.WALL, reach = W.trenchMaxM;
    by('footing', 'strip').forEach((f, k) => {
      const len = r4(Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])), mid = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
      const gys = [f.a, mid, f.b].map((q) => groundRead.gradedY(state, q[0], q[1])), lo = Math.min(...gys), hi = Math.max(...gys);
      // to the frost line where the ground is lowest, but no deeper than a shovel throws earth out where it is highest
      const botY = r4(Math.max(Math.min(f.y0, lo - frostM), hi - reach)), t = f.h || 0.2, w = f.w || 0.4;
      out.corners.push(f.a);
      out.digs.push({ poly: rectAround(f.a, f.b, w + 2 * W.trenchOverM, (w + 2 * W.trenchOverM) / 2), targetY: botY });
      out.elements.push(newElement({ id: f.id, kind: 'strip', memberIds: [f.id], volM3: f.vol || 0, run: { k, a: f.a, b: f.b, len, w, t, botY, topY: r4(botY + t), need: r6(len * w * t), planCm: Math.round((lo - f.y0) * 100), m3: 0, air: 0, wcM3: 0, weakM3: 0, firstT: null, full: 0 } }));
      const wm = by('stemwall').find((q) => near2(q.a, f.a) && near2(q.b, f.b));
      if (wm) {
        const wb = r4(botY + t), h = r4(wm.y1 - wb), rows = Math.max(1, Math.ceil(h / W.panelH - 1e-9)), along = Math.max(1, Math.ceil(len / W.panelL - 1e-9));
        const span = Math.max(0, len - 2 * W.tieEndM), cols = Math.max(2, Math.ceil(span / W.tieEveryM - 1e-9) + 1);
        out.elements.push(newElement({ id: wm.id, kind: 'wall', memberIds: [wm.id], volM3: wm.vol || 0, run: { k, a: wm.a, b: wm.b, len, w: wm.w || 0.2, botY: wb, topY: r4(wm.y1), h, need: r6(len * (wm.w || 0.2) * h),
          panels: 0, panelsNeed: along * rows, tieRows: Math.max(1, Math.ceil(h / W.tieRowM - 1e-9)), ties: Array.from({ length: cols }, () => 0), tieAt: Array.from({ length: cols }, (_, q) => r4(W.tieEndM + (span * q) / (cols - 1))),
          m3: 0, air: 0, wcM3: 0, weakM3: 0, firstT: null, full: 0, stripped: 0, rods: 0 } }));
      }
    });
    pierEls(by('pier', 'poured'));
    out.corners = dropCollinear(out.corners);
  } else if (type === 'piers') {
    out.elements = [];
    pierEls(by('pier', 'poured'));
    if (piers.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const m of piers) { x0 = Math.min(x0, m.a[0]); x1 = Math.max(x1, m.a[0]); z0 = Math.min(z0, m.a[1]); z1 = Math.max(z1, m.a[1]); }
      const e = 0.3;
      out.corners = [[r4(x0 - e), r4(z0 - e)], [r4(x1 + e), r4(z0 - e)], [r4(x1 + e), r4(z1 + e)], [r4(x0 - e), r4(z1 + e)]];
    }
  }
  if (out.corners.length < 3 || (type === 'slab' && !out.digs.length) || (type !== 'slab' && !out.elements.length)) return null;
  return out;
}

// another system's command, called in place (the pattern construction.js uses for stock)
function call(ctx, name, payload) {
  const h = ctx.sim && ctx.sim.handlers.get(name);
  if (!h) return null;
  return h.fn({ sim: ctx.sim, state: ctx.state, t: ctx.t, tick: ctx.tick, dt: 0, lifeDt: 0, get s() { return ctx.state.sys[h.sys.name]; }, set s(v) { ctx.state.sys[h.sys.name] = v; }, get: ctx.get, rng: ctx.rng, emit: ctx.emit }, payload);
}

// ------------------------------------------------------------------------------------------------ cure and gates
export function jobStrength(job) {
  let lo = Infinity, any = false;
  for (const e of job.elements) if (e.cure) { any = true; lo = Math.min(lo, e.cure.strength); }
  return any ? lo : 0;
}
// an element is poured when its concrete is all in (a pier or a run: full and rodded; a slab element: screeded)
const elDone = (e) => (e.hole ? !!e.hole.full && !!e.cure : e.run ? !!e.run.full && !!e.cure : !!e.cure);
const poured = (job) => job.elements.length > 0 && job.elements.every(elDone);
export function gatesOf(job, gates = CC.CURE_GATES) {
  const st = poured(job) ? jobStrength(job) : 0, out = { strength: st };
  for (const g in gates) out[g] = poured(job) && st >= gates[g];
  return out;
}
// what each held stage should say now: { stage: reason | null }. The frame gate first; then the anchor bolts (a slab's
// sills bolt down, so framing waits until they are in).
const boltsMissing = (job) => !!(job.finish && job.finish.bolts && job.finish.bolts.pos.some((b) => !b[2]));
const bracketsMissing = (job) => job.elements.some((e) => e.hole && e.hole.full && !e.hole.bracket);
const fixSay = (job) => (boltsMissing(job) ? CC.BOLT_SAYS : bracketsMissing(job) ? CC.BRACKET_SAYS : null);
function wantHolds(job) {
  const out = {}, g = gatesOf(job), pr = poured(job);
  for (const h of CC.GATE_HOLDS) for (const st of h.stages) {
    if (pr && job.step !== 'done' && !g[h.gate]) out[st] = CC.GATE_SAYS[h.gate];
    else if (pr && fixSay(job)) out[st] = out[st] || fixSay(job);
    else out[st] = out[st] || null;
  }
  return out;
}
// make the construction holds match the cure (also puts them back if the building's plan was sent again)
function applyHolds(ctx, job, release = false) {
  if (!job.owner) return;
  const cs = ctx.get('construction'), pr = cs && cs.progress && cs.progress[job.owner.structId];
  if (!pr) return;
  const want = wantHolds(job), byReason = new Map();
  for (const st in want) {
    const r = release ? null : want[st], have = (kept(pr, 'hold') || {})[st] || null;
    if (r === have) continue;
    if (!byReason.has(r)) byReason.set(r, []);
    byReason.get(r).push(st);
  }
  for (const [reason, stages] of byReason) call(ctx, 'construction.setHold', { structId: job.owner.structId, stages, reason });
  job.held = release ? null : Object.values(want).find((r) => r) || null;
}
function envOf(ctx) {
  const w = ctx.get('weather');
  if (!w) return { airC: 20, windMs: 0, rh: 0.6, rainMmH: 0 };
  return { airC: w.tempC, windMs: w.windMs, rh: w.humidity, rainMmH: w.rainMmH };
}

// ------------------------------------------------------------------------------------------------ layout and dig (B2)
function digFrac(job, key = 'frac') {
  const d = job.digs || [];
  if (!d.length) return 1;
  let a = 0, f = 0;
  for (const q of d) { const A = Math.abs(polyArea(q.poly)); a += A; f += A * (q[key] || 0); }
  return a > 0 ? f / a : 1;
}
function polyArea(P) { let A = 0; for (let a = 0, b = P.length - 1; a < P.length; b = a++) A += (P[b][0] + P[a][0]) * (P[b][1] - P[a][1]); return A / 2; }
function strokeRect(x0, z0, x1, z1, w) {
  const L = Math.hypot(x1 - x0, z1 - z0) || 1e-6, ux = (x1 - x0) / L, uz = (z1 - z0) / L, h = w / 2, nx = -uz * h, nz = ux * h, e = 0.05;
  const ax = x0 - ux * e, az = z0 - uz * e, bx = x1 + ux * e, bz = z1 + uz * e;
  return [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
}
// Sutherland-Hodgman: any simple polygon clipped by a convex one
export function clipConvex(subject, clip) {
  let out = subject.map((q) => [q[0], q[1]]);
  const sgn = polyArea(clip) >= 0 ? -1 : 1;     // polyArea is negative for an anticlockwise (x right, z up) outline
  for (let k = 0; k < clip.length && out.length; k++) {
    const A = clip[k], B = clip[(k + 1) % clip.length], inp = out;
    const side = (q) => sgn * ((B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]));
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const P = inp[i], Q = inp[(i + 1) % inp.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
  }
  return out;
}
const inPoly = (P, x, z) => { let ins = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) ins = !ins; return ins; };
// where a trim stroke's earth ends up: on along the stroke until it is out of every dig, then a little further
function spoilSpot(job, x0, z0, x1, z1, out) {
  const L = Math.hypot(x1 - x0, z1 - z0), ux = L > 1e-6 ? (x1 - x0) / L : 1, uz = L > 1e-6 ? (z1 - z0) / L : 0;
  let x = x1, z = z1;
  for (let k = 0; k < 400 && (job.digs || []).some((d) => inPoly(d.poly, x, z)); k++) { x += ux * 0.05; z += uz * 0.05; }
  return [r6(x + ux * out), r6(z + uz * out)];
}
// the building's site stage is the dig: finish its site members (no material) when the dig is done
function finishSite(ctx, job) {
  if (!job.owner) return;
  const cs = ctx.get('construction'), pr = cs && cs.progress && cs.progress[job.owner.structId];
  if (!pr) return;
  const ids = Object.keys(pr.members).filter((id) => pr.members[id].kind === 'site' && !pr.members[id].built);
  if (ids.length) call(ctx, 'construction.install', { structId: job.owner.structId, memberIds: ids, from: 'stacks' });
}


// ------------------------------------------------------------------------------------------------ base (B3)
const fineOf = (ctx) => { const L = ctx.get('landscape'); return L && L.grid && L.grid.tiles ? L.grid : null; };
const baseYOf = (job, d) => (num(d.baseY) ? d.baseY : job.topY - CC.BASE.slabM);
function* latticeIn(P, step = 0.1) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let j = Math.ceil(z0 / step); j <= Math.floor(z1 / step); j++) for (let i = Math.ceil(x0 / step); i <= Math.floor(x1 / step); i++) if (inPoly(P, i * step, j * step)) yield [i, j];
}
// How the base under a slab stands, read from the ground: level (its top on the line under the slab), gravel (a
// point has gravel at least half the base deep) and compact (tamped twice everywhere is 1). Fractions of the area.
export function baseRead(state, job, fine) {
  const B = CC.BASE;
  let n = 0, level = 0, gravel = 0, filled = 0, compact = 0, needM3 = 0;
  for (const d of job.digs || []) {
    const by = baseYOf(job, d), thick = Math.max(0.02, by - d.targetY);
    needM3 += Math.abs(polyArea(d.poly)) * thick;
    for (const [i, j] of latticeIn(d.poly)) {
      const x = i * 0.1, z = j * 0.1, dy = groundRead.surfaceY(state, x, z) - by;
      n++;
      if (dy <= B.tolUpM && dy >= -B.tolDownM) level++;
      const q = fine ? EW.point(fine, i, j) : null;
      // filled at least half the base above the dig line with gravel. Raking and pushing a layer lose track of its
      // thickness here and there (core earthwork keeps l only roughly once relaxed), so a filled point counts when it
      // reads as gravel, or gravel lies on most of the base or at least that share of it was tipped in (gravelSurf, below)
      if (q && q.s !== EW.UNTOUCHED && dy + by - d.targetY >= thick * B.minLayer) { filled++; if (B.surfaces.includes(q.s)) gravel++; }
      if (q && (q.s !== EW.UNTOUCHED)) compact += q.f & B.tamp2 ? 1 : q.f & B.tamp1 ? 0.5 : 0;
    }
  }
  const tipped = (job.gravelM3 || 0) >= needM3 * B.gravelSurf;   // or the job's own gravel was tipped into it
  return n ? { n, level: r6(level / n), gravel: r6(gravel / n >= B.gravelSurf || tipped ? filled / n : gravel / n), compact: r6(compact / n), needM3: r6(needM3) } : { n: 0, level: 1, gravel: 1, compact: 1, needM3: 0 };
}
const baseDone = (b) => b.level >= CC.BASE.levelDone && b.gravel >= CC.BASE.gravelDone && b.compact >= CC.BASE.compactDone;

// ------------------------------------------------------------------------------------------------ forms (B3)
// One run of form boards per side of the outline: the board's inside face on the string, its top at the slab's top,
// stakes outside it at the ends and every FORMS.stakeEveryM between.
export function makeForms(job) {
  const F = CC.FORMS, C = job.layout.corners, runs = [];
  for (let k = 0; k < C.length; k++) {
    const a = C[k], b = C[(k + 1) % C.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let nx = uz, nz = -ux;
    if (inPoly(C, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
    const e = Math.min(F.stakeEndM, L / 3), n = Math.max(2, Math.ceil((L - 2 * e) / F.stakeEveryM - 1e-9) + 1);
    const stakes = Array.from({ length: n }, (_, q) => r6(e + ((L - 2 * e) * q) / (n - 1)));
    runs.push({ a: [a[0], a[1]], b: [b[0], b[1]], len: r6(L), out: [r6(nx), r6(nz)], boards: Math.ceil((L + 2 * F.boardT) / F.boardM - 1e-9), set: 0, stakes, driven: stakes.map(() => 0), bow: 0, leak: null });
  }
  return { runs, topY: job.topY };
}
const formsSet = (job) => !!job.forms && job.forms.runs.every((r) => r.set >= r.boards);
const stakesLeft = (job) => (job.forms ? job.forms.runs.reduce((n, r) => n + (r.set >= r.boards ? r.driven.filter((d) => !d).length : 0), 0) : 0);
function runNear(job, x, z, want) {
  let best = -1, bd = Infinity;
  job.forms.runs.forEach((r, k) => {
    if (want && !want(r)) return;
    const d = segDist(r.a, r.b, x, z);
    if (d < bd) { bd = d; best = k; }
  });
  return best;
}
function segDist(a, b, x, z) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, k = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k); }
const along = (r, x, z) => ((x - r.a[0]) * (r.b[0] - r.a[0]) + (z - r.a[1]) * (r.b[1] - r.a[1])) / r.len;
function stockTake(ctx, id, qty) {
  const st = ctx.get('stock');
  if (!st) return qty;
  const have = st.items[id] || 0, q = Math.min(qty, Math.floor(have + 1e-9));
  if (q > 0) call(ctx, 'stock.remove', { id, qty: q });
  return q;
}
// the next step after the forms: rebar (B6) and under-slab rough-in (services) when there is any, else the pour
function afterForms(job) {
  if (job.elements.some((e) => e.rebar.need > e.rebar.set)) return 'rebar';
  if ((job.roughIn.needed || []).some((id) => !(job.roughIn.done || []).includes(id))) return 'roughin';
  return 'pour';
}
function stepTo(ctx, job, step) { if (job.step === step) return; job.step = step; ctx.emit('foundation.step', { jobId: job.id, step }); }

// ------------------------------------------------------------------------------------------------ mixing (B4)
const MIXQ = { num: 'water', den: 'mix', k: CC.MIX.cementKgPerBag / CC.MIX.bagKg, bands: CC.MIX.bands };
export function mixView(b) {
  if (!b || BA.isEmpty(b)) return { bags: 0, waterL: 0, vol: 0, mixed: 0, wc: null, band: null, says: null };
  const q = BA.quality(b, MIXQ);
  return { bags: r6((b.parts.mix || 0) / CC.MIX.bagKg), waterL: r6(b.parts.water || 0), vol: b.vol, mixed: b.mixed, wc: q.ratio, band: q.band ? q.band.id : null, says: q.band ? q.band.says : 'Dry powder: run water in' };
}
const bandOf = (id) => CC.MIX.bands.find((b) => b.id === id) || CC.MIX.bands[2];
const abrams = (wc) => Math.min(1, Math.pow(CC.MIX.abramsB, CC.MIX.designWc - wc));

// ------------------------------------------------------------------------------------------------ the pour field (B4)
// The wet concrete is an earthwork-format grid inside the job (job.pour.grid): h is millimetres of concrete over the
// base, kept as a layer (l = h) whose surface code is its finish ('mud', 'screeded'); the form boards are WALL_BIT on
// the points just outside the line, so concrete does not run across them until a bowed board gapes (a leak).
const P = CC.FEEL_POUR;
function ensurePour(job) {
  if (job.pour && job.pour.grid) return job.pour;
  const g = EW.makeGrid(), C = job.layout.corners;
  EW.code(g, CC.FINISH.mud); EW.code(g, CC.FINISH.screeded);
  job.pour = { grid: g, m3: 0, wcM3: 0, weakM3: 0, leakM3: 0, cold: 0, firstT: null, lastT: null, screed: 0, needM3: pourNeed(job) };
  ringWalls(job);
  return job.pour;
}
function pourNeed(job) {
  let v = 0;
  for (const d of job.digs || []) v += Math.abs(polyArea(d.poly)) * Math.max(0, job.topY - baseYOf(job, d));
  return r6(v);
}
const insideJob = (job, x, z) => inPoly(job.layout.corners, x, z);
// set the form walls on the ring outside the line, open where a board gapes
function ringWalls(job) {
  const g = job.pour.grid, C = job.layout.corners, R = P.ringM;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of C) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const runs = job.forms ? job.forms.runs : [];
  for (let j = Math.floor((z0 - R) / 0.1); j <= Math.ceil((z1 + R) / 0.1); j++) for (let i = Math.floor((x0 - R) / 0.1); i <= Math.ceil((x1 + R) / 0.1); i++) {
    const x = i * 0.1, z = j * 0.1;
    if (inPoly(C, x, z)) continue;
    let k = -1, bd = R + 1e-9;
    runs.forEach((r, q) => { const d = segDist(r.a, r.b, x, z); if (d <= bd) { bd = d; k = q; } });
    if (k < 0) continue;
    const r = runs[k], t = along(r, x, z), open = r.leak && t >= r.leak[0] && t <= r.leak[1];
    const f = EW.fAt(g, i, j), want = open ? f & ~EW.WALL_BIT : f | EW.WALL_BIT;
    if (want !== f || !EW.point(g, i, j)) EW.setPoint(g, i, j, { f: want });
  }
}
// the concrete is a layer: keep l = h, a finish code wherever there is some, and loose so a board can move it
function syncPour(g) {
  const mud = EW.code(g, CC.FINISH.mud);
  for (const k in g.tiles) {
    const t = g.tiles[k];
    for (let n = 0; n < t.h.length; n++) {
      if (t.h[n] < 0) t.h[n] = 0;
      if (t.h[n] > 0) { t.l[n] = t.h[n]; if (t.s[n] === 0) t.s[n] = mud; t.f[n] |= EW.LOOSE_BIT; } else t.l[n] = 0;
    }
  }
}
// How far each run's boards bow under the concrete against them (a beam between the stakes and corners that hold
// it), and which stretch gapes and leaks. Returns the runs that leak.
function formsLoad(job) {
  const F = CC.FORMS, g = job.pour.grid, leaks = [];
  job.forms.runs.forEach((r, k) => {
    const sup = [0, ...r.stakes.filter((s, q) => r.driven[q]), r.len].sort((a, b) => a - b);
    let worst = 0, gap = null;
    for (let q = 0; q + 1 < sup.length; q++) {
      const s0 = sup[q], s1 = sup[q + 1], S = s1 - s0;
      if (S < 0.05) continue;
      let dmax = 0;
      // the concrete against this stretch: the deepest point within 15 cm inside the board
      for (let t = s0 + 0.05; t < s1; t += 0.1) for (const off of [0.05, 0.15]) {
        const x = r.a[0] + ((r.b[0] - r.a[0]) * t) / r.len - r.out[0] * off, z = r.a[1] + ((r.b[1] - r.a[1]) * t) / r.len - r.out[1] * off;
        dmax = Math.max(dmax, EW.reliefAt(g, x, z));
      }
      const w = 0.5 * F.wetKNm3 * 1000 * dmax * dmax, bow = (5 * w * S ** 4) / (384 * F.EI);
      if (bow > worst) { worst = bow; gap = [s0, s1]; }
    }
    r.bow = r6(worst);
    const was = r.leak;
    r.leak = worst > F.leakBowM && gap ? [r6(gap[0] + (gap[1] - gap[0]) * 0.3), r6(gap[1] - (gap[1] - gap[0]) * 0.3)] : null;
    if (r.leak) leaks.push(k);
    if (JSON.stringify(was) !== JSON.stringify(r.leak)) r.changed = 1;
  });
  if (job.forms.runs.some((r) => r.changed)) { job.forms.runs.forEach((r) => delete r.changed); ringWalls(job); }
  return leaks;
}
// concrete runs out through the gaps (a little more every time it is worked)
function leakFlow(job, leaks) {
  const g = job.pour.grid;
  let out = 0;
  for (const k of leaks) {
    const r = job.forms.runs[k], t = (r.leak[0] + r.leak[1]) / 2, x = r.a[0] + ((r.b[0] - r.a[0]) * t) / r.len, z = r.a[1] + ((r.b[1] - r.a[1]) * t) / r.len;
    const before = outsideM3(job);
    EW.settle(g, x, z, 0.9, 0.12, 25);
    out += outsideM3(job) - before;
  }
  return out;
}
function outsideM3(job) {
  const g = job.pour.grid;
  let v = 0;
  for (const [i, j, h] of EW.worked(g, 0.0005)) if (h > 0 && !insideJob(job, i * 0.1, j * 0.1)) v += h;
  return v * 0.01;
}
// the screed rides on the forms: the level in concrete millimetres over the base at a point (0 outside the forms)
const screedLevel = (ctx, job) => (x, z) => (insideJob(job, x, z) ? Math.max(0, job.topY - groundRead.surfaceY(ctx.state, x, z)) : 0);
// how much of the slab is screeded flat to the forms, and how much is a hollow
function screedRead(ctx, job) {
  const g = job.pour.grid, lv = screedLevel(ctx, job), sc = EW.code(g, CC.FINISH.screeded);
  let n = 0, flat = 0, hollow = 0, low = 0;
  for (const d of job.digs || []) for (const [i, j] of latticeIn(d.poly)) {
    const x = i * 0.1, z = j * 0.1, h = EW.hAt(g, i, j), L = lv(x, z);
    n++;
    if (h < L - P.hollowM) { low++; if (EW.sAt(g, i, j) !== 0) hollow++; }
    else if (Math.abs(h - L) <= P.screedTolM + 0.001 && EW.sAt(g, i, j) === sc) flat++;
  }
  return n ? { n, flat: r6(flat / n), hollow: r6(hollow / n), low: r6(low / n) } : { n: 0, flat: 0, hollow: 0, low: 0 };
}
function pourBand(job) { const p = job.pour; return p && p.m3 > 1e-6 ? bandOf(CC.MIX.bands.find((b) => p.wcM3 / p.m3 < b.upTo)?.id || 'soupy') : bandOf('good'); }
// the slab is screeded: it is placed. It starts to cure (on the set clock) and is finished by hand: float, trowel or
// broom, joints, anchor bolts. The foundation's members are finished in construction.
function finishPour(ctx, job) {
  const p = job.pour, wc = p.m3 > 0 ? p.wcM3 / p.m3 : CC.MIX.designWc;
  const cap = abrams(wc) * (1 - 0.3 * Math.min(1, p.weakM3 / Math.max(1e-6, p.m3))) * (1 - 0.02 * Math.min(5, p.cold));
  const vol = job.elements.reduce((a, e) => a + (e.volM3 || 0), 0);
  for (const e of job.elements) {
    e.pour.m3 = r6(vol > 0 ? (p.m3 * (e.volM3 || 0)) / vol : p.m3 / job.elements.length); e.pour.level = 1; e.pour.cold = p.cold;
    e.finish.screed = p.screed;
    e.cure = CU.newCure(p.firstT ?? ctx.t, { setH20: CC.SET_H20 * CC.WORKABLE_SCALE });
    e.cure.q = r6(Math.max(0.3, cap)); e.cure.cap = e.cure.q;
  }
  p.doneT = ctx.t; p.wc = r6(wc);
  startFinish(job);
  stepTo(ctx, job, 'finish');
  if (job.owner) {
    const ids = [...job.baseIds, ...job.elements.flatMap((e) => e.memberIds)];
    if (ids.length) call(ctx, 'construction.settle', { structId: job.owner.structId, memberIds: ids });
  }
  ctx.emit('foundation.poured', { jobId: job.id, m3: r6(p.m3), wc: p.wc, cap: r6(cap) });
  applyHolds(ctx, job);
}

// ------------------------------------------------------------------------------------------------ finishing (B5)
const FN = CC.FIN;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const anyCure = (job) => { const e = job.elements.find((q) => q.cure); return e ? e.cure : null; };
// where the working time of the surface stands: setX is hours in units of the initial set time at its temperature
export function windowOf(job) {
  const c = anyCure(job), x = c ? c.setX || 0 : 0, be = FN.bleedEnd * (FN.bleedScale[pourBand(job).id] ?? 1);
  const sheen = x >= be ? 0 : x >= be - FN.sheenFade ? (be - x) / FN.sheenFade : 1;
  const phase = x < be ? 'bleeding' : x < FN.trowelUntil ? 'ready' : 'late';
  const setH = c ? CU.setHoursAt(c.setH20 ?? CC.SET_H20, c.tc ?? 20) : 0;
  return { x: r6(x), bleedEnd: r6(be), sheen: r6(sheen), phase, bleedLeftH: r6(Math.max(0, be - x) * setH), leftH: r6(Math.max(0, FN.trowelUntil - x) * setH), set: !!(c && c.set) };
}
const boltPrimary = (job) => job.elements.find((e) => e.kind === 'slab') || job.elements[0];
// anchor bolts along the sill line of the outline: near each corner and at most every 1.8 m between, a hand inside
export function makeBolts(job) {
  const B = CC.BOLTS, C = job.layout.corners, pos = [];
  for (let k = 0; k < C.length; k++) {
    const a = C[k], b = C[(k + 1) % C.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let nx = uz, nz = -ux;
    if (!inPoly(C, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
    const e = Math.min(B.endM, L / 2), span = L - 2 * e, n = span < 0.05 ? 1 : Math.ceil(span / B.everyM - 1e-9) + 1;
    for (let q = 0; q < n; q++) {
      const t = n === 1 ? L / 2 : e + (span * q) / (n - 1), x = a[0] + ux * t + nx * B.insetM, z = a[1] + uz * t + nz * B.insetM;
      if (pos.some((o) => Math.hypot(o[0] - x, o[1] - z) < B.mergeM)) continue;
      pos.push([r6(x), r6(z), 0, 0]);
    }
  }
  return { pos };
}
// control joints: a span over 3 m is cut across at most every 2.5 m; each line is a row of cells the groover fills
export function makeJoints(job) {
  const C = job.layout.corners, a0 = C[0], a1 = C[1], L0 = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1, ux = (a1[0] - a0[0]) / L0, uz = (a1[1] - a0[1]) / L0, lines = [];
  for (const [dx, dz] of [[ux, uz], [-uz, ux]]) {                         // lines run along (dx, dz), spaced across it
    const nx = -dz, nz = dx, v = C.map((c) => c[0] * nx + c[1] * nz), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo;
    if (span <= FN.jointAboveM) continue;
    const n = Math.ceil(span / FN.jointEveryM - 1e-9) - 1;
    for (let q = 1; q <= n; q++) {
      const off = lo + (span * q) / (n + 1);
      let t0 = Infinity, t1 = -Infinity;
      const ts = C.map((c) => c[0] * dx + c[1] * dz), tlo = Math.min(...ts) - 0.1, thi = Math.max(...ts) + 0.1;
      for (let t = tlo; t <= thi; t += 0.05) if (inPoly(C, dx * t + nx * off, dz * t + nz * off)) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
      if (!(t1 - t0 > 0.3)) continue;
      const len = r6(t1 - t0);
      lines.push({ a: [r6(dx * t0 + nx * off), r6(dz * t0 + nz * off)], b: [r6(dx * t1 + nx * off), r6(dz * t1 + nz * off)], len, cells: Array.from({ length: Math.ceil(len / FN.jointCellM) }, () => 0) });
    }
  }
  return { lines };
}
function startFinish(job) {
  const f = { bolts: makeBolts(job), joints: makeJoints(job), edge: (job.forms ? job.forms.runs : []).map((r) => Array.from({ length: Math.max(1, Math.ceil(r.len / FN.edgeCellM)) }, () => 0)), early: 0, cov: { float: 0, trowel: 0, broom: 0, scaled: 0, worked: 0 }, result: null };
  job.finish = f;
  const e = boltPrimary(job);
  for (const q of job.elements) q.bolts = { need: q === e ? f.bolts.pos.length : 0, set: 0 };
}
// how much of the slab each finish covers, read from the pour grid's finish codes
function finishCover(job) {
  const g = job.pour && job.pour.grid, c = job.finish.cov;
  if (!g) return c;
  const name = (i, j) => g.codes[EW.sAt(g, i, j)];
  let n = 0, fl = 0, tr = 0, br = 0, sc = 0;
  for (const d of job.digs || []) for (const [i, j] of latticeIn(d.poly)) {
    const k = name(i, j);
    n++;
    if (k === 'floated') fl++; else if (k === 'troweled') tr++; else if (k === 'broomed') br++; else if (k === 'scaled') sc++;
  }
  if (!n) return c;
  c.float = r6((fl + tr + br + sc) / n); c.trowel = r6(tr / n); c.broom = r6(br / n); c.scaled = r6(sc / n); c.worked = r6((tr + br + sc) / n);
  for (const e of job.elements) { e.finish.float = c.float; e.finish.trowel = c.trowel; e.finish.broom = c.broom; }
  return c;
}
const lineDone = (l) => l.cells.filter(Boolean).length / l.cells.length >= FN.done;
const jointsDone = (job) => job.finish.joints.lines.every(lineDone);
const finishDone = (job) => { const c = job.finish.cov; return c.float >= FN.done && c.worked >= FN.done && jointsDone(job) && !boltsMissing(job); };
// the working time is over or the slab is all worked: it goes on to cure. Unfinished work is left as it is.
function endFinish(ctx, job, forced) {
  const f = job.finish, c = finishCover(job), scaled = c.scaled;
  for (const e of job.elements) if (e.cure) { e.cure.q = r6(e.cure.q * (1 - FN.scaledLoss * Math.min(1, scaled / Math.max(0.05, c.worked)) * (c.worked > 0 ? 1 : 0))); }
  f.result = { forced: !!forced, scaled: c.scaled, worked: c.worked, unjointed: f.joints.lines.filter((l) => !lineDone(l)).length, unfloated: r6(1 - c.float) };
  if (job.pour) job.pour.grid = null;
  stepTo(ctx, job, 'cure');
  ctx.emit('foundation.finished', { jobId: job.id, ...f.result });
  applyHolds(ctx, job);
}
const unstripped = (job) => (job.forms ? job.forms.runs.reduce((a, r) => a + Math.max(0, r.set - (r.stripped || 0)), 0) : 0);
const cutFrac = (l) => l.cells.filter(Boolean).length / l.cells.length;
const toolMissing = (ctx, id, say) => { const st = ctx.get('stock'); return st && st.tools && !st.tools.includes(id) ? say : null; };

// ------------------------------------------------------------------------------------------------ piers and stem walls (B-1)
// A pier is an element with a hole: bored to the frost line with the post-hole digger (foundation.bore: a bite of
// earth from up to `gesture` holes per twist and lift, the plug dropped beside the hole as real earth), a tube form
// dropped in (foundation.setTube) and plumbed (foundation.plumb: its top pushed until the bubble centres), filled from
// the barrow (foundation.fill), rodded (foundation.rod: the trapped air out, the level drops, top it up) and a post
// bracket pushed into the wet top (foundation.setBracket). A stem wall's footing and wall are elements with a run: the
// trench is dug to the string line by the slab's dig path (digs, foundation.check, foundation.trim), the footing poured
// into it (foundation.fill in step 'footing'), wall panels set in pairs (foundation.setPanel, once the footing is a
// tenth strength) and tied through (foundation.tie), the wall poured and rodded, anchor bolts set in its wet top
// (foundation.setBolt), the panels stripped at a fifth strength (foundation.strip). The timber on the piers (beams) is
// set on the brackets once they can carry it (foundation.setBeam: construction.install from the stacks).
const holesOf = (job) => job.elements.filter((e) => e.hole);
const runsOf = (job, kind) => job.elements.filter((e) => e.run && e.kind === kind);
const depthOf = (h) => r6(h.gy - h.botY);
const holeDug = (e) => e.hole.dug >= depthOf(e.hole) - 1e-6;
const tubeOk = (e) => !!(e.hole.tube && e.hole.plumb);
const wallFormed = (e) => e.run.panels >= e.run.panelsNeed && e.run.ties.every(Boolean);
const tiltOf = (h) => Math.hypot(h.tilt[0], h.tilt[1]);
const centreOf = (job) => { const C = job.layout.corners; return C.length ? [C.reduce((a, c) => a + c[0], 0) / C.length, C.reduce((a, c) => a + c[1], 0) / C.length] : [job.x, job.z]; };
const runPt = (r, t) => [r.a[0] + ((r.b[0] - r.a[0]) * t) / (r.len || 1), r.a[1] + ((r.b[1] - r.a[1]) * t) / (r.len || 1)];
const areaOf = (e) => (e.hole ? Math.PI * (e.hole.d / 2) ** 2 : e.run.len * e.run.w);
// what to work next after the dig: the slab's base, a stem wall's footing, a pier job's tube forms
const afterDig = (job) => (job.type === 'slab' ? 'base' : job.type === 'stemwall' ? 'footing' : 'forms');
function hardFormsDone(job) { return holesOf(job).every(tubeOk) && runsOf(job, 'wall').every(wallFormed); }
// the excavation is done: the trench is down to the line (read from the ground) and every hole is bored
function digAdvance(ctx, job, frac) {
  if (job.step !== 'excavate' || frac < CC.DIG.done || !holesOf(job).every(holeDug)) return false;
  finishSite(ctx, job);
  stepTo(ctx, job, afterDig(job));
  if (job.step === 'forms' && hardFormsDone(job)) enterPour(ctx, job);
  return true;
}
// anchor bolts along a stem wall's top (its sill line): within 30 cm of each end and at most 1.8 m apart
export function makeWallBolts(job) {
  const W = CC.WALL, pos = [];
  for (const e of runsOf(job, 'wall')) {
    const r = e.run, span = Math.max(0, r.len - 2 * W.boltEndM), n = span < 0.05 ? 1 : Math.ceil(span / W.boltEveryM - 1e-9) + 1;
    for (let q = 0; q < n; q++) {
      const t = n === 1 ? r.len / 2 : W.boltEndM + (span * q) / (n - 1), [x, z] = runPt(r, t);
      if (pos.some((o) => Math.hypot(o[0] - x, o[1] - z) < CC.BOLTS.mergeM)) continue;
      pos.push([r6(x), r6(z), 0, 0, e.id]);
    }
  }
  return { pos };
}
function enterPour(ctx, job) {
  if (job.type === 'stemwall' && !job.finish) job.finish = { bolts: makeWallBolts(job), joints: { lines: [] }, edge: [], early: 0, cov: { float: 0, trowel: 0, broom: 0, scaled: 0, worked: 0 }, result: null };
  stepTo(ctx, job, 'pour');
}
// the nearest of a list of elements to (x, z): a hole by its centre, a run by its line. [element, distance]
function nearestEl(list, x, z) {
  let best = null, bd = Infinity;
  for (const e of list) { const d = e.hole ? Math.hypot(e.hole.x - x, e.hole.z - z) : segDist(e.run.a, e.run.b, x, z); if (d < bd) { bd = d; best = e; } }
  return [best, bd];
}
const byNear = (list, x, z) => list.map((e) => [e, e.hole ? Math.hypot(e.hole.x - x, e.hole.z - z) : segDist(e.run.a, e.run.b, x, z)]).sort((a, b) => a[1] - b[1]);
const partOf = (e) => e.hole || e.run;
// an element's concrete is all in: full to the top with the air rodded out. It cures from its first concrete, its
// members are finished in construction, and the step moves on when the last one of the step is in.
function checkFull(ctx, job, e) {
  const q = partOf(e), R = CC.ROD;
  if (q.full || q.m3 + 1e-9 < q.need * (1 - R.fullTol) - q.air || q.air > q.need * R.doneFrac + 1e-9) return false;
  q.full = 1;
  const wc = q.m3 > 0 ? q.wcM3 / q.m3 : CC.MIX.designWc, cap = abrams(wc) * (1 - 0.3 * Math.min(1, q.weakM3 / Math.max(1e-6, q.m3)));
  e.pour.m3 = r6(q.m3); e.pour.level = 1;
  if (!e.cure) e.cure = CU.newCure(q.firstT ?? ctx.t, { setH20: CC.SET_H20 * CC.WORKABLE_SCALE });
  e.cure.q = r6(Math.max(0.3, cap)); e.cure.cap = Math.min(e.cure.cap, e.cure.q);
  if (job.owner && e.memberIds.length) call(ctx, 'construction.settle', { structId: job.owner.structId, memberIds: e.memberIds });
  ctx.emit('foundation.placed', { jobId: job.id, elementId: e.id, kind: e.kind, m3: r6(q.m3) });
  if (job.step === 'footing' && runsOf(job, 'strip').every((s) => s.run.full)) stepTo(ctx, job, 'forms');
  else if (job.step === 'pour' && poured(job)) { stepTo(ctx, job, 'cure'); ctx.emit('foundation.poured', { jobId: job.id, m3: r6(job.elements.reduce((a, x) => a + (partOf(x) ? partOf(x).m3 : 0), 0)) }); }
  applyHolds(ctx, job);
  return true;
}
const wetOf = (e) => !!e.cure && (e.cure.setX || 0) < CC.FIN.boltFree;

function fillCmd(ctx, p = {}) {
  const s = ensure(ctx), job = jobOf(s, p), M = CC.MIX;
  if (!job) return fail('no such job');
  if (!['footing', 'pour'].includes(job.step)) return fail(['layout', 'excavate'].includes(job.step) ? 'Not ready to pour: ' + (CC.STEP_SAYS[job.step] || job.step) : job.step === 'forms' ? (job.type === 'piers' ? CC.PIER_SAYS.tube : 'Set and tie the wall forms first') : 'Poured');
  const b = s.carry;
  if (!b || !(b.vol > 1e-6)) return fail('The barrow is empty: mix a batch first');
  const q = BA.quality(b, MIXQ);
  if (!q.band) return fail('That is dry powder: run water in and hoe it through');
  if (b.mixed < M.tipMixed) return fail('Hoe it through first: there is dry powder in the corners');
  if (!num(p.x) || !num(p.z)) return fail('Where?');
  const want = job.step === 'footing' ? runsOf(job, 'strip') : [...runsOf(job, 'wall'), ...holesOf(job)];
  const open = want.filter((e) => !partOf(e).full);
  const [e, d] = nearestEl(open, p.x, p.z);
  if (!e || d > (e.hole ? 0.8 : 1.0)) return fail(job.step === 'footing' ? 'Tip it into the trench' : e && e.hole ? 'Tip it into a tube form' : 'Tip it into the forms');
  const h = partOf(e), R = CC.ROD, room = h.need - h.m3 - h.air;
  if (room <= h.need * R.fullTol + 1e-9) {
    if (checkFull(ctx, job, e)) return { ok: true, elementId: e.id, kind: e.kind, m3: 0, placed: h.m3, need: h.need, level: 1, air: h.air, full: true, step: job.step, left: want.filter((x) => !partOf(x).full).length };
    return fail(h.air > h.need * R.doneFrac ? 'Full to the top: rod it to let the air out, then top it up' : 'That one is full');
  }
  const t0 = b.t0, mixed = b.mixed;
  const dq = BA.discharge(b, Math.min(b.vol, room, num(p.m3) && p.m3 > 0 ? p.m3 : Infinity)), put = dq.m3;
  h.m3 = r6(h.m3 + put); h.air = r6(h.air + (e.kind === 'strip' ? 0 : R.airFrac * put));
  h.wcM3 = r6(h.wcM3 + q.ratio * put); h.weakM3 = r6(h.weakM3 + (1 - mixed) * put);
  if (h.firstT === null || h.firstT === undefined) h.firstT = t0 ?? ctx.t;
  // the working time runs from the first concrete in: brackets and bolts go in while it is wet
  if (!e.cure) e.cure = CU.newCure(h.firstT, { setH20: CC.SET_H20 * CC.WORKABLE_SCALE });
  if (s.carry && !(s.carry.vol > 1e-9)) s.carry = null;
  const full = checkFull(ctx, job, e), lv = Math.min(1, (h.m3 + h.air) / h.need);
  return { ok: true, elementId: e.id, kind: e.kind, m3: r6(put), placed: h.m3, need: h.need, level: r6(lv), air: h.air, full: !!h.full, rod: !h.full && lv >= 1 - R.fullTol, band: q.band.id, step: job.step, left: want.filter((x) => !partOf(x).full).length };
}

// Anchor bolts in a stem wall's wet top: the nearest unset marks, n of them, on runs that are full. Once a run has
// set, one at a time, drilled and epoxied.
function wallBolt(ctx, job, p) {
  const B = CC.BOLTS;
  if (!job.finish || !['pour', 'cure', 'strip'].includes(job.step)) return fail('Pour the wall first: the bolts go into its wet top');
  const pos = job.finish.bolts.pos, runOf = (b) => job.elements.find((e) => e.id === b[4]);
  const left = pos.map((b, k) => [b, k]).filter(([b]) => !b[2]);
  if (!left.length) return { ok: true, n: 0, left: 0 };
  const near = num(p.x) && num(p.z) ? left.map(([b, k]) => [Math.hypot(b[0] - p.x, b[1] - p.z), k]).sort((a, c) => a[0] - c[0]) : left.map(([, k]) => [0, k]);
  if (num(p.x) && near[0][0] > B.reachM * 4) return fail('Aim at a glowing bolt mark along the top of the wall');
  const first = runOf(pos[near[0][1]]);
  if (!first || !first.run.full) return fail('Fill and rod this run of the wall first: the bolts go into its wet top');
  const retro = !wetOf(first);
  if (retro && !(first.cure.strength >= CC.CURE_GATES.walk)) return fail('Too soft to drill, too stiff to push: wait for it to firm up');
  const want = (retro ? near.slice(0, 1) : near.filter(([, k]) => { const e = runOf(pos[k]); return e && e.run.full && wetOf(e); }).slice(0, Math.max(1, Math.min(B.perCall, Math.round(+p.n || 1))))).map((q) => q[1]);
  const got = stockTake(ctx, B.item, want.length);
  if (!got) return fail('You need anchor bolts: ' + left.length + ' more');
  for (const k of want.slice(0, got)) { pos[k][2] = 1; pos[k][3] = retro ? 1 : 0; }
  const lf = pos.filter((b) => !b[2]).length;
  if (lf === 0) { applyHolds(ctx, job); ctx.emit('foundation.bolted', { jobId: job.id }); }
  return { ok: true, n: got, left: lf, retro };
}
// A stem wall's forms off at a fifth strength: n panel pairs from a run (named, or nearest); the panels go back to
// stock, the ties' ends are snapped off (they stay in the wall).
function wallStrip(ctx, job, p) {
  const W = CC.WALL;
  if (!poured(job) || !['cure', 'strip'].includes(job.step)) return fail('Nothing to strip yet');
  if (job.stripped) return fail('The forms are off');
  const g = gatesOf(job);
  if (!g.strip) return fail(CC.GATE_SAYS.strip + ' (' + Math.round(g.strength * 100) + '% of ' + Math.round(CC.CURE_GATES.strip * 100) + '%)');
  const walls = runsOf(job, 'wall').filter((e) => e.run.panels - (e.run.stripped || 0) > 0);
  const e = Number.isInteger(p.run) ? walls.find((q) => q.run.k === p.run) : num(p.x) && num(p.z) ? nearestEl(walls, p.x, p.z)[0] : walls[0];
  if (!e) return fail('That side is already stripped');
  const n = Math.max(1, Math.min(W.maxPerCall, Math.round(+p.n || 1), e.run.panels - (e.run.stripped || 0)));
  e.run.stripped = (e.run.stripped || 0) + n;
  call(ctx, 'stock.add', { id: W.panelItem, qty: 2 * n });
  const all = runsOf(job, 'wall').every((q) => (q.run.stripped || 0) >= q.run.panels);
  if (all) { job.stripped = 1; if (job.step === 'strip') stepTo(ctx, job, 'cure'); ctx.emit('foundation.stripped', { jobId: job.id }); }
  return { ok: true, run: e.run.k, panels: 2 * n, runDone: e.run.stripped >= e.run.panels, all, left: runsOf(job, 'wall').reduce((a, q) => a + q.run.panels - (q.run.stripped || 0), 0) };
}

const HARD = {
  // The post-hole digger: one bite (a plug of earth twisted loose and lifted out) from the hole aimed at and the next
  // nearest ones, n in all; each plug is dropped beside its hole. { jobId, x, z, n? }
  'foundation.bore'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), P = CC.PIER;
    if (!job) return fail('no such job');
    if (job.step !== 'excavate') return fail(job.step === 'layout' ? CC.STEP_SAYS.layout : 'The holes are dug');
    const why = toolMissing(ctx, P.tool, 'You need a post-hole digger.');
    if (why) return fail(why);
    if (!num(p.x) || !num(p.z)) return fail('Where?');
    const left = byNear(holesOf(job).filter((e) => !holeDug(e)), p.x, p.z);
    if (!left.length) return { ok: true, n: 0, left: 0, bored: [] };
    if (left[0][1] > 0.8) return fail('Aim at a pier mark where the strings cross');
    const n = Math.max(1, Math.min(P.maxPerCall, Math.round(+p.n || 1))), [cx, cz] = centreOf(job), bored = [];
    for (const [e] of left.slice(0, n)) {
      const h = e.hole, dep = depthOf(h), bite = r6(Math.min(P.biteM, dep - h.dug));
      const r = call(ctx, 'ground.cut', { x: h.x, z: h.z, r: P.holeR, m3: r6(Math.PI * P.holeR * P.holeR * bite), maxDepth: dep + 0.1 });
      h.dug = r6(Math.min(dep, h.dug + bite));
      const m3 = r && r.ok ? r.m3 : 0;
      if (m3 > 1e-7) {
        let ux = h.x - cx, uz = h.z - cz; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
        call(ctx, 'ground.fill', { x: r6(h.x + ux * P.spoilOutM), z: r6(h.z + uz * P.spoilOutM), r: 0.3, m3 });
      }
      bored.push({ id: e.id, dug: h.dug, depth: dep, done: holeDug(e), m3: r6(m3) });
    }
    const nleft = holesOf(job).filter((e) => !holeDug(e)).length;
    let advanced = false;
    if (!nleft) advanced = digAdvance(ctx, job, digFrac(job));
    return { ok: true, n: bored.length, bored, left: nleft, advanced, step: job.step, frost: job.frost || null };
  },
  // A tube form dropped into each of up to n bored holes (nearest first), cut to length from a 12 ft tube (the offcut
  // does the next one). It leans until plumbed. { jobId, x, z, n? }
  'foundation.setTube'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), P = CC.PIER;
    if (!job) return fail('no such job');
    if (job.step !== 'forms') return fail(job.step === 'excavate' ? CC.PIER_SAYS.dig : job.step === 'footing' ? CC.STEP_SAYS.footing : 'The tubes are in');
    if (!num(p.x) || !num(p.z)) return fail('Where?');
    const left = byNear(holesOf(job).filter((e) => !e.hole.tube), p.x, p.z);
    if (!left.length) return { ok: true, set: [], left: 0 };
    if (left[0][1] > 0.8) return fail('Aim at a hole');
    const n = Math.max(1, Math.min(P.maxPerCall, Math.round(+p.n || 1))), set = [];
    for (const [e] of left.slice(0, n)) {
      const h = e.hole, L = h.tubeL;
      if ((job.tubeOff || 0) + 1e-6 < L) {
        const k = Math.ceil((L - (job.tubeOff || 0)) / P.tubeM - 1e-9), got = stockTake(ctx, P.tubeItem, k);
        if (got < k) { if (got) call(ctx, 'stock.add', { id: P.tubeItem, qty: got }); if (!set.length) return fail('You need tube forms (10 in x 12 ft): ' + Math.ceil(holesOf(job).filter((q) => !q.hole.tube).reduce((a, q) => a + q.hole.tubeL, 0) / P.tubeM - (job.tubeOff || 0) / P.tubeM - 1e-9) + ' more'); break; }
        job.tubeOff = r6((job.tubeOff || 0) + k * P.tubeM);
      }
      job.tubeOff = r6(job.tubeOff - L);
      h.tube = 1; if (tiltOf(h) <= P.plumbTolM) h.plumb = 1;
      set.push({ id: e.id, x: h.x, z: h.z, tilt: h.tilt.slice(), plumb: !!h.plumb });
    }
    return { ok: true, set, left: holesOf(job).filter((e) => !e.hole.tube).length, offcutM: job.tubeOff };
  },
  // Plumb a tube: its top pushed by (dx, dz) metres. Inside a centimetre the level's bubble centres and it is held
  // plumb, earth kicked in round it. { jobId, x, z | id, dx, dz }
  'foundation.plumb'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), P = CC.PIER;
    if (!job) return fail('no such job');
    if (job.step !== 'forms') return fail('Not setting tubes now');
    const list = holesOf(job).filter((e) => e.hole.tube && !e.hole.plumb);
    const e = p.id !== undefined ? list.find((q) => q.id === String(p.id)) : num(p.x) && num(p.z) ? nearestEl(list, p.x, p.z)[0] : list[0];
    if (!e) return { ok: true, plumb: true, left: 0 };
    if (!num(p.dx) || !num(p.dz)) return fail('Push the top of the tube');
    const L = Math.hypot(p.dx, p.dz), k = L > P.nudgeMaxM ? P.nudgeMaxM / L : 1, h = e.hole;
    h.tilt = [r6(h.tilt[0] + p.dx * k), r6(h.tilt[1] + p.dz * k)];
    if (tiltOf(h) <= P.snapM) { h.tilt = [0, 0]; h.plumb = 1; }
    const left = holesOf(job).filter((q) => !tubeOk(q)).length;
    if (job.step === 'forms' && hardFormsDone(job)) enterPour(ctx, job);
    return { ok: true, id: e.id, tilt: h.tilt.slice(), off: r6(tiltOf(h)), plumb: !!h.plumb, left, step: job.step };
  },
  'foundation.fill': fillCmd,
  // A stick worked up and down in the wet concrete of a pier or wall: the trapped air comes up, the level drops a
  // little. { jobId, x, z }
  'foundation.rod'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), R = CC.ROD;
    if (!job) return fail('no such job');
    if (job.step !== 'pour') return fail('Nothing wet to rod');
    if (!num(p.x) || !num(p.z)) return fail('Where?');
    const [e, d] = nearestEl([...runsOf(job, 'wall'), ...holesOf(job)].filter((q) => partOf(q).m3 > 0 && !partOf(q).full), p.x, p.z);
    if (!e || d > 0.8) return fail('Rod the wet concrete in a tube or the wall forms');
    const h = partOf(e), out = h.air * (1 - R.keep);
    h.air = r6(h.air - out); h.rods = (h.rods || 0) + 1;
    const full = checkFull(ctx, job, e);
    return { ok: true, elementId: e.id, dropM: r6(out / areaOf(e)), air: h.air, full: !!h.full, topUp: !h.full && h.air <= h.need * R.doneFrac, level: r6(Math.min(1, (h.m3 + h.air) / h.need)) };
  },
  // Post brackets pushed into the wet tops of full piers (the aimed one and the next nearest, n in all). Once the
  // concrete has set, one at a time, drilled and epoxied in. { jobId, x, z, n? }
  'foundation.setBracket'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), P = CC.PIER;
    if (!job) return fail('no such job');
    if (!['pour', 'cure'].includes(job.step)) return fail(job.step === 'done' ? 'Every bracket is in' : 'Fill the tubes first');
    if (!num(p.x) || !num(p.z)) return fail('Where?');
    const list = byNear(holesOf(job).filter((e) => e.hole.full && !e.hole.bracket), p.x, p.z);
    if (!list.length) return fail(holesOf(job).some((e) => !e.hole.full) ? 'Fill and rod the pier first: the bracket goes into its wet top' : 'Every bracket is in');
    if (list[0][1] > 0.8) return fail('Aim at the top of a full pier');
    const first = list[0][0], retro = !wetOf(first);
    if (retro && !(first.cure.strength >= CC.CURE_GATES.walk)) return fail('Too soft to drill, too stiff to push: wait for it to firm up');
    const want = retro ? [first] : list.filter(([e]) => wetOf(e)).slice(0, Math.max(1, Math.min(P.maxPerCall, Math.round(+p.n || 1)))).map(([e]) => e);
    const got = stockTake(ctx, P.bracketItem, want.length);
    if (!got) return fail('You need post brackets: ' + list.length + ' more');
    for (const e of want.slice(0, got)) e.hole.bracket = retro ? 2 : 1;
    const left = holesOf(job).filter((e) => !e.hole.bracket).length;
    if (!bracketsMissing(job)) { applyHolds(ctx, job); if (!left) ctx.emit('foundation.bracketed', { jobId: job.id }); }
    return { ok: true, n: got, ids: want.slice(0, got).map((e) => e.id), retro, left };
  },
  // Wall form panels set in pairs either side of the wall on a run (the one named, or nearest), n pairs. The footing
  // under them must be a tenth strength. { jobId, run? | x, z, n? }
  'foundation.setPanel'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), W = CC.WALL;
    if (!job) return fail('no such job');
    if (job.step !== 'forms' || job.type !== 'stemwall') return fail(job.step === 'footing' ? CC.STEP_SAYS.footing : 'Not setting wall forms now');
    const walls = runsOf(job, 'wall').filter((e) => e.run.panels < e.run.panelsNeed);
    const e = Number.isInteger(p.run) ? walls.find((q) => q.run.k === p.run) : num(p.x) && num(p.z) ? nearestEl(walls, p.x, p.z)[0] : walls[0];
    if (!e) return walls.length ? fail('no such run') : { ok: true, set: 0, left: 0 };
    const foot = runsOf(job, 'strip').find((q) => q.run.k === e.run.k);
    if (foot && !(foot.cure && foot.cure.strength >= CC.CURE_GATES.walk)) return fail(CC.WALL_SAYS.soft + ' (' + Math.round((foot.cure ? foot.cure.strength : 0) * 100) + '%)');
    const n = Math.max(1, Math.min(W.maxPerCall, Math.round(+p.n || 1), e.run.panelsNeed - e.run.panels));
    const st = ctx.get('stock'), have = st ? Math.floor(st.items[W.panelItem] || 0) : 2 * n, pairs = Math.min(n, Math.floor(have / 2));
    if (!pairs) return fail('You need wall form panels (4 x 8 ft, two a pair): ' + runsOf(job, 'wall').reduce((a, q) => a + 2 * (q.run.panelsNeed - q.run.panels), 0) + ' more');
    stockTake(ctx, W.panelItem, 2 * pairs);
    e.run.panels += pairs;
    return { ok: true, set: pairs, run: e.run.k, runDone: e.run.panels >= e.run.panelsNeed, left: runsOf(job, 'wall').reduce((a, q) => a + q.run.panelsNeed - q.run.panels, 0) };
  },
  // Snap ties through a run's panels: the column aimed at (all its rows) and the next ones along it, n columns.
  // { jobId, run? | x, z, col?, n? }
  'foundation.tie'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p), W = CC.WALL;
    if (!job) return fail('no such job');
    if (job.step !== 'forms' || job.type !== 'stemwall') return fail('Not setting wall forms now');
    const walls = runsOf(job, 'wall').filter((e) => e.run.ties.some((t) => !t));
    const e = Number.isInteger(p.run) ? walls.find((q) => q.run.k === p.run) : num(p.x) && num(p.z) ? nearestEl(walls, p.x, p.z)[0] : walls[0];
    if (!e) return { ok: true, tied: [], left: 0 };
    const r = e.run;
    if (r.panels < r.panelsNeed) return fail(CC.WALL_SAYS.panels);
    let first = Number.isInteger(p.col) ? p.col : -1;
    if (first < 0 && num(p.x) && num(p.z)) { const t = along({ a: r.a, b: r.b, len: r.len }, p.x, p.z); let bd = Infinity; r.tieAt.forEach((q, i) => { if (!r.ties[i] && Math.abs(q - t) < bd) { bd = Math.abs(q - t); first = i; } }); }
    if (first < 0) first = r.ties.indexOf(0);
    const order = [first];
    for (let d = 1; order.length < r.ties.length && d < r.ties.length; d++) { if (first + d < r.ties.length) order.push(first + d); if (first - d >= 0) order.push(first - d); }
    const want = order.filter((i) => !r.ties[i]).slice(0, Math.max(1, Math.min(W.maxPerCall, Math.round(+p.n || 1))));
    const st = ctx.get('stock'), have = st ? Math.floor(st.items[W.tieItem] || 0) : Infinity, cols = Math.min(want.length, Math.floor(have / r.tieRows));
    if (!cols) return fail('You need snap ties: ' + runsOf(job, 'wall').reduce((a, q) => a + q.run.ties.filter((t) => !t).length * q.run.tieRows, 0) + ' more');
    stockTake(ctx, W.tieItem, cols * r.tieRows);
    const tied = want.slice(0, cols);
    for (const i of tied) r.ties[i] = 1;
    if (job.step === 'forms' && hardFormsDone(job)) enterPour(ctx, job);
    return { ok: true, tied, run: r.k, rows: r.tieRows, left: runsOf(job, 'wall').reduce((a, q) => a + q.run.ties.filter((t) => !t).length, 0), step: job.step };
  },
  // The timber that sits on the piers (beams, posts) set on the brackets once the concrete can carry it: the nearest
  // n pieces, from the building's stacks. { jobId, x, z, n? }
  'foundation.setBeam'(ctx, p = {}) {
    const s = ensure(ctx), job = jobOf(s, p);
    if (!job || !job.owner) return fail('no such job');
    const cs = ctx.get('construction'), pr = cs && cs.progress[job.owner.structId];
    const left = (job.timber || []).filter((id) => pr && pr.members[id] && !pr.members[id].built);
    if (!left.length) return { ok: true, n: 0, left: 0 };
    if (!poured(job)) return fail('Pour the piers first');
    if (bracketsMissing(job)) return fail(CC.BRACKET_SAYS);
    if (!gatesOf(job).frame) return fail('The piers carry the beams at half strength (' + Math.round(jobStrength(job) * 100) + '%)');
    const mid = (id) => { const g = pr.members[id].geo; return g ? [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, g] : [job.x, job.z, null]; };
    const ord = left.map((id) => { const [mx, mz, g] = mid(id); return [id, num(p.x) && num(p.z) ? (g ? segDist(g.a, g.b, p.x, p.z) : Math.hypot(mx - p.x, mz - p.z)) : 0]; }).sort((a, b) => a[1] - b[1]);
    if (num(p.x) && ord[0][1] > 1.2) return fail('Aim along a row of brackets');
    const n = Math.max(1, Math.min(4, Math.round(+p.n || 1))), ids = ord.slice(0, n).map((q) => q[0]);
    const r = call(ctx, 'construction.install', { structId: job.owner.structId, memberIds: ids, from: 'stacks', auto: true });
    const done = r ? r.installed : [];
    if (!done.length) { const why = r && r.refused[0] ? r.refused[0].reason : 'cannot'; return fail(why === 'no material' ? 'The beam lumber is not on site: order the foundation stage\'s materials' : why); }
    return { ok: true, n: done.length, ids: done, left: left.length - done.length };
  },
};

// A building's poured foundation (foundation.setPlan, and foundation.followPlan from the building's members)
function planJob(ctx, p = {}) {
  if (p.structId === undefined || p.structId === null) return fail('no building');
  const s = ensure(ctx), cs = ctx.get('construction'), pr = cs && cs.progress ? cs.progress[p.structId] : null;
  const type = p.type || typeFromProgress(pr);
  if (!CC.POURED_TYPES.includes(type)) return fail('not a poured foundation');
  let elements, baseIds;
  if (Array.isArray(p.elements)) {
    if (!p.elements.every((e) => e && e.id !== undefined)) return fail('bad elements');
    elements = p.elements.map(newElement); baseIds = Array.isArray(p.baseIds) ? p.baseIds.map(String) : [];
  } else ({ elements, baseIds } = elementsFromProgress(pr, type));
  if (!Array.isArray(p.elements) && Array.isArray(p.baseIds)) baseIds = p.baseIds.map(String);
  if (!elements.length) return fail('nothing to pour');
  let job = jobOf(s, { structId: p.structId });
  if (!job) {
    const id = String(s.nextId++);
    job = s.jobs[id] = { id, owner: { structId: p.structId }, type, x: 0, z: 0, yaw: 0, topY: 0, step: 'layout',
      layout: { corners: [], closed: false, squareOk: false }, roughIn: { needed: [], done: [] }, elements: [], pour: null, held: null, baseIds: [] };
  }
  const old = new Map(job.elements.map((e) => [e.id, e]));
  for (const e of elements) { const o = old.get(e.id); if (o) { for (const k of KEEP) e[k] = o[k]; keepPart(e, o, 'hole', KEEP_HOLE); keepPart(e, o, 'run', KEEP_RUN); } }
  job.type = type; job.elements = elements; job.baseIds = baseIds;
  for (const k of ['x', 'z', 'yaw', 'topY']) if (num(p[k])) job[k] = p[k];
  // B2: where the corners go (world x, z) and what is dug to which level ({ poly, targetY } in world metres)
  if (p.corners !== undefined) {
    if (!(Array.isArray(p.corners) && p.corners.length >= 3 && p.corners.length <= 64 && p.corners.every(okPt))) return fail('bad corners');
    const was = job.layout.corners, same = was.length === p.corners.length && was.every((c, k) => Math.hypot(c[0] - p.corners[k][0], c[1] - p.corners[k][1]) < 0.05);
    if (!same) {
      job.layout = { corners: p.corners.map((c) => [r6(c[0]), r6(c[1]), 0]), closed: false, squareOk: false };
      if (job.step === 'excavate') job.step = 'layout';
    }
  }
  if (p.digs !== undefined) {
    if (!(Array.isArray(p.digs) && p.digs.length <= 64 && p.digs.every((d) => d && num(d.targetY) && Array.isArray(d.poly) && d.poly.length >= 3 && d.poly.length <= 256 && d.poly.every(okPt)))) return fail('bad digs');
    const old2 = job.digs || [];
    // a stem wall's trench keeps the depth its footing was given (see keepPart)
    const keptY = (k, y) => { const e = type === 'stemwall' && elements.find((q) => q.kind === 'strip' && q.run && q.run.k === k); return e ? e.run.botY : y; };
    p = { ...p, digs: p.digs.map((d, k) => ({ ...d, targetY: keptY(k, d.targetY) })) };
    job.digs = p.digs.map((d, k) => ({ poly: d.poly.map((q) => [r6(q[0]), r6(q[1])]), targetY: r6(d.targetY), ...(num(d.baseY) ? { baseY: r6(d.baseY) } : {}), frac: 0, rough: 0, ...(old2[k] && Math.abs(old2[k].targetY - d.targetY) < 1e-4 ? { frac: old2[k].frac, rough: old2[k].rough || 0 } : {}) }));
  }
  if (!job.digs) job.digs = [];
  if (Array.isArray(p.timber)) job.timber = p.timber.map(String);
  if (p.frost && num(p.frost.m)) job.frost = { m: p.frost.m, climate: String(p.frost.climate || '') };
  if (pr && !num(p.x)) { job.x = pr.x; job.z = pr.z; }
  applyHolds(ctx, job);
  return { ok: true, jobId: job.id, elements: elements.length };
}

export const foundationSystem = ({ cure = CC.CURE, every = CC.CURE_EVERY } = {}) => ({
  name: 'foundation',
  every,
  init: () => freshFoundation(),
  step(ctx) {
    const s = ctx.s;
    if (!s || !s.jobs) return;
    let env = null;
    for (const id in s.jobs) {
      const job = s.jobs[id];
      // a slab cures from its screeding (finish, cure, strip); piers and walls from their first concrete
      if (job.step === 'done' || !job.elements.some((e) => e.cure)) continue;
      env = env || envOf(ctx);
      const before = gatesOf(job), jenv = { ...env, wet: (job.wetUntil || 0) > ctx.t };   // a misting keeps the top wet
      let done = true;
      for (const e of job.elements) {
        if (!e.cure) { done = false; continue; }
        CU.stepCure(e.cure, ctx.dt / 3600, (ctx.lifeDt ?? ctx.dt) / 3600, jenv, cure);
        if (e.cure.eqH < CC.CURE_DONE_EQH) done = false;
      }
      const after = gatesOf(job);
      for (const g of CC.GATE_ORDER) if (after[g] && !before[g]) ctx.emit('foundation.gate', { jobId: job.id, gate: g });
      if (job.type !== 'slab') {
        if (job.step === 'cure' && job.type === 'stemwall' && after.strip && !job.stripped) stepTo(ctx, job, 'strip');
        else if ((job.step === 'cure' || job.step === 'strip') && done && !fixSay(job) && (job.type !== 'stemwall' || job.stripped)) { job.step = 'done'; ctx.emit('foundation.cured', { jobId: job.id }); }
      } else if (job.step === 'finish') { if (job.finish && windowOf(job).phase === 'late') endFinish(ctx, job, true); }
      else if (done && !boltsMissing(job)) { job.step = 'done'; ctx.emit('foundation.cured', { jobId: job.id }); }
      else if (job.step === 'cure' && after.strip && unstripped(job) > 0) stepTo(ctx, job, 'strip');
      applyHolds(ctx, job);
    }
  },
  commands: {
    ...HARD,
    // A building's poured foundation: { structId, type?, topY?, x?, z?, yaw?, elements? }. Without elements they are
    // read from the building's construction plan. Progress of elements with the same id is kept.
    'foundation.setPlan': (ctx, p = {}) => planJob(ctx, p),
    // construction.setPlan / construction.forget call this for every building (B-1): a building with a poured
    // foundation (slab, piers, stem wall) whose members carry their shape becomes a job here, its layout worked out
    // from them; a building gone, or no longer poured, loses its job. { structId, gone? }
    'foundation.followPlan'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, { structId: p.structId }), cs = ctx.get('construction'), pr = cs && cs.progress ? cs.progress[p.structId] : null;
      if (p.gone || !pr) { if (job) delete s.jobs[job.id]; return { ok: true, gone: true }; }
      const type = typeFromProgress(pr);
      if (!CC.POURED_TYPES.includes(type)) { if (job) { applyHolds(ctx, job, true); delete s.jobs[job.id]; } return { ok: true, job: null }; }
      const fr = frostOf(ctx.state), g = planGeometry(ctx.state, pr, type, fr.m);
      if (!g) { if (job) applyHolds(ctx, job); return { ok: true, jobId: job ? job.id : null }; }
      if (!job) {
        if (pr.done || (cs.options && cs.options.sandbox)) return { ok: true, job: null };
        // a building whose ground was already dug the old way (an older save) carries on the old way
        const ms = Object.values(pr.members), siteM = ms.filter((m) => m.kind === 'site');
        if (siteM.length ? siteM.every((m) => m.built) : ms.some((m) => m.stage === 'foundation' && m.built)) return { ok: true, job: null };
      }
      return planJob(ctx, { structId: p.structId, type, corners: g.corners, digs: g.digs, topY: g.topY, ...(g.elements ? { elements: g.elements } : {}), baseIds: g.baseIds, timber: g.timber, frost: fr });
    },
    // Drop a job (the building was removed, or its foundation changed to one that is not poured). Releases its holds.
    'foundation.forget'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      applyHolds(ctx, job, true);
      delete s.jobs[job.id];
      return { ok: true };
    },
    // Layout (B2): a corner stake driven and the string tied to it. When every corner is staked the loop is closed:
    // the strings go up on batter boards and digging can start. { jobId | structId, corner }
    'foundation.stake'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step !== 'layout') return fail('already laid out');
      const c = job.layout.corners[p.corner];
      if (!c) return fail('no such corner');
      if (c[2]) return { ok: true, already: true, closed: job.layout.closed };
      c[2] = 1;
      const closed = job.layout.corners.every((q) => q[2]);
      if (closed) { job.layout.closed = true; job.layout.squareOk = true; job.step = 'excavate'; ctx.emit('foundation.step', { jobId: job.id, step: job.step }); }
      return { ok: true, closed };
    },
    // How much of the dig is down to the line (read from the ground). At DIG.done the excavation is finished: the
    // building's site stage is done with it and the job moves on to its base. { jobId | structId }
    'foundation.check'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step === 'layout' && !job.layout.corners.length) job.step = 'excavate';
      // B3: the base, read from the ground (gravel, level under the slab, tamped twice); done, the forms come next
      if (job.step === 'base' && job.type === 'slab') {
        const b = baseRead(ctx.state, job, fineOf(ctx));
        for (const e of job.elements) { e.base.needM = r6(job.digs.length ? baseYOf(job, job.digs[0]) - job.digs[0].targetY : 0); e.base.frac = Math.min(b.level, b.gravel); e.base.compact = b.compact; }
        job.base = { level: b.level, gravel: b.gravel, compact: b.compact };
        let advanced = false;
        if (baseDone(b)) {
          advanced = true;
          if (job.owner && job.baseIds.length) call(ctx, 'construction.settle', { structId: job.owner.structId, memberIds: job.baseIds });
          job.forms = makeForms(job);
          stepTo(ctx, job, 'forms');
        }
        return { ok: true, step: job.step, level: b.level, gravel: b.gravel, compact: b.compact, advanced };
      }
      if (job.step === 'forms' && job.type !== 'slab') { if (hardFormsDone(job)) { enterPour(ctx, job); return { ok: true, step: job.step, advanced: true }; } return { ok: true, step: job.step }; }
      if (job.step === 'forms' && formsSet(job) && !stakesLeft(job)) { stepTo(ctx, job, afterForms(job)); return { ok: true, step: job.step, advanced: true }; }
      if (job.step !== 'excavate') return { ok: true, step: job.step, frac: digFrac(job) };
      const D = CC.DIG;
      let n = 0, high = 0, low = 0;
      for (const d of job.digs || []) {
        const r = groundRead.conform(ctx.state, { poly: d.poly }, d.targetY, D.tolUpM, D.tolDownM, D.cellM);
        d.frac = r.n ? r6(1 - r.high.length / r.n) : 1;
        d.rough = r.n ? r6(1 - r.high.filter((q) => q[2] > D.roughM).length / r.n) : 1;
        n += r.n; high += r.high.length; low += r.low.length;
      }
      const frac = n ? 1 - high / n : 1;
      for (const e of job.elements) e.dig.frac = r6(frac);
      const advanced = digAdvance(ctx, job, frac), hs = holesOf(job);
      return { ok: true, step: job.step, frac: r6(frac), rough: r6(digFrac(job, 'rough')), low: n ? r6(low / n) : 0, advanced, holes: hs.length, holesLeft: hs.filter((e) => !holeDug(e)).length };
    },
    // The flat of the shovel trims along a stroke down to the line (only once most of it is dug), and the earth it
    // takes is pushed out past the edge of the dig. { jobId | structId, x0, z0, x1, z1, w? }
    'foundation.trim'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), D = CC.DIG;
      if (!job) return fail('no such job');
      if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no stroke');
      if (job.step !== 'excavate') return fail('not digging');
      if (digFrac(job, 'rough') < D.trimFrom) return fail('Dig more of it first: trim when most of the dark amber is gone');
      const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
      if (L > D.maxStrokeM) return fail('too far in one stroke');
      const w = num(p.w) && p.w > 0 && p.w <= 1 ? p.w : D.bladeW, rect = strokeRect(p.x0, p.z0, p.x1, p.z1, w);
      let m3 = 0;
      for (const d of job.digs || []) {
        const poly = clipConvex(d.poly, rect);
        if (poly.length < 3) continue;
        const r = call(ctx, 'ground.trim', { region: { poly }, targetY: d.targetY });
        if (r && r.ok) m3 += r.m3;
      }
      if (m3 > 1e-7) {
        const [sx, sz] = spoilSpot(job, p.x0, p.z0, p.x1, p.z1, D.spoilOutM);
        call(ctx, 'ground.fill', { x: sx, z: sz, r: 0.3, m3 });
      }
      return { ok: true, m3: r6(m3) };
    },
    // ------------------------------------------------------------------------------------------ the base (B3)
    // The gravel truck tips a heap at (x, z): the building's gravel from its stacks (or the inventory's) is set out
    // as a landscape heap. { jobId | structId, x, z, m3? }
    'foundation.gravel'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), B = CC.BASE;
      if (!job) return fail('no such job');
      if (job.step !== 'base') return fail(job.step === 'excavate' || job.step === 'layout' ? 'Dig to the line first' : 'The base is in');
      if (!num(p.x) || !num(p.z)) return fail('Where?');
      const need = baseRead(ctx.state, job, null).needM3 * B.extra, got = job.gravelM3 || 0;
      if (got >= need - 1e-4) return fail('That is all the base needs: rake it level and tamp it');
      const want = r6(Math.min(num(p.m3) && p.m3 > 0 ? p.m3 : B.heapM3, need - got));
      if (job.owner) {
        const st = ctx.get('stock'), have = st ? st.items[B.item] || 0 : 0;
        if (have < want - 1e-6) {
          const d = call(ctx, 'construction.draw', { itemId: B.item, qty: r6(want - have), x: p.x, z: p.z, structId: job.owner.structId, stacksOnly: true });
          if (d && d.ok && d.qty > 0 && st) call(ctx, 'stock.add', { id: B.item, qty: d.qty });
        }
      }
      const r = call(ctx, 'landscape.deliver', { item: B.item, qty: want, x: p.x, z: p.z });
      if (!r || !r.ok) return fail('No gravel to tip: order the building\'s materials, or buy gravel in the Yard store');
      job.gravelM3 = r6(got + r.m3);
      return { ok: true, m3: r.m3, delivered: job.gravelM3, needM3: r6(need) };
    },
    // ------------------------------------------------------------------------------------------ forms (B3)
    // Set up to n boards on a run (the run named, or the nearest one with boards still to set), snapped to the string.
    // { jobId | structId, run? | x, z, n }
    'foundation.setForm'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), F = CC.FORMS;
      if (!job) return fail('no such job');
      if (job.step !== 'forms') return fail(job.step === 'base' ? 'The base goes in first: gravel, raked level, tamped twice' : 'Not setting forms now');
      const k = Number.isInteger(p.run) ? p.run : num(p.x) && num(p.z) ? runNear(job, p.x, p.z, (r) => r.set < r.boards) : job.forms.runs.findIndex((r) => r.set < r.boards);
      const r = job.forms.runs[k];
      if (!r) return fail('no such run');
      const n = Math.max(1, Math.min(4, Math.round(+p.n || 1), r.boards - r.set));
      if (n <= 0 || r.set >= r.boards) return { ok: true, set: 0, run: k, done: formsSet(job) };
      const got = stockTake(ctx, F.boardItem, n);
      if (!got) return fail('You need form boards (2 x 6 x 8 ft): ' + job.forms.runs.reduce((a, q) => a + q.boards - q.set, 0) + ' more');
      r.set += got;
      const done = formsSet(job);
      if (done && !stakesLeft(job)) stepTo(ctx, job, afterForms(job));
      return { ok: true, set: got, run: k, runDone: r.set >= r.boards, done, stakesLeft: stakesLeft(job) };
    },
    // Drive stakes on a run: the one named (or nearest x, z) and the next ones along it, n in all. Allowed while the
    // forms are set and during the pour (a bowing board staked stops its leak). { jobId, run | x, z, stake?, n }
    'foundation.stakeForm'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), F = CC.FORMS;
      if (!job) return fail('no such job');
      if (!job.forms || !['forms', 'rebar', 'roughin', 'pour'].includes(job.step)) return fail('Not setting forms now');
      const k = Number.isInteger(p.run) ? p.run : num(p.x) && num(p.z) ? runNear(job, p.x, p.z, (r) => r.set >= r.boards && r.driven.some((d) => !d)) : -1;
      const r = job.forms.runs[k];
      if (!r) return fail('no stake to drive there');
      if (r.set < r.boards) return fail('Set the boards on this side first');
      let first = Number.isInteger(p.stake) ? p.stake : -1;
      if (first < 0 && num(p.x) && num(p.z)) { const t = along(r, p.x, p.z); let bd = Infinity; r.stakes.forEach((q, i) => { if (!r.driven[i] && Math.abs(q - t) < bd) { bd = Math.abs(q - t); first = i; } }); }
      if (first < 0) first = r.driven.indexOf(0);
      if (first < 0 || first >= r.stakes.length) return { ok: true, driven: [], run: k };
      // the aimed stake, then outward along the run
      const order = [first];
      for (let d = 1; order.length < r.stakes.length; d++) { if (first + d < r.stakes.length) order.push(first + d); if (first - d >= 0) order.push(first - d); if (first + d >= r.stakes.length && first - d < 0) break; }
      const want = order.filter((i) => !r.driven[i]).slice(0, Math.max(1, Math.min(4, Math.round(+p.n || 1))));
      if (!want.length) return { ok: true, driven: [], run: k };
      const got = stockTake(ctx, F.stakeItem, want.length);
      if (!got) return fail('You need form stakes: ' + stakesLeft(job) + ' more');
      const driven = want.slice(0, got);
      for (const i of driven) r.driven[i] = 1;
      let leaks = [];
      if (job.pour && job.pour.grid) { leaks = formsLoad(job); }
      if (job.step === 'forms' && formsSet(job) && !stakesLeft(job)) stepTo(ctx, job, afterForms(job));
      return { ok: true, driven, run: k, stakesLeft: stakesLeft(job), leaking: leaks.length > 0 };
    },
    // ------------------------------------------------------------------------------------------ mixing (B4)
    // The barrow: slash bags open over it, run water in, hoe it through. { bags?, waterL?, work? (metres of hoe),
    // jobId? (the building whose bags are drawn) }. Returns the mix as it is now (mixView).
    'foundation.mix'(ctx, p = {}) {
      const s = ensure(ctx), M = CC.MIX, job = jobOf(s, p);
      if (p.vessel && p.vessel !== 'barrow') return fail('only the barrow mixes for now');
      const st = ctx.get('stock');
      if (st && !st.tools.includes('wheelbarrow')) return fail('You need a wheelbarrow to mix in');
      if (!s.carry || !s.carry.parts) s.carry = BA.newBatch({ capM3: M.barrowBags * M.bagM3 });
      const b = s.carry, out = { ok: true };
      if (+p.bags > 0) {
        const roomBags = Math.floor((BA.room(b) / M.bagM3) * 1000 + 1e-6) / 1000;
        if (roomBags < 0.05) return { ...fail('The barrow holds ' + M.barrowBags + ' bags: mix these and tip them first'), mix: mixView(b) };
        const n = Math.min(Math.max(1, Math.min(4, Math.round(+p.bags))), Math.ceil(roomBags - 1e-6));
        let kg = r6(Math.min(n, roomBags) * M.bagKg), drawn = 0;
        if (job && job.owner) { const d = call(ctx, 'construction.draw', { itemId: M.item, qty: kg, structId: job.owner.structId }); if (d && d.ok) drawn = d.qty; }
        else if (st) { const have = st.items[M.item] || 0, q = Math.min(kg, have); if (q > 0) { call(ctx, 'stock.remove', { id: M.item, qty: r6(q) }); drawn = q; } }
        else drawn = kg;
        if (!(drawn > 1e-6)) return { ...fail('No concrete mix: order the building\'s materials (it comes in 80 lb bags)'), mix: mixView(b) };
        BA.add(b, 'mix', r6(drawn), { m3Each: M.bagM3 / M.bagKg });
        out.bags = r6(drawn / M.bagKg);
      }
      if (+p.waterL > 0) {
        if (!(b.parts.mix > 0)) return { ...fail('Bags in first: water on its own is just a wet barrow'), mix: mixView(b) };
        BA.add(b, 'water', r6(Math.min(20, +p.waterL)), { clock: ctx.t });
      }
      if (+p.work > 0 && b.parts.mix > 0) {
        if (!(b.parts.water > 0)) out.dry = true;
        else BA.work(b, Math.min(5, +p.work), M.workPerBagM / M.bagM3);
      }
      out.mix = mixView(b);
      return out;
    },
    // Fill the barrow from a mixer's drum (B7 machines): { from: machineId, m3? }
    'foundation.take'(ctx, p = {}) {
      const s = ensure(ctx), M = CC.MIX, m = s.machines && s.machines[p.from];
      if (!m || !m.batch) return fail('no such mixer');
      if (!s.carry || !s.carry.parts) s.carry = BA.newBatch({ capM3: M.barrowBags * M.bagM3 });
      const q = BA.transfer(m.batch, s.carry, num(p.m3) && p.m3 > 0 ? p.m3 : Infinity);
      if (!(q > 0)) return fail(BA.room(s.carry) < 1e-6 ? 'The barrow is full' : 'The drum is empty');
      return { ok: true, m3: q, mix: mixView(s.carry) };
    },
    // ------------------------------------------------------------------------------------------ the pour (B4)
    // Tip the barrow into the forms at (x, z): a heap that slumps and spreads as wet as the mix is. { jobId, x, z, m3? }
    'foundation.tip'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), M = CC.MIX;
      if (!job) return fail('no such job');
      if (job.type !== 'slab') return fillCmd(ctx, p);
      if (job.step === 'forms' && formsSet(job)) stepTo(ctx, job, afterForms(job));
      if (job.step !== 'pour') return fail(['layout', 'excavate', 'base', 'forms'].includes(job.step) ? 'Not ready to pour: ' + (CC.STEP_SAYS[job.step] || job.step) : 'Poured');
      const b = s.carry;
      if (!b || !(b.vol > 1e-6)) return fail('The barrow is empty: mix a batch first');
      const q = BA.quality(b, MIXQ);
      if (!q.band) return fail('That is dry powder: run water in and hoe it through');
      if (b.mixed < M.tipMixed) return fail('Hoe it through first: there is dry powder in the corners');
      if (!num(p.x) || !num(p.z)) return fail('Where?');
      const C = job.layout.corners;
      let x = p.x, z = p.z;
      // tipped at the forms: the heap lands inside them (the barrow's lip rests on the board)
      const cx = C.reduce((a, c) => a + c[0], 0) / C.length, cz = C.reduce((a, c) => a + c[1], 0) / C.length;
      const edge = (xx, zz) => Math.min(...C.map((c, k) => segDist(c, C[(k + 1) % C.length], xx, zz)));
      if (!insideJob(job, x, z) && edge(x, z) > 0.6) return fail('Tip it into the forms');
      for (let k = 0; k < 40 && (!insideJob(job, x, z) || edge(x, z) < P.tipR * 0.8); k++) { x += (cx - x) * 0.08; z += (cz - z) * 0.08; }
      const pr = ensurePour(job), g = pr.grid, mixed = b.mixed, t0 = b.t0;
      const d = BA.discharge(b, num(p.m3) && p.m3 > 0 ? p.m3 : b.vol);
      const put = EW.fill(g, x, z, d.m3, { r: P.tipR, surface: CC.FINISH.mud, layer: true, spread: false });
      EW.settle(g, x, z, P.flowR, q.band.slope, P.flowIters);
      syncPour(g);
      // a batch placed against concrete that has already set makes a cold joint
      if (pr.lastT !== null && pr.lastT !== undefined && (ctx.t - pr.lastT) / 3600 > CU.setHoursAt(CC.SET_H20 * CC.WORKABLE_SCALE, envOf(ctx).airC)) pr.cold++;
      pr.m3 = r6(pr.m3 + put); pr.wcM3 = r6(pr.wcM3 + q.ratio * put); pr.weakM3 = r6(pr.weakM3 + (1 - mixed) * put);
      if (pr.firstT === null) pr.firstT = t0 ?? ctx.t;
      pr.lastT = ctx.t;
      const leaks = formsLoad(job), lost = leaks.length ? leakFlow(job, leaks) : 0;
      if (lost > 0) { pr.leakM3 = r6(pr.leakM3 + lost); syncPour(g); }
      if (s.carry && !(s.carry.vol > 1e-9)) s.carry = null;
      return { ok: true, m3: r6(put), band: q.band.id, slump: q.band.slope, placed: pr.m3, needM3: pr.needM3, leaking: leaks, leakM3: r6(lost), at: [r6(x), r6(z)] };
    },
    // A rake (come-along) pulled through the wet concrete: it evens it out, into empty corners too. { jobId, x, z, r? }
    'foundation.rake'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step !== 'pour' || !job.pour || !job.pour.grid) return fail('Nothing wet to rake');
      if (!num(p.x) || !num(p.z)) return fail('Where?');
      const g = job.pour.grid, r = Math.min(0.6, num(p.r) && p.r > 0 ? p.r : P.rakeR), band = pourBand(job);
      // the tines reach into the empty corners of the forms: they become part of the pour
      EW.paint(g, p.x, p.z, r, { surface: CC.FINISH.mud, setF: EW.LOOSE_BIT, ok: (q, i, j) => q.s === EW.UNTOUCHED && insideJob(job, i * 0.1, j * 0.1) });
      const moved = EW.relax(g, p.x, p.z, r, band.rakeK);
      syncPour(g);
      const leaks = formsLoad(job), lost = leaks.length ? leakFlow(job, leaks) : 0;
      if (lost > 0) { job.pour.leakM3 = r6(job.pour.leakM3 + lost); syncPour(g); }
      return { ok: true, m3: r6(moved), leaking: leaks, leakM3: r6(lost) };
    },
    // The screed board laid across the forms and drawn along them from (x0, z0) to (x1, z1): it rides on the boards
    // at the slab's top, cuts what stands above, fills hollows from the ridge of concrete it rolls ahead of itself, and
    // leaves the surface flat and wet. { jobId, x0, z0, x1, z1 }
    'foundation.screed'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step !== 'pour' || !job.pour || !job.pour.grid) return fail('Nothing to screed');
      if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no stroke');
      const L0 = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
      if (L0 > P.maxStrokeM) return fail('too far in one stroke');
      if (L0 < 1e-4) return { ok: true, m3: 0 };
      const C = job.layout.corners, g = job.pour.grid, band = pourBand(job);
      // the board lies across the forms square to the side nearest the stroke's direction, and is drawn along it
      const sx = (p.x1 - p.x0) / L0, sz = (p.z1 - p.z0) / L0;
      let ux = 1, uz = 0, best = -1;
      for (let k = 0; k < C.length; k++) { const a = C[k], b = C[(k + 1) % C.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const d = Math.abs((b[0] - a[0]) / L * sx + (b[1] - a[1]) / L * sz); if (d > best) { best = d; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; } }
      if (ux * sx + uz * sz < 0) { ux = -ux; uz = -uz; }
      const nx = -uz, nz = ux;
      let lo = Infinity, hi = -Infinity;
      for (const c of C) { const v = c[0] * nx + c[1] * nz; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const mid = (lo + hi) / 2, w = hi - lo + 2 * P.screedOverM;
      const a0 = p.x0 * ux + p.z0 * uz, a1 = p.x1 * ux + p.z1 * uz, at = (a) => [a * ux + mid * nx, a * uz + mid * nz];
      const lvl = screedLevel(ctx, job), steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / P.screedStepM));
      let ridge = 0;
      for (let k = 0; k < steps; k++) {
        const [xa, za] = at(a0 + ((a1 - a0) * k) / steps), [xb, zb] = at(a0 + ((a1 - a0) * (k + 1)) / steps);
        ridge = EW.push(g, xa, za, xb, zb, lvl, { w, t: 0 }).m3;
      }
      syncPour(g);
      // what the board passed over is screeded where it closed up on the level (a dry mix tears instead)
      const sc = EW.code(g, CC.FINISH.screeded), mud = EW.code(g, CC.FINISH.mud);
      const amin = Math.min(a0, a1) - 0.05, amax = Math.max(a0, a1) + 0.05;
      let passed = 0, torn = 0;
      for (const [i, j] of latticeIn(C)) {
        const x = i * 0.1, z = j * 0.1, a = x * ux + z * uz;
        if (a < amin || a > amax) continue;
        const h = EW.hAt(g, i, j), L = lvl(x, z);
        if (EW.sAt(g, i, j) === 0) continue;
        passed++;
        const flat = Math.abs(h - L) <= P.screedTolM + 0.001;
        if (flat && band.screeds) EW.setPoint(g, i, j, { s: sc });
        else { EW.setPoint(g, i, j, { s: mud }); if (flat) torn++; }
      }
      const leaks = formsLoad(job), lost = leaks.length ? leakFlow(job, leaks) : 0;
      if (lost > 0) { job.pour.leakM3 = r6(job.pour.leakM3 + lost); syncPour(g); }
      const rd = screedRead(ctx, job);
      job.pour.screed = rd.flat;
      for (const e of job.elements) e.finish.screed = rd.flat;
      const done = rd.flat >= P.screedDone;
      if (done) finishPour(ctx, job);
      return { ok: true, m3: r6(ridge), screed: rd.flat, hollow: rd.hollow, low: rd.low, torn: torn > passed * 0.3 ? band.says : null, done, leaking: leaks, board: { w: r6(w), mid: r6(mid), u: [r6(ux), r6(uz)] } };
    },
    // ------------------------------------------------------------------------------------------ finishing (B5)
    // A finishing tool worked over the wet slab at (x, z): float (the bull float, right after the screed: floated),
    // trowel or broom (once the bleed-water sheen is gone: troweled / broomed; before that the water is worked back in and
    // the skin scales), edge (the edger along a form). { jobId, x, z, r?, kind }
    'foundation.finishAt'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      const kind = p.kind;
      if (!FN.r[kind]) return fail('no such finishing tool');
      if (job.step === 'pour') return fail('Screed it off first');
      if (job.step !== 'finish' || !job.finish) return fail('The surface is past finishing');
      if (!num(p.x) || !num(p.z)) return fail('Where?');
      const why = toolMissing(ctx, FN.kit, 'You need the concrete finishing kit (bull float, edger, groover, trowel, broom).');
      if (why) return fail(why);
      const w = windowOf(job), f = job.finish, r = Math.min(1, num(p.r) && p.r > 0 ? p.r : FN.r[kind]);
      if (kind === 'edge') {
        if (!job.forms) return fail('No form to run the edger along');
        if (w.x >= FN.edgeUntil) return fail(CC.FINISH_SAYS.late);
        const k = runNear(job, p.x, p.z);
        if (k < 0 || segDist(job.forms.runs[k].a, job.forms.runs[k].b, p.x, p.z) > 0.7) return fail('Run the edger along a form: it rounds the edge');
        const run = job.forms.runs[k], cells = f.edge[k];
        let n = 0;
        for (let q = 0; q < cells.length; q++) {
          const t = Math.min(run.len, (q + 0.5) * FN.edgeCellM), cx = run.a[0] + ((run.b[0] - run.a[0]) * t) / run.len, cz = run.a[1] + ((run.b[1] - run.a[1]) * t) / run.len;
          if (!cells[q] && Math.hypot(cx - p.x, cz - p.z) <= r + FN.edgeCellM / 2) { cells[q] = 1; n++; }
        }
        const tot = f.edge.reduce((a, c) => a + c.length, 0), got = f.edge.reduce((a, c) => a + c.filter(Boolean).length, 0);
        return { ok: true, kind, n, run: k, edge: r6(got / tot), phase: w.phase };
      }
      if (kind === 'float' && w.x >= FN.floatUntil) return fail(CC.FINISH_SAYS.late);
      if ((kind === 'trowel' || kind === 'broom') && w.phase === 'late') return fail(CC.FINISH_SAYS.late);
      const g = job.pour && job.pour.grid;
      if (!g) return fail('Nothing wet to finish');
      const code = (nm) => EW.code(g, nm), FNS = CC.FINISH;
      const early = (kind === 'trowel' || kind === 'broom') && w.phase === 'bleeding';
      const put = kind === 'float' ? code(FNS.floated) : early ? code(FNS.scaled) : code(kind === 'trowel' ? FNS.troweled : FNS.broomed);
      const from = kind === 'float' ? [code(FNS.mud), code(FNS.screeded)] : [code(FNS.floated)];
      let n = 0, unfloated = 0, wet = 0;
      for (let j = Math.floor((p.z - r) / 0.1); j <= Math.ceil((p.z + r) / 0.1); j++) for (let i = Math.floor((p.x - r) / 0.1); i <= Math.ceil((p.x + r) / 0.1); i++) {
        if (Math.hypot(i * 0.1 - p.x, j * 0.1 - p.z) > r || !insideJob(job, i * 0.1, j * 0.1) || !(EW.hAt(g, i, j) > 0)) continue;
        wet++;
        const sc = EW.sAt(g, i, j);
        if (from.includes(sc)) { EW.setPoint(g, i, j, { s: put }); n++; } else if (kind !== 'float' && (sc === code(FNS.screeded) || sc === code(FNS.mud))) unfloated++;
      }
      if (early) f.early += n;
      const c = finishCover(job), done = finishDone(job);
      if (done) endFinish(ctx, job, false);
      return { ok: true, kind, n, wet, early, phase: w.phase, sheen: w.sheen, cov: { ...c }, done, unfloated: n === 0 && unfloated > 0 ? 'Bull float it first: the trowel and broom want a floated surface' : null };
    },
    // The groover along a straightedge: a control joint cut as deep as a quarter of the slab. Cuts the planned line
    // (spans over 3 m, at most every 2.5 m) it runs along. { jobId, x0, z0, x1, z1 }
    'foundation.joint'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step !== 'finish' || !job.finish) return fail('Joints are cut while the top is workable');
      if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no stroke');
      const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
      if (L > FN.maxStrokeM) return fail('too far in one stroke');
      const why = toolMissing(ctx, FN.kit, 'You need the concrete finishing kit (bull float, edger, groover, trowel, broom).');
      if (why) return fail(why);
      const lines = job.finish.joints.lines;
      if (!lines.length) return fail('This slab is small enough to need no joints');
      if (windowOf(job).x >= FN.jointUntil) return fail(CC.FINISH_SAYS.late);
      let n = 0, hit = -1;
      const steps = Math.max(1, Math.ceil(L / 0.05));
      for (let q = 0; q <= steps; q++) {
        const x = p.x0 + ((p.x1 - p.x0) * q) / steps, z = p.z0 + ((p.z1 - p.z0) * q) / steps;
        lines.forEach((l, k) => {
          if (segDist(l.a, l.b, x, z) > FN.jointReachM) return;
          const t = Math.max(0, Math.min(l.len, ((x - l.a[0]) * (l.b[0] - l.a[0]) + (z - l.a[1]) * (l.b[1] - l.a[1])) / l.len)), c = Math.min(l.cells.length - 1, Math.floor(t / FN.jointCellM));
          if (!l.cells[c]) { l.cells[c] = 1; n++; hit = k; }
        });
      }
      if (!n) return { ok: true, n: 0, line: -1, reason: 'Drag along a dashed joint line' };
      const done = finishDone(job);
      if (done) endFinish(ctx, job, false);
      return { ok: true, n, line: hit, cut: lines.map(cutFrac), lines: lines.length, done };
    },
    // Anchor bolts pushed into the wet slab at the marks along the sill line (the nearest unset ones to (x, z), n of
    // them). After initial set they are drilled and epoxied in instead (slower: one at a time). { jobId, x?, z?, n? }
    'foundation.setBolt'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), B = CC.BOLTS;
      if (!job) return fail('no such job');
      if (job.type === 'stemwall') return wallBolt(ctx, job, p);
      if (!job.finish || !['finish', 'cure', 'strip'].includes(job.step)) return fail(job.step === 'pour' ? 'Screed it off first' : 'No bolts to set');
      const pos = job.finish.bolts.pos, left = pos.map((b, k) => [b, k]).filter(([b]) => !b[2]);
      if (!left.length) return { ok: true, n: 0, left: 0 };
      const w = windowOf(job), retro = w.x >= FN.boltFree;
      if (retro && !gatesOf(job).walk) return fail('Too soft to drill, too stiff to push: wait for it to firm up');
      const near = num(p.x) && num(p.z) ? left.map(([b, k]) => [Math.hypot(b[0] - p.x, b[1] - p.z), k]).sort((a, c) => a[0] - c[0]) : left.map(([, k]) => [0, k]);
      if (near[0][0] > B.reachM * 4 && num(p.x)) return fail('Aim at a glowing bolt mark along the sill line');
      const want = near.slice(0, retro ? 1 : Math.max(1, Math.min(B.perCall, Math.round(+p.n || 1)))).map((q) => q[1]);
      const got = stockTake(ctx, B.item, want.length);
      if (!got) return fail('You need anchor bolts: ' + left.length + ' more');
      for (const k of want.slice(0, got)) { pos[k][2] = 1; pos[k][3] = retro ? 1 : 0; }
      const e = boltPrimary(job), setN = pos.filter((b) => b[2]).length;
      for (const q of job.elements) if (q === e) q.bolts.set = setN;
      const lf = pos.length - setN;
      let done = false;
      if (job.step === 'finish') { finishCover(job); done = finishDone(job); if (done) endFinish(ctx, job, false); }
      if (lf === 0) { applyHolds(ctx, job); ctx.emit('foundation.bolted', { jobId: job.id }); }
      return { ok: true, n: got, left: lf, retro, done };
    },
    // Finish now: stop working the top and let it cure (what is not done stays as it is). { jobId }
    'foundation.finish'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (job.step !== 'finish' || !job.finish) return fail('Not finishing');
      endFinish(ctx, job, true);
      return { ok: true, result: job.finish.result };
    },
    // A cover over the finished slab: plastic holds the moisture in, a blanket holds the heat in as well; null takes it
    // off. { jobId, kind: 'plastic' | 'blanket' | null }
    'foundation.cover'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (!poured(job) || !['cure', 'strip'].includes(job.step)) return fail(job.step === 'finish' ? 'Finish the top first: a cover marks wet concrete' : 'Nothing to cover');
      const kind = p.kind || null;
      if (kind !== null && !CC.COVERS[kind]) return fail('no such cover');
      if (kind) { const why = toolMissing(ctx, CC.COVERS[kind], kind === 'blanket' ? 'You need a curing blanket.' : 'You need polyethylene sheeting.'); if (why) return fail(why); }
      job.cover = kind;
      for (const e of job.elements) if (e.cure) e.cure.covered = kind;
      return { ok: true, cover: kind };
    },
    // The hose on a fine mist keeps the top wet for half an hour (it feeds the cure's drying term, and cools). Not in
    // freezing air. { jobId }
    'foundation.mist'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), M = CC.MIST;
      if (!job) return fail('no such job');
      if (!poured(job) || !['cure', 'strip'].includes(job.step)) return fail(job.step === 'finish' ? 'Finish the top first: water on wet concrete weakens it' : 'Nothing to mist');
      const why = toolMissing(ctx, M.tool, 'You need a garden hose.');
      if (why) return fail(why);
      if (envOf(ctx).airC < M.minAirC) return fail('Too cold to mist: the water would freeze on it. Cover it instead');
      if (job.cover === 'plastic') return fail('Under plastic it stays wet already');
      job.wetUntil = ctx.t + M.holdS;
      for (const e of job.elements) if (e.cure) e.cure.wet = true;
      return { ok: true, minutes: M.holdS / 60, until: job.wetUntil };
    },
    // Pull the forms once the concrete is a fifth strength: up to n boards of a side (the one named, or nearest
    // (x, z)); the first board off a side takes its stakes with it. Boards and stakes go back to stock. { jobId, run? | x, z, n }
    'foundation.strip'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), F = CC.FORMS;
      if (!job) return fail('no such job');
      if (job.type === 'stemwall') return wallStrip(ctx, job, p);
      if (!job.forms) return fail('No forms to strip');
      if (job.stripped) return fail('The forms are off');
      if (!poured(job) || !['cure', 'strip'].includes(job.step)) return fail(job.step === 'finish' ? 'Finish the top first: the forms stay on' : 'Nothing to strip yet');
      const g = gatesOf(job);
      if (!g.strip) return fail(CC.GATE_SAYS.strip + ' (' + Math.round(g.strength * 100) + '% of ' + Math.round(CC.CURE_GATES.strip * 100) + '%)');
      const runs = job.forms.runs, left = (r) => r.set - (r.stripped || 0) > 0;
      const k = Number.isInteger(p.run) ? p.run : num(p.x) && num(p.z) ? runNear(job, p.x, p.z, left) : runs.findIndex(left);
      const r = runs[k];
      if (!r || !left(r)) return fail('That side is already stripped');
      const n = Math.max(1, Math.min(4, Math.round(+p.n || 1), r.set - (r.stripped || 0)));
      r.stripped = (r.stripped || 0) + n;
      let stakes = 0;
      if (!r.pulled) { r.pulled = 1; stakes = r.driven.filter(Boolean).length; }
      if (n) call(ctx, 'stock.add', { id: F.boardItem, qty: n });
      if (stakes) call(ctx, 'stock.add', { id: F.stakeItem, qty: stakes });
      // a side whose edge was not run with the edger chips as the board comes off
      const ec = job.finish && job.finish.edge && job.finish.edge[k] ? job.finish.edge[k].filter(Boolean).length / job.finish.edge[k].length : 1, chipped = ec < 0.6;
      if (chipped && job.finish) job.finish.chips = (job.finish.chips || 0) + 1;
      const all = runs.every((q) => !left(q));
      if (all) { job.stripped = 1; if (job.step === 'strip') stepTo(ctx, job, 'cure'); ctx.emit('foundation.stripped', { jobId: job.id }); }
      return { ok: true, run: k, boards: n, stakes, chipped, runDone: !left(r), all, left: unstripped(job) };
    },
    // Sandbox and tests: every element is poured now (the foundation members are finished in construction) and
    // starts to cure from now; framing on it waits for the frame gate.
    'foundation.debugPour'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (STEPS.indexOf(job.step) >= STEPS.indexOf('finish')) return fail('already poured');
      for (const e of job.elements) {
        e.pour.m3 = e.volM3; e.pour.level = 1;
        e.cure = CU.newCure(ctx.t, { setH20: CC.SET_H20 * CC.WORKABLE_SCALE });
        const q = partOf(e);
        if (q) { q.m3 = q.need; q.air = 0; q.full = 1; if (e.hole) { e.hole.dug = depthOf(e.hole); e.hole.tube = e.hole.plumb = 1; e.hole.bracket = 1; e.hole.tilt = [0, 0]; } if (e.run && e.run.panelsNeed) { e.run.panels = e.run.panelsNeed; e.run.ties = e.run.ties.map(() => 1); } }
      }
      if (job.type === 'stemwall' && !job.finish) { job.finish = { bolts: makeWallBolts(job), joints: { lines: [] }, edge: [], early: 0, cov: { float: 0, trowel: 0, broom: 0, scaled: 0, worked: 0 }, result: null }; for (const b of job.finish.bolts.pos) b[2] = 1; job.stripped = 1; }
      job.step = 'cure';
      finishSite(ctx, job);
      if (job.owner) {
        const ids = [...job.baseIds, ...job.elements.flatMap((e) => e.memberIds)];
        if (ids.length) call(ctx, 'construction.settle', { structId: job.owner.structId, memberIds: ids });
      }
      applyHolds(ctx, job);
      return { ok: true, jobId: job.id };
    },
  },
});

// Reads for views and tools (any state, no ctx).
const F = (state) => (state && state.sys && state.sys.foundation) || freshFoundation();
export const foundationRead = {
  // the barrow's mix (B4): { bags, waterL, vol, mixed, wc, band, says }
  carry: (state) => mixView(F(state).carry),
  // B3: what the base needs and has, read from the ground
  base: (state, jobId) => { const j = F(state).jobs[jobId]; return j ? baseRead(state, j, state.sys.landscape && state.sys.landscape.grid) : null; },
  pourGrid: (state, jobId) => { const j = F(state).jobs[jobId]; return j && j.pour ? j.pour.grid : null; },
  screedLevelAt: (state, jobId, x, z) => { const j = F(state).jobs[jobId]; return j ? (inPoly(j.layout.corners, x, z) ? Math.max(0, j.topY - groundRead.surfaceY(state, x, z)) : 0) : 0; },
  inside: (state, jobId, x, z) => { const j = F(state).jobs[jobId]; return !!j && inPoly(j.layout.corners, x, z); },
  job: (state, jobId) => F(state).jobs[jobId] || null,
  jobFor: (state, structId) => jobOf(F(state), { structId }),
  gates: (state, jobId) => { const j = F(state).jobs[jobId]; return j ? gatesOf(j) : null; },
  cureOf: (state, jobId, elementId) => {
    const j = F(state).jobs[jobId];
    if (!j) return null;
    const e = elementId !== undefined ? j.elements.find((q) => q.id === String(elementId)) : j.elements.find((q) => q.cure && q.cure.strength === jobStrength(j));
    return e && e.cure ? { ...e.cure, workability: CU.workability(e.cure) } : null;
  },
  // B5: the finishing window and what is on the slab (for the view): { x, bleedEnd, sheen, phase, leftH, cover, wetUntil, bolts, joints, edge, cov, ... }
  finish: (state, jobId) => {
    const j = F(state).jobs[jobId];
    if (!j || !j.elements.some((e) => e.cure)) return null;
    const w = windowOf(j), f = j.finish, c = anyCure(j);
    return { ...w, cover: j.cover || null, wetUntil: j.wetUntil || 0, stripped: !!j.stripped, unstripped: unstripped(j), dry: c ? c.dry : 0, frost: c ? c.frost : 0, tc: c ? c.tc : null, strength: c ? c.strength : 0,
      bolts: f ? f.bolts.pos : [], joints: f ? f.joints.lines.map((l) => ({ a: l.a, b: l.b, len: l.len, cells: l.cells })) : [], edge: f ? f.edge : [], cov: f ? f.cov : null, early: f ? f.early : 0, result: f ? f.result : null, chips: f && f.chips || 0, boltsLeft: f ? f.bolts.pos.filter((b) => !b[2]).length : 0 };
  },
  // B-1: piers and walls for the view: holes, runs, bolts, the frost line, what is next
  hard: (state, jobId) => {
    const j = F(state).jobs[jobId];
    if (!j || j.type === 'slab') return null;
    const pr = j.owner && state.sys.construction && state.sys.construction.progress[j.owner.structId];
    const cureView = (e) => (e.cure ? { strength: e.cure.strength, wet: wetOf(e), setX: e.cure.setX || 0 } : null);
    return { type: j.type, step: j.step, frost: j.frost || frostOf(state), tubeOffM: j.tubeOff || 0,
      holes: holesOf(j).map((e) => ({ id: e.id, ...e.hole, depth: depthOf(e.hole), dugOk: holeDug(e), level: r6(Math.min(1, (e.hole.m3 + e.hole.air) / e.hole.need)), cure: cureView(e) })),
      footings: runsOf(j, 'strip').map((e) => ({ id: e.id, ...e.run, level: r6(Math.min(1, (e.run.m3 + e.run.air) / e.run.need)), cure: cureView(e) })),
      walls: runsOf(j, 'wall').map((e) => ({ id: e.id, ...e.run, level: r6(Math.min(1, (e.run.m3 + e.run.air) / e.run.need)), formed: wallFormed(e), cure: cureView(e) })),
      bolts: j.finish && j.type === 'stemwall' ? j.finish.bolts.pos : [], stripped: !!j.stripped,
      timberLeft: (j.timber || []).filter((id) => pr && pr.members[id] && !pr.members[id].built).length,
      timber: (j.timber || []).map((id) => pr && pr.members[id] ? { id, built: !!pr.members[id].built, geo: pr.members[id].geo || null } : null).filter(Boolean),
      brackets: bracketsMissing(j), poured: poured(j), gates: gatesOf(j) };
  },
  frost: (state) => frostOf(state),
  jobView: (state, jobId) => {
    const j = F(state).jobs[jobId];
    if (!j) return null;
    const g = gatesOf(j);
    return { id: j.id, type: j.type, step: j.step, held: j.held, corners: j.layout.corners.map((c) => [c[0], c[1], !!c[2]]), closed: j.layout.closed, dig: digFrac(j), rough: digFrac(j, 'rough'), trimFrom: CC.DIG.trimFrom, roughM: CC.DIG.roughM, strength: g.strength, gates: Object.fromEntries(CC.GATE_ORDER.map((k) => [k, g[k]])), elements: j.elements.map((e) => ({ id: e.id, kind: e.kind, volM3: e.volM3, poured: !!e.cure, strength: e.cure ? e.cure.strength : 0 })), cover: j.cover || null, stripped: !!j.stripped,
      base: j.base ? { ...j.base, gravelM3: j.gravelM3 || 0 } : { level: 0, gravel: 0, compact: 0, gravelM3: j.gravelM3 || 0 },
      forms: j.forms ? { boards: j.forms.runs.reduce((a, r) => a + r.boards, 0), set: j.forms.runs.reduce((a, r) => a + r.set, 0), stakes: j.forms.runs.reduce((a, r) => a + r.stakes.length, 0), driven: j.forms.runs.reduce((a, r) => a + r.driven.filter(Boolean).length, 0), leaking: j.forms.runs.some((r) => r.leak), bow: Math.max(0, ...j.forms.runs.map((r) => r.bow)) } : null,
      pour: j.pour ? { m3: j.pour.m3, needM3: j.pour.needM3, screed: j.pour.screed, leakM3: j.pour.leakM3, cold: j.pour.cold, band: pourBand(j).id, wc: j.pour.m3 > 0 ? r6(j.pour.wcM3 / j.pour.m3) : null } : null };
  },
};
