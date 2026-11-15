// The simulation core: one authoritative, serialisable world state advanced in fixed ticks.
//
// Rules that keep it deterministic (see ARCHITECTURE.md):
//   - state is plain JSON data; nothing else may hold simulation truth
//   - systems run in registration order, each on its own cadence, always with the same dt
//   - randomness only through ctx.rng (seeded streams stored in state)
//   - no wall clock, no frame time, no DOM, no three.js in here
//   - player actions enter as commands and are applied at the start of the next tick

import { TICK, START_T, dayFraction, dayIndex, calendarT, YEAR_DAYS_REAL } from './time.js';
import { stream } from './rng.js';

export const STATE_VERSION = 1;

export function createSim({ seed = 1, systems = [], record = false } = {}) {
  const sim = {
    state: { v: STATE_VERSION, seed: seed >>> 0, tick: 0, t: START_T, lifeT: START_T, yearDays: YEAR_DAYS_REAL, rng: {}, sys: {} },
    systems: [],
    handlers: new Map(),
    queue: [],              // commands waiting for the next tick
    recorded: record ? [] : null,
    listeners: [],
    acc: 0,                 // seconds owed to the simulation, below one tick
    ticksLastAdvance: 0,
  };
  const S = () => sim.state;

  sim.rng = (name) => stream(S().rng, S().seed, name);

  // system: { name, every = 1 (ticks), init(ctx) -> initial state, step(ctx), commands: { name(ctx, payload) } }
  sim.register = (sys) => {
    if (sim.systems.some((s) => s.name === sys.name)) throw new Error('system registered twice: ' + sys.name);
    const s = { every: 1, ...sys };
    sim.systems.push(s);
    if (S().sys[s.name] === undefined) S().sys[s.name] = s.init ? s.init(ctxFor(s)) : {};
    for (const [cmd, fn] of Object.entries(s.commands || {})) sim.handlers.set(cmd, { sys: s, fn });
    return sim;
  };

  function ctxFor(sys, dt = sys.every * TICK) {
    const st = S();
    return {
      sim, state: st, t: st.t, tick: st.tick, dt,
      // seasonal clock (see time.js): use lifeDt and lifeT for growth, ageing and other slow processes
      lifeScale: YEAR_DAYS_REAL / st.yearDays, lifeDt: dt * (YEAR_DAYS_REAL / st.yearDays), lifeT: st.lifeT,
      ct: calendarT(st.t, st.lifeT),                 // pass this, not t, to the calendar functions
      get s() { return st.sys[sys.name]; },
      set s(v) { st.sys[sys.name] = v; },
      get: (name) => st.sys[name],                    // read another system's state
      rng: (name) => sim.rng(sys.name + (name ? ':' + name : '')),
      emit: (type, data) => emit(type, data),
    };
  }
  function emit(type, data) { for (const fn of sim.listeners) fn(type, data, S()); }
  sim.listen = (fn) => { sim.listeners.push(fn); return () => { sim.listeners = sim.listeners.filter((f) => f !== fn); }; };

  // Queue a player or game action. It takes effect at the start of the next tick.
  sim.command = (name, payload = {}) => {
    if (!sim.handlers.has(name)) throw new Error('unknown command: ' + name);
    sim.queue.push({ name, payload });
  };

  // Apply a command immediately, for interface actions that must take effect while time is paused
  // (buying, building). Same handler and same recording as a queued command, so replays see it.
  sim.commandNow = (name, payload = {}) => {
    const h = sim.handlers.get(name);
    if (!h) throw new Error('unknown command: ' + name);
    if (sim.recorded) sim.recorded.push({ tick: S().tick, name, payload });
    return h.fn(ctxFor(h.sys, 0), payload);
  };

  function tickOnce() {
    const st = S();
    if (sim.queue.length) {
      const q = sim.queue; sim.queue = [];
      for (const c of q) {
        const h = sim.handlers.get(c.name);
        if (sim.recorded) sim.recorded.push({ tick: st.tick, name: c.name, payload: c.payload });
        h.fn(ctxFor(h.sys), c.payload);
      }
    }
    for (const sys of sim.systems) {
      if (sys.step && st.tick % sys.every === 0) sys.step(ctxFor(sys));
    }
    st.tick++; st.t += TICK; st.lifeT += TICK * (YEAR_DAYS_REAL / st.yearDays);
  }

  // Advance by world seconds. Whole ticks only; the remainder waits. maxTicks bounds the work
  // done in one call (a frame): time owed beyond it is dropped, so a slow machine sees time run
  // slower instead of stalling. Returns the number of ticks run.
  sim.advance = (seconds, maxTicks = Infinity) => {
    sim.acc += seconds;
    let n = 0;
    while (sim.acc >= TICK && n < maxTicks) { tickOnce(); sim.acc -= TICK; n++; }
    if (sim.acc >= TICK) sim.acc = sim.acc % TICK;
    sim.ticksLastAdvance = n;
    return n;
  };
  sim.runTicks = (n) => { for (let i = 0; i < n; i++) tickOnce(); };
  sim.runDays = (d) => sim.runTicks(Math.round((d * 86400) / TICK));

  // the timestamp to give calendar functions (date from the seasonal clock, time of day from the clock)
  sim.calendarT = () => calendarT(S().t + sim.acc, S().lifeT);
  sim.lifeScale = () => YEAR_DAYS_REAL / S().yearDays;
  // Length of the year in days: a world option. Takes effect from now on; nothing already grown is undone.
  sim.setYearDays = (days) => {
    const d = Math.round(+days);
    if (!(d >= 4 && d <= 365)) throw new Error('year length must be 4 to 365 days');
    if (sim.recorded) sim.recorded.push({ tick: S().tick, name: 'time.setYearDays', payload: { days: d } });
    S().yearDays = d; emit('time.yearDays', { days: d });
  };
  sim.dayFraction = () => dayFraction(S().t + sim.acc);   // includes the sub-tick remainder so the sun moves smoothly
  sim.day = () => dayIndex(S().t) + 1;

  sim.serialize = () => JSON.parse(JSON.stringify(S()));
  sim.load = (state) => {
    sim.state = JSON.parse(JSON.stringify(state));
    sim.acc = 0; sim.queue = [];
    if (S().lifeT === undefined) S().lifeT = S().t;          // saves from before the seasonal clock
    if (!S().yearDays) S().yearDays = YEAR_DAYS_REAL;
    for (const sys of sim.systems) if (S().sys[sys.name] === undefined) S().sys[sys.name] = sys.init ? sys.init(ctxFor(sys)) : {};
    emit('loaded', null);
  };
  sim.hash = () => hashState(S());

  for (const s of systems) sim.register(s);
  return sim;
}

// Order-independent-of-insertion hash of any JSON value (FNV-1a over a canonical form).
export function hashState(value) {
  let h = 2166136261 >>> 0;
  const eat = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
  const walk = (v) => {
    if (v === null || typeof v !== 'object') { eat(JSON.stringify(v === undefined ? null : v)); return; }
    if (Array.isArray(v)) { eat('['); for (const x of v) { walk(x); eat(','); } eat(']'); return; }
    eat('{'); for (const k of Object.keys(v).sort()) { eat(k); eat(':'); walk(v[k]); eat(','); } eat('}');
  };
  walk(value);
  return (h >>> 0).toString(16).padStart(8, '0');
}
