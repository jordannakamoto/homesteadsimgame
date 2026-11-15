// Save files. A save is one JSON document: the simulation state plus the parts of the world
// the engine owns (terrain edits, felled trees, stock, where the player stood).
// Bump SAVE_VERSION and add a step to MIGRATIONS whenever the shape changes; old saves must keep loading.

import { STATE_VERSION } from './sim.js';

export const SAVE_VERSION = 1;
export const FORMAT = 'homestead-save';

// MIGRATIONS[n] upgrades a save from version n to n + 1.
const MIGRATIONS = {};

export function makeSave(simState, world = {}) {
  return { format: FORMAT, v: SAVE_VERSION, sim: simState, world };
}

export function readSave(raw) {
  let save = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!save || save.format !== FORMAT) throw new Error('not a homestead save');
  if (save.v > SAVE_VERSION) throw new Error('save is from a newer version of the game');
  while (save.v < SAVE_VERSION) {
    const step = MIGRATIONS[save.v];
    if (!step) throw new Error('no migration from save version ' + save.v);
    save = step(save); save.v++;
  }
  if (!save.sim || save.sim.v > STATE_VERSION) throw new Error('save has an unknown simulation state');
  return save;
}

// Float32Array <-> base64, for terrain height edits. Works in the browser and in Node.
export function f32ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64ToF32(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
