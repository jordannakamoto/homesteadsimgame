// Laying a floor by hand in the built page: a cabin taken up to its flooring stage, then oak strip, vinyl plank, tile and
// carpet each laid through the pointer and the mouse button (set, then nail, tap, beat in, kick or sponge), in the trade's
// order: what goes under, the rows from the start wall with the chalk line ahead of them, cuts at the saw, then the grout,
// the baseboard and the threshold. Needs dist/index.html and Playwright.   node test/flooring.smoke.mjs   (SHOTS=dir for pictures)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html', SHOTS = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const G = (fn, arg) => page.evaluate(fn, arg);
await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 180000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build && window.__construct, null, { timeout: 180000 });
await G(() => { const g = __game; g.lockQuality(); g.setQuality('low'); const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {}; window.__step = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt); }; });
const tick = (n = 3) => G((n) => window.__step(n, 1 / 30), n);
const shot = async (name) => { if (!SHOTS) return; await G(() => { window.__step(1, 1 / 60); window.__draw(__game.scene, __game.camera); }); await page.waitForTimeout(300); await page.screenshot({ path: SHOTS + '/' + name + '.png', timeout: 120000 }); };
await tick(10);

// a cabin, staked out and ordered; everything before the floor is put up at once
await G(() => {
  const P = __game.player, c = __game.sim;
  c.commandNow('construction.setOption', { key: 'instant', value: true });
  c.commandNow('construction.setFeel', { key: 'takeM', value: 12 });
  c.state.sys.stock.money = 1e6;
  const r = __build.placePlan('cabin', P.x + 7, P.z, 0);
  __construct.V.pendingPlan = { struct: r.struct, planId: 'cabin', name: 'Small cabin' };
});
await tick(4);
const upToFloor = () => G(() => {
  const c = __game.sim, api = c.systems.find((q) => q.name === 'construction').api, pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]);
  const ids = Object.keys(pr.members).filter((id) => pr.members[id].stage !== 'flooring' && pr.members[id].stage !== 'trim' && !pr.members[id].built);
  c.commandNow('construction.settle', { structId: pr.id, memberIds: ids });
  const site = ids.filter((id) => pr.members[id].kind === 'site');
  if (site.length) c.commandNow('construction.install', { structId: pr.id, memberIds: site, from: 'stacks' });
  for (const p of api.flatParents(pr, 'wall-frame')) pr.raised[p] || c.commandNow('construction.raise', { structId: pr.id, parent: p });
  __build.setBuilt(ids, true);
  return { stage: pr.stage, left: Object.values(pr.members).filter((m) => !m.built && m.stage !== 'flooring' && m.stage !== 'trim').length };
});
let s = await upToFloor();
await tick(6);
check('the cabin stands up to its floor: the flooring stage is next', s.left === 0 && s.stage === 'flooring', JSON.stringify(s));
s = await G(() => { const pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), v = __construct.plan(pr.id).view.stages.find((q) => q.id === 'flooring'); return { lines: v.lines.map((l) => l.itemId + ' ' + l.qty), why: v.why, n: v.total }; });
check('the cabin\'s floor is pine boards on rosin paper, with a threshold', s.lines.some((l) => /^board_pine_1x6/.test(l)) && s.lines.some((l) => /^underlay_rosin/.test(l)) && s.lines.some((l) => /^threshold_oak/.test(l)), s.lines.join(', '));

