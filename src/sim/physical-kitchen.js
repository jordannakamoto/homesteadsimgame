// Bounded rigid-body kitchen. Commands + serializable poses are authoritative;
// Rapier is a disposable cache rebuilt on load. Heat uses the world clock.
import R from "@dimforge/rapier3d-compat";
import {
  carrotSolid,
  splitSolid,
  centerSolid,
  volume,
  rotate,
  inverse,
  dot,
} from "./food-solid.js";
import { stockRemove } from "./stock.js";
export const GRID = 9,
  PAN_R = 0.48,
  PAN_RIM_HEIGHT = 0.22,
  BURNER = { x: 1.4, z: -0.25, r: 0.34, y: 0.16 };
export const PLATE = { x: 0.05, z: 0.8, radius: 0.36 };
export const MAX_PIECES = 32;
const STEP = 1 / 60,
  IDENTITY = { x: 0, y: 0, z: 0, w: 1 },
  zero = () => ({ x: 0, y: 0, z: 0 });
let ready = false,
  promise;
export function initKitchenPhysics() {
  return (promise ||= R.init().then(() => {
    ready = true;
  }));
}
export function cellPoint(i) {
  return [
    (((i % GRID) / (GRID - 1)) * 2 - 1) * 0.43,
    0,
    ((Math.floor(i / GRID) / (GRID - 1)) * 2 - 1) * 0.43,
  ];
}
export const validCell = (i) =>
  Math.hypot(cellPoint(i)[0], cellPoint(i)[2]) <= 0.43;
const good = (p) => p && ["x", "y", "z"].every((k) => Number.isFinite(p[k]));
const yes = () => ({ ok: true }),
  no = (reason) => ({ ok: false, reason });
