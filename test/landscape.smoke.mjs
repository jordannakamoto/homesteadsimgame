// Browser test of the yard, the fast core: node test/landscape.smoke.mjs  (needs dist/index.html and Playwright)
// Key 6 takes up the yard tools. The shovel digs, carries and drops (earth neither made nor lost), right-drag bulldozes a heap;
// a path is skimmed, tamped, covered with fabric and gravel; cobbles go down in a band; cut stone stacks into a wall with a
// capstone; the yard survives a reload. The long tail (bags, garden box, plant,
// barrow, pond, garden bar) is test/landscape.tail.smoke.mjs: run it when landscape files change. SHOTS=dir saves a screenshot.
import { yardSetup } from './helpers/landscape.mjs';
const Y = await yardSetup();
const { t, page, G, check, wait, scr, P, at, landed, hold, click, drag, L, rel, ground, scoop, dig1, bags, shots } = Y;
// the shovel: press where the blade goes in, drag the scoop where it goes, let go; a click drops it beside the hole
await hold('shovel');
await scoop(at(0.4, 1.2), at(-0.8, 1.2));
let s = await L();
check('a scoop is dug, carried and dropped; earth is neither made nor lost', s.carry === 0 && s.tiles > 0 && Math.abs(s.net) < 2e-4, 'net ' + s.net.toFixed(5));
for (let i = 0; i < 4; i++) await scoop(at(0.4, 1.2), at(-0.8, 1.2));
const hole = await rel(at(0.4, 1.2)), heap = await rel(at(-0.8, 1.2));
check('scoop after scoop: a round hole, and a heap where they were dropped', hole < -0.12 && heap > 0.1, Math.round(hole * 100) + ' cm, +' + Math.round(heap * 100) + ' cm');
// the flat of the blade (right-drag): pushed through the heap from beside it, the heap is bulldozed along
{
  const h0 = await rel(at(-0.8, 1.2)), A0 = at(-0.8, 0.45), B0 = at(-0.8, 2.0), a = await scr(A0.x, A0.z), b = await scr(B0.x, B0.z);
  await page.mouse.move(a.x, a.y); await wait(150); await page.mouse.down({ button: 'right' });
  await page.mouse.move(b.x, b.y, { steps: 16 }); await wait(600); await page.mouse.up({ button: 'right' }); await wait(300); await landed();
  const h1 = await rel(at(-0.8, 1.2)), l = await L(), air = await G(() => Object.values(__game.sim.state.sys.landscape.air || {}).reduce((x, y) => x + y, 0));
  check('right-drag pushes the heap along with the flat of the blade; nothing lost', h1 < h0 - 0.05 && Math.abs(l.net + air) < 2e-4, Math.round(h0 * 100) + ' -> ' + Math.round(h1 * 100) + ' cm');
  check('the right button did not turn the view while pushing', Math.abs((await G(() => __game.cam.yaw)) - P.yaw) < 1e-6);
}
const airNow = () => G(() => Object.values(__game.sim.state.sys.landscape.air || {}).reduce((a, b) => a + b, 0));
const net0 = (await L()).net + (await airNow());
await dig1(at(0.4, 1.2));
{ const l = await L(), air = await G(() => Object.values(__game.sim.state.sys.landscape.air || {}).reduce((a, b) => a + b, 0)); check('a plain click digs and drops it beside the hole (earth on the ground or still in the air: none lost)', l.carry === 0 && Math.abs(l.net + air - net0) < 2e-4, JSON.stringify({ c: l.carry, d: l.net - net0, air })); }
check('the shaped ground is drawn and the terrain lets it through', await G(() => __landscape.tiles() > 0));
// a path, put in properly: skim, tamp, fabric, gravel
await landed();
await hold('sod'); await drag(at(1.0, 0.6), at(1.0, 1.8), 12, 300);
check('the turf cutter strips the turf', (await ground(at(1.0, 1.2)))?.s === 'soil');
await hold('tamper'); await drag(at(1.0, 0.7), at(1.0, 1.7), 10, 900);
check('the tamper firms it', ((await ground(at(1.0, 0.7))) || {}).tamped >= 1 || ((await ground(at(1.0, 1.7))) || {}).tamped >= 1);
await hold('fabric'); await drag(at(1.0, 0.7), at(1.0, 1.7), 16, 900);
check('fabric rolled over the dug-out path', !!(await ground(at(1.0, 1.2)))?.fabric);
await hold('gravel'); await drag(at(1.0, 0.7), at(1.0, 1.7), 20, 1500);
const gp = await ground(at(1.0, 1.2));
check('gravel laid on the fabric', gp && gp.s === 'gravel' && gp.fabric, JSON.stringify(gp));
// stone: a cobbled band, a cut-stone wall with a capstone
await hold('cobble'); await drag(at(0.75, 0.4), at(0.75, 1.4), 14);
const cob = await G(() => Object.values(__game.sim.state.sys.landscape.things).filter((o) => o.k === 'cobble').length);
check('dragging lays cobblestones in a band', cob >= 20, cob + ' setts');
await hold('cutstone'); await drag(at(1.45, 0.9), at(1.45, 1.75), 8); await drag(at(1.45, 0.9), at(1.45, 1.75), 8);
await hold('capstone'); await click(at(1.45, 1.3));
const wall = await G(() => { const t = __game.sim.state.sys.landscape.things; const c = (o) => { let n = 1; while (o.on && t[o.on]) { o = t[o.on]; n++; } return n; }; return Math.max(0, ...Object.values(t).map(c)); });
check('cut stone stacks into a wall with a capstone on top', wall >= 3, wall + ' courses');
if (shots) { await G(() => { __game.cam.dist = 7; }); await wait(1500); await page.screenshot({ path: shots + '/yard.png' }); }
const before = await L();
await G(() => __game.saveGame()); await t.reload();
const after = await L();
check('the yard survives a save and reload', after.tiles === before.tiles && after.things === before.things && after.plants === before.plants, JSON.stringify(after));
check('and is drawn again', await G(() => __landscape.tiles() > 0));

await t.finish();
