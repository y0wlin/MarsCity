// Cloud layer GLSL. OWNER: atmosphere agent.
//
// One thin layer between CLOUD_ALT and CLOUD_TOP. Three deterministic textures (GPU-generated at
// start-up from SEED) describe it at every scale:
//   * weather cubemap (2048^2 per face, ~2.6 km/texel at the face centre), RGBA8:
//       R coverage, G type (0 stratiform .. 1 cumuliform), B vertical extent (cloud-top height as a
//       fraction of the layer), A optical density (wisps / veils are thin, cumulus cores dense).
//     Structures (mean coverage ~6.6 %, A01 / R3): latitude climatology (ITCZ, dry subtropics,
//     storm tracks, dry poles), coherent domain-warped cloud systems whose margins break into
//     rounded heaps and puffs (true billow noise), comma clouds / spirals around a few cyclones,
//     a few long frontal bands, faint translucent veils; clear sky between systems stays clear.
//   * shape 3D texture (128^3, 9 km tile): Perlin-Worley cells (0.4-2 km) inside every weather texel.
//   * detail 3D texture (128^3, 1.8 km tile): Worley fbm that erodes edges into billows / wisps.
// The same density function drives the rendered clouds, their light march and the cloud-shadow
// maps sampled by every patched material, so shadows sit exactly under (and offset from) clouds.

export const WEATHER_VORTICES = 10;

// ---- generators ------------------------------------------------------------------------------
// Pass 1: planetary flow field (velocity cubemap, 512^2 per face, RGBA16F, xyz = tangent velocity
// in radians per unit time): zonal jets (trades, meandering westerlies, polar easterlies), the curl
// of a turbulent stream function (eddies, 300-1500 km) and the cyclones (Rankine-like profile).
export const GLSL_WEATHER_FLOW = /* glsl */`
#define NV ${WEATHER_VORTICES}
uniform int uFace;
uniform float uSize;
uniform uint uSeed;
uniform vec4 uVortex[NV];      // xyz centre (unit, cloud frame), w = signed peak speed (+ = ccw seen from outside)
uniform vec2 uVortexR[NV];     // x = core radius (rad), y = moisture of the comma head
out vec4 outColor;

vec3 lpFaceDir(int f, float sc, float tc) {
  if (f == 0) return vec3(1.0, -tc, -sc);
  if (f == 1) return vec3(-1.0, -tc, sc);
  if (f == 2) return vec3(sc, 1.0, tc);
  if (f == 3) return vec3(sc, -1.0, -tc);
  if (f == 4) return vec3(sc, -tc, 1.0);
  return vec3(-sc, -tc, -1.0);
}
float sq(float x) { return x * x; }
float gn(vec3 p, uint s) { return lpGradNoise(p, 0, s); }
float psi(vec3 p) {
  return gn(p * 2.1, uSeed + 1u) * 0.50 + gn(p * 4.3 + 3.1, uSeed + 2u) * 0.30 + gn(p * 8.9 - 1.7, uSeed + 3u) * 0.16;
}
void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec3 d = normalize(lpFaceDir(uFace, st.x * 2.0 - 1.0, st.y * 2.0 - 1.0));
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float alat = abs(lat);
  // zonal wind (eastward > 0), meandering
  float u = -0.38 * exp(-sq(lat / 0.30)) + 1.0 * exp(-sq((alat - 0.80) / 0.25)) - 0.22 * exp(-sq((alat - 1.27) / 0.14));
  u *= 1.0 + 0.45 * gn(d * 2.6 + 7.7, uSeed + 9u);
  vec3 east = vec3(d.z, 0.0, -d.x);              // |east| = cos(lat)
  vec3 v = east * u;
  // eddies: v = d x grad(psi)
  const float e = 0.0025;
  vec3 g = vec3(psi(d + vec3(e, 0.0, 0.0)) - psi(d - vec3(e, 0.0, 0.0)),
                psi(d + vec3(0.0, e, 0.0)) - psi(d - vec3(0.0, e, 0.0)),
                psi(d + vec3(0.0, 0.0, e)) - psi(d - vec3(0.0, 0.0, e))) / (2.0 * e);
  v += cross(d, g) * 0.13;
  // cyclones
  for (int k = 0; k < NV; k++) {
    vec3 c = uVortex[k].xyz;
    float ca = dot(d, c);
    if (ca < 0.55) continue;
    float r = acos(clamp(ca, -1.0, 1.0));
    float x = r / uVortexR[k].x;
    float f = x * exp(0.5 * (1.0 - x * x));
    vec3 t = cross(c, d);
    float tl = length(t);
    if (tl > 1e-6) v += t * (uVortex[k].w * f / tl);
  }
  outColor = vec4(v, 1.0);
}
`;

