// Foundations as a process (ground-foundations design, part B). One job per building whose foundation is poured
// (slab, piers, stem wall) or free-standing (later slices), with elements that stand for the building's foundation
// members, the steps layout .. done, and concrete that cures on the sim clock and holds the stages built on it while
// it is green (construction.setHold).
//
// B1 is the skeleton: state, foundation.setPlan / forget, foundation.debugPour (sandbox: the pour happens now), the
// cure step and the gates. B2 adds the layout and the dig: setPlan takes the corners and the dig regions from the
// page, foundation.stake closes the string lines, foundation.check reads the dig from the ground (and finishes the
// building's site stage when it is down to the line), foundation.trim is the flat of the shovel along a stroke.
// The other hands-on steps (base, forms, rebar, pour, finish, strip) come in B3-B8.
//
// state sys.foundation = { v: 1, nextId, jobs: { [id]: job }, carry: null, machines: {} }
// job = { id, owner: { structId } | null, type, x, z, yaw, topY, step, layout, digs: [{ poly, targetY, frac }], roughIn, elements: [element], pour,
//         held: reason | null, baseIds: [construction member ids of the gravel base] }
// element = { id, kind, memberIds, w, botY, topY, volM3, dig, base, forms, rebar, bolts, pour, finish, cure }
// events: 'foundation.gate' { jobId, gate } when a gate opens; 'foundation.cured' { jobId } when it is followed no more.
import * as CU from './core/cure.js';
import * as CC from './content/concrete.js';
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
  for (const k of ['outline', 'path', 'at']) if (e[k] !== undefined) el[k] = JSON.parse(JSON.stringify(e[k]));
  return el;
}
const KEEP = ['dig', 'base', 'forms', 'rebar', 'bolts', 'pour', 'finish', 'cure'];

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
const poured = (job) => job.elements.length > 0 && job.elements.every((e) => e.cure);
export function gatesOf(job, gates = CC.CURE_GATES) {
  const st = poured(job) ? jobStrength(job) : 0, out = { strength: st };
  for (const g in gates) out[g] = poured(job) && st >= gates[g];
  return out;
}
// what each held stage should say now: { stage: reason | null }
function wantHolds(job) {
  const out = {}, g = gatesOf(job);
  for (const h of CC.GATE_HOLDS) for (const st of h.stages) out[st] = poured(job) && job.step !== 'done' && !g[h.gate] ? CC.GATE_SAYS[h.gate] : out[st] || null;
  return out;
}
// make the construction holds match the cure (also puts them back if the building's plan was sent again)
function applyHolds(ctx, job, release = false) {
  if (!job.owner) return;
  const cs = ctx.get('construction'), pr = cs && cs.progress && cs.progress[job.owner.structId];
  if (!pr) return;
  const want = wantHolds(job), byReason = new Map();
  for (const st in want) {
    const r = release ? null : want[st], have = (pr.hold && pr.hold[st]) || null;
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
function digFrac(job) {
  const d = job.digs || [];
  if (!d.length) return 1;
  let a = 0, f = 0;
  for (const q of d) { const A = Math.abs(polyArea(q.poly)); a += A; f += A * (q.frac || 0); }
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
      if (job.step !== 'cure' && job.step !== 'strip') continue;
      env = env || envOf(ctx);
      const before = gatesOf(job);
      let done = true;
      for (const e of job.elements) {
        if (!e.cure) { done = false; continue; }
        CU.stepCure(e.cure, ctx.dt / 3600, (ctx.lifeDt ?? ctx.dt) / 3600, env, cure);
        if (e.cure.eqH < CC.CURE_DONE_EQH) done = false;
      }
      const after = gatesOf(job);
      for (const g of CC.GATE_ORDER) if (after[g] && !before[g]) ctx.emit('foundation.gate', { jobId: job.id, gate: g });
      if (done) { job.step = 'done'; ctx.emit('foundation.cured', { jobId: job.id }); }
      applyHolds(ctx, job);
    }
  },
  commands: {
    // A building's poured foundation: { structId, type?, topY?, x?, z?, yaw?, elements? }. Without elements they are
    // read from the building's construction plan. Progress of elements with the same id is kept.
    'foundation.setPlan'(ctx, p = {}) {
      if (p.structId === undefined || p.structId === null) return fail('no building');
      const s = ensure(ctx), cs = ctx.get('construction'), pr = cs && cs.progress ? cs.progress[p.structId] : null;
      const type = p.type || typeFromProgress(pr);
      if (!CC.POURED_TYPES.includes(type)) return fail('not a poured foundation');
      let elements, baseIds;
      if (Array.isArray(p.elements)) {
        if (!p.elements.every((e) => e && e.id !== undefined)) return fail('bad elements');
        elements = p.elements.map(newElement); baseIds = Array.isArray(p.baseIds) ? p.baseIds.map(String) : [];
      } else ({ elements, baseIds } = elementsFromProgress(pr, type));
      if (!elements.length) return fail('nothing to pour');
      let job = jobOf(s, { structId: p.structId });
      if (!job) {
        const id = String(s.nextId++);
        job = s.jobs[id] = { id, owner: { structId: p.structId }, type, x: 0, z: 0, yaw: 0, topY: 0, step: 'layout',
          layout: { corners: [], closed: false, squareOk: false }, roughIn: { needed: [], done: [] }, elements: [], pour: null, held: null, baseIds: [] };
      }
      const old = new Map(job.elements.map((e) => [e.id, e]));
      for (const e of elements) { const o = old.get(e.id); if (o) for (const k of KEEP) e[k] = o[k]; }
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
        job.digs = p.digs.map((d, k) => ({ poly: d.poly.map((q) => [r6(q[0]), r6(q[1])]), targetY: r6(d.targetY), frac: old2[k] && Math.abs(old2[k].targetY - d.targetY) < 1e-4 ? old2[k].frac : 0 }));
      }
      if (!job.digs) job.digs = [];
      if (pr && !num(p.x)) { job.x = pr.x; job.z = pr.z; }
      applyHolds(ctx, job);
      return { ok: true, jobId: job.id, elements: elements.length };
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
      if (job.step !== 'excavate') return { ok: true, step: job.step, frac: digFrac(job) };
      const D = CC.DIG;
      let n = 0, high = 0, low = 0;
      for (const d of job.digs || []) {
        const r = groundRead.conform(ctx.state, { poly: d.poly }, d.targetY, D.tolUpM, D.tolDownM, D.cellM);
        d.frac = r.n ? r6(1 - r.high.length / r.n) : 1;
        n += r.n; high += r.high.length; low += r.low.length;
      }
      const frac = n ? 1 - high / n : 1;
      for (const e of job.elements) e.dig.frac = r6(frac);
      let advanced = false;
      if (frac >= D.done) {
        job.step = 'base'; advanced = true;
        finishSite(ctx, job);
        ctx.emit('foundation.step', { jobId: job.id, step: job.step });
      }
      return { ok: true, step: job.step, frac: r6(frac), low: n ? r6(low / n) : 0, advanced };
    },
    // The flat of the shovel trims along a stroke down to the line (only once most of it is dug), and the earth it
    // takes is pushed out past the edge of the dig. { jobId | structId, x0, z0, x1, z1, w? }
    'foundation.trim'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p), D = CC.DIG;
      if (!job) return fail('no such job');
      if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no stroke');
      if (job.step !== 'excavate') return fail('not digging');
      if (digFrac(job) < D.trimFrom) return fail('Dig more of it first: trim when most of the amber is gone');
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
    // Sandbox and tests: every element is poured now (the foundation members are finished in construction) and
    // starts to cure from now; framing on it waits for the frame gate.
    'foundation.debugPour'(ctx, p = {}) {
      const s = ensure(ctx), job = jobOf(s, p);
      if (!job) return fail('no such job');
      if (STEPS.indexOf(job.step) >= STEPS.indexOf('cure')) return fail('already poured');
      for (const e of job.elements) {
        e.pour.m3 = e.volM3; e.pour.level = 1;
        e.cure = CU.newCure(ctx.t, { setH20: CC.SET_H20 * CC.WORKABLE_SCALE });
      }
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
  job: (state, jobId) => F(state).jobs[jobId] || null,
  jobFor: (state, structId) => jobOf(F(state), { structId }),
  gates: (state, jobId) => { const j = F(state).jobs[jobId]; return j ? gatesOf(j) : null; },
  cureOf: (state, jobId, elementId) => {
    const j = F(state).jobs[jobId];
    if (!j) return null;
    const e = elementId !== undefined ? j.elements.find((q) => q.id === String(elementId)) : j.elements.find((q) => q.cure && q.cure.strength === jobStrength(j));
    return e && e.cure ? { ...e.cure, workability: CU.workability(e.cure) } : null;
  },
  jobView: (state, jobId) => {
    const j = F(state).jobs[jobId];
    if (!j) return null;
    const g = gatesOf(j);
    return { id: j.id, type: j.type, step: j.step, held: j.held, corners: j.layout.corners.map((c) => [c[0], c[1], !!c[2]]), closed: j.layout.closed, dig: digFrac(j), trimFrom: CC.DIG.trimFrom, strength: g.strength, gates: Object.fromEntries(CC.GATE_ORDER.map((k) => [k, g[k]])), elements: j.elements.map((e) => ({ id: e.id, kind: e.kind, volM3: e.volM3, poured: !!e.cure, strength: e.cure ? e.cure.strength : 0 })) };
  },
};
