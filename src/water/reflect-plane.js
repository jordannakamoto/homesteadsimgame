// Mirror reflections for the stream water near the player: the scene drawn again from below a level water plane,
// at half the screen's resolution, so the banks, the grass hanging over the edge, rocks and trees show in the water
// right where they meet it, upside down and in place (a cube map taken from one point cannot do that: it puts the
// surroundings at infinity, which is what made the water read as a flat painted plane).
//
// Streams step down in pools, so the plane is the level of the water nearest the player; the water shader uses
// the mirror only where its own surface is near that level (and within about 30 m), and the surroundings' cube map
// (reflect-probe.js) elsewhere. The mirror camera is clipped at the water plane (an oblique near plane, Lengyel's
// method, as in three's Reflector), so nothing under the water shows in it.
//
// Cost: one more draw of the scene a frame at a quarter of the pixels, with no shadow-map refresh and none of the
// water, spray or particles; only while there is stream water near.
import * as THREE from 'three';

export function createReflectPlane({ renderer, scene, hide = [], uniforms }) {
  // detail: how often, how sharp and how far (setDetail). The cheap one draws it every other frame (the last one
  // still maps onto the world correctly in between: it carries its own camera), at a sixth of the pixels, to 40 m
  let every = 2, scale = 0.4, far = 40, frame = 0;
  const target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
  target.texture.generateMipmaps = false;
  const cam = new THREE.PerspectiveCamera();
  const texMat = new THREE.Matrix4(), size = new THREE.Vector2(), _cc = new THREE.Color();
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4(), tgt = new THREE.Vector3(), view = new THREE.Vector3();
  const N = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  let on = false, level = 0;
  // (the uniforms are declared with the water's: uRefl, uReflMat, uReflOn = on, the plane's level, where it was centred)
  uniforms.uRefl.value = target.texture;
  uniforms.uReflMat.value = texMat;
  function update(camera, y, cx, cz) {
    if (!on) return;
    if (frame++ % every && Math.abs(y - level) < 0.05) return;
    level = y;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(16, Math.round(size.x * scale)), h = Math.max(16, Math.round(size.y * scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= level + 0.02) { uniforms.uReflOn.value.x = 0; return; }   // under the water: no mirror
    P.set(camPos.x, level, camPos.z);
    // mirror the camera's position and what it looks at through the plane
    view.subVectors(P, camPos).reflect(N).negate().add(P);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.subVectors(P, look).reflect(N).negate().add(P);
    cam.position.copy(view);
    cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N);
    cam.lookAt(tgt);
    cam.far = Math.min(camera.far, far); cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    // the camera's projection, with the far plane brought in (most of the scene's cost is in what lies far off)
    { const pe = cam.projectionMatrix.elements, n = cam.near, f = cam.far; pe[10] = -(f + n) / (f - n); pe[14] = -2 * f * n / (f - n); }
    cam.projectionMatrix.elements[8] *= -1; cam.projectionMatrix.elements[12] *= -1;
    texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane at the water
    plane.setFromNormalAndCoplanarPoint(N, P).applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = cam.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    // also anything at the top of the scene marked userData.noReflect (unlit specks such as the floating bugs,
    // which a reflection would spread into glaring smears)
    const extra = scene.children.filter((o) => o.userData.noReflect && o.visible);
    const vis = hide.map((m) => m.visible);
    for (const m of hide) m.visible = false;
    for (const o of extra) o.visible = false;
    // cleared to nothing (alpha 0): where the mirror drew nothing (past its far plane, the sky) the water shader
    // falls back to its other reflection instead of showing the clear colour
    renderer.setRenderTarget(target);
    const cc = renderer.getClearColor(_cc), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setClearColor(cc, ca);
    renderer.render(scene, cam);
    hide.forEach((m, i) => { m.visible = vis[i]; });
    for (const o of extra) o.visible = true;
    renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = prevAuto; renderer.xr.enabled = prevXr;
    uniforms.uReflOn.value.set(1, level, cx, cz);
  }
  return {
    update,
    setOn(v) { on = v; if (!v) uniforms.uReflOn.value.x = 0; },
    setDetail(full) { every = full ? 1 : 2; scale = full ? 0.5 : 0.4; far = full ? 1e9 : 40; frame = 0; },
    get on() { return on; },
  };
}
