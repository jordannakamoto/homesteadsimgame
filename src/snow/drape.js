// Where the snow mounds: it drapes over what it buried. Rocks, stumps and lying logs within the surface's window are
// drawn as soft domes into a small toroidal height texture (51.2 m, 20 cm a texel, metres above the ground); the
// surface shader banks the snow up against the ones that stand clear and pillows it over the ones it has covered.
// Rebuilt on the CPU when the window has moved 3.2 m or something was felled, split, rolled or broken (checked once a
// second): a few hundred small splats.
const N = 256, M = 51.2, PX = M / N, STEP = 3.2;

export function createDrape(G, U) {
  const T = G.THREE, h = new Float32Array(N * N), d = new Uint8Array(N * N);
  const tex = new T.DataTexture(d, N, N, T.RedFormat, T.UnsignedByteType);
  tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.magFilter = tex.minFilter = T.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  U.uSnowDrape.value = tex;
  let cx = null, cz = null, sig = '', t = 0;
  const put = (i, j, v) => { const n = (((j % N) + N) % N) * N + (((i % N) + N) % N); if (v > h[n]) h[n] = v; };
  // a dome over a segment (a point when both ends are one): top height `top`, full to radius r, gone by r + skirt
  function dome(x0, z0, x1, z1, r, top, skirt) {
    const R = r + skirt, i0 = Math.floor((Math.min(x0, x1) - R) / PX), i1 = Math.ceil((Math.max(x0, x1) + R) / PX), j0 = Math.floor((Math.min(z0, z1) - R) / PX), j1 = Math.ceil((Math.max(z0, z1) + R) / PX);
    const bx = x1 - x0, bz = z1 - z0, bb = bx * bx + bz * bz;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i * PX - x0, pz = j * PX - z0, u = bb > 1e-6 ? Math.min(1, Math.max(0, (px * bx + pz * bz) / bb)) : 0;
      const dd = Math.hypot(px - bx * u, pz - bz * u);
      if (dd >= R) continue;
      const k = dd <= r * 0.5 ? 1 : 1 - (dd - r * 0.5) / (R - r * 0.5);
      put(i, j, top * k * k * (3 - 2 * k));
    }
  }
  function signature() {
    let n = 0, s = 0;
    for (const L of G.world.logs || []) { n++; s += L.x * 3 + L.z * 7 + L.yaw; }
    return n + '|' + s.toFixed(1) + '|' + (G.world.removed ? G.world.removed.size : 0);
  }
  function rebuild(nx, nz) {
    cx = nx; cz = nz; h.fill(0);
    const R = M / 2 - 1, near = (x, z) => Math.abs(x - cx) < R && Math.abs(z - cz) < R;
    for (const c of G.world.chunks.values()) {
      if (c.rocks) for (const r of c.rocks) if (r.alive && near(r.x, r.z)) dome(r.x, r.z, r.x, r.z, 0.45 * r.scale, 0.62 * r.scale, 0.9);
      // a felled tree leaves its stump
      if (c.trees) for (const tr of c.trees) if (!tr.alive && near(tr.x, tr.z)) dome(tr.x, tr.z, tr.x, tr.z, 0.22 * tr.scale, 0.38, 0.7);
    }
    for (const L of G.world.logs || []) {
      if (!near(L.x, L.z)) continue;
      const hx = Math.cos(L.yaw) * L.len * 0.5, hz = -Math.sin(L.yaw) * L.len * 0.5;
      dome(L.x - hx, L.z - hz, L.x + hx, L.z + hz, L.r, 2 * L.r, 0.7);
    }
    for (let n = 0; n < N * N; n++) d[n] = Math.min(255, Math.round(h[n] * 170));   // 1.5 m full scale
    tex.needsUpdate = true;
  }
  return {
    update(dt, nx, nz) {
      t -= dt;
      const moved = cx === null || Math.abs(nx - cx) >= STEP || Math.abs(nz - cz) >= STEP;
      if (!moved && t > 0) return;
      if (t <= 0) { t = 1; const s = signature(); if (s === sig && !moved) return; sig = s; }
      rebuild(Math.round(nx / STEP) * STEP, Math.round(nz / STEP) * STEP);
    },
    dispose() { tex.dispose(); U.uSnowDrape.value = null; },
  };
}
