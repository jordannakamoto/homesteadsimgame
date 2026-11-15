import { INGREDIENTS } from '../sim/food-catalog.js';

// Low-poly models share geometry and materials. Rebuilding food groups creates
// transforms only; reset removes the old groups without allocating new GPU assets.
export function kitchenModels(T) {
  const box = new T.BoxGeometry(1, 1, 1);
  const sphere = new T.IcosahedronGeometry(1, 1);
  const cylinder = new T.CylinderGeometry(1, 1, 1, 12);
  const cone = new T.ConeGeometry(1, 1, 8);
  const ring = new T.TorusGeometry(1, 0.065, 5, 16);
  const materials = new Map();
  const steamMat = new T.MeshLambertMaterial({ color: 0xe3e8dc, transparent: true, opacity: 0.22, depthWrite: false });
  function material(color) {
    if (!materials.has(color)) materials.set(color, new T.MeshLambertMaterial({ color }));
    return materials.get(color);
  }
  function part(group, geometry, color, x, y, z, sx, sy, sz) {
    const mesh = new T.Mesh(geometry, material(color));
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  const block = (g, color, x, y, z, sx, sy, sz) => part(g, box, color, x, y, z, sx, sy, sz);
  const ball = (g, color, x, y, z, sx, sy, sz) => part(g, sphere, color, x, y, z, sx, sy, sz);
  function ingredient(id, chopped = false) {
    const group = new T.Group(), color = INGREDIENTS[id].color;
    if (chopped) {
      for (let i = 0; i < 7; i++) {
        const x = (i % 3 - 1) * 0.12, z = (Math.floor(i / 3) - 1) * 0.13;
        const piece = block(group, color, x, 0.045, z, 0.09, 0.07, 0.09);
        piece.rotation.y = i * 1.7;
      }
    } else if (id === 'carrot') {
      const root = part(group, cone, color, 0, 0.10, 0, 0.12, 0.48, 0.12);
      root.rotation.z = Math.PI / 2;
      for (let i = 0; i < 3; i++) block(group, 0x557d36, -0.29, 0.1, (i - 1) * 0.06, 0.15, 0.035, 0.03);
    } else if (id === 'fish') {
      ball(group, color, 0, 0.09, 0, 0.35, 0.09, 0.12);
      const tail = part(group, cone, 0x6e8f94, -0.37, 0.09, 0, 0.12, 0.18, 0.04);
      tail.rotation.z = Math.PI / 2;
      ball(group, 0x222a27, 0.24, 0.15, 0.07, 0.018, 0.018, 0.018);
      block(group, 0xbeb9a6, 0.03, 0.155, 0, 0.35, 0.025, 0.04);
    } else if (id === 'parsley' || id === 'thyme') {
      for (let i = 0; i < 5; i++) {
        block(group, 0x718147, (i - 2) * 0.04, 0.025, 0, 0.016, 0.025, 0.4);
        ball(group, color, (i - 2) * 0.065, 0.08, -0.1, 0.08, 0.05, 0.12);
      }
    } else if (id === 'milk' || id === 'water_food' || id === 'oil_food') {
      part(group, cylinder, color, 0, 0.19, 0, 0.14, 0.36, 0.14);
      part(group, cylinder, color, 0, 0.4, 0, 0.08, 0.09, 0.08);
      const handle = part(group, ring, 0x6d7f77, 0.16, 0.23, 0, 0.11, 0.15, 0.11);
      handle.rotation.y = 0;
      block(group, 0xede3c9, 0, 0.2, 0.143, 0.12, 0.12, 0.01);
    } else if (id === 'flour' || id === 'baking_powder') {
      block(group, color, 0, 0.18, 0, 0.27, 0.34, 0.21);
      block(group, 0x667b66, 0, 0.18, 0.11, 0.17, 0.13, 0.01);
      block(group, 0xc4b18c, 0, 0.36, 0, 0.25, 0.035, 0.09);
    } else {
      ball(group, color, 0, 0.14, 0, id === 'egg' ? 0.10 : 0.19, id === 'egg' ? 0.15 : 0.14, 0.14);
      if (id === 'tomato' || id === 'onion') {
        part(group, cone, id === 'tomato' ? 0x4c7139 : 0x90764d, 0, 0.3, 0, 0.07, 0.1, 0.07);
      }
      if (id === 'potato') for (let i = 0; i < 3; i++) ball(group, 0x8b7448, (i - 1) * 0.07, 0.25, 0.035, 0.015, 0.01, 0.013);
    }
    return group;
  }
  function vessel(kind) {
    const group = new T.Group(), metal = kind === 'bowl' ? 0xc5bda8 : 0x424c4b;
    if (kind === 'tray') {
      block(group, metal, 0, 0.03, 0, 0.95, 0.05, 0.7);
      for (const z of [-0.36, 0.36]) block(group, metal, 0, 0.09, z, 1, 0.13, 0.04);
      for (const x of [-0.49, 0.49]) block(group, metal, x, 0.09, 0, 0.04, 0.13, 0.7);
    } else {
      const radius = kind === 'pot' ? 0.39 : 0.4, height = kind === 'pot' ? 0.38 : kind === 'bowl' ? 0.22 : 0.07;
      part(group, cylinder, metal, 0, height / 2, 0, radius, height, radius);
      part(group, cylinder, 0x252f2d, 0, height + 0.004, 0, radius * 0.88, 0.01, radius * 0.88);
      const rim = part(group, ring, kind === 'bowl' ? 0xe6dcc3 : 0x8b9590, 0, height, 0, radius, radius, radius);
      rim.rotation.x = Math.PI / 2;
      if (kind === 'pan') block(group, 0x554433, 0.64, 0.07, 0, 0.55, 0.07, 0.1);
      if (kind === 'pot') for (const x of [-0.48, 0.48]) block(group, metal, x, 0.29, 0, 0.2, 0.06, 0.12);
    }
    return group;
  }
  function kitchen(kind) {
    const group = new T.Group();
    block(group, 0x876643, 0, 0.86, 0, 5.7, 0.14, 2.35);
    const legs = [];
    for (const x of [-2.55, 2.55]) for (const z of [-0.95, 0.95]) legs.push(block(group, 0x5b4936, x, 0.42, z, 0.14, 0.84, 0.14));
    block(group, 0x70563c, 0, 0.25, 0, 5.4, 0.1, 1.8);
    block(group, 0x70563c, 0, 1.28, -0.9, 5.4, 0.08, 0.5);
    for (const x of [-2.5, 2.5]) block(group, 0x5b4936, x, 1.1, -0.9, 0.1, 0.32, 0.1);
    for (let i = 0; i < 7; i++) block(group, 0x94714c, -2.4 + i * 0.8, 1.33, -0.9, 0.7, 0.02, 0.45);
    block(group, 0xb8925e, -1.65, 0.97, 0.27, 1.15, 0.08, 0.85);
    const knife = new T.Group();
    block(knife, 0xaebbb5, 0, 0, 0, 0.42, 0.11, 0.025);
    block(knife, 0x4b3929, 0.31, 0, 0, 0.22, 0.08, 0.06);
    knife.position.set(-1.5, 1.05, 0.73); group.add(knife);
    const stove = new T.Group(); stove.position.set(1.75, 0.94, 0.12); group.add(stove);
    block(stove, kind === 'fire' ? 0x6a6557 : 0x4b5350, 0, 0.18, 0, 1.25, 0.35, 1.25);
    block(stove, 0x212a28, 0, 0.2, 0.635, 0.85, 0.21, 0.03);
    block(stove, 0xa29b83, 0, 0.31, 0.66, 0.5, 0.035, 0.05);
    for (let i = 0; i < 5; i++) block(stove, 0x222b28, -0.45 + i * 0.23, 0.39, 0, 0.035, 0.045, 1.08);
    const flame = new T.Group(); flame.position.set(1.75, 1.31, 0.12); group.add(flame);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      part(flame, cone, 0xe9a047, Math.cos(angle) * 0.22, 0.05, Math.sin(angle) * 0.22, 0.06, 0.17, 0.06);
    }
    flame.visible = false;
    const chopper = new T.Group(); chopper.position.set(-2.48, 1, 0.1); group.add(chopper);
    block(chopper, 0x728780, 0, 0.16, 0, 0.28, 0.28, 0.35);
    block(chopper, 0x413e32, 0, 0.35, 0, 0.38, 0.06, 0.1);
    chopper.visible = false;
    const steam = new T.Group(); steam.position.set(1.75, 1.8, 0.12); group.add(steam);
    for (let i = 0; i < 4; i++) {
      const puff = new T.Mesh(sphere, steamMat);
      puff.scale.setScalar(0.06); steam.add(puff);
    }
    steam.visible = false;
    return { group, knife, flame, chopper, legs, steam };
  }
  function cookedFood(recipe, progress = 0, burnt = false) {
    const group = new T.Group(), brown = burnt ? 0x332b25 : progress >= 1 ? 0xc68a44 : 0xe4ce91;
    if (recipe === 'soup') {
      part(group, cylinder, burnt ? 0x52422d : 0xb38044, 0, 0.39, 0, 0.33, 0.02, 0.33);
      for (let i = 0; i < 6; i++) block(group, i % 2 ? 0xd49a4f : 0x7e9851, Math.sin(i * 2) * 0.22, 0.41, Math.cos(i * 2) * 0.22, 0.07, 0.04, 0.07);
    } else if (recipe === 'eggs') {
      for (const x of [-0.14, 0.14]) {
        ball(group, burnt ? brown : 0xf3e9cd, x, 0.09, 0, 0.18, 0.026, 0.23);
        ball(group, 0xe8b444, x, 0.12, 0, 0.075, 0.045, 0.075);
      }
    } else if (recipe === 'pancakes') {
      part(group, cylinder, brown, 0, 0.09, 0, 0.31, 0.04, 0.31);
    } else if (recipe === 'bread') {
      ball(group, brown, 0, 0.14, 0, 0.36, 0.15 + progress * 0.06, 0.23);
      for (const x of [-0.13, 0, 0.13]) block(group, 0xe6bd7e, x, 0.29 + progress * 0.06, 0, 0.026, 0.015, 0.19);
    } else if (recipe === 'fish') {
      const fish = ingredient('fish');
      fish.traverse((object) => { if (object.isMesh) object.material = material(brown); });
      fish.position.y = 0.08; group.add(fish);
    } else {
      for (let i = 0; i < 9; i++) block(group, i % 2 ? brown : burnt ? brown : 0xda9846, (i % 3 - 1) * 0.24, 0.11, (Math.floor(i / 3) - 1) * 0.18, 0.18, 0.12, 0.15);
    }
    return group;
  }
  return { ingredient, vessel, kitchen, cookedFood, block, ball, part, cylinder };
}
