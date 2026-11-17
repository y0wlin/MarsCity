// Atmosphere model GLSL (Hillaire 2020 style: transmittance + multiple-scattering LUTs, per-pixel
// ray marching). OWNER: atmosphere agent. Requires the #defines from atmosphere/model.js
// (atmosphereDefines()) and GLSL_MATH from common.glsl.js.
//
// Conventions: positions are relative to the planet centre; a ray is described by the radius r
// of its origin, its PRECISE altitude h (passed separately: float32 cannot resolve h from r at
// planetary radii), mu = cos(zenith angle) and nu = dot(dir, sun). Distances in metres.
// All radiances are for unit sun illuminance; multiply by uLpSunE (sun colour * illuminance).

// --- medium, phase, geometry (no samplers) ---------------------------------------------------
export const GLSL_ATMO_MEDIUM = /* glsl */`
void lpMedium(float h, out vec3 scatR, out vec3 scatM, out vec3 ext) {
  float hc = max(h, -6000.0);
  float dR = exp(-hc * LP_HR_INV);
  float dM = exp(-hc * LP_HM_INV);
  float dO = max(0.0, 1.0 - abs(hc - LP_OZ_C) / LP_OZ_HW);
  scatR = LP_BETA_R * dR;
  scatM = LP_BETA_MS * dM;
  ext = scatR + LP_BETA_ME * dM + LP_BETA_O * dO;
}
float lpPhaseR(float nu) { return 0.05968310366 * (1.0 + nu * nu); }
float lpPhaseM(float nu) {
  const float g = LP_MIE_G;
  const float g2 = g * g;
  return 0.1193662073 * (1.0 - g2) * (1.0 + nu * nu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-5), 1.5));
}
float lpPhaseHG(float mu, float g) {
  float g2 = g * g;
  return 0.0795774715 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-5), 1.5);
}

// Ray from radius r (altitude h) with cos-zenith mu against the sphere at altitude hs.
// Returns (tNear, tFar); a miss returns tNear > tFar.
vec2 lpRaySphere(float r, float h, float mu, float hs) {
  float rs = LP_R + hs;
  float c = (h - hs) * (r + rs);
  float b = r * mu;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e30, -1e30);
  float s = sqrt(disc);
  float t0, t1;
  if (b > 0.0) { t0 = -b - s; t1 = t0 != 0.0 ? c / t0 : 0.0; }
  else { t1 = -b + s; t0 = t1 != 0.0 ? c / t1 : 0.0; }
  return vec2(min(t0, t1), max(t0, t1));
}

// altitude of the point at distance t along the ray (stable, no r - R cancellation)
float lpAltAt(float r, float h, float mu, float t, out float rs) {
  float q = h * (2.0 * LP_R + h) + t * t + 2.0 * r * mu * t;   // rs^2 - R^2
  rs = sqrt(max(LP_R * LP_R + q, 1.0));
  return q / (rs + LP_R);
}
`;

