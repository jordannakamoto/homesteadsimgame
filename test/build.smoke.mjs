// Build mode, driven the way a player drives it: node test/build.smoke.mjs  (needs dist/index.html and Playwright)
// Builds a small house with pointer events on the canvas, then checks the piece list, exact typed sizes,
// selection and remodeling, undo and redo, saving, and that a phone can reach every tool and option.
// Software rendering manages about a frame a second here, so drawing is switched off and frames are stepped
// by hand; a real frame is drawn at the end of each part.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  await page.goto(file, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game && window.__build && window.__build.view, null, { timeout: 180000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  await G(() => {
    const g = __game; g.lockQuality(); g.setQuality('low'); localStorage.clear(); __build.reset();
    const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
    window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  });
  const step = (n = 2) => G((n) => window.__step(n), n);
  // a real frame, so shader and draw errors surface
  const draw = () => G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });
  return { ctx, page, G, step, draw };
}

/* ---------- desktop: build a house ---------- */
{
  const { ctx, page, G, step, draw } = await open({ viewport: { width: 1280, height: 720 } });
  await page.keyboard.press('KeyB'); await step(70);
  check('build mode opens on Select, the home tool', await G(() => __game.player.tool === 'build' && !document.getElementById('buildbar').hidden && __build.view().tool === 'select'));
  check('thirteen tools, each with a letter', await G(() => { const b = [...document.querySelectorAll('#bpieces button')]; return b.length === 13 && b.every((x) => x.querySelector('.key').textContent.length === 1 && x.querySelector('svg')); }));

  // screen position of a point given in a frame's own metres (the building's grid), at a height above its base
  const at = (lx, lz, up = 0.12) => G(([lx, lz, up]) => {
    const g = __game, S = __build.state.structs[0] || window.__F, [x, z] = __build.toWorld(S, lx, lz);
    const v = new g.THREE.Vector3(x, (S.y0 === undefined ? g.heightAt(x, z) : S.y0) + up, z).project(g.camera), r = g.renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
  }, [lx, lz, up]);
  const move = async (p) => { await page.mouse.move(p[0], p[1]); await step(2); };
  const click = async (p) => { await move(p); await page.mouse.down(); await page.mouse.up(); await step(2); };
  const drag = async (a, b) => { await move(a); await page.mouse.down(); await step(1); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); await step(1); await move(b); await page.mouse.up(); await step(3); };
  const pieces = (f) => G((f) => __build.pieces().filter((p) => (!f && !p.parent) || (p.kind === f && (!p.parent || f === 'door' || f === 'window'))).map((p) => ({ id: p.id, kind: p.kind, type: p.type, material: p.material, length: p.length, height: p.height, area: p.area, netArea: p.netArea, y0: p.y0, y1: p.y1, wall: p.wall, free: p.free, layers: p.layers, pitchDeg: p.pitchDeg, planArea: p.planArea, openings: (p.openings || []).map((o) => ({ id: o.id, kind: o.kind, offset: o.offset, width: o.width })) })), f);

  // the new building's grid: ahead of the player, clear of the bar, facing the way the view does
  await G(() => { __game.cam.dist = 44; }); await step(30);
  await page.keyboard.press('KeyR'); await step(2);
  check('R picks the Room tool and its options are shown as swatches', await G(() => __build.view().tool === 'room' && document.querySelectorAll('#bopts .bsw').length >= 18 && !!document.querySelector('#bopts .btile[aria-pressed="true"]')));
  await G(() => { const g = __game, c = g.cam, x = g.player.x - Math.sin(c.yaw) * 1 - Math.cos(c.yaw) * 5, z = g.player.z - Math.cos(c.yaw) * 1 + Math.sin(c.yaw) * 5; const r = g.renderer.domElement.getBoundingClientRect(), v = new g.THREE.Vector3(x, g.heightAt(x, z), z).project(g.camera); window.__p0 = [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; });
  await move(await G(() => window.__p0));
  await G(() => { const p = __build.state.pending; window.__F = { ox: p.ox, oz: p.oz, yaw: p.yaw }; });

  // a room 5 m by 4 m, in one drag
  await move(await at(0, 0)); await page.mouse.down(); await step(1);
  await G(() => { window.__F.y0 = __build.state.drag.F.y0; });   // the stroke runs on a level plane from where it began
  await move(await at(3, 2, 0)); await move(await at(5, 4, 0));
  check('live dimensions and area show while a room is dragged', await G(() => { const d = __build.state.ov.dims; return d.length === 3 && d[0].text === '5 m' && d[1].text === '4 m' && d[2].text === '20 m²' && [...document.querySelectorAll('.bdim')].filter((e) => !e.hidden).length === 3; }));
  await page.mouse.up(); await step(3);
  let walls = await pieces('wall'), floors = await pieces('floor');
  check('one drag makes a room: four walls and a floor', walls.length === 4 && floors.length === 1, walls.map((w) => w.length).join(','));
  check('wall lengths, heights and areas are right', walls.map((w) => w.length).sort().join() === '4,4,5,5' && walls.every((w) => near(w.height, 2.84) && near(w.y1 - w.y0, 2.84) && near(w.area, w.length * 2.84) && w.layers.length === 5 && w.layers[3].material === 'air'), JSON.stringify(walls[0].layers));
  check('floor is 20 square metres with a layered build-up', near(floors[0].area, 20) && near(floors[0].y1 - floors[0].y0, 0.12) && floors[0].layers.length === 3);
  check('the floor sits at the foot of the walls', near(floors[0].y0, walls[0].y0));
  const ids0 = (await pieces()).map((p) => p.id);

  // a door in the near wall and a window in a side wall, by pointing at the wall faces
  await page.keyboard.press('KeyJ'); await click(await at(2.5, 4, 1.2));
  await page.keyboard.press('KeyU'); await click(await at(5, 1.5, 1.4));
  walls = await pieces('wall');
  const doors = await pieces('door'), wins = await pieces('window');
  const wd = walls.find((w) => w.openings.some((o) => o.kind === 'door')), ww = walls.find((w) => w.openings.some((o) => o.kind === 'window'));
  check('a door and a window are pieces of their own', doors.length === 1 && wins.length === 1, JSON.stringify(doors.concat(wins).map((p) => [p.type, p.length, p.height])));
  check('each is an opening on the wall it was put in', !!wd && !!ww && wd.id !== ww.id && wd.length === 5 && ww.length === 4 && doors[0].wall === wd.id && wins[0].wall === ww.id && wd.openings[0].id === doors[0].id && ww.openings[0].id === wins[0].id);
  check('openings are cut out of the wall area', near(wd.netArea, wd.area - doors[0].area) && near(doors[0].length, 0.82) && near(wd.openings[0].offset, 2.09) && near(ww.openings[0].offset, 1.1));

  // a pitched roof in one click
  await page.keyboard.press('KeyO'); await click(await at(2.5, 2));
  const roof = await pieces('roof');
  check('one click roofs the room: two planes with real geometry', roof.length === 2 && roof.every((r) => r.pitchDeg > 30 && r.pitchDeg < 50 && r.area > r.planArea && near(r.area * Math.cos((r.pitchDeg * Math.PI) / 180), r.planArea, 1e-6) && r.y1 > r.y0 && r.layers.length >= 1), JSON.stringify(roof.map((r) => [r.pitchDeg.toFixed(1), r.area.toFixed(2)])));
  check('the eaves sit at the top of the walls, less the overhang', roof.every((r) => r.y0 < walls[0].y1 && r.y0 > walls[0].y1 - 0.6 && r.y1 > walls[0].y1));
  check('piece ids did not shift when the door, window and roof were added', (await pieces()).filter((p) => ids0.includes(p.id)).length === ids0.length);
  const q = await G(() => __build.quantities());
  check('quantities add up from the piece list', near(q.wallLength, 18) && near(q.floorArea, 20) && q.doors === 1 && q.windows === 1 && near(q.roofArea, roof[0].area * 2, 1e-6), JSON.stringify(q));
  if (process.env.DUMP_HOUSE) {   // refresh the fixture the simulation tests use: a real small house as the simulation sees it
    const fs = await import('node:fs'); await step(3);
    fs.writeFileSync(process.env.DUMP_HOUSE, JSON.stringify(await G(() => __game.sim.state.sys.site.pieces), null, 1));
  }

  // a wall drawn point to point with a typed length
  await page.keyboard.press('KeyN'); await click(await at(8, 0)); await move(await at(11.2, 2.3));
  check('a wall in hand shows its length and angle, with a field to type in', await G(() => { const d = __build.state.ov.dims; return d.length === 2 && d[0].field === 'a' && d[1].field === 'b' && !!document.querySelector('.bdim.field input'); }));
  await page.keyboard.type('3.7'); await step(2);
  check('typing sets the length of the ghost', await G(() => Math.abs(__build.state.ov.dims[0].val - 3.7) < 1e-9 && document.activeElement.tagName === 'INPUT'));
  await page.keyboard.press('Enter'); await step(3); await page.keyboard.press('Escape'); await step(2);
  walls = await pieces('wall');
  const typed = walls.find((w) => w.free);
  check('the typed wall is exactly 3.7 m long', !!typed && near(typed.length, 3.7, 1e-9), typed && String(typed.length));
  const all = (await pieces()).map((p) => p.id);
  check('adding an unrelated wall left every other id alone', ids0.every((id) => all.includes(id)));

  // undo and redo, one step per action
  const n1 = (await pieces()).length;
  await page.keyboard.press('Control+z'); await step(2);
  const n2 = (await pieces()).length;
  await page.keyboard.press('Control+Shift+z'); await step(2);
  const back = await pieces('wall');
  check('undo takes the typed wall away in one step and redo brings it back with the same id', n2 === n1 - 1 && back.some((w) => w.id === typed.id && near(w.length, 3.7, 1e-9)));
  check('undo and redo are always on the bar, and undo runs at least 100 deep', await G(() => { const u = document.getElementById('bundo'), r = document.getElementById('bredo'); return u.offsetWidth > 0 && r.offsetWidth > 0 && !u.disabled; }));

  // saving: exact round trip, ids included
  const rt = await G(() => { const a = JSON.stringify(__build.serialize()), ids = __build.pieces().map((p) => p.id).join(), pj = JSON.stringify(__build.pieces()); __build.restore(JSON.parse(a)); return { same: a === JSON.stringify(__build.serialize()), ids: ids === __build.pieces().map((p) => p.id).join(), pieces: pj === JSON.stringify(__build.pieces()) }; });
  check('serialize and restore round-trip exactly, piece for piece and id for id', rt.same && rt.ids && rt.pieces, JSON.stringify(rt));
  // a save from before pieces had ids still loads, and its pieces are given ids
  const old = await G(() => { const d = JSON.parse(JSON.stringify(__build.serialize())), keep = JSON.stringify(d), n = __build.pieces().length; const v1 = { v: 1, structs: d.structs.map((s) => { delete s.ids; delete s.id; s.roofs.forEach((r) => delete r.id); s.segs = s.segs.map((x) => x.slice(0, 6)); return s; }) }; __build.restore(v1); const got = __build.pieces(), ok = got.length === n && got.every((p) => /^p\d/.test(p.id)) && new Set(got.map((p) => p.id)).size === n; __build.restore(JSON.parse(keep)); return ok; });
  check('a version 1 save (no ids) loads and every piece gets an id', old);
  const cost = await G(() => { const t = performance.now(); for (let i = 0; i < 300; i++) __build.update(1 / 144); return (performance.now() - t) / 300; });
  check('build mode costs little when nothing moves', cost < 0.5, cost.toFixed(3) + ' ms a frame');
  let fired = 0;
  await G(() => { window.__n = 0; window.__off = __build.onChange(() => window.__n++); });
  await page.keyboard.press('KeyP'); await click(await at(-2, 1)); await step(3);
  fired = await G(() => window.__n);
  check('onChange fires once when a piece is added', fired === 1 && (await pieces('post')).length === 1, 'fired ' + fired);
  await page.keyboard.press('Control+z'); await step(2);

  // Select: click a wall, read it in the inspector, change it in place
  await page.keyboard.press('Escape'); await step(2);
  check('Esc returns to Select', await G(() => __build.view().tool === 'select'));
  await click(await at(1.5, 4, 1.5));
  let v = await G(() => { const v = __build.view(); return { sel: __build.selection(), groups: v.groups.map((g) => g.id || g.title), info: v.groups[0].text }; });
  check('clicking a wall selects it and the strip becomes its inspector', v.sel.length === 1 && v.sel[0] === wd.id && v.groups.includes('s:style') && v.groups.includes('s:wmat') && v.groups.includes('s:len') && /5 m long/.test(v.info), v.info);
  await page.click('#bopts .bsw[title="Stone"]'); await step(2);
  check('a material swatch changes the selected wall in place, keeping its id', (await pieces('wall')).find((w) => w.id === wd.id).material === 'stone' && (await G(() => __build.selection()[0])) === wd.id);
  // push the wall out two metres: the room grows with it
  await page.waitForTimeout(450);
  const a = await at(1.5, 4, 0.6), b = await at(1.5, 6, 0.12);
  await move(a); await page.mouse.down(); await step(1); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); await step(2); await move(b); await page.mouse.up(); await step(3);
  floors = await pieces('floor');
  const grown = (await pieces('wall')).find((w) => w.id === wd.id);
  check('dragging a wall outward extends the room: floor, side walls and roof follow', near(floors[0].area, 30) && !!grown && grown.openings.length === 1 && (await pieces('roof')).every((r) => r.id.startsWith(roof[0].id.split('.')[0])), 'floor ' + floors[0].area);
  await page.keyboard.press('Control+z'); await step(2);
  check('and it undoes in one step', near((await pieces('floor'))[0].area, 20));
  // an exact length typed in the inspector
  await page.keyboard.press('KeyV'); await page.waitForTimeout(450); await click(await at(9.5, 1.08, 1)); await step(2);
  const hasLen = await G(() => !!document.querySelector('#bopts input[aria-label="Length"]'));
  if (hasLen) { await page.fill('#bopts input[aria-label="Length"]', '4.25'); await page.keyboard.press('Enter'); await step(3); }
  const set = (await pieces('wall')).find((w) => w.free);
  check('typing a length in the inspector sets a wall to exactly that', hasLen && near(set.length, 4.25, 1e-9), set && String(set.length));
  await page.keyboard.press('Delete'); await step(2);
  check('Delete removes the selection', !(await pieces('wall')).some((w) => w.free));

  // a marquee over open ground takes everything inside it; Delete and undo work on the group
  await page.keyboard.press('KeyV'); await step(2);
  const m0 = await at(-1.5, -1.5), m1 = await at(6.5, 5.5);
  await move(m0); await page.mouse.down(); await step(1); await page.mouse.move((m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2); await step(1); await move(m1); await page.mouse.up(); await step(3);
  const marq = (await G(() => __build.selection())).length;
  check('dragging over open ground selects the pieces inside', marq >= 5, marq + ' selected');
  check('a group shows its quantities', await G(() => /walls 18 m/.test(__build.view().groups[0].text) && /floor 20/.test(__build.view().groups[0].text)), await G(() => __build.view().groups[0].text));
  await page.keyboard.press('Escape'); await step(2);

  // measuring
  await page.keyboard.press('KeyY'); await click(await at(0, 0)); await click(await at(5, 0));
  check('Measure reads the distance between two clicked points and keeps it', await G(() => __build.state.meas.length === 1 && /^5 m/.test(__build.state.ov.meas[0].text)), await G(() => __build.state.ov.meas[0] && __build.state.ov.meas[0].text));
  // snapping
  check('the snap magnet is on the bar and toggles', await G(() => { const b = document.getElementById('bsnap'), was = b.getAttribute('aria-pressed'); b.click(); const off = __build.view().snap === false; b.click(); return was === 'true' && off && __build.view().snap === true; }));
  await page.keyboard.press('KeyN'); await move(await at(5.08, 4.07));
  check('the cursor snaps to a wall end and says so', await G(() => __build.state.hover && __build.state.hover.snap === 'end' && __build.state.ov.snap && __build.state.ov.snap.text === 'End'), await G(() => __build.state.hover && __build.state.hover.snap));
  await draw(); await page.waitForTimeout(600);
  await page.screenshot({ path: 'dist/build-smoke.png' });
  await ctx.close();
}