// Pass 2: weather cubemap (thin layered clouds, A01 / R3 / A03 look). Every texel traces its position
// a short way back along the planetary flow (RK2): systems are sheared by the jets and gently wound
// by the lows (comma clouds, cloud streets) without the filament "marbling" of long advection.
// Cover = coherent cloud systems from a two-level domain-warped moisture field (systems 1500-3000 km,
// clusters 300-800 km) + climatology + spiral bands around the lows (log-spiral arms with clear gaps,
// comma envelope, compact centre / eye); their margins are broken into rounded heaps and
// puffs by TRUE billow noise (|noise|: bright lumps, dark creases; the earlier ridged 1-|noise| drew
// bright line networks = lace / worms). The small-scale terms only move the threshold near a system,
// so clear sky stays clear (no salt-and-pepper specks far from any system). A few long frontal bands
// (smooth zero lines of a 2-octave field on the storm tracks / ITCZ) and faint translucent veils next
// to systems complete the picture. Coverage stays continuous; the renderer turns it into cells.
export const GLSL_WEATHER_GEN = /* glsl */`
#define NV ${WEATHER_VORTICES}
uniform int uFace;
uniform float uSize;
uniform uint uSeed;
uniform samplerCube uVel;
uniform float uT;                // advection time
uniform vec4 uVortex[NV];
uniform vec2 uVortexR[NV];
out vec4 outColor;

vec3 lpFaceDir(int f, float sc, float tc) {
  if (f == 0) return vec3(1.0, -tc, -sc);
  if (f == 1) return vec3(-1.0, -tc, sc);
  if (f == 2) return vec3(sc, 1.0, tc);
  if (f == 3) return vec3(sc, -1.0, -tc);
  if (f == 4) return vec3(sc, -tc, 1.0);
  return vec3(-sc, -tc, -1.0);
}
float sq(float x) { return x * x; }
float gn(vec3 p, uint s) { return lpGradNoise(p, 0, s); }
float fbm(vec3 p, int oct, uint s) {
  float sum = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    sum += a * gn(p, s + uint(i) * 131u);
    n += a; a *= 0.5;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
  }
  return sum / n;
}
// billow noise: |gradient noise| -> bright rounded lumps separated by thin dark creases (mean ~0.28)
float lumpy(vec3 p, int oct, uint s) {
  float sum = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += a * abs(gn(p, s + uint(i) * 71u));
    n += a; a *= 0.55;
    p = p * 2.11 + vec3(4.1, -2.3, 7.9);
  }
  return sum / n;
}
vec3 velAt(vec3 q) { return textureLod(uVel, q, 0.0).xyz; }

void main() {
  vec2 st = gl_FragCoord.xy / uSize;
  vec3 d0 = normalize(lpFaceDir(uFace, st.x * 2.0 - 1.0, st.y * 2.0 - 1.0));
  float lat = asin(clamp(d0.y, -1.0, 1.0));
  float alat = abs(lat);

  // ---- short backward trace --------------------------------------------------------------------
  const int K = 12;
  float dt = uT / float(K);
  vec3 q = d0, qS = d0;
  for (int i = 0; i < K; i++) {
    vec3 qm = normalize(q - velAt(q) * (0.5 * dt));
    q = normalize(q - velAt(qm) * dt);
    if (i == 5) qS = q;
  }

  // ---- climatology (sigma units): ITCZ, dry subtropics, storm tracks, dry polar caps ------------
  float itcz = exp(-sq((lat - 0.06) / 0.11));
  float subtrop = exp(-sq((alat - 0.50) / 0.15));
  float storm = exp(-sq((alat - 0.92) / 0.24));
  float polar = smoothstep(1.10, 1.40, alat);
  float clim = 0.45 * itcz - 0.55 * subtrop + 0.35 * storm - 1.8 * polar;

  // ---- two-level domain warp: organic, curved systems -------------------------------------------
  vec3 w1 = vec3(fbm(q * 1.9 + vec3(1.3, 7.1, 2.2), 3, uSeed + 40u),
                 fbm(q * 1.9 + vec3(5.2, -3.3, 8.8), 3, uSeed + 41u),
                 fbm(q * 1.9 + vec3(-6.1, 2.9, -4.4), 3, uSeed + 42u));
  vec3 qw = normalize(q + w1 * 0.20);
  vec3 w2 = vec3(fbm(qw * 6.5 + vec3(-2.1, 3.3, 0.7), 2, uSeed + 43u),
                 fbm(qw * 6.5 + vec3(4.4, 1.9, -5.3), 2, uSeed + 44u),
                 fbm(qw * 6.5 + vec3(0.6, -7.7, 3.9), 2, uSeed + 45u));
  vec3 qw2 = normalize(qw + w2 * 0.045);

  // ---- fields (~zero mean, ~unit standard deviation) ---------------------------------------------
  float nS = fbm(qw * 1.6 + vec3(3.0, 7.0, -1.0), 4, uSeed + 10u) / 0.21;      // systems
  float nC = fbm(qw2 * 6.0 + vec3(-5.0, 2.0, 11.0), 4, uSeed + 11u) / 0.21;    // clusters
  float nF = fbm(qS * 24.0 + vec3(-2.0, 4.0, 1.0), 3, uSeed + 21u) / 0.21;     // texture (flow-stretched)

  // cyclones: spiral cloud bands around each low (log-spiral arms that trail the sense of rotation,
  // wobbled by the cluster noise), a comma-shaped moisture envelope (one side wetter), a compact
  // dense centre and an eye for the small tropical ones. The gaps between the arms stay clear or
  // translucent, so a low never reads as one solid white disc (which looked like snow from orbit).
  float vh = 0.0, vArm = 0.0;
  for (int k = 0; k < NV; k++) {
    vec3 c = uVortex[k].xyz;
    float ca = dot(d0, c);
    if (ca < 0.6) continue;
    float r = acos(clamp(ca, -1.0, 1.0));
    float R0 = uVortexR[k].x;
    vec3 e1 = normalize(cross(abs(c.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), c));
    vec3 e2 = cross(c, e1);
    float th = atan(dot(d0, e2), dot(d0, e1));                 // counter-clockwise seen from outside
    float sgn = uVortex[k].w >= 0.0 ? 1.0 : -1.0;
    float hk = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float ph = 2.0 * (th + sgn * 2.3 * log(max(r, 1e-5) / R0)) + 6.2831853 * hk + 0.9 * nC + 0.35 * nF;
    float band = smoothstep(-0.25, 0.75, cos(ph));            // ~40 % of the azimuth is arm
    float env = exp(-sq(r / (R0 * 2.1)));
    float side = 0.50 + 0.50 * cos(th - 6.2831853 * fract(hk * 7.13));
    float eye = R0 < 0.06 ? smoothstep(0.08 * R0, 0.26 * R0, r) : 1.0;
    float centre = exp(-sq(r / (0.34 * R0)));
    float m = uVortexR[k].y * env * eye;
    // arms with clear gaps; only a small dense centre (a solid white disc read as snow from orbit)
    vh += m * mix(mix(0.25, 0.92, side) * (0.06 + 0.94 * band), 0.95, 0.35 * centre);
    vArm = max(vArm, m * band);
  }
  float low = 0.62 * nS + 0.50 * nC + clim + 0.95 * vh;
  // cumulus heaps (40-120 km) and puffs (12-35 km): true billow, slightly flow-stretched
  float lb = (lumpy(qS * 52.0 + vec3(1.0, -8.0, 4.0), 3, uSeed + 12u) - 0.28) / 0.17;
  float lf = (lumpy(qS * 170.0 + vec3(2.0, 5.0, -3.0), 2, uSeed + 30u) - 0.28) / 0.18;
  float lump = 0.70 * lb + 0.30 * lf;

  // fair-weather patches and cluster decks: coherent systems, lumpy soft margins
  float v = low + 0.30 * lump + 0.12 * nF;
  float cov = smoothstep(0.92, 1.72, v);

  // frontal bands: long smooth zero lines of a 2-octave field on the storm tracks / ITCZ
  float G = fbm(qw * 1.25 + vec3(9.0, -3.0, 5.0), 2, uSeed + 20u) / 0.25;
  float bandL = exp(-sq((G + 0.06 * nF) / 0.20));
  float bandZ = smoothstep(0.25, 0.85, storm + 0.7 * itcz) * (1.0 - polar) * smoothstep(-0.6, 0.6, nS + 0.4 * vh);
  float bv = bandL * bandZ + 0.22 * lump + 0.10 * nC;
  float bandCov = smoothstep(0.62, 1.05, bv);

  // faint translucent veils next to systems (thin stratiform sheets, low optical depth)
  float veil = smoothstep(0.70, 1.40, low + 0.25 * nF) * (1.0 - polar);

  // broken interiors: the inside of a system is not one opaque sheet but heaps and cell clusters
  // with translucent gaps (thin scattered clouds, A01 / R3). The billow noise thins the coverage by
  // up to ~half inside systems, so the far field (orbit) shows mottled heaps instead of a flat white
  // blob and the near field gets more clear gaps between the cells; the margins stay as before.
  float mottle = smoothstep(-1.1, 1.3, lump + 0.35 * nF);
  cov *= mix(0.50, 1.0, mottle) * mix(1.0, 0.85, smoothstep(0.6, 1.0, vArm));
  bandCov *= mix(0.62, 1.0, mottle);

  // ---- combine ---------------------------------------------------------------------------------
  float wS = cov, wB = bandCov * 0.92, wV = veil * 0.24 * (1.0 - cov);
  float coverage = 1.0 - (1.0 - wS) * (1.0 - wB) * (1.0 - wV);
  float sw = wS + wB + wV + 1e-4;
  float core = smoothstep(1.5, 2.6, v);
  // patches: cumuliform, thin (0.5-1.6 km) with thicker cores; bands: stratiform, deeper; veils: thin
  // (cyclone arms: stratiform sheets of moderate depth, denser along the band axis)
  float typeS = mix(clamp(0.78 + 0.10 * lump - 0.30 * core, 0.25, 1.0), 0.42, clamp(vArm * 0.8, 0.0, 0.7));
  float topS = clamp(0.28 + 0.30 * core + 0.06 * lump, 0.20, 0.80);
  float densS = mix(0.28, 0.78, core) * mix(0.80, 1.15, clamp(0.5 + 0.25 * lf, 0.0, 1.0));
  float type = (wS * typeS + wB * 0.38 + wV * 0.15) / sw;
  float top = (wS * topS + wB * clamp(0.58 + 0.08 * nF, 0.45, 0.75) + wV * 0.22) / sw;
  float dens = (wS * densS + wB * mix(0.40, 0.75, bandL) + wV * 0.08) / sw;
  outColor = vec4(clamp(coverage, 0.0, 1.0), clamp(type, 0.0, 1.0), clamp(top, 0.0, 1.0), clamp(dens, 0.0, 1.0));
}
`;

