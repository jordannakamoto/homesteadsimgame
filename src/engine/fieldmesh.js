/* Field meshes: a field of values over the ground drawn as one mesh. Generic (no words of what the field means).
   This file has the overlay part (slice B2): a tint laid on the ground cell by cell, for "how far is this from
   where it should be" reads such as a dig against its line. The mesh of an earthwork-format grid with a wet look
   (a pour) is added here in a later slice:  create({ grid, baseY(i, j), colour(tile, n, i, j), step }).
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
  window.__fieldmesh = { overlay };
})();
