// The sky: a dome round the camera, so the sky is a sky and not the flat fog colour it used to be. It shades from
// the horizon (the haze colour the distant land fades into, so the two meet without a line) up to the zenith's deeper
// blue (or night's dark, or an overcast grey), with a glow round the sun and its disc by day, and clouds: soft,
// drifting heaps that cover as much of the sky as the weather's cloud cover says, lit by the sun on top and grey
// beneath, merging into an even deck as it clouds over. The reflection probe sees it too, so water reflects it.
import * as THREE from 'three';

export function createSkyDome({ scene, camera, water, U }) {
  const uniforms = {
    uSunDir: water.uSunDir, uSunCol: water.uSunCol, uSky: water.uSky, uZenith: water.uZenith, uTime: U.time,
    uCloud: { value: 0.3 }, uDay: { value: 1 }, uWind: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;                               // on the far plane: behind everything
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunCol, uSky, uZenith; uniform float uTime, uCloud, uDay; uniform vec2 uWind;
      varying vec3 vDir;
      #include <common>
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        // the blue deepens upward; just above the horizon it is the haze colour
        vec3 col = mix(uSky, uZenith, pow(smoothstep(0.0, 1.0, h), 0.55));
        // round the sun: a wide warm glow, and the disc by day
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunCol * (0.08 * pow(sd, 6.0) + 0.25 * pow(sd, 64.0)) * (0.4 + 0.6 * uDay) * (1.0 - 0.7 * uCloud);
        col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 6.0 * uDay * (1.0 - smoothstep(0.6, 0.95, uCloud));
        // clouds on a layer overhead: the view ray meets it further off the lower it looks, so they crowd and
        // flatten toward the horizon
        if (d.y > 0.0) {
          vec2 cp = d.xz / (d.y + 0.12) * 1.6 + uWind * uTime * 0.004;
          float n = fbm(cp) * 0.75 + fbm(cp * 2.7 + 5.0) * 0.25;
          float cover = clamp(uCloud, 0.0, 1.0);
          float c = smoothstep(1.0 - cover - 0.08, 1.0 - cover + 0.32, n) * smoothstep(0.0, 0.12, d.y);
          float thick = smoothstep(1.0 - cover, 1.0 - cover + 0.5, n);
          vec3 lit = (uSky * 0.9 + uSunCol * 0.45 * (0.6 + 0.4 * pow(sd, 3.0))) * mix(1.15, 0.7, thick * cover);
          vec3 deck = mix(uSky, uZenith, 0.25) * 0.95;
          vec3 cc = mix(lit, deck, smoothstep(0.55, 1.0, cover));
          col = mix(col, cc, c * mix(0.92, 1.0, cover));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  scene.add(mesh);
  function update(cloud, day, windX, windZ) {
    mesh.position.copy(camera.position);
    uniforms.uCloud.value = cloud; uniforms.uDay.value = day; uniforms.uWind.value.set(windX, windZ);
  }
  return { mesh, update };
}