// --- LUT lookups: needs uLpAtlas (transmittance + SH irradiance) ------------------------------
export const GLSL_ATMO_LUT = /* glsl */`
uniform sampler2D uLpAtlas;

vec2 lpTransUV(float r, float h, float mu) {
  h = clamp(h, 0.0, LP_ATMO_H);
  r = LP_R + h;
  float rho = sqrt(max(h * (2.0 * LP_R + h), 0.0));
  float disc = r * r * (mu * mu - 1.0) + LP_RT * LP_RT;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = LP_ATMO_H - h;
  float dmax = rho + LP_HT;
  float xmu = clamp((d - dmin) / max(dmax - dmin, 1e-3), 0.0, 1.0);
  float xr = clamp(rho / LP_HT, 0.0, 1.0);
  return vec2((0.5 + xmu * (LP_TRANS_W - 1.0)) / LP_ATLAS_W, (0.5 + xr * (LP_TRANS_H - 1.0)) / LP_ATLAS_H);
}
// transmittance from (r,h) along mu to the top of the atmosphere (ray must not hit the ground)
vec3 lpTransmittance(float r, float h, float mu) {
  return texture(uLpAtlas, lpTransUV(r, h, mu)).rgb;
}
// cos of the geometric horizon seen from altitude h (negative)
float lpHorizonMu(float r, float h) {
  return -sqrt(max(h * (2.0 * LP_R + h), 0.0)) / r;
}
// sun transmittance at (r,h) for cos-sun-zenith mus, with the sun disc partially below the horizon
vec3 lpSunTransmittance(float r, float h, float mus) {
  h = max(h, 0.0);
  float muh = lpHorizonMu(LP_R + h, h);
  float vis = smoothstep(-LP_SUN_SIN, LP_SUN_SIN, mus - muh);
  if (vis <= 0.0) return vec3(0.0);
  return lpTransmittance(r, h, max(mus, muh + 1e-4)) * vis;
}

// sky irradiance from the SH LUT (pre-convolved, symmetric about the sun's vertical plane; sky only,
// the ground bounce is lpGroundIrradiance * local albedo * (1 - n.up) / 2, added by the callers).
// nl = normal in the local frame (x: towards sun azimuth, y: perpendicular, z: up).
vec3 lpIrradianceSH(float h, float mus, vec3 nl) {
  float xm = clamp(0.5 + 0.5 * sign(mus) * sqrt(abs(mus)), 0.0, 1.0);
  float xh = sqrt(clamp(h / LP_SH_HMAX, 0.0, 1.0));
  float u0 = 0.5 + xm * (LP_SH_MU - 1.0);
  float v = (LP_TRANS_H + 0.5 + xh * (LP_SH_ALT - 1.0)) / LP_ATLAS_H;
  vec4 t0 = texture(uLpAtlas, vec2(u0 / LP_ATLAS_W, v));
  vec4 t1 = texture(uLpAtlas, vec2((u0 + LP_SH_MU) / LP_ATLAS_W, v));
  vec4 t2 = texture(uLpAtlas, vec2((u0 + 2.0 * LP_SH_MU) / LP_ATLAS_W, v));
  vec4 t3 = texture(uLpAtlas, vec2((u0 + 3.0 * LP_SH_MU) / LP_ATLAS_W, v));
  vec4 t4 = texture(uLpAtlas, vec2((u0 + 4.0 * LP_SH_MU) / LP_ATLAS_W, v));
  vec3 c0 = t0.rgb, c1 = vec3(t0.a, t1.rg), c2 = vec3(t1.ba, t2.r);
  vec3 c3 = t2.gba, c4 = t3.rgb, c5 = vec3(t3.a, t4.rg);
  float x = nl.x, y = nl.y, z = nl.z;
  vec3 E = c0 * 0.282095 + c1 * (0.488603 * z) + c2 * (0.488603 * x)
         + c3 * (0.315392 * (3.0 * z * z - 1.0)) + c4 * (1.092548 * x * z) + c5 * (0.546274 * (x * x - y * y));
  return max(E, vec3(0.0));
}
// horizontal irradiance of the ground (direct sun + sky, unit sun) for cos sun zenith mus, from the
// ground row of the atlas (x in [LP_GROUND_X, LP_GROUND_X + LP_SH_MU), y = 0)
vec3 lpGroundIrradiance(float mus) {
  float xg = clamp(0.5 + 0.5 * sign(mus) * sqrt(abs(mus)), 0.0, 1.0);
  return texture(uLpAtlas, vec2((LP_GROUND_X + 0.5 + xg * (LP_SH_MU - 1.0)) / LP_ATLAS_W, 0.5 / LP_ATLAS_H)).rgb;
}
// DC (average) term only: cheap brightness of the sky dome
vec3 lpIrradianceDC(float h, float mus) {
  float xm = clamp(0.5 + 0.5 * sign(mus) * sqrt(abs(mus)), 0.0, 1.0);
  float xh = sqrt(clamp(h / LP_SH_HMAX, 0.0, 1.0));
  float u0 = 0.5 + xm * (LP_SH_MU - 1.0);
  float v = (LP_TRANS_H + 0.5 + xh * (LP_SH_ALT - 1.0)) / LP_ATLAS_H;
  return texture(uLpAtlas, vec2(u0 / LP_ATLAS_W, v)).rgb * 0.282095;
}
vec3 lpLocalFrameN(vec3 up, vec3 sunDir, vec3 n) {
  float mus = dot(up, sunDir);
  vec3 sx = sunDir - up * mus;
  float l = length(sx);
  sx = l > 1e-5 ? sx / l : normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 sy = cross(up, sx);
  return vec3(dot(n, sx), dot(n, sy), dot(n, up));
}
// irradiance (unit sun) on a surface with normal n at altitude h, local up, sun direction
vec3 lpSkyIrradiance(vec3 up, vec3 sunDir, float h, vec3 n) {
  return lpIrradianceSH(max(h, 0.0), dot(up, sunDir), lpLocalFrameN(up, sunDir, n));
}
`;

