// Foundations as a process (ground-foundations design, part B). One job per building whose foundation is poured
// (slab, piers, stem wall) or free-standing (later slices), with elements that stand for the building's foundation
// members, the steps layout .. done, and concrete that cures on the sim clock and holds the stages built on it while
// it is green (construction.setHold).
//
// B1 is the skeleton: state, foundation.setPlan / forget, foundation.debugPour (sandbox: the pour happens now), the
// cure step and the gates. The hands-on steps (layout, dig, base, forms, rebar, pour, finish, strip) come in B2-B8.
//
// state sys.foundation = { v: 1, nextId, jobs: { [id]: job }, carry: null, machines: {} }
// job = { id, owner: { structId } | null, type, x, z, yaw, topY, step, layout, roughIn, elements: [element], pour,
//         held: reason | null, baseIds: [construction member ids of the gravel base] }
// element = { id, kind, memberIds, w, botY, topY, volM3, dig, base, forms, rebar, bolts, pour, finish, cure }
// events: 'foundation.gate' { jobId, gate } when a gate opens; 'foundation.cured' { jobId } when it is followed no more.
import * as CU from './core/cure.js';
import * as CC from './content/concrete.js';

const STEPS = ['layout', 'excavate', 'base', 'forms', 'rebar', 'roughin', 'pour', 'finish', 'cure', 'strip', 'done'];
const fail = (reason) => ({ ok: false, reason });
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r6 = (v) => Math.round(v * 1e6) / 1e6;

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
    return { id: j.id, type: j.type, step: j.step, held: j.held, strength: g.strength, gates: Object.fromEntries(CC.GATE_ORDER.map((k) => [k, g[k]])), elements: j.elements.map((e) => ({ id: e.id, kind: e.kind, volM3: e.volM3, poured: !!e.cure, strength: e.cure ? e.cure.strength : 0 })) };
  },
};
