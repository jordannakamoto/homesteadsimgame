/* Bridge for the fx add-on (src/fx.js): builds the window.__fxHost object it expects from window.__game,
   and gives it a once-per-frame hook that runs just before the scene is drawn. */
(() => {
  const G = window.__game;
  if (!G || !G.scene) return;
  const scene = G.scene;
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const q = { get level() { return G.quality(); } };
  const hooks = [];
  let last = -1;
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (...a) {
    const now = performance.now();
    // the composer and the extra passes can draw the scene more than once a frame; run the hooks once
    if (now - last > 4) {
      last = now;
      for (const f of hooks) {
        try { f(); } catch (e) { console.warn('fx hook', e); }
      }
    }
    if (prev) prev.apply(this, a);
  };
  window.__fxHost = {
    jp: G.THREE, yi: G.renderer, oe: scene, hn: G.camera, en: sun, Se: G.heightAt, jn: -100, ar: q, dt: G.cam,
    get Nt() { return G.world; }, get nt() { return G.player; }, get ji() { return G.composer(); }, get Ts() { return G.seed; },
    hook(f) { hooks.push(f); },
  };
})();