// change the floor in Plan mode's own data and let the plan follow
const setFloor = (mat) => G((mat) => { const S = __build.state.structs[0]; for (const q of S.pids) q[3] = mat; __build._t.rebuild(S); }, mat);
const state = (stage = 'flooring') => G((stage) => {
  const c = __construct, s = __game.sim.state.sys.construction, pr = c.current() || Object.values(s.progress)[0], x = c.context(), np = c.nextPiece();
  if (np && np.sx !== undefined) { np.sx = Math.min(1240, Math.max(290, np.sx)); np.sy = Math.min(560, Math.max(128, np.sy)); }
  const fl = Object.keys(pr.members).filter((id) => pr.members[id].stage === stage);
  return { np, ctx: x && x.kind, act: x && x.act, kind: x && x.mid && pr.members[x.mid] ? pr.members[x.mid].kind : null, built: fl.filter((id) => pr.members[id].built).length, total: fl.length, done: pr.done,
    prompt: document.getElementById('cvprompt').hidden ? '' : document.getElementById('cvprompt').innerText.replace(/\s+/g, ' '), banner: document.getElementById('cvbanner').hidden ? '' : document.getElementById('cvbanner').innerText.replace(/\s+/g, ' '),
    sawing: c.V.sawing.size, carried: s.carried && s.carried.itemId, chalk: c.chalkLines(pr.id).length, line: (c.nextAction() || {}).line || '', stageDone: !Object.keys(pr.members).some((id) => pr.members[id].stage === stage && !pr.members[id].built) };
}, stage);
async function layFloor(mat, kinds, max = 2500, stage = 'flooring') {
  const seen = { prompts: new Set(), kinds: [], banners: new Set(), sawn: false, chalk: false, order: true };
  await G((stage) => __construct.act('order:' + stage), stage);
  await tick(4);
  let s = await state(stage), stall = 0, last = -1;
  for (let i = 0; i < max && !s.stageDone; i++) {
    // nothing in the arms for the next piece: pick up an armful from its stack (a click on the stack)
    if (!s.np) {
      await G(() => { const c = __game.sim, api = c.systems.find((q) => q.name === 'construction').api, s = c.state.sys.construction, pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), q = __construct.plan(pr.id).inst;
        const id = q.find((m) => pr.members[m].line && pr.members[m].need - pr.members[m].got > 1e-6), ln = id && pr.lines[pr.members[id].line];
        if (!ln) return; if (s.carried && s.carried.itemId !== ln.itemId) c.commandNow('construction.putDown', { x: __game.player.x + 1, z: __game.player.z });
        const st = s.stacks.find((k) => k.itemId === ln.itemId && !k.barrow); if (st) c.commandNow('construction.pickUp', { stackId: st.id }); });
      await tick(4); s = await state(stage); if (s.sawing) { stall = 0; await tick(10); continue; } if (++stall > 40) { if (process.env.DEBUG) console.log('     no piece', JSON.stringify(s).slice(0, 300), JSON.stringify(await G((stage) => { const c = __game.sim.state.sys.construction, pr = (__construct.current() || Object.values(c.progress)[0]); const need = {}; for (const id in pr.members) { const m = pr.members[id]; if (m.stage === stage && !m.built && m.line) need[m.line] = (need[m.line] || 0) + m.need - m.got; } return { left: Object.keys(pr.members).filter((id) => pr.members[id].stage === stage && !pr.members[id].built).slice(0, 6).map((id) => id + ' ' + pr.members[id].kind + ' ' + (+pr.members[id].got).toFixed(2) + '/' + (+pr.members[id].need).toFixed(2) + ' ' + (__game.sim.systems.find((q) => q.name === 'construction').api.blocked(pr, id)) + (__construct.V.sawing.has(id) ? ' SAWING' : '')), lines: Object.values(pr.lines).filter((l) => l.stage === stage).map((l) => l.itemId + ' q' + (+l.qty).toFixed(2) + ' o' + (+l.ordered).toFixed(2) + ' u' + (+l.used).toFixed(2) + ' still' + (+(need[l.key] || 0)).toFixed(2)), stacks: c.stacks.map((k) => k.itemId + ':' + (+k.qty).toFixed(2)), carried: c.carried && c.carried.itemId + ':' + c.carried.qty, ledger: c.ledger.tile_terracotta }; }, stage))); break; } continue;
    }
    // stand by the piece, point at it, hold the button
    await G((np) => { const P = __game.player, b = __build.structs()[0], dx = np.x - b.x, dz = np.z - b.z, L = Math.hypot(dx, dz) || 1; P.x = np.x - (dx / L) * 0.9; P.z = np.z - (dz / L) * 0.9; P.climbY = null; }, s.np);
    await tick(2);
    s = await state(stage);
    if (!s.np) continue;
    await page.mouse.move(s.np.sx, s.np.sy); await tick(1);
    s = await state(stage);
    if (s.ctx === 'hands') {
      if (s.prompt) seen.prompts.add(s.prompt.replace(/^E /, '').replace(/[0-9]+ of [0-9]+.*$/, '').trim());
      if (s.kind && seen.kinds[seen.kinds.length - 1] !== s.kind) seen.kinds.push(s.kind);
      if (s.chalk) seen.chalk = true;
      await page.mouse.down();
      for (let h = 0; h < 3; h++) { await tick(6); const q = await state(stage); if (q.prompt) seen.prompts.add(q.prompt.replace(/^E /, '').replace(/[0-9]+ of [0-9]+.*$/, '').trim()); if (q.sawing) seen.sawn = true; }
      await page.mouse.up(); await tick(2);
    } else await tick(6);
    s = await state(stage);
    if (s.sawing) seen.sawn = true;
    if (s.ctx === 'hands' && s.kind && stage === 'flooring' && !seen.kneelSeen) seen.kneelSeen = await G(() => (__game.player.kneelK || 0) > 0.5);
    if (s.banner) seen.banners.add(s.banner.split(' ').slice(0, 2).join(' '));
    if (s.built === last) { if (++stall > 60) { if (process.env.DEBUG) console.log('     stuck', JSON.stringify(s).slice(0, 400), JSON.stringify(await G((stage) => { const c = __game.sim.state.sys.construction, pr = (__construct.current() || Object.values(c.progress)[0]); const P = __game.player; return { py: [P.x, P.y, P.z, P.climbY], left: Object.keys(pr.members).filter((id) => pr.members[id].stage === stage && !pr.members[id].built).map((id) => id + ' ' + pr.members[id].kind + ' ' + (+pr.members[id].got).toFixed(2) + '/' + (+pr.members[id].need).toFixed(2)), lines: Object.values(pr.lines).filter((l) => l.stage === stage).map((l) => l.itemId + ' q' + l.qty + ' o' + l.ordered + ' u' + l.used), stacks: c.stacks.map((k) => k.itemId + ':' + (+k.qty).toFixed(2)), carried: c.carried, pending: c.deliveries.length, money: __game.sim.state.sys.stock.money }; }, stage))); break; } } else { stall = 0; last = s.built; }
    if (SHOTS && i === 40) await shot(mat + '-1-under-way');
  }
  for (let i = 0; i < 30 && s.sawing; i++) { await tick(10); s = await state(stage); }
  // the order the trade lays it: each kind of piece starts only once the ones it lies on are down
  const firstAt = (k) => seen.kinds.indexOf(k);
  for (let i = 0; i + 1 < kinds.length; i++) if (firstAt(kinds[i]) < 0 || firstAt(kinds[i + 1]) < firstAt(kinds[i])) seen.order = false;
  return { s, seen };
}