// equirect visualisation of the weather cubemap (dev bench)
export const GLSL_WEATHER_DEBUG = /* glsl */`
uniform samplerCube uCloudWeather;
uniform int uChannel;
uniform vec4 uWindow;     // lon0, lon1, lat0, lat1 (radians)
in vec2 vUv;
out vec4 outColor;
void main() {
  float lon = mix(uWindow.x, uWindow.y, vUv.x);
  float lat = mix(uWindow.z, uWindow.w, vUv.y);
  vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  vec4 w = textureLod(uCloudWeather, d, 0.0);
  vec3 c;
  if (uChannel == 0) c = vec3(w.r);
  else if (uChannel == 1) c = vec3(w.r) * mix(vec3(0.3, 0.5, 1.0), vec3(1.0, 0.9, 0.6), w.g);
  else if (uChannel == 2) c = vec3(w.r * w.b);
  else c = vec3(w.r * w.a);
  outColor = vec4(c, 1.0);
}
`;

export const GLSL_NOISE3D_GEN = /* glsl */`
uniform float uZ;
uniform float uSize;
uniform uint uSeed;
uniform int uKind;
out vec4 outColor;
float worleyFbm(vec3 p, int freq, uint seed) {
  float w1 = 1.0 - lpWorley(p * float(freq), freq, seed);
  float w2 = 1.0 - lpWorley(p * float(freq * 2), freq * 2, seed + 1u);
  float w3 = 1.0 - lpWorley(p * float(freq * 4), freq * 4, seed + 2u);
  return clamp(w1 * 0.625 + w2 * 0.25 + w3 * 0.125, 0.0, 1.0);
}
float perlinFbm(vec3 p, int freq, int oct, uint seed) {
  float s = 0.0, a = 1.0, n = 0.0;
  int f = freq;
  for (int o = 0; o < 8; o++) {
    if (o >= oct) break;
    s += a * lpGradNoise(p * float(f), f, seed + uint(o) * 17u);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}
void main() {
  vec3 p = vec3(gl_FragCoord.xy, uZ + 0.5) / uSize;
  if (uKind == 0) {
    // Perlin-Worley (billowy cells) + Worley fbm octaves
    float pf = clamp(perlinFbm(p, 4, 6, uSeed) * 0.7 + 0.5, 0.0, 1.0);
    float wf = worleyFbm(p, 4, uSeed + 10u);
    float pw = clamp(lpRemap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    outColor = vec4(pw, worleyFbm(p, 6, uSeed + 20u), worleyFbm(p, 12, uSeed + 30u), worleyFbm(p, 24, uSeed + 40u));
  } else {
    outColor = vec4(worleyFbm(p, 3, uSeed + 50u), worleyFbm(p, 6, uSeed + 60u), worleyFbm(p, 12, uSeed + 70u),
                    clamp(perlinFbm(p, 6, 4, uSeed + 80u) * 0.7 + 0.5, 0.0, 1.0));
  }
}
`;

