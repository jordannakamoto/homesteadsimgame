/* The homestead HUD wiring (content; loaded last among the add-ons). The kit (window.__ui, src/engine/ui.js) is
   generic; this file knows the game's own elements: it puts them in the kit's lanes, adds icons, opens the
   settings drawer from the gear, registers the dock, and turns the lone tool button of a sub-mode into a
   "back to the axe" chip. Looks are template/ui/20-hud.css. Event-driven only: nothing runs per frame.

   What it does, in order:
   - lanes: #tools -> bottom (first), #dock + #cvnext -> left, #msg + #cvbanner -> toast, #lock + #cvprompt -> prompt
   - icons: #tools buttons by data-tool (also ones added later, like the Site button), #stock items, #vitals bars,
     the clock chip (sun by day, moon by night), the weather chip (by #wxcond), drawer heads, .ui-close buttons
   - drawers: #status (settings, opened by #hud-gear), #sv, #ck, #ut, #cv, #wxpanel, #gfxsettings are kit panels
     (one open at a time, Esc closes). Views still open and close them by `hidden`; when the kit closes one, the
     two views that keep their own open flag (Home, weather) are told.
   - dock: the five launchers via __ui.dock.add (Bag and Shop are pressed by the Belongings tab that is showing)
   - skin tiles in the settings drawer
   - the mode chip: a click on the pressed Garden / Yard / Site / Hands button goes back to the axe */