// 1. the cabin's own: pine boards nailed through the tongue over rosin paper
let r = await layFloor('planks', ['underlay', 'plank', 'threshold']);
check('pine floor laid by hand, rosin paper first, then the boards, then the threshold', r.s.built === r.s.total && r.seen.order, r.s.built + ' of ' + r.s.total + ' ' + r.seen.kinds.join('>'));
check('the words are the trade\'s: roll out the paper, staple it, slide the board in, nail through the tongue', ['Roll out the paper', 'Staple it', 'Slide the board in', 'Nail through the tongue'].every((w) => [...r.seen.prompts].some((p) => p.toLowerCase().includes(w.toLowerCase()))), [...r.seen.prompts].slice(0, 8).join(' | '));
check('a chalk line marks the next row, and the boards at the wall go through the saw', r.seen.chalk && r.seen.sawn);
check('the character kneels to lay the floor', !!r.seen.kneelSeen);
check('"Floor down" when it is all in', [...r.seen.banners].some((b) => /^Floor down/.test(b)), [...r.seen.banners].join(', '));
await shot('planks-2-done');
// the trim: Craftsman (the cabin's), stools, casing, aprons, baseboard, then caulk and stain
const tr = await layFloor('planks', ['stool', 'casing', 'apron', 'baseboard', 'paint'], 1500, 'trim');
check('the cabin trimmed out by hand in the finish carpenter\'s order, and finished', tr.s.built === tr.s.total && tr.seen.order && tr.s.done, tr.s.built + ' of ' + tr.s.total + ' ' + tr.seen.kinds.join('>'));
check('trim: the hands say what they are doing', ['Set the', 'Nail it off', 'Caulk the seams', 'Fill and paint'].filter((w) => [...tr.seen.prompts].some((p) => p.toLowerCase().includes(w.toLowerCase()))).length >= 2 && [...tr.seen.prompts].some((p) => /Fill and paint/.test(p)), [...tr.seen.prompts].join(' | '));
check('trim: pieces go through the mitre saw', tr.seen.sawn);
check('"Trimmed out" at the end', [...tr.seen.banners].some((b) => /^Trimmed out|^Finished/.test(b)), [...tr.seen.banners].join(', '));
s = await G(() => { const S = __build.state.structs[0], mw = __build.membersOf(S.id || (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]).id); const t = mw.list.filter((m) => m.stage === 'trim' && m.paintCol); return { n: t.length, planned: t.filter((m) => mw.planned.has(m.id)).length }; });
check('build mode draws every piece of trim as built', s.n > 10 && s.planned === 0, JSON.stringify(s));
s = await G(() => __construct.V.dotStages || {});
check('a finished cabin shows no nail or screw heads anywhere', Object.keys(s).length === 0, JSON.stringify(s));
await shot('trim-done');
s = await G(() => { const pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), mw = __build.membersOf(pr.id), fl = mw.list.filter((m) => m.stage === 'flooring'), p = __build.pieces().find((q) => q.struct === pr.id && q.kind === 'floor'); return { planned: fl.filter((m) => mw.planned.has(m.id)).length, layers: (p.layers || []).map((l) => l.material + ':' + l.role) }; });
check('build mode draws every board as laid, and the floor\'s layers now include it', s.planned === 0 && s.layers.some((l) => /finish|deck/.test(l)), JSON.stringify(s.layers));

