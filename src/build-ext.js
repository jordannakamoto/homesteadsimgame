/* Build mode's extension point (X1). New building elements (decks, porches, lofts, skylights, chimneys) live in their
   own files and register here through window.__build.extend(spec), so src/build.js does not grow. Loaded just before
   build.js, which binds itself to it (EXT.bind) and calls it at a handful of fixed places:
   - membersOf: describe(S, desc, h) after the walls, floors and roofs are filled; an extension pushes elements into
     desc.extras (members made by the kind it registered with window.__framing.register) or adds to desc.roofs etc.
   - structPieces: pieces(S, out, h) adds the extension's own pieces (a deck as a floor piece...) before members are
     attached to what they belong to, so a piece lists its members and is built when they all are.
   - drawMembers: draw(S, add, mem, st, h) for meshes that are not plain members (add(mesh) puts it in the building and
     disposes it on the next redraw).
   - serialize / restore / undo: S.ext, an object { [extId]: data } of plain JSON, kept with the structure.
   - view / choose / pointerdown: tools an extension brings (a button on the bar, options, a click on the world).
   - pickAt / select click / Delete: pick(S, R, h) puts the extension's own pieces under the pointer (Select picks them, its
     inspector shows, Delete calls remove(key)); bounds(S, h) widens the structure's extent; ground(S, lx, lz, y, h) is a
     walking surface (a deck's boards).
   See ARCHITECTURE.md, "Adding to build mode". */