// medium + LUT lookups
export const GLSL_ATMO_CORE = GLSL_ATMO_MEDIUM + GLSL_ATMO_LUT;

// --- multiple scattering LUT lookup (composite / LUT generation only) ------------------------
export const GLSL_ATMO_MS = /* glsl */`
uniform sampler2D uLpMsLut;
vec3 lpMultiScat(float h, float mus) {
  float xh = sqrt(clamp(h / LP_ATMO_H, 0.0, 1.0));
  vec2 uv = vec2(0.5 + (mus * 0.5 + 0.5) * (LP_MS_SIZE - 1.0), 0.5 + xh * (LP_MS_SIZE - 1.0)) / LP_MS_SIZE;
  return texture(uLpMsLut, uv).rgb;
}
`;

// --- in-scattering integrator ----------------------------------------------------------------
// March [t0,t1] along a ray (origin radius r, altitude h, cos-zenith mu, origin cos-sun-zenith
// mus0, nu = dot(dir, sun)). Sample t_i = t0 + seg * f(i)^distExp, jittered inside each step.
// Accumulates in-scattered radiance L (unit sun) weighted by the running transmittance T.
export const GLSL_ATMO_MARCH = /* glsl */`
void lpIntegrate(float r, float h, float mu, float mus0, float nu, float t0, float t1, int N, float jitter, float distExp, inout vec3 L, inout vec3 T) {
  float seg = t1 - t0;
  if (seg <= 0.0 || N <= 0) return;
  float pR = lpPhaseR(nu), pM = lpPhaseM(nu);
  float tPrev = t0;
  float fN = float(N);
  for (int i = 0; i < 128; i++) {
    if (i >= N) break;
    float tNext = t0 + seg * pow((float(i) + 1.0) / fN, distExp);
    float dt = tNext - tPrev;
    float t = tPrev + dt * jitter;
    float rs;
    float hs = lpAltAt(r, h, mu, t, rs);
    float muss = clamp((r * mus0 + t * nu) / rs, -1.0, 1.0);
    vec3 sR, sM, ext;
    lpMedium(hs, sR, sM, ext);
    vec3 sunT = lpSunTransmittance(rs, hs, muss);
    vec3 ms = lpMultiScat(max(hs, 0.0), muss);
    vec3 S = sR * (sunT * pR + ms) + sM * (sunT * pM + ms);
    vec3 Ts = exp(-ext * dt);
    L += T * (S - S * Ts) / max(ext, vec3(1e-20));
    T *= Ts;
    tPrev = tNext;
  }
}
`;

// --- sky-view LUT parameterisation (camera inside the atmosphere) -----------------------------
// u = |azimuth relative to the sun| / pi (the sky is symmetric about the sun's vertical plane),
// v = 0.5 at the geometric horizon, sqrt-concentrated towards it, 1 = zenith, 0 = nadir.
export const GLSL_SKYVIEW = /* glsl */`
vec2 lpSkyViewUV(float mu, float muh, float azim) {
  float el = asin(clamp(mu, -1.0, 1.0)), elh = asin(clamp(muh, -1.0, 1.0));
  float ang = el - elh;
  float v = ang >= 0.0 ? 0.5 + 0.5 * sqrt(ang / (0.5 * LP_PI - elh)) : 0.5 - 0.5 * sqrt(-ang / (0.5 * LP_PI + elh));
  return vec2(clamp(azim / LP_PI, 0.0, 1.0), clamp(v, 0.0, 1.0));
}
// inverse: (u, v) -> (cos zenith, azimuth)
vec2 lpSkyViewDir(vec2 uv, float muh) {
  float elh = asin(clamp(muh, -1.0, 1.0));
  float ang = uv.y >= 0.5 ? pow((uv.y - 0.5) * 2.0, 2.0) * (0.5 * LP_PI - elh) : -pow((0.5 - uv.y) * 2.0, 2.0) * (0.5 * LP_PI + elh);
  return vec2(sin(elh + ang), uv.x * LP_PI);
}
`;
