// Convex polygon solids, independent of renderer/physics. Cut faces remain closed.
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function rotate(p, q) {
  const u = [q.x, q.y, q.z],
    t = cross(u, p).map((v) => 2 * v),
    v = cross(u, t);
  return p.map((x, i) => x + q.w * t[i] + v[i]);
}
export const inverse = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function carrotSolid() {
  const rings = [
    [-0.42, 0.12],
    [0.42, 0.025],
  ].map(([x, r]) =>
    Array.from({ length: 8 }, (_, i) => [
      x,
      Math.cos((i * Math.PI) / 4) * r,
      Math.sin((i * Math.PI) / 4) * r,
    ]),
  );
  const faces = [rings[0].slice().reverse(), rings[1]];
  for (let i = 0; i < 8; i++)
    faces.push([
      rings[0][i],
      rings[0][(i + 1) % 8],
      rings[1][(i + 1) % 8],
      rings[1][i],
    ]);
  return faces;
}
export function volume(faces) {
  // Absolute tetrahedra about an interior point, independent of winding.
  const all = faces.flat(),
    center = [0, 1, 2].map(
      (i) => all.reduce((s, p) => s + p[i], 0) / all.length,
    );
  let v = 0;
  for (const f of faces)
    for (let i = 1; i < f.length - 1; i++)
      v +=
        Math.abs(
          dot(
            sub(f[0], center),
            cross(sub(f[i], center), sub(f[i + 1], center)),
          ),
        ) / 6;
  return v;
}
function clip(faces, n, d) {
  const out = [],
    cap = [];
  for (const face of faces) {
    const poly = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        da = dot(a, n) - d,
        db = dot(b, n) - d;
      if (da <= 1e-8) poly.push(a.slice());
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const p = a.map((x, j) => x + ((b[j] - x) * da) / (da - db));
        poly.push(p);
        cap.push(p);
      }
    }
    if (poly.length >= 3) out.push(poly);
  }
  const unique = cap.filter(
    (p, i) => !cap.slice(0, i).some((q) => Math.hypot(...sub(p, q)) < 1e-6),
  );
  if (unique.length >= 3) {
    const center = [0, 1, 2].map(
      (i) => unique.reduce((s, p) => s + p[i], 0) / unique.length,
    );
    let u = cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const len = Math.hypot(...u);
    u = u.map((x) => x / len);
    const v = cross(n, u);
    unique.sort(
      (a, b) =>
        Math.atan2(dot(sub(a, center), v), dot(sub(a, center), u)) -
        Math.atan2(dot(sub(b, center), v), dot(sub(b, center), u)),
    );
    out.push(unique);
  }
  return out;
}
export function splitSolid(faces, n, d) {
  const a = clip(faces, n, d),
    b = clip(
      faces,
      n.map((v) => -v),
      -d,
    );
  if (volume(a) < 0.00003 || volume(b) < 0.00003) return null;
  return [a, b];
}
export function centerSolid(faces) {
  const points = faces.flat(),
    center = [0, 1, 2].map(
      (i) => points.reduce((s, p) => s + p[i], 0) / points.length,
    );
  return { center, faces: faces.map((f) => f.map((p) => sub(p, center))) };
}
