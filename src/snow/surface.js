// The snow surface's mesh: nested square rings centred on the player and snapped to 0.8 m, so every vertex always
// lands on its own world lattice and nothing swims as you walk: 12.8 m at 10 cm, 25.6 m at 20 cm, 51.2 m at 40 cm.
// The vertex shader lifts each vertex to the ground plus the snow (shade.js). Quads are split along the same diagonal
// as the terrain's, so on the finest ring the surface follows the ground's own facets. The outer row of each finer
// ring has its odd vertices collapsed onto the even ones, so it meets the coarser ring without cracks.
// position = (x, ring, z), local to the centre; the ring picks the live texture's mip.

export const RINGS = { high: [[6.4, 0.1], [12.8, 0.2], [25.6, 0.4]], medium: [[6.4, 0.1], [12.8, 0.2]] };
export const SNAP = 0.8;

export function buildSurface(T, rings) {
  const pos = [], idx = [];
  let inner = 0;
  rings.forEach(([half, step], ring) => {
    const n = Math.round((2 * half) / step), last = ring === rings.length - 1;
    const id = new Int32Array((n + 1) * (n + 1)).fill(-1);
    const hole = (i, j) => { const x = -half + i * step, z = -half + j * step; return x >= -inner - 1e-6 && x + step <= inner + 1e-6 && z >= -inner - 1e-6 && z + step <= inner + 1e-6; };
    const vert = (i, j) => {
      // a finer ring's outer edge: odd vertices fall onto their even neighbour, matching the coarser ring's edge
      let a = i, b = j;
      if (!last) { if ((j === 0 || j === n) && (a & 1)) a--; if ((i === 0 || i === n) && (b & 1)) b--; }
      const k = b * (n + 1) + a;
      if (id[k] < 0) { id[k] = pos.length / 3; pos.push(-half + a * step, ring, -half + b * step); }
      return id[k];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (hole(i, j)) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      if (a !== c && c !== b && a !== b) idx.push(a, c, b);
      if (b !== c && c !== d && b !== d) idx.push(b, c, d);
    }
    inner = half;
  });
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setIndex(new T.BufferAttribute(new Uint32Array(idx), 1));
  g.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
  return { geo: g, triangles: idx.length / 3, half: rings[rings.length - 1][0] };
}
