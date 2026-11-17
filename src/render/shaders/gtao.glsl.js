// Ground-truth ambient occlusion (Jimenez et al. 2016, XeGTAO formulation) at half resolution,
// reconstructed from the logarithmic depth buffer. OWNER: atmosphere agent.
// The result is NOT multiplied onto the image: patched materials sample it (reprojected with the
// previous frame's view-projection) and apply it to sky / ground-bounce light and environment
// reflections only, so sunlit faces keep their full brightness (contact shadows in the shade).
import { GLSL_MATH } from './common.glsl.js';

export const GTAO_FRAG = GLSL_MATH + /* glsl */`
uniform sampler2D tDepth;       // full-resolution log depth
uniform mat4 uInvProj;          // (jittered) inverse projection matching the depth buffer
uniform vec2 uProjScale;        // projection[0][0], projection[1][1]
uniform vec2 uFullSize;         // full-resolution size (px)
uniform float uLogFar;
uniform float uRadius;          // world radius (m)
uniform float uMaxDist;         // AO fades out towards this view distance (m)
uniform float uFrame;
in vec2 vUv;
out vec4 outColor;

// all lookups by integer full-resolution texel (half-res pixel centres sit exactly on full-res
// texel corners, so uv snapping is ambiguous and produced degenerate normals in whole rows)
ivec2 gFull;
vec3 lpViewPosT(ivec2 t) {
  t = clamp(t, ivec2(0), gFull - 1);
  float d = texelFetch(tDepth, t, 0).r;
  float z = d >= 0.9999999 ? 1e9 : exp2(d * uLogFar) - 1.0;
  vec2 uv = (vec2(t) + 0.5) / uFullSize;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 dir = v.xyz / v.w;
  return dir * (z / max(-dir.z, 1e-6));
}
float lpFastAcos(float x) {
  float ax = abs(x);
  float r = (-0.0187293 * ax + 0.0742610) * ax - 0.2121144;
  r = (r * ax + 1.5707288) * sqrt(max(1.0 - ax, 0.0));
  return x >= 0.0 ? r : LP_PI - r;
}

void main() {
  gFull = ivec2(uFullSize);
  ivec2 c = ivec2(gl_FragCoord.xy) * 2;
  vec3 P = lpViewPosT(c);
  float z = -P.z;
  if (z > uMaxDist || z <= 0.0) { outColor = vec4(1.0, z, 0.0, 1.0); return; }
  // normal from the neighbour with the smaller depth step on each axis
  vec3 Pl = lpViewPosT(c - ivec2(1, 0)), Pr = lpViewPosT(c + ivec2(1, 0));
  vec3 Pd = lpViewPosT(c - ivec2(0, 1)), Pu = lpViewPosT(c + ivec2(0, 1));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;
  float radiusPx = min(uRadius * uProjScale.y * 0.5 * uFullSize.y / z, uFullSize.y * 0.15);
  if (radiusPx < 1.5) { outColor = vec4(1.0, z, 0.0, 1.0); return; }
  float noise = lpIGN(gl_FragCoord.xy, uFrame);
  float noise2 = fract(noise * 1.6180339 + 0.37 + uFrame * 0.0618);
  const int SLICES = 3;
  const int STEPS = 10;
  const float THIN_K = 0.9;
  float falloffRange = 0.6 * uRadius;
  float falloffMul = -1.0 / falloffRange;
  float falloffAdd = uRadius / falloffRange;
  float vis = 0.0;
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + noise) * (LP_PI / float(SLICES));
    vec3 dirV = vec3(cos(phi), sin(phi), 0.0);
    vec2 omega = dirV.xy;
    vec3 orthoDir = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(orthoDir, V));
    vec3 projN = N - axis * dot(N, axis);
    float projNLen = length(projN);
    float signN = sign(dot(orthoDir, projN));
    float cosN = clamp(dot(projN, V) / max(projNLen, 1e-5), 0.0, 1.0);
    float n = signN * lpFastAcos(cosN);
    float hc0 = cos(n + 0.5 * LP_PI), hc1 = cos(n - 0.5 * LP_PI);
    float low0 = hc0, low1 = hc1;
    // thin-member filter: a sample's horizon is committed one step late; a sample that sticks out
    // towards the camera from BOTH its neighbours along the slice (a mullion, rail or post a few px
    // wide, with the surface / background visible again beyond it) only counts a quarter
    float pc0 = low0, pc1 = low1;           // pending candidates (previous sample)
    float pd0 = z, pd1 = z;                 // view depth of the previous sample
    float qd0 = z, qd1 = z;                 // ... and of the one before
    float thinT = max(0.3, 0.012 * z);
    for (int i = 0; i < STEPS; i++) {
      float t = (float(i) + noise2) / float(STEPS);
      t = t * t;
      vec2 offF = omega * max(t * radiusPx, 1.0 + float(i));
      ivec2 off = ivec2(round(offF));
      if (off == ivec2(0)) off = ivec2(sign(omega.x), sign(omega.y));
      ivec2 t0 = c + off, t1 = c - off;
      vec3 S0 = lpViewPosT(t0) - P;
      vec3 S1 = lpViewPosT(t1) - P;
      float l0 = length(S0), l1 = length(S1);
      float sh0 = dot(S0, V) / max(l0, 1e-5);
      float sh1 = dot(S1, V) / max(l1, 1e-5);
      // samples outside the screen carry no information
      float in0 = all(greaterThanEqual(t0, ivec2(0))) && all(lessThan(t0, gFull)) ? 1.0 : 0.0;
      float in1 = all(greaterThanEqual(t1, ivec2(0))) && all(lessThan(t1, gFull)) ? 1.0 : 0.0;
      // thin-occluder compensation (XeGTAO): the depth buffer cannot tell a thin mullion / rail / post
      // standing in front of a surface from a thick wall, so a sample displaced mostly ALONG the view
      // ray counts as further away (its weight falls off sooner): no dark halos where thin members meet
      // a surface behind them or stand against a far background (QQ-12)
      float f0 = length(vec3(S0.xy, S0.z * (1.0 + THIN_K)));
      float f1 = length(vec3(S1.xy, S1.z * (1.0 + THIN_K)));
      float w0 = clamp(f0 * falloffMul + falloffAdd, 0.0, 1.0) * in0;
      float w1 = clamp(f1 * falloffMul + falloffAdd, 0.0, 1.0) * in1;
      float d0 = z - S0.z, d1 = z - S1.z;   // view depth of the samples (P.z = -z)
      if (i > 0) {
        bool thin0 = pd0 < qd0 - thinT && pd0 < d0 - thinT;
        bool thin1 = pd1 < qd1 - thinT && pd1 < d1 - thinT;
        hc0 = max(hc0, thin0 ? mix(low0, pc0, 0.25) : pc0);
        hc1 = max(hc1, thin1 ? mix(low1, pc1, 0.25) : pc1);
      }
      pc0 = mix(low0, sh0, w0); pc1 = mix(low1, sh1, w1);
      qd0 = pd0; qd1 = pd1; pd0 = d0; pd1 = d1;
    }
    hc0 = max(hc0, pc0);
    hc1 = max(hc1, pc1);
    float h0 = -lpFastAcos(hc1);
    float h1 = lpFastAcos(hc0);
    h0 = n + clamp(h0 - n, -0.5 * LP_PI, 0.5 * LP_PI);
    h1 = n + clamp(h1 - n, -0.5 * LP_PI, 0.5 * LP_PI);
    float iarc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    float iarc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    vis += projNLen * (iarc0 + iarc1);
  }
  vis = clamp(vis / float(SLICES), 0.0, 1.0);
  vis = pow(vis, 1.35);
  vis = mix(1.0, vis, 1.0 - smoothstep(uMaxDist * 0.45, uMaxDist, z));
  outColor = vec4(vis, z, 0.0, 1.0);
}
`;

// 5x5 depth-aware blur of the half-resolution AO (R = AO, G = view depth)
export const AO_BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uTexel;
uniform float uStrength;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 c = texture(tAO, vUv).rg;
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 s = texture(tAO, vUv + vec2(float(x), float(y)) * uTexel).rg;
    float wd = exp(-abs(s.g - c.g) / (0.03 * c.g + 0.05));
    float ws = 1.0 - 0.12 * float(abs(x) + abs(y));
    sum += s.r * wd * ws; wsum += wd * ws;
  }
  float ao = sum / max(wsum, 1e-5);
  outColor = vec4(mix(1.0, ao, uStrength), c.g, 0.0, 1.0);
}
`;
