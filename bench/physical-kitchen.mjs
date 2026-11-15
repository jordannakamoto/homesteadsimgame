import { performance } from "node:perf_hooks";
import { createGameSim } from "../src/sim/index.js";
import {
  initKitchenPhysics,
  heatStep,
  newCarrot,
} from "../src/sim/physical-kitchen.js";
await initKitchenPhysics();
const sim = createGameSim(1337);
sim.commandNow("cooking.place", { kind: "stove", x: 0, y: 0, z: 0 });
sim.commandNow("kitchen.setup");
const s = sim.state.sys.physicalKitchen;
for (let i = 0; i < 32; i++)
  s.objects.push(
    newCarrot(
      s.nextId++,
      -2 + (i % 8) * 0.48,
      0.3 + Math.floor(i / 8) * 0.3,
      0,
    ),
  );
const sample = (name, n, fn) => {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(
    name,
    JSON.stringify({
      p50ms: times[Math.floor(n * 0.5)],
      p95ms: times[Math.floor(n * 0.95)],
    }),
  );
};
sample("32 food bodies + cookware, 60 Hz physics", 600, () =>
  sim.commandNow("kitchen.advance", { dt: 1 / 60 }),
);
s.power = 1;
const pan = s.objects.find((o) => o.kind === "pan");
pan.p = { x: 1.4, y: 0.185, z: -0.25 };
pan.q = { x: 0, y: 0, z: 0, w: 1 };
sample("81-cell heat + 32 foods, one world tick", 1000, () =>
  heatStep(s, 60 / 72),
);
console.log("Serialized kitchen bytes", JSON.stringify(s).length);
