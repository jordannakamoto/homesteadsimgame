// The look of stream water, shared by the baked meshes (rivers-render.js) and the live simulation's surface
// (rivers-live.js), so the two match where one hands over to the other.
//
// From what makes real streams read as real (see the design doc):
//  - colour is reflection plus "water fog", never reflection alone: light is absorbed per channel, red first, so
//    clear shallows go green-gold over the bed and deeper water olive-brown; sediment clouds it (uTurbid follows
//    the rain and the run-off, src/sim/streams.js)
//  - the bed shows through the shallows (transparency), with caustics where the sun reaches it
//  - flow shows in the surface: detail flowed along the velocity in two layers half a phase apart (Valve's flow
//    maps), glassy in pools, broken on riffles
//  - sky reflection darkened under trees (the baked sky-visibility map), low reflections showing the dark banks,
//    sun glints, Fresnel
//  - white water carried in the flow, broken into streaks along the current and posterised with an ordered dither
//  - everything evaluated per water texel (uTPM a metre, twice the ground's by default), so it stays pixel-crisp

export const RIVER_UNIFORMS = ['uTime', 'uTex', 'uSunDir', 'uSunCol', 'uAmb', 'uSky', 'uZenith', 'uSkyMap', 'uSkyK'];

export const RIVER_SHADE = /* glsl */ `
  uniform float uTime, uTurbid, uSkyK, uTPM, uSnap; uniform sampler2D uTex, uSkyMap, uFoamTex;
  uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith;
  uniform vec4 uWin;                       // the live simulation's window (x0, z0, x1, z1); x1 < x0 when there is none
  uniform vec4 uRip[12];                   // ripples: x, z, start time, strength
  const mat4 BAYER = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  float bayer4(vec2 c) { ivec2 i = ivec2(mod(c, 4.0)); return (BAYER[i.y][i.x] + 0.5) / 16.0; }
  // how far the live water has taken over at p: 0 outside its window, 1 more than 4 m inside, dithered between
  // by the caller so the hand-over is a scatter of texels, not a seam
  float liveShare(vec2 p) {
    if (uWin.z < uWin.x) return 0.0;
    float e = min(min(p.x - uWin.x, uWin.z - p.x), min(p.y - uWin.y, uWin.w - p.y));
    return clamp((e - 1.0) / 4.0, 0.0, 1.0);
  }
  vec2 waterCell(vec2 p) { return floor(p * uTPM); }
  vec2 waterTexel(vec2 p) { return uSnap > 0.5 ? (floor(p * uTPM) + 0.5) / uTPM : p; }
  // q: where to shade (the texel centre when pixel-snapped); v: velocity (m/s); d: depth (m); foamIn: white water (0-1)
  vec4 shadeRiver(vec2 q, vec2 cell, vec3 world, vec2 v, float d, float foamIn) {
    float sp = length(v);
    d = max(d, 0.0);
    vec2 fd = sp > 0.01 ? v / sp : vec2(1.0, 0.0), fn = vec2(-fd.y, fd.x);
    // flow maps (Vlachos): two layers half a phase apart, the phase offset in patches to hide the pulse
    float ph = uTime * 0.32 + texture2D(uTex, floor(q / 4.0) * 0.173).b;
    float t0 = fract(ph), t1 = fract(ph + 0.5), wb = abs(1.0 - 2.0 * t0);
    vec2 uvA = q * 0.31 - v * t0 * 0.55, uvB = q * 0.31 - v * t1 * 0.55 + 0.37;
    vec3 det = mix(texture2D(uTex, uvA).rgb, texture2D(uTex, uvB).rgb, wb);
    float rough = 0.3 + 0.7 * smoothstep(0.05, 1.1, sp);
    vec2 g = (det.rg - 0.5) * rough * 1.2;
    // fine capillary ripples everywhere (wind and the current's turbulence), so even a pool catches the sky
    g += (texture2D(uTex, q * 1.7 - v * t0 * 0.9 + uTime * vec2(0.05, 0.03)).rg - 0.5) * 0.35;
    // fast water draws itself out in lines along the current (the long ridges on a riffle's glide)
    vec2 lq = vec2(dot(q, fd) * 0.12, dot(q, fn) * 1.1);
    float ln = texture2D(uTex, lq - vec2(uTime * sp * 0.12, 0.0)).g - 0.5;
    g += fn * ln * 0.55 * smoothstep(0.2, 1.2, sp);
    // ripples spreading where the water was touched: a travelling ring in the slope
    for (int i = 0; i < 12; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > 3.0 || r.w <= 0.0) continue;
      vec2 dp = q - r.xy; float dd = length(dp) + 1e-4;
      float R = 0.12 + age * 0.75, wv = 0.05 + age * 0.05;
      float x = (dd - R) / wv;
      g += dp / dd * (x * exp(-x * x)) * r.w * 0.9 * exp(-age * 1.3) / (1.0 + dd * 2.0);
    }
    if (uSnap > 0.5) g = floor(g * 8.0 + 0.5) / 8.0;                // pixel style: ripples as facets
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - world);
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    float skyVis = mix(1.0, texture2D(uSkyMap, (q + 0.5) / 512.0).r, uSkyK);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 bank = uAmb * vec3(0.16, 0.2, 0.11) + uSunCol * vec3(0.04, 0.05, 0.025);
    vec3 sky = mix(bank, mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7)), smoothstep(0.04, 0.3, R.y)) * mix(0.35, 1.0, skyVis);
    float sd = max(dot(R, uSunDir), 0.0);
    vec3 glint = uSunCol * (pow(sd, mix(600.0, 120.0, rough)) * mix(40.0, 6.0, rough)) * skyVis;
    // a broad sheen of the sun on the rippled surface: what shows the water is there when you look straight down
    vec3 H = normalize(V + uSunDir);
    glint += uSunCol * pow(max(dot(N, H), 0.0), 60.0) * 0.35 * skyVis;
    float path = d * (1.0 + 1.0 / max(V.y, 0.25));
    // absorption a metre: clear stream water (pure water's red loss, a little green-brown from dissolved organic
    // matter), plus what the sediment adds as the stream runs muddy
    vec3 sigma = vec3(0.55, 0.16, 0.24) + uTurbid * vec3(0.55, 0.5, 0.62);
    vec3 T = exp(-sigma * path);
    float opaque = 1.0 - dot(T, vec3(0.3, 0.45, 0.25));
    vec3 lightIn = uAmb * mix(0.55, 1.0, skyVis) + uSunCol * 0.55 * skyVis * (0.6 + 0.4 * max(uSunDir.y, 0.0));
    vec3 scatter = mix(vec3(0.045, 0.065, 0.035), vec3(0.085, 0.068, 0.042), clamp(uTurbid * 0.35, 0.0, 1.0));
    float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);
    // aerated water (under and round foam) scatters more light back: it pales and goes milky
    vec3 body = scatter * lightIn * (1.0 + 2.5 * fwd) + lightIn * vec3(0.16, 0.18, 0.17) * foamIn * smoothstep(0.02, 0.12, d);
    vec2 bedP = q - V.xz / max(V.y, 0.3) * d;
    float ca = texture2D(uTex, bedP * 0.42 + uTime * vec2(0.03, 0.017) + g).b * texture2D(uTex, bedP * 0.61 - uTime * vec2(0.021, 0.031)).b;
    ca = uSnap > 0.5 ? step(0.42, ca) : smoothstep(0.36, 0.5, ca);
    vec3 caust = uSunCol * vec3(0.9, 1.0, 0.75) * ca * 0.22 * (1.0 - opaque) * skyVis * smoothstep(0.03, 0.15, d) * (1.0 - liveShare(q));   // the live window draws them on the bed itself
    // over the bed: what comes back is the water's own light where it is opaque plus the reflection on top, and the
    // bed shows through the rest (alpha blending carries the bed, so divide by the coverage)
    float alpha = clamp(opaque + (fres + 0.04) * (1.0 - opaque), 0.0, 1.0);
    alpha = max(alpha, 0.12 + 0.3 * foamIn);
    vec3 col = ((body + caust) * opaque * (1.0 - fres) + sky * fres + glint) / alpha;
    // foam: a lace of bubbles flowed with the water, eroded by a threshold that rises as the foam thins, so it
    // breaks into islands and strands; thin lace where the water runs out at the edges
    vec2 fuv = q * 2.0;
    vec2 fa = fuv - v * t0 * 0.42, fb = fuv - v * t1 * 0.42 + 0.53;
    vec3 F = mix(texture2D(uFoamTex, fa).rgb, texture2D(uFoamTex, fb).rgb, wb);
    vec3 F2 = mix(texture2D(uFoamTex, fa * 0.37 + 0.2).rgb, texture2D(uFoamTex, fb * 0.37 + 0.7).rgb, wb);
    float lacework = F.r * 0.55 + F.g * 0.45;
    float amount = clamp(foamIn * (0.55 + 0.9 * F2.b) + (1.0 - smoothstep(0.0, 0.05, d)) * 0.35 * F2.b, 0.0, 1.0);
    float th = 1.0 - amount;
    float fm = smoothstep(th - 0.06, th + 0.14, lacework * 0.8 + F2.b * 0.35) * smoothstep(0.02, 0.12, amount);
    // dense white water is a sheet of foam, only softly mottled; the lace shows where it thins
    fm = max(fm, smoothstep(0.5, 0.85, amount) * (0.72 + 0.28 * F2.b));
    if (uSnap > 0.5) fm = step(bayer4(cell), fm);
    vec3 foamCol = lightIn * (0.78 + 0.32 * lacework) * vec3(0.93, 0.96, 0.96);
    col = mix(col, foamCol, fm * 0.92);
    alpha = max(alpha, fm * 0.9);
    return vec4(col, alpha);
  }
`;
