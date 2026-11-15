// Full cooking loop through keyboard, pointer and UI events.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH may select existing browser installations.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { RECIPES, INGREDIENTS } from '../src/sim/food-catalog.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--single-process', '--no-zygote', '--in-process-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(pathToFileURL(process.cwd() + '/dist/index.html').href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.cooking && window.__build);
  const evaluate = (fn, arg) => page.evaluate(fn, arg);
  const step = (n = 70) => evaluate((n) => { for (let i = 0; i < n; i++) __game.step(1 / 60); }, n);
  await evaluate(() => {
    __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(0);
    window.drawCooking = __game.renderer.render.bind(__game.renderer);
    __game.renderer.render = () => {};
  });
  await page.keyboard.press('KeyK'); await step();
  assert.equal(await evaluate(() => __game.cooking.active), true, 'K opens the kitchen at spawn');
  const player = await evaluate(() => [__game.player.x, __game.player.z, __game.player.tool]);
  await page.keyboard.down('KeyW'); await page.keyboard.press('KeyB'); await step(10); await page.keyboard.up('KeyW');
  assert.deepEqual(await evaluate(() => [__game.player.x, __game.player.z, __game.player.tool]), player, 'cooking owns movement and build keys');

  // Hit the actual potato mesh, using its world-space center, rather than a label.
  const potato = await evaluate(() => {
    const root = __game.scene.getObjectByName('Homestead kitchen');
    const p = new __game.THREE.Vector3(-2.3, 1.47, -0.9);
    root.localToWorld(p); p.project(__game.camera);
    const r = __game.renderer.domElement.getBoundingClientRect();
    return [(p.x * 0.5 + 0.5) * r.width + r.left, (-p.y * 0.5 + 0.5) * r.height + r.top];
  });
  await page.mouse.click(...potato); await step(2);
  assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch.hand?.id), 'potato');
  await page.click('#kitchen-clear'); await step(2);

  for (const [id, recipe] of Object.entries(RECIPES)) {
    await page.selectOption('#kitchen-recipe', id); await step(2);
    for (const ingredient of Object.keys(recipe.ingredients)) {
      await page.click('[data-action="ingredient:' + ingredient + '"]'); await step(2);
      if (INGREDIENTS[ingredient].prep === 'chop') {
        await page.click('[data-action="board"]'); await step();
        assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch.hand.prepared), true);
      }
      await page.click('[data-action="vessel"]'); await step();
    }
    if (recipe.mix) { await page.click('[data-action="vessel"]'); await step(); }
    await page.click('[data-action="stove"]'); await step();
    assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch.status), 'cooking');
    await page.click('#kitchen-leave');
    assert.equal(await evaluate(() => __game.cooking.active), false);
    await evaluate(() => {
      __game.setSpeed(10);
      for (let i = 0; i < 1500 && __game.sim.state.sys.cooking.batch.status === 'cooking'; i++) __game.step(1 / 60);
      __game.setSpeed(0);
    });
    assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch.status), 'ready');
    await page.keyboard.press('KeyK'); await step();
    if (id === 'soup') {
      await evaluate(() => window.drawCooking(__game.scene, __game.camera));
      await page.screenshot({ path: 'dist/cooking-soup.png', timeout: 120000 });
    }
    await page.click('[data-action="stove"]'); await step(2);
    assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch), null);
    console.log('ok', recipe.name, 'prepares and cooks while away');
  }
  await page.click('#kitchen-meals'); await step(2);
  const before = await evaluate(() => __game.sim.state.sys.cooking.fullness);
  await page.click('[data-action="eat"]'); await step(2);
  assert.ok(await evaluate((before) => __game.sim.state.sys.cooking.fullness > before, before));
  await page.click('#meal-shelf [data-action="close"]');
  await page.click('#kitchen-leave');
  await evaluate(() => __game.saveGame());
  const saved = await evaluate(() => JSON.stringify(__game.sim.state.sys.cooking));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.cooking);
  await evaluate(() => {
    __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(0);
    window.drawCooking = __game.renderer.render.bind(__game.renderer);
    __game.renderer.render = () => {};
  });
  const restored = await evaluate(() => JSON.stringify(__game.sim.state.sys.cooking));
  // Clock can advance between reload and pause. Meal custody and station must persist exactly.
  const a = JSON.parse(saved), b = JSON.parse(restored);
  assert.deepEqual(b.meals, a.meals); assert.deepEqual(b.station, a.station); assert.deepEqual(b.learned, a.learned);
  await page.setViewportSize({ width: 540, height: 900 });
  await page.keyboard.press('KeyK'); await step();
  assert.equal(await evaluate(() => __game.cooking.active), true);
  await page.selectOption('#kitchen-recipe', 'eggs'); await step(2);
  await page.click('[data-action="ingredient:egg"]'); await step(2);
  assert.equal(await evaluate(() => __game.sim.state.sys.cooking.batch.hand.id), 'egg');
  await page.click('[data-action="vessel"]'); await step();
  await evaluate(() => window.drawCooking(__game.scene, __game.camera));
  await page.screenshot({ path: 'dist/cooking-mobile.png', timeout: 120000 });
  await page.click('#kitchen-leave');
  assert.deepEqual(errors, []);
  console.log('ok hunger, meals, reload, mobile interaction and no page errors');
} finally {
  await browser.close();
}
