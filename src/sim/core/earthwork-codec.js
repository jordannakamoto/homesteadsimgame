// Compact encoding of earthwork-format grids for save files. Generic: it knows the grid format of core/earthwork.js
// (any step and tile size), nothing of what the grid stands for.
//
// In memory a grid is { step, T, codes, tiles: { 'tx,tz': { h, s, l, f, t } }, rev } with five plain arrays of T*T
// integers per tile: about 17 KB a tile as JSON. Packed, each tile is one base64 string:
//   byte 1 (format), then five channels h, s, l, f, t, each as varint byteLength + payload.
//   h: the difference from the previous point in row order, as a zigzag varint; a run of equal points (difference 0)
//      is written as the token 0 followed by a varint run length. Smooth ground is about a byte a point, flat ground
//      a few bytes a row.
//   s, l, f, t: run-length pairs (zigzag varint value, varint run).
// Tiles with every channel zero are dropped (they read the same as no tile). A tile holding anything but safe
// integers is kept as it is (plain arrays), so a round trip is always exact.
//
// packReplacer / unpackReviver plug into JSON.stringify / JSON.parse, so any earthwork grid anywhere in a save is
// packed and unpacked with no code that knows where grids live. The in-memory shape never changes.

export const ENC = 'ew1';
const FORMAT_BYTE = 1;
const CH = ['h', 's', 'l', 'f', 't'];

export function isGrid(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && v.enc === undefined && typeof v.step === 'number' && typeof v.T === 'number'
    && Array.isArray(v.codes) && !!v.tiles && typeof v.tiles === 'object';
}
export const isPacked = (v) => !!v && typeof v === 'object' && v.enc === ENC && !!v.tiles;

// ------------------------------------------------------------------------------------------------ bytes
let buf = new Uint8Array(1 << 16), len = 0;
function put(b) {
  if (len >= buf.length) { const nb = new Uint8Array(buf.length * 2); nb.set(buf); buf = nb; }
  buf[len++] = b;
}
// unsigned varint, any safe integer (arithmetic, not bit operations, so values above 2^31 survive)
function uv(v) { while (v >= 128) { put((v % 128) + 128); v = Math.floor(v / 128); } put(v); }
const zz = (v) => (v >= 0 ? v * 2 : -v * 2 - 1);
const unzz = (u) => (u % 2 === 0 ? u / 2 : -(u + 1) / 2);

function encH(a) {
  let prev = 0, run = 0;
  for (let n = 0; n < a.length; n++) {
    const d = a[n] - prev; prev = a[n];
    if (d === 0) { run++; continue; }
    if (run) { put(0); uv(run); run = 0; }
    uv(zz(d));
  }
  if (run) { put(0); uv(run); }
}
function encRle(a) {
  let n = 0;
  while (n < a.length) {
    const v = a[n]; let r = 1;
    while (n + r < a.length && a[n + r] === v) r++;
    uv(zz(v)); uv(r); n += r;
  }
}
// one channel written after its byte length (the length is not known until it is written, so write it to the end
// of the buffer, then move it up behind its length)
function channel(a, enc) {
  const start = len;
  enc(a);
  const body = buf.slice(start, len), n = body.length;
  len = start; uv(n);
  for (let k = 0; k < n; k++) put(body[k]);
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------------------------------------------ tiles
function packable(tile, N) {
  for (const c of CH) {
    const a = tile[c];
    if (!Array.isArray(a) || a.length !== N) return false;
    for (let n = 0; n < N; n++) if (!Number.isSafeInteger(a[n])) return false;
  }
  return true;
}
const allZero = (tile) => CH.every((c) => tile[c].every((v) => v === 0));

export function packTile(tile, N) {
  if (!packable(tile, N)) return { h: [...tile.h], s: [...tile.s], l: [...tile.l], f: [...tile.f], t: [...tile.t] };
  if (allZero(tile)) return null;
  len = 0; put(FORMAT_BYTE);
  channel(tile.h, encH);
  for (const c of CH.slice(1)) channel(tile[c], encRle);
  return toBase64(buf.subarray(0, len));
}
export function unpackTile(v, N) {
  if (typeof v !== 'string') return { h: [...v.h], s: [...v.s], l: [...v.l], f: [...v.f], t: [...v.t] };
  const b = fromBase64(v);
  let p = 0;
  const rd = () => { let r = 0, m = 1, x; do { x = b[p++]; r += (x % 128) * m; m *= 128; } while (x >= 128); return r; };
  if (b[p++] !== FORMAT_BYTE) throw new Error('unknown earthwork tile format');
  const out = {};
  for (const c of CH) {
    const n = rd(), end = p + n, a = new Array(N);
    let k = 0;
    if (c === 'h') {
      let prev = 0;
      while (p < end) {
        const u = rd();
        if (u === 0) { const r = rd(); for (let q = 0; q < r; q++) a[k++] = prev; }
        else { prev += unzz(u); a[k++] = prev; }
      }
    } else {
      while (p < end) { const v2 = unzz(rd()), r = rd(); for (let q = 0; q < r; q++) a[k++] = v2; }
    }
    if (k !== N || p !== end) throw new Error('earthwork tile is damaged');
    out[c] = a;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ grids
export function packGrid(g) {
  const N = g.T * g.T, tiles = {};
  for (const k in g.tiles) { const v = packTile(g.tiles[k], N); if (v !== null) tiles[k] = v; }
  const out = { enc: ENC };
  for (const k in g) if (k !== 'tiles') out[k] = g[k];      // step, T, codes, rev and anything else the owner keeps there
  out.tiles = tiles;
  return out;
}
export function unpackGrid(p) {
  const N = p.T * p.T, tiles = {}, out = {};
  for (const k in p.tiles) tiles[k] = unpackTile(p.tiles[k], N);
  for (const k in p) if (k !== 'tiles' && k !== 'enc') out[k] = p[k];
  out.tiles = tiles;
  return out;
}
export function packReplacer(key, value) { return isGrid(value) ? packGrid(value) : value; }
export function unpackReviver(key, value) { return isPacked(value) ? unpackGrid(value) : value; }
// Unpack every packed grid inside an already parsed value (in place where possible); returns the value.
export function unpackAll(v) {
  if (!v || typeof v !== 'object') return v;
  if (isPacked(v)) return unpackGrid(v);
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = unpackAll(v[i]); return v; }
  for (const k in v) v[k] = unpackAll(v[k]);
  return v;
}
