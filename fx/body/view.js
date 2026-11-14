import * as THREE from 'three';
import { makeBody, charMaterials } from './body.js';
const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
R.setSize(1300, 760); document.body.appendChild(R.domElement); R.toneMapping = THREE.ACESFilmicToneMapping; R.shadowMap.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xa9c8d8);
scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x5a6b3c, 0.95));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.7); sun.position.set(4, 7, 6); sun.castShadow = true; scene.add(sun);
const gnd = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x6f9a3a })); gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true; scene.add(gnd);
const mats = charMaterials(THREE), outline = mats.outline;
function spawn(opt, x, rotY, pose) {
  const made = makeBody(THREE, opt), bones = made.defs.map(() => new THREE.Bone());
  made.defs.forEach((d, i) => { const p = d[0] < 0 ? [0, 0, 0] : made.defs[d[0]].slice(1); bones[i].position.set(d[1] - p[0], d[2] - p[1], d[3] - p[2]); if (d[0] >= 0) bones[d[0]].add(bones[i]); });
  const mat = mats.toon(made.faceTex);
  const mesh = new THREE.SkinnedMesh(made.geo, mat), line = new THREE.SkinnedMesh(made.geo, outline), sk = new THREE.Skeleton(bones);
  const grp = new THREE.Group(); grp.position.x = x; grp.rotation.y = rotY; scene.add(grp);
  mesh.add(bones[0]); mesh.castShadow = true; grp.add(mesh); mesh.bind(sk); grp.add(line); line.bind(sk, mesh.bindMatrix);
  mesh.frustumCulled = line.frustumCulled = false;
  if (pose === 'run') { bones[7].rotation.x = -0.8; bones[8].rotation.x = 0.9; bones[9].rotation.x = 0.6; bones[10].rotation.x = 0.4; bones[3].rotation.x = 0.7; bones[4].rotation.x = -0.6; bones[5].rotation.x = -0.8; bones[6].rotation.x = -0.9; }
  else { bones[3].rotation.z = -0.13; bones[5].rotation.z = 0.13; bones[4].rotation.x = bones[6].rotation.x = -0.3; }
  return grp;
}
const hero = { hairStyle: 0, cape: '#b23a2e', tabard: '#e4dcc8', glove: '#6a4a2c', eyeType: 0, mouthType: 2 }, girl = { tunic: '#b8323a', pants: '#3a2c2c', hair: '#e8d9b0', eye: '#7a4bb5', accent: '#f0e2c0', hairStyle: 1, cape: '#7a2a30', glove: '#5a3d28', eyeType: 1, mouthType: 1 }, gob = { goblin: true, skin: '#6f9a45', tunic: '#3b2a1e', pants: '#2a2118', accent: '#5a4630', belt: '#1e1610', lean: 0.2 };
const guard = { tunic: '#b8323a', pants: '#2f2a33', hair: '#c9cdd3', eye: '#8a5a2b', hairStyle: 2, pauldron: '#7f8892', glove: '#5b4030', eyeType: 3, mouthType: 3 };
const V = window.__view || 'turn';
let cam;
if (V === 'turn') {
  spawn(hero, -2.0, 0.3); spawn(hero, -1.0, 1.2); spawn(hero, 0, Math.PI - 0.5); spawn(girl, 1.0, 0.3); spawn(gob, 2.0, -0.4);
  cam = new THREE.PerspectiveCamera(20, 1300 / 760, 0.1, 100); cam.position.set(0, 1.15, 7.6); cam.lookAt(0, 0.78, 0);
} else if (V === 'stylesF' || V === 'stylesB') {
  const back = V === 'stylesB';
  [0, 3, 4, 5].forEach((hs, i) => spawn(Object.assign({}, hero, { hairStyle: hs }), -1.2 + i * 0.8, back ? Math.PI - 0.55 : 0.4));
  cam = new THREE.PerspectiveCamera(20, 1300 / 760, 0.1, 100); cam.position.set(0, 1.42, 5.0); cam.lookAt(0, 1.18, 0);
} else if (V === 'hair') {
  [0.3, 1.2, 3.14 - 0.5].forEach((r, i) => spawn(hero, -1.9 + i * 0.64, r));
  spawn(Object.assign({}, hero, { seed: 7, hair: '#b9502a', eye: '#3f8f5a' }), 0.02, 0.3);
  spawn(girl, 0.66, 0.5); spawn(girl, 1.3, 2.7); spawn(guard, 1.94, -0.5); spawn(guard, 2.58, 2.6);
  cam = new THREE.PerspectiveCamera(20, 1300 / 760, 0.1, 100); cam.position.set(0.3, 1.75, 6.9); cam.lookAt(0.3, 1.05, 0);
} else if (V === 'face') {
  const cool = { tunic: '#3a3f6a', pants: '#26242e', hair: '#2c2f45', eye: '#b0482e', hairStyle: 2, eyeType: 2, mouthType: 0, cape: '#22243a' };
  spawn(hero, -0.84, 0.12); spawn(girl, -0.28, -0.12); spawn(cool, 0.28, 0.12); spawn(guard, 0.84, -0.12);
  cam = new THREE.PerspectiveCamera(20, 1300 / 760, 0.1, 100); cam.position.set(0, 1.3, 3.5); cam.lookAt(0, 1.2, 0);
} else {
  spawn(hero, -1.2, 0.3); spawn(girl, 0, -0.4, 'run'); spawn(gob, 1.2, 0.2);
  cam = new THREE.PerspectiveCamera(30, 1300 / 760, 0.1, 100); cam.position.set(0, 7.5, 6.5); cam.lookAt(0, 0.8, 0);
}
R.render(scene, cam); window.__done = true;
