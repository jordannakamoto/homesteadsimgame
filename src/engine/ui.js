/* Interface kit (window.__ui): skins, icons, screen lanes, drawers, the dock, toasts and the one prompt line.
   Generic engine code: nothing here knows what game it is in. Loaded first among the add-ons. It looks
   only at the DOM and the keyboard, and does work only when something happens (a call, a key, a click,
   a panel's `hidden` changing, a timer for a toast): no requestAnimationFrame, nothing per frame.
   All looks live in template/ui/*.css; this file only sets classes and attributes.

   INTERFACE
     __ui.skin.get() -> name          __ui.skin.set(name) -> bool (saved in localStorage['ui:skin'], fires window 'ui:skin' {skin})
     __ui.skin.list                   ['cozy', 'minimal']
     __ui.icon(name, { cls, label }?) -> '<svg class="ui-ic ...">' string ('' for an unknown name)
     __ui.icons.add({ name: innerSvg }) add or replace icons (24x24 grid, stroke currentColor; closed shapes take the skin's tint)
     __ui.icons.has(name), __ui.icons.names()
     __ui.lanes.{bottom,context,prompt,toast,left,drawer}   the fixed lane elements (#ui-lane-<name>)
     __ui.mount(el | id, lane, { order, first }?) -> el      move an element into a lane; lanes stack their children
     __ui.panel({ el?, id, title, icon, kind: 'side'|'modal', wide?, onOpen, onClose })
        -> { el, body, id, open(), close(), toggle(force?), isOpen, note(text, tone?) }
        Adopts `el` (or the element with `id`) keeping its children and head as they are, or builds the shell
        (.ui-panel__head with icon, h2, .ui-panel__aside, .ui-close; .ui-panel__note; .ui-panel__body) in the drawer lane.
        Open means not [hidden]; a panel opened by setting `hidden` directly counts too. Opening a side panel closes
        every other kit panel; a modal closes other modals and sits over a side panel. Esc closes the top one.
        While any is open body has class ui-sheet. Calling panel() again for the same element returns the same handle.
     __ui.closeAll()
     __ui.dock.add({ id, label, icon, key, panel | onClick, order }) -> button
        Adopts the button with `id` if there is one (keeps its listeners and content; adds the icon if it has none),
        else builds one. panel: a handle from __ui.panel (click toggles it) or an element / id (only mirrored).
        The button's aria-pressed follows its panel. `key` is drawn as a keycap; it is bound (KeyX / DigitN)
        only on buttons the dock built, since adopted buttons already have their owner's key.
     __ui.dock.el                      the #dock element
     __ui.toast(text, { tone: 'good'|'warn'|'bad'|'info', seconds = 3, icon }?) -> { el, close() }
        Same text as the newest toast restarts it instead of stacking. At most four at once.
     __ui.prompt.show({ key, text, html, progress, tone, owner }), __ui.prompt.hide(owner?)
        One line in the prompt lane; writes only what changed. hide(owner) leaves another owner's prompt up.
     window events: 'ui:skin' { skin }, 'ui:panel' { id, open }
*/
(() => {
  if (window.__ui && window.__ui.skin) return;
  const doc = document, root = doc.documentElement;

  // ---- skins ---------------------------------------------------------------------------------------
  const SKINS = ['cozy', 'minimal'];
  const skin = {
    list: SKINS,
    get() { return SKINS.includes(root.dataset.skin) ? root.dataset.skin : SKINS[0]; },
    set(name) {
      if (!SKINS.includes(name)) return false;
      const was = root.dataset.skin;
      root.dataset.skin = name;
      try { localStorage.setItem('ui:skin', name); } catch (e) { /* private mode: live only */ }
      if (was !== name) window.dispatchEvent(new CustomEvent('ui:skin', { detail: { skin: name } }));
      return true;
    },
  };
  if (!SKINS.includes(root.dataset.skin)) {
    let s = null; try { s = localStorage.getItem('ui:skin'); } catch (e) { /* ignore */ }
    root.dataset.skin = SKINS.includes(s) ? s : SKINS[0];
  }

  // ---- icons ---------------------------------------------------------------------------------------
  // 24px grid, 2px inside the edge. Closed shapes are tinted by the skin (--icon-fill); details that must
  // stay open carry fill="none"; solid dots carry fill="currentColor" stroke="none".
  const O = ' fill="none"', DOT = ' fill="currentColor" stroke="none"';
  const CLOUD_HI = 'M7 14.5h10a3.5 3.5 0 0 0 .4-6.98A5.2 5.2 0 0 0 7.3 8a3.25 3.25 0 0 0-.3 6.5z';
  const ICONS = {
    coin: '<circle cx="12" cy="12" r="9"/><path' + O + ' d="M14.6 9.4c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 1.95 0 2.6 5.2 1.3 5.2 4.2 0 1.15-1.1 2-2.6 2-1.3 0-2.3-.6-2.7-1.5M12 6.3v1.6M12 16.1v1.6"/>',
    wood: '<circle cx="7.5" cy="16" r="4"/><circle cx="16.5" cy="16" r="4"/><circle cx="12" cy="8" r="4"/><circle cx="7.5" cy="16" r="1.2"' + DOT + '/><circle cx="16.5" cy="16" r="1.2"' + DOT + '/><circle cx="12" cy="8" r="1.2"' + DOT + '/>',
    stone: '<path d="M3.5 17.5 5.6 11l4.2-4.3h4.6l4.3 4.2 1.8 6.1-2.4 2.5H6z"/><path' + O + ' d="m9.8 6.7 2 6.3 6.9-2.1M11.8 13l-2.3 6.5"/>',
    bag: '<path d="M7.5 8h9l3 5v5a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-5z"/><path' + O + ' d="M9 8V6a3 3 0 0 1 6 0v2M8.5 13.5h7"/>',
    shop: '<path d="M3.5 9 5 4h14l1.5 5a2.83 2.83 0 0 1-5.67 0 2.83 2.83 0 0 1-5.66 0 2.83 2.83 0 0 1-5.67 0z"/><path' + O + ' d="M5 12v8h14v-8M10 20v-4.5h4V20"/>',
    list: '<path' + O + ' d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5"/><circle cx="5" cy="6" r="1.4"' + DOT + '/><circle cx="5" cy="12" r="1.4"' + DOT + '/><circle cx="5" cy="18" r="1.4"' + DOT + '/>',
    hen: '<path d="M6.5 11.5c0-3.2 1.5-5.5 3.8-5.5 2.2 0 3.4 1.8 3.4 4 0 1.1.7 1.8 1.8 1.8h1.8l2.4-3.3c1.2 5.2-1.4 9.8-7.2 9.8-3.6 0-6-2.6-6-6.8z"/><path' + O + ' d="M6.6 9.2 4.2 10.2l2.4.8M8.5 6.3c-.3-1.3.4-2.3 1.5-2.3.4-.9 1.6-.9 2 .2M10.5 18v3M14 17.5V21M9 21h3M12.5 21h3"/><circle cx="9.6" cy="9" r=".9"' + DOT + '/>',
    home: '<path d="M5 10.5 12 4.5l7 6V20H5z"/><path' + O + ' d="M3 12.2 12 4.5l9 7.7M10 20v-5.5h4V20"/>',
    hammer: '<g transform="rotate(45 12 12)"><path' + O + ' d="M12 9v12"/><path d="M7.5 4h8.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H7.5L6 7.6V5.4z"/></g>',
    gear: '<path d="M10.19 4.93L10.38 2.54L13.62 2.54L13.81 4.93A7.3 7.3 0 0 1 15.72 5.72L17.54 4.16L19.84 6.46L18.28 8.28A7.3 7.3 0 0 1 19.07 10.19L21.46 10.38L21.46 13.62L19.07 13.81A7.3 7.3 0 0 1 18.28 15.72L19.84 17.54L17.54 19.84L15.72 18.28A7.3 7.3 0 0 1 13.81 19.07L13.62 21.46L10.38 21.46L10.19 19.07A7.3 7.3 0 0 1 8.28 18.28L6.46 19.84L4.16 17.54L5.72 15.72A7.3 7.3 0 0 1 4.93 13.81L2.54 13.62L2.54 10.38L4.93 10.19A7.3 7.3 0 0 1 5.72 8.28L4.16 6.46L6.46 4.16L8.28 5.72A7.3 7.3 0 0 1 10.19 4.93Z"/><circle' + O + ' cx="12" cy="12" r="3"/>',
    close: '<path' + O + ' d="M6 6l12 12M18 6 6 18"/>',
    back: '<path' + O + ' d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
    menu: '<path' + O + ' d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    check: '<path' + O + ' d="m4.5 12.5 4.8 4.8L19.5 7"/>',
    plus: '<path' + O + ' d="M12 5v14M5 12h14"/>',
    minus: '<path' + O + ' d="M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path' + O + ' d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.2"' + DOT + '/>',
    sun: '<circle cx="12" cy="12" r="4"/><path' + O + ' d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55"/>',
    moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 11a3.75 3.75 0 0 0 0 7.5z"/>',
    rain: '<path d="' + CLOUD_HI + '"/><path' + O + ' d="m8.5 17.5-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>',
    snow: '<path d="' + CLOUD_HI + '"/><circle cx="8" cy="18" r="1.1"' + DOT + '/><circle cx="12" cy="20.2" r="1.1"' + DOT + '/><circle cx="16" cy="18" r="1.1"' + DOT + '/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>',
    play: '<path d="M8 5.2v13.6L18.8 12z"/>',
    fast: '<path d="M3.5 6.5v11L11 12zM12.5 6.5v11L20 12z"/>',
    faster: '<path d="M2.5 7.5v9L7.6 12zM9.4 7.5v9l5.1-4.5zM16.3 7.5v9l5.1-4.5z"/>',
    fastest: '<path d="M1.8 8.2v7.6L5.6 12zM7 8.2v7.6l3.8-3.8zM12.2 8.2v7.6L16 12zM17.4 8.2v7.6l3.8-3.8z"/>',
    bolt: '<path d="M13.5 2.5 5 13.5h6.2L10.5 21.5 19 10.5h-6.2z"/>',
    apple: '<path d="M12 8c-1.4-1-2.9-1.3-4.3-1C5.1 7.5 3.8 10 4.2 13.1c.5 3.9 3.1 7.9 5.8 7.9.8 0 1.3-.4 2-.4s1.2.4 2 .4c2.7 0 5.3-4 5.8-7.9.4-3.1-.9-5.6-3.5-6.1-1.4-.3-2.9 0-4.3 1z"/><path' + O + ' d="M12 8c0-2 .6-3.6 2-4.8M12.6 5.6c1.3-1.6 3.4-1.9 4.4-1.5-.4 1.6-2 2.7-4.4 1.5"/>',
    axe: '<path' + O + ' d="M5 20.5 15 6.5"/><path d="M11 6.8 14.2 2.5c3.9.4 6.9 3.4 7.3 7.3l-4.3 3.2C17 9.9 14.4 7.2 11 6.8z"/>',
    dig: '<path' + O + ' d="m11.5 12.5 7-7M16.5 3.5l4 4"/><path d="m3.5 20.5 1-5.5 3.5-3.5 4.5 4.5-3.5 3.5z"/>',
    raise: '<path' + O + ' d="M12 17V4.5M7 9.5l5-5 5 5M4 20.5h16"/>',
    level: '<rect x="2.5" y="8.5" width="19" height="7" rx="2"/><rect' + O + ' x="9" y="10.5" width="6" height="3" rx="1.5"/><path' + O + ' d="M12 10.5v3"/>',
    sprout: '<path d="M12 13.5C12 9.6 9.5 7 5 7c0 3.9 2.6 6.5 7 6.5zM12 11.5c0-3.2 2.2-5.8 7-5.8 0 3.2-2.3 5.8-7 5.8z"/><path' + O + ' d="M12 20.5v-9M7 20.5h10"/>',
    shrub: '<path d="M6.2 17.5a4.2 4.2 0 0 1-1-8.3 4.8 4.8 0 0 1 6.8-4.4 4.8 4.8 0 0 1 6.8 4.4 4.2 4.2 0 0 1-1 8.3z"/><path' + O + ' d="M12 17.5v3M8.5 20.5h7"/>',
    stake: '<path d="M10 3.5h4v12.5l-2 4.5-2-4.5z"/><path d="M14 4.5h6l-1.6 2.5L20 9.5h-6z"/>',
    hand: '<path d="M7 12.5V7a1.5 1.5 0 0 1 3 0v4.5V4.5a1.5 1.5 0 0 1 3 0v7V5.5a1.5 1.5 0 0 1 3 0v6.5V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.7-2.3l-2.5-3.2a1.6 1.6 0 0 1 2.4-2.1z"/>',
    blueprint: '<rect x="3" y="3.5" width="18" height="17" rx="1.8"/><path' + O + ' d="M8 14v-3.6l4-3.4 4 3.4V14zM7 17.3h10M7 16.2v2.2M17 16.2v2.2"/>',
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function icon(name, opt) {
    const inner = ICONS[name];
    if (inner == null) return '';
    const o = opt || {};
    const cls = 'ui-ic ui-ic--' + name + (o.cls ? ' ' + o.cls : '');
    const a11y = o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : ' aria-hidden="true" focusable="false"';
    return '<svg class="' + cls + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + a11y + '>' + inner + '</svg>';
  }
  const icons = {
    add(map) { for (const k in map) if (typeof map[k] === 'string') ICONS[k] = map[k]; },
    has: (name) => ICONS[name] != null,
    names: () => Object.keys(ICONS),
  };

  // ---- lanes ---------------------------------------------------------------------------------------
  const LANES = ['bottom', 'context', 'prompt', 'toast', 'left', 'drawer'];
  const lanes = {};
  for (const n of LANES) {
    let el = doc.getElementById('ui-lane-' + n);
    if (!el) { el = doc.createElement('div'); el.id = 'ui-lane-' + n; doc.body.appendChild(el); }
    el.classList.add('ui-lane', 'ui-lane--' + n);
    lanes[n] = el;
  }
  lanes.toast.setAttribute('aria-live', 'polite');
  const $ = (x) => (typeof x === 'string' ? doc.getElementById(x) : x) || null;
  function mount(x, lane, opt) {
    const el = $(x), L = lanes[lane];
    if (!el || !L) return el;
    const o = opt || {};
    if (o.order != null) el.style.order = String(o.order);
    if (o.first) L.insertBefore(el, L.firstChild); else if (el.parentNode !== L) L.appendChild(el);
    return el;
  }

  // ---- panels --------------------------------------------------------------------------------------
  const handles = new Map();      // element -> handle
  const stack = [];               // open kit panels, newest last
  const mirrors = new Map();      // element -> Set of buttons whose aria-pressed follows it
  const fire = (id, open) => window.dispatchEvent(new CustomEvent('ui:panel', { detail: { id, open } }));
  function syncPressed(el) {
    const set = mirrors.get(el); if (!set) return;
    const v = el.hidden ? 'false' : 'true';
    for (const b of set) if (b.getAttribute('aria-pressed') !== v) b.setAttribute('aria-pressed', v);
  }
  // A mirrored element that is not a kit panel still needs watching for its buttons.
  const watched = new WeakSet();
  const observer = new MutationObserver((list) => {
    const seen = new Set();
    for (const m of list) if (!seen.has(m.target)) { seen.add(m.target); const h = handles.get(m.target); if (h) h._sync(); else syncPressed(m.target); }
  });
  function watch(el) { if (!watched.has(el)) { watched.add(el); observer.observe(el, { attributes: true, attributeFilter: ['hidden'] }); } }
  function syncSheet() { doc.body.classList.toggle('ui-sheet', stack.length > 0); }

  function panel(opt) {
    const o = opt || {};
    let el = $(o.el) || (o.id ? doc.getElementById(o.id) : null);
    if (el && handles.has(el)) return handles.get(el);
    const kind = o.kind === 'modal' ? 'modal' : 'side';
    const built = !el;
    if (built) {
      el = doc.createElement('section');
      if (o.id) el.id = o.id;
      el.hidden = true;
      el.innerHTML = '<header class="ui-panel__head">' + (o.icon ? icon(o.icon) : '') + '<h2></h2><div class="ui-panel__aside"></div>' +
        '<button type="button" class="ui-close ui-btn ui-btn--icon ui-btn--ghost" aria-label="Close" title="Close (Esc)">' + icon('close') + '</button></header>' +
        '<div class="ui-panel__note" hidden></div><div class="ui-panel__body"></div>';
      el.querySelector('h2').textContent = o.title || '';
      lanes.drawer.appendChild(el);
    }
    el.classList.add('panel', 'ui-panel', 'ui-panel--' + kind);
    if (o.wide) el.classList.add('ui-panel--wide');
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    if (!el.getAttribute('aria-label') && o.title) el.setAttribute('aria-label', o.title);
    const body = el.querySelector('.ui-panel__body') || el;
    let was = !el.hidden;
    const h = {
      el, body, kind, id: el.id || o.id || '',
      get isOpen() { return !el.hidden; },
      open() { if (el.hidden) el.hidden = false; h._sync(); return h; },
      close() { if (!el.hidden) el.hidden = true; h._sync(); return h; },
      toggle(force) { return (force == null ? el.hidden : force) ? h.open() : h.close(); },
      note(text, tone) {
        let n = el.querySelector('.ui-panel__note');
        if (!n) {
          n = doc.createElement('div'); n.className = 'ui-panel__note';
          const head = el.querySelector('.ui-panel__head');
          if (head) head.after(n); else el.insertBefore(n, el.firstChild);
        }
        const t = text == null ? '' : String(text);
        if (n.textContent !== t) n.textContent = t;
        n.classList.remove('is-good', 'is-warn', 'is-bad', 'is-info');
        if (tone) n.classList.add('is-' + tone);
        n.hidden = !t;
        return h;
      },
      _sync() {
        const now = !el.hidden;
        if (now === was) { syncPressed(el); return; }
        was = now;
        const i = stack.indexOf(h);
        if (i >= 0) stack.splice(i, 1);
        if (now) {
          // one at a time: a side panel closes all others; a modal closes other modals only
          for (const other of stack.slice()) if (kind === 'side' || other.kind === 'modal') other.close();
          stack.push(h);
        }
        syncSheet(); syncPressed(el);
        const cb = now ? o.onOpen : o.onClose;
        if (cb) { try { cb(h); } catch (e) { console.warn('ui: panel ' + h.id + (now ? ' onOpen' : ' onClose') + ' failed', e); } }
        fire(h.id, now);
      },
    };
    handles.set(el, h);
    watch(el);
    el.addEventListener('click', (e) => { const c = e.target.closest && e.target.closest('.ui-close'); if (c && el.contains(c) && handles.get(el) === h) h.close(); });
    if (was) { was = false; h._sync(); }
    return h;
  }
  function closeAll() { for (const h of stack.slice().reverse()) h.close(); }
  // Esc closes the top kit panel, before any other key handler sees it.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    // a stale entry (element removed from the page) does not count as open
    while (stack.length && !stack[stack.length - 1].el.isConnected) { stack.pop(); syncSheet(); }
    if (!stack.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    stack[stack.length - 1].close();
  }, true);

  // ---- dock ----------------------------------------------------------------------------------------
  const keyCode = (k) => { if (!k) return ''; const s = String(k); return /^[a-z]$/i.test(s) ? 'Key' + s.toUpperCase() : /^\d$/.test(s) ? 'Digit' + s : s; };
  const keyLabel = (k) => String(k).replace(/^Key|^Digit/, '');
  const dockKeys = new Map();     // code -> button
  function dockEl() {
    let d = doc.getElementById('dock');
    if (!d) { d = doc.createElement('nav'); d.id = 'dock'; d.setAttribute('aria-label', 'Launchers'); lanes.left.appendChild(d); }
    d.classList.add('ui-dock');
    return d;
  }
  function place(d, b, order) {
    b.dataset.order = String(order);
    for (const c of d.children) if (c !== b && c.dataset.order != null && +c.dataset.order > order) { d.insertBefore(b, c); return; }
    if (b.parentNode !== d || b.nextSibling) d.appendChild(b);
  }
  let dockSeq = 0;
  function dockAdd(opt) {
    const o = opt || {}, d = dockEl();
    let b = o.id ? doc.getElementById(o.id) : null;
    const adopted = !!b;
    if (!b) {
      b = doc.createElement('button'); b.type = 'button'; if (o.id) b.id = o.id;
      b.innerHTML = (o.icon ? icon(o.icon) : '') + '<span class="nm"></span>' + (o.key ? '<span class="ui-key">' + esc(keyLabel(o.key)) + '</span>' : '');
      b.querySelector('.nm').textContent = o.label || '';
    } else if (o.icon && !b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', icon(o.icon));
    b.classList.add('ui-dock-btn');
    if (o.label) { b.setAttribute('aria-label', o.label); if (!b.title) b.title = o.label + (o.key ? ' (' + keyLabel(o.key) + ')' : ''); }
    place(d, b, o.order != null ? +o.order : 100 + dockSeq++);
    const ph = o.panel && o.panel.el && handles.get(o.panel.el) === o.panel ? o.panel : null;
    const pel = ph ? ph.el : $(o.panel);
    if (pel) {
      let set = mirrors.get(pel); if (!set) mirrors.set(pel, set = new Set());
      set.add(b); watch(pel); syncPressed(pel);
    }
    if (!b._uiDock) {
      b._uiDock = true;
      b.addEventListener('click', () => { const c = b._uiDockCfg; if (c.ph) c.ph.toggle(); if (c.onClick) c.onClick(b); });
    }
    b._uiDockCfg = { ph, onClick: typeof o.onClick === 'function' ? o.onClick : null };
    if (!adopted && o.key) dockKeys.set(keyCode(o.key), b);
    return b;
  }
  window.addEventListener('keydown', (e) => {
    if (!dockKeys.size || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const b = dockKeys.get(e.code); if (!b || !b.isConnected || b.disabled || b.hidden) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    e.preventDefault(); b.click();
  });
  const dock = { add: dockAdd, get el() { return dockEl(); } };

  // ---- toasts --------------------------------------------------------------------------------------
  const TONES = { good: 'is-good', warn: 'is-warn', bad: 'is-bad', info: 'is-info' };
  const MAX_TOASTS = 4;
  let lastToast = null;
  function toast(text, opt) {
    const o = opt || {}, secs = o.seconds != null ? +o.seconds : 3, t = String(text == null ? '' : text);
    if (lastToast && lastToast.el.isConnected && !lastToast.leaving && lastToast.text === t && lastToast.tone === (o.tone || '')) { lastToast.restart(secs); return lastToast; }
    const el = doc.createElement('div');
    el.className = 'ui-toast' + (TONES[o.tone] ? ' ' + TONES[o.tone] : '');
    el.setAttribute('role', 'status');
    el.innerHTML = (o.icon ? icon(o.icon) : '') + '<span class="ui-toast__text"></span>';
    el.lastChild.textContent = t;
    lanes.toast.appendChild(el);
    let timer = 0;
    const T = {
      el, text: t, tone: o.tone || '', leaving: false,
      close() {
        if (T.leaving) return; T.leaving = true; clearTimeout(timer);
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 320);   // CSS may fade it out over that time
        if (lastToast === T) lastToast = null;
      },
      restart(s) { clearTimeout(timer); if (s > 0) timer = setTimeout(T.close, s * 1000); },
    };
    T.restart(secs);
    const live = [...lanes.toast.children].filter((c) => !c.classList.contains('is-leaving'));
    for (let i = 0; i < live.length - MAX_TOASTS; i++) live[i].remove();
    lastToast = T;
    return T;
  }

  // ---- the prompt line -----------------------------------------------------------------------------
  const pEl = doc.createElement('div');
  pEl.id = 'ui-prompt'; pEl.className = 'ui-prompt'; pEl.hidden = true;
  pEl.innerHTML = '<kbd class="ui-key" hidden></kbd><span class="ui-prompt__text"></span><span class="ui-prompt__bar" hidden><i></i></span>';
  lanes.prompt.appendChild(pEl);
  const pKey = pEl.children[0], pText = pEl.children[1], pBar = pEl.children[2], pFill = pBar.firstChild;
  let pOwner = null, pLast = {};
  const prompt = {
    show(opt) {
      const o = opt || {};
      pOwner = o.owner != null ? o.owner : null;
      const key = o.key ? keyLabel(o.key) : '';
      if (pLast.key !== key) { pKey.textContent = key; pKey.hidden = !key; pLast.key = key; }
      const isHtml = o.html != null, txt = String(isHtml ? o.html : o.text == null ? '' : o.text);
      if (pLast.txt !== txt || pLast.isHtml !== isHtml) { if (isHtml) pText.innerHTML = txt; else pText.textContent = txt; pLast.txt = txt; pLast.isHtml = isHtml; }
      const p = typeof o.progress === 'number' && isFinite(o.progress) ? Math.max(0, Math.min(1, o.progress)) : null;
      if (pLast.p !== p) { pBar.hidden = p == null; if (p != null) pFill.style.transform = 'scaleX(' + p.toFixed(3) + ')'; pLast.p = p; }
      const tone = TONES[o.tone] || '';
      if (pLast.tone !== tone) { pEl.classList.remove(...Object.values(TONES)); if (tone) pEl.classList.add(tone); pLast.tone = tone; }
      if (pEl.hidden) pEl.hidden = false;
    },
    hide(owner) {
      if (owner != null && pOwner != null && owner !== pOwner) return;
      if (!pEl.hidden) pEl.hidden = true;
      pOwner = null;
    },
    get el() { return pEl; },
    get shown() { return !pEl.hidden; },
  };

  window.__ui = { skin, icon, icons, lanes, mount, panel, closeAll, dock, toast, prompt };
})();