// ---- runtime: density, light, shadow ---------------------------------------------------------
export const GLSL_CLOUD_PARS = /* glsl */`
uniform samplerCube uCloudWeather;
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;
uniform mat3 uCloudRot;          // planet frame -> drifting cloud frame (this sol's phase: cloud time = sol time)
uniform vec3 uCloudOffA;          // slow evolution offsets (noise-tile units)
uniform vec3 uCloudOffB;
// fix round 3 (QP-08): the cloud field is a pure function of the sol time (0..24). Over the sol's last
// hour it dissolves into the next sol's phase (cloud time - 24 = the field at sol time 0): the weather is
// blended in coverage space and the shape / detail noises with a variance-preserving mix, so one coherent
// field evolves (no double image) and the clock wrap has no jump. uCloudMix = 0 otherwise (one fetch each).
uniform mat3 uCloudRot2;
uniform vec3 uCloudOffA2;
uniform vec3 uCloudOffB2;
uniform float uCloudMix;
uniform float uCloudCoverage;     // global coverage multiplier (1 = authored weather)
uniform float uCloudSigma;        // extinction (1/m) at density 1

#define LP_CL_SHAPE_TILE 9000.0
#define LP_CL_DETAIL_TILE 1800.0
#define LP_CL_WEATHER_TEXEL 2600.0
#define LP_CL_THICK (LP_CLOUD_TOP - LP_CLOUD_BOT)

vec4 lpCloudWeatherAt(vec3 pr, float footprint) {
  return textureLod(uCloudWeather, pr, max(0.0, log2(max(footprint, 1.0) / LP_CL_WEATHER_TEXEL)));
}
// weather at a PLANET-frame position, both sol phases blended (use this, not uCloudRot * p, outside
// lpCloudBase)
vec4 lpCloudWeatherP(vec3 p, float footprint) {
  vec4 w = lpCloudWeatherAt(uCloudRot * p, footprint);
  if (uCloudMix > 0.0) w = mix(w, lpCloudWeatherAt(uCloudRot2 * p, footprint), uCloudMix);
  return w;
}
// variance-preserving blend of two independent noise samples (cells keep their contrast mid-dissolve)
vec4 lpCloudNoiseMix(vec4 a, vec4 b, float m) {
  return clamp(0.5 + (mix(a, b, m) - 0.5) * inversesqrt(max((1.0 - m) * (1.0 - m) + m * m, 0.5)), 0.0, 1.0);
}
vec3 gLpClPr2;                    // phase-2 frame position of the last lpCloudBase sample (uCloudMix > 0)
// coverage with the global multiplier: > 1 grows existing clouds and fills gaps, < 1 thins them
float lpCoverageMul(float c) {
  return uCloudCoverage >= 1.0 ? 1.0 - pow(1.0 - c, uCloudCoverage) : c * uCloudCoverage;
}

// base density (no detail erosion). Outputs: pr drifting-frame position, hf height fraction in the
// layer, w.x coverage, w.y type, w.z top fraction, w.w optical density scale. The signed field
// (inside > 0) and its ramp width are kept in globals for lpCloudDetail, which displaces the
// iso-surface with the Worley detail (crisp, billowy cumulus edges instead of soft density ramps).
float gLpClField;
float gLpClRamp;
float gLpClFar;
float gLpClHn;
// fraction of the layer area the near-field cells fill at weather coverage c (the far-field
// optical depth uses the same fraction so the LOD transition keeps the mean opacity)
float lpCloudFill(float c, float type) { return clamp(c * mix(0.98, 0.86, type), 0.0, 0.985); }
float lpCloudBase(vec3 p, float h, float footprint, out vec3 pr, out float hf, out vec4 w) {
  hf = (h - LP_CLOUD_BOT) * (1.0 / LP_CL_THICK);
  pr = vec3(0.0); w = vec4(0.0);
  gLpClField = -1.0; gLpClRamp = 1.0; gLpClFar = 0.0; gLpClHn = 0.0;
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  pr = uCloudRot * p;
  w = lpCloudWeatherAt(pr, footprint);
  if (uCloudMix > 0.0) { gLpClPr2 = uCloudRot2 * p; w = mix(w, lpCloudWeatherAt(gLpClPr2, footprint), uCloudMix); }
  w.x = clamp(lpCoverageMul(w.x), 0.0, 1.0);
  if (w.x < 0.006) return 0.0;
  float topW = mix(0.16, 1.0, w.z);
  if (hf >= min(topW * mix(1.06, 1.30, w.y), 1.0)) return 0.0;
  float lodA = log2(max(footprint, 1.0) / (LP_CL_SHAPE_TILE / 128.0));
  float fk = smoothstep(2.0, 5.0, lodA);                 // 0 near .. 1 far (pixel >> cells)
  gLpClFar = fk;
  // far: the mean over the cells (soft function of coverage), flat-topped at the weather top
  float hnF = hf / max(topW, 0.05);
  float profF = smoothstep(0.0, 0.12, hnF) * (1.0 - smoothstep(0.80, 1.0, hnF));
  // mean optical depth of the cell field, T = (1 - fill) + fill * exp(-tauCell) with tauCell the optical
  // depth of one cell column, so thin clouds stay as translucent from orbit as up close. The callers
  // multiply by the density scale w.w, which is divided out here (integral of profF = 0.84 * thickness * top).
  float fillF = lpCloudFill(w.x, w.y);
  float tauCell = uCloudSigma * w.w * LP_CL_THICK * topW * 0.5;
  float odFar = -log(max(1.0 - fillF * (1.0 - exp(-tauCell)), 1e-4));
  float dFar = profF * odFar / (uCloudSigma * 2100.0 * max(topW, 0.2) * max(w.w, 0.02));
  if (fk >= 1.0) { gLpClHn = hnF; return dFar; }
  // near: billowy Perlin-Worley cells (0.4-2 km) eroded by the Worley octaves
  vec4 n = textureLod(uCloudShape, pr * (1.0 / LP_CL_SHAPE_TILE) + uCloudOffA, max(lodA, 0.0));
  if (uCloudMix > 0.0) n = lpCloudNoiseMix(n, textureLod(uCloudShape, gLpClPr2 * (1.0 / LP_CL_SHAPE_TILE) + uCloudOffA2, max(lodA, 0.0)), uCloudMix);
  float wfb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float s = clamp(lpRemap(n.r, wfb - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  // cell tops: cumulus cells differ a lot in height (towers next to flat cells), decks are level
  float top = topW * mix(mix(0.86, 1.04, n.r), mix(0.50, 1.30, n.g * 0.6 + n.r * 0.4), w.y);
  float hn = hf / max(top, 0.05);
  gLpClHn = hn;
  if (hn >= 1.0) return fk * dFar;
  // vertical profile: crisp flat base (soft for veils), rounded cumulus domes, flat-topped decks
  float dome = sqrt(max(1.0 - hn * hn, 0.0));
  float flatS = 1.0 - smoothstep(0.55, 1.0, hn);
  float prof = smoothstep(0.0, mix(0.20, 0.035, w.y), hn) * mix(flatS, dome, w.y);
  s = mix(mix(0.60, 1.0, s), s, w.y);                    // stratiform: smoother, less eroded
  // coverage -> iso level; cumulus fields always keep gaps between the cells
  float covE = w.x * mix(0.94, 0.70, w.y);
  float field = s * prof - (1.0 - covE);
  float ramp = mix(0.36, 0.06, w.y) * (1.0 + 2.5 * smoothstep(0.0, 4.0, lodA));
  gLpClField = field; gLpClRamp = ramp;
  // liquid water grows with height inside a cell (dense cauliflower tops, thinner bases)
  float lwc = mix(0.55, 1.0, smoothstep(0.0, 0.7, hn) * w.y + (1.0 - w.y) * 0.8);
  float dNear = smoothstep(0.0, ramp, field) * lwc;
  return mix(dNear, dFar, fk);
}
// displace the iso-surface with the Worley detail: billowy cauliflower tops, torn wispy bases;
// fades out with distance (back to the base density)
float lpCloudDetail(float d, vec3 pr, float hf, vec4 w, float footprint) {
  float lodB = log2(max(footprint, 1.0) / (LP_CL_DETAIL_TILE / 128.0));
  if (lodB >= 5.0 || d <= 0.0 || gLpClFar >= 1.0) return d;
  vec4 nd = textureLod(uCloudDetail, pr * (1.0 / LP_CL_DETAIL_TILE) + uCloudOffB, max(lodB, 0.0));
  // gLpClPr2 belongs to the lpCloudBase call that produced d (callers run base -> detail back to back)
  if (uCloudMix > 0.0) nd = lpCloudNoiseMix(nd, textureLod(uCloudDetail, gLpClPr2 * (1.0 / LP_CL_DETAIL_TILE) + uCloudOffB2, max(lodB, 0.0)), uCloudMix);
  float dfbm = nd.r * 0.625 + nd.g * 0.25 + nd.b * 0.125;
  float hn = clamp(gLpClHn, 0.0, 1.0);
  float m = mix(1.0 - dfbm, dfbm, clamp(hn * 2.5, 0.0, 1.0));     // wispy below, billowy above
  float fade = 1.0 - smoothstep(3.0, 5.0, lodB);
  float ero = m * mix(0.10, 0.17, w.y) * fade;
  float lwc = mix(0.55, 1.0, smoothstep(0.0, 0.7, hn) * w.y + (1.0 - w.y) * 0.8);
  float dN = smoothstep(0.0, gLpClRamp, gLpClField - ero) * lwc;
  return mix(dN, d, gLpClFar);
}
// full density (0..1, times the optical density scale) at planet-relative position p
float lpCloudDensity(vec3 p, float h, float footprint, bool detail) {
  vec3 pr; float hf; vec4 w;
  float d = lpCloudBase(p, h, footprint, pr, hf, w);
  if (d <= 0.0) return 0.0;
  if (detail) d = lpCloudDetail(d, pr, hf, w, footprint);
  return d * w.w;
}
`;