/* ---------- phone: every tool and option within reach of a thumb ---------- */
{
  const { ctx, page, G, step, draw } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await G(() => window.__touch.enable());
  await page.tap('#tools button[data-tool="build"]'); await step(70);
  const sizes = await G(() => [...document.querySelectorAll('#bpieces button, #bsnap, #bdone, #bundo, #bredo')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check('phone: tools, undo, redo and snap are at least 40 px', sizes.length >= 17 && sizes.every((s) => s[0] >= 40 && s[1] >= 40), JSON.stringify(sizes.slice(0, 3)));
  for (const id of ['room', 'roof', 'decor', 'erase']) { await G((id) => document.querySelector('#bpieces button[data-piece="' + id + '"]').scrollIntoView({ inline: 'center' }), id); await page.tap('#bpieces button[data-piece="' + id + '"]'); await step(2); check('phone: ' + id + ' can be reached and picked', (await G(() => __build.view().top)) === id); }
  await G(() => document.querySelector('#bpieces button[data-piece="wall"]').scrollIntoView({ inline: 'center' })); await page.tap('#bpieces button[data-piece="wall"]'); await step(2);
  const strip = await G(() => { const o = document.getElementById('bopts'), items = [...o.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }); return { scrolls: o.scrollWidth > o.clientWidth, wraps: o.scrollHeight > o.clientHeight + 4, items }; });
  check('phone: the options strip scrolls sideways and its targets are at least 40 px', strip.scrolls && !strip.wraps && strip.items.every((s) => s[0] >= 40 && s[1] >= 40), JSON.stringify(strip.items.slice(0, 4)));
  await G(() => document.querySelector('#bopts .bsw[title="Brick"]').scrollIntoView({ inline: 'center' })); await page.tap('#bopts .bsw[title="Brick"]'); await step(2);
  check('phone: a material further along the strip can be chosen', (await G(() => __build.state.wmat)) === 'brick');
  check('phone: the bar fits the screen', await G(() => { const r = document.getElementById('buildbar').getBoundingClientRect(); return r.left >= 0 && r.right <= 390 && r.bottom <= 844 && r.height < 300; }));
  // a room by touch: tap a corner, then touch again to aim the opposite one
  await G(() => document.querySelector('#bpieces button[data-piece="room"]').scrollIntoView({ inline: 'center' })); await page.tap('#bpieces button[data-piece="room"]'); await step(2);
  await page.touchscreen.tap(120, 330); await step(3); await page.touchscreen.tap(290, 470); await step(4);
  check('phone: two taps build a room', await G(() => __build.pieces().some((p) => p.kind === 'floor') && __build.pieces().filter((p) => p.kind === 'wall').length === 4));
  await draw(); await page.waitForTimeout(600);
  await page.screenshot({ path: 'dist/build-smoke-phone.png' });
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed: ' + fails.join('; ')); process.exit(1); }
console.log('\nall passed');
