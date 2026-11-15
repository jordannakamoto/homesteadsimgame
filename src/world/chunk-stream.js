// Nearest-first streaming with a square retention margin to avoid boundary thrash.
// Only the current center's pending loads are kept. The chunk map owns residency.
export function createChunkStream({ size, radius, chunks, key, load, unload, now }) {
  const offsets = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distance = dx * dx + dz * dz;
      if (distance <= (radius + 0.5) ** 2) offsets.push({ dx, dz, distance });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance);
  const retain = radius + 1;
  let centerX, centerZ, next = offsets.length;

  function update(x, z, budgetMs) {
    const cx = Math.floor(x / size), cz = Math.floor(z / size);
    const moved = cx !== centerX || cz !== centerZ;
    if (moved) {
      centerX = cx;
      centerZ = cz;
      next = 0;
    }

    if (next < offsets.length) {
      const deadline = now() + budgetMs;
      while (next < offsets.length) {
        const { dx, dz } = offsets[next];
        const tx = cx + dx, tz = cz + dz, id = key(tx, tz);
        if (chunks.has(id)) { next++; continue; }
        chunks.set(id, load(tx, tz));
        next++;
        if (now() > deadline) break;
      }
    }

    if (moved) {
      for (const [id, chunk] of chunks) {
        if (Math.abs(chunk.cx - cx) <= retain && Math.abs(chunk.cz - cz) <= retain) continue;
        unload(chunk);
        chunks.delete(id);
      }
    }
  }

  function reset() {
    for (const chunk of chunks.values()) unload(chunk);
    chunks.clear();
    centerX = centerZ = undefined;
    next = offsets.length;
  }

  return { update, reset };
}
