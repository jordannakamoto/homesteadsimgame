// Save files. A save is one JSON document: the simulation state plus the parts of the world
// the engine owns (terrain edits, felled trees, stock, where the player stood).
// Bump SAVE_VERSION and add a step to MIGRATIONS whenever the shape changes; old saves must keep loading.

import { STATE_VERSION } from './sim.js';
import { packReplacer, unpackReviver, unpackAll } from './core/earthwork-codec.js';
import { makeGround, importTile } from './core/ground.js';

export const SAVE_VERSION = 3;
export const FORMAT = 'homestead-save';

// MIGRATIONS[n] upgrades a save from version n to n + 1.
const MIGRATIONS = {
  // v2 packs earthwork grids (core/earthwork-codec.js). The shape in memory is unchanged and readSave unpacks either
  // form, so a v1 save needs nothing more.
  1: (save) => save,
  // v3: the engine's terrain height edits (world.edits, Float32 metres per 32 m tile, base64) become the ground
  // system's macro grid (sim.sys.ground.macro, whole millimetres). The engine now only mirrors it.
  2: (save) => {
    const edits = (save.world && save.world.edits) || {};
    if (save.sim && save.sim.sys) {
      const G = save.sim.sys.ground && save.sim.sys.ground.macro ? save.sim.sys.ground : { ...makeGround(), totals: { cutM3: 0, fillM3: 0 }, pending: [] };
      for (const k in edits) { const m = base64ToF32(edits[k]); if (m.length === G.macro.T * G.macro.T) importTile(G, k, m); }
      save.sim.sys.ground = G;
    }
    if (save.world) delete save.world.edits;
    return save;
  },
};

export function makeSave(simState, world = {}) {
  return { format: FORMAT, v: SAVE_VERSION, sim: simState, world };
}

// The text a save is stored as: every earthwork grid in it packed (about 17 KB to about 1 KB a tile).
export function stringifySave(save) { return JSON.stringify(save, packReplacer); }

export function readSave(raw) {
  let save = typeof raw === 'string' ? JSON.parse(raw, unpackReviver) : unpackAll(raw);
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
