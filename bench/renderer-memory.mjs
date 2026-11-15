// Run after npm run build. PLAYWRIGHT_MODULE and CHROMIUM_PATH can select an
// existing installation. The benchmark includes GPU allocations and quality toggles.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--single-process', '--no-zygote', '--in-process-gpu',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => request((t) => { if (!window.freezeFrames) fn(t); });
  });
  const file = resolve(process.argv[2] || 'dist/index.html');
  await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fxInfo?.().installed);
  const result = await page.evaluate(() => {
    window.freezeFrames = true;
    const g = __game, renderer = g.renderer, gl = renderer.getContext();
    g.lockQuality();
    g.setSpeed(0);
    g.setQuality('high');
    g.step(0);
    g.render();
    // Hold visual effects still for a pixel comparison of quality round-trips.
    g.scene.onBeforeRender = () => {};
    function pixels() {
      g.render();
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    }
    function snapshot() {
      const c = g.composer();
      return {
        composer: [c.renderTarget1.width, c.renderTarget1.height],
        textures: renderer.info.memory.textures,
        canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    }
    const original = pixels(), high = snapshot();
    g.setQuality('low');
    pixels();
    const low = snapshot();
    let maxDifference = 0;
    const restoredTextures = [];
    for (let i = 0; i < 3; i++) {
      g.setQuality('high');
      const restored = pixels();
      for (let j = 0; j < original.length; j++) {
        maxDifference = Math.max(maxDifference, Math.abs(restored[j] - original[j]));
      }
      restoredTextures.push(snapshot().textures);
      g.setQuality('low');
      pixels();
    }
    return { high, low, maxDifference, restoredTextures,
      nonemptyImage: original.some((value, i) => i % 4 !== 3 && value > 0),
      fxError: __fxInfo().err, glError: gl.getError() };
  });
  assert.equal(result.nonemptyImage, true);
  assert.equal(result.maxDifference, 0, 'High must restore the same pixels');
  assert.deepEqual(result.restoredTextures, Array(3).fill(result.high.textures));
  assert.equal(result.fxError, null);
  assert.equal(result.glError, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
  // Explicitly exercise resizing while Low is active.
  await page.setViewportSize({ width: 960, height: 540 });
  const resized = await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    const c = __game.composer();
    const low = [c.renderTarget1.width, c.renderTarget1.height];
    __game.setQuality('high');
    __game.render();
    return { low, high: [c.renderTarget1.width, c.renderTarget1.height], error: __fxInfo().err };
  });
  assert.deepEqual(resized.high, [960, 540]);
  assert.equal(resized.error, null);
  if (process.env.EXPECT_LOW_RELEASE === '1') {
    assert.deepEqual(result.low.composer, [1, 1]);
    assert.deepEqual(resized.low, [1, 1]);
    assert.ok(result.low.textures < result.high.textures);
  }
  console.log('Resize and quality round-trips passed.');
} finally {
  await browser.close();
}
