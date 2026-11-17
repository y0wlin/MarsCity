// Shared GLSL helpers (GLSL ES 3.00). OWNER: atmosphere agent.
// Integer hashing (pcg3d), periodic gradient / Worley noise used by the texture generators,
// fullscreen-triangle vertex shader, small math helpers. All world-ish patterns are seeded from
// core/constants SEED (passed as a uint uniform/define) so they are deterministic everywhere.

export const GLSL_FULLSCREEN_VERT = /* glsl */`
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GLSL_MATH = /* glsl */`
#ifndef LP_PI
#define LP_PI 3.141592653589793
#endif
float lpSaturate(float x) { return clamp(x, 0.0, 1.0); }
float lpRemap(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }
float lpLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// interleaved gradient noise (Jimenez), animated by frame index with a golden-ratio offset
float lpIGN(vec2 p, float frame) {
  p += frame * vec2(47.0, 17.0) * 0.695;
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

export const GLSL_HASH = /* glsl */`
uvec3 lpPcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 lpHash33(ivec3 p, uint seed) {
  uvec3 h = lpPcg3d(uvec3(p) ^ uvec3(seed, seed * 747796405u + 1u, seed * 2891336453u + 7u));
  return vec3(h) * (1.0 / 4294967295.0);
}
float lpHash13(ivec3 p, uint seed) { return lpHash33(p, seed).x; }
ivec3 lpPmod(ivec3 a, int n) { return ((a % n) + n) % n; }
`;

// Periodic noises for tileable textures (period in lattice cells) and non-periodic gradient noise.
export const GLSL_NOISE = /* glsl */`
vec3 lpGrad(ivec3 c, uint seed) {
  vec3 h = lpHash33(c, seed) * 2.0 - 1.0;
  return normalize(h + vec3(1e-6));
}
// gradient noise, period <= 0 means non periodic. Returns roughly [-1, 1].
float lpGradNoise(vec3 x, int period, uint seed) {
  vec3 fl = floor(x);
  ivec3 i = ivec3(fl);
  vec3 f = x - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int k = 0; k < 8; k++) {
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    ivec3 c = i + o;
    if (period > 0) c = lpPmod(c, period);
    n[k] = dot(lpGrad(c, seed), f - vec3(o));
  }
  float x00 = mix(n[0], n[1], u.x), x10 = mix(n[2], n[3], u.x);
  float x01 = mix(n[4], n[5], u.x), x11 = mix(n[6], n[7], u.x);
  return 1.6 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
// Worley F1 distance, periodic. Returns ~[0, 1.1].
float lpWorley(vec3 x, int period, uint seed) {
  vec3 fl = floor(x);
  ivec3 i = ivec3(fl);
  vec3 f = x - fl;
  float d = 1e9;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    ivec3 o = ivec3(xx, y, z);
    ivec3 c = i + o;
    if (period > 0) c = lpPmod(c, period);
    vec3 fp = vec3(o) + lpHash33(c, seed);
    vec3 r = f - fp;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;
