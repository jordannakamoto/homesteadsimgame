import { INGREDIENTS, RECIPES, COOKERS, HEAT, foodId } from '../sim/food-catalog.js';
import { readyToCook, cookingQuality, mealFreshness } from '../sim/cooking.js';
import { kitchenModels } from './models.js';

export function createCookingView(G) {
  const T = G.THREE, models = kitchenModels(T), canvas = G.renderer.domElement;
  const root = new T.Group(); root.name = 'Homestead kitchen'; root.scale.set(0.7, 1, 0.7); G.scene.add(root);
  const moving = new T.Group(), contents = new T.Group(), pantry = new T.Group();
  let kitchen = null, active = false, mealsOpen = false, boundSim, unlisten;
  let modelKey = '', panelKey = '', stationKey = '', animation = null, noticeUntil = 0;
  let heat = 'medium', wasPlayerVisible = true;
  const ray = new T.Raycaster(), pointer = new T.Vector2(), projected = new T.Vector3();
  const cameraGoal = new T.Vector3(), lookGoal = new T.Vector3();
  const targets = [], labels = [];
  const $ = (id) => document.getElementById(id);
  const state = () => G.sim.state.sys.cooking;
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const style = document.createElement('style');
  style.textContent = `
    #kitchen-ui { position:fixed; inset:0; pointer-events:none; z-index:32; color:#f4eddf; font-family:inherit }
    #kitchen-ui[hidden], #meal-shelf[hidden], #kitchen-notice[hidden] { display:none }
    #kitchen-ui button,#kitchen-ui select,#meal-shelf button { font:inherit; cursor:pointer; min-height:40px }
    #kitchen-ui button:disabled { opacity:.45; cursor:default }
    #kitchen-head { position:absolute; top:16px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:18px; padding:10px 16px; background:#202b26ee; border:1px solid #a69c7355; border-radius:10px; pointer-events:auto }
    #kitchen-head strong { font-size:18px; white-space:nowrap }
    #kitchen-side { position:absolute; left:18px; top:154px; width:224px; max-height:calc(100% - 280px); overflow:auto; background:#202b26ef; border:1px solid #a69c7355; padding:16px; border-radius:10px; pointer-events:auto }
    #kitchen-side label { display:block; color:#c7c6b2; font-size:12px; margin:10px 0 5px }
    #kitchen-side select { width:100%; padding:8px; border:1px solid #91876b; background:#34443a; color:#fff4df; border-radius:6px }
    #kitchen-side p { line-height:1.5; font-size:13px; color:#d1d0bc; margin:10px 0 }
    #kitchen-side button { margin-top:7px; width:100% }
    #kitchen-ingredients { list-style:none; padding:0; font-size:13px; line-height:1.8 }
    #kitchen-ingredients .added { color:#a9c78a }
    #kitchen-bottom { position:absolute; bottom:24px; left:50%; transform:translateX(-50%); width:min(600px,calc(100% - 36px)); background:#202b26f2; border:1px solid #a69c7355; border-radius:10px; padding:14px 20px; text-align:center; pointer-events:auto }
    #kitchen-hint { margin:0; font-size:16px; color:#f2e5c5 }
    #kitchen-progress { width:100%; height:6px; margin-top:10px; accent-color:#bfad75 }
    #kitchen-progress[hidden] { display:none }
    .kitchen-label { position:absolute; transform:translate(-50%,-50%); pointer-events:auto; border:1px solid #b6aa7877; border-radius:7px; background:#25352ce8; color:#fff4d8; padding:5px 10px; font-size:12px!important; min-height:34px!important; white-space:nowrap }
    .kitchen-label:hover { background:#5c6a45 }
    #kitchen-notice { position:fixed; z-index:45; bottom:110px; left:50%; transform:translateX(-50%); max-width:85vw; background:#23362bec; color:#f0e8cf; padding:12px 18px; border-radius:9px; pointer-events:none }
    #meal-shelf { position:fixed; right:18px; top:100px; z-index:40; width:min(360px,calc(100vw - 36px)); max-height:65vh; overflow:auto; box-sizing:border-box; background:#243028f5; color:#f3ead6; padding:18px; border:1px solid #b0a37b66; border-radius:10px }
    #meal-shelf h2 { margin:0 0 12px; font-size:18px } #meal-shelf p { font-size:13px; color:#ccc9b8; line-height:1.5 }
    .meal-row { border-top:1px solid #c6b98a33; padding:12px 0 } .meal-row small { display:block; color:#cec5ac; margin:6px 0 } .meal-row button { margin-right:8px }
    #hungerbar { background:#c3a65d; width:80% }
    body.cooking-active #status, body.cooking-active #tools, body.cooking-active #lock,
    body.cooking-active #help, body.cooking-active #stance, body.cooking-active #reticle,
    body.cooking-active #svbar, body.cooking-active #touch { display:none!important }
    body.cooking-active #view { cursor:default }
    @media(max-width:700px) {
      #kitchen-head { top:8px; gap:8px; padding:6px 10px } #kitchen-head strong { font-size:14px }
      #kitchen-side { left:8px; top:82px; width:140px; padding:10px; max-height:45vh }
      #kitchen-side p,#kitchen-ingredients { display:none }
      #kitchen-bottom { bottom:10px; padding:10px }
      #kitchen-hint { font-size:13px }
      .kitchen-label { font-size:10px!important; padding:3px 5px }
      body.cooking-active #vitals { display:none }
    }
  `;
  document.head.append(style);
  const ui = document.createElement('section');
  ui.id = 'kitchen-ui'; ui.hidden = true; ui.setAttribute('aria-label', 'Cooking workbench');
  ui.innerHTML = `
    <div id="kitchen-head"><strong>Homestead kitchen</strong><button id="kitchen-meals">Meals</button><button id="kitchen-leave">Leave · Esc</button></div>
    <aside id="kitchen-side">
      <label for="kitchen-recipe">Recipe</label><select id="kitchen-recipe"></select>
      <p id="kitchen-description"></p><ul id="kitchen-ingredients"></ul>
      <label for="kitchen-heat">Heat</label><select id="kitchen-heat">
        <option value="off">Off</option><option value="low">Low · gentle simmer</option>
        <option value="medium">Medium · pan frying</option><option value="high">High · oven</option>
      </select><p id="kitchen-temperature"></p>
      <button id="kitchen-auto">Batch-chop vegetables</button>
      <button id="kitchen-clear">Put ingredients away</button>
      <button id="kitchen-pack">Pack kitchen</button>
      <label for="kitchen-kind">Station</label><select id="kitchen-kind"><option value="stove">Stove & oven</option><option value="fire">Open-fire grate</option></select>
    </aside>
    <div id="kitchen-bottom"><p id="kitchen-hint"></p><progress id="kitchen-progress" max="1" value="0" hidden></progress></div>
  `;
  document.body.append(ui);
  const shelf = document.createElement('section'); shelf.id = 'meal-shelf'; shelf.hidden = true; document.body.append(shelf);
  const notice = document.createElement('div'); notice.id = 'kitchen-notice'; notice.hidden = true; notice.setAttribute('role', 'status'); document.body.append(notice);
  const bar = document.createElement('div'); bar.className = 'bar';
  bar.innerHTML = '<span class="label">Hunger</span><div class="track" role="progressbar" aria-label="Fullness" aria-valuemin="0" aria-valuemax="100"><div class="fill" id="hungerbar"></div></div>';
  $('vitals').append(bar);
  const kitchenButton = document.createElement('button'); kitchenButton.id = 'kitchen-open'; kitchenButton.textContent = 'Kitchen · K';
  kitchenButton.title = 'Set up a kitchen here, or use your nearby kitchen (K)';
  const mealsButton = document.createElement('button'); mealsButton.id = 'meals-open'; mealsButton.textContent = 'Meals';
  $('status').append(kitchenButton, mealsButton);

  function say(message) {
    notice.textContent = message; notice.hidden = false; noticeUntil = performance.now() + 4500;
  }
  function command(name, payload = {}) {
    const result = G.sim.commandNow('cooking.' + name, payload);
    if (!result.ok) say(result.reason);
    G.markStockDirty();
    panelKey = ''; modelKey = '';
    return result.ok;
  }
  function transition(kind, action, seconds = 0.75) {
    if (animation) return;
    panelKey = '';
    animation = { kind, elapsed: 0, duration: seconds, action, sim: G.sim, batch: state().batch };
  }
  function ground(x, z) {
    const terrain = G.heightAt(x, z);
    return window.__build ? window.__build.ground(x, z, G.player.y, terrain) : terrain;
  }
  function place(kind = 'stove') {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, x = G.player.x + Math.sin(angle) * 3.8, z = G.player.z - Math.cos(angle) * 3.8;
      const samples = [[0, 0], [-1.96, -0.84], [1.96, -0.84], [-1.96, 0.84], [1.96, 0.84]].map(([dx, dz]) => ground(x + dx, z + dz));
      const low = Math.min(...samples), high = Math.max(...samples);
      if (low < 0.3 || high - low > 1.8) continue;
      if (!best || high - low < best.spread) best = { x, z, y: high, spread: high - low };
    }
    if (!best) { say('Find a dry, fairly level patch for the kitchen.'); return false; }
    return command('place', { kind, x: best.x, z: best.z, y: best.y });
  }
  function open() {
    if (active) { close(); return; }
    if (G.player.dead > 0) return;
    if (G.player.tool === 'build') { say('Leave build mode before cooking.'); return; }
    if (!state().station && !place()) return;
    const s = state().station;
    if (Math.hypot(G.player.x - s.x, G.player.z - s.z) > 6) { say('Walk back to your kitchen to cook. It is ' + Math.round(Math.hypot(G.player.x - s.x, G.player.z - s.z)) + ' m away.'); return; }
    active = true; ui.hidden = false; document.body.classList.add('cooking-active');
    if (document.pointerLockElement) document.exitPointerLock();
    for (const key in G.keys) G.keys[key] = false;
    G.mouse.left = G.mouse.right = false;
    G.player.aiming = false; G.player.charging = null; G.player.atk = null;
    wasPlayerVisible = G.pm.root.visible; G.pm.root.visible = false;
    if ($('sv')) $('sv').hidden = true;
    if (!state().batch) command('recipe', { id: 'soup' });
    heat = state().batch?.heat === 'off' ? RECIPES[state().batch.recipe].heat : state().batch.heat;
    modelKey = panelKey = '';
    update(0);
  }
  function close() {
    active = false; animation = null; ui.hidden = true;
    document.body.classList.remove('cooking-active');
    G.pm.root.visible = wasPlayerVisible;
    G.mouse.left = G.mouse.right = false;
    for (const key in G.keys) G.keys[key] = false;
    canvas.focus(); G.refreshLock();
  }
  function toggleMeals() {
    mealsOpen = !mealsOpen; shelf.hidden = !mealsOpen; panelKey = '';
    if (mealsOpen && document.pointerLockElement) document.exitPointerLock();
    renderPanel();
  }
  kitchenButton.addEventListener('click', open);
  mealsButton.addEventListener('click', toggleMeals);
  $('kitchen-leave').addEventListener('click', close);
  $('kitchen-meals').addEventListener('click', toggleMeals);
  $('kitchen-recipe').addEventListener('change', (event) => {
    if (animation) return;
    const id = event.target.value, b = state().batch;
    if (b && b.status !== 'prep') return;
    if (b) command('clear');
    command('recipe', { id }); heat = RECIPES[id].heat; renderPanel();
  });
  $('kitchen-heat').addEventListener('change', (event) => {
    heat = event.target.value;
    if (state().batch && state().batch.status !== 'prep') command('heat', { heat });
  });
  $('kitchen-clear').addEventListener('click', () => {
    if (animation) return;
    command('clear'); modelKey = panelKey = '';
  });
  $('kitchen-pack').addEventListener('click', () => {
    if (animation) return;
    if (state().batch?.status === 'prep') command('clear');
    if (command('pack')) close();
  });
  $('kitchen-kind').addEventListener('change', (event) => {
    const b = state().batch;
    if (b && b.status !== 'prep') return;
    if (b) command('clear');
    command('place', { ...state().station, kind: event.target.value });
    command('recipe', { id: 'soup' }); heat = 'low';
  });
  $('kitchen-auto').addEventListener('click', () => transition('machine', () => command('autoprep'), 0.45));
  shelf.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.action === 'close') { toggleMeals(); return; }
    command(button.dataset.action, { id: Number(button.dataset.meal) }); renderPanel();
  });

  window.addEventListener('keydown', (event) => {
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.metaKey) return;
    if (event.code === 'KeyK' && !event.repeat && G.player.tool !== 'build') { event.preventDefault(); event.stopImmediatePropagation(); open(); return; }
    if (!active) return;
    if (event.code === 'Escape') { event.preventDefault(); close(); }
    // Camera focus owns gameplay keys while still allowing quality and clock controls.
    if (!['KeyG', 'Semicolon', 'Quote', 'Backquote'].includes(event.code)) event.stopImmediatePropagation();
  }, true);

  function interaction(id) {
    if (!active || animation) return;
    const b = state().batch;
    if (!b) { say('Choose a recipe to begin.'); return; }
    if (id.startsWith('ingredient:')) {
      command('take', { id: id.slice(11) });
    } else if (id === 'board') {
      if (command('board') && state().batch.board && !state().batch.board.prepared) {
        const fast = G.sim.state.sys.stock.tools.includes('kitchen_chopper');
        transition(fast ? 'machine' : 'chop', () => { if (command('chop')) command('board'); }, fast ? 0.35 : 0.75);
      }
    } else if (id === 'knife') {
      if (b.board && !b.board.prepared) transition('chop', () => { if (command('chop')) command('board'); });
      else say('Place a vegetable on the board first.');
    } else if (id === 'vessel') {
      if (b.status !== 'prep') { if (b.status === 'ready') command('serve'); else say('The dish is still cooking.'); }
      else if (b.hand) transition(INGREDIENTS[b.hand.id].prep === 'crack' ? 'crack' : 'pour', () => command('add'), 0.6);
      else if (RECIPES[b.recipe].mix) transition('mix', () => command('mix'), 0.9);
    } else if (id === 'stove') {
      if (b.status === 'ready') command('serve');
      else if (b.status === 'prep') transition('transfer', () => command('start', { heat }), 0.65);
      else if (b.status === 'burnt' || b.status === 'spoiled') command('clear');
      else say('Cooking continues while you explore. Adjust the heat at the left.');
    }
    update(0);
  }
  const labelLayer = document.createElement('div'); ui.append(labelLayer);
  function target(object, id, label, position) {
    object.userData.cookingAction = id; targets.push(object);
    const button = document.createElement('button');
    button.className = 'kitchen-label'; button.textContent = label; button.dataset.action = id;
    button.addEventListener('click', () => interaction(id));
    labelLayer.append(button);
    labels.push({ button, position: new T.Vector3(...position) });
  }
  function rebuild() {
    const s = state(), b = s.batch;
    const nextStation = JSON.stringify(s.station);
    if (nextStation !== stationKey) {
      root.clear(); kitchen = null;
      if (s.station) {
        kitchen = models.kitchen(s.station.kind); root.add(kitchen.group, pantry, contents, moving);
        root.position.set(s.station.x, s.station.y, s.station.z);
        for (const leg of kitchen.legs) {
          const groundY = ground(s.station.x + leg.position.x * 0.7, s.station.z + leg.position.z * 0.7) - s.station.y;
          leg.scale.y = Math.max(0.1, 0.86 - groundY);
          leg.position.y = 0.86 - leg.scale.y / 2;
        }
      }
      stationKey = nextStation;
    }
    pantry.clear(); contents.clear(); moving.clear(); labelLayer.replaceChildren(); labels.length = 0; targets.length = 0;
    if (!kitchen) return;
    kitchen.chopper.visible = G.sim.state.sys.stock.tools.includes('kitchen_chopper');
    // Separate invisible hit boxes make the board and burner easy to select.
    function hit(id, label, x, y, z, w, d) {
      const mesh = models.block(contents, 0xffffff, x, y, z, w, 0.15, d);
      mesh.visible = false;
      target(mesh, id, label, [x, y + 0.2, z + d / 2]);
    }
    hit('board', b?.board?.prepared ? 'Pick up chopped food' : b?.hand ? 'Place on board' : 'Cutting board', -1.65, 1.05, 0.27, 1.15, 0.85);
    target(kitchen.knife, 'knife', 'Chop', [-1.05, 1.02, 0.78]);
    hit('stove', b?.status === 'ready' ? 'Serve meal' : (b?.status === 'burnt' || b?.status === 'spoiled') ? 'Clear food' : 'Cook', 1.75, 1.45, 0.12, 1.25, 1.25);
    const recipe = b && RECIPES[b.recipe];
    if (!recipe) return;
    const ids = [...Object.keys(recipe.ingredients), ...(recipe.herb ? [recipe.herb] : [])];
    ids.forEach((id, i) => {
      const model = models.ingredient(id), x = -2.3 + i * 0.84;
      model.position.set(x, 1.33, -0.9); pantry.add(model);
      target(model, 'ingredient:' + id, INGREDIENTS[id].name, [x, 1.88, -0.9]);
    });
    const cooking = b.status !== 'prep', oven = recipe.method === 'bake' || recipe.method === 'roast';
    const vesselKind = cooking && recipe.vessel === 'bowl' ? (oven ? 'tray' : 'pan') : recipe.vessel;
    const container = models.vessel(vesselKind);
    container.position.set(cooking ? 1.75 : 0, cooking ? 1.37 : 0.96, cooking ? 0.12 : 0.24);
    contents.add(container); contents.userData.vessel = container;
    if (!cooking) target(container, 'vessel', b.hand ? 'Add ingredient' : recipe.mix && !b.mixed ? 'Mix' : 'Prepared dish', [0, 1.2, 0.8]);
    if (cooking) {
      container.add(models.cookedFood(b.recipe, Math.min(1, b.progress / (recipe.minutes * 60)), (b.status === 'burnt' || b.status === 'spoiled')));
    } else {
      const added = Object.keys(b.added);
      if (b.mixed && recipe.vessel === 'bowl') {
        models.part(container, models.cylinder, 0xddc696, 0, 0.23, 0, 0.33, 0.035, 0.33);
      } else {
        added.forEach((id, i) => {
          const model = models.ingredient(id, INGREDIENTS[id].prep === 'chop');
          model.scale.setScalar(0.45);
          model.position.set(Math.sin(i * 2.3) * 0.16, recipe.vessel === 'pot' ? 0.38 : 0.12, Math.cos(i * 2.3) * 0.16);
          container.add(model);
        });
      }
    }
    if (b.board) {
      const model = models.ingredient(b.board.id, b.board.prepared);
      model.position.set(-1.65, 1.06, 0.27); contents.add(model); model.userData.cookingAction = 'board'; targets.push(model);
    }
    if (b.hand) {
      const model = models.ingredient(b.hand.id, b.hand.prepared && INGREDIENTS[b.hand.id].prep === 'chop');
      model.position.set(-0.7, 1.65, 0.55); moving.add(model);
    }
    const stream = new T.Group();
    models.part(stream, models.cylinder, b.hand?.id === 'oil_food' ? 0xd7b54f : b.hand?.id === 'water_food' ? 0x96c8cc : 0xe8dcb2,
      0, 0, 0, 0.025, 0.35, 0.025);
    stream.position.set(0, 1.4, 0.24); stream.visible = false; moving.add(stream);
    moving.userData.stream = stream;
    const spoon = new T.Group();
    models.block(spoon, 0x9b8053, 0, 0.16, 0, 0.035, 0.4, 0.035);
    models.ball(spoon, 0x9b8053, 0, -0.06, 0, 0.08, 0.1, 0.025);
    spoon.position.set(0.3, 1.38, 0.24); spoon.visible = false; moving.add(spoon); moving.userData.spoon = spoon;
  }

  function renderPanel() {
    const s = state(), b = s.batch, recipe = b && RECIPES[b.recipe];
    const owned = G.sim.state.sys.stock.items;
    $('hungerbar').style.width = s.fullness + '%';
    $('hungerbar').parentElement.setAttribute('aria-valuenow', String(Math.round(s.fullness)));
    bar.title = Math.round(s.fullness) + '% full. Food grants a small stamina recovery bonus; empty hunger does not cause damage.';
    kitchenButton.textContent = b?.status === 'ready' ? 'Meal ready · K' : 'Kitchen · K';
    if (active) {
      const select = $('kitchen-recipe');
      select.innerHTML = '<option value="">Choose a dish</option>' + Object.entries(RECIPES).map(([id, r]) =>
        '<option value="' + id + '"' + (!COOKERS[s.station.kind].methods.includes(r.method) ? ' disabled' : '') + '>' + esc(r.name) + '</option>').join('');
      select.value = b?.recipe || ''; select.disabled = !!animation || (!!b && b.status !== 'prep');
      $('kitchen-description').textContent = recipe ? recipe.steps : 'Select a recipe to begin.';
      $('kitchen-ingredients').innerHTML = recipe ? Object.entries(recipe.ingredients).map(([id, qty]) =>
        '<li class="' + (b.added[id] ? 'added' : '') + '">' + (b.added[id] ? '✓ ' : '') + qty + ' × ' + esc(INGREDIENTS[id].name) +
        ' <small>(' + (owned[foodId(id)] || 0) + ' in pantry)</small></li>').join('') +
        (recipe.herb ? '<li>Optional ' + esc(INGREDIENTS[recipe.herb].name.toLowerCase()) + '</li>' : '') : '';
      $('kitchen-heat').disabled = !!b && ['burnt', 'spoiled'].includes(b.status);
      $('kitchen-heat').value = b && b.status !== 'prep' ? b.heat : heat;
      $('kitchen-temperature').textContent = recipe ? (b.status === 'prep' ? 'Suggested heat · ' + recipe.heat + '. About ' + recipe.minutes + ' game minutes.' :
        Math.round(b.temperatureC) + '°C station · ' + (b.status === 'ready' ? cookingQuality(b) + ' · ready to serve' : b.status === 'burnt' ? 'Burned' : b.status === 'spoiled' ? 'Spoiled' : 'Cooking')) : '';
      $('kitchen-auto').hidden = !b || !s.learned.includes(b.recipe) || !G.sim.state.sys.stock.tools.includes('kitchen_chopper') || !Object.keys(recipe?.ingredients || {}).some((id) => INGREDIENTS[id].prep === 'chop');
      $('kitchen-auto').disabled = !!b && (b.status !== 'prep' || !!b.hand || !!b.board || !Object.keys(recipe.ingredients).some((id) => INGREDIENTS[id].prep === 'chop' && !b.added[id]));
      $('kitchen-clear').hidden = !b;
      $('kitchen-clear').textContent = b?.status === 'prep' ? 'Put ingredients away' : 'Discard this dish';
      $('kitchen-kind').value = s.station.kind; $('kitchen-kind').disabled = !!animation || (!!b && b.status !== 'prep');
      $('kitchen-pack').disabled = !!animation || (!!b && b.status !== 'prep');
      $('kitchen-clear').disabled = !!animation;
      const hint = !b ? 'Choose a recipe. Click ingredients on the back shelf to pick them up.' :
        b.status === 'spoiled' ? 'This dish spoiled. Clear it before cooking again.' :
        b.status === 'burnt' ? 'The food burned. Clear the cooker and try a gentler heat.' :
        b.status === 'ready' ? 'Ready to serve. Click the cooker, or turn off the heat to hold the dish.' :
        b.status === 'cooking' ? (b.heat === 'off' ? 'Heat is off. Choose a heat setting to continue cooking.' : 'Cooking. You can leave and get on with the homestead.') :
        b.hand ? (b.hand.prepared ? 'Click the ' + recipe.vessel + ' to ' + (INGREDIENTS[b.hand.id].prep === 'crack' ? 'crack in the eggs.' : INGREDIENTS[b.hand.id].prep === 'pour' ? 'pour this in.' : 'add the ingredient.') : 'Click the cutting board to chop this in one quick motion.') :
        b.board ? (b.board.prepared ? 'Click the chopped food to pick it up, then add it to the dish.' : 'Click the knife for one quick batch of chopping.') :
        readyToCook(b) ? 'Ready. Click the cooker to ' + recipe.method + ' over ' + heat + ' heat.' :
        Object.keys(recipe.ingredients).every((id) => b.added[id]) ? 'Click the ' + recipe.vessel + ' to mix everything together.' :
        'Click an ingredient on the shelf. One pickup takes the amount this recipe needs.';
      $('kitchen-hint').textContent = G.speed === 0 && b?.status === 'cooking' ? 'World time is paused. Resume time to cook; preparation still works.' : hint;
      $('kitchen-progress').hidden = !b || b.status === 'prep';
      $('kitchen-progress').value = recipe ? Math.min(1, b.progress / (recipe.minutes * 60)) : 0;
    }
    if (mealsOpen) {
      shelf.innerHTML = '<h2>Prepared meals</h2><button data-action="close">Close</button>' +
        (s.meals.length ? s.meals.map((meal) => {
          const freshness = mealFreshness(meal, G.sim.state.t), spoiled = freshness <= 0;
          return '<div class="meal-row"><strong>' + esc(RECIPES[meal.recipe].name) + ' × ' + meal.qty + '</strong><small>' +
            (spoiled ? 'Spoiled' : meal.quality + ' · ' + Math.ceil((meal.expiresAt - G.sim.state.t) / 3600) + ' game hours left') +
            '</small><button data-action="eat" data-meal="' + meal.id + '"' + (spoiled ? ' disabled' : '') + '>Eat one</button><button data-action="discardMeal" data-meal="' + meal.id + '">Discard batch</button></div>';
        }).join('') : '<p>No prepared meals yet. Make a dish at the kitchen and serve it into portions.</p>') +
        '<p>Eating fills hunger and gives a modest, temporary stamina recovery bonus. Empty hunger causes no damage.</p>';
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!active) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    root.updateMatrixWorld(true);
    ray.setFromCamera(pointer, G.camera);
    // Invisible interaction volumes are deliberately raycast, while visible models
    // use their real geometry. Three.js raycasting does not require visible=true.
    const hit = ray.intersectObjects(targets, true)[0];
    let object = hit?.object;
    while (object && !object.userData.cookingAction) object = object.parent;
    if (object) interaction(object.userData.cookingAction);
  }, true);
  for (const name of ['pointermove', 'pointerup', 'wheel']) canvas.addEventListener(name, (event) => {
    if (!active) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, passive: false });

  function updateCamera(dt) {
    if (!active || !state().station) return false;
    const s = state().station, portrait = G.camera.aspect < 1;
    cameraGoal.set(s.x - (portrait ? 0 : 0.8), s.y + (portrait ? 6.7 : 4.3), s.z + (portrait ? 6.8 : 4.2));
    lookGoal.set(s.x - (portrait ? 0 : 0.6), s.y + 0.9, s.z);
    G.camera.position.lerp(cameraGoal, 1 - Math.exp(-12 * dt));
    G.camera.fov = portrait ? 49 : 44; G.camera.updateProjectionMatrix();
    G.camera.lookAt(lookGoal); G.camera.updateMatrixWorld();
    for (const label of labels) {
      projected.copy(label.position); root.localToWorld(projected); projected.project(G.camera);
      label.button.style.left = (projected.x * 0.5 + 0.5) * canvas.clientWidth + 'px';
      label.button.style.top = (-projected.y * 0.5 + 0.5) * canvas.clientHeight + 'px';
      label.button.disabled = !!animation;
    }
    return true;
  }
  function update(dt) {
    if (G.sim !== boundSim) {
      if (active) close();
      if (unlisten) unlisten();
      boundSim = G.sim;
      unlisten = G.sim.listen((type, data) => { if (type === 'cooking.notice') say(data.message); });
      stationKey = modelKey = panelKey = '';
      animation = null;
    }
    const s = state(), b = s.batch;
    const key = s.version + '|' + JSON.stringify(s.station) + '|' + (b ? b.status + Math.floor(b.progress / (RECIPES[b.recipe].minutes * 60) * 4) : '') + '|' + G.sim.state.sys.stock.tools.length;
    if (key !== modelKey) { rebuild(); modelKey = key; }
    root.visible = !!s.station && Math.hypot(G.player.x - s.station.x, G.player.z - s.station.z) < 110;
    if (animation) {
      animation.elapsed += dt;
      const a = animation, f = Math.min(1, a.elapsed / a.duration);
      if (kitchen && a.kind === 'chop') {
        kitchen.knife.position.y = 1.12 + Math.abs(Math.sin(f * Math.PI * 5)) * 0.22;
        kitchen.knife.position.z = 0.27;
      }
      if (kitchen && a.kind === 'machine') {
        kitchen.chopper.children[1].rotation.z = Math.sin(f * Math.PI * 6) * 0.3;
      }
      if (a.kind === 'mix' && moving.userData.spoon) {
        const spoon = moving.userData.spoon; spoon.visible = true;
        spoon.position.x = Math.sin(f * Math.PI * 4) * 0.18;
        spoon.position.z = 0.24 + Math.cos(f * Math.PI * 4) * 0.18;
      }
      if (a.kind === 'transfer' && contents.userData.vessel) {
        contents.userData.vessel.position.set(1.75 * f, 0.96 + Math.sin(f * Math.PI) * 0.35 + 0.41 * f, 0.24 - 0.12 * f);
      }
      if ((a.kind === 'pour' || a.kind === 'crack') && moving.children[0]) {
        const held = moving.children[0]; held.position.x = -0.7 * (1 - f);
        held.rotation.z = -Math.sin(f * Math.PI) * 1.2;
        moving.userData.stream.visible = f > 0.25 && f < 0.85;
      }
      if (f >= 1) {
        animation = null;
        if (a.sim === G.sim && a.batch === s.batch) a.action();
        if (kitchen) { kitchen.knife.position.set(-1.5, 1.05, 0.73); kitchen.chopper.children[1].rotation.z = 0; }
        modelKey = panelKey = '';
      }
    }
    if (kitchen) {
      kitchen.flame.visible = !!b && b.heat !== 'off' && b.status !== 'prep' && b.status !== 'burnt';
      kitchen.steam.visible = !!b && b.temperatureC > 70 && b.status !== 'burnt' && b.status !== 'spoiled';
      if (kitchen.steam.visible) {
        const phase = performance.now() * 0.0005;
        kitchen.steam.children.forEach((puff, i) => {
          const t = (phase + i / 4) % 1;
          puff.position.set(Math.sin(i * 2 + t * 3) * 0.12, t * 0.65, Math.cos(i * 2) * 0.08);
          puff.scale.setScalar(0.03 + Math.sin(t * Math.PI) * 0.1);
        });
      }
      kitchen.flame.scale.y = 0.85 + 0.15 * Math.sin(G.sim.state.t + performance.now() * 0.008);
    }
    const nextPanel = key + '|' + G.sim.state.tick + '|' + G.speed + '|' + mealsOpen;
    if (nextPanel !== panelKey) { renderPanel(); panelKey = nextPanel; }
    if (!notice.hidden && performance.now() > noticeUntil) notice.hidden = true;
  }
  function collide(entity, radius) {
    const station = state().station;
    if (!station || entity.y > station.y + 1.6 || entity.y < station.y - 2) return;
    const dx = entity.x - station.x, dz = entity.z - station.z;
    const halfX = 2 + radius, halfZ = 0.83 + radius;
    if (Math.abs(dx) >= halfX || Math.abs(dz) >= halfZ) return;
    if (halfX - Math.abs(dx) < halfZ - Math.abs(dz)) entity.x = station.x + (dx < 0 ? -halfX : halfX);
    else entity.z = station.z + (dz < 0 ? -halfZ : halfZ);
  }
  return { collide, get active() { return active; }, open, close, update, updateCamera };
}
