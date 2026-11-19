/* Touch controls: two thumb sticks and action buttons. Build mode needs no extra buttons: its bar holds every tool and option. */
(() => {
  const G = window.__game,
    BL = window.__build;
  if (!G || !BL) return;
  const B = BL.state,
    P = G.player,
    K = G.keys,
    M = G.mouse,
    $ = (id) => document.getElementById(id),
    canvas = $("view"),
    clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const peaceful = document.body.classList.contains("peaceful"); // combat off: the bow button is the view button
  let on = false,
    rx = 0,
    ry = 0;

  const ui = document.createElement("div");
  ui.id = "touchui";
  ui.hidden = true;
  ui.innerHTML =
    '<div class="stick" id="tsl" role="group" aria-label="Move"><div class="nub"></div></div>' +
    '<div class="stick" id="tsr" role="group" aria-label="Turn the view"><div class="nub"></div></div>' +
    '<div id="tact" role="group" aria-label="Actions">' +
    '<button type="button" id="tbow">' + (peaceful ? "Look" : "Bow") + '</button><button type="button" id="tkick">Kick</button><button type="button" id="tparry">Parry</button>' +
    '<button type="button" id="tdash">Dash</button><button type="button" id="tjump">Jump</button><button type="button" id="troll">Roll</button>' +
    "</div>" +
    '<button type="button" id="tatk">Attack</button>';
  document.body.appendChild(ui);

  function enable() {
    if (on) return;
    on = true;
    document.body.classList.add("touch");
    ui.hidden = false;
    B.uiVer++;
  }
  if (window.matchMedia && matchMedia("(pointer: coarse)").matches) enable();
  window.addEventListener("pointerdown", (e) => e.pointerType === "touch" && enable(), true);
  window.__touch = { enable };

  /* ---------- sticks ---------- */
  function stick(el, cb) {
    let id = null;
    const nub = el.firstElementChild;
    const put = (e) => {
      const r = el.getBoundingClientRect(),
        R = r.width * 0.36;
      let x = (e.clientX - (r.left + r.width / 2)) / R,
        y = (e.clientY - (r.top + r.height / 2)) / R;
      const l = Math.hypot(x, y);
      if (l > 1) ((x /= l), (y /= l));
      nub.style.transform = "translate(" + x * R + "px," + y * R + "px)";
      l < 0.16 ? cb(0, 0) : cb(x, y);
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      nub.style.transform = "";
      el.classList.remove("on");
      cb(0, 0);
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      id = e.pointerId;
      try {
        el.setPointerCapture(id);
      } catch {}
      el.classList.add("on");
      put(e);
    });
    el.addEventListener("pointermove", (e) => e.pointerId === id && put(e));
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  }
  stick($("tsl"), (x, y) => {
    K.joyX = x;
    K.joyY = -y;
  });
  stick($("tsr"), (x, y) => {
    rx = x;
    ry = y;
  });

  /* ---------- buttons ---------- */
  function hold(el, down, up) {
    let id = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      id = e.pointerId;
      try {
        el.setPointerCapture(id);
      } catch {}
      el.classList.add("on");
      down();
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      el.classList.remove("on");
      up && up();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  const strike = () => {
    M.left = true;
    M.click = 0.25;
    P.levelTarget = P.y;
  };
  hold($("tatk"), strike, () => (M.left = false));
  hold(
    $("tjump"),
    () => (K.Space = true),
    () => (K.Space = false),
  );
  hold(
    $("troll"),
    () => (K.ShiftLeft = true),
    () => (K.ShiftLeft = false),
  );
  hold(
    $("tparry"),
    () => (K.KeyE = true),
    () => (K.KeyE = false),
  );
  hold(
    $("tkick"),
    () => (K.KeyQ = true),
    () => (K.KeyQ = false),
  );
  hold(
    $("tdash"),
    () => {
      K.AltLeft = true;
      strike();
    },
    () => {
      M.left = false;
      setTimeout(() => (K.AltLeft = false), 140);
    },
  );
  hold($("tbow"), () => (peaceful && G.camView ? G.camView("next") : (M.right = !M.right)));

  /* ---------- touches on the view, outside build mode ---------- */
  // Dragging turns the camera. With a terrain tool in hand, a touch works the ground there instead.
  const look = new Map();
  let brush = null;
  const aimAt = (e) => {
    const r = canvas.getBoundingClientRect();
    M.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    M.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const mine = (e) => on && e.pointerType === "touch" && e.target === canvas && P.tool !== "build";
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!mine(e)) return;
      e.stopPropagation();
      e.preventDefault();
      if (P.tool !== "axe" && brush === null) {
        brush = e.pointerId;
        aimAt(e);
        strike();
      } else look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    },
    true,
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!mine(e)) return;
      e.stopPropagation();
      if (e.pointerId === brush) return aimAt(e);
      const q = look.get(e.pointerId);
      if (!q) return;
      const c = G.cam,
        dx = e.clientX - q.x,
        dy = e.clientY - q.y;
      q.x = e.clientX;
      q.y = e.clientY;
      c.yaw -= dx * 0.0062;
      if (c.aimK > 0.5) c.aimPitch = clamp(c.aimPitch + dy * 0.004, c.aimLo ?? -0.28, c.aimHi ?? 0.9);
      else c.pitch = clamp(c.pitch + dy * 0.004, 0.5, 1.35);
    },
    true,
  );
  const lift = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId === brush) {
      brush = null;
      M.left = false;
      e.stopPropagation();
    }
    if (look.delete(e.pointerId)) e.stopPropagation();
  };
  window.addEventListener("pointerup", lift, true);
  window.addEventListener("pointercancel", lift, true);

  /* ---------- every frame ---------- */
  let last = performance.now(),
    n = 0,
    mode = "";
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (on) {
      const c = G.cam;
      if (B.on) {
        if (rx || ry) {
          c.yaw -= rx * 2.2 * dt;
          c.dist = clamp(c.dist * Math.exp(ry * 1.3 * dt), 9, 50);
          B.camT = 0;
        }
      } else {
        c.yaw -= rx * 2.9 * dt;
        if (c.aimK > 0.5) c.aimPitch = clamp(c.aimPitch + ry * 1.1 * dt, c.aimLo ?? -0.28, c.aimHi ?? 0.9);
        else c.pitch = clamp(c.pitch + ry * 0.9 * dt, 0.5, 1.35);
      }
      M.inside = false;
      const now = B.on ? "build" : P.tool;
      if (now !== mode) {
        mode = now;
        ui.dataset.mode = mode;
        if (mode !== "axe") M.right = false;
      }
      if (n++ % 6 === 0) {
        // the sticks ride just above whichever bar is at the bottom
        const bar = B.on ? $("buildbar") : $("tools"),
          r = bar.getBoundingClientRect();
        ui.style.setProperty("--lift", Math.max(8, window.innerHeight - r.top + 8) + "px");
        $("tbow").classList.toggle("lit", peaceful ? !!c.view : !!M.right);
        $("tatk").textContent = M.right ? "Loose" : "Attack";
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