function object(id, kind, x, y, z) {
  return { id, kind, p: { x, y, z }, q: { ...IDENTITY }, v: zero(), w: zero() };
}
export function newCarrot(id, x = -1.25, y = 0.25, z = 0) {
  return {
    ...object(id, "carrot", x, y, z),
    faces: carrotSolid(),
    mass: 0.12,
    temp: 20,
    cooked: 0,
    burn: 0,
    age: 0,
  };
}
function newState() {
  return {
    initialized: false,
    objects: [],
    nextId: 1,
    held: null,
    target: null,
    acc: 0,
    power: 0,
    grid: Array(GRID * GRID).fill(20),
    version: 0,
    cuts: 0,
  };
}
function colliderFor(world, desc, body) {
  return world.createCollider(
    desc.setFriction(0.85).setRestitution(0.02),
    body,
  );
}
function addBody(rt, o) {
  const body = rt.world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(o.p.x, o.p.y, o.p.z)
      .setRotation(o.q)
      .setLinvel(o.v.x, o.v.y, o.v.z)
      .setAngvel(o.w)
      .setCcdEnabled(true)
      .setLinearDamping(0.7)
      .setAngularDamping(2),
  );
  if (o.kind === "carrot")
    colliderFor(
      rt.world,
      R.ColliderDesc.convexHull(new Float32Array(o.faces.flat(2))).setMass(
        o.mass,
      ),
      body,
    );
  if (o.kind === "knife") {
    colliderFor(
      rt.world,
      R.ColliderDesc.cuboid(0.018, 0.09, 0.28).setMass(0.15),
      body,
    );
    colliderFor(
      rt.world,
      R.ColliderDesc.cuboid(0.045, 0.04, 0.16)
        .setTranslation(0, 0.02, 0.41)
        .setMass(0.05),
      body,
    );
  }
  if (o.kind === "pan") {
    colliderFor(
      rt.world,
      R.ColliderDesc.cylinder(0.025, PAN_R).setMass(1),
      body,
    );
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      colliderFor(
        rt.world,
        R.ColliderDesc.cuboid(0.107, PAN_RIM_HEIGHT / 2, 0.025)
          .setTranslation(
            Math.sin(a) * PAN_R,
            PAN_RIM_HEIGHT / 2,
            Math.cos(a) * PAN_R,
          )
          .setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) })
          .setMass(0.025),
        body,
      );
    }
    colliderFor(
      rt.world,
      R.ColliderDesc.cuboid(0.08, 0.035, 0.3)
        .setTranslation(0, 0.05, 0.74)
        .setMass(0.15),
      body,
    );
  }
  rt.bodies.set(o.id, body);
  return body;
}
function runtime(s) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const rt = { world, bodies: new Map() };
  colliderFor(
    world,
    R.ColliderDesc.cuboid(2.6, 0.08, 1.25).setTranslation(0, -0.08, 0),
  );
  colliderFor(
    world,
    R.ColliderDesc.cuboid(0.72, 0.02, 0.49).setTranslation(-1.25, 0.02, 0),
  );
  colliderFor(
    world,
    R.ColliderDesc.cuboid(0.7, 0.08, 0.66).setTranslation(1.4, 0.08, -0.25),
  );
  // Catch tray under the tabletop keeps dropped pieces recoverable.
  colliderFor(
    world,
    R.ColliderDesc.cuboid(3, 0.04, 1.8).setTranslation(0, -0.65, 0),
  );
  for (const o of s.objects) addBody(rt, o);
  // A save never resumes a stale pointer capture.
  s.held = null;
  s.target = null;
  s.group = null;
  s.dropPending = false;
  return rt;
}
function sync(s, rt) {
  for (const o of s.objects) {
    const b = rt.bodies.get(o.id);
    o.p = { ...b.translation() };
    o.q = { ...b.rotation() };
    o.v = { ...b.linvel() };
    o.w = { ...b.angvel() };
  }
}
function sliceAtBlade(s, rt, knife, oldY) {
  if (s.objects.length >= MAX_PIECES + 2 || oldY <= knife.p.y + 0.0001) return;
  const n = rotate([1, 0, 0], knife.q),
    edge = knife.p.y - 0.09;
  for (const o of s.objects.slice()) {
    if (
      o.kind !== "carrot" ||
      Math.abs(o.p.z - knife.p.z) > 0.35 ||
      Math.abs(o.p.x - knife.p.x) > 0.6
    )
      continue;
    // A descending edge must cross the solid's center, not merely hover nearby.
    if (edge > o.p.y || oldY - 0.09 < o.p.y - 0.03) continue;
    const localN = rotate(n, inverse(o.q)),
      delta = [knife.p.x - o.p.x, knife.p.y - o.p.y, knife.p.z - o.p.z];
    const pieces = splitSolid(o.faces, localN, dot(delta, n));
    if (!pieces) continue;
    const vols = pieces.map(volume),
      total = vols[0] + vols[1];
    rt.world.removeRigidBody(rt.bodies.get(o.id));
    rt.bodies.delete(o.id);
    s.objects.splice(s.objects.indexOf(o), 1);
    pieces.forEach((faces, i) => {
      const centered = centerSolid(faces),
        offset = rotate(centered.center, o.q),
        sign = i === 0 ? -1 : 1;
      const child = {
        ...o,
        id: s.nextId++,
        faces: centered.faces,
        mass: (o.mass * vols[i]) / total,
        p: {
          x: o.p.x + offset[0] + n[0] * 0.008 * sign,
          y: o.p.y + offset[1],
          z: o.p.z + offset[2] + n[2] * 0.008 * sign,
        },
        v: {
          x: o.v.x + n[0] * sign * 0.06,
          y: o.v.y,
          z: o.v.z + n[2] * sign * 0.06,
        },
      };
      s.objects.push(child);
      addBody(rt, child);
    });
    s.cuts++;
    s.version++;
    break;
  }
}
const CELLS = Array.from({ length: GRID * GRID }, (_, i) => cellPoint(i));
const ACTIVE = CELLS.map((_, i) => i).filter(validCell);
const NEIGHBORS = CELLS.map((_, i) =>
  [i - 1, i + 1, i - GRID, i + GRID].filter(
    (j) =>
      j >= 0 &&
      j < GRID * GRID &&
      validCell(j) &&
      Math.abs((i % GRID) - (j % GRID)) <= 1,
  ),
);
export function heatStep(s, seconds) {
  const pan = s.objects.find((o) => o.kind === "pan");
  if (!pan) return;
  const inv = inverse(pan.q),
    on = CELLS.map((p) => {
      const off = rotate([p[0], -0.025, p[2]], pan.q);
      return (
        Math.abs(pan.p.y + off[1] - BURNER.y) < 0.045 &&
        Math.hypot(pan.p.x + off[0] - BURNER.x, pan.p.z + off[2] - BURNER.z) <
          BURNER.r
      );
    });
  // Poses are constant within a world tick. Cache contact footprints outside the
  // thermal substeps rather than allocating vectors for every cell/iteration.
  const food = s.objects
    .filter((o) => o.kind === "carrot")
    .map((o) => {
      const relative = rotate(
          [o.p.x - pan.p.x, o.p.y - pan.p.y, o.p.z - pan.p.z],
          inv,
        ),
        points = o.faces.flat();
      const radius = Math.max(...points.map((v) => Math.hypot(v[0], v[2])));
      const bottom =
        Math.min(...points.map((v) => rotate(rotate(v, o.q), inv)[1])) +
        relative[1];
      const contact =
        Math.hypot(relative[0], relative[2]) < PAN_R - 0.025 &&
        bottom < 0.07 &&
        bottom > -0.04;
      const cells = contact
        ? ACTIVE.filter(
            (i) =>
              Math.hypot(CELLS[i][0] - relative[0], CELLS[i][2] - relative[2]) <
              Math.max(0.09, radius),
          )
        : [];
      return {
        o,
        cells,
        k: cells.length
          ? 0.075 * Math.cbrt(0.12 / Math.max(0.001, o.mass))
          : 0.012,
      };
    });
  const next = Array(GRID * GRID).fill(20);
  // <= .25 s explicit steps keep the diffusion stencil stable at all time speeds.
  while (seconds > 1e-8) {
    const dt = Math.min(0.25, seconds);
    seconds -= dt;
    for (const i of ACTIVE) {
      const temp = s.grid[i];
      let diffusion = 0;
      for (const j of NEIGHBORS[i]) diffusion += s.grid[j] - temp;
      const heat =
        on[i] && s.power > 0 ? (20 + s.power * 280 - temp) * 0.16 : 0;
      next[i] = Math.max(
        20,
        temp + dt * (heat + diffusion * 0.55 - (temp - 20) * 0.012),
      );
    }
    for (const i of ACTIVE) s.grid[i] = next[i];
    for (const { o, cells, k } of food) {
      let sum = 0;
      for (const i of cells) sum += s.grid[i];
      const target = cells.length ? sum / cells.length : 20;
      o.temp += (target - o.temp) * (1 - Math.exp(-k * dt));
      o.cooked = Math.min(1, o.cooked + (Math.max(0, o.temp - 75) * dt) / 1500);
      o.burn = Math.min(1, o.burn + (Math.max(0, o.temp - 160) * dt) / 3000);
    }
  }
}
function panContents(objects, pan) {
  const inv = inverse(pan.q);
  return objects.filter((o) => {
    if (o.kind !== "carrot") return false;
    const [x, y, z] = rotate(
      [o.p.x - pan.p.x, o.p.y - pan.p.y, o.p.z - pan.p.z],
      inv,
    );
    return Math.hypot(x, z) < PAN_R && y >= 0 && y < 0.32;
  });
}

