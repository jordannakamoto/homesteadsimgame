// The gate: build the tutorial shed from bare ground through real input, as a player would.
//   node test/shed.e2e.mjs        (needs dist/index.html and Playwright)
// Part 1, Hands-on: open the Build panel (L), choose the tool shed, set it down with the pointer, order the kit,
// level the site while the delivery is on its way, then walk to the stacks (W), point and click to pick up, walk back,
// point at each glowing place and hold the mouse button to set the piece and nail it,
// stage by stage, tilting each wall up; a save and reload in the middle of framing; "Work until done" for the long
// stages after the roof is on. Part 2, Guided: the same shed with one press a stage.
// Checks money, stacks, stages, the project card, unlocks, the reload, and that the page logs no errors.
// Walking is the W key; the camera is turned toward where the player is going from the page (a headless browser
// cannot capture the mouse). Software rendering is slow, so drawing is off and frames are stepped by hand.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const SHOTS = process.env.SHOTS || '';          // a folder: take the screenshots for judging

async function open(fresh = true) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  const G = (fn, arg) => page.evaluate(fn, arg);
  const boot = async () => {
    await page.waitForFunction(() => window.__game && window.__build && window.__build.view && window.__construct, null, { timeout: 180000 });
    await G(() => {
      const g = __game; g.lockQuality(); g.setQuality('low');
      const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
      window.__played = 0; g.stepHooks.push((dt) => { window.__played += dt; });
      window.__step = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt); };
    });
  };
  await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 180000 });
  if (fresh) { await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); }
  await boot();
  const tick = (n = 3) => G((n) => window.__step(n, 1 / 30), n);
  const shot = async (name) => { if (!SHOTS) return; await G(() => { window.__step(1, 1 / 60); window.__draw(__game.scene, __game.camera); }); await page.waitForTimeout(400); await page.screenshot({ path: SHOTS + '/' + name + '.png', timeout: 120000 }); };
  const state0 = () => G(() => {
    const c = __construct, s = __game.sim.state.sys.construction, pr = c.current() || Object.values(s.progress)[0] || null, a = c.nextAction(), x = c.context(), st = pr && __build.structs().find((q) => q.id === pr.id);
    return { stage: pr && pr.stage, done: !!(pr && pr.done), built: pr ? Object.values(pr.members).filter((m) => m.built).length : 0, total: pr ? Object.keys(pr.members).length : 0,
      raised: pr ? Object.keys(pr.raised).length : 0, raise: pr ? c.plan(pr.id).raise : null, np: c.nextPiece(), px: __game.player.x, pz: __game.player.z, target: a && a.target, line: a && a.line, ctx: x && x.kind, carried: s.carried,
      shed: st && { x: st.x, z: st.z, r: c.geom(pr.id).reach + 0.7 }, money: __game.sim.state.sys.stock.money, stacks: s.stacks.length, deliveries: s.deliveries.length, auto: !!c.V.auto,
      prompt: document.getElementById('cvprompt').hidden ? '' : document.getElementById('cvprompt').innerText.replace(/\s+/g, ' '),
      banner: document.getElementById('cvbanner').hidden ? '' : document.getElementById('cvbanner').innerText.replace(/\s+/g, ' '), played: window.__played };
  });
  const T0 = { base: 0 };
  const state = async () => { const q = await state0(); q.played += T0.base; return q; };
  // walk with W toward a point until within `range` of it
  const walkTo = async (t, range) => {
    let down = false;
    for (let i = 0; i < 500; i++) {
      const d = await G((t) => { const P = __game.player, dx = t.x - P.x, dz = t.z - P.z; __game.cam.yaw = Math.atan2(-dx, -dz); return Math.hypot(dx, dz); }, t);
      if (d <= range) break;
      if (!down) { await page.keyboard.down('KeyW'); down = true; }
      await tick(2);
    }
    if (down) await page.keyboard.up('KeyW');
    await tick(1);
  };
  return { ctx, page, G, boot, tick, shot, state, walkTo, T0 };
}
const banners = new Set();

