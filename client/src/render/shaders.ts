/**
 * GLSL ES 3.00 sources (WebGL2). PixiJS mesh shaders receive the projection,
 * render-group and local transforms as uniforms; we compute positions in
 * render-target pixel space (`uWorldTransformMatrix * uTransformMatrix * pos`)
 * so effects can sample other low-res buffers with uv = pixelPos / resolution.
 */

const MESH_HEADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
`;

// ------------------------------------------------------------------ normal pass

export const NORMAL_VERT = /* glsl */ `${MESH_HEADER}
in vec2 aUV;
out vec2 vUV;
out vec2 vAxisX;
out vec2 vAxisY;
void main() {
  mat3 m = uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((uProjectionMatrix * m * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vAxisX = m[0].xy;
  vAxisY = m[1].xy;
}`;

/** Decodes a tangent-space normal map (G = up), rotates/flips it with the sprite and stores it in screen space. */
export const NORMAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vAxisX;
in vec2 vAxisY;
uniform sampler2D uNormal;
out vec4 finalColor;
void main() {
  vec4 t = texture(uNormal, vUV);
  if (t.a < 0.5) discard;
  vec3 n = t.rgb * 2.0 - 1.0;
  n.y = -n.y;
  vec2 xy = normalize(vAxisX) * n.x + normalize(vAxisY) * n.y;
  vec3 s = normalize(vec3(xy, max(n.z, 0.05)));
  finalColor = vec4(s * 0.5 + 0.5, 1.0);
}`;

// ------------------------------------------------------------------ light pass

export const LIGHT_VERT = /* glsl */ `${MESH_HEADER}
out vec2 vLocal;
out vec2 vRT;
void main() {
  vec3 p = uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  vRT = p.xy;
  vLocal = aPosition;
  gl_Position = vec4((uProjectionMatrix * p).xy, 0.0, 1.0);
}`;

/**
 * One light, drawn as its visibility polygon with additive blending.
 * rgb = surface light (with normal mapping), a = colourless scatter used to
 * light the fog. Everything is stored at half scale so 8-bit buffers can hold
 * over-bright values (the composite multiplies by 2).
 */
export const LIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vRT;
uniform sampler2D uNormals;
uniform vec2 uResolution;
uniform vec2 uLightLocal;
uniform vec2 uLightRT;
uniform vec3 uLightColor;
uniform float uIntensity;
uniform float uRadius;
uniform float uHeight;
uniform vec4 uCone;      // dir.xy (local), cos(half angle), softness; z < -1.5 = omni light
uniform float uScatter;
out vec4 finalColor;
void main() {
  vec2 d = vLocal - uLightLocal;
  float dist = length(d);
  float att = clamp(1.0 - dist / uRadius, 0.0, 1.0);
  att = att * att;
  float cone = 1.0;
  if (uCone.z > -1.5) {
    float c = dot(d / max(dist, 0.001), uCone.xy);
    cone = smoothstep(uCone.z - uCone.w, uCone.z, c);
    cone *= smoothstep(0.0, 6.0, dist);
  }
  vec3 n = texture(uNormals, vRT / uResolution).rgb * 2.0 - 1.0;
  vec3 L = normalize(vec3(uLightRT - vRT, uHeight));
  float diff = max(dot(normalize(n), L), 0.0);
  float k = att * cone * uIntensity;
  finalColor = vec4(uLightColor * (k * diff * 0.5), k * uScatter * 0.5);
}`;

// ------------------------------------------------------------------ simple solid colour (mask pass)

export const SOLID_VERT = /* glsl */ `${MESH_HEADER}
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const SOLID_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uSolid;
out vec4 finalColor;
void main() { finalColor = uSolid; }`;

// ------------------------------------------------------------------ fullscreen helpers

export const QUAD_VERT = /* glsl */ `${MESH_HEADER}
in vec2 aUV;
out vec2 vUV;
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 3.7);
    a *= 0.5;
  }
  return v;
}
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[idx]) + 0.5) / 16.0;
}
`;



/**
 * Combines albedo, light buffer and masks: ambient + lights, posterised light
 * with ordered dithering, procedural sky/moon/stars behind everything, sea
 * reflections and pixel fog lit by the light buffer's scatter channel.
 */
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uLight;
uniform sampler2D uMask;
uniform vec2 uResolution;
uniform vec2 uCamera;          // world px at the top-left pixel of the screen
uniform float uTime;
uniform vec3 uAmbientExt;
uniform vec3 uAmbientInt;
uniform vec3 uFogColor;
uniform vec4 uFog;             // density, scatter gain, height falloff, enabled
uniform vec2 uMoon;            // screen px
uniform float uLightSteps;
uniform float uSeaLevel;       // world px of calm sea level
out vec4 finalColor;
${NOISE}

vec3 sky(vec2 screen, vec2 world) {
  float t = clamp((world.y - (uSeaLevel - 260.0)) / 260.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.020, 0.028, 0.065), vec3(0.075, 0.095, 0.16), t);
  // stars (slight parallax)
  vec2 sp = floor(screen + world * 0.02);
  float st = hash12(sp);
  if (st > 0.9965) col += vec3(0.55, 0.6, 0.75) * (0.6 + 0.4 * sin(uTime * 2.0 + st * 300.0));
  // moon
  vec2 dm = screen - uMoon;
  float r = length(dm);
  if (r < 7.5) {
    float crater = step(0.7, vnoise(floor(dm) * 0.7 + 11.0)) * step(r, 6.0);
    col = mix(vec3(0.92, 0.90, 0.82), vec3(0.74, 0.72, 0.64), crater);
    if (r > 6.5) col *= 0.85;
  } else {
    col += vec3(0.10, 0.12, 0.16) * exp(-(r - 7.5) / 18.0);
  }
  return col;
}

void main() {
  vec2 screen = floor(vUV * uResolution);
  vec2 world = screen + uCamera;
  vec4 albedo = texture(uScene, vUV);
  vec4 light = texture(uLight, vUV) * 2.0;
  vec4 mask = texture(uMask, vUV);
  float dither = bayer4(screen);

  // posterise the light into a few bands, ordered dithering between them
  vec3 lq = floor(light.rgb * uLightSteps + dither) / uLightSteps;
  vec3 ambient = mix(uAmbientExt, uAmbientInt, mask.g);
  // albedo is premultiplied: composite it over the procedural sky
  vec3 col = albedo.rgb * (ambient + lq) + sky(screen, world) * (1.0 - albedo.a);

  // sea: reflection of whatever is lit above the surface
  if (mask.b > 0.45) {
    float depth = (mask.b - 0.5) * 128.0;
    float surf = world.y - depth;
    float ripple = sin(world.y * 0.9 + uTime * 3.0) * 1.5 + sin(world.x * 0.15 + uTime) * 1.0;
    vec2 refl = vec2(screen.x + ripple, (surf - uCamera.y) - depth * 1.6);
    if (refl.y > 0.0) {
      vec2 ruv = (refl + 0.5) / uResolution;
      vec4 rl = texture(uLight, ruv) * 2.0;
      vec4 ra = texture(uScene, ruv);
      vec3 rc = ra.a > 0.01 ? ra.rgb * (uAmbientExt + rl.rgb) : vec3(0.0);
      float fade = exp(-depth / 30.0) * 0.45;
      col += (rc * 0.8 + rl.a * vec3(0.55, 0.62, 0.70) * 0.6) * fade * step(0.5, fract(world.y * 0.5 + 0.25) + 0.3);
    }
  }

  // fog: animated noise, denser near the water, never inside the hull
  if (uFog.w > 0.5 && mask.g < 0.5) {
    vec2 fp = world * vec2(0.011, 0.02) + vec2(uTime * 0.05, uTime * 0.008);
    float n = fbm(fp) * 0.7 + vnoise(fp * 0.35 + 7.0) * 0.6;
    float heightK = clamp(1.0 - (uSeaLevel - world.y) / uFog.z, 0.25, 1.0);
    float density = clamp((n - 0.35) * 1.6, 0.0, 1.0) * uFog.x * heightK;
    density *= (1.0 - mask.g) * (1.0 - 0.45 * mask.r);
    // quantise the fog for the pixel look
    density = floor(density * 5.0 + dither) / 5.0;
    vec3 fogLit = uFogColor * (0.55 + light.a * uFog.y);
    col = mix(col, fogLit, density);
    // thin air scattering so beams are visible even between fog banks
    col += vec3(0.62, 0.70, 0.78) * light.a * 0.10 * (1.0 - mask.g);
  }
  finalColor = vec4(col, 1.0);
}`;