export function physicalKitchenSystem() {
  let cachedState = null,
    rt = null;
  const getRuntime = (s) => {
    if (s !== cachedState) {
      rt?.world.free();
      rt = runtime(s);
      cachedState = s;
    }
    return rt;
  };
  const release = (s) => {
    if (!s.held) return;
    const r = getRuntime(s);
    if (!s.held) return; // Loading releases stale pointer ownership.
    for (const id of [s.held, ...Object.keys(s.group || {}).map(Number)]) {
      const body = r.bodies.get(id);
      body.setBodyType(R.RigidBodyType.Dynamic, true);
      body.setLinvel(zero(), true);
      body.setAngvel(zero(), true);
    }
    s.held = null;
    s.target = null;
    s.group = null;
    s.dropPending = false;
    r.tossTime = 0;
  };
  const grab = (s, objects) => {
    const r = getRuntime(s);
    release(s);
    const anchor = objects[0];
    s.held = anchor.id;
    s.target = { ...anchor.p };
    s.group = {};
    for (const o of objects) {
      r.bodies
        .get(o.id)
        .setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      if (o !== anchor)
        s.group[o.id] = {
          x: o.p.x - anchor.p.x,
          y: o.p.y - anchor.p.y,
          z: o.p.z - anchor.p.z,
        };
    }
  };
  const removeFood = (s, o) => {
    if (s.group) delete s.group[o.id];
    s.objects.splice(s.objects.indexOf(o), 1);
    if (s === cachedState) {
      rt.world.removeRigidBody(rt.bodies.get(o.id));
      rt.bodies.delete(o.id);
    }
    s.version++;
  };
  return {
    name: "physicalKitchen",
    init: newState,
    step(c) {
      if (c.s.initialized) {
        heatStep(c.s, c.dt / 72);
        for (const o of c.s.objects) if (o.kind === "carrot") o.age += c.dt;
      }
    },
    commands: {
      "kitchen.setup"(c) {
        if (!ready) return no("Physics is loading.");
        if (c.s.initialized) return yes();
        if (!c.get("cooking").station) return no("Place a kitchen first.");
        c.s.initialized = true;
        c.s.objects = [
          object(c.s.nextId++, "pan", 0.1, 0.08, 0),
          object(c.s.nextId++, "knife", -1.25, 0.13, 0.78),
        ];
        c.s.version++;
        return yes();
      },
      "kitchen.carrot"(c) {
        if (!c.s.initialized || c.s.objects.length >= MAX_PIECES + 2)
          return no("The workbench is full.");
        if (!stockRemove(c.get("stock"), "food_carrot", 1).ok)
          return no("No carrots left. Buy more from the supplier.");
        const o = newCarrot(c.s.nextId++, -1.25, 0.3, 0);
        c.s.objects.push(o);
        if (c.s === cachedState) addBody(rt, o);
        c.s.version++;
        return yes();
      },
      "kitchen.grab"(c, p) {
        if (!ready || !c.s.initialized) return no("Physics is loading.");
        const o = c.s.objects.find((o) => o.id === p.id);
        if (!o) return no("Missing object.");
        grab(c.s, o.kind === "pan" ? [o, ...panContents(c.s.objects, o)] : [o]);
        return yes();
      },
      "kitchen.scoop"(c) {
        if (!ready || !c.s.initialized) return no("Open the workbench first.");
        const food = c.s.objects.filter(
          (o) =>
            o.kind === "carrot" &&
            o.p.y >= 0 &&
            o.p.y < 0.35 &&
            Math.abs(o.p.x + 1.25) < 0.76 &&
            Math.abs(o.p.z) < 0.53,
        );
        if (!food.length) return no("There’s no food on the board.");
        grab(c.s, food);
        return { ok: true, count: food.length };
      },
      "kitchen.toss"(c) {
        const s = c.s;
        const pan = s.objects.find((o) => o.id === s.held && o.kind === "pan");
        if (!pan || s.dropPending)
          return no("Hold the pan to toss its contents.");
        const r = getRuntime(s);
        if (r.tossTime) return no("Let the food land first.");
        const pieces = Object.keys(s.group || {}).map(Number);
        if (!pieces.length) return no("Put food in the pan first.");
        // Hold the pan still for a short lift and catch. The pieces fly and
        // rotate under gravity, then only pieces still inside are gathered.
        r.tossTime = 0.68;
        for (const [index, id] of pieces.entries()) {
          const food = s.objects.find((o) => o.id === id);
          const body = r.bodies.get(id);
          body.setBodyType(R.RigidBodyType.Dynamic, true);
          body.setLinvel(
            {
              x: (pan.p.x - food.p.x) * 1.7,
              y: 2.65 + (index % 3) * 0.12,
              z: (pan.p.z - food.p.z) * 1.7,
            },
            true,
          );
          body.setAngvel({ x: 7.5, y: 0, z: index % 2 ? -2 : 2 }, true);
        }
        s.group = {};
        return yes();
      },
      "kitchen.drop"(c) {
        const s = c.s;
        if (!s.held) return yes();
        s.dropPending = true;
        return yes();
      },
      "kitchen.move"(c, p) {
        if (!c.s.held || !good(p)) return no("Invalid drag.");
        c.s.target = {
          x: Math.max(-2.35, Math.min(2.35, p.x)),
          y: Math.max(0.07, Math.min(1.6, p.y)),
          z: Math.max(-1.1, Math.min(1.1, p.z)),
        };
        return yes();
      },
      "kitchen.release"(c) {
        if (ready) release(c.s);
        return yes();
      },
      "kitchen.power"(c, p) {
        if (!Number.isFinite(p.value)) return no("Invalid heat.");
        c.s.power = Math.max(0, Math.min(1, p.value));
        return yes();
      },
      "kitchen.plate"(c, p) {
        const s = c.s;
        if (
          !ready ||
          !s.initialized ||
          !good(p) ||
          Math.hypot(p.x - PLATE.x, p.z - PLATE.z) > PLATE.radius
        )
          return no("Bring the pan over the plate.");
        const pan = s.objects.find((o) => o.id === s.held && o.kind === "pan");
        if (!pan) return no("Bring the pan over the plate.");
        if (getRuntime(s).tossTime)
          return no("Let the food land before serving.");
        const food = s.objects.filter((o) => s.group?.[o.id]);
        if (!food.length) return no("The pan is empty.");
        if (food.some((o) => o.age >= 172800 || o.burn > 0.6))
          return no("Remove burned or spoiled pieces before serving.");
        if (food.some((o) => o.cooked < 0.8))
          return no("Some pieces still need to cook.");
        const cooking = c.get("cooking");
        if (cooking.meals.length >= 40)
          return no("Your meal inventory is full.");
        const mass = food.reduce((sum, o) => sum + o.mass, 0);
        const quality = food.some((o) => o.burn > 0.25) ? "rough" : "good";
        cooking.meals.push({
          id: cooking.nextMeal++,
          recipe: "panCarrots",
          qty: 1,
          quality,
          satiety: (mass / 0.12) * 12,
          madeAt: c.t,
          expiresAt: c.t + Math.min(...food.map((o) => 172800 - o.age)),
        });
        for (const o of food) removeFood(s, o);
        return yes();
      },
      "kitchen.discard"(c, p) {
        const o = c.s.objects.find((o) => o.id === p.id);
        if (!o || o.kind !== "carrot") return no("Only food can be discarded.");
        if (c.s.held === o.id || c.s.group?.[o.id]) release(c.s);
        removeFood(c.s, o);
        return yes();
      },
      "kitchen.advance"(c, p) {
        if (!ready || !c.s.initialized) return yes();
        if (!Number.isFinite(p.dt) || p.dt < 0 || p.dt > 0.25)
          return no("Invalid physics interval.");
        const s = c.s,
          r = getRuntime(s);
        if (!s.held && [...r.bodies.values()].every((b) => b.isSleeping())) {
          s.acc = 0;
          return yes();
        }
        s.acc += p.dt;
        while (s.acc + 1e-10 >= STEP) {
          s.acc = Math.max(0, s.acc - STEP);
          let knife = null,
            oldY = 0;
          if (s.held && s.target && !r.tossTime) {
            const o = s.objects.find((o) => o.id === s.held),
              b = r.bodies.get(s.held),
              pos = b.translation(),
              d = Math.hypot(
                s.target.x - pos.x,
                s.target.y - pos.y,
                s.target.z - pos.z,
              ),
              f = Math.min(
                1,
                ((o.kind === "pan"
                  ? s.dropPending && s.target.y <= 0.22
                    ? 0.9
                    : 3
                  : o.kind === "knife"
                    ? 6
                    : 7) *
                  STEP) /
                  Math.max(d, 1e-8),
              );
            const next = {
              x: pos.x + (s.target.x - pos.x) * f,
              y: pos.y + (s.target.y - pos.y) * f,
              z: pos.z + (s.target.z - pos.z) * f,
            };
            b.setNextKinematicTranslation(next);
            for (const [id, offset] of Object.entries(s.group || {})) {
              r.bodies.get(Number(id)).setNextKinematicTranslation({
                x: next.x + offset.x,
                y: next.y + offset.y,
                z: next.z + offset.z,
              });
            }
            // Held utensils stay upright; free objects have full rigid-body rotation.
            b.setNextKinematicRotation(IDENTITY);
            if (o.kind === "knife") {
              knife = o;
              oldY = o.p.y;
            }
          }
          r.world.step();
          sync(s, r);
          if (knife) sliceAtBlade(s, r, knife, oldY);
          if (r.tossTime > 0) {
            r.tossTime = Math.max(0, r.tossTime - STEP);
            if (r.tossTime > 0) continue;
            const pan = s.objects.find((o) => o.id === s.held);
            for (const food of panContents(s.objects, pan)) {
              const body = r.bodies.get(food.id);
              body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
              s.group[food.id] = {
                x: food.p.x - pan.p.x,
                y: food.p.y - pan.p.y,
                z: food.p.z - pan.p.z,
              };
            }
          }
          const held = s.dropPending && r.bodies.get(s.held)?.translation();
          if (
            held &&
            Math.hypot(
              held.x - s.target.x,
              held.y - s.target.y,
              held.z - s.target.z,
            ) < 0.012
          ) {
            const pan = s.objects.find(
              (o) => o.id === s.held && o.kind === "pan",
            );
            if (pan && s.target.y > 0.22) {
              const onHob =
                Math.abs(s.target.x - BURNER.x) < 0.57 &&
                Math.abs(s.target.z - BURNER.z) < 0.52;
              const onBoard =
                Math.abs(s.target.x + 1.25) < 0.72 &&
                Math.abs(s.target.z) < 0.49;
              s.target.y = onHob ? 0.187 : onBoard ? 0.068 : 0.028;
            } else release(s);
          }
        }
        return yes();
      },
    },
  };
}
