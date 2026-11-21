// The lie of untouched snow: a small tiling height texture (12.8 m, 2.5 cm a texel) the surface adds to its depth.
// r: mounds, where the snow pillows over what it buried (a tuft, a stone, a hummock): low domes 40 cm to over a
// metre across, some run together. g: small clumps, what falls from the crowns (the shader lays these thick under
// trees and thin in the open). Drawn once on the CPU, wrapped at the edges, mipped.
export function createLumps(T) {
  const N = 512, M = 12.8, px = M / N, d = new Uint8Array(N * N * 4), r = new Float32Array(N * N), g = new Float32Array(N * N);
  let seed = 90210;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // a soft dome, wrapped; kept by the higher of what is there (domes merge, they do not stack)
  function dome(a, x, z, rx, rz, yaw, h, flat) {
    const R = Math.max(rx, rz), c = Math.cos(yaw), s = Math.sin(yaw);
    const i0 = Math.floor((x - R) / px), i1 = Math.ceil((x + R) / px), j0 = Math.floor((z - R) / px), j1 = Math.ceil((z + R) / px);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i * px - x, dz = j * px - z, u = (dx * c + dz * s) / rx, v = (-dx * s + dz * c) / rz, q = u * u + v * v;
      if (q >= 1) continue;
      const k = 1 - q, val = h * Math.min(1, Math.pow(k, flat) * (1 + flat * 0.3));
      const n = (((j % N) + N) % N) * N + (((i % N) + N) % N);
      if (val > a[n]) a[n] = val;
    }
  }
  for (let n = 0; n < 46; n++) {
    const x = rnd() * M, z = rnd() * M, rx = 0.22 + rnd() * 0.42, h = 0.35 + rnd() * 0.65, yaw = rnd() * 6.283;
    dome(r, x, z, rx, rx * (0.6 + rnd() * 0.5), yaw, h, 1.6);
    // every third has a smaller one against it
    if (n % 3 === 0) { const a = rnd() * 6.283, d2 = rx * (0.6 + rnd() * 0.5); dome(r, x + Math.cos(a) * d2, z + Math.sin(a) * d2, rx * 0.6, rx * 0.5, rnd() * 6.283, h * (0.5 + rnd() * 0.4), 1.6); }
  }
  for (let n = 0; n < 420; n++) {
    const rx = 0.05 + rnd() * rnd() * 0.12;
    dome(g, rnd() * M, rnd() * M, rx, rx * (0.7 + rnd() * 0.4), rnd() * 6.283, 0.3 + rnd() * 0.7, 0.9);
  }
  for (let n = 0; n < N * N; n++) { d[n * 4] = Math.round(r[n] * 255); d[n * 4 + 1] = Math.round(g[n] * 255); d[n * 4 + 3] = 255; }
  const tex = new T.DataTexture(d, N, N, T.RGBAFormat, T.UnsignedByteType);
  tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
