// Run after npm run build. All manipulation uses browser pointer/keyboard events.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--single-process",
    "--no-zygote",
    "--in-process-gpu",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(pathToFileURL(process.cwd() + "/dist/index.html").href, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => window.__game?.cooking?.ready,
    {},
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    __game.lockQuality();
    __game.setQuality("low");
    __game.setSpeed(0);
    window.drawKitchen = __game.renderer.render.bind(__game.renderer);
    __game.renderer.render = () => {};
  });
  const step = async (n = 70) =>
    page.evaluate((n) => {
      for (let i = 0; i < n; i++) __game.step(1 / 60);
    }, n);
  const state = () =>
    page.evaluate(() =>
      JSON.parse(JSON.stringify(__game.sim.state.sys.physicalKitchen)),
    );
  await page.keyboard.press("KeyK");
  await step(120);
  assert.equal(await page.evaluate(() => __game.cooking.active), true);
  assert.equal(await page.locator("#physical-kitchen-ui button").count(), 0);
  async function screen(p) {
    return page.evaluate((p) => {
      const v = new __game.THREE.Vector3(p.x, p.y, p.z),
        root = __game.scene.getObjectByName("Homestead kitchen");
      root.localToWorld(v);
      v.project(__game.camera);
      return {
        x: ((v.x + 1) * innerWidth) / 2,
        y: ((1 - v.y) * innerHeight) / 2,
      };
    }, p);
  }
  async function begin(id) {
    const o = (await state()).objects.find((o) => o.id === id),
      at = await screen(o.p);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await step(35);
    assert.equal((await state()).held, id, "grab actual mesh");
    return page
      .evaluate((at) => {
        const T = __game.THREE,
          root = __game.scene.getObjectByName("Homestead kitchen"),
          ray = new T.Raycaster();
        ray.setFromCamera(
          new T.Vector2(
            (at.x / innerWidth) * 2 - 1,
            1 - (at.y / innerHeight) * 2,
          ),
          __game.camera,
        );
        const p = new T.Vector3();
        ray.ray.intersectPlane(
          new T.Plane(new T.Vector3(0, 1, 0), -(root.position.y + 0.15)),
          p,
        );
        return { x: p.x - root.position.x, z: p.z - root.position.z };
      }, at)
      .then((p) => ({ x: o.p.x - p.x, z: o.p.z - p.z }));
  }
  async function dragTo(offset, p) {
    const at = await screen({ x: p.x - offset.x, y: 0.15, z: p.z - offset.z });
    await page.mouse.move(at.x, at.y, { steps: 12 });
    await step(90);
    return at;
  }
  let st = await state(),
    knife = st.objects.find((o) => o.kind === "knife"),
    carrot = st.objects.find((o) => o.kind === "carrot");
  const knifeOffset = await begin(knife.id);
  await dragTo(knifeOffset, { x: carrot.p.x + 0.1, z: carrot.p.z });
  await page.mouse.down({ button: "right" });
  await step(45);
  await page.mouse.up({ button: "right" });
  await step(30);
  assert.equal(
    (await state()).cuts,
    1,
    "right-mouse blade stroke cuts at actual location",
  );
  await dragTo(knifeOffset, { x: -1.3, z: 0.8 });
  await page.mouse.up();
  await step(90);
  console.log("ok actual knife drag creates two independent cut solids");
  st = await state();
  const pan = st.objects.find((o) => o.kind === "pan");
  for (const piece of st.objects.filter((o) => o.kind === "carrot")) {
    const offset = await begin(piece.id);
    await dragTo(offset, { x: pan.p.x, z: pan.p.z });
    await page.mouse.up();
    await step(90);
  }
  const panOffset = await begin(pan.id);
  await dragTo(panOffset, { x: 1.72, z: -0.25 });
  await page.mouse.up();
  await step(150);
  st = await state();
  const movedPan = st.objects.find((o) => o.kind === "pan");
  assert.ok(Math.abs(movedPan.p.x - 1.72) < 0.08);
  assert.ok(
    st.objects
      .filter((o) => o.kind === "carrot")
      .every(
        (o) => Math.hypot(o.p.x - movedPan.p.x, o.p.z - movedPan.p.z) < 0.5,
      ),
    "pan carries the pieces",
  );
  const dial = await screen({ x: 1.94, y: 0.25, z: 0.27 });
  await page.mouse.move(dial.x, dial.y);
  await page.mouse.down();
  await page.mouse.move(dial.x, dial.y - 140, { steps: 8 });
  await page.mouse.up();
  assert.ok((await state()).power > 0.9);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => __game.cooking.active), false);
  await page.evaluate(() => {
    __game.setSpeed(10);
    for (let i = 0; i < 240; i++) __game.step(1 / 60);
    __game.setSpeed(0);
  });
  st = await state();
  assert.ok(Math.max(...st.grid) > 100, "pan heats unattended");
  assert.ok(
    Math.max(...st.grid) - Math.min(...st.grid.filter((t) => t > 20)) > 20,
    "off-center pan heats unevenly",
  );
  await page.keyboard.press("KeyK");
  await step();
  await page.keyboard.press("KeyH");
  await step(2);
  await page.evaluate(() => window.drawKitchen(__game.scene, __game.camera));
  await page.screenshot({
    path: "dist/physical-kitchen-heat.png",
    timeout: 120000,
  });
  await page.keyboard.press("KeyH");
  await step(2);
  await page.evaluate(() => window.drawKitchen(__game.scene, __game.camera));
  await page.screenshot({ path: "dist/physical-kitchen.png", timeout: 120000 });
  // Turn the physical dial off, plate a cooked piece and eat it through the
  // same keyboard interaction available to a player.
  await page.mouse.move(dial.x, dial.y);
  await page.mouse.down();
  await page.mouse.move(dial.x, dial.y + 140, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state()).power, 0);
  const mealPiece = (await state()).objects.filter(o => o.kind === 'carrot').sort((a,b) => a.burn-b.burn)[0];
  assert.ok(mealPiece.cooked >= 0.8 && mealPiece.burn < 0.6, 'food actually cooked');
  const mealOffset = await begin(mealPiece.id);
  await dragTo(mealOffset, { x: 0.05, z: 0.8 });
  await page.mouse.up(); await step(120);
  const fullness = await page.evaluate(() => __game.sim.state.sys.cooking.fullness);
  await page.keyboard.press('KeyE'); await step(2);
  assert.ok(!(await state()).objects.some(o => o.id === mealPiece.id), 'plated food consumed');
  assert.ok(await page.evaluate(before => __game.sim.state.sys.cooking.fullness > before, fullness));
  console.log('ok cooked food can be plated and eaten without a recipe UI');
  const before = await state();
  await page.keyboard.press("Escape");
  await page.evaluate(() => __game.saveGame());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__game?.cooking?.ready,
    {},
    { timeout: 120000 },
  );
  const after = await state();
  assert.equal(after.cuts, before.cuts);
  assert.equal(after.objects.length, before.objects.length);
  assert.deepEqual(
    after.objects.filter((o) => o.kind === "carrot").map((o) => o.faces),
    before.objects.filter((o) => o.kind === "carrot").map((o) => o.faces),
  );
  assert.deepEqual(errors, []);
  console.log(
    "ok hollow pan, stove dial, localized unattended heat and save/reload; no page errors",
  );
} finally {
  await browser.close();
}
