// Optional spike. Install @dimforge/rapier3d-compat@0.21.0 in a temporary prefix,
// then pass its dist/rapier.mjs absolute path. No dependency in the shipped game.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass the absolute path to @dimforge/rapier3d-compat/dist/rapier.mjs');
const { default: R } = await import(pathToFileURL(modulePath).href);
await R.init();

function createYard(count) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(R.ColliderDesc.cuboid(24, 0.5, 24).setTranslation(0, -0.5, 0));
  for (let i = 0; i < count; i++) {
    const x = (i % 8) * 3 - 10.5, z = (Math.floor(i / 8) % 4) * 4 - 6;
    const y = 1 + Math.floor(i / 32) * 0.7;
    const log = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false));
    world.createCollider(R.ColliderDesc.cuboid(1.05, 0.19, 0.21).setFriction(0.8), log);
  }
  return world;
}

const steps = 600;
for (const count of [32, 128, 512]) {
  const warm = createYard(count);
  for (let step = 0; step < 300; step++) warm.step();
  warm.free();
  let snapshot;
  const times = [];
  for (let trial = 0; trial < 3; trial++) {
    const world = createYard(count);
    for (let step = 0; step < steps; step++) {
      const start = performance.now();
      world.step();
      times.push(performance.now() - start);
    }
    const current = world.takeSnapshot();
    world.free();
    if (snapshot) assert.deepEqual(current, snapshot);
    snapshot = current;
  }
  times.sort((a, b) => a - b);
  console.log(count + ' awake bodies', 'p50 ' + times[Math.floor(times.length * 0.5)].toFixed(3) + ' ms',
    'p95 ' + times[Math.floor(times.length * 0.95)].toFixed(3) + ' ms', snapshot.length + ' snapshot bytes');
}
