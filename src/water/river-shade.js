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
  uniform samplerCube uEnv, uEnv2; uniform vec4 uEnvPos; uniform float uEnvMix;          // the reflection probe (reflect-probe.js): where, and w on/off
  uniform vec4 uRip[24];                   // ripples: x, z, start time, strength
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
  // 3D simplex noise (Gustavson / Ashima Arts, MIT)
  vec4 sxPerm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    vec3 i = floor(v + dot(v, C.yyy)), x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz), l = 1.0 - g, i1 = min(g.xyz, l.zxy), i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx, x2 = x0 - i2 + C.yyy, x3 = x0 - 0.5;
    i = mod(i, 289.0);
    vec4 p = sxPerm(sxPerm(sxPerm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    vec4 j = p - 49.0 * floor(p / 49.0), x_ = floor(j / 7.0), y_ = floor(j - 7.0 * x_);
    vec4 x = (x_ * 2.0 + 0.5) / 7.0 - 1.0, y = (y_ * 2.0 + 0.5) / 7.0 - 1.0, h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy), b1 = vec4(x.zw, y.zw), s0 = floor(b0) * 2.0 + 1.0, s1 = floor(b1) * 2.0 + 1.0, sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy, a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x), p1 = vec3(a0.zw, h.y), p2 = vec3(a1.xy, h.z), p3 = vec3(a1.zw, h.w);
    vec4 nr = inversesqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= nr.x; p1 *= nr.y; p2 *= nr.z; p3 *= nr.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  // the stream's surface height (m) at a: (along the current, across it), carried downstream at speed sp
  float flowH(vec2 a, float sp, float rough) {
    float t = uTime;
    vec2 ad = vec2(a.x - t * (0.15 + sp), a.y);
    float patchy = smoothstep(-0.25, 0.65, snoise(vec3(ad * vec2(0.3, 0.45), t * 0.06)));
    float h = snoise(vec3(ad * vec2(0.5, 0.7), t * 0.2)) * 0.4;                             // slow swells
    h += snoise(vec3(ad * vec2(0.8, 2.0), t * 0.4)) * 0.35 * rough * (0.5 + 0.5 * patchy);  // broad ridges along the current
    return h * (0.006 + 0.024 * rough);
  }
  // q: where to shade (the texel centre when pixel-snapped); v: velocity (m/s); d: depth (m); foamIn: white water (0-1)
  vec4 shadeRiver(vec2 q, vec2 cell, vec3 world, vec2 v, float d, float foamIn) {
    float sp = length(v);
    d = max(d, 0.0);
    vec2 fd = sp > 0.01 ? v / sp : vec2(1.0, 0.0), fn = vec2(-fd.y, fd.x);
    // flow maps (Vlachos): two layers half a phase apart, the phase offset in patches to hide the pulse
    float ph = uTime * 0.32 + texture2D(uTex, floor(q / 4.0) * 0.173).b;
    float t0 = fract(ph), t1 = fract(ph + 0.5), wb = abs(1.0 - 2.0 * t0);
    // The surface: no repeating texture (that is what read as a diamond pattern), but noise built in the current's
    // own frame, so its shapes lie along the flow and move with it, and change as they go:
    //  - boils: broad swells welling up and spreading (the turbulence coming up from the bed)
    //  - streaks: ridges long along the current, narrow across it (a glide's lines, the tongue behind a stone)
    //  - wavelets and capillaries, in patches: some water glassy, some broken, wandering with the flow
    // Its slope, from small differences of that height, gives the normal.
    float rough = 0.25 + 0.75 * smoothstep(0.05, 1.2, sp);
    vec2 a = vec2(dot(q, fd), dot(q, fn));
    float e = 0.14;                                    // wide differences: a soft slope, no thin bright lines
    float h0 = flowH(a, sp, rough), hx = flowH(a + vec2(e, 0.0), sp, rough), hy = flowH(a + vec2(0.0, e), sp, rough);
    vec2 ga = vec2(hx - h0, hy - h0) / e;
    vec2 g = fd * ga.x + fn * ga.y;
    // and the earlier look's flowed ripple texture, at a lighter hand, each layer turned so its tiling never lines up
    mat2 r1 = mat2(0.799, 0.602, -0.602, 0.799), r2 = mat2(0.326, -0.946, 0.946, 0.326);
    vec2 uvA = r1 * q * 0.22 - v * t0 * 0.4, uvB = r2 * q * 0.22 - v * t1 * 0.4 + 0.37;
    g += (mix(texture2D(uTex, uvA).rg, texture2D(uTex, uvB).rg, wb) - 0.5) * 0.12 * (0.25 + rough);
    // the finest ruffle, too small to take differences of: tilts each spot a little at random
    vec3 rq = vec3(q * 9.0 - v * uTime * 9.0, uTime * 1.7);
    g += vec2(snoise(rq), snoise(rq + 31.7)) * 0.006 * rough;
    // ripples spreading where the water was touched: a travelling ring in the slope
    for (int i = 0; i < 24; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > 2.4 || r.w <= 0.0) continue;
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
    // What the water reflects is mostly its surroundings, not an empty sky (an even sky on a wavy surface is what
    // reads as oil): the bank, then trees up to a tree line, then sky above. The tree line stands as high as the
    // place is enclosed (the baked sky-visibility map: little sky seen, tall surroundings), varying round the
    // compass, and the ripples break the line up as they do on a real stream.
    float az = atan(R.z, R.x);
    float line = mix(0.06, 0.62, 1.0 - skyVis) * (0.7 + 0.6 * (snoise(vec3(az * 2.2, q * 0.02)) * 0.5 + 0.5)) + 0.04;
    vec3 bank = uAmb * vec3(0.2, 0.22, 0.14) + uSunCol * vec3(0.05, 0.05, 0.03);
    vec3 trees = uAmb * vec3(0.17, 0.24, 0.14) + uSunCol * vec3(0.06, 0.09, 0.04) * (0.6 + 0.4 * snoise(vec3(az * 9.0, R.y * 14.0, 0.0)));
    vec3 skyC = mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7));
    vec3 sky = mix(mix(bank, trees, smoothstep(0.0, 0.06, R.y)), skyC, smoothstep(line - 0.04, line + 0.04, R.y));
    // near the player, the real surroundings from the probe, blurred where the water is rough
    float envK = uEnvPos.w * (1.0 - smoothstep(25.0, 50.0, distance(q, uEnvPos.xz)));
    float lod = 2.0 + 2.5 * rough;
    if (envK > 0.0) sky = mix(sky, mix(textureLod(uEnv, R, lod).rgb, textureLod(uEnv2, R, lod).rgb, uEnvMix), envK);
    float sd = max(dot(R, uSunDir), 0.0);
    // the sun on the water: a soft sheen over the rippled surface (a mirror-sharp glint on smooth noise would draw
    // rings like a fingerprint), broken into sparkles by the smallest wavelets, more where the water is rough
    vec3 H = normalize(V + uSunDir);
    float nh = max(dot(N, H), 0.0);
    float sparkle = step(0.9, snoise(vec3(q * 9.0 - v * uTime * 9.0, uTime * 2.0)) * 0.5 + 0.5) * smoothstep(0.4, 1.0, rough);   // only on broken water
    vec3 glint = uSunCol * (pow(nh, 160.0) * 0.4 + pow(sd, 400.0) * 0.5) * sparkle * skyVis * step(line, R.y);   // only glints on broken water, no wide sheen; none where the reflection is trees
    float path = d * (1.0 + 1.0 / max(V.y, 0.25));
    // loss a metre: stream water carries fine sediment and dissolved organic matter even on a fair day (red lost
    // first, then blue: the olive-green to tea-brown of a real brook), much more when it runs muddy. Shallows show
    // their stones; a pool a metre deep is mostly the water's own colour.
    vec3 sigma = vec3(1.0, 0.42, 0.62) + uTurbid * vec3(0.8, 0.75, 0.95);
    vec3 T = exp(-sigma * path);
    float opaque = 1.0 - dot(T, vec3(0.3, 0.45, 0.25));
    vec3 lightIn = uAmb * mix(0.55, 1.0, skyVis) + uSunCol * 0.55 * skyVis * (0.6 + 0.4 * max(uSunDir.y, 0.0));
    vec3 scatter = mix(vec3(0.055, 0.07, 0.042), vec3(0.1, 0.082, 0.05), clamp(uTurbid * 0.4, 0.0, 1.0));   // what the sediment scatters back: olive, browner when muddy
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
    float amount = clamp(foamIn * (0.55 + 0.9 * F2.b) + (1.0 - smoothstep(0.0, 0.05, d)) * 0.12 * F2.b, 0.0, 1.0);
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
