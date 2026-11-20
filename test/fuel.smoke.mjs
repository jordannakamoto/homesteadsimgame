// Browser smoke test of fuel and the phone drive layout (V6, V9): node test/fuel.smoke.mjs  (needs dist/index.html and Playwright)
// Hold R beside the ATV with the can and gasoline: it fills at the can's rate out of stock; a delivery tops the tank up unless
// the setting is off; a nearly dry tank sputters and then stops, and the HUD chip says so; seated, the touch layout shows the
// drive buttons, and with a trailer hitched Tip bed and Unhitch appear and work.
import { openPage } from './helpers/page.mjs';
const T = await openPage();
const { page, check, G } = T;
await T.load(); await T.frames(40);
const id = await G(() => Object.keys(__game.sim.state.sys.vehicles.units).find((k) => __game.sim.state.sys.vehicles.units[k].kind === 'atv'));
const unit = (id) => G((id) => { const sim = __game.sim, u = sim.state.sys.vehicles.units[id]; return { f: u.fuelL, g: sim.state.sys.stock.items.gasoline || 0, imb: sim.systems.find((q) => q.name === 'vehicles').api.fuelImbalance(sim.state.sys.vehicles), body: __vehicles.body(id).fuelL }; }, id);
const setFuel = (id, l) => G(({ id, l }) => { const v = __game.sim.state.sys.vehicles, u = v.units[id]; v.totals.fuelBurnedL += u.fuelL - l; u.fuelL = l; }, { id, l });

// stand beside it on foot
await G((id) => { const u = __vehicles.unit(id), P = __game.player; P.x = u.x + 1.3; P.z = u.z; P.y = __game.groundAt(P.x, P.z, P.y + 2); __game.cam.yaw = 0; }, id);
await setFuel(id, 5); await T.frames(10);
await G(() => { const st = __game.sim.state.sys.stock; st.items.gasoline = 30; st.tools = st.tools.filter((t) => t !== 'fuel_can'); });
const f0 = await unit(id);
await page.keyboard.down('KeyR'); await T.frames(60); await page.keyboard.up('KeyR'); await T.frames(5);
const nocan = await unit(id);
check('without a can, holding R pours nothing', nocan.f === f0.f, JSON.stringify({ f0, nocan }));
await G(() => __game.sim.state.sys.stock.tools.push('fuel_can'));
await page.keyboard.down('KeyR'); await T.frames(150); await page.keyboard.up('KeyR'); await T.frames(5);   // 2.5 s of game time at 60 fps
const f1 = await unit(id);
const got = f1.f - f0.f;
check('holding R beside it pours at about 0.4 L a second, out of stock, books balanced, tank shown', got > 0.6 && got < 1.4 && Math.abs((f0.g - f1.g) - got) < 1e-3 && Math.abs(f1.imb) < 1e-6 && Math.abs(f1.body - f1.f) < 1e-3, JSON.stringify({ f0, f1 }));
await G(() => { __game.sim.state.sys.stock.items.gasoline = 0.2; }); await setFuel(id, 5);
await page.keyboard.down('KeyR'); await T.frames(120); await page.keyboard.up('KeyR');
const f2 = await unit(id);
check('a dry stock stops the pour at what there is', f2.f > 5 && f2.f <= 5.2 + 1e-6 && f2.g < 1e-6 && Math.abs(f2.imb) < 1e-6, JSON.stringify(f2));

// a delivery tops the tank up, unless the setting is off
await setFuel(id, 2);
await G(() => { const st = __game.sim.state.sys.stock; st.money = 20000; __game.sim.commandNow('construction.setDropPoint', { x: 8, z: 8 }); });
await G(() => { __game.sim.listeners.forEach((fn) => fn('construction.delivered', {}, __game.sim.state)); });
await T.frames(10);
const t1 = await unit(id);
check('a delivery tops the tank up', Math.abs(t1.f - 14.8) < 1e-6 && Math.abs(t1.imb) < 1e-6, JSON.stringify(t1));
await G(() => __vehicles.topUp(false)); await setFuel(id, 2);
await G(() => { __game.sim.listeners.forEach((fn) => fn('construction.delivered', {}, __game.sim.state)); }); await T.frames(10);
check('with the setting off it does not', (await unit(id)).f === 2 && !(await G(() => __vehicles.topUpOn())));
await G(() => __vehicles.topUp(true));

