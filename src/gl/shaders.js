/**
 * GLSL ES 3.00 shader library.
 *
 * The solver is a classic "Stable Fluids" fractional-step scheme:
 *   advect -> divergence -> Jacobi pressure -> pressure projection
 *
 * Velocity is stored as normalized domain units per second (UV/s). This makes
 * the simulation resolution-independent and keeps the force integration
 * physically interpretable.
 */

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;
`;

/* --------------------------------------------------------------------------
 * 1. Semi-Lagrangian advection
 * ------------------------------------------------------------------------ */
export const ADVECT_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform float uDt;
uniform float uInlet;
uniform float uTime;
uniform float uDissipation;
uniform float uViscosity;
uniform vec2 uInvDomain;

void main() {
  if (texture(uObstacle, vUv).r > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * vel * uInvDomain;
  back = clamp(back, uTexel * 0.5, vec2(1.0) - uTexel * 0.5);

  vec2 advected = texture(uVelocity, back).xy;
  advected *= pow(uDissipation, uDt * 60.0);
  advected *= exp(-uViscosity * uDt * 1.8);

  // Time-varying inlet shear seeds the Kelvin-Helmholtz instability so a
  // perfectly symmetric obstacle can actually shed a vortex street.
  if (vUv.x < uTexel.x * 1.5) {
    float shear =
      0.13 * sin(uTime * 2.15 + vUv.y * 17.0) +
      0.04 * sin(uTime * 5.90 + vUv.y * 43.0);
    advected = vec2(uInlet, uInlet * shear);
  } else if (vUv.x > 1.0 - uTexel.x * 1.5) {
    vec2 prev = texture(uVelocity, vUv - vec2(uTexel.x * 2.0, 0.0)).xy;
    advected = vec2(prev.x, 0.0);
  }

  // Free-slip tunnel walls.
  if (vUv.y < uTexel.y * 1.5 || vUv.y > 1.0 - uTexel.y * 1.5) {
    advected.y = 0.0;
  }

  if (texture(uObstacle, vUv).r > 0.5) {
    advected = vec2(0.0);
  }

  fragColor = vec4(advected, 0.0, 1.0);
}
`;

/* --------------------------------------------------------------------------
 * 2. Divergence (central differences)
 * ------------------------------------------------------------------------ */
export const DIVERGENCE_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform float uCell;

void main() {
  if (texture(uObstacle, vUv).r > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float l = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;

  float div = (r - l) / (2.0 * uCell) + (t - b) / (2.0 * uCell);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

/* --------------------------------------------------------------------------
 * 3. Jacobi pressure solve:  laplacian(p) = divergence
 * ------------------------------------------------------------------------ */
export const JACOBI_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform float uDx2;

float pressureAt(vec2 uv, float center) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    // Open pressure boundaries.
    return 0.0;
  }
  if (texture(uObstacle, uv).r > 0.5) {
    // Neumann: zero normal pressure gradient on solid walls.
    return center;
  }
  return texture(uPressure, uv).r;
}

