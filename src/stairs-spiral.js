/* Spiral stairs for window.__stairsGeo (src/stairs-geo.js): the part maker and the drawing for type 'spiral'.
   Stub for now (S3 fills it): kinds.spiral(k) gets the kit described in stairs-geo.js's header (local [u, v, y] frame,
   k.box, k.ob, k.newel, k.post, k.rail, k.pal, k.D) and the layout's spiral { c, r, post, a0, step, treads, rw, sweep };
   drawKinds.spiral(layout, size, opts) returns an svg string, or null to fall back to the generic plan and side view. */
(() => {
  const S = globalThis.__stairsGeo;
  if (!S) return;
  S.kinds.spiral = function spiral(k) { void k; };
  S.drawKinds.spiral = null;
})();
