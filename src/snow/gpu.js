// Off-screen plumbing for small GPU windows that follow the player: what the graphics card can do, render targets,
// drawing into one with the renderer's state put back afterwards, and the maths of toroidal windows (a texture
// addressed by world position modulo its size, so moving the window never copies anything: only the strip that came
// into view is written). Generic: no game words. three is passed in (add-ons never import it).

// What this renderer can do. `soft`: a software renderer (SwiftShader, llvmpipe: headless tests, machines with no
// usable GPU), where off-screen work runs on the CPU at a few frames a second; localStorage[forceKey] = 'force'
// treats it as a GPU (tests that need the full path), 'off' never uses the GPU path.
export function gpuCaps(renderer, forceKey) {
  const gl = renderer.getContext();
  const webgl2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2) || (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
  const half = webgl2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  let soft = false, force = '';
  try { const di = gl.getExtension('WEBGL_debug_renderer_info'); soft = /swiftshader|llvmpipe|software/i.test(di ? gl.getParameter(di.UNMASKED_RENDERER_WEBGL) : ''); } catch (e) { /* unknown: assume a GPU */ }
  try { force = (forceKey && localStorage.getItem(forceKey)) || ''; } catch (e) { /* no storage */ }
  if (force === 'force') soft = false;
  return { webgl2, half, soft, ok: webgl2 && half && !soft && force !== 'off', force };
}

// A square RGBA16F target, repeat-wrapped (toroidal), optionally with trilinear mips (three regenerates them after
// each render into it, so draw everything for a frame in one render call).
export function makeTarget(T, n, { mips = false, filter = true } = {}) {
  const t = new T.WebGLRenderTarget(n, n, {
    type: T.HalfFloatType, format: T.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: mips ? T.LinearMipmapLinearFilter : filter ? T.LinearFilter : T.NearestFilter,
    magFilter: filter ? T.LinearFilter : T.NearestFilter, wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping,
    generateMipmaps: mips,
  });
  t.texture.generateMipmaps = mips;
  t.texture.wrapS = t.texture.wrapT = T.RepeatWrapping;
  return t;
}

// Draw `scene` into `target` with `cam`, then put the renderer back exactly as it was (render target, autoClear,
// clear colour and alpha), so the frame's own drawing, the post composer included, never notices. clear: null to
// keep what is there, or [r, g, b, a] to clear first.
export function drawTo(T, renderer, target, scene, cam, clear = null) {
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  const cc = renderer.getClearColor(new T.Color()), ca = renderer.getClearAlpha();
  const xr = renderer.xr && renderer.xr.enabled;
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  if (clear) { renderer.setClearColor(new T.Color(clear[0], clear[1], clear[2]), clear[3]); renderer.clear(true, false, false); }
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(cc, ca);
  renderer.autoClear = prevAuto;
  if (renderer.xr) renderer.xr.enabled = xr;
}

// Toroidal window maths. Cells are world / cell, floored; a cell lives at texel mod(cell, n).
export const tmod = (i, n) => ((i % n) + n) % n;
// The cell index range [c0, c0 + n) of a window of n cells centred as near as possible on world p.
export const winStart = (p, cell, n) => Math.floor(p / cell) - (n >> 1);
// Calls fn(i0, i1) for each run of cell indices in [a0, a0 + n) that is not in [b0, b0 + n) (what a move uncovers).
export function uncovered(a0, b0, n, fn) {
  if (b0 == null || Math.abs(a0 - b0) >= n) { fn(a0, a0 + n); return; }
  if (a0 > b0) fn(b0 + n, a0 + n); else if (a0 < b0) fn(a0, b0);
}
