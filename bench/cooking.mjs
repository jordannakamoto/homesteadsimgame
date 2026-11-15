// Isolated headless system cost, excluding rendering and other simulation systems.
import { performance } from 'node:perf_hooks';
import { cookingSystem } from '../src/sim/cooking.js';
const system = cookingSystem();
const state = { fullness: 80, batch: null };
const c = { s: state, dt: 60, emit() {} };
const count = 500000;
function measure(name, active) {
  const times = [];
  for (let pass = 0; pass < 6; pass++) {
    state.batch = active ? { recipe: 'soup', status: 'cooking', heat: 'low', temperatureC: 100, progress: 0, damage: 0, rest: 0 } : null;
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      if (active) { state.batch.progress = 0; state.batch.damage = 0; state.batch.status = 'cooking'; }
      system.step(c);
    }
    if (pass) times.push((performance.now() - start) / count);
  }
  times.sort((a,b) => a-b);
  console.log(`${name}: ${times[2].toFixed(6)} ms/tick (median of 5 × ${count}; includes fixture reset)`);
}
measure('Idle kitchen', false);
measure('Simmering soup', true);