(() => {
  const exts = new Map(), // id -> spec, in registration order
    tools = new Map(); // tool id -> { ext, tool }
  let host = null,
    barDirty = false;
  const ID = /^[a-z][a-z0-9-]*$/;
  const warn = (ext, where, err) => console.error("build extension " + ext.id + " (" + where + "):", err);
  // each extension hook runs on its own: one that throws is reported and skipped, the building is still drawn
  function each(name, fn) {
    for (const e of exts.values())
      if (typeof e[name] === "function")
        try {
          fn(e);
        } catch (err) {
          warn(e, name, err);
        }
  }
  const dataOf = (S, id) => (S.ext && S.ext[id] !== undefined ? S.ext[id] : null);
  const own = (S, e, h) => ({ ...h, data: dataOf(S, e.id), pid: (key) => EXT.pid(S, e.id, key) });
  // the extensions' buttons on the build bar, added once the bar exists (src/buildui.js draws the built-in tools)
  function syncBar() {
    const bar = typeof document !== "undefined" && document.getElementById("bpieces");
    if (!bar || bar.dataset.slots) return; // the slot bar (src/buildui.js) files them under their cat itself, from view().tools
    barDirty = false;
    for (const [id, { tool }] of tools) {
      let b = bar.querySelector('button[data-piece="' + id + '"]');
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.dataset.piece = id;
        b.dataset.ext = "1";
        b.setAttribute("aria-pressed", "false");
        bar.appendChild(b);
      }
      b.title = tool.name + (tool.title ? ": " + tool.title : "");
      b.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (tool.icon || '<rect x="5" y="5" width="14" height="14" rx="2"/>') + '</svg><span class="name">' + tool.name + '</span><span class="key"></span>';
    }
  }
  let sel = null; // what an extension has selected itself: { ext, key }, shown by its inspector under the Select tool
  const picked = new Map(); // piece id -> { ext, key } of what pick() last found under the pointer
  const EXT = {
    // build.js hands over what the extension point needs: { refresh(), touch(), selecting(), hints, tools }
    bind(h) {
      host = h;
    },
    // extend({ id, describe?(S, desc, h), pieces?(S, out, h), draw?(S, add, mem, st, h), tools?: [{ id, name, icon?, title?,
    // hint?, group?, cat?, letter?, options?(g, G_), choose?(key, v), down?(hover, e), hover?(hover) }], inspector?(g, G_, key) })
    // Groups an options() or inspector() pushes go in the tray; give one sec: "<section>" to put it in the inspector instead
    extend(spec) {
      if (!spec || !ID.test(spec.id || "")) throw new Error("__build.extend: an extension needs an id of lower-case letters, digits and dashes");
      const old = exts.get(spec.id);
      if (old) for (const t of old.tools || []) tools.delete(t.id);
      for (const t of spec.tools || []) {
        if (!ID.test(t.id || "") || !t.name) throw new Error("__build.extend(" + spec.id + "): a tool needs an id and a name");
        if (t.letter !== undefined && !(/^[A-Z]$/.test(t.letter) && !(host && host.tools.some((q) => q.letter === t.letter)))) throw new Error("__build.extend(" + spec.id + "): tool " + t.id + " needs a free capital letter");
        if ((host && host.tools.some((q) => q.id === t.id)) || (tools.has(t.id) && tools.get(t.id).ext !== spec.id)) throw new Error("__build.extend(" + spec.id + "): tool " + t.id + " is taken");
      }
      exts.set(spec.id, spec);
      for (const t of spec.tools || []) {
        tools.set(t.id, { ext: spec.id, tool: t });
        if (host && t.hint) host.hints[t.id] = t.hint;
      }
      barDirty = true;
      syncBar();
      // buildings already standing (a save loaded before this file ran) take the extension in now
      host && host.refresh();
      return spec;
    },
    get: (id) => exts.get(id) || null,
    // an extension selects one of its own things (key is its own) or clears it (null); its inspector(g, G_, key) then
    // fills the options strip while the Select tool is in hand and build mode has nothing of its own selected
    select(extId, key) {
      sel = extId && exts.has(extId) ? { ext: extId, key } : null;
      host && host.touch();
    },
    selected: () => (sel ? { ...sel } : null),
    list: () => [...exts.keys()],
    // a piece id for something an extension owns, unique across buildings and stable through saves and undo (the structure
    // keeps its id): "x-<ext>-<struct>-<key>". It never starts with "p", so build mode's piece counter ignores it.
    pid: (S, extId, key) => "x-" + extId + "-" + S.id + "-" + key,
    // ---- called by build.js
    // h is build.js's helpers plus, for each extension, data (its S.ext entry or null) and pid(key) (EXT.pid for it)
    describe(S, desc, h) {
      desc.extras || (desc.extras = []);
      each("describe", (e) => e.describe(S, desc, own(S, e, h)));
    },
    pieces(S, out, h) {
      each("pieces", (e) => e.pieces(S, out, own(S, e, h)));
    },
    draw(S, add, mem, st) {
      each("draw", (e) => e.draw(S, add, mem, st, own(S, e, {})));
    },
    // the nearest of the extensions' own pieces along a ray in the structure's frame (build.js pickAt), nearer than bt
    pick(S, R, bt, hitBox) {
      let best = null;
      each("pick", (e) => {
        const r = e.pick(S, R, own(S, e, { hitBox }));
        if (r && r.t >= 0 && r.t < (best ? best.t : bt)) best = { t: r.t, id: r.id || EXT.pid(S, e.id, r.key), ext: e.id, key: r.key };
      });
      if (best) picked.set(best.id, { ext: best.ext, key: best.key });
      return best;
    },
    // Select clicked id: an extension's piece is selected there (true); anything else clears the extension's selection
    click(id) {
      const q = id && picked.get(id);
      if (q) return (EXT.select(q.ext, q.key), true);
      if (sel) EXT.select(null);
      return false;
    },
    // Delete with an extension's piece selected: its remove(key); true when it took it
    remove() {
      const e = sel && exts.get(sel.ext);
      if (!e || typeof e.remove !== "function") return false;
      let ok = false;
      try {
        ok = e.remove(sel.key) !== false;
      } catch (err) {
        warn(e, "remove", err);
      }
      if (ok) EXT.select(null);
      return ok;
    },
    bounds(S) {
      const out = [];
      if (S.ext) each("bounds", (e) => { const pts = dataOf(S, e.id) !== null && e.bounds(S, own(S, e, {})); if (pts) for (const p of pts) out.push(p); });
      return out;
    },
    // the highest walking surface the extensions have at (lx, lz) no more than a step above y (all in the structure's frame), or null
    ground(S, lx, lz, y) {
      let g = null;
      each("ground", (e) => {
        if (dataOf(S, e.id) === null) return;
        const v = e.ground(S, lx, lz, y, own(S, e, {}));
        if (v !== null && v !== undefined && (g === null || v > g)) g = v;
      });
      return g;
    },
    // redraw build mode's bar and options strip (an extension's live readout)
    touch: () => host && host.touch(),
    isTool: (id) => tools.has(id),
    // as build.js's TOOLS: cat is the bar slot it goes in ("more" unless it says), letter its key (none unless it says
    // one build mode leaves free), tip the slot's longer title, icon its SVG markup on a 24 x 24 grid
    tools: () => [...tools.values()].map(({ tool }) => ({ id: tool.id, name: tool.name, key: "", code: "", group: tool.group === undefined ? 5 : tool.group, ext: true, cat: tool.cat || "more", letter: tool.letter || "", tip: tool.title || tool.hint || "", icon: tool.icon || "" })),
    // the options strip for an extension's tool, or its inspector
    view(t, g, G_) {
      barDirty && syncBar();
      if (t === "select" && sel && !(host && host.selecting())) {
        const e = exts.get(sel.ext);
        if (e && e.inspector)
          try {
            e.inspector(g, G_, sel.key);
          } catch (err) {
            warn(e, "inspector", err);
          }
        return;
      }
      const q = tools.get(t);
      if (!q || !q.tool.options) return;
      try {
        q.tool.options(g, G_);
      } catch (err) {
        warn(exts.get(q.ext), "options", err);
      }
    },
    // an option an extension's control reports: ids "x:<tool>:<key>". True when it was one.
    choose(id, v) {
      const m = /^x:([a-z0-9-]+):(.*)$/.exec(id);
      const q = m && tools.get(m[1]);
      if (!q) return false;
      q.tool.choose && q.tool.choose(m[2], v);
      return true;
    },
    // a click on the world while an extension's tool is in hand: hover is build mode's (h.F the building or a new one,
    // h.lx/h.lz local metres, h.wx/h.wy/h.wz the world point)
    down(t, hover, e) {
      const q = tools.get(t);
      q && q.tool.down && q.tool.down(hover, e);
    },
    hover(t, hover) {
      const q = tools.get(t);
      q && q.tool.hover && q.tool.hover(hover);
    },
  };
  globalThis.__buildExt = EXT; // the page: window.__buildExt; headless tests read globalThis.__buildExt
})();
