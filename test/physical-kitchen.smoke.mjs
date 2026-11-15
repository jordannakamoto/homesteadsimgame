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
      grip =
        o.kind === "pan"
          ? await page.evaluate((o) => {
              const offset = new __game.THREE.Vector3(0, 0.05, 0.83);
              offset.applyQuaternion(
                new __game.THREE.Quaternion(o.q.x, o.q.y, o.q.z, o.q.w),
              );
              return {
                x: o.p.x + offset.x,
                y: o.p.y + offset.y,
                z: o.p.z + offset.z,
              };
            }, o)
          : o.p,
      at = await screen(grip);
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
  const knifeAt = await screen(knife.p);
  await page.mouse.click(knifeAt.x, knifeAt.y);
  const cutAt = await screen({ x: carrot.p.x + 0.1, y: 0.15, z: carrot.p.z });
  await page.mouse.click(cutAt.x, cutAt.y);
  await step(80);
  assert.equal(
    (await state()).cuts,
    1,
    "click creates a physical knife stroke",
  );
  const restAt = await screen({ x: -0.85, y: 0.15, z: 0.78 });
  await page.mouse.move(restAt.x, restAt.y);
  await step(35);
  await page.mouse.click(restAt.x, restAt.y, { button: "right" });
  await step(90);
  st = await state();
  const pan = st.objects.find((o) => o.kind === "pan");
  const board = await screen({ x: -1.58, y: 0.04, z: 0.34 });
  await page.mouse.move(board.x, board.y);
  await page.mouse.down();
  assert.equal(
    Object.keys((await state()).group || {}).length,
    1,
    "board drag gathers both slices",
  );
  const panCenter = await screen({ ...pan.p, y: 0.15 });
  await page.mouse.move(panCenter.x, panCenter.y);
  await page.mouse.up();
  await step(120);
  console.log("ok click-to-cut and quick board-to-pan transfer");
  const panOffset = await begin(pan.id);
  await dragTo(panOffset, { x: 1.58, z: -0.25 });
  await page.mouse.up();
  await step(150);
  st = await state();
  const movedPan = st.objects.find((o) => o.kind === "pan");
  assert.ok(Math.abs(movedPan.p.x - 1.58) < 0.08);
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
    for (let i = 0; i < 1200; i++) {
      __game.step(1 / 60);
      if (
        __game.sim.state.sys.physicalKitchen.objects
          .filter((o) => o.kind === "carrot")
          .every((o) => o.cooked >= 0.8 && o.burn < 0.6)
      )
        break;
    }
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
  const smokeVisible = await page.evaluate(
    () => __game.scene.getObjectByName("Kitchen smoke").visible,
  );
  assert.ok(smokeVisible, "hot food emits visible smoke");
  const fullness = await page.evaluate(
    () => __game.sim.state.sys.cooking.fullness,
  );
  await begin(pan.id);
  const plate = await screen({ x: 0.05, y: 0.025, z: 0.8 });
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.up();
  await step(120);
  assert.match(
    await page.locator("#physical-kitchen-readout").textContent(),
    /Meal ready/,
  );
  assert.equal(
    (await state()).objects.filter((o) => o.kind === "carrot").length,
    0,
  );
  assert.equal(
    await page.evaluate(() => __game.sim.state.sys.cooking.fullness),
    fullness,
  );
  console.log("ok smoke and plating into inventory");
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
  assert.equal(
    await page.evaluate(() => __game.sim.state.sys.cooking.meals[0]?.recipe),
    "panCarrots",
  );
  await page.keyboard.press("KeyI");
  await page.getByText("Pan-cooked carrots × 1").waitFor();
  await page.locator('[data-act="eat-meal"]').click();
  assert.equal(
    await page.evaluate(() => __game.sim.state.sys.cooking.meals.length),
    0,
  );
  assert.ok(
    await page.evaluate(
      (before) => __game.sim.state.sys.cooking.fullness > before,
      fullness,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "ok hollow pan, stove dial, localized unattended heat and save/reload; no page errors",
  );
} finally {
  await browser.close();
}
