// What the streams reflect: a small cube map of the real surroundings (banks, grass, trees, buildings, sky), taken
// from just above the water near the player, so reflections carry the colours actually round the stream instead of
// a made-up sky and tree line.
//
// Cost is kept small: 128 px faces, one face drawn a frame (the whole cube refreshes six times a second at 36 fps
// and faster above), only what is within 90 m, no shadow-map refresh for it, and none of the water itself, its
// spray or the particles. The water shader blurs it with its mip levels where the surface is rough.
import * as THREE from 'three';

export function createReflectProbe({ renderer, scene, hide = [] }) {
  const SIZE = 128;
  const target = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cube = new THREE.CubeCamera(0.1, 90, target);
  let face = 0, on = false, warm = 0;
  const pos = new THREE.Vector3();
  function update(px, py, pz) {
    if (!on) return;
    // move in whole steps, so the reflection does not swim as you walk
    pos.set(Math.round(px), py, Math.round(pz));
    cube.position.copy(pos);
    cube.updateMatrixWorld(true);
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    const vis = hide.map((m) => m.visible);
    for (const m of hide) m.visible = false;
    // the first time, all six faces; after that one a frame
    const n = warm < 1 ? 6 : 1;
    for (let k = 0; k < n; k++) {
      renderer.setRenderTarget(target, face);
      renderer.render(scene, cube.children[face]);
      face = (face + 1) % 6;
    }
    warm = 1;
    hide.forEach((m, i) => { m.visible = vis[i]; });
    renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = prevAuto; renderer.xr.enabled = prevXr;
  }
  return {
    texture: target.texture, update,
    setOn(v) { on = v; if (!v) warm = 0; },
    get on() { return on; },
  };
}
