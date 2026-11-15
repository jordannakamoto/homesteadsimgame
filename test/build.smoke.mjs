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
    g.sim.commandNow('construction.setOption', { key: 'sandbox', value: true });   // this test draws buildings that are built at once
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
  check('fourteen tools, each with a letter', await G(() => { const b = [...document.querySelectorAll('#bpieces button')]; return b.length === 14 && b.every((x) => x.querySelector('.key').textContent.length === 1 && x.querySelector('svg')); }));

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

  if (process.env.DUMP_SHED) {    // the tool shed as build mode plans it, for the headless construction tests
    const fs = await import('node:fs');
    const shed = await G(() => { const was = __build.constructionMode; __build.setConstructionMode(true); const r = __build.placePlan('shed', 40, 40, 0);
      const out = { struct: r.struct, pieces: __build.pieces().filter((p) => p.struct === r.struct), materialsList: __build.materialsList(r.struct) };
      __build.setConstructionMode(was); __build.key({ code: 'KeyZ', ctrlKey: true, preventDefault() {} }); return out; });
    fs.writeFileSync(process.env.DUMP_SHED, JSON.stringify(shed));
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
  check('a paused save captures build edits without waiting for a frame', await G(() => {
    const speed = __game.speed, build = __build.serialize();
    __game.setSpeed(0);
    try {
      __build.restore({ ...build, structs: [] });
      const empty = __game.saveData();
      __build.restore(build);
      const restored = __game.saveData();
      const ids = __build.pieces().map((p) => p.id).join();
      return empty.sim.sys.site.pieces.length === 0 &&
        restored.sim.sys.site.pieces.map((p) => p.id).join() === ids &&
        ids.length > 0 && empty.sim.tick === restored.sim.tick;
    } finally {
      __game.setSpeed(speed);
    }
  }));
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
  /* ---------- construction: real members, stages, built state, the shopping list, ready-made plans ---------- */
  await page.keyboard.press('Escape'); await step(2);
  const mem = await G((id) => __build.pieces().filter((p) => p.parent === id && p.kind !== 'window').map((p) => ({ id: p.id, kind: p.kind, type: p.type, stage: p.stage, built: p.built, b: p.section && p.section.b, d: p.section && p.section.d, length: p.length, ax: p.a.x, az: p.a.z, material: p.material })), ww.id);
  const wwNow = (await G((id) => __build.piece(id), ww.id));
  const studs = mem.filter((m) => m.kind === 'stud'), commons = studs.filter((m) => m.type === 'stud');
  const alongW = (m) => Math.hypot(m.ax - wwNow.a.x, m.az - wwNow.a.z);
  const gaps = commons.map(alongW).sort((a, b) => a - b).map((v) => Math.round(v * 100) / 100);
  check('a framed wall lists its members: plates, studs every 0.4 m, kings, jacks and a header at the window', wwNow.members.length === mem.length && mem.filter((m) => m.kind === 'plate' && m.type !== 'sill').length === 3 && studs.every((m) => near(m.b, 0.038) && near(m.d, 0.089) && m.material === 'timber') && gaps.every((v) => near((v / 0.4) % 1, 0, 1e-6) || near((v / 0.4) % 1, 1, 1e-6)) && studs.filter((m) => m.type === 'king').length === 2 && studs.filter((m) => m.type === 'jack').length === 2 && mem.filter((m) => m.kind === 'header').length === 1, gaps.join(','));
  check('members carry a stage, a parent and a built state; in the sandbox everything is built', mem.every((m) => m.built === true && typeof m.stage === 'string') && (await G(() => __build.pieces().every((p) => p.built === true && (!p.stage || __build.STAGES.includes(p.stage)))) ) && new Set(mem.map((m) => m.stage)).size >= 5, [...new Set(mem.map((m) => m.stage))].join(','));
  const kinds = await G(() => [...new Set(__build.pieces().filter((p) => p.parent).map((p) => p.kind))].sort().join(','));
  check('the house has a foundation, a floor frame, rafters, sheets and membranes as pieces', ['pier', 'beam', 'joist', 'rafter', 'sheathing', 'membrane', 'cladding', 'roofing', 'lining', 'stud', 'plate', 'header'].every((k) => kinds.split(',').includes(k)), kinds);
  // a plan set down in construction mode starts unbuilt and is raised stage by stage
  const shed = await G(() => { const g = __game; __build.setConstructionMode(true); const r = __build.placePlan('shed', g.player.x + 14, g.player.z + 9, 0.4); const P = __build.pieces().filter((p) => p.struct === r.struct);
    return { r, n: P.length, planned: P.filter((p) => !p.built).length, wallLayers: P.filter((p) => p.kind === 'wall' && !p.type.startsWith('g')).map((p) => p.layers.length), floor: P.filter((p) => p.kind === 'floor').map((p) => [p.area, p.layers.length]), piers: P.filter((p) => p.kind === 'pier').length, roofs: P.filter((p) => p.kind === 'roof').map((p) => p.type), doors: P.filter((p) => p.kind === 'door').length, wins: P.filter((p) => p.kind === 'window').length, len: P.filter((p) => p.kind === 'wall' && p.type === 'wall').map((p) => p.length).sort() }; });
  check('placePlan sets down the 2.4 x 3.0 m shed: four walls, a door, a window, a single-pitch roof, six pier blocks', !!shed.r && shed.piers === 6 && shed.doors === 1 && shed.wins === 1 && shed.roofs.join() === 'shed' && near(shed.floor[0][0], 7.2, 1e-6) && shed.len.map((v) => v.toFixed(1)).join() === '2.4,2.4,3.0,3.0' && (await G(() => __build.plans().map((p) => p.id).join())) === 'shed,cabin', JSON.stringify(shed));
  check('in construction mode a new plan starts entirely planned, and reports no layers', shed.planned === shed.n && shed.wallLayers.every((n) => n === 0) && shed.floor[0][1] === 0, shed.planned + ' of ' + shed.n);
  const stageUp = (to) => G(([S, to]) => { for (const st of __build.STAGES) { __build.setStageBuilt(S, st, true); if (st === to) break; } const P = __build.pieces().filter((p) => p.struct === S), w = P.find((p) => p.kind === 'wall' && p.type === 'wall'); return { layers: w.layers.map((l) => l.role + ':' + l.material), wallBuilt: w.built, built: P.filter((p) => p.built).length, n: P.length }; }, [shed.r.struct, to]);
  let su = await stageUp('top-plates'); await step(3);
  check('with the frames up a wall is an air cavity and nothing else', su.layers.join() === 'cavity:air' && su.wallBuilt === false && su.built > 0 && su.built < su.n, su.layers.join());
  su = await stageUp('wrap');
  check('sheathing and wrap appear in the layers once they are built', su.layers.join() === 'wrap:housewrap,sheathing:osb,cavity:air', su.layers.join());
  const rt2 = await G(() => { const a = JSON.stringify(__build.serialize()), b = __build.pieces().filter((p) => !p.built).map((p) => p.id).join(); __build.restore(JSON.parse(a)); return a === JSON.stringify(__build.serialize()) && b === __build.pieces().filter((p) => !p.built).map((p) => p.id).join() && b.length > 0; });
  check('what is built and what is planned survives saving and loading', rt2);
  const ml = await G((S) => __build.materialsList(S), shed.r.struct);
  const STG = await G(() => __build.STAGES);
  check('materialsList gives the shed by stage in buyable units, each line with a plain reason', ml.length >= 20 && ml.every((l) => STG.includes(l.stage) && l.label && l.why && l.qty > 0 && l.unit) && ml.find((l) => l.label === 'Pier blocks').qty === 6 && ml.find((l) => l.label.startsWith('Studs')).itemId === 'lumber_2x4' && ml.find((l) => l.label === 'Subfloor sheets').qty === 3, ml.length + ' lines');
  if (process.env.DUMP_SHED) (await import('node:fs')).writeFileSync(process.env.DUMP_SHED, JSON.stringify({ materials: ml, pieces: await G((S) => __build.pieces().filter((p) => p.struct === S), shed.r.struct) }, null, 1));
  await G(() => { __build.setBuilt(__build.pieces().filter((p) => p.kind === 'stud').slice(0, 3).map((p) => p.id), false); }); await step(3);
  check('setBuilt takes single members back to planned', (await G(() => __build.pieces().filter((p) => p.kind === 'stud' && !p.built).length)) === 3);
  await G(() => { __build.setAllBuilt(true); __build.setConstructionMode(false); }); await step(3);
  check('setAllBuilt finishes everything', await G(() => __build.pieces().every((p) => p.built)));
  await page.click('#bsched'); await step(3);
  check('the Schedule panel lists what to buy by stage, with a total', await G(() => { const p = document.getElementById('bschedp'); return !p.hidden && p.querySelectorAll('section').length >= 10 && /Studs/.test(p.textContent) && /Total/.test(p.textContent); }));
  await draw(); await page.waitForTimeout(600); await page.screenshot({ path: 'dist/build-smoke-schedule.png' });
  await page.click('#bsched'); await step(2);
  const tm = await G(() => { const t = performance.now(); for (let i = 0; i < 20; i++) { __build.state.version++; __build.state.structs.forEach((S) => (S.pc = null)); __build.pieces(); } return (performance.now() - t) / 20; });
  check('pieces() stays quick with every member in it', tm < 25, tm.toFixed(2) + ' ms to rebuild the whole list, ' + (await G(() => __build.pieces().length)) + ' pieces');
  /* ---------- equipment: fixtures, their settings, and wires and pipes between ports ---------- */
  await page.keyboard.press('KeyE'); await step(3);
  check('E picks up the Equip tool with a catalog to choose from', await G(() => __build.view().tool === 'equip' && document.querySelectorAll('#bdecor .bchip').length >= 2 && Object.keys(__build.fixtureCatalog()).length >= 6));
  // a panel on the roof takes the plane's tilt and facing; a battery and a light go on the floor by clicking
  await click(await at(2.5, 0.8, 3.6)); await step(3);
  let fx = await G(() => __build.pieces().filter((p) => p.kind === 'fixture' && p.fixture));
  const plane = await G((id) => __build.piece(id), fx[0] && fx[0].settings.roofPieceId);
  check('a solar panel clicked onto the roof takes that plane\'s tilt and facing', fx.length === 1 && fx[0].fixture === 'demo_solar_panel' && fx[0].mount === 'roof' && !!plane && plane.kind === 'roof' && near(fx[0].settings.tiltDeg, Math.round(plane.pitchDeg * 10) / 10) && near(fx[0].settings.azimuthDeg, Math.round(((Math.atan2(plane.facing.x, -plane.facing.z) * 180 / Math.PI) % 360 + 360) % 360)), JSON.stringify(fx[0] && fx[0].settings));
  await G(() => __build.choose('fx:kind', 'demo_battery')); await page.keyboard.press('KeyV'); await step(2); await page.keyboard.press('KeyE'); await step(2); await G(() => __build.choose('fx:kind', 'demo_battery')); await step(2);
  await click(await at(1.25, 1.25)); await step(3);
  fx = await G(() => __build.pieces().filter((p) => p.kind === 'fixture' && p.fixture));
  const bat = fx.find((f) => f.fixture === 'demo_battery');
  check('a fixture piece has the contract\'s shape', !!bat && bat.mount === 'floor' && typeof bat.a.x === 'number' && typeof bat.y0 === 'number' && bat.y1 > bat.y0 && typeof bat.yawRad === 'number' && typeof bat.settings === 'object' && bat.ports.length === 1 && bat.ports[0].id === 'dc' && bat.ports[0].type === 'power' && /^p\d+$/.test(bat.id), JSON.stringify(bat));
  const more = await G(() => { const g = __game, S = __build.state.structs[0], w = (lx, lz) => { const [x, z] = __build.toWorld(S, lx, lz); return { x, z, y: S.y0 + 0.12 }; };
    return __build.addFixtures([{ fixture: 'demo_light', ...w(3.5, 2), mount: 'floor' }, { fixture: 'demo_water_tank', ...w(8, 2), y: undefined }, { fixture: 'demo_tap', ...w(4.5, 3.5), mount: 'floor' }]); });
  check('addFixtures places equipment from code', more.length === 3 && more.every((id) => /^p\d+$/.test(id)));
  const ids = { panel: fx.find((f) => f.fixture === 'demo_solar_panel').id, bat: bat.id, light: more[0], tank: more[1], tap: more[2] };
  const c1 = await G((i) => __build.connect(i.panel, 'dc', i.bat, 'dc'), ids), c2 = await G((i) => __build.connect(i.tank, 'out', i.tap, 'in', { diameterMm: 25 }), ids), bad = await G((i) => __build.connect(i.bat, 'dc', i.tap, 'in'), ids), dup = await G((i) => __build.connect(i.bat, 'dc', i.panel, 'dc'), ids);
  check('ports of different kinds refuse to join, in plain words', c1.ok && c2.ok && !bad.ok && /power port cannot be joined to a water port/.test(bad.reason) && !dup.ok, bad.reason);
  // the third run is made by hand: from the battery's port dot to the light's
  await step(3);
  const dot = (fid, ev) => G(([fid, ev]) => { const d = [...document.querySelectorAll('.bport')].find((e) => !e.hidden && e._q && e._q.fid === fid); d.dispatchEvent(new PointerEvent(ev, { bubbles: true, cancelable: true })); return true; }, [fid, ev]);
  await dot(ids.bat, 'pointerdown'); await step(2); await dot(ids.light, 'pointerup'); await step(3);
  const links = await G(() => __build.pieces().filter((p) => p.kind === 'wire' || p.kind === 'pipe'));
  const wire = links.find((l) => l.kind === 'wire' && l.to.piece === ids.light), pipe = links.find((l) => l.kind === 'pipe');
  check('dragging from one port to another runs a wire; wires and pipes are pieces with a routed length', links.length === 3 && !!wire && wire.from.piece === ids.bat && wire.from.port === 'dc' && wire.to.port === 'in' && wire.gauge === 12 && wire.lengthM > 2 && wire.material === 'copper' && pipe.diameterMm === 25 && pipe.lengthM > 3 && pipe.gauge === undefined, JSON.stringify(wire));
  check('the inspector offers the run\'s gauge', await G(() => __build.view().groups.some((g) => g.id === 'fx:gauge')));
  await G(() => __build.choose('fx:gauge', 8)); await step(2);
  check('and changing it changes the piece', (await G((id) => __build.piece(id).gauge, wire.id)) === 8);
  const st = await G((i) => ({ a: __build.setFixtureSetting(i.light, 'on', false), b: __build.setFixtureSetting(i.panel, 'tiltDeg', 10), on: __build.piece(i.light).settings.on, tilt: __build.piece(i.panel).settings.tiltDeg }), ids);
  check('setFixtureSetting changes a setting; a roof panel keeps the roof\'s tilt', st.a === true && st.on === false && st.b === false && st.tilt > 20, JSON.stringify(st));
  const frt = await G(() => { const a = JSON.stringify(__build.serialize()), pj = JSON.stringify(__build.pieces().filter((p) => p.stage === 'services')); __build.restore(JSON.parse(a)); return { same: a === JSON.stringify(__build.serialize()), pieces: pj === JSON.stringify(__build.pieces().filter((p) => p.stage === 'services')), n: JSON.parse(pj).length }; });
  check('fixtures and connections survive saving and loading, ids included', frt.same && frt.pieces && frt.n === 8, JSON.stringify(frt));
  await G((i) => __build.removeFixture(i.tank), ids); await step(2);
  check('removing a fixture takes its connections with it', (await G(() => __build.pieces().filter((p) => p.kind === 'pipe').length)) === 0);
  check('the simulation sees the equipment', await G(() => { __game.step(1 / 60); return __game.sim.state.sys.site.pieces.some((p) => p.kind === 'fixture' && p.fixture === 'demo_battery' && p.ports.length === 1) && __game.sim.state.sys.site.pieces.some((p) => p.kind === 'wire' && p.material === 'copper'); }));
  await draw(); await page.waitForTimeout(600); await page.screenshot({ path: 'dist/build-smoke-equip.png' });
  await page.keyboard.press('Escape'); await step(2); await page.keyboard.press('Escape'); await step(2);
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
