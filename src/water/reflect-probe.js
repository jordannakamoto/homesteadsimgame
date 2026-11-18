// What the streams reflect: a small cube map of the real surroundings (banks, grass, trees, buildings, sky), taken
// from just above the water near the player, so reflections carry the colours actually round the stream instead of
// a made-up sky and tree line.
//
// It never changes in a jump: there are two cube maps. The one being shown stays whole while the other is redrawn a
// face a frame out of sight; when all six faces are done the water fades over to it (a third of a second), and the
// next one starts. The point it is taken from glides after the player rather than snapping.
//
// Cost: 128 px faces, one face drawn a frame, only what is within 90 m, no shadow-map refresh for it, and none of
// the water itself, its spray or the particles. The water shader blurs it with its mip levels.
import * as THREE from 'three';

export function createReflectProbe({ renderer, scene, hide = [], uniforms }) {
  const SIZE = 128;
  const mk = () => new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const targets = [mk(), mk()];
  // its near plane is 2.5 m out: what is right beside the probe (the bank you stand on, lit by your light) is not
  // what water further off would reflect
  const cube = new THREE.CubeCamera(2.5, 90, targets[0]);
  let face = 0, on = false, fresh = true, back = 1, fade = 1, every = 4, tick = 0;
  const pos = new THREE.Vector3(), want = new THREE.Vector3();
  // uniforms.uEnv shows targets[shown], uEnv2 the other; uEnvMix fades from the first to the second
  let shown = 0;
  function draw(t, f) {
    renderer.setRenderTarget(t, f);
    renderer.render(scene, cube.children[f]);
  }
  function update(dt, px, py, pz) {
    if (!on) return;
    want.set(px, py, pz);
    if (fresh) pos.copy(want); else pos.lerp(want, 1 - Math.exp(-dt * 1.5));
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    const vis = hide.map((m) => m.visible);
    for (const m of hide) m.visible = false;
    cube.position.copy(pos); cube.updateMatrixWorld(true);
    if (fresh) {
      // the first time: both maps at once, shown at once
      for (let f = 0; f < 6; f++) { draw(targets[0], f); draw(targets[1], f); }
      fresh = false; face = 0; fade = 1; shown = 0; back = 1;
    } else if (fade >= 1 && tick++ % every === 0) {
      draw(targets[back], face);
      face++;
      if (face === 6) { face = 0; fade = 0; }               // the back map is whole: fade over to it
    }
    hide.forEach((m, i) => { m.visible = vis[i]; });
    renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = prevAuto; renderer.xr.enabled = prevXr;
    if (fade < 1) {
      fade = Math.min(1, fade + dt * 3);
      if (fade >= 1) { shown = back; back = 1 - back; }
    }
    uniforms.uEnv.value = targets[shown].texture;
    uniforms.uEnv2.value = targets[fade < 1 ? back : shown].texture;
    uniforms.uEnvMix.value = fade < 1 ? fade : 0;
  }
  return {
    update,
    setOn(v) { if (on !== v) { on = v; if (!v) fresh = true; } },
    // cheap: a face every fourth frame and only to 60 m; full: a face every frame, to 90 m
    setDetail(full) { every = full ? 1 : 4; for (const c of cube.children) { c.far = full ? 90 : 60; c.updateProjectionMatrix(); } },
    get on() { return on; },
  };
}
