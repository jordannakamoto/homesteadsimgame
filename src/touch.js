/* Touch controls: two thumb sticks and action buttons, and the phone frame (docs/design/ui-redesign.md section 3 and
   plan-mode-redesign.md section 2.8). Peaceful game: Look, Jump and one Use button (the axe swing); the combat buttons
   carry class cb and only show with combat on. On a phone the top bar is a menu button (the dock as a sheet of tiles),
   money, and one time-and-weather chip (a tap shows the speed row) with the gear. Build mode: the nine slots scroll
   sideways with Undo, "..." and Done pinned at the right; Redo, Snap, the storeys, Roofs and Materials sit in the "..."
   sheet. The inspector is a bottom sheet above the bar with two heights, peek (the stage and the fit line) and full;
   in landscape it is a drawer on the right and the bar sits between the sticks. */
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
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    icon = (n) => (window.__ui && window.__ui.icon ? window.__ui.icon(n) : "");
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
    '<button type="button" id="tbow">' + (peaceful ? "Look" : "Bow") + '</button><button type="button" id="tkick" class="cb">Kick</button><button type="button" id="tparry" class="cb">Parry</button>' +
    '<button type="button" id="tdash" class="cb">Dash</button><button type="button" id="tjump">Jump</button><button type="button" id="troll" class="cb">Roll</button>' +
    "</div>" +
    '<button type="button" id="tatk" class="cb">Attack</button>' +
    '<button type="button" id="tuse" class="ui-fab" aria-label="Use: swing the tool in hand">' + icon("axe") + "<span>Use</span></button>";
  document.body.appendChild(ui);

  function enable() {
    if (on) return;
    on = true;
    document.body.classList.add("touch");
    ui.hidden = false;
    hudFrame();
    buildFrame();
    B.uiVer++;
  }
  window.addEventListener("pointerdown", (e) => e.pointerType === "touch" && enable(), true);
  window.__touch = { enable };

  /* ---------- the phone's top bar: a menu button for the dock, and the speed row behind the time chip ---------- */
  const outside = (e, ...els) => !els.some((el) => el && el.contains(e.target));
  let hudDone = false;
  function hudFrame() {
    if (hudDone) return;
    hudDone = true;
    const stock = $("stock"),
      dock = $("dock"),
      top = $("hud-top"),
      clock = $("hud-clock"),
      gear = $("hud-gear");
    if (stock && dock) {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.id = "hud-menu";
      menu.className = "panel ui-btn ui-btn--icon";
      menu.setAttribute("aria-label", "Menu: Bag, Shop, Hens, Home, Build");
      menu.setAttribute("aria-expanded", "false");
      menu.innerHTML = icon("menu");
      stock.insertBefore(menu, stock.firstChild);
      const show = (v) => (document.body.classList.toggle("hud-menu-open", v), menu.setAttribute("aria-expanded", String(v)));
      menu.addEventListener("click", () => show(!document.body.classList.contains("hud-menu-open")));
      // a tile opens its panel and the sheet goes away
      dock.addEventListener("click", (e) => e.target.closest("button") && show(false));
      window.addEventListener("pointerdown", (e) => document.body.classList.contains("hud-menu-open") && outside(e, menu, dock) && show(false), true);
    }
    if (top && clock) {
      // one chip with the time and the weather, then the gear; tapping the time shows the speed row under it
      const rows = top.querySelectorAll(".hud-row");
      if (gear && rows[0]) rows[0].appendChild(gear);
      clock.setAttribute("role", "button");
      clock.tabIndex = 0;
      clock.setAttribute("aria-expanded", "false");
      clock.title = "Time and speed";
      const show = (v) => (top.classList.toggle("hud-open", v), clock.setAttribute("aria-expanded", String(v)));
      clock.addEventListener("click", () => show(!top.classList.contains("hud-open")));
      window.addEventListener("pointerdown", (e) => top.classList.contains("hud-open") && outside(e, top) && show(false), true);
    }
    // the quest card is one line; a tap opens it
    const next = $("cvnext");
    next && next.addEventListener("click", (e) => e.target.closest("button") || next.classList.toggle("open"));
  }

  /* ---------- build mode on a phone ---------- */
  // The "..." sheet holds Redo, Snap, the storeys, Roofs and Materials (moved, so buildui.js's listeners still hold).
  // The inspector gets a button that switches its sheet between peek and full.
  let buildDone = false,
    xsheet = null,
    xbtn = null;
  function xshow(v) {
    if (!xsheet || xsheet.hidden === !v) return;
    xsheet.hidden = !v;
    xbtn.setAttribute("aria-expanded", String(v));
    if (!v) return;
    const r = $("bmain").getBoundingClientRect();
    xsheet.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
    xsheet.style.right = Math.round(window.innerWidth - r.right) + "px";
  }
  function buildFrame() {
    const aids = $("baids"),
      dp = $("bdesign");
    if (buildDone || !aids || !dp) return;
    buildDone = true;
    xbtn = document.createElement("button");
    xbtn.type = "button";
    xbtn.id = "bxtra";
    xbtn.className = "ui-btn ui-btn--icon";
    xbtn.setAttribute("aria-label", "More: redo, snap, storeys, roofs, materials");
    xbtn.setAttribute("aria-haspopup", "true");
    xbtn.setAttribute("aria-expanded", "false");
    xbtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/></svg>';
    xsheet = document.createElement("div");
    xsheet.id = "baidsheet";
    xsheet.hidden = true;
    xsheet.setAttribute("role", "group");
    xsheet.setAttribute("aria-label", "More for the plan");
    for (const id of ["bredo", "bsnap", "blevel", "broofs", "bsched"]) $(id) && xsheet.appendChild($(id));
    document.body.appendChild(xsheet);
    const undo = $("bundo");
    undo && undo.nextSibling ? aids.insertBefore(xbtn, undo.nextSibling) : aids.insertBefore(xbtn, aids.firstChild);
    xbtn.addEventListener("click", () => xshow(xsheet.hidden));
    // Materials opens a drawer of its own; the rest may be pressed more than once
    $("bsched") && $("bsched").addEventListener("click", () => xshow(false));
    window.addEventListener("pointerdown", (e) => !xsheet.hidden && outside(e, xsheet, xbtn) && xshow(false), true);
    window.addEventListener("resize", () => xshow(false));
    const head = dp.querySelector(".ui-panel__head"),
      close = head && head.querySelector(".ui-close");
    if (head && close) {
      const grow = document.createElement("button");
      grow.type = "button";
      grow.id = "bdgrow";
      grow.className = "ui-btn ui-btn--icon";
      grow.setAttribute("aria-expanded", "false");
      grow.setAttribute("aria-label", "Show every setting");
      grow.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14.5l6-6 6 6"/></svg>';
      head.insertBefore(grow, close);
      grow.addEventListener("click", () => sheetFull(!dp.classList.contains("full")));
      // the sheet's head (not its buttons) also switches it
      head.addEventListener("click", (e) => e.target.closest("button") || sheetFull(!dp.classList.contains("full")));
    }
  }
  function sheetFull(v) {
    const dp = $("bdesign"),
      g = $("bdgrow");
    if (!dp || dp.classList.contains("full") === v) return;
    dp.classList.toggle("full", v);
    if (g) (g.setAttribute("aria-expanded", String(v)), g.setAttribute("aria-label", v ? "Show less" : "Show every setting"));
    B.uiVer++;
  }


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
  hold($("tuse"), strike, () => (M.left = false));
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
    mode = "",
    sheetUp = false,
    liftV = -1,
    slotV = -1;
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
        // the inspector is a sheet (or, in landscape, a drawer): the sticks and buttons make way while it is up
        const dp = $("bdesign"),
          up = B.on && !!dp && !dp.hidden;
        if (up !== sheetUp) {
          sheetUp = up;
          document.body.classList.toggle("b-sheet", up);
          up || sheetFull(false);
        }
        if (!B.on) xshow(false);
        // the sticks ride just above whatever is at the bottom where they stand, and drop to the corners when it
        // stands between them (landscape)
        let r = null;
        if (B.on) r = $("buildbar").getBoundingClientRect();
        else
          for (const el of $("ui-lane-bottom") ? $("ui-lane-bottom").children : [])
            if (!el.hidden && el.offsetWidth) {
              const q = el.getBoundingClientRect();
              r = r ? { left: Math.min(r.left, q.left), right: Math.max(r.right, q.right), top: Math.min(r.top, q.top) } : q;
            }
        const L = $("tsl").getBoundingClientRect(),
          R = $("tsr").getBoundingClientRect(),
          over = r && ((r.left < L.right && r.right > L.left) || (r.left < R.right && r.right > R.left)),
          lf = over ? Math.max(8, Math.round(window.innerHeight - r.top + 8)) : 8;
        if (lf !== liftV) ui.style.setProperty("--lift", (liftV = lf) + "px");
        $("tbow").classList.toggle("lit", peaceful ? !!c.view : !!M.right);
        $("tatk").textContent = M.right ? "Loose" : "Attack";
      }
      // the tool in hand stays in sight in the sideways-scrolling row of slots
      if (B.on && B.uiVer !== slotV) {
        slotV = B.uiVer;
        const row = $("bpieces"),
          b = row && row.querySelector('button[aria-pressed="true"]');
        if (b && row.scrollWidth > row.clientWidth) {
          const q = b.getBoundingClientRect(),
            x0 = q.left - row.getBoundingClientRect().left + row.scrollLeft,
            x1 = x0 + q.width;
          if (x0 < row.scrollLeft) row.scrollLeft = x0 - 8;
          else if (x1 > row.scrollLeft + row.clientWidth) row.scrollLeft = x1 - row.clientWidth + 8;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (window.matchMedia && matchMedia("(pointer: coarse)").matches) enable();
})();