/**
 * The sea body (albedo pass). The CPU evaluates the shared wave function once
 * per 2 px column and passes the surface height as aUV.x, so the fragment
 * shader needs no trigonometry: depth gradient, foam crest, moonlit glints.
 */
export const SEA_VERT = /* glsl */ `${MESH_HEADER}
in vec2 aUV;
out vec2 vWorld;
out float vSurface;
void main() {
  vWorld = aPosition;
  vSurface = aUV.x;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const SEA_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vWorld;
in float vSurface;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFoam;
out vec4 finalColor;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 p = floor(vWorld);
  float depth = p.y - floor(vSurface);
  if (depth < 0.0) discard;
  vec3 col = mix(uShallow, uDeep, clamp(depth / 70.0, 0.0, 1.0));
  // horizontal moonlit glints, drifting slowly
  float g = hash12(vec2(floor(p.x / 6.0 + uTime * 1.5), p.y));
  col += vec3(0.10, 0.14, 0.17) * step(0.93, g) * exp(-depth / 40.0);
  if (depth < uFoam) col = mix(col, vec3(0.78, 0.84, 0.88), 0.8);
  else if (depth < uFoam + 1.0 && hash12(p) > 0.5) col = mix(col, vec3(0.6, 0.68, 0.74), 0.6);
  finalColor = vec4(col, 1.0);
}`;

