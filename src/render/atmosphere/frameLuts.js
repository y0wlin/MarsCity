// Per-frame atmosphere LUTs for a camera inside the atmosphere (Hillaire 2020). OWNER: atmosphere agent.
//   skyView (RGBA16F 256x192): in-scattered radiance (unit sun) along every view direction from the
//            camera to the top of the atmosphere / the ground. Sky pixels read it instead of marching.
//   aerial   (RGBA16F 64x40x40 froxels): in-scattering (rgb, unit sun) and mean transmittance (a)
//            from the camera to distance d along each screen direction, d = Dmax * s^2. Surfaces
//            read their aerial perspective from it with one 3D fetch.
// Both are recomputed every frame the camera or the sun changes (cheap: ~1.5 M march steps).
import * as THREE from 'three';
import { atmosphereDefines, LUT } from './model.js';
import { GLSL_MATH } from '../shaders/common.glsl.js';
import { GLSL_ATMO_CORE, GLSL_ATMO_MS, GLSL_ATMO_MARCH, GLSL_SKYVIEW } from '../shaders/atmosphere.glsl.js';
import { fsMaterial, FullscreenPass, halfFloatTarget } from './gpu.js';

export const SKY_W = 256, SKY_H = 192;
export const AP_W = 64, AP_H = 40, AP_D = 40;

const HEAD = () => atmosphereDefines() + GLSL_MATH + GLSL_ATMO_CORE + GLSL_ATMO_MS + GLSL_ATMO_MARCH + GLSL_SKYVIEW;

const SKY_FRAG = () => HEAD() + /* glsl */`
uniform float uCamR;
uniform float uCamH;
uniform float uMus;       // cos sun zenith at the camera
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${SKY_W}.0, ${SKY_H}.0);
  float r = uCamR, h = uCamH;
  float muh = lpHorizonMu(r, h);
  vec2 dz = lpSkyViewDir(uv, muh);
  float mu = dz.x, az = dz.y;
  float sinZ = sqrt(max(0.0, 1.0 - mu * mu));
  vec3 rd = vec3(sinZ * cos(az), sinZ * sin(az), mu);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - uMus * uMus)), 0.0, uMus);
  float nu = dot(rd, sun);
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  vec2 tg = lpRaySphere(r, h, mu, 0.0);
  bool hitG = mu < 0.0 && tg.x <= tg.y && tg.y > 0.0;
  float t1 = hitG ? max(tg.x, 0.0) : max(tt.y, 0.0);
  vec3 L = vec3(0.0), T = vec3(1.0);
  lpIntegrate(r, h, mu, uMus, nu, max(tt.x, 0.0), t1, 40, 0.5, 2.0, L, T);
  outColor = vec4(L, 1.0);
}
`;

const AP_FRAG = () => HEAD() + /* glsl */`
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCamUp;
uniform vec3 uSunDir;
uniform float uCamR;
uniform float uCamH;
uniform float uSlice;
uniform float uDmax;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${AP_W}.0, ${AP_H}.0);
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 rd = normalize(uCamRot * normalize(vp.xyz / vp.w));
  float r = uCamR, h = uCamH;
  float mu = dot(uCamUp, rd), mus0 = dot(uCamUp, uSunDir), nu = dot(rd, uSunDir);
  float s = (uSlice + 1.0) / ${AP_D}.0;
  float t1 = uDmax * s * s;
  vec2 tt = lpRaySphere(r, h, mu, LP_ATMO_H);
  t1 = min(t1, max(tt.y, 0.0));
  vec3 L = vec3(0.0), T = vec3(1.0);
  int N = int(clamp(4.0 + uSlice * 0.6, 4.0, 28.0));
  lpIntegrate(r, h, mu, mus0, nu, 0.0, t1, N, 0.5, 1.5, L, T);
  outColor = vec4(L, dot(T, vec3(0.3333333)));
}
`;

export class FrameLUTs {
  constructor(renderer, lightingUniforms, msTex) {
    this.renderer = renderer;
    this.sky = halfFloatTarget(SKY_W, SKY_H);
    this.sky.texture.name = 'lp.skyView';
    this.ap = new THREE.WebGL3DRenderTarget(AP_W, AP_H, AP_D, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false });
    const t = this.ap.texture;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.name = 'lp.aerial';
    const lu = lightingUniforms;
    this.skyUniforms = { uLpAtlas: lu.uLpAtlas, uLpMsLut: { value: msTex }, uCamR: { value: 0 }, uCamH: { value: 0 }, uMus: { value: 1 } };
    this.apUniforms = {
      uLpAtlas: lu.uLpAtlas, uLpMsLut: { value: msTex }, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
      uCamUp: { value: new THREE.Vector3() }, uSunDir: lu.uSunDir, uCamR: { value: 0 }, uCamH: { value: 0 }, uSlice: { value: 0 }, uDmax: { value: 1e5 },
    };
    this.skyPass = new FullscreenPass(fsMaterial({ fragmentShader: SKY_FRAG(), uniforms: this.skyUniforms }));
    this.apPass = new FullscreenPass(fsMaterial({ fragmentShader: AP_FRAG(), uniforms: this.apUniforms }));
    this.dmax = 1e5;
  }

  static dmaxFor(h) {
    const R = 3389500;
    return THREE.MathUtils.clamp(Math.sqrt(2 * R * Math.max(h, 1)) + 280000, 60000, 1400000);
  }

  /** recompute both LUTs for the current camera (projection may be jittered) */
  update(frame, camera, camR, camH) {
    const r = this.renderer;
    const mus = frame.camUp.dot(frame.sunDir);
    const su = this.skyUniforms;
    su.uCamR.value = camR; su.uCamH.value = camH; su.uMus.value = mus;
    this.skyPass.render(r, this.sky);
    const au = this.apUniforms;
    au.uInvProj.value.copy(camera.projectionMatrixInverse);
    au.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    au.uCamUp.value.copy(frame.camUp);
    au.uCamR.value = camR; au.uCamH.value = camH;
    this.dmax = FrameLUTs.dmaxFor(camH);
    au.uDmax.value = this.dmax;
    for (let z = 0; z < AP_D; z++) {
      au.uSlice.value = z;
      this.apPass.render(r, this.ap, null, z);
    }
  }

  dispose() { this.sky.dispose(); this.ap.dispose(); this.skyPass.dispose(); this.apPass.dispose(); }
}