// 2..4: the same room with other floors, from the Plan
for (const [mat, kinds, words] of [
  ['lvp', ['plank', 'threshold'], ['Angle the board in and drop it', 'Tap it tight']],
  ['tile', ['backer', 'tile', 'grout', 'threshold'], ['Set the cement board in thinset', 'Butter and set the tile', 'Beat it in level', 'Float grout across the row', 'Sponge off the haze']],
  ['carpet', ['tackstrip', 'pad', 'carpet', 'threshold'], ['Lay the tack strip', 'Roll out the pad', 'Unroll the carpet', 'Kick it tight']],
]) {
  await setFloor(mat); await tick(6);
  s = await G(() => { const pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]); return { stage: pr.stage, n: Object.values(pr.members).filter((m) => m.stage === 'flooring' && !m.built).length }; });
  check(mat + ': choosing another floor in the plan makes it the next work', s.stage === 'flooring' && s.n > 5, JSON.stringify(s));
  r = await layFloor(mat, kinds);
  check(mat + ' laid by hand in the trade\'s order', r.s.built === r.s.total && r.seen.order, r.s.built + ' of ' + r.s.total + ' ' + r.seen.kinds.join('>'));
  { const hit = words.filter((w) => [...r.seen.prompts].some((p) => p.toLowerCase().includes(w.toLowerCase())));
    check(mat + ': the hands say what they are doing', hit.length >= Math.ceil(words.length / 2) && hit.includes(words[words.length - 1]), hit.join(' | ')); }
  if (mat === 'tile') check('tile: the cut tiles at the walls go through the wet saw', r.seen.sawn);
  await shot(mat + '-2-done');
}

// a save in the middle of a floor comes back exactly
await setFloor('hardwood'); await tick(6);
r = await layFloor('hardwood', [], 150);
if (process.env.DEBUG) console.log('     hardwood', r.s.built, r.s.total, r.seen.kinds.join('>'), JSON.stringify(r.s).slice(0, 300));
const snap = await G(() => { const pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), n = Object.values(pr.members).filter((m) => m.stage === 'flooring' && m.built).length; __game.saveGame(); return n; });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build && window.__construct && __construct.current && (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), null, { timeout: 180000 });
await G(() => { const g = __game; g.lockQuality(); g.setQuality('low'); g.renderer.render = () => {}; window.__step = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt); }; });
await tick(8);
const back = await G(() => { const pr = (__construct.current() || Object.values(__game.sim.state.sys.construction.progress)[0]), mw = __build.membersOf(pr.id); return { built: Object.values(pr.members).filter((m) => m.stage === 'flooring' && m.built).length, agree: Object.keys(pr.members).every((id) => mw.planned.has(id) === !pr.members[id].built) }; });
check('a save half way through a floor reloads with every board where it was', back.built === snap && snap > 3 && back.agree, snap + ' -> ' + JSON.stringify(back));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? '\n' + fails.length + ' failed' : '\nall passed');
process.exit(fails.length ? 1 : 0);