/* ------------------------------------------------------------ part 1: hands-on */
let handsOnRoofed = 0, handsOnAll = 0, cost = 0;
{
  let T = await open();
  let { page, G, tick, shot, state, walkTo } = T;
  await tick(20);
  check('a new world is in construction mode, with the first-shed card in the projects', await G(() => __build.constructionMode && __game.sim.state.sys.stock.projects.some((p) => p.id === 'first-shed' && p.status === 'open')));
  check('the note on the left points at the plan book', await G(() => /first shed/i.test(document.getElementById('cvnext').innerText)));
  await page.keyboard.press('KeyL'); await tick(2);
  check('L opens the Build panel on the plan book: the shed is offered, the cabin is locked', await G(() => !document.getElementById('cv').hidden && !!document.querySelector('#cvbody button[data-act="place:shed"]') && !document.querySelector('#cvbody button[data-act="place:cabin"]') && /Finish your first shed/.test(document.getElementById('cvbody').innerText)));
  await shot('01-plan-book');
  await page.click('#cvbody button[data-act="place:shed"]'); await tick(2);
  await page.mouse.move(700, 300); await tick(2);
  await page.mouse.wheel(0, 100); await tick(1); await page.mouse.wheel(0, -100); await tick(1);
  check('the plan is in hand as a ghost that follows the pointer', await G(() => { const p = __construct.V.placing; return !!p && p.kind === 'plan' && p.ok && Math.abs(p.yaw) < 1e-9 && Math.hypot(p.x - __game.player.x, p.z - __game.player.z) > 1; }));
  await shot('02-ghost-in-hand');
  await page.mouse.click(700, 300); await tick(4);
  let s = await state();
  check('clicking sets the shed down as a building in progress, nothing built, ground untouched', !!s.shed && s.built === 0 && s.total > 140 && await G(() => { const st = __build.structs().find((q) => q.planned); return st && st.sitePlanned && __build.pieces().filter((p) => p.struct === st.id).every((p) => p.built === false); }), s.total + ' pieces');
  check('the Build panel shows the stages in order with one next action', await G(() => { const li = [...document.querySelectorAll('#cvbody li.st')]; return li.length >= 13 && li[0].classList.contains('next') && /Site/.test(li[0].innerText) && /Foundation/.test(li[1].innerText) && document.querySelectorAll('#cvbody .cvtop button.go').length === 1 && /step 2 of 13/.test(document.getElementById('cvbody').innerText); }));
  await shot('03-placed');
  const before = s.money;
  cost = await G(() => __construct.plan(__construct.current().id).view.toOrderUsd);
  await page.click('#cvbody button[data-act="order:all"]'); await tick(3);
  s = await state();
  check('ordering everything takes exactly its price and a delivery is on its way', Math.abs(before - s.money - cost) < 0.011 && s.deliveries === 1 && s.stacks === 0 && cost > 1500 && cost < 3500, '$' + cost);
  check('ordering again buys nothing more', await G(() => { const m = __game.sim.state.sys.stock.money; __construct.act('order:all'); return __game.sim.state.sys.stock.money === m; }));
  await page.keyboard.press('KeyL'); await tick(2);
  check('L closes the panel', await G(() => document.getElementById('cv').hidden));
  // level the site while the delivery is on its way
  await walkTo(s.shed, 1.5);
  s = await state();
  check('standing on the plan, the prompt offers to level the ground', s.ctx === 'hands' && /dig and level/i.test(s.prompt), s.prompt);
  check('a ghost wall does not block the way: the player stands inside the plan', await G(() => { const st = __build.structs().find((q) => q.planned); return Math.hypot(st.x - __game.player.x, st.z - __game.player.z) < 2.6; }));
  await page.keyboard.down('KeyF'); await tick(20);
  check('letting go of F part way through a piece loses only that piece', await (async () => { await page.keyboard.up('KeyF'); await tick(3); const q = await state(); return q.built === 0 && q.stage === 'site'; })());
  await page.keyboard.down('KeyF'); for (let i = 0; i < 60 && (await state()).stage === 'site'; i++) await tick(6); await page.keyboard.up('KeyF'); await tick(4);
  s = await state();
  check('the site is staked and levelled; the foundation is next, waiting for its delivery', s.stage === 'foundation' && /arrives/.test(s.line || ''), s.line);
  check('a card says what the next stage is and why, and stays away once dismissed', await (async () => {
    const had = await G(() => /Why:/.test(document.getElementById('cvnext').innerText) && !!document.querySelector('#cvnext button[data-act^="seen:"]'));
    await page.click('#cvnext button[data-act^="seen:"]'); await tick(20);
    return had && await G(() => !/Why:/.test(document.getElementById('cvnext').innerText));
  })());
  // the delivery takes an hour of game time: run the clock faster, as a player might
  await page.click('#speed button[data-speed="100"]');
  for (let i = 0; i < 200 && (await state()).stacks === 0; i++) await tick(10);
  await page.click('#speed button[data-speed="1"]'); await tick(30);
  s = await state();
  check('the delivery arrives as stacks by the building', s.stacks >= 14 && s.deliveries === 0 && await G(() => { const st = __construct.current(), b = __build.structs().find((q) => q.id === st.id); return __game.sim.state.sys.construction.stacks.every((k) => Math.hypot(k.x - b.x, k.z - b.z) < 14) && __construct.carry.pieceCount > 100; }), s.stacks + ' stacks');
  await shot('04-delivery');
  const t0 = s.played;

  // carry and work, stage by stage
  const taken = {};
  let trips = 0, reloaded = false, lastStage = '';
  const byHand = async (until) => {
    for (let guard = 0; guard < 600; guard++) {
      s = await state();
      if (s.banner) banners.add(s.banner.split(' ').slice(0, 2).join(' '));
      if (s.done || until(s)) return;
      if (s.stage !== lastStage) { console.log('     ' + Math.round(s.played - t0) + ' s  ' + s.stage + '  (' + s.built + ' of ' + s.total + ')'); lastStage = s.stage; }
      if (s.raise) {
        await walkTo(s.shed, s.shed.r);
        if (!taken.flat) { taken.flat = 1; check('a wall frame lies flat on the deck, waiting to be raised', await G(() => { const pr = __construct.current(), par = __construct.plan(pr.id).raise, mw = __build.membersOf(pr.id); return !!par && Object.keys(pr.members).filter((id) => pr.members[id].parent === par && pr.members[id].stage === 'wall-frame').every((id) => pr.members[id].built && mw.planned.has(id)); })); await shot('06-wall-flat'); }
        await page.keyboard.down('KeyF'); await tick(30);
        if (!taken.half) { taken.half = 1; check('holding F swings it up about its bottom plate', await G(() => { const R = __construct.V.raise; return !!R && R.p > 0.1 && R.p < 0.95 && Math.abs(R.angle) > 0.2 && Math.abs(R.angle) < 1.5; })); await shot('07-wall-half-raised'); }
        for (let i = 0; i < 40 && (await state()).raise; i++) await tick(5);
        await page.keyboard.up('KeyF'); await tick(30);
        if (!taken.up) { taken.up = 1; await shot('08-wall-up'); }
        continue;
      }
      const note = (q) => { if (q.banner) banners.add(q.banner.split(' ').slice(0, 2).join(' ')); };
      if (s.np) {
        // by hand: walk to the piece, point at it, hold the mouse button: it is set in place, then nailed blow by blow
        await walkTo(s.np, 1.2);
        if (s.carried && s.carried.itemId === 'lumber_2x4' && !taken.carry) { taken.carry = 1; check('the load is on the shoulder and walking is a little slower', await G(() => __construct.carry.loadForm === 'lumber' && __game.player.carryK > 0.7 && __game.player.carryK < 1)); await shot('05-carrying-studs'); }
        for (let k = 0; k < 40; k++) {
          const q = await state(); note(q);
          if (!q.np || q.raise || Math.hypot(q.np.x - q.px, q.np.z - q.pz) > 1.7) break;
          await page.mouse.move(q.np.sx, q.np.sy); await tick(1);
          const c = await state();
          if (c.ctx !== 'hands') { await tick(4); break; }
          if (!taken.loose && c.stage === 'floor-frame') {
            taken.loose = 1; await page.mouse.down(); await tick(2); await page.mouse.up(); await tick(8);
            check('a click sets a piece in place: its material leaves the arms and it sits loose until it is nailed', await G(() => { const pr = __construct.current(); return Object.values(pr.members).some((m) => !m.built && m.need > 0 && m.got >= m.need - 1e-6); }) && /Nail it/.test((await state()).prompt), (await state()).prompt);
            await shot('05a-set-loose');
          }
          await page.mouse.down(); await tick(24); await page.mouse.up(); await tick(1);
          // save and reload in the middle of framing the second wall, with studs in the arms
          if (!reloaded && c.stage === 'wall-frame' && c.raised === 1 && c.built - 24 > 22 && c.carried && c.carried.qty > 3) {
            await tick(20);
            const q2 = await state();
            const snap = await G(() => { __game.saveGame(); const s = __game.sim.state.sys.construction, pr = __construct.current(); return { c: JSON.stringify(s), money: __game.sim.state.sys.stock.money, built: Object.values(pr.members).filter((m) => m.built).length, flat: Object.keys(pr.members).filter((id) => pr.members[id].built && pr.members[id].stage === 'wall-frame' && !pr.raised[pr.members[id].parent]).length }; });
            T.T0.base = q2.played;
            await T.page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await T.boot(); await tick(10);
            const back = await G(() => { const s = __game.sim.state.sys.construction, pr = __construct.current(), mw = __build.membersOf(pr.id); return { c: JSON.stringify(s), money: __game.sim.state.sys.stock.money, load: __construct.carry.loadForm, stacks: __construct.carry.pieceCount,
              agree: Object.keys(pr.members).every((id) => { const m = pr.members[id], lying = m.stage === 'wall-frame' && !pr.raised[m.parent]; return mw.planned.has(id) === !(m.built && !lying); }) }; });
            check('a save in the middle of a wall reloads exactly: stacks, the load in the arms, every piece', back.c === snap.c && back.money === snap.money && back.load === 'lumber' && back.stacks > 50 && back.agree && snap.flat > 3, snap.built + ' built, ' + snap.flat + ' lying flat');
            reloaded = true; break;
          }
        }
        const z = await state();
        if (z.stage === 'roof-deck' && !taken.rafters) { taken.rafters = 1; await shot('09-rafters'); }
        continue;
      }
      if (!s.target) { await tick(20); continue; }
      await walkTo(s.target, 1.0);
      const sp = await G((t) => { const v = new __game.THREE.Vector3(t.x, __game.heightAt(t.x, t.z) + 0.2, t.z).project(__game.camera); return { x: (v.x * 0.5 + 0.5) * __construct.reach.w, y: (-v.y * 0.5 + 0.5) * __construct.reach.h }; }, s.target);
      await page.mouse.move(sp.x, sp.y); await tick(2);
      const c = await state();
      if (c.ctx === 'pick' || c.ctx === 'swap' || c.ctx === 'back') { await page.mouse.down(); await tick(1); await page.mouse.up(); await tick(2); trips++; }
      else await tick(10);
    }
  };
  await byHand((q) => ['sheathing', 'wrap', 'openings', 'cladding', 'insulation', 'lining'].includes(q.stage));
  s = await state();
  handsOnRoofed = s.played - t0;
  check('by hand from bare ground to a roof: foundation, floor, four walls tilted up, plates, rafters, deck, roofing', s.stage === 'sheathing' && s.raised === 4 && reloaded, Math.round(handsOnRoofed) + ' s of play, ' + trips + ' trips to the stacks');
  // real budget: about ten minutes; the bound is generous because the machine is shared
  check('roofed in about ten minutes of play, hands-on', handsOnRoofed < 780, (handsOnRoofed / 60).toFixed(1) + ' min');
  check('the moments were marked: a deck, wall up, framed, first rafter, dried in', ['You have', 'Wall up', 'Framed It', 'First rafter', 'Dried in'].every((b) => banners.has(b)), [...banners].join(' | '));
  check('built walls now stop the player; the deck carries them', await G(() => { const st = __build.structs()[0]; const e = { x: st.x + 5, z: st.z, y: st.y0 }; let hit = false; for (let i = 0; i < 80; i++) { const was = e.x; e.x -= 0.1; __build.collide(e, 0.28, true); if (Math.abs(e.x - (was - 0.1)) > 1e-6) hit = true; } return hit && __build.ground(st.x, st.z, st.y0 + 0.2, -50) > st.y0; }));
  await shot('11-dried-in');
  // the long stages: work until done
  await page.keyboard.press('KeyL'); await tick(2);
  await page.click('#cvbody input[data-opt="auto"]'); await tick(2);
  await page.keyboard.press('KeyL'); await tick(2);
  for (let guard = 0; guard < 60; guard++) {
    s = await state();
    if (s.done) break;
    if (s.banner) banners.add(s.banner.split(' ').slice(0, 2).join(' '));
    if (!s.auto) { await walkTo(s.shed, s.shed.r); if ((await state()).ctx === 'auto') await page.keyboard.press('KeyF'); await tick(4); }
    for (let i = 0; i < 400; i++) { await tick(10); const q = await state(); if (q.banner) banners.add(q.banner.split(' ').slice(0, 2).join(' ')); if (!q.auto) break; }
  }
  await tick(40);
  s = await state();
  handsOnAll = s.played - t0;
  await shot('12-finished');
  check('the shed is finished: every piece built in the simulation and in build mode', s.done && s.built === s.total && await G(() => __build.structs().every((q) => q.planned === 0) && __build.pieces().every((p) => p.built !== false)), Math.round(handsOnAll) + ' s of play in all');
  check('the door was hung and the finish was marked', banners.has('Door hung') && banners.has('Finished You'));
  const end = await G(() => { const s = __game.sim.state.sys.construction, st = __game.sim.state.sys.stock; return { money: st.money, card: st.projects.find((p) => p.id === 'first-shed').status, unlocked: s.unlocked, carried: s.carried, left: s.stacks.map((k) => k.itemId + ' ' + k.qty), off: __game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s), step: __game.sim.systems.find((q) => q.name === 'construction').api.tutorialStep(s) }; });
  check('money: only the order was paid for', Math.abs(4000 - cost - end.money) < 0.011, '$' + end.money);
  check('nothing conjured or lost: bought = stacks + built + used up', Object.keys(end.off).length === 0 && end.carried === null, 'left over: ' + (end.left.join(', ') || 'nothing'));
  check('the project card is ticked and the cabin and drawing are unlocked', end.card === 'done' && end.unlocked.includes('plan:cabin') && end.unlocked.includes('plan:draw') && end.step === 14);
  await page.keyboard.press('KeyL'); await tick(2);
  await page.click('#cvbody button[data-act="book"]'); await tick(2);
  check('the plan book now offers the cabin', await G(() => !!document.querySelector('#cvbody button[data-act="place:cabin"]')));
  check('a second reload keeps the finished shed', await (async () => { await G(() => __game.saveGame()); await T.page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await T.boot(); await tick(6); return G(() => __build.structs().length === 1 && __build.structs()[0].planned === 0 && Object.values(__game.sim.state.sys.construction.progress)[0].done); })());
  await T.ctx.close();
}