/** Sea in the mask pass: b = 0.5 + depth below the surface / 128 (used for reflections). */
export const SEA_MASK_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vWorld;
in float vSurface;
out vec4 finalColor;
void main() {
  float depth = floor(vWorld.y) - floor(vSurface);
  if (depth < 0.0) discard;
  finalColor = vec4(0.0, 0.0, 0.5 + min(depth, 63.0) / 128.0, 1.0);
}`;

/** Water inside a hull compartment (albedo pass, ship-local px). */
export const HULLWATER_VERT = /* glsl */ `${MESH_HEADER}
out vec2 vLocal;
void main() {
  vLocal = aPosition;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const HULLWATER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec3 uSurface;   // c (px at xMid), slope, xMid
uniform float uTime;
uniform float uAgitation;
uniform float uSurfaceOnly;
out vec4 finalColor;
${NOISE}
void main() {
  vec2 p = floor(vLocal) + 0.5;
  float ripple = sin(p.x * 0.35 + uTime * 4.0) * 0.6 + sin(p.x * 0.11 - uTime * 2.3) * (0.5 + uAgitation);
  float surf = uSurface.x + uSurface.y * (p.x - uSurface.z) + ripple;
  float depth = p.y - surf;
  if (depth < 0.0) discard;
  if (uSurfaceOnly > 0.5) {
    // unlit glint: the surface line and a few sparkles just below it
    float spark = step(0.9, hash12(vec2(floor(p.x / 3.0), floor(uTime * 6.0))));
    if (depth < 1.0) { finalColor = vec4(vec3(0.55, 0.75, 0.80) * 0.45, 0.45); return; }
    if (depth < 3.0 && spark > 0.5) { finalColor = vec4(vec3(0.6, 0.8, 0.85) * 0.3, 0.3); return; }
    discard;
  }
  vec3 shallow = vec3(0.16, 0.36, 0.42);
  vec3 deep = vec3(0.04, 0.12, 0.18);
  vec3 col = mix(shallow, deep, clamp(depth / 36.0, 0.0, 1.0));
  float caustic = vnoise(vec2(p.x * 0.25 + uTime * 0.7, p.y * 0.25 - uTime * 0.4));
  col += vec3(0.05, 0.09, 0.09) * step(0.72, caustic);
  float alpha = 0.72;
  if (depth < 1.0) { col = vec3(0.70, 0.86, 0.88); alpha = 0.95; }
  finalColor = vec4(col * alpha, alpha);
}`;