void main() {
  if (texture(uObstacle, vUv).r > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float center = texture(uPressure, vUv).r;
  float l = pressureAt(vUv - vec2(uTexel.x, 0.0), center);
  float r = pressureAt(vUv + vec2(uTexel.x, 0.0), center);
  float b = pressureAt(vUv - vec2(0.0, uTexel.y), center);
  float t = pressureAt(vUv + vec2(0.0, uTexel.y), center);
  float div = texture(uDivergence, vUv).r;

  float p = (l + r + b + t - div * uDx2) * 0.25;
  fragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

/* --------------------------------------------------------------------------
 * 4. Pressure projection: u <- u - grad(p)
 * ------------------------------------------------------------------------ */
export const GRADIENT_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uVelocity;
uniform sampler2D uPressure;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform float uInlet;
uniform float uMaxVelocity;
uniform float uTime;
uniform float uCell;

float pressureAt(vec2 uv, float center) {
  if (texture(uObstacle, uv).r > 0.5) return center;
  return texture(uPressure, uv).r;
}

void main() {
  if (texture(uObstacle, vUv).r > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float center = texture(uPressure, vUv).r;
  float l = pressureAt(vUv - vec2(uTexel.x, 0.0), center);
  float r = pressureAt(vUv + vec2(uTexel.x, 0.0), center);
  float b = pressureAt(vUv - vec2(0.0, uTexel.y), center);
  float t = pressureAt(vUv + vec2(0.0, uTexel.y), center);

  vec2 grad = vec2(r - l, t - b) / (2.0 * uCell);
  vec2 vel = texture(uVelocity, vUv).xy - grad;

  if (vUv.x < uTexel.x * 1.5) {
    float shear =
      0.13 * sin(uTime * 2.15 + vUv.y * 17.0) +
      0.04 * sin(uTime * 5.90 + vUv.y * 43.0);
    vel = vec2(uInlet, uInlet * shear);
  } else if (vUv.x > 1.0 - uTexel.x * 1.5) {
    vec2 prev = texture(uVelocity, vUv - vec2(uTexel.x * 2.0, 0.0)).xy;
    vel = vec2(prev.x, 0.0);
  }

  if (vUv.y < uTexel.y * 1.5 || vUv.y > 1.0 - uTexel.y * 1.5) {
    vel.y = 0.0;
  }

  float speed = length(vel);
  if (speed > uMaxVelocity) {
    vel *= uMaxVelocity / speed;
  }

  if (texture(uObstacle, vUv).r > 0.5) {
    vel = vec2(0.0);
  }

  fragColor = vec4(vel, 0.0, 1.0);
}
`;

/* --------------------------------------------------------------------------
 * 5. Background + obstacle composite
 * ------------------------------------------------------------------------ */
export const BACKGROUND_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform float uInlet;
uniform float uTime;
uniform float uCell;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(41.23, 289.11))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;

  // --- deep test-section background ---------------------------------------
  vec3 col = mix(
    vec3(0.018, 0.046, 0.064),
    vec3(0.007, 0.022, 0.033),
    smoothstep(0.0, 1.0, uv.y)
  );

  vec2 radial = (uv - 0.52) * vec2(1.0, 1.22);
  col *= 1.0 - smoothstep(0.32, 0.92, length(radial)) * 0.5;

  // --- velocity magnitude field -------------------------------------------
  vec2 vel = texture(uVelocity, uv).xy;
  float speed = clamp(length(vel) / max(uInlet, 0.0001), 0.0, 2.4);

  float l = texture(uVelocity, uv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVelocity, uv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVelocity, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVelocity, uv + vec2(0.0, uTexel.y)).x;
  float curl = (r - l) / (2.0 * uCell) - (t - b) / (2.0 * uCell);
  float vort = clamp(abs(curl) * uCell / max(uInlet, 0.0001), 0.0, 1.0);

  vec3 flowLow = vec3(0.020, 0.105, 0.180);
  vec3 flowHigh = vec3(0.045, 0.330, 0.545);
  vec3 flow = mix(flowLow, flowHigh, smoothstep(0.06, 1.35, speed));
  col += flow * (0.42 + 0.48 * pow(clamp(speed, 0.0, 1.0), 1.15));

  // A dark wake pocket gives the body a readable, photographic silhouette.
  float wake = (1.0 - smoothstep(0.08, 0.6, speed)) * smoothstep(0.06, 0.2, uv.x);
  col *= 1.0 - wake * 0.36;

  // Recirculation carries a quiet violet cast.
  col = mix(col, col * vec3(0.72, 0.66, 1.16), smoothstep(0.03, 0.55, vort) * 0.34);

  // Very faint measurement grid, editorial rather than sci-fi.
  vec2 gridCoord = uv * vec2(32.0, 16.0);
  vec2 gridDist = abs(fract(gridCoord - 0.5) - 0.5) / max(fwidth(gridCoord), vec2(1e-5));
  float grid = 1.0 - min(min(gridDist.x, gridDist.y), 1.0);
  col += vec3(0.42, 0.68, 0.74) * grid * 0.016;

  // Faint inlet energy sheet.
  col += vec3(0.10, 0.42, 0.52) * exp(-uv.x * 17.0) * 0.16;

  // --- obstacle body -------------------------------------------------------
  float mask = texture(uObstacle, uv).r;
  float mR = texture(uObstacle, uv + vec2(uTexel.x, 0.0)).r;
  float mL = texture(uObstacle, uv - vec2(uTexel.x, 0.0)).r;
  float mT = texture(uObstacle, uv + vec2(0.0, uTexel.y)).r;
  float mB = texture(uObstacle, uv - vec2(0.0, uTexel.y)).r;
  float edge = max(max(abs(mask - mR), abs(mask - mL)), max(abs(mask - mT), abs(mask - mB)));

  float aa = max(fwidth(mask), 0.0012);
  float body = smoothstep(0.5 - aa, 0.5 + aa, mask);
  vec3 bodyShade = vec3(0.80, 0.745, 0.615);
  vec3 bodyLight = vec3(0.975, 0.935, 0.815);
  vec3 bodyCol = mix(bodyShade, bodyLight, smoothstep(0.0, 0.92, uv.y));
  bodyCol = mix(bodyCol, bodyCol * 0.92, smoothstep(0.55, 1.0, uv.y) * 0.35);
  col = mix(col, bodyCol, body);

  // Soft cream rim light on the silhouette.
  float rim = smoothstep(0.04, 0.55, edge) * (1.0 - body);
  col += vec3(0.95, 0.88, 0.70) * rim * 0.16;
  col = mix(col, vec3(1.0, 0.975, 0.87), smoothstep(0.35, 0.9, edge) * body * 0.32);

  // Fine dither keeps the large blue gradients band-free.
  col += (hash21(uv * 1920.0) - 0.5) * 0.008;

  fragColor = vec4(col, 1.0);
}
`;

/* --------------------------------------------------------------------------
 * 6. GPGPU particles — update pass
 * ------------------------------------------------------------------------ */
export const PARTICLE_UPDATE_FRAGMENT = /* glsl */ `${HEADER}

uniform sampler2D uParticles;
uniform sampler2D uVelocity;
uniform sampler2D uObstacle;
uniform vec2 uTexel;
uniform vec2 uInvDomain;
uniform float uDt;
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 sampleVelocity(vec2 pos) {
  vec2 uv = clamp(pos, uTexel * 0.51, vec2(1.0) - uTexel * 0.51);
  return texture(uVelocity, uv).xy;
}

vec4 respawn(vec2 uv) {
  float seed = hash12(uv * 811.0 + uTime * 0.017);
  float y = mix(0.025, 0.975, hash12(vec2(seed * 5.17, uTime * 0.031)));
  float life = 2.6 + hash12(vec2(seed, 17.0)) * 5.4;
  return vec4(0.0015 + seed * 0.0035, y, 0.0, life);
}

void main() {
  vec4 data = texture(uParticles, vUv);
  vec2 pos = data.xy;
  float life = data.w;

  if (
    life <= 0.0 ||
    pos.x < 0.0 || pos.x > 1.0 ||
    pos.y < 0.0 || pos.y > 1.0
  ) {
    fragColor = respawn(vUv);
    return;
  }

  // RK2 midpoint integration through the velocity field.
  vec2 v0 = sampleVelocity(pos);
  vec2 mid = pos + v0 * uDt * 0.5 * uInvDomain;
  vec2 v1 = sampleVelocity(mid);
  vec2 next = pos + v1 * uDt * uInvDomain;

  life -= uDt;

  bool hitWall = texture(uObstacle, clamp(next, uTexel, vec2(1.0) - uTexel)).r > 0.5;
  if (next.x >= 0.998 || next.y <= 0.001 || next.y >= 0.999 || life <= 0.0 || hitWall) {
    fragColor = respawn(vUv);
    return;
  }

  fragColor = vec4(next, length(v1), life);
}
`;

/* --------------------------------------------------------------------------
 * 7. Particle rendering — velocity-oriented streak quads
 *
 * Each particle expands into two triangles. The tail is placed upstream by
 * velocity * trailTime, producing a comet-like streak whose length is
 * proportional to local speed. 65,536 particles × 6 vertices = 393k vertices.
 * ------------------------------------------------------------------------ */
export const PARTICLE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uParticles;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform vec2 uParticleRes;
uniform float uInlet;
uniform float uDensity;
uniform float uTrailTime;
uniform float uWidth;
uniform float uCell;
uniform float uAspect;
uniform vec2 uInvDomain;

out vec3 vColor;
out float vAlpha;
out float vEdge;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec3 speedRamp(float s) {
  s = clamp(s, 0.0, 2.1);
  vec3 low = vec3(0.020, 0.150, 0.360);
  vec3 azure = vec3(0.070, 0.490, 0.760);
  vec3 pale = vec3(0.420, 0.840, 0.880);
  vec3 cream = vec3(0.980, 0.940, 0.800);

  if (s < 0.55) return mix(low, azure, smoothstep(0.0, 0.55, s));
  if (s < 1.08) return mix(azure, pale, smoothstep(0.55, 1.08, s));
  return mix(pale, cream, smoothstep(1.08, 2.1, s));
}

void main() {
  int particleId = gl_VertexID / 6;
  int vertexInQuad = gl_VertexID - particleId * 6;

  if (hash11(float(particleId) * 1.731) > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vEdge = 0.0;
    return;
  }

  ivec2 coord = ivec2(
    particleId % int(uParticleRes.x),
    particleId / int(uParticleRes.x)
  );
  vec4 p = texelFetch(uParticles, coord, 0);
  if (p.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vEdge = 0.0;
    return;
  }

  float along = (vertexInQuad == 1 || vertexInQuad == 4 || vertexInQuad == 5) ? 1.0 : 0.0;
  float side = (vertexInQuad == 2 || vertexInQuad == 3 || vertexInQuad == 5) ? 1.0 : -1.0;

  vec2 uv = p.xy;
  vec2 vel = texture(uVelocity, clamp(uv, uTexel * 0.5, vec2(1.0) - uTexel * 0.5)).xy;
  float speed = length(vel) / max(uInlet, 0.0001);

  float l = texture(uVelocity, uv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVelocity, uv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVelocity, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVelocity, uv + vec2(0.0, uTexel.y)).x;
  float curl = (r - l) / (2.0 * uCell) - (t - b) / (2.0 * uCell);
  float vort = abs(curl) * uCell / max(uInlet, 0.0001);
  float recirculation =
    smoothstep(0.014, 0.13, vort) *
    (1.0 - smoothstep(0.52, 1.02, speed));

  vec3 col = speedRamp(speed);
  col = mix(col, vec3(0.67, 0.44, 0.82), smoothstep(0.0, 0.62, recirculation) * 0.82);

  float brightness = 0.78 + 0.22 * hash11(float(particleId) * 0.913);
  vColor = col * brightness;
  vEdge = side;

  float lifeFade = smoothstep(0.0, 0.38, p.w);
  float speedFade = 0.12 + 0.88 * smoothstep(0.04, 1.05, speed);
  float vortexGlow = smoothstep(0.02, 0.55, recirculation);
  vAlpha = lifeFade * max(speedFade, vortexGlow * 1.15) * along * 0.19;

  vec2 tail = uv - vel * uTrailTime * uInvDomain;
  vec2 delta = uv - tail;
  vec2 dirScreen = normalize(vec2(delta.x * uAspect, delta.y) + vec2(1e-7));
  vec2 normal = vec2(-dirScreen.y / uAspect, dirScreen.x);
  vec2 world = mix(tail, uv, along) + normal * side * uWidth;

  gl_Position = vec4(world * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
in float vEdge;
out vec4 fragColor;

void main() {
  float soft = 1.0 - pow(abs(vEdge), 4.0);
  fragColor = vec4(vColor, vAlpha * soft);
}
`;
