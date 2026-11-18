// The controller stack (src/engine/control.js): idle it changes nothing; possessions, modifiers and camera requests compose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControl } from '../src/engine/control.js';

const make = () => {
  const player = { x: 3, y: 1, z: -2, pace: 0, carryK: 0, standY: null, climbY: null, lead: null, faceHold: null };
  const cam = { yaw: 0.6, pitch: 0.95, dist: 24 };
  const keys = {}, mouse = { left: false, right: false };
  return { player, cam, keys, mouse, c: createControl({ player, cam, keys, mouse }) };
};

test('idle: walk on top, nothing written, camera untouched', () => {
  const { player, cam, c } = make();
  const before = { ...player }, camBefore = { ...cam };
  for (let i = 0; i < 60; i++) {
    c.compose();
    assert.equal(c.possess(1 / 60), false);
    assert.equal(c.camera(1 / 60, {}), false);
    const f = c.follow();
    assert.equal(f.x, player.x); assert.equal(f.y, player.y); assert.equal(f.z, player.z);
  }
  assert.deepEqual(player, before);
  assert.deepEqual(cam, camBefore);
  assert.equal(c.top().id, 'walk');
  assert.equal(c.rig.distK, 1);
  assert.equal(c.rig.pitch(0.95), 0.95);
  assert.equal(c.rig.fov(40), 40);
  assert.deepEqual(c.canTake('seat'), { ok: true });
});

test('possession runs instead of walking, gets camera-relative input, pops back to walk', () => {
  const { keys, c } = make();
  let ran = 0, got = null, exited = null;
  const h = c.push({ id: 'seat', update: (dt, inp) => { ran++; got = { ...inp }; }, onExit: (r) => { exited = r; } });
  keys.KeyW = true;
  assert.equal(c.possess(1 / 60), true);
  assert.equal(ran, 1);
  assert.equal(got.iz, 1);
  assert.ok(Math.abs(Math.hypot(got.mx, got.mz) - 1) < 1e-9);
  assert.equal(c.is('seat'), true);
  assert.equal(c.canTake('seat').ok, false);
  c.pop(h, 'off');
  assert.equal(exited, 'off');
  assert.equal(c.walking(), true);
  assert.equal(c.pop(c.top()), false, 'walk cannot be popped');
});

test('guards refuse a takeover with a reason', () => {
  const { c } = make();
  let busy = true;
  c.guards.push(() => (busy ? 'arms full' : null));
  assert.deepEqual(c.canTake('seat'), { ok: false, reason: 'arms full' });
  busy = false;
  assert.equal(c.canTake('seat').ok, true);
});

test('modifiers: pace multiplies, standY last set wins, released fields return to neutral, unowned fields untouched', () => {
  const { player, c } = make();
  player.faceHold = 1.25;                                  // written by un-migrated code: must survive
  c.mod('roof', { pace: 0.5, standY: 2 });
  c.mod('load', { pace: 0.8, standY: 3 });
  c.compose();
  assert.ok(Math.abs(player.pace - 0.4) < 1e-12);
  assert.equal(player.standY, 3);
  assert.equal(player.faceHold, 1.25);
  c.mod('load', null);
  c.compose();
  assert.equal(player.pace, 0.5); assert.equal(player.standY, 2);
  c.mod('roof', null);
  c.compose();
  assert.equal(player.pace, 0); assert.equal(player.standY, null);
  assert.equal(player.faceHold, 1.25);
});

test('camera requests ease in, the player can take a number back, release restores the rest', () => {
  const { cam, c } = make();
  c.camera(1 / 60, {});
  c.cam.request('hands', { dist: 8, pitch: 1.1, k: 5 });
  for (let i = 0; i < 300; i++) c.camera(1 / 60, {});
  assert.ok(Math.abs(cam.dist - 8) < 1e-3); assert.ok(Math.abs(cam.pitch - 1.1) < 1e-3);
  cam.pitch = 0.7;                                         // the mouse moved it
  for (let i = 0; i < 10; i++) c.camera(1 / 60, {});
  assert.equal(cam.pitch, 0.7);
  c.cam.request('hands', null);
  for (let i = 0; i < 300; i++) c.camera(1 / 60, {});
  assert.equal(cam.dist, 24);
  assert.equal(cam.pitch, 0.7, 'the pitch the player chose is kept');
  cam.dist = 30;                                           // the wheel, with nothing requested: the rig just tracks it
  c.camera(1 / 60, {});
  assert.equal(cam.dist, 30); assert.equal(c.cam.user.dist, 30);
});

test('possession camera wants and follow with look-ahead', () => {
  const { c } = make();
  const h = c.push({ id: 'seat', update() {}, follow: (o) => { o.x = 10; o.y = 0; o.z = 0; o.vx = 5; o.vz = 0; return o; }, cam: { distK: 1.3, leadS: 0.4 } });
  for (let i = 0; i < 600; i++) { c.camera(1 / 60, {}); c.follow(); }
  assert.ok(Math.abs(c.rig.distK - 1.3) < 1e-3);
  assert.ok(Math.abs(c.follow().x - 12) < 1e-2);
  c.pop(h);
  for (let i = 0; i < 900; i++) { c.camera(1 / 60, {}); c.follow(); }
  assert.equal(c.rig.distK, 1);
  assert.equal(c.rig.lx, 0);
});
