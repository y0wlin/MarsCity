// Physical parameters of the terraformed Martian atmosphere + photometric units.
// OWNER: atmosphere agent. Everything that shades light in the scene reads these numbers
// (LUT generation, sky/aerial-perspective composite, cloud lighting, material patch).
//
// Units: metres; scattering coefficients in 1/m; radiometric quantities are in "scene units"
// where the extraterrestrial sun illuminance is SUN_ILLUMINANCE (a white Lambertian surface
// facing the zenith sun at the top of the atmosphere has radiance SUN_ILLUMINANCE / pi).
// The output pass applies auto exposure; day exposure ~0.4, night exposure ~16-24.
import { R, ATMO_HEIGHT, CLOUD_ALT, CLOUD_TOP } from '../../core/constants.js';

export const ATMO = {
  groundRadius: R,
  topRadius: R + ATMO_HEIGHT,
  // Rayleigh: Earth-like N2/O2 air in a slightly thicker terraformed column (~Earth's sea-level
  // optical depth): a clear blue zenith and a blue sky fill in the shade (阴面留得住蓝色).
  rayleighScattering: [6.10e-6, 14.17e-6, 32.5e-6],
  rayleighScaleHeight: 8500,
  // Mie: fine reddish dust + water haze (a light haze, optical depth ~0.016): whitens the sky
  // irradiance (the shade reads cool, not cyan) and the horizon; absorption stronger in blue (iron
  // oxide dust) keeps the horizon haze and the low sun warm. Scale height ~1.5 km.
  mieScattering: [1.05e-5, 1.05e-5, 1.05e-5],
  mieAbsorption: [0.55e-6, 0.78e-6, 1.32e-6],
  mieScaleHeight: 1500,
  mieG: 0.8,
  // Ozone (terraformed O2 atmosphere has a UV shield) -> blue hour / zenith colour at twilight.
  // Fix round 2 (QQ-07): the red channel stands for 580-700 nm, i.e. it includes the Chappuis peak
  // (~600 nm), not just the weak 680 nm value (0.65e-6): with the 680 nm value an RGB model turns the
  // twilight zenith magenta (R/B 0.90 at sun -6.8 deg); with ~2.2e-6 it is the blue-violet of a real
  // blue hour (R/B ~0.53) over an orange horizon, while the noon sky is unchanged (short ozone path;
  // SUN_COLOR red +2 % keeps the noon white balance).
  ozoneAbsorption: [2.2e-6, 1.881e-6, 0.085e-6],
  ozoneCenter: 25000,
  ozoneHalfWidth: 15000,
  // bare red regolith (reference; the sky-irradiance SH LUT is sky-only since fix round 1 -- the
  // ground bounce is added analytically per fragment with the LOCAL albedo, see GROUND_BOUNCE)
  groundAlbedo: [0.30, 0.165, 0.095],
  // planet-average albedo (land + inner seas + cities) for the multiple-scattering LUT
  msAlbedo: [0.20, 0.13, 0.095],
};

// Effective albedo of the ground around a lit surface for the ground bounce ("背阴处接受蓝天和红土的
// 反射"): what a down-facing surface sees below it, shadows of the neighbourhood included. The
// atmosphere system mixes these by the land cover at the camera (world/fields.js) and publishes the
// result as uLpGroundAlbedo; `fallback` is used until the fields are available.
export const GROUND_BOUNCE = {
  fallback: [0.12, 0.106, 0.092],     // desaturated warm grey
  urban: [0.118, 0.104, 0.09],        // pale paving + roofs with a trace of red dust, street canyons in shadow
  farm: [0.075, 0.092, 0.058],        // crops, canal banks
  rock: [0.21, 0.125, 0.078],         // red regolith / bare rock (canyon walls glow red)
  ice: [0.46, 0.48, 0.52],            // frost / ice fields
  water: [0.04, 0.05, 0.06],
  orbit: [0.16, 0.115, 0.085],        // planet average (orbit views, cloud bases)
};

export const SUN_ILLUMINANCE = 8.0;             // extraterrestrial, scene units
// Fix round 1: the camera is white-balanced to local mid-day daylight (sun + sky), so the sun at the
// top of the atmosphere is set slightly cool: after the Rayleigh / dust transmittance and with the blue
// sky added, white ceramics read white at noon (horizontal sun + sky ~ R/G 1.03, B/G 0.985), while
// the low sun stays warm (R/G ~1.2 at 15 deg, ~1.3 at 6 deg) and the zenith is a clear blue.
export const SUN_COLOR = [1.0, 1.0, 1.03];
export const SUN_ANGULAR_RADIUS = 0.00305;      // rad (0.35 deg disc seen from 1.52 AU)

