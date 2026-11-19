// Shared setup for the yard smokes (test/landscape.smoke.mjs core, test/landscape.tail.smoke.mjs long tail).
import { openPage } from './page.mjs';
export async function yardSetup() {
  const t = await openPage({ viewport: { width: 1280, height: 720 } });   // the yard needs the room: pointer aim at 640x360 missed small targets
  const { page, G, check } = t;
  const wait = t.wait;   // real time: the yard view times presses and drops with performance.now, and a software-GL frame costs more than it sleeps, so stepFrames does not replace these waits
  await t.load();
  check('page loads', await G(() => !!(window.__game && window.__landscape)));
  await G(() => { __game.setSpeed(0); const st = __game.sim.state.sys.stock; st.money = 20000; st.tools.push('rake', 'tamper', 'wheelbarrow', 'garden_hose');
    Object.assign(st.items, { gravel: 1, landscape_fabric: 30, granite_sett: 200, cut_stone: 20, capstone: 4, garden_box_kit: 1, raised_bed_mix: 1200, plant_lavender: 1, pond_liner: 20 }); });
  await page.keyboard.press('Digit6'); await wait(1500);
  check('key 6 takes up the yard tools', await G(() => __game.player.tool === 'yard' && __hands.isOpen));
  const scr = (x, z) => G((o) => { const p = __hands.toScreen(o.x, __game.surfaceAt(o.x, o.z) + 0.02, o.z, {}); return { x: p.x, y: p.y }; }, { x, z });
  const P = await G(() => { const g = __game, P = g.player; return { x: P.x, z: P.z, fx: -Math.sin(g.cam.yaw), fz: -Math.cos(g.cam.yaw), rx: Math.cos(g.cam.yaw), rz: -Math.sin(g.cam.yaw), yaw: g.cam.yaw }; });
  const at = (r, f) => ({ x: P.x + P.rx * r + P.fx * f, z: P.z + P.rz * r + P.fz * f });
  const landed = async () => { for (let k = 0; k < 60 && (await G(() => __landscape.flying)); k++) await wait(250); };
  const hold = async (id) => { await G((i) => __landscape.hold(i), id); await wait(250); };
  const click = async (A) => { const a = await scr(A.x, A.z); await page.mouse.move(a.x, a.y); await wait(80); await page.mouse.down(); await wait(120); await page.mouse.up(); await wait(200); };
  const drag = async (A, B, steps = 12, holdMs = 200) => { const a = await scr(A.x, A.z), b = await scr(B.x, B.z); await page.mouse.move(a.x, a.y); await wait(80); await page.mouse.down(); await wait(120); await page.mouse.move(b.x, b.y, { steps }); await wait(holdMs); await page.mouse.up(); await wait(250); };
  const L = () => G(() => { const s = __game.sim.state.sys.landscape; return { tiles: Object.keys(s.grid.tiles || {}).length, carry: s.carry.m3, things: Object.keys(s.things).length, plants: Object.keys(s.plants).length, net: __game.earthwork.netVolume(s.grid) }; });
  const rel = (A) => G((p) => __game.landscape.reliefAt(__game.sim.state, p.x, p.z), A);
  const ground = (A) => G((p) => __game.landscape.groundAt(__game.sim.state, p.x, p.z), A);
  const scoop = async (A, B) => { await drag(A, B, 10, 250); await wait(300); await landed(); };
  const dig1 = async (A) => { await click(A); await wait(300); await landed(); };
  const bags = () => G(() => Object.values(__game.sim.state.sys.landscape.things).filter((o) => o.k === 'bag').map((o) => ({ id: o.id, x: o.x, z: o.z })));
  return { t, page, G, check, wait, scr, P, at, landed, hold, click, drag, L, rel, ground, scoop, dig1, bags, shots: process.env.SHOTS || '' };
}