(function () {
  const U = window.__ui, G = window.__game;
  if (!U || !U.skin || !document.getElementById('hud-top')) return;
  const $ = (id) => document.getElementById(id);
  const view = () => $('view');
  const focusView = () => { const v = view(); if (v) v.focus(); };
  const ic = (name, cls) => U.icon(name, cls ? { cls } : undefined);
  const prependIcon = (el, name, cls) => { if (el && name && !el.querySelector(':scope > svg.ui-ic')) el.insertAdjacentHTML('afterbegin', ic(name, cls)); };
  const setIcon = (el, name) => {
    if (!el) return;
    const cur = el.querySelector(':scope > svg.ui-ic');
    if (cur && cur.classList.contains('ui-ic--' + name)) return;
    if (cur) cur.remove();
    el.insertAdjacentHTML('afterbegin', ic(name));
  };

  // ---- lanes ---------------------------------------------------------------------------------------
  U.mount('tools', 'bottom', { first: true, order: 0 });
  U.mount('dock', 'left', { order: 0 });
  U.mount('cvnext', 'left', { order: 1 });
  U.mount('msg', 'toast');
  U.mount('cvbanner', 'toast');
  U.mount('cvprompt', 'prompt');
  U.mount('lock', 'prompt', { order: 9 });
  { const sh = $('shelter'), st = $('stock'); if (sh && st) { st.appendChild(sh); prependIcon(sh, 'home'); } }

  // ---- tool icons and the mode chip ----------------------------------------------------------------
  const TOOL_ICON = { axe: 'axe', dig: 'dig', raise: 'raise', level: 'level', garden: 'sprout', yard: 'shrub', site: 'stake', hands: 'hand', build: 'blueprint' };
  const SUB = new Set(['garden', 'yard', 'site', 'hands']);
  const tools = $('tools');
  function decorateTools() {
    if (!tools) return;
    for (const b of tools.querySelectorAll(':scope > button[data-tool]')) {
      const name = TOOL_ICON[b.dataset.tool];
      if (name && !b.querySelector(':scope > svg.ui-ic')) {
        const key = b.querySelector(':scope > .key');
        if (key) key.insertAdjacentHTML('afterend', ic(name)); else prependIcon(b, name);
      }
      if (SUB.has(b.dataset.tool) && !b.querySelector('.hud-back')) b.insertAdjacentHTML('beforeend', '<span class="hud-back" aria-hidden="true">' + ic('back') + '</span>');
      if (!b.title) { const n = b.querySelector('.name'), k = b.querySelector('.key'); if (n) b.title = n.textContent + (k ? ' (' + k.textContent + ')' : ''); }
    }
  }
  if (tools) {
    decorateTools();
    new MutationObserver(decorateTools).observe(tools, { childList: true });
    // capture: runs before the engine's own click handler on the button, which would just pick the mode again
    tools.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button[data-tool]');
      if (!b || b.parentNode !== tools || b.getAttribute('aria-pressed') !== 'true' || !SUB.has(b.dataset.tool)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (G && G.setTool) G.setTool('axe');
      focusView();
    }, true);
  }

  // ---- stock and vitals ----------------------------------------------------------------------------
  for (const it of document.querySelectorAll('#stock > .item[data-ic]')) prependIcon(it, it.dataset.ic);
  const VITAL_ICON = { stbar: 'bolt', hungerbar: 'apple', hpbar: 'plus' };
  function decorateVitals() {
    for (const bar of document.querySelectorAll('#vitals > .bar')) {
      const fill = bar.querySelector('.fill[id]');
      if (fill && VITAL_ICON[fill.id]) prependIcon(bar, VITAL_ICON[fill.id]);
      const lab = bar.querySelector('.label'); if (lab && !bar.title) bar.title = lab.textContent;
    }
  }
  decorateVitals();
  { const v = $('vitals'); if (v) new MutationObserver(decorateVitals).observe(v, { childList: true }); }
  // money pops when it changes (the engine rewrites the text twice a second; only a new value counts)
  {
    const m = $('money'), chip = m && m.closest('.item');
    let last = m ? m.textContent : '', t = 0;
    if (m && chip) new MutationObserver(() => {
      const v = m.textContent; if (v === last) return; last = v;
      chip.classList.remove('ui-pop'); void chip.offsetWidth; chip.classList.add('ui-pop');
      clearTimeout(t); t = setTimeout(() => chip.classList.remove('ui-pop'), 340);
    }).observe(m, { childList: true, characterData: true, subtree: true });
  }

  // ---- clock and weather chips ---------------------------------------------------------------------
  const clockChip = $('hud-clock'), clockEl = $('clock');
  let night = null;
  function syncClock() {
    const h = parseInt((clockEl && clockEl.textContent) || '12', 10);
    const n = !(h >= 6 && h < 20);
    if (n === night) return;
    night = n;
    setIcon(clockChip, n ? 'moon' : 'sun');
    clockChip.classList.toggle('is-night', n);
    syncWeather(true);
  }
  const wxBtn = $('wxbtn'), wxCond = $('wxcond');
  let wxLast = '';
  function syncWeather(force) {
    if (!wxBtn) return;
    const c = (wxCond && wxCond.textContent) || '';
    if (c === wxLast && !force) return;
    wxLast = c;
    const name = /snow/i.test(c) ? 'snow' : /rain/i.test(c) ? 'rain' : /cloud|wind/i.test(c) ? 'cloud' : night ? 'moon' : 'sun';
    setIcon(wxBtn, name);
    wxBtn.dataset.wx = c;
    if (c && !wxBtn.getAttribute('aria-label')) wxBtn.setAttribute('aria-label', 'Weather');
  }
  if (clockChip && clockEl) { syncClock(); new MutationObserver(syncClock).observe(clockEl, { childList: true, characterData: true, subtree: true }); }
  if (wxCond) { syncWeather(true); new MutationObserver(() => syncWeather(false)).observe(wxCond, { childList: true, characterData: true, subtree: true }); }

  // ---- speed icons -----------------------------------------------------------------------------------
  const SPEED_ICON = { 0: 'pause', 1: 'play', 10: 'fast', 100: 'faster', 1000: 'fastest' };
  for (const b of document.querySelectorAll('#speed button[data-speed]')) prependIcon(b, SPEED_ICON[b.dataset.speed]);

  // ---- drawers -------------------------------------------------------------------------------------
  for (const c of document.querySelectorAll('.ui-close')) if (!c.querySelector('svg')) c.innerHTML = ic('close');
  const HEAD_ICON = { status: 'gear', sv: 'bag', ck: 'hen', ut: 'home', cv: 'hammer', wxpanel: 'cloud' };
  for (const id in HEAD_ICON) { const h = document.querySelector('#' + id + ' > .ui-panel__head'); if (h) prependIcon(h, HEAD_ICON[id]); }
  const panels = {};
  const backToView = () => { const a = document.activeElement; if (!a || a === document.body || !a.isConnected || a.closest('.ui-panel')) focusView(); };
  const adopt = (id, opt) => { const el = $(id); if (el) panels[id] = U.panel(Object.assign({ el, kind: 'side', onClose: backToView }, opt)); };
  adopt('status', { title: 'Settings', icon: 'gear' });
  adopt('sv', { title: 'Belongings', icon: 'bag', wide: true });
  adopt('ck', { title: 'Chickens', icon: 'hen', wide: true });
  adopt('ut', { title: 'Home', icon: 'home' });
  adopt('cv', { title: 'Build', icon: 'hammer' });
  adopt('wxpanel', { title: 'Weather', icon: 'cloud' });
  adopt('gfxsettings', { title: 'Graphics', icon: 'gear' });
  // views with an open flag of their own hear when the kit closes their panel (Esc, or another drawer opened)
  window.addEventListener('ui:panel', (e) => {
    const d = e.detail || {};
    if (d.open) return;
    if (d.id === 'ut' && window.__utilities && window.__utilities.isOpen()) window.__utilities.show(false);
    if (d.id === 'wxpanel' && wxBtn && wxBtn.getAttribute('aria-expanded') === 'true') wxBtn.click();
  });
  // a panel's own Close button that is not a kit .ui-close (the graphics panel) still closes through `hidden`

  // ---- gear: the settings drawer -------------------------------------------------------------------
  const gear = $('hud-gear');
  if (gear && panels.status) {
    gear.innerHTML = ic('gear');
    gear.addEventListener('click', () => panels.status.toggle());
    const sync = () => gear.setAttribute('aria-pressed', panels.status.isOpen ? 'true' : 'false');
    window.addEventListener('ui:panel', (e) => { if (e.detail && e.detail.id === 'status') { sync(); if (e.detail.open) syncSkins(); } });
    sync();
  }
  // skin tiles
  const tiles = [...document.querySelectorAll('#status .hud-skin[data-skin]')];
  function syncSkins() { const s = U.skin.get(); for (const t of tiles) t.setAttribute('aria-pressed', t.dataset.skin === s ? 'true' : 'false'); }
  for (const t of tiles) t.addEventListener('click', () => { U.skin.set(t.dataset.skin); syncSkins(); });
  window.addEventListener('ui:skin', syncSkins);
  syncSkins();

  // ---- dock ----------------------------------------------------------------------------------------
  U.dock.add({ id: 'svb-inv', label: 'Bag', icon: 'bag', key: 'I', order: 10 });
  U.dock.add({ id: 'svb-shop', label: 'Shop', icon: 'shop', key: 'U', order: 20 });
  U.dock.add({ id: 'svb-notes', label: 'Projects', icon: 'list', key: 'J', order: 25 });
  U.dock.add({ id: 'ckb', label: 'Hens', icon: 'hen', key: 'H', order: 30, panel: 'ck' });
  U.dock.add({ id: 'utb', label: 'Home', icon: 'home', key: 'P', order: 40, panel: 'ut' });
  U.dock.add({ id: 'cvb', label: 'Build', icon: 'hammer', key: 'L', order: 50, panel: 'cv' });
  // Bag and Shop share one panel: the pressed one is the tab that shows
  {
    const sv = $('sv'), inv = $('svb-inv'), shop = $('svb-shop'), notes = $('svb-notes');
    const sync = () => {
      const open = sv && !sv.hidden, sel = sv && sv.querySelector('.svtabs [aria-selected="true"]'), tab = sel ? sel.dataset.tab : '';
      const set = (b, on) => { if (b && b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); };
      set(inv, open && (tab === 'inv' || tab === 'notes')); set(shop, open && tab === 'shop'); set(notes, open && tab === 'notes');
    };
    if (sv) new MutationObserver(sync).observe(sv, { attributes: true, attributeFilter: ['hidden', 'aria-selected'], subtree: true });
    sync();
  }
})();
