// Stock view: the Inventory, Supplier and Projects panel, and the buttons that open it.
// Reaches the game only through window.__game (stock API, player, markStockDirty).
// Keys: I inventory, U supplier, J projects, Esc closes. Build mode gets its keys first, so they are ignored there.
(() => {
  const G = window.__game;
  if (!G || !G.stock) return;
  const S = G.stock,
    $ = (id) => document.getElementById(id),
    panel = $('sv'),
    body = $('svbody'),
    note = $('svnote'),
    canvas = $('view');
  if (!panel) return;

  const UNIT = { each: '', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', L: 'L' };
  const STEP = { each: 1, m: 2, m2: 1, m3: 1, kg: 5, L: 5 };
  const isTool = (it) => it.category === 'tools_hand' || it.category === 'tools_power';
  const money = (v) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const num = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(v < 1 ? 3 : v < 10 ? 2 : 1));
  const kg = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' t' : v >= 10 ? Math.round(v) + ' kg' : v.toFixed(1) + ' kg');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const unitLabel = (it) => (it.unit === 'each' ? '' : ' ' + UNIT[it.unit]);

  let tab = 'inv',
    cat = 'lumber',
    showDismissed = false,
    sig = '';
  const qty = {}; // chosen quantity per item, kept between renders

  // The few real properties worth showing next to a product.
  function props(it) {
    const out = [];
    const m = it.material && S.MATERIALS[it.material];
    if (m) {
      if (m.uValueWm2K) out.push('U-value ' + m.uValueWm2K + ' W/m²K');
      else if (m.class === 'insulation' || m.class === 'wood' || m.class === 'roofing') {
        const r = S.rValuePer100mm(m.id);
        if (m.class === 'insulation' || r > 0.5) out.push('R ' + r.toFixed(2) + ' per 100 mm');
      }
      out.push('Density ' + Math.round(m.densityKgM3) + ' kg/m³');
      if (m.bendingStrengthMPa && (m.class === 'wood' || m.class === 'metal')) out.push('Bending ' + m.bendingStrengthMPa + ' MPa');
      else if (m.compressiveStrengthMPa && m.class === 'masonry') out.push('Compression ' + m.compressiveStrengthMPa + ' MPa');
      if (m.class === 'insulation' && it.dims) out.push('R ' + (it.dims.thicknessM / m.conductivityWmK).toFixed(2) + ' as sold');
    }
    if (it.dims && it.unit === 'm') out.push(Math.round(it.dims.widthM * 1000) + ' × ' + Math.round(it.dims.depthM * 1000) + ' mm');
    else if (it.dims && it.dims.thicknessM && it.unit !== 'each') out.push(Math.round(it.dims.thicknessM * 10000) / 10 + ' mm thick');
    out.push(num(it.massKgPerUnit) + ' kg per ' + (it.unit === 'each' ? 'piece' : UNIT[it.unit]));
    if (it.powerW) out.push('Needs power: ' + it.powerW + ' W');
    return out.join(' · ');
  }

  // ------------------------------------------------------------------ tabs
  function inventory(st) {
    let h = '';
    const total = S.stockMassKg(st);
    const meals = G.cooking?.meals || [];
    if (meals.length) h += '<h3>Prepared meals</h3>';
    for (const meal of meals) {
      const detail = meal.hoursLeft ? meal.quality + ' · ' + meal.hoursLeft + ' game hours left' : 'Spoiled';
      h += '<div class="row shop" data-id="' + meal.id + '"><div class="name">' + esc(meal.name) +
        ' × ' + meal.qty + '<small>' + esc(detail) + '</small></div><div class="buy">' +
        '<button type="button" class="go" data-act="eat-meal"' + (meal.hoursLeft ? '' : ' disabled') + '>Eat</button>' +
        '<button type="button" data-act="discard-meal">Discard</button></div></div>';
    }
    let any = meals.length > 0;
    for (const c of S.ITEM_CATEGORIES) {
      const ids = (isToolCat(c.id) ? st.tools : Object.keys(st.items)).filter((id) => S.ITEMS[id] && S.ITEMS[id].category === c.id);
      if (!ids.length) continue;
      any = true;
      h += '<h3>' + esc(c.name) + '</h3>';
      for (const id of ids) {
        const it = S.ITEMS[id],
          q = isTool(it) ? 1 : st.items[id];
        const needsPower = it.powerW && !G.powerAvailable();
        h += '<div class="row"><div class="name">' + esc(it.name) +
          (needsPower ? '<span class="tag warn">needs power</span>' : '') +
          '<small>' + esc(props(it)) + '</small></div>' +
          '<div class="qty">' + (isTool(it) ? '' : num(q) + unitLabel(it)) + '</div>' +
          '<div class="mass">' + kg(q * it.massKgPerUnit) + '</div></div>';
      }
    }
    if (!any) h += '<div class="empty">Nothing here yet.</div>';
    h += '<div class="total">Everything you own weighs ' + kg(total) + '</div>';
    if (!any) h = '<div class="empty">Your pockets are empty. Try the Supplier tab.</div>';
    return h;
  }
  const isToolCat = (id) => id === 'tools_hand' || id === 'tools_power';

  function supplier(st) {
    let h = '<div class="chips" role="group" aria-label="Categories">';
    for (const c of S.ITEM_CATEGORIES) h += '<button type="button" data-cat="' + c.id + '" aria-pressed="' + (c.id === cat) + '">' + esc(c.name) + '</button>';
    h += '</div>';
    const c = S.ITEM_CATEGORIES.find((x) => x.id === cat);
    h += '<h3>' + esc(c.name) + '<small>' + esc(c.blurb) + '</small></h3>';
    for (const it of Object.values(S.ITEMS).filter((i) => i.category === cat)) {
      const tool = isTool(it),
        owned = tool && st.tools.includes(it.id),
        q = tool ? 1 : qty[it.id] || 1,
        cost = Math.round(it.priceUsd * q * 100) / 100,
        short = cost - st.money;
      h += '<div class="row shop" data-id="' + it.id + '"><div class="name">' + esc(it.name) +
        (tool && it.powerW ? '<span class="tag warn">needs power</span>' : '') +
        '<small>' + money(it.priceUsd) + (it.unit === 'each' ? ' each' : ' per ' + UNIT[it.unit]) + ' · ' + esc(props(it)) + (it.blurb ? ' · ' + esc(it.blurb) : '') + '</small></div>';
      h += '<div class="buy">';
      if (owned) h += '<span class="tag">You own this</span>';
      else {
        if (!tool) h += '<button type="button" class="step" data-act="dec" aria-label="Less">−</button><input type="number" inputmode="decimal" min="0" step="any" value="' + q + '" aria-label="Quantity"><button type="button" class="step" data-act="inc" aria-label="More">+</button><span class="unit">' + esc(UNIT[it.unit]) + '</span>';
        h += '<span class="cost">' + money(cost) + '</span><button type="button" class="go" data-act="buy"' + (short > 1e-9 ? ' disabled title="Need ' + money(Math.ceil(short * 100) / 100) + ' more"' : '') + '>Buy</button>';
      }
      h += '</div></div>';
    }
    return h;
  }

  function projects(st) {
    const open = st.projects.filter((p) => p.status !== 'dismissed'),
      dis = st.projects.filter((p) => p.status === 'dismissed');
    let h = '<div class="svnote">Ideas for what to do next. Tick them off, dismiss them, or ignore them all. Nothing here is required.</div>';
    for (const p of open) {
      h += '<div class="card' + (p.status === 'done' ? ' done' : '') + '" data-id="' + esc(p.id) + '"><div class="name">' + esc(p.title) + '<small>' + esc(p.blurb) + '</small></div><div class="acts">' +
        '<button type="button" data-act="' + (p.status === 'done' ? 'reopen' : 'done') + '">' + (p.status === 'done' ? 'Undo' : 'Done ✓') + '</button>' +
        '<button type="button" data-act="dismiss">Dismiss</button></div></div>';
    }
    if (!open.length) h += '<div class="empty">No ideas right now. Enjoy the quiet.</div>';
    if (dis.length) {
      h += '<div><button type="button" data-act="toggledis">' + (showDismissed ? 'Hide' : 'Show') + ' dismissed (' + dis.length + ')</button></div>';
      if (showDismissed) for (const p of dis) h += '<div class="card done" data-id="' + esc(p.id) + '"><div class="name">' + esc(p.title) + '</div><div class="acts"><button type="button" data-act="reopen">Bring back</button></div></div>';
    }
    return h;
  }

  // ------------------------------------------------------------------ rendering
  function render(keepScroll) {
    const st = S.state,
      sc = body.scrollTop;
    body.innerHTML = tab === 'inv' ? inventory(st) : tab === 'shop' ? supplier(st) : projects(st);
    if (keepScroll) body.scrollTop = sc;
    $('svmoney').textContent = money(st.money);
    for (const b of panel.querySelectorAll('.svtabs button')) b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    sig = signature();
  }
  const signature = () => { const st = S.state; return tab + '|' + st.money + '|' + JSON.stringify(st.items) + st.tools.length + '|' + st.projects.map((p) => p.status).join() + (tab === 'inv' ? JSON.stringify(G.cooking?.meals || []) : ''); };
  function say(text, cls) { note.textContent = text; note.className = 'svnote ' + (cls || ''); }
  function pop() { const m = $('svmoney'); m.classList.add('pop'); setTimeout(() => m.classList.remove('pop'), 250); }

  // ------------------------------------------------------------------ open / close
  let poll = 0;
  function open(t) {
    tab = t;
    panel.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    say('');
    render(false);
    body.scrollTop = 0;
    clearInterval(poll);
    poll = setInterval(() => {
      const a = document.activeElement;
      if (!panel.hidden && signature() !== sig && !(a && a.tagName === 'INPUT' && body.contains(a))) render(true);
    }, 400);
  }
  function close() { panel.hidden = true; clearInterval(poll); canvas.focus(); }
  const toggle = (t) => (!panel.hidden && tab === t ? close() : open(t));
  $('svb-inv').addEventListener('click', () => toggle('inv'));
  $('svb-shop').addEventListener('click', () => toggle('shop'));
  $('svb-notes').addEventListener('click', () => toggle('notes'));
  $('svclose').addEventListener('click', close);
  panel.querySelector('.svtabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) { tab = b.dataset.tab; say(''); render(false); body.scrollTop = 0; } });

  window.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'Escape' && !panel.hidden) { close(); return; }
    if (G.player.tool === 'build') return;               // build mode owns its keys
    if (e.code === 'KeyI') toggle('inv');
    else if (e.code === 'KeyU') toggle('shop');
    else if (e.code === 'KeyJ') toggle('notes');
  });

  // ------------------------------------------------------------------ actions
  body.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-cat]');
    if (chip) { cat = chip.dataset.cat; render(false); body.scrollTop = 0; return; }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const row = b.closest('[data-id]'),
      id = row && row.dataset.id,
      act = b.dataset.act;
    if (act === 'toggledis') { showDismissed = !showDismissed; render(true); return; }
    if (['done', 'dismiss', 'reopen'].includes(act)) { S.do('projects.' + act, { id }); render(true); return; }
    if (act === 'eat-meal' || act === 'discard-meal') {
      const eating = act === 'eat-meal';
      const meal = G.cooking.meals.find(item => item.id === Number(id));
      const result = G.sim.commandNow(eating ? 'cooking.eat' : 'cooking.discardMeal', { id: Number(id) });
      say(result.ok ? (eating ? 'Ate ' : 'Discarded ') + meal.name + '.' : result.reason, result.ok ? 'good' : 'bad');
      render(true);
      return;
    }
    const it = S.ITEMS[id];
    if (!it) return;
    if (act === 'inc' || act === 'dec') {
      const q = qty[id] || 1,
        step = STEP[it.unit] || 1;
      qty[id] = Math.max(act === 'inc' ? q + step : Math.max(it.unit === 'each' ? 1 : 0.5, q - step), it.unit === 'each' ? 1 : 0.5);
      render(true);
    } else if (act === 'buy') {
      const q = isTool(it) ? 1 : qty[id] || 1,
        r = S.do('stock.buy', { id, qty: q });
      if (r.ok) {
        say('Bought ' + (isTool(it) ? '' : num(q) + unitLabel(it) + ' of ') + it.name + ' for ' + money(r.costUsd) + '. It is in your inventory.', 'good');
        pop();
        if (id.startsWith('lumber_')) S.do('projects.done', { id: 'lumber' });
      } else say(r.reason === 'not enough money' ? 'Not enough money for that yet.' : 'Could not buy: ' + r.reason + '.', 'bad');
      render(true);
    }
  });
  body.addEventListener('change', (e) => {
    const inp = e.target.closest('input'),
      row = e.target.closest('[data-id]');
    if (!inp || !row) return;
    const it = S.ITEMS[row.dataset.id];
    let v = parseFloat(inp.value);
    if (!(v > 0)) v = 1;
    qty[it.id] = it.unit === 'each' ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
    render(true);
  });

  // Fell-a-tree and roof cards tick themselves the first time the player does the thing. They can always un-tick.
  let seenV = -1;
  setInterval(() => {
    const st = S.state;
    const done = (id) => st.projects.some((p) => p.id === id && p.status === 'open') && S.do('projects.done', { id });
    if (Object.keys(st.items).some((k) => k.startsWith('log_'))) done('tree');
    if (window.__build && window.__build.version !== seenV) {
      seenV = window.__build.version;
      if (window.__build.pieces().some((p) => p.kind === 'roof')) done('roof');
    }
  }, 3000);

  G.stockView = { open, close, get tab() { return tab; }, get isOpen() { return !panel.hidden; } };
})();