// the phone layout with a trailer hitched
await G((id) => __vehicles.mount(id), id); await T.frames(40);
await G(() => __touch.enable()); await T.frames(12); await page.waitForFunction(() => document.getElementById('tuse').hidden, null, { timeout: 30000 }).catch(() => {});   // the touch layout runs on real animation frames
const lay = () => G(() => { const v = (i) => { const e = document.getElementById(i); return !e.hidden && getComputedStyle(e).display !== 'none'; }; return { mode: document.getElementById('touchui').dataset.mode, brake: v('tbrake'), off: v('toff'), use: v('tuse'), unhitch: v('tunhitch'), label: document.getElementById('tuse').textContent }; });
const bare = await lay();
check('seated on a bare ATV: Brake and Off only', bare.mode === 'drive' && bare.brake && bare.off && !bare.use && !bare.unhitch, JSON.stringify(bare));
await G((id) => {
  const sim = __game.sim, K = __vehicles.kinds(), a = sim.state.sys.vehicles.units[id], ball = K.atv.points.find((q) => q.type === 'ball').at[2];
  const r = sim.commandNow('vehicles.add', { kind: 'trailer_small', x: a.x - Math.sin(a.yaw) * (-ball + 1.65), z: a.z - Math.cos(a.yaw) * (-ball + 1.65), yaw: a.yaw });
  return sim.commandNow('vehicles.hitch', { id, to: r.id });
}, id).then((r) => console.log('hitch', JSON.stringify(r)));
await T.frames(30); await page.waitForFunction(() => !document.getElementById('tunhitch').hidden, null, { timeout: 30000 }).catch(() => {});
const hit = await lay();
check('with a trailer hitched: Tip bed and Unhitch show', hit.use && hit.unhitch && /Tip/.test(hit.label), JSON.stringify({ hit, st: await G(() => __vehicles.status()) }));
await G(() => { __vehicles.unhitch(); }); await T.frames(5);
const stillMoving = await G(() => Math.abs(__vehicles.body(__vehicles.driven()).speed));
// tap the Unhitch button (stopped): it lets go
await page.evaluate(() => { const b = document.getElementById('tunhitch'); b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })); });
await T.frames(10);
check('the Unhitch button lets the trailer go (or it already went)', await G((id) => !__game.sim.state.sys.vehicles.units[id].towing, id), 'speed ' + stillMoving.toFixed(2));
await page.evaluate(() => { const b = document.getElementById('toff'); b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, bubbles: true })); });
await T.frames(200);
check('the Off button steps off', await G(() => __game.control.top().id === 'walk'));

// sputter and stop, with the chip
await G((id) => __vehicles.mount(id), id); await T.frames(40);
await setFuel(id, 0.02); await G((id) => { __vehicles.unit(id); __game.cam.yaw = __vehicles.body(id).yaw + Math.PI; }, id);
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');   // round in a circle, clear of trees
await T.frames(40);
await page.waitForTimeout(300);
const sp = await G(() => ({ st: __vehicles.status(), chip: document.getElementById('veh').innerText.replace(/\s+/g, ' ') }));
check('a nearly dry tank warns on the chip', sp.st.warn === 'Fuel low' || sp.st.warn === 'Out of fuel', JSON.stringify(sp));
await T.frames(2400);
const dry = await G((id) => ({ st: __vehicles.status(), fuel: __game.sim.state.sys.vehicles.units[id].fuelL, b: __vehicles.body(id) }), id);
await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
check('out of fuel the engine stops and it rolls to a halt', dry.st.warn === 'Out of fuel' && dry.b.fuelL === 0 && Math.abs(dry.b.speed) < 1, JSON.stringify({ w: dry.st.warn, s: dry.b.speed, f: dry.b.fuelL }));

await T.finish();
