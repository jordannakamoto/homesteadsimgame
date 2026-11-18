/* Field meshes: a field of values over the ground drawn as one mesh. Generic (no words of what the field means).
   Two parts: the overlay (slice B2), a tint laid on the ground cell by cell, for "how far is this from where it
   should be" reads such as a dig against its line; and the mesh of an earthwork-format grid (slice B4), a smooth skin
   over the lattice at baseY + h, coloured per point, with a finish channel (0 matte .. 1 wet and glossy) that only
   lowers the roughness of the one standard material (a shader chunk swap, no new pass):
     const fm = window.__fieldmesh.create({ grid, i0, j0, i1, j1, baseY(x, z), colour(tile, n, i, j, out), minMs })
       grid: { step, T, tiles } (earthwork format, h in millimetres); the lattice box i0..i1, j0..j1 is drawn;
       colour writes [r, g, b, finish] (0..1) into out; a point with no h (or a tile missing) is not drawn
     fm.refresh(rect?)  re-seat the points in rect [i0, j0, i1, j1] (all when absent) now
     fm.request(rect?)  ask for that; done at most every `minMs` (default 70 ms) by fm.update()
     fm.update(), fm.visible, fm.dispose()
     const ov = window.__fieldmesh.overlay({ x0, z0, nx, nz, cell, yAt(x, z), colourAt(x, z, out) -> bool, lift })
       colourAt writes [r, g, b, a] (0..1) into out for a tinted cell, or returns false for none
     ov.refresh()     recolour and re-seat every cell now
     ov.request()     ask for a refresh; done at most every `minMs` (default 90 ms) by ov.update()
     ov.update()      call each frame while shown (does nothing unless a refresh was asked for and is due)
     ov.visible, ov.dispose()
   Each cell is its own flat-coloured quad (crisp cells, the pixel look), seated on the ground at its centre.
   Cost: nothing per frame unless asked; a refresh is one pass over the cells. No new pass: it is one transparent
   mesh drawn with the scene. */
