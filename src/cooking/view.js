import { RECIPES } from "../sim/food-catalog.js";
import {
  initKitchenPhysics,
  GRID,
  PAN_R,
  BURNER,
  PLATE,
  cellPoint,
  validCell,
} from "../sim/physical-kitchen.js";

// Direct manipulation only: picking/raycasting changes simulation commands.
// Rendering never owns ingredient custody, cut geometry, poses or temperatures.
export function createCookingView(G) {
  const T = G.THREE,
    canvas = G.renderer.domElement,
    root = new T.Group();
  root.name = "Homestead kitchen";
  G.scene.add(root);
  const bodies = new Map(),
    targets = [],
    materials = new Map();
  const box = new T.BoxGeometry(1, 1, 1),
    cylinder = new T.CylinderGeometry(1, 1, 1, 24),
    ring = new T.TorusGeometry(1, 0.04, 5, 24);
  const ray = new T.Raycaster(),
    pointer = new T.Vector2(),
    plane = new T.Plane(),
    point = new T.Vector3();
  const cameraGoal = new T.Vector3(),
    lookGoal = new T.Vector3();
  let active = false,
    loading = true,
    error = "",
    stationKey = "",
    boundSim = null,
    boundState = null,
    drag = null,
    hover = null,
    knife = null,
    stroke = null,
    heatMap = false,
    wasVisible = true,
    oldFov = 55;
  let staticGroup = null,
    knob = null,
    burner = null,
    gridMesh = null,
    plateRim = null,
    notice = "",
    noticeUntil = 0,
    lastPanel = "";
  const state = () => G.sim.state.sys.physicalKitchen,
    cooking = () => G.sim.state.sys.cooking;
  const $ = (id) => document.getElementById(id);
  const ui = document.createElement("section");
  ui.id = "physical-kitchen-ui";
  ui.hidden = true;
  ui.innerHTML =
    '<div class="kitchen-title">Homestead kitchen <small>Esc · leave</small></div><div id="physical-kitchen-readout"></div><div class="kitchen-instructions">Click knife to pick it up · Click food to cut · Right-click to put knife down<br>Drag board or Shift-drag food to gather · Drag pan onto plate to serve · E · eat packed meal · H · heat view</div>';
  const style = document.createElement("style");
  style.textContent = `
    #physical-kitchen-ui{position:fixed;inset:0;z-index:34;pointer-events:none;color:#fff0d4;font:14px system-ui}
    #physical-kitchen-ui[hidden]{display:none}.kitchen-title{position:absolute;top:18px;left:50%;transform:translateX(-50%);font-size:20px;background:#203027e8;padding:12px 20px;border-radius:8px;white-space:nowrap}.kitchen-title small{font-size:12px;margin-left:18px;color:#c5cbb7}
    .kitchen-instructions{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);width:max-content;max-width:90vw;text-align:center;background:#203027ee;padding:12px 18px;border-radius:8px;line-height:1.6}
    #physical-kitchen-readout{position:absolute;top:85px;left:50%;transform:translateX(-50%);background:#203027e8;padding:8px 14px;border-radius:6px;text-align:center;white-space:pre-line}
    body.cooking-active #status,body.cooking-active #tools,body.cooking-active #lock,body.cooking-active #help,body.cooking-active #stance,body.cooking-active #reticle,body.cooking-active #svbar,body.cooking-active #touch{display:none!important}
    #hungerbar{background:#c3a65d}body.cooking-active canvas{cursor:grab}
    @media(max-width:700px){.kitchen-instructions{font-size:11px;bottom:8px}.kitchen-title{font-size:15px}body.cooking-active #vitals{display:none}}
  `;
  document.head.append(style);
  document.body.append(ui);
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML =
    '<span class="label">Hunger</span><div class="track" role="progressbar" aria-label="Fullness" aria-valuemin="0" aria-valuemax="100"><div class="fill" id="hungerbar"></div></div>';
  $("vitals").append(bar);
  const entry = document.createElement("span");
  entry.textContent = " · K: kitchen";
  $("status").append(entry);
  const mealName = (meal) =>
    meal.recipe === "panCarrots"
      ? "Pan-cooked carrots"
      : RECIPES[meal.recipe].name;
  const freshMeal = () =>
    cooking().meals.find((meal) => meal.expiresAt > G.sim.state.t);
  const smokeCanvas = document.createElement("canvas");
  smokeCanvas.width = smokeCanvas.height = 32;
  const ctx = smokeCanvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  gradient.addColorStop(0, "#ffffffaa");
  gradient.addColorStop(1, "#ffffff00");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const smokeTexture = new T.CanvasTexture(smokeCanvas);
  const smoke = Array.from({ length: 6 }, () => {
    const puff = new T.Sprite(
      new T.SpriteMaterial({ map: smokeTexture, depthWrite: false }),
    );
    puff.name = "Kitchen smoke";
    puff.visible = false;
    root.add(puff);
    return puff;
  });
  initKitchenPhysics()
    .then(() => {
      loading = false;
    })
    .catch((e) => {
      loading = false;
      error = "Kitchen physics failed to load: " + e.message;
    });
  function say(text) {
    notice = text;
    noticeUntil = performance.now() + 4500;
  }
  function command(name, payload = {}) {
    const result = G.sim.commandNow("kitchen." + name, payload);
    if (!result.ok) say(result.reason);
    if (["carrot", "eat", "discard"].includes(name)) G.markStockDirty();
    return result;
  }
  function material(color) {
    if (!materials.has(color))
      materials.set(color, new T.MeshLambertMaterial({ color }));
    return materials.get(color);
  }
  function part(parent, geometry, color, x, y, z, sx, sy, sz) {
    const mesh = new T.Mesh(geometry, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const block = (g, c, x, y, z, w, h, d) => part(g, box, c, x, y, z, w, h, d);
  function tag(object, id) {
    object.userData.kitchenId = id;
    targets.push(object);
    return object;
  }
  function ground(x, z) {
    const h = G.heightAt(x, z);
    return window.__build ? window.__build.ground(x, z, G.player.y, h) : h;
  }
  function place() {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        x = G.player.x + Math.sin(a) * 4.5,
        z = G.player.z - Math.cos(a) * 4.5;
      const ys = [
        [-2.6, -1.25],
        [2.6, -1.25],
        [-2.6, 1.25],
        [2.6, 1.25],
        [0, 0],
      ].map(([dx, dz]) => ground(x + dx, z + dz));
      const low = Math.min(...ys),
        high = Math.max(...ys);
      if (low < 0.3 || high - low > 2) continue;
      if (!best || high - low < best.spread)
        best = { x, y: high, z, spread: high - low };
    }
    if (!best) {
      say("Find a dry level patch for the workbench.");
      return false;
    }
    return G.sim.commandNow("cooking.place", { kind: "stove", ...best }).ok;
  }
  function open() {
    if (active) {
      close();
      return;
    }
    if (loading || error) {
      say(error || "Kitchen physics is loading. Press K again in a moment.");
      return;
    }
    if (G.player.dead > 0 || G.player.tool === "build") return;
    if (!cooking().station && !place()) return;
    const s = cooking().station;
    if (Math.hypot(G.player.x - s.x, G.player.z - s.z) > 7) {
      say("Walk back to your kitchen.");
      return;
    }
    // Refund only untouched/prepared legacy ingredients. Existing cooked meals remain saved.
    if (cooking().batch?.status === "prep") G.sim.commandNow("cooking.clear");
    const first = !state().initialized;
    if (!command("setup").ok) return;
    if (first) command("carrot");
    active = true;
    ui.hidden = false;
    document.body.classList.add("cooking-active");
    oldFov = G.camera.fov;
    wasVisible = G.pm.root.visible;
    G.pm.root.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const key in G.keys) G.keys[key] = false;
    G.mouse.left = G.mouse.right = false;
    G.player.aiming = false;
    G.player.charging = null;
    G.player.atk = null;
    if ($("sv")) $("sv").hidden = true;
    update(0);
  }
  function close() {
    if (!active) return;
    command("release");
    drag = knife = stroke = null;
    hover = null;
    active = false;
    ui.hidden = true;
    document.body.classList.remove("cooking-active");
    G.pm.root.visible = wasVisible;
    G.camera.fov = oldFov;
    G.camera.updateProjectionMatrix();
    for (const key in G.keys) G.keys[key] = false;
    G.mouse.left = G.mouse.right = false;
    canvas.focus();
    G.refreshLock();
  }
  function makeStatic() {
    if (staticGroup) {
      root.remove(staticGroup);
      burner?.material.dispose();
    }
    staticGroup = new T.Group();
    root.add(staticGroup);
    targets.length = 0;
    block(staticGroup, 0x876643, 0, -0.08, 0, 5.2, 0.16, 2.5);
    for (const x of [-2.4, 2.4])
      for (const z of [-1.05, 1.05]) {
        const floor =
            ground(root.position.x + x, root.position.z + z) - root.position.y,
          h = Math.max(0.3, -floor);
        block(staticGroup, 0x55412d, x, -h / 2, z, 0.13, h, 0.13);
      }
    block(staticGroup, 0x705238, 0, -0.65, 0, 6, 0.08, 3.6);
    tag(
      block(staticGroup, 0xb58a52, -1.25, 0.02, 0, 1.44, 0.04, 0.98),
      "board",
    );
    // A smooth hob allows arbitrary pan placement, including partial overlap.
    block(staticGroup, 0x394440, 1.4, 0.08, -0.25, 1.4, 0.16, 1.32);
    burner = part(
      staticGroup,
      cylinder,
      0x332f2a,
      BURNER.x,
      0.165,
      BURNER.z,
      BURNER.r,
      0.008,
      BURNER.r,
    );
    burner.material = new T.MeshLambertMaterial({
      color: 0x332f2a,
      emissive: 0x000000,
    });
    for (const r of [0.11, 0.21, 0.31]) {
      const coil = part(
        staticGroup,
        ring,
        0x635c4d,
        1.4,
        0.173,
        -0.25,
        r,
        r,
        r,
      );
      coil.rotation.x = Math.PI / 2;
    }
    knob = new T.Group();
    knob.position.set(1.94, 0.2, 0.27);
    staticGroup.add(knob);
    tag(knob, "dial");
    part(knob, cylinder, 0x171f1c, 0, 0, 0, 0.105, 0.085, 0.105);
    block(knob, 0xe4d2a7, 0, 0.05, -0.04, 0.018, 0.012, 0.07);
    const basket = new T.Group();
    basket.position.set(-2.03, 0, -0.83);
    staticGroup.add(basket);
    tag(basket, "basket");
    block(basket, 0x6f5232, 0, 0.05, 0, 0.65, 0.1, 0.45);
    for (const z of [-0.23, 0.23])
      block(basket, 0x947049, 0, 0.14, z, 0.68, 0.12, 0.035);
    for (const x of [-0.33, 0.33])
      block(basket, 0x947049, x, 0.14, 0, 0.035, 0.12, 0.45);
    for (let i = 0; i < 3; i++) {
      const carrot = part(
        basket,
        cylinder,
        0xd97922,
        0,
        0.17,
        (i - 1) * 0.12,
        0.055,
        0.5,
        0.055,
      );
      carrot.rotation.z = Math.PI / 2;
      block(basket, 0x577b37, -0.29, 0.17, (i - 1) * 0.12, 0.12, 0.03, 0.04);
    }
    const plate = new T.Group();
    plate.position.set(0.05, 0, 0.8);
    staticGroup.add(plate);
    part(plate, cylinder, 0xd2cfb3, 0, 0.008, 0, 0.36, 0.015, 0.36);
    const rim = part(plate, ring, 0xe6dfc3, 0, 0.025, 0, 0.34, 0.34, 0.34);
    rim.rotation.x = Math.PI / 2;
    plateRim = rim;
    for (const mesh of bodies.values()) targets.push(mesh);
  }
  function foodMesh(o) {
    const vertices = [],
      colors = [],
      base = new T.Color(0xe88b2d),
      cut = new T.Color(0xf9ad51);
    for (const face of o.faces) {
      let f = face.slice();
      const a = new T.Vector3(...f[0]),
        b = new T.Vector3(...f[1]),
        c = new T.Vector3(...f[2]);
      const normal = b.sub(a).cross(c.sub(a)),
        center = new T.Vector3();
      for (const p of f) center.add(new T.Vector3(...p));
      if (normal.dot(center) < 0) f.reverse();
      const color = Math.abs(normal.clone().normalize().x) > 0.7 ? cut : base;
      for (let i = 1; i < f.length - 1; i++)
        for (const p of [f[0], f[i], f[i + 1]]) {
          vertices.push(...p);
          colors.push(color.r, color.g, color.b);
        }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new T.Mesh(
      geo,
      new T.MeshLambertMaterial({ vertexColors: true }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.owned = true;
    return mesh;
  }
  function makeBody(o) {
    let mesh;
    if (o.kind === "carrot") mesh = foodMesh(o);
    else {
      mesh = new T.Group();
      if (o.kind === "knife") {
        block(mesh, 0xb7c4c3, 0, 0, 0, 0.036, 0.18, 0.56);
        block(mesh, 0x473327, 0, 0.02, 0.41, 0.09, 0.08, 0.32);
      }
      if (o.kind === "pan") {
        part(mesh, cylinder, 0x353c3b, 0, 0, 0, PAN_R, 0.05, PAN_R);
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          const wall = block(
            mesh,
            0x4b5350,
            Math.sin(a) * PAN_R,
            0.09,
            Math.cos(a) * PAN_R,
            0.2,
            0.18,
            0.05,
          );
          wall.rotation.y = a;
        }
        block(mesh, 0x3e3025, 0, 0.05, 0.74, 0.16, 0.07, 0.6);
        gridMesh = new T.InstancedMesh(
          new T.PlaneGeometry(0.102, 0.102),
          new T.MeshBasicMaterial({ side: T.DoubleSide }),
          GRID * GRID,
        );
        const dummy = new T.Object3D();
        dummy.rotation.x = -Math.PI / 2;
        for (let i = 0; i < GRID * GRID; i++) {
          const p = cellPoint(i);
          dummy.position.set(p[0], 0.028, p[2]);
          dummy.scale.setScalar(validCell(i) ? 1 : 0);
          dummy.updateMatrix();
          gridMesh.setMatrixAt(i, dummy.matrix);
        }
        gridMesh.visible = heatMap;
        mesh.add(gridMesh);
      }
    }
    mesh.name = "Kitchen " + o.kind + " " + o.id;
    tag(mesh, o.id);
    root.add(mesh);
    bodies.set(o.id, mesh);
  }
  function pick(event) {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      (-(event.clientY - r.top) / r.height) * 2 + 1,
    );
    root.updateMatrixWorld(true);
    ray.setFromCamera(pointer, G.camera);
    const hit = ray.intersectObjects(targets, true)[0];
    let node = hit?.object;
    while (node && !Object.hasOwn(node.userData, "kitchenId"))
      node = node.parent;
    return node?.userData.kitchenId;
  }
  function tabletop(event) {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      (-(event.clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, G.camera);
    plane.set(new T.Vector3(0, 1, 0), -(root.position.y + 0.15));
    if (!ray.ray.intersectPlane(plane, point)) return null;
    return { x: point.x - root.position.x, z: point.z - root.position.z };
  }
  function moveDrag(event) {
    if (!drag) return;
    if (drag.id === "dial") {
      command("power", {
        value: drag.power + (drag.startY - event.clientY) / 140,
      });
      return;
    }
    const p = tabletop(event);
    if (!p) return;
    const o = state().objects.find((o) => o.id === drag.id);
    if (!o) return;
    command("move", { x: p.x + drag.dx, y: drag.height, z: p.z + drag.dz });
  }
  function finishDrag(event) {
    if (!drag) return;
    const p = tabletop(event);
    if (
      drag.kind === "pan" &&
      p &&
      Math.hypot(p.x - PLATE.x, p.z - PLATE.z) < PLATE.radius + 0.06
    ) {
      if (command("plate", { ...PLATE, y: 0 }).ok)
        say("Meal ready · Pan-cooked carrots packed in your inventory");
      // Leave the pan where you picked it up so it doesn't land on the plate.
      command("move", drag.start);
    } else {
      moveDrag(event);
    }
    command("drop");
    drag = null;
  }
  function aimKnife(p, y = 0.38) {
    command("move", { x: p.x, y, z: p.z });
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (knife && event.button === 2) {
        command("release");
        knife = stroke = null;
        return;
      }
      if (event.button !== 0 || drag) return;
      const p = tabletop(event);
      if (!p) return;
      if (knife) {
        if (!stroke) {
          stroke = { p, phase: "align" };
          aimKnife(p);
        }
        return;
      }
      let id = pick(event);
      hover = id;
      if (id === "dial") {
        drag = { id, power: state().power, startY: event.clientY };
      } else {
        if (id === "basket") {
          if (!command("carrot").ok) return;
          id = state().objects.at(-1).id;
        }
        const selected = state().objects.find((o) => o.id === id);
        if (id === "board" || (event.shiftKey && selected?.kind === "carrot")) {
          const result = command("scoop");
          if (!result.ok) return;
          id = state().held;
          say(
            result.count +
              (result.count === 1 ? " piece gathered" : " pieces gathered"),
          );
        } else if (!selected || !command("grab", { id }).ok) return;
        const o = state().objects.find((o) => o.id === id);
        if (o.kind === "knife") {
          knife = id;
          aimKnife(p);
          return;
        }
        const group =
          o.kind === "carrot"
            ? state().objects.filter((piece) => state().group?.[piece.id])
            : [];
        const count = group.length + 1;
        drag = {
          id,
          kind: o.kind,
          start: { ...o.p },
          height: 0.65,
          dx: group.length
            ? -(
                group.reduce((sum, piece) => sum + piece.p.x - o.p.x, 0) / count
              )
            : o.p.x - p.x,
          dz: group.length
            ? -(
                group.reduce((sum, piece) => sum + piece.p.z - o.p.z, 0) / count
              )
            : o.p.z - p.z,
        };
        moveDrag(event);
      }
      canvas.setPointerCapture(event.pointerId);
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (drag) moveDrag(event);
      else if (knife && !stroke) {
        const p = tabletop(event);
        if (p) aimKnife(p);
      } else if (!knife) hover = pick(event);
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button === 0) finishDrag(event);
    },
    true,
  );
  function cancelDrag() {
    if (!drag && !knife) return;
    command("release");
    drag = knife = stroke = null;
  }
  canvas.addEventListener("pointercancel", cancelDrag);
  canvas.addEventListener("lostpointercapture", () => {
    if (drag) cancelDrag();
  });
  window.addEventListener("blur", () => {
    if (active) cancelDrag();
  });
  canvas.addEventListener(
    "contextmenu",
    (e) => {
      if (active) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (drag && drag.id !== "dial") {
        drag.height = Math.max(
          0.12,
          Math.min(1.5, drag.height - event.deltaY * 0.001),
        );
        moveDrag(event);
      }
    },
    { capture: true, passive: false },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (event.code === "KeyK" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        open();
        return;
      }
      if (!active) return;
      if (event.code === "Escape") close();
      if (event.code === "KeyH" && !event.repeat) heatMap = !heatMap;
      if (event.code === "KeyE" && !event.repeat) {
        const meal = freshMeal();
        if (meal) {
          const result = G.sim.commandNow("cooking.eat", { id: meal.id });
          say(result.ok ? "Ate " + mealName(meal) : result.reason);
        } else say("No fresh prepared meals in your inventory.");
      }
      if (event.code === "Delete" && typeof hover === "number")
        command("discard", { id: hover });
      // Existing saved legacy cooking can still finish and be recovered without a recipe UI.
      if (
        event.code === "KeyM" &&
        !event.repeat &&
        cooking().batch?.status === "ready"
      )
        G.sim.commandNow("cooking.serve");
      if (!["KeyG", "Semicolon", "Quote", "Backquote"].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  function updateCamera(dt) {
    if (!active) return false;
    const p = root.position,
      portrait = G.camera.aspect < 1;
    cameraGoal.set(
      p.x,
      p.y + (portrait ? 6.6 : 4),
      p.z + (portrait ? 6.6 : 3.6),
    );
    lookGoal.set(p.x, p.y + 0.05, p.z);
    G.camera.position.lerp(cameraGoal, 1 - Math.exp(-12 * dt));
    G.camera.fov = 46;
    G.camera.updateProjectionMatrix();
    G.camera.lookAt(lookGoal);
    G.camera.updateMatrixWorld();
    return true;
  }
  function update(dt) {
    if (boundState !== state()) {
      for (const mesh of bodies.values()) {
        root.remove(mesh);
        if (mesh.userData.owned) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
      bodies.clear();
      targets.length = 0;
      if (gridMesh) {
        gridMesh.geometry.dispose();
        gridMesh.material.dispose();
        gridMesh = null;
      }
      plateRim = null;
      stationKey = "";
      boundState = state();
    }
    if (boundSim !== G.sim) {
      if (active) close();
      boundSim = G.sim;
      stationKey = "";
    }
    const s = state(),
      station = cooking().station;
    // Fixed 60 Hz interaction physics continues settling after leaving the camera.
    if (s.initialized && dt > 0) command("advance", { dt: Math.min(0.25, dt) });
    if (stroke) {
      const blade = s.objects.find((o) => o.id === knife);
      if (
        stroke.phase === "align" &&
        blade &&
        Math.hypot(
          blade.p.x - s.target.x,
          blade.p.y - s.target.y,
          blade.p.z - s.target.z,
        ) < 0.015
      ) {
        stroke.phase = "cut";
        aimKnife(stroke.p, 0.105);
      } else if (stroke.phase === "cut" && blade && blade.p.y < 0.116) {
        aimKnife(stroke.p);
        stroke = null;
      }
    }
    const key = JSON.stringify(station);
    if (key !== stationKey) {
      stationKey = key;
      if (station) {
        root.position.set(station.x, station.y + 1, station.z);
        makeStatic();
      }
    }
    root.visible =
      !!station &&
      s.initialized &&
      Math.hypot(G.player.x - station.x, G.player.z - station.z) < 110;
    const pan = s.objects.find((o) => o.kind === "pan");
    const hottest = Math.max(...s.grid);
    const hotFood =
      root.visible &&
      pan &&
      s.objects.find(
        (o) =>
          o.kind === "carrot" &&
          o.temp > 100 &&
          Math.hypot(o.p.x - pan.p.x, o.p.z - pan.p.z) < PAN_R &&
          o.p.y > pan.p.y &&
          o.p.y < pan.p.y + 0.28,
      );
    const phase = performance.now() * 0.00055;
    for (let i = 0; i < smoke.length; i++) {
      const puff = smoke[i];
      puff.visible = !!hotFood;
      if (!hotFood) continue;
      const t = (phase + i / smoke.length) % 1;
      puff.position.set(
        hotFood.p.x + Math.sin(i + t * 3) * 0.13,
        hotFood.p.y + t * 0.9,
        hotFood.p.z + t * 0.18,
      );
      puff.scale.setScalar(0.14 + t * 0.48);
      puff.material.color.setHex(hotFood.burn > 0.25 ? 0x82766d : 0xe8e4dc);
      puff.material.opacity =
        Math.sin(t * Math.PI) * (hotFood.burn > 0.25 ? 0.33 : 0.21);
    }
    const ids = new Set(s.objects.map((o) => o.id));
    for (const [id, mesh] of bodies)
      if (!ids.has(id)) {
        root.remove(mesh);
        const i = targets.indexOf(mesh);
        if (i >= 0) targets.splice(i, 1);
        if (mesh.userData.owned) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        bodies.delete(id);
      }
    for (const o of s.objects) {
      if (!bodies.has(o.id)) makeBody(o);
      const mesh = bodies.get(o.id);
      mesh.position.copy(o.p);
      mesh.quaternion.copy(o.q);
      if (o.kind === "carrot")
        mesh.material.color.setRGB(
          1 - o.burn * 0.8,
          1 - o.cooked * 0.2 - o.burn * 0.65,
          1 - o.cooked * 0.35 - o.burn * 0.5,
        );
    }
    if (plateRim)
      plateRim.material = material(drag?.kind === "pan" ? 0xffe5a1 : 0xe6dfc3);
    if (knob) knob.rotation.y = -2.3 + s.power * 4.6;
    if (burner) {
      burner.material.emissive.setRGB(s.power * 0.65, s.power * 0.07, 0);
    }
    if (gridMesh) gridMesh.visible = active && heatMap;
    if (gridMesh?.visible) {
      const color = new T.Color();
      for (let i = 0; i < s.grid.length; i++) {
        color.setHSL(
          0.62 * (1 - Math.min(1, (s.grid[i] - 20) / 260)),
          0.85,
          0.48,
        );
        gridMesh.setColorAt(i, color);
      }
      gridMesh.instanceColor.needsUpdate = true;
    }
    const full = cooking().fullness;
    $("hungerbar").style.width = full + "%";
    $("hungerbar").parentElement.setAttribute(
      "aria-valuenow",
      String(Math.round(full)),
    );
    if (active) {
      const o = s.objects.find((o) => o.id === (drag?.id || hover));
      const coldest = Math.min(...s.grid.filter((_, i) => validCell(i)));
      let text = `Burner ${Math.round(s.power * 100)}% · Pan ${Math.round(coldest)}–${Math.round(hottest)}°C`;
      if (o?.kind === "carrot")
        text += `\nCarrot · ${Math.round(o.mass * 1000)} g · ${Math.round(o.temp)}°C · ${o.age > 172800 ? "spoiled" : o.burn > 0.6 ? "burned" : o.cooked >= 0.8 ? "cooked" : "raw / cooking"}`;
      const meal = freshMeal();
      if (meal) text += "\nPacked meal · " + mealName(meal) + " · E to eat";
      if (hover === "basket")
        text +=
          "\nDrag a fresh carrot from the basket (" +
          (G.sim.state.sys.stock.items.food_carrot || 0) +
          " left)";
      if (drag?.kind === "pan")
        text += "\nDrop over the plate to pack the cooked food";
      if (hover === "dial")
        text += "\nDrag the dial upward for more heat, downward to turn it off";
      if (G.speed === 0)
        text += "\nWorld time paused: handling works, heating is paused";
      if (cooking().batch?.status === "ready")
        text += "\nPrevious saved meal ready · M to collect";
      if (noticeUntil > performance.now()) text += "\n" + notice;
      if (text !== lastPanel) {
        $("physical-kitchen-readout").textContent = text;
        lastPanel = text;
      }
    } else if (noticeUntil > performance.now()) {
      entry.textContent = " · " + notice;
    } else
      entry.textContent = freshMeal()
        ? " · K: kitchen · I: prepared meals"
        : " · K: kitchen";
  }
  function collide(entity, radius) {
    const s = cooking().station;
    if (!s || !state().initialized || entity.y > s.y + 2 || entity.y < s.y - 2)
      return;
    const dx = entity.x - s.x,
      dz = entity.z - s.z,
      hx = 2.6 + radius,
      hz = 1.25 + radius;
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) return;
    if (hx - Math.abs(dx) < hz - Math.abs(dz))
      entity.x = s.x + Math.sign(dx || 1) * hx;
    else entity.z = s.z + Math.sign(dz || 1) * hz;
  }
  return {
    get active() {
      return active;
    },
    get ready() {
      return !loading && !error;
    },
    get meals() {
      return cooking().meals.map((meal) => ({
        id: meal.id,
        name: mealName(meal),
        qty: meal.qty,
        quality: meal.quality,
        hoursLeft: Math.max(
          0,
          Math.ceil((meal.expiresAt - G.sim.state.t) / 3600),
        ),
      }));
    },
    open,
    close,
    update,
    updateCamera,
    collide,
  };
}
