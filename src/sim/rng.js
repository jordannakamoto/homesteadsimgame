// Seeded random streams for the simulation. Every stream's position lives in the
// saved state, so a loaded game continues the exact sequence it would have had.
// Simulation code must never call Math.random().

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// One step of mulberry32 over a counter kept in `box[key]`.
function next(box, key) {
  let a = (box[key] = (box[key] + 0x6d2b79f5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A named stream. `box` is state.rng; the stream is created on first use from the world seed.
export function stream(box, seed, name) {
  if (box[name] === undefined) box[name] = (hashString(name) ^ Math.imul(seed >>> 0, 2654435761)) >>> 0;
  const float = () => next(box, name);
  return {
    float,                                             // [0, 1)
    range: (a, b) => a + (b - a) * float(),
    int: (a, b) => a + Math.floor(float() * (b - a + 1)), // inclusive
    chance: (p) => float() < p,
    pick: (list) => list[Math.floor(float() * list.length)],
    // normal distribution (Box-Muller); uses two draws every call so the stream stays aligned
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(float(), 1e-12), v = float();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v);
    },
  };
}