(() => {
  const G = window.__game;
  if (!G || !G.THREE) return;
  const T = G.THREE;

  function overlay({ x0, z0, nx, nz, cell = 0.1, yAt, colourAt, lift = 0.015, minMs = 90, opacity = 1 }) {
    nx = Math.max(1, Math.min(400, nx | 0)); nz = Math.max(1, Math.min(400, nz | 0));
    const N = nx * nz, pos = new Float32Array(N * 12), col = new Float32Array(N * 16), idx = new Uint32Array(N * 6);
    for (let c = 0; c < N; c++) { const v = c * 4, k = c * 6; idx[k] = v; idx[k + 1] = v + 2; idx[k + 2] = v + 1; idx[k + 3] = v + 1; idx[k + 4] = v + 2; idx[k + 5] = v + 3; }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 4));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    const mat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide });
    const mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 2;
    G.scene.add(mesh);
    const rgba = [0, 0, 0, 0], h = cell / 2;
    let asked = false, last = 0;
    function refresh() {
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const c = j * nx + i, p = c * 12, q = c * 16, x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
        if (!colourAt(x, z, rgba)) { pos.fill(0, p, p + 12); col.fill(0, q, q + 16); continue; }
        // corners seated on the ground at the corners (follows a slope or the side of a hole)
        const y00 = yAt(x - h, z - h) + lift, y10 = yAt(x + h, z - h) + lift, y01 = yAt(x - h, z + h) + lift, y11 = yAt(x + h, z + h) + lift;
        pos[p] = x - h; pos[p + 1] = y00; pos[p + 2] = z - h;
        pos[p + 3] = x + h; pos[p + 4] = y10; pos[p + 5] = z - h;
        pos[p + 6] = x - h; pos[p + 7] = y01; pos[p + 8] = z + h;
        pos[p + 9] = x + h; pos[p + 10] = y11; pos[p + 11] = z + h;
        for (let k = 0; k < 4; k++) { col[q + k * 4] = rgba[0]; col[q + k * 4 + 1] = rgba[1]; col[q + k * 4 + 2] = rgba[2]; col[q + k * 4 + 3] = rgba[3]; }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      asked = false; last = performance.now();
    }
    return {
      mesh, refresh,
      request() { asked = true; },
      update() { if (asked && mesh.visible && performance.now() - last >= minMs) refresh(); },
      get visible() { return mesh.visible; },
      set visible(v) { mesh.visible = !!v; },
      dispose() { G.scene.remove(mesh); geo.dispose(); mat.dispose(); },
    };
  }
  // ---------------------------------------------------------------- the mesh of an earthwork-format grid (B4)
  let wetMat = null;
  function wetMaterial() {
    if (wetMat) return wetMat;
    wetMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    wetMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float finish;\nvarying float vFinish;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFinish = finish;');
      sh.fragmentShader = 'varying float vFinish;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.22, clamp(vFinish, 0.0, 1.0));');
    };
    wetMat.customProgramCacheKey = () => 'fieldmesh-wet';
    return wetMat;
  }
  function create({ grid, i0, j0, i1, j1, baseY, colour, minMs = 70, lift = 0.002 }) {
    const nx = Math.max(2, Math.min(600, i1 - i0 + 1)), nz = Math.max(2, Math.min(600, j1 - j0 + 1)), N = nx * nz;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3), fin = new Float32Array(N), has = new Uint8Array(N);
    const base = new Float32Array(N), step = grid.step, T0 = grid.T;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = j * nx + i, x = (i0 + i) * step, z = (j0 + j) * step; base[v] = baseY(x, z); pos[v * 3] = x; pos[v * 3 + 1] = base[v]; pos[v * 3 + 2] = z; nor[v * 3 + 1] = 1; }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setAttribute('finish', new T.BufferAttribute(fin, 1));
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    geo.setIndex(new T.BufferAttribute(idx, 1));
    const mesh = new T.Mesh(geo, wetMaterial());
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
    G.scene.add(mesh);
    const out = [0, 0, 0, 0];
    let asked = null, last = 0;
    function seat(a0, b0, a1, b1) {
      for (let j = Math.max(0, b0 - j0); j <= Math.min(nz - 1, b1 - j0); j++) for (let i = Math.max(0, a0 - i0); i <= Math.min(nx - 1, a1 - i0); i++) {
        const v = j * nx + i, gi = i0 + i, gj = j0 + j, tx = Math.floor(gi / T0), tz = Math.floor(gj / T0), tile = grid.tiles[tx + ',' + tz];
        const n = tile ? (gj - tz * T0) * T0 + (gi - tx * T0) : -1, h = tile ? tile.h[n] : 0;
        has[v] = h > 0.5 ? 1 : 0;
        pos[v * 3 + 1] = base[v] + Math.max(0, h) / 1000 + (h > 0.5 ? lift : -0.01);
        if (tile && h > 0.5 && colour(tile, n, gi, gj, out)) { col[v * 3] = out[0]; col[v * 3 + 1] = out[1]; col[v * 3 + 2] = out[2]; fin[v] = out[3]; }
      }
    }
    function normals(a0, b0, a1, b1) {
      for (let j = Math.max(0, b0 - j0 - 1); j <= Math.min(nz - 1, b1 - j0 + 1); j++) for (let i = Math.max(0, a0 - i0 - 1); i <= Math.min(nx - 1, a1 - i0 + 1); i++) {
        const v = j * nx + i, yl = pos[(j * nx + Math.max(0, i - 1)) * 3 + 1], yr = pos[(j * nx + Math.min(nx - 1, i + 1)) * 3 + 1];
        const yd = pos[(Math.max(0, j - 1) * nx + i) * 3 + 1], yu = pos[(Math.min(nz - 1, j + 1) * nx + i) * 3 + 1];
        const dx = (yl - yr) / (2 * step), dz = (yd - yu) / (2 * step), L = Math.hypot(dx, 1, dz);
        nor[v * 3] = dx / L; nor[v * 3 + 1] = 1 / L; nor[v * 3 + 2] = dz / L;
      }
    }
    function index() {
      let k = 0;
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        if (!(has[a] | has[b] | has[c] | has[d])) continue;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      geo.setDrawRange(0, k);
      geo.index.needsUpdate = true;
    }
    function refresh(rect) {
      const r = rect || [i0, j0, i0 + nx - 1, j0 + nz - 1];
      seat(r[0], r[1], r[2], r[3]); normals(r[0], r[1], r[2], r[3]); index();
      geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.finish.needsUpdate = true;
      asked = null; last = performance.now();
    }
    return {
      mesh, refresh,
      request(rect) { const r = rect || [i0, j0, i0 + nx - 1, j0 + nz - 1]; asked = asked ? [Math.min(asked[0], r[0]), Math.min(asked[1], r[1]), Math.max(asked[2], r[2]), Math.max(asked[3], r[3])] : r.slice(); },
      update() { if (asked && mesh.visible && performance.now() - last >= minMs) refresh(asked); },
      // the height drawn at a lattice point, metres (for things that sit on the field)
      yAt(gi, gj) { const i = gi - i0, j = gj - j0; return i >= 0 && j >= 0 && i < nx && j < nz ? pos[(j * nx + i) * 3 + 1] : null; },
      get visible() { return mesh.visible; },
      set visible(v) { mesh.visible = !!v; },
      dispose() { G.scene.remove(mesh); geo.dispose(); },
    };
  }
  window.__fieldmesh = { overlay, create };
})();