// light + integration, used by the cloud pass (needs atmosphere core + MS + march chunks)
export const GLSL_CLOUD_LIGHT = /* glsl */`
uniform sampler2D uLpEmission;     // control-map night emission (equirect, mipmapped)
uniform float uCityGlow;           // absolute irradiance of light pollution at emission = 1

// optical depth towards the sun (cone of 5 samples, coarse density)
float lpCloudLightOD(vec3 p, float h, float mus, float footprint) {
  float dist = clamp((LP_CLOUD_TOP - h) / max(mus, 0.05), 80.0, 18000.0);
  float od = 0.0, tPrev = 0.0;
  for (int i = 0; i < 5; i++) {
    float tn = dist * pow((float(i) + 1.0) / 5.0, 1.7);
    float tm = 0.5 * (tPrev + tn);
    vec3 q = p + uSunDir * tm;
    float hq = h + tm * mus + tm * tm * (0.5 / LP_R);
    od += lpCloudDensity(q, hq, max(footprint, tm * 0.25), false) * (tn - tPrev);
    tPrev = tn;
  }
  return od * uCloudSigma;
}

vec2 lpEquirectUV(vec3 d) {
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon * 0.15915494 + 0.5, 0.5 - lat * 0.31830989);
}

// direct-sun in-scattering per unit extinction (unit sun): light march, multiple-scattering octave
// sum (Wrenninge) with a two-lobe HG phase (silver lining forward, soft back-scatter), powder
// darkening of the dense interior seen from the sun side
vec3 lpCloudSunTerm(vec3 p, float h, float mus, float nu, vec3 sunT, float dens, float footprint) {
  if (max(sunT.r, max(sunT.g, sunT.b)) <= 1e-6) return vec3(0.0);
  float od = lpCloudLightOD(p, h, mus, footprint);
  float a = 1.0, b = 1.0, c = 1.0, ms = 0.0;
  for (int o = 0; o < 6; o++) {
    float ph = mix(lpPhaseHG(nu, -0.30 * c), lpPhaseHG(nu, 0.82 * c), 0.55);
    ms += a * ph * exp(-b * od);
    a *= 0.62; b *= 0.26; c *= 0.55;
  }
  float powder = 1.0 - 0.45 * exp(-od * 1.4 - dens * 2.5);
  return sunT * (ms * mix(1.0, powder, 0.4 + 0.6 * nu * nu) * 2.0);
}
// city light reaching the cloud base from below (absolute irradiance, night side only). Local: the
// emission map (10 km texels) is blurred over ~30-80 km only, and squared, so a cloud deck picks up a
// soft glow right over the light cores and stays dark over the dark country between them (§5 02)
vec3 lpCityGlow(vec3 up, float mus) {
  float night = smoothstep(0.03, -0.10, mus);
  if (night <= 0.0 || uCityGlow <= 0.0) return vec3(0.0);
  vec2 uv = lpEquirectUV(up);
  float e = textureLod(uLpEmission, uv, 1.5).r * 0.65 + textureLod(uLpEmission, uv, 3.0).r * 0.35;
  return vec3(1.0, 0.70, 0.42) * (e * e * uCityGlow * night);
}
`;

