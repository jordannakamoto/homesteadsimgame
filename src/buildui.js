/* Build mode's interface: the tool palette, the options strip that doubles as the property inspector, and what is
   drawn over the view (live dimensions with their typed fields, the snap marker, wall handles, measurements).
   It only draws what window.__build.view() describes and reports clicks through window.__build.choose(). */
(() => {
  const G = window.__game,
    BL = window.__build;
  if (!G || !BL || !BL.view) return;
  const B = BL.state,
    $ = (id) => document.getElementById(id),
    canvas = G.renderer.domElement,
    bar = $("buildbar");
  if (!bar) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const svg = (d, size = 24) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (d || "") + "</svg>";

  // drawn on a 24 unit grid, one stroke weight throughout
  const I = {
    select: '<path d="M6 3.5l12 8-5.3 1.2 3 5.9-2.3 1.2-3-5.9L6 18z"/>',
    room: '<path d="M10 19H4V5h16v14h-5"/><path d="M10 19l3.6-3.2" /><path d="M4 12h3M17 12h3" opacity=".45"/>',
    wall: '<path d="M3 7h18v10H3zM3 12h18M9 7v5M15 7v5M6 12v5M12 12v5M18 12v5"/>',
    floor: '<path d="M3 16l5-8h13l-5 8zM6.3 12h13M10.5 8l-2.2 4M15 12l-2.5 4M17.5 8L15.3 12"/>',
    roof: '<path d="M2.5 13L12 5l9.5 8M5.5 11v8h13v-8"/>',
    door: '<path d="M7 20V4.5h10V20M4.5 20h15"/><circle cx="14.3" cy="12.6" r=".9" fill="currentColor"/>',
    window: '<rect x="4.5" y="5" width="15" height="13" rx=".5"/><path d="M12 5v13M4.5 11.5h15M3 20h18"/>',
    stairs: '<path d="M3.5 19.5h4.3v-4.3h4.3v-4.3h4.3V6.6h4.1"/>',
    pillar: '<path d="M7.5 20h9M9.5 20V7M14.5 20V7M7 7h10M8.5 4.5h7"/>',
    path: '<path d="M8.5 21c0-5 6.5-5 6.5-9s-5.5-4-5.5-9M14.5 21c0-4 6-4 6-9"/>',
    decor: '<path d="M6 11V8.5A2.5 2.5 0 0 1 8.500 6h7A2.500 2.500 0 0 1 18 8.500V11"/><path d="M4 13.200a2 2 0 0 1 4 0V15h8v-1.800a2 2 0 0 1 4 0V18H4zM7 18v2M17 18v2"/>',
    measure: '<path d="M3.500 15.500l12-12 5 5-12 12zM7.500 13.500l1.600 1.600M10 11l2.400 2.400M12.500 8.500l1.600 1.600M15 6l2.400 2.400"/>',
    erase: '<path d="M5 7h14M10 7V4.500h4V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
    undo: '<path d="M8.500 5L4 9.500 8.500 14"/><path d="M4 9.500h10a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15.500 5L20 9.500 15.500 14"/><path d="M20 9.500H10a5 5 0 0 0 0 10h3"/>',
    snap: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"/>',
    up: '<path d="M6 14.500l6-6 6 6"/>',
    down: '<path d="M6 9.500l6 6 6-6"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    minus: '<path d="M6 12h12"/>',
    turn: '<path d="M19.500 12a7.500 7.500 0 1 1-2.400-5.500M19.500 4v4.500H15"/>',
    bin: '<path d="M5 7h14M10 7V4.500h4V7M6.500 7l1 13h9l1-13M10 11v5.500M14 11v5.500"/>',
    copy: '<rect x="8.500" y="8.500" width="11" height="11" rx="1"/><path d="M15.500 8.500v-4h-11v11h4"/>',
    pick: '<path d="M14.500 4.500l5 5-2.200 1-7.800 7.800-3.500.900.900-3.500 7.800-7.800z"/><path d="M12.500 8.500l3 3"/>',
    paint: '<rect x="4" y="4" width="13" height="6" rx="1"/><path d="M17 7h3v5h-8v3M12 15v5.500"/>',
    building: '<path d="M3 20V10l6-5 6 5v10zM15 13h6v7h-6M7 20v-5h4v5"/>',
    wing: '<path d="M3 17h8v-6h10M3 20h18" /><path d="M16 7v-3.500M14 5.500l2-2 2 2"/>',
    roofs: '<path d="M2.500 12L12 4.500l9.500 7.500"/><path d="M6 17.500h12M9 20.500h6" opacity=".6"/>',
    stop: '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
    done: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    "s-box": '<rect x="4.500" y="6" width="15" height="12"/>',
    "s-round": '<path d="M12 4.500l5.300 2.200 2.200 5.300-2.200 5.300-5.300 2.200-5.300-2.200L4.500 12l2.200-5.300z"/>',
    "w-wall": '<path d="M4 5.500h16V19H4zM9.300 5.500V19M14.700 5.500V19"/>',
    "w-arch": '<path d="M4 19V5.500h16V19M8 19v-6a4 4 0 0 1 8 0v6"/>',
    "w-arch2": '<path d="M4 19V5.500h16V19M8 19v-5.500c0-3 2-4.500 4-6 2 1.500 4 3 4 6V19"/>',
    "w-arch3": '<path d="M4 19V5.500h16V19M8 19V9.500h8V19M8 13l3-3.500M16 13l-3-3.500"/>',
    "w-rail": '<path d="M4.500 8.500V19M12 8.500V19M19.500 8.500V19M4.500 11h15M4.500 15.500h15"/>',
    "w-parapet": '<path d="M4 19v-8.500h3.500V13.500h3v-3h3v3h3v-3H20V19z"/>',
    "w-rampart": '<path d="M3 19V7h3v2.500h3V7h3v2.500h3V7h3v2.500h3V19zM3 14h18M9 14v5M15 14v5"/>',
    "d-door": '<path d="M7 20V4.500h10V20M4.500 20h15"/><circle cx="14.300" cy="12.600" r=".9" fill="currentColor"/>',
    "d-door2": '<path d="M5 20V4.500h14V20M12 4.500V20M3 20h18"/><circle cx="10" cy="12.600" r=".8" fill="currentColor"/><circle cx="14" cy="12.600" r=".8" fill="currentColor"/>',
    "d-gate": '<path d="M5 20V10.500a7 7 0 0 1 14 0V20M9 5.500V20M12 4V20M15 5.500V20M5 11.500h14M5 16h14"/>',
    "n-window": '<rect x="4.500" y="5.500" width="15" height="13"/><path d="M12 5.500v13M4.500 12h15"/>',
    "n-window2": '<path d="M6 19v-8.500a6 6 0 0 1 12 0V19zM12 4.500V19M6 12.500h12"/>',
    "n-window4": '<path d="M9 6h6v12H9zM9 12h6M4 6h3v12H4zM17 6h3v12h-3z"/>',
    "n-window3": '<path d="M10.800 5h2.400v14h-2.400zM5 4v16M19 4v16"/>',
    "r-gable": '<path d="M3 17.500l5-9.500 5 9.500zM8 8h9l4 9.500h-8"/>',
    "r-hip": '<path d="M2.500 17.500l6-8.500h7l6 8.500zM8.500 9l2.500 8.500M15.500 9L13 17.500"/>',
    "r-shed": '<path d="M3.500 18.500V8l17 6.500v4z"/>',
    "r-flat": '<path d="M3 12.500h18V17H3zM5 12.500v-2.500h14v2.500"/>',
    "r-steep": '<path d="M6.500 19.500L12 4l5.500 15.500z"/>',
    "t-none": '<circle cx="12" cy="12" r="7" stroke-dasharray="2.500 3"/>',
    "t-cone": '<path d="M5 19.500L12 4.500l7 15z"/>',
    "t-dome": '<path d="M4.500 19a7.500 10 0 0 1 15 0z"/>',
    "t-crenel": '<path d="M4 19v-8.500h3.500V13.500h3v-3h3v3h3v-3H20V19z"/>',
    "p-pillar": '<path d="M7.500 20h9M9.500 20V7M14.500 20V7M7 7h10M8.500 4.500h7"/>',
    "p-chimney": '<path d="M8 20.500V9h8v11.500M6.500 9h11M9.500 9V6h5v3"/><path d="M12 3.500c1-.800 1-1.700 2-2" opacity=".6"/>',
  };
  // a small picture of a material, drawn from its two colours
  function swatch(sw) {
    const [kind, a, b] = sw;
    let d = '<rect width="24" height="24" fill="' + a + '"/>';
    const st = ' stroke="' + b + '" stroke-width="1.6" fill="none"';
    if (kind === "planks") d += "<path" + st + ' d="M6 0v19M12 0v19M18 0v19"/><rect y="19" width="24" height="5" fill="' + b + '"/>';
    else if (kind === "courses") d += "<path" + st + ' stroke-width="1.3" d="M0 6h24M0 12h24M0 18h24M8 0v6M18 0v6M3 6v6M13 6v6M8 12v6M18 12v6M3 18v6M13 18v6"/>';
    else if (kind === "flat") d += '<rect x="10" width="4" height="24" fill="' + b + '"/><rect y="20" width="24" height="4" fill="' + b + '"/>';
    else if (kind === "brace") d += "<path" + st + ' stroke-width="3" d="M1.500 0v24M22.500 0v24M0 1.500h24M2 22L22 3"/>';
    else if (kind === "boards") d += "<path" + st + ' stroke-width="1.300" d="M0 6h24M0 12h24M0 18h24M9 0v6M16 6v6M6 12v6M14 18v6"/>';
    else if (kind === "check") d += '<path fill="' + b + '" d="M0 0h8v8H0zM16 0h8v8h-8zM8 8h8v8H8zM0 16h8v8H0zM16 16h8v8h-8z"/>';
    else if (kind === "roof") d += "<path" + st + ' stroke-width="1.400" d="M0 6q3 3 6 0t6 0 6 0 6 0M0 12q3 3 6 0t6 0 6 0 6 0M0 18q3 3 6 0t6 0 6 0 6 0"/>';
    else if (kind === "path") d += '<g fill="' + b + '"><circle cx="5" cy="6" r="2.200"/><circle cx="14" cy="4.500" r="1.800"/><circle cx="19" cy="11" r="2.300"/><circle cx="9" cy="13" r="2"/><circle cx="4.500" cy="19" r="1.800"/><circle cx="15" cy="19" r="2.300"/></g>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";
  }

  /* ---------- the bar ---------- */
  bar.innerHTML =
    '<div id="bhead"><span id="bhint" aria-live="polite"></span><button id="bstop" type="button" hidden>' + svg(I.stop, 16) + '<span>Stop</span><kbd>Esc</kbd></button><span class="grow"></span>' +
    '<button id="bundo" type="button" title="Undo (Ctrl+Z)">' + svg(I.undo, 20) + '<span>Undo</span></button><button id="bredo" type="button" title="Redo (Ctrl+Shift+Z)">' + svg(I.redo, 20) + "<span>Redo</span></button></div>" +
    '<div id="bopts" role="group" aria-label="Options"></div><div id="bdecor" role="group" aria-label="Pieces" hidden></div>' +
    '<div id="bmain"><div id="bpieces" role="group" aria-label="Build tools"></div><div id="baids">' +
    '<button id="bsnap" type="button" aria-pressed="true" title="Snap to the grid, to ends, middles and walls, and to round angles ( / ). Hold Ctrl to place freely.">' + svg(I.snap, 22) + '<span class="name">Snap</span><span class="key">/</span></button>' +
    '<div id="blevel" title="The storey you are working on (Page Up, Page Down)"><button id="blup" type="button" aria-label="Storey up">' + svg(I.up, 18) + '</button><span id="blname">Ground</span><button id="bldn" type="button" aria-label="Storey down">' + svg(I.down, 18) + "</button></div>" +
    '<button id="bfree" type="button" aria-pressed="true" title="When off, pieces cost wood and removing them refunds it">Free</button>' +
    '<button id="bdone" type="button" title="Leave build mode (B)">' + svg(I.done, 22) + '<span class="name">Done</span><span class="key">B</span></button></div></div>';
  const pieces = $("bpieces");
  let grp = -1;
  for (const t of BL.view().tools) {
    if (t.group !== grp && grp >= 0) pieces.insertAdjacentHTML("beforeend", '<span class="sep"></span>');
    grp = t.group;
    const letter = BL.TOOL_LETTER[t.id] || "";
    pieces.insertAdjacentHTML("beforeend", '<button type="button" data-piece="' + t.id + '" title="' + t.name + " (" + letter + " or " + t.key + ')" aria-pressed="false">' + svg(I[t.id], 26) + '<span class="name">' + t.name + '</span><span class="key">' + letter + "</span></button>");
  }
  const back = () => canvas.focus();
  pieces.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-piece]");
    b && (BL.setTool(b.dataset.piece), back());
  });
  const press = (id, what, v) => $(id).addEventListener("click", () => (BL.choose(what, v), back()));
  press("bundo", "undo");
  press("bredo", "redo");
  press("bsnap", "snap");
  press("bfree", "free");
  press("bdone", "done");
  press("bstop", "stop");
  press("blup", "level", 1);
  press("bldn", "level", -1);

  /* ---------- the options strip and inspector ---------- */
  const opts = $("bopts"),
    row2 = $("bdecor");
  let groups = [];
  const keyHint = (k) => (k ? "<kbd>" + esc(k) + "</kbd>" : "");
  function groupHtml(g, n) {
    const lab = (extra) => '<span class="blab">' + esc(g.label || "") + (extra ? ' <b class="bval">' + esc(extra) + "</b>" : "") + keyHint(g.key) + "</span>";
    const cur = g.items ? g.items.find((x) => x.v === g.value) : null;
    if (g.type === "info") return '<div class="bgroup binfo"><span class="btitle">' + esc(g.title) + '</span><span class="bnum">' + esc(g.text) + "</span></div>";
    if (g.type === "swatches") return '<div class="bgroup">' + lab(cur ? cur.name : g.value === null ? "mixed" : "") + '<div class="bitems">' + g.items.map((x, m) => '<button type="button" class="bsw" data-g="' + n + '" data-i="' + m + '" title="' + esc(x.name) + '" aria-label="' + esc(x.name) + '" aria-pressed="' + (x.v === g.value) + '">' + swatch(x.sw) + "</button>").join("") + "</div></div>";
    if (g.type === "tiles") return '<div class="bgroup">' + lab() + '<div class="bitems">' + g.items.map((x, m) => '<button type="button" class="btile" data-g="' + n + '" data-i="' + m + '" aria-pressed="' + (x.v === g.value) + '">' + svg(I[x.icon], 22) + "<span>" + esc(x.name) + "</span></button>").join("") + "</div></div>";
    if (g.type === "chips") return '<div class="bgroup">' + (g.label ? lab(cur && cur.note ? cur.note : "") : "") + '<div class="bitems">' + g.items.map((x, m) => '<button type="button" class="bchip" data-g="' + n + '" data-i="' + m + '" aria-pressed="' + (x.v === g.value) + '"' + (x.note ? ' title="' + esc(x.note) + '"' : "") + ">" + esc(x.name) + "</button>").join("") + "</div></div>";
    if (g.type === "stepper") return '<div class="bgroup">' + lab() + '<div class="bitems bstep"><button type="button" class="bchip" data-g="' + n + '" data-i="-1" aria-label="Less">' + svg(I.minus, 16) + '</button><span class="bnum">' + esc(g.text) + '</span><button type="button" class="bchip" data-g="' + n + '" data-i="1" aria-label="More">' + svg(I.plus, 16) + "</button></div></div>";
    if (g.type === "toggle") return '<div class="bgroup"><span class="blab">&nbsp;</span><div class="bitems"><button type="button" class="btile" data-g="' + n + '" aria-pressed="' + !!g.on + '" title="' + esc(g.title || g.name) + '">' + svg(I[g.icon], 20) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "action") return '<div class="bgroup"><span class="blab">' + (g.key ? keyHint(g.key) : "&nbsp;") + '</span><div class="bitems"><button type="button" class="btile' + (g.danger ? " danger" : "") + '" data-g="' + n + '">' + svg(I[g.icon], 20) + "<span>" + esc(g.name) + "</span></button></div></div>";
    if (g.type === "field") return '<div class="bgroup">' + lab() + '<div class="bitems bfield" title="' + esc(g.title || "") + '"><input type="text" inputmode="decimal" autocomplete="off" data-g="' + n + '" value="' + esc(g.value) + '" aria-label="' + esc(g.label) + '"><span>' + esc(g.unit) + "</span></div></div>";
    return "";
  }
  function renderOpts(v) {
    groups = v.groups;
    const first = [],
      second = [];
    groups.forEach((g, n) => (g.row === 2 ? second : first).push(groupHtml(g, n)));
    opts.innerHTML = first.join("");
    opts.hidden = !first.length;
    row2.innerHTML = second.join("");
    row2.hidden = !second.length;
  }
  const onPick = (e) => {
    const b = e.target.closest("button[data-g]");
    if (!b) return;
    const g = groups[+b.dataset.g];
    BL.choose(g.id, g.type === "stepper" ? +b.dataset.i : g.items ? g.items[+b.dataset.i].v : undefined);
    back();
  };
  opts.addEventListener("click", onPick);
  row2.addEventListener("click", onPick);
  // hovering a swatch names it in the group's label
  opts.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".bsw");
    if (!b) return;
    const val = b.closest(".bgroup").querySelector(".bval");
    if (val) val.textContent = b.title;
  });
  opts.addEventListener("pointerout", (e) => {
    const b = e.target.closest(".bsw");
    if (!b) return;
    const g = groups[+b.dataset.g],
      cur = g.items.find((x) => x.v === g.value),
      val = b.closest(".bgroup").querySelector(".bval");
    if (val) val.textContent = cur ? cur.name : "";
  });
  // typed properties of the selection
  opts.addEventListener("keydown", (e) => {
    if (e.target.tagName !== "INPUT") return;
    e.stopPropagation();
    if (e.key === "Enter") e.target.blur();
    else if (e.key === "Escape") ((e.target.value = e.target.defaultValue), e.target.blur(), back());
  });
  opts.addEventListener("change", (e) => {
    if (e.target.tagName !== "INPUT") return;
    const g = groups[+e.target.dataset.g],
      v = parseFloat(e.target.value.replace(",", "."));
    isFinite(v) ? BL.choose(g.id, v) : (e.target.value = e.target.defaultValue);
    back();
  });

  /* ---------- drawn over the view ---------- */
  const over = document.createElement("div");
  over.id = "bover";
  over.innerHTML = '<div id="bmarq" hidden></div><div id="bsnapm" hidden><i></i><span></span></div>';
  document.body.appendChild(over);
  const marq = $("bmarq"),
    snapEl = $("bsnapm"),
    lb = $("blabel");
  const pool = (cls, n, html) =>
    Array.from({ length: n }, () => {
      const d = document.createElement("div");
      d.className = cls;
      d.hidden = true;
      d.innerHTML = html || "";
      over.appendChild(d);
      return d;
    });
  const dimEls = pool("bdim", 4, '<input type="text" inputmode="decimal" autocomplete="off" size="4" aria-label="Exact size"><span class="u"></span><span class="t"></span><em></em>'),
    handleEls = pool("bhandle", 2),
    measEls = pool("bmeas", 9, '<span></span><button type="button" aria-label="Clear this measurement">' + svg('<path d="M7 7l10 10M17 7L7 17"/>', 12) + "</button>");
  const v3 = new G.THREE.Vector3();
  let rc = canvas.getBoundingClientRect();
  window.addEventListener("resize", () => ((rc = canvas.getBoundingClientRect()), (lastCam = NaN)));
  const place = (el, x, y, z, dx, dy) => {
    v3.set(x, y, z).project(G.camera);
    const sx = Math.round(rc.left + (v3.x * 0.5 + 0.5) * rc.width + (dx || 0)),
      sy = Math.round(rc.top + (-v3.y * 0.5 + 0.5) * rc.height + (dy || 0));
    if (el._x !== sx || el._y !== sy) ((el._x = sx), (el._y = sy), (el.style.transform = "translate(" + sx + "px," + sy + "px)"));
    return v3.z < 1;
  };
  const show = (el, on) => {
    if (el.hidden === on) el.hidden = !on;
  };
  const text = (el, s) => {
    if (el._t !== s) ((el._t = s), (el.textContent = s));
  };
  // typed sizes: each field holds what was typed until the stroke ends
  const typed = { a: "", b: "" };
  const fieldOf = (name) => dimEls.find((d) => !d.hidden && d._f === name);
  function sendTyped() {
    BL.typed(typed.a === "" ? null : typed.a.replace(",", "."), typed.b === "" ? null : typed.b.replace(",", "."));
  }
  for (const d of dimEls) {
    const inp = d.firstChild;
    inp.addEventListener("input", () => {
      if (!d._f) return;
      typed[d._f] = inp.value.trim();
      sendTyped();
    });
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.preventDefault(), inp.blur(), back(), BL.typedCommit());
      else if (e.key === "Escape") ((typed.a = typed.b = ""), BL.typedClear(), inp.blur(), back());
      else if (e.key === "Tab" || e.key === ",") {
        e.preventDefault();
        const other = fieldOf(d._f === "a" ? "b" : "a");
        other ? (other.firstChild.focus(), other.firstChild.select()) : 0;
      }
    });
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.addEventListener("focus", () => inp.select());
  }
  // a digit typed while drawing goes straight into the size on the ghost
  BL.setType((ch) => {
    const want = ch === "next" ? "b" : document.activeElement && document.activeElement.parentNode && document.activeElement.parentNode._f === "b" ? "b" : "a",
      d = fieldOf(want) || fieldOf("a");
    if (!d) return;
    const inp = d.firstChild;
    if (ch === "next") return (inp.focus(), inp.select());
    typed[d._f] = (document.activeElement === inp ? typed[d._f] : "") + ch;
    inp.value = typed[d._f];
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    sendTyped();
  });
  for (const m of measEls) m.lastChild.addEventListener("click", () => (BL.measClear(m._n), back()));

  let uiV = -1,
    ovV = -1,
    lastCam = NaN,
    typedV = -1,
    px = -1,
    py = -1,
    cursor = "";
  function frame() {
    if (!B.on) return;
    if (uiV !== B.uiVer) {
      uiV = B.uiVer;
      const v = BL.view();
      renderOpts(v);
      text($("bhint"), v.hint);
      for (const b of pieces.children) b.dataset.piece && b.setAttribute("aria-pressed", b.dataset.piece === v.top ? "true" : "false");
      $("bundo").disabled = !v.undo;
      $("bredo").disabled = !v.redo;
      $("bsnap").setAttribute("aria-pressed", v.snap ? "true" : "false");
      $("bfree").setAttribute("aria-pressed", v.free ? "true" : "false");
      text($("blname"), v.levelName);
      $("bstop").hidden = !v.busy;
      $("bstop").children[1].textContent = v.busy === "chain" ? "Finish" : v.busy === "copy" || v.busy === "move" ? "Put down" : "Stop";
    }
    if ((B.typedV || 0) !== typedV) ((typedV = B.typedV || 0), (typed.a = typed.b = ""));
    const m = G.camera.matrixWorld.elements,
      cam = m[12] + m[13] * 3 + m[14] * 7 + m[0] * 11 + m[5] * 13 + m[10] * 17 + m[8] * 19,
      ov = B.ov,
      moved = cam !== lastCam || ovV !== B.ovVer;
    if (moved) {
      lastCam = cam;
      ovV = B.ovVer;
      dimEls.forEach((d, n) => {
        const q = ov.dims[n];
        show(d, !!q);
        if (!q) return void (d._f = "");
        const inp = d.firstChild,
          editing = q.field && typed[q.field] !== "";
        d._f = q.field;
        d.classList.toggle("field", !!q.field);
        if (q.field) {
          if (!editing && document.activeElement !== inp) {
            const s = String(Math.round(q.val * 100) / 100);
            if (inp.value !== s) inp.value = s;
          }
          text(d.children[1], q.unit);
          text(d.children[2], "");
          text(d.lastChild, n === 0 ? (B.ptr.touch ? "tap to type" : "type for exact") : "");
        } else (text(d.children[1], ""), text(d.children[2], q.text), text(d.lastChild, ""));
        place(d, q.x, q.y, q.z, 0, -18);
        // keep the size clear of the cursor
        if (Math.hypot(d._x - B.ptr.x, d._y - B.ptr.y) < 46) ((d._y -= 44), (d.style.transform = "translate(" + d._x + "px," + d._y + "px)"));
      });
      show(snapEl, !!ov.snap);
      if (ov.snap) {
        place(snapEl, ov.snap.x, ov.snap.y, ov.snap.z);
        if (snapEl._k !== ov.snap.type) ((snapEl._k = ov.snap.type), (snapEl.className = "k-" + ov.snap.type));
        text(snapEl.lastChild, ov.snap.text);
      }
      handleEls.forEach((d, n) => {
        const q = ov.handles[n];
        show(d, !!q);
        q && place(d, q[0], q[1], q[2]);
      });
      measEls.forEach((d, n) => {
        const q = ov.meas[n];
        show(d, !!q);
        if (!q) return;
        d._n = q.n;
        text(d.firstChild, q.text);
        show(d.lastChild, q.n >= 0);
        place(d, q.x, q.y, q.z, 0, -14);
      });
      show(marq, !!ov.marq);
      if (ov.marq) {
        const q = ov.marq;
        marq.style.cssText = "left:" + Math.min(q.x0, q.x1) + "px;top:" + Math.min(q.y0, q.y1) + "px;width:" + Math.abs(q.x1 - q.x0) + "px;height:" + Math.abs(q.y1 - q.y0) + "px";
      }
      show(lb, !!B.label);
      text(lb, B.label);
      lb.classList.toggle("bad", B.labelBad);
    }
    if (B.label && (px !== B.ptr.x || py !== B.ptr.y || moved)) {
      px = B.ptr.x;
      py = B.ptr.y;
      // beside the cursor, above the finger, and never under the bar
      const top = bar.getBoundingClientRect().top,
        x = Math.min(px + 18, window.innerWidth - lb.offsetWidth - 8),
        y = Math.min(B.ptr.touch ? py - 46 : py + 20, top - 34);
      lb.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    const want = B.tool === "select" ? (B.move ? "grabbing" : B.hoverId ? "pointer" : "default") : B.tapMode ? "copy" : "crosshair";
    if (want !== cursor) canvas.style.cursor = cursor = want;
  }
  B.frameHook = frame;
})();
