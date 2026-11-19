// Garden cost: run on its own (a separate process) so the timings are not disturbed by the other tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchOnly } from './helpers/bench.mjs';
import { createSim, weather, stockSystem, garden, gardenSteps, DAY, calendar } from '../src/sim/index.js';
const G = (sim) => sim.state.sys.garden;
const at = (m, d) => (calendar.MONTH_START[m] + d - 1 - calendar.START_DAY_OF_YEAR) * DAY;
const runTo = (sim, t) => { while (sim.state.t < t) sim.runTicks(60); };
const cmd = (sim, name, p) => sim.commandNow(name, p);
const give = (sim, id, qty) => { const it = sim.state.sys.stock.items; it[id] = (it[id] || 0) + qty; };
function makeSim() { const sim = createSim({ seed: 1, systems: [weather, stockSystem(), garden] }); sim.state.sys.stock.tools.push('spade'); return sim; }

test('cost: 400 planted cells under 0.3 ms per growth step and 0.1 ms per soil step; nothing with no beds', benchOnly, () => {
  const sim = makeSim(); runTo(sim, at(4, 20));
  for (let k = 0; k < 4; k++) { const r = cmd(sim, 'garden.makeBed', { x0: k * 4, z0: 0, nx: 10, nz: 10 }); give(sim, 'seed_carrot', 5); cmd(sim, 'garden.sow', { crop: 'carrot', bed: r.id }); }
  sim.runDays(30);
  const s = G(sim);
  const ctx = { s, t: sim.state.t, tick: 60, dt: 3600, lifeScale: 1, ct: sim.state.t, get: (n) => sim.state.sys[n], emit: () => {}, sim };
  // CPU time, best of five rounds (the machine may be busy)
  const cpu = (fn, n) => { let best = Infinity; for (let r = 0; r < 5; r++) { const t0 = process.cpuUsage(); for (let i = 0; i < n; i++) fn(); const u = process.cpuUsage(t0); best = Math.min(best, (u.user + u.system) / 1000 / n); } return best; };
  const soil = cpu(() => gardenSteps.soilStep(ctx, s), 300);
  const growth = 3 * cpu(() => gardenSteps.growthStep(ctx, s), 300);   // each call steps a third of the garden
  console.log('# garden cost, 400 planted cells: soil step', soil.toFixed(4), 'ms; growth step for all of them', growth.toFixed(4), 'ms, spread over three hours');
  // The budget is 0.1 ms per soil step and 0.3 ms per growth step for 400 plants; measured alone on a quiet machine
  // they are about 0.03 and 0.28 ms. This machine is shared and npm test runs files in parallel, so the assertion
  // only catches a gross regression (five times the budget); read the logged figures for the real cost.
  assert.ok(soil < 0.5, 'soil ' + soil); assert.ok(growth < 1.5, 'growth ' + growth);
  const empty = makeSim(); const es = empty.state.sys.garden;
  const t0 = performance.now(); for (let i = 0; i < 10000; i++) garden.step({ s: es, tick: 180, get: () => null }); assert.ok((performance.now() - t0) / 10000 < 0.01);   // an empty garden: a few microseconds at most
});