// shadow maps (local tangent-plane map near the ground, global equirect map from orbit)
export const GLSL_CLOUD_SHADOW_GEN = /* glsl */`
uniform int uMode;            // 0 local, 1 global
uniform vec2 uSizePx;
uniform vec3 uAnchor;          // local: anchor on the mid-cloud sphere (planet frame)
uniform vec3 uAxisE;
uniform vec3 uAxisN;
uniform float uExtent;         // local: full width in metres
uniform vec3 uSunDir;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSizePx;
  vec3 q;
  float texel;
  if (uMode == 0) {
    vec2 xy = (uv - 0.5) * uExtent;
    q = normalize(uAnchor + uAxisE * xy.x + uAxisN * xy.y) * (LP_R + LP_CLOUD_MID);
    texel = uExtent / uSizePx.x;
  } else {
    float lon = (uv.x - 0.5) * 6.283185307;
    float lat = (0.5 - uv.y) * 3.141592654;
    q = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)) * (LP_R + LP_CLOUD_MID);
    texel = 6.283185307 * LP_R / uSizePx.x;
  }
  vec3 up = normalize(q);
  float mus = dot(up, uSunDir);
  // vertical coverage (for ambient dimming under decks): optical depth straight up, mapped to 0..1
  float odV = 0.0;
  for (int i = 0; i < 6; i++) {
    float hh = LP_CLOUD_BOT + (float(i) + 0.5) * (LP_CL_THICK / 6.0);
    odV += lpCloudDensity(up * (LP_R + hh), hh, max(texel, 60.0), false);
  }
  odV *= (LP_CL_THICK / 6.0) * uCloudSigma;
  float covV = 1.0 - exp(-odV * 0.5);
  float T = 1.0;
  if (mus > -0.08) {
    // slant path through the layer along the sun direction, centred on q
    float half_ = 0.5 * LP_CL_THICK / max(mus, 0.05);
    half_ = min(half_, 45000.0);
    const int N = 28;
    float od = 0.0;
    for (int i = 0; i < N; i++) {
      float s = -half_ + (float(i) + 0.5) * (2.0 * half_ / float(N));
      vec3 p = q + uSunDir * s;
      float hp = LP_CLOUD_MID + s * mus + s * s * (0.5 / LP_R);
      od += lpCloudDensity(p, hp, max(texel, 60.0), false);
    }
    od *= (2.0 * half_ / float(N)) * uCloudSigma * 0.8;   // detail erosion thins the rendered edges
    // forward scattering: direct sun under a cloud is not fully lost (diffuse light under thin cloud)
    T = mix(exp(-od), exp(-od * 0.22), 0.16);
  }
  outColor = vec4(T, covV, 0.0, 1.0);
}
`;

