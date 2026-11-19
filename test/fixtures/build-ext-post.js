/* Test fixture for build mode's extension point (X1), not shipped: free-standing 4x4 posts set on a building.
   S.ext.xpost = { posts: [[x, z], ...] } in the building's local metres. Each post is a piece of its own (kind "post")
   with one member, a 4x4 in the floor-frame stage, so it shows in membersOf, the shopping list and construction.
   Loaded headless (only the framing half runs: globalThis.__framing) or injected into the page (both halves). */
(() => {
  const F = globalThis.__framing,
    HIGH = 1.2;
  // the members of one post: a 4x4 standing HIGH metres on the ground at el.at
  F.register("xpost", (out, el, desc, h) => {
    const [b, d] = h.LUMBER["4x4"],
      [x, z] = el.at;
    h.M(out, el.id + ".post", "post", "xpost", "floor-frame", el.id, "timber", b, d, [x, 0, z], [x, el.high || HIGH, z], [1, 0, 0], { col: "timber" });
  });
  // in the page through window.__build; headless straight to the extension point (src/build-ext.js)
  const B = globalThis.window && window.__build,
    extend = B ? B.extend : globalThis.__buildExt && globalThis.__buildExt.extend;
  if (!extend) return;
  const posts = (h) => (h.data && h.data.posts) || [];
  extend({
    id: "xpost",
    describe(S, desc, h) {
      posts(h).forEach((p, n) => desc.extras.push({ kind: "xpost", id: h.pid(n), at: p, high: HIGH }));
    },
    pieces(S, out, h) {
      posts(h).forEach((p, n) => {
        const c = h.W2(p[0], p[1]);
        out.push({ ...h.head(h.pid(n), "post", "xpost", "timber"), a: c, b: c, y0: h.y0, y1: h.y0 + HIGH, height: HIGH, length: HIGH, thickness: 0.089 });
      });
    },
    tools: [
      {
        id: "xpost-tool",
        name: "Post",
        hint: "Click a floor to stand a post on it.",
        icon: '<path d="M10 4h4v16h-4z"/>',
        options(g, G_) {
          g.push(G_.info("Posts", "A 4 x 4 post, " + HIGH + " m"));
        },
        choose(key, v) {
          window.__xpostChosen = [key, v];
        },
        down(hover) {
          if (hover.F.isNew) return;
          const was = B.getExt(hover.F.id, "xpost") || { posts: [] };
          B.setExt(hover.F.id, "xpost", { posts: [...was.posts, [Math.round(hover.lx * 10) / 10, Math.round(hover.lz * 10) / 10]] });
        },
      },
    ],
  });
})();
