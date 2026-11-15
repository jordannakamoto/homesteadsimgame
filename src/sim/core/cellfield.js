// A field of cells: rectangular groups ("beds") of square cells laid on the ground, each cell carrying
// whatever per-cell state the caller supplies, plus brush operations that select swathes of cells.
// Generic: it knows nothing of what the cells hold. Plain JSON data, no allocation in the hot paths.
//
// field = { cellM, groups: { [id]: group }, nextId }
// group = { id, x0, z0, nx, nz, cells: [ cell ... ] }   x0, z0: the corner of cell (0, 0) in world metres;
//          cell (ix, iz) is cells[iz * nx + ix] and covers [x0 + ix * cellM, x0 + (ix + 1) * cellM) in x.
//
// A selection names cells: { group, cells: [index...] } | { group, ix, iz, w, h } | { rect: { x0, z0, x1, z1 } }
// | { x, z, r } (a round brush, world metres). resolve() turns any of them into [{ group, index }] lists.

export function makeField(cellM = 0.3) { return { cellM, groups: {}, nextId: 1 }; }

const snap = (v, c) => Math.round(v / c) * c;

// Snap a dragged rectangle to the cell grid. Returns { x0, z0, nx, nz } or null if smaller than one cell.
export function snapRect(field, r) {
  const c = field.cellM;
  const ax = Math.min(r.x0, r.x1), bx = Math.max(r.x0, r.x1), az = Math.min(r.z0, r.z1), bz = Math.max(r.z0, r.z1);
  const x0 = snap(ax, c), z0 = snap(az, c);
  const nx = Math.max(0, Math.round((bx - x0) / c)), nz = Math.max(0, Math.round((bz - z0) / c));
  if (nx < 1 || nz < 1) return null;
  return { x0: round(x0), z0: round(z0), nx, nz };
}
const round = (v) => Math.round(v * 1e6) / 1e6;

const overlaps = (a, b, c) => a.x0 < b.x0 + b.nx * c - 1e-6 && b.x0 < a.x0 + a.nx * c - 1e-6 && a.z0 < b.z0 + b.nz * c - 1e-6 && b.z0 < a.z0 + a.nz * c - 1e-6;

// Add a group of cells over a snapped rectangle. makeCell(ix, iz) gives each cell's initial state.
// Returns the group, or { error } when it would overlap another group or is too big.
export function addGroup(field, rect, makeCell, { id, maxCells = 4000 } = {}) {
  const r = rect.nx ? rect : snapRect(field, rect);
  if (!r) return { error: 'too small' };
  if (r.nx * r.nz > maxCells) return { error: 'too big' };
  for (const g of Object.values(field.groups)) if (overlaps(r, g, field.cellM)) return { error: 'overlaps', other: g.id };
  const gid = id || 'b' + field.nextId++;
  if (field.groups[gid]) return { error: 'id taken' };
  const cells = new Array(r.nx * r.nz);
  for (let iz = 0; iz < r.nz; iz++) for (let ix = 0; ix < r.nx; ix++) cells[iz * r.nx + ix] = makeCell(ix, iz);
  const g = { id: gid, x0: r.x0, z0: r.z0, nx: r.nx, nz: r.nz, cells };
  field.groups[gid] = g;
  return g;
}
export function removeGroup(field, id) { const g = field.groups[id]; delete field.groups[id]; return g || null; }

// Geometry
export const cellCentre = (field, g, i) => ({ x: g.x0 + ((i % g.nx) + 0.5) * field.cellM, z: g.z0 + (Math.floor(i / g.nx) + 0.5) * field.cellM });
export function cellAt(field, x, z) {
  const c = field.cellM;
  for (const g of Object.values(field.groups)) {
    const ix = Math.floor((x - g.x0) / c), iz = Math.floor((z - g.z0) / c);
    if (ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz) return { group: g, index: iz * g.nx + ix, ix, iz };
  }
  return null;
}
export const groupArea = (field, g) => g.nx * g.nz * field.cellM * field.cellM;

// The cells of a w x h block anchored at (ix, iz), or null if it leaves the group.
export function block(g, ix, iz, w, h = w) {
  if (ix < 0 || iz < 0 || ix + w > g.nx || iz + h > g.nz) return null;
  const out = [];
  for (let z = iz; z < iz + h; z++) for (let x = ix; x < ix + w; x++) out.push(z * g.nx + x);
  return out;
}

// Turn a selection into [{ group, index }]. Cells come back in a stable order (group, then row, then column).
export function resolve(field, sel) {
  const out = [];
  if (!sel) return out;
  const c = field.cellM;
  if (sel.group != null || sel.bed != null) {
    const g = field.groups[sel.group ?? sel.bed];
    if (!g) return out;
    if (Array.isArray(sel.cells)) { for (const i of sel.cells) if (i >= 0 && i < g.cells.length && Number.isInteger(i)) out.push({ group: g, index: i }); return out; }
    if (sel.ix != null) { const b = block(g, sel.ix, sel.iz, sel.w || 1, sel.h || sel.w || 1); if (b) for (const i of b) out.push({ group: g, index: i }); return out; }
    for (let i = 0; i < g.cells.length; i++) out.push({ group: g, index: i });
    return out;
  }
  for (const g of Object.values(field.groups)) {
    for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
      const cx = g.x0 + (ix + 0.5) * c, cz = g.z0 + (iz + 0.5) * c;
      let hit = false;
      if (sel.rect) {
        const r = sel.rect;
        hit = cx >= Math.min(r.x0, r.x1) && cx <= Math.max(r.x0, r.x1) && cz >= Math.min(r.z0, r.z1) && cz <= Math.max(r.z0, r.z1);
      } else if (sel.r != null) hit = (cx - sel.x) ** 2 + (cz - sel.z) ** 2 <= sel.r * sel.r;
      if (hit) out.push({ group: g, index: iz * g.nx + ix });
    }
  }
  return out;
}

// Apply fn(cell, group, index) to every selected cell. Returns how many were touched.
export function brush(field, sel, fn) {
  const list = resolve(field, sel);
  for (const { group, index } of list) fn(group.cells[index], group, index);
  return list.length;
}