// analytic cloud-shell intervals along a ray, clipped to [t0, t1] (no samplers; shared by the
// half-resolution cloud pass and the composite)
export const GLSL_CLOUD_INTERVALS = /* glsl */`
int lpCloudIntervals(float r, float h, float mu, float t0, float t1, out vec2 i0, out vec2 i1) {
  i0 = vec2(0.0); i1 = vec2(0.0);
  vec2 to = lpRaySphere(r, h, mu, LP_CLOUD_TOP);
  if (!(to.x <= to.y) || to.y <= 0.0) return 0;
  vec2 ti = lpRaySphere(r, h, mu, LP_CLOUD_BOT);
  bool hitI = ti.x <= ti.y && ti.y > 0.0;
  vec2 a = vec2(-1.0), b = vec2(-1.0);
  float o0 = max(to.x, 0.0);
  if (hitI) {
    if (ti.x > 0.0) { a = vec2(o0, ti.x); b = vec2(ti.y, to.y); }
    else { a = vec2(ti.y, to.y); }
  } else {
    a = vec2(o0, to.y);
  }
  int n = 0;
  a = vec2(max(a.x, t0), min(a.y, t1));
  b = vec2(max(b.x, t0), min(b.y, t1));
  if (a.y > a.x) { i0 = a; n = 1; }
  if (b.y > b.x) { if (n == 0) i0 = b; else i1 = b; n++; }
  return n;
}
`;