// Night-sky irradiance on a horizontal surface (airglow + starlight + Phobos/Deimos; art-directed,
// several times brighter than a physical Martian night) so the night side stays low but readable
// (A02: dark terrain still shows relief between the city lights).
// Fix round 1: cooler and ~1/3 darker than before (the red ground read as dim daylight in S02), the
// lighting patch adds a soft directional part from the sun's azimuth so relief reads (A02).
export const NIGHT_AMBIENT = [0.018, 0.026, 0.056];
// Fix round 2 (QQ-05): the night sky light seen from the ground (camera < ~4 km above ground, blended
// back to NIGHT_AMBIENT by ~60 km): ~2x the luminance (it is seen through the ~4.5x lower ground night
// exposure) and much less blue (a city's sky is not moonlit navy): facades and plazas away from lamps read
// ~2-3x darker than in round 1 (dark navy-grey ~13,17,25 sRGB, still with gradation) and no longer blue,
// so artificial light carries the night.
export const NIGHT_AMBIENT_GROUND = [0.040, 0.050, 0.070];
// Airglow layer (O 557.7 nm green + blue continuum) at ~95 km: a faint line at the night limb seen
// from space, a faint brightening towards the horizon at night from the ground.
export const AIRGLOW = { color: [0.22, 0.62, 0.56], radiance: 0.00018, alt: 94000, halfWidth: 4000 };

// Emissive unit: material emissive (colour * emissiveIntensity) is multiplied by this so that
// emissive = 1.0 reads as a typical lit window / street lamp at the night exposure (~0.6-0.7
// display value). Use 3-10 for very bright cores (they bloom), 0.2-0.5 for dim interiors.
// Fix round 2: this is the unit by day and from altitude; at night near the ground the shared uniform
// uLpEmissiveScale = EMISSIVE_SCALE * exposurePrior.emissiveGain (~4.5x, see exposure.js).
export const EMISSIVE_SCALE = 0.05;

export const CLOUD = {
  bottom: CLOUD_ALT,
  top: CLOUD_TOP,
  mid: (CLOUD_ALT + CLOUD_TOP) * 0.5,
};

// LUT sizes / layout. The "atlas" packs the transmittance LUT and the sky-irradiance SH LUT so
// patched materials only need one sampler for the whole atmosphere model.
export const LUT = {
  transW: 256, transH: 64,
  msSize: 32,
  shMu: 64, shAlt: 8, shTexels: 5, shMaxAlt: 30000,
  atlasW: 320, atlasH: 72,         // trans at y in [0,64), SH at y in [64,72)
  groundX: 256,                    // ground irradiance row (64 x 1, vs mu_s) at x in [256,320), y = 0
};

/** GLSL #defines describing the atmosphere (shared by every shader that includes the model). */
export function atmosphereDefines() {
  const a = ATMO;
  const v3 = (v) => `vec3(${v.map((x) => x.toExponential(6)).join(', ')})`;
  const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : x.toPrecision(9));
  const mieExt = a.mieScattering.map((s, i) => s + a.mieAbsorption[i]);
  const HT = Math.sqrt(a.topRadius * a.topRadius - a.groundRadius * a.groundRadius);
  return [
    `#define LP_R ${f(a.groundRadius)}`,
    `#define LP_RT ${f(a.topRadius)}`,
    `#define LP_ATMO_H ${f(a.topRadius - a.groundRadius)}`,
    `#define LP_HT ${f(HT)}`,
    `#define LP_HR_INV ${f(1 / a.rayleighScaleHeight)}`,
    `#define LP_HM_INV ${f(1 / a.mieScaleHeight)}`,
    `#define LP_BETA_R ${v3(a.rayleighScattering)}`,
    `#define LP_BETA_MS ${v3(a.mieScattering)}`,
    `#define LP_BETA_ME ${v3(mieExt)}`,
    `#define LP_BETA_O ${v3(a.ozoneAbsorption)}`,
    `#define LP_OZ_C ${f(a.ozoneCenter)}`,
    `#define LP_OZ_HW ${f(a.ozoneHalfWidth)}`,
    `#define LP_MIE_G ${f(a.mieG)}`,
    `#define LP_GROUND_ALBEDO ${v3(a.groundAlbedo)}`,
    `#define LP_MS_ALBEDO ${v3(a.msAlbedo)}`,
    `#define LP_ORBIT_GROUND_ALBEDO ${v3(GROUND_BOUNCE.orbit)}`,
    `#define LP_GROUND_X ${f(LUT.groundX)}`,
    `#define LP_SUN_SIN ${f(Math.sin(SUN_ANGULAR_RADIUS))}`,
    `#define LP_SUN_COS ${f(Math.cos(SUN_ANGULAR_RADIUS))}`,
    `#define LP_SUN_ANG ${f(SUN_ANGULAR_RADIUS)}`,
    `#define LP_TRANS_W ${f(LUT.transW)}`,
    `#define LP_TRANS_H ${f(LUT.transH)}`,
    `#define LP_MS_SIZE ${f(LUT.msSize)}`,
    `#define LP_SH_MU ${f(LUT.shMu)}`,
    `#define LP_SH_ALT ${f(LUT.shAlt)}`,
    `#define LP_SH_HMAX ${f(LUT.shMaxAlt)}`,
    `#define LP_ATLAS_W ${f(LUT.atlasW)}`,
    `#define LP_ATLAS_H ${f(LUT.atlasH)}`,
    `#define LP_CLOUD_BOT ${f(CLOUD.bottom)}`,
    `#define LP_CLOUD_TOP ${f(CLOUD.top)}`,
    `#define LP_CLOUD_MID ${f(CLOUD.mid)}`,
    `#define LP_AG_ALT ${f(AIRGLOW.alt)}`,
    `#define LP_AG_HW ${f(AIRGLOW.halfWidth)}`,
    `#define LP_AG_RAD ${v3(AIRGLOW.color.map((c) => c * AIRGLOW.radiance / 0.62))}`,
    '',
  ].join('\n');
}
