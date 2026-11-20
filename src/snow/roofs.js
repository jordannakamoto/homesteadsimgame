// Snow on roofs as a blanket with thickness, not a tint. Each built roof plane gets a slab over its footprint: full
// depth in the field of the roof, rounded down over about a forearm's width at the eaves and rakes (snow slumps to
// its angle of repose at a free edge), a lip hanging a little past the eave (it creeps and curls over), full depth
// right up to the ridge so the two sides meet in one cap. Steep planes hold less. One merged mesh for all roofs,
// rebuilt when the build changes; its thickness follows the snow depth through a uniform, so a storm or a thaw costs
// nothing. Receives shadows, casts none.
const STEP = 0.2, OVER = 0.1, SHOULDER = 0.38, LIFT = 0.035;

export function createRoofs(G, U) {
  const T = G.THREE;
  const uD = { value: 0 };
  let mesh = null, ver = null, checkT = 0, on = false;
  const mat = new T.MeshLambertMaterial({ color: new T.Color(0.80, 0.85, 0.92) });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnowRoofD = uD;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; uniform float uSnowRoofD; varying float vRoofT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoofT = aT * uSnowRoofD; transformed.y += vRoofT;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRoofT;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vRoofT < 0.012) discard;');
  };
  mat.customProgramCacheKey = () => 'snow-roof-1';

  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c; } return c; };
  function build() {
    const B = window.__build, pos = [], aT = [], idx = [];
    for (const p of (B && B.pieces ? B.pieces() : [])) {
      if (!p || p.built === false || p.kind !== 'roof' || !Array.isArray(p.footprint) || p.footprint.length < 3) continue;
      const poly = p.footprint, f = p.facing, fl = f ? Math.hypot(f.x, f.z) : 0, pitch = p.pitchDeg || 0, slope = Math.tan((pitch * Math.PI) / 180);
      const fx = fl ? f.x / fl : 0, fz = fl ? f.z / fl : 0, ax = p.a ? p.a.x : 0, az = p.a ? p.a.z : 0;
      const at = fl ? (x, z) => Math.min(p.ridgeY, p.eaveY + Math.max(0, -((x - ax) * fx + (z - az) * fz)) * slope) : () => (p.eaveY + p.ridgeY) / 2;
      const hold = Math.min(1, Math.max(0.15, 1 - (pitch - 35) / 35));          // steep roofs shed
      // free edges (eaves, rakes) round off; an edge along the ridge does not: the other plane's snow meets it there
      const edges = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ridge = fl && slope > 0.05 && at(a.x, a.z) > p.ridgeY - 0.06 && at(b.x, b.z) > p.ridgeY - 0.06;
        edges.push({ ax: a.x, az: a.z, dx: b.x - a.x, dz: b.z - a.z, L2: (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1, ridge });
      }
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of poly) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
      x0 -= OVER + STEP; z0 -= OVER + STEP; x1 += OVER + STEP; z1 += OVER + STEP;
      const nx = Math.ceil((x1 - x0) / STEP), nz = Math.ceil((z1 - z0) / STEP);
      if (nx * nz > 40000) continue;
      const base = pos.length / 3, tt = new Float32Array((nx + 1) * (nz + 1));
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = x0 + i * STEP, z = z0 + j * STEP, inside = inPoly(poly, x, z);
        let dFree = Infinity, dRidge = Infinity;
        for (const e of edges) {
          const u = Math.min(1, Math.max(0, ((x - e.ax) * e.dx + (z - e.az) * e.dz) / e.L2)), d = Math.hypot(x - e.ax - e.dx * u, z - e.az - e.dz * u);
          if (e.ridge) dRidge = Math.min(dRidge, d); else dFree = Math.min(dFree, d);
        }
        // distance in from the lip's edge; nothing beyond a ridge edge
        let e = inside ? dFree + OVER : (dRidge < dFree ? -1 : OVER - dFree);
        const k = e <= 0 ? 0 : Math.min(1, e / SHOULDER);
        const t = (1 - (1 - k) * (1 - k)) * hold;
        tt[j * (nx + 1) + i] = t;
        pos.push(x, at(x, z) + LIFT - (inside ? 0 : Math.min(0.05, (OVER - e) * 0.3)), z);   // the lip droops a little
        aT.push(t);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        if (tt[a] <= 0 && tt[b] <= 0 && tt[c] <= 0 && tt[d] <= 0) continue;
        idx.push(base + a, base + c, base + b, base + b, base + c, base + d);
      }
    }
    if (mesh) { G.scene.remove(mesh); mesh.geometry.dispose(); mesh = null; }
    if (!idx.length) return;
    // normals for a typical depth (30 cm), so the rounded shoulders shade as shoulders
    const lifted = new Float32Array(pos); for (let n = 0; n < aT.length; n++) lifted[n * 3 + 1] += aT[n] * 0.3;
    const tmp = new T.BufferGeometry(); tmp.setAttribute('position', new T.BufferAttribute(lifted, 3)); tmp.setIndex(idx); tmp.computeVertexNormals();
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', tmp.attributes.normal); g.setAttribute('aT', new T.Float32BufferAttribute(aT, 1));
    g.setIndex(idx); g.computeBoundingSphere(); g.boundingSphere.radius += 1;
    mesh = new T.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'snow-roofs'; mesh.matrixAutoUpdate = false;
    G.scene.add(mesh);
  }
  return {
    get on() { return on; }, get triangles() { return mesh ? mesh.geometry.index.count / 3 : 0; },
    set(o) { on = o; if (!o && mesh) { G.scene.remove(mesh); mesh.geometry.dispose(); mesh = null; ver = null; } },
    update(dt, depthM) {
      if (!on) return;
      uD.value = Math.min(0.7, Math.max(0, depthM));
      checkT -= dt;
      if (checkT > 0) return;
      checkT = 1;
      const B = window.__build, v = B ? B.version : 0;
      if (v !== ver) { ver = v; build(); }
    },
  };
}