/* ------------------------------------------------------------ part 2: guided */
let guidedAll = 0;
{
  const { ctx, page, G, tick, shot, state, walkTo } = await open();
  await tick(20);
  await page.keyboard.press('KeyL'); await tick(2);
  await page.click('#cvbody button[data-act="place:shed"]'); await tick(2);
  await page.mouse.move(700, 300); await tick(2); await page.mouse.click(700, 300); await tick(4);
  await page.click('#cvbody button[data-act="level:guided"]'); await tick(2);
  await page.click('#cvbody input[data-opt="instant"]'); await tick(2);
  await page.click('#cvbody button[data-act="order:all"]'); await tick(30);
  let s = await state();
  check('guided: with instant deliveries the stacks are there at once', s.stacks >= 14 && s.deliveries === 0);
  await page.keyboard.press('KeyL'); await tick(2);
  const t0 = s.played;
  await walkTo(s.shed, s.shed.r);
  let presses = 0;
  for (let guard = 0; guard < 40; guard++) {
    s = await state();
    if (s.done) break;
    if (!s.auto && s.ctx === 'auto') { await page.keyboard.press('KeyF'); presses++; await tick(3); }
    for (let i = 0; i < 300; i++) { await tick(10); const q = await state(); if (!q.auto) break; }
    if (guard === 4) await shot('13-guided');
  }
  await tick(30);
  s = await state();
  guidedAll = s.played - t0;
  check('guided: one press a stage builds the whole shed, walls tilting up on their own', s.done && s.built === s.total && presses >= 12 && presses <= 16, presses + ' presses, ' + Math.round(guidedAll) + ' s of play');
  // real budget: about three minutes
  check('guided: finished in about three minutes of play', guidedAll < 300, (guidedAll / 60).toFixed(1) + ' min');
  const end = await G(() => { const s = __game.sim.state.sys.construction, st = __game.sim.state.sys.stock; return { card: st.projects.find((p) => p.id === 'first-shed').status, cabin: s.unlocked.includes('plan:cabin'), off: __game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s), planned: __build.structs().map((q) => q.planned).join() }; });
  check('guided: card ticked, cabin unlocked, materials conserved, everything drawn as built', end.card === 'done' && end.cabin && Object.keys(end.off).length === 0 && end.planned === '0');
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log('\nhands-on: roofed in ' + (handsOnRoofed / 60).toFixed(1) + ' min, finished in ' + (handsOnAll / 60).toFixed(1) + ' min (the later stages on "Work until done");  guided: ' + (guidedAll / 60).toFixed(1) + ' min');
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
